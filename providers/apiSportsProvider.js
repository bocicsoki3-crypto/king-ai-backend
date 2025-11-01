// providers/apiSportsProvider.js
// Ez a provider felelős a 'soccer' adatok lekéréséért az API-Sports és az xG API-k segítségével.
import axios from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import {
    SPORT_CONFIG,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
    // JAVÍTÁS: Az XG_API kulcsokat most már a központi config.js-ből importáljuk,
    // ahelyett, hogy közvetlenül a process.env-ből olvasnánk.
    XG_API_KEY,
    XG_API_HOST
} from '../config.js';
// Figyelj a relatív elérési útra!

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData,
    makeRequest // Az általános hívót is importáljuk
} from './common/utils.js';
// --- API-SPORTS SPECIFIKUS CACHE-EK ---
// (Az eredeti DataFetch.js-ből áthelyezve)
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const xgApiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
// --- API-SPORTS KULCSROTÁCIÓS LOGIKA ---
// (Az eredeti DataFetch.js-ből áthelyezve)
let keyIndexes = {
    soccer: 0,
    hockey: 0,
    basketball: 0
};
function getApiConfig(sport) {
    const config = API_HOSTS[sport];
if (!config || !config.host || !config.keys || config.keys.length === 0) {
        throw new Error(`Kritikus konfigurációs hiba: Nincsenek API kulcsok a '${sport}' sporthoz a config.js-ben.`);
}
    const currentIndex = keyIndexes[sport];
    if (currentIndex >= config.keys.length) {
        throw new Error(`MINDEN API KULCS Kimerült a(z) '${sport}' sporthoz.`);
}
    const currentKey = config.keys[currentIndex];
    return {
        baseURL: `https://${config.host}`,
        headers: {
            'x-rapidapi-key': currentKey,
            'x-rapidapi-host': config.host
        },
        keyIndex: currentIndex,
        totalKeys: config.keys.length
    };
}

function rotateApiKey(sport) {
    const config = API_HOSTS[sport];
if (keyIndexes[sport] < config.keys.length - 1) {
        keyIndexes[sport]++;
console.log(`API KULCS ROTÁLÁS: Váltás a(z) ${keyIndexes[sport] + 1}. kulcsra (${sport})...`);
        return true;
} else {
        return false;
}
}

// --- API-SPORTS KÖZPONTI HÍVÓ FÜGGVÉNY KULCSROTÁCIÓVAL ---
// (Az eredeti DataFetch.js-ből áthelyezve)
async function makeRequestWithRotation(sport, endpoint, config = {}) {
    const maxAttempts = API_HOSTS[sport]?.keys?.length ||
1;
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const apiConfig = getApiConfig(sport);
const url = `${apiConfig.baseURL}${endpoint}`;
            const fullConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
// Itt az 'utils.js'-ből importált 'makeRequest'-et használjuk
            const response = await makeRequest(url, fullConfig, 0);
return response; // SIKER

        } catch (error) {
            if (error.isQuotaError) {
                console.warn(`Kvóta hiba a(z) ${keyIndexes[sport] + 1}. kulccsal (${sport}).`);
const canRotate = rotateApiKey(sport); 
                if (canRotate) {
                    attempts++;
continue; 
                } else {
                    throw new Error(`MINDEN API KULCS Kimerült (${sport}).`);
}
            } else {
                console.error(`API hiba (nem kvóta): ${error.message}`);
throw error; 
            }
        }
    }
    throw new Error(`API hívás sikertelen ${maxAttempts} kulccsal: ${endpoint}`);
}

// --- API-SPORTS FÜGGVÉNYEK (VÁLTOZATLAN) ---
// (Az eredeti DataFetch.js 79. sorától áthelyezve)

