// providers/newHockeyProvider.js
// Implementáció az "Ice Hockey Data" API-hoz (ice-hockey-data.p.rapidapi.com)

import axios from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

import {
    SPORT_CONFIG,
    // JAVÍTÁS: Kulcsok importálása a központi configból
    HOCKEY_API_KEY,
    HOCKEY_API_HOST
} from '../config.js'; // Figyelj a relatív elérési útra!
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData,
    makeRequest // Az általános hívót használjuk
} from './common/utils.js';
// --- JÉGKORONG SPECIFIKUS CACHE-EK ---
const hockeyLeagueCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const hockeyStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- API HÍVÓ SEGÉDFÜGGVÉNY (JAVÍTOTT HIBAKEZELÉSSEL) ---
async function makeHockeyRequest(endpoint, params = {}) {
    if (!HOCKEY_API_KEY || !HOCKEY_API_HOST) {
        throw new Error('[Hockey API] Hiányzó HOCKEY_API_KEY vagy HOCKEY_API_HOST a config.js-ben.');
    }

    const options = {
        method: 'GET',
        url: `https://${HOCKEY_API_HOST}${endpoint}`,
        params: params,
        headers: {
            'X-RapidAPI-Key': HOCKEY_API_KEY,
            'X-RapidAPI-Host': HOCKEY_API_HOST
        }
    };
    try {
        // A 'makeRequest' általános hívót használjuk 0 újrapróbálkozással
        const response = await makeRequest(options.url, { headers: options.headers, params: options.params }, 0);
        
        if (!response || !response.data) {
            throw new Error(`[Hockey API Hiba] Üres válasz érkezett. Endpoint: ${endpoint}`);
        }
        return response.data;
    } catch (error) {
        console.error(`[Hockey API Hiba] A hívás sikertelen. Endpoint: ${endpoint} - ${error.message}`);
        
        // JAVÍTÁS: NEM nyeljük el a hibát. Dobjuk tovább, hogy a DataFetch Factory elkapja.
        // A 'return null' elrejti a valódi hiba okát.
        throw error;
    }
}

// --- ADATLEKÉRŐ FÜGGVÉNYEK ---

async function getHockeyLeagueId(leagueName) {
    const cacheKey = `hockey_league_${leagueName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyLeagueCache.get(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Liga keresés: "${leagueName}"`);
    const data = await makeHockeyRequest('/tournament/list');
    if (!data?.tournaments) {
        console.warn(`[Hockey API] Nem sikerült lekérni a liga listát.`);
        return null;
    }

    const leagueNames = data.tournaments.map(t => t.name);
    const bestMatch = findBestMatch(leagueName, leagueNames);
    if (bestMatch.bestMatch.rating > 0.8) {
        const leagueId = data.tournaments[bestMatch.bestMatchIndex].id;
        console.log(`[Hockey API] Liga találat: "${leagueName}" -> "${bestMatch.bestMatch.target}" (ID: ${leagueId})`);
        hockeyLeagueCache.set(cacheKey, leagueId);
        return leagueId;
    }
    
    console.warn(`[Hockey API] Nem található liga: "${leagueName}"`);
    hockeyLeagueCache.set(cacheKey, null);
    return null;
}

async function getHockeyTeamId(teamName, leagueId) {
    const cacheKey = `hockey_team_${leagueId}_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyTeamCache.get(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Csapat keresés: "${teamName}" (Liga ID: ${leagueId})`);
    const data = await makeHockeyRequest('/tournament/teams', { tournamentId: leagueId });

    if (!data?.teams) {
        console.warn(`[Hockey API] Nem sikerült lekérni a csapatokat a ${leagueId} ligából.`);
        return null;
    }

    const teamNames = data.teams.map(t => t.name);
    const bestMatch = findBestMatch(teamName, teamNames);
    if (bestMatch.bestMatch.rating > 0.8) {
        const teamId = data.teams[bestMatch.bestMatchIndex].id;
        console.log(`[Hockey API] Csapat találat: "${teamName}" -> "${bestMatch.bestMatch.target}" (ID: ${teamId})`);
        hockeyTeamCache.set(cacheKey, teamId);
        return teamId;
    }
    
    console.warn(`[Hockey API] Nem található csapat: "${teamName}" a ${leagueId} ligában.`);
    hockeyTeamCache.set(cacheKey, null);
    return null;
}

