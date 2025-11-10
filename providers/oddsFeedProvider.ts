// FÁJL: providers/oddsFeedProvider_v1.4.ts
// VERZIÓ: v1.4 (Stratégiai váltás: 404-es hiba kerülése)
// JAVÍTÁS (v1.4): A Log napló (v1.3) bebizonyította, hogy az '/events'
// végpont HIBÁS (404).
//
// STRATÉGIAI VÁLTÁS: A 'findEventId' függvényt eltávolítottuk.
// A 'fetchOddsData' függvényt átírtuk. Közvetlenül a sportág 'odds'
// végpontját hívjuk ('/sports/{sportKey}/odds'), amely (remélhetőleg)
// visszaadja az összes aznapi meccs odds-át.
// A válaszban, a csapatnevek alapján keressük meg a kívánt eseményt.

import { makeRequest } from './common/utils.js';
import { ODDS_API_HOST, ODDS_API_KEY } from '../config.js';
import NodeCache from 'node-cache';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

const oddsApiCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 }); // 10p TTL

// Központi hívó függvény (Odds Feed)
async function makeOddsFeedRequest(endpoint: string, params: any = {}) {
    if (!ODDS_API_HOST || !ODDS_API_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó ODDS_API_HOST vagy ODDS_API_KEY.`);
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
        console.error(`[OddsFeedProvider] Hiba: ${error.message}. Endpoint: ${endpoint}, Params: ${JSON.stringify(params)}`);
        throw error;
    }
}

// Az Odds Feed API sportág-specifikus nevei
const SPORT_KEY_MAP: { [key: string]: string } = {
    soccer: 'soccer_epl',
    hockey: 'icehockey_nhl',
    basketball: 'basketball_nba'
};

// === JAVÍTÁS (v1.4): 'findEventId' eltávolítva ===

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
    const sportKey = SPORT_KEY_MAP[sport];
    if (!sportKey) {
        console.warn(`[OddsFeedProvider] Nem támogatott sportág: ${sport}`);
        return null;
    }

    // Csapatnevek normalizálása a kereséshez
    const searchHome = homeTeamName.toLowerCase().trim();
    const searchAway = awayTeamName.toLowerCase().trim();

    try {
        // === JAVÍTÁS (v1.4): Stratégia váltás ===
        // Nem keresünk EventID-t. Közvetlenül az odds-okat kérjük le
        // a sportágra és dátumra.
        
        const cacheKey = `oddsfeed_oddslist_v1.4_${sportKey}_${matchDate}`;
        let oddsResponse = oddsApiCache.get<any>(cacheKey);

        if (!oddsResponse) {
            console.log(`[OddsFeedProvider] Odds lista lekérése (Stratégia v1.4)... Sport: ${sportKey}, Dátum: ${matchDate}`);
            
            // Feltételezzük, hogy a helyes végpont a '/sports/{sportKey}/odds'
            // és a dátumot paraméterként kell átadni.
            oddsResponse = await makeOddsFeedRequest(`sports/${sportKey}/odds`, {
                date: matchDate,
                markets: 'h2h,totals,spreads' // Kérjük a fő piacokat
            });
            
            if (!oddsResponse || !Array.isArray(oddsResponse.events) || oddsResponse.events.length === 0) {
                console.warn(`[OddsFeedProvider] Az API nem adott vissza eseményeket (odds) (Sport: ${sportKey}, Dátum: ${matchDate})`);
                 // Lehetséges, hogy a 'sports/...' végpont sem jó.
                 // Végső próba: '/odds' végpont sport és dátum paraméterrel?
                 try {
                    console.log(`[OddsFeedProvider] Tartalék stratégia: '/odds' végpont hívása...`);
                    oddsResponse = await makeOddsFeedRequest(`odds`, {
                        sport: sportKey,
                        date: matchDate,
                        markets: 'h2h,totals,spreads'
                    });
                 } catch (e) {
                     console.error(`[OddsFeedProvider] A tartalék stratégia ('/odds') is hibát dobott.`, e.message);
                     return null;
                 }
                 
                 if (!oddsResponse || !Array.isArray(oddsResponse.events) || oddsResponse.events.length === 0) {
                     console.warn(`[OddsFeedProvider] Mindkét stratégia ('/sports/{sport}/odds' és '/odds') sikertelen.`);
                     return null;
                 }
            }
            oddsApiCache.set(cacheKey, oddsResponse, 60 * 10); // 10p cache
        } else {
             console.log(`[OddsFeedProvider] Odds lista a cache-ből (Events: ${oddsResponse.events?.length})`);
        }

        // 2. LÉPÉS: Keressük meg a meccset a válaszban a nevek alapján
        const foundEvent = oddsResponse.events.find((e: any) => {
            const apiHome = (e.home_team || "").toLowerCase().trim();
            const apiAway = (e.away_team || "").toLowerCase().trim();
            
            // Itt is 'includes'-t használunk a rugalmasságért
            return apiHome.includes(searchHome) && apiAway.includes(searchAway);
        });

        if (!foundEvent) {
            console.warn(`[OddsFeedProvider] Nem található esemény a(z) ${searchHome} vs ${searchAway} párosításhoz az odds listában.`);
            return null;
        }

        console.log(`[OddsFeedProvider] Odds esemény TALÁLAT: ${foundEvent.home_team} vs ${foundEvent.away_team} (EventID: ${foundEvent.id})`);

        // 3. LÉPÉS: Dolgozzuk fel a talált esemény odds-ait
        const bookmakers = foundEvent.bookmakers;
        if (!bookmakers || !Array.isArray(bookmakers) || bookmakers.length === 0) {
             console.warn(`[OddsFeedProvider] A talált esemény nem tartalmaz bukméker adatot.`);
             return null;
        }

        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const currentOdds: ICanonicalOdds['current'] = [];

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
            // A nevek (home/away) már megvannak, nem kell 'find'-ot használni
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
            fullApiData: oddsResponse, // A teljes napi választ mentjük
            fromCache: false // A 'fromCache' jelölőt a hívó DataFetch.ts kezeli
        };

        if (result.current.length === 0) {
             console.warn(`[OddsFeedProvider] Nem sikerült Moneyline (h2h) piacot találni.`);
        }

        return result;

    } catch (e: any) {
        console.error(`[OddsFeedProvider] KRITIKUS HIBA a fetchOddsData során (v1.4): ${e.message}`, e.stack);
        return null;
    }
}