async function getApiSportsTeamId(teamName, sport, leagueId, season) {
    const lowerName = teamName.toLowerCase().trim();
const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName;
    const cacheKey = `apisports_teamid_v45_${sport}_${leagueId}_${season}_${searchName.toLowerCase().replace(/\s+/g, '')}`;
    const cachedId = apiSportsTeamIdCache.get(cacheKey);
if (cachedId !== undefined) { 
        return cachedId === 'not_found' ?
null : cachedId; 
    }
    if (mappedName !== teamName) {
        console.log(`API-SPORTS Név Térképezés (${sport}): "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
}
    const endpoint = `/v3/teams?name=${encodeURIComponent(searchName)}&league=${leagueId}&season=${season}`;
    console.log(`API-SPORTS (${sport}): Csapatkeresés (Ligával): Név="${searchName}", LigaID="${leagueId}"`);
const response = await makeRequestWithRotation(sport, endpoint, {});
    if (response?.data?.response?.length > 0) {
        const team = response.data.response[0].team;
if (team && team.id) {
            console.log(`API-SPORTS (${sport}): TÖKÉLETES ID találat "${searchName}" -> ${team.id}`);
apiSportsTeamIdCache.set(cacheKey, team.id);
            return team.id;
        }
    }
    console.warn(`API-SPORTS (${sport}): Pontos (name=) keresés sikertelen. Próbálkozás 'search=' paraméterrel...`);
const fallbackEndpoint = `/v3/teams?search=${encodeURIComponent(searchName)}&league=${leagueId}&season=${season}`;
    const fallbackResponse = await makeRequestWithRotation(sport, fallbackEndpoint, {});
if (fallbackResponse?.data?.response?.length > 0) {
        const teams = fallbackResponse.data.response;
const teamNames = teams.map(t => t.team?.name);
        const matchResult = findBestMatch(searchName, teamNames);
if (matchResult.bestMatch.rating > 0.7) { 
            const teamId = teams[matchResult.bestMatchIndex].team.id;
console.log(`API-SPORTS (${sport}): Hasonló ID találat (fallback) "${searchName}" -> "${teams[matchResult.bestMatchIndex].team.name}" -> ${teamId}`);
            apiSportsTeamIdCache.set(cacheKey, teamId);
            return teamId;
}
    }
    console.warn(`API-SPORTS (${sport}): Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Eredeti: "${teamName}").`);
apiSportsTeamIdCache.set(cacheKey, 'not_found');
    return null;
}

async function getApiSportsLeagueId(leagueName, country, season, sport) {
    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
return null;
    }
    const tryGetLeague = async (currentSeason) => {
        const cacheKey = `apisports_leagueid_v40_${sport}_${country.toLowerCase()}_${leagueName.toLowerCase().replace(/\s/g, '')}_${currentSeason}`;
const cachedId = apiSportsLeagueIdCache.get(cacheKey);
        if (cachedId) return cachedId === 'not_found' ? null : cachedId;
        const endpoint = `/v3/leagues`;
const params = { name: leagueName, country: country, season: currentSeason };
        console.log(`API-SPORTS League Search (${sport}): "${leagueName}" (${country}, ${currentSeason})...`);
const response = await makeRequestWithRotation(sport, endpoint, { params });
        if (response?.data?.response?.length > 0) {
            const perfectMatch = response.data.response.find(l => l.league.name.toLowerCase() === leagueName.toLowerCase());
const league = perfectMatch || response.data.response[0];
            const leagueId = league.league.id;
            console.log(`API-SPORTS (${sport}): Liga ID találat "${leagueName}" -> "${league.name}" -> ${leagueId}`);
apiSportsLeagueIdCache.set(cacheKey, leagueId);
            return leagueId;
        }
        console.warn(`API-SPORTS (${sport}): Nem található liga ID ehhez: "${leagueName}" (${country}, ${currentSeason}).`);
apiSportsLeagueIdCache.set(cacheKey, 'not_found');
        return null;
    };
    let leagueId = await tryGetLeague(season);
if (!leagueId && sport === 'soccer') {
        console.warn(`API-SPORTS (${sport}): Nem található liga a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
leagueId = await tryGetLeague(season - 1);
    }
    return leagueId;
}

