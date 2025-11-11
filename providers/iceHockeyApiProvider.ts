// FÁJL: providers/iceHockeyApiProvider_v1.6.ts
// VERZIÓ: v1.6 (TELJES JAVÍTÁS)
// JAVÍTÁSOK (v1.6):
// 1. KRITIKUS (404 HIBA): A 'makeIceHockeyRequest' URL-jéből eltávolítva
//    a felesleges "dupla perjel" (https:/// -> https://).
// 2. KRITIKUS (404 HIBA): A 'findMatchByNames' végpontja javítva
//    'matchschedules'-ről 'matches'-re (a user képernyőfotója alapján).
// 3. KRITIKUS (NÉVMEGTALÁLÁS): A 'findMatchByNames' javítva 'homeTeam' (camelCase)
//    használatára 'home_team' (snake_case) helyett.
// 4. KRITIKUS (NÉVMEGTALÁLÁS): A 'findMatchByNames' javítva a TypeError elkerülésére
//    (eltávolítva a hibás '|| e.homeTeam' fallback).
// 5. ROBUSZTUSSÁG: A 'findMatchByNames' kiegészítve a fordított (Home/Away)
//    keresési esetre.
// 6. KRITIKUS (404 HIBA): A 'fetchMatchData' (H2H, Lineups, Stats) hívásai
//    javítva a helyes PascalCase nevekre és query paraméterekre
//    (pl. 'MatchH2HDuel?matchId=...').
// 7. ROBUSZTUSSÁG: A parserek ('parseH2H', 'parseStats') szintén
//    átírva camelCase (pl. 'homeScore', 'gamesPlayed') használatára.

import { makeRequest } from './common/utils.js';
import { ICEHOCKEYAPI_HOST, ICEHOCKEYAPI_KEY } from '../config.js';
import NodeCache from 'node-cache';
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    // ... többi import ...
    ICanonicalRawData,
    FixtureResult,
    IStructuredWeather
} from '../src/types/canonical.d.ts';

const apiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 600 }); // 6 órás TTL

