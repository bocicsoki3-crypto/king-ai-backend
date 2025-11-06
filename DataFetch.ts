// FÁJL: DataFetch.ts
// VERZIÓ: v63.0 (Javított)
// MÓDOSÍTÁS (Feladat 2.2):
// 1. ÚJ IMPORT: 'IPlayerStub' és 'ICanonicalPlayer' importálva a típusokhoz.
// 2. ÚJ FÜGGVÉNY: 'getRostersForMatch' exportálva az '/getRosters' végpont számára.
// 3. MÓDOSÍTOTT INTERFÉSZ: 'IDataFetchOptions' kiegészítve a 'manual_absentees' mezővel.
// 4. MÓDOSÍTOTT LOGIKA: 'getRichContextualData' kiegészítve a "Plan A / Plan B" hiányzó-kezeléssel.
// 5. JAVÍTÁS: A 'baseBResult' elgépelés javítva 'baseResult'-ra.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer } from './src/types/canonical.d.ts'; // <- MÓDOSÍTVA
// Providerek importálása
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries // v58.1
} from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';
import { fetchSofascoreData, type ISofascoreResponse } from './providers/sofascoreProvider.js';
import { getApiHostConfig, SPORT_CONFIG } from './config.js';
import { _callGemini } from './AI_Service.js';
import { decodeOptions } from './providers/common/utils.js';

// Globális cache beállítása
// stdTTL: 1 óra (3600 másodperc) a meccsekhez és statisztikákhoz
const scriptCache = new NodeCache({ stdTTL: 3600 });
const LEAGUE_CACHE_KEY = 'ESPN_LEAGUES_CACHE_V1';

// --- TÍPUSDEFINÍCIÓK ---

/**
 * A bemeneti paraméterek a fő adatgyűjtő funkciók számára.
 */
interface IDataFetchOptions {
    sport: string;
    home: string;
    away: string;
    league: string;
    date: string; // ISO dátum formátum
    fixtureId?: number; // Opcionális API-Sports azonosító
    sheetUrl?: string; // Opcionális sheet url (tanuláshoz)
    // ÚJ (v63.0) A manuálisan kiválasztott hiányzók.
    manual_absentees?: {
        home: IPlayerStub[];
        away: IPlayerStub[];
    }
}

/**
 * A fő adatgyűjtő funkciók visszatérési típusa.
 */
interface IDataFetchResponse extends ICanonicalRichContext {
    xgSource: 'SOFASCORE' | 'APISPORTS' | 'ESTIMATED' | 'MANUAL';
    // Az 'availableRosters' automatikusan benne van az ICanonicalRichContext-ben
}

/**
 * Egy meccs alapvető adatai, ahogy az ESPN-től érkezik.
 */
export interface IFixedFixture {
    id: string; // UUID az ESPN-hez, pl: 401614741
    utcKickoff: string;
    home: string;
    away: string;
    league: string;
    espnLink: string;
    sport: string;
}


// --- EXPORTÁLT FUNKCIÓK ---

/**
 * Segédfüggvény az ESPN-ből származó meccsek lekérésére.
 * Cache-elést használ.
 * @param sport - sportág slugja (pl. 'soccer')
 * @param leagueName - liga neve (pl. 'Premier League')
 * @returns IFixedFixture[]
 */
