// FÁJL: providers/aiOddsProvider.ts
// VERZIÓ: v1.0 (AI Web Search for Odds)
// CÉL: Kiváltani a hagyományos, gyakran hiányos API-kat.
// MŰKÖDÉS: A Gemini modellt használja Google Search Tool-lal (Grounding),
//          hogy valós időben megkeresse az aktuális szorzókat.

import { _callGeminiWithJsonRetry } from './common/utils.js';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

const PROMPT_ODDS_SEARCH = `
TASK: Find the CURRENT betting odds for the match: {homeTeam} vs {awayTeam} ({sport}).
USE GOOGLE SEARCH to find reliable odds from major bookmakers (e.g., Bet365, Pinnacle, Unibet, OddsPortal).

REQUIREMENTS:
1. Find the "Match Winner" (1X2 or Moneyline) odds.
2. Find the "Over/Under" odds for the main line (e.g. 2.5 for soccer, 220.5 for nba).
3. Find the "BTTS" (Both Teams To Score) odds if applicable (Soccer only).
4. Return the data in a standardized JSON format.

CRITICAL:
- If the match is LIVE, try to find live odds. If not, use pre-match closing odds.
- If you cannot find EXACT odds, return null, do not hallucinate numbers.

OUTPUT JSON STRUCTURE:
{
  "found": true,
  "bookmaker": "Name of the source found (e.g. Bet365 via Flashscore)",
  "h2h": {
    "home": <decimal number>,
    "draw": <decimal number or null>,
    "away": <decimal number>
  },
  "totals": {
    "line": <number, e.g. 2.5>,
    "over": <decimal number>,
    "under": <decimal number>
  },
  "btts": {
    "yes": <decimal number or null>,
    "no": <decimal number or null>
  }
}
`;

export async function fetchOddsViaWebSearch(
    homeTeam: string, 
    awayTeam: string, 
    sport: string
): Promise<ICanonicalOdds | null> {
    
    console.log(`[AiOddsProvider] Odds keresése a weben (Google Search)... ${homeTeam} vs ${awayTeam}`);
    
    try {
        const promptData = { homeTeam, awayTeam, sport };
        // A 'true' paraméter a végén aktiválja a Google Search-öt!
        const result = await _callGeminiWithJsonRetry(
            PROMPT_ODDS_SEARCH.replace('{homeTeam}', homeTeam).replace('{awayTeam}', awayTeam).replace('{sport}', sport),
            "AiOddsSearch",
            2,
            true // <--- USE SEARCH = TRUE
        );

        if (!result || !result.found || !result.h2h) {
            console.warn(`[AiOddsProvider] Nem sikerült oddsokat találni a weben.`);
            return null;
        }

        console.log(`[AiOddsProvider] SIKER! Forrás: ${result.bookmaker}. H:${result.h2h.home}, D:${result.h2h.draw}, A:${result.h2h.away}`);

        // Átalakítás kanonikus formátummá
        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const current: ICanonicalOdds['current'] = [];

        // 1X2
        const outcomesH2H = [
            { name: 'Home', price: result.h2h.home },
            { name: 'Away', price: result.h2h.away }
        ];
        current.push({ name: 'Hazai győzelem', price: result.h2h.home });
        current.push({ name: 'Vendég győzelem', price: result.h2h.away });

        if (result.h2h.draw) {
            outcomesH2H.push({ name: 'Draw', price: result.h2h.draw });
            current.push({ name: 'Döntetlen', price: result.h2h.draw });
        }
        allMarkets.push({ key: 'h2h', outcomes: outcomesH2H });

        // Totals
        if (result.totals && result.totals.line) {
            const outcomesTotals = [
                { name: `Over ${result.totals.line}`, price: result.totals.over, point: result.totals.line },
                { name: `Under ${result.totals.line}`, price: result.totals.under, point: result.totals.line }
            ];
            allMarkets.push({ key: 'totals', outcomes: outcomesTotals });
        }

        // BTTS
        if (result.btts && result.btts.yes) {
            const outcomesBTTS = [
                { name: 'Yes', price: result.btts.yes },
                { name: 'No', price: result.btts.no }
            ];
            allMarkets.push({ key: 'btts', outcomes: outcomesBTTS });
        }

        return {
            current,
            allMarkets,
            fullApiData: result,
            fromCache: false,
            // @ts-ignore
            source: `AI Web Search (${result.bookmaker})`
        };

    } catch (e: any) {
        console.error(`[AiOddsProvider] Hiba a keresés során: ${e.message}`);
        return null;
    }
}
