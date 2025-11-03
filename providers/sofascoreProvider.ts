// providers/sofascoreProvider.ts (v54.1 - Dinamikus Kontextus & Hiányzó Javítás)
// MÓDOSÍTÁS: 
// 1. getSofascoreTeamId: Dinamikus ország-kontextust használ a hardkódolt 'USA' helyett.
// 2. processSofascoreLineups: Javítva a "11 hiányzó" logikai hiba.

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
    // Bővítés a kontextuális szűréshez
    country?: {
        name?: string;
        alpha2?: string;
    };
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
// JAVÍTOTT INTERFÉSZ (v54.1)
interface ISofascoreRawPlayer {
    player: {
        id: number;
        name: string;
        position: 'G' | 'D' | 'M' | 'F' | 'Attacker' | 'Defender' | 'Midfielder' | 'Goalkeeper';
    };
    rating?: string;
    position?: string;
    substitute?: boolean;
    missing?: boolean; // Feltételezett mező a hiányzók azonosítására
    status?: { // Alternatív mező
        code: number;
        description: string; // pl. "Missing"
    };
}


// --- Cache-ek ---
const sofaTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7 }); // 1 hét
const sofaEventCache = new NodeCache({ stdTTL: 3600 * 6 }); // 6 óra

// --- API HÍVÓ SEGÉDFÜGGVÉNY (Változatlan) ---
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
 * (OPTIMALIZÁLT v54.1: Dinamikus kontextuális szűrés)
 */
