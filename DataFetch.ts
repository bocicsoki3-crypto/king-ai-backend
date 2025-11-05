// FÁJL: DataFetch.ts
// VERZIÓ: v62.1 (P1 Manuális Roster Választó - 3. Lépés)
// MÓDOSÍTÁS:
// 1. Nincs logikai változtatás. A v54.44-es  kód
//    architekturálisan helyes, mivel a '...baseResult' 
//    és '...finalResult' [cite: 1687] operátorok automatikusan
//    továbbítják az 'apiSportsProvider.ts' (v62.1) által
//    biztosított új 'availableRosters' mezőt.
// 2. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats } from './src/types/canonical.d.ts';
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
    manual_xg_away?: number | null; // v59.0 (Eltávolítva a v61.0-ben)
    manual_H_xG?: number | null;  // v61.0
    manual_H_xGA?: number | null; // v61.0
    manual_A_xG?: number | null;  // v61.0
    manual_A_xGA?: number | null; // v61.0
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
    const ck = `rich_context_v62.1_roster_${options.sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    
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
        const [
            baseResult, // Ez (v62.1) már tartalmazza az 'availableRosters'-t
            sofascoreData // P2 (Prémium) Kontextus
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions),
            (options.sport === 'soccer' && (!options.manual_H_xG)) // Optimalizálás: Sofascore-t csak akkor hívjuk, ha P1 *nincs* megadva (bár a P2 hiányzók miatt kellhet)
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
            // A Model.ts számolja ki az átlagot [cite: 1565-1566], itt csak továbbítjuk a komponenseket
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
        
        // === Redundáns Hiányzó-adat Fallback (v54.44 - Változatlan) ===
        const hasValidSofascoreData = (data: ISofascoreResponse | null): data is (ISofascoreResponse & { playerStats: ICanonicalPlayerStats }) => {
            return !!data && 
                   !!data.playerStats && 
                   (data.playerStats.home_absentees.length > 0 || 
                    data.playerStats.away_absentees.length > 0 ||
                    Object.keys(data.playerStats.key_players_ratings.home).length > 0);
        };

        if (options.sport === 'soccer') {
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
                const awayTeamId = baseResult.rawData.apiFootballData?.awayTeamId;

                if (fixtureId && homeTeamId && awayTeamId) {
                    try {
                        // Hívjuk az 'apiSportsProvider'-ben (v58.1) [cite: 2700-2704] lévő exportált funkciót
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


// --- KÖZÖS FÜGGVÉNYEK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
