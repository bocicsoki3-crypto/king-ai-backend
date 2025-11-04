// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v54.22 (Standings Fallback Fix)
// MÓDOSÍTÁS:
// 1. A '_getNhlStandings' [cite: 1313-1323] most már elfogadja a 'utcKickoff' dátumot.
// 2. IMPLEMENTÁLT FALLBACK: Ha a '/v1/standings/now'  0 csapatot ad vissza,
//    a provider automatikusan megpróbálja a '/v1/standings/{YYYY-MM-DD}' végpontot
//    a meccs dátumával. Ez kijavítja a [cite: 207] "A tabella üres" hibát.

import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds,
    IStructuredWeather
} from '../src/types/canonical.d.ts';

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData, // Ez még a stub [cite: 1056-1059]
    makeRequest // A központi, kulcs nélküli hívó [cite: 997-1019]
} from './common/utils.js';
import { SPORT_CONFIG } from '../config.js';

// --- JÉGKORONG SPECIFIKUS CACHE-EK ---
const hockeyLeagueCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const hockeyStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- ÚJ NHL API KONFIGURÁCIÓ ---
const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1';
const NHL_LEAGUE_ID = 'NHL';

/**
 * Módosított API hívó, amely a hivatalos NHL API-t hívja (nincs szükség kulcsra).
 */
async function makeHockeyRequest(endpoint: string, params: any = {}) {
    const url = `${NHL_API_BASE_URL}${endpoint}`;
    try {
        const response = await makeRequest(url, { params: params, timeout: 15000 }, 0);
        if (!response || !response.data) {
            throw new Error(`[NHL API Hiba] Üres válasz érkezett. Endpoint: ${endpoint}`);
        }
        return response.data;
    } catch (error: any) {
        console.error(`[NHL API Hiba] A hívás sikertelen. Endpoint: ${endpoint} - ${error.message}`);
        throw error;
    }
}

// --- ADATLEKÉRŐ FÜGGVÉNYEK (JAVÍTVA) ---

/**
 * Lekéri és cache-eli a teljes NHL tabellát.
 * JAVÍTVA (v54.22): Fallback logikát tartalmaz a '/standings/{date}' végpontra,
 * ha a '/standings/now' üres.
 */
async function _getNhlStandings(utcKickoff: string): Promise<any[]> {
    // A dátum alapú cache kulcs biztosítja, hogy a 'now' és a '{date}' hívások
    // külön cache-elődjenek, ha a meccs nem a mai napon van.
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0]; // YYYY-MM-DD
    const cacheKey = `nhl_standings_v2_fallback_${matchDate}`;
    
    const cached = hockeyStatsCache.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] Tabella CACHE TALÁLAT (${cacheKey}).`);
        return cached;
    }
    
    let data: any = null;
    let sourceEndpoint = '/standings/now';

    // 1. Próba: A 'now' végpont hívása
    try {
        console.log(`[NHL API] Tabella lekérése (1. Próba: ${sourceEndpoint})...`);
        data = await makeHockeyRequest(sourceEndpoint, {});
    } catch (e: any) {
        console.warn(`[NHL API] A '${sourceEndpoint}' hívása sikertelen: ${e.message}. Fallback indítása...`);
        data = null; // Biztosítjuk, hogy a fallback lefusson
    }

    // 2. Ellenőrzés és Fallback
    const standings = data?.standings || [];
    const allRows = standings.flatMap((s: any) => s.rows || []);
    
    if (allRows.length === 0) {
        console.warn(`[NHL API] Az elsődleges '${sourceEndpoint}' végpont 0 csapatot adott vissza. Fallback indítása a meccs dátumára (${matchDate})...`);
        sourceEndpoint = `/standings/${matchDate}`;
        try {
            data = await makeHockeyRequest(sourceEndpoint, {});
        } catch (e: any) {
             console.error(`[NHL API] A fallback hívás ('${sourceEndpoint}') is sikertelen: ${e.message}`);
             throw new Error(`[NHL API] A tabella lekérése végleg sikertelen (mind a 'now', mind a '${matchDate}' végpont hibát adott).`);
        }
    }

    // 3. Feldolgozás (a sikeres hívásból)
    const finalStandings = data?.standings || [];
    const finalAllRows = finalStandings.flatMap((s: any) => s.rows || []);
    
    if (finalAllRows.length === 0) {
        // Ez most már végleges hiba, ha a dátum alapú hívás sem adott vissza semmit
        throw new Error(`[NHL API] A tabella lekérése sikertelen. A '${sourceEndpoint}' végpont 0 csapatot adott vissza.`);
    }

    const uniqueTeamRows = Array.from(new Map(finalAllRows.map((row: any) => [row.team.id, row])).values());
    
    console.log(`[NHL API] Tabella sikeresen lekérve ('${sourceEndpoint}' forrásból), ${uniqueTeamRows.length} egyedi csapat cache-elve (${cacheKey}).`);
    hockeyStatsCache.set(cacheKey, uniqueTeamRows);
    return uniqueTeamRows;
}

/**
 * Ellenőrzi, hogy a liga "NHL"-e. (Változatlan)
 */
async function getHockeyLeagueId(leagueName: string): Promise<string | null> {
    const cacheKey = `hockey_league_${leagueName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyLeagueCache.get<string>(cacheKey);
    if (cached) return cached;

    if (leagueName.toLowerCase().trim() === 'nhl') {
        console.log(`[NHL API] Liga azonosítva: ${leagueName}`);
        hockeyLeagueCache.set(cacheKey, NHL_LEAGUE_ID);
        return NHL_LEAGUE_ID;
    }
    
    console.warn(`[NHL API] Ez a provider csak az "NHL" ligát támogatja. Kapott: "${leagueName}"`);
    hockeyLeagueCache.set(cacheKey, null);
    return null;
}

