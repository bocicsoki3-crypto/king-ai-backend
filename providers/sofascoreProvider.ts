// providers/sofascoreProvider.ts (v52.15 - Helyes Meccskeresés)
// MÓDOSÍTÁS: A getSofascoreEventId (2. lépés) teljesen átírva.
// A hibás '/teams/get-near-events' (404-es hiba) helyett
// most már a '/search' végpontot használja 'event' típussal.

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
 * (Ez a funkció most már csak a /checkhash-hoz hasonló diagnosztikai célra használatos,
 * mivel a 2. Lépés (getSofascoreEventId) már közvetlenül keres meccset)
 */
async function getSofascoreTeamId(teamName: string): Promise<number | null> {
    const cacheKey = `team_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;

    console.log(`[Sofascore] Csapat keresés: "${teamName}"`);

    // Helyes végpont: '/search' (a 50. lépésben javítva)
    const data = await makeSofascoreRequest('/search', { q: teamName });
    
    if (!data?.results) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' mező (Endpoint: /search).`);
        return null;
    }

    // A 'results' tömb feldolgozása
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
 * 2. Lépés: Megkeresi a meccs (Event) Sofascore ID-ját a csapatnevek alapján.
 * (MÓDOSÍTVA v52.15 - A 404-es hibát okozó /teams/get-near-events eltávolítva)
 */
async function getSofascoreEventId(homeTeamName: string, awayTeamName: string): Promise<number | null> {
    const cacheKey = `event_name_${homeTeamName.replace(/\s/g, '')}_vs_${awayTeamName.replace(/\s/g, '')}`;
    const cachedId = sofaEventCache.get<number>(cacheKey);
    if (cachedId) return cachedId;

    // === JAVÍTÁS (A KRITIKUS LOGIKA) ===
    // A /teams/get-near-events helyett a /search végpontot hívjuk,
    // de a hazai csapat nevére keresünk, és 'event' típust keresünk.
    console.log(`[Sofascore] Meccs keresés (Event Search): "${homeTeamName}"...`);
    const data = await makeSofascoreRequest('/search', { q: homeTeamName });

    if (!data?.results) {
        console.warn(`[Sofascore] Meccs keresés sikertelen: Nincs 'results' mező (Endpoint: /search).`);
        return null;
    }

    // Szűrés 'event' típusra
    const events: ISofascoreEvent[] = data.results
        .filter((r: any) => r.type === 'event' && r.entity.sport.name === 'Football')
        .map((r: any) => r.entity);

    if (events.length === 0) {
        console.warn(`[Sofascore] Meccs keresés: Nincs 'event' találat erre: "${homeTeamName}"`);
        return null;
    }

    // A 'awayTeamName' alapján keressük a legjobb egyezést a talált meccsek között
    const awayTeamNames = events.map(event => event.awayTeam.name);
    const bestMatch = findBestMatch(awayTeamName, awayTeamNames);

    if (bestMatch.bestMatch.rating > 0.7) {
        const foundEvent = events[bestMatch.bestMatchIndex];
        console.log(`[Sofascore] Meccs ID Találat: "${homeTeamName} vs ${awayTeamName}" -> "${foundEvent.homeTeam.name} vs ${foundEvent.awayTeam.name}" (Event ID: ${foundEvent.id})`);
        sofaEventCache.set(cacheKey, foundEvent.id);
        return foundEvent.id;
    }

    console.warn(`[Sofascore] Meccs ID Találat: Nem található "${awayTeamName}" nevű ellenfél a "${homeTeamName}" közelgő eseményei között.`);
    return null;
    // === JAVÍTÁS VÉGE ===
}

/**
 * 3. Lépés: Lekéri a valós xG adatokat a meccs ID alapján.
 */
async function getSofascoreXg(eventId: number): Promise<ISofascoreXg | null> {
    // A /v1/event/get-statistics végpont (a matches/get-statistics megfelelője)
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
    // A /v1/event/get-lineups végpont (a matches/get-lineups megfelelője)
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
 * FŐ EXPORTÁLT FUNKCIÓ (MÓDOSÍTVA v52.15)
 */
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string
): Promise<{ 
    advancedData: { xg_home: number; xG_away: number } | null, 
    playerStats: ICanonicalPlayerStats 
}> {
    
    // Explicit típus a kezdeti 'result' objektumhoz
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
        // === MÓDOSÍTÁS (v52.15) ===
        // A 'getSofascoreTeamId' hívások eltávolítva.
        // Helyette a 'getSofascoreEventId' már a neveket használja.
        const eventId = await getSofascoreEventId(homeTeamName, awayTeamName);
        // === MÓDOSÍTÁS VÉGE ===

        if (!eventId) {
            console.warn(`[Sofascore Provider] Event ID nem található (${homeTeamName} vs ${awayTeamName}). A Sofascore kérés leáll.`);
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
                xG_away: xgData.away 
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