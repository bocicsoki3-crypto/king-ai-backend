// --- VÉGLEGES INTEGRÁLT (v40 - Multi-Sport API Hívás) datafetch.js ---
// - V40 JAVÍTÁS: A 'getRichContextualData' és az összes 'getApiFootball...'
// függvény átalakítva, hogy a 'sport' paraméter alapján a
// config.js-ben definiált 'API_HOSTS' térképből válassza ki
// a helyes API hostot (foci, hoki, kosár).
// Ez javítja a logokban látott jégkorong hibákat.

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS // <-- V40: Az új Host Térkép importálása
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { fileURLToPath } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

// Importáljuk az új, specifikus providereket
import * as apiSportsProvider from './providers/apiSportsProvider.js';
import * as hockeyProvider from './providers/newHockeyProvider.js';
import * as basketballProvider from './providers/newBasketballProvider.js';

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures
} from './providers/common/utils.js';

// --- FŐ CACHE INICIALIZÁLÁS ---
// (Minden más cache a provider-specifikus fájlokba került)
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); 
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v40 (2025-10-29) - Multi-Sport API Hívás Javítás
**************************************************************/

// --- API HOST ÉS KULCS KIVÁLASZTÓ (v40) ---
function getApiConfig(sport) {
    const config = API_HOSTS[sport];
    if (!config || !config.host || !config.key) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó API_HOSTS bejegyzés a '${sport}' sporthoz a config.js-ben.`);
    }
    return {
        baseURL: `https://${config.host}`,
        headers: {
            'x-rapidapi-key': config.key,
            'x-rapidapi-host': config.host
        }
    };
}

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 25000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
           };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };
            
            let response;
            if (method === 'POST') {
                response = await axios.post(url, currentConfig.data || {}, currentConfig);
            } else {
                response = await axios.get(url, { ...currentConfig });
            }

            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.response.status === 429) { console.error(`CRITICAL RATE LIMIT: ${errorMessage}`); return null; }
                if ([401, 403].includes(error.response.status)) { console.error(`HITELESÍTÉSI HIBA: ${errorMessage}`);
                    return null; }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 25000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
            }
            
            if (attempts > retries) {
                console.error(`API (${method}) hívás végleg sikertelen: ${errorMessage}`);
                return null;
            }
            console.warn(errorMessage);
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    return null;
}


// --- GEMINI API FUNKCIÓ ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", }, };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }
        let potentialJson = responseText.trim();
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            potentialJson = jsonMatch[1].trim();
        }
        JSON.parse(potentialJson); // Validálás
        return potentialJson;
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        throw e;
    }
}

// --- IDŐJÁRÁS FUNKCIÓ (Placeholder) ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    console.log(`Időjárás lekérés (placeholder): Helyszín=${stadiumLocation}, Időpont=${utcKickoff}`);
    return {
        temperature_celsius: null,
        description: "N/A"
    };
}

// --- API-SPORTS FUNKCIÓK (v40 - Általánosítva) ---

