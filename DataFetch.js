// --- VÉGLEGES INTEGRÁLT (v28 - Teljes Kód) datafetch.js ---
// - GYÖKÉROK JAVÍTVA: Az API-Football liga keresés most már a 'country' paramétert is használja.
// - ADAPTÍV LOGIKA: Ha a jövőbeli szezon nem található, a kód automatikusan az előzővel próbálkozik.
// - ODDS API JAVÍTVA: A helyes, letesztelt URL-t és paramétereket használja ('start_at_min', 'status: SCHEDULED').
// - HIBATŰRÉS: A kód intelligensen kezeli, ha az Odds API nem ad vissza jövőbeli eseményeket.

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    // --- EGYSÉGESÍTETT KULCSOK ---
    RAPIDAPI_KEY,
    APIFOOTBALL_RAPIDAPI_HOST,
    RAPIDAPI_ODDS_HOST,
    ODDS_TEAM_NAME_MAP
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiFootballFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v28 (2025-10-29) - Végleges Javítás
* - API-FOOTBALL GYÖKÉROK JAVÍTVA: A `getApiFootballLeagueId` most már
* a 'country' paramétert is használja a pontosabb keresésért.
* - ADAPTÍV SZEZONKERESÉS: Ha a jövőbeli szezon nem található,
* a kód automatikusan az előző szezonnal próbálkozik.
* - ODDS API VÉGLEGESÍTVE: A helyes '/api/v1/events' útvonalat és a
* letesztelt 'start_at_min'/'max' és 'status' paramétereket használja.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 20000,
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
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                const apiMessage = response?.data?.Message || response?.data?.message || response?.data?.error || JSON.stringify(response?.data)?.substring(0, 150);
                if (url.includes(APIFOOTBALL_RAPIDAPI_HOST) && apiMessage) { error.message += ` - API-Football: ${apiMessage}`; }
                if (url.includes(RAPIDAPI_ODDS_HOST) && apiMessage) { error.message += ` - OddsAPI: ${apiMessage}`; }
                if ([401, 403].includes(response.status)) { console.error(`Hitelesítési Hiba (${response.status})! URL: ${url.substring(0, 100)}...`); }
                if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${url}`); }
                if (response.status === 422) { console.warn(`API Hiba: Feldolgozhatatlan kérés (422). URL: ${url.substring(0, 100)}... Válasz: ${apiMessage}`); }
                if (response.status === 429) { console.warn(`API Hiba: Túl sok kérés (429). URL: ${url.substring(0, 100)}...`); }
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.response.status === 429) { console.error(`CRITICAL RATE LIMIT: ${errorMessage}`); return null; }
                if ([401, 403].includes(error.response.status) || JSON.stringify(error.response.data).includes('Invalid API key')) { console.error(errorMessage); return null; }
                if (error.response.status === 422) { console.error(errorMessage); return null; }
                if (error.response.status === 404) { console.warn(errorMessage); return null; }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 20000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage, error.stack); return null;
            }
            if (attempts <= retries && error.response && error.response.status >= 500) {
                console.warn(errorMessage);
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
            } else if (attempts <= retries && !error.response) {
                 console.warn(errorMessage);
                 await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
            } else {
                if (error.response && error.response.status < 500 && error.response.status !== 404 && error.response.status !== 429) {
                     console.error(errorMessage);
                     return null;
                }
                console.error(`API (${method}) hívás végleg sikertelen: ${url.substring(0, 150)}...`);
                return null;
            }
        }
    }
    console.error(`API (${method}) hívás váratlanul véget ért: ${url.substring(0, 150)}...`);
    return null;
}

// --- SPORTMONKS API (Változatlan) ---
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    const TEAM_NAME_MAP = { 'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade', 'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen', 'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma' };
    let teamId = null;
    let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName];
    const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim();
    if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName);
    if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName);
    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt];
        try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                teamId = response.data.data[0].id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${response.data.data[0].name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                console.warn(`SportMonks API figyelmeztetés (${response.status}) Keresés: "${searchName}".`);
                break;
            }
        } catch (error) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
        if (attempt < namesToTry.length - 1) await new Promise(resolve => setTimeout(resolve, 50));
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}

// --- GEMINI API FUNKCIÓ (Változatlan) ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", }, };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        console.log(`Gemini API válasz státusz: ${response.status}`);
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            console.error('--- END RAW GEMINI ERROR RESPONSE ---');
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log('--- RAW GEMINI RESPONSE TEXT ---');
        if (responseText) {
            console.log(`Kapott karakterek száma: ${responseText.length}`);
            console.log(responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));
        } else {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            const safetyRatings = response.data?.candidates?.[0]?.safetyRatings;
            let blockReason = safetyRatings?.find(r => r.blocked)?.category || (finishReason === 'SAFETY' ? 'Safety' : 'N/A');
            console.warn(`Gemini nem adott vissza szöveges tartalmat! FinishReason: ${finishReason}. BlockReason: ${blockReason}. Teljes válasz:`, JSON.stringify(response.data));
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}${blockReason !== 'N/A' ? ` (${blockReason})` : ''}`);
        }
        console.log('--- END RAW GEMINI RESPONSE TEXT ---');
        let potentialJson = responseText.trim();
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            console.log("Tisztítás: ```json``` körítés eltávolítva.");
            potentialJson = jsonMatch[1].trim();
        }
        const firstBrace = potentialJson.indexOf('{');
        const lastBrace = potentialJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            potentialJson = potentialJson.substring(firstBrace, lastBrace + 1);
        } else if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) {
            console.error("A kapott válasz tisztítás után sem tűnik JSON objektumnak:", potentialJson.substring(0, 500));
            throw new Error("A Gemini válasza nem volt felismerhető JSON formátumú.");
        }
        try {
            JSON.parse(potentialJson);
            console.log("Gemini API válasz sikeresen validálva JSON-ként.");
            return potentialJson;
        } catch (parseError) {
            console.error("A Gemini válasza a tisztítási kísérlet után sem volt valid JSON:", potentialJson.substring(0, 500), parseError);
            throw new Error(`A Gemini válasza nem volt érvényes JSON: ${parseError.message}`);
        }
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
        feels_like_celsius: null,
        wind_speed_kmh: null,
        precipitation_mm: null,
        humidity_percent: null,
        description: "N/A"
    };
}

