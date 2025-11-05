// FÁJL: providers/sofascoreProvider.ts
// VERZIÓ: FÁZIS 2.1 (Tökéletes Foci Elemzés - Adatbővítés)
// MÓDOSÍTÁS:
// 1. A 'getSofascoreLineups' most már visszaadja az edző ('coach') adatait.
// 2. A 'processSofascoreData' most már feldolgozza a 'substitutes' listát
//    az új 'home_bench' / 'away_bench' mezőkbe.
// 3. A 'fetchSofascoreData' most már visszaadja a 'manager_tactics' objektumot.
// 4. Az 'ISofascoreResponse' interfész kiterjesztve.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { SOFASCORE_API_KEY, SOFASCORE_API_HOST } from '../config.js';
import { makeRequest } from './common/utils.js';
// Kanonikus típusok importálása (már tartalmazza a Fázis 1 bővítéseket)
import type { ICanonicalPlayerStats, ICanonicalPlayer, ICanonicalRawData } from '../src/types/canonical.d.ts';

// Típus exportálása a DataFetch.ts számára
export interface ISofascoreResponse {
    advancedData: { 
        xg_home: number;
        xG_away: number; // Figyelem a nagy 'G'-re
    } | null;
    playerStats: ICanonicalPlayerStats;
    // ÚJ (FÁZIS 2.1): Az edzői adatok továbbítása
    manager_tactics: ICanonicalRawData['manager_tactics'] | null;
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
        position: 'G' | 'D' | 'M' | 'F' | 'Attacker' | 'Defender' | 'Midfielder' | 'Goalkeeper';
    };
    rating?: string;
    position?: string; // Ez a részletesebb (pl. AMC, DR)
    substitute?: boolean; // True, ha a 'players' listában van (kezdő), de lecserélték
    reason?: string; // Hiányzás oka
}
// ÚJ (FÁZIS 2.1): Edző típusa
interface ISofascoreCoach {
    id: number;
    name: string;
}
// ÚJ (FÁZIS 2.1): Lineup válasz kiterjesztése
interface ISofascoreLineupResponse {
    players?: ISofascoreRawPlayer[];
    substitutes?: ISofascoreRawPlayer[];
    coach?: ISofascoreCoach;
    missing?: ISofascoreRawPlayer[];
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

// --- getSofascoreLineups (MÓDOSÍTVA - FÁZIS 2.1) ---
// Most már visszaadja az edzőket is.
async function getSofascoreLineups(eventId: number): Promise<{
    home: ISofascoreLineupResponse,
    away: ISofascoreLineupResponse
} | null> {
    const data = await makeSofascoreRequest('/matches/get-lineups', { matchId: eventId });
    if (!data?.home || !data?.away) {
        console.warn(`[Sofascore] Lineup Hiba: Nincs 'home' vagy 'away' mező (Event ID: ${eventId}).`);
        return null;
    }
    
    // Nyersen visszaadjuk a 'home' és 'away' objektumokat, amelyek
    // tartalmazzák a 'players', 'substitutes', 'coach' és 'missing' mezőket.
    return {
        home: data.home as ISofascoreLineupResponse,
        away: data.away as ISofascoreLineupResponse
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

// --- processSofascoreData (MÓDOSÍTVA - FÁZIS 2.1) ---
// Feldolgozza a lineup, substitute és incident adatokat a kanonikus ICanonicalPlayerStats formátumra
function processSofascoreData(
    lineups: { home: ISofascoreLineupResponse, away: ISofascoreLineupResponse } | null,
    incidents: ISofascoreIncidentPayload | null
): ICanonicalPlayerStats {
    
    const finalStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        home_bench: [], // ÚJ (FÁZIS 2.1)
        away_bench: [], // ÚJ (FÁZIS 2.1)
        key_players_ratings: { home: {}, away: {} }
    };
    
    // 1. Játékos-értékelés térkép építése (Kezdők + Cserék)
    const playerRatingMap: Map<number, { rating: number, position: 'G' | 'D' | 'M' | 'F' | 'Ismeretlen' }> = new Map();
    const allPlayers: ISofascoreRawPlayer[] = [];
    if (lineups) {
        allPlayers.push(...(lineups.home.players || []));
        allPlayers.push(...(lineups.away.players || []));
        // A cseréket is hozzáadjuk a rating térképhez, ha van értékelésük
        allPlayers.push(...(lineups.home.substitutes || []));
        allPlayers.push(...(lineups.away.substitutes || []));
    }
    
    for (const p of allPlayers) {
        if (p.player && p.player.id && p.rating) {
            const ratingNum = parseFloat(p.rating);
            if (!isNaN(ratingNum)) {
                let canonicalPos: ICanonicalPlayer['role'] = 'Ismeretlen';
                // Sofascore 'position' (G, D, M, F)
                if (p.player.position) {
                    if (['G', 'Goalkeeper'].includes(p.player.position)) canonicalPos = 'G';
                    else if (['D', 'Defender'].includes(p.player.position)) canonicalPos = 'D';
                    else if (['M', 'Midfielder'].includes(p.player.position)) canonicalPos = 'M';
                    else if (['F', 'Attacker'].includes(p.player.position)) canonicalPos = 'F';
                }
                playerRatingMap.set(p.player.id, { rating: ratingNum, position: canonicalPos });
            }
        }
    }

    // 2. Hiányzók ('missing' lista + 'incidents' lista) feldolgozása
    const processMissingPlayers = (team: 'home' | 'away', missingList: ISofascoreRawPlayer[] | undefined) => {
        if (!missingList || !Array.isArray(missingList)) return;
        
        const validMissingList = missingList.filter(p => p && p.player && p.player.id);
        for (const p of validMissingList) {
            const ratingData = playerRatingMap.get(p.player.id);
            const canonicalPos = p.player.position === 'Attacker' ? 'F' :
                               p.player.position === 'Midfielder' ? 'M' :
                               p.player.position === 'Defender' ? 'D' :
                               p.player.position === 'Goalkeeper' ? 'G' : 'Ismeretlen';

            const player: ICanonicalPlayer = {
                name: p.player.name,
                role: canonicalPos,
                importance: ratingData ? 'key' : 'regular', // Ha van ratingje, valószínűleg kulcsjátékos
                status: 'confirmed_out',
                rating_last_5: ratingData?.rating || undefined
                // TODO (Fázis 2.2): Itt kell majd hívni a _getSofascorePlayerMetrics-et
            };
            if (team === 'home') finalStats.home_absentees.push(player);
            else finalStats.away_absentees.push(player);
        }
    };
    
    // A lineup-ban listázott 'missing' játékosok (legmegbízhatóbb)
    processMissingPlayers('home', lineups?.home?.missing);
    processMissingPlayers('away', lineups?.away?.missing);
    // Az 'incidents' API-ból érkező 'missing' játékosok (fallback)
    processMissingPlayers('home', incidents?.home?.missing);
    processMissingPlayers('away', incidents?.away?.missing);

    // Sérülések az 'incidents' listából (duplikáció-ellenőrzéssel)
    if (incidents?.incidents) {
        for (const incident of incidents.incidents) {
            if ((incident.incidentType === 'injury' || incident.injury) && incident.player && incident.teamSide) {
                const existingList = (incident.teamSide === 'home' ? finalStats.home_absentees : finalStats.away_absentees);
                if (existingList.some(p => p.name === incident.player!.name)) {
                    continue; // Már listáztuk
                }
                
                const ratingData = playerRatingMap.get(incident.player.id);
                const player: ICanonicalPlayer = {
                    name: incident.player.name,
                    role: ratingData?.position || 'Ismeretlen',
                    importance: ratingData ? 'key' : 'regular',
                    status: 'confirmed_out',
                    rating_last_5: ratingData?.rating || undefined
                };
                if (incident.teamSide === 'home') finalStats.home_absentees.push(player);
                else finalStats.away_absentees.push(player);
            }
        }
    }
    
    // 3. Cserék ('substitutes' lista) feldolgozása (ÚJ - FÁZIS 2.1)
    const processBenchPlayers = (team: 'home' | 'away', benchList: ISofascoreRawPlayer[] | undefined) => {
        if (!benchList || !Array.isArray(benchList)) return;

        const validBenchList = benchList.filter(p => p && p.player && p.player.id);
        for (const p of validBenchList) {
            const ratingData = playerRatingMap.get(p.player.id);
            const canonicalPos = p.player.position === 'Attacker' ? 'F' :
                               p.player.position === 'Midfielder' ? 'M' :
                               p.player.position === 'Defender' ? 'D' :
                               p.player.position === 'Goalkeeper' ? 'G' : 'Ismeretlen';
            
            const player: ICanonicalPlayer = {
                name: p.player.name,
                role: canonicalPos,
                importance: 'bench', // Fontosság: 'bench'
                status: 'on_bench', // Státusz: 'on_bench'
                rating_last_5: ratingData?.rating || undefined
                // TODO (Fázis 2.2): Itt is hívni kell a _getSofascorePlayerMetrics-et
            };
            if (team === 'home') finalStats.home_bench.push(player);
            else finalStats.away_bench.push(player);
        }
    };

    processBenchPlayers('home', lineups?.home?.substitutes);
    processBenchPlayers('away', lineups?.away?.substitutes);

    return finalStats;
}


// --- FŐ EXPORTÁLT FÜGGVÉNY (MÓDOSÍTVA - FÁZIS 2.1) ---
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
        lineupData, // Ez most már tartalmazza az edzőket is
        incidentData
    ] = await Promise.all([
        getSofascoreXg(eventId),
        getSofascoreLineups(eventId),
        getSofascoreIncidents(eventId)
    ]);
    
