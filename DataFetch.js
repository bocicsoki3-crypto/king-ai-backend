// --- VÉGLEGES JAVÍTOTT (v15) datafetch.js ---
// API Sports Hockey/Basketball (kivéve NBA), ESPN Soccer/NBA, Weather Fix, Cache v15

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY, APIFOOTBALL_API_KEY
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Cache inicializálás (v15 kulcsokkal) ---
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false }); // Fő elemzés cache
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); // Odds cache
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // Sportmonks ID (végtelen TTL)

// TheSportsDB Caches
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600, useClones: false }); // Általános TSDB cache
const sportsDbLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 2, useClones: false }); // TSDB Liga ID

// API-FOOTBALL / API Sports Caches (v15 kulcsokkal)
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballFixtureIdCache = new NodeCache({ stdTTL: 3600 * 12, checkperiod: 3600 });
const apiFootballPlayersCache = new NodeCache({ stdTTL: 3600 * 12, checkperiod: 3600 });
const apiFootballMatchesCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600 });
const apiFootballLineupsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 1800 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 1800 });
const apiSportsFixturesCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 300 }); // 1 óra TTL a meccslistáknak


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEAGUES_DB_PATH = path.join(__dirname, 'leagues_db.json');

let localLeaguesCache = null;

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* JAVÍTÁS (2025-10-28 v15):
* - Új funkció: `_getFixturesFromApiSports` Hockey/Basketball meccsek lekérésére
* (kivéve NBA).
* - API-Football Free Tier Kompatibilitás javítások.
* - Csapatkeresés (`getApiFootballTeamId`) finomítása.
* - Időjárás (`getStructuredWeatherData`) hívás logikája javítva.
* - Hiányzó konstansok (`APIFOOTBALL_BASE_URL`) és funkciók (`getStructuredWeatherData`) pótolva.
* - Duplikált funkciók eltávolítva.
* - Cache kulcsok v15-re frissítve.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    const apiSportsKey = config?.headers?.['x-apisports-key'] || APIFOOTBALL_API_KEY; // API Sports (foci, hoki, kosár)
    const tsdbKey = config?.headers?.['X-API-KEY'] || THESPORTSDB_API_KEY; // TheSportsDB
    const oddsKey = config?.headers?.['X-API-KEY'] === ODDS_API_KEY ? ODDS_API_KEY : ''; // Odds API (csak ha expliciten adjuk meg)
    let displayUrl = url;
    if (apiSportsKey && displayUrl.includes(apiSportsKey)) displayUrl = displayUrl.replace(apiSportsKey, '<apifootball_key>');
    if (tsdbKey && displayUrl.includes(tsdbKey)) displayUrl = displayUrl.replace(tsdbKey, '<tsdb_key>');
    if (oddsKey && displayUrl.includes(oddsKey)) displayUrl = displayUrl.replace(oddsKey, '<odds_key>');
    displayUrl = displayUrl.replace(/apiKey=([^&]+)/, 'apiKey=<apikey>');

    while (attempts <= retries) {
        try {
            const baseConfig = { timeout: 15000, validateStatus: (status) => status >= 200 && status < 500, headers: {} };
            const currentHeaders = { ...baseConfig.headers, ...config?.headers };
            const currentConfig = { ...baseConfig, ...config, headers: currentHeaders };
            let response;
            if (method === 'POST') { response = await axios.post(url, currentConfig.data || {}, currentConfig); }
            else { response = await axios.get(url, currentConfig); }
            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${displayUrl.substring(0, 100)}...)`);
                error.response = response;
                const apiMessage = response?.data?.Message || response?.data?.message || response?.data?.error || JSON.stringify(response?.data)?.substring(0, 100);
                if (url.includes('thesportsdb') && apiMessage) { error.message += ` - TheSportsDB: ${apiMessage}`; }
                if (url.includes('api-sports.io') && apiMessage) { error.message += ` - API Sports: ${apiMessage}`; }
                if (url.includes('the-odds-api') && apiMessage) { error.message += ` - OddsAPI: ${apiMessage}`; }
                if ([401, 403, 499].includes(response.status) || (typeof apiMessage === 'string' && (apiMessage.includes('Invalid API key') || apiMessage.includes('authentication failed')))) { console.error(`Hitelesítési Hiba (${response.status})! URL: ${displayUrl.substring(0, 100)}...`); error.isAuthError = true; throw error; }
                if (response.status === 429 || (response.data?.errors?.requests) || (typeof apiMessage === 'string' && apiMessage.includes('quota'))) { console.warn(`API Hiba: Túl sok kérés / Kvóta elérve (${response.status}). URL: ${displayUrl.substring(0, 100)}...`); error.isRateLimitOrQuota = true; throw error; }
                if (response.status === 422) { console.warn(`API Hiba: Feldolgozhatatlan kérés (422). URL: ${displayUrl.substring(0, 100)}... Válasz: ${apiMessage}`); throw error; }
                if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${displayUrl}`); throw error; }
                throw error;
            }
            if(url.includes('api-sports.io') && response.data?.errors && Object.keys(response.data.errors).length > 0) {
                const apiErrorMsg = JSON.stringify(response.data.errors);
                if (apiErrorMsg.includes('credits') || apiErrorMsg.includes('quota') || apiErrorMsg.includes('limit')) {
                    console.error(`API-Sports Kvóta/Limit hiba: ${apiErrorMsg} (URL: ${displayUrl.substring(0,100)}...)`);
                    const error = new Error(`API-Sports Kvóta/Limit hiba: ${apiErrorMsg}`);
                    error.isQuotaError = true; error.response = response; throw error;
                } else { console.warn(`API-Sports logikai hiba a válaszban: ${apiErrorMsg} (URL: ${displayUrl.substring(0,100)}...)`); }
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${displayUrl.substring(0, 150)}... - `;
            if (error.response) { errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`; }
            else if (error.request) { errorMessage += `Timeout (${config?.timeout || 15000}ms) vagy nincs válasz.`; }
            else { errorMessage += `Hiba: ${error.message}`; }
            const shouldRetry = !error.isAuthError && !error.isRateLimitOrQuota && !error.isQuotaError && error.response?.status !== 404 && error.response?.status !== 422 && attempts <= retries;
            if (shouldRetry) { console.warn(errorMessage + " Újrapróbálkozás..."); await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); }
            else {
                if(error.isAuthError || error.isRateLimitOrQuota || error.isQuotaError || error.response?.status === 422){ console.error(errorMessage + " Kritikus hiba, nincs újrapróbálkozás."); }
                else if (error.response?.status === 404){ console.warn(errorMessage + " Erőforrás nem található."); }
                else if (attempts > retries) { console.error(errorMessage + " Nincs több újrapróbálkozás."); }
                else { console.error(errorMessage + " Ismeretlen kritikus hiba."); }
                return null;
            }
        }
    }
    console.error(`API (${method}) hívás váratlanul véget ért a ciklus után: ${displayUrl.substring(0, 150)}...`);
    return null;
}

// --- SPORTMONKS API ---
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

// --- GEMINI API FUNKCIÓ ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", }, };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await makeRequest(url, { method: 'POST', data: payload, headers: { 'Content-Type': 'application/json' }, timeout: 120000 }, 0);
        if (!response) { throw new Error("Gemini API hívás sikertelen (makeRequest hiba)."); }
        console.log(`Gemini API válasz státusz: ${response.status}`);
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
        if (jsonMatch && jsonMatch[1]) { console.log("Tisztítás: ```json``` körítés eltávolítva."); potentialJson = jsonMatch[1].trim(); }
        const firstBrace = potentialJson.indexOf('{'); const lastBrace = potentialJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) { potentialJson = potentialJson.substring(firstBrace, lastBrace + 1); }
        else if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) { console.error("A kapott válasz tisztítás után sem tűnik JSON objektumnak:", potentialJson.substring(0, 500)); throw new Error("A Gemini válasza nem volt felismerhető JSON formátumú."); }
        try {
            JSON.parse(potentialJson); console.log("Gemini API válasz sikeresen validálva JSON-ként."); return potentialJson;
        } catch (parseError) { console.error("A Gemini válasza a tisztítási kísérlet után sem volt valid JSON:", potentialJson.substring(0, 500), parseError); throw new Error(`A Gemini válasza nem volt érvényes JSON: ${parseError.message}`); }
    } catch (e) { console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack); throw e; }
}

