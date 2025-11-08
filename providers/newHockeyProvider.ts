// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v74.0 (Architekta Javítás - "Tiszta P1" Hibatűrés)
// MÓDOSÍTÁS:
// 1. ELTÁVOLÍTVA: A _callGemini és PROMPT_V43 importok törölve (v70.0).
// 2. MÓDOSÍTVA (v74.0): A 'fetchMatchData' logikája "hibatűrővé" alakítva.
// 3. LOGIKA (v74.0): Ha a 'getApiSportsTeamId' hibát jelez (pl. HomeID: null),
//    a provider már NEM dob fatális hibát. Ehelyett naplózza a hibát,
//    és egy üres, de érvényes "stub" választ ad vissza (generateEmptyStubContext).
// 4. CÉL (v74.0): Ez lehetővé teszi, hogy az 'AnalysisFlow.ts' folytatódjon,
//    és a felhasználó P1-es (manuális) xG és hiányzó adatait használja
//    azokon a napokon, amikor az 'api-sports-hockey-v1' API nem működik.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult,
    IStructuredWeather,
    IPlayerStub
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    NHL_TEAM_NAME_MAP,
    APISPORTS_HOCKEY_HOST,
    APISPORTS_HOCKEY_KEY
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    // _callGemini és PROMPT_V43 ELTÁVOLÍTVA (v70.0)
    makeRequest,
    getStructuredWeatherData
} from './common/utils.js';

// --- API-SPORTS (HOKI) SPECIFIKUS CACHE-EK ---
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const apiSportsFixtureStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsRosterCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsCountryLeagueCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsNameMappingCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });

// --- API-SPORTS KÖZPONTI HÍVÓ FÜGGVÉNY ---
async function makeHockeyRequest(endpoint: string, config: AxiosRequestConfig = {}) {
    const sport = 'hockey';
    if (!APISPORTS_HOCKEY_HOST || !APISPORTS_HOCKEY_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó APISPORTS_HOCKEY_HOST vagy APISPORTS_HOCKEY_KEY a .env fájlban.`);
    }
    const apiConfig = {
        baseURL: `https://${APISPORTS_HOCKEY_HOST}`,
        headers: { 'x-apisports-key': APISPORTS_HOCKEY_KEY }
    };
    try {
        const url = `${apiConfig.baseURL}${endpoint}`;
        const fullConfig: AxiosRequestConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
        // A központi 'makeRequest' hívása a 'common/utils.ts'-ből
        const response = await makeRequest(url, fullConfig, 0); 
        return response;
    } catch (error: any) {
        if (error.isQuotaError) {
            throw new Error(`API KULCS Kimerült (${sport}).`);
        } else {
            console.error(`[API-SPORTS (Hockey)] Hiba: ${error.message}`);
            throw error;
        }
    }
}

