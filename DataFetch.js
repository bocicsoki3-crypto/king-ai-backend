// --- VÉGLEGES INTEGRÁLT (v14) datafetch.js ---
// - Odds API lecserélve (RapidAPI - Odds Feed by Tipsters CO)
// - TSDB (TheSportsDB) teljesen eltávolítva
// - API-Football kibővítve (Lineups, Statistics, Season Stats)
// - ESPN megmaradt (a te kérésedre)

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    APIFOOTBALL_API_KEY, // Ez mostantól KRITIKUS
    RAPIDAPI_ODDS_API_KEY, // <-- ÚJ KONFIG VÁLTOZÓ
    RAPIDAPI_ODDS_HOST, // <-- ÚJ KONFIG VÁLTOZÓ
    ODDS_TEAM_NAME_MAP,
    // --- TSDB KULCS TÖRÖLVE ---
    // THESPORTSDB_API_KEY 
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); // Az új Odds API-nak is
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
// --- TSDB CACHE-ek TÖRÖLVE ---
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballFixtureIdCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 }); // Szezon statisztika

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- TSDB DB PATH TÖRÖLVE ---

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* JAVÍTÁS (2025-10-29 v14-integration):
* - `getOddsData`: Lecserélve az új RapidAPI ("Odds Feed by Tipsters CO") hívásra.
* - `THESPORTSDB`: Teljesen eltávolítva (minden `getSportsDb...` funkció törölve).
* - `API-FOOTBALL`: Kibővítve:
* - `getApiFootballLeagueId` (ÚJ): Liga ID keresése név és szezon alapján.
* - `getApiFootballFixtureId` (ÚJ): Meccs ID keresése (ESPN -> API-F áthidalás).
* - `getApiFootballLineups` (ÚJ): Kezdőcsapatok lekérése.
* - `getApiFootballStats` (ÚJ): Meccs statisztikák lekérése.
* - `getApiFootballTeamSeasonStats` (ÚJ): Szezonális statisztikák (GF, GA) lekérése.
* - `getRichContextualData`: Teljesen átírva, hogy az ESPN/API-Football/Új Odds API láncot kezelje.
* - `PROMPT_V43`: Új prompt, amely az API-Football adataira támaszkodik.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
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
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                const apiMessage = response?.data?.Message || response?.data?.message || JSON.stringify(response?.data)?.substring(0, 100);
                if (url.includes('api-sports.io') && apiMessage) { error.message += ` - API-Football: ${apiMessage}`; }
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
                if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key') || error.message.includes('Missing API key')) { console.error(errorMessage); return null; }
                if (error.response.status === 422) { console.error(errorMessage); return null; }
                if (error.response.status === 404) { return null; }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 15000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage, error.stack); return null;
            }
            if (attempts <= retries) { console.warn(errorMessage); await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); } else { console.error(`API (${method}) hívás végleg sikertelen: ${url.substring(0, 150)}...`); return null; }
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
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') { sportmonksIdCache.set(cacheKey, 'not_found'); return null; }
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

// --- THESPORTSDB FUNKCIÓK (TELJESEN TÖRÖLVE) ---
// ...
// --- A getSportsDbLeagueId, getSportsDbTeamId, getSportsDbMatchId, stb. funkciók mind törölve lettek ---
// ...

// --- IDŐJÁRÁS FUNKCIÓ (Változatlan) ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) { /* ... kód változatlan ... */ }

// --- API-FOOTBALL FUNKCIÓK (KIBŐVÍTVE) ---
const APIFOOTBALL_HEADERS = { 'x-apisports-key': APIFOOTBALL_API_KEY };
const APIFOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';

