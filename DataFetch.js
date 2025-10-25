import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// findBestMatch importálása

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 12, checkperiod: 3600, useClones: false });

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS: TheSportsDB V2 API maximális kihasználása:
* ÚJ Funkciók: getSportsDbMatchId, getSportsDbLineups, getSportsDbMatchStats.
* PROMPT V37: Integrálja a kezdőcsapatok és meccs statisztikák adatait.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY (Header támogatással) ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 10000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };

            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            if (response.status < 200 || response.status >= 300) {
                 const error = new Error(`API hiba: Státusz kód ${response.status} URL: ${url.substring(0, 100)}...`);
                 error.response = response;
                 const apiMessage = response?.data?.Message || response?.data?.message;
                 if (url.includes('thesportsdb') && apiMessage) { error.message += ` - TheSportsDB: ${apiMessage}`; }
                 if ([401, 403].includes(response.status)) { console.error(`Hitelesítési Hiba (${response.status})! Ellenőrizd az API kulcsot! URL: ${url.substring(0,100)}...`); }
                 if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${url}`); }
                 throw error;
            }
            return response;
        } catch (error) {
             attempts++;
             let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
             if (error.response) {
                 errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                 if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key') || error.message.includes('Missing API key')) { console.error(errorMessage); return null; }
             } else if (error.request) { errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`; }
             else { errorMessage += `Beállítási hiba: ${error.message}`; console.error(errorMessage, error.stack); return null; }
             console.warn(errorMessage);
             if (attempts <= retries) { await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); }
             else { console.error(`API hívás végleg sikertelen: ${url.substring(0, 150)}...`); return null; }
        }
    }
    console.error(`API hívás váratlanul véget ért: ${url.substring(0, 150)}...`);
    return null;
}


// --- SPORTMONKS API --- //
async function findSportMonksTeamId(teamName) { /* ... kód változatlan ... */ return null; }

// --- GEMINI API FUNKCIÓ --- //
export async function _callGemini(prompt) { /* ... kód változatlan ... */ return ""; }

// --- THESPORTSDB FUNKCIÓK ---
const TSDB_HEADERS = { 'X-API-KEY': THESPORTSDB_API_KEY };

