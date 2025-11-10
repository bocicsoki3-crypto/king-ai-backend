// FÁJL: providers/iceHockeyApiProvider.ts
// VERZIÓ: v1.0
// CÉL: Az 'IceHockeyApi' (icehockeyapi2.p.rapidapi.com) API-t hívja.
//      Ez a "Kontextus Szolgáltató" (H2H, Keretek, Forma).
//      Ez az "Aggregátor" modell másik fele.

import { makeRequest } from './common/utils.js';
import { ICEHOCKEYAPI_HOST, ICEHOCKEYAPI_KEY, NHL_TEAM_NAME_MAP } from '../config.js';
import NodeCache from 'node-cache';
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult, 
    IStructuredWeather,
    IPlayerStub
} from '../src/types/canonical.d.ts';

const apiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 600 }); // 6 órás TTL

// Központi hívó függvény (IceHockeyApi)
async function makeIceHockeyRequest(endpoint: string, params: any = {}) {
    if (!ICEHOCKEYAPI_HOST || !ICEHOCKEYAPI_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ICEHOCKEYAPI_HOST vagy ICEHOCKEYAPI_KEY a .env fájlban.`);
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
        // Ez az API a 'data' kulcsban, azon belül 'result'-ban vagy 'data'-ban adhat vissza
        return response.data?.data || response.data?.result || response.data;
    } catch (error: any) {
        console.error(`[IceHockeyApiProvider] Hiba: ${error.message}. Endpoint: ${endpoint}`);
        throw error;
    }
}

/**
 * Segédfüggvény a csapat ID-k kereséséhez a '/api/ice-hockey/search/{name}' végponttal
 */
async function findTeamId(teamName: string): Promise<number | null> {
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = NHL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();
    
    const cacheKey = `icehockeyapi_team_${searchName}`;
    const cachedId = apiCache.get<number>(cacheKey);
    if (cachedId) {
        console.log(`[IceHockeyApiProvider] Csapat ID cache találat: "${searchName}" -> ${cachedId}`);
        return cachedId;
    }

    console.log(`[IceHockeyApiProvider] Csapat ID keresése: "${searchName}"...`);
    try {
        const results = await makeIceHockeyRequest(`api/ice-hockey/search/${encodeURIComponent(searchName)}`);
        // Feltételezzük, hogy a válasz egy 'teams' tömb
        if (!results || !Array.isArray(results.teams) || results.teams.length === 0) {
            console.warn(`[IceHockeyApiProvider] Nem található csapat ID ehhez: "${searchName}"`);
            return null;
        }
        
        // A legjobb találat (az API rangsorol)
        const foundTeam = results.teams[0];
        if (foundTeam && foundTeam.id) {
            console.log(`[IceHockeyApiProvider] Csapat TALÁLAT: "${foundTeam.name}" (ID: ${foundTeam.id})`);
            apiCache.set(cacheKey, foundTeam.id);
            return foundTeam.id;
        }
        return null;
    } catch (e: any) {
         console.error(`[IceHockeyApiProvider] Hiba a csapat ID keresésekor (${searchName}): ${e.message}`);
         return null;
    }
}

/**
 * Segédfüggvény a meccs ID kereséséhez
 */
async function findMatchId(
    homeTeamId: number, 
    awayTeamId: number, 
    matchDate: string
): Promise<number | string | null> {
    const cacheKey = `icehockeyapi_match_${homeTeamId}_${awayTeamId}_${matchDate}`;
    const cachedId = apiCache.get<number | string>(cacheKey);
    if (cachedId) {
        console.log(`[IceHockeyApiProvider] Meccs ID cache találat: ${cachedId}`);
        return cachedId;
    }

    console.log(`[IceHockeyApiProvider] Meccs ID keresése: ${homeTeamId} vs ${awayTeamId} (${matchDate})...`);
    try {
        // A '/api/ice-hockey/match/list/{date}' végpontot használjuk
        const response = await makeIceHockeyRequest(`api/ice-hockey/match/list/${matchDate}`);
        if (!response || !Array.isArray(response.events) || response.events.length === 0) {
            console.warn(`[IceHockeyApiProvider] Nem található meccs a(z) ${matchDate} napon.`);
            return null;
        }

        const foundMatch = response.events.find((e: any) => 
            e.home_team_id == homeTeamId && e.away_team_id == awayTeamId
        );

        if (foundMatch && foundMatch.id) {
            console.log(`[IceHockeyApiProvider] Meccs TALÁLAT (ID: ${foundMatch.id})`);
            apiCache.set(cacheKey, foundMatch.id);
            return foundMatch.id;
        }
        console.warn(`[IceHockeyApiProvider] Nem található meccs a(z) ${homeTeamId} vs ${awayTeamId} párosításhoz.`);
        return null;
    } catch (e: any) {
         console.error(`[IceHockeyApiProvider] Hiba a meccs ID keresésekor: ${e.message}`);
         return null;
    }
}

// TODO: Ezeket az átalakító (parser) függvényeket implementálni kell
function parseH2H(apiH2h: any): any[] { 
    console.log("[IceHockeyApiProvider] H2H feldolgozás (TODO)...");
    return []; 
}
function parseLineups(apiLineups: any): ICanonicalRawData['detailedPlayerStats'] { 
    console.log("[IceHockeyApiProvider] Keretek/Sérülések feldolgozás (TODO)...");
    return {
        home_absentees: [], 
        away_absentees: [], 
        key_players_ratings: { home: {}, away: {} }
    }; 
}
function parseStats(apiStats: any): { home: ICanonicalStats, away: ICanonicalStats, form: any } { 
    console.log("[IceHockeyApiProvider] Statisztikák/Forma feldolgozás (TODO)...");
    return {
        home: { gp: 1, gf: 0, ga: 0, form: null },
        away: { gp: 1, gf: 0, ga: 0, form: null },
        form: { home_overall: null, away_overall: null }
    };
}

/**
 * FŐ EXPORTÁLT FÜGGVÉNY (Kontextust ad vissza, Odds nélkül)
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v1.0 - IceHockeyApi): ${homeTeamName} vs ${awayTeamName}...`);
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Csapat ID-k keresése
        const [homeTeamId, awayTeamId] = await Promise.all([
            findTeamId(homeTeamName),
            findTeamId(awayTeamName)
        ]);

        if (!homeTeamId || !awayTeamId) {
            console.error(`[IceHockeyApiProvider] KRITIKUS HIBA: Csapat ID-k hiányoznak. (H: ${homeTeamId}, A: ${awayTeamId})`);
            return generateEmptyStubContext(options);
        }

        // 2. LÉPÉS: Meccs ID keresése
        const matchId = await findMatchId(homeTeamId, awayTeamId, matchDate);
        if (!matchId) {
            console.error(`[IceHockeyApiProvider] KRITIKUS HIBA: Meccs ID nem található.`);
            return generateEmptyStubContext(options);
        }

        // 3. LÉPÉS: Kontextus adatok párhuzamos lekérése
        console.log(`[IceHockeyApiProvider] Kontextus adatok lekérése... (MatchID: ${matchId})`);
        
        const [h2hData, lineupsData, statsData] = await Promise.all([
            makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/h2h`),
            makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/lineups`),
            makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/statistics`)
        ]);

        // 4. LÉPÉS: Adatok átalakítása (Parsers)
        const parsedStats = parseStats(statsData);
        const parsedLineups = parseLineups(lineupsData);

        // 5. LÉPÉS: Adatok egyesítése (RawData)
        const finalData = generateStubRawData(homeTeamId, awayTeamId, null, matchId, utcKickoff);
        
        finalData.h2h_structured = parseH2H(h2hData);
        finalData.stats = { home: parsedStats.home, away: parsedStats.away };
        finalData.form = parsedStats.form;
        finalData.detailedPlayerStats = parsedLineups;
        finalData.absentees = { 
            home: parsedLineups.home_absentees, 
            away: parsedLineups.away_absentees 
        };
        // TODO: A többi mezőt (referee, coach, stb.) is ki kell nyerni, ha az API adja

        // 6. LÉPÉS: Befejezés (RichContext)
        // Az 'oddsData' szándékosan 'null', mert azt az 'OddsFeedProvider' adja.
        const result: ICanonicalRichContext = {
             rawStats: finalData.stats, 
             leagueAverages: {},
             richContext: "IceHockeyApi (v1.0) - Kontextus lekérve. TODO: Parser implementáció.",
             advancedData: { home: { xg: null }, away: { xg: null } }, 
             form: finalData.form, 
             rawData: finalData, 
             oddsData: null, // Ezt a DataFetch.ts fogja feltölteni!
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
export const providerName = 'ice-hockey-api-v1';


// === "Stub" Válasz Generátor ===
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (IceHockeyApi v1.0) sikertelen vagy hiányos. Az elemzés P1 adatokra támaszkodhat.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null, // Fontos: null, mert ez a provider nem felel az odds-okért
         fromCache: false,
         availableRosters: emptyRawData.availableRosters
    };
    
    return result;
}

// Segédfüggvény, ami CSAK 'ICanonicalRawData'-t ad vissza.
function generateStubRawData(
    homeTeamId: number | null,
    awayTeamId: number | null,
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
        apiFootballData: { // Ezt a nevet megtartjuk a kompatibilitás miatt
             homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [], 
            away_absentees: [], 
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A (Jég)", 
            weather: "N/A (Beltéri)", match_tension_index: null, coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    return emptyRawData;
}
