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
* VÁLTOZÁS: _callGemini funkció robusztusabb hibakezeléssel és logolással
* az "Unexpected end of JSON input" hiba okának felderítésére.
* TheSportsDB V2 hívás a helyes végponttal és headerrel.
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

// --- GEMINI API FUNKCIÓ (ROBUSZTUSABB HIBAKEZELÉSSEL) --- //
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }

    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself. Ensure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
        },
        // Safety settings (opcionális, de segíthet a blokkolás elkerülésében, ha az okozza a hibát)
        // safetySettings: [
        //     { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        //     { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        //     { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        //     { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        // ]
    };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000, // 2 perc timeout
            validateStatus: () => true // Minden státuszkódot elfogadunk, hogy a hibát itt kezelhessük
        });

        // --- RÉSZLETES VÁLASZ LOGOLÁS ---
        console.log(`Gemini API válasz státusz: ${response.status}`);
        // Logoljuk a teljes választ, ha nem 200 OK
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2)); // Formázva írjuk ki a hibát
            console.error('--- END RAW GEMINI ERROR RESPONSE ---');
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        // --- VÁLASZ LOGOLÁS VÉGE ---

        // Válasz szövegének kinyerése
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        // --- RÉSZLETES SZÖVEG LOGOLÁS ---
        console.log('--- RAW GEMINI RESPONSE TEXT ---');
        if (responseText) {
            console.log(`Kapott karakterek száma: ${responseText.length}`);
            console.log(responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : '')); // Csak az elejét logoljuk, ha hosszú
        } else {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            const safetyRatings = response.data?.candidates?.[0]?.safetyRatings;
            let blockReason = safetyRatings?.find(r => r.blocked)?.category || (finishReason === 'SAFETY' ? 'Safety' : 'N/A');
            console.warn(`Gemini nem adott vissza szöveges tartalmat! FinishReason: ${finishReason}. BlockReason: ${blockReason}. Teljes válasz:`, JSON.stringify(response.data));
            // Ha nincs szöveg, dobjunk hibát, ahelyett, hogy üres stringgel próbálnánk parse-olni
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}${blockReason !== 'N/A' ? ` (${blockReason})` : ''}`);
        }
        console.log('--- END RAW GEMINI RESPONSE TEXT ---');
        // --- SZÖVEG LOGOLÁS VÉGE ---

        // JSON validálás és tisztítás (óvatosabban)
        let potentialJson = responseText.trim();
        // Egyszerűsített tisztítás: csak a ```json ... ``` eltávolítása
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            console.log("Tisztítás: ```json``` körítés eltávolítva.");
            potentialJson = jsonMatch[1].trim();
        }

        // Biztosítjuk, hogy {}-val kezdődjön és végződjön, ha tartalmazza őket
        const firstBrace = potentialJson.indexOf('{');
        const lastBrace = potentialJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            potentialJson = potentialJson.substring(firstBrace, lastBrace + 1);
        } else if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) {
             // Ha nem tűnik JSON-nak, ne is próbáljuk parse-olni
             console.error("A kapott válasz tisztítás után sem tűnik JSON objektumnak:", potentialJson.substring(0, 500));
             throw new Error("A Gemini válasza nem volt felismerhető JSON formátumú.");
        }


        // Végső JSON parse próba
        try {
            JSON.parse(potentialJson); // Csak ellenőrizzük, hogy valid-e
            console.log("Gemini API válasz sikeresen validálva JSON-ként.");
            return potentialJson; // Visszaadjuk a (potenciálisan tisztított) valid JSON stringet
        } catch (parseError) {
            console.error("A Gemini válasza a tisztítási kísérlet után sem volt valid JSON:", potentialJson.substring(0, 500), parseError);
            throw new Error(`A Gemini válasza nem volt érvényes JSON: ${parseError.message}`);
        }

    } catch (e) {
        // Átfogóbb hibakezelés az axios vagy egyéb hibákra
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        // Továbbdobjuk a hibát, hogy a hívó (getAndParse) elkapja
        throw e;
    }
}


// --- THESPORTSDB FUNKCIÓK ---
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    const cacheKey = `tsdb_teamid_v2h_path_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    const url = `https://www.thesportsdb.com/api/v2/json/search/team/${encodeURIComponent(teamName)}`;
    const config = { headers: { 'X-API-KEY': THESPORTSDB_API_KEY } };
    // console.log(`TheSportsDB V2 Path Search: URL=${url} (Kulcs X-API-KEY headerben)`); // Csak debug

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
        console.error(`TheSportsDB Hiba (V2/Path getTeamId for ${teamName}): ${error.message}`);
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}
async function getSportsDbPlayerList(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_players_${teamId}`;
    const cachedPlayers = sportsDbCache.get(cacheKey);
    if (cachedPlayers) return cachedPlayers === 'not_found' ? null : cachedPlayers;
    const url = `https://www.thesportsdb.com/api/v2/json/list/players/${teamId}`;
    const config = { headers: { 'X-API-KEY': THESPORTSDB_API_KEY } };
    // console.log(`TheSportsDB V2 Player List: URL=${url}`); // Csak debug
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
async function getSportsDbRecentMatches(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_recent_${teamId}`;
    const cachedMatches = sportsDbCache.get(cacheKey);
    if (cachedMatches) return cachedMatches === 'not_found' ? null : cachedMatches;
    const url = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${teamId}`;
    const config = { headers: { 'X-API-KEY': THESPORTSDB_API_KEY } };
    // console.log(`TheSportsDB V2 Recent Matches: URL=${url}`); // Csak debug
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


// --- Strukturált Időjárás ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) { /* ... kód változatlan ... */ return null; }

// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v36_tsdb_players_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) { cached.oddsData = oddsResult; }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        // --- 1. LÉPÉS: TheSportsDB Adatok Lekérése ---
        console.log(`TheSportsDB adatok lekérése indul: ${homeTeamName} vs ${awayTeamName}`);
        const [homeTeamId, awayTeamId] = await Promise.all([ getSportsDbTeamId(homeTeamName), getSportsDbTeamId(awayTeamName) ]);
        const [homePlayers, awayPlayers, homeMatches, awayMatches] = await Promise.all([
            homeTeamId ? getSportsDbPlayerList(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbPlayerList(awayTeamId) : Promise.resolve(null),
            homeTeamId ? getSportsDbRecentMatches(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbRecentMatches(awayTeamId) : Promise.resolve(null)
        ]);
        const sportsDbData = { homeTeamId, awayTeamId, homePlayers: homePlayers || [], awayPlayers: awayPlayers || [], homeMatches: homeMatches || [], awayMatches: awayMatches || [] };
        console.log(`TheSportsDB adatok lekérve: H_ID=${homeTeamId || 'N/A'}, A_ID=${awayTeamId || 'N/A'}, H_Pl:${sportsDbData.homePlayers.length}, A_Pl:${sportsDbData.awayPlayers.length}, H_M:${sportsDbData.homeMatches.length}, A_M:${sportsDbData.awayMatches.length}`);

        // --- 2. LÉPÉS: Gemini AI Hívás ---
        const homePlayerNames = sportsDbData.homePlayers.map(p => p.strPlayer).slice(0, 15).join(', ');
        const awayPlayerNames = sportsDbData.awayPlayers.map(p => p.strPlayer).slice(0, 15).join(', ');
        const homeMatchDates = sportsDbData.homeMatches.map(m => m.dateEvent).join(', ');
        const awayMatchDates = sportsDbData.awayMatches.map(m => m.dateEvent).join(', ');
        const PROMPT_V36 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). ... AVAILABLE FACTUAL DATA (From TheSportsDB): - Home Team ID: ${sportsDbData.homeTeamId || 'N/A'} - Away Team ID: ${sportsDbData.awayTeamId || 'N/A'} - Home Players (Sample): ${homePlayerNames || 'N/A'} - Away Players (Sample): ${awayPlayerNames || 'N/A'} - Home Recent Matches (Dates): ${homeMatchDates || 'N/A'} - Away Recent Matches (Dates): ${awayMatchDates || 'N/A'} ... REQUESTED ANALYSIS ... STRUCTURE: { ... }`; // Rövidítve

        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V36),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);
        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; }
        catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}`); }
        if (!geminiData) { /* ... üres struktúra ... */ }

        // --- 3. LÉPÉS: Strukturált időjárás lekérése ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);

        // --- 4. LÉPÉS: Adatok Összefésülése és Visszaadása ---
        const finalData = {};
        // ... (Adatok normalizálása, GP kezelés, mint korábban) ...
        const parseStat=(v,d=null)=>(v===null||(typeof v==='number'&&!isNaN(v)&&v>=0))?v:d; const inferGp=(f)=>{if(!f||typeof f!=='string'||f==="N/A")return 1;const m=f.match(/[WDL]/g);return m?m.length:1};
        let dH=inferGp(geminiData?.form?.home_overall),dA=inferGp(geminiData?.form?.away_overall);let hG=parseStat(geminiData?.stats?.home?.gp,null),aG=parseStat(geminiData?.stats?.away?.gp,null);
        if(hG===null||hG<=0)hG=Math.max(1,dH);if(aG===null||aG<=0)aG=Math.max(1,dA);hG=(typeof hG==='number'&&hG>0)?hG:1;aG=(typeof aG==='number'&&aG>0)?aG:1;
        finalData.stats={home:{gp:hG,gf:parseStat(geminiData?.stats?.home?.gf),ga:parseStat(geminiData?.stats?.home?.ga)},away:{gp:aG,gf:parseStat(geminiData?.stats?.away?.gf),ga:parseStat(geminiData?.stats?.away?.ga)}};
        // ... (Többi adat másolása geminiData-ból finalData-ba, változatlanul) ...
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A"; /* ... */ finalData.sportsDbData = sportsDbData;
        finalData.contextual_factors = geminiData?.contextual_factors || {}; finalData.contextual_factors.structured_weather = structuredWeather;
        finalData.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };


        const richContextParts = [ /* ... Kontextus string összeállítása ... */ ];
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages || {}, richContext, advancedData: finalData.advanced_stats || { home: {}, away: {} }, form: finalData.form || {}, rawData: finalData };

        // KRITIKUS VALIDÁLÁS
        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' || typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            throw new Error(`Kritikus statisztikák érvénytelenek (${homeTeamName} vs ${awayTeamName}).`);
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
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) { /* ... kód változatlan ... */ return null; }
function generateTeamNameVariations(teamName) { /* ... kód változatlan ... */ return []; }
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) { /* ... kód változatlan ... */ return null; }
export function findMainTotalsLine(oddsData) { /* ... kód változatlan ... */ return 2.5; }


// --- ESPN MECCSLEKÉRDEZÉS --- //
export async function _getFixturesFromEspn(sport, days) { /* ... kód változatlan ... */ return []; }