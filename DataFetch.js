import axios from 'axios';
import NodeCache from 'node-cache';
// JAVÍTÁS: A google-auth-library importálása a hitelesítéshez
import { GoogleAuth } from 'google-auth-library'; 
import { SPORT_CONFIG, PROJECT_ID, LOCATION, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });

// JAVÍTÁS: Google Auth kliens inicializálása
const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Átállás Vertex AI végpontra google-auth-library
* használatával a Google Search aktiválásához.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config)); currentConfig.timeout = currentConfig.timeout || 10000;
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300);
            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') { response = await axios.post(url, currentConfig.data, currentConfig); }
            else { response = await axios.get(url, currentConfig); }
            return response;
        } catch (error) {
            attempts++; let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 100)}... - `;
            if (axios.isAxiosError(error)) {
                if (error.response) { errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`; if ([401, 403, 429].includes(error.response.status)) { console.error(errorMessage); return null; } }
                else if (error.request) { errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`; }
                else { errorMessage += `Beállítási hiba: ${error.message}`; console.error(errorMessage); return null; }
            } else { errorMessage += `Általános hiba: ${error.message}`; console.error(errorMessage); return null; }
            console.warn(errorMessage);
            if (attempts <= retries) { await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 100)}...`); return null;
}


// --- SPORTMONKS API FUNKCIÓK (VÁLTOZATLAN) ---
// (Marad a robusztus, többlépcsős kereső, ahogy kérted)
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim(); if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`; const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) { sportmonksIdCache.set(cacheKey, 'not_found'); return null; }
    const TEAM_NAME_MAP = { 'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade', 'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen', 'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma' };
    let teamId = null; let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName]; const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim(); if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName); if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName);
    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt]; try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            console.log(`SportMonks ID keresés (${attempt + 1}. próba): "${searchName}" (eredeti: "${teamName}")`);
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                const results = response.data.data; let bestMatch = results[0];
                if (results.length > 1) { const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName); if (perfectMatch) { bestMatch = perfectMatch; } else { const names = results.map(team => team.name); const sim = findBestMatch(originalLowerName, names); const simThreshold = (attempt === 0) ? 0.7 : 0.6; if (sim.bestMatch.rating > simThreshold) { bestMatch = results[sim.bestMatchIndex]; /* ...log... */ } else { const containingMatch = results.find(team => team.name.toLowerCase().includes(originalLowerName)); if(containingMatch) bestMatch = containingMatch; /* ...log... */ } } }
                teamId = bestMatch.id; console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`); break;
            } else if (response.status !== 404) { const rd = JSON.stringify(response.data)?.substring(0, 300); if (rd.includes('plan') || rd.includes('subscription') || rd.includes('does not have access')) { console.warn(`SportMonks figyelmeztetés (${response.status}) Keresés: "${searchName}". Lehetséges előfizetési korlát.`); teamId = null; break; } else { console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}"`); } break; }
        } catch (error) { console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`); if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break; }
        if (attempt < namesToTry.length - 1) { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found'); if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`); return teamId;
}