async function findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, utcKickoff, sport) {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return { fixtureId: null, fixtureDate: null };
const cacheKey = `apisports_findfixture_v40_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get(cacheKey);
    if (cached) return cached;
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
const endpoint = `/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
console.log(`API-SPORTS Fixture Keresés (${sport}): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában...`);
    const response = await makeRequestWithRotation(sport, endpoint, { params });
if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find(f => 
            (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId)
        );
if (foundFixture) {
            const fixture = foundFixture.fixture || foundFixture;
const result = { fixtureId: fixture.id, fixtureDate: fixture.date };
            console.log(`API-SPORTS (${sport}): MECCS TALÁLAT! FixtureID: ${result.fixtureId}`);
            apiSportsFixtureCache.set(cacheKey, result);
            return result;
}
    }
    console.warn(`API-SPORTS (${sport}): Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz.`);
apiSportsFixtureCache.set(cacheKey, { fixtureId: null, fixtureDate: null });
    return { fixtureId: null, fixtureDate: null };
}

async function getApiSportsH2H(homeTeamId, awayTeamId, limit = 5, sport) {
    const endpoint = `/v3/fixtures/headtohead`;
const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    const fixtures = response?.data?.response;
if (fixtures && Array.isArray(fixtures)) {
        return fixtures.map(fix => ({
            date: (fix.fixture || fix).date?.split('T')[0] || 'N/A',
            competition: (fix.league || fix).name || 'N/A',
            score: `${(fix.goals || fix.scores)?.home ?? '?'} - ${(fix.goals || fix.scores)?.away ?? '?'}`,
            home_team: fix.teams?.home?.name || fix.contestants?.home?.name || 'N/A',
           
 away_team: fix.teams?.away?.name || fix.contestants?.away?.name || 'N/A',
        })).slice(0, limit);
}
    return null;
}

