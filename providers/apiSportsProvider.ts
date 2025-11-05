// FÁJL: providers/apiSportsProvider.ts
// VERZIÓ: v56.2 (AI "Öngyógyító" Liga- és Csapatnév Feloldás)
// MÓDOSÍTÁS:
// 1. A 'getApiSportsLeagueId' [cite: 1020-1043] funkció kiegészítve egy "AI-Fallback" logikával
//    (egy új '_resolveLeagueNameWithAI' segédfüggvény).
// 2. Ha a statikus keresés  sikertelen egy ligánál (pl. "LaLiga2" ),
//    a rendszer már nem dob hibát [cite: 2016-2017], hanem AI segítségével azonosítja
//    a helyes ligát a letöltött ligalistából.
// 3. Ez a javítás közvetlenül kezeli a 'Log napló.txt'-ben [Log napló.txt]
//    azonosított kritikus összeomlást.
// 4. A v56.0-ás "Öngyógyító" Csapatnév feloldás  (AI-Fallback)
//    szintén ebben a fájlban marad.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalPlayer,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult,
    IStructuredWeather
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini, // <- Szükséges az AI-Fallback logikához
    PROMPT_V43,
    makeRequest,
    getStructuredWeatherData // Ez már a v55.9-es (valós) implementáció
} from './common/utils.js';

// --- API-SPORTS SPECIFIKUS CACHE-EK ---
// (Cache definíciók változatlanok)
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const apiSportsFixtureStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsNameMappingCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsRosterCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsCountryLeagueCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsLineupCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- API-SPORTS KULCSROTÁCIÓS LOGIKA (Változatlan) ---
let keyIndexes: { [key: string]: number } = { soccer: 0, hockey: 0, basketball: 0 };
function getApiConfig(sport: string) {
    const config = API_HOSTS[sport];
    if (!config || !config.host || !config.keys || !config.keys.length) {
        throw new Error(`Kritikus konfigurációs hiba: Nincsenek API kulcsok a '${sport}' sporthoz a config.js-ben.`);
    }
    const currentIndex = keyIndexes[sport];
    if (currentIndex >= config.keys.length) {
        throw new Error(`MINDEN API KULCS Kimerült a(z) '${sport}' sporthoz.`);
    }
    const currentKey = config.keys[currentIndex];
    return {
        baseURL: `https://${config.host}`,
        headers: { 'x-rapidapi-key': currentKey, 'x-rapidapi-host': config.host },
        keyIndex: currentIndex,
        totalKeys: config.keys.length
    };
}
function rotateApiKey(sport: string): boolean {
    const config = API_HOSTS[sport];
    if (keyIndexes[sport] < config.keys.length - 1) {
        keyIndexes[sport]++;
        console.log(`API KULCS ROTÁLÁS: Váltás a(z) ${keyIndexes[sport] + 1}. kulcsra (${sport})...`);
        return true;
    }
    return false;
}
async function makeRequestWithRotation(sport: string, endpoint: string, config: AxiosRequestConfig = {}) {
    const maxAttempts = API_HOSTS[sport]?.keys?.length || 1;
    let attempts = 0;
    while (attempts < maxAttempts) {
        try {
            const apiConfig = getApiConfig(sport);
            const url = `${apiConfig.baseURL}${endpoint}`;
            const fullConfig: AxiosRequestConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
            return await makeRequest(url, fullConfig, 0);
        } catch (error: any) {
            if (error.isQuotaError) {
                console.warn(`Kvóta hiba a(z) ${keyIndexes[sport] + 1}. kulccsal (${sport}).`);
                const canRotate = rotateApiKey(sport);
                if (canRotate) {
                    attempts++;
                    continue;
                } else {
                    throw new Error(`MINDEN API KULCS Kimerült (${sport}).`);
                }
            } else {
                console.error(`API hiba (nem kvóta, sport: ${sport}): ${error.message}`);
                throw error;
            }
        }
    }
    throw new Error(`API hívás sikertelen ${maxAttempts} kulccsal: ${endpoint}`);
}
// --- KULCSROTÁCIÓ VÉGE ---


