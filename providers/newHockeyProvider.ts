// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v54.33 (H2H Integráció)
// MÓDOSÍTÁS:
// 1. ÚJ FUNKCIÓ: '_getNhlH2H'. Ez egy másik, stabil NHL API végpontot
//    ('statsapi.web.nhl.com') hív, hogy lekérje a valós H2H adatokat.
// 2. A 'makeHockeyRequest' frissítve, hogy kezelje a különböző API alap URL-eket.
// 3. A 'fetchMatchData' most már párhuzamosan lekéri a H2H adatokat.
// 4. Az eredményt átadja a 'finalData.h2h_structured'-nek
//    és a Gemini promptnak.
// Eredmény: A 'calculateModelConfidence'  H2H büntetése  megszűnik.

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
    getStructuredWeatherData,
    makeRequest
} from './common/utils.js';
import { SPORT_CONFIG, NHL_TEAM_NAME_MAP } from '../config.js';

// --- JÉGKORONG SPECIFIKUS CACHE-EK ---
const hockeyLeagueCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const hockeyStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const nhlTeamListCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const nhlH2HCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 }); // ÚJ Cache a H2H-nak

// --- NHL API KONFIGURÁCIÓ ---
const NHL_API_BASE_URL = 'https://api-web.nhle.com/v1';
const NHL_STATS_API_BASE_URL = 'https://api.nhle.com/stats/rest/en';
const NHL_OLD_STATS_API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1'; // ÚJ H2H Forrás
const NHL_LEAGUE_ID = 'NHL';

/**
 * Módosított API hívó (v54.33)
 * Most már a hívó által megadott teljes URL-t használja.
 */
