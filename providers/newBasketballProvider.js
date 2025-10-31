// providers/newBasketballProvider.js
import axios from 'axios';
import { makeRequest } from './common/utils.js'; // Használjuk a közös request hívót

// Olvassuk be az ÚJ kulcsot a .env fájlból
const { BASKETBALL_API_KEY } = process.env;
const BASKETBALL_API_HOST = 'basketball-api.p.rapidapi.com'; // Példa API

/**
 * 🏀 Kosárlabda Adatlekérő Függvény
 */
export async function fetchMatchData(options) {
  const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;

  if (!BASKETBALL_API_KEY) {
    throw new Error('[Basketball API] Hiányzó BASKETBALL_API_KEY a .env fájlban.');
  }
  
  console.log(`[Basketball Provider]: Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

  // 1. API HÍVÁSOK
  // TODO: Implementáld a kosárlabda API hívásaidat
  
  // 2. GEMINI HÍVÁS (opcionális)

  // 3. ADAT EGYSÉGESÍTÉS (NORMALIZÁLÁS)
  // KRITIKUS LÉPÉS: Az adatokat át kell alakítanod UGYANARRA
  // a 'result' struktúrára, mint a többi provider!
  
  const unifiedResult = {
    rawStats: { home: { gp: 0 }, away: { gp: 0 } }, // TODO: Töltsd fel valós adatokkal
    leagueAverages: {},
    richContext: "Kosárlabda specifikus kontextus...", // TODO
    advancedData: { home: {}, away: {} }, // TODO
    form: { home_overall: "N/A", away_overall: "N/A" }, // TODO
    rawData: { /* ... a nyers API válaszok ... */ },
    oddsData: null, // TODO
    fromCache: false
  };

  // Ellenőrzés
  if (unifiedResult.rawStats.home.gp <= 0) {
     throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek (Basketball).`);
  }

  return unifiedResult;
}

export const providerName = 'new-basketball-api';
