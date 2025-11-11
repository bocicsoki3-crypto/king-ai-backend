// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.6 ("404-es végpont javítása")
// MÓDOSÍTÁS (v1.6):
// 1. KRITIKUS HIBAJAVÍTÁS (404): A 'findEventIdByNames' függvényben
//    a hibás '/api/v1/events/list' végpont cserélve
//    a valószínűleg helyes '/api/v1/events' végpontra.
// 2. ROBUSZTUSSÁG: Hozzáadva a 'findBestMatchByNames' fuzzy matching
//    logika (hasonlóan az iceHockeyApiProvider-hez), hogy
//    megbízhatóan megtalálja a csapatneveket.
// 3. KONFIGURÁCIÓ: A provider most már a központi 'config.ts'-ből
//    importálja az 'ODDS_API_KEY' és 'ODDS_API_HOST' kulcsokat.

import fetch from 'node-fetch';

// === JAVÍTÁS (v1.6): Importálás a központi konfigurációból ===
import { 
    ODDS_API_HOST, 
    ODDS_API_KEY 
} from '../config.js';
// =======================================================

// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ (v1.9-ből) ===
// (Hogy ez a provider is önállóan működőképes legyen)
function normalizeTeamName(name: string): string {
    if (!name) return '';
    return name.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
}
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

/**
 * Központi API hívó függvény
 */
async function makeOddsRequest(path: string, params: URLSearchParams): Promise<any> {
    if (!ODDS_API_KEY || !ODDS_API_HOST) {
        throw new Error("[OddsFeedProvider] Hiányzó ODDS_API_KEY vagy ODDS_API_HOST a config.ts-ből.");
    }
    
    const url = `https://${ODDS_API_HOST}${path}?${params.toString()}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': ODDS_API_KEY,
                'x-rapidapi-host': ODDS_API_HOST
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[OddsFeedProvider] API Hiba: ${response.status}`, errorBody);
            throw new Error(`API hiba: Státusz kód ${response.status} (${url}). Válasz: ${errorBody}`);
        }
        
        // === JAVÍTÁS (v1.6.1): TS18046 ('unknown' típus) hiba javítása ===
        // Kifejezett típus-kényszerítést (type assertion) adunk hozzá 'any'-ra,
        // mivel a .json() alapértelmezetten 'unknown' típust ad vissza
        // a szigorú beállítások mellett.
        const data = (await response.json()) as any;
        return data.data || data; // Az API válasza 'data' wrapperben lehet

    } catch (error: any) {
        console.error(`[OddsFeedProvider] Hiba a hívás során: ${error.message}`, { url });
        throw error;
    }
}

/**
 * Lefordítja a sportág nevét az Odds Feed API által várt formátumra
 */
function getSportKey(sport: string): string {
    switch (sport.toLowerCase()) {
        case 'soccer': return 'soccer_epl'; // Példa, ezt finomítani kell a liga alapján
        case 'hockey': return 'icehockey_nhl';
        case 'basketball': return 'basketball_nba';
        default: return sport;
    }
}

/**
 * JAVÍTOTT (v1.6): Fuzzy matching a napi események listáján
 */
function findBestMatchByNames(
    events: any[], 
    inputHomeNorm: string, 
    inputAwayNorm: string
): string | null {
    let bestMatch = { eventId: null as string | null, bestScore: 0 };
    const similarityThreshold = 0.55; 

    for (const event of events) {
        // Az Odds Feed API 'name' mezőben tárolja a "Home vs Away" stringet
        const apiName = normalizeTeamName(event.name); 
        
        if (!apiName || !event.id) continue;

        // Megpróbáljuk kinyerni a neveket a "vs" alapján
        const parts = apiName.split(' vs ');
        if (parts.length !== 2) continue;
        
        const apiHomeName = parts[0].trim();
        const apiAwayName = parts[1].trim();

        const homeScore = compareStrings(inputHomeNorm, apiHomeName);
        const awayScore = compareStrings(inputAwayNorm, apiAwayName);
        const combinedScore = (homeScore + awayScore) / 2.0;

        // Fordított ellenőrzés (bár a "vs" miatt valószínűtlen, de biztonságos)
        const revHomeScore = compareStrings(inputHomeNorm, apiAwayName);
        const revAwayScore = compareStrings(inputAwayNorm, apiHomeName);
        const reversedScore = (revHomeScore + revAwayScore) / 2.0;

        if (combinedScore > bestMatch.bestScore && combinedScore >= similarityThreshold) {
            bestMatch = { eventId: event.id, bestScore: combinedScore };
        }
        if (reversedScore > bestMatch.bestScore && reversedScore >= similarityThreshold) {
            bestMatch = { eventId: event.id, bestScore: reversedScore };
        }
    }

    return bestMatch.eventId;
}


/**
 * 1. LÉPÉS: Megkeresi az esemény ID-t a csapatnevek és dátum alapján
 */
