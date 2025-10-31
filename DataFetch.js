// --- VÉGLEGES INTEGRÁLT (v46 - Közvetlen API-SPORTS Hozzáférés) datafetch.js ---
// - V46 VÁLTOZÁS: A 'getApiConfig' függvény átalakítva a közvetlen API-Sports
// - hozzáféréshez (x-apisports-key header használata).
// - V45 JAVÍTÁS: A 'getApiSportsTeamId' most már 'leagueId' paramétert is kap.
// - A keresés most már a PONTOS ligára szűkít (/v3/teams?name=...&league=...).
// - Ez megoldja a "Pisa" (olasz) vs "Pisa" (finn) ütközést.
// - 'getRichContextualData' sorrendje megváltoztatva: Először Liga ID, utána Csapat ID.
// - MEGTARTVA (v42): xG API Integráció.
// - MEGTARTVA (v41): Kulcsrotációs logika.

import axios from 'axios';
import NodeCache from 'node-cache';
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
    XG_API_KEY, XG_API_HOST // V42 import
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
import { fileURLToPath } from 'url';
import path from 'path';

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const xgApiCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });

// --- GLOBÁLIS KULCS SZÁMLÁLÓ ---
let keyIndexes = {
    soccer: 0,
    hockey: 0,
    basketball: 0
};
// ------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v46 (2025-10-31) - Közvetlen API-Sports Hozzáférés
**************************************************************/

// --- V46: MÓDOSÍTOTT API KONFIGURÁCIÓ KIVÁLASZTÓ ---
// Ez a függvény most már a közvetlen API-Sports hozzáféréshez generál headereket.
function getApiConfig(sport) {
    const config = API_HOSTS[sport];
    if (!config || !config.host || !config.keys || config.keys.length === 0) {
        throw new Error(`Kritikus konfigurációs hiba: Nincsenek API kulcsok a '${sport}' sporthoz a config.js-ben.`);
    }
    const currentIndex = keyIndexes[sport];
    if (currentIndex >= config.keys.length) {
        throw new Error(`MINDEN API KULCS Kimerült a(z) '${sport}' sporthoz.`);
    }
    const currentKey = config.keys[currentIndex];

    // <-- VÁLTOZÁS: A headerek mostantól a közvetlen hozzáférésnek felelnek meg.
    // Nincs többé 'x-rapidapi-host', és a kulcs neve 'x-apisports-key'.
    return {
        baseURL: `https://${config.host}`,
        headers: {
            'x-apisports-key': currentKey
        },
        keyIndex: currentIndex,
        totalKeys: config.keys.length
    };
}

// --- KULCSROTÁCIÓS FUNKCIÓ (NEM VÁLTOZOTT) ---
function rotateApiKey(sport) {
    const config = API_HOSTS[sport];
    if (keyIndexes[sport] < config.keys.length - 1) {
        keyIndexes[sport]++;
        console.log(`API KULCS ROTÁLÁS: Váltás a(z) ${keyIndexes[sport] + 1}. kulcsra (${sport})...`);
        return true;
    } else {
        return false;
    }
}

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY (NEM VÁLTOZOTT) ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 25000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };
            
            let response;
            if (method === 'POST') {
                response = await axios.post(url, currentConfig.data || {}, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }

            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.response.status === 429 || error.response.data?.message?.includes('reached your credit limit')) {
                    const quotaError = new Error(errorMessage);
                    quotaError.response = error.response;
                    quotaError.isQuotaError = true;
                    throw quotaError; 
                }
                if ([401, 403].includes(error.response.status)) { 
                    console.error(`HITELESÍTÉSI HIBA: ${errorMessage}`);
                    return null; 
                }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 25000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
            }
            
            if (attempts > retries) {
                console.error(`API (${method}) hívás végleg sikertelen: ${errorMessage}`);
                throw new Error(`API hívás végleg sikertelen: ${error.message}`);
            }
            console.warn(errorMessage);
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    return null;
}

