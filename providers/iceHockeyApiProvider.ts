// FÁJL: providers/iceHockeyApiProvider_v1.5.ts
// VERZIÓ: v1.5 (Végpont Javítás a képernyőfotók alapján)
// JAVÍTÁS (v1.5): A Log napló (v1.4) felfedte, hogy az
// 'api/ice-hockey/match/list/{date}' végpont 404-es hibát ad.
//
// A felhasználó által biztosított képernyőfotók (image_cbbfdc.png)
// megerősítették, hogy a HELYES végpont a meccsek listázásához:
// 'GET /api/ice-hockey/matchschedules/{day}/{month}/{year}'
//
// Ez a verzió javítja a 'findMatchByNames' függvényt, hogy ezt
// a végpontot és paraméterezést használja.

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
// ... (v1.4-es kód változatlan) ...
    if (!ICEHOCKEYAPI_HOST || !ICEHOCKEYAPI_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ICEHOCKEYAPI_HOST vagy ICEHOCKEYAPI_KEY.`);
    }
    
    const url = `https://${ICEHOCKEYAPI_HOST}/${endpoint}`;
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


// === JAVÍTÁS (v1.5): 'findMatchByNames' átírva a 'MatchSchedules' végpontra ===
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

    const cacheKey = `icehockeyapi_schedules_v1.5_${year}-${month}-${day}`;
    let dailyEvents = apiCache.get<any[]>(cacheKey);

    if (!dailyEvents) {
        console.log(`[IceHockeyApiProvider v1.5] Meccslista lekérése (Dátum: ${year}-${month}-${day})...`);
        try {
            // === JAVÍTOTT VÉGPONT (a képernyőfotó alapján) ===
            const response = await makeIceHockeyRequest(`api/ice-hockey/matches/${day}/${month}/${year}`);
            // ===============================================
            
            // A válasz struktúrája a képernyőfotó alapján {"events": [...]},
            // tehát a meglévő 'response.events' logika helyes.
            if (!response || !Array.isArray(response.events) || response.events.length === 0) {
                console.warn(`[IceHockeyApiProvider v1.5] Nem található meccs a(z) ${year}-${month}-${day} napon a 'matchschedules' végponton.`);
                return null;
            }
            dailyEvents = response.events;
            apiCache.set(cacheKey, dailyEvents, 3600); // 1 óra cache a napi listának
        } catch (e: any) {
             console.error(`[IceHockeyApiProvider v1.5] Hiba a 'matchschedules' lekérésekor: ${e.message}`);
             return null;
        }
    } else {
        console.log(`[IceHockeyApiProvider v1.5] Meccslista cache találat (Dátum: ${year}-${month}-${day})`);
    }

    if (!dailyEvents) return null;

    // Keressük a meccset a listában a nevek alapján (v1.4 logika változatlan)
    const foundMatch = dailyEvents.find((e: any) => {
        const apiHomeName = (e.homeTeam?.name || '').toLowerCase().trim();
        const apiAwayName = (e.awayTeam?.name || '').toLowerCase().trim();
        return (apiHomeName.includes(searchHome) && apiAwayName.includes(searchAway));
    });

    if (foundMatch && foundMatch.id && foundMatch.home_team_id && foundMatch.away_team_id) {
        console.log(`[IceHockeyApiProvider v1.5] Meccs TALÁLAT (ID: ${foundMatch.id}) nevek alapján.`);
        return {
            matchId: foundMatch.id,
            homeTeamId: foundMatch.home_team_id,
            awayTeamId: foundMatch.away_team_id
        };
    }
    
    console.warn(`[IceHockeyApiProvider v1.5] Nem található meccs a(z) ${searchHome} vs ${searchAway} párosításhoz a napi listában.`);
    return null;
}
// === JAVÍTÁS VÉGE ===

