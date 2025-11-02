// providers/sofascoreProvider.ts (v52.13 - Végpont Javítás)
// MÓDOSÍTÁS: A getSofascoreTeamId hibás '/v2/teams/search' végpontja '/search'-re cserélve.
// MÓDOSÍTÁS: A válasz-értelmező 'data.teams'-ről 'data.results'-re javítva.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
import { makeRequest } from './common/utils.js';

// Kanonikus típusok importálása
import type { ICanonicalPlayerStats, ICanonicalPlayer } from '../src/types/canonical.d.ts';

// --- Típusdefiníciók a Sofascore válaszokhoz (Kiterjesztve) ---
interface ISofascoreTeam {
    name: string;
    id: number;
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
// Nyers játékos adatok a /get-lineups végpontról
interface ISofascoreRawPlayer {
    player: {
        id: number;
        name: string;
        position: 'G' | 'D' | 'M' | 'F' | 'Attacker' | 'Defender' | 'Midfielder' | 'Goalkeeper'; // Poszt
    };
    rating?: string; // Pl. "7.5", hiányzik, ha még nem játszott
    position?: string; // Fő poszt (redundáns, de hasznos)
    substitute?: boolean; // Csere?
}

// --- Cache-ek ---
const sofaTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7 }); // 1 hét
const sofaEventCache = new NodeCache({ stdTTL: 3600 * 6 }); // 6 óra

/**
 * Központi API hívó a Sofascore RapidAPI végponthoz.
 */
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
        // A 404-es hibát (Endpoint does not exist) itt kapja el
        console.error(`[Sofascore API Hiba] Endpoint: ${endpoint} - ${error.message}`);
        return null;
    }
}

/**
 * 1. Lépés: Megkeresi egy csapat Sofascore ID-ját a neve alapján.
 */
async function getSofascoreTeamId(teamName: string): Promise<number | null> {
    const cacheKey = `team_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;

    console.log(`[Sofascore] Csapat keresés: "${teamName}"`);

    // === JAVÍTÁS (A KRITIKUS SOR) ===
    // Lecseréljük a hibás '/v2/teams/search' végpontot a képen (image_50b14b.png)
    // látható gyökérszintű '/search' végpontra.
    // A paramétert 'name'-ről 'q'-ra (query) változtatjuk, ami a 'search' végpontok sztenderdje.
    const data = await makeSofascoreRequest('/search', { q: teamName });
    // === JAVÍTÁS VÉGE ===
    
    // A '/search' végpont 'results' tömböt ad vissza
    if (!data?.results) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' mező (Endpoint: /search).`);
        return null;
    }

    // A 'results' tömb feldolgozása (visszaállítva a 44. lépés logikájára)
    const teams: ISofascoreTeam[] = data.results
        .filter((r: any) => r.type === 'team' && r.entity.sport.name === 'Football')
        .map((r: any) => r.entity);

    if (teams.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés: Nincs találat erre: "${teamName}"`);
        return null;
    }
    
    const teamNames = teams.map(t => t.name);
    const bestMatch = findBestMatch(teamName, teamNames);
    
    if (bestMatch.bestMatch.rating > 0.7) {
        const foundTeam = teams[bestMatch.bestMatchIndex];
        console.log(`[Sofascore] Csapat ID Találat: "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[Sofascore] Csapat ID Találat: Alacsony egyezés (${bestMatch.bestMatch.rating}) erre: "${teamName}"`);
    return null;
}

/**
 * 2. Lépés: Megkeresi a meccs (Event) Sofascore ID-ját a csapat ID-k alapján.
 */
async function getSofascoreEventId(homeTeamId: number, awayTeamId: number): Promise<number | null> {
    const cacheKey = `event_${homeTeamId}_vs_${awayTeamId}`;
    const cachedId = sofaEventCache.get<number>(cacheKey);
    if (cachedId) return cachedId;

    // A képen (image_50b14b.png) látható 'teams/get-next-events'
    // logikai megfelelője a /v1/team/get-next-events
    const data = await makeSofascoreRequest('/v1/team/get-next-events', { teamId: homeTeamId, page: 0 });

    if (!data?.events) {
        console.warn(`[Sofascore] Meccs keresés sikertelen: Nincs 'events' mező (Hazai ID: ${homeTeamId}).`);
        return null;
    }

    const events: ISofascoreEvent[] = data.events;
    
    // Keressük az első meccset, ahol a vendég csapat ID-ja egyezik
    const foundEvent = events.find(event => event.awayTeam?.id === awayTeamId);

    if (foundEvent) {
        console.log(`[Sofascore] Meccs ID Találat: (Event ID: ${foundEvent.id})`);
        sofaEventCache.set(cacheKey, foundEvent.id);
        return foundEvent.id;
    }

    console.warn(`[Sofascore] Meccs ID Találat: Nem található ${homeTeamId} vs ${awayTeamId} meccs a következő események között.`);
    return null;
}

/**
 * 3. Lépés: Lekéri a valós xG adatokat a meccs ID alapján.
 */
