// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v75.3 (Helyes Végpont Javítás)
// MÓDOSÍTÁS:
// 1. OK: A v75.2-es kód egy nem létező '/get-teams' végpontot hívott (404-es hiba a logban).
// 2. JAVÍTVA: A teljes logika átírva, hogy a felhasználó által biztosított
//    képernyőfotón (image_34eede.png) látható, valós végpontokat használja.
// 3. ÚJ LOGIKA: A rendszer 'LeagueID' -> 'TeamID' helyett
//    'Event list flow' (esemény keresés) -> 'Get marketsodds' / 'Get results' (adatlekérés 'event_id' alapján)
//    logikára állt át.
// 4. ELTÁVOLÍTVA: A hibás 'getSportradarLeagueId' és 'getSportradarTeamId' függvények eltávolítva.

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
    SPORTRADAR_HOCKEY_HOST,
    SPORTRADAR_HOCKEY_KEY
} from '../config.js';
import {
    makeRequest, 
    getStructuredWeatherData
} from './common/utils.js';

// --- SPORTRADAR (HOKI) SPECIFIKUS CACHE-EK ---
const srApiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 600, useClones: false });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });

// --- SPORTRADAR KÖZPONTI HÍVÓ FÜGGVÉNY (v75.3) ---
// JAVÍTVA: 'endpoint' most már a valós végpontot jelenti (pl. 'eventlistflow')
async function makeSportradarRequest(endpoint: string, params: any = {}, config: AxiosRequestConfig = {}) {
    const sport = 'hockey';
    if (!SPORTRADAR_HOCKEY_HOST || !SPORTRADAR_HOCKEY_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó SPORTRADAR_HOCKEY_HOST vagy SPORTRADAR_HOCKEY_KEY a .env fájlban.`);
    }
    
    // Az API 'getresults', 'eventlistflow' stb. endpointokat használ
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
        const response = await makeRequest(url, fullConfig, 0); 
        // A 'sportrader-realtime-fast-stable-data' API válasz formátuma
        // ismeretlen (lehet 'results' vagy közvetlen adat).
        // A biztonság kedvéért az egész 'data' objektumot visszaadjuk.
        if (response?.data) {
            // A 'getresults' 'results' kulcsot használ, de az 'eventlistflow' talán nem.
            return response.data.results || response.data;
        } else {
             console.warn(`[Sportradar (Hockey)] API válasz nem tartalmazott 'data' kulcsot. Endpoint: ${endpoint}`);
             return null;
        }
    } catch (error: any) {
        if (error.isQuotaError) {
            throw new Error(`API KULCS Kimerült (${sport} - Sportradar).`);
        } else {
            // A 404-es hibát (Endpoint does not exist) itt fogjuk el
            console.error(`[Sportradar (Hockey)] Hiba: ${error.message}. Endpoint: ${endpoint}`);
            throw error;
        }
    }
}

// === ÚJ (v75.3) BELSŐ MECCS KERESŐ FÜGGVÉNY ===
async function findSportradarEvent(
    homeTeamName: string, 
    awayTeamName: string, 
    matchDate: string,
    sport: string
): Promise<any | null> {
    
    // 1. Csapatnevek normalizálása
    const homeLower = homeTeamName.toLowerCase().trim();
    const homeMapped = NHL_TEAM_NAME_MAP[homeLower] || homeTeamName;
    const searchHomeName = homeMapped.toLowerCase();
    
    const awayLower = awayTeamName.toLowerCase().trim();
    const awayMapped = NHL_TEAM_NAME_MAP[awayLower] || awayTeamName;
    const searchAwayName = awayMapped.toLowerCase();

    const cacheKey = `sportradar_event_v1_${searchHomeName}_${searchAwayName}_${matchDate}`;
    const cached = srApiCache.get<any>(cacheKey);
    if (cached) {
        console.log(`[Sportradar (Hockey)] Esemény CACHE TALÁLAT.`);
        return cached;
    }

    console.log(`[Sportradar (Hockey)] Esemény keresése: "${searchHomeName}" vs "${searchAwayName}" (${matchDate})...`);

    try {
        // 2. Az 'eventlistflow' végpont hívása (a képernyőfotó alapján)
        // TODO: A 'sportid' és 'date' paraméterek helyességét az API doksinak meg kell erősítenie.
        const events = await makeSportradarRequest('eventlistflow', { 
            sportid: 4, // Hoki (feltételezés)
            date: matchDate 
        });
        
        if (!events || !Array.isArray(events) || events.length === 0) {
            console.warn(`[Sportradar (Hockey)] Nem található esemény a(z) ${matchDate} napon. (Végpont: 'eventlistflow')`);
            return null;
        }

        // 3. Meccs keresése a listában
        // TODO: Az 'event.home.name' és 'event.away.name' elérési utakat
        // az API válasz (JSON struktúra) alapján ellenőrizni kell.
        let foundEvent: any = null;
        
        foundEvent = events.find((e: any) => 
            e.home?.name?.toLowerCase().includes(searchHomeName) &&
            e.away?.name?.toLowerCase().includes(searchAwayName)
        );

        if (foundEvent && foundEvent.id) {
            console.log(`[Sportradar (Hockey)] Esemény TALÁLAT: "${foundEvent.home.name}" vs "${foundEvent.away.name}" (EventID: ${foundEvent.id})`);
            srApiCache.set(cacheKey, foundEvent);
            return foundEvent;
        }

        console.error(`[Sportradar (Hockey)] NEM TALÁLHATÓ esemény ehhez: "${searchHomeName}" vs "${searchAwayName}"`);
        return null;

    } catch (e: any) {
        console.error(`[Sportradar (Hockey)] Hiba az esemény keresésekor ('eventlistflow'): ${e.message}`);
        // A log (404) alapján ez a hívás is el fog hasalni, ha a végpont neve
        // (pl. 'eventlistflow') helytelen.
        if (e.message.includes('404')) {
            console.error(`[Sportradar (Hockey)] KRITIKUS: Az 'eventlistflow' végpont nem létezik vagy hibás. Ellenőrizd a RapidAPI felületet (image_34eede.png) a pontos névhez!`);
        }
        return null;
    }
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (MÓDOSÍTVA v75.3) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    console.log(`Adatgyűjtés indul (v75.3 - Helyes Végpont): ${homeTeamName} vs ${awayTeamName}...`);
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    try {
        // 1. LÉPÉS: Esemény (Event) keresése az 'eventlistflow' végponton
        const eventData = await findSportradarEvent(homeTeamName, awayTeamName, matchDate, sport);

        if (!eventData || !eventData.id) {
            console.error(`[Sportradar (Hockey)] KRITIKUS HIBA: Az esemény (event) nem található. Az adatgyűjtés leáll.`);
            return generateEmptyStubContext(options);
        }

        const eventId = eventData.id;
        const fixtureId = eventId; // Az event ID-t használjuk fixtureId-ként
        const fixtureDate = eventData.time ? new Date(eventData.time * 1000).toISOString() : utcKickoff;
        
        // A 'generateStubRawData' biztosítja a helyes (TS2339) struktúrát
        const finalData: ICanonicalRawData = generateStubRawData(
            eventData.home?.id || null, 
            eventData.away?.id || null, 
            eventData.league?.id || null, 
            fixtureId, 
            fixtureDate
        );

        // 2. LÉPÉS: Odds és Eredmények lekérése (párhuzamosan)
        console.log(`[Sportradar (Hockey)] Odds és Eredmény lekérése... (EventID: ${eventId})`);
        
        const [matchDetails, oddsDetails] = await Promise.all([
            // 'Get results' hívása (a képernyőfotó alapján)
            makeSportradarRequest('getresults', { eventid: eventId }),
            // 'Get marketsodds' hívása (a képernyőfotó alapján)
            makeSportradarRequest('getmarketsodds', { eventid: eventId })
        ]);

        // 3. LÉPÉS: Odds adatok feldolgozása
        let fetchedOddsData: ICanonicalOdds | null = null;
        if (oddsDetails && oddsDetails.markets) {
             // TODO: Az 'oddsDetails.markets' struktúráját fel kell térképezni
             // az 'ICanonicalOdds' interfészre. Ez egy PÉLDA.
             const moneylineMarket = oddsDetails.markets.find((m: any) => m.name === "Moneyline");
             const currentOdds: { name: string; price: number }[] = [];
             
             if (moneylineMarket && moneylineMarket.outcomes) {
                 const homeOutcome = moneylineMarket.outcomes.find((o: any) => o.name === "Home");
                 const awayOutcome = moneylineMarket.outcomes.find((o: any) => o.name === "Away");
                 if (homeOutcome) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOutcome.odds) });
                 if (awayOutcome) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOutcome.odds) });
             }
             
             fetchedOddsData = {
                 current: currentOdds,
                 allMarkets: [], // TODO: Feldolgozni a többi piacot
                 fullApiData: oddsDetails,
                 fromCache: false
             };
        } else {
            console.warn(`[Sportradar (Hockey)] Nem érkeztek odds adatok a 'getmarketsodds' végpontról.`);
        }
        
        // 4. LÉPÉS: Meccs adatok feldolgozása (H2H, Stat, Keret)
        // TODO: A 'matchDetails' ('getresults') válaszát fel kell térképezni,
        // hogy kinyerjük a H2H, Szezon Stat, és Keret (Roster) adatokat.
        // Amíg ez nincs implementálva, a 'finalData' a 'stub' értékeket tartalmazza.
        
        // finalData.h2h_structured = parseH2H(matchDetails.h2h);
        // finalData.stats.home = parseStats(matchDetails.stats.home);
        // finalData.stats.away = parseStats(matchDetails.stats.away);
        // finalData.availableRosters = parseRosters(matchDetails.rosters);

        
        // 5. Befejezzük és becsomagoljuk 'ICanonicalRichContext'-be
        const result: ICanonicalRichContext = {
             rawStats: finalData.stats, 
             leagueAverages: {},
             richContext: "Sportradar Adat (v75.3) - Odds implementálva. H2H/Forma implementáció szükséges.",
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
async function _getApiSportsLeagueId(
    leagueName: string, 
    countryName: string, 
    season: number, 
    sport: string
): Promise<{ leagueId: number | null, foundSeason: number }> {
     throw new Error("Deprecated: _getApiSportsLeagueId (v75.3) - A DataFetch.ts már nem hívja.");
}
async function _getApiSportsTeamId(
    teamName: string, 
    sport: string, 
    leagueId: number | string, 
    season: number,
    leagueRosterData: { roster: any[], foundSeason: number }
): Promise<number | null> {
    throw new Error("Deprecated: _getApiSportsTeamId (v75.3) - A DataFetch.ts már nem hívja.");
}
// === DEPRECATED VÉGE ===


// === "Stub" Válasz Generátor ===
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { homeTeamName, awayTeamName } = options;
    console.warn(`[Sportradar (Hockey) - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    
    const emptyRawData = generateStubRawData(null, null, null, null, null);
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés (Sportradar v75.3) sikertelen vagy hiányos. Az elemzés P1 adatokra támaszkodhat.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
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
        apiFootballData: {
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

// A getApiSportsFixtureResult függvényt meghagyjuk, de az új logikára (event_id) alapozzuk
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { 
    if (sport !== 'hockey' || !fixtureId) {
        return null;
    }
    const cacheKey = `fixture_result_v1_SR_${sport}_${fixtureId}`;
    const cached = fixtureResultCache.get<FixtureResult>(cacheKey);
    if (cached) return cached;
    
    console.log(`[Sportradar (Hockey)] Eredmény lekérése... (EventID: ${fixtureId})`);
    
    try {
        // A 'fixtureId'-t most már 'eventid'-ként kezeljük
        const fixture = await makeSportradarRequest('getresults', { eventid: fixtureId });

        if (!fixture) {
             console.warn(`[Sportradar (Hockey)] Nem található meccs a ${fixtureId} EventID alatt.`);
             return null;
        }
        
        // TODO: Az API válasz alapján ellenőrizni kell a státusz és pontszám elérési utakat
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
        console.error(`[Sportradar (Hockey)] Hiba az eredmény lekérésekor (EventID: ${fixtureId}): ${error.message}`);
        return null;
    }
}