async function getApiFootballTeamId(teamName) {
    if (!APIFOOTBALL_API_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, csapat ID keresés kihagyva."); return null; }
    // Az ESPN nevek (pl. "Man City") és az API-F nevek (pl. "Manchester City") közötti eltérések kezelése
    const lowerName = teamName.toLowerCase().trim();
    const cacheKey = `apifootball_teamid_v2_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = apiFootballTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `${APIFOOTBALL_BASE_URL}/teams?search=${encodeURIComponent(teamName)}`;
    console.log(`API-FOOTBALL Team Search: ${teamName}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 8000 }, 1);
        if (response?.data?.response?.length > 0) {
            const teams = response.data.response;
            // A legjobb egyezés keresése string-similarity-vel, hogy az ESPN neveket kezeljük
            const teamNames = teams.map(t => t.team?.name);
            const matchResult = findBestMatch(teamName, teamNames);
            
            if (matchResult.bestMatch.rating > 0.6) { // Hasonlósági küszöb
                const bestMatch = teams[matchResult.bestMatchIndex];
                const teamId = bestMatch.team?.id;
                if (teamId) {
                    console.log(`API-FOOTBALL: ID találat "${teamName}" -> "${bestMatch.team?.name}" (Hasonlóság: ${(matchResult.bestMatch.rating * 100).toFixed(1)}%) -> ${teamId}`);
                    apiFootballTeamIdCache.set(cacheKey, teamId);
                    return teamId;
                }
            }
            console.warn(`API-FOOTBALL: Találatok (${teams.length}) "${teamName}"-re, de egyik sem elég hasonló (Legjobb: ${matchResult.bestMatch.target} @ ${(matchResult.bestMatch.rating * 100).toFixed(1)}%).`);
        }
        console.warn(`API-FOOTBALL: Nem található csapat ID ehhez: "${teamName}".`);
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (csapatkeresés "${teamName}"): ${error.response?.data?.message || error.message}`);
        apiFootballTeamIdCache.set(cacheKey, 'not_found');
        return null;
    }
}

async function getApiFootballLeagueId(leagueName, season) {
    if (!APIFOOTBALL_API_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, liga ID keresés kihagyva."); return null; }
    if (!leagueName || !season) { console.warn("API-FOOTBALL: Liga név vagy szezon hiányzik a liga ID kereséséhez."); return null; }

    const cacheKey = `apifootball_leagueid_${leagueName.toLowerCase().replace(/\s/g,'')}_${season}`;
    const cachedId = apiFootballLeagueIdCache.get(cacheKey);
    if (cachedId) return cachedId;

    const url = `${APIFOOTBALL_BASE_URL}/leagues?search=${encodeURIComponent(leagueName)}&season=${season}`;
    console.log(`API-FOOTBALL League Search: "${leagueName}" (${season})...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        if (response?.data?.response?.length > 0) {
            // A legjobb egyezés keresése
            const leagues = response.data.response;
            const leagueNames = leagues.map(l => l.league?.name);
            const matchResult = findBestMatch(leagueName, leagueNames);
            
            if (matchResult.bestMatch.rating > 0.7) {
                const bestMatch = leagues[matchResult.bestMatchIndex];
                const leagueId = bestMatch.league?.id;
                if (leagueId) {
                    console.log(`API-FOOTBALL: Liga ID találat "${leagueName}" -> "${bestMatch.league?.name}" -> ${leagueId}`);
                    apiFootballLeagueIdCache.set(cacheKey, leagueId);
                    return leagueId;
                }
            }
        }
        console.warn(`API-FOOTBALL: Nem található liga ID ehhez: "${leagueName}" (${season}).`);
        return null;
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (ligakeresés "${leagueName}"): ${error.message}`);
        return null;
    }
}

async function getApiFootballFixtureId(homeTeamId, awayTeamId, leagueId, season) {
    if (!homeTeamId || !awayTeamId || !leagueId || !season) {
        console.warn(`API-FOOTBALL: Fixture ID keresés kihagyva (hiányzó adatok): H:${homeTeamId}, A:${awayTeamId}, L:${leagueId}, S:${season}`);
        return null;
    }

    const cacheKey = `apifootball_fixtureid_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cachedId = apiFootballFixtureIdCache.get(cacheKey);
    if (cachedId) return cachedId;

    // A meccs keresése a következő 3 napban (az ESPN-től kapott dátum pontatlan lehet)
    const today = new Date().toISOString().split('T')[0];
    const url = `${APIFOOTBALL_BASE_URL}/fixtures?league=${leagueId}&season=${season}&team=${homeTeamId}&from=${today}&to=${new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]}`;
    
    console.log(`API-FOOTBALL Fixture Search: H:${homeTeamId} vs A:${awayTeamId} (L:${leagueId}, S:${season})...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        const fixtures = response?.data?.response;
        if (fixtures && fixtures.length > 0) {
            // Megkeressük azt a meccset, ahol a vendég is stimmel
            const fixture = fixtures.find(f => f.teams?.away?.id === awayTeamId && f.fixture?.status?.short !== 'FT');
            if (fixture) {
                const fixtureId = fixture.fixture.id;
                console.log(`API-FOOTBALL: Fixture ID találat -> ${fixtureId} (Dátum: ${fixture.fixture.date})`);
                apiFootballFixtureIdCache.set(cacheKey, fixtureId);
                return fixtureId;
            } else {
                console.warn(`API-FOOTBALL: Találatok a hazai csapatra (${fixtures.length}), de a vendég (${awayTeamId}) nem egyezik, vagy már lejátszották.`);
            }
        } else {
             console.warn(`API-FOOTBALL: Nem található Fixture ID a keresési feltételekre.`);
        }
        return null;
    } catch (error) {
         console.error(`API-FOOTBALL Hiba (fixture keresés): ${error.message}`);
         return null;
    }
}

async function getApiFootballH2H(homeTeamId, awayTeamId, limit = 5) {
    if (!APIFOOTBALL_API_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, H2H lekérés kihagyva."); return null; }
    
    if (!homeTeamId || !awayTeamId) {
        console.warn(`API-FOOTBALL H2H: Nem található mindkét csapat ID (H:${homeTeamId}, A:${awayTeamId}).`);
        return null;
    }

    try {
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().split('T')[0];

        const h2hUrl = `${APIFOOTBALL_BASE_URL}/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&from=${fromDate}&to=${toDate}`;
        console.log(`API-FOOTBALL H2H lekérés (ID-k alapján): ${homeTeamId} vs ${awayTeamId}...`);

        const response = await makeRequest(h2hUrl, { headers: APIFOOTBALL_HEADERS, timeout: 10000 }, 1);

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
        console.error(`API-FOOTBALL Hiba (H2H lekérés ${homeTeamId} vs ${awayTeamId}): ${error.response?.data?.message || error.message}`);
        return null;
    }
}

// --- ÚJ API-FOOTBALL FUNKCIÓK (A TSDB HELYETT) ---

async function getApiFootballLineups(fixtureId) {
    if (!fixtureId) return null;
    console.log(`API-FOOTBALL Kezdőcsapatok lekérése... (Fixture: ${fixtureId})`);
    const url = `${APIFOOTBALL_BASE_URL}/fixtures/lineups?fixture=${fixtureId}`;
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
    const url = `${APIFOOTBALL_BASE_URL}/fixtures/statistics?fixture=${fixtureId}`;
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
    if (cachedStats) return cachedStats;

    console.log(`API-FOOTBALL Szezon Stat lekérés: T:${teamId}, L:${leagueId}, S:${season}...`);
    const url = `${APIFOOTBALL_BASE_URL}/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS }, 1);
        const stats = response?.data?.response;
        if (stats) {
            console.log(`API-FOOTBALL: Szezon statisztika sikeresen lekérve (${stats.league?.name}).`);
            // Létrehozunk egy egyszerűsített statisztikai objektumot a Gemini számára
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
            console.warn(`API-FOOTBALL: Nem található szezon statisztika (T:${teamId}, L:${leagueId}, S:${season}).`);
            return null;
        }
    } catch (error) {
        console.error(`API-FOOTBALL Hiba (team statistics T:${teamId}): ${error.message}`);
        return null;
    }
}

