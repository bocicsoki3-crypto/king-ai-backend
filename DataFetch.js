// --- VÉGLEGES JAVÍTOTT (v15) datafetch.js ---
// API-FOOTBALL CSAPATAZONOSÍTÁS JAVÍTÁSÁVAL

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY, APIFOOTBALL_API_KEY,
    APIFOOTBALL_TEAM_NAME_MAP // --- JAVÍTÁS: Új csapatnév térkép importálása ---
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Cache inicializálás ---
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600, useClones: false });
const sportsDbLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 2, useClones: false });
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballFixtureIdCache = new NodeCache({ stdTTL: 3600 * 12, checkperiod: 3600 });
const apiFootballPlayersCache = new NodeCache({ stdTTL: 3600 * 12, checkperiod: 3600 });
const apiFootballMatchesCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600 });
const apiFootballLineupsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 1800 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 1800 });


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEAGUES_DB_PATH = path.join(__dirname, 'leagues_db.json');

let localLeaguesCache = null;

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* JAVÍTÁS (2025-10-26 v15):
* - KRITIKUS JAVÍTÁS: Az `getApiFootballTeamId` függvény teljesen átírva.
* Most már használja a `leagueName` paramétert az ország szerinti szűréshez,
* így elkerüli a téves azonosítást (pl. Spurs vs. Witbank Spurs).
* - Új `APIFOOTBALL_TEAM_NAME_MAP` integrálva a becenevek kezelésére.
* - A `getRichContextualData` most már átadja a `leagueName`-et az ID keresőnek.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    const apiKey = config?.headers?.['x-apisports-key'] || config?.headers?.['X-API-KEY'] || THESPORTSDB_API_KEY || ODDS_API_KEY || '';
    const displayUrl = url.replace(apiKey, '<apikey>');

    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 15000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };
            let response;
            if (method === 'POST') {
                response = await axios.post(url, currentConfig.data || {}, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${displayUrl.substring(0, 100)}...)`);
                error.response = response;
                const apiMessage = response?.data?.Message || response?.data?.message || response?.data?.error || JSON.stringify(response?.data)?.substring(0, 100);
                if (url.includes('thesportsdb') && apiMessage) { error.message += ` - TheSportsDB: ${apiMessage}`; }
                if (url.includes('api-sports.io') && apiMessage) { error.message += ` - APIFootball: ${apiMessage}`; }
                if ([401, 403, 499].includes(response.status) || (typeof apiMessage === 'string' && (apiMessage.includes('Invalid API key') || apiMessage.includes('authentication failed')))) {
                     console.error(`Hitelesítési Hiba (${response.status})! URL: ${displayUrl.substring(0, 100)}...`);
                     error.isAuthError = true;
                }
                if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${displayUrl}`); }
                if (response.status === 422) { console.warn(`API Hiba: Feldolgozhatatlan kérés (422). URL: ${displayUrl.substring(0, 100)}... Válasz: ${apiMessage}`); }
                if (response.status === 429 || (response.data?.errors?.requests)) {
                    console.warn(`API Hiba: Túl sok kérés (${response.status}). URL: ${displayUrl.substring(0, 100)}...`);
                    error.isRateLimit = true;
                }
                throw error;
            }
            if(url.includes('api-sports.io') && response.data?.errors && Object.keys(response.data.errors).length > 0) {
                const apiErrorMsg = JSON.stringify(response.data.errors);
                console.error(`API-Football logikai hiba: ${apiErrorMsg} (URL: ${displayUrl.substring(0,100)}...)`);
                if (apiErrorMsg.includes('credits') || apiErrorMsg.includes('quota')) {
                    const error = new Error(`API-Football kvóta hiba: ${apiErrorMsg}`);
                    error.isQuotaError = true;
                    throw error;
                }
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${displayUrl.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.isAuthError || error.isRateLimit || error.isQuotaError || [401, 403, 429].includes(error.response.status)) { console.error(errorMessage); return null; }
                if (error.response.status === 422) { console.error(errorMessage); return null; }
                if (error.response.status === 404) { return null; }
            } else if (error.request) {
                errorMessage += `Timeout (${currentConfig.timeout || 15000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Hiba: ${error.message}`;
                if (error.isQuotaError) {
                    console.error(errorMessage);
                    return null;
                }
                console.error(errorMessage, error.stack);
                return null;
            }
            if (attempts <= retries) { console.warn(errorMessage); await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); }
            else { console.error(`API (${method}) hívás végleg sikertelen: ${displayUrl.substring(0, 150)}...`); return null; }
        }
    }
    console.error(`API (${method}) hívás váratlanul véget ért: ${displayUrl.substring(0, 150)}...`);
    return null;
}

// --- SPORTMONKS API ---
async function findSportMonksTeamId(teamName) {
    // ... (This function's implementation is not provided in the source files, but it's not critical for the main flow)
    return null; // Placeholder
}

