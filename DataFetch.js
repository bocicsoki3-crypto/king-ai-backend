import axios from 'axios';
import NodeCache from 'node-cache';
// JAVÍTÁS: Behívjuk a configból az odds API kulcs VÁLASZTÓ függvényt is
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
// Név-hasonlósági csomag importálása
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache-ek inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false }); // Cache TTL csökkentve (2 óra) a frissebb adatokért
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); // Odds cache (10 perc)
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // SportMonks ID cache (nem jár le) - Hozzáadva


/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS: Elsődleges adatforrás a Gemini + Google Search.
* A SportMonks és Player API hívások KIkapcsolva/minimalizálva.
* Az Odds API hívás marad másodlagos forrásként, javított logikával.
* Robusztusabb hibakezelés és alapértelmezett értékek biztosítása.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
/**
 * Általános, hibatűrő axios kérés küldő, újrapróbálkozással.
 * @param {string} url Az API végpont URL-je.
 * @param {object} config Axios konfigurációs objektum (headers, timeout, method, data, etc.).
 * @param {number} retries Újrapróbálkozások száma.
 * @returns {Promise<axios.Response|null>} A sikeres válasz vagy null hiba esetén.
 */
async function makeRequest(url, config = {}, retries = 1) { // Kevesebb retry alapból
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config)); // Mély másolat
            currentConfig.timeout = currentConfig.timeout || 10000; // Alap 10 mp timeout
            // Alapértelmezett validateStatus csak 2xx-et fogad el
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300);

            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            return response; // Sikeres válasz
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 100)}... - `; // URL rövidítve a logban
            if (axios.isAxiosError(error)) {
                if (error.response) { // A szerver válaszolt, de nem a validateStatus szerint
                    errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                    // Ha rate limit (429) vagy jogosultsági (401, 403) hiba, nincs értelme újrapróbálni
                    if ([401, 403, 429].includes(error.response.status)) {
                        console.error(errorMessage);
                        return null; // Nincs újrapróbálkozás
                    }
                } else if (error.request) { // Kérés elküldve, de nem jött válasz (pl. timeout)
                    errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
                } else { // Beállítási hiba
                    errorMessage += `Beállítási hiba: ${error.message}`;
                    console.error(errorMessage);
                    return null; // Nincs újrapróbálkozás
                }
            } else { // Nem Axios hiba
                errorMessage += `Általános hiba: ${error.message}`;
                console.error(errorMessage); // Stack trace nélkül
                return null; // Nincs újrapróbálkozás
            }
            console.warn(errorMessage); // Figyelmeztetés logolása
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); // Növekvő várakozás
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 100)}...`);
    return null; // Sikertelen volt az összes próbálkozás
}


// --- SPORTMONKS API FUNKCIÓK (DEAKTIVÁLVA A FŐ FOLYAMATBAN) ---
// Ezek a függvények megmaradnak, de a getRichContextualData nem hívja őket aktívan.
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
            // console.log(`SportMonks ID keresés (${attempt + 1}. próba): "${searchName}" (eredeti: "${teamName}")`); // Csökkentett log
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                const results = response.data.data; let bestMatch = results[0];
                if (results.length > 1) { const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName); if (perfectMatch) { bestMatch = perfectMatch; } else { const names = results.map(team => team.name); const sim = findBestMatch(originalLowerName, names); const simThreshold = (attempt === 0) ? 0.7 : 0.6; if (sim.bestMatch.rating > simThreshold) { bestMatch = results[sim.bestMatchIndex]; } else { const containingMatch = results.find(team => team.name.toLowerCase().includes(originalLowerName)); if(containingMatch) bestMatch = containingMatch; } } }
                teamId = bestMatch.id; /* console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`); */ break; // Csökkentett log
            } else if (response.status !== 404) { const rd = JSON.stringify(response.data)?.substring(0, 300); if (rd.includes('plan') || rd.includes('subscription') || rd.includes('does not have access')) { /* console.warn(`SportMonks figyelmeztetés (${response.status}) Keresés: "${searchName}". Lehetséges előfizetési korlát.`); */ teamId = null; break; } else { console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}"`); } break; }
        } catch (error) { console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`); if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break; }
        if (attempt < namesToTry.length - 1) { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found'); if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`); return teamId;
 }
