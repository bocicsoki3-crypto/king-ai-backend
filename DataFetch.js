// DataFetch.js (Refaktorált v48 - Helyes Provider Routing JAVÍTVA)
// Ez a modul most már "Factory"-ként működik.
// Felelőssége:
// 1. A fő 'rich_context' cache kezelése.
// 2. A 'sport' paraméter alapján a megfelelő provider kiválasztása.
// 3. A feladat delegálása a provider-nek.
// 4. Általános (nem provider-specifikus) funkciók exportálása (pl. _getFixturesFromEspn).

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';

// --- JAVÍTÁS (v48): Visszaállítás a dedikált providerekre ---
// Az 'apiSportsProvider' csak a fociért felel.
// A 'hockeyProvider' (newHockeyProvider) felel a jégkorongért (az ice-hockey-data API-val).
// A 'basketballProvider' (newBasketballProvider) felel a kosárlabdáért.
import * as apiSportsProvider from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';
// --- JAVÍTÁS VÉGE ---

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
* VERZIÓ: v48 (2025-11-01) - Provider Mismatch Javítása
**************************************************************/

/**
 * A "Factory" (gyár) funkció, ami kiválasztja a megfelelő
 * adatlekérő "stratégiát" (provider) a sportág alapján.
 * (JAVÍTVA v48)
 */
function getProvider(sport) {
  switch (sport.toLowerCase()) {
    // --- JAVÍTÁS (v48): Minden sport a SAJÁT, dedikált providerét használja ---
    case 'soccer':
      return apiSportsProvider; // apiSportsProvider kezeli a focit
    case 'hockey':
      return hockeyProvider; // newHockeyProvider kezeli a jégkorongot (ice-hockey-data)
    case 'basketball':
      return basketballProvider; // newBasketballProvider kezeli a kosárlabdát
    // --- JAVÍTÁS VÉGE ---
    default:
      // Robusztus hibakezelés: ha olyan sport jön, amit nem ismerünk,
      // azonnal dobjunk egyértelmű hibát.
      throw new Error(`Nem támogatott sportág: '${sport}'. Nincs implementált provider.`);
  }
}

/**
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v46 - Factory)
 * Ez a függvény kezeli a fő gyorsítótárat és delegálja a
 * feladatot a megfelelő sport-providernek.
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    // A cache kulcs verzióját v46-ra emeljük, hogy a refaktorálás után friss adatokat kapjunk
    const ck = `rich_context_v46_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        // 1. Válaszd ki a megfelelő stratégiát (provider-t)
        const provider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${provider.providerName || sport}): ${homeTeamName} vs ${awayTeamName}...`);

        // 2. Hívd meg a provider specifikus adatlekérőjét
        // Átadjuk az összes opciót egy objektumban
        const options = {
            sport,
            homeTeamName,
            awayTeamName,
            leagueName,
            utcKickoff
        };
        const result = await provider.fetchMatchData(options);
        
        // 3. Mentsd az egységesített eredményt a fő cache-be
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v48), cache mentve (${ck}).`);
        
        return { ...result, fromCache: false };
    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v48 - Factory) során (${homeTeamName} vs ${awayTeam}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v48): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
// Ezeket exportáljuk, hogy más modulok (pl. index.js) is elérhessék.
// Az ESPN lekérdező most már a 'utils.js'-ből jön
export const _getFixturesFromEspn = commonGetFixtures;
// A Gemini hívó most már a 'utils.js'-ből jön
export const _callGemini = commonCallGemini;