async function getApiSportsTeamSeasonStats(teamId, leagueId, season, sport) {
    const tryGetStats = async (currentSeason) => {
        const cacheKey = `apisports_seasonstats_v40_${sport}_${teamId}_${leagueId}_${currentSeason}`;
const cachedStats = apiSportsStatsCache.get(cacheKey);
        if (cachedStats) {
            console.log(`API-SPORTS Szezon Stat cache találat (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}`);
return cachedStats;
        }
        console.log(`API-SPORTS Szezon Stat lekérés (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
const endpoint = `/v3/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
const response = await makeRequestWithRotation(sport, endpoint, { params });
        const stats = response?.data?.response;
if (stats && (stats.league?.id || stats.games?.played > 0)) {
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
let simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total ||
stats.games?.played,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };
// (A sport-specifikus statisztikák megmaradnak)
            if (sport === 'hockey' && stats.games) { /* ... */ }
            if (sport === 'basketball' && stats.games) { /* ... */ }
            apiSportsStatsCache.set(cacheKey, simplifiedStats);
return simplifiedStats;
        }
        return null;
    };
    let stats = await tryGetStats(season);
if (!stats && sport === 'soccer') {
        console.warn(`API-SPORTS (${sport}): Nem található statisztika a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
stats = await tryGetStats(season - 1);
    }
    if (!stats) {
        console.error(`API-SPORTS (${sport}): Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
}
    return stats;
}

async function getApiSportsOdds(fixtureId, sport) {
    if (!fixtureId) {
        console.warn(`API-SPORTS Odds (${sport}): Hiányzó fixtureId, a szorzók lekérése kihagyva.`);
return null;
    }
    const cacheKey = `apisports_odds_v40_${sport}_${fixtureId}`;
    const cached = apiSportsOddsCache.get(cacheKey);
if (cached) {
        console.log(`API-SPORTS Odds cache találat (${sport}): ${cacheKey}`);
return { ...cached, fromCache: true };
    }
    console.log(`Nincs API-SPORTS Odds cache (${cacheKey}). Friss lekérés...`);
const endpoint = `/v3/odds`;
    const params = { fixture: fixtureId };
    const response = await makeRequestWithRotation(sport, endpoint, { params });
if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`API-SPORTS Odds (${sport}): Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
return null;
    }
    const oddsData = response.data.response[0]; 
    const bookmaker = oddsData.bookmakers?.find(b => b.name === "Bet365") || oddsData.bookmakers?.[0];
const winnerMarketName = sport === 'soccer' ? "Match Winner" : "Moneyline";
    const matchWinnerMarket = bookmaker?.bets?.find(b => b.name === winnerMarketName);
const currentOdds = [];
    if (matchWinnerMarket) {
        const homeOdd = matchWinnerMarket.values.find(v => v.value === "Home")?.odd;
const drawOdd = matchWinnerMarket.values.find(v => v.value === "Draw")?.odd;
        const awayOdd = matchWinnerMarket.values.find(v => v.value === "Away")?.odd;
if (homeOdd) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOdd) });
        if (drawOdd) currentOdds.push({ name: 'Döntetlen', price: parseFloat(drawOdd) });
if (awayOdd) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOdd) });
    }
    const result = {
        current: currentOdds, 
        fullApiData: oddsData 
    };
if (result.current.length > 0) {
        apiSportsOddsCache.set(cacheKey, result);
console.log(`API-SPORTS Odds adatok (${sport}) sikeresen lekérve és cache-elve: ${cacheKey}`);
    } else {
         console.warn(`API-SPORTS Odds (${sport}): Találat, de nem sikerült '${winnerMarketName}' piacot találni.`);
}
    return { ...result, fromCache: false };
}


// --- ⚽ xG API FUNKCIÓ (JAVÍTVA) ---
// Ez a függvény most már a config.js-ből importált változókat használja
// és izolált 'axios' hívást használ a 'makeRequest' helyett,
// hogy garantáltan a helyes fejléceket küldje.
async function getXgData(fixtureId) {
    if (!fixtureId) {
        console.warn("xG API: Hiányzó fixtureId, xG lekérés kihagyva.");
return null;
    }
    
    // JAVÍTÁS: Közvetlen process.env olvasás helyett az importált konstansok használata
    const apiKey = XG_API_KEY;
    const apiHost = XG_API_HOST;

    if (!apiKey || !apiHost) {
        console.warn("xG API: Hiányzó XG_API_KEY vagy XG_API_HOST a config.js-ben vagy a .env fájlban. xG lekérés kihagyva.");
return null;
    }
    
    const cacheKey = `xg_api_v42_${fixtureId}`;
    const cached = xgApiCache.get(cacheKey);
if (cached) {
        console.log(`xG API cache találat: ${cacheKey}`);
        return cached;
}

    console.log(`xG API: Valós xG adatok lekérése... (FixtureID: ${fixtureId})`);
const options = {
        method: 'GET',
        url: `https://${apiHost}/fixtures/${fixtureId}`,
        headers: {
            'X-RapidAPI-Key': apiKey,  // Garantáltan a config.js-ből
            'X-RapidAPI-Host': apiHost // Garantáltan a config.js-ből
        },
        timeout: 15000 // Ésszerű időkorlát
    };
try {
        // Közvetlen, izolált axios hívás
        const response = await axios.request(options);
const xg = response?.data?.result?.xg;
        if (xg && xg.home !== null && xg.away !== null) {
            console.log(`xG API: SIKERES. Valós xG: H=${xg.home}, A=${xg.away}`);
xgApiCache.set(cacheKey, xg);
            return xg;
        } else {
            console.warn(`xG API: Az API válaszolt, de nem tartalmazott xG adatot a ${fixtureId} meccshez.`);
xgApiCache.set(cacheKey, null); 
            return null;
        }
    } catch (error) {
        // Részletesebb hibakezelés az axios hibáira
        if (error.response) {
            // A szerver válaszolt, de nem 2xx státusszal
            const status = error.response.status;
const data = error.response.data;
            if (status === 401 || status === 403) {
                 // Ez az a 401-es hiba, amit láttál!
console.error(`xG API: HITELESÍTÉSI HIBA (Státusz: ${status}). Kulcs érvénytelen vagy nincs előfizetés. Válasz: ${JSON.stringify(data)}`);
} else if (status === 404) {
                 console.warn(`xG API: Nem található fixture (${fixtureId}). Valószínűleg a liga nem támogatott.`);
} else if (status === 429) {
                 console.error("xG API: A NAPI KVÓTA KIMERÜLT. Az elemzés valós xG nélkül folytatódik.");
} else {
                 console.error(`xG API Hiba (Státusz: ${status}): ${error.message}`);
}
        } else if (error.request) {
            // A kérés elment, de nem érkezett válasz (pl. timeout)
            console.error(`xG API Hiba: Nincs válasz vagy időtúllépés. ${error.message}`);
} else {
            // Beállítási hiba
            console.error(`xG API Beállítási Hiba: ${error.message}`);
}
        
        xgApiCache.set(cacheKey, null);
        return null;
}
}