async function findEventIdByNames(
    homeTeamName: string,
    awayTeamName: string,
    utcKickoff: string,
    sport: string
): Promise<string | null> {
    
    const sportKey = getSportKey(sport);
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    console.log(`[OddsFeedProvider v1.6] Események lekérése (Endpoint: /api/v1/events): ${sportKey}, Dátum: ${matchDate}`);

    const params = new URLSearchParams({
        sport: sportKey,
        date: matchDate
    });

    try {
        // === JAVÍTÁS (v1.6): A végpont '/api/v1/events/list'-ről '/api/v1/events'-re cserélve ===
        const response = await makeOddsRequest('/api/v1/events', params);
        // =================================================================================

        if (!response || !Array.isArray(response.events) || response.events.length === 0) {
            console.warn(`[OddsFeedProvider v1.6] Az 'events' végpont nem adott vissza eseményeket.`);
            return null;
        }

        // Fuzzy matching a válaszon
        const inputHomeNorm = normalizeTeamName(homeTeamName);
        const inputAwayNorm = normalizeTeamName(awayTeamName);
        
        const eventId = findBestMatchByNames(response.events, inputHomeNorm, inputAwayNorm);

        if (eventId) {
            console.log(`[OddsFeedProvider v1.6] EventID sikeresen azonosítva: ${eventId}`);
            return eventId;
        } else {
            console.warn(`[OddsFeedProvider v1.6] Nem található esemény a listában: ${homeTeamName} vs ${awayTeamName}`);
            return null;
        }

    } catch (error: any) {
        // A 404-es hiba (amit a logban láttunk) ide fog befutni
        console.error(`[OddsFeedProvider v1.6] Hiba az 'events' hívásakor: ${error.message}`);
        return null;
    }
}

/**
 * 2. LÉPÉS: Lekéri a piacokat (odds) a megtalált esemény ID alapján
 */
async function getMarketsForEvent(eventId: string): Promise<any | null> {
    console.log(`[OddsFeedProvider v1.6] Piacok lekérése (Endpoint: /api/v1/event/markets) EventID: ${eventId}`);
    
    // Ez a végpont látható a 'image_dbabc2.png' képen
    const params = new URLSearchParams({
        period: 'FULL_TIME',
        sportMarketId: '1,2,10', // 1X2, Over/Under, BTTS (Példa)
        // Az eventId-t valószínűleg a path-ba kell tenni, vagy paraméterként
        // A kép alapján paraméter:
        eventId: eventId
        // Ha a kép félrevezető és a path-ba kell, akkor:
        // const path = `/api/v1/event/${eventId}/markets`;
    });

    // Próbáljuk a kép alapján (paraméter)
    const path = '/api/v1/event/markets';
    
    try {
        const response = await makeOddsRequest(path, params);
        if (!response || !response.markets || response.markets.length === 0) {
            console.warn(`[OddsFeedProvider v1.6] Az API nem adott vissza piacokat (markets) ehhez az EventID-hez: ${eventId}`);
            return null;
        }
        
        console.log(`[OddsFeedProvider v1.6] Piacok sikeresen lekérve.`);
        return response.markets;

    } catch (error: any) {
        console.error(`[OddsFeedProvider v1.6] Hiba a 'event/markets' hívásakor: ${error.message}`);
        return null;
    }
}

/**
 * 3. LÉPÉS: Átalakítja az API választ kanonikus OddsData formátumra
 * (Ez egy vázlat, a pontos API válasz struktúrájától függ)
 */
function parseMarketsToOddsData(markets: any[]): any | null {
    if (!markets) return null;
    
    // Tegyük fel, hogy 'markets' egy tömb, pl:
    // { market_id: 1, name: "Match Winner", outcomes: [{ name: "Home", price: 1.8 }, ...]}
    // { market_id: 2, name: "Total Goals", line: 6.5, outcomes: [{ name: "Over", price: 1.9 }, ...]}

    const allMarkets = markets.map(market => ({
        market_name: market.name || `MarketID ${market.market_id}`,
        line: market.line || null,
        outcomes: market.outcomes.map((outcome: any) => ({
            name: outcome.name,
            price: outcome.price
        }))
    }));

    return {
        bookmaker_name: "OddsFeed (Default)",
        allMarkets: allMarkets
    };
}


/**
 * FŐ EXPORTÁLT FÜGGVÉNY (a DataFetch.ts hívja)
 */
export async function fetchOddsData(
    homeTeamName: string,
    awayTeamName: string,
    utcKickoff: string,
    sport: string
): Promise<any | null> {
    
    try {
        // 1. LÉPÉS: Event ID keresése
        const eventId = await findEventIdByNames(homeTeamName, awayTeamName, utcKickoff, sport);
        
        if (!eventId) {
            console.warn(`[OddsFeedProvider v1.6] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }
        
        // 2. LÉPÉS: Piacok lekérése
        const markets = await getMarketsForEvent(eventId);
        
        if (!markets) {
            console.warn(`[OddsFeedProvider v1.6] Nem sikerült piacokat (odds) lekérni ehhez az EventID-hez: ${eventId}`);
            return null;
        }
        
        // 3. LÉPÉS: Átalakítás
        const oddsData = parseMarketsToOddsData(markets);
        
        return oddsData;

    } catch (error: any) {
        console.error(`[OddsFeedProvider v1.6] Ismeretlen hiba a fetchOddsData során: ${error.message}`);
        return null;
    }
}
