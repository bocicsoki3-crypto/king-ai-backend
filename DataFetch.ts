// FÁJL: DataFetch.ts
// VERZIÓ: v73.2 (Architekta Javítás - TS2322)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (ts2322): Az 'IDataFetchResponse' interfész 'xgSource' típusa
//    'string'-re módosítva a 67. sorban, hogy a 176. sorban lévő
//    cache-logika (pl. "API (Real) (Cache)") ne okozzon típus-ütközést.
// 2. Az összes többi (v73.1) logika (P2 Aggregátor, P1 Kezelés) változatlan.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData } from './src/types/canonical.d.ts'; // ICanonicalRawData importálva
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

// === ÚJ TÍPUS (JAVÍTÁS TS2322) ===
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
    manual_H_xG?: number | null;  // v61.0
    manual_H_xGA?: number | null; // v61.0
    manual_A_xG?: number | null;  // v61.0
    manual_A_xGA?: number | null;
    manual_absentees?: { home: { name: string, pos: string }[], away: { name: string, pos: string }[] } | null; // Típus frissítve
}

// Az IDataFetchResponse kiterjeszti az ICanonicalRichContext-et
export interface IDataFetchResponse extends ICanonicalRichContext {
    // === JAVÍTÁS (v73.2 - TS2322) ===
    // 'string'-re módosítva, hogy a cache-elt stringek (pl. "API (Real) (Cache)")
    // ne okozzanak típus-ütközést a 176. sorban.
    xgSource: string; 
    // === JAVÍTÁS VÉGE ===
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v73.2 (Architekta Javítás - TS2322)
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
 * Segédfüggvény a pozíció nevének fordításához (a Model.ts által várt formátumra)
 * === JAVÍTÁS (v73.0): Explicit visszatérési típus CanonicalRole-ra ===
 */
function getRoleFromPos(pos: string): CanonicalRole {
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
    if (p === 'D') return 'Védő';
    if (p === 'M') return 'Középpályás';
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}
// === JAVÍTÁS VÉGE ===

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v73.2)
 */
export async function getRichContextualData(
    options: IDataFetchOptions,
    explicitMatchId?: string // Az ingestor vagy az AnalysisFlow adja át
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

    const decodedLeagueName = decodeURIComponent(decodeURIComponent(leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(awayTeamName));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    
    const p1AbsenteesHash = manual_absentees ?
        `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
        '';
        
    // A cache kulcs most már az explicitMatchId-t használja, ha meg van adva
    const ck = explicitMatchId || `rich_context_v62.1_roster_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            
            const finalData = { ...cached };
            let p1Source = " (Cache)";
            let xgSource: IDataFetchResponse['xgSource'] = cached.xgSource || 'Calculated (Fallback)';

            if (manual_H_xG != null && manual_H_xGA != null && manual_A_xG != null && manual_A_xGA != null) {
                finalData.advancedData.manual_H_xG = manual_H_xG;
                finalData.advancedData.manual_H_xGA = manual_H_xGA;
                finalData.advancedData.manual_A_xG = manual_A_xG;
                finalData.advancedData.manual_A_xGA = manual_A_xGA;
                xgSource = "Manual (Components)"; // Felülírjuk az xG forrást
                p1Source = " (Cache + P1 xG)";
            }
            
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
                p1Source = " (Cache + P1 Hiányzók)";
            }

            // === JAVÍTÁS (v73.2 - TS2322) ===
            // Az 'xgSource' mezőt nem módosítjuk a 'p1Source' stringgel,
            // hogy a típusa 'Manual (Components)' maradhasson.
            return { ...finalData, fromCache: true, xgSource: xgSource };
            // === JAVÍTÁS VÉGE ===
        }
    }
    
    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || null; 
        if (sport === 'soccer' && !countryContext) {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        
        const providerOptions = {
            sport: sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff,
            countryContext: countryContext // Átadjuk a P4 providernek is
        };
        
        // Párhuzamos hívás (P4 Alap + P2 Kontextus)
        const skipSofascore = (options.manual_H_xG != null);
        const [
            baseResult, // Ez (v62.1) már tartalmazza az 'availableRosters'-t
            sofascoreData // P2 (Prémium) Kontextus
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions),
            (sport === 'soccer' && !skipSofascore)
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);
        
        // === EGYESÍTÉS (v73.0) ===
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
        
        preFetchAnalysisCache.set(ck, response); // A helyes kulcs használata
        console.log(`Sikeres adat-egyesítés (v73.2), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v73.2) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         throw new Error(`Adatgyűjtési hiba (v73.2): ${e.message} \nStack: ${e.stack}`);
    }
}


// === ÚJ (6 FŐS BIZOTTSÁG): P1 KERET-LEKÉRŐ FÜGGVÉNY ===
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
// ÚJ (v71.0)
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;