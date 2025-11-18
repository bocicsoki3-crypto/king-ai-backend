// FÁJL: providers/iceHockeyApiProvider.ts
// VERZIÓ: v105.3 (RapidAPI JSON Struktúra Javítás)
// MÓDOSÍTÁS (v105.3):
// 1. JAVÍTVA: A 'parseIceHockeyOdds' funkció most már a 'markets' tömböt keresi
//    az 'odds' helyett, mivel a log bizonyította, hogy ez a helyes kulcs.
// 2. JAVÍTVA: A piacok nevei igazítva a logban látottakhoz:
//    - 'Moneyline' -> 'Full time' (és 'Home/Away' marketGroup)
//    - 'Total' -> 'Match goals'
// 3. JAVÍTVA: A választások (choices) feldolgozása igazítva a log szerkezetéhez
//    (pl. 'fractionalValue' konvertálása decimálissá, ha nincs 'odds' mező).

import fetch from 'node-fetch';

import { 
    ICEHOCKEYAPI_HOST, 
    ICEHOCKEYAPI_KEY,
    NHL_TEAM_NAME_MAP 
} from '../config.js'; 

// Helyes interfészek importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    IStructuredWeather,
    ICanonicalOdds
} from '../src/types/canonical.d.ts';
import type { IDataFetchResponse } from '../DataFetch.js';


// Provider nevének exportálása
export const providerName = 'ice-hockey-api-v2.1-TSFIX';

// --- API Konfiguráció ---

const emptyHockeyWeather: IStructuredWeather = {
    description: "N/A (Beltéri/Jégkorong)",
    temperature_celsius: null,
    humidity_percent: null,
    wind_speed_kmh: null,
    precipitation_mm: null,
    source: 'N/A'
};

/**
 * Normalizáló segédfüggvény a string-összehasonlításhoz.
 */
function normalizeTeamName(name: string): string {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[-_.]/g, ' ') 
        .replace(/\s+/g, ' ') 
        .trim();
}


// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ (v1.9-ből) ===
function getStringBigrams(str: string): string[] {
    if (str.length <= 1) return [str];
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.add(str.substring(i, i + 2));
    }
    return Array.from(bigrams);
}

function compareStrings(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const bigrams1 = getStringBigrams(str1);
    const bigrams2 = getStringBigrams(str2);
    const intersection = new Set(bigrams1.filter(bigram => bigrams2.includes(bigram)));
    const totalLength = bigrams1.length + bigrams2.length;
    if (totalLength === 0) return 1;
    return (2.0 * intersection.size) / totalLength;
}
// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ VÉGE ===

// === Segédfüggvény: Tört odds konvertálása decimálissá ===
function parseFractionalOdds(fraction: string): number {
    if (!fraction) return 0;
    const parts = fraction.split('/');
    if (parts.length !== 2) return parseFloat(fraction); // Ha már decimális
    return 1 + (parseFloat(parts[0]) / parseFloat(parts[1]));
}

// === ÚJ (v105.3) Funkció: Odds adatok feldolgozása ===
/**
 * Lefordítja az 'ice-hockey-api' odds válaszát a mi belső ICanonicalOdds formátumunkra.
 * IGASZÍTVA A LOGBAN LÁTOTT ADATSTRUKTÚRÁHOZ.
 */
