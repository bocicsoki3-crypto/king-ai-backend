// DataFetch.js (Refaktorált v46.1 - Helyes Return Fix)
// Ez a modul most már "Factory"-ként működik.
// v46.1 JAVÍTÁS: A getRichContextualData return ága most már
// helyesen építi fel a richData objektumot, hozzáadva
// a hiányzó top-level kulcsokat (home, away, stb.),
// amiket az AnalysisFlow.js elvár.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';

// Importáljuk az új, specifikus providereket
import * as apiSportsProvider from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures
} from './providers/common/utils.js';

// --- FŐ CACHE INICIALIZÁLÁS ---
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v46.1 (2025-11-01) - Helyes Return Fix
**************************************************************/

/**
 * A "Factory" (gyár) funkció, ami kiválasztja a megfelelő
 * adatlekérő "stratégiát" (provider) a sportág alapján.
 */
function getProvider(sport) {
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v46.1 - Helyes Return Fix)
 * Ez a függvény kezeli a fő gyorsítótárat és delegálja a
 * feladatot a megfelelő sport-providernek.
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff, openingOdds, forceReAnalysis) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v46_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    
    // === JAVÍTÁS: A 'forceReAnalysis' paraméter használata a cache ellenőrzésnél ===
    if (!forceReAnalysis) {
        const cached = scriptCache.get(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            return { ...cached, fromCache: true };
        }
    }
    // === JAVÍTÁS VÉGE ===
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    
    try {
        // 1. Válaszd ki a megfelelő stratégiát (provider-t)
        const provider = getProvider(sport);
        
        console.log(`Adatgyűjtés indul (Provider: ${provider.providerName || sport}): ${homeTeamName} vs ${awayTeamName}...`);

        // 2. Hívd meg a provider specifikus adatlekérőjét
        const options = {
            sport,
            homeTeamName,
            awayTeamName,
            leagueName,
            utcKickoff,
            openingOdds // Átadjuk az openingOdds-ot is
        };
        
        // A 'result' tartalmazza a provider által gyűjtött összes adatot
        // (pl. apiFootballData, stats, odds, h2h_summary, stb.)
        const result = await provider.fetchMatchData(options);
        
        // === JAVÍTÁS KEZDETE: Helyes 'richData' objektum felépítése ===
        // A 'result' önmagában nem tartalmazza a 'home', 'away' kulcsokat.
        // Ezeket nekünk kell hozzáadni, hogy az AnalysisFlow.js megkapja.
        const finalRichData = {
            ...result, // Beletesszük az összes adatot, amit a provider adott
            
            // Hozzáadjuk a hiányzó top-level kulcsokat, amiket az AnalysisFlow vár
            home: result.home || homeTeamName, // Használja a provider által visszaadott nevet, vagy a normalizált nevet
            away: result.away || awayTeamName,
            leagueName: result.leagueName || leagueName,
            utcKickoff: result.utcKickoff || utcKickoff,
            sport: sport,
            version: 'v46' // Verziószám hozzáadása, amit a log is vár
        };
        // === JAVÍTÁS VÉGE ===

        // 3. Mentsd az egységesített eredményt (a finalRichData-t) a fő cache-be
        scriptCache.set(ck, finalRichData);
        console.log(`Sikeres adatgyűjtés (v46), cache mentve (${ck}).`);
        
        // A TELJES objektumot adjuk vissza
        return { ...finalRichData, fromCache: false };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v46 - Factory) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v46): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
// Ezeket exportáljuk, hogy más modulok (pl. index.js) is elérhessék.

// Az ESPN lekérdező most már a 'utils.js'-ből jön
export const _getFixturesFromEspn = commonGetFixtures;

// A Gemini hívó most már a 'utils.js'-ből jön
export const _callGemini = commonCallGemini;
