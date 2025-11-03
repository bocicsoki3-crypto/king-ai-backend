// providers/sofascoreProvider.ts (v54.3 - SSOT Refaktor Javítás)
// MÓDOSÍTÁS: (3. Fázis) A 'getSofascoreTeamId' most már a központi APIFOOTBALL_TEAM_NAME_MAP-et használja
//            és a hibás "USA" kontextus-szűrés eltávolítva.
// MÓDOSÍTÁS: (1. Fázis) A 'processSofascoreLineups' hibás 'isAbsent' logikája eltávolítva.
import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// === JAVÍTÁS (v54.3) ===
// Importáljuk a központi név-térképet és a Sofascore konfigurációt
import { 
    SOFASCORE_API_KEY, 
    SOFASCORE_API_HOST,
    APIFOOTBALL_TEAM_NAME_MAP // <-- ÚJ IMPORT
} from '../config.js';
import { makeRequest } from './common/utils.js';
// Kanonikus típusok importálása
import type { ICanonicalPlayerStats, ICanonicalPlayer } from '../src/types/canonical.d.ts';
// --- Típusdefiníciók a Sofascore válaszokhoz (Kiterjesztve) ---
interface ISofascoreTeam {
    name: string;
    id: number;
    // Bővítés a kontextuális szűréshez (feltételezett struktúra)
    country?: {
        name?: string;
        alpha2?: string;
    };
    // A 'search' válasz 'entity' objektuma gyakran tartalmazza a ligát is
    tournament?: {
        name?: string;
        id?: number;
    };
}
interface ISofascoreEvent {
    id: number;
    homeTeam: ISofascoreTeam;
    awayTeam: ISofascoreTeam;
    startTimestamp: number;
}
interface ISofascoreXg {
    home: number;
    away: number;
}
interface ISofascoreRawPlayer {
    player: {
        id: number;
        name: string;
        position: 'G' | 'D' | 'M' | 'F' | 'Attacker' | 'Defender' | 'Midfielder' | 'Goalkeeper';
    };
    rating?: string;
    position?: string;
    substitute?: boolean;
}


// --- Cache-ek ---
const sofaTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7 });
// 1 hét
const sofaEventCache = new NodeCache({ stdTTL: 3600 * 6 });
// 6 óra

// ... (makeSofascoreRequest változatlan)
async function makeSofascoreRequest(endpoint: string, params: any) {
    if (!SOFASCORE_API_KEY || !SOFASCORE_API_HOST) {
        throw new Error("Sofascore API konfigurációs hiba (SOFASCORE_API_KEY vagy HOST hiányzik).");
    }
    const config: AxiosRequestConfig = {
        method: 'GET',
        url: `https://${SOFASCORE_API_HOST}${endpoint}`,
        params: params,
        headers: {
            'X-RapidAPI-Key': SOFASCORE_API_KEY,
            'X-RapidAPI-Host': SOFASCORE_API_HOST
        }
    };
    try {
        const response = await makeRequest(config.url as string, config, 0); 
        return response.data;
    } catch (error: any) {
        console.error(`[Sofascore API Hiba] Endpoint: ${endpoint} - ${error.message}`);
        return null;
    }
}

/**
 * 1. Lépés: Megkeresi egy csapat Sofascore ID-ját a neve alapján.
 * (JAVÍTVA v54.3: APIFOOTBALL_TEAM_NAME_MAP integráció és hibás kontextus-szűrés eltávolítva)
 */