// --- _getLeagueRoster (Változatlan) ---
async function _getLeagueRoster(leagueId: number | string, season: number, sport: string): Promise<any[]> {
    const cacheKey = `apisports_roster_v1_${sport}_${leagueId}_${season}`;
    const cachedRoster = apiSportsRosterCache.get<any[]>(cacheKey);
    if (cachedRoster) {
        console.log(`API-SPORTS (${sport}): Csapatlista CACHE TALÁLAT (Liga: ${leagueId}, Szezon: ${season})`);
        return cachedRoster;
    }
    console.log(`API-SPORTS (${sport}): Csapatlista lekérése (Liga: ${leagueId}, Szezon: ${season})...`);
    const endpoint = `/v3/teams?league=${leagueId}&season=${season}`;
    const response = await makeRequestWithRotation(sport, endpoint, {});
    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`API-SPORTS (${sport}): Nem sikerült lekérni a csapatlistát a ${leagueId} ligából, ${season} szezon.`);
        return [];
    }
    const roster = response.data.response;
    apiSportsRosterCache.set(cacheKey, roster);
    console.log(`API-SPORTS (${sport}): Csapatlista sikeresen lekérve, ${roster.length} csapat cache-elve.`);
    return roster;
}

// === ÚJ (v56.0): AI-ASSZISZTÁLT CSAPATNÉV FELOLDÓ (Változatlan) ===
async function _resolveTeamNameWithAI(
    espnName: string, 
    searchName: string, 
    teamObjects: any[]
): Promise<number | null> {
    console.warn(`[AI Névfeloldó (Csapat)] Indítás. A statikus térkép és a fuzzy keresés sikertelen volt ehhez: "${espnName}" (Keresve: "${searchName}")`);
    const simpleRoster = teamObjects.map(t => ({ id: t.id, name: t.name }));
    if (simpleRoster.length === 0) {
        console.error("[AI Névfeloldó (Csapat)] Hiba: A csapatlista (roster) üres volt.");
        return null;
    }
    const prompt = `
TASK: You are an expert sports data mapping assistant.
Your goal is to find the correct team ID for a misspelled or alternative team name.
INPUT NAME: "${searchName}" (Eredeti ESPN név: "${espnName}")
ROSTER (AVAILABLE TEAMS):
${JSON.stringify(simpleRoster, null, 2)}
INSTRUCTIONS:
1. Analyze the ROSTER and find the *single best match* for the INPUT NAME.
2. Respond with ONLY a valid JSON object in this exact format:
   { "matched_id": <ID> }
3. If no logical match is found, respond with:
   { "matched_id": null }
`;
    try {
        const jsonString = await _callGemini(prompt, true);
        const result = JSON.parse(jsonString);
        if (result && result.matched_id) {
            const foundId = Number(result.matched_id);
            const matchedTeam = simpleRoster.find(t => t.id === foundId);
            console.log(`[AI Névfeloldó (Csapat)] SIKER: Az AI a "${searchName}" nevet ehhez a csapathoz rendelte: "${matchedTeam?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI Névfeloldó (Csapat)] HIBA: Az AI nem talált egyezést (matched_id: null) a "${searchName}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI Névfeloldó (Csapat)] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}
// === MÓDOSÍTÁS VÉGE ===


// === getApiSportsTeamId (MÓDOSÍTVA v56.0) (Változatlan) ===
async function getApiSportsTeamId(teamName: string, sport: string, leagueId: number | string, season: number): Promise<number | null> {
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();
    const nameCacheKey = `apisports_name_map_v6_strict_${sport}_${leagueId}_${season}_${searchName.replace(/\s+/g, '')}`;
    const cachedMappedId = apiSportsNameMappingCache.get<number | 'not_found'>(nameCacheKey);
    
    if (cachedMappedId !== undefined) {
        if (cachedMappedId === 'not_found') return null;
        console.log(`API-SPORTS (${sport}): NÉV-CACHE találat (v6 Strict): "${searchName}" -> ${cachedMappedId}`);
        return cachedMappedId;
    }

    if (mappedName !== teamName) {
        console.log(`API-SPORTS Név Térképezés (${sport}): "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    } else {
         console.log(`API-SPORTS Név Keresés (${sport}): "${teamName}" (Nincs térkép bejegyzés, közvetlen keresés)`);
    }

    const leagueRoster = await _getLeagueRoster(leagueId, season, sport);
    if (leagueRoster.length === 0) {
        console.warn(`API-SPORTS (${sport}): A liga (${leagueId}) csapatai nem érhetők el a(z) ${season} szezonban. Névfeloldás sikertelen.`);
        apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
        return null;
    }

    const teamObjects = leagueRoster.map(item => item.team);
    let foundTeam: any = null;
    
    foundTeam = teamObjects.find(t => t.name.toLowerCase() === searchName);
    if (foundTeam) {
        console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Tökéletes): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
    }

    if (!foundTeam) {
        foundTeam = teamObjects.find(t => t.name.toLowerCase().includes(searchName));
        if (foundTeam) {
             console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Tartalmazza): Az API név "${foundTeam.name}" tartalmazza a keresett nevet "${searchName}" (ID: ${foundTeam.id})`);
        }
    }
    
    if (!foundTeam) {
        const aiFoundId = await _resolveTeamNameWithAI(teamName, searchName, teamObjects);
        if (aiFoundId) {
            apiSportsNameMappingCache.set(nameCacheKey, aiFoundId);
            return aiFoundId;
        }
    }

    if (foundTeam && foundTeam.id) {
        apiSportsNameMappingCache.set(nameCacheKey, foundTeam.id);
        return foundTeam.id;
    }

    console.warn(`API-SPORTS (${sport}): VÉGLEGES HIBA. Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Szezon: ${season}, Eredeti: "${teamName}").`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}


// === ÚJ (v56.2): AI-ASSZISZTÁLT LIGA NÉV FELOLDÓ ===
/**
 * Ha a statikus keresés sikertelen, AI segítségével azonosítja a ligát.
 * Ez javítja a "LaLiga2"  hibát.
 */
async function _resolveLeagueNameWithAI(
    espnName: string, 
    searchName: string, 
    leagueObjects: any[] // A szezon teljes ligalistája
): Promise<number | null> {
    
    console.warn(`[AI Névfeloldó (Liga)] Indítás. A statikus keresés sikertelen volt ehhez: "${espnName}" (Keresve: "${searchName}")`);
    
    const simpleRoster = leagueObjects.map(l => ({ id: l.id, name: l.name }));
    if (simpleRoster.length === 0) {
        console.error("[AI Névfeloldó (Liga)] Hiba: A ligalista (roster) üres volt.");
        return null;
    }

    const prompt = `
TASK: You are an expert sports data mapping assistant.
Your goal is to find the correct league ID for an alternative league name.

INPUT NAME: "${searchName}" (Eredeti ESPN név: "${espnName}")

ROSTER (AVAILABLE LEAGUES):
${JSON.stringify(simpleRoster, null, 2)}

INSTRUCTIONS:
1. Analyze the ROSTER and find the *single best match* for the INPUT NAME.
   (Example: "LaLiga2" or "laliga2" should match "Segunda División").
2. Respond with ONLY a valid JSON object in this exact format:
   { "matched_id": <ID> }
3. If no logical match is found, respond with:
   { "matched_id": null }
`;

    try {
        const jsonString = await _callGemini(prompt, true);
        const result = JSON.parse(jsonString);

        if (result && result.matched_id) {
            const foundId = Number(result.matched_id);
            const matchedLeague = simpleRoster.find(l => l.id === foundId);
            
            console.log(`[AI Névfeloldó (Liga)] SIKER: Az AI a "${searchName}" nevet ehhez a ligához rendelte: "${matchedLeague?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI Névfeloldó (Liga)] HIBA: Az AI nem talált egyezést (matched_id: null) a "${searchName}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI Névfeloldó (Liga)] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}