async function getSofascoreXg(eventId: number): Promise<ISofascoreXg | null> {
    // A képen (image_50402c.png) látható 'matches/get-statistics'
    // logikai megfelelője a /v1/event/get-statistics
    const data = await makeSofascoreRequest('/v1/event/get-statistics', { eventId: eventId });

    if (!data?.statistics) {
        console.warn(`[Sofascore] xG Hiba: Nincs 'statistics' mező (Event ID: ${eventId}).`);
        return null;
    }

    try {
        let expectedGoalsRow: any = null;
        for (const statGroup of data.statistics) {
            // Néha 'Expected', néha 'Attacking' csoportban van
            if (statGroup.groupName === 'Expected' || statGroup.groupName === 'Attacking') {
                expectedGoalsRow = statGroup.rows.find((row: any) => row.name === 'Expected goals (xG)');
                if (expectedGoalsRow) break;
            }
        }

        if (expectedGoalsRow && expectedGoalsRow.home && expectedGoalsRow.away) {
            const xG: ISofascoreXg = { // Itt 'xG' a változónév
                home: parseFloat(expectedGoalsRow.home),
                away: parseFloat(expectedGoalsRow.away)
            };
            console.log(`[Sofascore] xG Adat kinyerve: H=${xG.home}, A=${xG.away}`);
            return xG; // 'xG' visszaadása
        } else {
            console.warn(`[Sofascore] xG Hiba: Nem található 'Expected goals (xG)' sor (Event ID: ${eventId}).`);
            return null;
        }
    } catch (e: any) {
        console.error(`[Sofascore] xG Feldolgozási Hiba: ${e.message}`);
        return null;
    }
}

/**
 * 4. Lépés: Lekéri a felállásokat (lineups) a meccs ID alapján.
 */
async function getSofascoreLineups(eventId: number): Promise<{ home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null> {
    // A képen (image_4fcbb0.png) látható 'matches/get-lineups'
    // logikai megfelelője a /v1/event/get-lineups
    const data = await makeSofascoreRequest('/v1/event/get-lineups', { eventId: eventId });

    if (!data?.home && !data?.away) {
        console.warn(`[Sofascore] Felállás Hiba: Nincs 'home' vagy 'away' mező (Event ID: ${eventId}).`);
        return null;
    }
    
    const homePlayers = (data.home.players || []).map((p: any) => ({ ...p, team: 'home' }));
    const awayPlayers = (data.away.players || []).map((p: any) => ({ ...p, team: 'away' }));

    console.log(`[Sofascore] Felállás Adat kinyerve: ${homePlayers.length} hazai, ${awayPlayers.length} vendég játékos.`);
    return { home: homePlayers, away: awayPlayers };
}

/**
 * === FELDOLGOZÓ FÜGGVÉNY (v52.9) ===
 * Feldolgozza a nyers Sofascore felállás adatokat a Model.ts
 * által elvárt ICanonicalPlayerStats formátumra.
 */
function processSofascoreLineups(
    lineups: { home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null
): ICanonicalPlayerStats {
    
    const canonicalStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        key_players_ratings: { home: {}, away: {} }
    };

    if (!lineups) return canonicalStats;
    
    const POS_MAP: { [key: string]: 'Támadó' | 'Középpályás' | 'Védő' | 'Kapus' } = {
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
            
            const isAbsent = p.substitute === false && ratingValue === 0;
            
            if (isAbsent) {
                const absentee: ICanonicalPlayer = {
                    name: p.player.name,
                    role: position,
                    importance: 'key',
                    status: 'confirmed_out', 
                    rating_last_5: 0
                };
                if (side === 'home') canonicalStats.home_absentees.push(absentee);
                else canonicalStats.away_absentees.push(absentee);
            }
            
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
        console.log(`[Sofascore Feldolgozó] Hiányzók azonosítva: ${canonicalStats.home_absentees.length} (H), ${canonicalStats.away_absentees.length} (A)`);
    }

    return canonicalStats;
}


/**
 * FŐ EXPORTÁLT FUNKCIÓ (MÓDOSÍTVA v52.12)
 */
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string
): Promise<{ 
    advancedData: { xg_home: number; xG_away: number } | null, 
    playerStats: ICanonicalPlayerStats 
}> {
    
    // Explicit típus a kezdeti 'result' objektumhoz (TS2322 javítás)
    let result: { 
        advancedData: { xg_home: number; xG_away: number } | null, 
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
        // 1. Csapat ID-k lekérése párhuzamosan
        const [homeTeamId, awayTeamId] = await Promise.all([
            getSofascoreTeamId(homeTeamName),
            getSofascoreTeamId(awayTeamName)
        ]);

        if (!homeTeamId || !awayTeamId) {
            console.warn(`[Sofascore Provider] Csapat ID hiba (${homeTeamName} vagy ${awayTeamName}). A Sofascore kérés leáll.`);
            return result; // Visszatérés üres adatokkal
        }

        // 2. Meccs ID lekérése
        const eventId = await getSofascoreEventId(homeTeamId, awayTeamId);
        if (!eventId) {
            console.warn(`[Sofascore Provider] Event ID nem található (${homeTeamId} vs ${awayTeamId}). A Sofascore kérés leáll.`);
            return result; // Visszatérés üres adatokkal
        }

        // 3. xG és Felállások lekérése párhuzamosan
        const [xgData, lineupsData] = await Promise.all([
            getSofascoreXg(eventId),
            getSofascoreLineups(eventId)
        ]);

        // 4. Eredmények feldolgozása
        if (xgData) {
            result.advancedData = {
                xg_home: xgData.home,
                xG_away: xgData.away // (TS2551 javítva)
            };
        }
        
        // A nyers 'lineupsData' átadása a feldolgozó funkciónak.
        result.playerStats = processSofascoreLineups(lineupsData);

    } catch (e: any) {
        console.warn(`[Sofascore Provider] Kritikus hiba a teljes Sofascore folyamat során: ${e.message}`);
    }

    return result;
}

export const providerName = 'sofascore-provider';