async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    const [homeTeamId, awayTeamId] = await Promise.all([findSportMonksTeamId(homeTeamName), findSportMonksTeamId(awayTeamName)]);
    if (!homeTeamId || !awayTeamId) return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    let fixtureData = null; const today = new Date();
    for (let i = 0; i < 3 && !fixtureData; i++) {
        const searchDate = new Date(today); searchDate.setDate(today.getDate() - i); const dateString = searchDate.toISOString().split('T')[0];
        try {
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${i + 1}. nap: ${dateString}): ID ${homeTeamId} vs ${awayTeamId}`);
            const response = await makeRequest(url, { timeout: 7000 });
            if (response?.data?.data?.length > 0) { const foundFixture = response.data.data.find(f=>(String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))); if (foundFixture) { fixtureData = foundFixture; console.log(`SportMonks meccs találat (${dateString})`); break; } }
        } catch (e) { /* makeRequest kezeli */ }
    }
    if (!fixtureData) { /* console.log(`SportMonks: Nem található meccs ID ${homeTeamId} vs ${awayTeamId} az elmúlt 3 napban.`); */ return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; }
    try {
        const extracted = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; const stats = fixtureData.statistics || []; const homeS = stats.find(s => String(s.participant_id) === String(homeTeamId)); const awayS = stats.find(s => String(s.participant_id) === String(awayTeamId));
        if (homeS) extracted.advanced_stats.home.xg = homeS.xg ?? null; if (awayS) extracted.advanced_stats.away.xg = awayS.xg ?? null;
        if(extracted.advanced_stats.home.xg !== null || extracted.advanced_stats.away.xg !== null) console.log(`SportMonks xG adatok sikeresen feldolgozva.`); else console.log(`SportMonks meccs megtalálva, de xG adat nem volt elérhető.`);
        return extracted;
    } catch (e) { console.error(`Hiba SportMonks adatok feldolgozásakor: ${e.message}`); return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; }
}


// --- PLAYER API (API-SPORTS) FUNKCIÓK (VÁLTOZATLAN) ---
// (Marad a robusztus, többlépcsős kereső, ami a korábbi szezonokat nézi)
async function _fetchPlayerData(playerNames) {
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<') || PLAYER_API_KEY.length < 20) return {}; if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) return {};
    const playerData = {}; const LATEST_ALLOWED_YEAR = 2023; const yearsToTry = [LATEST_ALLOWED_YEAR, LATEST_ALLOWED_YEAR - 1];
    console.log(`Player API: ${playerNames.length} játékos keresése indul (${yearsToTry.join(', ')} szezonokra)...`);
    let requestCount = 0; const RATE_LIMIT = 8;
    for (const playerName of playerNames) {
         const normalizedName = playerName.trim(); if (!normalizedName) { playerData[playerName] = null; continue; }
         let foundStats = null; let foundPlayerInfo = null; const namesToSearch = [normalizedName]; if (normalizedName.includes(' ')) namesToSearch.push(normalizedName.split(' ').pop());
         searchLoop: for (const year of yearsToTry) { for (const searchName of namesToSearch) {
             if (requestCount >= RATE_LIMIT) { console.warn(`Player API: Rate limit (${RATE_LIMIT}/perc) elérve, várakozás...`); await new Promise(resolve => setTimeout(resolve, 60000)); requestCount = 0; }
             try {
                 const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(searchName)}&season=${year}`; requestCount++;
                 const response = await axios.get(url, { timeout: 8000, headers: { 'x-rapidapi-host': 'v3.football.api-sports.io', 'x-rapidapi-key': PLAYER_API_KEY }, validateStatus: () => true });
                 const remaining = response.headers['x-ratelimit-requests-remaining']; if (remaining === '0') { console.warn("Player API: Rate limit elérve!"); break searchLoop; } if (remaining && parseInt(remaining, 10) < 5) console.warn(`Player API: Kevés kérés maradt: ${remaining}`);
                 if (response.status === 200 && response.data?.response?.length > 0) { const players = response.data.response; let bestPlayerMatch = players[0]; if (players.length > 1) { const names = players.map(p => p.player.name); const sim = findBestMatch(normalizedName, names); if (sim.bestMatch.rating > 0.85) bestPlayerMatch = players[sim.bestMatchIndex]; } const seasonStats = bestPlayerMatch.statistics?.find(s => s.league?.season === year) || bestPlayerMatch.statistics?.[0]; if (seasonStats) { foundStats = seasonStats; foundPlayerInfo = bestPlayerMatch.player; break searchLoop; } else if (!foundPlayerInfo) { foundPlayerInfo = bestPlayerMatch.player; } }
                 else if (response.status !== 404) { const errorDetails = JSON.stringify(response.data)?.substring(0, 150); if (!errorDetails.includes('do not have access to this season')) { console.error(`Player API hiba (${searchName}, ${year}): ${response.status} - ${errorDetails}`); } if ([401, 403, 429].includes(response.status)) break searchLoop; continue; }
             } catch (error) { console.error(`Hiba Player API híváskor (${searchName}, ${year}): ${error.message}`); break searchLoop; }
             await new Promise(resolve => setTimeout(resolve, 100));
         } }
         if (foundStats) { playerData[playerName] = { recent_goals_or_points: foundStats.goals?.total ?? 0, key_passes_or_assists_avg: foundStats.passes?.key ?? foundStats.goals?.assists ?? 0, tackles_or_rebounds_avg: foundStats.tackles?.total ?? 0 }; }
         else if (foundPlayerInfo) { playerData[playerName] = {}; } else { playerData[playerName] = null; }
         await new Promise(resolve => setTimeout(resolve, 150));
    }
    const foundCount = Object.values(playerData).filter(data => data && Object.keys(data).length > 0).length;
    console.log(`Player API adatok feldolgozva ${foundCount}/${playerNames.length} játékosra.`);
    Object.keys(playerData).forEach(key => { if (playerData[key] === null) playerData[key] = {}; });
    return playerData;
}