// === MÓDOSÍTÁS VÉGE ===


// === getApiSportsLeagueId (MÓDOSÍTVA v56.2) ===
async function getApiSportsLeagueId(leagueName: string, country: string, season: number, sport: string): Promise<{ leagueId: number, foundSeason: number } | null> {
    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const lowerCountry = country.toLowerCase();
    const leagueCacheKey = `apisports_league_id_v1_${sport}_${leagueName.toLowerCase().replace(/\s/g, '')}_${country}_${season}`;
    const cachedLeagueData = apiSportsLeagueIdCache.get<{ leagueId: number, foundSeason: number }>(leagueCacheKey);
    if (cachedLeagueData) {
        console.log(`API-SPORTS (${sport}): Liga ID CACHE TALÁLAT: "${leagueName}" -> ${cachedLeagueData.leagueId} (Szezon: ${cachedLeagueData.foundSeason})`);
        return cachedLeagueData;
    }
    
    const _getLeaguesByCountry = async (currentCountry: string, currentSeason: number): Promise<any[]> => {
        const cacheKey = `apisports_countryleagues_v1_${sport}_${currentCountry.toLowerCase()}_${currentSeason}`;
        const cachedLeagues = apiSportsCountryLeagueCache.get<any[]>(cacheKey);
        if (cachedLeagues) {
            console.log(`API-SPORTS (${sport}): Liga-lista CACHE TALÁLAT (Ország: ${currentCountry}, Szezon: ${currentSeason})`);
            return cachedLeagues;
        }

        console.log(`API-SPORTS (${sport}): Liga-lista lekérése (Ország: ${currentCountry}, Szezon: ${currentSeason})...`);
        const endpoint = `/v3/leagues`;
        const params = { country: currentCountry, season: currentSeason };
        const response = await makeRequestWithRotation(sport, endpoint, { params });

        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`API-SPORTS (${sport}): Nem találhatók ligák ehhez: ${currentCountry}, ${currentSeason}`);
            apiSportsCountryLeagueCache.set(cacheKey, []); 
            return [];
        }

        const leagues = response.data.response.map((l: any) => l.league);
        apiSportsCountryLeagueCache.set(cacheKey, leagues);
        console.log(`API-SPORTS (${sport}): ${leagues.length} liga cache-elve (${currentCountry}, ${currentSeason}).`);
        return leagues;
    };
    
    // === MÓDOSÍTOTT (v56.2) _findLeagueInList ===
    const _findLeagueInList = async (leagues: any[], targetName: string): Promise<number | null> => {
        if (leagues.length === 0) return null;
        
        const targetLower = targetName.toLowerCase().trim();
        const cleanTargetName = targetLower
            .replace(/\(.*?\)/g, '')
            .replace(/^(argentinian|brazilian|uefa|fifa)\s/i, '')
            .replace(/\s(league|liga|cup|copa|championship|division|super)/i, '')
            .trim();
        
        const leagueNameMap = leagues.map(l => {
            const originalName = l.name.toLowerCase();
            const cleanedApiName = originalName
                .replace(/\(.*?\)/g, '')
                .replace(/^(argentinian|brazilian|uefa|fifa)\s/i, '')
                .replace(/\s(league|liga|cup|copa|championship|division|super)/i, '')
                .trim();
            
            return { 
                original: l.name, 
                originalLower: originalName, 
                cleaned: cleanedApiName,
                id: l.id 
            };
        });
        
        let perfectMatch = leagueNameMap.find(l => l.originalLower === targetLower);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (1/3 - Tökéletes): "${targetName}" -> "${perfectMatch.original}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        perfectMatch = leagueNameMap.find(l => l.cleaned === cleanTargetName);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (2/3 - Tisztított Tökéletes): "${targetName}" (Keresve: "${cleanTargetName}") -> "${perfectMatch.original}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        console.warn(`API-SPORTS (${sport}): Nem található pontos liga egyezés ehhez: "${targetName}" (Keresve: "${cleanTargetName}"). Indítás: AI-Fallback (v56.2)...`);
        
        // 3. Próba: AI Feloldás (Ez javítja a "LaLiga2" hibát )
        const aiFoundId = await _resolveLeagueNameWithAI(targetName, cleanTargetName, leagues);
        if (aiFoundId) {
            return aiFoundId;
        }

        return null;
    };
    // === MÓDOSÍTÁS VÉGE ===

    let leagueData: { leagueId: number, foundSeason: number } | null = null;
    const seasonsToTry = [season, season - 1, season - 2];
    
    for (const s of seasonsToTry) {
        console.log(`API-SPORTS (${sport}): Ligák keresése (Ország: ${country}, Szezon: ${s})...`);
        const leaguesInSeason = await _getLeaguesByCountry(country, s);
        // A _findLeagueInList most már aszinkron (await szükséges)
        const foundLeagueId = await _findLeagueInList(leaguesInSeason, leagueName);
        
        if (foundLeagueId) {
            console.log(`API-SPORTS (${sport}): Liga sikeresen azonosítva a(z) ${s} szezonban (ID: ${foundLeagueId}). Keresés leáll.`);
            leagueData = { leagueId: foundLeagueId, foundSeason: s }; 
            apiSportsLeagueIdCache.set(leagueCacheKey, leagueData); // Cache-eljük a sikeres találatot
            break; 
        }
        
        if (sport !== 'soccer') {
             break;
        }
        
        console.warn(`API-SPORTS (${sport}): Nem található "${leagueName}" nevű liga ${country} országban a(z) ${s} szezonra.`);
    }

    if (!leagueData) {
        console.error(`API-SPORTS (${sport}): Végleg nem található liga ID ehhez: "${leagueName}" (${country}) (3 szezont ellenőrizve, AI-val is).`);
        return null;
    }
    
    return leagueData;
}