// --- FŐ ADATGYŰJTŐ FUNKCIÓ (ÁTÍRVA v14) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v43_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    
    // Gyorsítótárazás (az Odds-ot kivéve, azt mindig frissen kérjük)
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
        console.log(`Adatgyűjtés indul (v14 - API-Football): ${homeTeamName} vs ${awayTeamName}...`);
        
        const season = new Date(utcKickoff).getFullYear(); // Meghatározzuk a szezont az ESPN dátumból

        // 1. LÉPÉS: Azonosítók lekérése (ESPN neveket használva)
        const [homeTeamId, awayTeamId, leagueId] = await Promise.all([
            getApiFootballTeamId(homeTeamName), // ESPN név -> API-F ID
            getApiFootballTeamId(awayTeamName), // ESPN név -> API-F ID
            getApiFootballLeagueId(leagueName, season)
        ]);

        if (!homeTeamId || !awayTeamId || !leagueId) {
            console.error(`KRITIKUS AZONOSÍTÓ HIBA (${homeTeamName} vs ${awayTeamName}): Nem található azonosító. Home: ${homeTeamId}, Away: ${awayTeamId}, League: ${leagueId}`);
            throw new Error(`Alapvető API-Football azonosítók hiányoznak. Az ESPN nevek (${homeTeamName}, ${awayTeamName}) vagy a liga (${leagueName}) nem mapelhető.`);
        }

        // 2. LÉPÉS: Fixture ID lekérése (a kezdőcsapathoz és meccs-stat-hoz kell)
        const fixtureId = await getApiFootballFixtureId(homeTeamId, awayTeamId, leagueId, season);
        if (!fixtureId) {
            console.warn(`API-Football: Nem található 'fixture_id'. A kezdőcsapatok és az élő meccs-statisztikák valószínűleg hiányozni fognak. (Ez meccs napja előtt normális lehet)`);
        }

        // 3. LÉPÉS: Párhuzamos adatgyűjtés
        const [
            fetchedOddsData,
            apiFootballH2HData,
            apiFootballLineups,
            apiFootballStats, // Ez csak lejátszott meccseknél fog adatot adni, de hátha...
            apiFootballHomeSeasonStats,
            apiFootballAwaySeasonStats
        ] = await Promise.all([
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName), // ÚJ ODDS API
            getApiFootballH2H(homeTeamId, awayTeamId, 5), // H2H (ID alapján)
            fixtureId ? getApiFootballLineups(fixtureId) : Promise.resolve(null), // Kezdőcsapatok
            fixtureId ? getApiFootballStats(fixtureId) : Promise.resolve(null), // Meccs statisztika
            getApiFootballTeamSeasonStats(homeTeamId, leagueId, season), // Hazai szezon stat
            getApiFootballTeamSeasonStats(awayTeamId, leagueId, season) // Vendég szezon stat
        ]);

        // 4. LÉPÉS: Gemini hívás az összegyűjtött adatokkal
        const geminiJsonString = await _callGemini(PROMPT_V43(
            sport, homeTeamName, awayTeamName,
            apiFootballHomeSeasonStats, apiFootballAwaySeasonStats,
            apiFootballH2HData, apiFootballLineups
        ));

        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; } catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500)); }
        
        // Alapértelmezett struktúra, ha a Gemini hibázik
        if (!geminiData || typeof geminiData !== 'object') {
             geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home: {}, away: {} }, tactical_patterns: { home: [], away: [] }, key_matchups: {}, advanced_stats_team: { home: {}, away: {} }, advanced_stats_goalie: { home_goalie: {}, away_goalie: {} }, shot_distribution: {}, defensive_style: {}, absentees: { home: [], away: [] }, team_news: { home: "N/A", away: "N/A" }, h2h_structured: [] };
        }

        // 5. LÉPÉS: Adatok finalizálása
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
        const finalData = {};

        // Statisztikák összesítése: Elsődlegesen az API-Football szezon statisztikákat használjuk
        const parseStat = (val, d = null) => { if (val === null || val === undefined || val === "N/A") return d; const n = Number(val); return (!isNaN(n) && n >= 0) ? n : d; };

        const homeGp = parseStat(apiFootballHomeSeasonStats?.gamesPlayed, parseStat(geminiData?.stats?.home?.gp, 1));
        const homeGf = parseStat(apiFootballHomeSeasonStats?.goalsFor, parseStat(geminiData?.stats?.home?.gf, null));
        const homeGa = parseStat(apiFootballHomeSeasonStats?.goalsAgainst, parseStat(geminiData?.stats?.home?.ga, null));
        const awayGp = parseStat(apiFootballAwaySeasonStats?.gamesPlayed, parseStat(geminiData?.stats?.away?.gp, 1));
        const awayGf = parseStat(apiFootballAwaySeasonStats?.goalsFor, parseStat(geminiData?.stats?.away?.gf, null));
        const awayGa = parseStat(apiFootballAwaySeasonStats?.goalsAgainst, parseStat(geminiData?.stats?.away?.ga, null));
        
        finalData.stats = { home: { gp: homeGp, gf: homeGf, ga: homeGa }, away: { gp: awayGp, gf: awayGf, ga: awayGa } };
        console.log(`Végleges stats használatban: Home(GP:${homeGp ?? 'N/A'}, GF:${homeGf ?? 'N/A'}, GA:${homeGa ?? 'N/A'}), Away(GP:${awayGp ?? 'N/A'}, GF:${awayGf ?? 'N/A'}, GA:${awayGa ?? 'N/A'})`);

        // A TSDB adatok helyett az új API-Football adatokat csomagoljuk
        const apiFootballData = {
            homeTeamId, awayTeamId, leagueId, fixtureId,
            lineups: apiFootballLineups,
            liveStats: apiFootballStats, // Ezek az API-F statok, ha vannak
            seasonStats: { home: apiFootballHomeSeasonStats, away: apiFootballAwaySeasonStats }
        };
        finalData.sportsDbData = apiFootballData; // A változó nevét ("sportsDbData") meghagyjuk, hogy a kód többi része ne törjön el

        finalData.h2h_structured = apiFootballH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        
        // Forma: Elsődlegesen az API-Football formát használjuk, ha van
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
            structuredWeather ? `- Időjárás: ${structuredWeather.precipitation_mm ?? '?'}mm csap, ${structuredWeather.wind_speed_kmh ?? '?'}km/h szél.` : (finalData.contextual_factors?.weather ? `- Időjárás: ${finalData.contextual_factors.weather}` : `- Időjárás: N/A`),
            finalData.contextual_factors?.pitch_condition && finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advancedData, form: finalData.form, rawData: finalData };

        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' || typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.warn(`FIGYELMEZTETÉS (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}. Lehet, hogy a szezon eleje van, vagy a Gemini nem adott adatot.`);
            // Szezon eleji meccseknél ez előfordulhat, nem dobunk hibát, de logolunk.
            // A 'default xG' hiba elkerülése érdekében állítsunk be egy minimális GP-t, ha hiányzik
            if (result.rawStats.home.gp <= 0) result.rawStats.home.gp = 1;
            if (result.rawStats.away.gp <= 0) result.rawStats.away.gp = 1;
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v14: API-Football + Új Odds API), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v14) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v14): ${e.message}`);
    }
}

// --- GEMINI PROMPT (ÚJ v43) ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiFootballHomeSeasonStats, apiFootballAwaySeasonStats, apiFootballH2HData, apiFootballLineups) {
    
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Football season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats (gp, gf, ga).\n";
    if (apiFootballHomeSeasonStats || apiFootballAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats (gp, gf, ga, form) have been PRE-CALCULATED from API-Football. Use these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
        if (apiFootballHomeSeasonStats) {
            calculatedStatsInfo += `Home Calculated (GP=${apiFootballHomeSeasonStats.gamesPlayed ?? 'N/A'}, GF=${apiFootballHomeSeasonStats.goalsFor ?? 'N/A'}, GA=${apiFootballHomeSeasonStats.goalsAgainst ?? 'N/A'}, Form=${apiFootballHomeSeasonStats.form ?? 'N/A'})\n`;
        }
        if (apiFootballAwaySeasonStats) {
            calculatedStatsInfo += `Away Calculated (GP=${apiFootballAwaySeasonStats.gamesPlayed ?? 'N/A'}, GF=${apiFootballAwaySeasonStats.goalsFor ?? 'N/A'}, GA=${apiFootballAwaySeasonStats.goalsAgainst ?? 'N/A'}, Form=${apiFootballAwaySeasonStats.form ?? 'N/A'})\n`;
        }
    }

    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-FOOTBALL. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiFootballH2HData && Array.isArray(apiFootballH2HData) && apiFootballH2HData.length > 0) {
        const h2hString = apiFootballH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-FOOTBALL, Last ${apiFootballH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields. Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiFootballH2HData)}\n`;
    }

    let lineupInfo = "NOTE ON LINEUPS: No API-Football lineup data available (this is normal if the match is far away). Analyze absentees and formation based on your general knowledge and recent news.\n";
    if (apiFootballLineups && apiFootballLineups.length > 0) {
        lineupInfo = `CRITICAL LINEUP DATA (from API-Football): ${JSON.stringify(apiFootballLineups)}\nUse THIS data *first* to determine absentees, key players, and formation. This is more reliable than general knowledge.\n`;
    }

    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. **CRITICAL: You MUST use the latest factual data provided below (API-Football) over your general knowledge.**
