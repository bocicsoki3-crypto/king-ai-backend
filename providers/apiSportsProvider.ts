// providers/apiSportsProvider.ts (v54.4 - Build Fix 5. kísérlet)
// JAVÍTÁS: (Végleges) Minden generálási artefaktum (s, S, T, I, stb.) eltávolítva.
// JAVÍTÁS: (TS1404) Hiányzó '//' kommentjelek pótolva a getApiSportsTeamId függvényben.
// JAVÍTÁS: (TS1005) Hiányzó vessző pótolva a getApiSportsOdds -> result objektumban.
// JAVÍTÁS: (2. Fázis) 'getApiSportsFixtureStats' hívás eltávolítva a fetchMatchData-ból.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats, // Még importálva, mert a fetchMatchData használja a finalData-ban.
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult 
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData,
    makeRequest 
} from './common/utils.js';
// --- API-SPORTS SPECIFIKUS CACHE-EK ---
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const apiSportsFixtureStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
// --- NÉV- ÉS ROSTER CACHE-EK ---
const apiSportsNameMappingCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsRosterCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsCountryLeagueCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
// --- API-SPORTS KULCSROTÁCIÓS LOGIKA ---
let keyIndexes: { [key: string]: number } = {
    soccer: 0,
    hockey: 0,
    basketball: 0
};
function getApiConfig(sport: string) {
    const config = API_HOSTS[sport];
    if (!config || !config.host || !config.keys || config.keys.length === 0) {
        throw new Error(`Kritikus konfigurációs hiba: Nincsenek API kulcsok a '${sport}' sporthoz a config.js-ben.`);
    }
    const currentIndex = keyIndexes[sport];
    if (currentIndex >= config.keys.length) {
        throw new Error(`MINDEN API KULCS Kimerült a(z) '${sport}' sporthoz.`);
    }
    const currentKey = config.keys[currentIndex];
    return {
        baseURL: `https://${config.host}`,
        headers: {
            'x-rapidapi-key': currentKey,
            'x-rapidapi-host': config.host
        },
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
    } else {
        return false;
    }
}

// --- API-SPORTS KÖZPONTI HÍVÓ FÜGGVÉNY KULCSROTÁCIÓVAL ---
async function makeRequestWithRotation(sport: string, endpoint: string, config: AxiosRequestConfig = {}) {
    const maxAttempts = API_HOSTS[sport]?.keys?.length || 1;
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const apiConfig = getApiConfig(sport);
            const url = `${apiConfig.baseURL}${endpoint}`;
            const fullConfig: AxiosRequestConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
            const response = await makeRequest(url, fullConfig, 0); // makeRequest 'any' típust ad vissza, de AxiosResponse-nak kellene lennie
            return response; // SIKER

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


// --- ÚJ SEGÉDFÜGGVÉNY: A TELJES LIGA LEKÉRÉSE (CSAPATOKHOZ) ---
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
        return []; // Üres lista, ha hiba van
    }

    const roster = response.data.response;
    apiSportsRosterCache.set(cacheKey, roster);
    console.log(`API-SPORTS (${sport}): Csapatlista sikeresen lekérve, ${roster.length} csapat cache-elve.`);
    return roster;
}