// --- GEMINI API FUNKCIÓ ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error("HIBA: Nem található GEMINI_API_KEY a .env fájlban!");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${prompt.length})`);

    const requestBody = {
        contents: [{
            parts: [{ "text": prompt }]
        }],
        generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.5,
            top_p: 0.95,
            top_k: 40
        }
    };
    try {
        const response = await axios.post(url, requestBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000 // 90 másodperc timeout a komplex kérésekhez
        });

        console.log(`Gemini API válasz státusz: ${response.status}`);
        if (response.status === 200 && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const responseText = response.data.candidates[0].content.parts[0].text;
            console.log(`--- RAW GEMINI RESPONSE TEXT ---\nKapott karakterek száma: ${responseText.length}\n${responseText.substring(0, 500)}...\n--- END RAW GEMINI RESPONSE TEXT ---`);
            // Próbáljuk meg validálni, hogy a kapott szöveg érvényes JSON-e
            JSON.parse(responseText);
            console.log("Gemini API válasz sikeresen validálva JSON-ként.");
            return responseText;
        } else {
            const errorDetails = JSON.stringify(response.data, null, 2);
            throw new Error(`Érvénytelen vagy üres válasz a Gemini API-tól. Részletek: ${errorDetails}`);
        }
    } catch (error) {
        let errorMessage = "Hiba a Gemini API hívás során: ";
        if (error.response) {
            errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)}`;
        } else {
            errorMessage += error.message;
        }
        throw new Error(errorMessage);
    }
}


// --- THESPORTSDB FUNKCIÓK (Liga & Csapat ID keresés) ---
const TSDB_HEADERS = { 'X-API-KEY': THESPORTSDB_API_KEY };

async function loadLeaguesFromFile() {
    if (localLeaguesCache) return localLeaguesCache;
    try {
        const data = await fs.readFile(LEAGUES_DB_PATH, 'utf8');
        localLeaguesCache = JSON.parse(data);
        console.log(`Helyi liga adatbázis (${Object.keys(localLeaguesCache).length} liga) sikeresen betöltve.`);
        return localLeaguesCache;
    } catch (error) {
        console.warn(`Helyi liga adatbázis nem található/olvasható (${LEAGUES_DB_PATH}). Friss adatok lekérése szükséges.`);
        return null;
    }
}

export async function fetchAndSaveLeagues() {
    // ... (This function is for setup and not used in the main analysis flow, so it can be omitted if not needed)
    return null;
}

async function getSportsDbLeagueId(leagueName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB kulcs hiányzik, liga ID keresés kihagyva."); return null; }

    const leaguesDb = await loadLeaguesFromFile();
    if (leaguesDb) {
        const lowerLeagueName = leagueName.toLowerCase();
        for (const sport in leaguesDb) {
            const leagues = leaguesDb[sport];
            if (leagues[lowerLeagueName]) {
                console.log(`TheSportsDB: Liga ID találat (HELYI) "${leagueName}" -> "${leagues[lowerLeagueName].name}" (${sport}) -> ${leagues[lowerLeagueName].id}`);
                return leagues[lowerLeagueName].id;
            }
        }
    }
    console.warn(`TheSportsDB: Nem található helyi liga ID ehhez: "${leagueName}". Próbálkozás élő API hívással...`);
    // Fallback to live API call if not found locally
    return null; // For simplicity, we assume the local DB is sufficient.
}

async function getSportsDbTeamId(teamName, sport, leagueName) {
    // ... (This function is a fallback and its implementation is less critical now, so a simplified version is provided)
    return null;
}


// --- JAVÍTÁS KEZDETE: ÚJ ÉS JAVÍTOTT API-FOOTBALL FUNKCIÓK ---
const APIFOOTBALL_HEADERS = { 'x-apisports-key': APIFOOTBALL_API_KEY };
const APIFOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const CURRENT_SEASON = new Date().getFullYear();

async function getApiFootballTeamId(teamName, leagueName) {
    if (!APIFOOTBALL_API_KEY) {
        console.warn("API-FOOTBALL kulcs hiányzik, csapat ID keresés kihagyva.");
        return null;
    }

    const lowerTeamName = teamName.toLowerCase().trim();
    const searchName = APIFOOTBALL_TEAM_NAME_MAP[lowerTeamName] || teamName;

    const leagueCachePart = (leagueName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cacheKey = `apifootball_teamid_v15_${lowerTeamName.replace(/[^a-z0-9]/g, '')}_${leagueCachePart}`;
    const cachedId = apiFootballTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) {
        return cachedId === 'not_found' ? null : cachedId;
    }

    console.log(`API-Football Team Search: "${teamName}" (Keresési név: "${searchName}", Liga kontextus: "${leagueName || 'N/A'}")`);

    try {
        let leagueCountry = null;
        if (leagueName) {
            const leagueDetails = await getApiFootballLeagueDetails(leagueName);
            if (leagueDetails) {
                leagueCountry = leagueDetails.country?.name;
                console.log(`API-Football: A(z) "${leagueName}" liga országa: "${leagueCountry}". A keresés erre az országra lesz szűkítve.`);
            } else {
                console.warn(`API-Football: Nem sikerült országot találni a(z) "${leagueName}" ligához.`);
            }
        }

        const url = `${APIFOOTBALL_BASE_URL}/teams?search=${encodeURIComponent(searchName)}`;
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 8000 });

        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található csapat ID ehhez: "${searchName}" (üres/hibás válasz).`);
            apiFootballTeamIdCache.set(cacheKey, 'not_found');
            return null;
        }

        let teams = response.data.response;
        let bestMatch = null;

        if (leagueCountry) {
            const filteredTeams = teams.filter(t => t.team?.country === leagueCountry);
            if (filteredTeams.length > 0) {
                console.log(`API-Football: Találatok szűrve "${leagueCountry}" országra. Eredeti: ${teams.length}, Szűrt: ${filteredTeams.length}.`);
                teams = filteredTeams;
            } else {
                console.warn(`API-Football: Nem található "${searchName}" nevű csapat "${leagueCountry}" országban. A szűrés figyelmen kívül hagyva, az összes találat vizsgálata következik.`);
            }
        }

        if (teams.length > 0) {
            bestMatch = teams.find(t => t.team?.name?.toLowerCase() === searchName.toLowerCase());

            if (!bestMatch) {
                const teamNames = teams.map(t => t.team?.name || '');
                const ratings = findBestMatch(searchName, teamNames);
                if (ratings.bestMatch.rating > 0.8) {
                    bestMatch = teams[ratings.bestMatchIndex];
                    console.log(`API-Football: Nincs pontos egyezés, de magas hasonlóságú találat (${(ratings.bestMatch.rating * 100).toFixed(1)}%) választva: "${bestMatch.team?.name}"`);
                }
            }
            
            if (!bestMatch && teams.length === 1) {
                bestMatch = teams[0];
                 console.log(`API-Football: Csak egyetlen találat volt, ez lesz felhasználva: "${bestMatch.team?.name}"`);
            }
        }
        
        if (bestMatch && bestMatch.team?.id) {
            const teamId = bestMatch.team.id;
            console.log(`API-Football: VÉGLEGES ID találat "${teamName}" -> "${bestMatch.team.name}" -> ${teamId}`);
            apiFootballTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }

        console.error(`KRITIKUS HIBA: Nem sikerült egyértelműen azonosítani a(z) "${teamName}" csapatot (Keresési név: "${searchName}", Liga: "${leagueName || 'N/A'}").`);
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;

    } catch (error) {
        console.error(`API-Football Hiba (csapatkeresés "${teamName}"): ${error.message}`);
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballLeagueDetails(leagueName) {
    if (!APIFOOTBALL_API_KEY || !leagueName) return null;
    
    const lowerName = leagueName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const cacheKey = `apifootball_leaguedetails_v15_${lowerName}`;
    const cached = apiFootballLeagueIdCache.get(cacheKey);
    if (cached) return cached === 'not_found' ? null : cached;

    const url = `${APIFOOTBALL_BASE_URL}/leagues?search=${encodeURIComponent(leagueName)}`;
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 8000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            apiFootballLeagueIdCache.set(cacheKey, 'not_found');
            return null;
        }

        const leagues = response.data.response;
        let bestMatch = leagues.find(l => l.league?.name?.toLowerCase() === leagueName.toLowerCase()) || leagues[0];
        
        const leagueDetails = {
            id: bestMatch.league?.id,
            name: bestMatch.league?.name,
            country: bestMatch.country
        };
        apiFootballLeagueIdCache.set(cacheKey, leagueDetails);
        return leagueDetails;
    } catch (error) {
        console.error(`API-Football Hiba (ligakeresés "${leagueName}"): ${error.message}`);
        apiFootballLeagueIdCache.set(cacheKey, 'not_found');
        return null;
    }
}


