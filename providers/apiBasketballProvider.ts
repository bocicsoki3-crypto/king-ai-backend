// FÁJL: providers/apiBasketballProvider.ts
// VERZIÓ: v106.0 (Smart Team Totals & Spread Support)
// MÓDOSÍTÁS (v106.0):
// 1. BŐVÍTÉS: Hozzáadva a 'spread' (Hendikep) piac feldolgozása.
// 2. ÚJ FUNKCIÓ: "Származtatott Csapat Totals" (Derived Team Totals).
//    Ha van Fővonal (Total) és Hendikep (Spread), a kód matematikailag
//    kiszámolja a csapatok várható egyéni pontszámát (Implied Team Total),
//    és létrehozza a 'home_total' és 'away_total' piacokat.
// 3. EREDMÉNY: A rendszer így akkor is tud "Warriors Over 115.5" tippet adni,
//    ha az API nem küldött explicit csapat-specifikus piacot.

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


// --- API HÍVÓ FÜGGVÉNY ---
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
 * "Stub" Válasz Generátor
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
function parseTheRundownEvent(
    event: any, 
    homeTeamName: string, 
    awayTeamName: string,
    // === ÚJ v125.0: Manuális xG értékek paraméterként ===
    manual_H_xG?: number | null,
    manual_H_xGA?: number | null,
    manual_A_xG?: number | null,
    manual_A_xGA?: number | null
): IDataFetchResponse {
    
    const homeTeamData = event.teams_normalized.find((t: any) => t.is_home);
    const awayTeamData = event.teams_normalized.find((t: any) => t.is_away);

    // --- 1. Statisztikák kinyerése ---
    const parseRecord = (record: string): { gp: number, form: string | null } => {
        if (!record || !record.includes('-')) return { gp: 1, form: null };
        try {
            const parts = record.split('-');
            const wins = parseInt(parts[0], 10);
            const losses = parseInt(parts[1], 10);
            const gp = wins + losses;
            return { gp: gp > 0 ? gp : 1, form: null };
        } catch (e) {
            return { gp: 1, form: null };
        }
    };
    
    const homeRecord = parseRecord(homeTeamData?.record);
    const awayRecord = parseRecord(awayTeamData?.record);
    
    const homeStats: ICanonicalStats = {
        gp: homeRecord.gp,
        gf: 0,
        ga: 0,
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
    
    const americanToDecimal = (americanOdds: number): number => {
        if (!americanOdds) return 1.91; // Fallback
        if (americanOdds > 0) {
            return (americanOdds / 100) + 1;
        } else {
            return (100 / Math.abs(americanOdds)) + 1;
        }
    };

    if (event.lines) {
        // Válasszuk a "Pinnacle" (id: 3) vagy "Bovada" (id: 2) oddsait
        const bookmakerLine = event.lines["3"] || event.lines["2"];
        
        if (bookmakerLine) {
            // A) Moneyline (h2h)
            if (bookmakerLine.moneyline) {
                const homeOdd = bookmakerLine.moneyline.moneyline_home;
                const awayOdd = bookmakerLine.moneyline.moneyline_away;
                if (homeOdd && awayOdd && homeOdd !== 0.0001 && awayOdd !== 0.0001) {
                    const homeDecimal = americanToDecimal(homeOdd);
                    const awayDecimal = americanToDecimal(awayOdd);
                    
                    current.push({ name: 'Hazai győzelem', price: homeDecimal });
                    current.push({ name: 'Vendég győzelem', price: awayDecimal });
                    allMarkets.push({
                        key: 'h2h',
                        outcomes: [
                            { name: 'Home', price: homeDecimal },
                            { name: 'Away', price: awayDecimal }
                        ]
                    });
                }
            }

            // B) Total és Spread (Hendikep)
            // Ezekre szükségünk lesz a Csapat Totals kiszámításához
            let mainTotalLine: number | null = null;
            let mainSpreadLine: number | null = null;

            // Total
            if (bookmakerLine.total) {
                const line = bookmakerLine.total.total_over;
                const overPrice = bookmakerLine.total.total_over_money;
                const underPrice = bookmakerLine.total.total_under_money;
                
                if (line && line !== 0.0001) {
                    mainTotalLine = line;
                    const overDecimal = americanToDecimal(overPrice);
                    const underDecimal = americanToDecimal(underPrice);
                    
                    allMarkets.push({
                        key: 'totals',
                        outcomes: [
                            { name: `Over ${line}`, price: overDecimal, point: line },
                            { name: `Under ${line}`, price: underDecimal, point: line }
                        ]
                    });
                }
            }
            
            // Spread (Hendikep)
            if (bookmakerLine.spread) {
                const line = bookmakerLine.spread.point_spread_home; // Pl. -5.0 (Home favored)
                const homePrice = bookmakerLine.spread.point_spread_home_money;
                const awayPrice = bookmakerLine.spread.point_spread_away_money;

                if (line && line !== 0.0001) {
                    mainSpreadLine = line;
                    const homeDecimal = americanToDecimal(homePrice);
                    const awayDecimal = americanToDecimal(awayPrice);

                    allMarkets.push({
                        key: 'spread',
                        outcomes: [
                            { name: `Home ${line}`, price: homeDecimal, point: line },
                            { name: `Away ${-line}`, price: awayDecimal, point: -line }
                        ]
                    });
                }
            }

            // === C) SZÁRMAZTATOTT CSAPAT TOTALS (SMART FEATURE v106.0) ===
            // Ha megvan a Total és a Spread, kiszámoljuk a csapatok várható pontszámát.
            // Ez akkor is ad "Team Total" piacot, ha az API nem küldte el közvetlenül!
            if (mainTotalLine !== null && mainSpreadLine !== null) {
                // Matematika: 
                // Implied Home = (Total - Spread_Home) / 2
                // Implied Away = (Total + Spread_Home) / 2
                // (Mert a Spread_Home negatív, ha ők a favoritok. Pl. Total 200, Spread -10. Home = (200 - (-10))/2 = 105. Helyes.)
                
                const impliedHomeTotal = (mainTotalLine - mainSpreadLine) / 2;
                const impliedAwayTotal = (mainTotalLine + mainSpreadLine) / 2;
                
                // Kerekítés 0.5-re vagy egészre
                const roundToHalf = (num: number) => Math.round(num * 2) / 2;
                
                const homeLine = roundToHalf(impliedHomeTotal);
                const awayLine = roundToHalf(impliedAwayTotal);

                // Hazai Csapat Totals
                allMarkets.push({
                    key: 'home_total',
                    outcomes: [
                        { name: `Over ${homeLine}`, price: 1.91, point: homeLine }, // Standard 1.91 odds placeholder
                        { name: `Under ${homeLine}`, price: 1.91, point: homeLine }
                    ]
                });

                // Vendég Csapat Totals
                allMarkets.push({
                    key: 'away_total',
                    outcomes: [
                        { name: `Over ${awayLine}`, price: 1.91, point: awayLine },
                        { name: `Under ${awayLine}`, price: 1.91, point: awayLine }
                    ]
                });
                
                console.log(`[apiBasketballProvider] Származtatott Csapat Totals Generálva: Home ~${homeLine}, Away ~${awayLine}`);
            }
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
             leagueId: event.schedule?.league_name || 'NBA',
             fixtureId: event.event_id,
             fixtureDate: event.event_date,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
        form: {
            home_overall: homeRecord.form,
            away_overall: awayRecord.form,
        },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: event.score?.venue_name || "N/A",
            structured_weather: { description: "N/A (Beltéri)", temperature_celsius: null, humidity_percent: null, wind_speed_kmh: null, precipitation_mm: null, source: 'N/A' },
            pitch_condition: "N/A (Parketta)", 
            weather: "N/A (Beltéri)",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    // === FEJLESZTVE v125.0: Manuális xG értékek beépítése ===
    const advancedData = { 
        home: { xg: null },
        away: { xg: null },
        manual_H_xG: manual_H_xG ?? null,
        manual_H_xGA: manual_H_xGA ?? null,
        manual_A_xG: manual_A_xG ?? null,
        manual_A_xGA: manual_A_xGA ?? null
    };
    
    if (manual_H_xG != null || manual_H_xGA != null || manual_A_xG != null || manual_A_xGA != null) {
        console.log(`[apiBasketballProvider v125.0] ✅ Manuális xG értékek beépítve: H_xG=${manual_H_xG}, H_xGA=${manual_H_xGA}, A_xG=${manual_A_xG}, A_xGA=${manual_A_xGA}`);
    }
    
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {},
         richContext: `Kosárlabda elemzés (v2.0 - TheRundown). Szezon: ${event.schedule?.season_year || 'N/A'}`,
         advancedData: advancedData,
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
        apiConfig,
        // === ÚJ v125.0: Manuális xG értékek fogadása ===
        manual_H_xG,
        manual_H_xGA,
        manual_A_xG,
        manual_A_xGA
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
            
            const apiHomeName = `${homeTeamData.name} ${homeTeamData.mascot}`.toLowerCase();
            const apiAwayName = `${awayTeamData.name} ${awayTeamData.mascot}`.toLowerCase();
            
            const scoreHome = compareStrings(searchHome, apiHomeName);
            const scoreAway = compareStrings(searchAway, apiAwayName);
            const avgScore = (scoreHome + scoreAway) / 2;

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
            
            // === ÚJ v125.0: Manuális xG értékek átadása ===
            return parseTheRundownEvent(
                bestMatch.event, 
                homeTeamName, 
                awayTeamName,
                manual_H_xG,
                manual_H_xGA,
                manual_A_xG,
                manual_A_xGA
            );
            
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