// --- KÖZPONTI HÍVÓ FÜGGVÉNY KULCSROTÁCIÓVAL (NEM VÁLTOZOTT) ---
async function makeRequestWithRotation(sport, endpoint, config = {}) {
    const maxAttempts = API_HOSTS[sport]?.keys?.length || 1;
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const apiConfig = getApiConfig(sport);
            const url = `${apiConfig.baseURL}${endpoint}`;
            const fullConfig = { ...config, headers: { ...apiConfig.headers, ...config.headers } };
            const response = await makeRequest(url, fullConfig, 0); 
            return response; // SIKER

        } catch (error) {
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
                console.error(`API hiba (nem kvóta): ${error.message}`);
                throw error; 
            }
        }
    }
    throw new Error(`API hívás sikertelen ${maxAttempts} kulccsal: ${endpoint}`);
}

// --- A FÁJL TÖBBI RÉSZE VÁLTOZATLAN ---

// --- GEMINI API FUNKCIÓ (NEM VÁLTOZOTT) ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID.");
    }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", }, };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }
        let potentialJson = responseText.trim();
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            potentialJson = jsonMatch[1].trim();
        }
        JSON.parse(potentialJson); // Validálás
        return potentialJson;
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        throw e;
    }
}

// --- IDŐJÁRÁS FUNKCIÓ (NEM VÁLTOZOTT) ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    console.log(`Időjárás lekérés (placeholder): Helyszín=${stadiumLocation}, Időpont=${utcKickoff}`);
    return {
        temperature_celsius: null,
        description: "N/A"
    };
}

// --- API-SPORTS FUNKCIÓK (v45 - Liga-alapú Kereséssel) ---
async function getApiSportsTeamId(teamName, sport, leagueId, season) {
    const lowerName = teamName.toLowerCase().trim();
    const mappedName = APIFOOTBALL_TEAM_NAME_MAP[lowerName] || teamName;
    const searchName = mappedName;
    const cacheKey = `apisports_teamid_v45_${sport}_${leagueId}_${season}_${searchName.toLowerCase().replace(/\s+/g, '')}`;
    const cachedId = apiSportsTeamIdCache.get(cacheKey);
    if (cachedId !== undefined) { 
        return cachedId === 'not_found' ?
        null : cachedId; 
    }

    if (mappedName !== teamName) {
        console.log(`API-SPORTS Név Térképezés (${sport}): "${teamName}" (ESPN) -> "${searchName}" (Keresés)`);
    }
    
    const endpoint = `/v3/teams?name=${encodeURIComponent(searchName)}&league=${leagueId}&season=${season}`;
    console.log(`API-SPORTS (${sport}): Csapatkeresés (Ligával): Név="${searchName}", LigaID="${leagueId}"`);

    const response = await makeRequestWithRotation(sport, endpoint, {});
    if (response?.data?.response?.length > 0) {
        const team = response.data.response[0].team;
        if (team && team.id) {
            console.log(`API-SPORTS (${sport}): TÖKÉLETES ID találat "${searchName}" -> ${team.id}`);
            apiSportsTeamIdCache.set(cacheKey, team.id);
            return team.id;
        }
    }
    
    console.warn(`API-SPORTS (${sport}): Pontos (name=) keresés sikertelen. Próbálkozás 'search=' paraméterrel...`);
    const fallbackEndpoint = `/v3/teams?search=${encodeURIComponent(searchName)}&league=${leagueId}&season=${season}`;
    const fallbackResponse = await makeRequestWithRotation(sport, fallbackEndpoint, {});
    if (fallbackResponse?.data?.response?.length > 0) {
        const teams = fallbackResponse.data.response;
        const teamNames = teams.map(t => t.team?.name);
        const matchResult = findBestMatch(searchName, teamNames);
        if (matchResult.bestMatch.rating > 0.9) { 
            const teamId = teams[matchResult.bestMatchIndex].team.id;
            console.log(`API-SPORTS (${sport}): Hasonló ID találat (fallback) "${searchName}" -> "${teams[matchResult.bestMatchIndex].team.name}" -> ${teamId}`);
            apiSportsTeamIdCache.set(cacheKey, teamId);
            return teamId;
        }
    }

    console.warn(`API-SPORTS (${sport}): Nem található csapat ID ehhez: "${searchName}" (Liga: "${leagueId}", Eredeti: "${teamName}").`);
    apiSportsTeamIdCache.set(cacheKey, 'not_found');
    return null;
}