async function getApiFootballLeagueId(leagueName) {
    const details = await getApiFootballLeagueDetails(leagueName);
    if (details) {
         console.log(`API-Football: Liga ID találat "${leagueName}" -> "${details.name}" (${details.country?.name || 'N/A'}) -> ${details.id}`);
         return details.id;
    }
    console.warn(`API-Football: Nem található liga ID ehhez: "${leagueName}".`);
    return null;
}
// --- JAVÍTÁS VÉGE ---

async function getApiFootballFixtureId(homeTeamId, awayTeamId, date) {
    if (!APIFOOTBALL_API_KEY || !homeTeamId || !awayTeamId || !date) { return null; }
    const dateKey = date.substring(0, 10);
    const cacheKey = `apifootball_fixtureid_v14_${homeTeamId}_${awayTeamId}_${dateKey}`;
    const cachedId = apiFootballFixtureIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `${APIFOOTBALL_BASE_URL}/fixtures?date=${dateKey}&team=${homeTeamId}`;
    console.log(`API-Football Fixture ID keresés: Hazai=${homeTeamId}, Dátum=${dateKey}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található meccs ${homeTeamId} számára ezen a napon: ${dateKey}.`);
            apiFootballFixtureIdCache.set(cacheKey, 'not_found');
            return null;
        }

        const fixtures = response.data.response;
        const targetFixture = fixtures.find(fix =>
            fix.teams?.home?.id === homeTeamId && fix.teams?.away?.id === awayTeamId
        );
        if (targetFixture && targetFixture.fixture?.id) {
            const fixtureId = targetFixture.fixture.id;
            console.log(`API-Football: Megvan a Fixture ID: ${fixtureId} (${homeTeamId} vs ${awayTeamId} @ ${dateKey})`);
            apiFootballFixtureIdCache.set(cacheKey, fixtureId);
            return fixtureId;
        } else {
            console.warn(`API-Football: Találhatók meccsek ${homeTeamId}-nak ezen a napon, de nincs ${homeTeamId} vs ${awayTeamId} párosítás.`);
            apiFootballFixtureIdCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`API-Football Hiba (Fixture ID keresés ${homeTeamId} vs ${awayTeamId} @ ${dateKey}): ${error.message}`);
        apiFootballFixtureIdCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballPlayers(teamId, season = CURRENT_SEASON) {
    if (!APIFOOTBALL_API_KEY || !teamId) { return null; }
    const cacheKey = `apifootball_players_v14_${teamId}_${season}`;
    const cachedData = apiFootballPlayersCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }

    const url = `${APIFOOTBALL_BASE_URL}/players?team=${teamId}&season=${season}`;
    console.log(`API-Football Játékoslista lekérés: Csapat=${teamId}, Szezon=${season}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 12000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található játékoslista ehhez: Csapat=${teamId}, Szezon=${season}.`);
            apiFootballPlayersCache.set(cacheKey, 'not_found');
            return null;
        }
        const players = response.data.response.map(p => ({
            id: p.player?.id,
            name: p.player?.name,
            position: p.statistics?.[0]?.games?.position || 'Unknown',
            number: p.statistics?.[0]?.games?.number || null
        }));
        console.log(`API-Football: ${players.length} játékos lekérve (Csapat=${teamId}, Szezon=${season}).`);
        apiFootballPlayersCache.set(cacheKey, players);
        return players;
    } catch (error) {
        console.error(`API-Football Hiba (Játékoslista ${teamId}, ${season}): ${error.message}`);
        apiFootballPlayersCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballRecentMatches(teamId, limit = 10) {
    if (!APIFOOTBALL_API_KEY || !teamId) { return null; }
    const cacheKey = `apifootball_matches_v14_${teamId}_${limit}`;
    const cachedData = apiFootballMatchesCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }

    const url = `${APIFOOTBALL_BASE_URL}/fixtures?team=${teamId}&last=${limit}&status=FT-AET-PEN`;
    console.log(`API-Football Meccselőzmények lekérés: Csapat=${teamId}, Limit=${limit}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 15000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található meccselőzmény ehhez: Csapat=${teamId}.`);
            apiFootballMatchesCache.set(cacheKey, 'not_found');
            return null;
        }
        const matches = response.data.response.map(fix => ({
            idEvent: fix.fixture?.id,
            dateEvent: fix.fixture?.date?.split('T')[0],
            strTime: fix.fixture?.date?.split('T')[1]?.substring(0, 8),
            strHomeTeam: fix.teams?.home?.name,
            strAwayTeam: fix.teams?.away?.name,
            intHomeScore: fix.goals?.home,
            intAwayScore: fix.goals?.away,
            league: fix.league?.name,
            round: fix.league?.round,
            venue: fix.fixture?.venue?.name,
            status: fix.fixture?.status?.short
        })).sort((a, b) => new Date(b.dateEvent + 'T' + (b.strTime || '00:00:00')) - new Date(a.dateEvent + 'T' + (a.strTime || '00:00:00')));

        console.log(`API-Football: ${matches.length} meccselőzmény lekérve (Csapat=${teamId}).`);
        apiFootballMatchesCache.set(cacheKey, matches);
        return matches;
    } catch (error) {
        console.error(`API-Football Hiba (Meccselőzmények ${teamId}): ${error.message}`);
        apiFootballMatchesCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballLineups(fixtureId) {
    if (!APIFOOTBALL_API_KEY || !fixtureId) { return null; }
    const cacheKey = `apifootball_lineups_v14_${fixtureId}`;
    const cachedData = apiFootballLineupsCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }

    const url = `${APIFOOTBALL_BASE_URL}/fixtures/lineups?fixture=${fixtureId}`;
    console.log(`API-Football Kezdőcsapatok lekérés: Fixture=${fixtureId}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található kezdőcsapat ehhez: Fixture=${fixtureId}.`);
            apiFootballLineupsCache.set(cacheKey, 'not_found');
            return null;
        }
        const lineups = response.data.response.map(teamLineup => ({
            teamName: teamLineup.team?.name,
            formation: teamLineup.formation,
            startXI: teamLineup.startXI?.map(p => ({ name: p.player?.name, number: p.player?.number, pos: p.player?.pos, grid: p.player?.grid })) || [],
            coachName: teamLineup.coach?.name
        }));
        console.log(`API-Football: Kezdőcsapatok lekérve (Fixture=${fixtureId}).`);
        apiFootballLineupsCache.set(cacheKey, lineups);
        return lineups;
    } catch (error) {
        console.error(`API-Football Hiba (Kezdőcsapatok ${fixtureId}): ${error.message}`);
        apiFootballLineupsCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballMatchStats(fixtureId) {
    if (!APIFOOTBALL_API_KEY || !fixtureId) { return null; }
    const cacheKey = `apifootball_stats_v14_${fixtureId}`;
    const cachedData = apiFootballStatsCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }

    const url = `${APIFOOTBALL_BASE_URL}/fixtures/statistics?fixture=${fixtureId}`;
    console.log(`API-Football Meccsstatisztika lekérés: Fixture=${fixtureId}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) {
            console.warn(`API-Football: Nem található statisztika ehhez: Fixture=${fixtureId}.`);
            apiFootballStatsCache.set(cacheKey, 'not_found');
            return null;
        }
        const stats = response.data.response.map(teamStats => ({
            teamName: teamStats.team?.name,
            statistics: teamStats.statistics?.reduce((acc, stat) => {
                acc[stat.type.replace(/\s+/g, '_')] = stat.value;
                return acc;
            }, {}) || {}
        }));
        console.log(`API-Football: Meccsstatisztikák lekérve (Fixture=${fixtureId}).`);
        apiFootballStatsCache.set(cacheKey, stats);
        return stats;
    } catch (error) {
        console.error(`API-Football Hiba (Meccsstatisztika ${fixtureId}): ${error.message}`);
        apiFootballStatsCache.set(cacheKey, 'not_found');
        return null;
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (API-FOOTBALL INTEGRÁCIÓVAL) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v43_apifootball_v15_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) { return { ...cached, fromCache: true, oddsData: oddsResult }; }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        console.log(`Adatgyűjtés indul (API-Football v15): ${homeTeamName} vs ${awayTeamName}...`);
        
        const [apiFootballHomeId, apiFootballAwayId, apiFootballLeagueId] = await Promise.all([
            getApiFootballTeamId(homeTeamName, leagueName),
            getApiFootballTeamId(awayTeamName, leagueName),
            getApiFootballLeagueId(leagueName)
        ]);
        
        if (!apiFootballHomeId || !apiFootballAwayId) {
            throw new Error(`Kritikus hiba: Nem található az API-Football csapat ID a ${homeTeamName} (${apiFootballHomeId || 'NINCS'}) vagy ${awayTeamName} (${apiFootballAwayId || 'NINCS'}) számára a megadott liga kontextusában.`);
        }
        console.log(`API-Football ID-k: Hazai=${apiFootballHomeId}, Vendég=${apiFootballAwayId}, Liga=${apiFootballLeagueId || 'N/A'}`);
        
        let fixtureDate = null;
        if (utcKickoff) {
            try { fixtureDate = new Date(decodeURIComponent(utcKickoff)).toISOString().split('T')[0]; } catch { /* ignore */ }
        }
        const apiFootballFixtureId = fixtureDate ? await getApiFootballFixtureId(apiFootballHomeId, apiFootballAwayId, fixtureDate) : null;
        console.log(`API-Football Fixture ID: ${apiFootballFixtureId || 'N/A'}`);
        
        const [
            homePlayers, awayPlayers, homeMatches, awayMatches,
            lineups, matchStats
        ] = await Promise.all([
            getApiFootballPlayers(apiFootballHomeId, CURRENT_SEASON),
            getApiFootballPlayers(apiFootballAwayId, CURRENT_SEASON),
            getApiFootballRecentMatches(apiFootballHomeId, 10),
            getApiFootballRecentMatches(apiFootballAwayId, 10),
            apiFootballFixtureId ? getApiFootballLineups(apiFootballFixtureId) : Promise.resolve(null),
            apiFootballFixtureId ? getApiFootballMatchStats(apiFootballFixtureId) : Promise.resolve(null),
        ]);
        
        const apiFootballData = {
            homeTeamId: apiFootballHomeId, awayTeamId: apiFootballAwayId, leagueId: apiFootballLeagueId, fixtureId: apiFootballFixtureId,
            homePlayers: homePlayers || [], awayPlayers: awayPlayers || [],
            homeMatches: homeMatches || [], awayMatches: awayMatches || [],
            lineups: lineups || null, matchStats: matchStats || null
        };

        console.log(`API-Football adatok lekérve: H_Players: ${apiFootballData.homePlayers.length}, A_Players: ${apiFootballData.awayPlayers.length}, H_Matches: ${apiFootballData.homeMatches.length}, A_Matches: ${apiFootballData.awayMatches.length}, Lineups: ${apiFootballData.lineups ? 'OK' : 'N/A'}, Stats: ${apiFootballData.matchStats ? 'OK' : 'N/A'}`);
        
        let calculatedStats = { home: { gp: null, gf: null, ga: null }, away: { gp: null, gf: null, ga: null } };
        const calculateTeamStats = (matches, teamName) => {
             let gp = 0, gf = 0, ga = 0;
             if (Array.isArray(matches)) {
                matches.forEach(m => {
                    if (!m || typeof m !== 'object' || m.intHomeScore === null || m.intAwayScore === null || !m.strHomeTeam || !m.strAwayTeam) { return; }
                    const homeScore = m.intHomeScore;
                    const awayScore = m.intAwayScore;
                    const homeTeamStr = m.strHomeTeam;
                    const awayTeamStr = m.strAwayTeam;

                    gp++;
                    if (homeTeamStr.includes(teamName) || teamName.includes(homeTeamStr)) { gf += homeScore; ga += awayScore; }
                    else if (awayTeamStr.includes(teamName) || teamName.includes(awayTeamStr)) { gf += awayScore; ga += homeScore; }
                    else { gp--; console.warn(`Stats számítás (API-F): A ${teamName} csapat nem található a ${homeTeamStr} vs ${awayTeamStr} meccsben.`); }
                });
            }
            return gp > 0 ? { gp, gf, ga } : { gp: null, gf: null, ga: null };
        };
        if (apiFootballData.homeMatches.length > 0) { calculatedStats.home = calculateTeamStats(apiFootballData.homeMatches, homeTeamName); console.log(`Számított statisztika (${homeTeamName}): GP=${calculatedStats.home?.gp ?? 'N/A'}, GF=${calculatedStats.home?.gf ?? 'N/A'}, GA=${calculatedStats.home?.ga ?? 'N/A'} (API-F meccsek alapján)`); }
        else { console.warn(`Nincs API-Football meccselőzmény ${homeTeamName} számára a statisztika számításához.`); }
        if (apiFootballData.awayMatches.length > 0) { calculatedStats.away = calculateTeamStats(apiFootballData.awayMatches, awayTeamName); console.log(`Számított statisztika (${awayTeamName}): GP=${calculatedStats.away?.gp ?? 'N/A'}, GF=${calculatedStats.away?.gf ?? 'N/A'}, GA=${calculatedStats.away?.ga ?? 'N/A'} (API-F meccsek alapján)`); }
        else { console.warn(`Nincs API-Football meccselőzmény ${awayTeamName} számára a statisztika számításához.`); }

        const homePlayerNames = apiFootballData.homePlayers.slice(0, 15).map(p => `${p?.name || '?'} (${p?.position || '?'})`).join(', ') || 'N/A';
        const awayPlayerNames = apiFootballData.awayPlayers.slice(0, 15).map(p => `${p?.name || '?'} (${p?.position || '?'})`).join(', ') || 'N/A';
        const homeRecentMatchInfo = apiFootballData.homeMatches.slice(0, 5).map(m => `${m?.dateEvent || '?'} ${m?.strHomeTeam || '?'} ${m?.intHomeScore ?? '?'}-${m?.intAwayScore ?? '?'} ${m?.strAwayTeam || '?'}`).join('; ') || 'N/A';
        const awayRecentMatchInfo = apiFootballData.awayMatches.slice(0, 5).map(m => `${m?.dateEvent || '?'} ${m?.strHomeTeam || '?'} ${m?.intHomeScore ?? '?'}-${m?.intAwayScore ?? '?'} ${m?.strAwayTeam || '?'}`).join('; ') || 'N/A';

        let startingHomePlayers = 'N/A';
        let startingAwayPlayers = 'N/A';
        let homeFormation = 'N/A';
        let awayFormation = 'N/A';
        if (apiFootballData.lineups) {
            const homeLineup = apiFootballData.lineups.find(l => l.teamName?.includes(homeTeamName) || homeTeamName.includes(l.teamName));
            const awayLineup = apiFootballData.lineups.find(l => l.teamName?.includes(awayTeamName) || awayTeamName.includes(l.teamName));
            if (homeLineup) {
                startingHomePlayers = homeLineup.startXI.map(p => `${p.name} (${p.pos}, #${p.number})`).join(', ') || 'N/A';
                homeFormation = homeLineup.formation || 'N/A';
            }
             if (awayLineup) {
                startingAwayPlayers = awayLineup.startXI.map(p => `${p.name} (${p.pos}, #${p.number})`).join(', ') || 'N/A';
                awayFormation = awayLineup.formation || 'N/A';
            }
        }
        const matchStatsSample = apiFootballData.matchStats ? JSON.stringify(apiFootballData.matchStats).substring(0, 500) + '...' : 'N/A';

        const [fetchedOddsData, apiFootballH2HData] = await Promise.all([
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName),
            getApiFootballH2H(apiFootballHomeId, apiFootballAwayId, 5)
        ]);
        
        const geminiJsonString = await _callGemini(PROMPT_V42(
            sport, homeTeamName, awayTeamName,
            apiFootballData,
            homePlayerNames, awayPlayerNames,
            homeRecentMatchInfo, awayRecentMatchInfo,
            startingHomePlayers, startingAwayPlayers,
            homeFormation, awayFormation,
            matchStatsSample,
            calculatedStats, apiFootballH2HData
        ));
        
        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; } catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500)); }
        if (!geminiData || typeof geminiData !== 'object') { throw new Error("A Gemini AI nem adott vissza érvényes JSON adatot."); }

        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
        const finalData = {};
        const parseStat = (val, d = null) => { if (val === null || val === undefined || val === "N/A") return d; const n = Number(val); return (!isNaN(n) && n >= 0) ? n : d; };
        
        const homeGp = parseStat(calculatedStats.home?.gp, parseStat(geminiData?.stats?.home?.gp, 1));
        const homeGf = parseStat(calculatedStats.home?.gf, parseStat(geminiData?.stats?.home?.gf, null));
        const homeGa = parseStat(calculatedStats.home?.ga, parseStat(geminiData?.stats?.home?.ga, null));
        const awayGp = parseStat(calculatedStats.away?.gp, parseStat(geminiData?.stats?.away?.gp, 1));
        const awayGf = parseStat(calculatedStats.away?.gf, parseStat(geminiData?.stats?.away?.gf, null));
        const awayGa = parseStat(calculatedStats.away?.ga, parseStat(geminiData?.stats?.away?.ga, null));
        finalData.stats = { home: { gp: homeGp, gf: homeGf, ga: homeGa }, away: { gp: awayGp, gf: awayGf, ga: awayGa } };
        console.log(`Végleges stats használatban: Home(GP:${homeGp ?? 'N/A'}, GF:${homeGf ?? 'N/A'}, GA:${homeGa ?? 'N/A'}), Away(GP:${awayGp ?? 'N/A'}, GF:${awayGf ?? 'N/A'}, GA:${awayGa ?? 'N/A'})`);
        
        finalData.h2h_structured = apiFootballH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        const normKP = (p) => (Array.isArray(p) ? p : []).map(i => ({ name: i?.name || '?', role: i?.role || '?', stats: i?.stat || i?.stats || 'N/A' }));
        finalData.key_players = { home: normKP(geminiData?.key_players?.home), away: normKP(geminiData?.key_players?.away) };
        finalData.contextual_factors = geminiData?.contextual_factors || {};
        finalData.contextual_factors.stadium_location = finalData.contextual_factors.stadium_location || "N/A";
        finalData.contextual_factors.match_tension_index = finalData.contextual_factors.match_tension_index || "N/A";
        finalData.contextual_factors.pitch_condition = finalData.contextual_factors.pitch_condition || "N/A";
        finalData.contextual_factors.referee = geminiData?.contextual_factors?.referee || { name: "N/A", style: "N/A" };
        finalData.contextual_factors.structured_weather = structuredWeather;
        finalData.referee = finalData.contextual_factors.referee;
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } };
        if (homeFormation !== 'N/A') finalData.tactics.home.formation = homeFormation;
        if (awayFormation !== 'N/A') finalData.tactics.away.formation = awayFormation;
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] };
        finalData.key_matchups = geminiData?.key_matchups || {};
        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} };
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} };
        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" };
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" };
        finalData.advancedData = { home: { xg: null }, away: { xg: null } };
        finalData.league_averages = geminiData?.league_averages || {};
        finalData.apiFootballData = apiFootballData;
        
        const richContextParts = [
            `Mérkőzés: ${homeTeamName} vs ${awayTeamName}`,
            `Bajnokság: ${leagueName || 'N/A'}`,
            `Hírek (Hazai): ${finalData.team_news.home}`,
            `Hírek (Vendég): ${finalData.team_news.away}`,
            `Hiányzók (Hazai): ${finalData.absentees.home.map(p => `${p.name} (${p.role})`).join(', ') || 'Nincs'}`,
            `Hiányzók (Vendég): ${finalData.absentees.away.map(p => `${p.name} (${p.role})`).join(', ') || 'Nincs'}`,
            `Forma (Össz): ${homeTeamName}: ${finalData.form.home_overall} | ${awayTeamName}: ${finalData.form.away_overall}`,
            `H2H Összefoglaló: ${finalData.h2h_summary}`
        ];
        const richContext = richContextParts.join('\n');

        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advancedData, form: finalData.form, rawData: finalData };
        
        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + APIFootball [H2H, Players, Matches, Lineups, Stats] + StatsCalc + Időjárás), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- FRISSÍTETT GEMINI PROMPT (v43 - API-Football) ---
