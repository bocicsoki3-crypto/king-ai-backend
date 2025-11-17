// FÁJL: providers/oddsProvider.ts
// VERZIÓ: v75.1 (Név-alapú Fallback Bővítés)
// MÓDOSÍTÁS (v75.1):
// 1. HOZZÁADVA: Új 'fetchOddsByName' funkció. Ez ugyanazt az API kulcsot
//    és 'makeOddsFeedRequest' hívót használja, mint a meglévő provider,
//    de a '/api/v1/events/search' végpontot hívja csapatnév alapján.
// 2. CÉL: Ez fog futni, ha a P4-es adatgyűjtés elbukik, és nincs 'fixtureId'.

import { makeRequest } from './common/utils.js';
import { ODDS_API_KEY, ODDS_API_HOST } from '../config.js';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';
import NodeCache from 'node-cache';
import axios from 'axios'; // Új import a 'fetchOddsByName' hívásához

// Ennek a providernek a saját, 10 perces gyorsítótára
const oddsFeedCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 });
// Új cache a név-alapú kereséshez
const oddsNameCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600 });


/**
 * 1. API Hívó (a v75.0 config alapján)
 * Egyedi hívó az "Odds Feed" API-hoz, a megfelelő headerekkel.
 */
async function makeOddsFeedRequest(endpoint: string, params: any) {
    if (!ODDS_API_KEY || !ODDS_API_HOST) {
        throw new Error("[OddsProvider] Hiba: ODDS_API_KEY vagy ODDS_API_HOST hiányzik a .env-ből.");
    }
    const config: any = {
        method: 'GET',
        url: `https://${ODDS_API_HOST}${endpoint}`,
        params: params,
        headers: {
            'X-RapidAPI-Key': ODDS_API_KEY,
            'X-RapidAPI-Host': ODDS_API_HOST
        }
    };
    
    // A központi 'makeRequest' hívása (providers/common/utils.ts)
    console.log(`[OddsProvider] Hívás indul: ${config.url} params: ${JSON.stringify(params)}`);
    // makeRequest helyett axios.get, hogy a 'makeRequest' kvóta logikáját kikerüljük
    // (a makeRequest az api-sports kulcsrotációhoz van kötve)
    const response = await axios.request(config);
    return response.data;
}

/**
 * 2. Adat-Transzformáló (A "Fordító")
 * Lefordítja az "Odds Feed" API válaszát a mi belső ICanonicalOdds formátumunkra.
 */
function parseOddsFeedResponse(apiResponse: any, fixtureIdOrName: number | string): ICanonicalOdds | null {
    
    // Az API válasza (mind a '/find', mind a '/search') 'markets' tömböt tartalmaz
    const rawMarkets = apiResponse?.markets;
    if (!rawMarkets || !Array.isArray(rawMarkets) || rawMarkets.length === 0) {
        console.warn(`[OddsProvider] Az 'Odds Feed' API nem adott vissza 'markets' tömböt a ${fixtureIdOrName} kereséshez.`);
        return null;
    }

    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    const current: ICanonicalOdds['current'] = []; // 1X2

    // 1X2 piac keresése (Moneyline/Match Winner)
    const h2hMarkets = rawMarkets.filter(m => 
        (m.market_name === '1X2' || m.market_name === 'Match Winner') && 
        m.status === 'OPEN'
    );
    const h2hMarket = h2hMarkets.find(m => m.bookmaker === 'Pinnacle') || h2hMarkets[0]; // Pinnacle priorizálása

    if (h2hMarket && h2hMarket.outcomes) {
        const h2hOutcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        h2hMarket.outcomes.forEach((o: any) => {
            const name = o.name; // Pl. "1", "X", "2"
            const price = parseFloat(o.odds);
            if (name && !isNaN(price)) {
                h2hOutcomes.push({ name, price });
                // Feltöltjük a 'current' tömböt is
                if (name === '1') current.push({ name: 'Hazai győzelem', price });
                if (name === 'X') current.push({ name: 'Döntetlen', price });
                if (name === '2') current.push({ name: 'Vendég győzelem', price });
            }
        });
        allMarkets.push({ key: 'h2h', outcomes: h2hOutcomes });
    }

    // Totals (Over/Under) piac keresése
    const totalsMarket = rawMarkets.find(m => m.market_name === 'Totals' && m.status === 'OPEN' && (m.bookmaker === 'Pinnacle' || !h2hMarket));
    if (totalsMarket && totalsMarket.outcomes) {
        const totalsOutcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        totalsMarket.outcomes.forEach((o: any) => {
            const name = o.name; // Pl. "Over 2.5", "Under 2.5"
            const price = parseFloat(o.odds);
            const pointMatch = name.match(/(\d+\.\d+)/); // Megkeresi a tizedes törtet
            const point = pointMatch ? parseFloat(pointMatch[1]) : null;
            
            if (name && !isNaN(price)) {
                totalsOutcomes.push({ name, price, point });
            }
        });
        allMarkets.push({ key: 'totals', outcomes: totalsOutcomes });
    }
    
    // BTTS (Both Teams To Score) piac keresése
    const bttsMarket = rawMarkets.find(m => m.market_name === 'Both Teams To Score' && m.status === 'OPEN' && (m.bookmaker === 'Pinnacle' || !h2hMarket));
    if (bttsMarket && bttsMarket.outcomes) {
        const bttsOutcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        bttsMarket.outcomes.forEach((o: any) => {
            const name = o.name; // Pl. "Yes", "No"
            const price = parseFloat(o.odds);
            if (name && !isNaN(price)) {
                bttsOutcomes.push({ name, price });
            }
        });
        allMarkets.push({ key: 'btts', outcomes: bttsOutcomes });
    }

    if (allMarkets.length === 0) {
        console.warn(`[OddsProvider] Az 'Odds Feed' API adott vissza adatot, de nem találtunk '1X2', 'Totals' vagy 'BTTS' piacokat (Keresés: ${fixtureIdOrName}).`);
        return null;
    }

    return {
        current: current,
        allMarkets: allMarkets,
        fullApiData: apiResponse, // A nyers válasz elmentése
        fromCache: false
    };
}