async function getApiSportsLeagueId(leagueName, country, season, sport) {
    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const tryGetLeague = async (currentSeason) => {
        const cacheKey = `apisports_leagueid_v40_${sport}_${country.toLowerCase()}_${leagueName.toLowerCase().replace(/\s/g, '')}_${currentSeason}`;
        const cachedId = apiSportsLeagueIdCache.get(cacheKey);
        if (cachedId) return cachedId === 'not_found' ? null : cachedId;

        const endpoint = `/v3/leagues`;
        const params = { name: leagueName, country: country, season: currentSeason };
        
        console.log(`API-SPORTS League Search (${sport}): "${leagueName}" (${country}, ${currentSeason})...`);
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        
        if (response?.data?.response?.length > 0) {
            const perfectMatch = response.data.response.find(l => l.league.name.toLowerCase() === leagueName.toLowerCase());
            const league = perfectMatch || response.data.response[0];
            const leagueId = league.league.id;
            console.log(`API-SPORTS (${sport}): Liga ID találat "${leagueName}" -> "${league.name}" -> ${leagueId}`);
            apiSportsLeagueIdCache.set(cacheKey, leagueId);
            return leagueId;
        }
        console.warn(`API-SPORTS (${sport}): Nem található liga ID ehhez: "${leagueName}" (${country}, ${currentSeason}).`);
        apiSportsLeagueIdCache.set(cacheKey, 'not_found');
        return null;
    };

    let leagueId = await tryGetLeague(season);
    if (!leagueId && sport === 'soccer') {
        console.warn(`API-SPORTS (${sport}): Nem található liga a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        leagueId = await tryGetLeague(season - 1);
    }
    return leagueId;
}

async function findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, utcKickoff, sport) {
    if (!homeTeamId || !awayTeamId || !season || !leagueId) return { fixtureId: null, fixtureDate: null };
    const cacheKey = `apisports_findfixture_v40_${sport}_${homeTeamId}_${awayTeamId}_${leagueId}_${season}`;
    const cached = apiSportsFixtureCache.get(cacheKey);
    if (cached) return cached;
    
    const matchDate = new Date(utcKickoff).toISOString().split('T')[0];
    const endpoint = `/v3/fixtures`;
    const params = { league: leagueId, season: season, team: homeTeamId, date: matchDate };
    console.log(`API-SPORTS Fixture Keresés (${sport}): H:${homeTeamId} vs A:${awayTeamId} a(z) ${leagueId} ligában...`);
    const response = await makeRequestWithRotation(sport, endpoint, { params });
    if (response?.data?.response?.length > 0) {
        const foundFixture = response.data.response.find(f => 
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
    
    console.warn(`API-SPORTS (${sport}): Nem található fixture a H:${homeTeamId} vs A:${awayTeamId} párosításhoz.`);
    apiSportsFixtureCache.set(cacheKey, { fixtureId: null, fixtureDate: null });
    return { fixtureId: null, fixtureDate: null };
}

async function getApiSportsH2H(homeTeamId, awayTeamId, limit = 5, sport) {
    const endpoint = `/v3/fixtures/headtohead`;
    const params = { h2h: `${homeTeamId}-${awayTeamId}` };
    const response = await makeRequestWithRotation(sport, endpoint, { params });

    const fixtures = response?.data?.response;
    if (fixtures && Array.isArray(fixtures)) {
        return fixtures.map(fix => ({
            date: (fix.fixture || fix).date?.split('T')[0] || 'N/A',
            competition: (fix.league || fix).name || 'N/A',
            score: `${(fix.goals || fix.scores)?.home ?? '?'} - ${(fix.goals || fix.scores)?.away ?? '?'}`,
            home_team: fix.teams?.home?.name || fix.contestants?.home?.name || 'N/A',
            away_team: fix.teams?.away?.name || fix.contestants?.away?.name || 'N/A',
        })).slice(0, limit);
    }
    return null;
}

async function getApiSportsTeamSeasonStats(teamId, leagueId, season, sport) {
    const tryGetStats = async (currentSeason) => {
        const cacheKey = `apisports_seasonstats_v40_${sport}_${teamId}_${leagueId}_${currentSeason}`;
        const cachedStats = apiSportsStatsCache.get(cacheKey);
        if (cachedStats) {
            console.log(`API-SPORTS Szezon Stat cache találat (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}`);
            return cachedStats;
        }

        console.log(`API-SPORTS Szezon Stat lekérés (${sport}): T:${teamId}, L:${leagueId}, S:${currentSeason}...`);
        const endpoint = `/v3/teams/statistics`;
        const params = { team: teamId, league: leagueId, season: currentSeason };
        const response = await makeRequestWithRotation(sport, endpoint, { params });
        const stats = response?.data?.response;
        if (stats && (stats.league?.id || stats.games?.played > 0)) {
            console.log(`API-SPORTS (${sport}): Szezon statisztika sikeresen lekérve (${stats.league?.name || leagueId}, ${currentSeason}).`);
            let simplifiedStats = {
                gamesPlayed: stats.fixtures?.played?.total || stats.games?.played,
                form: stats.form,
                goalsFor: stats.goals?.for?.total?.total,
                goalsAgainst: stats.goals?.against?.total?.total,
            };
            if (sport === 'hockey' && stats.games) {
                simplifiedStats = {
                    gamesPlayed: stats.games.played,
                    form: stats.form,
                    goalsFor: stats.goals.for,
                    goalsAgainst: stats.goals.against,
                };
            }
            if (sport === 'basketball' && stats.games) {
                simplifiedStats = {
                    gamesPlayed: stats.games.played,
                    form: stats.form,
                    pointsFor: stats.points.for,
                    pointsAgainst: stats.points.against,
                };
            }

            apiSportsStatsCache.set(cacheKey, simplifiedStats);
            return simplifiedStats;
        }
        return null;
    };
    
    let stats = await tryGetStats(season);
    if (!stats && sport === 'soccer') {
        console.warn(`API-SPORTS (${sport}): Nem található statisztika a(z) ${season} szezonra. Próbálkozás az előző szezonnal...`);
        stats = await tryGetStats(season - 1);
    }

    if (!stats) {
        console.error(`API-SPORTS (${sport}): Végleg nem található szezon statisztika ehhez: T:${teamId}, L:${leagueId}`);
    }
    
    return stats;
}

async function getApiSportsOdds(fixtureId, sport) {
    if (!fixtureId) {
        console.warn(`API-SPORTS Odds (${sport}): Hiányzó fixtureId, a szorzók lekérése kihagyva.`);
        return null;
    }
    
    const cacheKey = `apisports_odds_v40_${sport}_${fixtureId}`;
    const cached = apiSportsOddsCache.get(cacheKey);
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
    const bookmaker = oddsData.bookmakers?.find(b => b.name === "Bet365") || oddsData.bookmakers?.[0];
    const winnerMarketName = sport === 'soccer' ? "Match Winner" : "Moneyline";
    const matchWinnerMarket = bookmaker?.bets?.find(b => b.name === winnerMarketName);
    const currentOdds = [];
    if (matchWinnerMarket) {
        const homeOdd = matchWinnerMarket.values.find(v => v.value === "Home")?.odd;
        const drawOdd = matchWinnerMarket.values.find(v => v.value === "Draw")?.odd;
        const awayOdd = matchWinnerMarket.values.find(v => v.value === "Away")?.odd;
        if (homeOdd) currentOdds.push({ name: 'Hazai győzelem', price: parseFloat(homeOdd) });
        if (drawOdd) currentOdds.push({ name: 'Döntetlen', price: parseFloat(drawOdd) });
        if (awayOdd) currentOdds.push({ name: 'Vendég győzelem', price: parseFloat(awayOdd) });
    }

    const result = {
        current: currentOdds, 
        fullApiData: oddsData 
    };
    if (result.current.length > 0) {
        apiSportsOddsCache.set(cacheKey, result);
        console.log(`API-SPORTS Odds adatok (${sport}) sikeresen lekérve és cache-elve: ${cacheKey}`);
    } else {
         console.warn(`API-SPORTS Odds (${sport}): Találat, de nem sikerült '${winnerMarketName}' piacot találni.`);
    }

    return { ...result, fromCache: false };
}

// --- xG API FUNKCIÓ (NEM VÁLTOZOTT) ---
async function getXgData(fixtureId) {
    if (!fixtureId) {
        console.warn("xG API: Hiányzó fixtureId, xG lekérés kihagyva.");
        return null;
    }
    if (!XG_API_KEY || !XG_API_HOST) {
        console.warn("xG API: Hiányzó XG_API_KEY vagy XG_API_HOST a config.js-ben. xG lekérés kihagyva.");
        return null;
    }
    
    const cacheKey = `xg_api_v42_${fixtureId}`;
    const cached = xgApiCache.get(cacheKey);
    if (cached) {
        console.log(`xG API cache találat: ${cacheKey}`);
        return cached;
    }

    console.log(`xG API: Valós xG adatok lekérése... (FixtureID: ${fixtureId})`);
    const url = `https://${XG_API_HOST}/fixtures/${fixtureId}`;
    const headers = {
        'x-rapidapi-key': XG_API_KEY,
        'x-rapidapi-host': XG_API_HOST
    };
    try {
        const response = await makeRequest(url, { headers }, 0);
        const xg = response?.data?.result?.xg;
        if (xg && xg.home !== null && xg.away !== null) {
            console.log(`xG API: SIKERES. Valós xG: H=${xg.home}, A=${xg.away}`);
            xgApiCache.set(cacheKey, xg);
            return xg;
        } else {
            console.warn(`xG API: Az API válaszolt, de nem tartalmazott xG adatot a ${fixtureId} meccshez.`);
            xgApiCache.set(cacheKey, null); 
            return null;
        }
    } catch (error) {
        if (error.isQuotaError) {
            console.error("xG API: A NAPI KVÓTA KIMERÜLT (100 hívás). Az elemzés valós xG nélkül folytatódik.");
        } else if (error.response?.status === 404) {
             console.warn(`xG API: Nem található fixture (${fixtureId}). Valószínűleg a liga nem támogatott. Az elemzés valós xG nélkül folytatódik.`);
        } else if (error.response?.status === 401 || error.response?.status === 403) {
             console.error("xG API: HITELESÍTÉSI HIBA. Valószínűleg az API kulcs hibás, vagy a feliratkozás még 'Open' státuszban van.");
        } else {
            console.error(`xG API Hiba: ${error.message}`);
        }
        xgApiCache.set(cacheKey, null);
        return null;
    }
}

export function findMainTotalsLine(oddsData, sport) {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line || (sport === 'soccer' ? 2.5 : 6.5);
    
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultConfigLine;
    }

    const bookmaker = oddsData.fullApiData.bookmakers.find(b => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultConfigLine;

    let marketName;
    if (sport === 'soccer') marketName = "over/under";
    else if (sport === 'hockey') marketName = "total";
    else if (sport === 'basketball') marketName = "total points";
    else marketName = "over/under";
    const totalsMarket = bookmaker.bets.find(b => b.name.toLowerCase() === marketName);
    if (!totalsMarket?.values) {
        console.warn(`Nem található '${marketName}' piac a szorzókban (${sport}).`);
        return defaultConfigLine;
    }

    const linesAvailable = {};
    for (const val of totalsMarket.values) {
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

// --- FŐ ADATGYŰJTŐ FUNKCIÓ (NEM VÁLTOZOTT) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v45_apif_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const fixtureId = cached.rawData.apiFootballData.fixtureId;
        const oddsResult = await getApiSportsOdds(fixtureId, sport);
        if (oddsResult && !oddsResult.fromCache) {
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff));
        const seasonDate = new Date(decodedUtcKickoff);
        const season = (sport !== 'soccer' && seasonDate.getMonth() < 7) ? seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        if (isNaN(season)) throw new Error(`Érvénytelen utcKickoff: ${decodedUtcKickoff}`);
        
        console.log(`Adatgyűjtés indul (v45 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
        
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig.espn_leagues[leagueName];
        if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
        
        const country = leagueData.country;
        
        const leagueId = await getApiSportsLeagueId(leagueName, country, season, sport);
        if (!leagueId) throw new Error(`Nem sikerült a 'leagueId' azonosítása.`);
        console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId}`);
        const [homeTeamId, awayTeamId] = await Promise.all([
            getApiSportsTeamId(homeTeamName, sport, leagueId, season),
            getApiSportsTeamId(awayTeamName, sport, leagueId, season),
        ]);
        if (!homeTeamId || !awayTeamId) { 
            throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`);
        }
        
        const { fixtureId, fixtureDate } = await findApiSportsFixture(homeTeamId, awayTeamId, season, leagueId, decodedUtcKickoff, sport);
        if (!fixtureId) {
             console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
        }

        console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
        const [
            fetchedOddsData,
            apiSportsH2HData,
            apiSportsHomeSeasonStats,
            apiSportsAwaySeasonStats,
            realXgData
        ] = await Promise.all([
            getApiSportsOdds(fixtureId, sport), 
            getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
            getApiSportsTeamSeasonStats(homeTeamId, leagueId, season, sport),
            getApiSportsTeamSeasonStats(awayTeamId, leagueId, season, sport),
            (sport === 'soccer' && fixtureId) ? getXgData(fixtureId) : Promise.resolve(null)
        ]);
        console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
        
        const geminiJsonString = await _callGemini(PROMPT_V43(
             sport, homeTeamName, awayTeamName,
             apiSportsHomeSeasonStats, apiSportsAwaySeasonStats,
             apiSportsH2HData,
             null
        ));
        let geminiData = null;
        try { 
            geminiData = geminiJsonString ?
            JSON.parse(geminiJsonString) : null;
        } catch (e) { 
            console.error(`Gemini JSON parse hiba: ${e.message}.`, (geminiJsonString || '').substring(0, 500));
        }

        if (!geminiData || typeof geminiData !== 'object') {
             geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home: {}, away: {} }, tactical_patterns: { home: [], away: [] }, key_matchups: {}, advanced_stats_team: { home: {}, away: {} }, advanced_stats_goalie: { home_goalie: {}, away_goalie: {} }, shot_distribution: {}, defensive_style: {}, absentees: { home: [], away: [] }, team_news: { home: "N/A", away: "N/A" }, h2h_structured: [] };
            console.warn("Gemini válasz hibás vagy üres, default struktúra használva.");
        }

        const finalData = { ...geminiData };
        const finalHomeStats = {
            ...(geminiData.stats?.home || {}),
            ...(apiSportsHomeSeasonStats || {}),
        };
        const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || geminiData.stats?.home?.gp || 1;
        finalHomeStats.GP = homeGP;
        finalHomeStats.gp = homeGP;
        finalHomeStats.gamesPlayed = homeGP;
        const finalAwayStats = {
            ...(geminiData.stats?.away || {}),
            ...(apiSportsAwaySeasonStats || {}),
        };
        const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || geminiData.stats?.away?.gp || 1;
        finalAwayStats.GP = awayGP;
        finalAwayStats.gp = awayGP;
        finalAwayStats.gamesPlayed = awayGP;
        finalData.stats = {
            home: finalHomeStats,
            away: finalAwayStats
        };
        console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);

        finalData.apiFootballData = {
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: null, 
            liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        };
        finalData.sportsDbData = finalData.apiFootballData; 
        finalData.h2h_structured = apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []);
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        const homeForm = apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || "N/A";
        const awayForm = apiSportsAwaySeasonStats?.form || geminiData?.form?.away_overall || "N/A";
        finalData.form = { 
            home_overall: homeForm, 
            away_overall: awayForm, 
            home_home: geminiData?.form?.home_home || "N/A", 
            away_away: geminiData?.form?.away_away || "N/A" 
        };
        
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, decodedUtcKickoff);
        if (!finalData.contextual_factors) finalData.contextual_factors = {};
        finalData.contextual_factors.structured_weather = structuredWeather;
        const richContextParts = [
             finalData.h2h_summary && finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
             realXgData && `- Valós xG (API): H=${realXgData.home}, A=${realXgData.away}`,
             finalData.contextual_factors.match_tension_index && finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
             (finalData.team_news?.home && finalData.team_news.home !== "N/A") || (finalData.team_news?.away && finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news?.home||'-'}, V:${finalData.team_news?.away||'-'}`,
             (finalData.absentees?.home?.length > 0 || finalData.absentees?.away?.length > 0) && `- Hiányzók: H:${finalData.absentees?.home?.map(p=>p?.name).join(', ')||'-'}, V:${finalData.absentees?.away?.map(p=>p?.name).join(', ')||'-'}`,
             finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             (finalData.form?.home_overall && finalData.form.home_overall !== "N/A") || (finalData.form?.away_overall && finalData.form.away_overall !== "N/T") && `- Forma: H:${finalData.form?.home_overall||'N/A'}, V:${finalData.form?.away_overall||'N/A'}`,
             (finalData.tactics?.home?.style && finalData.tactics.home.style !== "N/A") || (finalData.tactics?.away?.style && finalData.tactics.away.style !== "N/A") && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`,
             structuredWeather && structuredWeather.description !== "N/A" ? `- Időjárás: ${structuredWeather.description}, ${structuredWeather.temperature_celsius ?? '?'}°C` : `- Időjárás: N/A`,
             finalData.contextual_factors?.pitch_condition && finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const advancedData = realXgData ?
            { home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
            (geminiData.advancedData || { home: { xg: null }, away: { xg: null } });
        const result = {
             rawStats: finalData.stats,
             leagueAverages: finalData.league_averages || {},
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
        
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (v45), cache mentve (${ck}).`);
        return result;

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData (v45) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v45): ${e.message}`);
    }
}

// --- ESPN MECCSLEKÉRDEZÉS (NEM VÁLTOZOTT) ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues) return [];
    
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) return [];
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, leagueData] of Object.entries(sportConfig.espn_leagues)) {
            const slug = leagueData.slug;
            if (!slug) {
                console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`);
                continue;
            }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => {
                        const competition = event.competitions?.[0];
                        if (!competition) return null;
                        const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                        const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        if (event.id && homeTeam?.name && awayTeam?.name && event.date) {
                            return {
                                id: String(event.id),
                                home: homeTeam.name.trim(),
                                away: awayTeam.name.trim(),
                                utcKickoff: event.date,
                                league: leagueName.trim()
                            };
                        }
                        return null;
                    }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400) {
                    console.warn(`ESPN Hiba (400): Valószínűleg rossz slug '${slug}' (${leagueName})?`);
                } else {
                    console.error(`ESPN Hiba (${leagueName}): ${error.message}`);
                }
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    try {
        const results = await Promise.all(promises);
        const uniqueFixtures = Array.from(new Map(results.flat().map(f => [`${f.home}-${f.away}-${f.utcKickoff}`, f])).values());
        uniqueFixtures.sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
        console.log(`ESPN: ${uniqueFixtures.length} egyedi meccs lekérve a következő ${daysInt} napra.`);
        return uniqueFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}