async function makeHockeyRequest(url: string, params: any = {}) {
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

// --- ADATLEKÉRŐ FÜGGVÉNYEK ---

/**
 * Lekéri a tabellát (STATISZTIKÁKHOZ). (Változatlan v54.25)
 */
async function _getNhlStandings(utcKickoff: string): Promise<any[]> {
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const cacheKey = `nhl_standings_v2_fallback_${matchDate}`;
    
    const cached = hockeyStatsCache.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] Tabella (Statisztika) CACHE TALÁLAT (${cacheKey}).`);
        return cached;
    }
    
    let data: any = null;
    let sourceEndpoint = `${NHL_API_BASE_URL}/standings/now`;

    // 1. Próba
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

    // 3. Feldolgozás
    const finalStandings = data?.standings || [];
    const finalAllRows = finalStandings.flatMap((s: any) => s.rows || []);
    
    if (finalAllRows.length === 0) {
        console.warn(`[NHL API] A tabella (statisztika) lekérése sikertelen. A '${sourceEndpoint}' végpont 0 csapatot adott vissza. Az elemzés P4 becslés helyett 'gp: 1' placeholder adatokat fog használni.`);
        return [];
    }

    const uniqueTeamRows = Array.from(new Map(finalAllRows.map((row: any) => [row.team.id, row])).values());
    
    console.log(`[NHL API] Tabella (Statisztika) sikeresen lekérve ('${sourceEndpoint}' forrásból), ${uniqueTeamRows.length} egyedi csapat cache-elve (${cacheKey}).`);
    hockeyStatsCache.set(cacheKey, uniqueTeamRows);
    return uniqueTeamRows;
}

/**
 * Lekéri a stabil, szezonfüggetlen csapatlistát (CSAPAT ID-KHEZ). (Változatlan v54.25)
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
        const data = await makeHockeyRequest(url, {}); // v54.25 javítás
        if (!data?.data || data.data.length === 0) {
             throw new Error("Az NHL API ('/team') 0 csapatot adott vissza.");
        }

        const teams = data.data.map((t: any) => ({
            id: t.id,
            name: t.fullName, // Pl. "Buffalo Sabres"
            abbrev: t.triCode // Pl. "BUF"
        }));
        
        console.log(`[NHL API] Csapatlista (ID azonosításhoz) sikeresen lekérve, ${teams.length} csapat cache-elve.`);
        nhlTeamListCache.set(cacheKey, teams);
        return teams;

    } catch (e: any) {
        console.error(`[NHL API] A stabil csapatlista ('${url}') lekérése sikertelen: ${e.message}`);
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
 * Megkeresi a csapat ID-t az ESPN név alapján a stabil csapatlistából.
 * (Változatlan v54.26)
 */
async function getHockeyTeamId(teamName: string): Promise<number | null> {
    const searchName = teamName.toLowerCase().trim();
    const cacheKey = `hockey_team_nhl_v3_map_${searchName}`;
    const cached = hockeyTeamCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[NHL API] Csapat ID keresés (v54.26 Map): "${teamName}"`);
    
    // 1. Keresés az új, determinisztikus térképben
    const mappedName = NHL_TEAM_NAME_MAP[searchName];
    if (!mappedName) {
         console.warn(`[NHL API] Nincs térkép (map) bejegyzés a config.js-ben ehhez: "${searchName}". A feloldás sikertelen.`);
         hockeyTeamCache.set(cacheKey, null);
         return null;
    }

    // 2. A hivatalos csapatlista lekérése (cache-ből vagy API-ból)
    const teams = await _getNhlTeamList();

    // 3. Tökéletes egyezés keresése a hivatalos név alapján
    const foundTeam = teams.find(t => t.name.toLowerCase() === mappedName.toLowerCase());

    if (foundTeam) {
        console.log(`[NHL API] Csapat ID találat (Map): "${teamName}" -> "${mappedName}" (ID: ${foundTeam.id})`);
        hockeyTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.error(`[NHL API] Kritikus térkép hiba: A név ("${searchName}") szerepel a térképben ("${mappedName}"), de ez a név nem található a hivatalos NHL API csapatlistájában.`);
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

/**
 * ÚJ (v54.33): Lekéri a H2H adatokat a 'statsapi' végpontról.
 */
async function _getNhlH2H(homeTeamId: number, awayTeamId: number): Promise<any[] | null> {
    const cacheKey = `nhl_h2h_v1_${homeTeamId}_vs_${awayTeamId}`;
    const cached = nhlH2HCache.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[NHL API] H2H CACHE TALÁLAT (${homeTeamId} vs ${awayTeamId})`);
        return cached;
    }

    const url = `${NHL_OLD_STATS_API_BASE_URL}/teams/${homeTeamId}`;
    const params = {
        hydrate: `previousSchedule(teamId=${awayTeamId},gameType=[R,P])`, // R=Regular, P=Playoff
        // A 'hydrate' paraméter kéri le a megadott ellenfél elleni korábbi meccseket
    };

    console.log(`[NHL API] H2H adatok lekérése (${homeTeamId} vs ${awayTeamId})...`);

    try {
        const data = await makeHockeyRequest(url, params);
        const teamData = data?.teams?.[0];
        
        if (!teamData?.previousSchedule?.dates || teamData.previousSchedule.dates.length === 0) {
            console.warn(`[NHL API] H2H: Nem található korábbi meccs (${homeTeamId} vs ${awayTeamId}).`);
            return null;
        }

        const h2hGames: any[] = [];
        teamData.previousSchedule.dates.forEach((dateEntry: any) => {
            dateEntry.games.forEach((game: any) => {
                // Kanonikus formátumra  hozzuk, ahogy a Model.ts elvárja
                h2hGames.push({
                    date: game.gameDate?.split('T')[0] || 'N/A',
                    competition: 'NHL', // Feltételezzük
                    score: `${game.teams.home.score} - ${game.teams.away.score}`,
                    home_team: game.teams.home.team.name,
                    away_team: game.teams.away.team.name,
                });
            });
        });

        // Fordított sorrend (legújabb elöl), és limitálás (pl. 5 meccs)
        const sortedH2H = h2hGames.reverse().slice(0, 5);
        
        nhlH2HCache.set(cacheKey, sortedH2H);
        console.log(`[NHL API] H2H adatok sikeresen lekérve (${sortedH2H.length} meccs).`);
        return sortedH2H;

    } catch (e: any) {
        console.error(`[NHL API] H2H lekérési hiba: ${e.message}`);
        return null;
    }
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.33) ---

export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff, manual_H_xG, manual_A_xG } = options;
    console.log(`[Hockey Provider (v54.33 - H2H Fix)] Adatgyűjtés indul: ${homeTeamName} vs ${awayTeamName}`);

    // --- 1. LIGA és CSAPAT ID-k (Stabil) ---
    const leagueApiId = await getHockeyLeagueId(leagueName);
    if (!leagueApiId) {
        throw new Error(`[NHL API] Ez a provider csak az "NHL" ligát támogatja. Kapott: "${leagueName}". Az elemzés leáll.`);
    }

    const [homeTeamId, awayTeamId] = await Promise.all([
        getHockeyTeamId(homeTeamName),
        getHockeyTeamId(awayTeamName)
    ]);
    if (!homeTeamId || !awayTeamId) {
        throw new Error(`[NHL API] Csapat ID nem található: Home(${homeTeamName}=${homeTeamId}) vagy Away(${awayTeamName}=${awayTeamId}). Ellenőrizd az NHL_TEAM_NAME_MAP bejegyzéseket a config.js-ben.`);
    }

    // --- 2. MECCS (Stabil) és H2H (ÚJ) ---
    // A 'findHockeyFixture' most már párhuzamosan futhat a H2H lekéréssel
    const [fixtureId, apiSportsH2HData] = await Promise.all([
        findHockeyFixture(homeTeamId, awayTeamId, utcKickoff),
        _getNhlH2H(homeTeamId, awayTeamId) // ÚJ HÍVÁS (v54.33)
    ]);
    
    // --- 3. OPCIONÁLIS STATISZTIKÁK (P1/P4 Logika) ---
    let homeStatsApi: any = null;
    let awayStatsApi: any = null;
    let standingsSource = "N/A (P1 Manual xG)";

    if (manual_H_xG == null || manual_A_xG == null) {
        console.log(`[NHL API] P4-es ág (nincs manuális xG): Statisztikák lekérése a tabelláról...`);
        try {
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
         apiSportsH2HData, // JAVÍTÁS (v54.33): Átadjuk a H2H adatot a promptnak
         null
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
        // JAVÍTÁS (v54.33): A valós H2H adat beillesztése
        h2h_structured: apiSportsH2HData || geminiData.h2h_structured || null,
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
         // JAVÍTÁS (v54.33): A Gemini H2H összefoglalóját használjuk, ami most már valós adatokon alapul
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
         rawData: finalData, // Ez most már tartalmazza a 'h2h_structured' adatot
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