async function findHockeyFixture(homeTeamId, awayTeamId, leagueId, utcKickoff) {
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const cacheKey = `hockey_fixture_${leagueId}_${homeTeamId}_${awayTeamId}_${matchDate}`;
    const cached = hockeyFixtureCache.get(cacheKey);
    if (cached) return cached;
    console.log(`[Hockey API] Meccs keresés: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    const data = await makeHockeyRequest('/tournament/fixture', { tournamentId: leagueId, date: matchDate });
    if (!data?.fixtures) {
        console.warn(`[Hockey API] Nem találhatók meccsek erre a napra: ${matchDate}`);
        return null;
    }

    const fixture = data.fixtures.find(f => f.home.id === homeTeamId && f.away.id === awayTeamId);
    if (fixture) {
        console.log(`[Hockey API] MECCS TALÁLAT! FixtureID: ${fixture.id}`);
        hockeyFixtureCache.set(cacheKey, fixture.id);
        return fixture.id;
    }

    console.warn(`[Hockey API] Nem található meccs: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    hockeyFixtureCache.set(cacheKey, null);
    return null;
}

async function getHockeyStats(leagueId) {
    // Ez az API a "Tournament Standings" végponton adja vissza a statisztikákat
    const cacheKey = `hockey_stats_${leagueId}`;
    const cached = hockeyStatsCache.get(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Statisztika lekérés (Standings)... (Liga ID: ${leagueId})`);
    const data = await makeHockeyRequest('/tournament/standings', { tournamentId: leagueId });

    if (!data?.standings) {
        console.warn(`[Hockey API] Nem sikerült lekérni a statisztikákat a ${leagueId} ligából.`);
        return null;
    }
    
    // Alakítsuk át az adatokat egy könnyen kereshető formátumba (teamId kulccsal)
    const statsMap = new Map();
    for (const group of data.standings) {
        for (const row of group.rows) {
            statsMap.set(row.team.id, row);
        }
    }
    
    console.log(`[Hockey API] Statisztikák sikeresen feldolgozva ${statsMap.size} csapatra.`);
    hockeyStatsCache.set(cacheKey, statsMap);
    return statsMap;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData ---
export async function fetchMatchData(options) {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    console.log(`[Hockey Provider] Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

    // --- 1. LIGA és CSAPAT ID-k ---
    const leagueId = await getHockeyLeagueId(leagueName);
    if (!leagueId) {
        throw new Error(`[Hockey API] Nem található liga: "${leagueName}". Az elemzés leáll.`);
    }

    const [homeTeamId, awayTeamId] = await Promise.all([
        getHockeyTeamId(homeTeamName, leagueId),
        getHockeyTeamId(awayTeamName, leagueId)
    ]);
    if (!homeTeamId || !awayTeamId) {
        throw new Error(`[Hockey API] Csapat ID nem található: Home(${homeTeamName}) vagy Away(${awayTeamName}).`);
    }

    // --- 2. MECCS és STATISZTIKA ---
    const [fixtureId, statsMap] = await Promise.all([
        findHockeyFixture(homeTeamId, awayTeamId, leagueId, utcKickoff),
        getHockeyStats(leagueId)
    ]);
    // --- 3. ADATOK KINYERÉSE ---
    const homeStats = statsMap ? statsMap.get(homeTeamId) : null;
    const awayStats = statsMap ? statsMap.get(awayTeamId) : null;

    // --- 4. STATISZTIKÁK EGYSÉGESÍTÉSE (NORMALIZÁLÁS) ---
    const unifiedHomeStats = {
        gamesPlayed: homeStats?.played ||
 0,
        form: homeStats?.form ||
 'N/A', // Ez az API 'form' stringet ad (pl. "LWWWL")
        goalsFor: homeStats?.scoresFor ||
 0,
        goalsAgainst: homeStats?.scoresAgainst || 0
    };
    const unifiedAwayStats = {
        gamesPlayed: awayStats?.played ||
 0,
        form: awayStats?.form ||
 'N/A',
        goalsFor: awayStats?.scoresFor ||
 0,
        goalsAgainst: awayStats?.scoresAgainst || 0
    };
    // --- 5. GEMINI HÍVÁS (Kontextus) ---
    const geminiJsonString = await _callGemini(PROMPT_V43(
         sport, homeTeamName, awayTeamName,
         unifiedHomeStats, unifiedAwayStats,
         null, // H2H (ez az API nem támogatja)
         null // Lineups
    ));
    let geminiData = {};
    try { 
        geminiData = geminiJsonString ?
 JSON.parse(geminiJsonString) : {};
    } catch (e) { 
        console.error(`[Hockey API] Gemini JSON parse hiba: ${e.message}`);
    }

    // --- 6. VÉGLEGES ADAT EGYESÍTÉS ---
    const finalData = { ...geminiData };
    const finalHomeStats = {
        ...(geminiData.stats?.home || {}),
        ...unifiedHomeStats,
        GP: unifiedHomeStats.gamesPlayed
    };
    const finalAwayStats = {
        ...(geminiData.stats?.away || {}),
        ...unifiedAwayStats,
        GP: unifiedAwayStats.gamesPlayed
    };
    finalData.stats = { home: finalHomeStats, away: finalAwayStats };
    console.log(`[Hockey API] Végleges stats használatban: Home(GP:${finalHomeStats.GP}), Away(GP:${finalAwayStats.GP})`);

    const stadiumLocation = geminiData?.contextual_factors?.stadium_location ||
 "N/A";
    const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
    if (!finalData.contextual_factors) finalData.contextual_factors = {};
    finalData.contextual_factors.structured_weather = structuredWeather;
    const richContext = [
         geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
         geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
         geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
         (finalHomeStats.form !== 'N/A' || finalAwayStats.form !== 'N/A') && `- Forma: H:${finalHomeStats.form}, V:${finalAwayStats.form}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`
    ].filter(Boolean).join('\n') ||
 "N/A";

    const result = {
         rawStats: finalData.stats,
         leagueAverages: geminiData.league_averages ||
 {},
         richContext,
         advancedData: geminiData.advancedData ||
 { home: {}, away: {} },
         form: { home_overall: finalHomeStats.form, away_overall: finalAwayStats.form },
         rawData: finalData,
         oddsData: null, // Ez az API nem szolgáltat odds-okat
         fromCache: false
    };
    // Kritikus ellenőrzés
    if (typeof result.rawStats?.home?.GP !== 'number' || result.rawStats.home.GP <= 0 || typeof result.rawStats?.away?.GP !== 'number' || result.rawStats.away.GP <= 0) {
        console.warn(`[Hockey API] Figyelmeztetés: Érvénytelen statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.GP}, AwayGP: ${result.rawStats?.away?.GP}`);
        if (result.rawStats.home.GP <= 0) result.rawStats.home.GP = 1;
        if (result.rawStats.away.GP <= 0) result.rawStats.away.GP = 1;
    }

    return result;
}

export const providerName = 'ice-hockey-data';