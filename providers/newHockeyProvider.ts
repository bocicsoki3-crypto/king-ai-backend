// FÁJL: providers/newHockeyProvider.ts
// (v54.8 - Típusbiztos 'contextual_factors' és 'referee' javítás)
// Implementáció az "Ice Hockey Data" API-hoz
// MÓDOSÍTÁS: A modul átalakítva TypeScript-re.
// A 'fetchMatchData' most már a 'IDataProvider' interfésznek megfelelően
// Promise<ICanonicalRichContext> típust ad vissza.

import axios from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Kanonikus típusok importálása
// === JAVÍTÁS (TS2846) ===
// A 'import' helyett 'import type'-ot használunk, mivel a .d.ts fájlok
// nem tartalmaznak futásidejű kódot, csak típus-deklarációkat.
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    IStructuredWeather // Szükséges a helyi inicializáláshoz
} from '../src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

import {
    HOCKEY_API_KEY,
    HOCKEY_API_HOST
} from '../config.js';

// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData,
    makeRequest
} from './common/utils.js';

// --- JÉGKORONG SPECIFIKUS CACHE-EK ---
const hockeyLeagueCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const hockeyFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const hockeyStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- API HÍVÓ SEGÉDFÜGGVÉNY (JAVÍTVA v50) ---
async function makeHockeyRequest(endpoint: string, params: any = {}) {
    
    if (!HOCKEY_API_KEY || !HOCKEY_API_HOST) {
        throw new Error('[Hockey API] Kritikus konfigurációs hiba: Hiányzó HOCKEY_API_KEY vagy HOCKEY_API_HOST a config.js-ben.');
    }

    const API_KEY = HOCKEY_API_KEY;
    const API_HOST = HOCKEY_API_HOST;

    const options = {
        method: 'GET',
        url: `https://${API_HOST}${endpoint}`,
        params: params,
        headers: {
            'X-RapidAPI-Key': API_KEY,
            'X-RapidAPI-Host': API_HOST
        }
    };
    
    try {
        const response = await makeRequest(options.url, { headers: options.headers, params: options.params }, 0);
        if (!response || !response.data) {
            throw new Error(`[Hockey API Hiba] Üres válasz érkezett. Endpoint: ${endpoint}`);
        }
        return response.data;
    } catch (error: any) {
        console.error(`[Hockey API Hiba] A hívás sikertelen. Endpoint: ${endpoint} - ${error.message}`);
        throw error;
    }
}

// --- ADATLEKÉRŐ FÜGGVÉNYEK (Típusosítva) ---

async function getHockeyLeagueId(leagueName: string): Promise<number | null> {
    const cacheKey = `hockey_league_${leagueName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyLeagueCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Liga keresés: "${leagueName}"`);
    const data = await makeHockeyRequest('/tournament/list');
    
    if (!data?.tournaments) {
        console.warn(`[Hockey API] Nem sikerült lekérni a liga listát.`);
        return null;
    }

    const leagueNames = data.tournaments.map((t: any) => t.name);
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

async function getHockeyTeamId(teamName: string, leagueId: number): Promise<number | null> {
    const cacheKey = `hockey_team_${leagueId}_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cached = hockeyTeamCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Csapat keresés: "${teamName}" (Liga ID: ${leagueId})`);
    const data = await makeHockeyRequest('/tournament/teams', { tournamentId: leagueId });

    if (!data?.teams) {
        console.warn(`[Hockey API] Nem sikerült lekérni a csapatokat a ${leagueId} ligából.`);
        return null;
    }

    const teamNames = data.teams.map((t: any) => t.name);
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

