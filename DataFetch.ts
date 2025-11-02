// DataFetch.ts (v52.7 - Sofascore Integráció)
// Ez a modul most már "Factory"-ként működik TypeScript alatt.
// MÓDOSÍTÁS: A 'getRichContextualData' most már meghívja az alap providert (pl. apiSports)
// ÉS a sofascoreProvider-t is, majd egyesíti az eredményeket.

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

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v52.7 (Sofascore Integráció)
* - A 'getRichContextualData' most már párhuzamosan hívja meg a sport-specifikus
* providert (oddsokért) és a Sofascore providert (xG/játékos adatokért).
* - Az eredményeket egyesíti, priorizálva a Sofascore adatait.
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v52.7 - Sofascore Egyesítéssel)
 * Garantálja, hogy a visszatérési érték ICanonicalRichContext.
 */
export async function getRichContextualData(
    sport: string, 
    homeTeamName: string, 
    awayTeamName: string, 
    leagueName: string, 
    utcKickoff: string
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
            utcKickoff
        };
        
        // === MÓDOSÍTÁS: PÁRHUZAMOS HÍVÁS ===
        // A 'sportProvider' (pl. apiSports) és a 'sofascoreProvider' párhuzamosan fut.
        
        const [
            // Az 'apiSportsProvider' adja az Odds-okat, H2H-t, és a fallback statisztikákat
            baseResult, 
            // A 'sofascoreProvider' adja a megbízható xG-t és (később) a játékos-értékeléseket
            sofascoreData 
        ] = await Promise.all([
            sportProvider.fetchMatchData(providerOptions),
            fetchSofascoreData(homeTeamName, awayTeamName) // Csak 'soccer' esetén kellene hívni, de a sofascoreProvider kezeli
        ]);
        
        // === EGYESÍTÉS (MERGE) ===
        // Az 'baseResult' (apiSportsProvider) az alap.
        const finalResult: ICanonicalRichContext = baseResult;

        // 2. Sofascore xG Adat felülírása (Ha létezik)
        // Ez javítja a 'log napló.txt' hibát (becsült xG használata).
        if (sofascoreData.advancedData?.xg_home != null && sofascoreData.advancedData?.xg_away != null) {
            console.log(`[DataFetch] Felülírás: API-Football xG felülírva a Sofascore xG-vel.`);
            finalResult.advancedData.home['xg'] = sofascoreData.advancedData.xg_home;
            finalResult.advancedData.away['xg'] = sofascoreData.advancedData.xg_away;
        } else {
            console.warn(`[DataFetch] Sofascore xG adat nem elérhető. Az 'apiSportsProvider' becslése (vagy hibája) marad érvényben.`);
        }

        // 3. Sofascore Játékos Adat felülírása (Ha létezik)
        // Ez javítja a szimulált 'getDetailedPlayerStats' problémát.
        if (sofascoreData.playerStats && sofascoreData.playerStats.home_absentees.length > 0) {
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
        console.log(`Sikeres adat-egyesítés (v52.7), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };

    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v52.7 - Factory) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v52.7): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;