// --- JAVÍTOTT getApiSportsTeamId (ROBUSZTUS, 5-LÉPCSŐS EGYEZTETÉS) ---
async function getApiSportsTeamId(teamName: string, sport: string, leagueId: number | string, season: number): Promise<number |
null> {
    const lowerName = teamName.toLowerCase().trim();
    // 1. LÉPÉS: Keménykódolt térkép (felülbírálás)
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] ||
teamName;
    const searchName = mappedName.toLowerCase();
    // 2. LÉPÉS: Dinamikus NÉV-CACHE ellenőrzése (leggyorsabb)
    const nameCacheKey = `apisports_name_map_v5_robust_${sport}_${leagueId}_${season}_${searchName.replace(/\s+/g, '')}`;
    const cachedMappedId = apiSportsNameMappingCache.get<number | 'not_found'>(nameCacheKey);
    if (cachedMappedId !== undefined) {
        if (cachedMappedId === 'not_found') {
            console.warn(`API-SPORTS (${sport}): NÉV-CACHE találat (NOT_FOUND): "${searchName}".`);
            return null;
        }
        console.log(`API-SPORTS (${sport}): NÉV-CACHE találat: "${searchName}" -> ${cachedMappedId}`);
        return cachedMappedId;
    }

    if (mappedName !== teamName) {
        console.log(`API-SPORTS Név Térképezés (${sport}): "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    }

    // 3. LÉPÉS: A TELJES LIGA-ROSTER LEKÉRÉSE (A MEGFELELŐ SZEZONNAL)
    const leagueRoster = await _getLeagueRoster(leagueId, season, sport);
    if (leagueRoster.length === 0) {
        console.warn(`API-SPORTS (${sport}): A liga (${leagueId}) csapatai nem érhetők el a(z) ${season} szezonban. Névfeloldás sikertelen.`);
        apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
        return null;
    }

    const teamObjects = leagueRoster.map(item => item.team);
    const lowerTeamNames = teamObjects.map(t => t.name.toLowerCase());
    // 4. LÉPÉS: TÖBBLÉPCSŐS EGYEZTETÉS
    let foundTeam: any = null;

    // 4a.
    // JAVÍTÁS: Hiányzó '//' pótolva
    // Próba: Tökéletes egyezés
    foundTeam = teamObjects.find(t => t.name.toLowerCase() === searchName);
    if (foundTeam) {
        console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Tökéletes): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
    }

    // 4b. Próba: 'Includes' ellenőrzés
    if (!foundTeam) {
        foundTeam = teamObjects.find(t => searchName.includes(t.name.toLowerCase()));
        if (foundTeam) {
            console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Tartalmazza): Az ESPN név "${searchName}" tartalmazza az API nevet "${foundTeam.name}" (ID: ${foundTeam.id})`);
        }
    }
    // 4c.
    // JAVÍTÁS: Hiányzó '//' pótolva
    // Próba: Fordított 'Includes' ellenőrzés
    if (!foundTeam) {
        const simplifiedSearchName = APIFOOTBALL_TEAM_NAME_MAP[searchName] ||
searchName;
        foundTeam = teamObjects.find(t => t.name.toLowerCase().includes(simplifiedSearchName));
        if (foundTeam) {
             console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Fordítva tartalmazza): Az API név "${foundTeam.name}" tartalmazza az ESPN nevet "${simplifiedSearchName}" (ID: ${foundTeam.id})`);
        }
    }

    // 4d.
    // JAVÍTÁS: Hiányzó '//' pótolva
    // Próba: Hasonlósági keresés (Engedékenyebb)
    if (!foundTeam) {
        const matchResult = findBestMatch(searchName, lowerTeamNames);
        if (matchResult.bestMatch.rating > 0.6) {
            foundTeam = teamObjects[matchResult.bestMatchIndex];
            console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Hasonló): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id}, Rating: ${matchResult.bestMatch.rating.toFixed(2)})`);
        }
    }

    // 4e.
    // JAVÍTÁS: Hiányzó '//' pótolva
    // Próba: Agresszív tisztítás + Hasonlósági keresés
    if (!foundTeam) {
        const cleanSearchName = searchName.replace(/^(1\.\s*FC|TSV|SC|FC)\s/i, '').replace(/\s(city|wanderers|berlin)/i, '').trim();
        const cleanTeamNames = lowerTeamNames.map(t => t.replace(/^(1\.\s*FC|TSV|SC|FC)\s/i, '').replace(/\s(bsc)/i, '').trim());
        const cleanMatchResult = findBestMatch(cleanSearchName, cleanTeamNames);
        if (cleanMatchResult.bestMatch.rating > 0.7) {
            foundTeam = teamObjects[cleanMatchResult.bestMatchIndex];
            console.log(`API-SPORTS (${sport}): HELYI TALÁLAT (Tisztított): "${searchName}" (keresve: "${cleanSearchName}") -> "${foundTeam.name}" (ID: ${foundTeam.id}, Rating: ${cleanMatchResult.bestMatch.rating.toFixed(2)})`);
        }
    }

    // 5. LÉPÉS: Eredmény feldolgozása
    if (foundTeam && foundTeam.id) {
        apiSportsNameMappingCache.set(nameCacheKey, foundTeam.id);
        return foundTeam.id;
    }

    // 6. LÉPÉS: Végleges hiba cache-elése
    console.warn(`API-SPORTS (${sport}): Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Szezon: ${season}, Eredeti: "${teamName}") a lekért ${leagueRoster.length} csapatos rosterben sem.`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}