// === findApiSportsFixture (Változatlan) ===
async function findApiSportsFixture(homeTeamId: number, awayTeamId: number, season: number, leagueId: number, utcKickoff: string, sport: string): Promise<any | null> {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return null;
    const cacheKey = `apisports_findfixture_v54.7_FULL_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get<any>(cacheKey);
    if (cached) {
        console.log(`API-SPORTS (${sport}): Teljes Fixture CACHE TALÁLAT! FixtureID: ${cached.fixture?.id}`);
        return cached;
    }
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const endpoint = `/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    console.log(`API-SPORTS Fixture Keresés (${sport}): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában (${season} szezon)...`);
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find((f: any) => (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId));
        if (foundFixture) {
            console.log(`API-SPORTS (${sport}): MECCS TALÁLAT! FixtureID: ${foundFixture.fixture?.id}`);
            apiSportsFixtureCache.set(cacheKey, foundFixture);
            return foundFixture;
        }
    }
    console.warn(`API-SPORTS (${sport}): Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz (Dátum: ${matchDate}, Szezon: ${season}).`);
    apiSportsFixtureCache.set(cacheKey, null);
    return null;
}

// === getApiSportsFixtureResult (Változatlan) ===
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { 
    if (sport !== 'soccer' || !fixtureId) {
        console.warn(`[getApiSportsFixtureResult] Lekérés kihagyva: Csak 'soccer' támogatott vagy hiányzó fixtureId.`);
        return null;
    }
    const cacheKey = `fixture_result_v1_${fixtureId}`;
    const cached = fixtureResultCache.get<FixtureResult>(cacheKey);
    if (cached) {
        console.log(`[getApiSportsFixtureResult] Cache találat (ID: ${fixtureId}): ${cached.status}`);
        return cached;
    }
    console.log(`[getApiSportsFixtureResult] Eredmény lekérése... (ID: ${fixtureId})`);
    const endpoint = `/v3/fixtures`;
    const params = { id: fixtureId };
    try {
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[getApiSportsFixtureResult] Nem található meccs a ${fixtureId} ID alatt.`);
            return null; 
        }
        const fixture = response.data.response[0];
        const status = fixture.fixture?.status?.short;
        const goals = fixture.goals;
        if (status === 'FT') {
            const result: FixtureResult = { home: goals.home, away: goals.away, status: 'FT' };
            fixtureResultCache.set(cacheKey, result);
            console.log(`[getApiSportsFixtureResult] Eredmény rögzítve (ID: ${fixtureId}): H:${result.home}-A:${result.away}`);
            return result;
        }
        console.log(`[getApiSportsFixtureResult] Meccs még nincs befejezve (ID: ${fixtureId}). Státusz: ${status}`);
        return { status: status }; 
    } catch (error: any) {
        console.error(`[getApiSportsFixtureResult] Hiba történt (ID: ${fixtureId}): ${error.message}`);
        return null;
    }
}

// === getApiSportsH2H (Változatlan) ===
async function getApiSportsH2H(homeTeamId: number, awayTeamId: number, limit: number = 5, sport: string): Promise<any[] | null> {
    const endpoint = `/v3/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    const fixtures = response?.data?.response;
    if (fixtures && Array.isArray(fixtures)) {
        return fixtures.map((fix: any) => ({
            date: (fix.fixture || fix).date?.split('T')[0] || 'N/A',
            competition: (fix.league || fix).name || 'N/A',
            score: `${(fix.goals || fix.scores)?.home ?? '?'} - ${(fix.goals || fix.scores)?.away ?? '?'}`,
            home_team: fix.teams?.home?.name || fix.contestants?.home?.name || 'N/A',
            away_team: fix.teams?.away?.name || fix.contestants?.away?.name || 'N/A',
        })).slice(0, limit);
    }
    return null;
}

// === getApiSportsTeamSeasonStats (Változatlan) ===
async function getApiSportsTeamSeasonStats(teamId: number, leagueId: number, season: number, sport: string): Promise<any | null> {
    const tryGetStats = async (currentSeason: number) => {
        const cacheKey = `apisports_seasonstats_v40_${sport}_${teamId}_${leagueId}_${currentSeason}`;
        const cachedStats = apiSportsStatsCache.get<any>(cacheKey);
        if (cachedStats) {
            console.log(`API-SPORTS Szezon Stat cache találat (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}`);
            return cachedStats;
        }
        console.log(`API-SPORTS Szezon Stat lekérés (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
        const endpoint = `/v3/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        const stats = response?.data?.response;
        if (stats && (stats.league?.id || (stats.games?.played != null && stats.games?.played > 0))) { 
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
            let simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total || stats.games?.played,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };
            apiSportsStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        }
        return null;
    };
    let stats: any = null;
    const seasonsToTry = [season, season - 1, season - 2];
    for (const s of seasonsToTry) {
        stats = await tryGetStats(s);
        if (stats) {
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen azonosítva a(z) ${s} szezonban.`);
            break; 
        }
         if (sport !== 'soccer') break;
        console.warn(`API-SPORTS (${sport}): Nem található statisztika a(z) ${s} szezonra.`);
    }
    if (!stats) {
        console.error(`API-SPORTS (${sport}): Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    return stats;
}

// === getApiSportsOdds (Változatlan) ===
async function getApiSportsOdds(fixtureId: number | string | null, sport: string): Promise<ICanonicalOdds | null> {
    if (!fixtureId) {
        console.warn(`API-SPORTS Odds (${sport}): Hiányzó fixtureId, a szorzók lekérése kihagyva.`);
        return null;
    }
    const cacheKey = `apisports_odds_v40_${sport}_${fixtureId}`;
    const cached = apiSportsOddsCache.get<ICanonicalOdds>(cacheKey);
    if (cached) {
        console.log(`API-SPORTS Odds cache találat (${sport}): ${cacheKey}`);
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs API-SPORTS Odds cache (${cacheKey}). Friss lekérés...`);
    const endpoint = `/v3/odds`;
    const params = { fixture: fixtureId };
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`API-SPORTS Odds (${sport}): Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
        return null;
    }
    const oddsData = response.data.response[0]; 
    const bookmaker = oddsData.bookmakers?.find((b: any) => b.name === "Bet365") || oddsData.bookmakers?.[0];
    const winnerMarketName = sport === 'soccer' ? "Match Winner" : "Moneyline";
    const matchWinnerMarket = bookmaker?.bets?.find((b: any) => b.name === winnerMarketName);
    const currentOdds: { name: string; price: number }[] = [];
    if (matchWinnerMarket) {
        const homeOdd = matchWinnerMarket.values.find((v: any) => v.value === "Home")?.odd;
        const drawOdd = matchWinnerMarket.values.find((v: any) => v.value === "Draw")?.odd;
        const awayOdd = matchWinnerMarket.values.find((v: any) => v.value === "Away")?.odd;
        if (homeOdd) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOdd) });
        if (drawOdd) currentOdds.push({ name: 'Döntetlen', price: parseFloat(drawOdd) });
        if (awayOdd) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOdd) });
    }
    const allMarkets: ICanonicalOdds['allMarkets'] = [];
    if (bookmaker?.bets) {
        for (const bet of bookmaker.bets) {
            const marketKey = bet.name?.toLowerCase().replace(/\s/g, '_');
            const outcomes = (bet.values || []).map((v: any) => ({
                name: v.value,
                price: parseFloat(v.odd),
                point: (typeof v.value === 'string') ? (v.value.match(/(\d+\.\d)/) ? parseFloat(v.value.match(/(\d+\.\d)/)[1]) : null) : null
            }));
            if (marketKey === 'match_winner') allMarkets.push({ key: 'h2h', outcomes });
            if (marketKey === 'moneyline') allMarkets.push({ key: 'h2h', outcomes });
            if (marketKey === 'over/under') allMarkets.push({ key: 'totals', outcomes });
            if (marketKey === 'total') allMarkets.push({ key: 'totals', outcomes });
            if (marketKey === 'total_points') allMarkets.push({ key: 'totals', outcomes });
            if (marketKey === 'both_teams_to_score') allMarkets.push({ key: 'btts', outcomes });
            if (marketKey === 'corners_over/under') allMarkets.push({ key: 'corners_over_under', outcomes });
            if (marketKey === 'cards_over/under') allMarkets.push({ key: 'cards_over_under', outcomes });
        }
    }
    const result: ICanonicalOdds = {
        current: currentOdds, 
        fullApiData: oddsData,
        allMarkets: allMarkets,
        fromCache: false 
    };
    if (result.current.length > 0) {
        apiSportsOddsCache.set(cacheKey, result);
        console.log(`API-SPORTS Odds adatok (${sport}) sikeresen lekérve és cache-elve: ${cacheKey}`);
    } else {
         console.warn(`API-SPORTS Odds (${sport}): Találat, de nem sikerült '${winnerMarketName}' piacot találni.`);
    }
    return result; 
}

