// DataFetch.ts (Refaktorált v52.3 - TS2307 Path Fix)
// Ez a modul most már "Factory"-ként működik TypeScript alatt.
// Felelőssége:
// 1. A fő 'rich_context' cache kezelése.
// 2. A 'sport' paraméter alapján a megfelelő provider kiválasztása.
// 3. A feladat delegálása a provider-nek.
// 4. Annak kényszerítése, hogy minden provider ICanonicalRichContext-et adjon vissza.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';

// Kanonikus típusok importálása
// === JAVÍTÁS (TS2307) ===
// A hibás './types/canonical.d.ts' útvonal javítva a helyes './src/types/canonical.d.ts'-re,
// a 'tsconfig.json' "include" beállításával összhangban.
import type { ICanonicalRichContext } from './src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

// Providerek importálása (már .ts fájlokként, de az import .js-t használ a NodeNext modul feloldás miatt)
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

// Típusdefiníció a providerek számára
// Minden providernek implementálnia kell ezt a szerződést
interface IDataProvider {
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v52.3 (TypeScript Path Fix)
* - A 'getRichContextualData' most már Promise<ICanonicalRichContext> típust ad vissza.
* - A 'getProvider' egy IDataProvider interfészt ad vissza.
* - Javítva a TS2307 hiba (import útvonal).
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
      // Megjegyzés: A hockeyProvider-t és basketballProvider-t is át kell
      // alakítani, hogy ICanonicalRichContext-et adjanak vissza.
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v52 - TS Factory)
 * Ez a függvény kezeli a fő gyorsítótárat és delegálja a
 * feladatot a megfelelő sport-providernek.
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
    // A cache kulcs verzióját v52-re emeljük a TS migráció miatt
    const ck = `rich_context_v52_ts_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
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
        
        // A TypeScript itt kényszeríti, hogy a 'result' ICanonicalRichContext típusú legyen
        const result: ICanonicalRichContext = await provider.fetchMatchData(options);
        
        // 3. Mentsd az egységesített eredményt a fő cache-be
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v52), cache mentve (${ck}).`);
        
        return { ...result, fromCache: false };

    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v52 - Factory) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v52): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
// Ezeket exportáljuk, hogy más modulok (pl. index.ts) is elérhessék.
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;