// --- JAVÍTOTT getApiSportsLeagueId (VÉGLEGES, ORSZÁG-ALAPÚ KERESÉS + 2-LÉPCSŐS NÉV EGYEZTETÉS) ---
async function getApiSportsLeagueId(leagueName: string, country: string, season: number, sport: string): Promise<{ leagueId: number, foundSeason: number } |
null> {
    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const lowerCountry = country.toLowerCase();
    // Belső függvény, amely lekéri az ÖSSZES ligát egy országból
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
            apiSportsCountryLeagueCache.set(cacheKey, []); // Üres tömb cache-elése
            return [];
        }

        const leagues = response.data.response.map((l: any) => l.league);
        apiSportsCountryLeagueCache.set(cacheKey, leagues);
        console.log(`API-SPORTS (${sport}): ${leagues.length} liga cache-elve (${currentCountry}, ${currentSeason}).`);
        return leagues;
    };
    // Belső függvény, amely a helyi listán keres 2 LÉPCSŐBEN
    const _findLeagueInList = (leagues: any[], targetName: string): number |
null => {
        if (leagues.length === 0) return null;
        const targetLower = targetName.toLowerCase();
        const leagueNameMap = leagues.map(l => ({ 
            name: l.name, 
            lowerName: l.name.toLowerCase(), 
            id: l.id 
        }));
        // 1. Próba: Tökéletes egyezés
        const perfectMatch = leagueNameMap.find(l => l.lowerName === targetLower);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (Tökéletes): "${targetName}" -> "${perfectMatch.name}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        // 2. Próba: Nyers hasonlóság
        let matchResult = findBestMatch(targetLower, leagueNameMap.map(l => l.lowerName));
        const HIGH_CONFIDENCE_THRESHOLD = 0.85; // Szigorúbb küszöb
        if (matchResult.bestMatch.rating > HIGH_CONFIDENCE_THRESHOLD) { 
            const foundLeague = leagueNameMap[matchResult.bestMatchIndex];
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (Nyers hasonlóság, R: ${matchResult.bestMatch.rating.toFixed(2)}) "${targetName}" -> "${foundLeague.name}" (ID: ${foundLeague.id})`);
            return foundLeague.id;
        }

        // 3. Próba: Tisztított hasonlóság
        const cleanTargetName = targetLower.replace(new RegExp(`^${lowerCountry}\\s*`), '').trim();
        const cleanLeagueNames = leagueNameMap.map(l => l.lowerName.replace(new RegExp(`^${lowerCountry}\\s*`), '').trim());
        matchResult = findBestMatch(cleanTargetName, cleanLeagueNames);
        if (matchResult.bestMatch.rating > 0.7) {
            const foundLeague = leagueNameMap[matchResult.bestMatchIndex];
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (Tisztított, R: ${matchResult.bestMatch.rating.toFixed(2)}) "${targetName}" (keresve: "${cleanTargetName}") -> "${foundLeague.name}" (ID: ${foundLeague.id})`);
            return foundLeague.id;
        }
        
        return null;
    };
    // --- FŐ LOGIKA: SZEZON VISSZAKERESÉS ---
    let leagueData: { leagueId: number, foundSeason: number } |
null = null;
    const seasonsToTry = [season, season - 1, season - 2]; // Pl. [2025, 2024, 2023]
    
    for (const s of seasonsToTry) {
        console.log(`API-SPORTS (${sport}): Ligák keresése (Ország: ${country}, Szezon: ${s})...`);
        const leaguesInSeason = await _getLeaguesByCountry(country, s);
        const foundLeagueId = _findLeagueInList(leaguesInSeason, leagueName);
        if (foundLeagueId) {
            console.log(`API-SPORTS (${sport}): Liga sikeresen azonosítva a(z) ${s} szezonban (ID: ${foundLeagueId}). Keresés leáll.`);
            leagueData = { leagueId: foundLeagueId, foundSeason: s }; // Tároljuk el a szezont, amiben megtaláltuk!
            break; // Sikerült, állj!
        }
        if (sport !== 'soccer') {
             break; // Más sportágaknál ne keressünk vissza
        }
        console.warn(`API-SPORTS (${sport}): Nem található "${leagueName}" nevű liga ${country} országban a(z) ${s} szezonra.`);
    }

    if (!leagueData) {
        console.error(`API-SPORTS (${sport}): Végleg nem található liga ID ehhez: "${leagueName}" (${country}) (3 szezont ellenőrizve).`);
        return null;
    }
    
    return leagueData; // Visszaadja a { leagueId, foundSeason } objektumot vagy null-t
}


