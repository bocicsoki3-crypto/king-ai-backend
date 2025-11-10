// FÁJL: providers/apiSportsProvider.ts
// VERZIÓ: v95.2 ("Okos" Alias Javítás)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (KRITIKUS): A `_cleanLeagueName` (kb. 300. sor) logikája
//    MEGFORDÍTVA.
// 2. LOGIKA: Először a SPECIFIKUS alias-szabályok futnak le (pl. "Segunda División" -> "laliga2").
// 3. LOGIKA: Az általános "buta" tisztítás (pl. "division" szó törlése)
//    CSAK AKKOR fut le, ha a specifikus szabályok nem találtak egyezést.
// 4. CÉL: Ez a javítás véglegesen megoldja a "Segunda División" / "laliga2"
//    azonosítási hibát, ami a log naplóban látható volt.

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
    IStructuredWeather,
    IPlayerStub
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    makeRequest,
    getStructuredWeatherData
} from './common/utils.js';

// --- API-SPORTS SPECIFIKUS CACHE-EK ---
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const apiSportsFixtureStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsNameMappingCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsRosterCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsSquadCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsCountryLeagueCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsLineupCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const apiSportsRefereeCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });

// (v77.2) Hiányzó típusdefiníció
type LineupDataPayload = {
    playerStats: ICanonicalPlayerStats;
    coachData: {
        home_name: string | null;
        away_name: string | null;
    };
    rosters: {
        home: IPlayerStub[];
        away: IPlayerStub[];
    };
};

// --- API-SPORTS KULCSROTÁCIÓS LOGIKA (Változatlan v95.1) ---
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

