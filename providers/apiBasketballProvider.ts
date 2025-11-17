// FÁJL: providers/apiBasketballProvider.ts
// VERZIÓ: v2.0 (Teljes "The Rundown" API Refaktor)
// MÓDOSÍTÁS:
// 1. TELJES ÚJRAÍRÁS: A provider most már a "The Rundown" API-t használja,
//    a felhasználó által biztosított logok és API tesztpont alapján.
// 2. ELTÁVOLÍTVA: Az 'api-sports' specifikus funkciók (getLeagueId, getTeamId, stb.) törölve,
//    mivel a "The Rundown" API nem így működik.
// 3. HOZZÁADVA: Új 'fetchMatchData' logika, ami a '/sports/4/events/{date}'
//    végpontot hívja, és "fuzzy matching"-et használ a csapatnevek azonosítására.
// 4. HOZZÁADVA: Helyi "fuzzy matching" segédfüggvények.
// 5. HOZZÁADVA: 'parseTheRundownEvent' függvény, ami a komplex JSON-t
//    ICanonicalRichContext-re alakítja.
// 6. JAVÍTÁS: .js kiterjesztések hozzáadva az importokhoz (Node.js/TypeScript-hez).

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
import type { IDataFetchResponse } from '../DataFetch.js'; 

import {
    SPORT_CONFIG,
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    makeRequest,
} from './common/utils.js';

// --- FUZZY MATCHING SEGÉDFÜGGVÉNYEK ---
// (Szükséges a csapatnevek azonosításához)
function getStringBigrams(str: string): Set<string> {
    if (!str || str.length < 2) return new Set();
    const s = str.toLowerCase();
    const v = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
        v.add(s.substring(i, i + 2));
    }
    return v;
}

function compareStrings(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const pairs1 = getStringBigrams(str1);
    const pairs2 = getStringBigrams(str2);
    if (pairs1.size === 0 && pairs2.size === 0) return 1;
    if (pairs1.size === 0 || pairs2.size === 0) return 0;
    
    const union = pairs1.size + pairs2.size;
    const intersection = new Set([...pairs1].filter(x => pairs2.has(x))).size;
    return (2.0 * intersection) / union;
}
// --- FUZZY MATCHING VÉGE ---


// --- API-SPORTS KÖZPONTI HÍVÓ FÜGGVÉNY ---
async function makeBasketballRequest(endpoint: string, config: AxiosRequestConfig = {}, sportConfig: any) {
    const sport = 'basketball';
    if (!sportConfig || !sportConfig.host || !sportConfig.keys || sportConfig.keys.length === 0) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó API HOST vagy KEYS a 'basketball' sporthoz a config.js API_HOSTS térképében.`);
    }
    
    const currentKey = sportConfig.keys[0]; 

    try {
        const url = `https://${sportConfig.host}${endpoint}`;
        const fullConfig: AxiosRequestConfig = {
            ...config,
            headers: {
                'x-rapidapi-key': currentKey,
                'x-rapidapi-host': sportConfig.host,
                ...config.headers
            }
        };
        const response = await makeRequest(url, fullConfig, 0); 
        return response;
    } catch (error: any) {
        if (error.isQuotaError) {
            throw new Error(`API KULCS Kimerült (${sport}).`);
        } else {
            console.error(`[apiBasketballProvider] Hiba: ${error.message}`);
            throw error;
        }
    }
}

/**
 * Időjárás-lekérő segédfüggvény (beltéri sportágra szabva)
 */
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    // Kosárlabda beltéri
    return { 
        description: "N/A (Beltéri)", 
        temperature_celsius: null,
        humidity_percent: null, 
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
}


/**
 * "Stub" Válasz Generátor (Hibakezeléshez)
 */
