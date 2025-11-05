// FÁJL: providers/newBasketballProvider.ts
// VERZIÓ: v62.1 (P1 Manuális Roster Választó - 4. Lépés)
// MÓDOSÍTÁS:
// 1. Az 'ICanonicalRichContext' és 'ICanonicalRawData'
//    interfészeknek való megfelelés érdekében
//    az 'availableRosters: { home: [], away: [] }' mező
//    hozzáadva a 'finalData' és 'result' objektumokhoz.
// 2. Ez a javítás MEGOLDJA a 'TS2741: Property 'availableRosters' is missing...' [image: 438084.png]
//    build hibát ebben a fájlban.
// 3. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

import axios from 'axios';
import { makeRequest } from './common/utils.js';

// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    IStructuredWeather,
    IPlayerStub // v62.1
} from '../src/types/canonical.d.ts';
import {
    BASKETBALL_API_KEY,
    BASKETBALL_API_HOST
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData // v55.9 valós implementáció
} from './common/utils.js';

/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 * FIGYELEM: Ez a provider jelenleg egy "stub" (csonk).
 * Most már a v62.1-es ICanonicalRichContext szerződést teljesíti.
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
  if (!BASKETBALL_API_KEY || !BASKETBALL_API_HOST) {
    throw new Error('[Basketball API] Kritikus konfigurációs hiba: Hiányzó BASKETBALL_API_KEY vagy BASKETBALL_API_HOST a config.js-ben.');
  }
  
  console.log(`[Basketball Provider]: Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);
  console.log(`[Basketball Provider]: FIGYELEM: Ez a provider jelenleg egy "stub" (csonk), és placeholder adatokat ad vissza.`);
  // 1. API HÍVÁSOK (STUB)
  // ...
  
  // 2. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL)
  const unifiedHomeStats: ICanonicalStats = {
      gp: 1, // Kötelező > 0
      gf: 110, // Placeholder
      ga: 110, // Placeholder
      form: null
  };
  const unifiedAwayStats: ICanonicalStats = {
      gp: 1, // Kötelező > 0
      gf: 110, // Placeholder
      ga: 110, // Placeholder
      form: null
  };

  // 3. GEMINI HÍVÁS (opcionális, a placeholder adatokkal)
  const geminiJsonString = await _callGemini(PROMPT_V43(
       sport, homeTeamName, awayTeamName,
       unifiedHomeStats,
       unifiedAwayStats,
       null, null
  ));
  let geminiData: any = {};
  try { 
      geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};
  } catch (e: any) { 
      console.error(`[Basketball API] Gemini JSON parse hiba: ${e.message}`);
  }

  // --- 4. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v62.1) ---
  
  // v55.8-as Időjárás placeholder (már helyes)
  const defaultStructuredWeather: IStructuredWeather = {
      description: "N/A (Beltéri)",
      temperature_celsius: null,
      wind_speed_kmh: null,
      precipitation_mm: null,
      source: 'N/A'
  };

  // Hozzuk létre az alap ICanonicalRawData struktúrát
  const finalData: ICanonicalRawData = {
      stats: {
          home: { ...unifiedHomeStats, ...(geminiData.stats?.home || {}) },
          away: { ...unifiedAwayStats, ...(geminiData.stats?.away || {}) }
      },
      form: {
          home_overall: unifiedHomeStats.form,
          away_overall: unifiedAwayStats.form,
          ...geminiData.form
      },
      detailedPlayerStats: { 
          home_absentees: [], 
          away_absentees: [], 
          key_players_ratings: { home: {}, away: {} } 
      },
      absentees: { home: [], away: [] },
      h2h_structured: geminiData.h2h_structured || null,
      referee: {
        name: null,
        style: null
      },
      contextual_factors: {
        stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
        pitch_condition: "N/A (Parketta)",
        weather: "N/A (Beltéri)",
        match_tension_index: geminiData?.contextual_factors?.match_tension_index || null,
        structured_weather: defaultStructuredWeather,
        coach: { // v58.3
            home_name: null,
            away_name: null
        }
      },
      
      // === JAVÍTÁS (v62.1): Hiányzó 'availableRosters' mező hozzáadva ===
      availableRosters: {
        home: [], // A kosár provider nem ad vissza keretet
        away: []
      },
      // === JAVÍTÁS VÉGE ===

      ...geminiData
  };
  finalData.stats.home.gp = unifiedHomeStats.gp;
  finalData.stats.away.gp = unifiedAwayStats.gp;

  console.log(`[Basketball API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
  
  const location = finalData.contextual_factors.stadium_location;
  let structuredWeather: IStructuredWeather = defaultStructuredWeather;
  if (location && location !== "N/A (Beltéri)" && location !== "N/A") {
      // Ez a hívás a v55.9-es valós implementációt hívja
      structuredWeather = await getStructuredWeatherData(location, utcKickoff);
  }

  // Közvetlenül frissítjük a finalData objektumot
  finalData.contextual_factors.structured_weather = structuredWeather;
  finalData.contextual_factors.weather = structuredWeather.description || "N/A (Beltéri)";

  const richContext = [
       geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
       geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
       geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
       finalData.contextual_factors.weather !== "N/A (Beltéri)" && `- Időjárás: ${finalData.contextual_factors.weather}`
  ].filter(Boolean).join('\n') || "N/A";


  // A végső ICanonicalRichContext objektum összeállítása
  const result: ICanonicalRichContext = {
       rawStats: finalData.stats,
       leagueAverages: geminiData.league_averages || {},
       richContext,
       advancedData: { 
           home: geminiData.advancedData?.home || {}, 
           away: geminiData.advancedData?.away || {}
       },
       form: finalData.form,
       rawData: finalData,
       oddsData: null,
       fromCache: false,
       
       // === JAVÍTÁS (v62.1): Hiányzó 'availableRosters' mező hozzáadva ===
       availableRosters: {
          home: [],
          away: []
       }
       // === JAVÍTÁS VÉGE ===
  };
  
  if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
     console.warn("[Basketball API] Figyelmeztetés: A Gemini nem adott meg GP-t, 1-re állítva.");
     result.rawStats.home.gp = 1;
     result.rawStats.away.gp = 1;
  }

  return result;
}

export const providerName = 'new-basketball-api-stub';