// --- API-FOOTBALL FUNKCIÓK ---
const APIFOOTBALL_HEADERS = {
    'x-rapidapi-key': RAPIDAPI_KEY,
    'x-rapidapi-host': APIFOOTBALL_RAPIDAPI_HOST
};
const APIFOOTBALL_BASE_URL = `https://${APIFOOTBALL_RAPIDAPI_HOST}`;

async function getApiFootballTeamId(teamName) {
    if (!RAPIDAPI_KEY) { console.warn("API-FOOTBALL RapidAPI kulcs hiányzik, csapat ID keresés kihagyva."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    const cacheKey = `apifootball_teamid_v2_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = apiFootballTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `${APIFOOTBALL_BASE_URL}/v3/teams?search=${encodeURIComponent(teamName)}`;
    console.log(`API-FOOTBALL Team Search (via RapidAPI): ${teamName}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        if (response?.data?.response?.length > 0) {
            const teams = response.data.response;
            const teamNames = teams.map(t => t.team?.name);
            const matchResult = findBestMatch(teamName, teamNames);
            if (matchResult.bestMatch.rating > 0.6) {
                const bestMatch = teams[matchResult.bestMatchIndex];
                const teamId = bestMatch.team?.id;
                if (teamId) {
                    console.log(`API-FOOTBALL: ID találat "${teamName}" -> "${bestMatch.team?.name}" (Hasonlóság: ${(matchResult.bestMatch.rating * 100).toFixed(1)}%) -> ${teamId}`);
                    apiFootballTeamIdCache.set(cacheKey, teamId);
                    return teamId;
                }
            }
            console.warn(`API-FOOTBALL: Találatok (${teams.length}) "${teamName}"-re, de egyik sem elég hasonló (Legjobb: ${matchResult.bestMatch.target} @ ${(matchResult.bestMatch.rating * 100).toFixed(1)}%).`);
        } else {
             console.warn(`API-FOOTBALL: Nem található csapat ID ehhez: "${teamName}". A válasz: ${JSON.stringify(response?.data)}`);
        }
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (csapatkeresés "${teamName}"): ${error.message}`);
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballH2H(homeTeamId, awayTeamId, limit = 5) {
    if (!RAPIDAPI_KEY) { console.warn("API-FOOTBALL RapidAPI kulcs hiányzik, H2H lekérés kihagyva."); return null; }
    if (!homeTeamId || !awayTeamId) {
        console.warn(`API-FOOTBALL H2H: Nem található mindkét csapat ID (H:${homeTeamId}, A:${awayTeamId}).`);
        return null;
    }
    try {
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().split('T')[0];
        const h2hUrl = `${APIFOOTBALL_BASE_URL}/v3/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&from=${fromDate}&to=${toDate}`;
        console.log(`API-FOOTBALL H2H lekérés (ID-k alapján): ${homeTeamId} vs ${awayTeamId}...`);
        const response = await makeRequest(h2hUrl, { headers: APIFOOTBALL_HEADERS }, 1);
        const fixtures = response?.data?.response;
        if (fixtures && Array.isArray(fixtures)) {
            console.log(`API-FOOTBALL H2H: ${fixtures.length} meccs adat lekérve.`);
            const structuredH2H = fixtures.map(fix => ({
                date: fix.fixture?.date?.split('T')[0] || 'N/A',
                competition: fix.league?.name || 'N/A',
                home_team: fix.teams?.home?.name || 'N/A',
                away_team: fix.teams?.away?.name || 'N/A',
                home_score: fix.goals?.home,
                away_score: fix.goals?.away,
                score: `${fix.goals?.home ?? '?'} - ${fix.goals?.away ?? '?'}`
            })).sort((a, b) => new Date(b.date) - new Date(a.date));
            return structuredH2H.slice(0, limit);
        } else {
            console.warn(`API-FOOTBALL H2H: Nem érkezett érvényes meccslista.`);
            return null;
        }
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (H2H lekérés ${homeTeamId} vs ${awayTeamId}): ${error.message}`);
        return null;
    }
}