${calculatedStatsInfo}
${h2hInfo}
${lineupInfo}
AVAILABLE FACTUAL DATA (From API-Football):
- Home Season Stats: ${JSON.stringify(apiFootballHomeSeasonStats || 'N/A')}
- Away Season Stats: ${JSON.stringify(apiFootballAwaySeasonStats || 'N/A')}
- Recent H2H: ${h2hInfo.substring(0, 300)}...
- Lineups: ${lineupInfo.substring(0, 300)}...

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga. **USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-FOOTBALL H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. **(CRITICAL: Use the API-Football LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall). **(CRITICAL: Use the 'Form' string from the API-Football Season Stats provided above.)**
5. Key Players: name, role, recent key stat. **(Use API-Football LINEUP data to see who is starting).**
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

// --- ODDS API FUNKCIÓK (ÚJ v14 - RapidAPI "Odds Feed by Tipsters CO") ---
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    // Ellenőrizzük az ÚJ kulcsokat
    if (!RAPIDAPI_ODDS_API_KEY || !RAPIDAPI_ODDS_HOST) {
        console.warn(`Odds API (RapidAPI): Hiányzó kulcs/host. Odds lekérés kihagyva.`);
        return null;
    }
    
    // Az "Odds Feed by Tipsters CO" API /v1/markets végpontját használja
    // Ez a végpont általában sportág és régió szerint szűr (a kép alapján)
    // Most egy általánosabb keresést feltételezünk, pl. esemény név alapján,
    // vagy egy sport-specifikus végpontot, ahogy az előző API-d.
    // Mivel az API-juk (a kép alapján) nem listáz egyértelmű keresési végpontot,
    // egy feltételezett /events vagy /markets végpontot használunk.
    // A PONTOS URL-t és paramétereket neked kell beállítanod a RapidAPI dokumentációja alapján.
    
    // --- FELTÉTELEZETT PÉLDA /v1/markets hívásra ---
    // Ezt a részt cseréld le a te API-d valós végpontjára és logikájára!
    
    const rapidApiHeaders = {
        'x-rapidapi-key': RAPIDAPI_ODDS_API_KEY,
        'x-rapidapi-host': RAPIDAPI_ODDS_HOST
    };

    // 1. LÉPÉS: Keressük meg az eseményt (Event ID)
    // Feltételezzük, hogy van egy /events végpont, ami név alapján keres
    let eventId = null;
    let apiHomeTeam = null;
    let apiAwayTeam = null;
    const searchUrl = `https://${RAPIDAPI_ODDS_HOST}/v1/events?sport=${sport}&search=${encodeURIComponent(homeTeam)}`;
    console.log(`Odds API (RapidAPI): Esemény keresése... URL: ${searchUrl}`);
    
    try {
        const eventsResponse = await makeRequest(searchUrl, { headers: rapidApiHeaders, timeout: 10000 });
        if (!eventsResponse?.data?.data || !Array.isArray(eventsResponse.data.data)) {
            console.warn(`Odds API (RapidAPI): Érvénytelen/üres válasz az /events végpontról.`);
            return null;
        }

        const events = eventsResponse.data.data;
        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.60;

        for (const event of events) {
            if (!event?.home || !event?.away) continue;
            const apiHomeLower = event.home.toLowerCase().trim();
            const apiAwayLower = event.away.toLowerCase().trim();
            
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            
            const combinedSim = (homeMatchResult.bestMatch.rating + awayMatchResult.bestMatch.rating) / 2;

            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = event;
            }
        }
        
        if (!bestMatch) {
            console.warn(`Odds API (RapidAPI): Nem található esemény egyezés ehhez: ${homeTeam} vs ${awayTeam}.`);
            return null;
        }
        
        eventId = bestMatch.event_id; // Feltételezett mezőnév
        apiHomeTeam = bestMatch.home;
        apiAwayTeam = bestMatch.away;
        console.log(`Odds API (RapidAPI): Esemény találat ${apiHomeTeam} vs ${apiAwayTeam} (ID: ${eventId}).`);

    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI /events keresés) során: ${e.message}`, e.stack);
        return null;
    }

    if (!eventId) return null;

    // 2. LÉPÉS: Odds lekérése az Event ID alapján (a képen látható /v1/markets végpont)
    const marketsUrl = `https://${RAPIDAPI_ODDS_HOST}/v1/markets?event_id=${eventId}`;
    console.log(`Odds API (RapidAPI): Piacok lekérése... URL: ${marketsUrl}`);
    
    try {
        const marketsResponse = await makeRequest(marketsUrl, { headers: rapidApiHeaders, timeout: 10000 });
        const marketsData = marketsResponse?.data?.data; // Feltételezett válasz struktúra
        
        if (!marketsData || !Array.isArray(marketsData)) {
            console.warn(`Odds API (RapidAPI): Nem található piac ehhez az eseményhez: ${eventId}`);
            return null;
        }

        const currentOdds = [];
        const allMarkets = marketsData; // Elmentjük az összes piacot későbbre

        // Pinnacle (vagy a kívánt bukméker) keresése. A "Tipsters CO" valószínűleg aggregál.
        // Tegyük fel, hogy a legjobb oddsot adja, vagy egy specifikus bukmékert kell keresni.
        // Egyszerűsítsük: Tegyük fel, hogy a /markets végpont visszaadja a H2H és Totals piacokat.
        
        const h2hMarket = marketsData.find(m => m.market_name === 'Match Winner' || m.market_name === 'H2H');
        if (h2hMarket?.outcomes && Array.isArray(h2hMarket.outcomes)) {
            h2hMarket.outcomes.forEach(o => {
                if (o?.price && typeof o.price === 'number' && o.price > 1) {
                    let n = o.name;
                    if (n.toLowerCase() === apiHomeTeam.toLowerCase()) n = 'Hazai győzelem';
                    else if (n.toLowerCase() === apiAwayTeam.toLowerCase()) n = 'Vendég győzelem';
                    else if (n.toLowerCase() === 'draw') n = 'Döntetlen';
                    currentOdds.push({ name: n, price: o.price });
                }
            });
        } else { console.warn(`Odds API (RapidAPI): Nincs H2H piac: ${eventId}`); }

        const totalsMarket = marketsData.find(m => m.market_name === 'Total Goals' || m.market_name === 'Totals');
        if (totalsMarket?.outcomes && Array.isArray(totalsMarket.outcomes)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            console.log(`Odds API (RapidAPI): Fő Totals vonal: ${mainLine}`);
            
            const overOutcome = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Over');
            const underOutcome = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Under');
            
            if (overOutcome?.price > 1) { currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price }); }
            if (underOutcome?.price > 1) { currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price }); }
        } else { console.warn(`Odds API (RapidAPI): Nincs Totals piac: ${eventId}`); }
        
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;

    } catch (e) {
        console.error(`Hiba getOddsData (RapidAPI /markets lekérés) során: ${e.message}`, e.stack);
        return null;
    }
}

