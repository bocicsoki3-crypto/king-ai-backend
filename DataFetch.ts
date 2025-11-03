// FÁJL: DataFetch.ts
// VERZIÓ: v54.10 (Kritikus xG Prioritási Lánc Javítás)
// MÓDOSÍTÁS:
// 1. A 'getRichContextualData' most már egy 'options' objektumot fogad,
//    amely tartalmazza az opcionális 'manual_xg_home'/'manual_xg_away' mezőket.
// 2. Az "EGYESÍTÉS" szekció teljesen újraírva, hogy betartsa a
//    P1 (Manuális) > P2 (Sofascore) > P3 (API-Sports) > P4 (Becsült)
//    xG prioritási sorrendet.

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

// === JAVÍTÁS (v54.10) ===
// Új interfész a kiterjesztett funkció opciókhoz
export interface IDataFetchOptions {
    sport: string;
    homeTeamName: string; // URL-kódoltan érkezik
    awayTeamName: string; // URL-kódoltan érkezik
    leagueName: string;   // URL-kódoltan érkezik
    utcKickoff: string;   // URL-kódoltan érkezik
    manual_xg_home?: number | null; // A P1 prioritású adat
    manual_xg_away?: number | null; // A P1 prioritású adat
}
// === JAVÍTÁS VÉGE ===

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v54.10 (xG Prioritási Lánc Fix)
**************************************************************/

/**
 * A "Factory" (gyár) funkció, ami kiválasztja a megfelelő
 * adatlekérő "stratégiát" (provider) a sportág alapján.
 */
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v54.10 - xG Prioritási Lánc Javítás)
 */
export async function getRichContextualData(
    // === JAVÍTÁS (v54.10): A funkció most már az új interfészt használja ===
    options: IDataFetchOptions 
): Promise<ICanonicalRichContext> {
    
    // === JAVÍTÁS KEZDETE: Teljes dekódolás ===
    // Itt dekódolunk mindent, amit a kliens kódolva küldhet.
    const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff));
    // A manuális xG adatokat (options.manual_xg_home) nem kell dekódolni
    // === JAVÍTÁS VÉGE ===

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    // A cache kulcs verzióját v54.10-re emeljük
    const ck = `rich_context_v54.10_sofascore_${options.sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        
        // 1. Válaszd ki a megfelelő sport providert
        const sportProvider = getProvider(options.sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || options.sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        // Ország kontextus kinyerése (a dekódolt névvel)
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
            utcKickoff: decodedUtcKickoff // JAVÍTVA: A dekódolt időpontot adjuk tovább
            // A manuális xG-t NEM adjuk tovább a providereknek,
            // az az itteni egyesítési logikához kell.
        };

        // Párhuzamos hívás (Kontextussal és dekódolt nevekkel)
        const [
            baseResult, 
            sofascoreData 
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            options.sport === 'soccer' 
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);

        // === EGYESÍTÉS (v54.10 JAVÍTÁS - xG PRIORITÁSI LÁNC) ===
        const finalResult: ICanonicalRichContext = baseResult;

        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: string = "N/A";

        // 1. PRIORITÁS: Manuális (User-Provided) xG
        if (options.manual_xg_home != null && options.manual_xg_away != null) {
            finalHomeXg = options.manual_xg_home;
            finalAwayXg = options.manual_xg_away;
            xgSource = "P1: Manual (User-Provided)";
        }
        // 2. PRIORITÁS: Sofascore valós xG
        // (Javítva a 'xG_away' elírás 'xg_away'-re)
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xg_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xg_away;
            xgSource = "P2: Sofascore (Real)";
        }
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
        
        // Végleges xG beállítása a 'finalResult' objektumon
        // A 'Model.ts' majd ez alapján dönt, hogy kell-e becsülnie vagy sem.
        finalResult.advancedData = {
            home: { ...finalResult.advancedData.home, xg: finalHomeXg },
            away: { ...finalResult.advancedData.away, xg: finalAwayXg }
        };
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);
        
        // 3. Sofascore Játékos Adat felülírása (Ez a logika helyes volt)
        if (sofascoreData && sofascoreData.playerStats) {
            console.log(`[DataFetch] Felülírás: Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absentees.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);
            finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
            finalResult.rawData.absentees = {
                home: sofascoreData.playerStats.home_absentees,
                away: sofascoreData.playerStats.away_absentees
            };
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Mentsd az egyesített eredményt a fő cache-be
        scriptCache.set(ck, finalResult);
        console.log(`Sikeres adat-egyesítés (v54.10), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v54.10 - Factory) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
        // A stack trace-t is továbbadjuk a pontosabb hibakereséshez
        throw new Error(`Adatgyűjtési hiba (v54.10): ${e.message} \nStack: ${e.stack}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
