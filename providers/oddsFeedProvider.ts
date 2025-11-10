// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.0
// CÉL: Az 'Odds Feed' API-t (RapidAPI) hívja, hogy lekérje a
//       megbízható odds adatokat. Ez az "Aggregátor" modell egyik fele.

import { makeRequest } from './common/utils.js';
import { ODDS_API_HOST, ODDS_API_KEY } from '../config.js';
import NodeCache from 'node-cache';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

const oddsApiCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 }); // 10p TTL

// Központi hívó függvény (Odds Feed)
async function makeOddsFeedRequest(endpoint: string, params: any = {}) {
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
        // A 'common/utils.js'-ből importált 'makeRequest' hívása
        const response = await makeRequest(url, fullConfig, 0); 
        return response.data; // Az Odds Feed API a 'data' kulcsban adja vissza a választ
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
        console.log(`[OddsFeedProvider] Események a cache-ből (Events: ${events.length})`);
    }

    // Csapatnevek normalizálása
    const searchHome = homeTeamName.toLowerCase();
    const searchAway = awayTeamName.toLowerCase();

    // Megkeressük a meccset a válaszban
    // Az Odds Feed API 'description'-t vagy 'name'-t használ a meccs nevére
    const foundEvent = events.find((e: any) => {
        const eventName = (e.description || e.name || "").toLowerCase();
        return eventName.includes(searchHome) && eventName.includes(searchAway);
    });

    if (foundEvent && foundEvent.id) {
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
    
    const matchDate = new Date(matchDateISO).toISOString().split('T')[0];

    try {
        const eventId = await findEventId(homeTeamName, awayTeamName, matchDate, sport);
        if (!eventId) {
            console.warn(`[OddsFeedProvider] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        const cacheKey = `oddsfeed_odds_v1_${eventId}`;
        const cached = oddsApiCache.get<ICanonicalOdds>(cacheKey);
        if (cached) {
            console.log(`[OddsFeedProvider] Odds cache találat (EventID: ${eventId})`);
            return { ...cached, fromCache: true };
        }

        console.log(`[OddsFeedProvider] Odds lekérése... (EventID: ${eventId})`);
        const oddsResponse = await makeOddsFeedRequest(`events/${eventId}/odds`);
        
        if (!oddsResponse || !Array.isArray(oddsResponse.sports) || !oddsResponse.sports[0]) {
            console.warn(`[OddsFeedProvider] Az API nem adott vissza odds adatot (EventID: ${eventId})`);
            return null;
        }

        // Az Odds Feed API mélyen beágyazza az adatokat
        const bookmakers = oddsResponse.sports[0].bookmakers;
        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const currentOdds: ICanonicalOdds['current'] = [];

        // Itt feltételezzük, hogy az első elérhető bukméker (pl. Pinnacle) adatait használjuk
        const primaryBookmaker = bookmakers.find((b: any) => b.key === "pinnacle") || bookmakers[0];
        if (!primaryBookmaker) {
            console.warn(`[OddsFeedProvider] Nem található bukméker az adatokban.`);
            return null;
        }

        console.log(`[OddsFeedProvider] Odds adatok feldolgozása (${primaryBookmaker.key} bukméker alapján)...`);

        const markets = primaryBookmaker.markets || [];
        
        // Moneyline (H2H)
        const moneylineMarket = markets.find((m: any) => m.key === "h2h");
        if (moneylineMarket && Array.isArray(moneylineMarket.outcomes)) {
            const homeOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase() === homeTeamName.toLowerCase());
            const awayOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase() === awayTeamName.toLowerCase());
            
            if (homeOutcome) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOutcome.price) });
            if (awayOutcome) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOutcome.price) });
            
            allMarkets.push({
                key: 'h2h',
                outcomes: moneylineMarket.outcomes.map((o: any) => ({
                    name: o.name,
                    price: parseFloat(o.price)
                }))
            });
        }

        // Totals (Over/Under)
        const totalsMarket = markets.find((m: any) => m.key === "totals");
        if (totalsMarket && Array.isArray(totalsMarket.outcomes)) {
             allMarkets.push({
                key: 'totals',
                outcomes: totalsMarket.outcomes.map((o: any) => ({
                    name: o.name, // "Over" vagy "Under"
                    price: parseFloat(o.price),
                    point: parseFloat(o.point)
                }))
            });
        }
        
        // Spreads (Handicap)
        const spreadsMarket = markets.find((m: any) => m.key === "spreads");
         if (spreadsMarket && Array.isArray(spreadsMarket.outcomes)) {
             allMarkets.push({
                key: 'spreads',
                outcomes: spreadsMarket.outcomes.map((o: any) => ({
                    name: o.name,
                    price: parseFloat(o.price),
                    point: parseFloat(o.point)
                }))
            });
        }

        const result: ICanonicalOdds = {
            current: currentOdds,
            allMarkets: allMarkets,
            fullApiData: oddsResponse,
            fromCache: false
        };

        if (result.current.length > 0) {
            oddsApiCache.set(cacheKey, result);
        } else {
             console.warn(`[OddsFeedProvider] Nem sikerült Moneyline (h2h) piacot találni.`);
        }

        return result;

    } catch (e: any) {
        console.error(`[OddsFeedProvider] KRITIKUS HIBA a fetchOddsData során: ${e.message}`, e.stack);
        return null; // Hibatűrés
    }
}
