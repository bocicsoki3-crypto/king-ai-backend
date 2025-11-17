// FÁJL: providers/apiBasketballProvider.ts
// VERZIÓ: v1.1 (TS Hiba Javítva)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (TS2304): Hozzáadva a hiányzó 'getWeatherForFixture' segédfüggvény.
// 2. JAVÍTVA (TS2353): A 'fetchMatchData' és 'generateEmptyStubContext'
//    visszatérési típusa a helyes 'IDataFetchResponse'-ra javítva.
// 3. JAVÍTÁS: .js kiterjesztések hozzáadva az importokhoz (Node.js/TypeScript-hez).

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
// Az IDataFetchResponse-t a DataFetch.ts-ből kellene importálni, de a körkörös hivatkozás
// elkerülése végett itt helyben definiáljuk, mit várunk.
import type { IDataFetchResponse } from '../DataFetch.js'; 

import {
    SPORT_CONFIG,
    // Kosaras név-mappa (ha szükség lenne rá a jövőben)
    // NHL_TEAM_NAME_MAP, 
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    makeRequest,
    getStructuredWeatherData // Ezt valójában nem használjuk, de a getWeatherForFixture lecserélte
} from './common/utils.js';

// === JAVÍTÁS 1 (TS2304): Hiányzó getWeatherForFixture függvény hozzáadása ===
/**
 * Időjárás-lekérő segédfüggvény (beltéri sportágra szabva)
 */
