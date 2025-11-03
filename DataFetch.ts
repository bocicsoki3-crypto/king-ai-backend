// DataFetch.ts (v54.3 - SSOT Refaktor)
// MÓDOSÍTÁS: Az '_getFixturesFromEspn' export átirányítva
// az 'apiSportsProvider.getFixturesFromApiSports' függvényre.
import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext } from './src/types/canonical.d.ts';

// Providerek importálása
import * as apiSportsProvider from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';
// === ÚJ IMPORT (Sofascore) ===
import { fetchSofascoreData } from './providers/sofascoreProvider.js';
// === VÉGE ===

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini as commonCallGemini
    // === JAVÍTÁS (v54.3) ===
    // Az _getFixturesFromEspn import eltávolítva a common/utils.ts-ből
    // === JAVÍTÁS VÉGE ===
} from './providers/common/utils.js';
// --- FŐ CACHE INICIALIZÁLÁS ---
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
// Típusdefiníció a providerek számára
interface IDataProvider {
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v54.3 (SSOT Refaktor)
* - A 'getRichContextualData' most már párhuzamosan hívja meg a sport-specifikus
* providert (oddsokért) és a Sofascore providert (xG/játékos adatokért).
* - Az _getFixturesFromEspn export átirányítva az apiSportsProvider.getFixturesFromApiSports-ra.
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v52.13 - Sofascore Egyesítéssel)
 * Garantálja, hogy a visszatérési érték ICanonicalRichContext.
 */
export async function getRichContextualData(
    sport: string, 
    homeTeamName: string, 
    awayTeamName: string, 
    leagueName: string, 
    utcKickoff: string,
    // === ÚJ (v54.3) SSOT Paraméterek ===
    // Ezeket az AnalysisFlow.ts továbbítja, hogy elkerüljük a név-egyeztetést
    apiFootballLeagueId?: number,
    apiFootballHomeId?: number,
    apiFootballAwayId?: number,
    apiFootballFixtureId?: number
    // === VÉGE ===
): Promise<ICanonicalRichContext> {
    
    const teamNames = [homeTeamName, awayTeamName].sort();
    // A cache kulcs verzióját v52.7-re emeljük az új adatforrás miatt
    const ck = `rich_context_v52.7_sofascore_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        
        // 1. Válaszd ki a megfelelő sport providert (Odds, H2H, Alap statok)
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${homeTeamName} vs ${awayTeamName}...`);

        const providerOptions = {
            sport,
            homeTeamName,
            awayTeamName,
            leagueName,
            utcKickoff,
            // === ÚJ (v54.3) SSOT ID-k továbbítása ===
            apiFootballLeagueId,
            apiFootballHomeId,
            apiFootballAwayId,
            apiFootballFixtureId
            // === VÉGE ===
        };
        
        // === MÓDOSÍTÁS: PÁRHUZAMOS HÍVÁS ===
        const [
            // Az 'apiSportsProvider' adja az Odds-okat, H2H-t, és a fallback statisztikákat
            baseResult, 
            // A 'sofascoreProvider' adja a megbízható xG-t és játékos-értékeléseket
            sofascoreData 
        ] = await Promise.all([
       
            sportProvider.fetchMatchData(providerOptions),
            // Csak foci esetén hívjuk a Sofascore-t
            sport === 'soccer' ? fetchSofascoreData(homeTeamName, awayTeamName) : Promise.resolve(null)
        ]);
        // === EGYESÍTÉS (MERGE) ===
        const finalResult: ICanonicalRichContext = baseResult;
        
        // 2. Sofascore xG Adat felülírása (Ha létezik)
        // === JAVÍTÁS (TS2551) ===
        // A 'xg_away' (kis 'g') cserélve 'xG_away'-re (nagy 'G'), hogy megfeleljen a provider típusának.
        if (sofascoreData && sofascoreData.advancedData?.xg_home != null && sofascoreData.advancedData?.xG_away != null) {
            console.log(`[DataFetch] Felülírás: API-Football xG felülírva a Sofascore xG-vel.`);
            finalResult.advancedData.home['xg'] = sofascoreData.advancedData.xg_home;
            finalResult.advancedData.away['xg'] = sofascoreData.advancedData.xG_away; // <-- JAVÍTVA
        } else {
        // === JAVÍTÁS VÉGE ===
            console.warn(`[DataFetch] Sofascore xG adat nem elérhető. Az 'apiSportsProvider' becslése (vagy hibája) marad érvényben.`);
        }

        // 3. Sofascore Játékos Adat felülírása (Ha létezik)
        if (sofascoreData && sofascoreData.playerStats && (sofascoreData.playerStats.home_absentees.length > 0 || sofascoreData.playerStats.away_absentees.length > 0)) {
            console.log(`[DataFetch] Felülírás: Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival.`);
            finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
            finalResult.rawData.absentees = {
                home: sofascoreData.playerStats.home_absentees,
                away: sofascoreData.playerStats.away_absentees
            };
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Mentsd az egyesített eredményt a fő cache-be
        scriptCache.set(ck, finalResult);
        console.log(`Sikeres adat-egyesítés (v52.13), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v52.13 - Factory) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
         throw new Error(`Adatgyűjtési hiba (v52.13): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
// === JAVÍTÁS (v54.3) ===
// Az _getFixturesFromEspn helyett az apiSportsProvider SSOT függvényét exportáljuk
// Az 'index.ts' (Source 699) mostantól automatikusan az API-Football-t hívja.
export const _getFixturesFromEspn = apiSportsProvider.getFixturesFromApiSports;
// === JAVÍTÁS VÉGE ===

export const _callGemini = commonCallGemini;
