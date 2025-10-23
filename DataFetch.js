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

// JAVÍTÁS: Google Auth kliens inicializálása [cite: 1595]
const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform' // Szükséges scope a Vertex AI-hoz [cite: 1595]
});

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Átállás Vertex AI végpontra google-auth-library
* használatával a Google Search aktiválásához.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
/**
 * Általános, hibatűrő axios kérés küldő, újrapróbálkozással.
 * @param {string} url Az API végpont URL-je.
 * @param {object} config Axios konfigurációs objektum (headers, timeout, method, data, etc.).
 * @param {number} retries Újrapróbálkozások száma.
 * @returns {Promise<axios.Response|null>} A sikeres válasz vagy null hiba esetén. [cite: 1594]
 */
async function makeRequest(url, config = {}, retries = 1) { // Kevesebb retry alapból [cite: 1596]
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config)); currentConfig.timeout = currentConfig.timeout || 10000; // Alap 10 mp timeout [cite: 1596]
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300); // Csak 2xx sikeres [cite: 1596]
            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') { response = await axios.post(url, currentConfig.data, currentConfig); }
            else { response = await axios.get(url, currentConfig); }
            return response; // Sikeres válasz [cite: 1597]
        } catch (error) {
            attempts++; let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 100)}... - `;
            if (axios.isAxiosError(error)) {
                if (error.response) { errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`; if ([401, 403, 429].includes(error.response.status)) { console.error(errorMessage); return null; } } // Jogosultsági/limit hiba -> nincs retry [cite: 1598]
                else if (error.request) { errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`; } // Timeout hiba [cite: 1598]
                else { errorMessage += `Beállítási hiba: ${error.message}`; console.error(errorMessage); return null; } // Kliens oldali hiba -> nincs retry [cite: 1598]
            } else { errorMessage += `Általános hiba: ${error.message}`; console.error(errorMessage); return null; } // Nem Axios hiba -> nincs retry [cite: 1599]
            console.warn(errorMessage); // Figyelmeztetés logolása [cite: 1599]
            if (attempts <= retries) { await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); } // Növekvő várakozás [cite: 1599]
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 100)}...`); return null; // Sikertelen volt az összes próbálkozás [cite: 1599]
}


// --- SPORTMONKS API FUNKCIÓK (VÁLTOZATLAN) ---
// (Marad a robusztus, többlépcsős kereső, de a fő folyamat nem biztos, hogy használja)
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim(); if (!originalLowerName) return null; // Üres név -> null [cite: 1600]
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`; const cachedResult = sportmonksIdCache.get(cacheKey); // Cache ellenőrzés [cite: 1600]
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult; // Cache találat [cite: 1600]
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) { sportmonksIdCache.set(cacheKey, 'not_found'); return null; } // API kulcs ellenőrzés [cite: 1600]
    const TEAM_NAME_MAP = { 'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade', 'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen', 'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma' }; // Név térkép [cite: 1601]
    let teamId = null; let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName]; const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim(); if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName); if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName); // Több névvariáció próbálása [cite: 1601]
    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt]; try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            console.log(`SportMonks ID keresés (${attempt + 1}. próba): "${searchName}" (eredeti: "${teamName}")`); // Logolás [cite: 1602]
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true }); // Direkt axios hívás (404 nem hiba) [cite: 1602]
            if (response.status === 200 && response.data?.data?.length > 0) {
                const results = response.data.data; let bestMatch = results[0]; // Első találat alapból [cite: 1603]
                if (results.length > 1) { // Ha több találat, finomítás
                    const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName); // Pontos egyezés keresése [cite: 1603]
                    if (perfectMatch) { bestMatch = perfectMatch; } else { // Ha nincs pontos, hasonlóság alapján
                        const names = results.map(team => team.name); const sim = findBestMatch(originalLowerName, names); const simThreshold = (attempt === 0) ? 0.7 : 0.6; // Hasonlósági küszöb [cite: 1603]
                        if (sim.bestMatch.rating > simThreshold) { bestMatch = results[sim.bestMatchIndex]; /* ...log... */ } else { // Ha hasonlóság alacsony, de tartalmazza
                            const containingMatch = results.find(team => team.name.toLowerCase().includes(originalLowerName)); if(containingMatch) bestMatch = containingMatch; /* ...log... */
                        }
                    }
                }
                teamId = bestMatch.id; console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`); break; // Megvan, kilépés [cite: 1604]
            } else if (response.status !== 404) { // Ha nem 404, de hiba
                const rd = JSON.stringify(response.data)?.substring(0, 300); if (rd.includes('plan') || rd.includes('subscription') || rd.includes('does not have access')) { console.warn(`SportMonks figyelmeztetés (${response.status}) Keresés: "${searchName}". Lehetséges előfizetési korlát.`); teamId = null; break; } // Előfizetési hiba -> leállás [cite: 1604]
                else { console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}"`); } break; // Egyéb hiba -> leállás [cite: 1604]
            } // Ha 404, megy a következő névre
        } catch (error) { console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`); if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break; } // Csak timeout esetén próbálkozik tovább [cite: 1605]
        if (attempt < namesToTry.length - 1) { await new Promise(resolve => setTimeout(resolve, 50)); } // Kis szünet [cite: 1605]
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found'); if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`); return teamId; // Cachelés és visszatérés [cite: 1605]
}

