// FÁJL: providers/sofascoreProvider.ts
// VERZIÓ: v54.11 (Típus Hiba és Export Javítás)
// MÓDOSÍTÁS:
// 1. Az 'ISofascoreResponse' interfész EXPORTÁLVA,
//    hogy a DataFetch.ts (v54.44) importálhassa.
// 2. A 'rating_last_5' értékadása '|| null'-ról
//    '|| undefined'-ra javítva, hogy megfeleljen
//    a 'ICanonicalPlayer' típusnak (TS2322).

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
import { makeRequest } from './common/utils.js';
// Kanonikus típusok importálása
import type { ICanonicalPlayerStats, ICanonicalPlayer } from '../src/types/canonical.d.ts';

// === JAVÍTÁS (v54.44): Típus exportálása ===
export interface ISofascoreResponse {
    advancedData: { 
        xg_home: number;
        xG_away: number; // Figyelem a nagy 'G'-re
    } | null;
    playerStats: ICanonicalPlayerStats;
}
// === JAVÍTÁS VÉGE ===

// --- Típusdefiníciók (Kiterjesztve) ---
interface ISofascoreTeam {
    name: string;
    id: number;
    country?: { name?: string; alpha2?: string; };
    tournament?: { name?: string; id?: number; };
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
    reason?: string;
}
interface ISofascoreIncidentPayload {
    incidents?: ISofascoreIncident[];
    home?: {
        missing?: ISofascoreRawPlayer[]; 
    };
    away?: {
        missing?: ISofascoreRawPlayer[];
    };
}
interface ISofascoreIncident {
    player?: {
         id: number;
        name: string;
    };
    teamSide?: 'home' | 'away';
    incidentType?: 'injury' | 'card'; 
    injury?: boolean; 
    reason?: string;
}


// --- Cache-ek ---
const sofaTeamCache = new NodeCache({ stdTTL: 3600 * 24 * 7 });
const sofaEventCache = new NodeCache({ stdTTL: 3600 * 6 });
const sofaIncidentsCache = new NodeCache({ stdTTL: 3600 * 6 });

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


