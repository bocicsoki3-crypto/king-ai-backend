// FÁJL: providers/oddsFeedProvider.ts
// VERZIÓ: v1.9.4 (Teljes Piac Lekérés Javítás)
// MÓDOSÍTÁS (v1.9.4):
// 1. JAVÍTÁS (Felhasználói kérés): A 'fetchOddsData' funkció módosítva.
// 2. LOGIKA: Eltávolítva a '?market_id=1' szűrő az API hívásból. A rendszer
//    most már az ÖSSZES piacot lekéri (beleértve a "Totals"-t is).
// 3. LOGIKA: A 'fetchOddsData' feldolgozó logikája átírva, hogy képes
//    legyen feldolgozni a teljes piactömböt, és kinyerje a 'h2h'
//    (Match Winner) és a 'totals' (Over/Under) piacokat is.
// 4. EREDMÉNY: Ez a javítás (az utils.ts v105.1 javításával együtt)
//    megoldja, hogy a Jégkorong már ne a 6.5-ös alapvonalat használja.
// 5. Megtartja a korábbi v1.9.3-as [cite: 51] dátumkezelési javításokat.

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
    if (union === 0) return 1; // Mindkét string üres vagy 1 karakteres
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
 * (Változatlan v1.9.3)
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

    // === v1.9.3 Robusztus Dátumkezelés ===
    let targetDate: Date | null = null;
    let matchDateForApi: string;

    if (utcKickoff) {
        const parsedDate = new Date(utcKickoff);
        if (!isNaN(parsedDate.getTime())) {
            targetDate = parsedDate; // Ezt használjuk a belső ellenőrzéshez
            matchDateForApi = parsedDate.toISOString().split('T')[0]; // Ezt küldjük az API-nak
            console.log(`[OddsFeedProvider v1.9.4] Cél dátum beállítva: ${matchDateForApi}`);
        } else {
            console.warn(`[OddsFeedProvider v1.9.4] Érvénytelen utcKickoff formátum: "${utcKickoff}". Mai dátum használata fallbackként.`);
            matchDateForApi = new Date().toISOString().split('T')[0];
        }
    } else {
        console.warn(`[OddsFeedProvider v1.9.4] Nincs utcKickoff. Mai dátum használata fallbackként.`);
        matchDateForApi = new Date().toISOString().split('T')[0];
    }
    // === Dátumkezelés Vége ===

    const sportId = getSportId(sport);
    
    console.log(`[OddsFeedProvider v1.9.4] Események lekérése (Endpoint: /api/v1/events): SportID: ${sportId}, Dátum: ${matchDateForApi}, Status: SCHEDULED`);

    const params = new URLSearchParams({
        sport_id: sportId,
        date: matchDateForApi,
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
        // @ts-ignore
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

            if (targetDate) {
                try {
                    const eventDate = new Date(event.start_time);
                    if (eventDate.toDateString() !== targetDate.toDateString()) {
                        continue; // Nem ez a nap, ugorj a következőre
                    }
                } catch (e) {
                    continue;
                }
            }
            
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
 * MÓDOSÍTVA (v1.9.4): Most már az összes piacot (Totals-t is) lekéri és feldolgozza.
 */
export async function fetchOddsData(
    homeTeamName: string,
    awayTeamName: string,
    utcKickoff: string,
    sport: string
): Promise<ICanonicalOdds | null> {
    
    console.log(`[OddsFeedProvider v1.9.4] Odds keresés indítása (Minden piac)...`);

    try {
        const eventId = await findEventIdByNames(homeTeamName, awayTeamName, utcKickoff, sport);

        if (!eventId) {
            console.warn(`[OddsFeedProvider] Nem sikerült EventID-t találni, az odds lekérés sikertelen.`);
            return null;
        }

        // === JAVÍTÁS (v1.9.4): A '?market_id=1' eltávolítva ===
        // Most már az összes piacot lekérjük, nem csak a Match Winner-t.
        const url = `https://${ODDS_API_HOST}/api/v1/events/${eventId}/markets`;
        // === JAVÍTÁS VÉGE ===
        
        const options = {
            method: 'GET',
            headers: {
                'x-rapidapi-host': ODDS_API_HOST || '',
                'x-rapidapi-key': ODDS_API_KEY || ''
            }
        };
        // @ts-ignore
        const response = await fetch(url, options);
        
        if (!response.ok) {
             console.error(`[OddsFeedProvider] Market hiba: ${response.status}`);
             return null;
        }

        const data = (await response.json()) as any;

        // A 'data.data' most már egy TÖMB, ami az ÖSSZES piacot tartalmazza
        const rawMarkets = data?.data; 

        if (!rawMarkets || !Array.isArray(rawMarkets) || rawMarkets.length === 0) {
            console.warn(`[OddsFeedProvider] Nincs elérhető odds adat (markets tömb üres) ehhez az eseményhez (ID: ${eventId}).`);
            return null;
        }

        // === JAVÍTÁS (v1.9.4): Új, teljes feldolgozó logika ===
            
        const allMarkets: ICanonicalOdds['allMarkets'] = [];
        const current: ICanonicalOdds['current'] = []; // 1X2 vagy Moneyline

        // 1. Piac: 1X2 (H2H) vagy Moneyline
        const h2hMarket = rawMarkets.find(m => 
            (m.name === '1X2' || m.name === 'Match Winner') && m.status === 'OPEN'
        );

        if (h2hMarket && h2hMarket.outcomes) {
            const outcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
            const homeOdd = parseFloat(h2hMarket.outcomes.find((o: any) => o.name === '1' || o.name === homeTeamName)?.price);
            const awayOdd = parseFloat(h2hMarket.outcomes.find((o: any) => o.name === '2' || o.name === awayTeamName)?.price);
            const drawOdd = parseFloat(h2hMarket.outcomes.find((o: any) => o.name === 'X' || o.name === 'Draw')?.price);

            if (homeOdd && awayOdd) {
                outcomes.push({ name: 'Home', price: homeOdd });
                outcomes.push({ name: 'Away', price: awayOdd });
                current.push({ name: 'Hazai győzelem', price: homeOdd });
                current.push({ name: 'Vendég győzelem', price: awayOdd });

                if (drawOdd) {
                    outcomes.push({ name: 'Draw', price: drawOdd });
                    current.push({ name: 'Döntetlen', price: drawOdd });
                }
                allMarkets.push({ key: 'h2h', outcomes: outcomes });
            }
        }

        // 2. Piac: Totals (Over/Under)
        // (Ez hiányzott a hokinál)
        const totalsMarket = rawMarkets.find(m => 
            (m.name === 'Totals' || m.name === 'Over/Under') && m.status === 'OPEN'
        );

        if (totalsMarket && totalsMarket.outcomes) {
            const totalsOutcomes: ICanonicalOdds['allMarkets'][0]['outcomes'] = [];
            totalsMarket.outcomes.forEach((o: any) => {
                const name = o.name; // Pl. "Over 6.5", "Under 6.5"
                const price = parseFloat(o.price);
                
                // Kinyerjük a 'point'-ot a névből
                const pointMatch = name.match(/(\d+(\.\d+)?)/);
                const point = pointMatch ? parseFloat(pointMatch[1]) : null;
                
                if (name && !isNaN(price)) {
                    totalsOutcomes.push({ name, price, point });
                }
            });
            
            if (totalsOutcomes.length > 0) {
                allMarkets.push({ key: 'totals', outcomes: totalsOutcomes });
            }
        }
        // === FELDOLGOZÓ LOGIKA VÉGE ===

        if (allMarkets.length === 0) {
             console.warn(`[OddsFeedProvider] Bár kaptunk ${rawMarkets.length} piacot, nem találtunk '1X2' vagy 'Totals' piacot (ID: ${eventId}).`);
             return null;
        }

        const oddsResult: ICanonicalOdds = {
            // @ts-ignore
            source: 'OddsFeedApi (Fallback - All Markets)', // Forrás frissítve
            allMarkets: allMarkets,
            current: current,
            fullApiData: data.data, // A teljes piactömb mentése
            fromCache: false
        };

        console.log(`[OddsFeedProvider] Odds sikeresen lekérve. (Markets: ${oddsResult.allMarkets.length})`);
        
        // Nincs cache-elés (a v1.9.3-ban sem volt), ezt tiszteletben tartjuk.
        
        return oddsResult;

    } catch (error: any) {
        console.error(`[OddsFeedProvider] Kritikus hiba: ${error.message}`);
        return null;
    }
}