// Parser függvények (v1.4 - változatlanul hagyva)
function parseH2H(apiH2h: any): FixtureResult[] { 
    // ... (v1.4-es kód változatlan) ...
    console.log("[IceHockeyApiProvider] H2H feldolgozás...");
    if (!apiH2h || !Array.isArray(apiH2h.events)) {
        return [];
    }
    return apiH2h.events.map((event: any) => ({
        fixture_id: event.id,
        date: new Date(event.timestamp * 1000).toISOString(),
        home_team_name: event.home_team,
        away_team_name: event.away_team,
        home_score: event.home_score?.current,
        away_score: event.away_score?.current,
        result_type: event.status === 'finished' ? 'FullTime' : 'Scheduled'
    })).slice(0, 10);
}
function parseLineups(apiLineups: any): ICanonicalRawData['detailedPlayerStats'] { 
    // ... (v1.4-es kód változatlan) ...
    console.log("[IceHockeyApiProvider] Keretek/Sérülések feldolgozás...");
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
    // ... (v1.4-es kód változatlan) ...
    console.log("[IceHockeyApiProvider] Statisztikák/Forma feldolgozás...");
    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const homeApiStats = apiStats?.home?.statistics || apiStats?.home;
    const awayApiStats = apiStats?.away?.statistics || apiStats?.away;
    const homeStats: ICanonicalStats = homeApiStats ? {
        gp: homeApiStats.games_played || 1, gf: homeApiStats.goals_scored || 0,
        ga: homeApiStats.goals_conceded || 0, form: homeApiStats.form || null
    } : emptyStats;
    const awayStats: ICanonicalStats = awayApiStats ? {
        gp: awayApiStats.games_played || 1, gf: awayApiStats.goals_scored || 0,
        ga: awayApiStats.goals_conceded || 0, form: awayApiStats.form || null
    } : emptyStats;
    return {
        home: homeStats, away: awayStats,
        form: { home_overall: homeStats.form, away_overall: awayStats.form }
    };
}


/**
 * FŐ EXPORTÁLT FÜGGVÉNY (Kontextust ad vissza, Odds nélkül)
 * (v1.4-es kód változatlan)
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v1.5 - IceHockeyApi - Stratégia: Schedules): ${homeTeamName} vs ${awayTeamName}...`);
    
    // A 'matchDate'-t a findMatchByNames már helyesen kezeli (ISO stringként)
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Meccs ID, Home ID, Away ID keresése NEVEK alapján (Már a v1.5-öt hívja)
        const matchIds = await findMatchByNames(homeTeamName, awayTeamName, matchDate);
        
        if (!matchIds) {
            console.error(`[IceHockeyApiProvider v1.5] KRITIKUS HIBA: Meccs ID nem található a 'matchschedules' listában.`);
            return generateEmptyStubContext(options);
        }
        
        const { matchId, homeTeamId, awayTeamId } = matchIds;

        // 2. LÉPÉS: SZEKVENCIÁLIS adatlekérés (Rate Limit Fix)
        console.log(`[IceHockeyApiProvider v1.5] Kontextus adatok SZEKVENCIÁLIS lekérése... (MatchID: ${matchId})`);
        
        const h2hData = await makeIceHockeyRequest(`api/ice-hockey/MatchH2HDuel?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.5] H2H lekérve.`);
        
        const lineupsData = await makeIceHockeyRequest(`api/ice-hockey/MatchLineups?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.5] Lineups lekérve.`);
        
        const statsData = await makeIceHockeyRequest(`api/ice-hockey/MatchStatistics?matchId=${matchId}`);
        console.log(`[IceHockeyApiProvider v1.5] Stats lekérve.`);

        // 3. LÉPÉS: Adatok átalakítása (Parserek)
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
             richContext: "IceHockeyApi (v1.5) - Kontextus sikeresen lekérve (Schedules stratégia).",
             advancedData: { home: { xg: null }, away: { xg: null } },
             form: finalData.form, 
             rawData: finalData, 
             oddsData: null,
             fromCache: false,
             availableRosters: finalData.availableRosters
        };
    
        return result;

    } catch (e: any) {
        console.error(`[IceHockeyApiProvider v1.5] KRITIKUS HIBA a fetchMatchData során: ${e.message}`, e.stack);
        return generateEmptyStubContext(options);
    }
}

// Meta-adat a logoláshoz
export const providerName = 'ice-hockey-api-v1.5-FIXED';


// === "Stub" Válasz Generátor ===
// (Változatlan v1.4 óta)
function generateEmptyStubContext(options: any): ICanonicalRichContext {
// ... (v1.4-es kód változatlan) ...
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats, leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (IceHockeyApi v1.5) sikertelen vagy hiányos.",
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
// ... (v1.4-es kód változatlan) ...
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
