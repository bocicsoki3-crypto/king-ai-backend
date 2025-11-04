// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v54.25 (API Paraméter Fix)
// MÓDOSÍTÁS:
// 1. Javítva a TS2304 / 400-as build hiba .
// 2. Az '_getNhlTeamList' funkcióban a 'makeHockeyRequest' hívásból
//    eltávolítva a hibás { sort: "teamName", limit: -1 } paraméterek,
//    amelyek az API 400-as hibáját ("Invalid path 'teamName'")  okozták.

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
// ÚJ CACHE: A szezonfüggetlen csapatlistának
const nhlTeamListCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });

// --- ÚJ NHL API KONFIGURÁCIÓ ---
const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1';
const NHL_STATS_API_BASE_URL = 'https://api.nhle.com/stats/rest/en'; // Stabilabb végpont a csapatokhoz
const NHL_LEAGUE_ID = 'NHL';

/**
 * Módosított API hívó, amely a hivatalos NHL API-t hívja (nincs szükség kulcsra).
 */
async function makeHockeyRequest(url: string, params: any = {}) {
    // A hívónak kell megadnia a teljes URL-t (mivel 2 API-t is használunk)
    try {
        const response = await makeRequest(url, { params: params, timeout: 15000 }, 0);
        if (!response || !response.data) {
            throw new Error(`[NHL API Hiba] Üres válasz érkezett. URL: ${url}`);
        }
        return response.data;
    } catch (error: any) {
        console.error(`[NHL API Hiba] A hívás sikertelen. URL: ${url} - ${error.message}`);
        throw error;
    }
}

// --- ADATLEKÉRŐ FÜGGVÉNYEK (JAVÍTVA) ---

/**
 * Lekéri és cache-eli a teljes NHL tabellát (STATISZTIKÁKHOZ).
 * (v54.22): Fallback logikát tartalmaz a '/standings/{date}' végpontra.
 */
async function _getNhlStandings(utcKickoff: string): Promise<any[]> {
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0]; // YYYY-MM-DD
    const cacheKey = `nhl_standings_v2_fallback_${matchDate}`;
    
    const cached = hockeyStatsCache.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] Tabella (Statisztika) CACHE TALÁLAT (${cacheKey}).`);
        return cached;
    }
    
    let data: any = null;
    let sourceEndpoint = `${NHL_API_BASE_URL}/standings/now`;

    // 1. Próba: A 'now' végpont hívása
    try {
        console.log(`[NHL API] Tabella (Statisztika) lekérése (1. Próba: ${sourceEndpoint})...`);
        data = await makeHockeyRequest(sourceEndpoint, {});
    } catch (e: any) {
        console.warn(`[NHL API] A '${sourceEndpoint}' hívása sikertelen: ${e.message}. Fallback indítása...`);
        data = null;
    }

    // 2. Ellenőrzés és Fallback
    const standings = data?.standings || [];
    const allRows = standings.flatMap((s: any) => s.rows || []);
    
    if (allRows.length === 0) {
        console.warn(`[NHL API] Az elsődleges '${sourceEndpoint}' végpont 0 statisztikát adott vissza. Fallback indítása a meccs dátumára (${matchDate})...`);
        sourceEndpoint = `${NHL_API_BASE_URL}/standings/${matchDate}`;
        try {
            data = await makeHockeyRequest(sourceEndpoint, {});
        } catch (e: any) {
             console.error(`[NHL API] A statisztika fallback hívás ('${sourceEndpoint}') is sikertelen: ${e.message}`);
             data = null;
        }
    }

    // 3. Feldolgozás (a sikeres hívásból)
    const finalStandings = data?.standings || [];
    const finalAllRows = finalStandings.flatMap((s: any) => s.rows || []);
    
    if (finalAllRows.length === 0) {
        console.warn(`[NHL API] A tabella (statisztika) lekérése sikertelen. A '${sourceEndpoint}' végpont 0 csapatot adott vissza. Az elemzés P4 becslés helyett 'gp: 1' placeholder adatokat fog használni.`);
        return []; // Üres tömböt adunk vissza, nem dobunk hibát
    }

    const uniqueTeamRows = Array.from(new Map(finalAllRows.map((row: any) => [row.team.id, row])).values());
    
    console.log(`[NHL API] Tabella (Statisztika) sikeresen lekérve ('${sourceEndpoint}' forrásból), ${uniqueTeamRows.length} egyedi csapat cache-elve (${cacheKey}).`);
    hockeyStatsCache.set(cacheKey, uniqueTeamRows);
    return uniqueTeamRows;
}

/**
 * ÚJ (v54.24): Lekéri a stabil, szezonfüggetlen csapatlistát (CSAPAT ID-KHEZ).
 * JAVÍTVA (v54.25): Eltávolítva a hibás 'sort' és 'limit' paraméterek.
 */
async function _getNhlTeamList(): Promise<{ id: number; name: string; abbrev: string; }[]> {
    const cacheKey = 'nhl_team_list_v1_stable';
    const cached = nhlTeamListCache.get<{ id: number; name: string; abbrev: string; }[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] Csapatlista (ID azonosításhoz) CACHE TALÁLAT.`);
        return cached;
    }

    const url = `${NHL_STATS_API_BASE_URL}/team`;
    console.log(`[NHL API] Csapatlista (ID azonosításhoz) lekérése (${url})...`);
    
    try {
        // === JAVÍTÁS (v54.25) ===
        // A { sort: "teamName", limit: -1 } paraméterek eltávolítva,
        // mivel ez okozta a 400-as Bad Request hibát.
        const data = await makeHockeyRequest(url, {});
        // === JAVÍTÁS VÉGE ===

        if (!data?.data || data.data.length === 0) {
             throw new Error("Az NHL API ('/team') 0 csapatot adott vissza.");
        }

        const teams = data.data.map((t: any) => ({
            id: t.id,
            name: t.fullName,
            abbrev: t.triCode
        }));
        
        console.log(`[NHL API] Csapatlista (ID azonosításhoz) sikeresen lekérve, ${teams.length} csapat cache-elve.`);
        nhlTeamListCache.set(cacheKey, teams);
        return teams;

    } catch (e: any) {
        console.error(`[NHL API] A stabil csapatlista ('${url}') lekérése sikertelen: ${e.message}`);
        // A [cite: 1656-1661] logban látható hibát dobjuk tovább
        throw new Error(`[NHL API] A csapat ID-k feloldásához szükséges csapatlista lekérése sikertelen: ${e.message}`);
    }
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
 * Megkeresi a csapat ID-t a ESPN név alapján a stabil csapatlistából.
 * (v54.24): A '_getNhlTeamList'-re támaszkodik.
 */
