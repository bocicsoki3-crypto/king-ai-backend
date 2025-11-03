// DataFetch.ts (v54.2 - Azonnali Dekódolás Javítás)
// MÓDOSÍTÁS: A 'leagueName' dekódolása a 'getRichContextualData'
// elejére került, hogy a 'countryContext' keresés sikeres legyen.

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

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v54.2 (Azonnali Dekódolás Fix)
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
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v54.2 - Azonnali Dekódolás Javítás)
 */
export async function getRichContextualData(
    sport: string, 
    homeTeamName: string, // Ez URL-kódoltan érkezik
    awayTeamName: string, // Ez URL-kódoltan érkezik
    leagueName: string, // Ez URL-kódoltan érkezik (pl. "Serie%20B%20%28Brazil%29")
    utcKickoff: string
): Promise<ICanonicalRichContext> {
    
    // === JAVÍTÁS KEZDETE: Azonnali dekódolás ===
    // Dekódoljuk a bejövő paramétereket a függvény legelején.
    const decodedLeagueName = decodeURIComponent(decodeURIComponent(leagueName));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(homeTeamName));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(awayTeamName));
    // === JAVÍTÁS VÉGE ===

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    // A cache kulcs verzióját v54.2-re emeljük
    const ck = `rich_context_v54.2_sofascore_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        
        // 1. Válaszd ki a megfelelő sport providert
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        // === JAVÍTÁS: Ország kontextus kinyerése (a dekódolt névvel) ===
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName]; // A dekódolt nevet használjuk
        const countryContext = leagueData?.country || null; // Pl. "USA" vagy "Brazil"
        if (!countryContext) {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        // === JAVÍTÁS VÉGE ===

        const providerOptions = {
            sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName, // A dekódolt nevet adjuk tovább
            utcKickoff
        };

        // === MÓDOSÍTÁS: PÁRHUZAMOS HÍVÁS (Kontextussal és dekódolt nevekkel) ===
        const [
            baseResult, 
            sofascoreData 
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), // Ez már a dekódolt neveket kapja
            sport === 'soccer' 
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);

        // === EGYESÍTÉS (MERGE) ===
        const finalResult: ICanonicalRichContext = baseResult;

        // ... (xG és PlayerStats egyesítés változatlan) ...
        if (sofascoreData && sofascoreData.advancedData?.xg_home != null && sofascoreData.advancedData?.xG_away != null) {
            console.log(`[DataFetch] Felülírás: API-Football xG felülírva a Sofascore xG-vel.`);
            finalResult.advancedData.home['xg'] = sofascoreData.advancedData.xg_home;
            finalResult.advancedData.away['xg'] = sofascoreData.advancedData.xG_away; 
        } else {
            console.warn(`[DataFetch] Sofascore xG adat nem elérhető. Az 'apiSportsProvider' becslése (vagy hibája) marad érvényben.`);
        }

        // 3. Sofascore Játékos Adat felülírása (Ha létezik)
        // (Figyelem: A v54.2-es sofascoreProvider már helyesen 0 hiányzót ad vissza)
        if (sofascoreData && sofascoreData.playerStats) {
             // Akkor is felülírjuk, ha üres, hogy a fallback (szimulált) adatokat töröljük
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
        console.log(`Sikeres adat-egyesítés (v54.2), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v54.2 - Factory) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v54.2): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