// v40: Átnevezve 'getApiSportsTeamId'-re, és 'sport' paramétert kap
async function getApiSportsTeamId(teamName, sport) {
    const apiConfig = getApiConfig(sport);
    
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName;
    
    const cacheKey = `apisports_teamid_v40_${sport}_${searchName.toLowerCase().replace(/\s+/g, '')}`;
    
    const cachedId = apiSportsTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { 
        return cachedId === 'not_found' ? null : cachedId; 
    }

    const url = `${apiConfig.baseURL}/v3/teams?search=${encodeURIComponent(searchName)}`;
    
    if (mappedName !== teamName) {
        console.log(`API-SPORTS Név Térképezés (${sport}): "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    }

    const response = await makeRequest(url, { headers: apiConfig.headers });
    if (response?.data?.response?.length > 0) {
        const teams = response.data.response;
        
        const perfectMatch = teams.find(t => t.team?.name.toLowerCase() === searchName.toLowerCase());
        if (perfectMatch) {
            const teamId = perfectMatch.team.id;
            console.log(`API-SPORTS (${sport}): TÖKÉLETES ID találat "${searchName}" -> ${teamId}`);
            apiSportsTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }

        const teamNames = teams.map(t => t.team?.name);
        const matchResult = findBestMatch(searchName, teamNames);
        if (matchResult.bestMatch.rating > 0.6) {
            const teamId = teams[matchResult.bestMatchIndex].team.id;
            console.log(`API-SPORTS (${sport}): Hasonló ID találat "${searchName}" -> "${teams[matchResult.bestMatchIndex].team.name}" -> ${teamId}`);
            apiSportsTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }
    }
    
    console.warn(`API-SPORTS (${sport}): Nem található csapat ID ehhez: "${searchName}" (eredeti: "${teamName}").`);
    apiSportsTeamIdCache.set(cacheKey, 'not_found');
    return null;
}

// v40: Átnevezve 'getApiSportsLeagueId'-re, és 'sport' paramétert kap
async function getApiSportsLeagueId(leagueName, country, season, sport) {
    const apiConfig = getApiConfig(sport);

    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const tryGetLeague = async (currentSeason) => {
        const cacheKey = `apisports_leagueid_v40_${sport}_${country.toLowerCase()}_${leagueName.toLowerCase().replace(/\s/g, '')}_${currentSeason}`;
        const cachedId = apiSportsLeagueIdCache.get(cacheKey);
        if (cachedId) return cachedId === 'not_found' ? null : cachedId;

        const url = `${apiConfig.baseURL}/v3/leagues`;
        
        // Az API-Hockey és API-Basketball más paraméterezést használhat (pl. "search" név alapján)
        // De a "name" és "country" általában működik
        const params = { name: leagueName, country: country, season: currentSeason };
        
        console.log(`API-SPORTS League Search (${sport}): "${leagueName}" (${country}, ${currentSeason})...`);
        const response = await makeRequest(url, { headers: apiConfig.headers, params });
        
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
    if (!leagueId && sport === 'soccer') { // Csak focinál próbáljunk előző szezont, sportoknál bonyolultabb
        console.warn(`API-SPORTS (${sport}): Nem található liga a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        leagueId = await tryGetLeague(season - 1);
    }
    return leagueId;
}

// v40: Átnevezve 'findApiSportsFixture'-re, és 'sport' paramétert kap
async function findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, utcKickoff, sport) {
    const apiConfig = getApiConfig(sport);
    
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return { fixtureId: null, fixtureDate: null };
    const cacheKey = `apisports_findfixture_v40_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get(cacheKey);
    if (cached) return cached;
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const url = `${apiConfig.baseURL}/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    
    console.log(`API-SPORTS Fixture Keresés (${sport}): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában...`);
    const response = await makeRequest(url, { headers: apiConfig.headers, params });
    if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find(f => 
            (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId) // Kosárlabda más struktúrát használhat
        );
        if (foundFixture) {
            const fixture = foundFixture.fixture || foundFixture; // API-eltérések kezelése
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

// v40: Átnevezve 'getApiSportsH2H'-re, és 'sport' paramétert kap
async function getApiSportsH2H(homeTeamId, awayTeamId, limit = 5, sport) {
    const apiConfig = getApiConfig(sport);
    
    const url = `${apiConfig.baseURL}/v3/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    const response = await makeRequest(url, { headers: apiConfig.headers, params });
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

// v40: Átnevezve 'getApiSportsTeamSeasonStats'-re, és 'sport' paramétert kap
async function getApiSportsTeamSeasonStats(teamId, leagueId, season, sport) {
    const apiConfig = getApiConfig(sport);
    
    const tryGetStats = async (currentSeason) => {
        const cacheKey = `apisports_seasonstats_v40_${sport}_${teamId}_${leagueId}_${currentSeason}`;
        const cachedStats = apiSportsStatsCache.get(cacheKey);
        if (cachedStats) {
            console.log(`API-SPORTS Szezon Stat cache találat (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}`);
            return cachedStats;
        }

        console.log(`API-SPORTS Szezon Stat lekérés (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
        const url = `${apiConfig.baseURL}/v3/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
        const response = await makeRequest(url, { headers: apiConfig.headers, params });
        const stats = response?.data?.response;
        
        // Általánosított statisztika (Foci, Hoki, Kosár eltérő lehet)
        if (stats && (stats.league?.id || stats.games?.played > 0)) {
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
            
            // Foci statisztikák
            let simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total || stats.games?.played,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };

            // Jégkorong statisztikák (ha léteznek)
            if (sport === 'hockey' && stats.games) {
                simplifiedStats = {
                    gamesPlayed: stats.games.played,
                    form: stats.form,
                    goalsFor: stats.goals.for,
                    goalsAgainst: stats.goals.against,
                };
            }
            
            // Kosárlabda statisztikák (ha léteznek)
            if (sport === 'basketball' && stats.games) {
                simplifiedStats = {
                    gamesPlayed: stats.games.played,
                    form: stats.form,
                    pointsFor: stats.points.for,
                    pointsAgainst: stats.points.against,
                };
            }

            apiSportsStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        }
        return null;
    };
    
    let stats = await tryGetStats(season);
    if (!stats && sport === 'soccer') { // Csak focinál próbáljunk előző szezont
        console.warn(`API-SPORTS (${sport}): Nem található statisztika a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        stats = await tryGetStats(season - 1);
    }

    if (!stats) {
        console.error(`API-SPORTS (${sport}): Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    
    return stats;
}


// v40: Átnevezve 'getApiSportsOdds'-re, és 'sport' paramétert kap
async function getApiSportsOdds(fixtureId, sport) {
    const apiConfig = getApiConfig(sport);
    
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
    const url = `${apiConfig.baseURL}/v3/odds`;
    const params = { fixture: fixtureId }; // 'fixture' paraméter általános az API-Sports-nál
    
    const response = await makeRequest(url, { headers: apiConfig.headers, params });

    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`API-SPORTS Odds (${sport}): Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
        return null;
    }

    const oddsData = response.data.response[0]; 
    const bookmaker = oddsData.bookmakers?.find(b => b.name === "Bet365") || oddsData.bookmakers?.[0];
    
    // Piac nevének általánosítása (Foci: "Match Winner", Kosár/Hoki: "Moneyline")
    const winnerMarketName = sport === 'soccer' ? "Match Winner" : "Moneyline";
    const matchWinnerMarket = bookmaker?.bets?.find(b => b.name === winnerMarketName);
    
    const currentOdds = [];
    if (matchWinnerMarket) {
        const homeOdd = matchWinnerMarket.values.find(v => v.value === "Home")?.odd;
        const drawOdd = matchWinnerMarket.values.find(v => v.value === "Draw")?.odd; // Csak focinál/hokinál
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

// v40: Átírva, hogy a 'sport' paramétert is használja
export function findMainTotalsLine(oddsData, sport) {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line || (sport === 'soccer' ? 2.5 : 6.5);
    
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultConfigLine;
    }

    const bookmaker = oddsData.fullApiData.bookmakers.find(b => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultConfigLine;

    // Általánosított piacnév (Foci: "Over/Under", Hoki: "Total", Kosár: "Total Points")
    let marketName;
    if (sport === 'soccer') marketName = "over/under";
    else if (sport === 'hockey') marketName = "total";
    else if (sport === 'basketball') marketName = "total points";
    else marketName = "over/under"; // Alapértelmezett

    const totalsMarket = bookmaker.bets.find(b => b.name.toLowerCase() === marketName);
    if (!totalsMarket?.values) {
        console.warn(`Nem található '${marketName}' piac a szorzókban (${sport}).`);
        return defaultConfigLine;
    }

    const linesAvailable = {}; 

    for (const val of totalsMarket.values) {
        // A vonal lehet "Over 2.5" vagy "2.5"
        const lineMatch = val.value.match(/(\d+\.\d)/);
        const line = lineMatch ? lineMatch[1] : val.value; // Ha csak szám (pl. kosárnál)

        if (isNaN(parseFloat(line))) continue; // Ha nem szám (pl. "Over" de nincs szám)

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


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (v40 - Multi-Sport) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v40_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        
        const fixtureId = cached.rawData.apiFootballData.fixtureId; // v36-ban 'apiFootballData'-ként mentettük
        const oddsResult = await getApiSportsOdds(fixtureId, sport); 
        
        if (oddsResult && !oddsResult.fromCache) {
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));
        const seasonDate = new Date(decodedUtcKickoff);
        // Jégkorongnál/Kosárnál a szezon pl. 2024-2025. Ha a meccs 2025 januárjában van, a szezon 2024.
        const season = (sport !== 'soccer' && seasonDate.getMonth() < 7) ? seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        
        if (isNaN(season)) throw new Error(`Érvénytelen utcKickoff: ${decodedUtcKickoff}`);
        
        console.log(`Adatgyűjtés indul (v40 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
        
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiSportsTeamId(homeTeamName, sport),
            getApiSportsTeamId(awayTeamName, sport),
        ]);
        
        if (!homeTeamId || !awayTeamId) { 
            throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`); 
        }
        
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig.espn_leagues[leagueName];
        if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
        
        const leagueId = await getApiSportsLeagueId(leagueName, leagueData.country, season, sport);
        if (!leagueId) throw new Error(`Nem sikerült a 'leagueId' azonosítása.`);
        console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId}`);
        
        const { fixtureId, fixtureDate } = await findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff, sport);
        
        if (!fixtureId) {
             console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds lekérés és a H2H kihagyva.`);
        }

        console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
        const [
            fetchedOddsData,
            apiSportsH2HData,
            apiSportsHomeSeasonStats,
            apiSportsAwaySeasonStats
        ] = await Promise.all([
            getApiSportsOdds(fixtureId, sport), 
            getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
            getApiSportsTeamSeasonStats(homeTeamId, leagueId, season, sport),
            getApiSportsTeamSeasonStats(awayTeamId, leagueId, season, sport)
        ]);
        console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
        
        const geminiJsonString = await _callGemini(PROMPT_V43(
             sport, homeTeamName, awayTeamName,
             apiSportsHomeSeasonStats, apiSportsAwaySeasonStats,
             apiSportsH2HData,
             null // Lineups (opcionális)
        ));
        
        let geminiData = null;
        try { 
            geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null;
        } catch (e) { 
            console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500));
        }

        if (!geminiData || typeof geminiData !== 'object') {
             geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home: {}, away: {} }, tactical_patterns: { home: [], away: [] }, key_matchups: {}, advanced_stats_team: { home: {}, away: {} }, advanced_stats_goalie: { home_goalie: {}, away_goalie: {} }, shot_distribution: {}, defensive_style: {}, absentees: { home: [], away: [] }, team_news: { home: "N/A", away: "N/A" }, h2h_structured: [] };
             console.warn("Gemini válasz hibás vagy üres, default struktúra használva.");
        }

        // --- *** VÉGLEGES ADAT EGYESÍTÉS (v40) *** ---
        
        const finalData = { ...geminiData }; 
        const finalHomeStats = {
            ...(geminiData.stats?.home || {}),
            ...(apiSportsHomeSeasonStats || {}),
        };
        const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || geminiData.stats?.home?.gp || 1;
        finalHomeStats.GP = homeGP;
        finalHomeStats.gp = homeGP;
        finalHomeStats.gamesPlayed = homeGP;

        const finalAwayStats = {
            ...(geminiData.stats?.away || {}),
            ...(apiSportsAwaySeasonStats || {}),
        };
        const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || geminiData.stats?.away?.gp || 1;
        finalAwayStats.GP = awayGP;
        finalAwayStats.gp = awayGP;
        finalAwayStats.gamesPlayed = awayGP;

        finalData.stats = {
            home: finalHomeStats,
            away: finalAwayStats
        };
        console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);

        finalData.apiFootballData = { // A név marad 'apiFootballData' a kompatibilitás miatt
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: null, 
            liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        };
        finalData.sportsDbData = finalData.apiFootballData; 
        finalData.h2h_structured = apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";

        const homeForm = apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || "N/A";
        const awayForm = apiSportsAwaySeasonStats?.form || geminiData?.form?.away_overall || "N/A";
        finalData.form = { 
            home_overall: homeForm, 
            away_overall: awayForm, 
            home_home: geminiData?.form?.home_home || "N/A", 
            away_away: geminiData?.form?.away_away || "N/A" 
        };
        
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, decodedUtcKickoff);
        if (!finalData.contextual_factors) finalData.contextual_factors = {};
        finalData.contextual_factors.structured_weather = structuredWeather;
        
        const richContextParts = [
             finalData.h2h_summary && finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
             finalData.contextual_factors.match_tension_index && finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
             (finalData.team_news?.home && finalData.team_news.home !== "N/A") || (finalData.team_news?.away && finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news?.home||'-'}, V:${finalData.team_news?.away||'-'}`,
             (finalData.absentees?.home?.length > 0 || finalData.absentees?.away?.length > 0) && `- Hiányzók: H:${finalData.absentees?.home?.map(p=>p?.name).join(', ')||'-'}, V:${finalData.absentees?.away?.map(p=>p?.name).join(', ')||'-'}`,
             finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             (finalData.form?.home_overall && finalData.form.home_overall !== "N/A") || (finalData.form?.away_overall && finalData.form.away_overall !== "N/A") && `- Forma: H:${finalData.form?.home_overall||'N/A'}, V:${finalData.form?.away_overall||'N/A'}`,
             (finalData.tactics?.home?.style && finalData.tactics.home.style !== "N/A") || (finalData.tactics?.away?.style && finalData.tactics.away.style !== "N/A") && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`,
             structuredWeather && structuredWeather.description !== "N/A" ? `- Időjárás: ${structuredWeather.description}, ${structuredWeather.temperature_celsius ?? '?'}°C` : `- Időjárás: N/A`,
             finalData.contextual_factors?.pitch_condition && finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";

        const result = {
             rawStats: finalData.stats,
             leagueAverages: finalData.league_averages || {},
             richContext,
             advancedData: finalData.advancedData || { home: { xg: null }, away: { xg: null } },
             form: finalData.form,
             rawData: finalData,
             oddsData: fetchedOddsData, 
             fromCache: false
        };

        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
        }
        
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v40), cache mentve (${ck}).`);
        return result;

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v40) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v40): ${e.message}`);
    }
}