// === getApiSportsFixtureStats (Változatlan) ===
async function getApiSportsFixtureStats(fixtureId: number | string | null, sport: string): Promise<{ home: number; away: number } | null> {
    if (sport !== 'soccer' || !fixtureId) {
        console.log(`API-SPORTS Fixture Stats (${sport}): Lekérés kihagyva (Sport nem foci, vagy hiányzó FixtureID).`);
        return null;
    }
    const cacheKey = `apisports_fixturestats_v50_${fixtureId}`;
    const cached = apiSportsFixtureStatsCache.get<{ home: number; away: number }>(cacheKey);
    if (cached) {
        console.log(`API-SPORTS Fixture Stats cache találat: ${cacheKey}`);
        return cached;
    }
    console.log(`API-SPORTS Fixture Stats: Valós xG adatok lekérése... (FixtureID: ${fixtureId})`);
    const endpoint = `/v3/fixtures/statistics`;
    const params = { fixture: fixtureId };
    try {
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        if (!response?.data?.response || response.data.response.length < 2) {
            console.warn(`API-SPORTS Fixture Stats: Nem érkezett statisztikai adat a ${fixtureId} fixture-höz (válasz üres vagy hiányos).`);
            apiSportsFixtureStatsCache.set(cacheKey, null); 
            return null;
        }
        const stats = response.data.response;
        const homeStats = stats.find((s: any) => s.team?.id === stats[0].team?.id);
        const awayStats = stats.find((s: any) => s.team?.id !== stats[0].team?.id);
        if (!homeStats || !awayStats) {
             console.warn(`API-SPORTS Fixture Stats: Nem sikerült szétválasztani a hazai és vendég statisztikát (ID: ${fixtureId}).`);
             apiSportsFixtureStatsCache.set(cacheKey, null);
             return null;
        }
        const homeXgStat = homeStats.statistics?.find((stat: any) => stat.type === 'Expected Goals');
        const awayXgStat = awayStats.statistics?.find((stat: any) => stat.type === 'Expected Goals');
        if (homeXgStat?.value == null || awayXgStat?.value == null) {
            console.warn(`API-SPORTS Fixture Stats: Az API válaszolt, de nem tartalmaz "Expected Goals" (xG) adatot (ID: ${fixtureId}). Ez valószínűleg a liga lefedettségének vagy a meccs státuszának (pl. még nem kezdődött el) hibája.`);
            apiSportsFixtureStatsCache.set(cacheKey, null);
            return null;
        }
        const xgData = {
            home: parseFloat(homeXgStat.value) || 0.0, 
            away: parseFloat(awayXgStat.value) || 0.0
        };
        console.log(`API-SPORTS Fixture Stats: SIKERES. Valós xG: H=${xgData.home}, A=${xgData.away} (ID: ${fixtureId})`);
        apiSportsFixtureStatsCache.set(cacheKey, xgData);
        return xgData;
    } catch (error: any) {
        console.error(`API-SPORTS Fixture Stats Hiba (ID: ${fixtureId}): ${error.message}`);
        apiSportsFixtureStatsCache.set(cacheKey, null); 
        return null;
    }
}

