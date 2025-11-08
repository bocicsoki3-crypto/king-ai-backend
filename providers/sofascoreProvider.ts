// FÁJL: providers/sofascoreProvider.ts
// VERZIÓ: v75.0 (Végső Típusjavítás: TS2339/TS2322 FIX)
// MÓDOSÍTÁS:
// 1. JAVÍTVA: A makeRequest import beillesztve a hiányzó dependenciához.
// 2. JAVÍTVA: Az ISofascoreRawPlayer interfészben a 'position' mező (ami a játékos objektum gyökérszintjén van) hozzáadva. 
//    Ez megszünteti a TS2339 hibát (Property 'position' does not exist on type 'ISofascoreRawPlayer') a kód azon részein,
//    ahol a Sofascore API néha a fő objektum gyökerében adja vissza a pozíciót.
// 3. JAVÍTVA: A processSofascoreData logikája változatlan, a konverzió stabil.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
// === JAVÍTÁS (v74.0): Hozzáadva a hiányzó makeRequest import ===
import { makeRequest } from './common/utils.js';
// === JAVÍTÁS VÉGE ===

// Kanonikus típusok importálása
import type { ICanonicalPlayerStats, ICanonicalPlayer } from '../src/types/canonical.d.ts';

// === TÍPUS SEGÉDFÜGGVÉNY A HIBÁHOZ (TS2322) ===
type CanonicalRole = ICanonicalPlayer['role'];

// A nyers angol pozíciók kanonikus magyar szerepkörre fordítása
function toCanonicalRole(rawPosition: string | undefined): CanonicalRole {
    if (!rawPosition) return 'Ismeretlen';
    const p = rawPosition.toLowerCase();
    
    // A hiba oka a nem 100%-os egyezés volt, a Sofascore adhat 'Forward' vagy 'Attacker' szavakat.
    if (p.includes('goalkeeper')) return 'Kapus';
    if (p.includes('defender')) return 'Védő';
    if (p.includes('midfielder')) return 'Középpályás';
    if (p.includes('attacker') || p.includes('forward')) return 'Támadó';
    
    // Kezeli a rövidítéseket (bár ez a Sofascore-ban ritka)
    if (p === 'g') return 'Kapus';
    if (p === 'd') return 'Védő';
    if (p === 'm') return 'Középpályás';
    if (p === 'f') return 'Támadó';
    
    return 'Ismeretlen';
}
// === VÉGE ===


// Típus exportálása a DataFetch.ts (v54.44) számára
export interface ISofascoreResponse {
    advancedData: { 
        xg_home: number;
        xG_away: number; // Figyelem a nagy 'G'-re
    } | null;
    playerStats: ICanonicalPlayerStats;
}

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
        // A Sofascore API VÁLTOZÓ pozíciója
        position: 'G' | 'D' | 'M' | 'F' | 'Attacker' | 'Defender' | 'Midfielder' | 'Goalkeeper' | string; 
    };
    rating?: string;
    // === JAVÍTÁS (v75.0): Ez hiányzott a korábbi definícióból ===
    position?: string; 
    // === JAVÍTÁS VÉGE ===
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
        position: string | undefined;
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


