// FÁJL: providers/oddsFeedProvider_v1.5.ts
// VERZIÓ: v1.5 (Végleges javítás a RapidAPI képernyőfotó alapján)
//
// JAVÍTÁS (v1.5): A felhasználó által biztosított képernyőfotó felfedte a
// kritikus hibát:
// 1. Minden hívásnak az '/api/v1/' prefixet kell használnia.
// 2. A helyes végpont az események listázásához a 'GET /events/list'.
// 3. A helyes végpont az odds-ok lekéréséhez a 'GET /events/markets'.
//
// Ez a verzió visszatér a kétlépcsős (findEventId -> fetchOdds) logikához,
// de már a HELYES végpontokkal és a HELYES alap útvonallal.

import { makeRequest } from './common/utils.js';
import { ODDS_API_HOST, ODDS_API_KEY } from '../config.js';
import NodeCache from 'node-cache';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

const oddsApiCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 }); // 10p TTL

// === JAVÍTÁS (v1.5): Helyes API alap útvonal ===
const API_BASE_PATH = '/api/v1';
// ============================================

// Központi hívó függvény (Odds Feed)
async function makeOddsFeedRequest(endpoint: string, params: any = {}) {
    if (!ODDS_API_HOST || !ODDS_API_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ODDS_API_HOST vagy ODDS_API_KEY.`);
    }
    
    // === JAVÍTÁS (v1.5): Az API_BASE_PATH használata ===
    const url = `https://${ODDS_API_HOST}${API_BASE_PATH}/${endpoint}`;
    // ============================================
    
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
        console.error(`[OddsFeedProvider] Hiba: ${error.message}. URL: ${url}, Params: ${JSON.stringify(params)}`);
        throw error;
    }
}

// Az Odds Feed API sportág-specifikus nevei
const SPORT_KEY_MAP: { [key: string]: string } = {
    soccer: 'soccer_epl',
    hockey: 'icehockey_nhl',
    basketball: 'basketball_nba'
};