// --- GEMINI API FUNKCIÓ (VÉGLEGES JAVÍTÁS - Vertex AI) ---
/**
 * Meghívja a Vertex AI Gemini modellt Google Kereső eszközzel.
 * google-auth-library segítségével hitelesít.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string|null>} A Gemini válasza JSON stringként vagy null hiba esetén.
 */
async function _callGeminiWithSearch(prompt) {
    let authToken;
    try {
        // Hitelesítés a szolgáltatási fiókkal (google-credentials.json)
        const client = await auth.getClient();
        const credentials = await client.getAccessToken();
        authToken = credentials.token;
    } catch (e) {
        console.error("KRITIKUS HIBA: Nem sikerült Google Auth tokent szerezni.", e.message);
        console.error("Ellenőrizd, hogy a 'google-credentials.json' fájl létezik-e és a szolgáltatási fióknak van-e 'Vertex AI User' jogosultsága!");
        return null; // Hitelesítés nélkül nem tudunk továbblépni
    }

    if (!authToken) { console.error("KRITIKUS HIBA: Az Auth token üres."); return null; }
    if (!PROJECT_ID || !LOCATION || !GEMINI_MODEL_ID) { console.error("KRITIKUS HIBA: PROJECT_ID, LOCATION vagy GEMINI_MODEL_ID hiányzik a config.js-ből."); return null; }

    // JAVÍTÁS: A Végpont URL-je a Vertex AI-hoz
    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${GEMINI_MODEL_ID}:generateContent`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4, // Magasabb hőmérséklet a kereséshez
            maxOutputTokens: 8192,
        },
        // === GOOGLE SEARCH AKTIVÁLVA ===
        tools: [{ "googleSearchRetrieval": {} }]
    };

    console.log("Gemini API (Vertex AI) hívás indul Google Search használatával...");

    try {
        const response = await axios.post(url, payload, {
             headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${authToken}` // Bearer token használata
             },
             timeout: 120000, // 2 perc timeout
             validateStatus: () => true // Minden választ elfogadunk
         });

        // Hibakezelés
        if (response.status !== 200) {
             let errorMsg = `Gemini (Vertex) API HTTP hiba (${response.status}).`; let responseDetails = "";
             try { responseDetails = JSON.stringify(response.data)?.substring(0, 500); } catch { responseDetails = String(response.data)?.substring(0, 500); }
             // A Vertex AI 403-as hibája általában jogosultsági probléma
             if (response.status === 403) {
                 errorMsg = `Gemini API hiba (403 Forbidden) - Jogosultsági probléma. A szolgáltatási fióknak (${process.env.GOOGLE_APPLICATION_CREDENTIALS}) szüksége van 'Vertex AI User' szerepkörre!`;
                 console.error(errorMsg);
                 throw new Error(errorMsg); // Ez kritikus
             }
             if (response.status === 400) errorMsg += " (Bad Request - ellenőrizd a promptot vagy a modellt)";
             console.error(`${errorMsg} Részletek: ${responseDetails}`);
             return null;
        }

        // Sikeres válasz feldolgozása
        const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
             const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category;
             console.error(`Gemini (Vertex) válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`);
             if (finishReason === 'SAFETY' || blockReason) throw new Error(`Az AI válaszát biztonsági szűrők blokkolták (${blockReason || 'SAFETY'}).`);
             if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt.");
             return null;
         }

        // JSON tisztítás és validálás
        let cleanedJsonString = responseText.trim();
        const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch?.[1]) cleanedJsonString = jsonMatch[1];
        if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{'));
        if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);

        try {
            JSON.parse(cleanedJsonString);
            console.log("Gemini API (Vertex/Search) sikeresen visszaadott valid JSON-t.");
            return cleanedJsonString;
        } catch (jsonError) {
            console.error(`Gemini válasz (Vertex/Search) nem valid JSON: ${jsonError.message}`, cleanedJsonString.substring(0,500));
            return null; // JSON hiba
        }
    } catch (e) {
         console.error(`Végleges hiba a Gemini (Vertex) API hívás során: ${e.message}`);
         throw e; // Dobjuk tovább a kritikus hibát
     }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (GOOGLE SEARCH ALAPÚ) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v30_vertex_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió
    const cached = scriptCache.get(ck);
    if (cached) { console.log(`Cache találat (${ck})`); return { ...cached, fromCache: true }; }
    console.log(`Nincs cache (${ck}), friss adatok lekérése Vertex AI (Google Search) segítségével...`);

    let geminiData = null;
    let oddsResult = null;

    try {
        // Párhuzamos adatgyűjtés: Gemini+Search és Odds API
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
             _callGeminiWithSearch( // Gemini hívás
                 `CRITICAL TASK: Use Google Search to find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also search for basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. NO extra text/markdown. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`
             ),
             // Az Odds API hívás marad, mert az fontos adat
             getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
         ]);

        // Odds eredmény elmentése
        oddsResult = fetchedOddsData;

        // Gemini válasz feldolgozása (ha volt)
        if (geminiJsonString) {
             try { geminiData = JSON.parse(geminiJsonString); }
             catch (e) { console.error(`Gemini válasz (Search) JSON parse hiba: ${e.message}`); /* geminiData marad null */ }
         }
         // Ha Gemini nem válaszolt, létrehozunk egy üres struktúrát
         if (!geminiData) {
             console.warn("Gemini API hívás (Search) sikertelen vagy nem adott vissza adatot. Alapértelmezett adatok lesznek.");
             geminiData = { stats: { home:{}, away:{} }, key_players: { home: [], away: [] } };
         }

        // Player és SportMonks adatokat már nem kérjük le, mert a Gemini keresője (elvileg) pótolja a kontextust

        // --- Adatok EGYESÍTÉSE és NORMALIZÁLÁSA ---
        const finalData = {};
        const parseStat = (val, defaultVal = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0) ? val : defaultVal);
        const defaultGpHome = (geminiData?.form?.home_overall && geminiData.form.home_overall !== "N/A") ? 5 : 1;
        const defaultGpAway = (geminiData?.form?.away_overall && geminiData.form.away_overall !== "N/A") ? 5 : 1;
        let homeGp = parseStat(geminiData?.stats?.home?.gp, null); let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null) homeGp = defaultGpHome; if (awayGp === null) awayGp = defaultGpAway;

        finalData.stats = {
            home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf, null), ga: parseStat(geminiData?.stats?.home?.ga, null) },
            away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf, null), ga: parseStat(geminiData?.stats?.away?.ga, null) }
        };

        if ((!geminiData?.stats?.home?.gp && finalData.stats.home.gp > 0) || (!geminiData?.stats?.away?.gp && finalData.stats.away.gp > 0)) {
            console.warn(`Figyelmeztetés: Gemini nem adott 'gp'-t, becsült érték (${finalData.stats.home.gp}/${finalData.stats.away.gp}) használva.`);
        }

        // Többi adat normalizálása
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: (geminiData.key_players?.home || []).map(p => ({...p, stats: {}})), away: (geminiData.key_players?.away || []).map(p => ({...p, stats: {}})) }; // Player API-t nem hívtuk
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } }; // SportMonks-ot nem hívtuk
        finalData.referee = { name: 'N/A', stats: 'N/A' };
        finalData.league_averages = geminiData?.league_averages || {};

        // Gazdag kontextus string
        const richContextParts = [];
        if (finalData.h2h_summary !== "N/A") richContextParts.push(`- H2H: ${finalData.h2h_summary}`);
        if (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") richContextParts.push(`- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`);
        const homeAbs = finalData.absentees.home.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs'; const awayAbs = finalData.absentees.away.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs';
        if (homeAbs !== 'Nincs' || awayAbs !== 'Nincs') richContextParts.push(`- Hiányzók: H: ${homeAbs}, V: ${awayAbs}`);
        if (finalData.absentee_impact_analysis !== "N/A") richContextParts.push(`- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`);
        if (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") richContextParts.push(`- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`);
        if (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") richContextParts.push(`- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni a keresővel.";

        const result = {
            rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext,
            advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData
        };

        // KRITIKUS ELLENŐRZÉS
        if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
             console.error(`KRITIKUS HIBA: Az alap statisztikák (rawStats) érvénytelenek (gp=0). Elemzés nem lehetséges.`);
             throw new Error("Kritikus csapat statisztikák (rawStats) érvénytelenek.");
         }

        scriptCache.set(ck, result); // Cachelés
        console.log(`Sikeres adatgyűjtés Google Search (${ck}), cache mentve.`);
        return { ...result, fromCache: false, oddsData: oddsResult }; // Visszaadjuk az odds adatokat is

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData(Search) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        // Visszaadunk egy alapértelmezett struktúrát, hogy az AnalysisFlow NE szálljon el
        return {
             rawStats: { home: { gp: 1, gf: 0, ga: 0 }, away: { gp: 1, gf: 0, ga: 0 } }, // Minimális adatok
             leagueAverages: {}, richContext: "Hiba történt az adatok gyűjtése során.",
             advancedData: { home: { xg: null }, away: { xg: null } }, form: {}, rawData: { error: e.message },
             fromCache: false, error: `Adatgyűjtési hiba: ${e.message}`, oddsData: null
         };
    }
}