/**
 * Megkeresi a csapat ID-t a ESPN név alapján a cache-elt NHL tabellából.
 * JAVÍTVA (v54.22): Most már átveszi a 'utcKickoff'-ot, hogy továbbadja a '_getNhlStandings'-nek.
 */
async function getHockeyTeamId(teamName: string, utcKickoff: string): Promise<number | null> {
    const cacheKey = `hockey_team_nhl_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyTeamCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[NHL API] Csapat keresés: "${teamName}"`);
    // JAVÍTÁS: Átadjuk a dátumot a tabella lekérőnek
    const standingsRows = await _getNhlStandings(utcKickoff);
    if (standingsRows.length === 0) {
        // Ennek már nem szabadna megtörténnie a fallback miatt, de a biztonság kedvéért marad.
        throw new Error("[NHL API] A tabella üres, a csapat ID keresés sikertelen.");
    }

    const teams = standingsRows.map((row: any) => ({
        id: row.team.id,
        name: row.teamName.default,
        abbrev: row.teamAbbrev.default
    }));

    const mappedName = SPORT_CONFIG.hockey.espn_leagues["NHL"].slug === 'nhl' 
        ? (teamName.split(' ').pop() || teamName)
        : teamName;

    const searchNames = teams.map(t => t.name).concat(teams.map(t => t.abbrev));
    const bestMatch = findBestMatch(mappedName, searchNames); 

    if (bestMatch.bestMatch.rating > 0.7) {
        const foundTeam = teams[bestMatch.bestMatchIndex % teams.length];
        console.log(`[NHL API] Csapat találat: "${teamName}" (Keresve: "${mappedName}") -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        hockeyTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[NHL API] Nem található csapat: "${teamName}" (Keresve: "${mappedName}")`);
    hockeyTeamCache.set(cacheKey, null);
    return null;
}

/**
 * Megkeresi a meccs 'gamePk' azonosítóját a schedule végponton. (Változatlan)
 */