// --- _getLeagueRoster (v74.0 - Hibatűrő) ---
async function _getLeagueRoster(leagueId: number | string, season: number, sport: string): Promise<{ roster: any[], foundSeason: number }> {
    const tryGetRosterForSeason = async (currentSeason: number) => {
        const cacheKey = `apisports_roster_v1_${sport}_${leagueId}_${currentSeason}`;
        const cachedRoster = apiSportsRosterCache.get<any[]>(cacheKey);
        if (cachedRoster) {
            console.log(`[API-SPORTS (Hockey)]: Csapatlista CACHE TALÁLAT (Liga: ${leagueId}, Szezon: ${currentSeason})`);
            return cachedRoster;
        }
        console.log(`[API-SPORTS (Hockey)]: Csapatlista lekérése (Liga: ${leagueId}, Szezon: ${currentSeason})...`);
        const endpoint = `/teams?league=${leagueId}&season=${currentSeason}`;
        
        try {
            const response = await makeHockeyRequest(endpoint, {});
            if (!response?.data?.response || response.data.response.length === 0) {
                console.warn(`[API-SPORTS (Hockey)]: Nem sikerült lekérni a csapatlistát a ${leagueId} ligából, ${currentSeason} szezon.`);
                return null;
            }
            const roster = response.data.response;
            apiSportsRosterCache.set(cacheKey, roster);
            console.log(`[API-SPORTS (Hockey)]: Csapatlista sikeresen lekérve, ${roster.length} csapat cache-elve (Szezon: ${currentSeason}).`);
            return roster;
        } catch (e: any) {
            console.error(`[API-SPORTS (Hockey)] KRITIKUS API HIBA a csapatlista lekérésekor (Szezon: ${currentSeason}): ${e.message}`);
            return null; // Hibatűrés: null-t adunk vissza, nem 'throw'
        }
    };
    
    let roster = await tryGetRosterForSeason(season);
    if (roster && roster.length > 0) {
        return { roster, foundSeason: season };
    }
    
    const fallbackSeason = season - 1;
    console.warn(`[API-SPORTS (Hockey)]: A ${season} szezon üres volt. Újrapróbálkozás a ${fallbackSeason} szezonnal...`);
    roster = await tryGetRosterForSeason(fallbackSeason);
    if (roster && roster.length > 0) {
        console.log(`[API-SPORTS (Hockey)]: Siker. A csapatlista a ${fallbackSeason} (fallback) szezonból származik.`);
        return { roster, foundSeason: fallbackSeason };
    }
    
    console.error(`[API-SPORTS (Hockey)]: A csapatlista lekérése sikertelen mind a ${season}, mind a ${fallbackSeason} szezonra (Liga: ${leagueId}).`);
    return { roster: [], foundSeason: season }; // Hibatűrés: Üres listát adunk vissza
}