// --- ODDS API FUNKCIÓK (VÁLTOZATLANOK MARADNAK) ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { /* console.log("Nincs ODDS_API_KEY."); */ return null; }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    // 1. Nyitó szorzók (cache-ből vagy frontendtől)
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) { try { const matchData = openingOdds[key]; const currentOdds = []; const allMarkets = []; if (matchData.h2h) { allMarkets.push({ key: 'h2h', outcomes: matchData.h2h }); (matchData.h2h || []).forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (typeof name === 'string') { const ln = name.toLowerCase(); if (ln === homeTeam.toLowerCase()) name = 'Hazai győzelem'; else if (ln === awayTeam.toLowerCase()) name = 'Vendég győzelem'; else if (ln === 'draw') name = 'Döntetlen'; } currentOdds.push({ name: name, price: price }); } }); } if (matchData.totals) { allMarkets.push({ key: 'totals', outcomes: matchData.totals }); const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = matchData.totals.find(o => o.point === mainLine && o.name === 'Over'); const under = matchData.totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); } if (currentOdds.length > 0) { /* console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`); */ return { current: currentOdds, allMarkets: allMarkets, fromCache: true, sport: sport }; } } catch (e) { console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}.`); } }
    // 2. Cache
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`; const cachedOdds = oddsCache.get(cacheKey); if (cachedOdds) { /* console.log(`Élő szorzók használva (cache) a ${key} meccshez.`); */ return { ...cachedOdds, fromCache: true }; }
    // 3. API hívás
    // console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam} (${leagueName || 'általános'})`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) { oddsCache.set(cacheKey, liveOddsData); return { ...liveOddsData, fromCache: false }; }
    else { console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`); return null; }
}

async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey || !sportConfig.odds_api_sport_key) { console.error(`getOddsData: Hiányzó kulcsok/konfig ${sport}/${leagueName}-hoz.`); return null; }
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`;
    try {
        // console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`); // Csökkentett log
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data)) { if (oddsApiKey !== sportConfig.odds_api_sport_key) { /* console.warn(`Odds API (${oddsApiKey}): Nem adott vissza adatot, próbálkozás az általános (${sportConfig.odds_api_sport_key}) kulccsal...`); */ return getOddsData(homeTeam, awayTeam, sport, sportConfig, null); } console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat.`); return null; }
        const oddsData = response.data; const lowerHome = homeTeam.toLowerCase().trim(); const lowerAway = awayTeam.toLowerCase().trim(); let bestMatch = null; let highestRating = 0.65;
        for (const match of oddsData) { if (!match.home_team || !match.away_team) continue; const apiHomeLower = match.home_team.toLowerCase().trim(); const apiAwayLower = match.away_team.toLowerCase().trim(); const homeSim = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating; const awaySim = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating; const avgSim = (homeSim * 0.6 + awaySim * 0.4); if (avgSim > highestRating) { highestRating = avgSim; bestMatch = match; } }
        if (!bestMatch) { /* console.warn(`Odds API (${oddsApiKey}): Nem található meccs: ${homeTeam} vs ${awayTeam}.`); */ return null; }
        if (highestRating < 0.7 && !(bestMatch.home_team.toLowerCase().includes(lowerHome) || bestMatch.away_team.toLowerCase().includes(lowerAway))) { /* console.warn(`Odds API (${oddsApiKey}): Legjobb találat ... hasonlósága alacsony.`); */ return null; }
        // console.log(`Odds API (${oddsApiKey}): Megtalált meccs (hasonlóság: ${(highestRating * 100).toFixed(1)}%): "${bestMatch.home_team}" vs "${bestMatch.away_team}"`); // Csökkentett log
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle'); if (!bookmaker?.markets) { console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' adat: ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }
        const currentOdds = []; const allMarkets = bookmaker.markets; const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes; const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;
        if (h2h) { h2h.forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (name === bestMatch.home_team) name = 'Hazai győzelem'; else if (name === bestMatch.away_team) name = 'Vendég győzelem'; else if (name === 'Draw') name = 'Döntetlen'; currentOdds.push({ name: name, price: price }); } }); }
        if (totals) { const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = totals.find(o => o.point === mainLine && o.name === 'Over'); const under = totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); }
        if (currentOdds.length > 0) { return { current: currentOdds, allMarkets: allMarkets, sport: sport }; }
        else { console.warn(`Nem sikerült érvényes szorzókat kinyerni (${oddsApiKey}): ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }
    } catch (e) { console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`); return null; }
}

export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5; const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals'); if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) return defaultLine; let closestPair = { diff: Infinity, line: defaultLine }; const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];
    for (const point of points) { const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over'); const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under'); if (over?.price && under?.price) { const diff = Math.abs(parseFloat(over.price) - parseFloat(under.price)); if (!isNaN(diff) && diff < closestPair.diff) closestPair = { diff, line: point }; } }
    if (closestPair.diff === Infinity && points.includes(defaultLine)) return defaultLine; if (closestPair.diff !== Infinity) return closestPair.line; if(points.length > 0) return points.sort((a,b) => Math.abs(a - defaultLine) - Math.abs(b-defaultLine))[0]; return defaultLine;
}

// --- fetchOpeningOddsForAllSports (KEVÉSBÉ FONTOS) ---
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)..."); let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) { const sportConfig = SPORT_CONFIG[sport]; if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league || !sportConfig.odds_api_sport_key) continue; const allLeagueKeys = Object.keys(sportConfig.odds_api_keys_by_league).join(','); if (!allLeagueKeys) continue; const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${allLeagueKeys}`;
        try { const response = await makeRequest(url, { timeout: 20000 }); if (response?.data && Array.isArray(response.data)) { response.data.forEach(match => { if (!match?.home_team || !match?.away_team) return; const key = `${match.home_team.toLowerCase().trim().replace(/\s+/g, '')}_vs_${match.away_team.toLowerCase().trim().replace(/\s+/g, '')}`; const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle'); if (bookmaker?.markets) { const odds = {}; const h2h = bookmaker.markets.find(m => m.key === 'h2h')?.outcomes; const totals = bookmaker.markets.find(m => m.key === 'totals')?.outcomes; if (h2h) odds.h2h = h2h; if (totals) odds.totals = totals; if (Object.keys(odds).length > 0) allOdds[key] = odds; } }); } } catch (e) { /* makeRequest kezeli */ } await new Promise(resolve => setTimeout(resolve, 300));
    } console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`); return allOdds;
}


// --- _getFixturesFromEspn (VÁLTOZATLAN) ---
/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája objektumként [{id, home, away, utcKickoff, league}].
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport]; if (!sportConfig?.name || !sportConfig.espn_leagues) { console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`); return []; } const daysInt = parseInt(days, 10); if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`); return []; } const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); }); const promises = []; console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);
    for (const dateString of datesToFetch) { for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) { if (!slug) continue; const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`; promises.push( makeRequest(url, { timeout: 6000 }).then(response => { if (!response?.data?.events) return []; return response.data.events .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') .map(event => { const competition = event.competitions?.[0]; const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team; const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team; if (event.id && home?.name && away?.name && event.date) { return { id: String(event.id), home: String(home.shortDisplayName || home.displayName || home.name).trim(), away: String(away.shortDisplayName || away.displayName || away.name).trim(), utcKickoff: event.date, league: String(leagueName).trim() }; } return null; }).filter(Boolean) || []; }) ); await new Promise(resolve => setTimeout(resolve, 30)); } }
    const results = await Promise.all(promises); const uniqueFixturesMap = new Map(); results.flat().forEach(fixture => { if (fixture?.id && !uniqueFixturesMap.has(fixture.id)) uniqueFixturesMap.set(fixture.id, fixture); }); const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff)); console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`); return finalFixtures;
}