// === JAVÍTÁS (v1.5): 'findEventId' függvény visszaállítva és javítva ===
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

    const cacheKey = `oddsfeed_eventlist_v1.5_${sportKey}_${matchDate}`;
    let events = oddsApiCache.get<any[]>(cacheKey);

    if (!events) {
        console.log(`[OddsFeedProvider v1.5] Események lekérése (Endpoint: events/list): ${sportKey}, Dátum: ${matchDate}`);
        
        try {
            // A képernyőfotó alapján a helyes végpont: 'events/list'
            const response = await makeOddsFeedRequest('events/list', {
                sport: sportKey,
                date: matchDate
            });

            if (!response || !Array.isArray(response.events) || response.events.length === 0) {
                console.warn(`[OddsFeedProvider v1.5] Nem található esemény (sport: ${sportKey}, date: ${matchDate}) a 'events/list' végponton.`);
                return null;
            }
            events = response.events;
            oddsApiCache.set(cacheKey, events, 3600); // 1 óra cache
        } catch (e: any) {
            console.error(`[OddsFeedProvider v1.5] Hiba a 'events/list' hívásakor: ${e.message}`);
            return null;
        }
    } else {
        console.log(`[OddsFeedProvider v1.5] Események a cache-ből (Events: ${events?.length})`);
    }

    if (!events) return null;

    // Csapatnevek normalizálása
    const searchHome = homeTeamName.toLowerCase().trim();
    const searchAway = awayTeamName.toLowerCase().trim();

    // Keressük a meccset a válaszban a nevek alapján
    const foundEvent = events.find((e: any) => {
        const apiHome = (e.home_team || "").toLowerCase().trim();
        const apiAway = (e.away_team || "").toLowerCase().trim();
        return apiHome.includes(searchHome) && apiAway.includes(searchAway);
    });

    if (foundEvent && foundEvent.id) {
        console.log(`[OddsFeedProvider v1.5] Esemény TALÁLAT: ${foundEvent.home_team} vs ${foundEvent.away_team} (EventID: ${foundEvent.id})`);
        return foundEvent.id;
    }

    console.warn(`[OddsFeedProvider v1.5] Nem található esemény ehhez: "${searchHome}" vs "${searchAway}" az 'events/list' válaszban.`);
    return null;
}
// === JAVÍTÁS VÉGE ===


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
        // 1. LÉPÉS: EventID keresése a 'events/list' végponttal
        const eventId = await findEventId(homeTeamName, awayTeamName, matchDate, sport);
        if (!eventId) {
            console.warn(`[OddsFeedProvider v1.5] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        // 2. LÉPÉS: Odds-ok lekérése az 'events/markets' végponttal
        const cacheKey = `oddsfeed_markets_v1.5_${eventId}`;
        let oddsResponse = oddsApiCache.get<any>(cacheKey);

        if (!oddsResponse) {
            console.log(`[OddsFeedProvider v1.5] Odds/Piacok lekérése (Endpoint: events/markets)... (EventID: ${eventId})`);
            
            // A képernyőfotó alapján a helyes végpont: 'events/markets'
            oddsResponse = await makeOddsFeedRequest('events/markets', {
                event_id: eventId,
                markets: 'h2h,totals,spreads' // Kérjük a fő piacokat
            });
            
            if (!oddsResponse || !Array.isArray(oddsResponse.bookmakers) || oddsResponse.bookmakers.length === 0) {
                console.warn(`[OddsFeedProvider v1.5] Az API nem adott vissza bukméker adatot az 'events/markets' végponton (EventID: ${eventId})`);
                return null;
            }
            oddsApiCache.set(cacheKey, oddsResponse, 60 * 10); // 10p cache
        } else {
            console.log(`[OddsFeedProvider v1.5] Piacok a cache-ből (EventID: ${eventId})`);
        }
        
        // 3. LÉPÉS: Dolgozzuk fel a kapott odds-okat
        const bookmakers = oddsResponse.bookmakers;
        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const currentOdds: ICanonicalOdds['current'] = [];

        const primaryBookmaker = bookmakers.find((b: any) => b.key === "pinnacle") || bookmakers[0];
        if (!primaryBookmaker) {
            console.warn(`[OddsFeedProvider v1.5] Nem található bukméker az adatokban.`);
            return null;
        }

        console.log(`[OddsFeedProvider v1.5] Odds adatok feldolgozása (${primaryBookmaker.key} bukméker alapján)...`);
        const markets = primaryBookmaker.markets || [];
        
        // Moneyline (H2H)
        const moneylineMarket = markets.find((m: any) => m.key === "h2h");
        if (moneylineMarket && Array.isArray(moneylineMarket.outcomes)) {
            const searchHome = homeTeamName.toLowerCase().trim();
            const searchAway = awayTeamName.toLowerCase().trim();
            
            const homeOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase().includes(searchHome));
            const awayOutcome = moneylineMarket.outcomes.find((o: any) => o.name.toLowerCase().includes(searchAway));
            
            if (homeOutcome) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOutcome.price) });
            if (awayOutcome) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOutcome.price) });
            
            allMarkets.push({
                key: 'h2h',
                outcomes: moneylineMarket.outcomes.map((o: any) => ({ name: o.name, price: parseFloat(o.price) }))
            });
        }

        // Totals (Over/Under)
        const totalsMarket = markets.find((m: any) => m.key === "totals");
        if (totalsMarket && Array.isArray(totalsMarket.outcomes)) {
             allMarkets.push({
                key: 'totals',
                outcomes: totalsMarket.outcomes.map((o: any) => ({
                    name: o.name, price: parseFloat(o.price), point: parseFloat(o.point)
                }))
            });
        }
        
        // Spreads (Handicap)
        const spreadsMarket = markets.find((m: any) => m.key === "spreads");
         if (spreadsMarket && Array.isArray(spreadsMarket.outcomes)) {
             allMarkets.push({
                key: 'spreads',
                outcomes: spreadsMarket.outcomes.map((o: any) => ({
                    name: o.name, price: parseFloat(o.price), point: parseFloat(o.point)
                }))
            });
        }

        const result: ICanonicalOdds = {
            current: currentOdds,
            allMarkets: allMarkets,
            fullApiData: oddsResponse,
            fromCache: false
        };

        if (result.current.length === 0) {
             console.warn(`[OddsFeedProvider v1.5] Nem sikerült Moneyline (h2h) piacot találni.`);
        }

        return result;

    } catch (e: any) {
        console.error(`[OddsFeedProvider] KRITIKUS HIBA a fetchOddsData során (v1.5): ${e.message}`, e.stack);
        return null;
    }
}