function parseIceHockeyOdds(apiResponse: any): ICanonicalOdds | null {
    // A log szerint a kulcs 'markets' és nem 'odds'
    const rawMarkets = apiResponse?.markets;
    
    if (!rawMarkets || !Array.isArray(rawMarkets) || rawMarkets.length === 0) {
        console.warn(`[IceHockeyApiProvider] Érvénytelen odds válasz (nincs 'markets'). Nyers adat: ${JSON.stringify(apiResponse).substring(0, 200)}...`);
        return null;
    }

    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    const current: ICanonicalOdds['current'] = []; // Moneyline

    // 1. Piac: Moneyline (H2H)
    // A logban: marketName="Full time", marketGroup="Home/Away"
    const h2hMarket = rawMarkets.find((m: any) => 
        (m.marketName === 'Full time' || m.marketGroup === 'Home/Away') && !m.suspended
    );

    if (h2hMarket && h2hMarket.choices) {
        const outcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        
        // A logban: name="1" (Hazai), name="2" (Vendég)
        const homeChoice = h2hMarket.choices.find((c: any) => c.name === '1');
        const awayChoice = h2hMarket.choices.find((c: any) => c.name === '2');
        
        // Az odds "fractionalValue" mezőben van (pl. "4/5")
        const homeOdd = homeChoice ? parseFractionalOdds(homeChoice.fractionalValue) : 0;
        const awayOdd = awayChoice ? parseFractionalOdds(awayChoice.fractionalValue) : 0;

        if (homeOdd > 0 && awayOdd > 0) {
            outcomes.push({ name: 'Home', price: homeOdd });
            outcomes.push({ name: 'Away', price: awayOdd });
            current.push({ name: 'Hazai győzelem', price: homeOdd });
            current.push({ name: 'Vendég győzelem', price: awayOdd });
            allMarkets.push({ key: 'h2h', outcomes: outcomes });
        }
    }

    // 2. Piac: Totals (Over/Under)
    // A logban: marketName="Match goals", marketGroup="Match goals"
    // FONTOS: A logban csak EGY vonal (5.5) látszik a 'choiceGroup'-ban.
    // A kódnak kezelnie kell, ha több ilyen piac van.
    const totalsMarkets = rawMarkets.filter((m: any) => 
        (m.marketName === 'Match goals' || m.marketGroup === 'Match goals') && !m.suspended
    );

    if (totalsMarkets.length > 0) {
        const totalsOutcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        
        totalsMarkets.forEach((market: any) => {
            // A vonal a 'choiceGroup'-ban van (pl. "5.5")
            const line = parseFloat(market.choiceGroup);
            if (isNaN(line)) return;

            const overChoice = market.choices.find((c: any) => c.name === 'Over');
            const underChoice = market.choices.find((c: any) => c.name === 'Under');

            const overOdd = overChoice ? parseFractionalOdds(overChoice.fractionalValue) : 0;
            const underOdd = underChoice ? parseFractionalOdds(underChoice.fractionalValue) : 0;

            if (overOdd > 0) {
                totalsOutcomes.push({ name: `Over ${line}`, price: overOdd, point: line });
            }
            if (underOdd > 0) {
                totalsOutcomes.push({ name: `Under ${line}`, price: underOdd, point: line });
            }
        });

        if (totalsOutcomes.length > 0) {
            allMarkets.push({ key: 'totals', outcomes: totalsOutcomes });
        }
    }

    if (allMarkets.length === 0) {
         console.warn(`[IceHockeyApiProvider] Feldolgoztunk ${rawMarkets.length} piacot, de nem találtunk érvényes 'Full time' vagy 'Match goals' adatot.`);
         return null;
    }

    return {
        current: current,
        allMarkets: allMarkets,
        fullApiData: rawMarkets, // A nyers piactömb mentése
        fromCache: false
    };
}

// === ÚJ (v105.1) Funkció: Odds API hívása ===
/**
 * Lekéri a szorzókat a megadott meccs ID alapján.
 */
async function getIceHockeyOdds(matchId: string | number): Promise<ICanonicalOdds | null> {
    if (!matchId) {
        console.warn(`[IceHockeyApiProvider] Odds lekérés kihagyva: érvénytelen matchId.`);
        return null;
    }
    if (!ICEHOCKEYAPI_KEY || !ICEHOCKEYAPI_HOST) {
        console.error(`[IceHockeyApiProvider] Odds lekérés hiba: Hiányzó API kulcs vagy Host.`);
        return null;
    }

    const path = `/api/ice-hockey/match/${matchId}/odds`;
    const url = `https://${ICEHOCKEYAPI_HOST}${path}`;
    
    console.log(`[IceHockeyApiProvider v105.1] Odds adatok lekérése (A-terv)... (ID: ${matchId}) URL: ${url}`);

    try {
        // @ts-ignore
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': ICEHOCKEYAPI_KEY,
                'x-rapidapi-host': ICEHOCKEYAPI_HOST
            }
        });

        if (!response.ok) {
            throw new Error(`API hiba az odds lekérésekor: ${response.status} ${response.statusText} (${url})`);
        }

        const data = (await response.json()) as any;

        // === JAVÍTÁS (v105.3): 'markets' ellenőrzése 'odds' helyett ===
        if (!data || (!data.odds && !data.markets)) {
            console.warn(`[IceHockeyApiProvider] Az odds végpont nem adott vissza 'markets' adatot (ID: ${matchId}). Válasz: ${JSON.stringify(data)}`);
            return null;
        }

        // Feldolgozzuk és visszaadjuk a kanonikus formátumot
        return parseIceHockeyOdds(data);

    } catch (error: any) {
        console.error(`[IceHockeyApiProvider] Kritikus hiba az odds lekérése során (ID: ${matchId}): ${error.message}`);
        return null;
    }
}

/**
 * Fallback függvény
 */