async function findHockeyFixture(homeTeamId: number, awayTeamId: number, utcKickoff: string): Promise<number | null> {
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0]; // YYYY-MM-DD
    
    const cacheKey = `hockey_fixture_nhl_${homeTeamId}_${awayTeamId}_${matchDate}`;
    const cached = hockeyFixtureCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[NHL API] Meccs keresés: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    const data = await makeHockeyRequest(`/schedule/${matchDate}`);

    if (!data?.gameWeek || data.gameWeek.length === 0 || !data.gameWeek[0].games) {
        console.warn(`[NHL API] Nem találhatók meccsek erre a napra: ${matchDate}`);
        return null;
    }

    const gamesToday = data.gameWeek[0].games;
    const fixture = gamesToday.find((f: any) => 
        f.homeTeam?.id === homeTeamId && f.awayTeam?.id === awayTeamId
    );

    if (fixture) {
        console.log(`[NHL API] MECCS TALÁLAT! FixtureID (gamePk): ${fixture.gamePk}`);
        hockeyFixtureCache.set(cacheKey, fixture.gamePk);
        return fixture.gamePk;
    }
    
    console.warn(`[NHL API] Nem található meccs: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    hockeyFixtureCache.set(cacheKey, null);
    return null;
}

/**
 * Kinyeri a statisztikákat a már cache-elt tabellából. (Változatlan)
 */
function getStatsFromStandings(teamId: number, standingsRows: any[]): any | null {
    if (!standingsRows) return null;
    return standingsRows.find((row: any) => row.team.id === teamId) || null;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.22) ---

export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    console.log(`[Hockey Provider (v54.22 - NHL API Fallback)] Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

    // --- 1. LIGA és TABELLA (STATISZTIKA) ---
    const leagueApiId = await getHockeyLeagueId(leagueName);
    if (!leagueApiId) {
        throw new Error(`[NHL API] Ez a provider csak az "NHL" ligát támogatja. Kapott: "${leagueName}". Az elemzés leáll.`);
    }

    // JAVÍTÁS: A '_getNhlStandings' hívása *először* történik, átadva a dátumot.
    // Ez biztosítja, hogy a tabella cache-elve legyen a 'getHockeyTeamId' hívások előtt.
    const standingsRows = await _getNhlStandings(utcKickoff);

    // --- 2. CSAPAT ID-k ---
    const [homeTeamId, awayTeamId] = await Promise.all([
        getHockeyTeamId(homeTeamName, utcKickoff), // Átadjuk a dátumot
        getHockeyTeamId(awayTeamName, utcKickoff)  // Átadjuk a dátumot
    ]);
    if (!homeTeamId || !awayTeamId) {
        throw new Error(`[NHL API] Csapat ID nem található: Home(${homeTeamName}=${homeTeamId}) vagy Away(${awayTeamName}=${awayTeamId}).`);
    }

    // --- 3. MECCS és STATISZTIKA Kinyerése ---
    const fixtureId = await findHockeyFixture(homeTeamId, awayTeamId, utcKickoff);
    const homeStatsApi = getStatsFromStandings(homeTeamId, standingsRows);
    const awayStatsApi = getStatsFromStandings(awayTeamId, standingsRows);

    // --- 4. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL) ---
    const unifiedHomeStats: ICanonicalStats = {
        gp: homeStatsApi?.gamesPlayed || 1,
        gf: homeStatsApi?.goalsFor || 0,
        ga: homeStatsApi?.goalsAgainst || 0,
        form: null 
    };
    const unifiedAwayStats: ICanonicalStats = {
        gp: awayStatsApi?.gamesPlayed || 1,
        gf: awayStatsApi?.goalsFor || 0,
        ga: awayStatsApi?.goalsAgainst || 0,
        form: null
    };

    // --- 5. GEMINI HÍVÁS (Kontextus) ---
    const geminiJsonString = await _callGemini(PROMPT_V43(
         sport, homeTeamName, awayTeamName,
         unifiedHomeStats,
         unifiedAwayStats, 
         null, null
    ));
    let geminiData: any = {};
    try { 
        geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};
    } catch (e: any) { 
        console.error(`[Hockey API] Gemini JSON parse hiba: ${e.message}`);
    }

    // --- 6. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL) ---
    
    const defaultStructuredWeather: IStructuredWeather = {
        description: "N/A (Beltéri)",
        temperature_celsius: -1,
        humidity_percent: null,
        wind_speed_kmh: null,
        precipitation_mm: null
    };

    const finalData: ICanonicalRawData = {
        stats: {
            home: { ...unifiedHomeStats, ...(geminiData.stats?.home || {}) },
            away: { ...unifiedAwayStats, ...(geminiData.stats?.away || {}) }
        },
        apiFootballData: {
            fixtureId: fixtureId,
            leagueId: leagueApiId,
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId
        },
        form: {
            home_overall: unifiedHomeStats.form,
            away_overall: unifiedAwayStats.form,
            ...geminiData.form
        },
        detailedPlayerStats: { 
            home_absentees: [], 
            away_absentees: [], 
            key_players_ratings: { home: {}, away: {} } 
        },
        absentees: { home: [], away: [] },
        h2h_structured: geminiData.h2h_structured || null,
        referee: {
            name: null,
            style: null
        },
        contextual_factors: {
            stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
            pitch_condition: "N/A (Jég)",
            weather: "N/A (Beltéri)",
            match_tension_index: geminiData?.contextual_factors?.match_tension_index || null,
            structured_weather: defaultStructuredWeather
        },
        ...geminiData
    };

    finalData.stats.home.gp = Math.max(1, unifiedHomeStats.gp);
    finalData.stats.away.gp = Math.max(1, unifiedAwayStats.gp);

    console.log(`[NHL API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
    
    const location = finalData.contextual_factors.stadium_location;
    let structuredWeather: IStructuredWeather = defaultStructuredWeather;
    if (location && location !== "N/A (Beltéri)" && location !== "N/A") {
        structuredWeather = await getStructuredWeatherData(location, utcKickoff);
    }

    finalData.contextual_factors.structured_weather = structuredWeather;
    finalData.contextual_factors.weather = structuredWeather.description || "N/A (Beltéri)";

    const richContext = [
         geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
         geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
         geminiData.team_news?.away && `- Hírek: V:${gemiminiData.team_news.away}`, // Javítás itt is, 'geminiData'
         (finalData.form.home_overall || finalData.form.away_overall) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
    ].filter(Boolean).join('\n') || "N/A";

    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: geminiData.league_averages || {},
         richContext,
         advancedData: geminiData.advancedData || { home: {}, away: {} },
         form: finalData.form,
         rawData: finalData,
         oddsData: null,
         fromCache: false
    };

    if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
        console.error(`[NHL API] KRITIKUS HIBA: Érvénytelen VÉGLEGES statisztikák (GP <= 0).`);
        throw new Error("Kritikus statisztikák (GP <= 0) érvénytelenek a providerben.");
    }

    return result;
}

export const providerName = 'nhl-official-api-v1';