/**
 * 3. Fő Exportált Függvény (MEGLÉVŐ)
 * Lekéri a szorzókat 'fixtureId' alapján.
 */
export async function fetchOddsData(
    fixtureId: number | string, 
    sport: string
): Promise<ICanonicalOdds | null> {
    
    const cacheKey = `oddsfeed_v1_fix_${fixtureId}`;
    const cached = oddsFeedCache.get<ICanonicalOdds>(cacheKey);
    if (cached) {
        console.log(`[OddsProvider] Cache találat (FixtureID: ${fixtureId})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`[OddsProvider] Adatok lekérése (FixtureID: ${fixtureId})...`);
    
    try {
        const endpoint = '/api/v1/markets/find';
        const params = {
            'Event-ids': fixtureId,
            'language': 'en',
            'market_name': 'ALL', 
            'odds_type': 'decimal'
        };
        
        const response = await makeOddsFeedRequest(endpoint, params);
        
        if (!response || !response.markets) {
            if (response && response.results === 0) {
                console.warn(`[OddsProvider] Az 'Odds Feed' API nem talált piacokat (0 results) a ${fixtureId} ID-hoz.`);
            } else {
                console.error("[OddsProvider] Hiba: Az 'Odds Feed' API válasza érvénytelen (hiányzó 'markets' mező).");
            }
            return null;
        }

        const parsedOdds = parseOddsFeedResponse(response, fixtureId);
        
        if (parsedOdds) {
            oddsFeedCache.set(cacheKey, parsedOdds);
            console.log(`[OddsProvider] Siker. Adatok mentve a cache-be (FixtureID: ${fixtureId}).`);
        }
        
        return parsedOdds;

    } catch (e: any) {
        console.error(`[OddsProvider] KRITIKUS HIBA a 'fetchOddsData' során (FixtureID: ${fixtureId}): ${e.message}`);
        return null;
    }
}


/**
 * 4. ÚJ EXPORTÁLT FÜGGVÉNY (v75.1)
 * Lekéri a szorzókat CSAPATNÉV alapján.
 */
export async function fetchOddsByName(
    homeTeam: string,
    awayTeam: string,
    sport: string
): Promise<ICanonicalOdds | null> {
    
    // A név-alapú keresés lassabb, hosszabb cache-időt kap
    const cacheKey = `oddsfeed_v1_name_${sport}_${homeTeam.substring(0,5)}_${awayTeam.substring(0,5)}`;
    const cached = oddsNameCache.get<ICanonicalOdds>(cacheKey);
    if (cached) {
        console.log(`[OddsProvider] Cache találat (Név: ${homeTeam} vs ${awayTeam})`);
        return { ...cached, fromCache: true };
    }

    console.log(`[OddsProvider] Adatok lekérése (Név: ${homeTeam} vs ${awayTeam})...`);

    try {
        // Ez a végpont név alapján keres
        const endpoint = '/api/v1/events/search';
        const params = {
            'event_name': `${homeTeam} ${awayTeam}`,
            'language': 'en',
            'market_name': 'ALL',
            'odds_type': 'decimal'
        };

        const response = await makeOddsFeedRequest(endpoint, params);

        // A '/search' végpont 'events' tömböt ad vissza
        const event = response?.events?.[0];
        
        if (!event || !event.markets) {
             if (response && response.results === 0) {
                console.warn(`[OddsProvider] Az 'Odds Feed' API (név-alapú) nem talált piacokat (0 results) a "${homeTeam} vs ${awayTeam}" keresésre.`);
            } else {
                console.error("[OddsProvider] Hiba: Az 'Odds Feed' API (név-alapú) válasza érvénytelen (hiányzó 'events' vagy 'markets' mező).");
            }
            return null;
        }

        // Ugyanazt a parsert használjuk, mint a fixtureId alapú
        const parsedOdds = parseOddsFeedResponse(event, `${homeTeam} vs ${awayTeam}`);
        
        if (parsedOdds) {
            oddsNameCache.set(cacheKey, parsedOdds);
            console.log(`[OddsProvider] Siker. Név-alapú adatok mentve a cache-be (${homeTeam} vs ${awayTeam}).`);
        }
        
        return parsedOdds;

    } catch (e: any) {
        console.error(`[OddsProvider] KRITIKUS HIBA a 'fetchOddsByName' során (${homeTeam} vs ${awayTeam}): ${e.message}`);
        return null;
    }
}