export async function _getFixturesFromEspn(sport: string, leagueName: string): Promise<IFixedFixture[]> {
    const cacheKey = `fixtures_v1_${sport}_${leagueName}`;
    const cached = scriptCache.get<IFixedFixture[]>(cacheKey);
    if (cached) {
        console.log(`[DataFetch] ESPN meccsek betöltve a cache-ből (${cacheKey}).`);
        return cached;
    }

    const sportConfig = SPORT_CONFIG[sport];
    const leagueConfig = sportConfig.espn_leagues[leagueName];

    if (!leagueConfig) {
        throw new Error(`Ismeretlen liga konfiguráció: ${sport} / ${leagueName}`);
    }

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${leagueConfig.slug}/scoreboard`;
        console.log(`[DataFetch] ESPN meccsek lekérése: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API hiba: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        const fixtures: IFixedFixture[] = [];
        const events = data.events || [];

        for (const event of events) {
            if (event.status.type.state === 'pre') { // Csak a még el nem kezdett meccsek
                const homeTeam = event.competitions[0].competitors.find((c: any) => c.homeAway === 'home');
                const awayTeam = event.competitions[0].competitors.find((c: any) => c.homeAway === 'away');

                if (homeTeam && awayTeam) {
                    fixtures.push({
                        id: event.id,
                        utcKickoff: event.date,
                        home: homeTeam.team.displayName,
                        away: awayTeam.team.displayName,
                        league: leagueName,
                        espnLink: event.links.find((l: any) => l.rel.includes('summary'))?.href || '',
                        sport: sport
                    });
                }
            }
        }
        
        scriptCache.set(cacheKey, fixtures, 300); // Cache 5 percig (300 mp)
        console.log(`[DataFetch] ${fixtures.length} meccs cache-elve.`);
        return fixtures;

    } catch (e: any) {
        console.error(`Hiba az ESPN meccslekérés során: ${e.message}`);
        throw new Error(`Hiba az ESPN meccsek lekérése során: ${e.message}`);
    }
}


/**
 * A fő adatgyűjtő funkció, amely minden adatot (stats, advanced, context) összegyűjt.
 * Egy sportág-specifikus provider-t hív (pl. apiSportsProvider.fetchMatchData).
 * @param options - IDataFetchOptions
 * @returns IDataFetchResponse
 */
