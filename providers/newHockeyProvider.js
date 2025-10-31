// providers/newHockeyProvider.js
import axios from 'axios';
import { makeRequest } from './common/utils.js'; // Használjuk a közös request hívót

// Olvassuk be az ÚJ kulcsot a .env fájlból
const { HOCKEY_API_KEY } = process.env;
const HOCKEY_API_HOST = 'ice-hockey-api.p.rapidapi.com'; // Példa API

/**
 * 🏒 Jégkorong Adatlekérő Függvény
 */
export async function fetchMatchData(options) {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;

  if (!HOCKEY_API_KEY) {
    throw new Error('[Hockey API] Hiányzó HOCKEY_API_KEY a .env fájlban.');
  }

  console.log(`[Hockey Provider]: Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

  // 1. API HÍVÁSOK
  // TODO: Implementáld a jégkorong API hívásaidat (liga, csapat, meccs keresés)
  // Példa 'makeRequest' használatával:
  /*
  const apiOptions = {
    params: { league: leagueName, home: homeTeamName },
    headers: {
      'X-RapidAPI-Key': HOCKKEY_API_KEY,
      'X-RapidAPI-Host': HOCKEY_API_HOST
    }
  };
  const response = await makeRequest(`https://${HOCKEY_API_HOST}/games`, apiOptions);
  const rawApiData = response.data;
  */

  // 2. GEMINI HÍVÁS (opcionális, ha kellenek szöveges adatok)
  // const geminiJsonString = await _callGemini(PROMPT_V43(...));
  
  // 3. ADAT EGYSÉGESÍTÉS (NORMALIZÁLÁS)
  // KRITIKUS LÉPÉS: Az adatokat át kell alakítanod UGYANARRA
  // a 'result' struktúrára, amit az 'apiSportsProvider.js' visszaad!
  
  const unifiedResult = {
    rawStats: { home: { gp: 0 }, away: { gp: 0 } }, // TODO: Töltsd fel valós adatokkal
    leagueAverages: {},
    richContext: "Jégkorong specifikus kontextus...", // TODO
    advancedData: { home: {}, away: {} }, // TODO
    form: { home_overall: "N/A", away_overall: "N/A" }, // TODO
    rawData: { /* ... a nyers API válaszok ... */ },
    oddsData: null, // TODO
    fromCache: false
  };
  
  // Ellenőrzés
  if (unifiedResult.rawStats.home.gp <= 0) {
     throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek (Hockey).`);
  }

  return unifiedResult;
}

export const providerName = 'new-hockey-api';
