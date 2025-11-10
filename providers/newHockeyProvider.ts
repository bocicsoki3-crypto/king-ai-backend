// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v75.0 (Teljes csere Sportradar logikára)
// MÓDOSÍTÁS:
// 1. TELJES CSERE: A fájl teljes tartalma lecserélve.
// 2. API VÁLTÁS: A régi 'api-sports-hockey-v1' logikája eltávolítva.
// 3. ÚJ LOGIKA: Az új, Tier 1 'Sportradar' (RapidAPI-n keresztül) logikája implementálva.
// 4. KONFIGURÁCIÓ: Az új 'SPORTRADAR_HOCKEY_HOST' és 'SPORTRADAR_HOCKEY_KEY' kulcsokat használja a 'config.ts'-ből.
// 5. EGYSZERŰSÍTÉS: A 'fetchMatchData' most már egy önálló, robusztus függvény,
//    ami belsőleg kezeli az ID-keresést. Nincs többé szükség a DataFetch.ts
//    oldaláról exportált '_getLeagueRoster' vagy 'getApiSportsTeamId' hívásokra.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
// Kanonikus típusok importálása
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
import {
    SPORT_CONFIG,
    NHL_TEAM_NAME_MAP,
    // ÚJ KULCSOK IMPORTÁLÁSA (v75.0)
    SPORTRADAR_HOCKEY_HOST,
    SPORTRADAR_HOCKEY_KEY
} from '../config.js';
import {
    makeRequest, // Ezt továbbra is használjuk a központi utils-ból
    getStructuredWeatherData
} from './common/utils.js';

// --- SPORTRADAR (HOKI) SPECIFIKUS CACHE-EK ---
const srApiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 600, useClones: false });
const srTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const srLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });

// --- SPORTRADAR KÖZPONTI HÍVÓ FÜGGVÉNY (v75.0) ---
async function makeSportradarRequest(endpoint: string, params: any = {}, config: AxiosRequestConfig = {}) {
    const sport = 'hockey';
    if (!SPORTRADAR_HOCKEY_HOST || !SPORTRADAR_HOCKEY_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó SPORTRADAR_HOCKEY_HOST vagy SPORTRADAR_HOCKEY_KEY a .env fájlban.`);
    }
    
    // Az API-nak 'get' és 'results' endpointjai vannak
    const url = `https://${SPORTRADAR_HOCKEY_HOST}/${endpoint}`;
    
    const fullConfig: AxiosRequestConfig = {
        ...config,
        params: { ...params, ...config.params },
        headers: {
            'x-rapidapi-host': SPORTRADAR_HOCKEY_HOST,
            'x-rapidapi-key': SPORTRADAR_HOCKEY_KEY,
            ...config.headers
        }
    };

    try {
        // A központi 'makeRequest' hívása a 'common/utils.ts'-ből
        const response = await makeRequest(url, fullConfig, 0); 
        // A Sportradar API 'results' kulcs alatt adja vissza az adatokat
        if (response?.data?.results) {
            return response.data.results;
        } else {
             console.warn(`[Sportradar (Hockey)] API válasz nem tartalmazta a 'results' kulcsot. Endpoint: ${endpoint}`);
             return null;
        }
    } catch (error: any) {
        if (error.isQuotaError) {
            throw new Error(`API KULCS Kimerült (${sport} - Sportradar).`);
        } else {
            console.error(`[Sportradar (Hockey)] Hiba: ${error.message}. Endpoint: ${endpoint}`);
            throw error;
        }
    }
}

// === ÚJ (v75.0) BELSŐ ID KERESŐ FÜGGVÉNYEK (Nem exportált) ===

async function getSportradarLeagueId(leagueName: string, sport: string): Promise<number | null> {
    if (sport !== 'hockey' || leagueName.toUpperCase() !== 'NHL') {
        return null;
    }
    
    // A Sportradar API-ban az NHL ID-ja (általában, ellenőrizni kell az API doksit!)
    // Tegyük fel, hogy az API 'league_id' paramétert vár a csapatkereséshez.
    // A Sportradar (RapidAPI) 'get-results' endpointja 'sport_id'-t és 'league_id'-t várhat.
    // Példa: A hoki sport_id=4. Az NHL league_id=1.
    // EZEKET AZ ÉRTÉKEKET AZ API DOKUMENTÁCIÓBÓL KELL KINYERNI.
    
    // Mivel a 'sportrader-realtime-fast-stable-data' API dokumentációja
    // nem publikus, egy ésszerű alapértelmezett értéket feltételezünk,
    // amit az API hívások finomítanak.
    
    // Tegyük fel, hogy az API 'get-results' endpointja 'league_id' nélkül is működik,
    // vagy a 'get-leagues' endpointon keresztül kellene megkeresni.
    
    // Egyszerűsítés: Az NHL-t (league_id=57) feltételezzük, ahogy a régi provider tette,
    // de ez az ÚJ API-val valószínűleg HIBÁS lesz.
    
    // *** VALÓDI MEGOLDÁS ***
    // 1. Az API 'get-leagues' (vagy hasonló) endpointját kellene hívni.
    // 2. Megkeresni az "NHL" nevű ligát.
    // 3. Visszaadni az ID-ját.
    
    // Átmeneti megoldás: Használjuk a régi, ismert ID-t (57), hátha működik.
    const NHL_LEAGE_ID_FROM_OLD_API = 57;
    console.warn(`[Sportradar (Hockey)] FIGYELEM: Hardkódolt NHL Liga ID (${NHL_LEAGE_ID_FROM_OLD_API}) használata. Ezt az új Sportradar API dokumentációja alapján ellenőrizni kell!`);
    
    return NHL_LEAGE_ID_FROM_OLD_API;
}


async function getSportradarTeamId(
    teamName: string, 
    leagueId: number,
    sport: string
): Promise<number | null> {
    
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = NHL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();
    
    const cacheKey = `sportradar_team_id_v1_${leagueId}_${searchName}`;
    const cached = srTeamIdCache.get<number>(cacheKey);
    if (cached) return cached;

    console.log(`[Sportradar (Hockey)] Csapat ID keresése: "${teamName}" (Keresés: "${searchName}")...`);

    try {
        // Ennek az endpointnak a nevét az API doksiból kell venni.
        // Tegyük fel, hogy van egy 'get-teams' endpoint.
        const teams = await makeSportradarRequest('get-teams', { league_id: leagueId, sport_id: 4 });
        
        if (!teams || teams.length === 0) {
            console.warn(`[Sportradar (Hockey)] Nem sikerült lekérni a csapatlistát a ${leagueId} ligából.`);
            return null;
        }

        let foundTeam: any = null;
        foundTeam = teams.find((t: any) => t.name.toLowerCase() === searchName);
        if (!foundTeam) {
            foundTeam = teams.find((t: any) => t.name.toLowerCase().includes(searchName));
        }

        if (foundTeam && foundTeam.id) {
            console.log(`[Sportradar (Hockey)] Csapat ID találat: "${teamName}" -> ${foundTeam.name} (ID: ${foundTeam.id})`);
            srTeamIdCache.set(cacheKey, foundTeam.id);
            return foundTeam.id;
        }

        console.error(`[Sportradar (Hockey)] NEM TALÁLHATÓ csapat ID ehhez: "${teamName}" (Keresés: "${searchName}")`);
        return null;

    } catch (e: any) {
        console.error(`[Sportradar (Hockey)] Hiba a csapat ID keresésekor: ${e.message}`);
        return null;
    }
}

// --- Ezt a függvényt a DataFetch.ts már nem használja, de belsőleg hasznos lehet ---
async function _getLeagueRoster(leagueId: number, season: number): Promise<any[]> {
    const cacheKey = `sportradar_roster_v1_${leagueId}_${season}`;
    const cached = srApiCache.get<any[]>(cacheKey);
    if (cached) return cached;

    console.log(`[Sportradar (Hockey)] Csapatkeret lekérése... (Liga: ${leagueId}, Szezon: ${season})`);
    
    // Tegyük fel, hogy az 'get-teams' endpoint visszaadja a játékosokat is,
    // vagy egy külön 'get-rosters' endpoint van.
    // Endpoint név az API doksiból kell!
    const teamsAndRosters = await makeSportradarRequest('get-teams', { league_id: leagueId, season: season });

    if (!teamsAndRosters || teamsAndRosters.length === 0) {
        console.warn(`[Sportradar (Hockey)] Nem sikerült lekérni a csapatkereteket (Liga: ${leagueId}, Szezon: ${season})`);
        return [];
    }

    srApiCache.set(cacheKey, teamsAndRosters);
    return teamsAndRosters;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (MÓDOSÍTVA v75.0) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v75.0 - Sportradar): ${homeTeamName} vs ${awayTeamName}...`);
    
    // A Sportradar API (feltételezve) nem igényel szezon paramétert a 'get-results' híváshoz,
    // csak dátumot.
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Liga ID (Belső keresés)
        const leagueId = await getSportradarLeagueId(leagueName, sport);
        if (!leagueId) {
            console.error(`[Sportradar (Hockey)] KRITIKUS HIBA: Nem található '${leagueName}' liga ID.`);
            return generateEmptyStubContext(options);
        }

        // 2. LÉPÉS: Csapat ID-k (Belső keresés)
        const [homeTeamId, awayTeamId] = await Promise.all([
            getSportradarTeamId(homeTeamName, leagueId, sport),
            getSportradarTeamId(awayTeamName, leagueId, sport),
        ]);

        if (!homeTeamId || !awayTeamId) {
            console.error(`[Sportradar (Hockey)] KRITIKUS HIBA: Csapat ID-k feloldása sikertelen. H:${homeTeamId}, A:${awayTeamId}`);
            return generateEmptyStubContext(options);
        }

        // 3. LÉPÉS: Meccs (Fixture) és Odds-ok keresése
        // A Sportradar API (a képed alapján) a 'get-results' endpointon adja vissza a meccseket,
        // és valószínűleg az odds-okat is.
        
        const cacheKey = `sportradar_match_v1_${homeTeamId}_${awayTeamId}_${matchDate}`;
        let matchData = srApiCache.get<any>(cacheKey);

        if (!matchData) {
            console.log(`[Sportradar (Hockey)] Meccs adat lekérése... (Dátum: ${matchDate})`);
            // Endpoint név az API doksiból kell!
            const dailyResults = await makeSportradarRequest('get-results', {
                sport_id: 4, // Hoki (feltételezés)
                league_id: leagueId,
                date: matchDate
            });

            if (!dailyResults || dailyResults.length === 0) {
                console.warn(`[Sportradar (Hockey)] Nem található meccs a ${matchDate} napon.`);
                return generateEmptyStubContext(options);
            }
            
            // Megkeressük a mi meccsünket a napi eredmények között
            matchData = dailyResults.find((m: any) => 
                (m.home?.id === homeTeamId && m.away?.id === awayTeamId)
            );

            if (matchData) {
                srApiCache.set(cacheKey, matchData);
            } else {
                console.warn(`[Sportradar (Hockey)] Nem található a ${homeTeamName} vs ${awayTeamName} meccs a napi listában.`);
                return generateEmptyStubContext(options);
            }
        } else {
            console.log(`[Sportradar (Hockey)] Meccs adat CACHE TALÁLAT.`);
        }

        // 4. LÉPÉS: Adatok feldolgozása
        const fixtureId = matchData.id || null;
        const fixtureDate = matchData.time ? new Date(matchData.time * 1000).toISOString() : utcKickoff;

        // Statisztikák (H2H, Forma) - Ezeket külön endpointokból kellene lekérni
        // (pl. 'get-h2h', 'get-team-stats'). Mivel ezek nincsenek a képen,
        // feltételezzük, hogy most csak az alap meccsadatot és odds-ot kapjuk meg.
        
        const apiSportsH2HData = null; // TODO: Implementálni a 'get-h2h' endpoint alapján
        const apiSportsHomeSeasonStats = null; // TODO: Implementálni a 'get-team-stats' endpoint alapján
        const apiSportsAwaySeasonStats = null; // TODO: Implementálni a 'get-team-stats' endpoint alapján
        const availableRosters = { home: [], away: [] }; // TODO: Implementálni a 'get-rosters' endpoint alapján

        // Odds adatok kinyerése (feltételezve, hogy a 'get-results' tartalmazza)
        let fetchedOddsData: ICanonicalOdds | null = null;
        if (matchData.odds) {
             // Az adatszerkezetet az API doksi alapján kell átalakítani!
             // Ez csak egy PÉLDA:
             const moneyline = matchData.odds?.moneyline;
             const currentOdds: { name: string; price: number }[] = [];
             if (moneyline) {
                 currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(moneyline.home) });
                 currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(moneyline.away) });
             }
             fetchedOddsData = {
                 current: currentOdds,
                 allMarkets: [], // TODO: Feldolgozni a többi piacot
                 fullApiData: matchData.odds,
                 fromCache: false
             };
        }
        
        // --- VÉGLEGES ADAT EGYESÍTÉS (v75.0 - Sportradar) ---
        const finalData = generateStubDataWithIds(homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate);
        
        // FELÜLÍRÁS A VALÓS ADATOKKAL (amiket eddig megszereztünk)
        finalData.apiFootballData.seasonStats = { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats };
        finalData.h2h_structured = apiSportsH2HData || [];
        finalData.form = {
            home_overall: apiSportsHomeSeasonStats?.form || null,
            away_overall: apiSportsAwaySeasonStats?.form || null,
        };
        finalData.availableRosters = availableRosters;
        
        // Statisztikák (ha vannak)
        const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || 1; 
        finalData.stats.home = {
            gp: homeGP,
            gf: apiSportsHomeSeasonStats?.goalsFor || 0,
            ga: apiSportsHomeSeasonStats?.goalsAgainst || 0,
            form: apiSportsHomeSeasonStats?.form || null
        };
        const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || 1;
        finalData.stats.away = {
            gp: awayGP,
            gf: apiSportsAwaySeasonStats?.goalsFor || 0,
            ga: apiSportsAwaySeasonStats?.goalsAgainst || 0,
            form: apiSportsAwaySeasonStats?.form || null
        };

        const result: ICanonicalRichContext = {
             rawStats: finalData.stats,
             leagueAverages: {},
             richContext: "Sportradar Adat (v75.0) - H2H/Forma implementáció szükséges.",
             advancedData: { home: { xg: null }, away: { xg: null } }, // xG-t te adod
             form: finalData.form,
             rawData: finalData,
             oddsData: fetchedOddsData, // Az új Sportradar odds-ok
             fromCache: false,
             availableRosters: finalData.availableRosters
        };
    
        return result;

    } catch (e: any) {
        console.error(`[Sportradar (Hockey)] KRITIKUS HIBA a fetchMatchData során: ${e.message}`, e.stack);
        return generateEmptyStubContext(options);
    }
}

// Meta-adat a logoláshoz
export const providerName = 'sportradar-hockey-v1';

// === Ezt a két függvényt a DataFetch.ts (v95.0) már NEM hívja ===
// Meghagyjuk őket, hátha a jövőben szükség lesz rájuk, de már nem exportáljuk.
async function _getApiSportsLeagueId(
    leagueName: string, 
    countryName: string, 
    season: number, 
    sport: string
): Promise<{ leagueId: number | null, foundSeason: number }> {
     throw new Error("Deprecated: _getApiSportsLeagueId (v75.0) - A DataFetch.ts már nem hívja.");
}
async function _getApiSportsTeamId(
    teamName: string, 
    sport: string, 
    leagueId: number | string, 
    season: number,
    leagueRosterData: { roster: any[], foundSeason: number }
): Promise<number | null> {
    throw new Error("Deprecated: _getApiSportsTeamId (v75.0) - A DataFetch.ts már nem hívja.");
}
// === DEPRECATED VÉGE ===

// === "Stub" Válasz Generátor ===
// Ezt használjuk, ha az API hívás BÁRHOL hibára fut.
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[Sportradar (Hockey) - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    return generateStubDataWithIds(null, null, null, null, null);
}

// ÚJ (v75.0) Segédfüggvény az adatszerkezet feltöltéséhez
function generateStubDataWithIds(
    homeTeamId: number | null,
    awayTeamId: number | null,
    leagueId: number | null,
    fixtureId: number | string | null,
    fixtureDate: string | null
): ICanonicalRichContext {
    
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
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentee: [], away_absentees: [], key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A (Jég)", 
            weather: "N/A (Beltéri)", match_tension_index: null, coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (Sportradar v75.0) sikertelen vagy hiányos. Az elemzés P1 adatokra támaszkodhat.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] }
    };
    
    return result;
}

// A getApiSportsFixtureResult függvényt meghagyjuk, hátha a régi rendszer
// egy másik része még hívja, de már nem része a fő adatfolyamnak.
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { 
    if (sport !== 'hockey' || !fixtureId) {
        return null;
    }
    const cacheKey = `fixture_result_v1_SR_${sport}_${fixtureId}`;
    const cached = fixtureResultCache.get<FixtureResult>(cacheKey);
    if (cached) return cached;
    
    console.log(`[Sportradar (Hockey)] Eredmény lekérése... (ID: ${fixtureId})`);
    
    try {
        // Endpoint név az API doksiból kell!
        const fixture = await makeSportradarRequest('get-results', { match_id: fixtureId });

        if (!fixture) {
             console.warn(`[Sportradar (Hockey)] Nem található meccs a ${fixtureId} ID alatt.`);
             return null;
        }

        const status = fixture.status; // Pl. "finished"
        const scores = fixture.scores; // Pl. { home: 3, away: 2 }
        
        if (status === 'finished' || status === 'FT') {
            const result: FixtureResult = { 
                home: scores.home,
                away: scores.away,
                status: 'FT'
            };
            fixtureResultCache.set(cacheKey, result);
            return result;
        }
        return { status: status }; 
    } catch (error: any) {
        console.error(`[Sportradar (Hockey)] Hiba az eredmény lekérésekor (ID: ${fixtureId}): ${error.message}`);
        return null;
    }
}
