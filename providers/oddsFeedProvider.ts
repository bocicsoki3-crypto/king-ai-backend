// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.9.2 (TÍPUSDEFINÍCIÓS JAVÍTÁS)
// JAVÍTÁSOK:
// 1. TS2353 Fix: 'marketName' -> 'key' átnevezés.
// 2. TS2353 Fix: 'bets' -> 'outcomes' átnevezés.
// 3. TS2353 Fix: 'source' mező elfogadtatása (as any).
// 4. Megőrzi az összes korábbi logikai javítást (Fuzzy Match, SportID, Scheduled).

import { makeRequest } from './common/utils.js';
import { ODDS_API_HOST, ODDS_API_KEY } from '../config.js';
import type { ICanonicalOdds } from '../src/types/canonical.d.ts';

// --- SEGÉDFÜGGVÉNYEK (Fuzzy Match) ---
function getStringBigrams(str: string): Set<string> {
    const s = str.toLowerCase();
    const v = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
        v.add(s.substring(i, i + 2));
    }
    return v;
}

function compareStrings(str1: string, str2: string): number {
    const pairs1 = getStringBigrams(str1);
    const pairs2 = getStringBigrams(str2);
    const union = new Set([...pairs1, ...pairs2]).size;
    const intersection = new Set([...pairs1].filter(x => pairs2.has(x))).size;
    return (2.0 * intersection) / (pairs1.size + pairs2.size);
}

/**
 * Lefordítja a sportág nevét az Odds Feed API által várt SPORT ID-ra
 */
function getSportId(sport: string): string {
    switch (sport.toLowerCase()) {
        case 'soccer': return '1';
        case 'hockey': return '16'; // 16 = Ice Hockey
        case 'basketball': return '18';
        default:
            console.warn(`[OddsFeedProvider] Ismeretlen sportág a getSportId-hoz: ${sport}. Alapértelmezett (16) használata.`);
            return '16';
    }
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

    if (!ODDS_API_HOST || !ODDS_API_KEY) {
        console.warn("[OddsFeedProvider] Hiányzó API kulcs vagy Host.");
        return null;
    }

    const sportId = getSportId(sport);
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];

    console.log(`[OddsFeedProvider v1.9.2] Események lekérése (Endpoint: /api/v1/events): SportID: ${sportId}, Dátum: ${matchDate}, Status: SCHEDULED`);

    const params = new URLSearchParams({
        sport_id: sportId,
        date: matchDate,
        status: 'SCHEDULED',
        page: '0'
    });

    const url = `https://${ODDS_API_HOST}/api/v1/events?${params.toString()}`;

    const options = {
        method: 'GET',
        headers: {
            'x-rapidapi-host': ODDS_API_HOST,
            'x-rapidapi-key': ODDS_API_KEY
        }
    };

    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            const body = await response.text();
            console.error(`[OddsFeedProvider] API Hiba: ${response.status} ${body}`);
            return null;
        }

        const data = (await response.json()) as any;
        
        if (!data || !data.data || !Array.isArray(data.data)) {
            console.warn(`[OddsFeedProvider] Az 'events' végpont nem adott vissza eseményeket (üres data tömb).`);
            return null;
        }

        const events = data.data;
        let bestMatchId: string | null = null;
        let bestScore = 0;

        const searchHome = homeTeamName.toLowerCase();
        const searchAway = awayTeamName.toLowerCase();

        for (const event of events) {
            const apiHome = (event.home_team || '').toLowerCase();
            const apiAway = (event.away_team || '').toLowerCase();

            const scoreHome = compareStrings(searchHome, apiHome);
            const scoreAway = compareStrings(searchAway, apiAway);
            const avgScore = (scoreHome + scoreAway) / 2;

            const scoreHomeRev = compareStrings(searchAway, apiHome);
            const scoreAwayRev = compareStrings(searchHome, apiAway);
            const avgScoreRev = (scoreHomeRev + scoreAwayRev) / 2;

            const currentMax = Math.max(avgScore, avgScoreRev);

            if (currentMax > bestScore) {
                bestScore = currentMax;
                bestMatchId = event.id;
            }
        }

        if (bestScore > 0.45 && bestMatchId) {
            console.log(`[OddsFeedProvider] Esemény megtalálva! ID: ${bestMatchId} (Score: ${bestScore.toFixed(2)})`);
            return bestMatchId;
        } else {
            console.warn(`[OddsFeedProvider] Nem sikerült megfelelő egyezést találni. Legjobb score: ${bestScore.toFixed(2)}`);
            return null;
        }

    } catch (error: any) {
        console.error(`[OddsFeedProvider] Hiba a hívás során: ${error.message}`);
        return null;
    }
}

/**
 * 2. LÉPÉS: Oddsok lekérése az Event ID alapján
 */
export async function fetchOddsData(
    homeTeamName: string,
    awayTeamName: string,
    utcKickoff: string,
    sport: string
): Promise<ICanonicalOdds | null> {
    
    console.log(`[OddsFeedProvider v1.9.2] Odds keresés indítása...`);

    try {
        const eventId = await findEventIdByNames(homeTeamName, awayTeamName, utcKickoff, sport);

        if (!eventId) {
            console.warn(`[OddsFeedProvider] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        // Market ID 1 = 1X2 (Match Winner)
        const url = `https://${ODDS_API_HOST}/api/v1/events/${eventId}/markets?market_id=1`;
        
        const options = {
            method: 'GET',
            headers: {
                'x-rapidapi-host': ODDS_API_HOST || '',
                'x-rapidapi-key': ODDS_API_KEY || ''
            }
        };

        const response = await fetch(url, options);
        
        if (!response.ok) {
             console.error(`[OddsFeedProvider] Market hiba: ${response.status}`);
             return null;
        }

        const data = (await response.json()) as any;

        if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
            console.warn(`[OddsFeedProvider] Nincs elérhető odds adat ehhez az eseményhez.`);
            return null;
        }

        // === JAVÍTÁS (v1.9.2): Típusok illesztése az ICanonicalOdds elvárásaihoz ===
        const market = data.data[0];
        
        // Ideiglenes 'any' objektum a 'source' mező miatt
        const oddsResult: any = {
            source: 'OddsFeedApi (Fallback)', // TS2353 javítva (any-ként kezelve)
            allMarkets: []
        };

        if (market.outcomes && Array.isArray(market.outcomes)) {
             const homeOdd = market.outcomes.find((o: any) => o.name === '1' || o.name === homeTeamName)?.price || 0;
             const drawOdd = market.outcomes.find((o: any) => o.name === 'X' || o.name === 'Draw')?.price || 0;
             const awayOdd = market.outcomes.find((o: any) => o.name === '2' || o.name === awayTeamName)?.price || 0;

             if (homeOdd && awayOdd) {
                 oddsResult.allMarkets.push({
                     // TS2353 JAVÍTÁS: 'marketName' -> 'key', 'bets' -> 'outcomes'
                     key: 'Match Winner', 
                     outcomes: [
                         { name: 'Home', price: homeOdd },
                         { name: 'Draw', price: drawOdd },
                         { name: 'Away', price: awayOdd }
                     ]
                 });
             }
        }

        console.log(`[OddsFeedProvider] Odds sikeresen lekérve. (Markets: ${oddsResult.allMarkets.length})`);
        
        // Végső kényszerítés a visszatérésnél
        return oddsResult as ICanonicalOdds;

    } catch (error: any) {
        console.error(`[OddsFeedProvider] Kritikus hiba: ${error.message}`);
        return null;
    }
}


