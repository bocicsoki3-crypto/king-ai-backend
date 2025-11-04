// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v54.21 (TS2304 'gemAta' Typo Fix)
// MÓDOSÍTÁS:
// 1. A 'fetchMatchData'  funkcióban a 'gemAta'  elgépelés javítva 'geminiData'-ra,
//    ami a TS2304 build hibát okozta.
// 2. A provider továbbra is a hivatalos, ingyenes NHL API-t ('https://api-web.nhle.com/v1') [cite: 1313-1315] használja.

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

// --- JÉGKORONG SPECIFIKUS CACHE-EK (Változatlanok) ---
const hockeyLeagueCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
// A 'hockeyStatsCache' mostantól a teljes NHL tabellát tárolja
const hockeyStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- ÚJ NHL API KONFIGURÁCIÓ ---
const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1';
const NHL_LEAGUE_ID = 'NHL'; // A 'leagueName' alapján

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

// --- ADATLEKÉRŐ FÜGGVÉNYEK (Újraimplementálva) ---

/**
 * Lekéri és cache-eli a teljes NHL tabellát, amely tartalmazza a statisztikákat és a csapat ID-ket.
 */
async function _getNhlStandings(): Promise<any[]> {
    const cacheKey = `nhl_standings_v1_full`;
    const cached = hockeyStatsCache.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] Tabella CACHE TALÁLAT.`);
        return cached;
    }
    
    console.log(`[NHL API] Tabella lekérése... (${NHL_API_BASE_URL}/standings/now)`);
    const data = await makeHockeyRequest('/standings/now', {});
    
    if (!data?.standings || data.standings.length === 0) {
        throw new Error("[NHL API] Nem sikerült lekérni a tabellát (standings üres).");
    }

    // Az NHL API több tabellát (wildcard, divízió stb.) visszaad.
    // Az első ('league') tartalmazza általában az összesített adatokat.
    const allRows = data.standings.flatMap((s: any) => s.rows || []);
    
    if (allRows.length < 30) { // Kevesebb mint 30 csapat?
         console.warn(`[NHL API] Figyelmeztetés: A tabella lekérés gyanúsan kevés csapatot (${allRows.length}) adott vissza.`);
    }

    // Duplikációk eltávolítása team.id alapján
    const uniqueTeamRows = Array.from(new Map(allRows.map((row: any) => [row.team.id, row])).values());
    
    console.log(`[NHL API] Tabella sikeresen lekérve, ${uniqueTeamRows.length} egyedi csapat cache-elve.`);
    hockeyStatsCache.set(cacheKey, uniqueTeamRows);
    return uniqueTeamRows;
}

/**
 * Ellenőrzi, hogy a liga "NHL"-e.
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
 */
async function getHockeyTeamId(teamName: string): Promise<number | null> {
    const cacheKey = `hockey_team_nhl_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyTeamCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[NHL API] Csapat keresés: "${teamName}"`);
    const standingsRows = await _getNhlStandings();
    if (standingsRows.length === 0) {
        throw new Error("[NHL API] A tabella üres, a csapat ID keresés sikertelen.");
    }

    const teams = standingsRows.map((row: any) => ({
        id: row.team.id,
        name: row.teamName.default,
        abbrev: row.teamAbbrev.default
    }));

    // Keresés a 'config.js'-ben definiált rövid nevek (pl. "Senators") alapján
    const mappedName = SPORT_CONFIG.hockey.espn_leagues["NHL"].slug === 'nhl' 
        ? (teamName.split(' ').pop() || teamName) // Pl. "Ottawa Senators" -> "Senators"
        : teamName;

    const searchNames = teams.map(t => t.name).concat(teams.map(t => t.abbrev));
    // Az ESPN nevet (pl. "Senators") keressük az NHL API nevei között
    const bestMatch = findBestMatch(mappedName, searchNames); 

    if (bestMatch.bestMatch.rating > 0.7) {
        const foundTeam = teams[bestMatch.bestMatchIndex % teams.length]; // Modulo a duplikált tömb miatt
        console.log(`[NHL API] Csapat találat: "${teamName}" (Keresve: "${mappedName}") -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        hockeyTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[NHL API] Nem található csapat: "${teamName}" (Keresve: "${mappedName}")`);
    hockeyTeamCache.set(cacheKey, null);
    return null;
}

/**
 * Megkeresi a meccs 'gamePk' azonosítóját a schedule végponton.
 */
async function findHockeyFixture(homeTeamId: number, awayTeamId: number, utcKickoff: string): Promise<number | null> {
    // Az NHL API UTC-ben dolgozik, de a biztonság kedvéért +/- 1 napot is ellenőrizhetnénk,
    // de a 'utcKickoff' [cite: 258-259] elvileg pontos.
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
 * Kinyeri a statisztikákat a már cache-elt tabellából.
 */
function getStatsFromStandings(teamId: number, standingsRows: any[]): any | null {
    if (!standingsRows) return null;
    return standingsRows.find((row: any) => row.team.id === teamId) || null;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.21) ---

export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    console.log(`[Hockey Provider (v54.21 - NHL API)] Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

    // --- 1. LIGA és TABELLA (STATISZTIKA) ---
    const leagueApiId = await getHockeyLeagueId(leagueName);
    if (!leagueApiId) {
        throw new Error(`[NHL API] Ez a provider csak az "NHL" ligát támogatja. Kapott: "${leagueName}". Az elemzés leáll.`);
    }

    // Egyszerre lekérjük a teljes tabellát, ez tartalmazza a statisztikákat ÉS a csapat ID-ket
    const standingsRows = await _getNhlStandings();

    // --- 2. CSAPAT ID-k ---
    const [homeTeamId, awayTeamId] = await Promise.all([
        getHockeyTeamId(homeTeamName), // A 'standingsRows' már cache-elve van
        getHockeyTeamId(awayTeamName)
    ]);
    if (!homeTeamId || !awayTeamId) {
        throw new Error(`[NHL API] Csapat ID nem található: Home(${homeTeamName}=${homeTeamId}) vagy Away(${awayTeamName}=${awayTeamId}).`);
    }

    // --- 3. MECCS és STATISZTIKA Kinyerése ---
    const fixtureId = await findHockeyFixture(homeTeamId, awayTeamId, utcKickoff);
    const homeStatsApi = getStatsFromStandings(homeTeamId, standingsRows);
    const awayStatsApi = getStatsFromStandings(awayTeamId, standingsRows);

    // --- 4. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL) ---
    // Az NHL API 'standings' adatai alapján
    const unifiedHomeStats: ICanonicalStats = {
        gp: homeStatsApi?.gamesPlayed || 1, // Biztosítjuk, hogy a GP > 0
        gf: homeStatsApi?.goalsFor || 0,
        ga: homeStatsApi?.goalsAgainst || 0,
        // Az NHL API 'streakCode' (pl. "W2") vagy 'l10Record' (pl. "6-3-1")
        // formátumot ad, ami nem kompatibilis a 'getFormPoints' [cite: 382-386] "WWLDW" elvárásával.
        // A 'null' átadása biztosítja, hogy a Model.ts [cite: 321-447] helyesen kezeli a helyzetet.
        form: null 
    };
    const unifiedAwayStats: ICanonicalStats = {
        gp: awayStatsApi?.gamesPlayed || 1, // Biztosítjuk, hogy a GP > 0
        gf: awayStatsApi?.goalsFor || 0,
        ga: awayStatsApi?.goalsAgainst || 0,
        form: null
    };

    // --- 5. GEMINI HÍVÁS (Kontextus) ---
    // A 'newHockeyProvider' (v54.9) [cite: 213-295] logikáját követve
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

    // --- 6. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v54.9) ---
    
    // Alapértelmezett 'structured_weather' (Beltéri sport)
    const defaultStructuredWeather: IStructuredWeather = {
        description: "N/A (Beltéri)",
        temperature_celsius: -1, // Szimbolikus érték
        humidity_percent: null,
        wind_speed_kmh: null,
        precipitation_mm: null
    };

    const finalData: ICanonicalRawData = {
        stats: {
            home: { ...unifiedHomeStats, ...(geminiData.stats?.home || {}) },
            away: { ...unifiedAwayStats, ...(geminiData.stats?.away || {}) }
        },
        apiFootballData: { // Átnevezhetnénk 'apiProviderData'-ra, de a kanonikus modell ezt várja
            fixtureId: fixtureId,
            leagueId: leagueApiId,
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId
        },
        form: {
            home_overall: unifiedHomeStats.form, // null
            away_overall: unifiedAwayStats.form, // null
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
            // === JAVÍTÁS (v54.21) ===
            // A 'gemAta'  (typo) javítva 'geminiData'-ra.
            stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
            // === JAVÍTÁS VÉGE ===
            pitch_condition: "N/A (Jég)",
            weather: "N/A (Beltéri)",
            match_tension_index: geminiData?.contextual_factors?.match_tension_index || null, // A v54.9-nek megfelelően string
            structured_weather: defaultStructuredWeather
        },
        ...geminiData
    };

    // GP felülírása a valós API adatokkal, biztosítva, hogy ne legyen 0 [cite: 323, 1384-1386]
    finalData.stats.home.gp = Math.max(1, unifiedHomeStats.gp);
    finalData.stats.away.gp = Math.max(1, unifiedAwayStats.gp);

    console.log(`[NHL API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);
    
    // A 'structured_weather' [cite: 1754-1756] hívása (beltéri sportnál felesleges, de a teljesség kedvéért)
    const location = finalData.contextual_factors.stadium_location;
    let structuredWeather: IStructuredWeather = defaultStructuredWeather;
    if (location && location !== "N/A (Beltéri)" && location !== "N/A") {
        // A 'getStructuredWeatherData' [cite: 1056-1059] jelenleg egy stub,
        // de ha implementálva lenne, itt hívódna
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

    // A végső ICanonicalRichContext objektum összeállítása [cite: 1214-1218]
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: geminiData.league_averages || {},
         richContext,
         advancedData: geminiData.advancedData || { home: {}, away: {} },
         form: finalData.form,
         rawData: finalData,
         oddsData: null, // Az NHL API (egyelőre) nem szolgáltat odds adatokat
         fromCache: false
    };

    // Kritikus ellenőrzés [cite: 1384-1386]
    if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
        console.error(`[NHL API] KRITIKUS HIBA: Érvénytelen VÉGLEGES statisztikák (GP <= 0).`);
        throw new Error("Kritikus statisztikák (GP <= 0) érvénytelenek a providerben.");
    }

    return result;
}

export const providerName = 'nhl-official-api-v1';