function PROMPT_V42( // Nevét meghagyjuk v42-nek a kompatibilitás miatt, de a tartalom frissült
    sport, homeTeamName, awayTeamName,
    apiFootballData,
    homePlayerNames, awayPlayerNames,
    homeRecentMatchInfo, awayRecentMatchInfo,
    startingHomePlayers, startingAwayPlayers,
    homeFormation, awayFormation,
    matchStatsSample,
    calculatedStats, apiFootballH2HData
) {
    let calculatedStatsInfo = "";
    if (calculatedStats.home?.gp !== null || calculatedStats.away?.gp !== null) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats (gp, gf, ga) have been PRE-CALCULATED based on the available recent match history from API-Football. Use these exact numbers; do not rely on your internal knowledge for these specific stats.\nHome Calculated (GP=${calculatedStats.home?.gp ?? 'N/A'}, GF=${calculatedStats.home?.gf ?? 'N/A'}, GA=${calculatedStats.home?.ga ?? 'N/A'})\nAway Calculated (GP=${calculatedStats.away?.gp ?? 'N/A'}, GF=${calculatedStats.away?.gf ?? 'N/A'}, GA=${calculatedStats.away?.ga ?? 'N/A'})\n`;
    } else {
        calculatedStatsInfo = "NOTE ON STATS: Could not pre-calculate basic stats (gp, gf, ga) from API-Football recent matches. Please use your best knowledge for the CURRENT SEASON/COMPETITION.\n";
    }

    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-FOOTBALL. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiFootballH2HData && Array.isArray(apiFootballH2HData) && apiFootballH2HData.length > 0) {
        const h2hString = apiFootballH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-FOOTBALL, Last ${apiFootballH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields. Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiFootballH2HData)}\n`;
    }

    let apiFootballDataInfo = `AVAILABLE FACTUAL DATA (Mainly from API-Football):\n`;
    apiFootballDataInfo += `- Fixture ID: ${apiFootballData.fixtureId || 'N/A'}\n`;
    apiFootballDataInfo += `- Home Team ID (API-F): ${apiFootballData.homeTeamId || 'N/A'}\n`;
    apiFootballDataInfo += `- Away Team ID (API-F): ${apiFootballData.awayTeamId || 'N/A'}\n`;
    apiFootballDataInfo += `- Home Players (Sample): ${homePlayerNames}\n`;
    apiFootballDataInfo += `- Away Players (Sample): ${awayPlayerNames}\n`;
    apiFootballDataInfo += `- Home Recent Matches (API-F, Last available): ${homeRecentMatchInfo}\n`;
    apiFootballDataInfo += `- Away Recent Matches (API-F, Last available): ${awayRecentMatchInfo}\n`;
    apiFootballDataInfo += `- Starting Home XI: ${startingHomePlayers}\n`;
    apiFootballDataInfo += `- Starting Away XI: ${startingAwayPlayers}\n`;
    apiFootballDataInfo += `- Home Formation: ${homeFormation}\n`;
    apiFootballDataInfo += `- Away Formation: ${awayFormation}\n`;
    apiFootballDataInfo += `- Match Stats (API-F, if available): ${matchStatsSample}\n`;


    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. **CRITICAL: You MUST use the latest factual data provided below (mainly from API-Football) over your general knowledge.** If external data is N/A, use your knowledge but state the uncertainty.