// --- ESPN MECCSLEKÉRDEZÉS ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues) return [];
    
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) return [];
    
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    
    for (const dateString of datesToFetch) {
        for (const [leagueName, leagueData] of Object.entries(sportConfig.espn_leagues)) {
            const slug = leagueData.slug;
            if (!slug) {
                console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`);
                continue;
            }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => {
                        const competition = event.competitions?.[0];
                        if (!competition) return null;
                        const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                        const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        if (event.id && homeTeam?.name && awayTeam?.name && event.date) {
                            return {
                                id: String(event.id),
                                home: homeTeam.name.trim(),
                                away: awayTeam.name.trim(),
                                utcKickoff: event.date,
                                league: leagueName.trim()
                            };
                        }
                        return null;
                    }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400) {
                    console.warn(`ESPN Hiba (400): Valószínűleg rossz slug '${slug}' (${leagueName})?`);
                } else {
                    console.error(`ESPN Hiba (${leagueName}): ${error.message}`);
                }
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    try {
        const results = await Promise.all(promises);
        const uniqueFixtures = Array.from(new Map(results.flat().map(f => [`${f.home}-${f.away}-${f.utcKickoff}`, f])).values());
        uniqueFixtures.sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
        console.log(`ESPN: ${uniqueFixtures.length} egyedi meccs lekérve a következő ${daysInt} napra.`);
        return uniqueFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}

// --- PROMPT (v40 - Általánosítva) ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiSportsHomeSeasonStats, apiSportsAwaySeasonStats, apiSportsH2HData, apiSportsLineups) {
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Sports season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats.\n";
    if (apiSportsHomeSeasonStats || apiSportsAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats have been PRE-CALCULATED from API-Sports.
Use these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
        if (apiSportsHomeSeasonStats) {
            calculatedStatsInfo += `Home Calculated (GP=${apiSportsHomeSeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsHomeSeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Home Calculated: N/A\n`; }
        if (apiSportsAwaySeasonStats) {
            calculatedStatsInfo += `Away Calculated (GP=${apiSportsAwaySeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsAwaySeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Away Calculated: N/A\n`; }
    }
    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-Sports. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiSportsH2HData && Array.isArray(apiSportsH2HData) && apiSportsH2HData.length > 0) {
        const h2hString = apiSportsH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-Sports, Last ${apiSportsH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields.
Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiSportsH2HData)}\n`;
    }
    let lineupInfo = "NOTE ON LINEUPS: No API-Sports lineup data available (this is normal if the match is far away). Analyze absentees and formation based on your general knowledge and recent news.\n";
    if (apiSportsLineups && apiSportsLineups.length > 0) {
        const relevantLineupData = apiSportsLineups.map(t => ({
             team: t.team?.name,
             formation: t.formation,
             startXI: t.startXI?.map(p => p.player?.name),
             substitutes: t.substitutes?.map(p => p.player?.name)
        }));
        lineupInfo = `CRITICAL LINEUP DATA (from API-Sports): ${JSON.stringify(relevantLineupData)}\nUse THIS data *first* to determine absentees, key players, and formation.
This is more reliable than general knowledge.\n`;
    }
    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.
**CRITICAL: You MUST use the latest factual data provided below (API-Sports) over your general knowledge.**
${calculatedStatsInfo}
${h2hInfo}
${lineupInfo}
AVAILABLE FACTUAL DATA (From API-Sports):
- Home Season Stats: ${JSON.stringify(apiSportsHomeSeasonStats || 'N/A')}
- Away Season Stats: ${JSON.stringify(apiSportsAwaySeasonStats || 'N/A')}
- Recent H2H: ${h2hInfo.substring(0, 500)}... (See full data above if provided)
- Lineups: ${lineupInfo.substring(0, 500)}... (See full data above if provided)

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga (vagy points).
**USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-Sports H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis.
**(CRITICAL: Use the API-Sports LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall).
**(CRITICAL: Use the 'Form' string from the API-Sports Season Stats provided above.)** Provide home_home and away_away based on general knowledge if season stats are limited.
5. Key Players: name, role, recent key stat. **(Use API-Sports LINEUP data to see who is STARTING).**
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation.
**(CRITICAL: Infer formation from the 'formation' field in the API-Sports LINEUP data. If N/A, use your knowledge but state it's an estimate).**
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }.
  9. Key Matchups: Identify 1-2 key positional or player battles.
IF hockey:
  7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }.
IF basketball:
  7. Advanced Styles: Shot Distribution { home: "...", away: "..." }, Defensive Style { home: "...", away: "..." }.
OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately.
STRUCTURE: {
  "stats":{ "home":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> }, "away":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> } },
  "h2h_summary":"...",
  "h2h_structured":[...],
  "team_news":{ "home":"...", "away":"..." },
  "absentees":{ "home":[{name, importance, role}], "away":[] },
  "absentee_impact_analysis":"...",
  "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." },
  "key_players":{ "home":[{name, role, stat}], "away":[] },
  "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } },
  "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} },
  "tactical_patterns":{ "home":[], "away":[] },
  "key_matchups":{ "description":"..." },
  "advanced_stats_team":{ "home":{...}, "away":{...} },
  "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} },
  "shot_distribution":{ "home":"...", "away":"..." },
  "defensive_style":{ "home":"...", "away":"..." }, 
  "league_averages": { /* Optional: avg_goals_per_game, etc. */ }
}`;
}

// --- ODDS API FUNKCIÓK (v26 - JAVÍTOTT URL-lel ÉS LOGIKÁVAL) ---
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    if (!RAPIDAPI_KEY || !RAPIDAPI_ODDS_HOST) {
        console.warn(`Odds API (RapidAPI): Hiányzó kulcs/host. Odds lekérés kihagyva.`);
        return null;
    }

    const rapidApiHeaders = {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_ODDS_HOST
    };

    let eventId = null;
    let apiHomeTeam = null;
    let apiAwayTeam = null;

    // A `/api/v1/events` végpont nem fogad el dátum paramétereket, ezért eltávolítjuk őket.
    const eventsUrl = `https://${RAPIDAPI_ODDS_HOST}/api/v1/events`;
    console.log(`Odds API (RapidAPI v26): Események listájának lekérése... URL: ${eventsUrl}`);
    try {
        const eventsResponse = await makeRequest(eventsUrl, { headers: rapidApiHeaders, timeout: 15000 });
        const events = eventsResponse?.data?.data;
        
        if (!events || !Array.isArray(events)) {
            console.warn(`Odds API (RapidAPI v26): Érvénytelen/üres válasz az /events végpontról. Státusz: ${eventsResponse?.status}`);
            return null;
        }

        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.60; // Enyhített küszöb

        for (const event of events) {
            const currentApiHome = event?.home;
            const currentApiAway = event?.away;
            const currentEventId = event?.id;
            if (!currentApiHome || !currentApiAway || !currentEventId) continue;
            const apiHomeLower = currentApiHome.toLowerCase().trim();
            const apiAwayLower = currentApiAway.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            if (homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue; // Még enyhébb egyoldali küszöb
            const combinedSim = (homeMatchResult.bestMatch.rating + awayMatchResult.bestMatch.rating) / 2;
            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = event;
            }
        }

        if (!bestMatch) {
            console.warn(`Odds API (RapidAPI v26): Nem található esemény egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam} a listában.`);
            return null;
        }

        eventId = bestMatch.id;
        apiHomeTeam = bestMatch.home;
        apiAwayTeam = bestMatch.away;
        console.log(`Odds API (RapidAPI v26): Esemény találat ${apiHomeTeam} vs ${apiAwayTeam} (ID: ${eventId}). Hasonlóság: ${(highestCombinedRating*100).toFixed(1)}%`);
    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI v26 /events keresés) során: ${e.message}`, e.stack);
        if (e.response?.status === 429) {
             console.error("Odds API (RapidAPI v26): Rate limit túllépve az /events hívásnál! Fontold meg a fizetős csomagot.");
        }
        return null;
    }

    if (!eventId) return null;

    const marketsUrl = `https://${RAPIDAPI_ODDS_HOST}/api/v1/events/markets?event_id=${eventId}`;
    console.log(`Odds API (RapidAPI v26): Piacok lekérése... URL: ${marketsUrl}`);
    try {
        const marketsResponse = await makeRequest(marketsUrl, { headers: rapidApiHeaders, timeout: 15000 });
        const marketsData = marketsResponse?.data?.data;

        if (!marketsData || !Array.isArray(marketsData)) {
            console.warn(`Odds API (RapidAPI v26): Nem található piac ehhez az eseményhez: ${eventId}. Státusz: ${marketsResponse?.status}`);
            return null;
        }

        const currentOdds = [];
        const allMarkets = marketsData;

        const h2hMarket = marketsData.find(m => m.market_name === '1X2');
        const h2hBook = h2hMarket?.market_books?.[0];
        
        if (h2hBook) {
            if (h2hBook.outcome_0 > 1) currentOdds.push({ name: 'Hazai győzelem', price: h2hBook.outcome_0 });
            if (h2hBook.outcome_1 > 1) currentOdds.push({ name: 'Döntetlen', price: h2hBook.outcome_1 });
            if (h2hBook.outcome_2 > 1) currentOdds.push({ name: 'Vendég győzelem', price: h2hBook.outcome_2 });
            console.log(`Odds API (RapidAPI v26): H2H oddsok (${h2hBook.book}): H:${h2hBook.outcome_0}, D:${h2hBook.outcome_1}, A:${h2hBook.outcome_2}`);
        } else { console.warn(`Odds API (RapidAPI v26): Nincs H2H ('1X2') piac: ${eventId}`); }

        const mainLine = sportConfig.totals_line ?? 2.5;
        console.log(`Odds API (RapidAPI v26): Fő Totals vonal keresése: ${mainLine}`);
        
        const totalsMarket = marketsData.find(m => m.market_name === 'Goals Over/Under' && m.value === mainLine);
        const totalsBook = totalsMarket?.market_books?.[0];
        
        if (totalsBook) {
            if (totalsBook.outcome_0 > 1) currentOdds.push({ name: `Over ${mainLine}`, price: totalsBook.outcome_0 });
            if (totalsBook.outcome_1 > 1) currentOdds.push({ name: `Under ${mainLine}`, price: totalsBook.outcome_1 });
            console.log(`Odds API (RapidAPI v26): Totals (${mainLine}) oddsok (${totalsBook.book}): Over:${totalsBook.outcome_0}, Under:${totalsBook.outcome_1}`);
        } else { console.warn(`Odds API (RapidAPI v26): Nincs Totals ('Goals Over/Under') piac a ${mainLine} vonalhoz: ${eventId}`); }

        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;

    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI v26 /events/markets lekérés) során: ${e.message}`, e.stack);
        if (e.response?.status === 429) {
             console.error("Odds API (RapidAPI v26): Rate limit túllépve a /events/markets hívásnál!");
        }
        return null;
    }
}

// Odds cache-elő wrapper
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!RAPIDAPI_KEY) {
        console.warn("RapidAPI Odds API kulcs hiányzik, odds lekérés kihagyva.");
        return null;
    }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v26_rapidapi_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        console.log(`Odds cache találat: ${cacheKey}`);
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs odds cache: ${cacheKey}. Friss lekérés...`);
    
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);

    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        console.log(`Odds adatok sikeresen lekérve és cache-elve: ${cacheKey}`);
        return { ...liveOdds, fromCache: false };
    }
    if (liveOdds !== null) {
        console.warn(`Nem található releváns (H2H, Totals) odds piac (RapidAPI v26): ${homeTeam} vs ${awayTeam}`);
    } else {
        console.warn(`Nem sikerült élő szorzókat lekérni (RapidAPI v26): ${homeTeam} vs ${awayTeam}`);
    }
    return null;
}