    // A processSofascoreData most már feltölti a 'home_bench' és 'away_bench' mezőket is
    const playerStats = processSofascoreData(lineupData, incidentData);
    
    const advancedData = (xgData && xgData.home != null && xgData.away != null)
        ? { xg_home: xgData.home, xG_away: xgData.away }
        : null;
        
    // ÚJ (FÁZIS 2.1): Edzői adatok kinyerése
    const manager_tactics: ICanonicalRawData['manager_tactics'] = {
        home_manager_name: lineupData?.home?.coach?.name || null,
        away_manager_name: lineupData?.away?.coach?.name || null,
        home_avg_sub_time: null, // Ezt (egyelőre) az AI-nak kell becsülnie
        away_avg_sub_time: null,
        home_primary_sub_role: null,
        away_primary_sub_role: null
    };

    if (!advancedData) {
        console.warn(`[Sofascore] Hiányzó xG adat (Event ID: ${eventId}). 'advancedData' null lesz.`);
    }
    if (playerStats.home_absentees.length === 0 && playerStats.away_absentees.length === 0) {
        console.warn(`[Sofascore] Hiányzó hiányzó-adat (Event ID: ${eventId}). 'playerStats.absentees' üres lesz.`);
    }
     if (playerStats.home_bench.length === 0 && playerStats.away_bench.length === 0) {
        console.warn(`[Sofascore] Hiányzó csere-adat (Event ID: ${eventId}). 'playerStats.bench' üres lesz.`);
    }

    return {
        advancedData: advancedData,
        playerStats: playerStats,
        manager_tactics: manager_tactics // Visszaadjuk az edzői adatokat
    };
}