// --- getApiSportsTeamId (v70.0 - AI Nélkül) ---
async function getApiSportsTeamId(
    teamName: string, 
    sport: string, 
    leagueId: number | string, 
    season: number,
    leagueRosterData: { roster: any[], foundSeason: number }
): Promise<number | null> {
    
    const { roster, foundSeason } = leagueRosterData;
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = NHL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();
    const nameCacheKey = `apisports_name_map_v6_strict_${sport}_${leagueId}_${foundSeason}_${searchName.replace(/\s+/g, '')}`;
    const cachedMappedId = apiSportsNameMappingCache.get<number | 'not_found'>(nameCacheKey);
    if (cachedMappedId !== undefined) {
        if (cachedMappedId === 'not_found') {
            return null;
        }
        console.log(`[API-SPORTS (Hockey)]: NÉV-CACHE találat (v6 Strict): "${searchName}" -> ${cachedMappedId}`);
        return cachedMappedId;
    }
    if (mappedName !== teamName) {
        console.log(`[API-SPORTS (Hockey)] Név Térképezés: "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    } else {
         console.log(`[API-SPORTS (Hockey)] Név Keresés: "${teamName}" (Nincs térkép bejegyzés, közvetlen keresés)`);
    }
    
    // === MÓDOSÍTÁS (v74.0) ===
    // Ha a _getLeagueRoster üres listát adott vissza (API hiba), ne keressünk benne.
    if (roster.length === 0) {
        console.warn(`[API-SPORTS (Hockey)]: A liga (${leagueId}) csapatai nem érhetők el (a roster üres). Névfeloldás sikertelen.`);
        apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
        return null;
    }
    // === MÓDOSÍTÁS VÉGE ===

    const teamObjects = roster.map(item => item.team);
    let foundTeam: any = null;
    foundTeam = teamObjects.find(t => t.name.toLowerCase() === searchName);
    if (foundTeam) {
        console.log(`[API-SPORTS (Hockey)]: HELYI TALÁLAT (Tökéletes): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
    }
    if (!foundTeam) {
        foundTeam = teamObjects.find(t => t.name.toLowerCase().includes(searchName));
        if (foundTeam) {
             console.log(`[API-SPORTS (Hockey)]: HELYI TALÁLAT (Tartalmazza): Az API név "${foundTeam.name}" tartalmazza a keresett nevet "${searchName}" (ID: ${foundTeam.id})`);
        }
    }
    if (foundTeam && foundTeam.id) {
        apiSportsNameMappingCache.set(nameCacheKey, foundTeam.id);
        return foundTeam.id;
    }
    console.warn(`[API-SPORTS (Hockey)]: Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Szezon: ${foundSeason}, Eredeti: "${teamName}").`);
    console.warn(`    Javaslat: Add hozzá a hiányzó "${lowerName}" nevet az 'NHL_TEAM_NAME_MAP' listához a 'config.js'-ben.`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}

// --- findApiSportsFixture (Változatlan) ---
async function findApiSportsFixture(homeTeamId: number, awayTeamId: number, season: number, leagueId: number, utcKickoff: string, sport: string): Promise<any | null> {
    // === MÓDOSÍTÁS (v74.0) ===
    // Ha az ID-k null-ok, ne is próbálkozzunk.
    if (!homeTeamId || !awayTeamId || !season || !leagueId) {
        console.warn(`[API-SPORTS (Hockey)] Fixture Keresés KIHAGYVA: Hiányzó TeamID-k (H:${homeTeamId}, A:${awayTeamId}).`);
        return null;
    }
    // === MÓDOSÍTÁS VÉGE ===

    const cacheKey = `apisports_findfixture_v54.7_FULL_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get<any>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS (Hockey)]: Teljes Fixture CACHE TALÁLAT! FixtureID: ${cached.fixture?.id}`);
        return cached;
    }
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const endpoint = `/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    console.log(`[API-SPORTS (Hockey)] Fixture Keresés: H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában (${season} szezon)...`);
    
    try {
        const response = await makeHockeyRequest(endpoint, { params });
        if (response?.data?.response?.length > 0) {
            const foundFixture = response.data.response.find((f: any) => (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId));
            if (foundFixture) {
                console.log(`[API-SPORTS (Hockey)]: MECCS TALÁLAT! FixtureID: ${foundFixture.fixture?.id}`);
                apiSportsFixtureCache.set(cacheKey, foundFixture); 
                return foundFixture;
            }
        }
        console.warn(`[API-SPORTS (Hockey)]: Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz (Dátum: ${matchDate}, Szezon: ${season}).`);
        apiSportsFixtureCache.set(cacheKey, null);
        return null;
    } catch (e: any) {
        console.error(`[API-SPORTS (Hockey)] KRITIKUS API HIBA a fixture keresésekor: ${e.message}`);
        return null; // Hibatűrés
    }
}

// --- getApiSportsFixtureResult (Változatlan) ---
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { 
    if (sport !== 'hockey') {
        console.warn(`[getApiSportsFixtureResult] Lekérés kihagyva: Ez a provider csak 'hockey'-t kezel.`);
        return null;
    }
    if (!fixtureId) {
        return null;
    }
    const cacheKey = `fixture_result_v1_${sport}_${fixtureId}`;
    const cached = fixtureResultCache.get<FixtureResult>(cacheKey);
    if (cached) {
        console.log(`[getApiSportsFixtureResult (Hockey)] Cache találat (ID: ${fixtureId}): ${cached.status}`);
        return cached;
    }
    console.log(`[getApiSportsFixtureResult (Hockey)] Eredmény lekérése... (ID: ${fixtureId})`);
    const endpoint = `/fixtures`;
    const params = { id: fixtureId };
    try {
        const response = await makeHockeyRequest(endpoint, { params });
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[getApiSportsFixtureResult (Hockey)] Nem található meccs a ${fixtureId} ID alatt.`);
            return null; 
        }
        const fixture = response.data.response[0];
        const status = fixture.fixture?.status?.short;
        const scores = fixture.scores; 
        if (status === 'FT') {
            const result: FixtureResult = { 
                home: scores.home,
                away: scores.away,
                status: 'FT'
            };
            fixtureResultCache.set(cacheKey, result);
            console.log(`[getApiSportsFixtureResult (Hockey)] Eredmény rögzítve (ID: ${fixtureId}): H:${result.home}-A:${result.away}`);
            return result;
        }
        console.log(`[getApiSportsFixtureResult (Hockey)] Meccs még nincs befejezve (ID: ${fixtureId}). Státusz: ${status}`);
        return { status: status }; 
    } catch (error: any) {
        console.error(`[getApiSportsFixtureResult (Hockey)] Hiba történt (ID: ${fixtureId}): ${error.message}`);
        return null;
    }
}

