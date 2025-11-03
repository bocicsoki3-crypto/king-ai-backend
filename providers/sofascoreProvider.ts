// providers/sofascoreProvider.ts (v54.9 - TS18048 Végleges Javítás)
// MÓDOSÍTÁS: 
// 1. A 'processSofascoreIncidents' függvényben a 'forEach' + 'if'
//    logikát lecseréljük egy robusztus '.filter()' hívásra,
//    hogy a TypeScript fordító garantáltan tudja, hogy 'p.player' létezik.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
import { makeRequest } from './common/utils.js';
// Kanonikus típusok importálása
import type { ICanonicalPlayerStats, ICanonicalPlayer } from '../src/types/canonical.d.ts';

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
// Ez a /get-lineups válasza (Ratingeket ad)
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

// Ez a /get-incidents válasza
interface ISofascoreIncidentPayload {
    incidents?: ISofascoreIncident[]; 
    home?: {
        missing?: ISofascoreRawPlayer[]; 
    };
    away?: {
        missing?: ISofascoreRawPlayer[];
    };
}
// Az 'incidents' tömb egy eleme
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


// --- getSofascoreTeamId (v54.2 - U20 Szűrővel, Változatlan) ---
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

// --- getSofascoreLineups (Változatlan, ez adja a Ratingeket) ---
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

// --- getSofascoreIncidents (v54.6 - Változatlan) ---
async function getSofascoreIncidents(eventId: number): Promise<ISofascoreIncidentPayload | null> {
    const cacheKey = `incidents_v1_${eventId}`;
    const cached = sofaIncidentsCache.get<ISofascoreIncidentPayload>(cacheKey);
    if (cached) {
        console.log(`[Sofascore] Incidens/Hiányzó adat Találat (Cache): ${eventId}`);
        return cached;
    }
    
    const data = await makeSofascoreRequest('/matches/get-incidents', { matchId: eventId });
    
    if (!data) {
        console.warn(`[Sofascore] Hiányzók Hiba: Az '/matches/get-incidents' végpont hívása sikertelen (Event ID: ${eventId}).`);
        return null;
    }
    
    sofaIncidentsCache.set(cacheKey, data);
    console.log(`[Sofascore] Incidens/Hiányzó adat kinyerve (Event ID: ${eventId}).`);
    return data;
}


/**
 * Feldolgozza a Sofascore felállás adatokat (CSAK a ratingekért).
 * (v54.2 - "11 Hiányzó" hiba javítva)
 */
function processSofascoreLineups(
    lineups: { home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null
): Pick<ICanonicalPlayerStats, 'key_players_ratings'> { 
    
    const key_players_ratings: ICanonicalPlayerStats['key_players_ratings'] = { home: {}, away: {} };
    if (!lineups) return { key_players_ratings };
    
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
            
            if (ratingValue > 0) {
                 if (ratingsByPosition[position]) {
                    ratingsByPosition[position].push(ratingValue);
                }
            }
        });

        for (const [pos, ratings] of Object.entries(ratingsByPosition)) {
            if (ratings.length > 0) {
                const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
                if (side === 'home') key_players_ratings.home[pos] = avgRating;
                else key_players_ratings.away[pos] = avgRating;
            }
        }
    };
    
    processSide(lineups.home, 'home');
    processSide(lineups.away, 'away');
    
    console.log(`[Sofascore Feldolgozó] Játékos értékelések (ratingek) feldolgozva a kezdőcsapatból.`);
    return { key_players_ratings };
}

/**
 * Feldolgozza az incidens adatokat és kinyeri a valós hiányzókat.
 * (JAVÍTVA v54.9 - TS18048 Végleges Javítás)
 */