// Központi hívó függvény (IceHockeyApi)
async function makeIceHockeyRequest(endpoint: string, params: any = {}) {
    if (!ICEHOCKEYAPI_HOST || !ICEHOCKEYAPI_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ICEHOCKEYAPI_HOST vagy ICEHOCKEYAPI_KEY.`);
    }
    
    // === JAVÍTÁS (v1.6): A "dupla perjel" hiba eltávolítva ===
    const url = `https://${ICEHOCKEYAPI_HOST}/${endpoint}`;
    // ===================================================

    const fullConfig = {
        params: params,
        headers: {
            'x-rapidapi-host': ICEHOCKEYAPI_HOST,
            'x-rapidapi-key': ICEHOCKEYAPI_KEY
        }
    };

    try {
        const response = await makeRequest(url, fullConfig, 0); 
        return response.data?.data || response.data?.result || response.data;
    } catch (error: any) {
        console.error(`[IceHockeyApiProvider] Hiba: ${error.message}. Endpoint: ${endpoint}`);
        throw error;
    }
}


// === JAVÍTÁS (v1.6): 'findMatchByNames' teljes átírása ===
/**
 * Segédfüggvény a meccs ID kereséséhez a napi meccslista alapján
 */
interface FoundMatchIds {
    matchId: number | string;
    homeTeamId: number | string;
    awayTeamId: number | string;
}
async function findMatchByNames(
    homeTeamName: string, 
    awayTeamName: string, 
    matchDate: string // Ez egy ISO string, pl. "2025-11-12"
): Promise<FoundMatchIds | null> {
    
    // Név normalizálás
    const searchHome = homeTeamName.toLowerCase().trim();
    const searchAway = awayTeamName.toLowerCase().trim();

    // Dátum feldolgozása a végponthoz
    const dateObj = new Date(matchDate);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1; // JS hónapok 0-indexeltek
    const day = dateObj.getDate();

    const cacheKey = `icehockeyapi_matches_v1.6_${year}-${month}-${day}`;
    let dailyEvents = apiCache.get<any[]>(cacheKey);

    if (!dailyEvents) {
        console.log(`[IceHockeyApiProvider v1.6] Meccslista lekérése (Dátum: ${year}-${month}-${day})...`);
        try {
            // === JAVÍTOTT VÉGPONT (a user 'matches' képe alapján) ===
            const response = await makeIceHockeyRequest(`api/ice-hockey/matches/${day}/${month}/${year}`);
            // ===============================================
            
            if (!response || !Array.isArray(response.events) || response.events.length === 0) {
                console.warn(`[IceHockeyApiProvider v1.6] Nem található meccs a(z) ${year}-${month}-${day} napon a 'matches' végponton.`);
                return null;
            }
            dailyEvents = response.events;
            apiCache.set(cacheKey, dailyEvents, 3600); // 1 óra cache a napi listának
        } catch (e: any) {
             console.error(`[IceHockeyApiProvider v1.6] Hiba a 'matches' lekérésekor: ${e.message}`);
             return null;
        }
    } else {
        console.log(`[IceHockeyApiProvider v1.6] Meccslista cache találat (Dátum: ${year}-${month}-${day})`);
    }

    if (!dailyEvents) return null;

    // === JAVÍTÁS (v1.6): Robusztus keresési logika (camelCase, TypeError, Fordított sorrend) ===
    const foundMatch = dailyEvents.find((e: any) => {
        // 1. JAVÍTÁS (camelCase és TypeError fix):
        const apiHomeName = (e.homeTeam?.name || '').toLowerCase().trim();
        const apiAwayName = (e.awayTeam?.name || '').toLowerCase().trim();

        // 2. JAVÍTÁS (Fordított sorrend ellenőrzése):
        const standardMatch = apiHomeName.includes(searchHome) && apiAwayName.includes(searchAway);
        const reversedMatch = apiHomeName.includes(searchAway) && apiAwayName.includes(searchHome);

        return standardMatch || reversedMatch;
    });

    // === JAVÍTÁS (v1.6): ID kinyerése (camelCase) ===
    if (foundMatch && foundMatch.id && foundMatch.homeTeamId && foundMatch.awayTeamId) {
        console.log(`[IceHockeyApiProvider v1.6] Meccs TALÁLAT (ID: ${foundMatch.id}) nevek alapján.`);
        return {
            matchId: foundMatch.id,
            homeTeamId: foundMatch.homeTeamId,
            awayTeamId: foundMatch.awayTeamId
        };
    }
    
    console.warn(`[IceHockeyApiProvider v1.6] Nem található meccs a(z) ${searchHome} vs ${searchAway} párosításhoz a napi listában.`);
    return null;
}
// === JAVÍTÁS VÉGE ===

// === JAVÍTÁS (v1.6): Parserek átírása camelCase-re ===
function parseH2H(apiH2h: any): FixtureResult[] { 
    console.log("[IceHockeyApiProvider v1.6] H2H feldolgozás...");
    if (!apiH2h || !Array.isArray(apiH2h.events)) {
        return [];
    }
    return apiH2h.events.map((event: any) => ({
        fixture_id: event.id,
        date: new Date(event.timestamp * 1000).toISOString(),
        home_team_name: event.homeTeam?.name || event.homeTeam,
        away_team_name: event.awayTeam?.name || event.awayTeam,
        home_score: event.homeScore?.current, // camelCase
        away_score: event.awayScore?.current, // camelCase
        result_type: event.status === 'finished' ? 'FullTime' : 'Scheduled'
    })).slice(0, 10);
}
function parseLineups(apiLineups: any): ICanonicalRawData['detailedPlayerStats'] { 
    // (A feltételezés az, hogy ez a struktúra helyes volt)
    console.log("[IceHockeyApiProvider v1.6] Keretek/Sérülések feldolgozás...");
    const result: ICanonicalRawData['detailedPlayerStats'] = {
        home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} }
    };
    if (apiLineups && Array.isArray(apiLineups.home)) {
        result.home_absentees = apiLineups.home
            .filter((p: any) => p.status === 'injured' || p.status === 'absent')
            .map((p: any) => p.name || 'Ismeretlen játékos');
    }
    if (apiLineups && Array.isArray(apiLineups.away)) {
        result.away_absentees = apiLineups.away
            .filter((p: any) => p.status === 'injured' || p.status === 'absent')
            .map((p: any) => p.name || 'Ismeretlen játékos');
    }
    return result; 
}
function parseStats(apiStats: any): { home: ICanonicalStats, away: ICanonicalStats, form: any } { 
    console.log("[IceHockeyApiProvider v1.6] Statisztikák/Forma feldolgozás...");
    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const homeApiStats = apiStats?.home?.statistics || apiStats?.home;
    const awayApiStats = apiStats?.away?.statistics || apiStats?.away;
    const homeStats: ICanonicalStats = homeApiStats ? {
        gp: homeApiStats.gamesPlayed || 1, // camelCase
        gf: homeApiStats.goalsScored || 0, // camelCase
        ga: homeApiStats.goalsConceded || 0, // camelCase
        form: homeApiStats.form || null
    } : emptyStats;
    const awayStats: ICanonicalStats = awayApiStats ? {
        gp: awayApiStats.gamesPlayed || 1, // camelCase
        gf: awayApiStats.goalsScored || 0, // camelCase
        ga: awayApiStats.goalsConceded || 0, // camelCase
        form: awayApiStats.form || null
    } : emptyStats;
    return {
        home: homeStats, away: awayStats,
        form: { home_overall: homeStats.form, away_overall: awayStats.form }
    };
}
// === JAVÍTÁS VÉGE ===


