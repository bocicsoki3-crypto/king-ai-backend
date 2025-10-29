// --- VÉGLEGES INTEGRÁLT (v33 - GP Fix & Odds Lister) datafetch.js ---
// - V33 JAVÍTÁS: A 'getRichContextualData' most már explicit NAGYBETŰS 'GP' kulcsot is generál a modellező motor számára.
// - V33 JAVÍTÁS: Az 'Odds API Debugger' most már nem keres, hanem listázza az első 15 futball eseményt, hogy lássuk, mit ad vissza az API.

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    APIFOOTBALL_KEY, APIFOOTBALL_HOST,
    ODDS_API_KEY, ODDS_API_HOST,
    ODDS_TEAM_NAME_MAP
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { fileURLToPath } from 'url';
import path from 'path';

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiFootballFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v33 (2025-10-29) - GP Fix és Odds Lister
* - STATISZTIKA JAVÍTÁS: Explicit 'GP' (nagybetűs) mező hozzáadása
* a 'finalData' objektumhoz a modellező kompatibilitása érdekében.
* - ODDS DEBUGGER: Az Odds API hívás most listázza a kapott eseményeket.
**************************************************************/

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

// --- API-FOOTBALL FUNKCIÓK ---
const APIFOOTBALL_HEADERS = { 'x-rapidapi-key': APIFOOTBALL_KEY, 'x-rapidapi-host': APIFOOTBALL_HOST };
const APIFOOTBALL_BASE_URL = `https://${APIFOOTBALL_HOST}`;

async function getApiFootballTeamId(teamName) {
    if (!APIFOOTBALL_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, csapat ID keresés kihagyva."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    const cacheKey = `apifootball_teamid_v2_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = apiFootballTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `${APIFOOTBALL_BASE_URL}/v3/teams?search=${encodeURIComponent(teamName)}`;
    const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS });
    if (response?.data?.response?.length > 0) {
        const teams = response.data.response;
        const teamNames = teams.map(t => t.team?.name);
        const matchResult = findBestMatch(teamName, teamNames);
        if (matchResult.bestMatch.rating > 0.6) {
            const teamId = teams[matchResult.bestMatchIndex].team.id;
            console.log(`API-FOOTBALL: ID találat "${teamName}" -> "${teams[matchResult.bestMatchIndex].team.name}" -> ${teamId}`);
            apiFootballTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }
    }
    console.warn(`API-FOOTBALL: Nem található csapat ID ehhez: "${teamName}".`);
    apiFootballTeamIdCache.set(cacheKey, 'not_found');
    return null;
}

async function getApiFootballLeagueId(leagueName, country, season) {
    if (!APIFOOTBALL_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, liga ID keresés kihagyva."); return null; }
    if (!leagueName || !country || !season) {
        console.warn(`API-FOOTBALL: Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const tryGetLeague = async (currentSeason) => {
        const cacheKey = `apifootball_leagueid_v30_${country.toLowerCase()}_${leagueName.toLowerCase().replace(/\s/g, '')}_${currentSeason}`;
        const cachedId = apiFootballLeagueIdCache.get(cacheKey);
        if (cachedId) return cachedId === 'not_found' ? null : cachedId;

        const url = `${APIFOOTBALL_BASE_URL}/v3/leagues`;
        const params = { name: leagueName, country: country, season: currentSeason };
        console.log(`API-FOOTBALL League Search: "${leagueName}" (${country}, ${currentSeason})...`);
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, params });
        if (response?.data?.response?.length > 0) {
            const perfectMatch = response.data.response.find(l => l.league.name.toLowerCase() === leagueName.toLowerCase());
            const league = perfectMatch || response.data.response[0];
            const leagueId = league.league.id;
            console.log(`API-FOOTBALL: Liga ID találat "${leagueName}" -> "${league.name}" -> ${leagueId}`);
            apiFootballLeagueIdCache.set(cacheKey, leagueId);
            return leagueId;
        }
        console.warn(`API-FOOTBALL: Nem található liga ID ehhez: "${leagueName}" (${country}, ${currentSeason}).`);
        apiFootballLeagueIdCache.set(cacheKey, 'not_found');
        return null;
    };

    let leagueId = await tryGetLeague(season);
    if (!leagueId) {
        console.warn(`API-Football: Nem található liga a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        leagueId = await tryGetLeague(season - 1);
    }
    return leagueId;
}

async function findApiFootballFixture(homeTeamId, awayTeamId, season, leagueId, utcKickoff) {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return { fixtureId: null, fixtureDate: null };
    const cacheKey = `apifootball_findfixture_v21_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiFootballFixtureCache.get(cacheKey);
    if (cached) return cached;
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const url = `${APIFOOTBALL_BASE_URL}/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    console.log(`API-Football Fixture Keresés (Pontos nap): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában...`);
    const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, params });
    if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find(f => f.teams?.away?.id === awayTeamId);
        if (foundFixture) {
            const result = { fixtureId: foundFixture.fixture.id, fixtureDate: foundFixture.fixture.date };
            console.log(`API-Football: MECCS TALÁLAT! FixtureID: ${result.fixtureId}`);
            apiFootballFixtureCache.set(cacheKey, result);
            return result;
        }
    }
    
    console.warn(`API-Football: Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz.`);
    apiFootballFixtureCache.set(cacheKey, { fixtureId: null, fixtureDate: null });
    return { fixtureId: null, fixtureDate: null };
}

