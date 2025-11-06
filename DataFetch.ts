// FÁJL: DataFetch.ts
// VERZIÓ: v62.1 (P1 Manuális Roster Választó - 3. Lépés)
// MÓDOSÍTÁS:
// 1. Nincs logikai változtatás.
//    A v54.44-es  kód
//    architekturálisan helyes, mivel a '...baseResult' 
//    és '...finalResult' operátorok automatikusan
//    továbbítják az 'apiSportsProvider.ts' (v62.1) által
//    biztosított új 'availableRosters' mezőt.
// 2. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

// === KÖVETKEZŐ LÉPÉS (6 FŐS BIZOTTSÁG) ===
// MÓDOSÍTÁS (Feladat 2.2):
// 1. ÚJ IMPORT: 'IPlayerStub' és 'ICanonicalPlayer' importálva a típusokhoz.
// 2. ÚJ FÜGGVÉNY: 'getRostersForMatch' exportálva az '/getRosters' végpont számára.
// 3. MÓDOSÍTOTT INTERFÉSZ: 'IDataFetchOptions' kiegészítve a 'manual_absentees' mezővel.
// 4. MÓDOSÍTOTT LOGIKA: 'getRichContextualData' kiegészítve a "Plan A / Plan B" hiányzó-kezeléssel.

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
import { SPORT_CONFIG } from './config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures
} from './providers/common/utils.js';
// --- FŐ CACHE INICIALIZÁLÁS ---
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
// Típusdefiníció a providerek számára
interface IDataProvider {
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

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
    manual_xg_home?: number | null; // v59.0 (Eltávolítva a v61.0-ben)
    manual_xg_away?: number | null;
    // v59.0 (Eltávolítva a v61.0-ben)
    manual_H_xG?: number | null;  // v61.0
    manual_H_xGA?: number | null; // v61.0
    manual_A_xG?: number | null;  // v61.0
    manual_A_xGA?: number | null;
    // v61.0
    manual_absentees?: { home: string[], away: string[] } | null; // ÚJ (6 FŐS BIZOTTSÁG)
}

// Az IDataFetchResponse kiterjeszti az ICanonicalRichContext-et (amely v62.1-ben
// már tartalmazza az 'availableRosters'-t)
export interface IDataFetchResponse extends ICanonicalRichContext {
    xgSource: 'Manual (Direct)' | 'Manual (Components)' | 'API (Real)' | 'Calculated (Fallback)';
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v62.1 (Logikailag v54.44 , de v62.1 kontextusban)
**************************************************************/

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
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v62.1)
 */