// === getApiSportsLineupsAndInjuries (Változatlan) ===
export async function getApiSportsLineupsAndInjuries(
    fixtureId: number | string | null,
    sport: string,
    homeTeamId: number,
    awayTeamId: number
): Promise<ICanonicalPlayerStats | null> {
    if (sport !== 'soccer' || !fixtureId) {
        console.log(`[API-SPORTS Fallback] Lineups/Injuries: Lekérés kihagyva (Sport nem foci, vagy hiányzó FixtureID).`);
        return null;
    }
    const cacheKey = `apisports_lineups_v1_${fixtureId}`;
    const cached = apiSportsLineupCache.get<ICanonicalPlayerStats>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS Fallback] Lineups cache találat: ${cacheKey}`);
        return cached;
    }
    console.log(`[API-SPORTS Fallback] Hiányzók/Felállások lekérése (FixtureID: ${fixtureId})...`);
    const endpoint = `/v3/fixtures/lineups`;
    const params = { fixture: fixtureId };
    try {
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[API-SPORTS Fallback] Lineups: Nem érkezett adat a ${fixtureId} fixture-höz.`);
            return null;
        }
        const data = response.data.response;
        const homeData = data.find((t: any) => t.team?.id === homeTeamId);
        const awayData = data.find((t: any) => t.team?.id === awayTeamId);
        if (!homeData || !awayData) {
            console.warn(`[API-SPORTS Fallback] Lineups: Nem sikerült a hazai/vendég adat szétválasztása (ID: ${fixtureId}).`);
            return null;
        }
        const mapPlayer = (p: any): ICanonicalPlayer => ({
            name: p.player?.name || 'Ismeretlen',
            role: p.player?.pos || 'Ismeretlen',
            importance: 'regular',
            status: 'active',
            rating_last_5: undefined
        });
        const playerStats: ICanonicalPlayerStats = {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        };
        console.log(`[API-SPORTS Fallback] Lineups: Adat feldolgozva. (Hiányzók: 0, Ratingek: 0)`);
        apiSportsLineupCache.set(cacheKey, playerStats);
        return playerStats;
    } catch (error: any) {
        console.error(`[API-SPORTS Fallback] Lineups Hiba (ID: ${fixtureId}): ${error.message}`);
        return null;
    }
}