// --- THESPORTSDB FUNKCIÓK (Liga & Csapat ID keresés) ---
const TSDB_HEADERS = { 'X-API-KEY': THESPORTSDB_API_KEY };
async function loadLeaguesFromFile() {
    if (localLeaguesCache) { return localLeaguesCache; }
    try {
        const data = await fs.readFile(LEAGUES_DB_PATH, 'utf8');
        localLeaguesCache = JSON.parse(data);
        console.log(`Helyi liga adatbázis (${localLeaguesCache.length} liga) sikeresen betöltve.`);
        return localLeaguesCache;
    } catch (error) {
        if (error.code === 'ENOENT') { console.warn(`Helyi liga adatbázis (${LEAGUES_DB_PATH}) még nem létezik. Futtasd a liga letöltést.`); localLeaguesCache = []; return localLeaguesCache; }
        console.error(`Hiba a helyi liga adatbázis betöltésekor (${LEAGUES_DB_PATH}): ${error.message}`); return null;
    }
}
export async function fetchAndSaveLeagues() {
    console.log("Összes liga lekérése a TheSportsDB-től...");
    if (!THESPORTSDB_API_KEY) { console.error("TheSportsDB API kulcs hiányzik a liga lista lekéréséhez."); return; }
    const url = `https://www.thesportsdb.com/api/v2/json/all/leagues`;
    const config = { headers: TSDB_HEADERS, method: 'GET', timeout: 30000 };
    try {
        const response = await makeRequest(url, config, 0);
        const leagues = response?.data?.all || response?.data?.leagues;
        if (leagues && Array.isArray(leagues) && leagues.length > 0) {
            const leaguesToSave = leagues.map(l => ({ idLeague: l.idLeague, strLeague: l.strLeague, strSport: l.strSport, strLeagueAlternate: l.strLeagueAlternate }));
            await fs.writeFile(LEAGUES_DB_PATH, JSON.stringify(leaguesToSave, null, 2), 'utf8');
            console.log(`Sikeresen lekért és elmentett ${leaguesToSave.length} ligát ide: ${LEAGUES_DB_PATH}`);
            localLeaguesCache = leaguesToSave;
        } else { console.error("Nem sikerült lekérni vagy üres a liga lista a TheSportsDB-től.", response?.data); }
    } catch (error) { console.error(`Hiba történt a ligák lekérése vagy mentése során: ${error.message}`); }
}
async function getSportsDbLeagueId(leagueName) {
    if (!leagueName) return null;
    const originalLowerLeagueName = leagueName.toLowerCase().trim();
    const leagues = await loadLeaguesFromFile();
    if (leagues && leagues.length > 0) {
        const variations = [...new Set([leagueName.trim(), originalLowerLeagueName, leagueName.trim().replace(/\s+/g, '_'), leagueName.trim().replace('-', ' ')])];
        for (const variation of variations) {
            const lowerVariation = variation.toLowerCase();
            const foundLeague = leagues.find(l => l.strLeague?.toLowerCase() === lowerVariation || l.strLeagueAlternate?.toLowerCase().split(',').map(alt => alt.trim()).includes(lowerVariation));
            if (foundLeague && foundLeague.idLeague) { console.log(`TheSportsDB: Liga ID találat (HELYI) "${leagueName}" -> "${foundLeague.strLeague}" (${foundLeague.strSport}) -> ${foundLeague.idLeague}`); return foundLeague.idLeague; }
        }
        console.log(`TheSportsDB: Nem található "${leagueName}" a helyi liga adatbázisban (${leagues.length} átnézve). API hívás következik...`);
    } else if (leagues) { console.warn("Helyi liga adatbázis üres. API hívás következik..."); }
    else { console.warn("Nem sikerült betölteni a helyi liga adatbázist, API hívás következik..."); }
    const apiFriendlyLeagueName = leagueName.trim().replace(/\s+/g, '_');
    const cacheKey = `tsdb_leagueid_v15_api_${encodeURIComponent(apiFriendlyLeagueName.toLowerCase())}`;
    const cachedId = sportsDbLeagueIdCache.get(cacheKey);
    if (cachedId !== undefined) return cachedId === 'not_found' ? null : cachedId;
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik a liga API kereséséhez."); return null; }
    const config = { headers: TSDB_HEADERS, method: 'GET' };
    const url = `https://www.thesportsdb.com/api/v2/json/search/league/${encodeURIComponent(apiFriendlyLeagueName)}`;
    console.log(`TheSportsDB V2 League Search próbálkozás (API): URL=${url.replace(THESPORTSDB_API_KEY,'<apikey>')}`);
    try {
        const response = await makeRequest(url, config);
        const leaguesArray = response?.data?.search || response?.data?.countrys;
        if (leaguesArray && Array.isArray(leaguesArray) && leaguesArray.length > 0) {
            const bestMatch = leaguesArray.find(l => l.strLeague?.toLowerCase() === originalLowerLeagueName) || leaguesArray[0];
            const leagueId = bestMatch.idLeague;
            console.log(`TheSportsDB: Liga ID találat (API) "${leagueName}" (${apiFriendlyLeagueName}) -> "${bestMatch.strLeague}" (${bestMatch.strSport}) -> ${leagueId}`);
            sportsDbLeagueIdCache.set(cacheKey, leagueId); return leagueId;
        } else { console.warn(`TheSportsDB: Nem található liga ID (API) ehhez: "${leagueName}" (${apiFriendlyLeagueName}). Válasz:`, JSON.stringify(response?.data).substring(0, 100)); sportsDbLeagueIdCache.set(cacheKey, 'not_found'); return null; }
    } catch (error) { console.error(`TheSportsDB Hiba (API liga keresés "${leagueName}"): ${error.message}`); sportsDbLeagueIdCache.set(cacheKey, 'not_found'); return null; }
}
async function getSportsDbTeamId(teamName, sport, leagueName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const leaguePart = leagueName ? `_${encodeURIComponent(leagueName.toLowerCase().replace(/\s+/g, ''))}` : '_noleague';
    const cacheKey = `tsdb_teamid_v15_final_${sport}_${leaguePart}_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }
    const config = { headers: TSDB_HEADERS, method: 'GET' };
    let teamId = null; const sportNameMapping = { soccer: 'Soccer', hockey: 'Ice Hockey', basketball: 'Basketball' }; const targetSportName = sportNameMapping[sport];
    if (leagueName && targetSportName) {
        console.log(`TheSportsDB ID Keresés (Liga-alapú) "${teamName}" (${leagueName})...`);
        const leagueId = await getSportsDbLeagueId(leagueName);
        if (leagueId) {
            const listUrl = `https://www.thesportsdb.com/api/v2/json/list/teams/${leagueId}`;
            console.log(`TheSportsDB V2 Team List próbálkozás (Liga ID: ${leagueId}): URL=${listUrl.replace(THESPORTSDB_API_KEY,'<apikey>')}`);
            try {
                const listResponse = await makeRequest(listUrl, config);
                const teamsInLeague = listResponse?.data?.list || listResponse?.data?.teams;
                if (teamsInLeague && Array.isArray(teamsInLeague) && teamsInLeague.length > 0) {
                    const teamNamesFromLeague = teamsInLeague.map(t => t.strTeam); const matchResult = findBestMatch(teamName, teamNamesFromLeague);
                    if (matchResult.bestMatch.rating > 0.6) { const foundTeam = teamsInLeague[matchResult.bestMatchIndex]; teamId = foundTeam.idTeam; console.log(`TheSportsDB (Liga-lista): ID találat "${teamName}" -> "${foundTeam.strTeam}" (Hasonlóság: ${(matchResult.bestMatch.rating * 100).toFixed(1)}%) -> ${teamId}`); }
                    else { console.warn(`TheSportsDB (Liga-lista): Nem található elég hasonló csapatnév "${teamName}"-hez a(z) "${leagueName}" ligában. Legjobb tipp: ${matchResult.bestMatch.target} (${(matchResult.bestMatch.rating * 100).toFixed(1)}%).`); }
                } else { console.warn(`TheSportsDB (Liga-lista): Nem sikerült lekérni vagy üres a csapatlista a(z) ${leagueId} (${leagueName}) ligához.`); }
            } catch (error) { console.error(`TheSportsDB Hiba (liga csapatlista ${leagueId}): ${error.message}`); }
        } else { console.warn(`TheSportsDB (Liga-alapú): Nem található liga ID ehhez: "${leagueName}". Fallback.`); }
    } else { console.log(`TheSportsDB: Liga név (${leagueName}) vagy sport (${targetSportName}) hiányzik. Fallback...`); }
    if (!teamId && targetSportName) {
        console.log(`TheSportsDB ID Keresés (Fallback) "${teamName}" (${sport})...`);
        const namesToTry = generateTeamNameVariations(teamName);
        for (const searchName of namesToTry) {
            const apiFriendlySearchName = searchName.trim().replace(/\s+/g, '_');
            const searchUrl = `https://www.thesportsdb.com/api/v2/json/search/team/${encodeURIComponent(apiFriendlySearchName)}`;
            console.log(`TheSportsDB V2 Team Search (Fallback): URL=${searchUrl.replace(THESPORTSDB_API_KEY,'<apikey>')}`);
            try {
                const response = await makeRequest(searchUrl, config);
                const teamsArray = response?.data?.search;
                if (teamsArray && Array.isArray(teamsArray) && teamsArray.length > 0) {
                    const teamsInSport = teamsArray.filter(t => t.strSport && t.strSport.toLowerCase() === targetSportName.toLowerCase());
                    if (teamsInSport.length > 0) {
                        if (teamsInSport.length === 1) { teamId = teamsInSport[0].idTeam; console.log(`TheSportsDB (Fallback/Szűrt): ID találat "${searchName}" -> "${teamsInSport[0].strTeam}" (${sport}) -> ${teamId}`); }
                        else {
                            const teamNamesFromSport = teamsInSport.map(t => t.strTeam); const bestApiMatch = findBestMatch(teamName, teamNamesFromSport);
                            if (bestApiMatch.bestMatch.rating > 0.65) { const foundTeam = teamsInSport[bestApiMatch.bestMatchIndex]; teamId = foundTeam.idTeam; console.log(`TheSportsDB (Fallback/Szűrt): Több találat, legjobb választva "${teamName}" -> "${foundTeam.strTeam}" (${sport}, Hasonlóság: ${(bestApiMatch.bestMatch.rating * 100).toFixed(1)}%) -> ${teamId}`); }
                            else { console.warn(`TheSportsDB (Fallback/Szűrt): Több találat "${searchName}"-re (${sport}), de egyik sem elég hasonló. Első ${sport} találat használva.`); teamId = teamsInSport[0].idTeam; console.log(`TheSportsDB (Fallback/Szűrt): Első ${sport} találat: "${teamsInSport[0].strTeam}" -> ${teamId}`); }
                        }
                        break;
                    } else { console.warn(`TheSportsDB (Fallback): Találatok "${searchName}"-re, de egyik sem ${sport}.`); }
                } else if (response?.status === 200) { console.warn(`TheSportsDB (Fallback): 200 OK, de nem található adat: "${searchName}".`); }
            } catch (error) { console.error(`TheSportsDB Hiba (Fallback "${searchName}" keresés): ${error.message}`); }
            if (!teamId) { await new Promise(resolve => setTimeout(resolve, 50)); } else { break; }
        }
    } else if (!targetSportName) { console.warn(`TheSportsDB: Ismeretlen sport (${sport}) a fallback kereséshez.`); }
    sportsDbCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) { console.error(`TheSportsDB: Végleg nem található ${sport} ID ehhez: "${teamName}" (Liga: ${leagueName || 'N/A'}).`); }
    return teamId;
}