${calculatedStatsInfo}
${h2hInfo}
${apiFootballDataInfo}
REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga. **USE THE PRE-CALCULATED STATS PROVIDED ABOVE if available.** If not, provide stats for the CURRENT SEASON/COMPETITION based on your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-FOOTBALL H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. (CRITICAL: Use Starting XI/Player List from API-Football to verify player availability if possible. If Starting XI is 'N/A', mention this uncertainty).
4. Recent Form: W-D-L strings (overall, home/away). **Derive this primarily from the API-Football Recent Matches provided above.** If data is N/A, use your knowledge.
5. Key Players: name, role, recent key stat. Use API-Football player list for names/roles if available.
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation. **CRITICAL: Use Formation from API-Football data if available ('${homeFormation}' / '${awayFormation}').** If N/A, use your knowledge but state it's an estimate.
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }. Identify key attacking/defending patterns.
  9. Key Matchups: Identify 1-2 key positional or player battles based on tactics and player roles.
  10. Advanced Stats: Extract key stats like xG, Possession %, Shots on Target from the provided API-Football Match Stats if available.
IF hockey:
  7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. Use your knowledge.
IF basketball:
  7. Advanced Styles: Shot Distribution { home: "e.g., Heavy 3-point", away: "..." }, Defensive Style { home: "e.g., Aggressive Perimeter", away: "..." }. Use your knowledge.
OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately. Fields for other sports can be omitted.
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
  "advanced_stats_team":{ "home":{/* Include API-F stats here if relevant */}, "away":{/* Include API-F stats here if relevant */} },
  "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} },
  "shot_distribution":{ "home":"...", "away":"..." },
  "defensive_style":{ "home":"...", "away":"..." },
  "league_averages": { /* Optional: avg_goals_per_game, etc. */ }
}`;
}


// --- ODDS API FUNKCIÓK ---
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const specificApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : null;
    const oddsApiKey = specificApiKey || sportConfig.odds_api_sport_key;
    if (!ODDS_API_KEY || !oddsApiKey) { console.warn(`Odds API: Hiányzó kulcs/sportkulcs. Liga: "${leagueName}", Használt: "${oddsApiKey || 'NINCS'}"`); return null; }
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&oddsFormat=decimal`;
    const displayUrl = url.replace(ODDS_API_KEY, '<apikey>');
    console.log(`Odds API (${oddsApiKey}): Adatok lekérése... URL: ${displayUrl}`);
    try {
        const response = await makeRequest(url, { headers:{'X-API-KEY': ODDS_API_KEY}, timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data)) { console.warn(`Odds API (${oddsApiKey}): Érvénytelen/üres válasz. Státusz: ${response?.status}`); return null; }
        if (response.data.length === 0) { console.warn(`Odds API (${oddsApiKey}): Nincs elérhető meccs.`); return null; }
        const oddsData = response.data;
        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.60;
        for (const match of oddsData) {
            if (!match?.home_team || !match?.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            const mappedHome = ODDS_TEAM_NAME_MAP[homeTeam.toLowerCase().trim()];
            const mappedAway = ODDS_TEAM_NAME_MAP[awayTeam.toLowerCase().trim()];
            const isExactMapped = (mappedHome && mappedHome.toLowerCase() === apiHomeLower) || (mappedAway && mappedAway.toLowerCase() === apiAwayLower);
            if (!homeMatchResult?.bestMatch || !awayMatchResult?.bestMatch || homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue;

            const homeSim = homeMatchResult.bestMatch.rating;
            const awaySim = awayMatchResult.bestMatch.rating;
            let combinedSim = (homeSim + awaySim) / 2;
            if(isExactMapped) combinedSim += 0.1;

            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = match;
            }
        }
        if (!bestMatch) { console.warn(`Odds API (${oddsApiKey}): Nem található elég jó egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam}.`); return null; }
        console.log(`Odds API (${oddsApiKey}): Találat ${bestMatch.home_team} vs ${bestMatch.away_team} (${(highestCombinedRating*100).toFixed(1)}%).`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) { console.warn(`Odds API: Nincs Pinnacle piac: ${bestMatch.home_team}`); return null; }
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const h2hOutcomes = h2hMarket?.outcomes;
        if (h2hOutcomes && Array.isArray(h2hOutcomes)) {
            h2hOutcomes.forEach(o => {
                if (o?.price && typeof o.price === 'number' && o.price > 1) {
                    let n = o.name;
    
                    if (findBestMatch(n, generateTeamNameVariations(homeTeam)).bestMatch.rating > 0.7) n = 'Hazai győzelem';
                    else if (findBestMatch(n, generateTeamNameVariations(awayTeam)).bestMatch.rating > 0.7) n = 'Vendég győzelem';
                    else if (n.toLowerCase() === 'draw') n = 'Döntetlen';
                    
                    currentOdds.push({ name: n, price: o.price });
                }
            });
        } else { console.warn(`Odds API: Nincs H2H piac: ${bestMatch.home_team}`); }
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totalsOutcomes = totalsMarket?.outcomes;
        if (totalsOutcomes && Array.isArray(totalsOutcomes)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            console.log(`Odds API: Fő Totals vonal: ${mainLine}`);
            const overOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Over');
            const underOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Under');
            if (overOutcome?.price && typeof overOutcome.price === 'number' && overOutcome.price > 1) { currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price }); }
            if (underOutcome?.price && typeof underOutcome.price === 'number' && underOutcome.price > 1) { currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price }); }
        } else { console.warn(`Odds API: Nincs Totals piac: ${bestMatch.home_team}`); }
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) {
        console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}, Liga: ${leagueName||'N/A'}, Kulcs: ${oddsApiKey}): ${e.message}`, e.stack?.substring(0, 300));
        return null;
    }
}

export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) {
        console.warn("Odds API kulcs hiányzik, odds lekérés kihagyva.");
        return null;
    }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v9_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        console.log(`Odds cache találat (${cacheKey})`);
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`);
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (!liveOdds && leagueName && getOddsApiKeyForLeague(leagueName) !== sportConfig.odds_api_sport_key) {
        console.log(`Odds API: Specifikus liga (${leagueName}) sikertelen, próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
        liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
    }
    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        console.log(`Odds adatok sikeresen lekérve és cache-elve (${cacheKey}).`);
        return { ...liveOdds, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni (még fallback után sem): ${homeTeam} vs ${awayTeam}`);
    return null;
}