// === EXPORTÁLVA (Változatlan v95.1) ===
export async function _getLeagueRoster(leagueId: number | string, season: number, sport: string): Promise<any[]> {
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

// === EXPORTÁLVA (Változatlan v95.1) ===
export async function getApiSportsTeamId(teamName: string, sport: string, leagueId: number | string, season: number): Promise<number | null> {
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();
    const nameCacheKey = `apisports_name_map_v6_strict_${sport}_${leagueId}_${season}_${searchName.replace(/\s/g, '')}`;
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

    if (foundTeam && foundTeam.id) {
        apiSportsNameMappingCache.set(nameCacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[apiSportsProvider] A statikus csapat ID azonosítás sikertelen ehhez: "${searchName}". A DataFetch.ts most elindítja az AI Fallback-et...`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}

// === EXPORTÁLVA (JAVÍTVA v95.2) ===
export async function getApiSportsLeagueId(leagueName: string, country: string, season: number, sport: string): Promise<{ leagueId: number, foundSeason: number } | null> {
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
        // JAVÍTÁS (v95.1): A 'leagues' tömb most már a teljes 'league' objektumot tartalmazza
        const leagues = response.data.response.map((l: any) => l.league);
        apiSportsCountryLeagueCache.set(cacheKey, leagues);
        console.log(`API-SPORTS (${sport}): ${leagues.length} liga cache-elve (${currentCountry}, ${currentSeason}).`);
        return leagues;
    };
    
    // === JAVÍTÁS (v95.2): "Okos" Alias Logika ===
    
    /**
     * Eltávolítja az ékezeteket és a felesleges szavakat a liga nevéből
     * a megbízhatóbb egyeztetés érdekében.
     * KRITIKUS VÁLTOZÁS (v95.2): A specifikus szabályok futnak ELŐSZÖR.
     */
    const _cleanLeagueName = (name: string): string => {
        if (!name) return 'n/a';
        let lower = name.toLowerCase().trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Ékezetek eltávolítása (pl. Süper -> Super)

        // 1. LÉPÉS: Specifikus, "okos" szabályok (EZ FUT LE ELŐSZÖR)
        
        // Spanyolország (LaLiga 1 & 2)
        // "laliga" (ESPN 1), "la liga" (API)
        // "laliga2" (ESPN 2), "laliga hypermotion" (API), "segunda division" (API)
        if (lower.includes('laliga') || lower.includes('segunda division')) {
            // Megkülönböztetjük az 1-es és 2-es osztályt
            if (lower.includes('2') || lower.includes('hypermotion') || lower.includes('segunda')) {
                return 'laliga2'; // Ez a "Segunda División"-t is elkapja
            }
            return 'laliga1'; // Ez a "La Liga"-t is elkapja
        }

        // Törökország (Super Lig)
        // "super lig" (ESPN), "süper lig" (API)
        if (lower.includes('super lig')) { // Az ékezetet már eltávolítottuk
            return 'superlig';
        }
        
        // ... Ide jöhetnek más specifikus szabályok ...

        // 2. LÉPÉS: Általános, "buta" tisztítás (CSAK HA AZ ELŐZŐ NEM SIKERÜLT)
        // Ez az a szabály, ami a v95.1-ben hibát okozott, mert túl korán futott le.
        lower = lower.replace(/\(.*?\)/g, '') // Zárójelek eltávolítása
                     .replace(/^(argentinian|brazilian|uefa|fifa)\s/i, '') // Előtagok
                     .replace(/\s(league|liga|cup|copa|championship|division|super|lig|ligue|serie|profesional)/i, '') // Utótagok
                     .trim();

        return lower;
    };

    const _findLeagueInList = async (leagues: any[], targetName: string): Promise<number | null> => {
        if (leagues.length === 0) return null;
        
        const targetLower = targetName.toLowerCase().trim();
        
        // 1. Keresés Tökéletes Egyezésre (pl. "Premier League")
        let perfectMatch = leagues.find(l => l.name.toLowerCase() === targetLower);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (1/2 - Tökéletes): "${targetName}" -> "${perfectMatch.name}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        // 2. Keresés Normalizált Név Alapján (v95.2 - Javított logika)
        const cleanTargetName = _cleanLeagueName(targetName); // pl. "LaLiga2" -> "laliga2"

        const leagueNameMap = leagues.map(l => ({
            original: l.name,
            cleaned: _cleanLeagueName(l.name), // pl. "Segunda División" -> "laliga2"
            id: l.id
        }));

        const normalizedMatch = leagueNameMap.find(l => l.cleaned === cleanTargetName);
        if (normalizedMatch) {
            // Ez az az üzenet, amit a logban látni akarunk:
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (2/2 - Normalizált v95.2): "${targetName}" (Keresve: "${cleanTargetName}") -> "${normalizedMatch.original}" (ID: ${normalizedMatch.id})`);
            return normalizedMatch.id;
        }

        console.warn(`API-SPORTS (${sport}): Nem található pontos liga egyezés ehhez: "${targetName}" (Keresve: "${cleanTargetName}"). AI Fallback KIHAGYVA (v70.0).`);
        
        // DEBUG: Ha nem találja, kiírjuk, mit keresett
        console.warn(`[DEBUG v95.2] A(z) "${cleanTargetName}" keresés sikertelen. Elérhető tisztított nevek a(z) "${country}" országban:`);
        console.warn(leagueNameMap.map(l => `${l.original} -> ${l.cleaned}`).join('\n'));
        
        return null;
    };
    // === JAVÍTÁS VÉGE ===

    let leagueData: { leagueId: number, foundSeason: number } | null = null;
    const seasonsToTry = [season, season - 1, season - 2];
    for (const s of seasonsToTry) {
        console.log(`API-SPORTS (${sport}): Ligák keresése (Ország: ${country}, Szezon: ${s})...`);
        const leaguesInSeason = await _getLeaguesByCountry(country, s);
        const foundLeagueId = await _findLeagueInList(leaguesInSeason, leagueName);
        if (foundLeagueId) {
            console.log(`API-SPORTS (${sport}): Liga sikeresen azonosítva a(z) ${s} szezonban (ID: ${foundLeagueId}). Keresés leáll.`);
            leagueData = { leagueId: foundLeagueId, foundSeason: s }; 
            apiSportsLeagueIdCache.set(leagueCacheKey, leagueData);
            break;
        }
        if (sport !== 'soccer') break;
        console.warn(`API-SPORTS (${sport}): Nem található "${leagueName}" nevű liga ${country} országban a(z) ${s} szezonra.`);
    }
    if (!leagueData) {
        console.error(`API-SPORTS (${sport}): Végleg nem található liga ID ehhez: "${leagueName}" (${country}) (3 szezont ellenőrizve).`);
        return null;
    }
    return leagueData;
}

