// providers/sofascoreProvider.ts (v52.7 - Új Provider)
// Ez a modul felelős a Sofascore API-val való kommunikációért,
// hogy megbízható xG és játékos-statisztikai adatokat nyerjen ki.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
import { makeRequest } from './common/utils.js'; // A központi hívót használjuk

// Kanonikus típusok importálása
import type { ICanonicalPlayerStats } from '../src/types/canonical.d.ts';

// --- Típusdefiníciók a Sofascore válaszokhoz (egyszerűsítve) ---
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
interface ISofascorePlayerRating {
    player: { id: number; name: string; };
    rating: string; // Pl. "7.5"
    position: string; // Pl. 'M', 'D', 'F'
}

// --- Cache-ek a Sofascore ID-k és adatok tárolására ---
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
        // A 'makeRequest' az 'utils.ts'-ből származó általános hívó
        const response = await makeRequest(config.url as string, config, 0); 
        return response.data;
    } catch (error: any) {
        console.error(`[Sofascore API Hiba] Endpoint: ${endpoint} - ${error.message}`);
        return null; // Hiba esetén null-t adunk vissza, hogy a folyamat folytatódhasson
    }
}

/**
 * 1. Lépés: Megkeresi egy csapat Sofascore ID-ját a neve alapján.
 */
async function getSofascoreTeamId(teamName: string): Promise<number | null> {
    const cacheKey = `team_${teamName.toLowerCase().replace(/\s/g, '')}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;

    const data = await makeSofascoreRequest('/v1/search/all', { name: teamName });
    
    // A válasz 'results' tömböt tartalmaz, amelyben 'team' objektumok vannak
    if (!data?.results) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' mező.`);
        return null;
    }

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

    // Lekérjük a hazai csapat következő 5 meccsét
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
    const data = await makeSofascoreRequest('/v1/event/get-statistics', { eventId: eventId });

    // Az xG adat "statistics[0].groups[...].rows" alatt van elrejtve
    if (!data?.statistics) {
        console.warn(`[Sofascore] xG Hiba: Nincs 'statistics' mező (Event ID: ${eventId}).`);
        return null;
    }

    try {
        let expectedGoalsRow: any = null;
        for (const statGroup of data.statistics) {
            if (statGroup.groupName === 'Expected') {
                expectedGoalsRow = statGroup.rows.find((row: any) => row.name === 'Expected goals (xG)');
                break;
            }
        }

        if (expectedGoalsRow && expectedGoalsRow.home && expectedGoalsRow.away) {
            const xg: ISofascoreXg = {
                home: parseFloat(expectedGoalsRow.home),
                away: parseFloat(expectedGoalsRow.away)
            };
            console.log(`[Sofascore] xG Adat kinyerve: H=${xg.home}, A=${xg.away}`);
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

/**
 * 4. Lépés: Lekéri a játékosok értékeléseit (Player Ratings) a meccs ID alapján.
 */
async function getSofascorePlayerRatings(eventId: number): Promise<ISofascorePlayerRating[] | null> {
    const data = await makeSofascoreRequest('/v1/event/get-lineups', { eventId: eventId });

    if (!data?.home?.players && !data?.away?.players) {
        console.warn(`[Sofascore] Játékos Hiba: Nincs 'players' mező (Event ID: ${eventId}).`);
        return null;
    }

    const allPlayers: ISofascorePlayerRating[] = [];
    
    // Kezdő és cserejátékosok (hazai)
    (data.home?.players || []).forEach((p: any) => {
        if (p.rating && p.player) {
            allPlayers.push({ player: p.player, rating: p.rating, position: p.position });
        }
    });
    // Kezdő és cserejátékosok (vendég)
    (data.away?.players || []).forEach((p: any) => {
        if (p.rating && p.player) {
            allPlayers.push({ player: p.player, rating: p.rating, position: p.position });
        }
    });

    console.log(`[Sofascore] Játékos Adat kinyerve: ${allPlayers.length} játékos értékelés.`);
    return allPlayers;
}


/**
 * FŐ EXPORTÁLT FUNKCIÓ
 * Orchestrálja a Sofascore hívásokat, hogy visszaadja az xG-t és a játékos adatokat.
 * Ezt a DataFetch.ts hívja meg.
 */
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string
): Promise<{ 
    advancedData: { xg_home: number; xg_away: number } | null, 
    playerStats: ICanonicalPlayerStats 
}> {
    
    // Alapértelmezett (üres) visszatérési érték
    const result = {
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
            throw new Error("A csapat ID-k nem találhatók a Sofascore-ban.");
        }

        // 2. Meccs ID lekérése
        const eventId = await getSofascoreEventId(homeTeamId, awayTeamId);
        if (!eventId) {
            throw new Error("A meccs (Event) ID nem található a Sofascore-ban.");
        }

        // 3. xG és Játékos-értékelések lekérése párhuzamosan
        const [xgData, playerRatings] = await Promise.all([
            getSofascoreXg(eventId),
            getSofascorePlayerRatings(eventId)
        ]);

        // 4. Eredmények feldolgozása
        if (xgData) {
            result.advancedData = {
                xg_home: xgData.home,
                xg_away: xGData.away
            };
        }

        // TODO: A 'playerRatings' adatokat (amelyek most már valósak)
        // fel kell dolgozni, hogy feltöltsék a 'result.playerStats'
        // ICanonicalPlayerStats interfészt (pl. hiányzók azonosítása,
        // kulcsjátékosok átlagolása poszt szerint).
        // Jelenleg ez a logika még hiányzik, de az adatgyűjtés már valós.

    } catch (e: any) {
        console.warn(`[Sofascore Provider] Hiba a teljes folyamat során: ${e.message}. A rendszer a becsült adatokra támaszkodik.`);
    }

    return result;
}

export const providerName = 'sofascore-provider';