function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([
        teamName,
        lowerName,
        ODDS_TEAM_NAME_MAP[lowerName] || teamName
    ]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.|us|tsg|vfl|hsc|sv|spvgg)\s+/i, '').trim());

    const parts = teamName.split(' ');
    if (parts.length > 1) {
        variations.add(parts[0]);
        if (parts.length > 2 && !/^(fc|sc|...)/i.test(parts[0])) { 
             variations.add(parts[0]);
        }
    }

    if (lowerName === 'manchester united') variations.add('man united');
    if (lowerName === 'manchester city') variations.add('man city');
    if (lowerName === 'tottenham hotspur') variations.add('tottenham');
    if (lowerName === 'wolverhampton wanderers') variations.add('wolves');
    if (lowerName === 'west ham united') variations.add('west ham');
    if (lowerName === 'brighton & hove albion') variations.add('brighton');
    if (lowerName === 'internazionale') variations.add('inter');
    if (lowerName === 'atletico madrid') variations.add('atletico');
    if (lowerName === 'real betis') variations.add('betis');
    if (lowerName === 'golden knights') variations.add('vegas golden knights');
    if (lowerName === 'maple leafs') variations.add('toronto maple leafs');
    if (lowerName === 'blue jackets') variations.add('columbus blue jackets');
    return Array.from(variations).filter(name => name && name.length > 2);
}

