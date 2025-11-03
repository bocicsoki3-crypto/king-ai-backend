// FÁJL: DataFetch.ts
// VERZIÓ: v54.16 (IDataFetchResponse exportálása)
// MÓDOSÍTÁS:
// 1. Az 'IDataFetchResponse' interfész most már 'export'-álva van,
//    hogy az AnalysisFlow.ts importálhassa (ez javítja a TS2339 hibát).
// 2. Az xG prioritási lánc (v54.15) és a cache 'forceNew' (v54.15)
//    logikája változatlan.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext } from './src/types/canonical.d.ts';

// Providerek importálása
import * as apiSportsProvider from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';
import { fetchSofascoreData } from './providers/sofascoreProvider.js';
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

// Interfész a kiterjesztett funkció opciókhoz
export interface IDataFetchOptions {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;   
    utcKickoff: string;   
    forceNew: boolean; // (v54.15)
    // P1 (Direkt)
    manual_xg_home?: number | null; 
    manual_xg_away?: number | null; 
    // P1 (Komponens)
    manual_H_xG?: number | null;
    manual_H_xGA?: number | null;
    manual_A_xG?: number | null;
    manual_A_xGA?: number | null;
}

// === JAVÍTÁS (v54.16): Interfész exportálása ===
// A 'getRichContextualData' most már az 'xgSource'-t is visszaadja.
export interface IDataFetchResponse extends ICanonicalRichContext {
    xgSource: 'Manual (Direct)' | 'Manual (Components)' | 'API (Real)' | 'Calculated (Fallback)';
}
// === JAVÍTÁS VÉGE ===


/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v54.16 (Teljes xG Lánc és forceNew Fix)
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v54.16)
 */
export async function getRichContextualData(
    options: IDataFetchOptions 
): Promise<IDataFetchResponse> { // Módosított visszatérési típus
    
    // === Dekódolás ===
    const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    // A cache kulcs verzióját v54.16-ra emeljük
    const ck = `rich_context_v54.16_sofascore_${options.sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    
    // === JAVÍTÁS (v54.15): Cache ellenőrzés a 'forceNew' figyelembevételével ===
    if (!options.forceNew) {
        const cached = scriptCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            return { ...cached, fromCache: true };
        }
    }
    // === JAVÍTÁS VÉGE ===
    
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

        // Párhuzamos hívás
        const [
            baseResult, 
            sofascoreData 
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            options.sport === 'soccer' 
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);

        // === EGYESÍTÉS (v54.16 JAVÍTÁS - TELJES xG LÁNC) ===
        const finalResult: ICanonicalRichContext = baseResult;

        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: IDataFetchResponse['xgSource']; // A szigorúbb típus

        // 1. PRIORITÁS (A): Manuális Direkt xG
        if (options.manual_xg_home != null && options.manual_xg_away != null) {
            finalHomeXg = options.manual_xg_home;
            finalAwayXg = options.manual_xg_away;
            xgSource = "Manual (Direct)";
        }
        // 1. PRIORITÁS (B): Manuális Komponens xG
        else if (options.manual_H_xG != null && options.manual_H_xGA != null &&
                 options.manual_A_xG != null && options.manual_A_xGA != null)
        {
            finalHomeXg = (options.manual_H_xG + options.manual_A_xGA) / 2;
            finalAwayXg = (options.manual_A_xG + options.manual_H_xGA) / 2;
            xgSource = "Manual (Components)";
        }
        // 2. PRIORITÁS: Sofascore valós xG (v54.12 javítás - 'xG_away')
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away; // (nagy G)
            xgSource = "API (Real)";
        }
        // 3. PRIORITÁS: API-Sports valós xG
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = "API (Real)";
        }
        // 4. PRIORITÁS: Visszaesés (Becslés)
        else {
            finalHomeXg = null; // A Model.ts fogja becsülni
            finalAwayXg = null; // A Model.ts fogja becsülni
            xgSource = "Calculated (Fallback)";
        }
        
        // Végleges xG beállítása (kis 'xg'-vel a kanonikus modellnek megfelelően)
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);
        
        // 3. Sofascore Játékos Adat felülírása
        if (sofascoreData && sofascoreData.playerStats) {
            
            // v54.14 javítás: 'home_absentees' (kis 's')
            console.log(`[DataFetch] Felülírás: Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absentees.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);

            finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
            finalResult.rawData.absentees = {
                home: sofascoreData.playerStats.home_absentees,
                away: sofascoreData.playerStats.away_absentees
            };
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Cache mentése
        const response: IDataFetchResponse = {
            ...finalResult,
            xgSource: xgSource // Hozzáadjuk a forrást a cache-elt objektumhoz
        };

        scriptCache.set(ck, response);
        console.log(`Sikeres adat-egyesítés (v54.16), cache mentve (${ck}).`);
        
        return { ...response, fromCache: false };

    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v54.16 - Factory) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v54.16): ${e.message} \nStack: ${e.stack}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