// --- PROMPT (NEM VÁLTOZOTT) ---
function PROMPT_V43(sport, homeTeamName, awayTeamName, apiSportsHomeSeasonStats, apiSportsAwaySeasonStats, apiSportsH2HData, apiSportsLineups) {
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Sports season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats.\n";
    if (apiSportsHomeSeasonStats || apiSportsAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats have been PRE-CALCULATED from API-Sports.\nUse these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
        if (apiSportsHomeSeasonStats) {
            calculatedStatsInfo += `Home Calculated (GP=${apiSportsHomeSeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsHomeSeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Home Calculated: N/A\n`; }
        if (apiSportsAwaySeasonStats) {
            calculatedStatsInfo += `Away Calculated (GP=${apiSportsAwaySeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsAwaySeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Away Calculated: N/A\n`; }
    }
    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-Sports. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiSportsH2HData && Array.isArray(apiSportsH2HData) && apiSportsH2HData.length > 0) {
        const h2hString = apiSportsH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-Sports, Last ${apiSportsH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields.\nDo not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiSportsH2HData)}\n`;
    }
    let lineupInfo = "NOTE ON LINEUPS: No API-Sports lineup data available (this is normal if the match is far away). Analyze absentees and formation based on your general knowledge and recent news.\n";
    if (apiSportsLineups && apiSportsLineups.length > 0) {
        const relevantLineupData = apiSportsLineups.map(t => ({
             team: t.team?.name,
             formation: t.formation,
             startXI: t.startXI?.map(p => p.player?.name),
             substitutes: t.substitutes?.map(p => p.player?.name)
        }));
        lineupInfo = `CRITICAL LINEUP DATA (from API-Sports): ${JSON.stringify(relevantLineupData)}\nUse THIS data *first* to determine absentees, key players, and formation.\nThis is more reliable than general knowledge.\n`;
    }
    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.
**CRITICAL: You MUST use the latest factual data provided below (API-Sports) over your general knowledge.**
${calculatedStatsInfo}
${h2hInfo}
${lineupInfo}
AVAILABLE FACTUAL DATA (From API-Sports):
- Home Season Stats: ${JSON.stringify(apiSportsHomeSeasonStats || 'N/A')}
- Away Season Stats: ${JSON.stringify(apiSportsAwaySeasonStats || 'N/A')}
- Recent H2H: ${h2hInfo.substring(0, 500)}... (See full data above if provided)
- Lineups: ${lineupInfo.substring(0, 500)}... (See full data above if provided)
- (NOTE: Real xG data may have been fetched separately and will be used by the model.)

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga (vagy points).
**USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-Sports H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis.
**(CRITICAL: Use the API-Sports LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall).
**(CRITICAL: Use the 'Form' string from the API-Sports Season Stats provided above.)** Provide home_home and away_away based on general knowledge if season stats are limited.
5. Key Players: name, role, recent key stat. **(Use API-Sports LINEUP data to see who is STARTING).**
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation.
**(CRITICAL: Infer formation from the 'formation' field in the API-Sports LINEUP data. If N/A, use your knowledge but state it's an estimate).**
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }.
  9. Key Matchups: Identify 1-2 key positional or player battles.
IF hockey:
  7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }.
IF basketball:
  7. Advanced Styles: Shot Distribution { home: "...", away: "..." }, Defensive Style { home: "...", away: "..." }.
OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately.
STRUCTURE: {
  "stats":{ "home":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> }, "away":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> } },
  "h2h_summary":"...",
  "h2h_structured":[...],
  "team_news":{ "home":"...", "away":"..." },
  "absentees":{ "home":[{name, importance, role}], "away":[] },
  "absentee_impact_analysis":"...",
  "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." },
  "key_players":{ "home":[{name, role, stat}], "away":[] },
  "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } },
  "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} },
  "tactical_patterns":{ "home":[], "away":[] },
  "key_matchups":{ "description":"..." },
  "advanced_stats_team":{ "home":{...}, "away":{...} },
  "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} },
  "shot_distribution":{ "home":"...", "away":"..." },
  "defensive_style":{ "home":"...", "away":"..." }, 
  "league_averages": { /* Optional: avg_goals_per_game, etc. */ }
}`;
}