// --- getApiSportsH2H (Változatlan) ---
async function getApiSportsH2H(homeTeamId: number | null, awayTeamId: number | null, limit: number = 5, sport: string): Promise<any[] | null> {
    if (!homeTeamId || !awayTeamId) return null; // v74.0
    
    const endpoint = `/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    try {
        const response = await makeHockeyRequest(endpoint, { params });
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
    } catch (e: any) {
        console.error(`[API-SPORTS (Hockey)] Hiba a H2H lekérésekor: ${e.message}`);
        return null; // Hibatűrés
    }
}

// --- getApiSportsTeamSeasonStats (Változatlan) ---
async function getApiSportsTeamSeasonStats(teamId: number | null, leagueId: number | null, season: number, sport: string): Promise<any | null> {
    if (!teamId || !leagueId) return null; // v74.0
    
    const tryGetStats = async (currentSeason: number) => {
        const cacheKey = `apisports_seasonstats_v40_${sport}_${teamId}_${leagueId}_${currentSeason}`;
        const cachedStats = apiSportsStatsCache.get<any>(cacheKey);
        if (cachedStats) {
            console.log(`[API-SPORTS (Hockey)] Szezon Stat cache találat: T:${teamId}, L:${leagueId}, S:${currentSeason}`);
            return cachedStats;
        }
        console.log(`[API-SPORTS (Hockey)] Szezon Stat lekérés: T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
        const endpoint = `/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
        
        try {
            const response = await makeHockeyRequest(endpoint, { params });
            const stats = response?.data?.response;
            if (stats && (stats.league?.id || (stats.games?.played != null && stats.games?.played > 0))) { 
                console.log(`[API-SPORTS (Hockey)]: Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
                let simplifiedStats = {
                    gamesPlayed: stats.games?.played,
                    form: stats.form, 
                    goalsFor: stats.goals?.for,
                    goalsAgainst: stats.goals?.against,
                };
                if (typeof simplifiedStats.goalsFor === 'object' && simplifiedStats.goalsFor !== null) {
                     simplifiedStats.goalsFor = simplifiedStats.goalsFor.total;
                }
                 if (typeof simplifiedStats.goalsAgainst === 'object' && simplifiedStats.goalsAgainst !== null) {
                     simplifiedStats.goalsAgainst = simplifiedStats.goalsAgainst.total;
                }
                apiSportsStatsCache.set(cacheKey, simplifiedStats);
                return simplifiedStats;
            }
            return null;
        } catch (e: any) {
            console.error(`[API-SPORTS (Hockey)] Hiba a szezon statisztika lekérésekor (Szezon: ${currentSeason}): ${e.message}`);
            return null; // Hibatűrés
        }
    };
    
    let stats: any = null;
    stats = await tryGetStats(season);
    if (stats) {
        console.log(`[API-SPORTS (Hockey)]: Szezon statisztika sikeresen azonosítva a(z) ${season} szezonban.`);
    } else {
        const fallbackSeason = season - 1;
        console.warn(`[API-SPORTS (Hockey)]: Nem található statisztika a(z) ${season} szezonra. Újrapróbálkozás: ${fallbackSeason}...`);
        stats = await tryGetStats(fallbackSeason);
        if (!stats) {
            console.error(`[API-SPORTS (Hockey)]: Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
        }
    }
    return stats;
}

// --- getApiSportsOdds (Változatlan) ---
async function getApiSportsOdds(fixtureId: number | string | null, sport: string): Promise<ICanonicalOdds | null> {
    if (!fixtureId) {
        console.warn(`[API-SPORTS (Hockey)] Odds: Hiányzó fixtureId, a szorzók lekérése kihagyva.`);
        return null;
    }
    const cacheKey = `apisports_odds_v40_${sport}_${fixtureId}`;
    const cached = apiSportsOddsCache.get<ICanonicalOdds>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS (Hockey)] Odds cache találat: ${cacheKey}`);
        return { ...cached, fromCache: true };
    }
    console.log(`[API-SPORTS (Hockey)] Nincs Odds cache (${cacheKey}). Friss lekérés...`);
    const endpoint = `/odds`;
    const params = { fixture: fixtureId };
    
    try {
        const response = await makeHockeyRequest(endpoint, { params });
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[API-SPORTS (Hockey)] Odds: Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
            return null;
        }
        const oddsData = response.data.response[0]; 
        const bookmaker = oddsData.bookmakers?.find((b: any) => b.name === "Bet365") || oddsData.bookmakers?.[0];
        const winnerMarketName = "Moneyline";
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
                if (marketKey === 'moneyline') allMarkets.push({ key: 'h2h', outcomes });
                if (marketKey === 'total') allMarkets.push({ key: 'totals', outcomes });
                if (marketKey === 'handicap') allMarkets.push({ key: 'spreads', outcomes });
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
            console.log(`[API-SPORTS (Hockey)] Odds adatok sikeresen lekérve és cache-elve: ${cacheKey}`);
        } else {
             console.warn(`[API-SPORTS (Hockey)] Odds: Találat, de nem sikerült '${winnerMarketName}' piacot találni.`);
        }
        return result; 
    } catch (e: any) {
        console.error(`[API-SPORTS (Hockey)] Hiba az oddsok lekérésekor: ${e.message}`);
        return null; // Hibatűrés
    }
}