async function getApiFootballLineups(fixtureId) {
    if (!fixtureId) return null;
    console.log(`API-FOOTBALL Kezdőcsapatok lekérése... (Fixture: ${fixtureId})`);
    const url = `${APIFOOTBALL_BASE_URL}/v3/fixtures/lineups?fixture=${fixtureId}`;
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        const lineups = response?.data?.response;
        if (lineups && lineups.length > 0) {
            console.log(`API-FOOTBALL: Kezdőcsapatok sikeresen lekérve (${lineups.length} csapat).`);
            return lineups;
        } else {
            console.warn(`API-FOOTBALL: Nem található kezdőcsapat adat ehhez: ${fixtureId}. (Lehet, hogy túl korán van)`);
            return null;
        }
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (lineups ${fixtureId}): ${error.message}`);
        return null;
    }
}

async function getApiFootballStats(fixtureId) {
    if (!fixtureId) return null;
    console.log(`API-FOOTBALL Meccs-statisztika lekérése... (Fixture: ${fixtureId})`);
    const url = `${APIFOOTBALL_BASE_URL}/v3/fixtures/statistics?fixture=${fixtureId}`;
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        const stats = response?.data?.response;
        if (stats && stats.length > 0) {
            console.log(`API-FOOTBALL: Meccs-statisztika sikeresen lekérve (${stats.length} csapat).`);
            return stats;
        } else {
            console.warn(`API-FOOTBALL: Nem található meccs-statisztika ehhez: ${fixtureId}. (Csak lejátszott meccsekhez van)`);
            return null;
        }
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (statistics ${fixtureId}): ${error.message}`);
        return null;
    }
}

async function getApiFootballTeamSeasonStats(teamId, leagueId, season) {
    if (!teamId || !leagueId || !season) {
         console.warn(`API-FOOTBALL Szezon Stat: Hiányzó adatok (T:${teamId}, L:${leagueId}, S:${season})`);
         return null;
    }
    const cacheKey = `apifootball_seasonstats_${teamId}_${leagueId}_${season}`;
    const cachedStats = apiFootballStatsCache.get(cacheKey);
    if (cachedStats) {
        console.log(`API-FOOTBALL Szezon Stat cache találat: T:${teamId}, L:${leagueId}, S:${season}`);
        return cachedStats;
    }
    console.log(`API-FOOTBALL Szezon Stat lekérés: T:${teamId}, L:${leagueId}, S:${season}...`);
    const url = `${APIFOOTBALL_BASE_URL}/v3/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        const stats = response?.data?.response;
        if (stats && stats.league?.id) {
            console.log(`API-FOOTBALL: Szezon statisztika sikeresen lekérve (${stats.league?.name}).`);
            const simplifiedStats = {
                leagueName: stats.league?.name,
                gamesPlayed: stats.fixtures?.played?.total,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
                avgGoalsFor: stats.goals?.for?.average?.total,
                avgGoalsAgainst: stats.goals?.against?.average?.total,
            };
            apiFootballStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        } else {
            console.warn(`API-FOOTBALL: Nem található vagy érvénytelen szezon statisztika (T:${teamId}, L:${leagueId}, S:${season}). Válasz: ${JSON.stringify(response?.data).substring(0,100)}`);
            apiFootballStatsCache.set(cacheKey, null);
            return null;
        }
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (team statistics T:${teamId}, L:${leagueId}, S:${season}): ${error.message}`);
        apiFootballStatsCache.set(cacheKey, null);
        return null;
    }
}