// --- findApiSportsFixture (Változatlan v95.1) ---
async function findApiSportsFixture(homeTeamId: number | null, awayTeamId: number | null, season: number, leagueId: number, utcKickoff: string, sport: string): Promise<any | null> {
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

// --- getApiSportsFixtureResult (Változatlan v95.1) ---
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

// --- getApiSportsH2H (Változatlan v95.1) ---
export async function getApiSportsH2H(homeTeamId: number | null, awayTeamId: number | null, limit: number = 5, sport: string): Promise<any[] | null> {
    if (!homeTeamId || !awayTeamId) {
        console.warn(`[getApiSportsH2H] Lekérés kihagyva: Hiányzó csapat ID (H:${homeTeamId}, A:${awayTeamId}).`);
        return null;
    }
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

// --- getApiSportsTeamSeasonStats (Változatlan v95.1) ---
export async function getApiSportsTeamSeasonStats(teamId: number | null, leagueId: number, season: number, sport: string): Promise<any | null> {
    if (!teamId) {
        console.warn(`[getApiSportsTeamSeasonStats] Lekérés kihagyva: Hiányzó csapat ID.`);
        return null;
    }
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
                gamesPlayed: stats.fixtures?.played?.total ||
stats.games?.played,
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

// --- getApiSportsOdds (Változatlan v95.1) ---
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
    const bookmaker = oddsData.bookmakers?.find((b: any) => b.name === "Bet365") ||
oddsData.bookmakers?.[0];
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

// --- getApiSportsFixtureStats (Változatlan v95.1) ---
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
            home: parseFloat(homeXgStat.value) ||
0.0, 
            away: parseFloat(awayXgStat.value) ||
0.0
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

// --- _getSquadForTeam (Változatlan v95.1) ---
async function _getSquadForTeam(teamId: number | null, season: number, sport: string): Promise<IPlayerStub[]> {
    if (!teamId) {
        console.warn(`[API-SPORTS Squad] Lekérés kihagyva: Hiányzó csapat ID.`);
        return [];
    }
    const cacheKey = `apisports_squad_v1_${sport}_${teamId}_${season}`;
    const cachedSquad = apiSportsSquadCache.get<IPlayerStub[]>(cacheKey);
    if (cachedSquad) {
        console.log(`[API-SPORTS Squad] Cache találat (T:${teamId}, S:${season})`);
        return cachedSquad;
    }

    console.log(`[API-SPORTS Squad] Teljes keret lekérése (T:${teamId}, S:${season})...`);
    const fetchPage = async (page: number): Promise<any[]> => {
        const endpoint = `/v3/players`;
        const params = { team: teamId, season: season, page: page };
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        return response?.data?.response || [];
    };

    let allPlayers: any[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    while (hasMorePages) {
        const players = await fetchPage(currentPage);
        if (players.length > 0) {
            allPlayers.push(...players);
            currentPage++;
            if (players.length < 20) { 
                hasMorePages = false;
            }
        } else {
            hasMorePages = false;
        }
    }

    if (allPlayers.length === 0) {
        console.warn(`[API-SPORTS Squad] Nem található keret (T:${teamId}, S:${season}).`);
        return [];
    }

    const mapPlayerToStub = (p: any): IPlayerStub | null => {
        if (!p?.player?.id || !p?.player?.name) return null;
        
        let rawPos = p.statistics?.[0]?.games?.position || p.player.type || 'N/A';

        return {
            id: p.player.id,
            name: p.player.name,
            pos: rawPos,
            rating_last_5: 7.5
        };
    };
    const squad = allPlayers
        .map(mapPlayerToStub)
        .filter((p): p is IPlayerStub => p !== null);
    
    const normalizePos = (pos: string): string => {
        if (!pos) return 'N/A';
        const p = pos.toLowerCase();
        if (p.includes('goalkeeper') || p.includes('kapus')) return 'G';
        if (p.includes('defender') || p.includes('védő')) return 'D';
        if (p.includes('midfielder') || p.includes('középpályás')) return 'M';
        if (p.includes('attacker') || p.includes('forward') || p.includes('támadó')) return 'F';
        return 'N/A';
    };
    
    const finalSquad = squad.map(p => ({ ...p, pos: normalizePos(p.pos) }));

    apiSportsSquadCache.set(cacheKey, finalSquad);
    console.log(`[API-SPORTS Squad] Keret sikeresen lekérve (T:${teamId}, S:${season}). ${finalSquad.length} játékos cache-elve.`);
    return finalSquad;
}


// --- _getApiSportsLineupData (Változatlan v95.1) ---
async function _getApiSportsLineupData(
    fixtureId: number | string | null,
    sport: string,
    homeTeamId: number | null,
    awayTeamId: number | null,
    season: number
): Promise<LineupDataPayload | null> {
    if (sport !== 'soccer' || !fixtureId || !homeTeamId || !awayTeamId) {
        console.log(`[API-SPORTS LineupData] Lekérés kihagyva (Sport nem foci, vagy hiányzó FixtureID/Team ID).`);
        return null;
    }
    
    const cacheKey = `apisports_lineups_v4_squad_${fixtureId}_${season}`;
    const cached = apiSportsLineupCache.get<LineupDataPayload>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS LineupData] Cache találat (v4_squad): ${cacheKey}`);
        return cached;
    }

    console.log(`[API-SPORTS LineupData] Adatok lekérése (FixtureID: ${fixtureId})...`);
    
    const [
        squadData,
        lineupResponse
    ] = await Promise.all([
        Promise.all([
            _getSquadForTeam(homeTeamId, season, sport),
            _getSquadForTeam(awayTeamId, season, sport)
        ]),
        (async () => {
            try {
                const endpoint = `/v3/fixtures/lineups`;
                const params = { fixture: fixtureId };
                return await makeRequestWithRotation(sport, endpoint, { params });
            } catch (e: any) {
       
                console.warn(`[API-SPORTS LineupData] A /v3/fixtures/lineups hívás sikertelen (ID: ${fixtureId}): ${e.message}. Ez várható, ha a meccs még messze van.`);
                return null;
            }
        })()
    ]);
    const [homeRoster, awayRoster] = squadData;

    let coachData = { home_name: null, away_name: null };
    let playerStats: ICanonicalPlayerStats = {
        home_absentees: [],
        away_absentees: [],
        key_players_ratings: { home: {}, away: {} }
    };

    if (lineupResponse && lineupResponse.data?.response?.length > 0) {
        console.log(`[API-SPORTS LineupData] Sikeres /lineups válasz (Edzők/Kezdők).`);
        const data = lineupResponse.data.response;
        const homeData = data.find((t: any) => t.team?.id === homeTeamId);
        const awayData = data.find((t: any) => t.team?.id === awayTeamId); 
        
        if (homeData && awayData) {
            coachData = {
                home_name: homeData.coach?.name || null,
                away_name: awayData.coach?.name || null
            };
        } else {
            console.warn(`[API-SPORTS LineupData] Nem sikerült a hazai/vendég adat szétválasztása (ID: ${fixtureId}).`);
        }
    } else {
        console.warn(`[API-SPORTS LineupData] Nem érkezett adat a /v3/fixtures/lineups végpontról (ID: ${fixtureId}). A P1 választó a teljes keretet fogja használni.`);
    }

    console.log(`[API-SPORTS LineupData] Adat feldgozva. (Edzők: H:${coachData.home_name}, A:${coachData.away_name}). (TELJES Keret: H:${homeRoster.length}, A:${awayRoster.length})`);
    const result: LineupDataPayload = { 
        playerStats, 
        coachData,
        rosters: { home: homeRoster, away: awayRoster }
    };
    apiSportsLineupCache.set(cacheKey, result);
    return result;
}

// --- getApiSportsLineupsAndInjuries (Változatlan v95.1) ---
export async function getApiSportsLineupsAndInjuries(
    fixtureId: number | string | null,
    sport: string,
    homeTeamId: number | null, 
    awayTeamId: number | null, 
    season: number
): Promise<ICanonicalPlayerStats | null> {
    const data = await _getApiSportsLineupData(fixtureId, sport, homeTeamId, awayTeamId, season);
    return data ? data.playerStats : null;
}

// --- _getApiSportsRefereeStyle (Változatlan v95.1) ---
async function _getApiSportsRefereeStyle(
    refereeName: string | null,
    leagueId: number,
    season: number,
    sport: string
): Promise<string | null> {
    if (sport !== 'soccer' || !refereeName || refereeName === "N/A" || !leagueId || !season) {
        return null;
    }
    const cacheKey = `apisports_referee_v1_${refereeName.toLowerCase().replace(/\s/g, '')}_${leagueId}_${season}`;
    const cached = apiSportsRefereeCache.get<string>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS Bíró] Cache találat: ${refereeName} -> ${cached}`);
        return cached;
    }
    console.log(`[API-SPORTS Bíró] Stílus lekérése... (Név: ${refereeName}, Liga: ${leagueId})`);
    try {
        const searchEndpoint = `/v3/referees`;
        let params: any = { search: refereeName, league: leagueId, season: season };
        let response = await makeRequestWithRotation(sport, searchEndpoint, { params });
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[API-SPORTS Bíró] Nem található ${refereeName} a ${leagueId} ligában. Kiterjesztett keresés...`);
            params = { search: refereeName };
            response = await makeRequestWithRotation(sport, searchEndpoint, { params });
        }
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[API-SPORTS Bíró] Végleg nem található adat ehhez: ${refereeName}`);
            apiSportsRefereeCache.set(cacheKey, "N/A");
            return null;
        }
        const refereeData = response.data.response[0];
        const leagueStats = refereeData.leagues?.find((l: any) => l.id === leagueId && l.season === season) || refereeData.leagues?.[0];
        if (!leagueStats || !leagueStats.cards) {
            console.warn(`[API-SPORTS Bíró] A bírónak (${refereeName}) nincs lap statisztikája ehhez a ligához.`);
            apiSportsRefereeCache.set(cacheKey, "N/A");
            return null;
        }
        const cardsPerMatch = leagueStats.cards?.total / leagueStats.matches;
        if (isNaN(cardsPerMatch)) {
            apiSportsRefereeCache.set(cacheKey, "N/A");
            return null;
        }
        const AVG_CARDS_IN_LEAGUE = 4.5;
        let style: string;
        if (cardsPerMatch > (AVG_CARDS_IN_LEAGUE + 1.0)) {
            style = `Szigorú (${cardsPerMatch.toFixed(2)} lap/meccs)`;
        } else if (cardsPerMatch < (AVG_CARDS_IN_LEAGUE - 1.0)) {
            style = `Engedékeny (${cardsPerMatch.toFixed(2)} lap/meccs)`;
        } else {
            style = `Átlagos (${cardsPerMatch.toFixed(2)} lap/meccs)`;
        }
        console.log(`[API-SPORTS Bíró] Stílus azonosítva: ${refereeName} -> ${style}`);
        apiSportsRefereeCache.set(cacheKey, style);
        return style;
    } catch (error: any) {
        console.error(`[API-SPORTS Bíró] Hiba (${refereeName}) lekérése közben: ${error.message}`);
        return null;
    }
}

