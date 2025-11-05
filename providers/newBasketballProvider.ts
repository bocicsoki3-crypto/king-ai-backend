// FÁJL: providers/newBasketballProvider.ts
// VERZIÓ: v55.7 (Szintaktikai Végleges Javítás)
// MÓDOSÍTÁS:
// 1. A 'defaultStructuredWeather' kiegészítve a hiányzó,
//    de a v55.4-es 'ICanonicalWeather' interfész  által megkövetelt
//    'wind_speed_kmh: null' és 'precipitation_mm: null' mezőkkel. 
// 2. JAVÍTVA: Az összes kódtörzsön belüli, szintaktikai hibát
//    okozó '' hivatkozás eltávolítva.

import axios from 'axios';
import { makeRequest } from './common/utils.js';

// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    IStructuredWeather // Szükséges a helyi inicializáláshoz
} from '../src/types/canonical.d.ts';
import {
    BASKETBALL_API_KEY,
    BASKETBALL_API_HOST
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData // Ez a placeholder, amit később cserélünk
} from './common/utils.js';

/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 * FIGYELEM: Ez a provider jelenleg egy "stub" (csonk).
 * A valós API hívásokat (pl. makeBasketballRequest) implementálni kell.
 * Most már az ICanonicalRichContext szerződést teljesíti.
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

  // --- 4. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v55.7) ---
  
  // === JAVÍTÁS (v55.5): A v55.4-es interfésznek megfelelő placeholder ===
  const defaultStructuredWeather: IStructuredWeather = {
      description: "N/A (Beltéri)",
      temperature_celsius: null,
      wind_speed_kmh: null,     // KÖTELEZŐ MEZŐ HOZZÁADVA
      precipitation_mm: null, // KÖTELEZŐ MEZŐ HOZZÁADVA
      source: 'N/A'
  };
  // === JAVÍTÁS VÉGE ===

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

      // v54.9-nek megfelelő alapértelmezett adatok
      referee: {
        name: null,
        style: null
      },
      contextual_factors: {
        stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
        pitch_condition: "N/A (Parketta)",
        weather: "N/A (Beltéri)", // Alapértelmezett
        match_tension_index: geminiData?.contextual_factors?.match_tension_index || null,
        structured_weather: defaultStructuredWeather // Alapértelmezett (Javított v55.7)
      },
      ...geminiData
  };
  finalData.stats.home.gp = unifiedHomeStats.gp;
  finalData.stats.away.gp = unifiedAwayStats.gp;

  console.log(`[Basketball API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
  
  // A 'getStructuredWeatherData' hívás (ami a 'utils.ts'-re támaszkodik)
  const location = finalData.contextual_factors.stadium_location;
  let structuredWeather: IStructuredWeather = defaultStructuredWeather;
  if (location && location !== "N/A (Beltéri)" && location !== "N/A") {
      // Ez a hívás még mindig a 'utils.ts' placeholderét hívja,
      // ami a következő lépésben lesz javítva.
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
       advancedData: geminiData.advancedData || { home: {}, away: {} },
       form: finalData.form,
       rawData: finalData,
       oddsData: null,
       fromCache: false
  };
  if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
     console.warn("[Basketball API] Figyelmeztetés: A Gemini nem adott meg GP-t, 1-re állítva.");
     result.rawStats.home.gp = 1;
     result.rawStats.away.gp = 1;
  }

  return result;
}

export const providerName = 'new-basketball-api-stub';