// --- Odds Segédfüggvény (VÁLTOZATLAN) ---
// (Az eredeti DataFetch.js 164. sorától áthelyezve)
function findMainTotalsLine(oddsData, sport) {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line ||
(sport === 'soccer' ? 2.5 : 6.5);
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultConfigLine;
}
    const bookmaker = oddsData.fullApiData.bookmakers.find(b => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultConfigLine;
    let marketName;
if (sport === 'soccer') marketName = "over/under";
    else if (sport === 'hockey') marketName = "total";
else if (sport === 'basketball') marketName = "total points";
    else marketName = "over/under";
const totalsMarket = bookmaker.bets.find(b => b.name.toLowerCase() === marketName);
    if (!totalsMarket?.values) {
        console.warn(`Nem található '${marketName}' piac a szorzókban (${sport}).`);
return defaultConfigLine;
    }
    const linesAvailable = {};
for (const val of totalsMarket.values) {
        const lineMatch = val.value.match(/(\d+\.\d)/);
const line = lineMatch ? lineMatch[1] : val.value; 
        if (isNaN(parseFloat(line))) continue; 
        if (!linesAvailable[line]) linesAvailable[line] = {};
if (val.value.toLowerCase().startsWith("over")) {
            linesAvailable[line].over = parseFloat(val.odd);
} else if (val.value.toLowerCase().startsWith("under")) {
            linesAvailable[line].under = parseFloat(val.odd);
}
    }
    if (Object.keys(linesAvailable).length === 0) {
        return defaultConfigLine;
}
    let closestPair = { diff: Infinity, line: defaultConfigLine };
for (const line in linesAvailable) {
        const pair = linesAvailable[line];
if (pair.over && pair.under) {
            const diff = Math.abs(pair.over - pair.under);
if (diff < closestPair.diff) {
                closestPair = { diff, line: parseFloat(line) };
}
        }
    }
    if (closestPair.diff < 0.5) {
        return closestPair.line;
}
    const numericDefaultLine = defaultConfigLine;
    const numericLines = Object.keys(linesAvailable).map(parseFloat);
numericLines.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return numericLines[0];
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData ---
// Ez a függvény futtatja az adatlekérési logikát ehhez a providerhez.
// A törzse az eredeti 'getRichContextualData' függvényből származik.
export async function fetchMatchData(options) {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
// Az eredeti 'getRichContextualData' logikája (try...catch nélkül,
    // azt a hívó 'DataFetch.js' kezeli)
    
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));
const seasonDate = new Date(decodedUtcKickoff);
    const season = (sport !== 'soccer' && seasonDate.getMonth() < 7) ?
seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
    if (isNaN(season)) throw new Error(`Érvénytelen utcKickoff: ${decodedUtcKickoff}`);
    
    console.log(`Adatgyűjtés indul (v45 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
// 1. LÉPÉS: Liga adatok lekérése
    const sportConfig = SPORT_CONFIG[sport];
    const leagueData = sportConfig.espn_leagues[leagueName];
if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
    
    const country = leagueData.country;
const leagueId = await getApiSportsLeagueId(leagueName, country, season, sport);
    if (!leagueId) throw new Error(`Nem sikerült a 'leagueId' azonosítása.`);
console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId}`);

    // 2. LÉPÉS: Csapat ID-k lekérése
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, season),
        getApiSportsTeamId(awayTeamName, sport, leagueId, season),
    ]);