async function getHockeyTeamId(teamName: string): Promise<number | null> {
    const cacheKey = `hockey_team_nhl_v2_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyTeamCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[NHL API] Csapat ID keresés: "${teamName}"`);
    const teams = await _getNhlTeamList();

    const mappedName = SPORT_CONFIG.hockey.espn_leagues["NHL"].slug === 'nhl' 
        ? (teamName.split(' ').pop() || teamName)
        : teamName;

    // Az NHL API-ból jövő nevek (pl. "Buffalo Sabres") és rövidítések (pl. "BUF")
    const searchNames = teams.map(t => t.name).concat(teams.map(t => t.abbrev));
    // Az ESPN nevet (pl. "Sabres") keressük az NHL API nevei között
    const bestMatch = findBestMatch(mappedName, searchNames); 

    if (bestMatch.bestMatch.rating > 0.7) {
        const foundTeam = teams[bestMatch.bestMatchIndex % teams.length]; // Modulo a duplikált tömb miatt
        console.log(`[NHL API] Csapat ID találat: "${teamName}" (Keresve: "${mappedName}") -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        hockeyTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[NHL API] Nem található csapat ID: "${teamName}" (Keresve: "${mappedName}")`);
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
    const data = await makeHockeyRequest(`${NHL_API_BASE_URL}/schedule/${matchDate}`);

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


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.24) ---

export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff, manual_H_xG, manual_A_xG } = options;
    console.log(`[Hockey Provider (v54.25 - SPOF Fix)] Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

    // --- 1. LIGA és CSAPAT ID-k (Stabil) ---
    const leagueApiId = await getHockeyLeagueId(leagueName);
    if (!leagueApiId) {
        throw new Error(`[NHL API] Ez a provider csak az "NHL" ligát támogatja. Kapott: "${leagueName}". Az elemzés leáll.`);
    }

    const [homeTeamId, awayTeamId] = await Promise.all([
        getHockeyTeamId(homeTeamName), // Már nem kell 'utcKickoff'
        getHockeyTeamId(awayTeamName)
    ]);
    if (!homeTeamId || !awayTeamId) {
        throw new Error(`[NHL API] Csapat ID nem található: Home(${homeTeamName}=${homeTeamId}) vagy Away(${awayTeamName}=${awayTeamId}).`);
    }

    // --- 2. MECCS (Stabil) ---
    const fixtureId = await findHockeyFixture(homeTeamId, awayTeamId, utcKickoff);
    
    // --- 3. OPCIONÁLIS STATISZTIKÁK (P1/P4 Logika) ---
    let homeStatsApi: any = null;
    let awayStatsApi: any = null;
    let standingsSource = "N/A (P1 Manual xG)";

    // Csak akkor hívjuk a szezonális statisztika végpontot, ha NINCS manuális P1 adat megadva.
    // [cite: 997-998]
    if (manual_H_xG == null || manual_A_xG == null) {
        console.log(`[NHL API] P4-es ág (nincs manuális xG): Statisztikák lekérése a tabelláról...`);
        try {
            // Ez a hívás most már fallback-el, és 0-t ad vissza hiba esetén, ahelyett, hogy megszakadna
            const standingsRows = await _getNhlStandings(utcKickoff); 
            if (standingsRows.length > 0) {
                homeStatsApi = getStatsFromStandings(homeTeamId, standingsRows);
                awayStatsApi = getStatsFromStandings(awayTeamId, standingsRows);
                standingsSource = 'NHL API Standings (P4)';
            } else {
                 console.warn(`[NHL API] Figyelmeztetés: A tabella lekérése 0 csapatot adott vissza. Az elemzés 'gp: 1' placeholder statisztikákkal folytatódik.`);
                 standingsSource = 'Placeholder (Standings API hiba)';
            }
        } catch (e: any) {
             console.warn(`[NHL API] Figyelmeztetés: A tabella lekérése (P4) sikertelen (${e.message}). Az elemzés 'gp: 1' placeholder statisztikákkal folytatódik.`);
             standingsSource = 'Placeholder (Standings API hiba)';
        }
    } else {
         console.log(`[NHL API] P1-es ág (manuális xG észlelve): A szezonális statisztikák (Standings) lekérése kihagyva.`);
    }

    // --- 4. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL) ---
    // Ha a 'homeStatsApi' null (mert P1-et használunk, vagy hiba történt),
    // a 'gp: 1' biztosítja, hogy a Model.ts ne osszon nullával.
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
            home_absentee : [], // 'home_absentees'
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

    console.log(`[NHL API] Végleges stats használatban (Forrás: ${standingsSource}): Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
    
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
         geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
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