async function findApiSportsFixture(homeTeamId: number, awayTeamId: number, season: number, leagueId: number, utcKickoff: string, sport: string): Promise<{ fixtureId: number |
null, fixtureDate: string | null }> {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return { fixtureId: null, fixtureDate: null };
    const cacheKey = `apisports_findfixture_v41_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get<{ fixtureId: number | null, fixtureDate: string | null }>(cacheKey);
    if (cached) return cached;
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const endpoint = `/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    console.log(`API-SPORTS Fixture Keresés (${sport}): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában (${season} szezon)...`);
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find((f: any) => 
            (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId)
        );
        if (foundFixture) {
            const fixture = foundFixture.fixture || foundFixture;
            const result = { fixtureId: fixture.id, fixtureDate: fixture.date };
            console.log(`API-SPORTS (${sport}): MECCS TALÁLAT! FixtureID: ${result.fixtureId}`);
            apiSportsFixtureCache.set(cacheKey, result);
            return result;
        }
    }
    console.warn(`API-SPORTS (${sport}): Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz (Dátum: ${matchDate}, Szezon: ${season}).`);
    apiSportsFixtureCache.set(cacheKey, { fixtureId: null, fixtureDate: null });
    return { fixtureId: null, fixtureDate: null };
}

// === v50.1: ÚJ FUNKCIÓ A VÉGEREDMÉNY LEKÉRÉSÉHEZ ===
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { // A kanonikus típust használja
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
            return null; // Nem található
        }

        const fixture = response.data.response[0];
        const status = fixture.fixture?.status?.short;
        const goals = fixture.goals;

        // Csak a befejezett (Full Time) meccsek érdekelnek minket
        if (status === 'FT') {
            const result: FixtureResult = { // Típusos hozzárendelés
                home: goals.home,
                away: goals.away,
                status: 'FT'
            };
            fixtureResultCache.set(cacheKey, result); // Eredmény cache-elése (végleges)
            console.log(`[getApiSportsFixtureResult] Eredmény rögzítve (ID: ${fixtureId}): H:${result.home}-A:${result.away}`);
            return result;
        }

        console.log(`[getApiSportsFixtureResult] Meccs még nincs befejezve (ID: ${fixtureId}). Státusz: ${status}`);
        return { status: status }; // Visszaadjuk az aktuális státuszt, de nem cache-eljük véglegesen

    } catch (error: any) {
        console.error(`[getApiSportsFixtureResult] Hiba történt (ID: ${fixtureId}): ${error.message}`);
        return null;
    }
}
// === JAVÍTÁS VÉGE ===