async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) { console.log("SportMonks hívás kihagyva (Google Search az elsődleges)."); return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; }

// --- PLAYER API (API-SPORTS) FUNKCIÓK (DEAKTIVÁLVA A FŐ FOLYAMATBAN) ---
async function _fetchPlayerData(playerNames) { console.log("Player API hívás kihagyva (Google Search az elsődleges)."); return {}; }


// --- GEMINI API FUNKCIÓ (GOOGLE SEARCH AKTIVÁLVA) ---
/**
 * Meghívja a Gemini API-t a megadott prompttal, Google Kereső eszközzel.
 * Kezeli a hibákat és próbál JSON választ adni.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string|null>} A Gemini válasza JSON stringként vagy null hiba esetén.
 */
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) { console.error("Hiányzó Gemini API kulcs."); return null; } // Null-t adunk vissza, nem dobunk hibát

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4, // Kicsit magasabb lehet a keresés miatt
            maxOutputTokens: 8192,
            // responseMimeType: "application/json", // Ezt inkább kerüljük
        },
        // === GOOGLE SEARCH AKTIVÁLVA ===
        tools: [{ "googleSearchRetrieval": {} }]
    };

    console.log("Gemini API hívás indul Google Search használatával...");

    try {
        // Közvetlen axios hívás a specifikus hibakezeléshez
        const response = await axios.post(GEMINI_API_URL, payload, {
             headers: { 'Content-Type': 'application/json' },
             timeout: 120000, // Hosszabb timeout a keresés miatt (2 perc)
             validateStatus: () => true // Minden választ elfogadunk
         });

        // Hibakezelés
        if (response.status !== 200) {
             let errorMsg = `Gemini API HTTP hiba (${response.status}).`; let responseDetails = "";
             try { responseDetails = JSON.stringify(response.data)?.substring(0, 500); } catch { responseDetails = String(response.data)?.substring(0, 500); }
             // Külön kezeljük a "Search grounding not supported" hibát
             if (responseDetails.includes('Search Grounding is not supported')) {
                 errorMsg = "Gemini API hiba: Ez a modell/kulcs mégsem támogatja a keresést.";
                 console.error(errorMsg);
                 throw new Error(errorMsg); // Ez kritikus hiba, dobjuk tovább
             }
             if (response.status === 400 && responseDetails.toLowerCase().includes('<html')) { errorMsg = "Gemini API hiba (400 Bad Request) - Valószínűleg API kulcs vagy projekt beállítási probléma."; console.error(errorMsg); return null; } // Nem dobunk hibát, csak logolunk és null-t adunk
             console.error(`${errorMsg} Részletek: ${responseDetails}`);
             if (response.status === 429) console.warn("Gemini API rate limit elérve."); // Csak figyelmeztetés
             if (response.status === 400 && errorDetails.includes('API key not valid')) console.error("Érvénytelen Gemini API kulcs.");
             return null; // Nem kritikus hiba esetén null-t adunk vissza
        }

        // Sikeres válasz feldolgozása
        const candidate = response.data?.candidates?.[0];
        // FIGYELEM: Keresés esetén a válasz struktúrája MÁS lehet! A tartalom a tool_calls-ban is lehet.
        // Itt egy egyszerűsített feldolgozás, ami a legtöbb esetben működik.
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
             const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category;
             console.error(`Gemini API válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`);
             // Ha safety miatt blokkolt, próbáljuk meg logolni a promptot a debuggoláshoz
             if (finishReason === 'SAFETY') console.warn("Gemini SAFETY block. Prompt (első 300 kar.):", prompt.substring(0, 300));
             return null; // Nincs válasz, null-t adunk vissza
         }

        // JSON tisztítás és validálás
        let cleanedJsonString = responseText.trim();
        const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch?.[1]) cleanedJsonString = jsonMatch[1];
        // Agresszívebb tisztítás
         if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{'));
         if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);

        try {
            JSON.parse(cleanedJsonString); // Csak validáljuk
            console.log("Gemini API (Search) sikeresen visszaadott valid JSON-t.");
            return cleanedJsonString; // Visszaadjuk a JSON stringet
        } catch (jsonError) {
            console.error(`Gemini válasz (Search) nem valid JSON: ${jsonError.message}`, cleanedJsonString.substring(0,500));
            return null; // JSON hiba esetén null
        }

    } catch (e) { // Hálózati/timeout vagy már dobott kritikus hiba
         console.error(`Hiba a Gemini API hívás (Search) során: ${e.message}`);
         // Ha a hibaüzenet a keresés nem támogatottságáról szól, dobjuk tovább
         if (e.message.includes('nem támogatja a keresést')) throw e;
         return null; // Egyéb hiba esetén null
     }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (GOOGLE SEARCH ALAPÚ) ---