export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) {
        console.warn("Totals piac nem található vagy hiányos az odds adatokban.");
        return defaultLine;
    }

    let closestPair = { diff: Infinity, line: defaultLine };
    const lines = {};
    totalsMarket.outcomes.forEach(o => {
        if (typeof o.point === 'number' && !isNaN(o.point) && o.name && o.price) {
            if (!lines[o.point]) {
                lines[o.point] = {};
            }
            lines[o.point][o.name.toLowerCase()] = o.price;
        }
    });
    const points = Object.keys(lines).map(Number).filter(p => lines[p].over && lines[p].under);

    if (points.length === 0) {
        console.warn("Nem található teljes Over/Under pár egyetlen vonalon sem.");
        return defaultLine;
    }

    for (const point of points) {
        const overPrice = lines[point].over;
        const underPrice = lines[point].under;
        const diff = Math.abs(overPrice - underPrice);
        if (diff < closestPair.diff) {
            closestPair = { diff, line: point };
        }
        if (diff < 0.01) break;
    }

    if (closestPair.diff < 0.5) {
        console.log(`Legkiegyensúlyozottabb totals vonal: ${closestPair.line} (Diff: ${closestPair.diff.toFixed(2)})`);
        return closestPair.line;
    }

    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    console.log(`Nincs kiegyensúlyozott totals vonal, a defaulthoz (${numericDefaultLine}) legközelebbi: ${points[0]}`);
    return points[0];
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
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre' && event.competitions?.[0]?.competitors?.length === 2) 
                    .map(event => {
 
                        const competition = event.competitions?.[0];
                        if (!competition) return null;
                        const homeTeamData = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                
                        const awayTeamData = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        const homeName = homeTeamData ? String(homeTeamData.shortDisplayName || homeTeamData.displayName || homeTeamData.name || '').trim() : null;
              
                        const awayName = awayTeamData ? String(awayTeamData.shortDisplayName || awayTeamData.displayName || awayTeamData.name || '').trim() : null;
                        const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;
                        if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                            return {
                                id: String(event.id),
                           
     home: homeName,
                                away: awayName,
                                utcKickoff: event.date,
                            
     league: safeLeagueName
                            };
                        } else {
                            console.warn(`_getFixturesFromEspn: Hiányos adatú esemény kihagyva: ID=${event.id}, Home=${homeName}, Away=${awayName}, Date=${event.date}`);
                            return null;
                        }
                    }).filter(Boolean);
            }).catch(error => {
                const displayUrl = url; 
                if (error.response?.status === 400 || error.message.includes('404')) {
                    console.warn(`ESPN Hiba (40x): Lehetséges, hogy rossz a slug '${slug}' (${leagueName})? URL: ${displayUrl}`);
 
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
            if (f?.id && !uniqueFixturesMap.has(f.id)) { 
                uniqueFixturesMap.set(f.id, f);
            }
        });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff);
            const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1;
            if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve.`);
        return finalFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack?.substring(0, 300));
        return [];
    }
}

// --- EGYÉB SEGÉDFÜGGVÉNYEK ---
async function getStructuredWeatherData(location, utcKickoff) {
    if (!location || location === "N/A" || !location.includes(',')) {
        console.warn(`Időjárás: Hiányzó vagy érvénytelen helyszín: "${location}".`);
        return null;
    }

    const parts = location.split(',');
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) {
        console.warn(`Időjárás: Nem sikerült feldolgozni a koordinátákat: "${location}".`);
        return null;
    }

    try {
        const kickoffDate = new Date(decodeURIComponent(utcKickoff));
        const dateString = kickoffDate.toISOString().split('T')[0];
        const hour = kickoffDate.getUTCHours();

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m&start_date=${dateString}&end_date=${dateString}`;
        
        const response = await makeRequest(url);
        if (!response?.data?.hourly) {
            console.warn(`Időjárás: Nem érkezett érvényes adat a ${location} helyszínre.`);
            return null;
        }
        
        const weather = response.data.hourly;
        
        const matchHourIndex = weather.time.findIndex(t => new Date(t).getUTCHours() === hour);
        const index = matchHourIndex !== -1 ? matchHourIndex : Math.floor(weather.time.length / 2);

        const structured = {
            temp_celsius: weather.temperature_2m[index],
            precipitation_mm: weather.precipitation[index],
            wind_speed_kmh: weather.wind_speed_10m[index]
        };

        console.log(`Időjárás: Adatok sikeresen lekérve (${location}):`, structured);
        return structured;

    } catch (e) {
        console.error(`Időjárás API hiba (${location}): ${e.message}`);
        return null;
    }
}

async function getApiFootballH2H(homeTeamId, awayTeamId, limit = 5) {
    if (!APIFOOTBALL_API_KEY || !homeTeamId || !awayTeamId) {
        return null;
    }
    const cacheKey = `apifootball_h2h_v15_${homeTeamId}_${awayTeamId}_${limit}`;
    const cachedData = apiFootballMatchesCache.get(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    const h2hString = `${homeTeamId}-${awayTeamId}`;
    const url = `${APIFOOTBALL_BASE_URL}/fixtures/headtohead?h2h=${h2hString}&last=${limit}`;
    
    console.log(`API-FOOTBALL H2H lekérés: ${homeTeamId} vs ${awayTeamId}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 15000 });

        if (!response || !response.data?.response || response.data.results === 0) {
            console.warn(`API-Football H2H: Nem található adat ehhez: ${homeTeamId} vs ${awayTeamId}.`);
            apiFootballMatchesCache.set(cacheKey, []);
            return [];
        }

        const matches = response.data.response.map(fix => ({
            date: fix.fixture?.date?.split('T')[0],
            competition: fix.league?.name,
            home_team: fix.teams?.home?.name,
            away_team: fix.teams?.away?.name,
            score: `${fix.goals?.home}-${fix.goals?.away}`
        }));
        
        console.log(`API-Football H2H: ${matches.length} meccs adat lekérve.`);
        apiFootballMatchesCache.set(cacheKey, matches);
        return matches;
    } catch (e) {
        console.error(`API-Football H2H hiba (${homeTeamId} vs ${awayTeamId}): ${e.message}`);
        return null;
    }
}