async function getWeatherForFixture(
    venue: { name: string, city: string } | null, 
    utcKickoff: string
): Promise<IStructuredWeather> {
    // Kosárlabda beltéri, így nincs szükség valós időjárás API hívásra.
    return { 
        description: "N/A (Beltéri)", 
        temperature_celsius: null,
        humidity_percent: null, 
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
}
// === JAVÍTÁS 1 VÉGE ===

// --- API-SPORTS (KOSÁR) SPECIFIKUS CACHE-EK ---
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
async function makeBasketballRequest(endpoint: string, config: AxiosRequestConfig = {}, sportConfig: any) {
    const sport = 'basketball';
    if (!sportConfig || !sportConfig.host || !sportConfig.keys || sportConfig.keys.length === 0) {
        throw new Error(`Kritikus konfigurációs hiba: Hiányzó API HOST vagy KEYS a 'basketball' sporthoz a config.js API_HOSTS térképében.`);
    }
    
    const currentKey = sportConfig.keys[0]; 

    try {
        const url = `https://${sportConfig.host}${endpoint}`;
        const fullConfig: AxiosRequestConfig = {
            ...config,
            headers: {
                'x-rapidapi-key': currentKey,
                'x-rapidapi-host': sportConfig.host,
                ...config.headers
            }
        };
        const response = await makeRequest(url, fullConfig, 0); 
        return response;
    } catch (error: any) {
        if (error.isQuotaError) {
            throw new Error(`API KULCS Kimerült (${sport}).`);
        } else {
            console.error(`[apiBasketballProvider] Hiba: ${error.message}`);
            throw error;
        }
    }
}

// --- Liga, Csapat, Fixture Keresők ---

export async function _getLeagueRoster(leagueId: number | string, season: number, sport: string, apiConfig: any): Promise<{ roster: any[], foundSeason: number }> {
    const tryGetRosterForSeason = async (currentSeason: number) => {
        const cacheKey = `apisports_roster_v1_${sport}_${leagueId}_${currentSeason}`;
        const cachedRoster = apiSportsRosterCache.get<any[]>(cacheKey);
        if (cachedRoster) return cachedRoster;
        
        console.log(`[apiBasketballProvider]: Csapatlista lekérése (Liga: ${leagueId}, Szezon: ${currentSeason})...`);
        const endpoint = `/teams?league=${leagueId}&season=${currentSeason}`;
        try {
            const response = await makeBasketballRequest(endpoint, {}, apiConfig);
            if (!response?.data?.response || response.data.response.length === 0) {
                console.warn(`[apiBasketballProvider]: Nem sikerült lekérni a csapatlistát (L:${leagueId}, S:${currentSeason}).`);
                return null;
            }
            const roster = response.data.response;
            apiSportsRosterCache.set(cacheKey, roster);
            return roster;
        } catch (e: any) {
            console.error(`[apiBasketballProvider] KRITIKUS API HIBA a csapatlista lekérésekor (S:${currentSeason}): ${e.message}`);
            return null;
        }
    };
    
    let roster = await tryGetRosterForSeason(season);
    if (roster && roster.length > 0) return { roster, foundSeason: season };
    
    const fallbackSeason = season - 1;
    console.warn(`[apiBasketballProvider]: A ${season} szezon üres volt. Újrapróbálkozás a ${fallbackSeason} szezonnal...`);
    roster = await tryGetRosterForSeason(fallbackSeason);
    if (roster && roster.length > 0) return { roster, foundSeason: fallbackSeason };
    
    console.error(`[apiBasketballProvider]: A csapatlista lekérése sikertelen mindkét szezonra (L: ${leagueId}).`);
    return { roster: [], foundSeason: season };
}

export async function getApiSportsTeamId(
    teamName: string, 
    sport: string, 
    leagueId: number | string, 
    season: number,
    leagueRosterData: { roster: any[], foundSeason: number }
): Promise<number | null> {
    
    const { roster, foundSeason } = leagueRosterData;
    const lowerName = teamName.toLowerCase().trim();
    // const mappedName = NHL_TEAM_NAME_MAP[lowerName] || teamName; // TODO: Kosárra is kellhet név-térkép
    const mappedName = teamName;
    const searchName = mappedName.toLowerCase();
    const nameCacheKey = `apisports_name_map_v6_strict_${sport}_${leagueId}_${foundSeason}_${searchName.replace(/\s/g, '')}`;
    
    const cachedMappedId = apiSportsNameMappingCache.get<number | 'not_found'>(nameCacheKey);
    if (cachedMappedId !== undefined) {
        if (cachedMappedId === 'not_found') return null;
        return cachedMappedId;
    }

    if (roster.length === 0) {
        apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
        return null;
    }

    const teamObjects = roster; // API-Sports-nál a roster = {team, country}
    let foundTeam: any = null;
    
    // 1. Tökéletes egyezés
    foundTeam = teamObjects.find(t => t.name.toLowerCase() === searchName);
    if (foundTeam) {
         console.log(`[apiBasketballProvider]: HELYI TALÁLAT (Tökéletes): "${searchName}" -> "${foundTeam.name}" (ID: ${foundTeam.id})`);
    }
    // 2. Tartalmazás (includes)
    if (!foundTeam) {
        foundTeam = teamObjects.find(t => t.name.toLowerCase().includes(searchName));
        if (foundTeam) {
             console.log(`[apiBasketballProvider]: HELYI TALÁLAT (Tartalmazza): "${foundTeam.name}" tartalmazza "${searchName}" (ID: ${foundTeam.id})`);
        }
    }

    if (foundTeam && foundTeam.id) {
        apiSportsNameMappingCache.set(nameCacheKey, foundTeam.id);
        return foundTeam.id;
    }
    
    console.warn(`[apiBasketballProvider]: Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Szezon: ${foundSeason}, Eredeti: "${teamName}").`);
    apiSportsNameMappingCache.set(nameCacheKey, 'not_found');
    return null;
}

export async function getApiSportsLeagueId(
    leagueName: string, 
    countryName: string, 
    season: number, 
    sport: string,
    apiConfig: any
): Promise<{ leagueId: number | null, foundSeason: number }> {
    
    const leagueCacheKey = `apisports_league_id_v2_${sport}_${leagueName.toLowerCase().replace(/\s/g, '')}_${countryName}_${season}`;
    const cachedLeagueData = apiSportsLeagueIdCache.get<{ leagueId: number, foundSeason: number }>(leagueCacheKey);
    if (cachedLeagueData) {
        console.log(`[apiBasketballProvider]: Liga ID CACHE TALÁLAT: "${leagueName}" -> ${cachedLeagueData.leagueId} (Szezon: ${cachedLeagueData.foundSeason})`);
        return cachedLeagueData;
    }

    const tryGetLeague = async (currentSeason: number) => {
        const endpoint = `/leagues`;
        const params = { season: currentSeason, country: countryName };
        try {
            const response = await makeBasketballRequest(endpoint, { params }, apiConfig);
            if (!response?.data?.response || response.data.response.length === 0) {
                console.warn(`[apiBasketballProvider]: Nem találhatók ligák (S: ${currentSeason}, C: ${countryName})`);
                return null;
            }
            
            // Megkeressük a pontos egyezést
            const league = response.data.response.find((l: any) => l.name.toLowerCase() === leagueName.toLowerCase());
            if (league) {
                return league.id;
            }
            // Ha nincs pontos, megpróbáljuk a 'search'-t
            const searchParams = { season: currentSeason, search: leagueName };
            const searchResponse = await makeBasketballRequest(endpoint, { params: searchParams }, apiConfig);
            if (searchResponse?.data?.response && searchResponse.data.response.length > 0) {
                return searchResponse.data.response[0].id; // Vesszük az elsőt
            }
            return null;
        } catch (e: any) {
            console.error(`[apiBasketballProvider] Hiba a liga keresésekor: ${e.message}`);
            return null;
        }
    };
    
    let leagueId = await tryGetLeague(season);
    if (leagueId) {
        apiSportsLeagueIdCache.set(leagueCacheKey, { leagueId, foundSeason: season });
        return { leagueId, foundSeason: season };
    }
    
    const fallbackSeason = season - 1;
    console.warn(`[apiBasketballProvider]: Nem található liga a(z) ${season} szezonban. Újrapróbálkozás: ${fallbackSeason}...`);
    leagueId = await tryGetLeague(fallbackSeason);
    
    if (leagueId) {
        apiSportsLeagueIdCache.set(leagueCacheKey, { leagueId, foundSeason: fallbackSeason });
        return { leagueId, foundSeason: fallbackSeason };
    }

    console.error(`[apiBasketballProvider]: Végleg nem található liga ID ehhez: "${leagueName}" (${countryName})`);
    return { leagueId: null, foundSeason: season };
}


async function findApiSportsFixture(homeTeamId: number, awayTeamId: number, season: number, leagueId: number, utcKickoff: string, sport: string, apiConfig: any): Promise<any | null> {
    const cacheKey = `apisports_findfixture_v1_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get<any>(cacheKey);
    if (cached) return cached;

    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const endpoint = `/games`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    
    try {
        const response = await makeBasketballRequest(endpoint, { params }, apiConfig);
        if (response?.data?.response?.length > 0) {
            const foundFixture = response.data.response.find((f: any) => f.teams?.away?.id === awayTeamId);
            if (foundFixture) {
                console.log(`[apiBasketballProvider]: MECCS TALÁLAT! FixtureID: ${foundFixture.id}`);
                apiSportsFixtureCache.set(cacheKey, foundFixture); 
                return foundFixture;
            }
        }
        console.warn(`[apiBasketballProvider]: Nem található fixture (H:${homeTeamId} vs A:${awayTeamId}, D:${matchDate}, S:${season}).`);
        apiSportsFixtureCache.set(cacheKey, null);
        return null;
    } catch (e: any) {
        console.error(`[apiBasketballProvider] KRITIKUS API HIBA a fixture keresésekor: ${e.message}`);
        return null;
    }
}

async function getApiSportsTeamSeasonStats(teamId: number, leagueId: number, season: number, sport: string, apiConfig: any): Promise<any | null> {
    const cacheKey = `apisports_seasonstats_v1_${sport}_${teamId}_${leagueId}_${season}`;
    const cachedStats = apiSportsStatsCache.get<any>(cacheKey);
    if (cachedStats) return cachedStats;

    const endpoint = `/teams/statistics`;
    const params = { team: teamId, league: leagueId, season: season };
    
    try {
        const response = await makeBasketballRequest(endpoint, { params }, apiConfig);
        const stats = response?.data?.response;
        if (stats && (stats.league?.id || (stats.games?.played > 0))) {
            console.log(`[apiBasketballProvider]: Szezon statisztika sikeresen lekérve (S:${season}).`);
            
            // Kanonikus formára hozzuk (amennyire lehet)
            let simplifiedStats = {
                gamesPlayed: stats.games?.played,
                form: null, // Kosárnál az 'api-sports' nem ad forma stringet
                // A 'gf' és 'ga' itt a pontátlagot jelenti
                gf: stats.points?.for, // Átlag lőtt pont
                ga: stats.points?.against, // Átlag kapott pont
                offensive_rating: null,
                defensive_rating: null,
                pace: null
            };
            apiSportsStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        }
        return null;
    } catch (e: any) {
        console.error(`[apiBasketballProvider] Hiba a szezon statisztika lekérésekor (S:${season}): ${e.message}`);
        return null;
    }
}

async function getApiSportsOdds(fixtureId: number | string, sport: string, apiConfig: any): Promise<ICanonicalOdds | null> {
    const cacheKey = `apisports_odds_v1_${sport}_${fixtureId}`;
    const cached = apiSportsOddsCache.get<ICanonicalOdds>(cacheKey);
    if (cached) return { ...cached, fromCache: true };

    const endpoint = `/odds`;
    const params = { game: fixtureId }; // 'game' az 'api-basketball'-ban
    
    try {
        const response = await makeBasketballRequest(endpoint, { params }, apiConfig);
        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`[apiBasketballProvider] Odds: Nem érkezett szorzó adat a ${fixtureId} fixture-höz.`);
            return null;
        }
        
        const oddsData = response.data.response[0]; 
        const bookmaker = oddsData.bookmakers?.find((b: any) => b.name === "Bet365") || oddsData.bookmakers?.[0];
        
        const currentOdds: { name: string; price: number }[] = [];
        const allMarkets: ICanonicalOdds['allMarkets'] = [];

        // 1. Moneyline (h2h)
        const moneylineMarket = bookmaker?.bets?.find((b: any) => b.name === "Moneyline");
        if (moneylineMarket) {
            const homeOdd = moneylineMarket.values.find((v: any) => v.value === "Home")?.odd;
            const awayOdd = moneylineMarket.values.find((v: any) => v.value === "Away")?.odd;
            if (homeOdd) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOdd) });
            if (awayOdd) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOdd) });
            
            allMarkets.push({
                key: 'h2h',
                outcomes: currentOdds.map(o => ({ name: o.name.includes('Hazai') ? 'Home' : 'Away', price: o.price }))
            });
        }
        
        // 2. Totals (Total Points)
        const totalsMarket = bookmaker?.bets?.find((b: any) => b.name === "Total");
        if (totalsMarket) {
             const outcomes = (totalsMarket.values || []).map((v: any) => ({
                name: v.value,
                price: parseFloat(v.odd),
                point: (typeof v.value === 'string') ? (v.value.match(/(\d+\.\d)/) ? parseFloat(v.value.match(/(\d+\.\d)/)[1]) : null) : null
            }));
            allMarkets.push({ key: 'totals', outcomes });
        }

        const result: ICanonicalOdds = {
            current: currentOdds, 
            fullApiData: oddsData,
            allMarkets: allMarkets,
            fromCache: false 
        };
        
        if (result.current.length > 0) {
            apiSportsOddsCache.set(cacheKey, result);
        }
        return result; 
    } catch (e: any) {
        console.error(`[apiBasketballProvider] Hiba az oddsok lekérésekor: ${e.message}`);
        return null;
    }
}

// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData ---
// === JAVÍTÁS 2 (TS2353): Visszatérési típus javítása IDataFetchResponse-ra ===
export async function fetchMatchData(options: any): Promise<IDataFetchResponse> {
// === JAVÍTÁS 2 VÉGE ===
    
    const { 
        sport, 
        homeTeamName, 
        awayTeamName, 
        leagueName, 
        utcKickoff, 
        countryContext,
        apiConfig // Ezt a DataFetch.ts-től kapjuk meg
    } = options;
    
    const seasonDate = new Date(utcKickoff);
    const originSeason = (seasonDate.getMonth() < 7) ? seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
    
    console.log(`Adatgyűjtés indul (v1.1 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    
    // 1. LÉPÉS: Liga ID
    const { leagueId, foundSeason } = await getApiSportsLeagueId(leagueName, countryContext, originSeason, sport, apiConfig);
    
    if (!leagueId) {
        console.error(`[apiBasketballProvider] KRITIKUS HIBA: Nem található Liga ID. Tiszta P1 mód kényszerítése.`);
        return generateEmptyStubContext(options);
    }
    
    // 2. LÉPÉS: Csapatlista lekérése
    const leagueRosterData = await _getLeagueRoster(leagueId, foundSeason, sport, apiConfig);
    
    // 3. LÉPÉS: Csapat ID-k lekérése
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, originSeason, leagueRosterData),
        getApiSportsTeamId(awayTeamName, sport, leagueId, originSeason, leagueRosterData),
    ]);
    
    if (!homeTeamId || !awayTeamId) { 
        console.warn(`[apiBasketballProvider] FIGYELMEZTETÉS: Csapat azonosítók hiányoznak. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}. Tiszta P1 mód.`);
        return generateEmptyStubContext(options);
    }
    
    // 4. LÉPÉS: Meccskeresés
    const foundFixture = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport, apiConfig);
    const fixtureId = foundFixture?.id || null;
    const fixtureDate = foundFixture?.date || null;
    const venueData = foundFixture?.arena || null;
    
    if (!fixtureId) {
         console.warn(`[apiBasketballProvider]: Nem található fixture, az odds és H2H lekérés kihagyva.`);
    }

    // 5. LÉPÉS: Statisztikák párhuzamos lekérése
    const [
        fetchedOddsData,
        // H2H (az 'api-basketball' másképp kéri, mint a hoki)
        // apiSportsH2HData, 
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        structuredWeather
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport, apiConfig),
        // TODO: H2H implementálása kosárhoz (/games/h2h)
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport, apiConfig),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport, apiConfig),
        getWeatherForFixture(venueData, utcKickoff) // Ez a hívás most már működik
    ]);
    
    // --- VÉGLEGES ADAT EGYESÍTÉS ---
    const finalData: ICanonicalRawData = {
        stats: { home: {} as ICanonicalStats, away: {} as ICanonicalStats },
        apiFootballData: { // Ezt a nevet megtartjuk a kompatibilitás miatt
             homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
             lineups: null, liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        },
        h2h_structured: [], // TODO: H2H implementálása
        form: {
            home_overall: apiSportsHomeSeasonStats?.form || null, // API-Sports nem ad formát kosárhoz
            away_overall: apiSportsAwaySeasonStats?.form || null, 
        },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] }, // TODO: Kosár hiányzók (/injuries)
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: venueData ? `${venueData.name}, ${venueData.city}` : "N/J",
            structured_weather: structuredWeather,
            pitch_condition: "N/A (Parketta)", 
            weather: structuredWeather.description || "N/J",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] } // TODO: Kosár keretek (/players)
    };
    
    const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || 1; 
    finalData.stats.home = {
        gp: homeGP,
        gf: apiSportsHomeSeasonStats?.gf || 110, // Átlag lőtt pont
        ga: apiSportsHomeSeasonStats?.ga || 110, // Átlag kapott pont
        form: apiSportsHomeSeasonStats?.form || null
    };
    const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || 1;
    finalData.stats.away = {
        gp: awayGP,
        gf: apiSportsAwaySeasonStats?.gf || 110,
        ga: apiSportsAwaySeasonStats?.ga || 110,
        form: apiSportsAwaySeasonStats?.form || null
    };
    
    const richContext = `Kosárlabda elemzés (v1.1). Statisztikák ${foundSeason} szezonból.`;
    
    // Itt adjuk át a valós, számított statisztikákat
    const advancedData = { 
        home: { 
            xg: null, // Kosárnál nem releváns
            offensive_rating: apiSportsHomeSeasonStats?.gf, // Átadjuk az átlag lőtt pontot
            defensive_rating: apiSportsHomeSeasonStats?.ga, // Átadjuk az átlag kapott pontot
            pace: null // Az API-Sports ingyenes verziója nem adja meg
        }, 
        away: { 
            xg: null,
            offensive_rating: apiSportsAwaySeasonStats?.gf,
            defensive_rating: apiSportsAwaySeasonStats?.ga,
            pace: null
        } 
    };
        
    // === JAVÍTÁS 2 (TS2353): Az 'xgSource'-t a külső objektumhoz adjuk ===
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: {}, // A Model.ts kezeli a defaultokat
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData,
         oddsData: fetchedOddsData,
         fromCache: false,
         availableRosters: finalData.availableRosters
         // Az 'xgSource' mező eltávolítva innen
    };
    
    // Az IDataFetchResponse interfésznek megfelelően
    // az 'xgSource'-t a legkülső objektumhoz adjuk hozzá.
    return {
        ...result,
        xgSource: "API (Real)" // (vagy a P1 logika által meghatározott)
    };
    // === JAVÍTÁS 2 VÉGE ===
}