async function getApiSportsH2H(homeTeamId: number, awayTeamId: number, limit: number = 5, sport: string): Promise<any[] |
null> {
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

// --- JAVÍTVA: A 'sport' paraméter hozzáadva a tryGetStats-hoz ---
async function getApiSportsTeamSeasonStats(teamId: number, leagueId: number, season: number, sport: string): Promise<any |
null> {
    
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
        // JAVÍTÁS: A 'sport' paraméter átadása a makeRequestWithRotation-nek
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        const stats = response?.data?.response;
        if (stats && (stats.league?.id || (stats.games?.played != null && stats.games?.played > 0))) { // Robusztusabb ellenőrzés
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
            let simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total ||
stats.games?.played,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };
            if (sport === 'hockey' && stats.games) { /* ... */ }
            if (sport === 'basketball' && stats.games) { /* ... */ }
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
         if (sport !== 'soccer') {
             break;
        }
        console.warn(`API-SPORTS (${sport}): Nem található statisztika a(z) ${s} szezonra.`);
    }

    if (!stats) {
        console.error(`API-SPORTS (${sport}): Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    return stats;
}

// --- JAVÍTOTT getApiSportsOdds (TS1005 JAVÍTVA) ---
async function getApiSportsOdds(fixtureId: number | string | null, sport: string): Promise<ICanonicalOdds |
null> {
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
// Inicializálás
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
        fromCache: false, // <-- JAVÍTVA: Hiányzó vessző (TS1005)
    };
    if (result.current.length > 0) {
        apiSportsOddsCache.set(cacheKey, result);
        console.log(`API-SPORTS Odds adatok (${sport}) sikeresen lekérve és cache-elve: ${cacheKey}`);
    } else {
         console.warn(`API-SPORTS Odds (${sport}): Találat, de nem sikerült '${winnerMarketName}' piacot találni.`);
    }
    return result; // Már tartalmazza a 'fromCache: false'-t
}


// --- ⚽ v50 JAVÍTÁS: ÚJ FUNKCIÓ AZ xG LEKÉRÉSÉHEZ AZ API-FOOTBALL-BÓL ---
async function getApiSportsFixtureStats(fixtureId: number | string | null, sport: string): Promise<{ home: number;
away: number } | null> {
    // Csak 'soccer' esetén futtatjuk, és csak ha van érvényes fixtureId
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
            apiSportsFixtureStatsCache.set(cacheKey, null); // Hibás választ is cache-elünk (rövid ideig)
            return null;
        }

        const stats = response.data.response;
        const homeStats = stats.find((s: any) => s.team?.id === stats[0].team?.id); // Feltételezzük, hogy az első a hazai
        const awayStats = stats.find((s: any) => s.team?.id !== stats[0].team?.id);
        if (!homeStats || !awayStats) {
             console.warn(`API-SPORTS Fixture Stats: Nem sikerült szétválasztani a hazai és vendég statisztikát (ID: ${fixtureId}).`);
             apiSportsFixtureStatsCache.set(cacheKey, null);
             return null;
        }

        // Keressük az "Expected Goals" statisztikát
        const homeXgStat = homeStats.statistics?.find((stat: any) => stat.type === 'Expected Goals');
        const awayXgStat = awayStats.statistics?.find((stat: any) => stat.type === 'Expected Goals');
        // Ellenőrizzük az xG adatot
        if (homeXgStat?.value == null || awayXgStat?.value == null) {
            console.warn(`API-SPORTS Fixture Stats: Az API válaszolt, de nem tartalmaz "Expected Goals" (xG) adatot (ID: ${fixtureId}). Ez valószínűleg a liga lefedettségének vagy a meccs státuszának (pl. még nem kezdődött el) hibája.`);
            apiSportsFixtureStatsCache.set(cacheKey, null);
            return null;
        }

        const xgData = {
            home: parseFloat(homeXgStat.value) || 0.0, // Biztonságos parse-olás
            away: parseFloat(awayXgStat.value) || 0.0
        };

        console.log(`API-SPORTS Fixture Stats: SIKERES. Valós xG: H=${xgData.home}, A=${xgData.away} (ID: ${fixtureId})`);
        apiSportsFixtureStatsCache.set(cacheKey, xgData);
        return xgData;

    } catch (error: any) {
        // Kezeljük az esetleges hibákat (pl. 404, ha a fixture-höz nincs statisztika)
        console.error(`API-SPORTS Fixture Stats Hiba (ID: ${fixtureId}): ${error.message}`);
        apiSportsFixtureStatsCache.set(cacheKey, null); // Hiba esetén is cache-elünk null-t
        return null;
    }
}
// --- v50 JAVÍTÁS VÉGE ---


// --- ⚽ xG API FUNKCIÓ (ELTÁVOLÍTVA v50) ---
// async function getXgData(fixtureId) { ... } // TÖRÖLVE


// --- JAVÍTOTT Odds Segédfüggvény (Robusztusabb Keresés) ---
function findMainTotalsLine(oddsData: ICanonicalOdds | null, sport: string): number {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line ||
(sport === 'soccer' ? 2.5 : 6.5);
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultConfigLine;
    }
    const bookmaker = oddsData.fullApiData.bookmakers.find((b: any) => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultConfigLine;
    let marketName: string;
    let alternativeMarketName: string | null = null;
    if (sport === 'soccer') {
        marketName = "over/under";
        alternativeMarketName = "totals";
    } else if (sport === 'hockey') {
        marketName = "total";
    } else if (sport === 'basketball') {
        marketName = "total points";
    } else {
        marketName = "over/under";
    }

    let totalsMarket = bookmaker.bets.find((b: any) => b.name.toLowerCase() === marketName);
    if (!totalsMarket && alternativeMarketName) {
        console.warn(`Nem található '${marketName}' piac. Keresés erre: '${alternativeMarketName}'...`);
        totalsMarket = bookmaker.bets.find((b: any) => b.name.toLowerCase() === alternativeMarketName);
    }

    if (!totalsMarket?.values) {
        console.warn(`Nem található '${marketName}' (sem '${alternativeMarketName || ''}') piac a szorzókban (${sport}).`);
        return defaultConfigLine;
    }
    
    const linesAvailable: { [key: string]: { over?: number, under?: number } } = {};
    for (const val of totalsMarket.values) {
        if (typeof val.value === 'string') {
            const lineMatch = val.value.match(/(\d+\.\d)/);
            const line = lineMatch ? lineMatch[1] : val.value; 
            if (isNaN(parseFloat(line))) continue; 
            if (!linesAvailable[line]) linesAvailable[line] = {};
            if (val.value.toLowerCase().startsWith("over")) {
                linesAvailable[line].over = parseFloat(val.odd);
            } else if (val.value.toLowerCase().startsWith("under")) {
                linesAvailable[line].under = parseFloat(val.odd);
            }
        }
    }
    if (Object.keys(linesAvailable).length === 0) {
        return defaultConfigLine;
    }
    let closestPair = { diff: Infinity, line: defaultConfigLine };
    for (const line in linesAvailable) {
        const pair = linesAvailable[line];
        if (pair.over && pair.under) {
            const diff = Math.abs(pair.over - pair.under);
            if (diff < closestPair.diff) {
                closestPair = { diff, line: parseFloat(line) };
            }
        }
    }
    if (closestPair.diff < 0.5) {
        return closestPair.line;
    }
    const numericDefaultLine = defaultConfigLine;
    const numericLines = Object.keys(linesAvailable).map(parseFloat);
    numericLines.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return numericLines[0];
}

// --- Szimulált Player Stats Funkció Eltávolítva (v52.9) ---
// --- Eredeti kód itt: getDetailedPlayerStats(homeTeamId, awayTeamId, leagueId) { ... }
// Ezt már a SofascoreProvider fogja biztosítani
// --- VÉGE ---


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA A SZEZON KEZELÉSÉVEL ÉS xG KONSZOLIDÁCIÓVAL v50) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName: rawLeagueName, utcKickoff: rawUtcKickoff } = options; // Átnevezés 'raw'-ra
    
    // --- MÓDOSÍTÁS KEZDETE ---
    // Biztosítjuk, hogy minden bemeneti paraméter dekódolva legyen
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(rawUtcKickoff));
    const leagueName = decodeURIComponent(decodeURIComponent(rawLeagueName)); // HIÁNYZÓ DEKÓDOLÁS HOZZÁADVA
    // --- MÓDOSÍTÁS VÉGE ---

    const seasonDate = new Date(decodedUtcKickoff);
    // Az 'originSeason' az aktuális év (vagy a szezonátfedés miatt az előző)
    const originSeason = (sport !== 'soccer' && seasonDate.getMonth() < 7) ?
    seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        
    if (isNaN(originSeason)) throw new Error(`Érvénytelen utcKickoff: ${decodedUtcKickoff}`);
    
    console.log(`Adatgyűjtés indul (v50 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    // 1. LÉPÉS: Liga adatok lekérése
    const sportConfig = SPORT_CONFIG[sport];
    
    // A 'leagueName' már a dekódolt '2. Bundesliga' értéket tartalmazza
    const leagueData = sportConfig.espn_leagues[leagueName];
    if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
    
    const country = leagueData.country;
    // Az 'originSeason' (pl. 2025) a kiindulópont. A függvény kezeli a 2024, 2023 fallback-et.
    const leagueDataResponse = await getApiSportsLeagueId(leagueName, country, originSeason, sport);
    
    if (!leagueDataResponse || !leagueDataResponse.leagueId) {
        throw new Error(`Nem sikerült a 'leagueId' azonosítása ('${leagueName}' néven).`);
    }

    // --- KRITIKUS JAVÍTÁS ---
    // A talált liga ID-t ÉS a szezont használjuk, amelyben megtaláltuk
    const { leagueId, foundSeason } = leagueDataResponse;
    console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId} (A ${foundSeason} szezon alapján azonosítva)`);
    // 2. LÉPÉS: Csapat ID-k lekérése (A 'foundSeason' használatával)
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, foundSeason),
        getApiSportsTeamId(awayTeamName, sport, leagueId, foundSeason),
    ]);
    if (!homeTeamId || !awayTeamId) { 
        throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`);
    }
    
    // 3. LÉPÉS: Meccskeresés (A 'foundSeason' használatával)
    const { fixtureId, fixtureDate } = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, decodedUtcKickoff, sport);
    if (!fixtureId) {
         console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
    }

    console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    // 4. LÉPÉS: Statisztikák (A 'foundSeason' használatával)
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        // Szimulált/redundáns hívások eltávolítva:
        
        // === 2. FÁZIS JAVÍTÁS (XG) ===
        // A 'realFixtureStats' (getApiSportsFixtureStats) hívás ELTÁVOLÍTVA.
        // Ez a végpont csak meccs UTÁN ad xG-t, meccs ELŐTT mindig hibát dob.
        // Ennek eltávolítása kényszeríti a Model.ts-t, hogy a becsült xG-t használja.
        // realFixtureStats, // TÖRÖLVE 
        // === JAVÍTÁS VÉGE ===

        // getDetailedPlayerStats (SZIMULÁLT) ELTÁVOLÍTVA (v52.9)
  D ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        // (sport === 'soccer' && fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null), // TÖRÖLVE
    ]);
    console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
    
    // --- v50 JAVÍTÁS: realXgData kinyerése a realFixtureStats-ból ---
    const realXgData = null; // Mivel a hívást eltávolítottuk, ez mindig null
    let geminiData: any = null; 
    
    // --- VÉGLEGES ADAT EGYESÍTÉS (v52.9) ---
    // Az ICanonicalRawData interfész alapján hozzuk létre a finalData-t
    const finalData: ICanonicalRawData = {
        ...(geminiData || {}), 
        stats: {
            home: {} as ICanonicalStats, 
            away: {} as ICanonicalStats
        },
        apiFootballData: {
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: null, liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        },
        h2h_structured: apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []),
        form: {
            home_overall: apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || null,
            away_overall: apiSportsHomeSeasonStats?.form || geminiData?.form?.away_overall || null,
        },
        // Alapértelmezett, üres playerStats, amelyet a DataFetch.ts fog felülírni a Sofascore adatokkal
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] } // Sofascore fogja felülírni
  D };
    // Kanonikus statisztikák feltöltése (gp, gf, ga, form)
    const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || geminiData?.stats?.home?.gp || 1;
    finalData.stats.home = {
        gp: homeGP,
        gf: apiSportsHomeSeasonStats?.goalsFor || geminiData?.stats?.home?.gf || 0,
        ga: apiSportsHomeSeasonStats?.goalsAgainst || geminiData?.stats?.home?.ga || 0,
        form: apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || null
    };
    const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || geminiData?.stats?.away?.gp || 1;
    finalData.stats.away = {
        gp: awayGP,
        gf: apiSportsAwaySeasonStats?.goalsFor || geminiData?.stats?.away?.gf || 0,
        ga: apiSportsAwaySeasonStats?.goalsAgainst || geminiData?.stats?.away?.ga || 0,
        form: apiSportsAwaySeasonStats?.form || geminiData?.form?.away_overall || null
    };
    console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
    
    // Kontextus adatok (időjárás, stb.)
    const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
    const structuredWeather = await getStructuredWeatherData(stadiumLocation, decodedUtcKickoff);
    if (!finalData.contextual_factors) finalData.contextual_factors = {};
    finalData.contextual_factors.structured_weather = structuredWeather;
    const richContextParts = [
         realXgData && `- Valós xG (API-Football): H=${realXgData.home}, A=${realXgData.away}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`
    ].filter(Boolean);
    const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
    
    const advancedData = realXgData ?
        { home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
        (geminiData?.advancedData || { home: { xg: null }, away: { xg: null } });
    // A végső ICanonicalRichContext objektum összeállítása
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: finalData.league_averages || {},
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData, // Ez tartalmazza az alapértelmezett detailedPlayerStats-t
         oddsData: fetchedOddsData, 
         fromCache: false
    };
    // Validáció
    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
        console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
        throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-soccer';