// --- IDŐJÁRÁS FUNKCIÓ ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) { console.warn("Időjárás: Hiányzó helyszín/idő."); return null; }
    const locationKey = stadiumLocation.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cacheKey = `weather_v15_${locationKey}`;
    const cachedWeather = scriptCache.get(cacheKey);
    if (cachedWeather !== undefined) {
        console.log(`Időjárás cache találat (${cacheKey})`);
        if (cachedWeather !== 'not_found' && cachedWeather.forecastTime) {
            try {
                const kickoffDate = new Date(utcKickoff); const forecastDate = new Date(cachedWeather.forecastTime);
                if (kickoffDate.toISOString().substring(0,10) === forecastDate.toISOString().substring(0,10)) { console.log("Időjárás cache érvényes."); return cachedWeather; }
                else { console.log("Időjárás cache lejárt. Új lekérés."); }
            } catch (e) { console.warn("Hiba időjárás cache ellenőrzéskor:", e.message); }
        } else if (cachedWeather === 'not_found'){ return null; }
    }
    console.log(`Időjárás lekérése: ${stadiumLocation} @ ${utcKickoff}`);
    const baseUrl = 'https://api.open-meteo.com/v1/forecast'; let lat = null, lon = null;
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stadiumLocation)}&count=1&language=en&format=json`;
    console.log("Geokódolás...");
    try {
        const geoResponse = await makeRequest(geocodeUrl, { timeout: 8000 }, 0);
        if (geoResponse?.data?.results?.[0]) { lat = geoResponse.data.results[0].latitude; lon = geoResponse.data.results[0].longitude; console.log(`Geokódolás OK: ${stadiumLocation} -> Lat: ${lat}, Lon: ${lon}`); }
        else { console.warn(`Geokódolás sikertelen: ${stadiumLocation}`); scriptCache.set(cacheKey, 'not_found'); return null; }
    } catch (e) { console.error(`Geokódolási API hiba (${stadiumLocation}): ${e.message}`); scriptCache.set(cacheKey, 'not_found'); return null; }
    if (!lat || !lon) { scriptCache.set(cacheKey, 'not_found'); return null; }
    let kickoffDate; try { kickoffDate = new Date(utcKickoff); if (isNaN(kickoffDate.getTime())) throw new Error("Érvénytelen dátum"); }
    catch (e) { console.error(`Időjárás: Érvénytelen kezdési időpont: ${utcKickoff} - ${e.message}`); scriptCache.set(cacheKey, 'not_found'); return null; }
    const endDate = new Date(kickoffDate); endDate.setUTCHours(kickoffDate.getUTCHours() + 3);
    const weatherUrl = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m&start_date=${kickoffDate.toISOString().split('T')[0]}&end_date=${endDate.toISOString().split('T')[0]}&timezone=UTC`;
    console.log("Időjárás lekérés Open-Meteo...");
    try {
        const weatherResponse = await makeRequest(weatherUrl, { timeout: 10000 }, 1);
        if (!weatherResponse?.data?.hourly?.time) { console.warn(`Open-Meteo: Nincs óránkénti adat.`); scriptCache.set(cacheKey, 'not_found'); return null; }
        const hourlyData = weatherResponse.data.hourly; let bestIndex = -1; let minDiff = Infinity;
        hourlyData.time.forEach((timeStr, index) => { try { const timeDiff = Math.abs(new Date(timeStr + 'Z') - kickoffDate); if (timeDiff < minDiff) { minDiff = timeDiff; bestIndex = index; } } catch { /* ignore */ } });
        if (bestIndex !== -1) {
            const weather = { temperature_celsius: hourlyData.temperature_2m?.[bestIndex], humidity_percent: hourlyData.relative_humidity_2m?.[bestIndex], precipitation_probability_percent: hourlyData.precipitation_probability?.[bestIndex], precipitation_mm: hourlyData.precipitation?.[bestIndex], wind_speed_kmh: hourlyData.wind_speed_10m?.[bestIndex], weather_code: hourlyData.weather_code?.[bestIndex], description: interpretWeatherCode(hourlyData.weather_code?.[bestIndex]), forecastTime: hourlyData.time?.[bestIndex] + 'Z' };
            console.log(`Időjárás: Temp: ${weather.temperature_celsius}°C, Csap(%): ${weather.precipitation_probability_percent}, Szél: ${weather.wind_speed_kmh} km/h`);
            scriptCache.set(cacheKey, weather); return weather;
        } else { console.warn(`Open-Meteo: Nem található közeli óránkénti adat.`); scriptCache.set(cacheKey, 'not_found'); return null; }
    } catch (e) { console.error(`Open-Meteo API hiba: ${e.message}`); scriptCache.set(cacheKey, 'not_found'); return null; }
}
function interpretWeatherCode(code) {
    if (code === null || code === undefined) return "Ismeretlen"; if (code === 0) return "Tiszta égbolt"; if (code >= 1 && code <= 3) return "Részben felhős"; if (code === 45 || code === 48) return "Köd"; if (code >= 51 && code <= 55) return "Szitálás"; if (code >= 56 && code <= 57) return "Ónos szitálás"; if (code >= 61 && code <= 65) return "Eső"; if (code >= 66 && code <= 67) return "Ónos eső"; if (code >= 71 && code <= 75) return "Hóesés"; if (code === 77) return "Szemcsés hó"; if (code >= 80 && code <= 82) return "Zápor"; if (code >= 85 && code <= 86) return "Hózápor"; if (code >= 95 && code <= 99) return "Zivatar"; return `Kód: ${code}`;
}


// --- API SPORTS (FOOTBALL, HOCKEY, BASKETBALL) FUNKCIÓK ---
const APIFOOTBALL_HEADERS = { 'x-apisports-key': APIFOOTBALL_API_KEY };
const APIFOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const CURRENT_SEASON = new Date().getFullYear();
const PREVIOUS_SEASON = CURRENT_SEASON - 1;