function processSofascoreIncidents(
    incidentsData: ISofascoreIncidentPayload | null
): Pick<ICanonicalPlayerStats, 'home_absentees' | 'away_absentees'> {
    
    const absentees: Pick<ICanonicalPlayerStats, 'home_absentees' | 'away_absentees'> = {
        home_absentees: [],
        away_absentees: []
    };
    
    if (!incidentsData) return absentees;

    // === JAVÍTÁS (v54.9): .filter() használata a 'forEach' + 'if' helyett ===
    
    // 1. Logika: Keresés a 'home' és 'away' 'missing' tömbökben
    if (incidentsData.home?.missing) {
        incidentsData.home.missing
            // Garantálja, hogy p, p.player és p.player.name is létezik
            .filter((p): p is ISofascoreRawPlayer & { player: { id: number, name: string } } => 
                !!p && !!p.player && !!p.player.name
            ) 
            .forEach(p => { 
                absentees.home_absentees.push({
                    name: p.player.name,
                    role: 'Ismeretlen', 
                    importance: 'key',
                    status: 'confirmed_out',
                });
            });
    }
    if (incidentsData.away?.missing) {
         incidentsData.away.missing
            // Garantálja, hogy p, p.player és p.player.name is létezik
            .filter((p): p is ISofascoreRawPlayer & { player: { id: number, name: string } } => 
                !!p && !!p.player && !!p.player.name
            )
            .forEach(p => {
                absentees.away_absentees.push({
                    name: p.player.name,
                    role: 'Ismeretlen',
                    importance: 'key',
                    status: 'confirmed_out',
                });
            });
    }

    // 2. Logika: Keresés az 'incidents' tömbben (fallback)
    if (Array.isArray(incidentsData.incidents)) {
        incidentsData.incidents
            // Garantálja, hogy p, p.player és p.player.name is létezik
            .filter((p): p is ISofascoreIncident & { player: { id: number, name: string }, teamSide: 'home' | 'away' } =>
                !!p && !!p.player && !!p.player.name && !!p.teamSide
            )
            .forEach(p => {
                const isMissing = p.incidentType === 'injury' || p.injury === true || p.reason === 'Suspension';
                
                if (isMissing) {
                    const absentee: ICanonicalPlayer = {
                        name: p.player.name,
                        role: 'Ismeretlen',
                        importance: 'key',
                        status: 'confirmed_out',
                    };
                    
                    // Duplikáció elkerülése
                    if (p.teamSide === 'home' && !absentees.home_absentees.find(a => a.name === p.player.name)) {
                        absentees.home_absentees.push(absentee);
                    } else if (p.teamSide === 'away' && !absentees.away_absentees.find(a => a.name === p.player.name)) {
                        absentees.away_absentees.push(absentee);
                    }
                }
            });
    }
    // === JAVÍTÁS VÉGE ===

    
    if (absentees.home_absentees.length > 0 || absentees.away_absentees.length > 0) {
        console.log(`[Sofascore Feldolgozó] VALÓS HIÁNYZÓK azonosítva: ${absentees.home_absentees.length} (H), ${absentees.away_absentees.length} (A)`);
    } else {
        console.log(`[Sofascore Feldolgozó] Nincs explicit hiányzó az '/matches/get-incidents' végpont adatai között.`);
    }

    return absentees;
}


/**
 * FŐ FUNKCIÓ: Lefuttatja a teljes Sofascore adatgyűjtési folyamatot.
 * (JAVÍTVA v54.8: TS hiba javítva)
 */
export async function fetchSofascoreData(
    homeTeamName: string, 
    awayTeamName: string,
    countryContext: string | null 
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
            getSofascoreTeamId(homeTeamName, countryContext), 
            getSofascoreTeamId(awayTeamName, countryContext) 
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

        const [xgData, lineupsData, incidentsData] = await Promise.all([
            getSofascoreXg(eventId),
            getSofascoreLineups(eventId),
            getSofascoreIncidents(eventId) 
        ]);

        if (xgData) {
            result.advancedData = {
                xg_home: xgData.home,
                // === JAVÍTÁS (TS2304) ===
                xG_away: xgData.away 
                // === JAVÍTÁS VÉGE ===
            };
        }
        
        // Két külön feldolgozó függvény hívása
        const playerRatingsData = processSofascoreLineups(lineupsData);
        const playerAbsenteesData = processSofascoreIncidents(incidentsData); // v54.9-es javított hívás

        // Az eredmények egyesítése a végső ICanonicalPlayerStats objektumba
        result.playerStats = {
            key_players_ratings: playerRatingsData.key_players_ratings,
            home_absentees: playerAbsenteesData.home_absentees,
            away_absentees: playerAbsenteesData.away_absentees
        };
        
    } catch (e: any) {
        console.warn(`[Sofascore Provider] Kritikus hiba a teljes Sofascore folyamat során: ${e.message}`);
    }
    return result;
}

export const providerName = 'sofascore-provider';