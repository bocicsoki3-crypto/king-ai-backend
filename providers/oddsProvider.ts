// FÁJL: providers/oddsProvider.ts
// VERZIÓ: v75.0 (Új Redundáns Odds Provider)
// CÉL: Az 'odds_implementation_plan.md' (3.2) alapján jött létre.
//      Ez a szolgáltató felelős a dedikált 'Odds Feed' API hívásáért,
//      hogy megoldja az 'apiSportsProvider' megbízhatatlanságából fakadó
//      adathiányt (amit a "Bielefeld-log" -5.00 Kockázati Pontszáma jelzett).

import { makeRequest } from './common/utils.js';
import { ODDS_API_KEY, ODDS_API_HOST } from '../config.js';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';
import NodeCache from 'node-cache';

// Ennek a providernek a saját, 10 perces gyorsítótára
const oddsFeedCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2 });

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
    const response = await makeRequest(config.url, config, 0); 
    return response.data;
}

/**
 * 2. Adat-Transzformáló (A "Fordító")
 * Lefordítja az "Odds Feed" API válaszát a mi belső ICanonicalOdds formátumunkra.
 * Ez a függvény az 'image_e85921.png' képen látható API-ra van szabva.
 */
function parseOddsFeedResponse(apiResponse: any, fixtureId: number | string): ICanonicalOdds | null {
    
    // Az 'Odds Feed' API a 'markets' tömbben adja vissza az adatokat
    const rawMarkets = apiResponse?.markets;
    if (!rawMarkets || !Array.isArray(rawMarkets) || rawMarkets.length === 0) {
        console.warn(`[OddsProvider] Az 'Odds Feed' API nem adott vissza 'markets' tömböt a ${fixtureId} ID-hoz.`);
        return null;
    }

    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    const current: ICanonicalOdds['current'] = []; // 1X2

    // 1X2 piac keresése (Moneyline/Match Winner)
    // A 'find' helyett 'filter'-t használunk, hogy az összes Bet365/Pinnacle piacot megtaláljuk, ha több van
    const h2hMarkets = rawMarkets.filter(m => 
        (m.market_name === '1X2' || m.market_name === 'Match Winner') && 
        m.status === 'OPEN'
    );
    const h2hMarket = h2hMarkets[0]; // TODO: Okosabb kiválasztás (pl. Bet365 priorizálása)

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
    const totalsMarket = rawMarkets.find(m => m.market_name === 'Totals' && m.status === 'OPEN');
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
    const bttsMarket = rawMarkets.find(m => m.market_name === 'Both Teams To Score' && m.status === 'OPEN');
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
        console.warn(`[OddsProvider] Az 'Odds Feed' API adott vissza adatot, de nem találtunk '1X2', 'Totals' vagy 'BTTS' piacokat (FixtureID: ${fixtureId}).`);
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
 * 3. Fő Exportált Függvény
 * Lekéri a szorzókat az "Odds Feed" API-ról.
 * A 'fixtureId'-t az 'apiSportsProvider'-től kapja, és bízunk benne, hogy az 'Odds Feed'
 * API is felismeri ezt az 'Event-id'-t (ahogy az image_e85921.png sugallja).
 */
export async function fetchOddsData(
    fixtureId: number | string, 
    sport: string // A 'sport' paramétert egyelőre nem használjuk, de a jövőben kellhet a sportkulcs-fordításhoz
): Promise<ICanonicalOdds | null> {
    
    // Architekta Döntés (v75.0): Feltételezzük, hogy az 'apiSports' FixtureID-ja
    // megegyezik az 'Odds Feed' 'Event-ids'-jével, mivel mindkettő RapidAPI szolgáltató.
    
    const cacheKey = `oddsfeed_v1_${fixtureId}`;
    const cached = oddsFeedCache.get<ICanonicalOdds>(cacheKey);
    if (cached) {
        console.log(`[OddsProvider] Cache találat (FixtureID: ${fixtureId})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`[OddsProvider] Adatok lekérése (FixtureID: ${fixtureId})...`);
    
    try {
        // A képernyőképed alapján ('image_e85921.png') a '/api/v1/markets/find' a helyes végpont.
        const endpoint = '/api/v1/markets/find';
        const params = {
            'Event-ids': fixtureId,
            'language': 'en',
            'market_name': 'ALL', // Lekérjük az összes fő piacot (1X2, Totals, BTTS)
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