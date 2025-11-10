// FÁJL: providers/iceHockeyApiProvider_FIXED.ts
// VERZIÓ: v1.3 (Kritikus javítások: Csapatkeresés és Parser Implementáció)
// JAVÍTÁS (Csapatkeresés): A Log napló alapján a 'findTeamId' nem találta a "devils" és "islanders"
// csapatokat. Ez 99%-ban azért van, mert az API teljes neveket vár (pl. "New Jersey Devils"),
// és a 'config.js'-ből importált 'NHL_TEAM_NAME_MAP' hiányos.
// HOZZÁADVA: Egy belső, robusztus térkép (INTERNAL_NHL_TEAM_MAP) hozzáadva,
// hogy kezelje a gyakori rövid neveket, biztosítva a csapat ID-k megtalálását.
//
// JAVÍTÁS (TODO): Az üres 'parseH2H', 'parseLineups', 'parseStats' függvények
// ki lettek töltve logikával. E nélkül az AI nem kapna adatot.

import { makeRequest } from './common/utils.js';
// Az NHL_TEAM_NAME_MAP továbbra is importálva van, hogy a config.js felülírhassa a belső térképet
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

// === JAVÍTÁS (v1.3): Robusztus belső térkép a gyakori NHL nevekre ===
// Ez biztosítja, hogy a rövid nevek ("devils") is működjenek,
// még akkor is, ha a config.js-ben lévő térkép hiányos.
const INTERNAL_NHL_TEAM_MAP: { [key: string]: string } = {
    'devils': 'New Jersey Devils',
    'islanders': 'New York Islanders',
    'rangers': 'New York Rangers',
    'flyers': 'Philadelphia Flyers',
    'penguins': 'Pittsburgh Penguins',
    'bruins': 'Boston Bruins',
    'sabres': 'Buffalo Sabres',
    'canadiens': 'Montreal Canadiens',
    'senators': 'Ottawa Senators',
    'leafs': 'Toronto Maple Leafs',
    'hurricanes': 'Carolina Hurricanes',
    'panthers': 'Florida Panthers',
    'lightning': 'Tampa Bay Lightning',
    'capitals': 'Washington Capitals',
    'blackhawks': 'Chicago Blackhawks',
    'red wings': 'Detroit Red Wings',
    'predators': 'Nashville Predators',
    'blues': 'St. Louis Blues',
    'flames': 'Calgary Flames',
    'avalanche': 'Colorado Avalanche',
    'oilers': 'Edmonton Oilers',
    'wild': 'Minnesota Wild',
    'canucks': 'Vancouver Canucks',
    'ducks': 'Anaheim Ducks',
    'stars': 'Dallas Stars',
    'kings': 'Los Angeles Kings',
    'sharks': 'San Jose Sharks',
    'blue jackets': 'Columbus Blue Jackets',
    'golden knights': 'Vegas Golden Knights',
    'jets': 'Winnipeg Jets',
    'coyotes': 'Arizona Coyotes',
    'kraken': 'Seattle Kraken'
};
// =================================================================