// v28 - JAVÍTOTT ÉS ADAPTÍV LIGA KERESŐ
async function getApiFootballLeagueId(leagueName, country, season) {
    if (!RAPIDAPI_KEY) { console.warn("API-FOOTBALL RapidAPI kulcs hiányzik, liga ID keresés kihagyva."); return null; }
    if (!leagueName || !country || !season) {
        console.warn(`API-FOOTBALL: Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik/érvénytelen a liga ID kereséséhez.`);
        return null;
    }

    const tryGetLeague = async (currentSeason) => {
        const cacheKey = `apifootball_leagueid_v28_${country.toLowerCase()}_${leagueName.toLowerCase().replace(/\s/g, '')}_${currentSeason}`;
        const cachedId = apiFootballLeagueIdCache.get(cacheKey);
        if (cachedId !== undefined) {
            if(cachedId !== 'not_found') console.log(`API-Football: Liga ID cache találat: ${cachedId}`);
            return cachedId === 'not_found' ? null : cachedId;
        }

        const url = `${APIFOOTBALL_BASE_URL}/v3/leagues?name=${encodeURIComponent(leagueName)}&country=${encodeURIComponent(country)}&season=${currentSeason}`;
        console.log(`API-FOOTBALL League Search: "${leagueName}" (${country}, ${currentSeason})...`);
        try {
            const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
            if (response?.data?.response?.length > 0) {
                // A 'find' robusztusabb, ha több azonos nevű liga van (pl. alacsonyabb osztályok)
                const perfectMatch = response.data.response.find(l => l.league.name.toLowerCase() === leagueName.toLowerCase());
                const league = perfectMatch || response.data.response[0];
                
                const leagueId = league.league.id;
                console.log(`API-FOOTBALL: Liga ID találat "${leagueName}" -> "${league.league.name}" -> ${leagueId}`);
                apiFootballLeagueIdCache.set(cacheKey, leagueId);
                return leagueId;
            }
            console.warn(`API-FOOTBALL: Nem található liga ID ehhez: "${leagueName}" (${country}, ${currentSeason}).`);
            apiFootballLeagueIdCache.set(cacheKey, 'not_found');
            return null;
        } catch (error) {
            console.error(`API-FOOTBALL Hiba (ligakeresés "${leagueName}", ${currentSeason}): ${error.message}`);
            apiFootballLeagueIdCache.set(cacheKey, 'not_found');
            return null;
        }
    };

    // 1. Próbálkozás az adott szezonnal
    let leagueId = await tryGetLeague(season);
    
    // 2. Próbálkozás (Fallback) az előző szezonnal, ha az első sikertelen
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
    if (cached) {
        console.log(`API-Football: Fixture találat cache-ből: ${cached.fixtureId}`);
        return cached;
    }
    let foundFixture = null;
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    let fixturesUrl = `${APIFOOTBALL_BASE_URL}/v3/fixtures?league=${leagueId}&season=${season}&team=${homeTeamId}&from=${today}&to=${futureDate}`;
    console.log(`API-Football Fixture Keresés (10 nap): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában...`);
    try {
        let fixturesResponse = await makeRequest(fixturesUrl, { headers: APIFOOTBALL_HEADERS }, 1);
        let upcomingFixtures = fixturesResponse?.data?.response;
        if (upcomingFixtures && upcomingFixtures.length > 0) {
            foundFixture = upcomingFixtures.find(f => f.teams?.away?.id === awayTeamId);
        }
        if (!foundFixture) {
            console.log(`API-Football Fixture Keresés (Pontos nap): H:${homeTeamId} vs A:${awayTeamId}...`);
            const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
            fixturesUrl = `${APIFOOTBALL_BASE_URL}/v3/fixtures?league=${leagueId}&season=${season}&team=${homeTeamId}&date=${matchDate}`;
            fixturesResponse = await makeRequest(fixturesUrl, { headers: APIFOOTBALL_HEADERS }, 1);
            upcomingFixtures = fixturesResponse?.data?.response;
            if (upcomingFixtures && upcomingFixtures.length > 0) {
                 foundFixture = upcomingFixtures.find(f => f.teams?.away?.id === awayTeamId);
            }
        }
    } catch (error) {
        console.error(`API-Football Hiba a fixture keresése közben: ${error.message}`);
    }
    if (foundFixture) {
        const result = { fixtureId: foundFixture.fixture.id, fixtureDate: foundFixture.fixture.date };
        console.log(`API-Football: MECCS TALÁLAT! FixtureID: ${result.fixtureId} (Dátum: ${result.fixtureDate})`);
        apiFootballFixtureCache.set(cacheKey, result);
        return result;
    } else {
        console.warn(`API-Football: Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz.`);
        apiFootballFixtureCache.set(cacheKey, { fixtureId: null, fixtureDate: null });
        return { fixtureId: null, fixtureDate: null };
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (v28 logika) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v43_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) {
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));
        console.log(`Adatgyűjtés indul (v28 - API-Football): ${homeTeamName} vs ${awayTeamName}...`);
        const season = new Date(decodedUtcKickoff).getFullYear();
        if (isNaN(season)) {
            throw new Error(`Érvénytelen utcKickoff paraméter a dekódolás után: ${decodedUtcKickoff}`);
        }
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiFootballTeamId(homeTeamName),
            getApiFootballTeamId(awayTeamName),
        ]);
        if (!homeTeamId || !awayTeamId) { throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`); }
        console.log(`API-Football: Csapat ID-k rendben (H:${homeTeamId}, A:${awayTeamId}).`);
        
        // v28 LOGIKA: Célzott, adaptív liga keresés
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig.espn_leagues[leagueName];
        if (!leagueData || !leagueData.country) {
            throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
        }
        const country = leagueData.country;
        
        let leagueId = await getApiFootballLeagueId(leagueName, country, season);

        if (!leagueId) { throw new Error(`Nem sikerült a 'leagueId' azonosítása semmilyen módszerrel.`); }
        console.log(`API-Football: Végleges LeagueID: ${leagueId}`);
        
        const { fixtureId, fixtureDate } = await findApiFootballFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff);
        if (!fixtureId) { console.warn(`API-Football: Nem található 'fixtureId'. Kezdőcsapatok/Élő statok hiányozni fognak.`); }
        
        console.log(`API-Football: Adatok párhuzamos lekérése (H2H, Lineups, Stats, SeasonStats)...`);
        const [
            fetchedOddsData,
            apiFootballH2HData,
            apiFootballLineups,
            apiFootballStats,
            apiFootballHomeSeasonStats,
            apiFootballAwaySeasonStats
        ] = await Promise.all([
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName),
            getApiFootballH2H(homeTeamId, awayTeamId, 5),
            fixtureId ? getApiFootballLineups(fixtureId) : Promise.resolve(null),
            fixtureId ? getApiFootballStats(fixtureId) : Promise.resolve(null),
            getApiFootballTeamSeasonStats(homeTeamId, leagueId, season),
            getApiFootballTeamSeasonStats(awayTeamId, leagueId, season)
        ]);
        console.log(`API-Football: Párhuzamos lekérések befejezve.`);
        
        const geminiJsonString = await _callGemini(PROMPT_V43(
             sport, homeTeamName, awayTeamName,
             apiFootballHomeSeasonStats, apiFootballAwaySeasonStats,
             apiFootballH2HData, apiFootballLineups
        ));
        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null;
        } catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500)); }
        
        if (!geminiData || typeof geminiData !== 'object') {
             geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home: {}, away: {} }, tactical_patterns: { home: [], away: [] }, key_matchups: {}, advanced_stats_team: { home: {}, away: {} }, advanced_stats_goalie: { home_goalie: {}, away_goalie: {} }, shot_distribution: {}, defensive_style: {}, absentees: { home: [], away: [] }, team_news: { home: "N/A", away: "N/A" }, h2h_structured: [] };
             console.warn("Gemini válasz hibás vagy üres, default struktúra használva.");
        }
        
        console.log("Adatok finalizálása...");
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, decodedUtcKickoff);
        const finalData = {};
        const parseStat = (val, d = null) => { if (val === null || val === undefined || val === "N/A") return d; const n = Number(val); return (!isNaN(n) && n >= 0) ? n : d; };
        const homeGp = parseStat(apiFootballHomeSeasonStats?.gamesPlayed, parseStat(geminiData?.stats?.home?.gp, null));
        const homeGf = parseStat(apiFootballHomeSeasonStats?.goalsFor, parseStat(geminiData?.stats?.home?.gf, null));
        const homeGa = parseStat(apiFootballHomeSeasonStats?.goalsAgainst, parseStat(geminiData?.stats?.home?.ga, null));
        const awayGp = parseStat(apiFootballAwaySeasonStats?.gamesPlayed, parseStat(geminiData?.stats?.away?.gp, null));
        const awayGf = parseStat(apiFootballAwaySeasonStats?.goalsFor, parseStat(geminiData?.stats?.away?.gf, null));
        const awayGa = parseStat(apiFootballAwaySeasonStats?.goalsAgainst, parseStat(geminiData?.stats?.away?.ga, null));
        const finalHomeGp = (homeGp !== null && homeGp > 0) ? homeGp : 1;
        const finalAwayGp = (awayGp !== null && awayGp > 0) ? awayGp : 1;
        
        finalData.stats = { home: { gp: finalHomeGp, gf: homeGf, ga: homeGa }, away: { gp: finalAwayGp, gf: awayGf, ga: awayGa } };
        console.log(`Végleges stats használatban: Home(GP:${finalHomeGp}, GF:${homeGf ?? 'N/A'}, GA:${homeGa ?? 'N/A'}), Away(GP:${finalAwayGp}, GF:${awayGf ?? 'N/A'}, GA:${awayGa ?? 'N/A'})`);
        
        const apiFootballData = {
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: apiFootballLineups,
            liveStats: apiFootballStats,
            seasonStats: { home: apiFootballHomeSeasonStats, away: apiFootballAwaySeasonStats }
        };
        finalData.sportsDbData = apiFootballData;
        finalData.h2h_structured = apiFootballH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        const homeForm = apiFootballHomeSeasonStats?.form || geminiData?.form?.home_overall || "N/A";
        const awayForm = apiFootballAwaySeasonStats?.form || geminiData?.form?.away_overall || "N/A";
        finalData.form = { home_overall: homeForm, away_overall: awayForm, home_home: geminiData?.form?.home_home || "N/A", away_away: geminiData?.form?.away_away || "N/A" };
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
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] };
        finalData.key_matchups = geminiData?.key_matchups || {};
        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} };
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} };
        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" };
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" };
        finalData.advancedData = { home: { xg: null }, away: { xg: null } };
        finalData.league_averages = geminiData?.league_averages || {};
        
        const richContextParts = [
             finalData.h2h_summary && finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
             finalData.contextual_factors.match_tension_index && finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
             (finalData.team_news?.home && finalData.team_news.home !== "N/A") || (finalData.team_news?.away && finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news?.home||'-'}, V:${finalData.team_news?.away||'-'}`,
             (finalData.absentees?.home?.length > 0 || finalData.absentees?.away?.length > 0) && `- Hiányzók: H:${finalData.absentees?.home?.map(p=>p?.name).join(', ')||'-'}, V:${finalData.absentees?.away?.map(p=>p?.name).join(', ')||'-'}`,
             finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             (finalData.form?.home_overall && finalData.form.home_overall !== "N/A") || (finalData.form?.away_overall && finalData.form.away_overall !== "N/A") && `- Forma: H:${finalData.form?.home_overall||'N/A'}, V:${finalData.form?.away_overall||'N/A'}`,
             (finalData.tactics?.home?.style && finalData.tactics.home.style !== "N/A") || (finalData.tactics?.away?.style && finalData.tactics.away.style !== "N/A") && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`,
             structuredWeather && structuredWeather.description !== "N/A" ? `- Időjárás: ${structuredWeather.description}, ${structuredWeather.temperature_celsius ?? '?'}°C, ${structuredWeather.precipitation_mm ?? '?'}mm csap, ${structuredWeather.wind_speed_kmh ?? '?'}km/h szél.` : `- Időjárás: N/A`,
             finalData.contextual_factors?.pitch_condition && finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        
        const result = {
             rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext,
             advancedData: finalData.advancedData, form: finalData.form, rawData: finalData
        };
        
        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v28: API-Football + Javított Odds API), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };
    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v28) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v28): ${e.message}`);
    }
}