async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    // Ezt a függvényt most nem hívjuk, de a kódja itt marad referenciaként
    // Ha mégis kellene, a logikája jó, csak a getRichContextualData-ban kell visszakapcsolni
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    const [homeTeamId, awayTeamId] = await Promise.all([findSportMonksTeamId(homeTeamName), findSportMonksTeamId(awayTeamName)]);
    if (!homeTeamId || !awayTeamId) return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; // ID hiba [cite: 1606]
    let fixtureData = null; const today = new Date();
    for (let i = 0; i < 3 && !fixtureData; i++) { // 3 nap keresése [cite: 1607]
        const searchDate = new Date(today); searchDate.setDate(today.getDate() - i); const dateString = searchDate.toISOString().split('T')[0];
        try {
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${i + 1}. nap: ${dateString}): ID ${homeTeamId} vs ${awayTeamId}`); // Logolás [cite: 1607]
            const response = await makeRequest(url, { timeout: 7000 }); // makeRequest használata [cite: 1607]
            if (response?.data?.data?.length > 0) { const foundFixture = response.data.data.find(f=>(String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))); if (foundFixture) { fixtureData = foundFixture; console.log(`SportMonks meccs találat (${dateString})`); break; } } // Találat keresése és kilépés [cite: 1608]
        } catch (e) { /* makeRequest kezeli */ }
    }
    if (!fixtureData) { /* console.log(`SportMonks: Nem található meccs...`); */ return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; } // Nincs találat [cite: 1608]
    try {
        const extracted = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; const stats = fixtureData.statistics || []; const homeS = stats.find(s => String(s.participant_id) === String(homeTeamId)); const awayS = stats.find(s => String(s.participant_id) === String(awayTeamId)); // Statisztikák keresése [cite: 1609]
        if (homeS) extracted.advanced_stats.home.xg = homeS.xg ?? null; if (awayS) extracted.advanced_stats.away.xg = awayS.xg ?? null; // xG kinyerése [cite: 1609]
        if(extracted.advanced_stats.home.xg !== null || extracted.advanced_stats.away.xg !== null) console.log(`SportMonks xG adatok sikeresen feldolgozva.`); else console.log(`SportMonks meccs megtalálva, de xG adat nem volt elérhető.`); // Logolás [cite: 1609]
        return extracted;
    } catch (e) { console.error(`Hiba SportMonks adatok feldolgozásakor: ${e.message}`); return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; } // Hiba feldolgozáskor [cite: 1610]
}


// --- PLAYER API (API-SPORTS) FUNKCIÓK (VÁLTOZATLAN, DEAKTIVÁLT) ---
// Ezt sem hívjuk most, a kód itt marad referenciaként
async function _fetchPlayerData(playerNames) {
    // A kód itt változatlanul szerepelhet, de a getRichContextualData nem hívja meg
    // ... (korábbi _fetchPlayerData kód) ...
    console.log("Player API hívás kihagyva (Google Search az elsődleges)."); return {}; // Rövidített verzió, ami nem csinál semmit [cite: 1610]
}


// --- GEMINI API FUNKCIÓ (VÉGLEGES JAVÍTÁS - Vertex AI) ---
/**
 * Meghívja a Vertex AI Gemini modellt Google Kereső eszközzel.
 * google-auth-library segítségével hitelesít. [cite: 1617]
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string|null>} A Gemini válasza JSON stringként vagy null hiba esetén. [cite: 1617]
 */
export async function _callGeminiWithSearch(prompt) {
    let authToken;
    try {
        // Hitelesítés a szolgáltatási fiókkal (google-credentials.json) [cite: 1617]
        const client = await auth.getClient();
        const credentials = await client.getAccessToken();
        authToken = credentials.token; // Token megszerzése [cite: 1618]
    } catch (e) {
        console.error("KRITIKUS HIBA: Nem sikerült Google Auth tokent szerezni.", e.message); // Hiba logolása [cite: 1618]
        console.error("Ellenőrizd, hogy a 'google-credentials.json' fájl létezik-e és a szolgáltatási fióknak van-e 'Vertex AI User' jogosultsága!"); // Javaslat [cite: 1618]
        return null; // Hitelesítés nélkül nincs tovább [cite: 1618]
    }

    if (!authToken) { console.error("KRITIKUS HIBA: Az Auth token üres."); return null; } // Üres token hiba [cite: 1619]
    if (!PROJECT_ID || !LOCATION || !GEMINI_MODEL_ID) { console.error("KRITIKUS HIBA: PROJECT_ID, LOCATION vagy GEMINI_MODEL_ID hiányzik a config.js-ből."); return null; } // Konfig hiba [cite: 1619]

    // JAVÍTÁS: A Végpont URL-je a Vertex AI-hoz [cite: 1619]
    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${GEMINI_MODEL_ID}:generateContent`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4, // Magasabb hőmérséklet a kereséshez [cite: 1620]
            maxOutputTokens: 8192,
        },
        // === GOOGLE SEARCH AKTIVÁLVA === [cite: 1620]
        tools: [{ "googleSearchRetrieval": {} }]
    };

    console.log("Gemini API (Vertex AI) hívás indul Google Search használatával..."); // Logolás [cite: 1620]

    try {
        const response = await axios.post(url, payload, {
             headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${authToken}` // Bearer token használata [cite: 1621]
             },
             timeout: 120000, // 2 perc timeout [cite: 1622]
             validateStatus: () => true // Minden választ elfogadunk [cite: 1622]
         });

        // Hibakezelés
        if (response.status !== 200) {
             let errorMsg = `Gemini (Vertex) API HTTP hiba (${response.status}).`; let responseDetails = "";
             try { responseDetails = JSON.stringify(response.data)?.substring(0, 500); } catch { responseDetails = String(response.data)?.substring(0, 500); } // Hiba részletek kinyerése [cite: 1623]
             // A Vertex AI 403-as hibája általában jogosultsági probléma [cite: 1623]
             if (response.status === 403) {
                 errorMsg = `Gemini API hiba (403 Forbidden) - Jogosultsági probléma. A szolgáltatási fióknak (${process.env.GOOGLE_APPLICATION_CREDENTIALS}) szüksége van 'Vertex AI User' szerepkörre!`; // Pontosabb hibaüzenet 403 esetén [cite: 1624]
                 console.error(errorMsg);
                 throw new Error(errorMsg); // Ez kritikus, dobjuk tovább [cite: 1624]
             }
             if (response.status === 400) errorMsg += " (Bad Request - ellenőrizd a promptot vagy a modellt)"; // 400-as hiba jelzése [cite: 1624]
             console.error(`${errorMsg} Részletek: ${responseDetails}`); // Általános hiba logolása [cite: 1624]
             return null; // Nem kritikus hiba -> null [cite: 1624]
        }

        // Sikeres válasz feldolgozása [cite: 1625]
         const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text; // Egyszerűsített kinyerés [cite: 1625]
        const finishReason = candidate?.finishReason;

        if (!responseText) { // Ha nincs szöveges válasz [cite: 1626]
             const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category;
             console.error(`Gemini (Vertex) válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`); // Hiba logolása [cite: 1626]
             if (finishReason === 'SAFETY' || blockReason) throw new Error(`Az AI válaszát biztonsági szűrők blokkolták (${blockReason || 'SAFETY'}).`); // Safety block -> kritikus hiba [cite: 1626]
             if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt."); // Max tokens -> kritikus hiba [cite: 1626]
             return null; // Egyéb ok -> null [cite: 1626]
         }

        // JSON tisztítás és validálás
        let cleanedJsonString = responseText.trim();
        const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/); if (jsonMatch?.[1]) cleanedJsonString = jsonMatch[1]; // ```json``` blokk eltávolítása [cite: 1627]
        if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{')); // Eleje tisztítás [cite: 1627]
        if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1); // Vége tisztítás [cite: 1627]

        try {
            JSON.parse(cleanedJsonString); // Validálás [cite: 1627]
            console.log("Gemini API (Vertex/Search) sikeresen visszaadott valid JSON-t."); // Siker logolása [cite: 1627]
            return cleanedJsonString; // Visszaadás [cite: 1627]
        } catch (jsonError) {
            console.error(`Gemini válasz (Vertex/Search) nem valid JSON: ${jsonError.message}`, cleanedJsonString.substring(0,500)); // JSON hiba logolása [cite: 1627]
            return null; // JSON hiba -> null [cite: 1627]
        }
    } catch (e) { // Hálózati/timeout vagy már dobott kritikus hiba [cite: 1628]
         console.error(`Végleges hiba a Gemini (Vertex) API hívás során: ${e.message}`); // Hiba logolása [cite: 1628]
         throw e; // Dobjuk tovább a kritikus hibát [cite: 1628]
     }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (GOOGLE SEARCH ALAPÚ) ---
/**
 * Összegyűjti az összes szükséges adatot egy meccshez, elsődlegesen Gemini + Google Search használatával.
 * Megpróbálja az Odds API-t is hívni. Garantálja a 'rawStats' meglétét. [cite: 1629]
 * @param {string} sport A sportág.
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object>} Az összesített adatok objektuma. [cite: 1629]
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v30_vertex_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió [cite: 1629]
    const cached = scriptCache.get(ck); if (cached) { console.log(`Cache találat (${ck})`); return { ...cached, fromCache: true }; } // Cache ellenőrzés [cite: 1629]
    console.log(`Nincs cache (${ck}), friss adatok lekérése Vertex AI (Google Search) segítségével...`); // Logolás [cite: 1630]

    let geminiData = null;
    let oddsResult = null;

    try {
        // Párhuzamos adatgyűjtés: Gemini+Search és Odds API [cite: 1629]
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
             _callGeminiWithSearch( // Gemini hívás [cite: 1630]
                 `CRITICAL TASK: Use Google Search to find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also search for basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. NO extra text/markdown. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}` // Részletes prompt [cite: 1631]
             ),
             // Az Odds API hívás marad [cite: 1631]
             getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
         ]);

        // Odds eredmény elmentése [cite: 1632]
        oddsResult = fetchedOddsData;

        // Gemini válasz feldolgozása [cite: 1632]
        if (geminiJsonString) {
             try { geminiData = JSON.parse(geminiJsonString); }
             catch (e) { console.error(`Gemini válasz (Search) JSON parse hiba: ${e.message}`); /* geminiData marad null */ } // JSON parse hiba kezelése [cite: 1633]
         }
         // Ha Gemini nem válaszolt, üres struktúra létrehozása [cite: 1633]
         if (!geminiData) {
             console.warn("Gemini API hívás (Search) sikertelen vagy nem adott vissza adatot. Alapértelmezett adatok lesznek.");
             geminiData = { stats: { home:{}, away:{} }, key_players: { home: [], away: [] } };
         }

        // Player és SportMonks adatokat már nem kérjük le [cite: 1634]

        // --- Adatok EGYESÍTÉSE és NORMALIZÁLÁSA ---
        const finalData = {};
        // Garantált 'rawStats' objektum létezése [cite: 1635]
        const parseStat = (val, defaultVal = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0) ? val : defaultVal); // null megengedése, negatív nem [cite: 1636]
        const defaultGpHome = (geminiData?.form?.home_overall && geminiData.form.home_overall !== "N/A") ? 5 : 1; // Alap GP forma alapján [cite: 1637]
        const defaultGpAway = (geminiData?.form?.away_overall && geminiData.form.away_overall !== "N/A") ? 5 : 1; // Alap GP forma alapján [cite: 1637]
        let homeGp = parseStat(geminiData?.stats?.home?.gp, null); let awayGp = parseStat(geminiData?.stats?.away?.gp, null); // Először null alapértékkel [cite: 1637]
        if (homeGp === null) homeGp = defaultGpHome; if (awayGp === null) awayGp = defaultGpAway; // Ha null maradt, default érték [cite: 1637]

        finalData.stats = {
            home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf, null), ga: parseStat(geminiData?.stats?.home?.ga, null) }, // gf, ga lehet null [cite: 1638]
            away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf, null), ga: parseStat(geminiData?.stats?.away?.ga, null) } // gf, ga lehet null [cite: 1639]
        };

        if ((geminiData?.stats?.home && geminiData.stats.home.gp === null && finalData.stats.home.gp > 0) || (geminiData?.stats?.away && geminiData.stats.away.gp === null && finalData.stats.away.gp > 0)) {
            console.warn(`Figyelmeztetés: Gemini nem adott 'gp'-t, becsült érték (${finalData.stats.home.gp}/${finalData.stats.away.gp}) használva.`); // Figyelmeztetés, ha becsülni kellett [cite: 1639]
        }

        // Többi adat normalizálása [cite: 1640]
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: (geminiData?.key_players?.home || []).map(p => ({...p, stats: {}})), away: (geminiData?.key_players?.away || []).map(p => ({...p, stats: {}})) }; // Üres stats objektummal [cite: 1641]
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } }; // Nincs xG forrás [cite: 1642]
        finalData.referee = { name: 'N/A', stats: 'N/A' }; // Nincs bíró forrás [cite: 1642]
        finalData.league_averages = geminiData?.league_averages || {}; // Ezt a Gemini adhatja [cite: 1642]

        // Gazdag kontextus string [cite: 1643]
        const richContextParts = [];
        if (finalData.h2h_summary !== "N/A") richContextParts.push(`- H2H: ${finalData.h2h_summary}`);
        if (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") richContextParts.push(`- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`);
        const homeAbs = finalData.absentees.home.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs'; const awayAbs = finalData.absentees.away.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs';
        if (homeAbs !== 'Nincs' || awayAbs !== 'Nincs') richContextParts.push(`- Hiányzók: H: ${homeAbs}, V: ${awayAbs}`);
        if (finalData.absentee_impact_analysis !== "N/A") richContextParts.push(`- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`); // [cite: 1644]
        if (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") richContextParts.push(`- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`); // [cite: 1644]
        if (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") richContextParts.push(`- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`); // [cite: 1644]
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni a keresővel."; // Üzenet, ha semmi nincs [cite: 1644]

        const result = {
            rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext,
            advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData // rawData most csak a finalData [cite: 1645]
        };

        // KRITIKUS ELLENŐRZÉS: gp > 0 [cite: 1646]
        if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
             console.error(`KRITIKUS HIBA: Az alap statisztikák (rawStats) érvénytelenek (gp=0). Elemzés nem lehetséges.`);
             throw new Error("Kritikus csapat statisztikák (rawStats) érvénytelenek.");
         }

        scriptCache.set(ck, result); // Cachelés [cite: 1647]
        console.log(`Sikeres adatgyűjtés Google Search (${ck}), cache mentve.`);
        // Visszaadjuk az odds adatokat is külön a fő folyamatnak [cite: 1647]
        return { ...result, fromCache: false, oddsData: oddsResult };

    } catch (e) { // Kritikus hiba esetén [cite: 1648]
        console.error(`KRITIKUS HIBA a getRichContextualData(Search) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        throw new Error(`Adatgyűjtési hiba (Search): ${e.message}`); // Dobjuk tovább a hibát [cite: 1648]
    }
}