async function getApiFootballH2H(homeTeamId, awayTeamId, limit = 5) {
    const url = `${APIFOOTBALL_BASE_URL}/v3/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, params });
    const fixtures = response?.data?.response;
    if (fixtures && Array.isArray(fixtures)) {
        return fixtures.map(fix => ({
            date: fix.fixture?.date?.split('T')[0] || 'N/A',
            competition: fix.league?.name || 'N/A',
            score: `${fix.goals?.home ?? '?'} - ${fix.goals?.away ?? '?'}`,
            home_team: fix.teams?.home?.name || 'N/A',
            away_team: fix.teams?.away?.name || 'N/A',
        })).slice(0, limit);
    }
    return null;
}

async function getApiFootballTeamSeasonStats(teamId, leagueId, season) {
    const tryGetStats = async (currentSeason) => {
        const cacheKey = `apifootball_seasonstats_v31_${teamId}_${leagueId}_${currentSeason}`;
        const cachedStats = apiFootballStatsCache.get(cacheKey);
        if (cachedStats) {
            console.log(`API-FOOTBALL Szezon Stat cache találat: T:${teamId}, L:${leagueId}, S:${currentSeason}`);
            return cachedStats;
        }

        console.log(`API-FOOTBALL Szezon Stat lekérés: T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
        const url = `${APIFOOTBALL_BASE_URL}/v3/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, params });
        const stats = response?.data?.response;
        if (stats && stats.league?.id && stats.fixtures?.played?.total > 0) {
            console.log(`API-FOOTBALL: Szezon statisztika sikeresen lekérve (${stats.league?.name}, ${currentSeason}).`);
            const simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };
            apiFootballStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        }
        return null;
    };
    
    let stats = await tryGetStats(season);
    if (!stats) {
        console.warn(`API-Football: Nem található statisztika a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        stats = await tryGetStats(season - 1);
    }

    if (!stats) {
        console.error(`API-Football: Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    
    return stats;
}


// --- ODDS API FUNKCIÓK ---
const ODDS_API_HEADERS = { 'x-rapidapi-key': ODDS_API_KEY, 'x-rapidapi-host': ODDS_API_HOST };

async function getOddsData(homeTeam, awayTeam) {
    if (!ODDS_API_KEY) { console.warn("Odds API kulcs hiányzik, odds lekérés kihagyva."); return null; }

    const url = `https://${ODDS_API_HOST}/api/v1/events`;
    console.log(`Odds API (RapidAPI v31): Teljes eseménylista lekérése... URL: ${url}`);
    const response = await makeRequest(url, { headers: ODDS_API_HEADERS });
    if (!response?.data?.data || response.data.data.length === 0) {
        console.warn(`Odds API (RapidAPI v31): Az API nem szolgáltatott eseményeket.`);
        return null;
    }

    const events = response.data.data;

    // --- *** V33 DEBUGGER KÓD KEZDETE (Javított) *** ---
    // Kiírja az első 15 futball eseményt, hogy lássuk, mit kapunk az API-tól.
    try {
        const footballEvents = events
            .filter(event => event.sport?.slug === 'football' && event.home && event.away)
            .map(event => `${event.home} vs ${event.away} (Liga: ${event.league?.name || 'N/A'})`);
        
        console.log(`[ODDS DEBUG v33] Az API-tól kapott első 15 futball esemény:`);
        if (footballEvents.length > 0) {
            console.log(footballEvents.slice(0, 15));
        } else {
            console.log("Nem található 'football' esemény a listában.");
        }
    } catch (e) {
        console.warn(`[ODDS DEBUG v33] Hiba a debug nevek gyűjtése során: ${e.message}`);
    }
    // --- *** V33 DEBUGGER KÓD VÉGE *** ---

    const homeVariations = generateTeamNameVariations(homeTeam);
    const awayVariations = generateTeamNameVariations(awayTeam);
    let bestMatch = null;
    let highestCombinedRating = 0.59; 

    for (const event of events) {
        if (!event.home || !event.away || event.sport?.slug !== 'football') continue;
        const homeMatchResult = findBestMatch(event.home, homeVariations);
        const awayMatchResult = findBestMatch(event.away, awayVariations);
        const combinedSim = (homeMatchResult.bestMatch.rating + awayMatchResult.bestMatch.rating) / 2;
        if (combinedSim >= highestCombinedRating) {
            highestCombinedRating = combinedSim;
            bestMatch = event;
        }
    }

    if (!bestMatch) {
        console.warn(`Odds API (RapidAPI v31): Nem található esemény egyezés (Legjobb: ${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam} a listában.`);
        return null;
    }

    const eventId = bestMatch.id;
    console.log(`Odds API (RapidAPI v31): Esemény találat ${bestMatch.home} vs ${bestMatch.away} (ID: ${eventId}). Hasonlóság: ${(highestCombinedRating*100).toFixed(1)}%`);

    const marketsUrl = `https://${ODDS_API_HOST}/api/v1/events/markets`;
    const marketsResponse = await makeRequest(marketsUrl, { headers: ODDS_API_HEADERS, params: { event_id: eventId } });
    if (!marketsResponse?.data?.data) return { current: [] };

    const marketsData = marketsResponse.data.data;
    const currentOdds = [];
    const h2hMarket = marketsData.find(m => m.market_name === '1X2');
    if (h2hMarket?.market_books?.[0]) {
        const book = h2hMarket.market_books[0];
        if (book.outcome_0 > 1) currentOdds.push({ name: 'Hazai győzelem', price: book.outcome_0 });
        if (book.outcome_1 > 1) currentOdds.push({ name: 'Döntetlen', price: book.outcome_1 });
        if (book.outcome_2 > 1) currentOdds.push({ name: 'Vendég győzelem', price: book.outcome_2 });
    }
    return { current: currentOdds, allMarkets: marketsData };
}

export async function getOptimizedOddsData(homeTeam, awayTeam, sport) {
    const key = `${homeTeam}${awayTeam}${sport}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v31_rapidapi_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        console.log(`Odds cache találat: ${cacheKey}`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs odds cache: ${cacheKey}. Friss lekérés...`);
    const liveOdds = await getOddsData(homeTeam, awayTeam);
    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        console.log(`Odds adatok sikeresen lekérve és cache-elve: ${cacheKey}`);
        return { ...liveOdds, fromCache: false };
    }
    return null;
}