// Névgenerátor segédfüggvény
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.|us)\s+/i, '').trim());
    if (lowerName === 'manchester united') variations.add('man united');
    if (lowerName === 'manchester city') variations.add('man city');
    if (lowerName === 'tottenham hotspur') variations.add('tottenham');
    if (lowerName === 'vegas golden knights') variations.add('golden knights');
    return Array.from(variations).filter(name => name && name.length > 2);
}

// Fő totals vonal kereső
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.market_name === 'Goals Over/Under');

    if (!totalsMarket?.market_books?.[0]) {
        console.warn("findMainTotalsLine: Nem található érvényes Totals outcome struktúra.");
        return defaultLine;
    }
    
    const linesAvailable = [...new Set(oddsData.allMarkets
        .filter(m => m.market_name === 'Goals Over/Under')
        .map(m => m.value)
        .filter(v => typeof v === 'number' && !isNaN(v))
    )];
    
    if (linesAvailable.length === 0) {
        console.warn("findMainTotalsLine: Nem található numerikus Totals vonal a 'value' mezőben.");
        return defaultLine;
    }

    let closestPair = { diff: Infinity, line: defaultLine };
    for (const line of linesAvailable) {
        const marketForLine = oddsData.allMarkets.find(m => m.market_name === 'Goals Over/Under' && m.value === line);
        const book = marketForLine?.market_books?.[0];
        if (book) {
            const overPrice = book.outcome_0;
            const underPrice = book.outcome_1;
            if (overPrice > 1 && underPrice > 1) {
                const diff = Math.abs(overPrice - underPrice);
                if (diff < closestPair.diff) {
                    closestPair = { diff, line: line };
                }
            }
        }
    }

    if (closestPair.diff < 0.5) {
        console.log(`findMainTotalsLine: Legközelebbi odds pár ${closestPair.line} vonalnál (diff: ${closestPair.diff.toFixed(2)}).`);
        return closestPair.line;
    }

    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    linesAvailable.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    console.log(`findMainTotalsLine: Nincs egyértelmű fő vonal, a ${numericDefaultLine}-hez legközelebbi: ${linesAvailable[0]}.`);
    return linesAvailable[0];
}