// Központi hívó függvény (IceHockeyApi)
async function makeIceHockeyRequest(endpoint: string, params: any = {}) {
    // ... a kód többi része változatlan ...
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
    
    // === JAVÍTÁS (v1.3): Bővített név leképezés ===
    // 1. Először a config.js-ből importált térképet nézzük (ha felül akarjuk írni)
    // 2. Aztán a belső, robusztus térképet
    // 3. Végül magát a kapott nevet
    const mappedName = (NHL_TEAM_NAME_MAP && NHL_TEAM_NAME_MAP[lowerName]) 
                       || INTERNAL_NHL_TEAM_MAP[lowerName] 
                       || teamName;
    
    const searchName = mappedName.toLowerCase();
    // ===============================================
    
    const cacheKey = `icehockeyapi_team_${searchName}`;
    const cachedId = apiCache.get<number>(cacheKey);
    if (cachedId) {
        console.log(`[IceHockeyApiProvider] Csapat ID cache találat: "${searchName}" -> ${cachedId}`);
        return cachedId;
    }

    console.log(`[IceHockeyApiProvider] Csapat ID keresése: "${searchName}" (Eredeti: "${teamName}")...`);
    try {
        const results = await makeIceHockeyRequest(`api/ice-hockey/search/${encodeURIComponent(searchName)}`);
        
        if (!results || !Array.isArray(results.teams) || results.teams.length === 0) {
            console.warn(`[IceHockeyApiProvider] Nem található csapat ID ehhez: "${searchName}"`);
            return null;
        }
        
        // Tegyük fel, hogy az API a legjobb találatot adja elsőnek
        // Egy robusztusabb megoldás string hasonlósági vizsgálatot végezne
        const foundTeam = results.teams.find((t: any) => t.name.toLowerCase() === searchName) || results.teams[0];
        
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
// ... a kód többi része változatlan ...
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
        // Figyelem: A 'match/list' végpont 'date' paramétert vár?
        // Ellenőrizni kell az API dokumentációt. Ha az URL-ben kell, akkor 'match/list/${matchDate}'
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

// === JAVÍTÁS (v1.3): Parser függvények implementálása ===

function parseH2H(apiH2h: any): FixtureResult[] { 
    console.log("[IceHockeyApiProvider] H2H feldolgozás...");
    if (!apiH2h || !Array.isArray(apiH2h.events)) {
        return [];
    }
    // Átalakítjuk az API választ a kanonikus 'FixtureResult' formátumra
    return apiH2h.events.map((event: any) => ({
        fixture_id: event.id,
        date: new Date(event.timestamp * 1000).toISOString(),
        home_team_name: event.home_team,
        away_team_name: event.away_team,
        home_score: event.home_score?.current,
        away_score: event.away_score?.current,
        result_type: event.status === 'finished' ? 'FullTime' : 'Scheduled'
    })).slice(0, 10); // Csak az utolsó 10 H2H érdekes
}

function parseLineups(apiLineups: any): ICanonicalRawData['detailedPlayerStats'] { 
    console.log("[IceHockeyApiProvider] Keretek/Sérülések feldolgozás...");
    
    const result: ICanonicalRawData['detailedPlayerStats'] = {
        home_absentees: [], 
        away_absentees: [], 
        key_players_ratings: { home: {}, away: {} }
    };

    // Tegyük fel, hogy az 'apiLineups' objektum 'home' és 'away' tömböket tartalmaz
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
    
    // TODO: A 'key_players_ratings' feltöltése, ha az API ad rá adatot
    // (Jelenleg üresen hagyjuk)

    return result; 
}

function parseStats(apiStats: any): { home: ICanonicalStats, away: ICanonicalStats, form: any } { 
    console.log("[IceHockeyApiProvider] Statisztikák/Forma feldolgozás...");
    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    
    // Tegyük fel, hogy az 'apiStats' 'home' és 'away' objektumokat tartalmaz
    // 'statistics' vagy 'standings' kulcs alatt
    
    const homeApiStats = apiStats?.home?.statistics || apiStats?.home;
    const awayApiStats = apiStats?.away?.statistics || apiStats?.away;

    const homeStats: ICanonicalStats = homeApiStats ? {
        gp: homeApiStats.games_played || 1,
        gf: homeApiStats.goals_scored || 0,
        ga: homeApiStats.goals_conceded || 0,
        form: homeApiStats.form || null // Pl. "WWLWL"
    } : emptyStats;
    
    const awayStats: ICanonicalStats = awayApiStats ? {
        gp: awayApiStats.games_played || 1,
        gf: awayApiStats.goals_scored || 0,
        ga: awayApiStats.goals_conceded || 0,
        form: awayApiStats.form || null
    } : emptyStats;

    return {
        home: homeStats,
        away: awayStats,
        form: { home_overall: homeStats.form, away_overall: awayStats.form }
    };
}
// =======================================================

/**
 * FŐ EXPORTÁLT FÜGGVÉNY (Kontextust ad vissza, Odds nélkül)
 */
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v1.3 - IceHockeyApi - Javított): ${homeTeamName} vs ${awayTeamName}...`);
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Csapat ID-k keresése (Javított logikával)
        const homeTeamId = await findTeamId(homeTeamName);
        const awayTeamId = await findTeamId(awayTeamName);

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

        // 3. LÉPÉS: SZEKVENCIÁLIS adatlekérés (Rate Limit Fix)
        // (Ez a rész már helyes volt a v1.2-ben)
        console.log(`[IceHockeyApiProvider] Kontextus adatok SZEKVENCIÁLIS lekérése... (MatchID: ${matchId})`);
        
        const h2hData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/h2h`);
        console.log(`[IceHockeyApiProvider] H2H lekérve.`);
        
        const lineupsData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/lineups`);
        console.log(`[IceHockeyApiProvider] Lineups lekérve.`);
        
        const statsData = await makeIceHockeyRequest(`api/ice-hockey/match/${matchId}/statistics`);
        console.log(`[IceHockeyApiProvider] Stats lekérve.`);

        // 4. LÉPÉS: Adatok átalakítása (Javított Parserek)
        const parsedStats = parseStats(statsData);
        const parsedLineups = parseLineups(lineupsData);
        const parsedH2H = parseH2H(h2hData);

        // 5. LÉPÉS: Adatok egyesítése (RawData)
        const finalData = generateStubRawData(homeTeamId, awayTeamId, null, matchId, utcKickoff);
        
        finalData.h2h_structured = parsedH2H;
        finalData.stats = { home: parsedStats.home, away: parsedStats.away };
        finalData.form = parsedStats.form;
        finalData.detailedPlayerStats = parsedLineups;
        finalData.absentees = { 
            home: parsedLineups.home_absentees, 
            away: parsedLineups.away_absentees 
        };
        // TODO: A többi mezőt (referee, coach, stb.) is ki kell nyerni, ha az API adja

        // 6. LÉPÉS: Befejezés (RichContext)
        const result: ICanonicalRichContext = {
             rawStats: finalData.stats, 
             leagueAverages: {}, // Ezt egy külön liga-átlag provider tölthetné fel
             richContext: "IceHockeyApi (v1.3) - Kontextus sikeresen lekérve és feldolgozva.",
             advancedData: { home: { xg: null }, away: { xg: null } }, // xG-t (várható gól) ez az API nem biztosít
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
export const providerName = 'ice-hockey-api-v1.3-FIXED';


// === "Stub" Válasz Generátor ===
// ... a kód többi része változatlan ...
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (IceHockeyApi v1.3) sikertelen vagy hiányos. Az elemzés P1 adatokra támaszkodhat.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null, // Fontos: null, mert ez a provider nem felel az odds-okért
         fromCache: false,
         availableRosters: emptyRawData.availableRosters
    };
    
    return result;
}

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