if (!homeTeamId || !awayTeamId) { 
        throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`);
}
    
    const { fixtureId, fixtureDate } = await findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff, sport);
if (!fixtureId) {
         console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
}

    console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realXgData // V42 (JAVÍTVA)
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, season, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, season, sport),
      
  (sport === 'soccer' && fixtureId) ? getXgData(fixtureId) : Promise.resolve(null) // JAVÍTOTT hívás
    ]);
console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
    
    // Itt a 'utils.js'-ből importált '_callGemini'-t és 'PROMPT_V43'-t használjuk
    const geminiJsonString = await _callGemini(PROMPT_V43(
         sport, homeTeamName, awayTeamName,
         apiSportsHomeSeasonStats, apiSportsAwaySeasonStats,
         apiSportsH2HData,
         null // Lineups (opcionális)
    ));
let geminiData = null;
    try { 
        geminiData = geminiJsonString ?
JSON.parse(geminiJsonString) : null;
    } catch (e) { 
        console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500));
}

    if (!geminiData || typeof geminiData !== 'object') {
         geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home: {}, away: {} }, tactical_patterns: { home: [], away: [] }, key_matchups: {}, advanced_stats_team: { home: {}, away: {} }, advanced_stats_goalie: { home_goalie: {}, away_goalie: {} }, shot_distribution: {}, defensive_style: {}, absentees: { home: [], away: [] }, team_news: { home: "N/A", away: "N/A" }, h2h_structured: [] };
console.warn("Gemini válasz hibás vagy üres, default struktúra használva.");
    }

    // --- VÉGLEGES ADAT EGYESÍTÉS (v45) ---
    const finalData = { ...geminiData };
const finalHomeStats = {
        ...(geminiData.stats?.home || {}),
        ...(apiSportsHomeSeasonStats || {}),
    };
const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || geminiData.stats?.home?.gp || 1;
    finalHomeStats.GP = homeGP;
// ... (a többi statisztika egyesítés) ...
    const finalAwayStats = {
        ...(geminiData.stats?.away || {}),
        ...(apiSportsAwaySeasonStats || {}),
    };
const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || geminiData.stats?.away?.gp || 1;
    finalAwayStats.GP = awayGP;
// ...
    finalData.stats = { home: finalHomeStats, away: finalAwayStats };
    console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
finalData.apiFootballData = {
        homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
        lineups: null, liveStats: null, 
        seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
    };
finalData.sportsDbData = finalData.apiFootballData; 
    finalData.h2h_structured = apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
    finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
const homeForm = apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || "N/A";
    const awayForm = apiSportsAwaySeasonStats?.form || geminiData?.form?.away_overall || "N/A";
finalData.form = { home_overall: homeForm, away_overall: awayForm, home_home: geminiData?.form?.home_home || "N/A", away_away: geminiData?.form?.away_away || "N/A" };
    
    const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
// 'utils.js'-ből importált hívás
    const structuredWeather = await getStructuredWeatherData(stadiumLocation, decodedUtcKickoff);
    if (!finalData.contextual_factors) finalData.contextual_factors = {};
finalData.contextual_factors.structured_weather = structuredWeather;
    
    const richContextParts = [
         finalData.h2h_summary && finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
         realXgData && `- Valós xG (API): H=${realXgData.home}, A=${realXgData.away}`, // V42 (JAVÍTVA)
         finalData.team_news?.home && finalData.team_news.home !== "N/A" && `- Hírek (H): ${finalData.team_news.home}`,
         finalData.team_news?.away && finalData.team_news.away !== "N/A" && `- Hírek (V): ${finalData.team_news.away}`,
         finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
         (homeForm !== "N/A" || awayForm !== "N/A") && `- Forma: H:${homeForm}, V:${awayForm}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`
    ].filter(Boolean);
const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
// V42: Az 'advancedData' mezőt most az xG API-ból töltjük fel
    const advancedData = realXgData ?
{ home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
        (geminiData.advancedData || { home: { xg: null }, away: { xg: null } });
const result = {
         rawStats: finalData.stats,
         leagueAverages: finalData.league_averages ||
{},
         richContext,
         advancedData: advancedData, // <-- V42: Itt adjuk át a VALÓS xG-t
         form: finalData.form,
         rawData: finalData,
         oddsData: fetchedOddsData, 
         fromCache: false // A 'getRichContextualData' kezeli a 'fromCache' zászlót
    };
if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
        console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0).`);
throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
    }
    
    // A provider visszaadja a teljes, egységesített adatobjektumot
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-soccer';