async function getApiSportsTeamId(sport, teamName) {
     if (!APIFOOTBALL_API_KEY) { console.warn(`API Sports (${sport}) kulcs hiányzik.`); return null; }
     const lowerName = teamName.toLowerCase().trim();
     const cacheKey = `apisports_teamid_${sport}_v15_${lowerName.replace(/\s+/g, '')}`;
     const cachedId = apiFootballTeamIdCache.get(cacheKey);
     if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }
     const baseUrl = APIFOOTBALL_BASE_URL;
     const url = `${baseUrl}/teams?search=${encodeURIComponent(teamName)}`;
     console.log(`API Sports Team Search (${sport}): ${teamName}...`);
     try {
         const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 8000 });
         if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API Sports (${sport}): Nem található csapat ID ehhez: "${teamName}".`); apiFootballTeamIdCache.set(cacheKey, 'not_found'); return null; }
         if (response.data.response.length > 0) {
             const teams = response.data.response;
             const filteredTeams = teams.filter(t => !t.team?.name?.toLowerCase().includes("women") && !/\bW\b/.test(t.team?.name) && !/U\d+/.test(t.team?.name));
             if (filteredTeams.length === 0) { console.warn(`API Sports (${sport}): Találatok "${teamName}"-re, de szűrés után nem maradt releváns csapat.`); apiFootballTeamIdCache.set(cacheKey, 'not_found'); return null; }
             let bestMatch = filteredTeams.find(t => t.team?.name?.toLowerCase() === lowerName) || filteredTeams[0];
             if(filteredTeams.length > 1 && bestMatch.team?.name?.toLowerCase() !== lowerName){
                  const ratings = findBestMatch(teamName, filteredTeams.map(t => t.team?.name || ''));
                  if(ratings.bestMatch.rating > 0.7) { bestMatch = filteredTeams[ratings.bestMatchIndex]; console.log(`API Sports (${sport}): Több találat, jobb egyezés választva "${teamName}" -> "${bestMatch.team?.name}" (${(ratings.bestMatch.rating * 100).toFixed(1)}%)`); }
                  else { console.warn(`API Sports (${sport}): Több találat "${teamName}"-re, az első relevánsat használjuk: "${bestMatch.team?.name}".`); }
             }
             const teamId = bestMatch.team?.id;
             if (teamId) { console.log(`API Sports (${sport}): ID találat "${teamName}" -> "${bestMatch.team?.name}" -> ${teamId}`); apiFootballTeamIdCache.set(cacheKey, teamId); return teamId; }
         }
         console.warn(`API Sports (${sport}): Nem található csapat ID ehhez: "${teamName}".`); apiFootballTeamIdCache.set(cacheKey, 'not_found'); return null;
     } catch (error) { console.error(`API Sports Hiba (${sport} csapatkeresés "${teamName}"): ${error.message}`); apiFootballTeamIdCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiSportsLeagueId(sport, leagueName) {
    const baseUrl = APIFOOTBALL_BASE_URL;
    if (!APIFOOTBALL_API_KEY || !leagueName) { return null; }
    const lowerName = leagueName.toLowerCase().trim();
    const cacheKey = `apisports_leagueid_${sport}_v15_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = apiFootballLeagueIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }
    const url = `${baseUrl}/leagues?search=${encodeURIComponent(leagueName)}`;
    console.log(`API Sports League Search (${sport}): ${leagueName}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 8000 });
         if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API Sports (${sport}): Nem található liga ID ehhez: "${leagueName}".`); apiFootballLeagueIdCache.set(cacheKey, 'not_found'); return null; }
        if (response.data.response.length > 0) {
            const leagues = response.data.response; const filteredLeagues = leagues;
            if(filteredLeagues.length === 0){ console.warn(`API Sports (${sport}): Találatok "${leagueName}"-re, de egyik sem ${sport} liga.`); apiFootballLeagueIdCache.set(cacheKey, 'not_found'); return null; }
            let bestMatch = filteredLeagues.find(l => l.league?.name?.toLowerCase() === lowerName && l.country?.name) || filteredLeagues.find(l => l.league?.name?.toLowerCase() === lowerName) || filteredLeagues[0];
             if(filteredLeagues.length > 1 && bestMatch.league?.name?.toLowerCase() !== lowerName){
                 const ratings = findBestMatch(leagueName, filteredLeagues.map(l => l.league?.name || ''));
                 if(ratings.bestMatch.rating > 0.7) { bestMatch = filteredLeagues[ratings.bestMatchIndex]; console.log(`API Sports (${sport}): Több liga találat, jobb egyezés "${leagueName}" -> "${bestMatch.league?.name}" (${(ratings.bestMatch.rating * 100).toFixed(1)}%)`); }
                 else { console.warn(`API Sports (${sport}): Több liga találat "${leagueName}"-re, az első relevánsat használjuk: "${bestMatch.league?.name}".`); }
            }
            const leagueId = bestMatch.league?.id;
            if (leagueId) { console.log(`API Sports (${sport}): Liga ID találat "${leagueName}" -> "${bestMatch.league?.name}" (${bestMatch.country?.name || 'N/A'}) -> ${leagueId}`); apiFootballLeagueIdCache.set(cacheKey, leagueId); return leagueId; }
        }
        console.warn(`API Sports (${sport}): Nem található liga ID ehhez: "${leagueName}".`); apiFootballLeagueIdCache.set(cacheKey, 'not_found'); return null;
    } catch (error) { console.error(`API Sports Hiba (${sport} ligakeresés "${leagueName}"): ${error.message}`); apiFootballLeagueIdCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballFixtureId(homeTeamId, awayTeamId, date) {
    if (!APIFOOTBALL_API_KEY || !homeTeamId || !awayTeamId || !date) { return null; }
    const dateKey = date.substring(0, 10);
    const cacheKey = `apifootball_fixtureid_v15_${homeTeamId}_${awayTeamId}_${dateKey}`;
    const cachedId = apiFootballFixtureIdCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }
    const url = `${APIFOOTBALL_BASE_URL}/fixtures?date=${dateKey}&team=${homeTeamId}&season=${CURRENT_SEASON}`; // Season hozzáadva
    console.log(`API-Football Fixture ID keresés: Hazai=${homeTeamId}, Dátum=${dateKey}, Szezon=${CURRENT_SEASON}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API-Football: Nem található meccs ${homeTeamId} számára ${dateKey} napon.`); apiFootballFixtureIdCache.set(cacheKey, 'not_found'); return null; }
        const fixtures = response.data.response;
        const targetFixture = fixtures.find(fix => fix.teams?.home?.id == homeTeamId && fix.teams?.away?.id == awayTeamId); // Lazább összehasonlítás
        if (targetFixture && targetFixture.fixture?.id) { const fixtureId = targetFixture.fixture.id; console.log(`API-Football: Megvan a Fixture ID: ${fixtureId} (${homeTeamId} vs ${awayTeamId} @ ${dateKey})`); apiFootballFixtureIdCache.set(cacheKey, fixtureId); return fixtureId; }
        else { console.warn(`API-Football: Nincs ${homeTeamId} vs ${awayTeamId} meccs ${dateKey} napon.`); apiFootballFixtureIdCache.set(cacheKey, 'not_found'); return null; }
    } catch (error) { console.error(`API-Football Hiba (Fixture ID keresés ${homeTeamId} vs ${awayTeamId} @ ${dateKey}): ${error.message}`); apiFootballFixtureIdCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballPlayers(teamId, season = CURRENT_SEASON) {
    if (!APIFOOTBALL_API_KEY || !teamId) { return null; }
    let current_try_season = season; const cacheKeyBase = `apifootball_players_v15_${teamId}`;
    let cacheKey = `${cacheKeyBase}_${current_try_season}`;
    let cachedData = apiFootballPlayersCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }
    let url = `${APIFOOTBALL_BASE_URL}/players?team=${teamId}&season=${current_try_season}`;
    console.log(`API-Football Játékoslista: Csapat=${teamId}, Szezon=${current_try_season}...`);
    try {
        let response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 12000 });
        // Fallback előző szezonra
        if (!response || response.data?.results === 0 || response.data?.errors?.requests?.includes('access')) {
             const errorInfo = response ? JSON.stringify(response.data.errors) : "Nincs válasz";
             console.warn(`API-Football: Szezon (${current_try_season}) nem elérhető vagy üres (${errorInfo}). Fallback (${PREVIOUS_SEASON})...`);
             current_try_season = PREVIOUS_SEASON; cacheKey = `${cacheKeyBase}_${current_try_season}`;
             cachedData = apiFootballPlayersCache.get(cacheKey);
             if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }
             url = `${APIFOOTBALL_BASE_URL}/players?team=${teamId}&season=${current_try_season}`;
             response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 12000 });
        }
        if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API-Football: Nem található játékoslista (még fallback után sem): Csapat=${teamId}, Szezon=${current_try_season}.`); apiFootballPlayersCache.set(cacheKey, 'not_found'); return null; }
        const players = response.data.response.map(p => ({ id: p.player?.id, name: p.player?.name, position: p.statistics?.[0]?.games?.position || '?', number: p.statistics?.[0]?.games?.number || null }));
        console.log(`API-Football: ${players.length} játékos lekérve (Csapat=${teamId}, Szezon=${current_try_season}).`);
        apiFootballPlayersCache.set(cacheKey, players); return players;
    } catch (error) { console.error(`API-Football Hiba (Játékoslista ${teamId}, ${current_try_season}): ${error.message}`); apiFootballPlayersCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballRecentMatches(teamId, limit = 10) {
     if (!APIFOOTBALL_API_KEY || !teamId) { return null; }
     const cacheKey = `apifootball_matches_v15_${teamId}_last60d`;
     const cachedData = apiFootballMatchesCache.get(cacheKey);
     if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }
     const toDate = new Date().toISOString().split('T')[0];
     const fromDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
     const url = `${APIFOOTBALL_BASE_URL}/fixtures?team=${teamId}&from=${fromDate}&to=${toDate}&status=FT-AET-PEN`;
     console.log(`API-Football Meccselőzmények (utolsó 60 nap): Csapat=${teamId}...`);
     try {
         const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 15000 });
         if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API-Football: Nincs meccselőzmény (utolsó 60 nap): Csapat=${teamId}.`); apiFootballMatchesCache.set(cacheKey, 'not_found'); return null; }
         const matches = response.data.response.map(fix => ({ idEvent: fix.fixture?.id, dateEvent: fix.fixture?.date?.split('T')[0], strTime: fix.fixture?.date?.split('T')[1]?.substring(0, 8), strHomeTeam: fix.teams?.home?.name, strAwayTeam: fix.teams?.away?.name, intHomeScore: fix.goals?.home, intAwayScore: fix.goals?.away, league: fix.league?.name, round: fix.league?.round, venue: fix.fixture?.venue?.name, status: fix.fixture?.status?.short })).sort((a, b) => new Date(b.dateEvent + 'T' + (b.strTime || '00:00:00')) - new Date(a.dateEvent + 'T' + (a.strTime || '00:00:00')));
         console.log(`API-Football: ${matches.length} meccselőzmény lekérve (utolsó 60 nap, Csapat=${teamId}).`);
         apiFootballMatchesCache.set(cacheKey, matches.slice(0, limit)); return matches.slice(0, limit);
     } catch (error) { console.error(`API-Football Hiba (Meccselőzmények ${teamId}): ${error.message}`); apiFootballMatchesCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballLineups(fixtureId) {
    if (!APIFOOTBALL_API_KEY || !fixtureId) { return null; }
    const cacheKey = `apifootball_lineups_v15_${fixtureId}`;
    const cachedData = apiFootballLineupsCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }
    const url = `${APIFOOTBALL_BASE_URL}/fixtures/lineups?fixture=${fixtureId}`;
    console.log(`API-Football Kezdőcsapatok: Fixture=${fixtureId}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API-Football: Nincs kezdőcsapat: Fixture=${fixtureId}.`); apiFootballLineupsCache.set(cacheKey, 'not_found'); return null; }
        const lineups = response.data.response.map(teamLineup => ({ teamName: teamLineup.team?.name, formation: teamLineup.formation, startXI: teamLineup.startXI?.map(p => ({ name: p.player?.name, number: p.player?.number, pos: p.player?.pos, grid: p.player?.grid })) || [], coachName: teamLineup.coach?.name }));
        console.log(`API-Football: Kezdőcsapatok lekérve (Fixture=${fixtureId}).`); apiFootballLineupsCache.set(cacheKey, lineups); return lineups;
    } catch (error) { console.error(`API-Football Hiba (Kezdőcsapatok ${fixtureId}): ${error.message}`); apiFootballLineupsCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballMatchStats(fixtureId) {
    if (!APIFOOTBALL_API_KEY || !fixtureId) { return null; }
    const cacheKey = `apifootball_stats_v15_${fixtureId}`;
    const cachedData = apiFootballStatsCache.get(cacheKey);
    if (cachedData !== undefined) { return cachedData === 'not_found' ? null : cachedData; }
    const url = `${APIFOOTBALL_BASE_URL}/fixtures/statistics?fixture=${fixtureId}`;
    console.log(`API-Football Meccsstatisztika: Fixture=${fixtureId}...`);
    try {
        const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
        if (!response || !response.data?.response || response.data?.results === 0) { console.warn(`API-Football: Nincs statisztika: Fixture=${fixtureId}.`); apiFootballStatsCache.set(cacheKey, 'not_found'); return null; }
        const stats = response.data.response.map(teamStats => ({ teamName: teamStats.team?.name, statistics: teamStats.statistics?.reduce((acc, stat) => { acc[stat.type.replace(/\s+/g, '_')] = stat.value; return acc; }, {}) || {} }));
        console.log(`API-Football: Meccsstatisztikák lekérve (Fixture=${fixtureId}).`); apiFootballStatsCache.set(cacheKey, stats); return stats;
    } catch (error) { console.error(`API-Football Hiba (Meccsstatisztika ${fixtureId}): ${error.message}`); apiFootballStatsCache.set(cacheKey, 'not_found'); return null; }
}
async function getApiFootballH2H(homeTeamName, awayTeamName, limit = 5) {
     if (!APIFOOTBALL_API_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, H2H lekérés kihagyva."); return null; }
     try {
         const [homeId, awayId] = await Promise.all([ getApiSportsTeamId('soccer', homeTeamName), getApiSportsTeamId('soccer', awayTeamName) ]); // getApiSportsTeamId használata
         if (!homeId || !awayId) { console.warn(`API-FOOTBALL H2H: Nem található mindkét csapat ID (${homeTeamName}:${homeId}, ${awayTeamName}:${awayId}).`); return null; }
         const toDate = new Date().toISOString().split('T')[0];
         const fromDate = new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().split('T')[0];
         const h2hUrl = `${APIFOOTBALL_BASE_URL}/fixtures/headtohead?h2h=${homeId}-${awayId}&from=${fromDate}&to=${toDate}`;
         console.log(`API-Football H2H lekérés (dátumtartománnyal): ${homeTeamName} vs ${awayTeamName}...`);
         const response = await makeRequest(h2hUrl, { headers: APIFOOTBALL_HEADERS, timeout: 10000 });
         const fixtures = response?.data?.response;
         if (fixtures && Array.isArray(fixtures)) {
             console.log(`API-Football H2H: ${fixtures.length} meccs adat lekérve.`);
             const structuredH2H = fixtures.map(fix => ({ date: fix.fixture?.date?.split('T')[0] || 'N/A', competition: fix.league?.name || 'N/A', home_team: fix.teams?.home?.name || 'N/A', away_team: fix.teams?.away?.name || 'N/A', home_score: fix.goals?.home, away_score: fix.goals?.away, score: `${fix.goals?.home ?? '?'} - ${fix.goals?.away ?? '?'}` })).sort((a, b) => new Date(b.date) - new Date(a.date));
             return structuredH2H.slice(0, limit);
         } else { console.warn(`API-Football H2H: Nem érkezett érvényes meccslista.`); return null; }
     } catch (error) { console.error(`API-Football Hiba (H2H ${homeTeamName} vs ${awayTeamName}): ${error.message}`); return null; }
}

// --- FŐ ADATGYŰJTŐ FUNKCIÓ (API SPORTS INTEGRÁCIÓVAL) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v15_apisports_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) { return { ...cached, fromCache: true, oddsData: oddsResult }; }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        console.log(`Adatgyűjtés indul (API Sports - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);

        const [apiSportsHomeId, apiSportsAwayId, apiSportsLeagueId] = await Promise.all([
            getApiSportsTeamId(sport, homeTeamName), getApiSportsTeamId(sport, awayTeamName), getApiSportsLeagueId(sport, leagueName)
        ]);
        if (!apiSportsHomeId || !apiSportsAwayId) { throw new Error(`Kritikus hiba (${sport}): Nem található az API Sports csapat ID a ${homeTeamName} (${apiSportsHomeId || 'undefined'}) vagy ${awayTeamName} (${apiSportsAwayId || 'undefined'}) számára.`); }
        console.log(`API Sports ID-k (${sport}): Hazai=${apiSportsHomeId}, Vendég=${apiSportsAwayId}, Liga=${apiSportsLeagueId || 'N/A'}`);

        let fixtureDate = null; if (utcKickoff) { try { fixtureDate = new Date(decodeURIComponent(utcKickoff)).toISOString().split('T')[0]; } catch { console.warn("Érvénytelen utcKickoff formátum:", utcKickoff); } }
        let apiSportsFixtureId = null; let stadiumLocationForWeather = "N/A";

        // Fixture ID és Stadion keresés (csak focihoz van most implementálva)
        if (sport === 'soccer') {
            apiSportsFixtureId = fixtureDate ? await getApiFootballFixtureId(apiSportsHomeId, apiSportsAwayId, fixtureDate) : null;
            console.log(`API Sports Fixture ID (soccer): ${apiSportsFixtureId || 'N/A'}`);
            if (apiSportsFixtureId) {
                const fixtureDetailsUrl = `${APIFOOTBALL_BASE_URL}/fixtures?id=${apiSportsFixtureId}`;
                console.log("Stadion helyszín lekérése időjáráshoz (soccer)...");
                 try {
                     const fixtureResponse = await makeRequest(fixtureDetailsUrl, { headers: APIFOOTBALL_HEADERS, timeout: 8000 });
                     const venue = fixtureResponse?.data?.response?.[0]?.fixture?.venue;
                     if (venue?.city && venue?.name) { stadiumLocationForWeather = `${venue.name}, ${venue.city}`; console.log("Stadion helyszín: ", stadiumLocationForWeather); }
                     else { console.warn("Nem sikerült kinyerni a stadion helyszínét."); }
                 } catch (e) { console.error("Hiba a stadion helyszín lekérésekor:", e.message); }
            }
        } else { console.log(`API Sports Fixture ID keresés (${sport}) még nincs implementálva.`); }

        // Játékosok, Meccsek, Lineup, Statok (csak focihoz)
        let homePlayers = [], awayPlayers = [], homeMatches = [], awayMatches = [], lineups = null, matchStats = null;
        if (sport === 'soccer') {
             [ homePlayers, awayPlayers, homeMatches, awayMatches, lineups, matchStats ] = await Promise.all([
                getApiFootballPlayers(apiSportsHomeId, CURRENT_SEASON), getApiFootballPlayers(apiSportsAwayId, CURRENT_SEASON),
                getApiFootballRecentMatches(apiSportsHomeId, 10), getApiFootballRecentMatches(apiSportsAwayId, 10),
                apiSportsFixtureId ? getApiFootballLineups(apiSportsFixtureId) : Promise.resolve(null),
                apiSportsFixtureId ? getApiFootballMatchStats(apiSportsFixtureId) : Promise.resolve(null),
            ]);
        } else { console.warn(`Részletes adatlekérés (${sport}) még nincs implementálva.`); }

        const apiSportsData = { homeTeamId: apiSportsHomeId, awayTeamId: apiSportsAwayId, leagueId: apiSportsLeagueId, fixtureId: apiSportsFixtureId, homePlayers: homePlayers || [], awayPlayers: awayPlayers || [], homeMatches: homeMatches || [], awayMatches: awayMatches || [], lineups: lineups || null, matchStats: matchStats || null };
        console.log(`API Sports adatok (${sport}) lekérve: H_Pl: ${apiSportsData.homePlayers.length}, A_Pl: ${apiSportsData.awayPlayers.length}, H_M: ${apiSportsData.homeMatches.length}, A_M: ${apiSportsData.awayMatches.length}, Lineups: ${apiSportsData.lineups ? 'OK' : 'N/A'}, Stats: ${apiSportsData.matchStats ? 'OK' : 'N/A'}`);

        // Statisztika számítás
        let calculatedStats = { home: { gp: null, gf: null, ga: null }, away: { gp: null, gf: null, ga: null } };
        const calculateTeamStats = (matches, teamName) => {
             let gp = 0, gf = 0, ga = 0;
            if (Array.isArray(matches)) {
                matches.forEach(m => {
                    if (!m || typeof m !== 'object' || m.intHomeScore === null || m.intAwayScore === null || !m.strHomeTeam || !m.strAwayTeam) { return; }
                    const homeScore = m.intHomeScore; const awayScore = m.intAwayScore; const homeTeamStr = m.strHomeTeam; const awayTeamStr = m.strAwayTeam; gp++;
                    if (homeTeamStr.includes(teamName) || teamName.includes(homeTeamStr)) { gf += homeScore; ga += awayScore; }
                    else if (awayTeamStr.includes(teamName) || teamName.includes(awayTeamStr)) { gf += awayScore; ga += homeScore; }
                    else { gp--; console.warn(`Stats számítás (API-S): A ${teamName} csapat nem található a ${homeTeamStr} vs ${awayTeamStr} meccsben.`); }
                });
            } return gp > 0 ? { gp, gf, ga } : { gp: null, gf: null, ga: null };
        };
        if (apiSportsData.homeMatches.length > 0) { calculatedStats.home = calculateTeamStats(apiSportsData.homeMatches, homeTeamName); console.log(`Számított statisztika (${homeTeamName}): GP=${calculatedStats.home?.gp ?? 'N/A'}, GF=${calculatedStats.home?.gf ?? 'N/A'}, GA=${calculatedStats.home?.ga ?? 'N/A'} (API-S)`); } else { console.warn(`Nincs API Sports meccselőzmény ${homeTeamName}-hoz.`); }
        if (apiSportsData.awayMatches.length > 0) { calculatedStats.away = calculateTeamStats(apiSportsData.awayMatches, awayTeamName); console.log(`Számított statisztika (${awayTeamName}): GP=${calculatedStats.away?.gp ?? 'N/A'}, GF=${calculatedStats.away?.gf ?? 'N/A'}, GA=${calculatedStats.away?.ga ?? 'N/A'} (API-S)`); } else { console.warn(`Nincs API Sports meccselőzmény ${awayTeamName}-hoz.`); }

        // Gemini adatok előkészítése
        const homePlayerNames = apiSportsData.homePlayers.slice(0, 15).map(p => `${p?.name || '?'} (${p?.position || '?'})`).join(', ') || 'N/A';
        const awayPlayerNames = apiSportsData.awayPlayers.slice(0, 15).map(p => `${p?.name || '?'} (${p?.position || '?'})`).join(', ') || 'N/A';
        const homeRecentMatchInfo = apiSportsData.homeMatches.slice(0, 5).map(m => `${m?.dateEvent || '?'} ${m?.strHomeTeam || '?'} ${m?.intHomeScore ?? '?'}-${m?.intAwayScore ?? '?'} ${m?.strAwayTeam || '?'}`).join('; ') || 'N/A';
        const awayRecentMatchInfo = apiSportsData.awayMatches.slice(0, 5).map(m => `${m?.dateEvent || '?'} ${m?.strHomeTeam || '?'} ${m?.intHomeScore ?? '?'}-${m?.intAwayScore ?? '?'} ${m?.strAwayTeam || '?'}`).join('; ') || 'N/A';
        let startingHomePlayers = 'N/A', startingAwayPlayers = 'N/A', homeFormation = 'N/A', awayFormation = 'N/A';
        if (apiSportsData.lineups) { /* ... lineup/formation kinyerése ... */ }
        const matchStatsSample = apiSportsData.matchStats ? JSON.stringify(apiSportsData.matchStats).substring(0, 500) + '...' : 'N/A';

        // Időjárás lekérése
        const structuredWeather = await getStructuredWeatherData(stadiumLocationForWeather, utcKickoff);

        // Odds és H2H
        const [fetchedOddsData, apiSportsH2HData] = await Promise.all([
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName),
            getApiFootballH2H(homeTeamName, awayTeamName, 5) // Ez még a foci specifikus, de használható általánosan is
        ]);

        // Gemini hívás
        const geminiJsonString = await _callGemini(PROMPT_V42( sport, homeTeamName, awayTeamName, apiSportsData, homePlayerNames, awayPlayerNames, homeRecentMatchInfo, awayRecentMatchInfo, startingHomePlayers, startingAwayPlayers, homeFormation, awayFormation, matchStatsSample, calculatedStats, apiSportsH2HData ));

        // Eredmények feldolgozása
        let geminiData = null; try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; } catch (e) { /*...*/ } if (!geminiData || typeof geminiData !== 'object') { /*...*/ }
        const finalData = {}; const parseStat = (val, d = null) => { /*...*/ };
        const homeGp = parseStat(calculatedStats.home?.gp, parseStat(geminiData?.stats?.home?.gp, 1)); const homeGf = parseStat(calculatedStats.home?.gf, parseStat(geminiData?.stats?.home?.gf, null)); const homeGa = parseStat(calculatedStats.home?.ga, parseStat(geminiData?.stats?.home?.ga, null)); const awayGp = parseStat(calculatedStats.away?.gp, parseStat(geminiData?.stats?.away?.gp, 1)); const awayGf = parseStat(calculatedStats.away?.gf, parseStat(geminiData?.stats?.away?.gf, null)); const awayGa = parseStat(calculatedStats.away?.ga, parseStat(geminiData?.stats?.away?.ga, null));
        finalData.stats = { home: { gp: homeGp, gf: homeGf, ga: homeGa }, away: { gp: awayGp, gf: awayGf, ga: awayGa } }; console.log(`Végleges stats (${sport}): Home(GP:${homeGp ?? 'N/A'}, ...), Away(GP:${awayGp ?? 'N/A'}, ...)`);
        finalData.h2h_structured = apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []); finalData.h2h_summary = geminiData?.h2h_summary || "N/A"; finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" }; finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] }; finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A"; finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" }; const normKP = (p) => (Array.isArray(p) ? p : []).map(i => ({ name: i?.name || '?', role: i?.role || '?', stats: i?.stat || i?.stats || 'N/A' })); finalData.key_players = { home: normKP(geminiData?.key_players?.home), away: normKP(geminiData?.key_players?.away) }; finalData.contextual_factors = geminiData?.contextual_factors || {}; finalData.contextual_factors.stadium_location = stadiumLocationForWeather !== "N/A" ? stadiumLocationForWeather : (geminiData?.contextual_factors?.stadium_location || "N/A"); finalData.contextual_factors.match_tension_index = finalData.contextual_factors.match_tension_index || "N/A"; finalData.contextual_factors.pitch_condition = finalData.contextual_factors.pitch_condition || "N/A"; finalData.contextual_factors.referee = geminiData?.contextual_factors?.referee || { name: "N/A", style: "N/A" }; finalData.contextual_factors.structured_weather = structuredWeather; finalData.referee = finalData.contextual_factors.referee; finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } }; if (homeFormation !== 'N/A') finalData.tactics.home.formation = homeFormation; if (awayFormation !== 'N/A') finalData.tactics.away.formation = awayFormation; finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] }; finalData.key_matchups = geminiData?.key_matchups || {}; finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} }; finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} }; finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" }; finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" }; finalData.advancedData = { home: { xg: null }, away: { xg: null } }; finalData.league_averages = geminiData?.league_averages || {}; finalData.apiSportsData = apiSportsData;

        const richContextParts = [ finalData.h2h_summary && `- H2H: ${finalData.h2h_summary}`, finalData.contextual_factors.match_tension_index && `- Tét: ${finalData.contextual_factors.match_tension_index}`, (finalData.team_news?.home||finalData.team_news?.away) && `- Hírek: H:${finalData.team_news?.home||'-'}, V:${finalData.team_news?.away||'-'}`, (finalData.absentees?.home?.length>0||finalData.absentees?.away?.length>0) && `- Hiányzók: H:${finalData.absentees?.home?.map(p=>p?.name).join(', ')||'-'}, V:${finalData.absentees?.away?.map(p=>p?.name).join(', ')||'-'}`, finalData.absentee_impact_analysis && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`, (finalData.form?.home_overall||finalData.form?.away_overall) && `- Forma: H:${finalData.form?.home_overall||'N/A'}, V:${finalData.form?.away_overall||'N/A'}`, (finalData.tactics?.home?.style||finalData.tactics?.away?.style) && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`, structuredWeather ? `- Időjárás: ${structuredWeather.description || '?'} (${structuredWeather.temperature_celsius?.toFixed(1) ?? '?'}°C, ${structuredWeather.precipitation_mm?.toFixed(1) ?? '?'}mm, ${structuredWeather.wind_speed_kmh?.toFixed(1) ?? '?'}km/h)` : `- Időjárás: N/A`, finalData.contextual_factors?.pitch_condition && `- Pálya: ${finalData.contextual_factors.pitch_condition}` ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advancedData, form: finalData.form, rawData: finalData };

        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) { console.error(`KRITIKUS HIBA (${sport} - ${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0).`); throw new Error(`Kritikus statisztikák (GP <= 0) ${homeTeamName} vs ${awayTeamName}.`); }
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${sport}), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) { console.error(`KRITIKUS HIBA getRichContextualData (${sport}) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack); return { error: `Adatgyűjtési hiba: ${e.message}` }; }
}

// --- FRISSÍTETT GEMINI PROMPT (v43 - API SPORTS) ---
function PROMPT_V42( // Nevét meghagyjuk v42-nek a kompatibilitás miatt
    sport, homeTeamName, awayTeamName, apiSportsData, homePlayerNames, awayPlayerNames,
    homeRecentMatchInfo, awayRecentMatchInfo, startingHomePlayers, startingAwayPlayers,
    homeFormation, awayFormation, matchStatsSample, calculatedStats, apiSportsH2HData // Átnevezve H2H adat
) {
    let calculatedStatsInfo = "";
    if (calculatedStats.home?.gp !== null || calculatedStats.away?.gp !== null) { calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats (gp, gf, ga) have been PRE-CALCULATED based on the available recent match history from API Sports. Use these exact numbers; do not rely on your internal knowledge for these specific stats.\nHome Calculated (GP=${calculatedStats.home?.gp ?? 'N/A'}, GF=${calculatedStats.home?.gf ?? 'N/A'}, GA=${calculatedStats.home?.ga ?? 'N/A'})\nAway Calculated (GP=${calculatedStats.away?.gp ?? 'N/A'}, GF=${calculatedStats.away?.gf ?? 'N/A'}, GA=${calculatedStats.away?.ga ?? 'N/A'})\n`; }
    else { calculatedStatsInfo = "NOTE ON STATS: Could not pre-calculate basic stats (gp, gf, ga) from API Sports recent matches. Please use your best knowledge for the CURRENT SEASON/COMPETITION.\n"; }

    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API Sports. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiSportsH2HData && Array.isArray(apiSportsH2HData) && apiSportsH2HData.length > 0) {
        const h2hString = apiSportsH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API Sports, Last ${apiSportsH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields. Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiSportsH2HData)}\n`;
    }

    let apiSportsDataInfo = `AVAILABLE FACTUAL DATA (Mainly from API Sports - ${sport}):\n`; // Sportág jelölve
    apiSportsDataInfo += `- Fixture ID: ${apiSportsData.fixtureId || 'N/A'}\n`;
    apiSportsDataInfo += `- Home Team ID (API-S): ${apiSportsData.homeTeamId || 'N/A'}\n`;
    apiSportsDataInfo += `- Away Team ID (API-S): ${apiSportsData.awayTeamId || 'N/A'}\n`;
    apiSportsDataInfo += `- Home Players (Sample): ${homePlayerNames}\n`;
    apiSportsDataInfo += `- Away Players (Sample): ${awayPlayerNames}\n`;
    apiSportsDataInfo += `- Home Recent Matches (API-S, Last available): ${homeRecentMatchInfo}\n`;
    apiSportsDataInfo += `- Away Recent Matches (API-S, Last available): ${awayRecentMatchInfo}\n`;
    apiSportsDataInfo += `- Starting Home XI: ${startingHomePlayers}\n`;
    apiSportsDataInfo += `- Starting Away XI: ${startingAwayPlayers}\n`;
    apiSportsDataInfo += `- Home Formation: ${homeFormation}\n`;
    apiSportsDataInfo += `- Away Formation: ${awayFormation}\n`;
    apiSportsDataInfo += `- Match Stats (API-S, if available): ${matchStatsSample}\n`;

    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. **CRITICAL: You MUST use the latest factual data provided below (mainly from API Sports) over your general knowledge.** If external data is N/A, use your knowledge but state the uncertainty.
${calculatedStatsInfo}
${h2hInfo}
${apiSportsDataInfo}
REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga. **USE THE PRE-CALCULATED STATS PROVIDED ABOVE if available.** If not, provide stats for the CURRENT SEASON/COMPETITION.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API Sports H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. (CRITICAL: Use Starting XI/Player List from API Sports. If Starting XI is 'N/A', mention uncertainty).
4. Recent Form: W-D-L strings (overall, home/away). **Derive this primarily from the API Sports Recent Matches.** If data is N/A, use your knowledge.
5. Key Players: name, role, recent key stat. Use API Sports player list.
6. Contextual Factors: Stadium Location, Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style + formation. **CRITICAL: Use Formation from API Sports data if available ('${homeFormation}' / '${awayFormation}').** If N/A, estimate.
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }.
  9. Key Matchups: Identify 1-2 key battles.
  10. Advanced Stats: Extract key stats like xG, Possession %, Shots on Target from API Sports Match Stats into advanced_stats_team.
IF hockey: 7. Advanced Stats: Team { Corsi_For_Pct, HDCF_Pct }, Goalie { GSAx }. Use your knowledge (API Sports stats might be less common for these).
IF basketball: 7. Advanced Styles: Shot Distribution, Defensive Style. Use your knowledge (API Sports stats might be less common for these).
OUTPUT FORMAT: Strict JSON. Use "N/A" or null. Omit fields for other sports.
STRUCTURE: {
  "stats":{ "home":{ "gp": <num|null>, "gf": <num|null>, "ga": <num|null> }, "away":{ "gp": <num|null>, "gf": <num|null>, "ga": <num|null> } },
  "h2h_summary":"...", "h2h_structured":[...], "team_news":{ "home":"...", "away":"..." },
  "absentees":{ "home":[{name, importance, role}], "away":[] }, "absentee_impact_analysis":"...",
  "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." },
  "key_players":{ "home":[{name, role, stat}], "away":[] },
  "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } },
  "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} },
  "tactical_patterns":{ "home":[], "away":[] }, "key_matchups":{ "description":"..." },
  "advanced_stats_team":{ "home":{/* API-S stats */}, "away":{/* API-S stats */} },
  "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} },
  "shot_distribution":{ "home":"...", "away":"..." }, "defensive_style":{ "home":"...", "away":"..." },
  "league_averages": { /* Optional */ }
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
        // Fontos: Az Odds API kulcsot headerként is elfogadhatja, de a query paraméter a dokumentáció alapja
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data)) { console.warn(`Odds API (${oddsApiKey}): Érvénytelen/üres válasz. Státusz: ${response?.status}`); return null; }
        if (response.data.length === 0) { console.warn(`Odds API (${oddsApiKey}): Nincs elérhető meccs.`); return null; }
        const oddsData = response.data;
        const homeVariations = generateTeamNameVariations(homeTeam); const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null; let highestCombinedRating = 0.60;
        for (const match of oddsData) {
            if (!match?.home_team || !match?.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim(); const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations); const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            const mappedHome = ODDS_TEAM_NAME_MAP[homeTeam.toLowerCase().trim()]; const mappedAway = ODDS_TEAM_NAME_MAP[awayTeam.toLowerCase().trim()];
            const isExactMapped = (mappedHome && mappedHome.toLowerCase() === apiHomeLower) || (mappedAway && mappedAway.toLowerCase() === apiAwayLower);
            if (!homeMatchResult?.bestMatch || !awayMatchResult?.bestMatch || homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue;
            const homeSim = homeMatchResult.bestMatch.rating; const awaySim = awayMatchResult.bestMatch.rating; let combinedSim = (homeSim + awaySim) / 2;
            if(isExactMapped) combinedSim += 0.1;
            if (combinedSim > highestCombinedRating) { highestCombinedRating = combinedSim; bestMatch = match; }
        }
        if (!bestMatch) { console.warn(`Odds API (${oddsApiKey}): Nem található elég jó egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam}.`); return null; }
        console.log(`Odds API (${oddsApiKey}): Találat ${bestMatch.home_team} vs ${bestMatch.away_team} (${(highestCombinedRating*100).toFixed(1)}%).`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) { console.warn(`Odds API: Nincs Pinnacle piac: ${bestMatch.home_team}`); return null; }
        const currentOdds = []; const allMarkets = bookmaker.markets;
        const h2hMarket = allMarkets.find(m => m.key === 'h2h'); const h2hOutcomes = h2hMarket?.outcomes;
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
        const totalsMarket = allMarkets.find(m => m.key === 'totals'); const totalsOutcomes = totalsMarket?.outcomes;
        if (totalsOutcomes && Array.isArray(totalsOutcomes)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            console.log(`Odds API: Fő Totals vonal: ${mainLine}`);
            const overOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Over');
            const underOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Under');
            if (overOutcome?.price && typeof overOutcome.price === 'number' && overOutcome.price > 1) { currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price }); }
            if (underOutcome?.price && typeof underOutcome.price === 'number' && underOutcome.price > 1) { currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price }); }
        } else { console.warn(`Odds API: Nincs Totals piac: ${bestMatch.home_team}`); }
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) { console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}, Liga: ${leagueName||'N/A'}, Kulcs: ${oddsApiKey}): ${e.message}`, e.stack?.substring(0, 300)); return null; }
}
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { console.warn("Odds API kulcs hiányzik, odds lekérés kihagyva."); return null; }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v15_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) { console.log(`Odds cache találat (${cacheKey})`); return { ...cached, fromCache: true }; }
    console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`);
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (!liveOdds && leagueName && getOddsApiKeyForLeague(leagueName) !== sportConfig.odds_api_sport_key) {
        console.log(`Odds API: Specifikus liga (${leagueName}) sikertelen, fallback alap sportkulcsra (${sportConfig.odds_api_sport_key})...`);
        liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
    }
    if (liveOdds?.current?.length > 0) { oddsCache.set(cacheKey, liveOdds); console.log(`Odds adatok cache-elve (${cacheKey}).`); return { ...liveOdds, fromCache: false }; }
    console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`); return null;
}
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([ teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName ]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.|us|tsg|vfl|hsc|sv|spvgg)\s+/i, '').trim());
    const parts = teamName.split(' ');
    if (parts.length > 1) { variations.add(parts[0]); if (parts.length > 2 && !/^(fc|sc|...)/i.test(parts[0])) { variations.add(parts[0]); } }
    if (lowerName === 'manchester united') variations.add('man united'); if (lowerName === 'manchester city') variations.add('man city'); if (lowerName === 'tottenham hotspur') variations.add('tottenham'); if (lowerName === 'wolverhampton wanderers') variations.add('wolves'); if (lowerName === 'west ham united') variations.add('west ham'); if (lowerName === 'brighton & hove albion') variations.add('brighton'); if (lowerName === 'internazionale') variations.add('inter'); if (lowerName === 'atletico madrid') variations.add('atletico'); if (lowerName === 'real betis') variations.add('betis'); if (lowerName === 'golden knights') variations.add('vegas golden knights'); if (lowerName === 'maple leafs') variations.add('toronto maple leafs'); if (lowerName === 'blue jackets') variations.add('columbus blue jackets');
    return Array.from(variations).filter(name => name && name.length > 2);
}
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) { console.warn("Totals piac nem található/hiányos."); return defaultLine; }
    let closestPair = { diff: Infinity, line: defaultLine }; const lines = {};
    totalsMarket.outcomes.forEach(o => { if (typeof o.point === 'number' && !isNaN(o.point) && o.name && o.price) { if (!lines[o.point]) lines[o.point] = {}; lines[o.point][o.name.toLowerCase()] = o.price; } });
    const points = Object.keys(lines).map(Number).filter(p => lines[p].over && lines[p].under);
    if (points.length === 0) { console.warn("Nincs teljes Over/Under pár."); return defaultLine; }
    for (const point of points) { const diff = Math.abs(lines[point].over - lines[point].under); if (diff < closestPair.diff) closestPair = { diff, line: point }; if (diff < 0.01) break; }
    if (closestPair.diff < 0.5) { console.log(`Legkiegyensúlyozottabb totals: ${closestPair.line}`); return closestPair.line; }
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5; points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    console.log(`Nincs kiegyensúlyozott vonal, defaulthoz (${numericDefaultLine}) legközelebbi: ${points[0]}`); return points[0];
}