// --- getApiSportsFixtureStats (Változatlan - Stub) ---
async function getApiSportsFixtureStats(fixtureId: number | string | null, sport: string): Promise<{ home: number; away: number } | null> {
    if (sport !== 'hockey' || !fixtureId) { 
        return null;
    }
    console.warn(`[API-SPORTS Fixture Stats (Hockey)]: A funkció még nincs implementálva a hoki-specifikus xG-re.`);
    return null;
}

// --- getWeatherForFixture (Változatlan) ---
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    return { 
        description: "N/A (Beltéri)", 
        temperature_celsius: -1,
        humidity_percent: null, 
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (MÓDOSÍTVA v74.0) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    const seasonDate = new Date(utcKickoff);
    const originSeason = (seasonDate.getMonth() < 7) ? seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
    if (isNaN(originSeason)) {
        // Ha a dátum érvénytelen, azonnal adjunk vissza egy "stub" választ
        console.error(`[API-SPORTS (Hockey)] Érvénytelen utcKickoff: ${utcKickoff}. Tiszta P1 mód kényszerítése.`);
        return generateEmptyStubContext(options);
    }
    
    console.log(`Adatgyűjtés indul (v74.0 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    
    // 1. LÉPÉS: Liga ID (Hardkódolt) és Csapatlista (Szezon Fallback)
    const leagueId = 57; // Hardkódolt NHL ID az api-sports.io-hoz
    const leagueRosterData = await _getLeagueRoster(leagueId, originSeason, sport);
    const foundSeason = leagueRosterData.foundSeason;
    
    console.log(`[API-SPORTS (Hockey)]: Végleges LeagueID: ${leagueId} (Hardkódolt), Szezon: ${foundSeason}`);
    
    // 2. LÉPÉS: Csapat ID-k lekérése
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, originSeason, leagueRosterData),
        getApiSportsTeamId(awayTeamName, sport, leagueId, originSeason, leagueRosterData),
    ]);
    
    // === MÓDOSÍTÁS (v74.0): FATÁLIS HIBA ELHÁRÍTÁSA ===
    if (!homeTeamId || !awayTeamId) { 
        console.warn(`[API-SPORTS (Hockey)] FIGYELMEZTETÉS: Alapvető API-Sports (Hockey) csapat azonosítók hiányoznak. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}.`);
        console.warn(`[API-SPORTS (Hockey)] Tiszta P1 mód feltételezése. A lánc folytatódik, de csak a P1 (manuális) adatok lesznek használva.`);
        // Ahelyett, hogy hibát dobnánk, visszaadjuk az üres "stub" adatszerkezetet.
        // Az AnalysisFlow.ts ezután a te P1-es manuális adataidat fogja használni.
        return generateEmptyStubContext(options);
    }
    // === MÓDOSÍTÁS VÉGE ===
    
    // 3. LÉPÉS: Meccskeresés
    const foundFixture = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport);
    const fixtureId = foundFixture?.fixture?.id || null;
    const fixtureDate = foundFixture?.fixture?.date || null;
    const refereeData = foundFixture?.fixture?.referee || null;
    const venueData = foundFixture?.fixture?.venue || null;
    
    if (!fixtureId) {
         console.warn(`[API-SPORTS (Hockey)]: Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
         // Bár ez nem fatális, valószínűleg a P1 módra kell hagyatkoznunk
    }

    console.log(`[API-SPORTS (Hockey)]: Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    
    // 4. LÉPÉS: Statisztikák
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realFixtureStats,
        structuredWeather
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        (fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null),
        getWeatherForFixture(venueData, utcKickoff)
    ]);
    
    console.log(`[API-SPORTS (Hockey)]: Párhuzamos lekérések befejezve.`);
    
    const realXgData = realFixtureStats || null;
    
    // --- VÉGLEGES ADAT EGYESÍTÉS (v70.0 - AI Nélkül) ---
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
            stadium_location: venueData ? `${venueData.name}, ${venueData.city}` : "N/A",
            structured_weather: structuredWeather,
            pitch_condition: "N/A (Jég)", 
            weather: structuredWeather.description || "N/A",
            match_tension_index: null,
            coach: {
                home_name: null,
                away_name: null
            }
        },
        availableRosters: {
            home: [],
            away: []
        }
    };
    
    // Itt a '|| 1' a kulcs a hibatűréshez
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
    
    console.log(`[API-SPORTS (Hockey)] Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
    
    const richContextParts = [
         (apiSportsH2HData && apiSportsH2HData.length > 0) && `- H2H: ${apiSportsH2HData[0].home_team} ${apiSportsH2HData[0].score} ${apiSportsH2HData[0].away_team}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         refereeData && `- Bíró: ${refereeData}`
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
            home: [],
            away: []
         }
    };

    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats?.away?.gp <= 0) {
        console.error(`[API-SPORTS (Hockey)] KRITIKUS HIBA: Érvénytelen VÉGLEGES statisztikák (GP <= 0).`);
        // Még egy hibatűrési réteg: visszaállítjuk 1-re
        result.rawStats.home.gp = 1;
        result.rawStats.away.gp = 1;
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-hockey-v1';

// === ÚJ (v74.0): "Stub" Válasz Generátor ===
/**
 * Létrehoz egy üres, de érvényes ICanonicalRichContext objektumot,
 * ha az API-hívások (pl. csapat ID) meghiúsulnak.
 * Ez lehetővé teszi a P1-es adatok (manuális xG, hiányzók) feldolgozását.
 */
function generateEmptyStubContext(options: any): ICanonicalRichContext {
    const { sport, homeTeamName, awayTeamName, utcKickoff } = options;
    
    console.warn(`[generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const emptyWeather: IStructuredWeather = {
        description: "N/A (API Hiba)",
        temperature_celsius: null,
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: {
             homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A",
            structured_weather: emptyWeather,
            pitch_condition: "N/A", 
            weather: "N/A",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus API adatgyűjtés sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { home: { xg: null }, away: { xg: null } },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] }
    };
    
    return result;
}