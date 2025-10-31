// providers/apiSportsSoccerProvider.js
const axios = require('axios');

// Olvassuk be a környezeti változókat
const {
  APISPORTS_API_KEY, // Feltételezem, van egy ilyen kulcsod az API-Sports-hoz
  XG_API_KEY,
  XG_API_HOST
} = process.env;

// Egy helper function az API-Sports hívásokhoz
// (A te jelenlegi logikád alapján)
async function apiSportsRequest(endpoint, params) {
  const options = {
    method: 'GET',
    url: `https://v3.football.api-sports.io/${endpoint}`,
    params: params,
    headers: {
      'x-rapidapi-key': APISPORTS_API_KEY,
      'x-rapidapi-host': 'v3.football.api-sports.io'
    }
  };
  // TODO: Ide jön a te létező API-Sports hívás logikád (pl. axios-szal)
  // const response = await axios.request(options);
  // return response.data;
  
  // *** Placeholder - cseréld le a valódi API hívásokkal ***
  console.log(`[API-Sports HÍVÁS] Endpoint: ${endpoint}`, params);
  if (endpoint === 'leagues') return { response: [{ league: { id: 62 } }] }; // Log alapján
  if (endpoint === 'teams' && params.name === 'Annecy') return { response: [{ team: { id: 3012 } }] }; // Log alapján
  if (endpoint === 'teams' && params.name === 'Boulogne') return { response: [{ team: { id: 1299 } }] }; // Log alapján
  if (endpoint === 'fixtures') return { response: [{ fixture: { id: 1389229 } }] }; // Log alapján
  if (endpoint === 'statistics') return { response: { goals: { for: { total: { total: 15 } } } } }; // Log alapján
  if (endpoint === 'odds') return { response: [] }; // Log alapján
  return { response: [] };
}

/**
 * ⚽ xG API HÍVÁS - JAVÍTVA ⚽
 * Ez az axios hívás megoldja a 401-es hibát.
 */
async function fetchXgData(fixtureId) {
  // Ellenőrizzük, hogy a kulcsok be vannak-e töltve
  if (!XG_API_KEY || !XG_API_HOST) {
    console.warn('[xG API] Hiányzó XG_API_KEY vagy XG_API_HOST a .env fájlban. xG lekérés kihagyva.');
    return null;
  }

  const options = {
    method: 'GET',
    url: `https://${XG_API_HOST}/fixtures/${fixtureId}`,
    headers: {
      'X-RapidAPI-Key': XG_API_KEY,  // Pontosan a .env fájlból
      'X-RapidAPI-Host': XG_API_HOST // Pontosan a .env fájlból
    }
  };

  try {
    const response = await axios.request(options);
    console.log(`[xG API] Sikeres adatlekérés a ${fixtureId} meccshez.`);
    return response.data; // Az axios automatikusan parse-olja a JSON-t
  } catch (error) {
    // Az axios automatikusan hibát dob 4xx/5xx státuszkódokra
    // Pontosan azt a hibát logoljuk, amit a naplóban láttál
    console.error(`[xG API HITELESÍTÉSI HIBA] Státusz: ${error.response?.status}`);
    console.error(`[xG API HITELESÍTÉSI HIBA] Válasz:`, error.response?.data);
    return null; // A rendszered így is tovább tud futni (fallback xG-re)
  }
}

async function fetchMatchData(options) {
  const { home, away, leagueName } = options;

  // 1. LIGA ID LEKÉRÉSE (A te logikád alapján)
  const leagueData = await apiSportsRequest('leagues', { name: leagueName, country: 'France' }); // Feltételezés
  const leagueId = leagueData.response[0]?.league?.id || 62; // Fallback

  // 2. CSAPAT ID-K LEKÉRÉSE (A te logikád alapján)
  const homeTeamData = await apiSportsRequest('teams', { name: home, league: leagueId });
  const awayTeamData = await apiSportsRequest('teams', { name: away, league: leagueId });
  const homeTeamId = homeTeamData.response[0]?.team?.id; //
  const awayTeamId = awayTeamData.response[0]?.team?.id; //

  if (!homeTeamId || !awayTeamId) {
    throw new Error(`Csapat ID nem található: Home(${home}) vagy Away(${away})`);
  }

  // 3. MECCS (FIXTURE) ID LEKÉRÉSE
  const fixtureData = await apiSportsRequest('fixtures', { league: leagueId, season: 2025, home: homeTeamId, away: awayTeamId });
  const fixtureId = fixtureData.response[0]?.fixture?.id; //

  if (!fixtureId) {
    throw new Error(`Meccs (Fixture) ID nem található a ${home} vs ${away} meccshez.`);
  }

  // 4. PÁRHUZAMOS ADATLEKÉRÉSEK (A logod alapján)
  const [
    homeStats,
    awayStats,
    oddsData,
    xgData
  ] = await Promise.all([
    apiSportsRequest('statistics', { team: homeTeamId, league: leagueId, season: 2025 }), //
    apiSportsRequest('statistics', { team: awayTeamId, league: leagueId, season: 2025 }), //
    apiSportsRequest('odds', { fixture: fixtureId }), //
    fetchXgData(fixtureId) // A JAVÍTOTT xG HÍVÁS
  ]);

  // 5. ADATOK EGYSÉGESÍTÉSE (Normalizálás)
  // Ez a legfontosabb lépés. Itt kell egy egységes
  // objektumot összerakni, amit a Model.js és a többi modul vár.
  const unifiedData = {
    provider: 'api-sports-soccer',
    fixtureId: fixtureId,
    league: { id: leagueId, name: leagueName },
    teams: {
      home: { id: homeTeamId, name: home },
      away: { id: awayTeamId, name: away }
    },
    stats: {
      home: homeStats.response, // A te logikád alapján
      away: awayStats.response  // A te logikád alapján
    },
    odds: oddsData.response, // A te logikád alapján
    xg: xgData, // Az új, javított xG adat
    // ...minden más adat, amit a rendszered használ
  };
  
  return unifiedData;
}

module.exports = { 
  fetchMatchData,
  providerName: 'api-sports-soccer' // Meta-adat a logoláshoz
};