// Odds cache-elő wrapper (VÁLTOZATLAN)
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!RAPIDAPI_ODDS_API_KEY) { // Az új kulcsot ellenőrizzük
        console.warn("RapidAPI Odds API kulcs hiányzik, odds lekérés kihagyva.");
        return null;
    }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v14_rapidapi_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        return { ...cached, fromCache: true };
    }
    
    // Az ÚJ getOddsData funkciót hívja
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    
    // A fallback logikát (ha van) itt lehet hagyni
    if (!liveOdds && leagueName) {
        console.log(`Odds API (RapidAPI): Specifikus liga (${leagueName}) sikertelen, próbálkozás alap sport kulccsal...`);
        liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
    }

    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        return { ...liveOdds, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni (RapidAPI): ${homeTeam} vs ${awayTeam}`);
    return null;
}

// Névgenerátor segédfüggvény (VÁLTOZATLAN)
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.|us)\s+/i, '').trim());
    if (lowerName === 'manchester united') variations.add('man united');
    if (lowerName === 'manchester city') variations.add('man city');
    if (lowerName === 'tottenham hotspur') variations.add('tottenham');
    if (lowerName === 'golden knights') variations.add('vegas golden knights');
    return Array.from(variations).filter(name => name && name.length > 2);
}

// Fő vonal kereső (VÁLTOZATLAN)
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals' || m.market_name === 'Totals'); // Kiegészítve az új API-hoz
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number' && !isNaN(p)))];
    if (points.length === 0) return defaultLine;
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && (o.name === 'Over' || o.name === 'Over'));
        const under = totalsMarket.outcomes.find(o => o.point === point && (o.name === 'Under' || o.name === 'Under'));
        if (over?.price && typeof over.price === 'number' && under?.price && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price);
            if (diff < closestPair.diff) {
                closestPair = { diff, line: point };
            }
        }
    }
    if (closestPair.diff < 0.5) return closestPair.line;
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return points[0];
}

// --- ESPN MECCSLEKÉRDEZÉS (VÁLTOZATLAN, A TE KÉRÉSEDRE) ---
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
                        return null;
                    }
                }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400 || error.message.includes('404')) {
                    console.warn(`ESPN Hiba (40x): Lehetséges, hogy rossz a slug '${slug}' (${leagueName})? URL: ${url}`);
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
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}