// === JAVÍTOTT (v56.3) getSofascoreTeamId (Változatlan, TS2322 nem érinti) ===
// Szigorúbb keresési logikával
async function getSofascoreTeamId(teamName: string, countryContext: string | null): Promise<number | null> {
    const countryCode = countryContext ? (countryContext.length === 2 ? countryContext.toUpperCase() : countryContext) : 'GLOBAL';
    const cacheKey = `team_v56.3_strict_${teamName.toLowerCase().replace(/\s/g, '')}_ctx_${countryCode}`;
    const cachedId = sofaTeamCache.get<number>(cacheKey);
    if (cachedId) return cachedId;
    
    console.log(`[Sofascore] Csapat keresés (v56.3 Szigorú: ${countryCode}): "${teamName}"`);
    const data = await makeSofascoreRequest('/search', { q: teamName });
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
        console.warn(`[Sofascore] Csapatkeresés sikertelen: "${teamName}". Nincs 'results' tömb (Endpoint: /search).`);
        return null;
    }

    // Utótag szűrő (pl. II, B, C, U23)
    const getSuffix = (name: string): string => {
        const lower = name.toLowerCase();
        if (lower.endsWith(" ii")) return "ii";
        if (lower.endsWith(" b")) return "b";
        if (lower.endsWith(" c")) return "c";
        if (lower.endsWith(" u23")) return "u23";
        if (lower.endsWith(" u21")) return "u21";
        if (lower.endsWith(" u20")) return "u20";
        if (lower.endsWith(" u19")) return "u19";
        return "none";
    };

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
    const inputSuffix = getSuffix(normalizedInput);

    // 1. Próba: Tökéletes Egyezés
    let foundTeam: ISofascoreTeam | null = null;
    foundTeam = teamsToSearch.find(t => t.name.toLowerCase() === normalizedInput) || null;
    if (foundTeam) {
        console.log(`[Sofascore] Csapat ID Találat (1/3 - Tökéletes ${searchContext}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
        sofaTeamCache.set(cacheKey, foundTeam.id);
        return foundTeam.id;
    }

    // 2. Próba: Szigorú Hasonlósági Keresés (Fuzzy Search)
    const teamNames = teamsToSearch.map(t => t.name);
    if (teamNames.length === 0) {
         console.warn(`[Sofascore] Csapat ID Találat: Nincs érvényes jelölt a(z) "${teamName}" keresésre (${searchContext} kontextus).`);
         return null;
    }

    const bestMatch = findBestMatch(teamName, teamNames);
    const FUZZY_THRESHOLD = 0.7; // <-- JAVÍTÁS (v56.3): 0.4-ről 0.7-re emelve
    
    if (bestMatch.bestMatch.rating >= FUZZY_THRESHOLD) {
        const potentialTeam = teamsToSearch[bestMatch.bestMatchIndex];
        const potentialSuffix = getSuffix(potentialTeam.name);

        // 3. Próba: Utótag Szűrő (Suffix Filter)
        // Ha az input "II" és a találat "C", akkor elutasítjuk
        if (inputSuffix !== "none" && potentialSuffix !== "none" && inputSuffix !== potentialSuffix) {
             console.warn(`[Sofascore] Csapat ID Találat ELUTASÍTVA (3/3 - Utótag Konfliktus): "${teamName}" (Input: ${inputSuffix}) hasonló ehhez: "${potentialTeam.name}" (Találat: ${potentialSuffix}), de az utótagok nem egyeznek. (Rating: ${bestMatch.bestMatch.rating})`);
        } else {
            // Elfogadva (vagy nincs utótag, vagy egyezik)
            foundTeam = potentialTeam;
            console.log(`[Sofascore] Csapat ID Találat (2/3 - Hasonlóság ${searchContext} >= ${FUZZY_THRESHOLD}): "${teamName}" -> "${foundTeam.name}" (ID: ${foundTeam.id}, Rating: ${bestMatch.bestMatch.rating})`);
            sofaTeamCache.set(cacheKey, foundTeam.id);
            return foundTeam.id;
        }
    }
    
    console.warn(`[Sofascore] Csapat ID Találat: Sikertelen egyeztetés (${searchContext} kontextus). Alacsony egyezés (${bestMatch.bestMatch.rating} < ${FUZZY_THRESHOLD}) vagy Utótag Konfliktus erre: "${teamName}"`);
    sofaTeamCache.set(cacheKey, -1); // Negatív cache-elés
    return null;
}
// === JAVÍTÁS VÉGE ===


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

// --- processSofascoreData (v74.0 - TS2322 Fix) ---
function processSofascoreData(
    lineups: { home: ISofascoreRawPlayer[], away: ISofascoreRawPlayer[] } | null,
    incidents: ISofascoreIncidentPayload | null
): ICanonicalPlayerStats {
    
    const finalStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        key_players_ratings: { home: {}, away: {} }
    };
    const playerRatingMap: Map<number, { rating: number, position: CanonicalRole }> = new Map();
    const allPlayers: ISofascoreRawPlayer[] = [];
    if (lineups) {
        allPlayers.push(...lineups.home, ...lineups.away);
    }
    
    for (const p of allPlayers) {
        if (p.player && p.player.id && p.rating) {
            const ratingNum = parseFloat(p.rating);
            if (!isNaN(ratingNum)) {
                
                // MÓDOSÍTVA (v73.0): Kanonikus szerepkör használata
                // Itt a TS2322-t megkerüljük a toCanonicalRole használatával
                const canonicalRole = toCanonicalRole(p.player.position || p.position); 

                playerRatingMap.set(p.player.id, { 
                    rating: ratingNum, 
                    position: canonicalRole 
                });
            }
        }
    }

    const processMissingPlayers = (team: 'home' | 'away', missingList: ISofascoreRawPlayer[] | undefined) => {
        if (!missingList || !Array.isArray(missingList)) return;
        const validMissingList = missingList.filter(p => p && p.player && p.player.id);
        for (const p of validMissingList) {
            const ratingData = playerRatingMap.get(p.player.id);
            
            // MÓDOSÍTVA (v73.0): Kanonikus szerepkör használata
            const role = toCanonicalRole(p.player.position); 

            const player: ICanonicalPlayer = {
                name: p.player.name,
                role: role, // <-- Itt a javítás! Csak a toCanonicalRole kimenetét használjuk
                importance: ratingData ? 'key' : (p.reason ? 'regular' : 'regular'),
                status: 'confirmed_out',
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

                // MÓDOSÍTVA (v73.0): Kanonikus szerepkör használata
                const role = ratingData?.position || toCanonicalRole(incident.player.position);

                const player: ICanonicalPlayer = {
                    name: incident.player.name,
                    role: role, // <-- Itt a javítás! Csak a toCanonicalRole kimenetét használjuk
                    importance: ratingData ? 'key' : 'regular',
                    status: 'confirmed_out',
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
        getSofascoreTeamId(homeTeamName, countryContext), // Ez már a v56.3-as szigorú verzió
        getSofascoreTeamId(awayTeamName, countryContext)  // Ez már a v56.3-as szigorú verzió
    ]);
    
    if (!homeTeamId || !awayTeamId || homeTeamId === -1 || awayTeamId === -1) {
        console.warn(`[Sofascore] Folyamat megszakítva: Nem található mindkét csapat ID (H: ${homeTeamId}, A: ${awayTeamId}). A szigorú v56.3-as keresés meghiúsult.`);
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

    // === JAVÍTÁS (v74.0) ===
    // A hiba a 488. sorban van, mert nincs visszatérési típus megadva, és
    // a TS nem tudja garantálni a szerkezetet, ha a 'playerStats' hibás.
    // Explicit return hozzáadva.
    return {
        advancedData: advancedData,
        playerStats: playerStats,
    };
    // === JAVÍTÁS VÉGE ===
}