// --- ESPN MECCSLEKÉRDEZÉS ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig (${sport}).`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) {
        console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`);
        return [];
    }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) {
                console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`);
                continue;
            }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events.filter(event => event?.status?.type?.state?.toLowerCase() === 'pre').map(event => {
                    const competition = event.competitions?.[0];
                    if (!competition) return null;
                    const homeTeamData = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                    const awayTeamData = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                    const homeName = homeTeamData ? String(homeTeamData.displayName || homeTeamData.shortDisplayName || homeTeamData.name || '').trim() : null;
                    const awayName = awayTeamData ? String(awayTeamData.displayName || awayTeamData.shortDisplayName || awayTeamData.name || '').trim() : null;
                    const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : null;
                    if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                        return {
                            id: String(event.id),
                            home: homeName,
                            away: awayName,
                            utcKickoff: event.date,
                            league: safeLeagueName
                        };
                    } else {
                        console.warn(`ESPN: Hiányos adat (${slug}, ${dateString}). ID: ${event?.id}, H: ${homeName}, A: ${awayName}, D: ${event?.date}`);
                        return null;
                    }
                }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400 || error.message.includes('404')) {
                    console.warn(`ESPN Hiba (40x): Slug '${slug}' (${leagueName})? URL: ${url}`);
                } else {
                    console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`);
                }
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => {
            const uniqueKey = `${f.home}-${f.away}-${f.utcKickoff}`;
            if (f?.home && f?.away && f?.utcKickoff && !uniqueFixturesMap.has(uniqueKey)) {
                uniqueFixturesMap.set(uniqueKey, f);
            }
        });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff);
            const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1;
            if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve a következő ${daysInt} napra.`);
        return finalFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}