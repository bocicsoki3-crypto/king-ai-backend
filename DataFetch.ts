// FÁJL: DataFetch.ts
// VERZIÓ: v93.0 ("Tiszta P1" Hibatűrés)
// MÓDOSÍTÁS (v93.0):
// 1. HOZZÁADVA: `generateEmptyStubContext` segédfüggvény (a newHockeyProvider.ts v74.0 alapján).
// 2. MÓDOSÍTVA: A `getRichContextualData` (kb. 350. sor) már NEM DOB FATÁLIS HIBÁT,
//    ha a P4-es adatgyűjtés (pl. `getApiSportsTeamId`) null-t ad vissza.
// 3. LOGIKA: API hiba esetén a rendszer a `generateEmptyStubContext` által adott
//    üres választ adja vissza. Ez lehetővé teszi az AnalysisFlow.ts számára,
//    hogy folytassa a futást, és kizárólag a P1 (manuális) adatokra támaszkodjon.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather } from './src/types/canonical.d.ts'; // Bővítve
// Providerek importálása
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries, 
    _getLeagueRoster, 
    getApiSportsTeamId, 
    getApiSportsLeagueId 
} from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';
import { fetchSofascoreData, type ISofascoreResponse } from './providers/sofascoreProvider.js';
import { fetchOddsData as oddsFeedFetchData } from './providers/oddsProvider.js';
import { runStep_TeamNameResolver } from './AI_Service.js';
import { SPORT_CONFIG } from './config.js';
// Importálás a központi utils fájlból
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures,
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry
} from './providers/common/utils.js';

// --- FŐ CACHE INICIALIZÁLÁS ---
export const preFetchAnalysisCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

