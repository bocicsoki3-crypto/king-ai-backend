// FÁJL: providers/iceHockeyApiProvider_v1.4.ts
// VERZIÓ: v1.4 (Stratégiai váltás: Keresés helyett listázás)
// JAVÍTÁS (v1.4): A Log napló (v1.3) bebizonyította, hogy az API 'search'
// végpontja megbízhatatlan (nem találta meg a 'new jersey devils'-t).
//
// STRATÉGIAI VÁLTÁS: A 'findTeamId' függvényt eltávolítottuk.
// A 'findMatchId' függvényt átírtuk: Most már nem ID-ket, hanem csapatneveket
// kap. Lekéri az ÖSSZES meccset a megadott dátumra, és a válaszban,
// a csapatnevek alapján keresi meg a meccs ID-t. Ez sokkal robusztusabb.

import { makeRequest } from './common/utils.js';
import { ICEHOCKEYAPI_HOST, ICEHOCKEYAPI_KEY } from '../config.js'; // NHL_TEAM_NAME_MAP már nem kell
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
    
    const url = `https:///${ICEHOCKEYAPI_HOST}/${endpoint}`;
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

// === JAVÍTÁS (v1.4): 'findTeamId' eltávolítva ===

// === JAVÍTÁS (v1.4): 'findMatchId' átírva, hogy neveket fogadjon ===
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
    matchDate: string
): Promise<FoundMatchIds | null> {
    
    // Név normalizálás (bár lehet, hogy az API válaszában is normalizálni kell)
    const searchHome = homeTeamName.toLowerCase().trim();
    const searchAway = awayTeamName.toLowerCase().trim();

    const cacheKey = `icehockeyapi_matchlist_${matchDate}`;
    let dailyEvents = apiCache.get<any[]>(cacheKey);

    if (!dailyEvents) {
        console.log(`[IceHockeyApiProvider] Meccslista lekérése (Dátum: ${matchDate})...`);
        try {
            const response = await makeIceHockeyRequest(`api/ice-hockey/match/list/${matchDate}`);
            
            if (!response || !Array.isArray(response.events) || response.events.length === 0) {
                console.warn(`[IceHockeyApiProvider] Nem található meccs a(z) ${matchDate} napon.`);
                return null;
            }
            dailyEvents = response.events;
            apiCache.set(cacheKey, dailyEvents, 3600); // 1 óra cache a napi listának
        } catch (e: any) {
             console.error(`[IceHockeyApiProvider] Hiba a meccslista lekérésekor: ${e.message}`);
             return null;
        }
    } else {
        console.log(`[IceHockeyApiProvider] Meccslista cache találat (Dátum: ${matchDate})`);
    }

    if (!dailyEvents) return null;

    // Keressük a meccset a listában a nevek alapján
    const foundMatch = dailyEvents.find((e: any) => {
        // Az API válaszában lévő nevek normalizálása
        const apiHomeName = (e.home_team?.name || e.home_team || '').toLowerCase().trim();
        const apiAwayName = (e.away_team?.name || e.away_team || '').toLowerCase().trim();

        // Próbálunk egyezést találni (lehet, hogy "Devils" vs "New Jersey Devils", ezért 'includes'-t használunk)
        return (apiHomeName.includes(searchHome) && apiAwayName.includes(searchAway));
    });

    if (foundMatch && foundMatch.id && foundMatch.home_team_id && foundMatch.away_team_id) {
        console.log(`[IceHockeyApiProvider] Meccs TALÁLAT (ID: ${foundMatch.id}) nevek alapján.`);
        return {
            matchId: foundMatch.id,
            homeTeamId: foundMatch.home_team_id,
            awayTeamId: foundMatch.away_team_id
        };
    }
    
    console.warn(`[IceHockeyApiProvider] Nem található meccs a(z) ${searchHome} vs ${searchAway} párosításhoz a napi listában.`);
    return null;
}
// === JAVÍTÁS VÉGE ===

// Parser függvények (v1.3 - változatlanul hagyva)
function parseH2H(apiH2h: any): FixtureResult[] { 
    // ... (v1.3-as kód változatlan) ...
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
    // ... (v1.3-as kód változatlan) ...
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
    // ... (v1.3-as kód változatlan) ...
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
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v1.4 - IceHockeyApi - Stratégia: Lista): ${homeTeamName} vs ${awayTeamName}...`);
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Meccs ID, Home ID, Away ID keresése NEVEK alapján
        const matchIds = await findMatchByNames(homeTeamName, awayTeamName, matchDate);
        
        if (!matchIds) {
            console.error(`[IceHockeyApiProvider] KRITIKUS HIBA: Meccs ID nem található a napi listában.`);
            return generateEmptyStubContext(options);
        }
        
        const { matchId, homeTeamId, awayTeamId } = matchIds;

        // 2. LÉPÉS: SZEKVENCIÁLIS adatlekérés (Rate Limit Fix)
        console.log(`[IceHockeyApiProvider] Kontextus adatok SZEKVENCIÁLIS lekérése... (MatchID: ${matchId})`);
        
        const h2hData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/h2h`);
        console.log(`[IceHockeyApiProvider] H2H lekérve.`);
        
        const lineupsData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/lineups`);
        console.log(`[IceHockeyApiProvider] Lineups lekérve.`);
        
        const statsData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/statistics`);
        console.log(`[IceHockeyApiProvider] Stats lekérve.`);

        // 3. LÉPÉS: Adatok átalakítása (Parserek)
        const parsedStats = parseStats(statsData);
        const parsedLineups = parseLineups(lineupsData);
        const parsedH2H = parseH2H(h2hData);

        // 4. LÉPÉS: Adatok egyesítése (RawData)
        // Most már megvannak az ID-k is
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
             richContext: "IceHockeyApi (v1.4) - Kontextus sikeresen lekérve (Lista stratégia).",
             advancedData: { home: { xg: null }, away: { xg: null } },
             form: finalData.form, 
             rawData: finalData, 
             oddsData: null,
             fromCache: false,
             availableRosters: finalData.availableRosters
        };
    
        return result;

    } catch (e: any) {
        console.error(`[IceHockeyApiProvider] KRITIKUS HIBA a fetchMatchData során: ${e.message}`, e.stack);
        return generateEmptyStubContext(options);
    }
}

// Meta-adat a logoláshoz
export const providerName = 'ice-hockey-api-v1.4-FIXED';


// === "Stub" Válasz Generátor ===
// (Változatlan)
function generateEmptyStubContext(options: any): ICanonicalRichContext {
// ... (v1.3-as kód változatlan) ...
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats, leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (IceHockeyApi v1.4) sikertelen vagy hiányos.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form, rawData: emptyRawData, oddsData: null,
         fromCache: false, availableRosters: emptyRawData.availableRosters
    };
    return result;
}
function generateStubRawData(
    homeTeamId: number | string | null, // Módosítva, hogy string is lehessen (ha az API úgy adja)
    awayTeamId: number | string | null,
    leagueId: number | null,
    fixtureId: number | string | null,
    fixtureDate: string | null
): ICanonicalRawData {
// ... (v1.3-as kód változatlan) ...
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