async function getSofascoreTeamId(teamName: string, countryContext: string | null): Promise<number | null> {
    // A kontextust a cache kulcsba is beépítjük
    const countryCode = countryContext ? (countryContext.length === 2 ? countryContext.toUpperCase() : countryContext) : 'GLOBAL';
    const cacheKey = `team_v54.1_${teamName.toLowerCase().replace(/\s/g, '')}_ctx_${countryCode}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;
    
    console.log(`[Sofascore] Csapat keresés (v54.1 Kontextuális: ${countryCode}): "${teamName}"`);
    
    const data = await makeSofascoreRequest('/search', { q: teamName });
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' tömb (Endpoint: /search).`);
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
        console.warn(`[Sofascore] Csapatkeresés: Nincs 'Football' típusú 'team' találat erre: "${teamName}"`);
        return null;
    }

    // === KONTEXTUÁLIS SZŰRÉS (v54.1 JAVÍTVA) ===
    let teamsToSearch: ISofascoreTeam[] = allTeams;
    let searchContext = "Globális";

    // Csak akkor szűrünk, ha kaptunk érvényes ország kontextust
    if (countryContext) {
        const lowerCountryContext = countryContext.toLowerCase();
        const filteredTeams = allTeams.filter(t => 
            t.country?.name?.toLowerCase() === lowerCountryContext || 
            t.country?.alpha2?.toLowerCase() === lowerCountryContext
        );

        if (filteredTeams.length > 0) {
            teamsToSearch = filteredTeams;
            searchContext = countryContext;
        } else {
            // Nem találtunk egyező országú csapatot, visszalépünk globális keresésre
            console.warn(`[Sofascore] Kontextus Hiba: Nincs "${countryContext}" találat a(z) "${teamName}" keresésre. Visszalépés globális keresésre.`);
        }
    }
    // === SZŰRÉS VÉGE ===

    const normalizedInput = teamName.toLowerCase();
    let foundTeam: ISofascoreTeam | null = null;

    // 1. Lépés: Tökéletes egyezés (a szűkített listán)
    foundTeam = teamsToSearch.find(t => t.name.toLowerCase() === normalizedInput) || null;
    if (foundTeam) {
        console.log(`[Sofascore] Csapat ID Találat (1/2 - Tökéletes ${searchContext}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }

    // 2. Lépés: Hasonlósági egyezés (Fuzzy Match) - (a szűkített listán)
    const teamNames = teamsToSearch.map(t => t.name);
    if (teamNames.length === 0) {
         console.warn(`[Sofascore] Csapat ID Találat: Nincs érvényes jelölt a(z) "${teamName}" keresésre (${searchContext} kontextus).`);
        return null;
    }

    const bestMatch = findBestMatch(teamName, teamNames);
    // A 0.4-es küszöbérték szükséges az "LAFC" vs "Los Angeles FC" egyezéshez.
    // Most már biztonságos, mert a kontextus szűrés (remélhetőleg) eltávolítja a többi "LAFC"-t.
    const FUZZY_THRESHOLD = 0.4; 
    if (bestMatch.bestMatch.rating >= FUZZY_THRESHOLD) {
        foundTeam = teamsToSearch[bestMatch.bestMatchIndex];
        console.log(`[Sofascore] Csapat ID Találat (2/2 - Hasonlóság ${searchContext} >= ${FUZZY_THRESHOLD}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id}, Rating: ${bestMatch.bestMatch.rating})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[Sofascore] Csapat ID Találat: Sikertelen egyeztetés (${searchContext} kontextus). Alacsony egyezés (${bestMatch.bestMatch.rating}) erre: "${teamName}"`);
    return null;
}

// ... (getSofascoreEventId változatlan) ...
async function getSofascoreEventId(homeTeamId: number, awayTeamId: number): Promise<number | null> {
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

// ... (getSofascoreXg változatlan) ...
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

// ... (getSofascoreLineups változatlan) ...
async function getSofascoreLineups(eventId: number): Promise<{ home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null> {
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


/**
 * 4. Lépés: Feldolgozza a Sofascore felállás adatokat.
 * (JAVÍTVA v54.1: A "11 hiányzó" hiba javítása)
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

            // === JAVÍTOTT HIÁNYZÓ LOGIKA (v54.1) ===
            // A régi, hibás logika:
            // const isAbsent = p.substitute === false && ratingValue === 0;
            
            // Új, robusztus logika:
            // Csak azt tekintjük hiányzónak, akit az API expliciten annak jelöl.
            const isExplicitlyMissing = p.missing === true;
            const statusDescription = p.status?.description?.toLowerCase() || '';
            const isStatusMissing = statusDescription === 'missing' || statusDescription === 'absent';
            
            const isAbsent = isExplicitlyMissing || isStatusMissing;
            // === JAVÍTÁS VÉGE ===

            if (isAbsent) {
                const absentee: ICanonicalPlayer = {
                    name: p.player.name,
                    role: position,
                    importance: 'key', // Ezt később finomíthatjuk a játékos átlagos ratingje alapján
                    status: 'confirmed_out', 
                    rating_last_5: 0 // Nem tudjuk a ratinget, 0-n hagyjuk
                };
                if (side === 'home') canonicalStats.home_absentees.push(absentee);
                else canonicalStats.away_absentees.push(absentee);
            }
            
            // A rating feldolgozása (ez helyes volt)
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
 * FŐ FUNKCIÓ: Lefuttatja a teljes Sofascore adatgyűjtési folyamatot.
 * (JAVÍTVA v54.1: Fogadja a 'countryContext'-et)
 */
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string,
    countryContext: string | null // Új paraméter
): Promise<{ 
    advancedData: { xg_home: number; xG_away: number } | null, 
    playerStats: ICanonicalPlayerStats 
}> {
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
        const [homeTeamId, awayTeamId] = await Promise.all([
            getSofascoreTeamId(homeTeamName, countryContext), // Átadjuk a kontextust
            getSofascoreTeamId(awayTeamName, countryContext)  // Átadjuk a kontextust
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
        result.playerStats = processSofascoreLineups(lineupsData);
    } catch (e: any) {
        console.warn(`[Sofascore Provider] Kritikus hiba a teljes Sofascore folyamat során: ${e.message}`);
    }
    return result;
}

export const providerName = 'sofascore-provider';