// === getWeatherForFixture (Változatlan, v55.9-et hív) ===
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    const location = venue?.city || null;
    // Ez a hívás most már a v55.9-es, valós Open-Meteo implementációt
    // használja a 'utils.ts'-ből.
    return await getStructuredWeatherData(location, utcKickoff);
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (MÓDOSÍTVA v56.2) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    const seasonDate = new Date(utcKickoff);
    const originSeason = (sport !== 'soccer' && seasonDate.getMonth() < 7) ?
        seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        
    if (isNaN(originSeason)) throw new Error(`Érvénytelen utcKickoff: ${utcKickoff}`);
    
    console.log(`Adatgyűjtés indul (v56.2 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    
    // 1. LÉPÉS: Liga adatok lekérése (Már a v56.2 "Öngyógyító" logikával)
    const sportConfig = SPORT_CONFIG[sport];
    const leagueData = sportConfig.espn_leagues[leagueName];
    if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
    
    const country = leagueData.country;
    // A 'getApiSportsLeagueId' már tartalmazza az AI-Fallback-et
    const leagueDataResponse = await getApiSportsLeagueId(leagueName, country, originSeason, sport);
    
    if (!leagueDataResponse || !leagueDataResponse.leagueId) {
        // A v56.2-es javítás (AI-Fallback) ellenére sem sikerült. Ez most már végleges hiba.
        throw new Error(`Végleg nem sikerült a 'leagueId' azonosítása ('${leagueName}' néven, AI-val is).`);
    }

    const { leagueId, foundSeason } = leagueDataResponse;
    console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId} (A ${foundSeason} szezon alapján azonosítva)`);
    
    // 2. LÉPÉS: Csapat ID-k lekérése (Már a v56.0 "Öngyógyító" logikával)
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, foundSeason),
        getApiSportsTeamId(awayTeamName, sport, leagueId, foundSeason),
    ]);
    
    if (!homeTeamId || !awayTeamId) { 
        throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}. (Az AI feloldás sikertelen volt).`);
    }
    
    // 3. LÉPÉS: Meccskeresés
    const foundFixture = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport);
    const fixtureId = foundFixture?.fixture?.id || null;
    const fixtureDate = foundFixture?.fixture?.date || null;
    const refereeData = foundFixture?.fixture?.referee || null;
    const venueData = foundFixture?.fixture?.venue || null;
    
    if (!fixtureId) {
         console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
    }

    console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    
    // 4. LÉPÉS: Statisztikák (Valós időjárással a v55.9-ből)
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realFixtureStats,
        structuredWeather // Ez már a valós adatokat tartalmazza
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        (sport === 'soccer' && fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null),
        getWeatherForFixture(venueData, utcKickoff) // Ez hívja a v55.9-es utils-t
    ]);
    
    console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
    
    const realXgData = realFixtureStats || null; 
    const geminiData: any = {};
    
    // --- VÉGLEGES ADAT EGYESÍTÉS ---
    const finalData: ICanonicalRawData = {
        stats: {
            home: {} as ICanonicalStats, 
            away: {} as ICanonicalStats
        },
        apiFootballData: {
             homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
             lineups: null, liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        },
        h2h_structured: apiSportsH2HData || [],
        form: {
            home_overall: apiSportsHomeSeasonStats?.form || null,
            away_overall: apiSportsAwaySeasonStats?.form || null,
        },
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: {
            name: refereeData || "N/A",
            style: null 
        },
        contextual_factors: {
            stadium_location: venueData ? `${venueData.name}, ${venueData.city}` : "N/Am",
            structured_weather: structuredWeather, // v55.9 valós adat
            pitch_condition: "N/A", 
            weather: structuredWeather.description || "N/A",
            match_tension_index: null 
        }
    };
    
    const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || 1;
    finalData.stats.home = {
        gp: homeGP,
        gf: apiSportsHomeSeasonStats?.goalsFor || 0,
        ga: apiSportsHomeSeasonStats?.goalsAgainst || 0,
        form: apiSportsHomeSeasonStats?.form || null
    };
    
    const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || 1;
    finalData.stats.away = {
        gp: awayGP,
        gf: apiSportsAwaySeasonStats?.goalsFor || 0,
        ga: apiSportsAwaySeasonStats?.goalsAgainst || 0,
        form: apiSportsAwaySeasonStats?.form || null
    };
    
    console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
    
    const richContextParts = [
         realXgData && `- Valós xG (API-Football): H=${realXgData.home}, A=${realXgData.away}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`,
         refereeData && `- Bíró: ${refereeData}`
    ].filter(Boolean);
    
    const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
    
    const advancedData = realXgData ?
        { home: { xG: realXgData.home }, away: { xG: realXgData.away } } :
        { home: { xG: null }, away: { xG: null } };
    
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {},
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData,
         oddsData: fetchedOddsData, 
         fromCache: false
    };
    
    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
        console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
        throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-soccer';
