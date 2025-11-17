// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.9.3 (Robusztus Dátumkezelés és TS1005 Javítás)
// MÓDOSÍTÁS (v1.9.3):
// 1. JAVÍTÁS (Dátum Hiba): A 'findEventIdByNames' (kb. 51. sor) módosítva.
//    Most már ellenőrzi a 'utcKickoff' [cite: 51, line 65] érvényességét.
//    Ha 'null' vagy érvénytelen, a kód NEM áll le "Invalid time value" [cite: 48, line 35] hibával,
//    hanem 'new Date()' (mai nap) értékre állítja a dátumot.
// 2. JAVÍTÁS (TS1005 Hiba) [cite: 52]: Eltávolítva a felesleges '}' karakter
//    a fájl végéről (a korábbi 282. sorból [cite: 51, line 282]).
// 3. Megtartja a korábbi v1.9.2-es [cite: 51] típusdefiníciós javításokat.

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

    // === JAVÍTÁS (v1.9.3) - Robusztus Dátumkezelés ===
    let targetDate: Date | null = null;
    let matchDateForApi: string;

    if (utcKickoff) {
        const parsedDate = new Date(utcKickoff);
        if (!isNaN(parsedDate.getTime())) {
            targetDate = parsedDate; // Ezt használjuk a belső ellenőrzéshez
            matchDateForApi = parsedDate.toISOString().split('T')[0]; // Ezt küldjük az API-nak
            console.log(`[OddsFeedProvider v1.9.3] Cél dátum beállítva: ${matchDateForApi}`);
        } else {
            console.warn(`[OddsFeedProvider v1.9.3] Érvénytelen utcKickoff formátum: "${utcKickoff}". Mai dátum használata fallbackként.`);
            matchDateForApi = new Date().toISOString().split('T')[0];
            // targetDate null marad, így a dátumellenőrzés ki lesz hagyva
        }
    } else {
        console.warn(`[OddsFeedProvider v1.9.3] Nincs utcKickoff. Mai dátum használata fallbackként.`);
        matchDateForApi = new Date().toISOString().split('T')[0];
        // targetDate null marad
    }
    // === JAVÍTÁS VÉGE ===

    const sportId = getSportId(sport);
    // const matchDate = new Date(utcKickoff).toISOString().split('T')[0]; // <-- EREDETI HIBA [cite: 51, line 65]

    console.log(`[OddsFeedProvider v1.9.3] Események lekérése (Endpoint: /api/v1/events): SportID: ${sportId}, Dátum: ${matchDateForApi}, Status: SCHEDULED`);

    const params = new URLSearchParams({
        sport_id: sportId,
        date: matchDateForApi, // Itt már a biztonságos 'matchDateForApi'-t használjuk
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
        // A te v1.9.2-es [cite: 51] fájlod 'fetch'-et használ, azt tartjuk meg
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

            // === JAVÍTÁS (v1.9.3): Dátumellenőrzés (ha van 'targetDate') ===
            if (targetDate) {
                try {
                    const eventDate = new Date(event.start_time);
                    if (eventDate.toDateString() !== targetDate.toDateString()) {
                        continue; // Nem ez a nap, ugorj a következőre
                    }
                } catch (e) {
                    // Ha az API rossz dátumot ad, azt is ugorjuk
                    continue;
                }
            }
            // Ha a dátum egyezik, VAGY ha nem volt dátum (P1 mód), akkor jöhet a név-ellenőrzés
            
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
        // v1.9.3: Jobb hibakezelés az "Invalid time value" elkerülésére
        if (error instanceof TypeError && error.message.includes("Invalid time value")) {
             console.error(`[OddsFeedProvider] KRITIKUS DÁTUM HIBA: A 'utcKickoff' paraméter (${utcKickoff}) érvénytelen.`);
        } else {
             console.error(`[OddsFeedProvider] Hiba a hívás során: ${error.message}`);
        }
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
    
    console.log(`[OddsFeedProvider v1.9.3] Odds keresés indítása...`);

    try {
        const eventId = await findEventIdByNames(homeTeamName, awayTeamName, utcKickoff, sport);

        if (!eventId) {
            console.warn(`[OddsFeedProvider] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        // Market ID 1 = 1X2 (Match Winner)
        // v1.9.3: A te v1.9.2-es fájlod [cite: 51] csak a market_id=1-et kéri le.
        // Ez gyors, de csak 1X2-t ad. A jövőben érdemes lehet
        // a '/api/v1/events/${eventId}/markets' végpontot hívni 'market_id' nélkül,
        // hogy az összes piacot (pl. Totals) is megkapjuk.
        // Egyelőre maradunk a te kódod logikájánál:
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
            console.warn(`[OddsFeedProvider] Nincs elérhető odds adat (market_id=1) ehhez az eseményhez (ID: ${eventId}).`);
            return null;
        }

        // === JAVÍTÁS (v1.9.2) [cite: 51]: Típusok illesztése az ICanonicalOdds elvárásaihoz ===
        const market = data.data[0];
        
        // Ideiglenes 'any' objektum a 'source' mező miatt
        const oddsResult: any = {
            source: 'OddsFeedApi (Fallback)', // TS2353 javítva (any-ként kezelve)
            allMarkets: [],
            current: [] // v1.9.3: Hozzáadva a 'current'
        };

        if (market.outcomes && Array.isArray(market.outcomes)) {
             const homeOddVal = market.outcomes.find((o: any) => o.name === '1' || o.name === homeTeamName)?.price || 0;
             const drawOddVal = market.outcomes.find((o: any) => o.name === 'X' || o.name === 'Draw')?.price || 0;
             const awayOddVal = market.outcomes.find((o: any) => o.name === '2' || o.name === awayTeamName)?.price || 0;
             
             const homeOdd = parseFloat(homeOddVal);
             const drawOdd = parseFloat(drawOddVal);
             const awayOdd = parseFloat(awayOddVal);

             if (homeOdd && awayOdd) {
                 const outcomes = [
                     { name: 'Home', price: homeOdd },
                     { name: 'Away', price: awayOdd }
                 ];
                 
                 // A 'current' tömb feltöltése (ezt használja a DataFetch)
                 oddsResult.current.push({ name: 'Hazai győzelem', price: homeOdd });
                 oddsResult.current.push({ name: 'Vendég győzelem', price: awayOdd });

                 if (drawOdd) {
                     outcomes.push({ name: 'Draw', price: drawOdd });
                     oddsResult.current.push({ name: 'Döntetlen', price: drawOdd });
                 }

                 oddsResult.allMarkets.push({
                     // TS2353 JAVÍTÁS [cite: 51]: 'marketName' -> 'key', 'bets' -> 'outcomes'
                     key: 'Match Winner', 
                     outcomes: outcomes
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

// === JAVÍTÁS (v1.9.3): Eltávolítva a felesleges '}' karakter a 282. sorból [cite: 51, line 282] ===