function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.|us)\s+/i, '').trim());
    return Array.from(variations);
}

export function findMainTotalsLine(oddsData) {
    const defaultLine = 2.5;
    if (!oddsData || !oddsData.allMarkets) {
        return defaultLine;
    }
    const totalsMarket = oddsData.allMarkets.find(m => m.market_name === 'Goals Over/Under');
    if (!totalsMarket?.market_books?.[0]) {
        return defaultLine;
    }
    
    const linesAvailable = [...new Set(oddsData.allMarkets
        .filter(m => m.market_name === 'Goals Over/Under')
        .map(m => m.value)
        .filter(v => typeof v === 'number' && !isNaN(v))
    )];
    if (linesAvailable.length === 0) {
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
        return closestPair.line;
    }

    const numericDefaultLine = 2.5;
    linesAvailable.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return linesAvailable[0];
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v43_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport);
        if (oddsResult && !oddsResult.fromCache) {
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));
        const season = new Date(decodedUtcKickoff).getFullYear();
        if (isNaN(season)) throw new Error(`Érvénytelen utcKickoff: ${decodedUtcKickoff}`);
        
        console.log(`Adatgyűjtés indul (v31 - API-Football): ${homeTeamName} vs ${awayTeamName}...`);
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiFootballTeamId(homeTeamName),
            getApiFootballTeamId(awayTeamName),
        ]);
        if (!homeTeamId || !awayTeamId) throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`);
        
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig.espn_leagues[leagueName];
        if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
        
        const leagueId = await getApiFootballLeagueId(leagueName, leagueData.country, season);
        if (!leagueId) throw new Error(`Nem sikerült a 'leagueId' azonosítása.`);
        console.log(`API-Football: Végleges LeagueID: ${leagueId}`);
        
        const { fixtureId, fixtureDate } = await findApiFootballFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff);
        
        console.log(`API-Football: Adatok párhuzamos lekérése...`);
        const [
            fetchedOddsData,
            apiFootballH2HData,
            apiFootballHomeSeasonStats,
            apiFootballAwaySeasonStats
        ] = await Promise.all([
            getOptimizedOddsData(homeTeamName, awayTeamName, sport),
            getApiFootballH2H(homeTeamId, awayTeamId, 5),
            
            getApiFootballTeamSeasonStats(homeTeamId, leagueId, season),
            getApiFootballTeamSeasonStats(awayTeamId, leagueId, season)
        ]);
        console.log(`API-Football: Párhuzamos lekérések befejezve.`);
        
        const geminiJsonString = await _callGemini(PROMPT_V43(
             sport, homeTeamName, awayTeamName,
             apiFootballHomeSeasonStats, apiFootballAwaySeasonStats,
             apiFootballH2HData
        ));
        let geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};

        // --- *** KRITIKUS JAVÍTÁS KEZDETE (v33 - GP Fix) *** ---
        // Adatok összefésülése, explicit NAGYBETŰS 'GP' kulccsal.
        
        const finalHomeStats = {
            ...(geminiData.stats?.home || {}),
            ...(apiFootballHomeSeasonStats || {}),
        };
        // Explicit GP (nagybetűs) hozzáadása a modellező motor számára
        finalHomeStats.GP = apiFootballHomeSeasonStats?.gamesPlayed || geminiData.stats?.home?.gp || 1;

        const finalAwayStats = {
            ...(geminiData.stats?.away || {}),
            ...(apiFootballAwaySeasonStats || {}),
        };
        // Explicit GP (nagybetűs) hozzáadása a modellező motor számára
        finalAwayStats.GP = apiFootballAwaySeasonStats?.gamesPlayed || geminiData.stats?.away?.gp || 1;

        const finalData = {
            ...geminiData,
            apiFootballData: { homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate },
            h2h_structured: apiFootballH2HData || geminiData.h2h_structured,
            stats: {
                home: finalHomeStats,
                away: finalAwayStats
            }
        };
        // --- *** KRITIKUS JAVÍTÁS VÉGE (v33) *** ---

        const result = { rawData: finalData, oddsData: fetchedOddsData, fromCache: false };
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v31), cache mentve (${ck}).`);
        return result;

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v31) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v31): ${e.message}`);
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

// --- PROMPT ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiFootballHomeSeasonStats, apiFootballAwaySeasonStats, apiFootballH2HData) {
    return `Analyze the ${sport} match: "${homeTeamName}" vs "${awayTeamName}".
Provide a single, valid JSON object.
    Home Stats: ${JSON.stringify(apiFootballHomeSeasonStats)}
    Away Stats: ${JSON.stringify(apiFootballAwaySeasonStats)}
    H2H: ${JSON.stringify(apiFootballH2HData)}
    OUTPUT FORMAT: Strict JSON.`;
}
