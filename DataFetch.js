// DataFetch.js (Refaktorált v46 - Provider/Factory Pattern)
// Ez a modul most már "Factory"-ként működik.
// Felelőssége:
// 1. A fő 'rich_context' cache kezelése.
// 2. A 'sport' paraméter alapján a megfelelő provider kiválasztása.
// 3. A feladat delegálása a provider-nek.
// 4. Általános (nem provider-specifikus) funkciók exportálása (pl. _getFixturesFromEspn).

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
// (Minden más cache a provider-specifikus fájlokba került)
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v46 (2025-10-31) - Provider/Factory Pattern
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
        // Odds-frissítési logika (opcionális, de hasznos)
        // Mivel az 'getApiSportsOdds' az 'apiSportsProvider'-be került,
        // ezt a logikát egyszerűsíthetjük, vagy a providerre bízhatjuk.
        // Egyelőre a teljes cache-t adjuk vissza.
        // TODO: Odds-frissítés implementálása, ha szükséges.
        
        // const fixtureId = cached.rawData.apiFootballData.fixtureId;
        // const oddsResult = await getApiSportsOdds(fixtureId, sport); // EZT MÁR NEM ÉRJÜK EL INNEN
        
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
        console.log(`Sikeres adatgyűjtés (v46), cache mentve (${ck}).`);
        
        return { ...result, fromCache: false };
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
