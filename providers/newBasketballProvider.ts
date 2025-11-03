// FÁJL: providers/newBasketballProvider.ts
// (v54.8 - Típusbiztos 'contextual_factors' és 'referee' javítás)
// MÓDOSÍTÁS: A modul átalakítva TypeScript-re.
// A 'fetchMatchData' most már a 'IDataProvider' interfésznek megfelelően
// Promise<ICanonicalRichContext> típust ad vissza.
// FIGYELEM: Ez a provider továbbra is "stub" (csonk), de most már
// típusbiztos és a kanonikus modellt használja.

import axios from 'axios';
import { makeRequest } from './common/utils.js';

// Kanonikus típusok importálása
// === JAVÍTÁS (TS2846) ===
// A 'import' helyett 'import type'-ot használunk, mivel a .d.ts fájlok
// nem tartalmaznak futásidejű kódot, csak típus-deklarációkat.
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    IStructuredWeather // Szükséges a helyi inicializáláshoz
} from '../src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

import {
    BASKETBALL_API_KEY,
    BASKETBALL_API_HOST
} from '../config.js';

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData // Ez a legacy (hiányos) weather függvény
} from './common/utils.js';

/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 * FIGYELEM: Ez a provider jelenleg egy "stub" (csonk).
 * A valós API hívásokat (pl. makeBasketballRequest) implementálni kell.
 * Most már az ICanonicalRichContext szerződést teljesíti.
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
  
  // --- JAVÍTÁS (v50): Konfiguráció ellenőrzése a helyes változókkal ---
  if (!BASKETBALL_API_KEY || !BASKETBALL_API_HOST) {
    throw new Error('[Basketball API] Kritikus konfigurációs hiba: Hiányzó BASKETBALL_API_KEY vagy BASKETBALL_API_HOST a config.js-ben.');
  }
  
  console.log(`[Basketball Provider]: Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);
  console.log(`[Basketball Provider]: FIGYELEM: Ez a provider jelenleg egy "stub" (csonk), és placeholder adatokat ad vissza.`);
  
  // 1. API HÍVÁSOK
  // TODO: Implementáld a kosárlabda API hívásaidat a 'BASKETBALL_API_HOST' és 'BASKETBALL_API_KEY' felhasználásával.
  // Példa egy (még nem létező) hívófüggvényre:
  // const leagueId = await getBasketballLeagueId(leagueName, BASKETBALL_API_HOST, BASKETBALL_API_KEY);
  // const homeTeamId = await getBasketballTeamId(homeTeamName, leagueId, ...);
  
  // --- 2. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL) ---
  // Mivel ez egy "stub", szimulált adatokat hozunk létre, hogy megfeleljünk az interfésznek
  // KRITIKUS LÉPÉS: A 'gp' (Games Played) értékét 1-re állítjuk,
  // hogy a 'Model.ts' ne dobjon hibát (GP > 0 ellenőrzés).
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


  // --- 3. GEMINI HÍVÁS (opcionális, a placeholder adatokkal) ---
  const geminiJsonString = await _callGemini(PROMPT_V43(
       sport, homeTeamName, awayTeamName,
       unifiedHomeStats, // Már a kanonikus statokat adjuk át
       unifiedAwayStats,
       null, // Nincs H2H
       null // Nincs Lineup
  ));
  
  let geminiData: any = {};
  try { 
      geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};
  } catch (e: any) { 
      console.error(`[Basketball API] Gemini JSON parse hiba: ${e.message}`);
  }

  // --- 4. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v54.8) ---
  
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
      // Szimulált PlayerStats, mivel ez az API nem támogatja
      detailedPlayerStats: { 
          home_absentees: [], 
          away_absentees: [], 
          key_players_ratings: { home: {}, away: {} } 
      },
      absentees: { home: [], away: [] }, // Szintén a 'detailedPlayerStats'-ból származna
      h2h_structured: geminiData.h2h_structured || null,

      // === JAVÍTÁS (v54.8) Kezdete ===
      // A hiányzó mezők pótlása az ICanonicalRawData (v54.8) interfésznek megfelelően.
      // Ez megoldja a TS2739 és TS2339 hibákat.
      referee: {
        name: null,
        style: null
      },
      contextual_factors: {
        stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
        pitch_condition: "N/A (Parketta)",
        
        // A Model.ts által várt mezők (TS2339)
        weather: "N/A (Beltéri)", // Alapértelmezett, felülírjuk a structuredWeather alapján
        match_tension_index: null, 

        // Alapértelmezett 'structured_weather', hogy az objektum teljes legyen
        structured_weather: {
            description: "N/A",
            temperature_celsius: null
            // A többi mező (humidity, wind, precip) opcionális a v54.8 interfészben
        }
      },
      // === JAVÍTÁS (v54.8) Vége ===

      ...geminiData // Minden egyéb AI által generált adat (pl. tactics)
  };
  
  // GP felülírása a biztonság kedvéért (az ICanonicalStats-nak megfelelően)
  finalData.stats.home.gp = unifiedHomeStats.gp;
  finalData.stats.away.gp = unifiedAwayStats.gp;

  console.log(`[Basketball API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);

  // === JAVÍTÁS (v54.8) A 'structured_weather' kezelése ===
  // A 'getStructuredWeatherData' egy legacy függvény, ami csak { desc, temp } objektumot ad vissza.
  // Mivel az IStructuredWeather (v54.8) már opcionális mezőket használ, ez a hívás kompatibilis.
  const structuredWeather = await getStructuredWeatherData(
      finalData.contextual_factors.stadium_location, 
      utcKickoff
  );
  
  // Közvetlenül frissítjük a finalData objektumot (nincs szükség 'if' ellenőrzésre)
  finalData.contextual_factors.structured_weather = structuredWeather;
  // Frissítjük a Model.ts által várt 'weather' stringet is
  finalData.contextual_factors.weather = structuredWeather.description || "N/A (Beltéri)";
  // === JAVÍTÁS VÉGE ===


  const richContext = [
       geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
       geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
       geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
       // Most már a finalData-ból olvassuk ki, ahelyett, hogy külön változót használnánk
       finalData.contextual_factors.weather !== "N/A (Beltéri)" && `- Időjárás: ${finalData.contextual_factors.weather}`
  ].filter(Boolean).join('\n') || "N/A";


  // A végső ICanonicalRichContext objektum összeállítása
  const result: ICanonicalRichContext = {
       rawStats: finalData.stats,
       leagueAverages: geminiData.league_averages || {},
       richContext,
       advancedData: geminiData.advancedData || { home: {}, away: {} },
       form: finalData.form,
       rawData: finalData, // Ez már a v54.8-nak megfelelő adat
       oddsData: null, // Ez az API nem szolgáltat odds-okat
       fromCache: false
  };

  // Kritikus ellenőrzés (A 'gp' kulcsra, ahogy az interfész diktálja)
  if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
     console.warn("[Basketball API] Figyelmeztetés: A Gemini nem adott meg GP-t, 1-re állítva.");
     result.rawStats.home.gp = 1;
     result.rawStats.away.gp = 1;
  }

  return result;
}

export const providerName = 'new-basketball-api-stub';