function generateEmptyStubContext(homeTeamName: string, awayTeamName: string): IDataFetchResponse {
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: { homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: { stadium_location: "N/A", structured_weather: emptyHockeyWeather, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
        availableRosters: { home: [], away: [] }
    };

    const result: ICanonicalRichContext = {
        rawStats: emptyRawData.stats,
        leagueAverages: {},
        richContext: "Figyelem: Az automatikus P4 API adatgyűjtés (iceHockeyApiProvider v2.1) sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
        advancedData: { home: { xg: null }, away: { xg: null } },
        form: emptyRawData.form,
        rawData: emptyRawData,
        oddsData: null,
        fromCache: false,
        availableRosters: { home: [], away: [] }
    };
    
    return {
        ...result,
        xgSource: "N/A (API Hiba)"
    };
}


/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (JAVÍTOTT v105.1)
 */
export async function fetchMatchData(options: {
    sport: string;
    homeTeamName: string;
    awayTeamName: string;
    leagueName: string;
    utcKickoff: string;
    homeTeamId: number | null;
    awayTeamId: number | null;
    leagueId: number | null;
}): Promise<IDataFetchResponse> {

    const { homeTeamName, awayTeamName, utcKickoff } = options;
    console.log(`Adatgyűjtés indul (v2.1 - IceHockeyApi - Stratégia: Config Import + Map): ${homeTeamName} vs ${awayTeamName}...`);

    if (!ICEHOCKEYAPI_KEY) {
        console.error(`[IceHockeyApiProvider v2.1] KRITIKUS HIBA: Az 'ICEHOCKEYAPI_KEY' hiányzik a 'config.ts' fájlból vagy a .env fájlból.`);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
    if (!ICEHOCKEYAPI_HOST) {
        console.error(`[IceHockeyApiProvider v2.1] KRITIKUS HIBA: Az 'ICEHOCKEYAPI_HOST' hiányzik a 'config.ts' fájlból vagy a .env fájlból.`);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }

    try {
        const kickoffDate = new Date(utcKickoff);
        const day = kickoffDate.getDate(); 
        const month = kickoffDate.getMonth() + 1; 
        const year = kickoffDate.getFullYear();

        const path = `/api/ice-hockey/matches/${day}/${month}/${year}`;
        const url = `https://${ICEHOCKEYAPI_HOST}${path}`;

        console.log(`[IceHockeyApiProvider v2.1] Meccslista lekérése (Dátum: ${day}/${month}/${year})...`);

        // @ts-ignore
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': ICEHOCKEYAPI_KEY,
                'x-rapidapi-host': ICEHOCKEYAPI_HOST
            }
        });

        if (!response.ok) {
            throw new Error(`API hiba: ${response.status} ${response.statusText} (${url})`);
        }

        const data = (await response.json()) as any;
        const events = data?.events;

        if (!events || !Array.isArray(events) || events.length === 0) {
            console.warn(`[IceHockeyApiProvider v2.1] Az API nem adott vissza meccseket erre a napra: ${day}/${month}/${year}`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

        // --- AZ INTELLIGENS NÉVFELOLDÓ LOGIKA (JAVÍTVA v2.1) ---
        
        const resolvedHomeName = NHL_TEAM_NAME_MAP[homeTeamName.toLowerCase()] || homeTeamName;
        const resolvedAwayName = NHL_TEAM_NAME_MAP[awayTeamName.toLowerCase()] || awayTeamName;
        
        const inputHomeNorm = normalizeTeamName(resolvedHomeName);
        const inputAwayNorm = normalizeTeamName(resolvedAwayName);

        let bestMatch = { event: null as any, bestScore: 0, isReversed: false };
        const similarityThreshold = 0.55; 

        for (const event of events) {
            const apiHomeName = normalizeTeamName(event.homeTeam?.name);
            const apiAwayName = normalizeTeamName(event.awayTeam?.name);

            if (!apiHomeName || !apiAwayName) continue; 

            const homeScore = compareStrings(inputHomeNorm, apiHomeName);
            const awayScore = compareStrings(inputAwayNorm, apiAwayName);
            const combinedScore = (homeScore + awayScore) / 2.0;

            const revHomeScore = compareStrings(inputHomeNorm, apiAwayName);
            const revAwayScore = compareStrings(inputAwayNorm, apiHomeName);
            const reversedScore = (revHomeScore + revAwayScore) / 2.0;
            
            if (combinedScore > bestMatch.bestScore && combinedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: combinedScore, isReversed: false };
            }
            if (reversedScore > bestMatch.bestScore && reversedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: reversedScore, isReversed: true };
            }
        }
        // --- NÉVFELOLDÓ VÉGE ---

        if (bestMatch.event) {
            const matchedEvent = bestMatch.event;
            const matchId = matchedEvent.id;
            
            console.log(`[IceHockeyApiProvider v2.1] SIKERES NÉVFELOLDÁS (Score: ${bestMatch.bestScore.toFixed(2)})`);
            
            if (bestMatch.isReversed) {
                 console.warn(`  -> Figyelem: A bemeneti csapatok valószínűleg felcserélve! (A rendszer kezeli)`);
            }
            console.log(`  -> MECCS ID: ${matchId}`);
            
            // === JAVÍTÁS (v105.1): Odds adatok lekérése az "A-terv" szolgáltatótól ===
            // Ezt a hívást a meccs ID megtalálása *után* kell elvégezni.
            const fetchedOddsData = await getIceHockeyOdds(matchId);
            if (fetchedOddsData) {
                console.log(`[IceHockeyApiProvider v105.1] Sikeres odds lekérés az "A-terv" (iceHockeyApi) szolgáltatótól.`);
            } else {
                console.warn(`[IceHockeyApiProvider v105.1] Az "A-terv" (iceHockeyApi) nem adott vissza odds adatot. A DataFetch.ts B-terve (fallback) fog futni.`);
            }
            // === JAVÍTÁS VÉGE ===

            const homeRoster = matchedEvent.homeRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];
            const awayRoster = matchedEvent.awayRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];

            // Mock adatok (az 'ice-hockey-api' nem ad forma és statisztika adatokat a /matches végponton)
            const homeMockStats: ICanonicalStats = {
                gp: matchedEvent.homeTeamSeasonHistoricalForm?.wins + matchedEvent.homeTeamSeasonHistoricalForm?.losses || 1,
                gf: (matchedEvent.homeTeamSeasonHistoricalForm?.wins || 0) * 3, // Durva becslés
                ga: (matchedEvent.homeTeamSeasonHistoricalForm?.losses || 0) * 3, // Durva becslés
                form: null // Az API nem ad 'form' stringet
            };
            const awayMockStats: ICanonicalStats = {
                gp: matchedEvent.awayTeamSeasonHistoricalForm?.wins + matchedEvent.awayTeamSeasonHistoricalForm?.losses || 1,
                gf: (matchedEvent.awayTeamSeasonHistoricalForm?.wins || 0) * 3,
                ga: (matchedEvent.awayTeamSeasonHistoricalForm?.losses || 0) * 3,
                form: null
            };


            const successfulRawData: ICanonicalRawData = {
                stats: { home: homeMockStats, away: awayMockStats },
                apiFootballData: { homeTeamId: matchedEvent.homeTeam?.id, awayTeamId: matchedEvent.awayTeam?.id, leagueId: matchedEvent.tournament?.id, fixtureId: matchId, fixtureDate: matchedEvent.startTimestamp, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
                h2h_structured: [],
                form: { home_overall: null, away_overall: null },
                detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
                absentees: { home: [], away: [] },
                referee: { name: "N/A", style: null },
                contextual_factors: { stadium_location: matchedEvent.venue?.name || "N/A", structured_weather: emptyHockeyWeather, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
                availableRosters: {
                    home: homeRoster,
                    away: awayRoster
                }
            };
            
            const result: ICanonicalRichContext = {
                rawStats: successfulRawData.stats,
                leagueAverages: {},
                richContext: `Sikeres adatgyűjtés (v2.1) ${matchId} ID-val.`,
                advancedData: { home: { xg: null }, away: { xg: null } },
                form: successfulRawData.form,
                rawData: successfulRawData,
                // === JAVÍTÁS (v105.1): 'null' cserélve 'fetchedOddsData'-ra ===
                oddsData: fetchedOddsData,
                // === JAVÍTÁS VÉGE ===
                fromCache: false,
                availableRosters: successfulRawData.availableRosters
            };

            return {
                ...result,
                xgSource: "N/A (iceHockeyApi)"
            };

        } else {
            console.error(`[IceHockeyApiProvider v2.1] KRITIKUS HIBA: A névfeloldás sikertelen. Egyik meccs sem érte el a ${similarityThreshold} küszöböt.`);
            console.error(`  -> Keresett nevek (feloldás után): '${inputHomeNorm}' vs '${inputAwayNorm}'`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

    } catch (error: any) {
        console.error(`[IceHockeyApiProvider v2.1] Váratlan hiba a fetchMatchData során: ${error.message}`, error.stack);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
}
