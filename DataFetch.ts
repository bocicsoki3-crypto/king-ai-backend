// FÁJL: DataFetch.ts
// VERZIÓ: v54.12 (Sofascore 'xG_away' Típusjavítás)
// MÓDOSÍTÁS:
// 1. A 'getRichContextualData' (v54.10) egy 'options' objektumot fogad.
// 2. Az "EGYESÍTÉS" szekció betartja a P1 > P2 > P3 > P4 láncot.
// 3. (v54.12) A Sofascore P2 prioritás javítva, hogy a 'xG_away' (nagy G)
//    kulcsot használja, ahogy azt a TS2551 hiba jelzi.

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
    homeTeamName: string; // URL-kódoltan érkezik
    awayTeamName: string; // URL-kódoltan érkezik
    leagueName: string;   // URL-kódoltan érkezik
    utcKickoff: string;   // URL-kódoltan érkezik
    manual_xg_home?: number | null; // A P1 prioritású adat (AnalysisFlow kezeli)
    manual_xg_away?: number | null; // A P1 prioritású adat (AnalysisFlow kezeli)
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v54.12 (xG Prioritási Lánc Fix)
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v54.12)
 */
export async function getRichContextualData(
    options: IDataFetchOptions 
): Promise<ICanonicalRichContext> {
    
    // === Dekódolás ===
    const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    // A cache kulcs verzióját v54.12-re emeljük
    const ck = `rich_context_v54.12_sofascore_${options.sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
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

        // === EGYESÍTÉS (v54.12 JAVÍTÁS - xG PRIORITÁSI LÁNC) ===
        const finalResult: ICanonicalRichContext = baseResult;

        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: string = "N/A";

        // 1. PRIORITÁS: Manuális xG
        // (Ezt az 'AnalysisFlow.ts' (v54.12) kezeli, miután ez a függvény visszatér)
        // Mi a P2 > P3 logikát futtatjuk le.

        // === JAVÍTÁS (v54.12): Visszaállítás 'xG_away'-re (nagy G) ===
        // Ez oldja meg a TS2551 hibát.
        // 2. PRIORITÁS: Sofascore valós xG
        if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away; // JAVÍTVA (nagy G)
            xgSource = "P2: Sofascore (Real)";
        }
        // === JAVÍTÁS VÉGE ===

        // 3. PRIORITÁS: API-Sports valós xG
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = "P3: API-Sports (Real)";
        }
        // 4. PRIORITÁS: Visszaesés (Becslés)
        else {
            xgSource = "P4: N/A (Fallback to Model Estimation)";
        }
        
        // Végleges xG beállítása
        finalResult.advancedData = {
            home: { ...finalResult.advancedData.home, xG: finalHomeXg }, // 'xG'-t használunk, de a Model 'xg'-t vár...
            away: { ...finalResult.advancedData.away, xG: finalAwayXg }  // ... javítsuk 'xg'-re (kis g)
        };
        // JAVÍTÁS: A kanonikus modell (ICanonicalRichContext) 'advancedData.home.xg' (kis g)-t vár.
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        
        console.log(`[DataFetch] xG Forrás meghatározva (API szinten): ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);
        
        // 3. Sofascore Játékos Adat felülírása (Logika helyes)
        if (sofascoreData && sofascoreData.playerStats) {
            console.log(`[DataFetch] Felülírás: Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absenteS.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);
            finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
            finalResult.rawData.absentees = {
                home: sofascoreData.playerStats.home_absentees,
                away: sofascoreData.playerStats.away_absentees
            };
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Cache mentése
        scriptCache.set(ck, finalResult);
        console.log(`Sikeres adat-egyesítés (v54.12), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v54.12 - Factory) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v54.12): ${e.message} \nStack: ${e.stack}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
