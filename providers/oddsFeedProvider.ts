// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.1 (TS18048 Fix)
// CÉL: Az 'Odds Feed' API-t (RapidAPI) hívja.
// JAVÍTÁS: Null/undefined ellenőrzés hozzáadva az 'events' tömbhöz
//          a 'findEventId' függvényben (TS18048).

import { makeRequest } from './common/utils.js';
import { ODDS_API_HOST, ODDS_API_KEY } from '../config.js';
import NodeCache from 'node-cache';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

const oddsApiCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 }); // 10p TTL

// Központi hívó függvény (Odds Feed)
async function makeOddsFeedRequest(endpoint: string, params: any = {}) {
// ... (függvény törzse változatlan)
    if (!ODDS_API_HOST || !ODDS_API_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ODDS_API_HOST vagy ODDS_API_KEY a .env fájlban.`);
    }
    
    const url = `https://${ODDS_API_HOST}/${endpoint}`;
    const fullConfig = {
        params: params,
        headers: {
            'x-rapidapi-host': ODDS_API_HOST,
            'x-rapidapi-key': ODDS_API_KEY
        }
    };

    try {
        const response = await makeRequest(url, fullConfig, 0); 
        return response.data; 
    } catch (error: any) {
        console.error(`[OddsFeedProvider] Hiba: ${error.message}. Endpoint: ${endpoint}`);
        throw error;
    }
}

// Az Odds Feed API sportág-specifikus nevei
const SPORT_KEY_MAP: { [key: string]: string } = {
    soccer: 'soccer_epl', // Példa, ezt finomítani kell
    hockey: 'icehockey_nhl',
    basketball: 'basketball_nba'
};

/**
 * Lekéri az eseményeket egy adott napra, hogy megtalálja a meccs ID-t
 */
async function findEventId(
    homeTeamName: string, 
    awayTeamName: string, 
    matchDate: string, 
    sport: string
): Promise<string | null> {
    
    const sportKey = SPORT_KEY_MAP[sport];
// ... (függvény törzse változatlan)
    if (!sportKey) {
        console.warn(`[OddsFeedProvider] Nem támogatott sportág: ${sport}`);
        return null;
    }

    const cacheKey = `oddsfeed_event_${sportKey}_${matchDate}`;
    let events = oddsApiCache.get<any[]>(cacheKey);

    if (!events) {
        console.log(`[OddsFeedProvider] Események lekérése: ${sportKey}, Dátum: ${matchDate}`);
        const response = await makeOddsFeedRequest(`sports/${sportKey}/events/date/${matchDate}`);
        if (!response || !Array.isArray(response.events) || response.events.length === 0) {
            console.warn(`[OddsFeedProvider] Nem található esemény a(z) ${matchDate} napon.`);
            return null;
        }
        events = response.events;
        oddsApiCache.set(cacheKey, events);
    } else {
        console.log(`[OddsFeedProvider] Események a cache-ből (Events: ${events?.length})`);
    }

    // === JAVÍTÁS (v1.1 - TS18048) ===
    // Ha az 'events' tömb a cache-ből vagy az API-ból továbbra is hiányzik,
    // biztonságosan lépjünk ki, mielőtt a .find() metódust hívnánk.
    if (!events || !Array.isArray(events)) {
        console.warn(`[OddsFeedProvider] Az 'events' tömb érvénytelen vagy üres a findEventId futása során.`);
        return null;
    }
    // === JAVÍTÁS VÉGE ===

    // Csapatnevek normalizálása
    const searchHome = homeTeamName.toLowerCase();
    const searchAway = awayTeamName.toLowerCase();

    // Megkeressük a meccset a válaszban (Ez a sor most már biztonságos)
    const foundEvent = events.find((e: any) => {
        const eventName = (e.description || e.name || "").toLowerCase();
        return eventName.includes(searchHome) && eventName.includes(searchAway);
    });

    if (foundEvent && foundEvent.id) {
// ... (függvény törzse változatlan)
        console.log(`[OddsFeedProvider] Esemény TALÁLAT: ${foundEvent.description} (EventID: ${foundEvent.id})`);
        return foundEvent.id;
    }

    console.warn(`[OddsFeedProvider] Nem található esemény ehhez: "${searchHome}" vs "${searchAway}"`);
    return null;
}

/**
 * FŐ EXPORTÁLT FÜGGVVÉNY (Csak Odds-t ad vissza)
 */
export async function fetchOddsData(
    homeTeamName: string, 
    awayTeamName: string, 
    matchDateISO: string, 
    sport: string
): Promise<ICanonicalOdds | null> {
// ... (függvény törzse változatlan)
    
    const matchDate = new Date(matchDateISO).toISOString().split('T')[0];

    try {
        const eventId = await findEventId(homeTeamName, awayTeamName, matchDate, sport);
// ... (függvény törzse változatlan)
        if (!eventId) {
            console.warn(`[OddsFeedProvider] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        const cacheKey = `oddsfeed_odds_v1_${eventId}`;
// ... (függvény törzse változatlan)
        const cached = oddsApiCache.get<ICanonicalOdds>(cacheKey);
        if (cached) {
            console.log(`[OddsFeedProvider] Odds cache találat (EventID: ${eventId})`);
            return { ...cached, fromCache: true };
        }

        console.log(`[OddsFeedProvider] Odds lekérése... (EventID: ${eventId})`);
// ... (függvény törzse változatlan)
        const oddsResponse = await makeOddsFeedRequest(`events/${eventId}/odds`);
        
        if (!oddsResponse || !Array.isArray(oddsResponse.sports) || !oddsResponse.sports[0]) {
// ... (függvény törzse változatlan)
            console.warn(`[OddsFeedProvider] Az API nem adott vissza odds adatot (EventID: ${eventId})`);
            return null;
        }

        const bookmakers = oddsResponse.sports[0].bookmakers;
// ... (függvény törzse változatlan)
        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const currentOdds: ICanonicalOdds['current'] = [];

        const primaryBookmaker = bookmakers.find((b: any) => b.key === "pinnacle") || bookmakers[0];
// ... (függvény törzse változatlan)
        if (!primaryBookmaker) {
            console.warn(`[OddsFeedProvider] Nem található bukméker az adatokban.`);
            return null;
        }

        console.log(`[OddsFeedProvider] Odds adatok feldolgozása (${primaryBookmaker.key} bukméker alapján)...`);

        const markets = primaryBookmaker.markets || [];
        
        // Moneyline (H2H)
// ... (függvény törzse változatlan)
        const moneylineMarket = markets.find((m: any) => m.key === "h2h");
        if (moneylineMarket && Array.isArray(moneylineMarket.outcomes)) {
            const homeOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase() === homeTeamName.toLowerCase());
// ... (függvény törzse változatlan)
            const awayOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase() === awayTeamName.toLowerCase());
            
            if (homeOutcome) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOutcome.price) });
// ... (függvény törzse változatlan)
            if (awayOutcome) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOutcome.price) });
            
            allMarkets.push({
// ... (függvény törzse változatlan)
                key: 'h2h',
                outcomes: moneylineMarket.outcomes.map((o: any) => ({
                    name: o.name,
                    price: parseFloat(o.price)
                }))
            });
        }

        // Totals (Over/Under)
// ... (függvény törzse változatlan)
        const totalsMarket = markets.find((m: any) => m.key === "totals");
        if (totalsMarket && Array.isArray(totalsMarket.outcomes)) {
             allMarkets.push({
// ... (függvény törzse változatlan)
                key: 'totals',
                outcomes: totalsMarket.outcomes.map((o: any) => ({
                    name: o.name, // "Over" vagy "Under"
                    price: parseFloat(o.price),
                    point: parseFloat(o.point)
                }))
            });
        }
        
        // Spreads (Handicap)
// ... (függvény törzse változatlan)
        const spreadsMarket = markets.find((m: any) => m.key === "spreads");
         if (spreadsMarket && Array.isArray(spreadsMarket.outcomes)) {
             allMarkets.push({
// ... (függvény törzse változatlan)
                key: 'spreads',
                outcomes: spreadsMarket.outcomes.map((o: any) => ({
                    name: o.name,
                    price: parseFloat(o.price),
                    point: parseFloat(o.point)
                }))
            });
        }

        const result: ICanonicalOdds = {
// ... (függvény törzse változatlan)
            current: currentOdds,
            allMarkets: allMarkets,
            fullApiData: oddsResponse,
            fromCache: false
        };

        if (result.current.length > 0) {
// ... (függvény törzse változatlan)
            oddsApiCache.set(cacheKey, result);
        } else {
             console.warn(`[OddsFeedProvider] Nem sikerült Moneyline (h2h) piacot találni.`);
        }

        return result;

    } catch (e: any) {
// ... (függvény törzse változatlan)
        console.error(`[OddsFeedProvider] KRITIKUS HIBA a fetchOddsData során: ${e.message}`, e.stack);
        return null; // Hibatűrés
    }
}