/**
 * Lekéri egy csapat TheSportsDB ID-ját név alapján (cache-elve).
 */
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    const cacheKey = `tsdb_teamid_v2h_path_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `https://www.thesportsdb.com/api/v2/json/search/team/${encodeURIComponent(teamName)}`;
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Path Search: URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }
        const teamsArray = response?.data?.teams || response?.data?.search;
        const teamId = (Array.isArray(teamsArray) && teamsArray.length > 0) ? teamsArray[0]?.idTeam : null;
        if (teamId) {
            console.log(`TheSportsDB (V2/Path): ID találat "${teamName}" -> ${teamId}`);
            sportsDbCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`TheSportsDB (V2/Path): Nem található ID ehhez: "${teamName}".`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Path getTeamId for ${teamName}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * ÚJ FUNKCIÓ: Lekéri a TheSportsDB Match ID-t a liga ID és csapatnevek alapján (cache-elve).
 * Ehhez szükségünk van a teljes menetrendre, mivel nincs közvetlen keresési végpont.
 */
async function getSportsDbMatchId(leagueName, homeTeamId, awayTeamId) {
    if (!THESPORTSDB_API_KEY || !homeTeamId || !awayTeamId || !leagueName) return null;
    const cacheKey = `tsdb_matchid_${leagueName}_${homeTeamId}_${awayTeamId}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId) return cachedId === 'not_found' ? null : cachedId;

    // A megfelelő liga ID lekérése a SPORT_CONFIG-ból vagy keresés TheSportsDB all/leagues-ben
    const sportConfig = Object.values(SPORT_CONFIG).find(sc => sc.odds_api_keys_by_league && sc.odds_api_keys_by_league[leagueName]);
    const leagueId = sportConfig?.tsdb_league_id || 4328; // 4328 = EPL, defaultnak

    // Végpont: /schedule/full/league/{idLeague}/{season} - Ez túl sok adatot hozhat
    // Helyette: /schedule/next/league/{idLeague} - a következő 5 meccs (egyszerűbb)
    // De a legjobb lenne a mai/holnapi meccsek lekérése. Végpont: /eventsday.php?d={YYYY-MM-DD}
    // Most az egyszerűség kedvéért az ESPN meccs ID-t használjuk, ha lehetséges, vagy a V2 schedule next/league-et
    const url = `https://www.thesportsdb.com/api/v2/json/schedule/next/league/${leagueId}`;
    const config = { headers: TSDB_HEADERS };

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // Megkeressük a meccset a válaszban a csapat ID-k alapján
        const events = response?.data?.events || [];
        const match = events.find(e =>
             (e.idHomeTeam === homeTeamId && e.idAwayTeam === awayTeamId) ||
             (e.idHomeTeam === awayTeamId && e.idAwayTeam === homeTeamId)
        );
        const matchId = match?.idEvent || null;

        if (matchId) {
            console.log(`TheSportsDB: Match ID ${matchId} találat ${leagueName} ligában.`);
            sportsDbCache.set(cacheKey, matchId);
            return matchId;
        } else {
            console.warn(`TheSportsDB: Nem található Match ID ehhez: ${homeTeamId} vs ${awayTeamId} (${leagueName})`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (getSportsDbMatchId for ${leagueName}): ${error.message}`);
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}


/**
 * Lekéri egy csapat játékoskeretét TheSportsDB ID alapján (cache-elve).
 */
async function getSportsDbPlayerList(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_players_${teamId}`;
    const cachedPlayers = sportsDbCache.get(cacheKey);
    if (cachedPlayers) return cachedPlayers === 'not_found' ? null : cachedPlayers;

    const url = `https://www.thesportsdb.com/api/v2/json/list/players/${teamId}`;
    const config = { headers: TSDB_HEADERS };

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }
        const players = response?.data?.player;
        if (Array.isArray(players)) {
            console.log(`TheSportsDB (V2): ${players.length} játékos lekérve (${teamId}).`);
            const relevantPlayers = players.map(p => ({ idPlayer: p.idPlayer, strPlayer: p.strPlayer, strPosition: p.strPosition }));
            sportsDbCache.set(cacheKey, relevantPlayers);
            return relevantPlayers;
        } else {
            console.warn(`TheSportsDB (V2): Nem található játékoslista (${teamId}).`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) { console.error(`TheSportsDB Hiba (V2 getPlayerList for ${teamId}): ${error.message}`); sportsDbCache.set(cacheKey, 'not_found'); return null; }
}

/**
 * Lekéri egy csapat legutóbbi 5 meccsét TheSportsDB ID alapján (cache-elve).
 */
async function getSportsDbRecentMatches(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_recent_${teamId}`;
    const cachedMatches = sportsDbCache.get(cacheKey);
    if (cachedMatches) return cachedMatches === 'not_found' ? null : cachedMatches;

    const url = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${teamId}`;
    const config = { headers: TSDB_HEADERS };

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }
        const matches = response?.data?.results;
        if (Array.isArray(matches)) {
            console.log(`TheSportsDB (V2): ${matches.length} meccs lekérve (${teamId}).`);
            const relevantMatches = matches.map(m => ({ idEvent: m.idEvent, strEvent: m.strEvent, dateEvent: m.dateEvent, strTime: m.strTime, intHomeScore: m.intHomeScore, intAwayScore: m.intAwayScore }))
                .sort((a,b) => new Date(b.dateEvent + 'T' + b.strTime) - new Date(a.dateEvent + 'T' + a.strTime));
            sportsDbCache.set(cacheKey, relevantMatches);
            return relevantMatches;
        } else {
            console.warn(`TheSportsDB (V2): Nem található meccslista (${teamId}).`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) { console.error(`TheSportsDB Hiba (V2 getRecentMatches for ${teamId}): ${error.message}`); sportsDbCache.set(cacheKey, 'not_found'); return null; }
}

/**
 * ÚJ FUNKCIÓ: Lekéri a kezdőcsapatokat a TheSportsDB Match ID alapján.
 */
async function getSportsDbLineups(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_lineups_${matchId}`;
    const cachedLineups = sportsDbCache.get(cacheKey);
    if (cachedLineups) return cachedLineups === 'not_found' ? null : cachedLineups;

    // Végpont: /lookup/event_lineup/{idEvent}
    const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_lineup/${matchId}`;
    const config = { headers: TSDB_HEADERS };

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const lineups = response?.data?.lineup; // Válasz kulcs: 'lineup'
        if (Array.isArray(lineups)) {
            console.log(`TheSportsDB (V2): Kezdőcsapatok lekérve a ${matchId} meccshez. (Ezek a legfrissebb adatok!)`);
            // Itt valószínűleg szükség van a feldolgozásra, hogy kinyerjük a kezdőket (StartingXI) és a sérülteket/cserepadot
            // Ezt most egyszerűen adjuk vissza, de a PROMPT-ban kérjük az AI-t, hogy értelmezze.
            sportsDbCache.set(cacheKey, lineups);
            return lineups;
        } else {
            console.warn(`TheSportsDB (V2): Nem található felállás (${matchId}). Lehetséges, hogy még túl korai.`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getLineups for ${matchId}): ${error.message}`);
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * ÚJ FUNKCIÓ: Lekéri az esemény statisztikákat a TheSportsDB Match ID alapján.
 */
async function getSportsDbMatchStats(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_stats_${matchId}`;
    const cachedStats = sportsDbCache.get(cacheKey);
    if (cachedStats) return cachedStats === 'not_found' ? null : cachedStats;

    // Végpont: /lookup/event_stats/{idEvent}
    const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_stats/${matchId}`;
    const config = { headers: TSDB_HEADERS };

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const stats = response?.data?.eventstats; // Válasz kulcs: 'eventstats'
        if (Array.isArray(stats)) {
            console.log(`TheSportsDB (V2): Statisztikák lekérve a ${matchId} meccshez.`);
            sportsDbCache.set(cacheKey, stats);
            return stats;
        } else {
            console.warn(`TheSportsDB (V2): Nem található statisztika (${matchId}).`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getMatchStats for ${matchId}): ${error.message}`);
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}


// --- Strukturált Időjárás ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) { /* ... kód változatlan ... */ return null; }


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v37_full_tsdb_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzió növelve
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) { cached.oddsData = oddsResult; }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        // --- 1. LÉPÉS: TheSportsDB Adatok Lekérése (MAXIMÁLIS) ---
        console.log(`TheSportsDB adatok lekérése indul: ${homeTeamName} vs ${awayTeamName}`);
        const [homeTeamId, awayTeamId] = await Promise.all([ getSportsDbTeamId(homeTeamName), getSportsDbTeamId(awayTeamName) ]);
        const matchId = await getSportsDbMatchId(leagueName, homeTeamId, awayTeamId); // Match ID megszerzése (ehhez kell a liga/csapat ID)

        const [homePlayers, awayPlayers, homeMatches, awayMatches, lineups, matchStats] = await Promise.all([
            homeTeamId ? getSportsDbPlayerList(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbPlayerList(awayTeamId) : Promise.resolve(null),
            homeTeamId ? getSportsDbRecentMatches(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbRecentMatches(awayTeamId) : Promise.resolve(null),
            matchId ? getSportsDbLineups(matchId) : Promise.resolve(null), // Kezdőcsapat/Felállás
            matchId ? getSportsDbMatchStats(matchId) : Promise.resolve(null), // Meccs statisztikák
        ]);

        const sportsDbData = {
             homeTeamId, awayTeamId, matchId,
             homePlayers: homePlayers || [], awayPlayers: awayPlayers || [],
             homeMatches: homeMatches || [], awayMatches: awayMatches || [],
             lineups: lineups,
             matchStats: matchStats
        };
        console.log(`TheSportsDB adatok lekérve: H_ID=${homeTeamId || 'N/A'}, A_ID=${awayTeamId || 'N/A'}, MatchID=${matchId || 'N/A'}, Lineups: ${lineups ? lineups.length : 0} db`);

        // --- 2. LÉPÉS: Gemini AI Hívás (Minden adat bemenetként) ---
        const homePlayerNames = sportsDbData.homePlayers.map(p => p.strPlayer).slice(0, 10).join(', ');
        const awayPlayerNames = sportsDbData.awayPlayers.map(p => p.strPlayer).slice(0, 10).join(', ');
        const homeMatchDates = sportsDbData.homeMatches.map(m => `${m.dateEvent} ${m.intHomeScore}-${m.intAwayScore}`).join('; ');
        const awayMatchDates = sportsDbData.awayMatches.map(m => `${m.dateEvent} ${m.intAwayScore}-${m.intHomeScore}`).join('; '); // Itt fordítva van a score

        const PROMPT_V37 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. **CRITICAL: You MUST use the latest factual data provided below (e.g., Lineups, Recent Matches) over your general knowledge.**

AVAILABLE FACTUAL DATA (From TheSportsDB - Use this as primary source):
- Match ID: ${sportsDbData.matchId || 'N/A'}
- Home Team ID: ${sportsDbData.homeTeamId || 'N/A'}
- Away Team ID: ${sportsDbData.awayTeamId || 'N/A'}
- Home Players (Sample): ${homePlayerNames || 'N/A'}
- Away Players (Sample): ${awayPlayerNames || 'N/A'}
- Home Recent Matches (Date Score): ${homeMatchDates || 'N/A'}
- Away Recent Matches (Date Score): ${awayMatchDates || 'N/A'}
- Lineups (JSON): ${JSON.stringify(sportsDbData.lineups || 'N/A').substring(0, 500)}...
- Match Stats (JSON): ${JSON.stringify(sportsDbData.matchStats || 'N/A').substring(0, 500)}...

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data): 1. Basic Stats: gp, gf, ga. 2. H2H: Last 5 structured + summary. 3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact. (CRITICAL: Use Lineups/Player List to verify current status). 4. Recent Form: W-D-L strings (Use recent match results for high accuracy). 5. Key Players: name, role, recent key stat. 6. Contextual Factors: Stadium Location, Match Tension, Pitch Condition, Referee. --- SPECIFIC DATA BY SPORT --- IF soccer: 7. Tactics: Style + formation. (Use Lineup data to infer formation if possible). 8. Tactical Patterns: { home: [], away: [] }. 9. Key Matchups: { }. IF hockey: 7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. IF basketball: 7. Advanced Styles: Shot Distribution { home, away }, Defensive Style { home, away }. OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately. STRUCTURE: { "stats":{...}, "h2h_summary":"...", "h2h_structured":[...], "team_news":{...}, "absentees":{...}, "absentee_impact_analysis":"...", "form":{...}, "key_players":{...}, "contextual_factors":{...}, "tactics":{...}, "tactical_patterns":{...}, "key_matchups":{...}, "advanced_stats_team":{...}, "advanced_stats_goalie":{...}, "shot_distribution":{...}, "defensive_style":{...} }`;

        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V37),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);
        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; }
        catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}`); }
        if (!geminiData) {
            console.warn("Gemini API hívás sikertelen. Alapértelmezett adatok.");
            geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home:{}, away:{} }, tactical_patterns:{ home:[], away:[] }, key_matchups:{}, advanced_stats_team:{ home:{}, away:{} }, advanced_stats_goalie:{ home_goalie:{}, away_goalie:{} }, shot_distribution:{}, defensive_style:{} };
        }

        // --- 3. LÉPÉS: Strukturált időjárás lekérése ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);

        // --- 4. LÉPÉS: Adatok Összefésülése és Visszaadása ---
        const finalData = {};
        const parseStat = (val, d = null) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0)) ? val : d;
        const inferGp = (formString) => { if (!formString || typeof formString !== 'string' || formString === "N/A") return 1; const matches = formString.match(/[WDL]/g); return matches ? matches.length : 1; };
        let defaultGpHome = inferGp(geminiData?.form?.home_overall); let defaultGpAway = inferGp(geminiData?.form?.away_overall);
        let homeGp = parseStat(geminiData?.stats?.home?.gp, null); let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null || homeGp <= 0) homeGp = Math.max(1, defaultGpHome); if (awayGp === null || awayGp <= 0) awayGp = Math.max(1, defaultGpAway);
        homeGp = (typeof homeGp === 'number' && homeGp > 0) ? homeGp : 1; awayGp = (typeof awayGp === 'number' && awayGp > 0) ? awayGp : 1;
        finalData.stats = { home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf), ga: parseStat(geminiData?.stats?.home?.ga) }, away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf), ga: parseStat(geminiData?.stats?.away?.ga) } };
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.key_players = { home: (Array.isArray(geminiData?.key_players?.home) ? geminiData.key_players.home : []).map(p => ({ name: p?.name || '?', role: p?.role || '?', stats: p?.stat || 'N/A' })), away: (Array.isArray(geminiData?.key_players?.away) ? geminiData.key_players.away : []).map(p => ({ name: p?.name || '?', role: p?.role || '?', stats: p?.stat || 'N/A' })) };
        finalData.contextual_factors = geminiData?.contextual_factors || { stadium_location: "N/A", match_tension_index: "N/A", pitch_condition: "N/A", referee: { name: "N/A", style: "N/A" } };
        finalData.contextual_factors.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };
        finalData.contextual_factors.structured_weather = structuredWeather;
        finalData.referee = finalData.contextual_factors.referee;
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } };
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] };
        finalData.key_matchups = geminiData?.key_matchups || {};
        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} };
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} };
        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" };
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" };
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } };
        finalData.league_averages = geminiData?.league_averages || {};
        finalData.sportsDbData = sportsDbData;

        const richContextParts = [
             finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
             finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
             (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news.home||'-'}, V:${finalData.team_news.away||'-'}`,
             (finalData.absentees.home.length > 0 || finalData.absentees.away.length > 0) && `- Hiányzók: H:${finalData.absentees.home.map(p=>p.name).join(', ')||'-'}, V:${finalData.absentees.away.map(p=>p.name).join(', ')||'-'}`,
             finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") && `- Forma: H:${finalData.form.home_overall}, V:${finalData.form.away_overall}`,
             (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") && `- Taktika: H:${finalData.tactics.home.style||'?'}(${finalData.tactics.home.formation||'?'}), V:${finalData.tactics.away.style||'?'}(${finalData.tactics.away.formation||'?'})`,
             structuredWeather ? `- Időjárás: ${structuredWeather.precipitation_mm}mm csap, ${structuredWeather.wind_speed_kmh}km/h szél.` : `- Időjárás: N/A`,
             finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData };

        // KRITIKUS VALIDÁLÁS
        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' || typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen statisztikák. HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + TSDB(ID,Pl,M) + Időjárás), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) {
        // console.log("Odds API kulcs hiányzik, szorzó lekérés kihagyva.");
        return null;
    }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v7_${key}`; // Verzió növelve, ha változik a logika
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        // console.log(`Odds cache találat (${cacheKey})`);
        return { ...cached, fromCache: true };
    }
    // console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`);
    const live = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (live?.current?.length > 0) {
        oddsCache.set(cacheKey, live);
        return { ...live, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
    return null;
}
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.)\s+/i, '').trim());
    variations.add(lowerName.split(' ')[0]);
    return Array.from(variations).filter(name => name && name.length > 2);
}
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey) {
        console.warn(`Odds API: Hiányzó kulcs/sportkulcs (${leagueName || sport})`);
        return null;
    }
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&oddsFormat=decimal`;
    try {
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.warn(`Odds API (${oddsApiKey}): Nincs adat.`);
            if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Odds API: Próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        const oddsData = response.data;
        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.60;
        console.log(`Odds API (${oddsApiKey}): Keresés ${homeTeam} vs ${awayTeam}... ${oddsData.length} meccs az API-ban.`);
        for (const match of oddsData) {
            if (!match?.home_team || !match?.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            if (!homeMatchResult?.bestMatch || !awayMatchResult?.bestMatch) continue;
            const homeSim = homeMatchResult.bestMatch.rating;
            const awaySim = awayMatchResult.bestMatch.rating;
            const combinedSim = (homeSim * 0.5 + awaySim * 0.5);
            if (combinedSim > highestCombinedRating) { highestCombinedRating = combinedSim; bestMatch = match; }
        }
        if (!bestMatch) {
            console.warn(`Odds API (${oddsApiKey}): Nincs meccs ${homeTeam} vs ${awayTeam}.`);
             if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Odds API: Próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        console.log(`Odds API (${oddsApiKey}): Találat ${bestMatch.home_team} vs ${bestMatch.away_team} (${(highestCombinedRating*100).toFixed(1)}%).`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) { console.warn(`Odds API: Nincs Pinnacle piac: ${bestMatch.home_team}`); return null; }
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const h2h = h2hMarket?.outcomes;
        if (h2h && Array.isArray(h2h)) {
            h2h.forEach(o => {
                if (o?.price && o.price > 1) {
                    let name = o.name;
                    if (name.toLowerCase() === bestMatch.home_team.toLowerCase()) name = 'Hazai győzelem';
                    else if (name.toLowerCase() === bestMatch.away_team.toLowerCase()) name = 'Vendég győzelem';
                    else if (name.toLowerCase() === 'draw') name = 'Döntetlen';
                    else name = o.name; // Eredeti név, ha nem standard
                    const priceNum = parseFloat(o.price);
                    if (!isNaN(priceNum)) currentOdds.push({ name: name, price: priceNum });
                }
            });
        } else { console.warn(`Odds API: Nincs H2H: ${bestMatch.home_team}`); }
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totals = totalsMarket?.outcomes;
        if (totals && Array.isArray(totals)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Over'); // Típusellenőrzés
            const under = totals.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Under'); // Típusellenőrzés
            if (over?.price && over.price > 1) { const priceNum = parseFloat(over.price); if (!isNaN(priceNum)) currentOdds.push({ name: `Over ${mainLine}`, price: priceNum }); }
            if (under?.price && under.price > 1) { const priceNum = parseFloat(under.price); if (!isNaN(priceNum)) currentOdds.push({ name: `Under ${mainLine}`, price: priceNum }); }
        } else { console.warn(`Odds API: Nincs Totals: ${bestMatch.home_team}`); }
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) { console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}): ${e.message}`, e.stack); return null; }
}
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number' && !isNaN(p)))];
    if (points.length === 0) return defaultLine;
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        if (over?.price && typeof over.price === 'number' && under?.price && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price);
            if (diff < closestPair.diff) closestPair = { diff, line: point };
        }
    }
    if (closestPair.diff < 0.5) return closestPair.line;
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return points[0];
}


// --- ESPN MECCSLEKÉRDEZÉS --- //
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig (${sport}).`); return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) { console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`); continue; }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push( makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => {
                        const competition = event.competitions?.[0]; if (!competition) return null;
                        const home = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                        const away = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        const homeName = home ? String(home.shortDisplayName || home.displayName || home.name || '').trim() : null;
                        const awayName = away ? String(away.shortDisplayName || away.displayName || away.name || '').trim() : null;
                        const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;
                        if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                             return { id: String(event.id), home: homeName, away: awayName, utcKickoff: event.date, league: safeLeagueName };
                        } else {
                            // console.warn(`ESPN: Kihagyva egy hiányos/érvénytelen esemény: ID=${event.id}, Date=${event.date}`);
                            return null;
                        }
                    }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400) console.warn(`ESPN Hiba (400): Rossz slug '${slug}' (${leagueName})?`);
                else console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`);
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) uniqueFixturesMap.set(f.id, f); });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve.`);
        return finalFixtures;
    } catch (e) { console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack); return []; }
}