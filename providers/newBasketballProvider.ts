// FÁJL: providers/newBasketballProvider.ts
// VERZIÓ: v70.0 (Architekta Refaktor)
// MÓDOSÍTÁS:
// 1. ELTÁVOLÍTVA: A _callGemini és PROMPT_V43 importok törölve (TS2305 hiba javítása).
// 2. LOGIKA: A 'fetchMatchData' funkció már nem hívja meg a Geminit.
// 3. LOGIKA: A provider egy "stub", amely csak a kanonikus adatstruktúrát
//    biztosítja a "Mély-adat" (v73.0) teszteléséhez.

import axios from 'axios';
// === JAVÍTÁS (v70.0): Importok eltávolítva ===
// import { _callGemini, PROMPT_V43 } from './common/utils.js'; (HIBÁS VOLT)
import { makeRequest, getStructuredWeatherData } from './common/utils.js';
// === JAVÍTÁS VÉGE ===

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

/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 * FIGYELEM: Ez a provider jelenleg egy "stub" (csonk).
 * Most már a v70.0-s architektúrát követi.
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
  if (!BASKETBALL_API_KEY || !BASKETBALL_API_HOST) {
    console.warn('[Basketball API] Figyelmeztetés: Hiányzó BASKETBALL_API_KEY. A "stub" provider futtatása folytatódik placeholder adatokkal.');
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

  // === JAVÍTÁS (v70.0): Gemini hívás eltávolítva ===
  // const geminiJsonString = await _callGemini(PROMPT_V43(...));
  const geminiData: any = {}; // Üres objektum, az AI hívás törölve
  // === JAVÍTÁS VÉGE ===

  // --- 4. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v62.1) ---
  
  const defaultStructuredWeather: IStructuredWeather = {
      description: "N/A (Beltéri)",
      temperature_celsius: null,
      wind_speed_kmh: null,
      precipitation_mm: null,
      source: 'N/A'
  };

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
        coach: {
            home_name: null,
            away_name: null
        }
      },
      availableRosters: {
        home: [],
        away: []
      },
      ...geminiData
  };
  finalData.stats.home.gp = unifiedHomeStats.gp;
  finalData.stats.away.gp = unifiedAwayStats.gp;

  console.log(`[Basketball API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
  
  const location = finalData.contextual_factors.stadium_location;
  let structuredWeather: IStructuredWeather = defaultStructuredWeather;
  if (location && location !== "N/A (Beltéri)" && location !== "N/A") {
      structuredWeather = await getStructuredWeatherData(location, utcKickoff);
  }

  finalData.contextual_factors.structured_weather = structuredWeather;
  finalData.contextual_factors.weather = structuredWeather.description || "N/A (Beltéri)";

  const richContext = [
       geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
       geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
       geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
       finalData.contextual_factors.weather !== "N/A (Beltéri)" && `- Időjárás: ${finalData.contextual_factors.weather}`
  ].filter(Boolean).join('\n') || "N/A";


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
       availableRosters: {
          home: [],
          away: []
       }
  };
  
  if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
     console.warn("[Basketball API] Figyelmeztetés: A Gemini nem adott meg GP-t, 1-re állítva.");
     result.rawStats.home.gp = 1;
     result.rawStats.away.gp = 1;
  }

  return result;
}

export const providerName = 'new-basketball-api-stub';