export async function getRichContextualData(options: IDataFetchOptions): Promise<IDataFetchResponse> {
    const { sport, home, away, league, date, fixtureId, sheetUrl, manual_absentees } = options;
    
    const ck = `analysis_v63_${sport}_${home.replace(/\s/g, '-')}_${away.replace(/\s/g, '-')}_${league.replace(/\s/g, '-')}_${fixtureId || 'no-id'}`;
    const cached = scriptCache.get<IDataFetchResponse>(ck);

    if (cached) {
        console.log(`[DataFetch] Adatok betöltve a cache-ből (${ck}).`);
        return { ...cached, fromCache: true };
    }

    const sportProvider = 
        sport === 'soccer' ? { fetchMatchData: apiSportsFetchData, providerName: apiSportsProviderName } :
        sport === 'hockey' ? hockeyProvider :
        sport === 'basketball' ? basketballProvider :
        null;
        
    if (!sportProvider) {
        throw new Error(`Nincs konfigurálva provider a(z) ${sport} sportághoz.`);
    }

    console.log(`Adatgyűjtés indul (v63.0 - ${sport}): ${home} vs ${away}...`);
    
    let baseResult: ICanonicalRichContext | null = null;
    let xgSource: IDataFetchResponse['xgSource'] = 'ESTIMATED';
    let finalResult: ICanonicalRichContext;

    try {
        // 1. Sport-specifikus adatgyűjtő hívása
        baseResult = await sportProvider.fetchMatchData(options);
        
        if (!baseResult) {
            throw new Error(`A(z) ${sportProvider.providerName} nem adott vissza eredményt.`);
        }
        
        finalResult = baseResult;

        // 2. Kiegészítő adatgyűjtés (pl. Sofascore xG) - Jelenleg csak focira
        if (sport === 'soccer' && baseResult.rawData?.contextual_factors?.venue_city) {
            console.log(`[DataFetch] Sofascore adatlekérési kísérlet...`);
            const sofascoreOptions = {
                ...options,
                venueCity: baseResult.rawData.contextual_factors.venue_city
            };
            const sofascoreData = await fetchSofascoreData(sofascoreOptions);
            
            if (sofascoreData) {
                console.log(`[DataFetch] Sofascore adatok beolvasva.`);
                
                // xG adat felülírása
                if (sofascoreData.advancedData?.xg_home != null && sofascoreData.advancedData?.xG_away != null) {
                    finalResult.advancedData.home.xg = sofascoreData.advancedData.xg_home;
                    finalResult.advancedData.away.xg = sofascoreData.advancedData.xG_away;
                    xgSource = 'SOFASCORE';
                    console.log(`[DataFetch] xG forrás beállítva: SOFASCORE`);
                } else if (baseResult.advancedData.home.xg != null && baseResult.advancedData.away.xg != null) {
                    // Ha a Sofascore nem adott xG-t, de a baseProvider igen
                    xgSource = 'APISPORTS';
                    console.log(`[DataFetch] xG forrás beállítva: APISPORTS (Sofascore xG hiányzott)`);
                } else {
                    // Ha egyik sem adott xG-t, akkor ESTIMATED marad
                    console.log(`[DataFetch] xG forrás beállítva: ESTIMATED (Sem API-Sports, sem Sofascore nem adott xG-t)`);
                }
                
                // Játékos statisztikák egyesítése (ez a P2/P3/P4)
                if (sofascoreData.playerStats?.home?.length || sofascoreData.playerStats?.away?.length) {
                    // Plan B (P4): Megpróbáljuk a Sofascore játékos-adatait felhasználni,
                    // ha a base provider (P1/P2/P3) hiányos volt.
                    if (!finalResult.rawData.playerStats?.home?.length && sofascoreData.playerStats.home.length) {
                        finalResult.rawData.playerStats = {
                            home: sofascoreData.playerStats.home as ICanonicalPlayerStats[],
                            away: sofascoreData.playerStats.away as ICanonicalPlayerStats[]
                        };
                        console.log(`[DataFetch] Játékos-adatok felülírva Sofascore adatokkal (P4 fallback).`);
                    } else if (finalResult.rawData.playerStats?.home?.length) {
                        console.log(`[DataFetch] Játékos-adatok (P1-P3) megtartva, a Sofascore adatok (P4) elvetve.`);
                    }
                }
                
            } else if (baseResult.advancedData.home.xg != null && baseResult.advancedData.away.xg != null) {
                xgSource = 'APISPORTS';
                console.log(`[DataFetch] xG forrás beállítva: APISPORTS (Sofascore hívás sikertelen volt)`);
            } else {
                console.log(`[DataFetch] Sofascore adatok nem érhetők el, xG forrás: ESTIMATED.`);
            }
        } else if (baseResult.advancedData.home.xg != null && baseResult.advancedData.away.xg != null) {
            xgSource = 'APISPORTS';
            console.log(`[DataFetch] xG forrás beállítva: APISPORTS (Nem foci, vagy hiányzott a venue_city)`);
        }
        
        // 3. Hiányzók / Keretek kezelése (P1 manuális választó)
        // A 'manual_absentees' felülírja a provider által biztosított 'injuries/absentees'-t a rawData-ban.
        if (manual_absentees?.home?.length || manual_absentees?.away?.length) {
             console.log(`[DataFetch] Manuális hiányzók felülírják a provider adatait.`);
             xgSource = 'MANUAL'; // Manuális beavatkozás miatt xG forrás frissítése
             
             // Plan A: A manual_absentees csak a hiányzókat tartalmazza (P1)
             // Az 'ICanonicalRawData.injuries' felülírása a P1-es választással
             finalResult.rawData.injuries = {
                home: manual_absentees.home.map(p => ({
                    ...p, 
                    reason: "Manuálisan Kiválasztva (P1)"
                }) as ICanonicalPlayer),
                away: manual_absentees.away.map(p => ({
                    ...p, 
                    reason: "Manuálisan Kiválasztva (P1)"
                }) as ICanonicalPlayer)
             };

             // Plan B: Ha hiányoznak a PlayerStats (P2/P3), megpróbáljuk a P4-et újra.
             // Ha a P1-es hiányzó-választó aktív, de nincsenek P2/P3-as PlayerStats adatok (pl. API-Sports korlátozás),
             // akkor megpróbáljuk a P4-et (getApiSportsLineupsAndInjuries)
             if (sport === 'soccer' && (!finalResult.rawData.playerStats?.home?.length || !finalResult.rawData.playerStats?.away?.length)) {
                 console.warn(`[DataFetch] A P1-es hiányzó-választó aktív, de a PlayerStats hiányzik (P2/P3). Plan B (P4) fallback indítása...`);
                 if (options.fixtureId && finalResult.rawData.teams?.home?.id && finalResult.rawData.teams?.away?.id) {
                    try {
                        const baseResultP4 = await getApiSportsLineupsAndInjuries({
                            fixtureId: options.fixtureId,
                            homeTeamId: finalResult.rawData.teams.home.id,
                            awayTeamId: finalResult.rawData.teams.away.id
                        });
                        
                        if (baseResultP4?.playerStats?.home?.length) {
                            finalResult.rawData.playerStats = baseResultP4.playerStats as { home: ICanonicalPlayerStats[], away: ICanonicalPlayerStats[] };
                            console.log(`[DataFetch] Plan B (P4) fallback sikeres: ${finalResult.rawData.playerStats.home.length} játékos-stat betöltve.`);
                        } else {
                             console.warn(`[DataFetch] A (P4) fallback ('apiSportsProvider') sem adott vissza játékos-adatot.`);
                        }
                    } catch (e: any) {
                        console.error(`[DataFetch] Kritikus hiba a (P4) fallback ('apiSportsProvider') hívása során: ${e.message}`);
                    }
                } else {
                    console.warn(`[DataFetch] A (P4) fallback nem indítható, mert hiányzik a 'fixtureId' vagy 'teamId' a 'baseResult'-ból.`);
                }
            }
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Cache mentése
        const response: IDataFetchResponse = {
            ...finalResult,
            // Az 'availableRosters' automatikusan bekerül a '...finalResult'  részeként
            xgSource: xgSource 
        };
        
        scriptCache.set(ck, response);
        console.log(`Sikeres adat-egyesítés (v63.0), cache mentve (${ck}).`);
        
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v63.0) során (${options.home} vs ${options.away}): ${e.message}`, e.stack);
         throw new Error(`Adatgyűjtési hiba (v63.0): ${e.message}`);
    }
}


/**
 * getRostersForMatch (ÚJ FÜGGVÉNY - v63.0)
 * Ez a végpont felelős a P1-es hiányzó-választó azonnali betöltéséért a kliens oldalon.
 * Csak a kanonikus 'availableRosters'-t adja vissza.
 * @param options - IDataFetchOptions (sport, home, away, league, utcKickoff, fixtureId)
 * @returns { home: IPlayerStub[], away: IPlayerStub[] } | null
 */
export async function getRostersForMatch(options: { 
    sport: string, 
    home: string, 
    away: string, 
    league: string, 
    utcKickoff: string, 
    fixtureId?: number 
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } | null> {
    
    // Decodoljuk a paramétereket, ahogy az AnalysisFlow.ts is tenné
    const decodedHomeTeam = decodeURIComponent(options.home);
    const decodedAwayTeam = decodeURIComponent(options.away);
    const decodedLeagueName = decodeURIComponent(options.league);
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));

    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${decodedHomeTeam} vs ${decodedAwayTeam}`);
    
    const sportProvider = 
        options.sport === 'soccer' ? apiSportsFetchData :
        options.sport === 'hockey' ? hockeyProvider.fetchMatchData :
        options.sport === 'basketball' ? basketballProvider.fetchMatchData :
        null;
        
    if (!sportProvider) {
        console.warn(`[DataFetch] Nincs provider konfigurálva a(z) ${options.sport} sportághoz a keretlekéréshez.`);
        return null;
    }

    try {
        // Létrehozzuk a providerOptions-t a decode-olt értékekkel
        const providerOptions = {
            sport: options.sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff
            // Figyelem: A 'forceNew: true' szándékosan hiányzik,\
            // hogy a provider-szintű cache-t (pl. apiSportsLineupCache) használhassa, ha elérhető.\
        };

        // Meghívjuk a sport-specifikus adatlekérőt
        // Ez a hívás (pl. apiSportsProvider.fetchMatchData) már tartalmazza
        // az 'availableRosters'-t a válaszában.
        const baseResult = await sportProvider(providerOptions);
        
        if (baseResult && baseResult.availableRosters) {
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) nem adott vissza 'availableRosters' adatot.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[DataFetch] Hiba a getRostersForMatch során: ${e.message}`, e.stack);
        return null;
    }
}