// Típusdefiníció a providerek számára
interface IDataProvider {
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

type CanonicalRole = 'Kapus' | 'Védő' | 'Középpályás' | 'Támadó' | 'Ismeretlen';

// Az 'apiSportsProvider' manuális becsomagolása az 'IDataProvider' interfészhez
const apiSportsProvider: IDataProvider = {
    fetchMatchData: apiSportsFetchData,
    providerName: apiSportsProviderName
};
// Interfész a kiterjesztett funkció opciókhoz
export interface IDataFetchOptions {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
    forceNew: boolean;
    manual_xg_home?: number | null; 
    manual_xg_away?: number | null;
    manual_H_xG?: number | null;
    manual_H_xGA?: number | null;
    manual_A_xG?: number | null;
    manual_A_xGA?: number | null;
    manual_absentees?: { home: { name: string, pos: string }[], away: { name: string, pos: string }[] } | null; 
}

// Az IDataFetchResponse kiterjeszti az ICanonicalRichContext-et
export interface IDataFetchResponse extends ICanonicalRichContext {
    xgSource: string; 
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v93.0 (Tiszta P1 Hibatűrés)
**************************************************************/

/**
 * === ÚJ (v93.0): "Stub" Válasz Generátor ===
 * Létrehoz egy üres, de érvényes ICanonicalRichContext objektumot,
 * ha az API-hívások (pl. csapat ID) meghiúsulnak.
 * Ez lehetővé teszi a P1-es adatok (manuális xG, hiányzók) feldolgozását.
 */
function generateEmptyStubContext(options: IDataFetchOptions): IDataFetchResponse {
    const { sport, homeTeamName, awayTeamName } = options;
    
    console.warn(`[DataFetch/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const emptyWeather: IStructuredWeather = {
        description: "N/A (API Hiba)",
        temperature_celsius: null,
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: {
             homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A",
            structured_weather: emptyWeather,
            pitch_condition: "N/A", 
            weather: "N/A",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    const result: IDataFetchResponse = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { 
             home: { xg: null }, 
             away: { xg: null },
             // Átadjuk a P1 adatokat, ha léteznek
             manual_H_xG: options.manual_H_xG,
             manual_H_xGA: options.manual_H_xGA,
             manual_A_xG: options.manual_A_xG,
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] },
         xgSource: "N/A (API Hiba)"
    };
    
    return result;
}


function getProvider(sport: string): IDataProvider {
  switch (sport.toLowerCase()) {
    case 'soccer':
      return apiSportsProvider;
    case 'hockey':
      return hockeyProvider; 
    case 'basketball':
      return basketballProvider;
    default:
      throw new Error(`Nem támogatott sportág: '${sport}'. Nincs implementált provider.`);
  }
}

/**
 * Segédfüggvény a pozíció nevének fordításához (a Model.ts által várt formátumra)
 */
function getRoleFromPos(pos: string): CanonicalRole {
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
    if (p === 'D') return 'Védő';
    if (p === 'M') return 'Középpályás';
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v93.0)
 */
export async function getRichContextualData(
    options: IDataFetchOptions,
    explicitMatchId?: string 
): Promise<IDataFetchResponse> {
    
    const { 
        sport, 
        homeTeamName, 
        awayTeamName, 
        leagueName, 
        utcKickoff, 
        forceNew,
        manual_H_xG,
        manual_H_xGA,
        manual_A_xG,
        manual_A_xGA,
        manual_absentees
    } = options;

    const decodedLeagueName = decodeURIComponent(decodeURIComponent(leagueName || 'N/A'));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(homeTeamName || 'N/A'));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(awayTeamName || 'N/A'));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    
    const p1AbsenteesHash = manual_absentees ?
        `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
        '';
        
    const ck = explicitMatchId || `rich_context_v62.1_roster_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    // === CACHE OLVASÁS ===
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            
            const finalData = { ...cached };
            let xgSource: IDataFetchResponse['xgSource'] = cached.xgSource || 'Calculated (Fallback)';

            // P1 xG felülbírálás a cache-elt adatokon
            if (manual_H_xG != null && manual_H_xGA != null && manual_A_xG != null && manual_A_xGA != null) {
                finalData.advancedData.manual_H_xG = manual_H_xG;
                finalData.advancedData.manual_H_xGA = manual_H_xGA;
                finalData.advancedData.manual_A_xG = manual_A_xG;
                finalData.advancedData.manual_A_xGA = manual_A_xGA;
                xgSource = "Manual (Components)"; 
            }
            
            // P1 Hiányzó felülbírálás a cache-elt adatokon
            if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
                const mapManualToCanonical = (playerStub: { name: string, pos: string }): ICanonicalPlayer => ({
                    name: playerStub.name,
                    role: getRoleFromPos(playerStub.pos), 
                    importance: 'key', 
                    status: 'confirmed_out',
                    rating_last_5: 7.5
                });
                finalData.rawData.detailedPlayerStats.home_absentees = manual_absentees.home.map(mapManualToCanonical);
                finalData.rawData.detailedPlayerStats.away_absentees = manual_absentees.away.map(mapManualToCanonical);
                finalData.rawData.absentees.home = finalData.rawData.detailedPlayerStats.home_absentees;
                finalData.rawData.absentees.away = finalData.rawData.detailedPlayerStats.away_absentees;
            }

            return { ...finalData, fromCache: true, xgSource: xgSource };
        }
    }
    // === CACHE OLVASÁS VÉGE ===

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        if (sport === 'soccer' && countryContext === 'N/A') {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        
        // 1. LÉPÉS: Liga adatok lekérése
        const leagueDataResponse = await getApiSportsLeagueId(decodedLeagueName, countryContext, new Date(decodedUtcKickoff).getFullYear(), sport);
        
        // === MÓDOSÍTÁS (v93.0): TISZTA P1 HIBATŰRÉS ===
        if (!leagueDataResponse || !leagueDataResponse.leagueId) {
             console.error(`[DataFetch] KRITIKUS P4 HIBA: Végleg nem sikerült a 'leagueId' azonosítása ('${decodedLeagueName}' néven).`);
             console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
             // Ahelyett, hogy hibát dobnánk, visszaadjuk az üres "stub"-ot.
             // Az AnalysisFlow ezután a P1-es adatokat fogja használni.
             return generateEmptyStubContext(options);
        }
        // === MÓDOSÍTÁS VÉGE ===
        
        const { leagueId, foundSeason } = leagueDataResponse;

        // 2. LÉPÉS: Csapat ID-k lekérése (Statikus Keresés - AI nélkül)
        let homeTeamId: number | null = await getApiSportsTeamId(decodedHomeTeam, sport, leagueId, foundSeason);
        let awayTeamId: number | null = await getApiSportsTeamId(decodedAwayTeam, sport, leagueId, foundSeason);
        
        // === V77.3: AI Névfeloldó (8. Ügynök) Fallback Logika ===
        if (sport === 'soccer' && (!homeTeamId || !awayTeamId)) {
            console.warn(`[DataFetch] Statikus névfeloldás sikertelen (H:${homeTeamId}, A:${awayTeamId}). AI Fallback indítása (8. Ügynök)...`);

            const leagueRoster = await _getLeagueRoster(leagueId, foundSeason, sport);
            const rosterStubs = leagueRoster.map(item => ({ id: item.team.id, name: item.team.name }));
            
            if (!homeTeamId) {
                const result = await runStep_TeamNameResolver({
                    inputName: decodedHomeTeam,
                    searchTerm: decodedHomeTeam.toLowerCase().trim(),
                    rosterJson: rosterStubs 
                });
                if (result) {
                    homeTeamId = result;
                    console.log(`[DataFetch] AI SIKER: Hazai csapat azonosítva (ID: ${homeTeamId}).`);
                }
            }
            if (!awayTeamId) {
                const result = await runStep_TeamNameResolver({
                    inputName: decodedAwayTeam,
                    searchTerm: decodedAwayTeam.toLowerCase().trim(),
                    rosterJson: rosterStubs 
                });
                if (result) {
                    awayTeamId = result;
                    console.log(`[DataFetch] AI SIKER: Vendég csapat azonosítva (ID: ${awayTeamId}).`);
                }
            }
        }
        // === VÉGE: AI Névfeloldó Logika ===

        // 3. LÉPÉS: Ellenőrzés (Ha az AI sem tudta megoldani)
        // === MÓDOSÍTÁS (v93.0): TISZTA P1 HIBATŰRÉS ===
        if (!homeTeamId || !awayTeamId) {
            console.error(`[DataFetch] KRITIKUS P4 HIBA: A csapat azonosítókat a statikus keresés és az AI Fallback sem tudta feloldani. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}.`);
            console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
            // Ahelyett, hogy hibát dobnánk, visszaadjuk az üres "stub"-ot.
            return generateEmptyStubContext(options);
        }
        // === MÓDOSÍTÁS VÉGE ===

        // 4. LÉPÉS: Adatgyűjtés a már azonosított ID-kkal
        const providerOptions = {
            sport: sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff,
            countryContext: countryContext,
            // A providernek szüksége van az ID-kra is
            homeTeamId: homeTeamId, 
            awayTeamId: awayTeamId,
            leagueId: leagueId,
            foundSeason: foundSeason
        };
        
        // Párhuzamos hívás (P4 Alap + P2 Kontextus)
        const skipSofascore = (options.manual_H_xG != null);
        const [
            baseResult, // Ez a provider belső ID-val lekérdezett eredménye
            sofascoreData // P2 (Prémium) Kontextus
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            (sport === 'soccer' && !skipSofascore)
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);
        
        // === EGYESÍTÉS ===
        const finalResult: ICanonicalRichContext = baseResult;
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: IDataFetchResponse['xgSource'];
        
        // 1. xG PRIORITÁSI LÁNC
        if (manual_H_xG != null && manual_H_xGA != null &&
            manual_A_xG != null && manual_A_xGA != null)
        {
            finalResult.advancedData.manual_H_xG = manual_H_xG;
            finalResult.advancedData.manual_H_xGA = manual_H_xGA;
            finalResult.advancedData.manual_A_xG = manual_A_xG;
            finalResult.advancedData.manual_A_xGA = manual_A_xGA;
            finalHomeXg = (manual_H_xG + manual_A_xGA) / 2;
            finalAwayXg = (manual_A_xG + manual_H_xGA) / 2;
            xgSource = "Manual (Components)";
        }
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away;
            xgSource = "API (Real)"; // Sofascore a legjobb
        }
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = "API (Real)"; // apiSports a második legjobb
        }
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xgSource = "Calculated (Fallback)"; // P4
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        // === REDUNDÁNS ODDS FALLBACK (Bielefeld-javítás) ===
        const primaryOddsFailed = !finalResult.oddsData || 
                                  !finalResult.oddsData.allMarkets || 
                                  finalResult.oddsData.allMarkets.length === 0;
        
        const fixtureId = finalResult.rawData.apiFootballData?.fixtureId;

        if (primaryOddsFailed && fixtureId && sport === 'soccer') {
            console.warn(`[DataFetch] Az 'apiSportsProvider' nem adott vissza Odds adatot. Fallback indítása az 'OddsProvider'-re (FixtureID: ${fixtureId})...`);
            
            try {
                const oddsFeedResult = await oddsFeedFetchData(fixtureId, sport);
                
                if (oddsFeedResult) {
                    console.log(`[DataFetch] SIKER. Az 'OddsProvider' megbízható odds adatokat adott vissza.`);
                    finalResult.oddsData = oddsFeedResult; 
                } else {
                    console.warn(`[DataFetch] A 'fallback' ('OddsProvider') sem adott vissza adatot a ${fixtureId} ID-hoz.`);
                }
            } catch (e: any) {
                console.error(`[DataFetch] Kritikus hiba az 'OddsProvider' fallback hívása során: ${e.message}`);
            }
        } else if (!primaryOddsFailed) {
            console.log(`[DataFetch] Az 'apiSportsProvider' sikeresen adott vissza Odds adatot. Fallback kihagyva.`);
        }
        // === REDUNDÁNS ODDS FALLBACK VÉGE ===

        
        // 2. HIÁNYZÓK PRIORITÁSI LÁNC
        // === PLAN A (Manuális) ===
        if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
            console.log(`[DataFetch] Felülírás (P1): Manuális hiányzók alkalmazva. (H: ${manual_absentees.home.length}, A: ${manual_absentees.away.length}). Automatikus lekérés (Sofascore/apiSports) kihagyva.`);
            
            const mapManualToCanonical = (playerStub: { name: string, pos: string }): ICanonicalPlayer => ({
                name: playerStub.name,
                role: getRoleFromPos(playerStub.pos),
                importance: 'key', 
                status: 'confirmed_out',
                rating_last_5: 7.5
            });

            finalResult.rawData.detailedPlayerStats = {
                home_absentees: manual_absentees.home.map(mapManualToCanonical),
                away_absentees: manual_absentees.away.map(mapManualToCanonical),
                key_players_ratings: { home: {}, away: {} } 
            };
            finalResult.rawData.absentees = {
                home: finalResult.rawData.detailedPlayerStats.home_absentees,
                away: finalResult.rawData.detailedPlayerStats.away_absentees
            };
        }
        // === PLAN B (Automatikus - Sofascore) ===
        else if (options.sport === 'soccer') {
            const hasValidSofascoreData = (data: ISofascoreResponse | null): data is (ISofascoreResponse & { playerStats: ICanonicalPlayerStats }) => {
                return !!data && 
                       !!data.playerStats && 
                       (data.playerStats.home_absentees.length > 0 || 
                        data.playerStats.away_absentees.length > 0 ||
                        Object.keys(data.playerStats.key_players_ratings.home).length > 0);
            };

            if (hasValidSofascoreData(sofascoreData)) {
                console.log(`[DataFetch] Felülírás (P2): Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absentees.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);
                finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
                finalResult.rawData.absentees = {
                    home: sofascoreData.playerStats.home_absentees,
                    away: sofascoreData.playerStats.away_absentees
                };
            } else {
                // === PLAN C (Automatikus - apiSports Fallback) ===
                console.warn(`[DataFetch] Figyelmeztetés: A Sofascore (P2) nem adott vissza hiányzó-adatot. Az 'apiSportsProvider' (P4) adatai maradnak érvényben.`);
            }
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Cache mentése
        const response: IDataFetchResponse = {
            ...finalResult,
            xgSource: xgSource 
        };
        