async function getSofascoreTeamId(teamName: string): Promise<number |
null> {
    
    // === JAVÍTÁS (v54.3): Név-térkép ellenőrzése ===
    const lowerName = teamName.toLowerCase().trim();
    // A config.js-ben lévő térkép használata (pl. "LAFC" -> "Los Angeles FC")
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName; 
    const searchName = mappedName.toLowerCase();
    // === JAVÍTÁS VÉGE ===

    const cacheKey = `team_v54.3_mapped_${searchName.replace(/\s/g, '')}`; // Cache kulcs frissítve
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;
    
    console.log(`[Sofascore] Csapat keresés (v54.3 Térképezett): "${teamName}" -> "${searchName}"`);
    
    const data = await makeSofascoreRequest('/search', { q: searchName }); // A 'searchName'-t használjuk
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${searchName}". Nincs 'results' tömb (Endpoint: /search).`);
        return null;
    }

    // Az 'entity' objektum teljes átvétele, a kontextus (ország) megtartásával
    const allTeams: ISofascoreTeam[] = data.results
        .filter((r: any) => 
            r.type === 'team' && 
            r.entity?.sport?.name === 'Football' && 
            r.entity.id &&
            r.entity.name
        )
       .map((r: any) => r.entity);

    if (allTeams.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés: Nincs 'Football' típusú 'team' találat erre: "${searchName}"`);
        return null;
    }

    // === JAVÍTÁS (v54.3): Hibás Kontextus Szűrés Eltávolítva ===
    // A "USA" kontextusra szűrés (Source 1766-1769) eltávolítva,
    // mivel ez okozta a "Lazio" meccs hibáját (Source 1730-1731).
    let teamsToSearch: ISofascoreTeam[] = allTeams;
    let searchContext = "Globális";
    // === JAVÍTÁS VÉGE ===

    const normalizedInput = searchName; // A térképezett nevet keressük
    let foundTeam: ISofascoreTeam | null = null;

    // 1. Lépés: Tökéletes egyezés (a globális listán)
    foundTeam = teamsToSearch.find(t => t.name.toLowerCase() === normalizedInput) || null;
    if (foundTeam) {
        console.log(`[Sofascore] Csapat ID Találat (1/2 - Tökéletes ${searchContext}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }

    // 2. Lépés: Hasonlósági egyezés (Fuzzy Match)
    const teamNames = teamsToSearch.map(t => t.name);
    if (teamNames.length === 0) {
         console.warn(`[Sofascore] Csapat ID Találat: Nincs érvényes jelölt a(z) "${teamName}" (keresve: "${searchName}") keresésre.`);
        return null;
    }

    const bestMatch = findBestMatch(searchName, teamNames); // 'searchName'-t használjuk
    
    // Magasabb küszöböt használunk a globális keresés miatt
    const FUZZY_THRESHOLD = 0.6; 
    if (bestMatch.bestMatch.rating >= FUZZY_THRESHOLD) {
        foundTeam = teamsToSearch[bestMatch.bestMatchIndex];
        console.log(`[Sofascore] Csapat ID Találat (2/2 - Hasonlóság ${searchContext} >= ${FUZZY_THRESHOLD}): "${teamName}" (keresve: "${searchName}") -> "${foundTeam.name}" (ID: ${foundTeam.id}, Rating: ${bestMatch.bestMatch.rating.toFixed(2)})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[Sofascore] Csapat ID Találat: Sikertelen egyeztetés (${searchContext} kontextus). Alacsony egyezés (${bestMatch.bestMatch.rating.toFixed(2)}) erre: "${teamName}" (keresve: "${searchName}")`);
    return null;
}

// ... (getSofascoreEventId változatlan v52.19 óta)
async function getSofascoreEventId(homeTeamId: number, awayTeamId: number): Promise<number |
null> {
    const cacheKey = `event_${homeTeamId}_vs_${awayTeamId}`;
    const cachedId = sofaEventCache.get<number>(cacheKey);
    if (cachedId) {
        console.log(`[Sofascore] Meccs ID Találat (Cache): ${cachedId}`);
        return cachedId;
    }

    console.log(`[Sofascore] Meccs keresés (1/2): ${homeTeamId} (Home) naptárának ellenőrzése...`);
    let data = await makeSofascoreRequest('/teams/get-next-matches', { teamId: homeTeamId, page: 0 });
    if (data?.events) {
        const events: ISofascoreEvent[] = data.events;
        const foundEvent = events.find(event => event.awayTeam?.id === awayTeamId);
        if (foundEvent) {
            console.log(`[Sofascore] Meccs ID Találat (1/2): (Event ID: ${foundEvent.id})`);
            sofaEventCache.set(cacheKey, foundEvent.id);
            return foundEvent.id;
        }
    } else {
         console.warn(`[Sofascore] Meccs keresés (1/2) sikertelen: Nincs 'events' mező (Hazai ID: ${homeTeamId}).`);
    }

    console.log(`[Sofascore] Meccs keresés (2/2): ${awayTeamId} (Away) naptárának ellenőrzése...`);
    data = await makeSofascoreRequest('/teams/get-next-matches', { teamId: awayTeamId, page: 0 });
    if (data?.events) {
        const events: ISofascoreEvent[] = data.events;
        const foundEvent = events.find(event => event.homeTeam?.id === homeTeamId);
        if (foundEvent) {
            console.log(`[Sofascore] Meccs ID Találat (2/2): (Event ID: ${foundEvent.id})`);
            sofaEventCache.set(cacheKey, foundEvent.id);
            return foundEvent.id;
        }
    } else {
         console.warn(`[Sofascore] Meccs keresés (2/2) sikertelen: Nincs 'events' mező (Vendég ID: ${awayTeamId}).`);
    }

    console.warn(`[Sofascore] Meccs ID Találat: Nem található ${homeTeamId} vs ${awayTeamId} meccs (mindkét csapat naptára ellenőrizve).`);
    return null;
}

// ... (getSofascoreXg változatlan)
async function getSofascoreXg(eventId: number): Promise<ISofascoreXg | null> {
    const data = await makeSofascoreRequest('/matches/get-statistics', { matchId: eventId });
    if (!data?.statistics) {
        console.warn(`[Sofascore] xG Hiba: Nincs 'statistics' mező (Event ID: ${eventId}).`);
        return null;
    }
    try {
        let expectedGoalsRow: any = null;
        for (const statGroup of data.statistics) {
            if (statGroup.groupName === 'Expected' || statGroup.groupName === 'Attacking') {
                expectedGoalsRow = statGroup.rows.find((row: any) => row.name === 'Expected goals (xG)');
                if (expectedGoalsRow) break;
            }
        }
        if (expectedGoalsRow && expectedGoalsRow.home && expectedGoalsRow.away) {
            const xG: ISofascoreXg = {
                home: parseFloat(expectedGoalsRow.home),
                away: parseFloat(expectedGoalsRow.away)
            };
            console.log(`[Sofascore] xG Adat kinyerve: H=${xG.home}, A=${xG.away}`);
            return xG;
        } else {
            console.warn(`[Sofascore] xG Hiba: Nem található 'Expected goals (xG)' sor (Event ID: ${eventId}).`);
            return null;
        }
    } catch (e: any) {
        console.error(`[Sofascore] xG Feldolgozási Hiba: ${e.message}`);
        return null;
    }
}

// ... (getSofascoreLineups változatlan)
async function getSofascoreLineups(eventId: number): Promise<{ home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } |
null> {
    const data = await makeSofascoreRequest('/matches/get-lineups', { matchId: eventId });
    if (!data?.home && !data?.away) {
        console.warn(`[Sofascore] Felállás Hiba: Nincs 'home' vagy 'away' mező (Event ID: ${eventId}).`);
        return null;
    }
    const homePlayers = (data.home.players || []).map((p: any) => ({ ...p, team: 'home' }));
    const awayPlayers = (data.away.players || []).map((p: any) => ({ ...p, team: 'away' }));
    console.log(`[Sofascore] Felállás Adat kinyerve: ${homePlayers.length} hazai, ${awayPlayers.length} vendég játékos.`);
    return { home: homePlayers, away: awayPlayers };
}

// === 1. FÁZIS JAVÍTÁS (HIÁNYZÓK) ===
function processSofascoreLineups(
    lineups: { home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null
): ICanonicalPlayerStats {
    const canonicalStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        key_players_ratings: { home: {}, away: {} }
    };
    if (!lineups) return canonicalStats;
    const POS_MAP: { [key: string]: 'Támadó' | 'Középpályás' | 'Védő' |
'Kapus' } = {
        'F': 'Támadó', 'Attacker': 'Támadó',
        'M': 'Középpályás', 'Midfielder': 'Középpályás',
        'D': 'Védő', 'Defender': 'Védő',
        'G': 'Kapus', 'Goalkeeper': 'Kapus'
    };
    const processSide = (players: ISofascoreRawPlayer[], side: 'home' | 'away') => {
        const ratingsByPosition: { [pos: string]: number[] } = { 'Támadó': [], 'Középpályás': [], 'Védő': [], 'Kapus': [] };
        players.forEach(p => {
            if (!p || !p.player) return; 
            const position = POS_MAP[p.player.position] || 'Középpályás';
            const ratingValue = parseFloat(p.rating || '0');

            // === JAVÍTÁS (v54.2 / 1. Fázis) ===
            // A 'ratingValue === 0' hibásan azonosította (Source 1046)
            // a meccs előtti
            // kezdőket hiányzóként. Ezt a logikát eltávolítjuk.
            // (Eltávolítva a logikai blokk, ami a Source 1850-1856-ban volt)
            // === JAVÍTÁS VÉGE ===

            if (ratingValue > 0) {
     
                           if (ratingsByPosition[position]) {
                    ratingsByPosition[position].push(ratingValue);
                }
            }
        });
        for (const [pos, ratings] of Object.entries(ratingsByPosition)) {
            if (ratings.length > 0) {
                const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
                if (side === 'home') canonicalStats.key_players_ratings.home[pos] = avgRating;
                else canonicalStats.key_players_ratings.away[pos] = avgRating;
            }
        }
    };
    processSide(lineups.home, 'home');
    processSide(lineups.away, 'away');
    if (canonicalStats.home_absentees.length > 0 || canonicalStats.away_absentees.length > 0) {
        // Ez a log most már csak akkor fut, ha az API *valóban* hiányzókat jelent
        console.log(`[Sofascore Feldolgozó] Hiányzók azonosítva: ${canonicalStats.home_absentees.length} (H), ${canonicalStats.away_absentees.length} (A)`);
    }
    return canonicalStats;
}

// ... (fetchSofascoreData változatlan)
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string
): Promise<{ 
    advancedData: { xg_home: number;
xG_away: number } | null, 
    playerStats: ICanonicalPlayerStats 
}> {
    let result: { 
        advancedData: { xg_home: number;
xG_away: number } | null, 
        playerStats: ICanonicalPlayerStats 
    } = {
        advancedData: null,
        playerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        } as ICanonicalPlayerStats
    };
    try {
        const [homeTeamId, awayTeamId] = await Promise.all([
            getSofascoreTeamId(homeTeamName), // v54.3-as verzió
            getSofascoreTeamId(awayTeamName)  // v54.3-as verzió
        ]);
        if (!homeTeamId || !awayTeamId) {
            console.warn(`[Sofascore Provider] Csapat ID hiba (${homeTeamName}=${homeTeamId} | ${awayTeamName}=${awayTeamId}). A Sofascore kérés leáll.`);
            return result;
        }

        const eventId = await getSofascoreEventId(homeTeamId, awayTeamId);
        if (!eventId) {
            console.warn(`[Sofascore Provider] Event ID nem található (${homeTeamId} vs ${awayTeamId}). A Sofascore kérés leáll.`);
            return result;
        }

        const [xgData, lineupsData] = await Promise.all([
            getSofascoreXg(eventId),
            getSofascoreLineups(eventId)
        ]);
        if (xgData) {
            result.advancedData = {
                xg_home: xgData.home,
                xG_away: xgData.away 
            };
        }
        result.playerStats = processSofascoreLineups(lineupsData); // v54.2 (1. Fázis) javítással
    } catch (e: any) {
        console.warn(`[Sofascore Provider] Kritikus hiba a teljes Sofascore folyamat során: ${e.message}`);
    }
    return result;
}

export const providerName = 'sofascore-provider';
