// FÁJL: providers/newHockeyProvider.ts
// VERZIÓ: v54.38 (A Nagy Egyesítés)
// MÓDOSÍTÁS:
// 1. A 'newHockeyProvider.ts' (v54.37) teljes,
//    hibás NHL API logikája eltávolítva.
// 2. Ez a fájl most már a stabil, tesztelt 'apiSportsProvider.ts' (v54.28)
//    klónja, amely a 'config.ts'-ből
//    a közvetlen 'api-sports.io' (Hoki) hozzáférésedet használja.
// 3. A 'makeHockeyRequest' az 'x-apisports-key' fejlécet használja (nem 'x-rapidapi-key').
// 4. A 'getApiSportsTeamId' az 'NHL_TEAM_NAME_MAP'
//    térképet használja a determinisztikus névfeloldáshoz.
// 5. Minden hoki adat (H2H, Odds, Stats) mostantól a fizetett API-ról érkezik.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
// A 'string-similarity' (pkg) már nincs használatban

// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult,
    IStructuredWeather
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    NHL_TEAM_NAME_MAP, // A HOKI TÉRKÉP HASZNÁLATA
    APISPORTS_HOCKEY_HOST, // Az új közvetlen hoszt
    APISPORTS_HOCKEY_KEY   // Az új közvetlen kulcs
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    makeRequest // Az alapvető, hibatűrő hívó
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

// --- API-SPORTS KÖZPONTI HÍVÓ FÜGGVÉNY (KÖZVETLEN KULCCSAL) ---
/**
 * Ez a hívó a közvetlen (nem RapidAPI) api-sports kulcsot használja.
 * Nincs kulcsrotáció, mivel csak egy kulcs van.
 */
async function makeHockeyRequest(endpoint: string, config: AxiosRequestConfig = {}) {
    const sport = 'hockey'; // Hardkódolva erre a providerre
    
    if (!APISPORTS_HOCKEY_HOST || !APISPORTS_HOCKEY_KEY) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó APISPORTS_HOCKEY_HOST vagy APISPORTS_HOCKEY_KEY a .env fájlban.`);
    }

    const apiConfig = {
        baseURL: `https://${APISPORTS_HOCKEY_HOST}`,
        headers: {
            'x-apisports-key': APISPORTS_HOCKEY_KEY // A közvetlen API 'x-apisports-key'-t használ
        }
    };
    
    try {
        const url = `${apiConfig.baseURL}${endpoint}`;
        const fullConfig: AxiosRequestConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
        // Az alap 'makeRequest' [cite: 997-1019] hívása
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


// --- _getLeagueRoster (Klónozva az apiSportsProvider-ből) ---
async function _getLeagueRoster(leagueId: number | string, season: number, sport: string): Promise<any[]> {
    const cacheKey = `apisports_roster_v1_${sport}_${leagueId}_${season}`;
    const cachedRoster = apiSportsRosterCache.get<any[]>(cacheKey);
    if (cachedRoster) {
        console.log(`[API-SPORTS (Hockey)]: Csapatlista CACHE TALÁLAT (Liga: ${leagueId}, Szezon: ${season})`);
        return cachedRoster;
    }

    console.log(`[API-SPORTS (Hockey)]: Csapatlista lekérése (Liga: ${leagueId}, Szezon: ${season})...`);
    // Az 'api-sports' (Hoki) a '/teams' végpontot használja
    const endpoint = `/teams?league=${leagueId}&season=${season}`;
    const response = await makeHockeyRequest(endpoint, {});

    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`[API-SPORTS (Hockey)]: Nem sikerült lekérni a csapatlistát a ${leagueId} ligából, ${season} szezon.`);
        return []; 
    }

    const roster = response.data.response;
    apiSportsRosterCache.set(cacheKey, roster);
    console.log(`[API-SPORTS (Hockey)]: Csapatlista sikeresen lekérve, ${roster.length} csapat cache-elve.`);
    return roster;
}