export async function getRichContextualData(
    options: IDataFetchOptions 
): Promise<IDataFetchResponse> {
    
    const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    // A cache kulcs a v62.1-es 'availableRosters' miatt változik
    // MÓDOSÍTÁS (6 FŐS BIZOTTSÁG): Cache kulcs kiegészítése a P1 hiányzók miatt
    const p1AbsenteesHash = options.manual_absentees ? 
        `_P1A_${options.manual_absentees.home.length}_${options.manual_absentees.away.length}` : 
        '';
    const ck = `rich_context_v62.1_roster_${options.sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    if (!options.forceNew) {
        const cached = scriptCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            return { ...cached, fromCache: true };
        }
    }
    
    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        // 1. Providerek kiválasztása és beállítása
        const sportProvider = getProvider(options.sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || options.sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[options.sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || null; 
        if (!countryContext) {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        
        const providerOptions = {
            sport: options.sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff
        };
        // Párhuzamos hívás (P4 Alap + P2 Kontextus)
        
        // MÓDOSÍTÁS (6 FŐS BIZOTTSÁG): Optimalizálás
        // Ha P1 hiányzókat adtunk meg, a Sofascore-t (P2) már csak az xG miatt hívjuk.
        // Ha P1 xG-t IS megadtunk, a Sofascore hívás teljesen kihagyható.
        const skipSofascore = (options.manual_H_xG != null);
        
        const [
            baseResult, // Ez (v62.1) már tartalmazza az 'availableRosters'-t
            sofascoreData // P2 (Prémium) Kontextus
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions),
            (options.sport === 'soccer' && !skipSofascore)
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);
        // === EGYESÍTÉS (v61.0/v62.1) ===
        // A 'baseResult' automatikusan tartalmazza az 'availableRosters'-t
        const finalResult: ICanonicalRichContext = baseResult;
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: IDataFetchResponse['xgSource'];
        // 1. xG PRIORITÁSI LÁNC (MÓDOSÍTVA v61.0)
        // A 2-mezős (Direkt) [image: 4223a5.png] logika eltávolítva
        if (options.manual_H_xG != null && options.manual_H_xGA != null &&
            options.manual_A_xG != null && options.manual_A_xGA != null)
        {
            // A Model.ts számolja ki az átlagot, itt csak továbbítjuk a komponenseket
            
            finalResult.advancedData.manual_H_xG = options.manual_H_xG;
            finalResult.advancedData.manual_H_xGA = options.manual_H_xGA;
            finalResult.advancedData.manual_A_xG = options.manual_A_xG;
            finalResult.advancedData.manual_A_xGA = options.manual_A_xGA;
            // A Model.ts majd kiszámolja a 'mu_h'-t és 'mu_a'-t
            finalHomeXg = (options.manual_H_xG + options.manual_A_xGA) / 2;
            finalAwayXg = (options.manual_A_xG + options.manual_H_xGA) / 2;
            xgSource = "Manual (Components)";
        }
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away;
            xgSource = "API (Real)";
        }
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = "API (Real)";
        }
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xgSource = "Calculated (Fallback)";
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        // === MÓDOSÍTÁS (6 FŐS BIZOTTSÁG): P1 MANUÁLIS HIÁNYZÓ KEZELÉS (PLAN A) ===
        if (options.manual_absentees && (options.manual_absentees.home.length > 0 || options.manual_absentees.away.length > 0)) {
            console.log(`[DataFetch] Felülírás (P1): Manuális hiányzók alkalmazva. (H: ${options.manual_absentees.home.length}, A: ${options.manual_absentees.away.length}). Automatikus lekérés (Sofascore/apiSports) kihagyva.`);
            
            const mapManualToCanonical = (name: string): ICanonicalPlayer => ({
                name: name,
                role: 'Ismeretlen', // A manuális bevitel nem tudja a szerepkört
                importance: 'key', // Feltételezzük, hogy a user csak fontos hiányzót ír be
                status: 'confirmed_out',
                rating_last_5: undefined
            });

            finalResult.rawData.detailedPlayerStats = {
                home_absentees: options.manual_absentees.home.map(mapManualToCanonical),
                away_absentees: options.manual_absentees.away.map(mapManualToCanonical),
                key_players_ratings: { home: {}, away: {} } // Manuális bevitel esetén nincsenek kulcsjátékos értékelések
            };
            finalResult.rawData.absentees = {
                home: finalResult.rawData.detailedPlayerStats.home_absentees,
                away: finalResult.rawData.detailedPlayerStats.away_absentees
            };
        }
        // === PLAN B (Automatikus) ===
        else if (options.sport === 'soccer') {
            // === Redundáns Hiányzó-adat Fallback (v54.44 - Változatlan) ===
            const hasValidSofascoreData = (data: ISofascoreResponse | null): data is (ISofascoreResponse & { playerStats: ICanonicalPlayerStats }) => {
                return !!data && 
                       !!data.playerStats && 
                       (data.playerStats.home_absentees.length > 0 || 
                        data.playerStats.away_absentees.length > 0 ||
                        Object.keys(data.playerStats.key_players_ratings.home).length > 0);
            };

            if (hasValidSofascoreData(sofascoreData)) {
                // 1. Eset: A Sofascore (P2) sikeres volt
                console.log(`[DataFetch] Felülírás (P2): Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absentees.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);
                finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
                finalResult.rawData.absentees = {
                    home: sofascoreData.playerStats.home_absentees,
                    away: sofascoreData.playerStats.away_absentees
                };
            } else {
                // 2. Eset: A Sofascore (P2) csődöt mondott
                console.warn(`[DataFetch] Figyelmeztetés: A Sofascore (P2) nem adott vissza hiányzó- vagy értékelés-adatot. Fallback indítása az 'apiSportsProvider' (P4) felé...`);
                const fixtureId = baseResult.rawData.apiFootballData?.fixtureId;
                const homeTeamId = baseResult.rawData.apiFootballData?.homeTeamId;
                const awayTeamId = baseBResult.rawData.apiFootballData?.awayTeamId;
                if (fixtureId && homeTeamId && awayTeamId) {
                    try {
                        // Hívjuk az 'apiSportsProvider'-ben (v58.1) lévő exportált funkciót
                        const apiSportsPlayerStats = await getApiSportsLineupsAndInjuries(fixtureId, options.sport, homeTeamId, awayTeamId);
                        if (apiSportsPlayerStats) {
                            console.log(`[DataFetch] Felülírás (P4 Fallback): A 'sofascoreProvider' üres adatai felülírva az 'apiSportsProvider' (P4) adataival.`);
                            finalResult.rawData.detailedPlayerStats = apiSportsPlayerStats;
                            finalResult.rawData.absentees = {
                                home: apiSportsPlayerStats.home_absentees,
                                away: apiSportsPlayerStats.away_absentees
                            };
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
        console.log(`Sikeres adat-egyesítés (v62.1), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v62.1) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         throw new Error(`Adatgyűjtési hiba (v62.1): ${e.message} \nStack: ${e.stack}`);
    }
}


// === ÚJ (6 FŐS BIZOTTSÁG): P1 KERET-LEKÉRŐ FÜGGVÉNY ===
/**
 * Könnyített függvény, amelyet az '/getRosters' végpont hív.
 * Csak a provider 'fetchMatchData' funkcióját hívja meg (ami cache-elt),
 * és csak a keretadatokat ('availableRosters') adja vissza.
 */
export async function getRostersForMatch(options: {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } | null> {
    
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
    try {
        const sportProvider = getProvider(options.sport);
        
        // Dekódolás, ahogy a getRichContextualData-ban
        const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName));
        const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName));
        const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName));
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));

        const providerOptions = {
            sport: options.sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff
            // Figyelem: A 'forceNew: true' szándékosan hiányzik,
            // hogy a provider-szintű cache-t (pl. apiSportsLineupCache) használhassa, ha elérhető.
        };

        // Meghívjuk a sport-specifikus adatlekérőt
        // Ez a hívás (pl. apiSportsProvider.fetchMatchData) már tartalmazza
        // az 'availableRosters'-t a válaszában.
        const baseResult = await sportProvider.fetchMatchData(providerOptions);
        
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


// --- KÖZÖS FÜGGVÉNYEK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