/**
 * Összegyűjti az összes szükséges adatot egy meccshez, elsődlegesen Gemini + Google Search használatával.
 * Megpróbálja az Odds API-t is hívni. Garantálja a 'rawStats' meglétét.
 * @param {string} sport A sportág.
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object>} Az összesített adatok objektuma.
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v29_gsearch_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió
    const cached = scriptCache.get(ck);
    if (cached) { console.log(`Cache találat (${ck})`); return { ...cached, fromCache: true }; }
    console.log(`Nincs cache (${ck}), friss adatok lekérése Google Search segítségével...`);

    let geminiData = null; // Alapból null
    let oddsResult = null; // Odds API eredménye

    try {
        // --- Elsődleges: Gemini + Google Search ---
        // JAVÍTOTT PROMPT: Kicsit specifikusabb kérések, N/A megengedése
        const geminiPrompt = `CRITICAL TASK: Use Google Search to find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also search for basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. NO extra text/markdown. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`;

        const geminiJsonString = await _callGeminiWithSearch(geminiPrompt);

        if (geminiJsonString) {
             try { geminiData = JSON.parse(geminiJsonString); }
             catch (e) { console.error(`Gemini válasz (Search) JSON parse hiba: ${e.message}`); /* geminiData marad null */ }
         } else {
             console.warn("Gemini API hívás (Search) sikertelen vagy nem adott vissza adatot. Alapértelmezett adatok lesznek.");
         }
         // Ha Gemini nem válaszolt, létrehozunk egy üres struktúrát
         if (!geminiData) {
              geminiData = { stats: { home:{}, away:{} }, key_players: { home: [], away: [] } };
         }

        // --- Másodlagos: Odds API ---
         const sportConfig = SPORT_CONFIG[sport];
         if (sportConfig) {
            oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, sportConfig, null, leagueName); // Nyitó oddsokat most nem küldünk
         }


        // --- Adatok EGYESÍTÉSE és NORMALIZÁLÁSA ---
        const finalData = {};

        // VÉGLEGES JAVÍTÁS: Garantált 'rawStats' objektum létezése és alapértelmezett értékek
        const parseStat = (val, defaultVal = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0) ? val : defaultVal); // null megengedése, negatív nem
        // Ha Gemini nem adott gp-t, de formát igen (5 meccs), akkor 5, különben 1 (hogy ne legyen 0)
        const defaultGpHome = (geminiData?.form?.home_overall && geminiData.form.home_overall !== "N/A") ? 5 : 1;
        const defaultGpAway = (geminiData?.form?.away_overall && geminiData.form.away_overall !== "N/A") ? 5 : 1;
        
        // Először a parseStat-ot null alapértékkel hívjuk, hogy a null megmaradjon, ha Gemini azt adta
        const parseStatAllowNull = (val) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0) ? val : null); // null megengedése
        
        let homeGp = parseStatAllowNull(geminiData?.stats?.home?.gp);
        let awayGp = parseStatAllowNull(geminiData?.stats?.away?.gp);

        // Ha a statisztika null (mert a Gemini nem adta meg), akkor használjuk a defaultGp-t
        if (homeGp === null) homeGp = defaultGpHome;
        if (awayGp === null) awayGp = defaultGpAway;


        finalData.stats = {
            home: {
                 gp: homeGp,
                 gf: parseStatAllowNull(geminiData?.stats?.home?.gf), // null lehet alapból
                 ga: parseStatAllowNull(geminiData?.stats?.home?.ga), // null lehet alapból
             },
             away: {
                 gp: awayGp,
                 gf: parseStatAllowNull(geminiData?.stats?.away?.gf), // null lehet alapból
                 ga: parseStatAllowNull(geminiData?.stats?.away?.ga), // null lehet alapból
             }
         };
         
         // Figyelmeztetés, ha alapértelmezett GP-t kellett használni
         if (geminiData?.stats?.home && geminiData.stats.home.gp === null && finalData.stats.home.gp > 0) console.warn(`Figyelmeztetés: Gemini nem adott 'gp'-t (home), ${finalData.stats.home.gp} érték használva.`);
         if (geminiData?.stats?.away && geminiData.stats.away.gp === null && finalData.stats.away.gp > 0) console.warn(`Figyelmeztetés: Gemini nem adott 'gp'-t (away), ${finalData.stats.away.gp} érték használva.`);


        // Többi adat normalizálása
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: [], away: [] }; // Player API-t nem hívtuk, a Gemini listája marad
            (geminiData?.key_players?.home || []).forEach(p => { if (p?.name) finalData.key_players.home.push({ ...p, stats: {} }); }); // Üres stats
            (geminiData?.key_players?.away || []).forEach(p => { if (p?.name) finalData.key_players.away.push({ ...p, stats: {} }); }); // Üres stats
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } }; // xG-t most nem tudunk megbízhatóan szerezni
        finalData.referee = { name: 'N/A', stats: 'N/A' };
        finalData.league_averages = geminiData?.league_averages || {}; // Ha a kereső talált

        // Gazdag kontextus string (csak a Gemini által talált adatokból)
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
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats, // Csak üres xG lesz benne
            form: finalData.form,
            // Odds adatokat külön kezeljük, itt csak a nyers Gemini adatot adjuk át
            rawData: { gemini: geminiData, odds: oddsResult } // oddsResult lehet null
        };

        // KRITIKUS ELLENŐRZÉS: Van-e legalább minimális adat?
        // Ha a gp <= 0 (ami csak akkor lehet, ha Gemini explicit 0-t adott, VAGY a parseStat 0-t adott vissza)
        if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
             console.error(`KRITIKUS HIBA: Az alap statisztikák (rawStats) érvénytelenek (gp=0). Elemzés nem lehetséges.`);
             throw new Error("Kritikus csapat statisztikák (rawStats) érvénytelenek.");
         }

        scriptCache.set(ck, result); // Cachelés
        console.log(`Sikeres adatgyűjtés Google Search (${ck}), cache mentve.`);
        // Visszaadjuk az odds adatokat is külön a fő folyamatnak
        return { ...result, fromCache: false, oddsData: oddsResult };

    } catch (e) { // Ez csak akkor fut le, ha valami kritikus hiba történt (pl. JSON.parse, Gemini kritikus hiba)
        console.error(`KRITIKUS HIBA a getRichContextualData(Search) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        throw new Error(`Adatgyűjtési hiba (Search): ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK (VÉGLEGESEN JAVÍTVA) ---
/**
 * Lekéri az élő fogadási szorzókat az Odds API-ból, vagy használja a frontendtől kapott nyitó szorzókat.
 * Gyorsítótárazza az élő szorzókat. Liga alapján választ API kulcsot és intelligens név-egyeztetést használ.
 */
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { /* console.log("Nincs ODDS_API_KEY."); */ return null; } // Csökkentett log
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    // 1. Nyitó szorzók (nem használjuk aktívan most)
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
    // 2. Cache
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`; const cachedOdds = oddsCache.get(cacheKey); 
    if (cachedOdds) { /* console.log(`Élő szorzók használva (cache) a ${key} meccshez.`); */ return { ...cachedOdds, fromCache: true }; }
    // 3. API hívás
    // console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam} (${leagueName || 'általános'})`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) { 
        oddsCache.set(cacheKey, liveOddsData); 
        return { ...liveOddsData, fromCache: false }; 
    }
    else { console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`); return null; }
}

/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból, a liga neve alapján választva API kulcsot.
 * Intelligens név-egyeztetést használ a meccs megtalálásához.
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey || !sportConfig.odds_api_sport_key) { console.error(`getOddsData: Hiányzó kulcsok/konfig ${sport}/${leagueName}-hoz.`); return null; }
    // Az URL-ben a sportConfig.odds_api_sport_key megy, a sports paraméterbe a liga(ák) kulcsa(i)
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`;
    try {
        // console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`); // Csökkentett log
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data)) { 
            // Ha a specifikus kulcs nem adott vissza adatot, és ez NEM az általános sportkulcs volt, próbáljuk az általánossal
             if (oddsApiKey !== sportConfig.odds_api_sport_key) { 
                 console.warn(`Odds API (${oddsApiKey}): Nem adott vissza adatot, próbálkozás az általános (${sportConfig.odds_api_sport_key}) kulccsal...`); 
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null); // Rekurzív hívás liga nélkül
             }
             console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat.`); // Ha már az általánossal sem ment
             return null; 
        }
        const oddsData = response.data; const lowerHome = homeTeam.toLowerCase().trim(); const lowerAway = awayTeam.toLowerCase().trim();
        let bestMatch = null; let highestRating = 0.65; // Közepes-magas küszöb
        for (const match of oddsData) { 
            if (!match.home_team || !match.away_team) continue; 
            const apiHomeLower = match.home_team.toLowerCase().trim(); const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeSim = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating; const awaySim = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating;
            const avgSim = (homeSim * 0.6 + awaySim * 0.4); // Súlyozott átlag
            if (avgSim > highestRating) { highestRating = avgSim; bestMatch = match; } 
        }
        if (!bestMatch) { /* console.warn(`Odds API (${oddsApiKey}): Nem található meccs: ${homeTeam} vs ${awayTeam}.`); */ return null; } // Csökkentett log
        if (highestRating < 0.7 && !(bestMatch.home_team.toLowerCase().includes(lowerHome) || bestMatch.away_team.toLowerCase().includes(lowerAway))) { 
            /* console.warn(`Odds API (${oddsApiKey}): Legjobb találat ... hasonlósága alacsony.`); */ return null; // Csökkentett log
         }
        // console.log(`Odds API (${oddsApiKey}): Megtalált meccs (hasonlóság: ${(highestRating * 100).toFixed(1)}%): "${bestMatch.home_team}" vs "${bestMatch.away_team}"`); // Csökkentett log
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle'); 
        if (!bookmaker?.markets) { console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' adat: ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }
        
        const currentOdds = []; const allMarkets = bookmaker.markets;
        const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes;
        const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;
        if (h2h) { h2h.forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (name === bestMatch.home_team) name = 'Hazai győzelem'; else if (name === bestMatch.away_team) name = 'Vendég győzelem'; else if (name === 'Draw') name = 'Döntetlen'; currentOdds.push({ name: name, price: price }); } }); }
        if (totals) { const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = totals.find(o => o.point === mainLine && o.name === 'Over'); const under = totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); }
        
        if (currentOdds.length > 0) { return { current: currentOdds, allMarkets: allMarkets, sport: sport }; }
        else { console.warn(`Nem sikerült érvényes szorzókat kinyerni (${oddsApiKey}): ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }
    } catch (e) { console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`); return null; }
}


// --- findMainTotalsLine ---
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5; 
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals'); 
    if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) return defaultLine; 
    let closestPair = { diff: Infinity, line: defaultLine }; 
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];
    for (const point of points) { 
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over'); 
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under'); 
        if (over?.price && under?.price) { 
            const diff = Math.abs(parseFloat(over.price) - parseFloat(under.price)); 
            if (!isNaN(diff) && diff < closestPair.diff) closestPair = { diff, line: point }; 
        } 
    }
    if (closestPair.diff === Infinity && points.includes(defaultLine)) return defaultLine; 
    if (closestPair.diff !== Infinity) return closestPair.line; 
    if(points.length > 0) return points.sort((a,b) => Math.abs(a - defaultLine) - Math.abs(b-defaultLine))[0]; 
    return defaultLine;
}

// --- fetchOpeningOddsForAllSports (Ritkán használt, de teljes) ---
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)..."); let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) { 
        const sportConfig = SPORT_CONFIG[sport]; 
        if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league || !sportConfig.odds_api_sport_key) continue; 
        const allLeagueKeys = Object.keys(sportConfig.odds_api_keys_by_league).join(','); 
        if (!allLeagueKeys) continue; 
         const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${allLeagueKeys}`;
        try { 
            const response = await makeRequest(url, { timeout: 20000 }); 
            if (response?.data && Array.isArray(response.data)) { 
                response.data.forEach(match => { 
                     if (!match?.home_team || !match?.away_team) return; 
                     const key = `${match.home_team.toLowerCase().trim().replace(/\s+/g, '')}_vs_${match.away_team.toLowerCase().trim().replace(/\s+/g, '')}`; 
                     const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle'); 
                     if (bookmaker?.markets) { 
                         const odds = {}; 
                         const h2h = bookmaker.markets.find(m => m.key === 'h2h')?.outcomes; 
                         const totals = bookmaker.markets.find(m => m.key === 'totals')?.outcomes; 
                         if (h2h) odds.h2h = h2h; 
                         if (totals) odds.totals = totals; 
                         if (Object.keys(odds).length > 0) allOdds[key] = odds; 
                     } 
                }); 
            } 
        } catch (e) { /* makeRequest kezeli */ } 
        await new Promise(resolve => setTimeout(resolve, 300));
    } 
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`); 
    return allOdds;
}


// --- _getFixturesFromEspn (VÁLTOZATLAN) ---
/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája objektumként [{id, home, away, utcKickoff, league}].
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport]; 
    if (!sportConfig?.name || !sportConfig.espn_leagues) { console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`); return []; } 
    const daysInt = parseInt(days, 10); 
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`); return []; } 
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); }); 
    const promises = []; 
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);
    
    for (const dateString of datesToFetch) { 
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) { 
            if (!slug) continue; 
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`; 
            promises.push( 
                makeRequest(url, { timeout: 6000 })
                    .then(response => { 
                        if (!response?.data?.events) return []; 
                        return response.data.events 
                            .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') 
                            .map(event => { 
                                const competition = event.competitions?.[0]; 
                                const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team; 
                                const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team; 
                                if (event.id && home?.name && away?.name && event.date) { 
                                    return { 
                                        id: String(event.id), 
                                        home: String(home.shortDisplayName || home.displayName || home.name).trim(), 
                                        away: String(away.shortDisplayName || away.displayName || away.name).trim(), 
                                        utcKickoff: event.date, 
                                        league: String(leagueName).trim() 
                                    }; 
                                } 
                                return null; 
                            }).filter(Boolean) || []; 
                    }) 
            ); 
            await new Promise(resolve => setTimeout(resolve, 30)); // Rate limit védelem
        } 
    }
    
    const results = await Promise.all(promises); 
    const uniqueFixturesMap = new Map();
    results.flat().forEach(fixture => { 
        if (fixture?.id && !uniqueFixturesMap.has(fixture.id)) { 
            uniqueFixturesMap.set(fixture.id, fixture); 
        } 
    });
    const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`); 
    return finalFixtures;
}