// --- ODDS API FUNKCIÓK (VÁLTOZATLANOK MARADNAK AZ ELŐZŐ VERZIÓBÓL) ---
/**
 * Lekéri az élő fogadási szorzókat az Odds API-ból, vagy használja a frontendtől kapott nyitó szorzókat.
 * Gyorsítótárazza az élő szorzókat. Liga alapján választ API kulcsot és intelligens név-egyeztetést használ. [cite: 1648]
 */
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { /* console.log("Nincs ODDS_API_KEY."); */ return null; }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    // 1. Nyitó szorzók (cache-ből vagy frontendtől) [cite: 1648]
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key]; const currentOdds = []; const allMarkets = [];
            if (matchData.h2h) {
                allMarkets.push({ key: 'h2h', outcomes: matchData.h2h });
                (matchData.h2h || []).forEach(o => {
                    const price = parseFloat(o.price);
                    if (!isNaN(price) && price > 1) {
                        let name = o.name;
                        if (typeof name === 'string') {
                            const ln = name.toLowerCase();
                            if (ln === homeTeam.toLowerCase()) name = 'Hazai győzelem';
                            else if (ln === awayTeam.toLowerCase()) name = 'Vendég győzelem';
                            else if (ln === 'draw') name = 'Döntetlen';
                        }
                        currentOdds.push({ name: name, price: price });
                    }
                });
            }
            if (matchData.totals) {
                allMarkets.push({ key: 'totals', outcomes: matchData.totals });
                const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
                const over = matchData.totals.find(o => o.point === mainLine && o.name === 'Over');
                const under = matchData.totals.find(o => o.point === mainLine && o.name === 'Under');
                if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
                if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
            }
            if (currentOdds.length > 0) {
                /* console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`); */
                return { current: currentOdds, allMarkets: allMarkets, fromCache: true, sport: sport };
            }
        } catch (e) { console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}.`); }
    }
    // 2. Cache [cite: 1649]
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`; const cachedOdds = oddsCache.get(cacheKey); if (cachedOdds) { /* console.log(`Élő szorzók használva (cache) a ${key} meccshez.`); */ return { ...cachedOdds, fromCache: true }; }
    // 3. API hívás [cite: 1649]
    // console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam} (${leagueName || 'általános'})`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) { oddsCache.set(cacheKey, liveOddsData); return { ...liveOddsData, fromCache: false }; }
    else { console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`); return null; } // Hiba logolása [cite: 1649]
}

/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból, a liga neve alapján választva API kulcsot.
 * Intelligens név-egyeztetést használ a meccs megtalálásához. [cite: 1649]
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null); // Liga kulcs vagy alap kulcs [cite: 1650]
    if (!ODDS_API_KEY || !oddsApiKey || !sportConfig.odds_api_sport_key) { console.error(`getOddsData: Hiányzó kulcsok/konfig ${sport}/${leagueName}-hoz.`); return null; } // Kulcs ellenőrzés [cite: 1650]
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`; // URL összeállítása [cite: 1650]
    try {
        // console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`); // Csökkentett log
        const response = await makeRequest(url, { timeout: 10000 }); // API hívás [cite: 1651]
        if (!response?.data || !Array.isArray(response.data)) { // Ha nincs válasz vagy nem tömb
             if (oddsApiKey !== sportConfig.odds_api_sport_key) { // Ha specifikus kulccsal próbáltuk
                 /* console.warn(`Odds API (${oddsApiKey}): Nem adott vissza adatot, próbálkozás az általános (${sportConfig.odds_api_sport_key}) kulccsal...`); */
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null); // Próba általános kulccsal [cite: 1651]
             }
             console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat.`); return null; // Ha általánossal sem jött [cite: 1651]
        }
        const oddsData = response.data; const lowerHome = homeTeam.toLowerCase().trim(); const lowerAway = awayTeam.toLowerCase().trim();
        let bestMatch = null; let highestRating = 0.65; // Név-hasonlóság keresése [cite: 1651]
        for (const match of oddsData) { if (!match.home_team || !match.away_team) continue; const apiHomeLower = match.home_team.toLowerCase().trim(); const apiAwayLower = match.away_team.toLowerCase().trim(); const homeSim = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating; const awaySim = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating; const avgSim = (homeSim * 0.6 + awaySim * 0.4); if (avgSim > highestRating) { highestRating = avgSim; bestMatch = match; } } // Súlyozott hasonlóság [cite: 1652]
        if (!bestMatch) { /* console.warn(`Odds API (${oddsApiKey}): Nem található meccs...`); */ return null; } // Nincs találat [cite: 1652]
        if (highestRating < 0.7 && !(bestMatch.home_team.toLowerCase().includes(lowerHome) || bestMatch.away_team.toLowerCase().includes(lowerAway))) { /* console.warn(`Odds API (${oddsApiKey}): ... hasonlósága alacsony.`); */ return null; } // Túl alacsony hasonlóság [cite: 1653]
        // console.log(`Odds API (${oddsApiKey}): Megtalált meccs...`); // Csökkentett log
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle'); if (!bookmaker?.markets) { console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' adat...`); return null; } // Pinnacle adatok keresése [cite: 1653]
        const currentOdds = []; const allMarkets = bookmaker.markets; const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes; const totals = allMarkets.find(m => m.key === 'totals')?.outcomes; // Piacok kinyerése [cite: 1654]
        if (h2h) { h2h.forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (name === bestMatch.home_team) name = 'Hazai győzelem'; else if (name === bestMatch.away_team) name = 'Vendég győzelem'; else if (name === 'Draw') name = 'Döntetlen'; currentOdds.push({ name: name, price: price }); } }); } // H2H oddsok feldolgozása [cite: 1654]
        if (totals) { const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = totals.find(o => o.point === mainLine && o.name === 'Over'); const under = totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); } // Totals oddsok feldolgozása [cite: 1655]
        if (currentOdds.length > 0) { return { current: currentOdds, allMarkets: allMarkets, sport: sport }; } // Siker [cite: 1656]
        else { console.warn(`Nem sikerült érvényes szorzókat kinyerni (${oddsApiKey})...`); return null; } // Hiba [cite: 1656]
    } catch (e) { console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`); return null; } // Általános hiba [cite: 1656]
}

// --- findMainTotalsLine (VÁLTOZATLAN) ---
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5; const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals'); if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) return defaultLine; let closestPair = { diff: Infinity, line: defaultLine }; const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))]; // [cite: 1657]
    for (const point of points) { const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over'); const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under'); if (over?.price && under?.price) { const diff = Math.abs(parseFloat(over.price) - parseFloat(under.price)); if (!isNaN(diff) && diff < closestPair.diff) closestPair = { diff, line: point }; } } // Legkisebb különbség keresése [cite: 1657]
    if (closestPair.diff === Infinity && points.includes(defaultLine)) return defaultLine; if (closestPair.diff !== Infinity) return closestPair.line; if(points.length > 0) return points.sort((a,b) => Math.abs(a - defaultLine) - Math.abs(b-defaultLine))[0]; return defaultLine; // Visszatérés: legközelebbi, default, vagy defaulthoz legközelebbi [cite: 1658]
}

// --- fetchOpeningOddsForAllSports (KEVÉSBÉ FONTOS, MARADHAT) ---
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)..."); let allOdds = {}; // [cite: 1658]
    for (const sport of Object.keys(SPORT_CONFIG)) { const sportConfig = SPORT_CONFIG[sport]; if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league || !sportConfig.odds_api_sport_key) continue; const allLeagueKeys = Object.keys(sportConfig.odds_api_keys_by_league).join(','); if (!allLeagueKeys) continue; const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${allLeagueKeys}`; // URL összeállítása az összes ligakulccsal [cite: 1658]
        try { const response = await makeRequest(url, { timeout: 20000 }); if (response?.data && Array.isArray(response.data)) { response.data.forEach(match => { if (!match?.home_team || !match?.away_team) return; const key = `${match.home_team.toLowerCase().trim().replace(/\s+/g, '')}_vs_${match.away_team.toLowerCase().trim().replace(/\s+/g, '')}`; const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle'); if (bookmaker?.markets) { const odds = {}; const h2h = bookmaker.markets.find(m => m.key === 'h2h')?.outcomes; const totals = bookmaker.markets.find(m => m.key === 'totals')?.outcomes; if (h2h) odds.h2h = h2h; if (totals) odds.totals = totals; if (Object.keys(odds).length > 0) allOdds[key] = odds; } }); } } catch (e) { /* makeRequest kezeli */ } await new Promise(resolve => setTimeout(resolve, 300)); // [cite: 1659]
    } console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`); return allOdds; // [cite: 1659]
}


// --- _getFixturesFromEspn (VÁLTOZATLAN) ---
/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája objektumként [{id, home, away, utcKickoff, league}]. [cite: 1660]
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport]; if (!sportConfig?.name || !sportConfig.espn_leagues) { console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`); return []; } const daysInt = parseInt(days, 10); if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`); return []; } const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); }); const promises = []; console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`); // [cite: 1661]
    for (const dateString of datesToFetch) { for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) { if (!slug) continue; const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`; promises.push( makeRequest(url, { timeout: 6000 }).then(response => { if (!response?.data?.events) return []; return response.data.events .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') .map(event => { const competition = event.competitions?.[0]; const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team; const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team; if (event.id && home?.name && away?.name && event.date) { return { id: String(event.id), home: String(home.shortDisplayName || home.displayName || home.name).trim(), away: String(away.shortDisplayName || away.displayName || away.name).trim(), utcKickoff: event.date, league: String(leagueName).trim() }; } return null; }).filter(Boolean) || []; }) ); await new Promise(resolve => setTimeout(resolve, 30)); } } // [cite: 1662]
    const results = await Promise.all(promises); const uniqueFixturesMap = new Map(); results.flat().forEach(fixture => { if (fixture?.id && !uniqueFixturesMap.has(fixture.id)) uniqueFixturesMap.set(fixture.id, fixture); }); const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff)); console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`); return finalFixtures; // [cite: 1663]
}