// --- ESPN MECCSLEKÉRDEZÉS (SOCCER, NBA) ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) { console.warn(`_getFixturesFromEspn: Nincs ESPN konfig (${sport}).`); return []; }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); });
    const promises = []; console.log(`ESPN (${sport}): ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) { console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`); continue; }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre' && event.competitions?.[0]?.competitors?.length === 2)
                    .map(event => {
                        const competition = event.competitions?.[0]; if (!competition) return null;
                        const homeTeamData = competition.competitors?.find(c => c.homeAway === 'home')?.team; const awayTeamData = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        const homeName = homeTeamData ? String(homeTeamData.shortDisplayName || homeTeamData.displayName || homeTeamData.name || '').trim() : null;
                        const awayName = awayTeamData ? String(awayTeamData.shortDisplayName || awayTeamData.displayName || awayTeamData.name || '').trim() : null;
                        const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;
                        if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                            const uniqueId = `${sport}_${homeName.toLowerCase().replace(/\s+/g, '')}_${awayName.toLowerCase().replace(/\s+/g, '')}`;
                            return { id: String(event.id), home: homeName, away: awayName, utcKickoff: event.date, league: safeLeagueName, uniqueId: uniqueId };
                        } else { console.warn(`_getFixturesFromEspn: Hiányos adatú esemény: ID=${event.id}, H=${homeName}, A=${awayName}, D=${event.date}`); return null; }
                    }).filter(Boolean);
            }).catch(error => { const displayUrl = url; if (error.response?.status === 400 || error.message.includes('404')) { console.warn(`ESPN Hiba (40x): Slug '${slug}' (${leagueName})? URL: ${displayUrl}`); } else { console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`); } return []; }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises); const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.uniqueId && !uniqueFixturesMap.has(f.uniqueId)) { uniqueFixturesMap.set(f.uniqueId, f); } });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => { const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff); if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1; return dateA - dateB; });
        console.log(`ESPN (${sport}): ${finalFixtures.length} egyedi meccs lekérve.`); return finalFixtures;
    } catch (e) { console.error(`ESPN (${sport}) feldolgozási hiba: ${e.message}`, e.stack?.substring(0, 300)); return []; }
}

// --- ÚJ: API SPORTS MECCSLEKÉRDEZÉS (HOCKEY, BASKETBALL - kivéve NBA) ---
export async function _getFixturesFromApiSports(sport, days) {
    const sportConfig = SPORT_CONFIG[sport]; const leagueIds = sportConfig.api_sports_leagues ? Object.values(sportConfig.api_sports_leagues) : [];
    if (!APIFOOTBALL_API_KEY || leagueIds.length === 0) { console.warn(`_getFixturesFromApiSports: Nincs API kulcs vagy liga (${sport}).`); return []; }
    const baseUrl = APIFOOTBALL_BASE_URL; const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromApiSports: Érvénytelen napok: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0]; });
    const promises = []; console.log(`API Sports (${sport}): ${daysInt} nap, ${leagueIds.length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const leagueId of leagueIds) {
            const url = `${baseUrl}/fixtures?league=${leagueId}&season=${CURRENT_SEASON}&date=${dateString}&status=NS`;
            promises.push(makeRequest(url, { headers: APIFOOTBALL_HEADERS, timeout: 10000 }).then(response => {
                if (!response?.data?.response || response.data?.results === 0) { return []; }
                return response.data.response
                    .filter(fix => fix.teams?.home?.name && fix.teams?.away?.name && fix.fixture?.date)
                    .map(fix => {
                        const homeName = String(fix.teams.home.name || '').trim(); const awayName = String(fix.teams.away.name || '').trim();
                        const leagueInfo = Object.entries(sportConfig.api_sports_leagues).find(([name, id]) => id == leagueId); const leagueDisplayName = leagueInfo ? leagueInfo[0] : `Liga ID: ${leagueId}`;
                        if (homeName && awayName && fix.fixture.date) {
                             const uniqueId = `${sport}_${homeName.toLowerCase().replace(/\s+/g, '')}_${awayName.toLowerCase().replace(/\s+/g, '')}`;
                            return { id: String(fix.fixture.id), home: homeName, away: awayName, utcKickoff: fix.fixture.date, league: leagueDisplayName, uniqueId: uniqueId };
                        } else { console.warn(`_getFixturesFromApiSports: Hiányos adatú fixture: ${JSON.stringify(fix)}`); return null; }
                    }).filter(Boolean);
            }).catch(error => { console.error(`API Sports Hiba (${sport}, Liga: ${leagueId}, Dátum: ${dateString}): ${error.message}`); return []; }));
            await new Promise(resolve => setTimeout(resolve, 100)); // Növelt várakozás
        }
    }
    try {
        const results = await Promise.all(promises); const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.uniqueId && !uniqueFixturesMap.has(f.uniqueId)) { uniqueFixturesMap.set(f.uniqueId, f); } else if (f?.id && !uniqueFixturesMap.has(f.id)) { console.warn(`Duplicate uniqueId, using API ID: ${f.id}`); uniqueFixturesMap.set(f.id, f); } });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => { const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff); if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1; return dateA - dateB; });
        console.log(`API Sports (${sport}): ${finalFixtures.length} egyedi meccs lekérve.`); return finalFixtures;
    } catch (e) { console.error(`API Sports (${sport}) feldolgozási hiba: ${e.message}`, e.stack?.substring(0, 300)); return []; }
}