function generateEmptyStubContext(options: any): IDataFetchResponse {
    const { sport, homeTeamName, awayTeamName } = options;
    console.warn(`[apiBasketballProvider/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const defaultPoints = SPORT_CONFIG[sport]?.avg_goals || 110;
    const emptyStats: ICanonicalStats = { gp: 1, gf: defaultPoints, ga: defaultPoints, form: null };
    const emptyWeather: IStructuredWeather = { description: "N/A (API Hiba)", temperature_celsius: null, wind_speed_kmh: null, precipitation_mm: null, source: 'N/A' };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: { homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: { stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
        availableRosters: { home: [], away: [] }
    };
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés (kosárlabda) sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { 
            home: { xg: null, offensive_rating: defaultPoints, defensive_rating: defaultPoints }, 
            away: { xg: null, offensive_rating: defaultPoints, defensive_rating: defaultPoints },
             manual_H_xG: options.manual_H_xG,
             manual_H_xGA: options.manual_H_xGA,
             manual_A_xG: options.manual_A_xG,
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] }
    };
    
    let xgSource = "N/A (API Hiba)";
    if (options.manual_H_xG != null) {
        xgSource = "Manual (Components)";
    }
    
    return {
        ...result,
        xgSource: xgSource
    };
}


/**
 * 3. LÉPÉS: Feldolgozza a "The Rundown" eseményt kanonikus formátumra
 */
function parseTheRundownEvent(event: any, homeTeamName: string, awayTeamName: string): IDataFetchResponse {
    
    const homeTeamData = event.teams_normalized.find((t: any) => t.is_home);
    const awayTeamData = event.teams_normalized.find((t: any) => t.is_away);

    // --- 1. Statisztikák kinyerése ---
    // A 'record' mező (pl. "11-2") alapján számolunk GP-t
    const parseRecord = (record: string): { gp: number, form: string | null } => {
        if (!record || !record.includes('-')) return { gp: 1, form: null };
        try {
            const parts = record.split('-');
            const wins = parseInt(parts[0], 10);
            const losses = parseInt(parts[1], 10);
            const gp = wins + losses;
            // TODO: Forma kinyerése (az API testpoint nem mutatja)
            return { gp: gp > 0 ? gp : 1, form: null };
        } catch (e) {
            return { gp: 1, form: null };
        }
    };
    
    const homeRecord = parseRecord(homeTeamData?.record);
    const awayRecord = parseRecord(awayTeamData?.record);
    
    const homeStats: ICanonicalStats = {
        gp: homeRecord.gp,
        gf: 0, // A "The Rundown" nem adja meg az átlagpontokat ebben a végpontban
        ga: 0, // Ezeket a Model.ts-nek kell megbecsülnie, vagy P1-ből kapnia
        form: homeRecord.form
    };
    const awayStats: ICanonicalStats = {
        gp: awayRecord.gp,
        gf: 0,
        ga: 0,
        form: awayRecord.form
    };

    // --- 2. Oddsok kinyerése ---
    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    const current: ICanonicalOdds['current'] = [];
    
    if (event.lines) {
        // A 'lines' egy objektum, ahol a kulcs az affiliate_id (pl. "2", "3")
        // Válasszuk a "Pinnacle" (id: 3) vagy a "Bovada" (id: 2) oddsait
        const bookmakerLine = event.lines["3"] || event.lines["2"];
        if (bookmakerLine) {
            // Moneyline (h2h)
            if (bookmakerLine.moneyline) {
                const homeOdd = bookmakerLine.moneyline.moneyline_home;
                const awayOdd = bookmakerLine.moneyline.moneyline_away;
                if (homeOdd && awayOdd) {
                    current.push({ name: 'Hazai győzelem', price: (homeOdd > 0 ? (homeOdd/100)+1 : (100/Math.abs(homeOdd))+1) });
                    current.push({ name: 'Vendég győzelem', price: (awayOdd > 0 ? (awayOdd/100)+1 : (100/Math.abs(awayOdd))+1) });
                    allMarkets.push({
                        key: 'h2h',
                        outcomes: [
                            { name: 'Home', price: current[0].price },
                            { name: 'Away', price: current[1].price }
                        ]
                    });
                }
            }
            // Total (Totals)
            if (bookmakerLine.total) {
                const line = bookmakerLine.total.total_over; // (ami megegyezik a total_under-rel)
                const overPrice = bookmakerLine.total.total_over_money;
                const underPrice = bookmakerLine.total.total_under_money;
                
                allMarkets.push({
                    key: 'totals',
                    outcomes: [
                        { name: `Over ${line}`, price: (overPrice > 0 ? (overPrice/100)+1 : (100/Math.abs(overPrice))+1), point: line },
                        { name: `Under ${line}`, price: (underPrice > 0 ? (underPrice/100)+1 : (100/Math.abs(underPrice))+1), point: line }
                    ]
                });
            }
            // TODO: Spread (Handicap) kinyerése (bookmakerLine.spread)
        }
    }
    
    const oddsData: ICanonicalOdds = {
        current: current,
        allMarkets: allMarkets,
        fullApiData: event.lines || null,
        fromCache: false
    };

    // --- 3. Nyers Adatok (RawData) ---
    const finalData: ICanonicalRawData = {
        stats: { home: homeStats, away: awayStats },
        apiFootballData: {
             homeTeamId: homeTeamData?.team_id || null,
             awayTeamId: awayTeamData?.team_id || null,
             leagueId: event.schedule?.league_name || 'NBA', // Az API nem ad ID-t
             fixtureId: event.event_id,
             fixtureDate: event.event_date,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [], // Az API nem ad H2H-t ebben a végpontban
        form: {
            home_overall: homeRecord.form,
            away_overall: awayRecord.form,
        },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] }, // Az API nem ad hiányzókat ebben a végpontban
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: event.score?.venue_name || "N/A",
            structured_weather: { description: "N/A (Beltéri)", temperature_celsius: null, humidity_percent: null, wind_speed_kmh: null, precipitation_mm: null, source: 'N/A' },
            pitch_condition: "N/A (Parketta)", 
            weather: "N/A (Beltéri)",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] } // Az API nem ad kereteket ebben a végpontban
    };
    
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {}, // A Model.ts kezeli a defaultokat
         richContext: `Kosárlabda elemzés (v2.0 - TheRundown). Szezon: ${event.schedule?.season_year || 'N/A'}`,
         advancedData: { 
            home: { xg: null }, // Nincs xG/pont adat
            away: { xg: null }
         },
         form: finalData.form,
         rawData: finalData,
         oddsData: oddsData,
         fromCache: false,
         availableRosters: finalData.availableRosters
    };

    return {
        ...result,
        xgSource: "N/A (TheRundown API)"
    };
}

// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (Teljesen újraírva v104.2) ---
export async function fetchMatchData(options: any): Promise<IDataFetchResponse> {
    
    const { 
        sport, 
        homeTeamName, 
        awayTeamName, 
        leagueName, 
        utcKickoff, 
        apiConfig // Ezt a DataFetch.ts-től kapjuk meg
    } = options;
    
    console.log(`Adatgyűjtés indul (v2.0 - TheRundown - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);

    try {
        // 1. LÉPÉS: Dátum formázása és API hívás
        const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
        const sportId = "4"; // Kosárlabda a "The Rundown" API-ban
        
        const endpoint = `/sports/${sportId}/events/${matchDate}`;
        const params = {
            include: "scores,teams,schedule", // Kérjük a csapat és score adatokat
            offset: "0"
        };

        const response = await makeBasketballRequest(endpoint, { params }, apiConfig);

        if (!response?.data?.events || !Array.isArray(response.data.events) || response.data.events.length === 0) {
            console.warn(`[apiBasketballProvider] A "The Rundown" API nem adott vissza meccseket erre a napra: ${matchDate}`);
            return generateEmptyStubContext(options);
        }
        
        const events = response.data.events;

        // 2. LÉPÉS: Meccs megkeresése "Fuzzy Matching" segítségével
        let bestMatch: { event: any, score: number } | null = null;
        const FUZZY_THRESHOLD = 0.4; // Óvatos küszöb

        const searchHome = homeTeamName.toLowerCase();
        const searchAway = awayTeamName.toLowerCase();

        for (const event of events) {
            if (!event.teams_normalized || event.teams_normalized.length < 2) continue;
            
            const homeTeamData = event.teams_normalized.find((t: any) => t.is_home);
            const awayTeamData = event.teams_normalized.find((t: any) => t.is_away);
            
            if (!homeTeamData || !awayTeamData) continue;
            
            // A "The Rundown" API a 'name' (pl. "Indiana") és 'mascot' (pl. "Pacers") mezőket adja
            const apiHomeName = `${homeTeamData.name} ${homeTeamData.mascot}`.toLowerCase();
            const apiAwayName = `${awayTeamData.name} ${awayTeamData.mascot}`.toLowerCase();
            
            const scoreHome = compareStrings(searchHome, apiHomeName);
            const scoreAway = compareStrings(searchAway, apiAwayName);
            const avgScore = (scoreHome + scoreAway) / 2;

            // Fordított ellenőrzés (ha pl. a mi adatbázisunkban "Pacers", az API-ban "IND Pacers")
            const scoreHomeAlt = compareStrings(searchHome, `${homeTeamData.abbreviation} ${homeTeamData.mascot}`.toLowerCase());
            const scoreAwayAlt = compareStrings(searchAway, `${awayTeamData.abbreviation} ${awayTeamData.mascot}`.toLowerCase());
            const avgScoreAlt = (scoreHomeAlt + scoreAwayAlt) / 2;
            
            const finalScore = Math.max(avgScore, avgScoreAlt);

            if (finalScore > (bestMatch?.score || 0) && finalScore > FUZZY_THRESHOLD) {
                bestMatch = { event: event, score: finalScore };
            }
        }
        
        // 3. LÉPÉS: Feldolgozás vagy Hiba
        if (bestMatch) {
            const homeFound = bestMatch.event.teams_normalized.find((t:any) => t.is_home).name;
            const awayFound = bestMatch.event.teams_normalized.find((t:any) => t.is_away).name;
            console.log(`[apiBasketballProvider] SIKERES NÉVEGYEZTETÉS (Score: ${bestMatch.score.toFixed(2)}): ${homeTeamName} vs ${awayTeamName} -> ${homeFound} vs ${awayFound}`);
            
            // Átalakítjuk az eseményt a mi kanonikus formátumunkra
            return parseTheRundownEvent(bestMatch.event, homeTeamName, awayTeamName);
            
        } else {
            console.error(`[apiBasketballProvider] KRITIKUS HIBA: A névfeloldás sikertelen. Nem található a(z) '${homeTeamName}' vs '${awayTeamName}' meccs a ${matchDate} napon.`);
            return generateEmptyStubContext(options);
        }

    } catch (e: any) {
        console.error(`[apiBasketballProvider] KRITIKUS HIBA a fetchMatchData során: ${e.message}`, e.stack);
        return generateEmptyStubContext(options);
    }
}

// Meta-adat a logoláshoz
export const providerName = 'api-basketball-v2.0-TheRundown';