// --- getWeatherForFixture (Változatlan v95.1) ---
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    const location = venue?.city ||
null;
    return await getStructuredWeatherData(location, utcKickoff);
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (Változatlan v95.1) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    
    // (v94.2) A DataFetch.ts (v93.0) által feloldott ID-k kinyerése
    const { 
        sport, 
        homeTeamName, 
        awayTeamName, 
        leagueName, 
        utcKickoff, 
        countryContext,
        homeTeamId, 
        awayTeamId, 
        leagueId,   
        foundSeason 
    } = options;
    
    console.log(`Adatgyűjtés indul (v95.1 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    
    console.log(`[apiSportsProvider] Feloldott ID-k fogadva: H:${homeTeamId}, A:${awayTeamId}, L:${leagueId}, S:${foundSeason}`);

    // 3. LÉPÉS: Meccskeresés (A kapott ID-kkal)
    const foundFixture = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport);
    const fixtureId = foundFixture?.fixture?.id || null;
    const fixtureDate = foundFixture?.fixture?.date || null;
    const refereeData = foundFixture?.fixture?.referee || null;
    const venueData = foundFixture?.fixture?.venue || null;
    
    if (!fixtureId) {
         console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
    }

    console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    
    // 4. LÉPÉS: Statisztikák
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realFixtureStats,
        structuredWeather,
        lineupData
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        (sport === 'soccer' && fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null),
        getWeatherForFixture(venueData, utcKickoff),
        _getApiSportsLineupData(fixtureId, sport, homeTeamId, awayTeamId, foundSeason)
    ]);
    
    // 5. LÉPÉS: Bíró Stílus lekérése
    const refereeStyle = await _getApiSportsRefereeStyle(refereeData?.name || null, leagueId, foundSeason, sport);
    console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
    
    const realXgData = realFixtureStats || null;
    
    // --- VÉGLEGES ADAT EGYESÍTÉS ---
    
    const finalData: ICanonicalRawData = {
        stats: {
            home: {} as ICanonicalStats, 
            away: {} as ICanonicalStats
        },
        apiFootballData: {
             homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
             foundSeason: foundSeason,
             lineups: null, liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        },
        h2h_structured: apiSportsH2HData ||
[],
        form: {
            home_overall: apiSportsHomeSeasonStats?.form ||
null,
            away_overall: apiSportsAwaySeasonStats?.form ||
null,
        },
        detailedPlayerStats: lineupData?.playerStats ||
{
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { 
            home: lineupData?.playerStats?.home_absentees ||
[], 
            away: lineupData?.playerStats?.away_absentees ||
[] 
        },
        referee: {
            name: refereeData?.name ||
"N/A",
            style: refereeStyle ||
null
        },
        contextual_factors: {
            stadium_location: venueData ?
`${venueData.name}, ${venueData.city}` : "N/A",
            structured_weather: structuredWeather,
            pitch_condition: "N/A", 
            weather: structuredWeather.description ||
"N/A",
            match_tension_index: null,
            coach: {
                home_name: lineupData?.coachData?.home_name ||
null,
                away_name: lineupData?.coachData?.away_name ||
null
            }
        },
        availableRosters: {
            home: lineupData?.rosters?.home ||
[],
            away: lineupData?.rosters?.home ||
[]
        }
    };
    
    const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || 1;
    finalData.stats.home = {
        gp: homeGP,
        gf: apiSportsHomeSeasonStats?.goalsFor ||
0,
        ga: apiSportsHomeSeasonStats?.goalsAgainst ||
0,
        form: apiSportsHomeSeasonStats?.form || null
    };
    const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || 1;
    finalData.stats.away = {
        gp: awayGP,
        gf: apiSportsAwaySeasonStats?.goalsFor ||
0,
        ga: apiSportsAwaySeasonStats?.goalsAgainst ||
0,
        form: apiSportsAwaySeasonStats?.form || null
    };
    console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
    
    const richContextParts = [
         realXgData && `- Valós xG (API-Football): H=${realXgData.home}, A=${realXgData.away}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall ||
'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`,
         refereeData && `- Bíró: ${finalData.referee?.name} (${refereeStyle || 'Ismeretlen stílus'})`,
         lineupData?.coachData?.home_name && `- Edzők: H: ${lineupData.coachData.home_name}, A: ${lineupData.coachData.away_name}`
    ].filter(Boolean);
    const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
    
    const advancedData = realXgData ?
    { home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
        { home: { xg: null }, away: { xg: null } };
        
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {},
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData,
         oddsData: fetchedOddsData, 
         fromCache: false,
         availableRosters: {
            home: lineupData?.rosters?.home ||
[],
            away: lineupData?.rosters?.away ||
[]
        }
    };
    
    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats?.away?.gp <= 0) {
        console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
        result.rawStats.home.gp = 1;
        result.rawStats.away.gp = 1;
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-soccer';
}