async function findHockeyFixture(homeTeamId: number, awayTeamId: number, leagueId: number, utcKickoff: string): Promise<number | null> {
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const cacheKey = `hockey_fixture_${leagueId}_${homeTeamId}_${awayTeamId}_${matchDate}`;
    const cached = hockeyFixtureCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Meccs keresés: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    const data = await makeHockeyRequest('/tournament/fixture', { tournamentId: leagueId, date: matchDate });
    
    if (!data?.fixtures) {
        console.warn(`[Hockey API] Nem találhatók meccsek erre a napra: ${matchDate}`);
        return null;
    }

    const fixture = data.fixtures.find((f: any) => f.home.id === homeTeamId && f.away.id === awayTeamId);
    
    if (fixture) {
        console.log(`[Hockey API] MECCS TALÁLAT! FixtureID: ${fixture.id}`);
        hockeyFixtureCache.set(cacheKey, fixture.id);
        return fixture.id;
    }

    console.warn(`[Hockey API] Nem található meccs: H:${homeTeamId} vs A:${awayTeamId} (Dátum: ${matchDate})`);
    hockeyFixtureCache.set(cacheKey, null);
    return null;
}

async function getHockeyStats(leagueId: number): Promise<Map<number, any> | null> {
    const cacheKey = `hockey_stats_${leagueId}`;
    const cached = hockeyStatsCache.get<Map<number, any>>(cacheKey);
    if (cached) return cached;

    console.log(`[Hockey API] Statisztika lekérés (Standings)... (Liga ID: ${leagueId})`);
    const data = await makeHockeyRequest('/tournament/standings', { tournamentId: leagueId });
    
    if (!data?.standings) {
        console.warn(`[Hockey API] Nem sikerült lekérni a statisztikákat a ${leagueId} ligából.`);
        return null;
    }
    
    const statsMap = new Map<number, any>();
    for (const group of data.standings) {
        for (const row of group.rows) {
            statsMap.set(row.team.id, row);
        }
    }
    
    console.log(`[Hockey API] Statisztikák sikeresen feldolgozva ${statsMap.size} csapatra.`);
    hockeyStatsCache.set(cacheKey, statsMap);
    return statsMap;
}

// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (Kanonikus Modellt Implementál) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
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
    const homeStatsApi = statsMap ? statsMap.get(homeTeamId) : null;
    const awayStatsApi = statsMap ? statsMap.get(awayTeamId) : null;

    // --- 4. STATISZTIKÁK EGYSÉGESÍTÉSE (KANONIKUS MODELL) ---
    const unifiedHomeStats: ICanonicalStats = {
        gp: homeStatsApi?.played || 1, // Biztosítjuk, hogy a GP > 0
        gf: homeStatsApi?.scoresFor || 0,
        ga: homeStatsApi?.scoresAgainst || 0,
        form: homeStatsApi?.form || null
    };
    
    const unifiedAwayStats: ICanonicalStats = {
        gp: awayStatsApi?.played || 1, // Biztosítjuk, hogy a GP > 0
        gf: awayStatsApi?.scoresFor || 0,
        ga: awayStatsApi?.scoresAgainst || 0,
        form: awayStatsApi?.form || null
    };

    // --- 5. GEMINI HÍVÁS (Kontextus) ---
    const geminiJsonString = await _callGemini(PROMPT_V43(
         sport, homeTeamName, awayTeamName,
         unifiedHomeStats, // Már a kanonikus statokat adjuk át
         unifiedAwayStats, 
         null, // H2H (ez az API nem támogatja)
         null // Lineups
    ));
    
    let geminiData: any = {};
    try { 
        geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : {};
    } catch (e: any) { 
        console.error(`[Hockey API] Gemini JSON parse hiba: ${e.message}`);
    }

    // --- 6. VÉGLEGES ADAT EGYESÍTÉS (KANONIKUS MODELL v54.8) ---
    
    // Hozzuk létre az alap ICanonicalRawData struktúrát
    const finalData: ICanonicalRawData = {
        stats: {
            home: { ...unifiedHomeStats, ...(geminiData.stats?.home || {}) },
            away: { ...unifiedAwayStats, ...(geminiData.stats?.away || {}) }
        },
        form: {
            home_overall: unifiedHomeStats.form,
            away_overall: unifiedAwayStats.form,
            ...geminiData.form
        },
        // Szimulált PlayerStats, mivel ez az API nem támogatja
        detailedPlayerStats: { 
            home_absentees: [], 
            away_absentees: [], 
            key_players_ratings: { home: {}, away: {} } 
        },
        absentees: { home: [], away: [] }, // Szintén a 'detailedPlayerStats'-ból származna
        h2h_structured: geminiData.h2h_structured || null,
        
        // === JAVÍTÁS (v54.8) Kezdete ===
        // A hiányzó mezők pótlása az ICanonicalRawData (v54.8) interfésznek megfelelően.
        // Ez megoldja a TS2739 és TS2339 hibákat.
        referee: {
            name: null,
            style: null
        },
        contextual_factors: {
            stadium_location: geminiData?.contextual_factors?.stadium_location || "N/A (Beltéri)",
            pitch_condition: "N/A (Jég)",
            
            // A Model.ts által várt mezők (TS2339)
            weather: "N/A (Beltéri)", // Alapértelmezett, felülírjuk a structuredWeather alapján
            match_tension_index: null, 

            // Alapértelmezett 'structured_weather', hogy az objektum teljes legyen
            structured_weather: {
                description: "N/A (Beltéri)",
                temperature_celsius: -1 // Szimbolikus érték
                // A többi mező (humidity, wind, precip) opcionális a v54.8 interfészben
            }
        },
        // === JAVÍTÁS (v54.8) Vége ===
        
        ...geminiData // Minden egyéb AI által generált adat (pl. tactics)
    };
    
    // GP felülírása a biztonság kedvéért
    finalData.stats.home.gp = unifiedHomeStats.gp;
    finalData.stats.away.gp = unifiedAwayStats.gp;

    console.log(`[Hockey API] Végleges stats használatban: Home(GP:${finalData.stats.home.gp}), Away(GP:${finalData.stats.away.gp})`);

    // === JAVÍTÁS (v54.8) A 'structured_weather' kezelése ===
    // A 'getStructuredWeatherData' egy legacy függvény, ami csak { desc, temp } objektumot ad vissza.
    const structuredWeather = await getStructuredWeatherData(
        finalData.contextual_factors.stadium_location, 
        utcKickoff
    );

    // Közvetlenül frissítjük a finalData objektumot
    finalData.contextual_factors.structured_weather = structuredWeather;
    // Frissítjük a Model.ts által várt 'weather' stringet is
    finalData.contextual_factors.weather = structuredWeather.description || "N/A (Beltéri)";
    // === JAVÍTÁS VÉGE ===

    const richContext = [
         geminiData.h2h_summary && `- H2H: ${geminiData.h2h_summary}`,
         geminiData.team_news?.home && `- Hírek: H:${geminiData.team_news.home}`,
         geminiData.team_news?.away && `- Hírek: V:${geminiData.team_news.away}`,
         (finalData.form.home_overall || finalData.form.away_overall) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         // Most már a finalData-ból olvassuk ki
         finalData.contextual_factors.weather !== "N/A (Beltéri)" && `- Időjárás: ${finalData.contextual_factors.weather}`
    ].filter(Boolean).join('\n') || "N/A";

    // A végső ICanonicalRichContext objektum összeállítása
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: geminiData.league_averages || {},
         richContext,
         advancedData: geminiData.advancedData || { home: {}, away: {} },
         form: finalData.form,
         rawData: finalData, // Ez már a v54.8-nak megfelelő adat
         oddsData: null, // Ez az API nem szolgáltat odds-okat
         fromCache: false
    };

    // Kritikus ellenőrzés (A 'gp' kulcsra, ahogy az interfész diktálja)
    if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
        console.warn(`[Hockey API] Figyelmeztetés: Érvénytelen statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
        // Ha nincs statisztika, legalább 1-es GP-t adunk, hogy a modellek ne szálljanak el
        if (result.rawStats.home.gp <= 0) result.rawStats.home.gp = 1;
        if (result.rawStats.away.gp <= 0) result.rawStats.away.gp = 1;
    }

    return result;
}

export const providerName = 'ice-hockey-data';