// === JAVÍTOTT (v54.38) getApiSportsTeamId ===
// Klónozva a v54.28-as foci providerből, de az NHL_TEAM_NAME_MAP-et használja
async function getApiSportsTeamId(teamName: string, sport: string, leagueId: number | string, season: number): Promise<number | null> {
    const lowerName = teamName.toLowerCase().trim();
    
    // 1. Keresés a determinisztikus HOKI térképben
    const mappedName = NHL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName.toLowerCase();

    const nameCacheKey = `apisports_name_map_v6_strict_${sport}_${leagueId}_${season}_${searchName.replace(/\s+/g, '')}`;
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

    // 2. A liga csapatlistájának lekérése
    const leagueRoster = await _getLeagueRoster(leagueId, season, sport);
    if (leagueRoster.length === 0) {
        console.warn(`[API-SPORTS (Hockey)]: A liga (${leagueId}) csapatai nem érhetők el a(z) ${season} szezonban. Névfeloldás sikertelen.`);
        apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
        return null;
    }

    const teamObjects = leagueRoster.map(item => item.team);
    let foundTeam: any = null;

    // 3. Szigorú ellenőrzés (Tökéletes egyezés)
    foundTeam = teamObjects.find(t => t.name.toLowerCase() === searchName);
    if (foundTeam) {
        console.log(`[API-SPORTS (Hockey)]: HELYI TALÁLAT (Tökéletes): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
    }

    // 4. Szigorú ellenőrzés (Tartalmazás)
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

    console.warn(`[API-SPORTS (Hockey)]: Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Szezon: ${season}, Eredeti: "${teamName}").`);
    console.warn(`    Javaslat: Add hozzá a hiányzó "${lowerName}" nevet az 'NHL_TEAM_NAME_MAP' listához a 'config.js'-ben.`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}


// === getApiSportsLeagueId (Klónozva az apiSportsProvider-ből) ===
async function getApiSportsLeagueId(leagueName: string, country: string, season: number, sport: string): Promise<{ leagueId: number, foundSeason: number } | null> {
    if (!leagueName || !country || !season) {
        console.warn(`[API-SPORTS (Hockey)]: Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const lowerCountry = country.toLowerCase();
    
    // Belső függvény, amely lekéri az ÖSSZES ligát egy országból
    const _getLeaguesByCountry = async (currentCountry: string, currentSeason: number): Promise<any[]> => {
        const cacheKey = `apisports_countryleagues_v1_${sport}_${currentCountry.toLowerCase()}_${currentSeason}`;
        const cachedLeagues = apiSportsCountryLeagueCache.get<any[]>(cacheKey);
        if (cachedLeagues) {
            console.log(`[API-SPORTS (Hockey)]: Liga-lista CACHE TALÁLAT (Ország: ${currentCountry}, Szezon: ${currentSeason})`);
            return cachedLeagues;
        }

        console.log(`[API-SPORTS (Hockey)]: Liga-lista lekérése (Ország: ${currentCountry}, Szezon: ${currentSeason})...`);
        const endpoint = `/leagues`;
        const params = { country: currentCountry, season: currentSeason };
        const response = await makeHockeyRequest(endpoint, { params });

        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[API-SPORTS (Hockey)]: Nem találhatók ligák ehhez: ${currentCountry}, ${currentSeason}`);
            apiSportsCountryLeagueCache.set(cacheKey, []); 
            return [];
        }

        const leagues = response.data.response.map((l: any) => l.league);
        apiSportsCountryLeagueCache.set(cacheKey, leagues);
        console.log(`[API-SPORTS (Hockey)]: ${leagues.length} liga cache-elve (${currentCountry}, ${currentSeason}).`);
        return leagues;
    };
    
    // Belső függvény a liga megtalálásához
    const _findLeagueInList = (leagues: any[], targetName: string): number | null => {
        if (leagues.length === 0) return null;
        
        const targetLower = targetName.toLowerCase().trim();
        // A 'findBestMatch' (fuzzy) logika eltávolítva (v54.28 minta alapján)
        
        const leagueNameMap = leagues.map(l => ({ 
            original: l.name, 
            originalLower: l.name.toLowerCase(), 
            id: l.id 
        }));

        // 1. Próba: Tökéletes egyezés
        let perfectMatch = leagueNameMap.find(l => l.originalLower === targetLower);
        if (perfectMatch) {
            console.log(`[API-SPORTS (Hockey)]: HELYI LIGA TALÁLAT (Tökéletes): "${targetName}" -> "${perfectMatch.original}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }
        
        console.warn(`[API-SPORTS (Hockey)]: Nem található pontos liga egyezés ehhez: "${targetName}".`);
        return null;
    };

    // --- FŐ LOGIKA: SZEZON VISSZAKERESÉS ---
    let leagueData: { leagueId: number, foundSeason: number } | null = null;
    const seasonsToTry = [season, season - 1, season - 2];

    for (const s of seasonsToTry) {
        console.log(`[API-SPORTS (Hockey)]: Ligák keresése (Ország: ${country}, Szezon: ${s})...`);
        const leaguesInSeason = await _getLeaguesByCountry(country, s);
        const foundLeagueId = _findLeagueInList(leaguesInSeason, leagueName);
        
        if (foundLeagueId) {
            console.log(`[API-SPORTS (Hockey)]: Liga sikeresen azonosítva a(z) ${s} szezonban (ID: ${foundLeagueId}). Keresés leáll.`);
            leagueData = { leagueId: foundLeagueId, foundSeason: s }; 
            break; 
        }
        
        // Hokinál és kosárnál nem keresünk vissza több szezont, ha az aktuálisban nincs meg
         if (sport !== 'soccer') {
             break;
        }
        
        console.warn(`[API-SPORTS (Hockey)]: Nem található "${leagueName}" nevű liga ${country} országban a(z) ${s} szezonra.`);
    }

    if (!leagueData) {
        console.error(`[API-SPORTS (Hockey)]: Végleg nem található liga ID ehhez: "${leagueName}" (${country}) (${seasonsToTry.length} szezont ellenőrizve).`);
        return null;
    }
    
    return leagueData;
}


// === findApiSportsFixture (Klónozva az apiSportsProvider-ből) ===
async function findApiSportsFixture(homeTeamId: number, awayTeamId: number, season: number, leagueId: number, utcKickoff: string, sport: string): Promise<any | null> {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return null;
    
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
    const response = await makeHockeyRequest(endpoint, { params });
    
    if (response?.data?.response?.length > 0) {
        // A Hoki API 'contestants' kulcsot használhat
        const foundFixture = response.data.response.find((f: any) => 
            (f.teams?.away?.id === awayTeamId) || (f.contestants?.away?.id === awayTeamId)
        );
        if (foundFixture) {
            console.log(`[API-SPORTS (Hockey)]: MECCS TALÁLAT! FixtureID: ${foundFixture.fixture?.id}`);
            apiSportsFixtureCache.set(cacheKey, foundFixture); 
            return foundFixture;
        }
    }
    
    console.warn(`[API-SPORTS (Hockey)]: Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz (Dátum: ${matchDate}, Szezon: ${season}).`);
    apiSportsFixtureCache.set(cacheKey, null);
    return null;
}

// === getApiSportsFixtureResult (Klónozva) ===
// Ezt a SettlementService hívja, de most már hokihoz is működhet
export async function getApiSportsFixtureResult(fixtureId: number | string, sport: string): Promise<FixtureResult> { 
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
        // A Hoki API 'scores' kulcsot használ
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

// === getApiSportsH2H (Klónozva) ===
// Ez most már működni fog a jégkorongnál! 
async function getApiSportsH2H(homeTeamId: number, awayTeamId: number, limit: number = 5, sport: string): Promise<any[] | null> {
    const endpoint = `/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
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
}

// === getApiSportsTeamSeasonStats (Klónozva) ===
async function getApiSportsTeamSeasonStats(teamId: number, leagueId: number, season: number, sport: string): Promise<any | null> {
    
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
        const response = await makeHockeyRequest(endpoint, { params });
        
        const stats = response?.data?.response;
        // Hoki API más választ adhat (pl. 'games.played' a 'fixtures.played.total' helyett)
        if (stats && (stats.league?.id || (stats.games?.played != null && stats.games?.played > 0))) { 
            console.log(`[API-SPORTS (Hockey)]: Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
            let simplifiedStats = {
                gamesPlayed: stats.games?.played,
                form: stats.form, // Hoki API más formátumot adhat
                goalsFor: stats.goals?.for, // Hoki API más struktúrát használhat
                goalsAgainst: stats.goals?.against,
            };
            
            // Kanonizálás (A Hoki válasz 'for' és 'against' objektum lehet)
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
    };
    
    let stats: any = null;
    const seasonsToTry = [season, season - 1, season - 2];
    
    for (const s of seasonsToTry) {
        stats = await tryGetStats(s);
        if (stats) {
            console.log(`[API-SPORTS (Hockey)]: Szezon statisztika sikeresen azonosítva a(z) ${s} szezonban.`);
            break; 
        }
         if (sport !== 'soccer') {
             break;
        }
        console.warn(`[API-SPORTS (Hockey)]: Nem található statisztika a(z) ${s} szezonra.`);
    }

    if (!stats) {
        console.error(`[API-SPORTS (Hockey)]: Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    return stats;
}

// === getApiSportsOdds (Klónozva) ===
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
    const response = await makeHockeyRequest(endpoint, { params });
    
    if (!response?.data?.response || response.data.response.length === 0) {
        console.warn(`[API-SPORTS (Hockey)] Odds: Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
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
            // Hoki-specifikus piacok (ha vannak)
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
}


// === getApiSportsFixtureStats (Klónozva) ===
// Ez a funkció (foci xG) valószínűleg nem ad vissza adatot hokinál, de a
// P2-es szinthez itt kellene a hoki xG-t (pl. 'Expected Goals') lekérni.
async function getApiSportsFixtureStats(fixtureId: number | string | null, sport: string): Promise<{ home: number; away: number } | null> {
    if (sport !== 'hockey' || !fixtureId) { // Módosítva 'hockey'-ra
        console.log(`[API-SPORTS Fixture Stats (Hockey)]: Lekérés kihagyva (Sport nem hoki, vagy hiányzó FixtureID).`);
        return null;
    }

    const cacheKey = `apisports_fixturestats_v50_HOCKEY_${fixtureId}`;
    const cached = apiSportsFixtureStatsCache.get<{ home: number; away: number }>(cacheKey);
    if (cached) {
        console.log(`[API-SPORTS Fixture Stats (Hockey)] cache találat: ${cacheKey}`);
        return cached;
    }

    console.log(`[API-SPORTS Fixture Stats (Hockey)]: Valós xG/Haladó adatok lekérése... (FixtureID: ${fixtureId})`);
    
    const endpoint = `/fixtures/statistics`;
    const params = { fixture: fixtureId };
    
    try {
        const response = await makeHockeyRequest(endpoint, { params });
        if (!response?.data?.response || response.data.response.length < 2) {
            console.warn(`[API-SPORTS Fixture Stats (Hockey)]: Nem érkezett statisztikai adat a ${fixtureId} fixture-höz.`);
            apiSportsFixtureStatsCache.set(cacheKey, null); 
            return null;
        }
        
        // TODO: A jövőben itt kell feldolgozni a hoki-specifikus haladó statokat (pl. xG),
        // ha az API-SPORTS biztosítja őket ezen a végponton.
        // Jelenleg 'null'-t adunk vissza, hogy a P4-es (GP/GF/GA) logika fusson le.
        console.warn(`[API-SPORTS Fixture Stats (Hockey)]: A funkció még nincs implementálva a hoki-specifikus xG-re.`);
        apiSportsFixtureStatsCache.set(cacheKey, null);
        return null;

    } catch (error: any) {
        console.error(`[API-SPORTS Fixture Stats (Hockey)] Hiba (ID: ${fixtureId}): ${error.message}`);
        apiSportsFixtureStatsCache.set(cacheKey, null); 
        return null;
    }
}

// === getWeatherForFixture (Klónozva) ===
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    
    // Hokinál mindig beltéri
    return { 
        description: "N/A (Beltéri)", 
        temperature_celsius: -1, 
        humidity_percent: null, 
        wind_speed_kmh: null, 
        precipitation_mm: null 
    };
}


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.38) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    const seasonDate = new Date(utcKickoff);
    // A Hoki szezon (pl. 2024-2025) a naptári év alapján 2024-nek számít
    const originSeason = (seasonDate.getMonth() < 7) ? seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        
    if (isNaN(originSeason)) throw new Error(`Érvénytelen utcKickoff: ${utcKickoff}`);
    
    console.log(`Adatgyűjtés indul (v54.38 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    // 1. LÉPÉS: Liga adatok lekérése
    const sportConfig = SPORT_CONFIG[sport];
    const leagueData = sportConfig.espn_leagues[leagueName];
    if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
    
    const country = leagueData.country;
    const leagueDataResponse = await getApiSportsLeagueId(leagueName, country, originSeason, sport);
    if (!leagueDataResponse || !leagueDataResponse.leagueId) {
        throw new Error(`Nem sikerült a 'leagueId' azonosítása ('${leagueName}' néven).`);
    }

    const { leagueId, foundSeason } = leagueDataResponse;
    console.log(`[API-SPORTS (Hockey)]: Végleges LeagueID: ${leagueId} (A ${foundSeason} szezon alapján azonosítva)`);
    
    // 2. LÉPÉS: Csapat ID-k lekérése (v54.28 Szigorú verzió)
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, foundSeason),
        getApiSportsTeamId(awayTeamName, sport, leagueId, foundSeason),
    ]);
    if (!homeTeamId || !awayTeamId) { 
        throw new Error(`Alapvető API-Sports (Hockey) csapat azonosítók hiányoznak. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}. (Ellenőrizd az 'NHL_TEAM_NAME_MAP' bejegyzéseket a config.js-ben).`);
    }
    
    // 3. LÉPÉS: Meccskeresés
    const foundFixture = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport);
    const fixtureId = foundFixture?.fixture?.id || null;
    const fixtureDate = foundFixture?.fixture?.date || null;
    const refereeData = foundFixture?.fixture?.referee || null;
    const venueData = foundFixture?.fixture?.venue || null;
    
    if (!fixtureId) {
         console.warn(`[API-SPORTS (Hockey)]: Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
    }

    console.log(`[API-SPORTS (Hockey)]: Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    
    // 4. LÉPÉS: Statisztikák (Most már H2H-val és Oddssal)
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realFixtureStats,
        structuredWeather
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport), // EZ MOST MÁR MŰKÖDIK
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        (fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null),
        getWeatherForFixture(venueData, utcKickoff)
    ]);
    console.log(`[API-SPORTS (Hockey)]: Párhuzamos lekérések befejezve.`);
    
    const realXgData = realFixtureStats || null; // Ez hokinál (még) null lesz
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
            stadium_location: venueData ? `${venueData.name}, ${venueData.city}` : "N/A",
            structured_weather: structuredWeather,
            pitch_condition: "N/A (Jég)", 
            weather: structuredWeather.description || "N/A",
            match_tension_index: null 
        }
    };
    
    // Kanonikus statisztikák feltöltése
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
         // A Gemini hívást kivettük, de a H2H összefoglalót generálhatnánk
         (apiSportsH2HData && apiSportsH2HData.length > 0) && `- H2H: ${apiSportsH2HData[0].home_team} ${apiSportsH2HData[0].score} ${apiSportsH2HData[0].away_team}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         refereeData && `- Bíró: ${refereeData}`
    ].filter(Boolean);
    const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
    
    const advancedData = realXgData ?
        { home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
        { home: { xg: null }, away: { xg: null } }; // Még nincs P2 xG, így null
        
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {},
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData,
         oddsData: fetchedOddsData, // Most már lesz Hoki Odds!
         fromCache: false
    };

    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
        console.error(`[API-SPORTS (Hockey)] KRITIKUS HIBA: Érvénytelen VÉGLEGES statisztikák (GP <= 0).`);
        throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-hockey-v1';