// Meta-adat a logoláshoz
export const providerName = 'api-basketball-v1';

// "Stub" Válasz Generátor (Hibakezeléshez)
// === JAVÍTÁS 2 (TS2353): Visszatérési típus javítása IDataFetchResponse-ra ===
function generateEmptyStubContext(options: any): IDataFetchResponse {
// === JAVÍTÁS 2 VÉGE ===
    const { homeTeamName, awayTeamName, sport } = options;
    console.warn(`[apiBasketballProvider/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const defaultPoints = SPORT_CONFIG[sport]?.avg_goals || 110;
    const emptyStats: ICanonicalStats = { gp: 1, gf: defaultPoints, ga: defaultPoints, form: null };
    const emptyWeather: IStructuredWeather = { description: "N/A (API Hiba)", temperature_celsius: null, wind_speed_kmh: null, precipitation_mm: null, source: 'N/A' };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: { homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: { stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
        availableRosters: { home: [], away: [] }
    };
    
    // === JAVÍTÁS 2 (TS2353): Az 'xgSource'-t a külső objektumhoz adjuk ===
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés (kosárlabda) sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { 
            home: { xg: null, offensive_rating: defaultPoints, defensive_rating: defaultPoints }, 
            away: { xg: null, offensive_rating: defaultPoints, defensive_rating: defaultPoints },
            // Átadjuk a P1 adatokat, ha léteznek (bár kosárnál nem valószínű)
             manual_H_xG: options.manual_H_xG,
             manual_H_xGA: options.manual_H_xGA,
             manual_A_xG: options.manual_A_xG,
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] }
         // Az 'xgSource' mező eltávolítva innen
    };
    
    let xgSource = "N/A (API Hiba)";
    if (options.manual_H_xG != null) { // Csak P1 ellenőrzés
        xgSource = "Manual (Components)";
    }
    
    // Az 'IDataFetchResponse' viszont igen
    return {
        ...result,
        xgSource: xgSource
    };
    // === JAVÍTÁS 2 VÉGE ===
}