// --- getSofascoreTeamId (Változatlan) ---
async function getSofascoreTeamId(teamName: string, countryContext: string | null): Promise<number | null> {
    const countryCode = countryContext ? (countryContext.length === 2 ? countryContext.toUpperCase() : countryContext) : 'GLOBAL';
    const cacheKey = `team_v54.2_${teamName.toLowerCase().replace(/\s/g, '')}_ctx_${countryCode}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;
    
    console.log(`[Sofascore] Csapat keresés (v54.2 Kontextuális: ${countryCode}): "${teamName}"`);
    const data = await makeSofascoreRequest('/search', { q: teamName });
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' tömb (Endpoint: /search).`);
        return null;
    }

    const allTeams: ISofascoreTeam[] = data.results
        .filter((r: any) => 
            r.type === 'team' && 
            r.entity?.sport?.name === 'Football' && 
            r.entity.id &&
            r.entity.name &&
            !/U(19|20|21|23)/i.test(r.entity.name) && 
            !r.entity.name.toLowerCase().endsWith(" u20")
        )
        .map((r: any) => r.entity);

    if (allTeams.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés: Nincs 'Football' típusú (nem U20) 'team' találat erre: "${teamName}"`);
        return null;
    }

    let teamsToSearch: ISofascoreTeam[] = allTeams;
    let searchContext = "Globális";
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
            console.warn(`[Sofascore] Kontextus Hiba: Nincs "${countryContext}" találat a(z) "${teamName}" keresésre. Visszalépés globális keresésre.`);
        }
    }

    const normalizedInput = teamName.toLowerCase();
    let foundTeam: ISofascoreTeam | null = null;
    
    foundTeam = teamsToSearch.find(t => t.name.toLowerCase() === normalizedInput) || null;
    if (foundTeam) {
        console.log(`[Sofascore] Csapat ID Találat (1/2 - Tökéletes ${searchContext}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }

    const teamNames = teamsToSearch.map(t => t.name);
    if (teamNames.length === 0) {
         console.warn(`[Sofascore] Csapat ID Találat: Nincs érvényes jelölt a(z) "${teamName}" keresésre (${searchContext} kontextus).`);
         return null;
    }

    const bestMatch = findBestMatch(teamName, teamNames);
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

// --- getSofascoreEventId (Változatlan) ---
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

// --- getSofascoreXg (Változatlan) ---
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

// --- getSofascoreLineups (Változatlan) ---
async function getSofascoreLineups(eventId: number): Promise<{ home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null> {
    const data = await makeSofascoreRequest('/matches/get-lineups', { matchId: eventId });
    if (!data?.home || !data?.away) {
        console.warn(`[Sofascore] Lineup Hiba: Nincs 'home' vagy 'away' mező (Event ID: ${eventId}).`);
        return null;
    }
    
    const extractPlayers = (teamData: any): ISofascoreRawPlayer[] => {
        const players: ISofascoreRawPlayer[] = [];
        if (teamData.players && Array.isArray(teamData.players)) {
            players.push(...teamData.players);
        }
        return players.filter(p => p.player && p.player.id);
    };

    return {
        home: extractPlayers(data.home),
        away: extractPlayers(data.away)
    };
}

// --- getSofascoreIncidents (Változatlan) ---
async function getSofascoreIncidents(eventId: number): Promise<ISofascoreIncidentPayload | null> {
    const cacheKey = `incidents_v54.9_${eventId}`;
    const cached = sofaIncidentsCache.get<ISofascoreIncidentPayload>(cacheKey);
    if (cached) {
        console.log(`[Sofascore] Incidens/Hiányzó CACHE TALÁLAT (Event ID: ${eventId})`);
        return cached;
    }
    
    console.log(`[Sofascore] Incidens/Hiányzó adatok lekérése (Event ID: ${eventId})...`);
    const data = await makeSofascoreRequest('/matches/get-incidents', { matchId: eventId });

    if (!data) {
        console.warn(`[Sofascore] Incidens Hiba: Az API 'null' választ adott (Event ID: ${eventId}).`);
        return null;
    }
    
    const payload: ISofascoreIncidentPayload = {
        incidents: data.incidents || [],
        home: { missing: data.home?.missing || [] },
        away: { missing: data.away?.missing || [] }
    };
    
    sofaIncidentsCache.set(cacheKey, payload);
    return payload;
}

// --- processSofascoreData (v54.11 - JAVÍTVA) ---
// Feldolgozza a lineup és incident adatokat a kanonikus ICanonicalPlayerStats formátumra
function processSofascoreData(
    lineups: { home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null,
    incidents: ISofascoreIncidentPayload | null
): ICanonicalPlayerStats {
    
    const finalStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        key_players_ratings: { home: {}, away: {} }
    };

    const playerRatingMap: Map<number, { rating: number, position: string }> = new Map();
    const allPlayers: ISofascoreRawPlayer[] = [];
    if (lineups) {
        allPlayers.push(...lineups.home, ...lineups.away);
    }
    
    for (const p of allPlayers) {
        if (p.player && p.player.id && p.rating) {
            const ratingNum = parseFloat(p.rating);
            if (!isNaN(ratingNum)) {
                let canonicalPos = p.player.position; // G, D, M, F
                if (p.position) {
                    if (p.position === 'Attacker') canonicalPos = 'F';
                    if (p.position === 'Midfielder') canonicalPos = 'M';
                    if (p.position === 'Defender') canonicalPos = 'D';
                    if (p.position === 'Goalkeeper') canonicalPos = 'G';
                }
                playerRatingMap.set(p.player.id, { rating: ratingNum, position: canonicalPos });
            }
        }
    }

    const processMissingPlayers = (team: 'home' | 'away', missingList: ISofascoreRawPlayer[] | undefined) => {
        if (!missingList || !Array.isArray(missingList)) return;
        
        const validMissingList = missingList.filter(p => p && p.player && p.player.id);

        for (const p of validMissingList) {
            const ratingData = playerRatingMap.get(p.player.id);
            const player: ICanonicalPlayer = {
                name: p.player.name,
                role: p.player.position,
                importance: ratingData ? 'key' : (p.reason ? 'regular' : 'regular'),
                status: 'confirmed_out',
                // === JAVÍTÁS (v54.11): 'null' -> 'undefined' a TS2322 hiba javítására ===
                rating_last_5: ratingData?.rating || undefined
            };
            
            if (team === 'home') {
                finalStats.home_absentees.push(player);
            } else {
                finalStats.away_absentees.push(player);
            }
        }
    };
    
    processMissingPlayers('home', incidents?.home?.missing);
    processMissingPlayers('away', incidents?.away?.missing);

    if (incidents?.incidents) {
        for (const incident of incidents.incidents) {
            if ((incident.incidentType === 'injury' || incident.injury) && incident.player && incident.teamSide) {
                const existing = (incident.teamSide === 'home' ? finalStats.home_absentees : finalStats.away_absentees);
                if (existing.some(p => p.name === incident.player!.name)) {
                    continue; 
                }
                
                const ratingData = playerRatingMap.get(incident.player.id);
                const player: ICanonicalPlayer = {
                    name: incident.player.name,
                    role: ratingData?.position || 'Ismeretlen',
                    importance: ratingData ? 'key' : 'regular',
                    status: 'confirmed_out',
                    // === JAVÍTÁS (v54.11): 'null' -> 'undefined' a TS2322 hiba javítására ===
                    rating_last_5: ratingData?.rating || undefined
                };
                
                if (incident.teamSide === 'home') {
                    finalStats.home_absentees.push(player);
                } else {
                    finalStats.away_absentees.push(player);
                }
            }
        }
    }
    
    return finalStats;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY (Változatlan) ---
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string,
    countryContext: string | null
): Promise<ISofascoreResponse | null> {
    
    const [homeTeamId, awayTeamId] = await Promise.all([
        getSofascoreTeamId(homeTeamName, countryContext),
        getSofascoreTeamId(awayTeamName, countryContext)
    ]);

    if (!homeTeamId || !awayTeamId) {
        console.warn(`[Sofascore] Folyamat megszakítva: Nem található mindkét csapat ID (H: ${homeTeamId}, A: ${awayTeamId}).`);
        return null;
    }
    
    const eventId = await getSofascoreEventId(homeTeamId, awayTeamId);
    if (!eventId) {
        console.warn(`[Sofascore] Folyamat megszakítva: Nem található a meccs ID (H: ${homeTeamId}, A: ${awayTeamId}).`);
        return null;
    }
    
    console.log(`[Sofascore] Párhuzamos adatlekérés indul (Event ID: ${eventId})...`);
    const [
        xgData,
        lineupData,
        incidentData
    ] = await Promise.all([
        getSofascoreXg(eventId),
        getSofascoreLineups(eventId),
        getSofascoreIncidents(eventId)
    ]);
    
    const playerStats = processSofascoreData(lineupData, incidentData);
    
    const advancedData = (xgData && xgData.home != null && xgData.away != null)
        ? { xg_home: xgData.home, xG_away: xgData.away }
        : null;

    if (!advancedData) {
        console.warn(`[Sofascore] Hiányzó xG adat (Event ID: ${eventId}). 'advancedData' null lesz.`);
    }
    if (playerStats.home_absentees.length === 0 && playerStats.away_absentees.length === 0) {
        console.warn(`[Sofascore] Hiányzó hiányzó-adat (Event ID: ${eventId}). 'playerStats.absentees' üres lesz.`);
    }

    return {
        advancedData: advancedData,
        playerStats: playerStats
    };
}