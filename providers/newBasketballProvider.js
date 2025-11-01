// providers/newBasketballProvider.js (v49 - Egységesített Konfiguráció)
import axios from 'axios';
import { makeRequest } from './common/utils.js';

// --- JAVÍTÁS (v49): Egységesített Konfiguráció Importálása ---
// A 'BASKETBALL_API_KEY' és 'BASKETBALL_API_HOST' közvetlen importálása helyett
// az egész 'API_HOSTS' objektumot importáljuk.
import {
    API_HOSTS
} from '../config.js';
// --- JAVÍTÁS VÉGE ---

// Importáljuk a megosztott segédfüggvényeket (ha szükségesek)
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData
} from './common/utils.js';


/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 * FIGYELEM: Ez a provider jelenleg egy "stub" (csonk).
 * Csak a konfigurációs hibát javítja, de nem kér le valós adatokat.
 * A valós API hívásokat (pl. makeBasketballRequest) implementálni kell.
 */
export async function fetchMatchData(options) {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;

  // --- JAVÍTÁS (v49): Konfiguráció ellenőrzése az API_HOSTS-ból ---
  const basketballConfig = API_HOSTS.basketball;

  if (!basketballConfig || !basketballConfig.host || !basketballConfig.keys || basketballConfig.keys.length === 0) {
    throw new Error('[Basketball API] Kritikus konfigurációs hiba: Nincsenek API kulcsok vagy host a "basketball" sporthoz a config.js API_HOSTS objektumában.');
  }
  
  console.log(`[Basketball Provider]: Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);
  console.log(`[Basketball Provider]: FIGYELEM: Ez a provider jelenleg egy "stub" (csonk), és placeholder adatokat ad vissza.`);

  // 1. API HÍVÁSOK
  // TODO: Implementáld a kosárlabda API hívásaidat a 'basketballConfig.host' és 'basketballConfig.keys[0]' felhasználásával.
  // Példa egy (még nem létező) hívófüggvényre:
  // const leagueId = await getBasketballLeagueId(leagueName, basketballConfig);
  // const homeTeamId = await getBasketballTeamId(homeTeamName, leagueId, basketballConfig);
  
  // 2. GEMINI HÍVÁS (opcionális, a placeholder adatokkal)
  const geminiJsonString = await _callGemini(PROMPT_V43(
       sport, homeTeamName, awayTeamName,
       null, // Nincs szezon statisztika
       null, // Nincs H2H
       null // Nincs Lineup
  ));
  let geminiData = {};
  try { 
      geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};
  } catch (e) { 
      console.error(`[Basketball API] Gemini JSON parse hiba: ${e.message}`);
  }

  // 3. ADAT EGYSÉGESÍTÉS (NORMALIZÁLÁS)
  // KRITIKUS LÉPÉS: Mivel nincsenek API adataink, a 'GP' (Games Played) értéket
  // 1-re állítjuk, hogy a 'Model.js'  ne dobjon hibát (GP > 0 ellenőrzés).
  const finalHomeStats = { ...(geminiData.stats?.home || {}), GP: geminiData.stats?.home?.gp || 1 };
  const finalAwayStats = { ...(geminiData.stats?.away || {}), GP: geminiData.stats?.away?.gp || 1 };

  const unifiedResult = {
    rawStats: { home: finalHomeStats, away: finalAwayStats },
    leagueAverages: geminiData.league_averages || {},
    richContext: geminiData.h2h_summary || "Kosárlabda specifikus kontextus (Gemini alapján)...",
    advancedData: geminiData.advanced_data || { home: {}, away: {} },
    form: geminiData.form || { home_overall: "N/A", away_overall: "N/A" },
    rawData: { ...geminiData }, // A Gemini válaszát adjuk át nyers adatként
    oddsData: null,
    fromCache: false
  };

  // Ellenőrzés
  if (unifiedResult.rawStats.home.GP <= 0 || unifiedResult.rawStats.away.GP <= 0) {
     console.warn("[Basketball API] Figyelmeztetés: A Gemini nem adott meg GP-t, 1-re állítva.");
     unifiedResult.rawStats.home.GP = 1;
     unifiedResult.rawStats.away.GP = 1;
  }

  return unifiedResult;
}

export const providerName = 'new-basketball-api';