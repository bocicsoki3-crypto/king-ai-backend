// FÁJL: providers/nameBasedOddsProvider.ts
// VERZIÓ: v1.0 (Fejlesztés 2)
// CÉL: Ez egy "végső mentsvár" tartalék provider.
// Akkor hívódik meg, ha a P4-es adatgyűjtés teljesen elbukik (nincs leagueId/fixtureId),
// és a rendszer "Tiszta P1 Módba" kényszerül.
// Ez a "The Odds API"-t használja, és CSAPATNÉV alapján keres.
// Ez KÜLÖNBÖZIK a meglévő 'oddsProvider.ts'-től, ami fixtureId alapján keres.

import axios, { type AxiosRequestConfig } from 'axios';
import { THE_ODDS_API_HOST, THE_ODDS_API_KEY } from '../config.js';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

// Segédfüggvény a "The Odds API" sportkulcsának meghatározásához
function getOddsApiSportKey(sport: string): string {
    // Ez a 'The Odds API' v4 dokumentációja szerinti kulcsokat használja
    switch (sport) {
        // A te logod 'soccer'-t használ [9, line 7]
        case 'soccer': return 'soccer_all_leagues'; // Általános foci kulcs
        case 'basketball': return 'basketball_nba';
        case 'hockey': return 'icehockey_nhl';
        default: return 'soccer_all_leagues';
    }
}

// Segédfüggvény a "The Odds API" válaszának kanonikus formátumra alakításához
function parseOddsApiResponse(apiResponse: any[], homeTeam: string, awayTeam: string): ICanonicalOdds | null {
    if (!apiResponse || apiResponse.length === 0) {
        return null;
    }

    // Keressük az első elérhető meccset, ami tartalmazza a csapatainkat
    // Egyszerűsített keresés, mivel P1 módban vagyunk
    const lowerHome = homeTeam.toLowerCase().substring(0, 8);
    const lowerAway = awayTeam.toLowerCase().substring(0, 8);

    const match = apiResponse.find(m => 
        m.home_team.toLowerCase().includes(lowerHome) ||
        m.away_team.toLowerCase().includes(lowerAway) ||
        m.home_team.toLowerCase().includes(lowerAway) || // Fordított meccs
        m.away_team.toLowerCase().includes(lowerHome)
    );

    if (!match || !match.bookmakers || match.bookmakers.length === 0) {
        console.warn(`[NameBasedOddsProvider] Találat ${apiResponse.length} meccsre, de egyik sem egyezett a "${lowerHome}" vs "${lowerAway}" keresésre.`);
        return null;
    }

    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    const current: ICanonicalOdds['current'] = [];

    // Vegyük az első elérhető fogadóirodát (lehetőleg Pinnacle)
    const bookmaker = match.bookmakers.find((b: any) => b.key === 'pinnacle') || match.bookmakers[0];
    
    // 1. Piac: 1X2 (h2h)
    const h2hMarket = bookmaker.markets.find((m: any) => m.key === 'h2h');
    if (h2hMarket && h2hMarket.outcomes) {
        const homeOutcome = h2hMarket.outcomes.find((o: any) => o.name === match.home_team);
        const awayOutcome = h2hMarket.outcomes.find((o: any) => o.name === match.away_team);
        const drawOutcome = h2hMarket.outcomes.find((o: any) => o.name.toLowerCase() === 'draw');

        const outcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
        if (homeOutcome) {
            outcomes.push({ name: 'Home', price: homeOutcome.price });
            current.push({ name: 'Hazai győzelem', price: homeOutcome.price });
        }
        if (awayOutcome) {
            outcomes.push({ name: 'Away', price: awayOutcome.price });
            current.push({ name: 'Vendég győzelem', price: awayOutcome.price });
        }
        if (drawOutcome) {
            outcomes.push({ name: 'Draw', price: drawOutcome.price });
        }
        
        if (outcomes.length > 0) {
            allMarkets.push({ key: 'h2h', outcomes: outcomes });
        }
    }

    // 2. Piac: Totals (totals)
    const totalsMarket = bookmaker.markets.find((m: any) => m.key === 'totals');
    if (totalsMarket && totalsMarket.outcomes) {
        // Általában 2 kimenetel van: Over és Under
        const overOutcome = totalsMarket.outcomes.find((o: any) => o.name.toLowerCase() === 'over');
        const underOutcome = totalsMarket.outcomes.find((o: any) => o.name.toLowerCase() === 'under');
        
        if (overOutcome && underOutcome && overOutcome.point) {
            allMarkets.push({
                key: 'totals',
                outcomes: [
                    { name: `Over ${overOutcome.point}`, price: overOutcome.price, point: overOutcome.point },
                    { name: `Under ${underOutcome.point}`, price: underOutcome.price, point: underOutcome.point }
                ]
            });
        }
    }
    
    if (allMarkets.length === 0) {
        return null;
    }

    return {
        current: current,
        allMarkets: allMarkets,
        fullApiData: match,
        fromCache: false // Ez mindig friss hívás
    };
}


/**
 * Fő exportált funkció: Odds-ok lekérése CSAPATNEVEK alapján
 */
export async function fetchOddsByName(homeTeam: string, awayTeam: string, sport: string): Promise<ICanonicalOdds | null> {
    
    if (!THE_ODDS_API_HOST || !THE_ODDS_API_KEY) {
        console.warn("[NameBasedOddsProvider] THE_ODDS_API_HOST vagy KEY hiányzik a config.ts-ből. Kihagyva.");
        return null;
    }

    const sportKey = getOddsApiSportKey(sport);
    // Ez a végpont a 'sport' összes meccsét lekéri
    const endpoint = `/v4/sports/${sportKey}/odds`;

    try {
        const config: AxiosRequestConfig = {
            params: {
                apiKey: THE_ODDS_API_KEY,
                regions: 'us,eu', // US és EU piacok
                markets: 'h2h,totals',
                bookmakers: 'pinnacle,bet365' // Prioritás
            }
        };

        const url = `https://${THE_ODDS_API_HOST}${endpoint}`;
        console.log(`[NameBasedOddsProvider] Hívás indul: ${url} (Sport: ${sportKey})`);
        
        const response = await axios.get(url, config);

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            console.log(`[NameBasedOddsProvider] Sikeres válasz, ${response.data.length} meccs érkezett a(z) ${sportKey} sportághoz.`);
            return parseOddsApiResponse(response.data, homeTeam, awayTeam);
        } else {
            console.warn(`[NameBasedOddsProvider] Az API hívás sikeres volt, de nem adott vissza meccseket.`);
            return null;
        }

    } catch (error: any) {
        console.error(`[NameBasedOddsProvider] KRITIKUS HIBA a "The Odds API" hívása közben: ${error.message}`, error.response?.data);
        return null;
    }
}
