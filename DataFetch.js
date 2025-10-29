// --- VÉGLEGES INTEGRÁLT (v37 - Név Térképezés Javítás) datafetch.js ---
// - V37 JAVÍTÁS: A 'getApiFootballTeamId' most már aktívan HASZNÁLJA
// a 'APIFOOTBALL_TEAM_NAME_MAP'-et a 'config.js'-ből, hogy
// megoldja az "LAFC" és "Austin FC" típusú név-eltérési hibákat.
// - MEGTARTVA (v36): Kompatibilitás az AnalysisFlow.js-sel.
// - MEGTARTVA (v35): API-Football Odds használata.
// - MEGTARTVA (v34): Bombabiztos GP statisztika-egyesítés.

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    APIFOOTBALL_KEY, APIFOOTBALL_HOST,
    ODDS_TEAM_NAME_MAP,
    APIFOOTBALL_TEAM_NAME_MAP // <-- V37: Szükséges import
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { fileURLToPath } from 'url';
import path from 'path';

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const apiFootballOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); 
const apiFootballTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiFootballStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiFootballFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v37 (2025-10-29) - API-Football Név Térképezés Javítás
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

// --- *** JAVÍTOTT FÜGGVÉNY (v37) *** ---
// Ez a függvény most már használja az APIFOOTBALL_TEAM_NAME_MAP-et.
async function getApiFootballTeamId(teamName) {
    if (!APIFOOTBALL_KEY) { console.warn("API-FOOTBALL kulcs hiányzik, csapat ID keresés kihagyva."); return null; }
    
    const lowerName = teamName.toLowerCase().trim();
    
    // V37 JAVÍTÁS: Használjuk a config.js-ben definiált térképet a pontosabb kereséshez.
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName; // A név, amit valójában keresünk
    
    const cacheKey = `apifootball_teamid_v37_${searchName.toLowerCase().replace(/\s+/g, '')}`;
    
    const cachedId = apiFootballTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { 
        return cachedId === 'not_found' ? null : cachedId; 
    }

    // A 'searchName'-t (a térképezett nevet) használjuk 'teamName' helyett
    const url = `${APIFOOTBALL_BASE_URL}/v3/teams?search=${encodeURIComponent(searchName)}`;
    
    if (mappedName !== teamName) {
        console.log(`API-FOOTBALL Név Térképezés: "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    }

    const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS });
    if (response?.data?.response?.length > 0) {
        const teams = response.data.response;
        
        // 1. Keressünk TÖKÉLETES EGYEZÉST a 'searchName'-mel
        const perfectMatch = teams.find(t => t.team?.name.toLowerCase() === searchName.toLowerCase());
        if (perfectMatch) {
            const teamId = perfectMatch.team.id;
            console.log(`API-FOOTBALL: TÖKÉLETES ID találat "${searchName}" -> ${teamId}`);
            apiFootballTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }

        // 2. Ha nincs tökéletes egyezés, jöhet a string hasonlóság
        const teamNames = teams.map(t => t.team?.name);
        const matchResult = findBestMatch(searchName, teamNames);
        if (matchResult.bestMatch.rating > 0.6) {
            const teamId = teams[matchResult.bestMatchIndex].team.id;
            console.log(`API-FOOTBALL: Hasonló ID találat "${searchName}" -> "${teams[matchResult.bestMatchIndex].team.name}" -> ${teamId}`);
            apiFootballTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }
    }
    
    // Ha idáig eljut, a keresés sikertelen volt
    console.warn(`API-FOOTBALL: Nem található csapat ID ehhez: "${searchName}" (eredeti: "${teamName}").`);
    apiFootballTeamIdCache.set(cacheKey, 'not_found');
    return null;
}
// --- *** JAVÍTOTT FÜGGVÉNY VÉGE (v37) *** ---

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


// --- *** API-FOOTBALL ODDS FUNKCIÓ (v35) *** ---
async function getApiFootballOdds(fixtureId) {
    if (!fixtureId) {
        console.warn("API-Football Odds: Hiányzó fixtureId, a szorzók lekérése kihagyva.");
        return null;
    }
    
    const cacheKey = `apifootball_odds_v35_${fixtureId}`;
    const cached = apiFootballOddsCache.get(cacheKey);
    if (cached) {
        console.log(`API-Football Odds cache találat: ${cacheKey}`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs API-Football Odds cache (${cacheKey}). Friss lekérés...`);
    const url = `${APIFOOTBALL_BASE_URL}/v3/odds`;
    const params = { fixture: fixtureId };
    
    const response = await makeRequest(url, { headers: APIFOOTBALL_HEADERS, params });

    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`API-Football Odds: Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
        return null;
    }

    const oddsData = response.data.response[0]; 
    const bookmaker = oddsData.bookmakers?.find(b => b.name === "Bet365") || oddsData.bookmakers?.[0];
    const matchWinnerMarket = bookmaker?.bets?.find(b => b.name === "Match Winner");
    
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
        apiFootballOddsCache.set(cacheKey, result);
        console.log(`API-Football Odds adatok sikeresen lekérve és cache-elve: ${cacheKey}`);
    } else {
         console.warn(`API-Football Odds: Találat, de nem sikerült 'Match Winner' piacot találni.`);
    }

    return { ...result, fromCache: false };
}

// --- *** Fő gólvonal kereső (v35) *** ---
export function findMainTotalsLine(oddsData) {
    const defaultLine = 2.5;
    
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultLine;
    }

    const bookmaker = oddsData.fullApiData.bookmakers.find(b => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultLine;

    const totalsMarket = bookmaker.bets.find(b => b.name.toLowerCase() === "over/under");
    if (!totalsMarket?.values) {
        console.warn("Nem található 'Over/Under' piac a szorzókban.");
        return defaultLine;
    }

    const linesAvailable = {}; 

    for (const val of totalsMarket.values) {
        const lineMatch = val.value.match(/(\d\.\d)/);
        if (!lineMatch || !lineMatch[1]) continue;
        
        const line = lineMatch[1]; 
        if (!linesAvailable[line]) linesAvailable[line] = {};

        if (val.value.toLowerCase().startsWith("over")) {
            linesAvailable[line].over = parseFloat(val.odd);
        } else if (val.value.toLowerCase().startsWith("under")) {
            linesAvailable[line].under = parseFloat(val.odd);
        }
    }

    if (Object.keys(linesAvailable).length === 0) {
        return defaultLine;
    }

    let closestPair = { diff: Infinity, line: defaultLine };

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

    const numericDefaultLine = 2.5;
    const numericLines = Object.keys(linesAvailable).map(parseFloat);
    numericLines.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return numericLines[0];
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (v36 - Kompatibilitás Javítva) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v37_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // v37
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        
        const fixtureId = cached.rawData.apiFootballData.fixtureId;
        const oddsResult = await getApiFootballOdds(fixtureId); 
        
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
        
        console.log(`Adatgyűjtés indul (v37 - API-Football): ${homeTeamName} vs ${awayTeamName}...`);
        
        // --- V37: A 'getApiFootballTeamId' HÍVÁS MOST MÁR A NÉV TÉRKÉPET HASZNÁLJA ---
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiFootballTeamId(homeTeamName),
            getApiFootballTeamId(awayTeamName),
        ]);
        
        // --- V36 KRITIKUS HIBAKEZELÉS ---
        // Ha a (már térképezett) nevekkel sem talál ID-t, a program leáll.
        if (!homeTeamId || !awayTeamId) { 
            throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`); 
        }
        
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig.espn_leagues[leagueName];
        if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
        
        const leagueId = await getApiFootballLeagueId(leagueName, leagueData.country, season);
        if (!leagueId) throw new Error(`Nem sikerült a 'leagueId' azonosítása.`);
        console.log(`API-Football: Végleges LeagueID: ${leagueId}`);
        
        const { fixtureId, fixtureDate } = await findApiFootballFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff);
        
        if (!fixtureId) {
             console.warn(`API-Football: Nem található fixture, az odds lekérés és a H2H kihagyva.`);
        }

        console.log(`API-Football: Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
        const [
            fetchedOddsData,
            apiFootballH2HData,
            apiFootballHomeSeasonStats,
            apiFootballAwaySeasonStats
        ] = await Promise.all([
            getApiFootballOdds(fixtureId), 
            getApiFootballH2H(homeTeamId, awayTeamId, 5),
            getApiFootballTeamSeasonStats(homeTeamId, leagueId, season),
            getApiFootballTeamSeasonStats(awayTeamId, leagueId, season)
        ]);
        console.log(`API-Football: Párhuzamos lekérések befejezve.`);
        
        const geminiJsonString = await _callGemini(PROMPT_V43(
             sport, homeTeamName, awayTeamName,
             apiFootballHomeSeasonStats, apiFootballAwaySeasonStats,
             apiFootballH2HData,
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

        // --- *** VÉGLEGES ADAT EGYESÍTÉS (v36) *** ---
        
        const finalData = { ...geminiData }; 
        const finalHomeStats = {
            ...(geminiData.stats?.home || {}),
            ...(apiFootballHomeSeasonStats || {}),
        };
        const homeGP = apiFootballHomeSeasonStats?.gamesPlayed || geminiData.stats?.home?.gp || 1;
        finalHomeStats.GP = homeGP;
        finalHomeStats.gp = homeGP;
        finalHomeStats.gamesPlayed = homeGP;

        const finalAwayStats = {
            ...(geminiData.stats?.away || {}),
            ...(apiFootballAwaySeasonStats || {}),
        };
        const awayGP = apiFootballAwaySeasonStats?.gamesPlayed || geminiData.stats?.away?.gp || 1;
        finalAwayStats.GP = awayGP;
        finalAwayStats.gp = awayGP;
        finalAwayStats.gamesPlayed = awayGP;

        finalData.stats = {
            home: finalHomeStats,
            away: finalAwayStats
        };
        console.log(`Végleges stats használatban: Home(GP:${homeGP}, GF:${finalHomeStats.goalsFor ?? 'N/A'}, GA:${finalHomeStats.goalsAgainst ?? 'N/A'}), Away(GP:${awayGP}, GF:${finalAwayStats.goalsFor ?? 'N/A'}, GA:${finalAwayStats.goalsAgainst ?? 'N/A'})`);

        finalData.apiFootballData = {
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: null, 
            liveStats: null, 
            seasonStats: { home: apiFootballHomeSeasonStats, away: apiFootballAwaySeasonStats }
        };
        finalData.sportsDbData = finalData.apiFootballData; 
        finalData.h2h_structured = apiFootballH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";

        const homeForm = apiFootballHomeSeasonStats?.form || geminiData?.form?.home_overall || "N/A";
        const awayForm = apiFootballAwaySeasonStats?.form || geminiData?.form?.away_overall || "N/A";
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

        // --- Végleges Visszatérési Objektum (v36) ---
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
        console.log(`Sikeres adatgyűjtés (v37), cache mentve (${ck}).`);
        return result;

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v37) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        // A v36-os hibakezelés (a 426. soron) már itt van, a try/catch blokk elején
        throw new Error(`Adatgyűjtési hiba (v37): ${e.message}`);
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

// --- PROMPT (v25 alapján) ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiFootballHomeSeasonStats, apiFootballAwaySeasonStats, apiFootballH2HData, apiFootballLineups) {
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Football season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats (gp, gf, ga).\n";
    if (apiFootballHomeSeasonStats || apiFootballAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats (gp, gf, ga, form) have been PRE-CALCULATED from API-Football.
Use these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
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
        h2hInfo = `CRITICAL H2H DATA (from API-FOOTBALL, Last ${apiFootballH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields.
Do not use your internal knowledge for H2H.\n`;
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
        lineupInfo = `CRITICAL LINEUP DATA (from API-Football): ${JSON.stringify(relevantLineupData)}\nUse THIS data *first* to determine absentees, key players, and formation.
This is more reliable than general knowledge.\n`;
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
1. Basic Stats: gp, gf, ga.
**USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-FOOTBALL H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis.
**(CRITICAL: Use the API-Football LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall).
**(CRITICAL: Use the 'Form' string from the API-Football Season Stats provided above.)** Provide home_home and away_away based on general knowledge if season stats are limited.
5. Key Players: name, role, recent key stat. **(Use API-Football LINEUP data to see who is STARTING).**
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation.
**(CRITICAL: Infer formation from the 'formation' field in the API-Football LINEUP data. If N/A, use your knowledge but state it's an estimate).**
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