        preFetchAnalysisCache.set(ck, response);
        console.log(`Sikeres adat-egyesítés (v93.0), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v93.0) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         // Még egy utolsó védvonal
         console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE (Catch Blokk). A rendszer üres adat-stubot ad vissza.`);
         return generateEmptyStubContext(options);
    }
}


// === P1 KERET-LEKÉRŐ FÜGGVÉNY (Változatlan v93.0) ===
export async function getRostersForMatch(options: {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } |
null> {
    
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
    try {
        const sportProvider = getProvider(options.sport);
        const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName || 'N/A'));
        const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName || 'N/A'));
        const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName || 'N/A'));
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff || new Date().toISOString()));
        
        const sportConfig = SPORT_CONFIG[options.sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A';
        
        const leagueDataResponse = await getApiSportsLeagueId(decodedLeagueName, countryContext, new Date(decodedUtcKickoff).getFullYear(), options.sport);
        if (!leagueDataResponse || !leagueDataResponse.leagueId) {
             console.warn(`[DataFetch] Nem sikerült a liga ID azonosítása a keret lekéréséhez.`);
             return null;
        }
        const { leagueId, foundSeason } = leagueDataResponse;
        
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiSportsTeamId(decodedHomeTeam, options.sport, leagueId, foundSeason),
            getApiSportsTeamId(decodedAwayTeam, options.sport, leagueId, foundSeason),
        ]);
        
        if (!homeTeamId || !awayTeamId) {
             console.warn(`[DataFetch] Csapat ID hiányzik a keret lekéréséhez. (HomeID: ${homeTeamId}, AwayID: ${awayTeamId}).`);
             return null;
        }

        const providerOptions = {
            sport: options.sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff,
            countryContext: countryContext,
            homeTeamId: homeTeamId, 
            awayTeamId: awayTeamId,
            leagueId: leagueId,
            foundSeason: foundSeason
        };

        const baseResult = await sportProvider.fetchMatchData(providerOptions);
        
        if (baseResult && 
            baseResult.availableRosters && 
            (baseResult.availableRosters.home.length > 0 || baseResult.availableRosters.away.length > 0)
        ) {
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) 'availableRosters' adatot adott vissza, de az üres (H: ${baseResult?.availableRosters?.home?.length ?? 'N/A'}, A: ${baseResult?.availableRosters?.away?.length ?? 'N/A'}). Ez hibának minősül.`);
            return null;
        }

    } catch (e: any) {
        console.error(`[DataFetch] Hiba a getRostersForMatch során: ${e.message}`, e.stack);
        return null;
    }
}


// --- KÖZÖS FÜGGVÉNYEK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;