/**
 * FŐ EXPORTÁLT FÜGGVÉNY (Kontextust ad vissza, Odds nélkül)
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v1.6 - IceHockeyApi - Stratégia: Matches): ${homeTeamName} vs ${awayTeamName}...`);
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Meccs ID, Home ID, Away ID keresése (Már a v1.6-ot hívja)
        const matchIds = await findMatchByNames(homeTeamName, awayTeamName, matchDate);
        
        if (!matchIds) {
            console.error(`[IceHockeyApiProvider v1.6] KRITIKUS HIBA: Meccs ID nem található a 'matches' listában.`);
            return generateEmptyStubContext(options);
        }
        
        const { matchId, homeTeamId, awayTeamId } = matchIds;

        // === JAVÍTÁS (v1.6): Szekvenciális hívások javítása (PascalCase + query param) ===
        console.log(`[IceHockeyApiProvider v1.6] Kontextus adatok SZEKVENCIÁLIS lekérése... (MatchID: ${matchId})`);
        
        const h2hData = await makeIceHockeyRequest(`api/ice-hockey/MatchH2HDuel?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.6] H2H lekérve.`);
        
        const lineupsData = await makeIceHockeyRequest(`api/ice-hockey/MatchLineups?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.6] Lineups lekérve.`);
        
        const statsData = await makeIceHockeyRequest(`api/ice-hockey/MatchStatistics?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.6] Stats lekérve.`);
        // === JAVÍTÁS VÉGE ===

        // 3. LÉPÉS: Adatok átalakítása (Parserek) (Már a v1.6-ot hívja)
        const parsedStats = parseStats(statsData);
        const parsedLineups = parseLineups(lineupsData);
        const parsedH2H = parseH2H(h2hData);

        // 4. LÉPÉS: Adatok egyesítése (RawData)
        const finalData = generateStubRawData(homeTeamId, awayTeamId, null, matchId, utcKickoff);
        
        finalData.h2h_structured = parsedH2H;
        finalData.stats = { home: parsedStats.home, away: parsedStats.away };
        finalData.form = parsedStats.form;
        finalData.detailedPlayerStats = parsedLineups;
        finalData.absentees = { 
            home: parsedLineups.home_absentees, 
            away: parsedLineups.away_absentees 
        };

        // 5. LÉPÉS: Befejezés (RichContext)
        const result: ICanonicalRichContext = {
             rawStats: finalData.stats, 
             leagueAverages: {},
             richContext: "IceHockeyApi (v1.6) - Kontextus sikeresen lekérve (Matches stratégia).",
             advancedData: { home: { xg: null }, away: { xg: null } },
             form: finalData.form, 
             rawData: finalData, 
             oddsData: null,
             fromCache: false,
             availableRosters: finalData.availableRosters
        };
    
        return result;

    } catch (e: any) {
        console.error(`[IceHockeyApiProvider v1.6] KRITIKUS HIBA a fetchMatchData során: ${e.message}`, e.stack);
        return generateEmptyStubContext(options);
    }
}

// Meta-adat a logoláshoz
export const providerName = 'ice-hockey-api-v1.6-FIXED';


// === "Stub" Válasz Generátor ===
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats, leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (IceHockeyApi v1.6) sikertelen vagy hiányos.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form, rawData: emptyRawData, oddsData: null,
         fromCache: false, availableRosters: emptyRawData.availableRosters
    };
    return result;
}
function generateStubRawData(
    homeTeamId: number | string | null,
    awayTeamId: number | string | null,
    leagueId: number | null,
    fixtureId: number | string | null,
    fixtureDate: string | null
): ICanonicalRawData {
    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const emptyWeather: IStructuredWeather = {
        description: "N/A (Beltéri)", temperature_celsius: -1, humidity_percent: null, 
        wind_speed_kmh: null, precipitation_mm: null, source: 'N/A'
    };
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: {
             homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [], form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] }, referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A (Jég)", 
            weather: "N/A (Beltéri)", match_tension_index: null, coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    return emptyRawData;
}