// --- GEMINI PROMPT (v43 - Változatlan) ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiFootballHomeSeasonStats, apiFootballAwaySeasonStats, apiFootballH2HData, apiFootballLineups) {
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Football season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats (gp, gf, ga).\n";
    if (apiFootballHomeSeasonStats || apiFootballAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats (gp, gf, ga, form) have been PRE-CALCULATED from API-Football. Use these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
        if (apiFootballHomeSeasonStats) {
            calculatedStatsInfo += `Home Calculated (GP=${apiFootballHomeSeasonStats.gamesPlayed ?? 'N/A'}, GF=${apiFootballHomeSeasonStats.goalsFor ?? 'N/A'}, GA=${apiFootballHomeSeasonStats.goalsAgainst ?? 'N/A'}, Form=${apiFootballHomeSeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Home Calculated: N/A\n`; }
        if (apiFootballAwaySeasonStats) {
            calculatedStatsInfo += `Away Calculated (GP=${apiFootballAwaySeasonStats.gamesPlayed ?? 'N/A'}, GF=${apiFootballAwaySeasonStats.goalsFor ?? 'N/A'}, GA=${apiFootballAwaySeasonStats.goalsAgainst ?? 'N/A'}, Form=${apiFootballAwaySeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Away Calculated: N/A\n`; }
    }
    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-FOOTBALL. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiFootballH2HData && Array.isArray(apiFootballH2HData) && apiFootballH2HData.length > 0) {
        const h2hString = apiFootballH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-FOOTBALL, Last ${apiFootballH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields. Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiFootballH2HData)}\n`;
    }
    let lineupInfo = "NOTE ON LINEUPS: No API-Football lineup data available (this is normal if the match is far away). Analyze absentees and formation based on your general knowledge and recent news.\n";
    if (apiFootballLineups && apiFootballLineups.length > 0) {
        const relevantLineupData = apiFootballLineups.map(t => ({
             team: t.team?.name,
             formation: t.formation,
             startXI: t.startXI?.map(p => p.player?.name),
             substitutes: t.substitutes?.map(p => p.player?.name)
        }));
        lineupInfo = `CRITICAL LINEUP DATA (from API-Football): ${JSON.stringify(relevantLineupData)}\nUse THIS data *first* to determine absentees, key players, and formation. This is more reliable than general knowledge.\n`;
    }
    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.
**CRITICAL: You MUST use the latest factual data provided below (API-Football) over your general knowledge.**
${calculatedStatsInfo}
${h2hInfo}
${lineupInfo}
AVAILABLE FACTUAL DATA (From API-Football):
- Home Season Stats: ${JSON.stringify(apiFootballHomeSeasonStats || 'N/A')}
- Away Season Stats: ${JSON.stringify(apiFootballAwaySeasonStats || 'N/A')}
- Recent H2H: ${h2hInfo.substring(0, 500)}... (See full data above if provided)
- Lineups: ${lineupInfo.substring(0, 500)}... (See full data above if provided)

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga. **USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-FOOTBALL H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. **(CRITICAL: Use the API-Football LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall). **(CRITICAL: Use the 'Form' string from the API-Football Season Stats provided above.)** Provide home_home and away_away based on general knowledge if season stats are limited.
5. Key Players: name, role, recent key stat. **(Use API-Football LINEUP data to see who is STARTING).**
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation. **(CRITICAL: Infer formation from the 'formation' field in the API-Football LINEUP data. If N/A, use your knowledge but state it's an estimate).**
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

// --- ODDS API FUNKCIÓK (v28 - VÉGLEGES LOGIKÁVAL) ---
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
    
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    
    const formatDate = (date) => date.toISOString().split('T')[0];

    const startAtMin = formatDate(today);
    const startAtMax = formatDate(tomorrow);
    
    // v28 JAVÍTÁS: A helyes, letesztelt paraméterek használata
    const eventsUrl = `https://${RAPIDAPI_ODDS_HOST}/api/v1/events?start_at_min=${startAtMin}&start_at_max=${startAtMax}&status=SCHEDULED`;
    console.log(`Odds API (RapidAPI v28): Események listájának lekérése... URL: ${eventsUrl}`);
    try {
        const eventsResponse = await makeRequest(eventsUrl, { headers: rapidApiHeaders, timeout: 15000 });
        const events = eventsResponse?.data?.data;
        
        // v28 HIBATŰRÉS: Ha a válasz sikeres, de üres, az nem hiba, csak nincs adat.
        if (!events || !Array.isArray(events) || events.length === 0) {
            console.warn(`Odds API (RapidAPI v28): Az API nem szolgáltatott jövőbeli eseményeket. A válasz sikeres, de üres.`);
            return null;
        }

        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.59; // v28 JAVÍTÁS: Enyhített küszöb

        for (const event of events) {
            const currentApiHome = event?.home;
            const currentApiAway = event?.away;
            const currentEventId = event?.id;
            if (!currentApiHome || !currentApiAway || !currentEventId) continue;
            const apiHomeLower = currentApiHome.toLowerCase().trim();
            const apiAwayLower = currentApiAway.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            if (homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue; 
            const combinedSim = (homeMatchResult.bestMatch.rating + awayMatchResult.bestMatch.rating) / 2;
            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = event;
            }
        }

        if (!bestMatch) {
            console.warn(`Odds API (RapidAPI v28): Nem található esemény egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam} a listában.`);
            return null;
        }

        eventId = bestMatch.id;
        apiHomeTeam = bestMatch.home;
        apiAwayTeam = bestMatch.away;
        console.log(`Odds API (RapidAPI v28): Esemény találat ${apiHomeTeam} vs ${apiAwayTeam} (ID: ${eventId}). Hasonlóság: ${(highestCombinedRating*100).toFixed(1)}%`);
    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI v28 /events keresés) során: ${e.message}`, e.stack);
        if (e.response?.status === 429) {
             console.error("Odds API (RapidAPI v28): Rate limit túllépve az /events hívásnál! Fontold meg a fizetős csomagot.");
        }
        return null;
    }

    if (!eventId) return null;

    const marketsUrl = `https://${RAPIDAPI_ODDS_HOST}/api/v1/events/markets?event_id=${eventId}`;
    console.log(`Odds API (RapidAPI v28): Piacok lekérése... URL: ${marketsUrl}`);
    try {
        const marketsResponse = await makeRequest(marketsUrl, { headers: rapidApiHeaders, timeout: 15000 });
        const marketsData = marketsResponse?.data?.data;

        if (!marketsData || !Array.isArray(marketsData)) {
            console.warn(`Odds API (RapidAPI v28): Nem található piac ehhez az eseményhez: ${eventId}. Státusz: ${marketsResponse?.status}`);
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
            console.log(`Odds API (RapidAPI v28): H2H oddsok (${h2hBook.book}): H:${h2hBook.outcome_0}, D:${h2hBook.outcome_1}, A:${h2hBook.outcome_2}`);
        } else { console.warn(`Odds API (RapidAPI v28): Nincs H2H ('1X2') piac: ${eventId}`); }

        const mainLine = sportConfig.totals_line ?? 2.5;
        console.log(`Odds API (RapidAPI v28): Fő Totals vonal keresése: ${mainLine}`);
        
        const totalsMarket = marketsData.find(m => m.market_name === 'Goals Over/Under' && m.value === mainLine);
        const totalsBook = totalsMarket?.market_books?.[0];
        
        if (totalsBook) {
            if (totalsBook.outcome_0 > 1) currentOdds.push({ name: `Over ${mainLine}`, price: totalsBook.outcome_0 });
            if (totalsBook.outcome_1 > 1) currentOdds.push({ name: `Under ${mainLine}`, price: totalsBook.outcome_1 });
            console.log(`Odds API (RapidAPI v28): Totals (${mainLine}) oddsok (${totalsBook.book}): Over:${totalsBook.outcome_0}, Under:${totalsBook.outcome_1}`);
        } else { console.warn(`Odds API (RapidAPI v28): Nincs Totals ('Goals Over/Under') piac a ${mainLine} vonalhoz: ${eventId}`); }

        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;

    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI v28 /events/markets lekérés) során: ${e.message}`, e.stack);
        if (e.response?.status === 429) {
             console.error("Odds API (RapidAPI v28): Rate limit túllépve a /events/markets hívásnál!");
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
    const cacheKey = `live_odds_v28_rapidapi_${key}`;
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
        console.warn(`Nem található releváns (H2H, Totals) odds piac (RapidAPI v28): ${homeTeam} vs ${awayTeam}`);
    }
    // Azért nem logolunk hibát, ha a liveOdds null, mert ez a normális működés, ha az API nem ad jövőbeli adatot.
    
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
    if (!oddsData || !oddsData.allMarkets) {
        return defaultLine;
    }
    const totalsMarket = oddsData.allMarkets.find(m => m.market_name === 'Goals Over/Under');

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
        for (const [leagueName, leagueData] of Object.entries(sportConfig.espn_leagues)) {
            const slug = leagueData.slug;
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
