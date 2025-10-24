import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import { SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP } from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: AI Studio API + Helyes ESPN URL + Robusztus JSON tisztító + Odds név map
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config));
            currentConfig.timeout = currentConfig.timeout || 10000;
            currentConfig.validateStatus = (status) => status >= 200 && status < 500; // Elfogadjuk a 4xx hibákat is
            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            if (response.status < 200 || response.status >= 300) { // Ha nem 2xx a státusz, hibát dobunk
                const error = new Error(`API hiba: Státusz kód ${response.status}`);
                error.response = response;
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if ([401, 403, 429].includes(error.response.status)) { // Jogosultsági vagy limit hiba esetén nincs újrapróbálkozás
                    console.error(errorMessage);
                    return null;
                }
            } else if (error.request) { // Timeout vagy nincs válasz
                errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
            } else { // Beállítási vagy egyéb hiba
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage);
                return null;
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); // Várakozás újrapróbálkozás előtt
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 150)}...`);
    return null;
}

// --- SPORTMONKS API ---
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    // Ne logoljunk hibát, ha nincs kulcs, egyszerűen csak nem használjuk a funkciót
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') {
         sportmonksIdCache.set(cacheKey, 'not_found');
         // console.log("SportMonks API kulcs hiányzik vagy nincs beállítva, SportMonks ID keresés kihagyva."); // Opcionális log
         return null;
     }
    const TEAM_NAME_MAP = { 'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade', 'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen', 'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma' };
    let teamId = null;
    let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName];
    const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim();
    if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName);
    if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName);
    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt];
        try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            console.log(`SportMonks ID keresés (${attempt + 1}. próba): "${searchName}" (eredeti: "${teamName}")`);
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                 // Egyszerűsített kiválasztás: vesszük az első találatot
                let bestMatch = response.data.data[0];
                teamId = bestMatch.id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                 // Ha nem 404 (Not Found), akkor valószínűleg jogosultsági/terv hiba van
                 console.warn(`SportMonks API figyelmeztetés (${response.status}) Keresés: "${searchName}". Válasz: ${JSON.stringify(response.data)?.substring(0,100)}...`);
                 // Ilyenkor nem próbálkozunk tovább más nevekkel sem
                 break;
            }
        } catch (error) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
             // Csak akkor állunk le, ha nem timeout hiba volt
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
         // Várakozás a próbálkozások között, ha van még
         if (attempt < namesToTry.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 50));
         }
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}


// --- GEMINI API FUNKCIÓ (GOLYÓÁLLÓ JSON KÉNYSZERÍTŐVEL) ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        console.error("KRITIKUS HIBA: A GEMINI_API_KEY hiányzik vagy nincs beállítva a config.js-ben / környezeti változókban!");
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) {
        console.error("KRITIKUS HIBA: A GEMINI_MODEL_ID hiányzik a config.js-ből!");
        throw new Error("Hiányzó GEMINI_MODEL_ID.");
    }

    // Technikai kényszerítő parancs hozzáadása minden egyes prompthoz
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
            temperature: 0.2, // Alacsonyabb hőmérséklet a pontosabb, kevésbé "kreatív" JSON válaszokért
            maxOutputTokens: 8192,
            responseMimeType: "application/json", // Kikényszerítjük a JSON választ az API szintjén
        },
    };
    console.log(`Gemini API (AI Studio) hívás indul a '${GEMINI_MODEL_ID}' modellel...`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true }); // Hosszabb timeout
        if (response.status !== 200) {
            const errorDetails = JSON.stringify(response.data);
            console.error(`Gemini API hiba: ${response.status} - ${errorDetails}`);
            throw new Error(`Gemini API hiba: ${response.status} - ${errorDetails}`);
        }

        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            const safetyRatings = response.data?.candidates?.[0]?.safetyRatings;
             let blockReason = safetyRatings?.find(r => r.blocked)?.category;
             if (!blockReason && finishReason === 'SAFETY') blockReason = 'Safety'; // Általános biztonsági blokk
             console.error(`Gemini nem adott vissza szöveges tartalmat. FinishReason: ${finishReason}. BlockReason: ${blockReason || 'N/A'}. SafetyRatings: ${JSON.stringify(safetyRatings)}`);
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}${blockReason ? ` (${blockReason})` : ''}`);
        }

        // A responseMimeType miatt a válasz már eleve tiszta JSON kell legyen.
        // A biztonság kedvéért validáljuk.
        try {
            JSON.parse(responseText);
            console.log("Gemini API sikeresen visszaadott valid JSON-t.");
            return responseText; // A tiszta JSON stringet adjuk vissza
        } catch (e) {
            console.error("A Gemini által visszaadott 'application/json' válasz mégsem volt valid JSON:", responseText.substring(0, 500));
            // Próbálkozunk egy utolsó tisztítással (pl. ha ```json ... ``` mégis belekerülne)
            let cleanedJsonString = responseText.trim().match(/```json\n([\s\S]*?)\n```/)?.[1] || responseText.trim();
            if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{'));
            if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);
             try {
                 JSON.parse(cleanedJsonString);
                 console.log("Gemini API válasz sikeresen megtisztítva valid JSON-ná.");
                 return cleanedJsonString;
             } catch (e2) {
                 console.error("A Gemini válasza tisztítás után sem volt valid JSON:", cleanedJsonString.substring(0, 500));
                 throw new Error(`A Gemini válasza nem volt érvényes JSON formátumú még tisztítás után sem.`);
             }
        }
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`);
        throw e; // Továbbdobjuk a hibát, hogy a hívó kontextus kezelhesse
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v32_aistudio_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        return { ...cached, fromCache: true, oddsData: oddsResult };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése AI Studio segítségével...`);
    try {
        // Párhuzamosan futtatjuk az AI hívást és az odds lekérést
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(`CRITICAL TASK: Based on your internal knowledge, find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also provide basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. The final output must be a single valid JSON object. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);

        let geminiData = null;
         try {
             geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null;
         } catch (e) {
             console.error(`getRichContextualData: Gemini válasz JSON parse hiba: ${e.message}`, geminiJsonString);
             // Itt nem dobunk hibát, hanem üres adatokkal megyünk tovább
         }

        // Ha az AI hívás sikertelen volt, üres objektummal inicializálunk
        if (!geminiData) {
            console.warn("getRichContextualData: Gemini API hívás sikertelen vagy nem adott vissza valid adatot. Alapértelmezett adatok.");
            geminiData = { stats: {}, key_players: {}, form: {}, tactics: {}, absentees: {}, team_news: {} };
        }

        const finalData = {};
        // Statisztikák normalizálása és validálása
        const parseStat = (val, d = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0)) ? val : d;
        // Próbáljuk meg kitalálni a meccsszámot a formából, ha a stats hiányzik
        const inferGp = (formString) => formString && formString !== "N/A" ? formString.split('-').length : 1;
        let defaultGpHome = inferGp(geminiData?.form?.home_overall);
        let defaultGpAway = inferGp(geminiData?.form?.away_overall);

        let homeGp = parseStat(geminiData?.stats?.home?.gp, null);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null || homeGp === 0) homeGp = defaultGpHome; // Ha nincs vagy 0 a gp, a formából próbáljuk
        if (awayGp === null || awayGp === 0) awayGp = defaultGpAway; // Ha nincs vagy 0 a gp, a formából próbáljuk

        finalData.stats = {
            home: {
                gp: homeGp,
                gf: parseStat(geminiData?.stats?.home?.gf, null),
                ga: parseStat(geminiData?.stats?.home?.ga, null)
            },
            away: {
                gp: awayGp,
                gf: parseStat(geminiData?.stats?.away?.gf, null),
                ga: parseStat(geminiData?.stats?.away?.ga, null)
            }
        };

        // Többi adat normalizálása, alapértelmezett értékekkel
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = {
            home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [],
            away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : []
        };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = {
            home: (geminiData?.key_players?.home || []).map(p => ({ name: p?.name || 'Ismeretlen', role: p?.role || 'N/A', stats: {} })),
            away: (geminiData?.key_players?.away || []).map(p => ({ name: p?.name || 'Ismeretlen', role: p?.role || 'N/A', stats: {} }))
        };
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } }; // Placeholder
        finalData.referee = { name: 'N/A', stats: 'N/A' }; // Placeholder
        finalData.league_averages = geminiData?.league_averages || {}; // Placeholder

        // Összefoglaló kontextus string generálása
        const richContextParts = [
            finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
            (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") && `- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`,
            (finalData.absentees.home.length > 0 || finalData.absentees.away.length > 0) && `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs'}`,
            finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
            (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") && `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`,
            (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") && `- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`
        ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni.";

        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats,
            form: finalData.form,
            rawData: finalData // Tartalmazza az összes normalizált adatot
        };

        // KRITIKUS VALIDÁLÁS: A meccsszám (gp) nem lehet nulla vagy érvénytelen
        if (!result.rawStats?.home?.gp || result.rawStats.home.gp <= 0 || !result.rawStats?.away?.gp || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Az alap statisztikák (rawStats.gp) érvénytelenek (${result.rawStats.home.gp}, ${result.rawStats.away.gp}). Elemzés nem lehetséges.`);
            throw new Error(`Kritikus csapat statisztikák (gp) érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI Studio), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };
    } catch (e) {
        // Logoljuk a hibát, de itt is továbbdobjuk, hogy a fő elemzési folyamat leálljon
        console.error(`KRITIKUS HIBA a getRichContextualData(AI Studio) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        throw new Error(`Adatgyűjtési hiba (AI Studio): ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    // Ne logoljunk hibát, ha nincs kulcs, egyszerűen csak nem használjuk
    if (!ODDS_API_KEY || ODDS_API_KEY.includes('<') || ODDS_API_KEY === 'YOUR_ODDS_API_KEY') {
         // console.log("Odds API kulcs hiányzik vagy nincs beállítva, szorzó lekérés kihagyva."); // Opcionális log
         return null;
    }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    const cacheKey = `live_odds_v5_${sport}_${key}_${leagueName || 'noliga'}`; // Cache verzió növelve
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
         // console.log(`Odds cache találat (${cacheKey})`); // Opcionális log
         return { ...cachedOdds, fromCache: true };
    }
    // console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`); // Opcionális log
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
    return null;
}

async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey) return null; // API kulcs ellenőrzés itt is

    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&oddsFormat=decimal&sports=${oddsApiKey}`; // oddsFormat hozzáadva a biztonság kedvéért
    try {
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat, vagy üres a válasz.`);
            // Ha specifikus liga kulccsal nem ment, és az nem az alap sport kulcs volt, próbáljuk az alap sport kulccsal
            if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Próbálkozás az alap odds sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        const oddsData = response.data;

        const originalLowerHome = homeTeam.toLowerCase().trim();
        const originalLowerAway = awayTeam.toLowerCase().trim();

        // Használjuk a map-et, ha van benne bejegyzés, különben az eredetit
        const searchHomeName = ODDS_TEAM_NAME_MAP[originalLowerHome] || homeTeam;
        const searchAwayName = ODDS_TEAM_NAME_MAP[originalLowerAway] || awayTeam;
        const lowerSearchHome = searchHomeName.toLowerCase().trim();
        const lowerSearchAway = searchAwayName.toLowerCase().trim();

        let bestMatch = null;
        let highestRating = 0.65; // Hasonlósági küszöb

        console.log(`Odds API: Keresem "${lowerSearchHome}" vs "${lowerSearchAway}" (Eredeti: "${originalLowerHome}" vs "${originalLowerAway}"). API meccsek száma: ${oddsData.length}`);

        for (const match of oddsData) {
            if (!match.home_team || !match.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();

            const homeSim = findBestMatch(lowerSearchHome, [apiHomeLower]).bestMatch.rating;
            const awaySim = findBestMatch(lowerSearchAway, [apiAwayLower]).bestMatch.rating;
            // Súlyozott átlag, a hazai csapat nevének nagyobb súlyt adunk (gyakran pontosabb)
            const avgSim = (homeSim * 0.6 + awaySim * 0.4);

             // Logoljuk a top hasonlóságokat a debuggoláshoz
             if (avgSim > 0.5 && oddsData.length < 50) { // Csak kevés meccs esetén, hogy ne legyen túl sok log
                 console.log(` -> Odds API hasonlítás: "${match.home_team}" (${(homeSim*100).toFixed(0)}%) vs "${match.away_team}" (${(awaySim*100).toFixed(0)}%) = Avg: ${(avgSim*100).toFixed(0)}%`);
             }

            if (avgSim > highestRating) {
                highestRating = avgSim;
                bestMatch = match;
            }
        }

        if (!bestMatch) {
            console.warn(`Odds API: Nem találtam megfelelő meccset "${lowerSearchHome}" vs "${lowerSearchAway}" párosításhoz ${highestRating > 0 ? `(legjobb egyezés: ${(highestRating*100).toFixed(0)}%)` : ''}.`);
            return null;
        }
        console.log(`Odds API: A legjobb találat "${bestMatch.home_team}" vs "${bestMatch.away_team}" (${(highestRating*100).toFixed(1)}% egyezés). Kezdés: ${bestMatch.commence_time}`);

        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
             console.warn(`Odds API: A legjobb találat (${bestMatch.home_team}) nem tartalmazott Pinnacle piacokat.`);
             return null;
        }
        const currentOdds = [];
        const allMarkets = bookmaker.markets;

        // H2H piac (győztes)
        const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes;
        if (h2h) {
            h2h.forEach(o => {
                if (o.price && o.price > 1) { // Ellenőrizzük, hogy az ár létezik és nagyobb 1-nél
                    let name = o.name;
                    if (name === bestMatch.home_team) name = 'Hazai győzelem';
                    else if (name === bestMatch.away_team) name = 'Vendég győzelem';
                    else if (name === 'Draw') name = 'Döntetlen';
                    currentOdds.push({ name: name, price: parseFloat(o.price) }); // Átalakítjuk számmá
                }
            });
        } else {
             console.warn(`Odds API: Nem találtam H2H piacot a ${bestMatch.home_team} meccshez.`);
        }

        // Totals piac (Over/Under)
        const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;
        if (totals) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
            if (over?.price && over.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: parseFloat(over.price) });
            if (under?.price && under.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: parseFloat(under.price) });
        } else {
            console.warn(`Odds API: Nem találtam Totals piacot a ${bestMatch.home_team} meccshez.`);
        }

        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) {
        console.error(`Hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`);
        return null;
    }
}

export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    // Csak a szám típusú pontokat vegyük figyelembe
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];
    if (points.length === 0) return defaultLine; // Ha nincsenek szám pontok, default

    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        if (over?.price && under?.price) {
            const diff = Math.abs(parseFloat(over.price) - parseFloat(under.price));
            if (!isNaN(diff) && diff < closestPair.diff) {
                closestPair = { diff, line: point };
            }
        }
    }
    // Ha találtunk párt, ami közel van egymáshoz, azt adjuk vissza
    if (closestPair.diff < 0.5) { // Növeltük a toleranciát picit
        return closestPair.line;
    }
    // Ha nincs egyértelműen legközelebbi pár, a default line-hoz legközelebbit adjuk vissza
    points.sort((a, b) => Math.abs(a - defaultLine) - Math.abs(b - defaultLine));
    return points[0]; // A default line-hoz legközelebbi pont
}


// --- ESPN MECCSLEKÉRDEZÉS ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó vagy üres ESPN konfig (espn_sport_path / espn_leagues) ${sport}-hoz.`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) {
        console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`);
        return [];
    }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        // UTC dátumot használunk, hogy elkerüljük az időzóna problémákat
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD formátum
    });
    const promises = [];
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) {
                 console.warn(`_getFixturesFromEspn: Üres slug a ${leagueName} ligához.`);
                 continue; // Kihagyjuk az üres slug-okat
            }
            // Itt a javított `espn_sport_path`-t használjuk
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                makeRequest(url, { timeout: 8000 }) // Növelt timeout
                 .then(response => {
                    if (!response?.data?.events) {
                         // Ha nincs esemény, az nem feltétlenül hiba (lehet, hogy nincs meccs aznap)
                         // console.log(`ESPN: Nincs esemény ${leagueName} (${slug}) ligában ${dateString} napon.`); // Opcionális log
                         return [];
                    }
                    return response.data.events
                        .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') // Csak a még el nem kezdődött meccsek
                        .map(event => {
                            const competition = event.competitions?.[0];
                            if (!competition) return null;
                            const home = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                            const away = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                             // Robusztusabb névellenőrzés
                            const homeName = home ? String(home.shortDisplayName || home.displayName || home.name || '').trim() : null;
                            const awayName = away ? String(away.shortDisplayName || away.displayName || away.name || '').trim() : null;

                            if (event.id && homeName && awayName && event.date) {
                                return {
                                    id: String(event.id),
                                    home: homeName,
                                    away: awayName,
                                    utcKickoff: event.date, // Ez UTC idő
                                    league: String(leagueName).trim()
                                };
                            }
                            return null;
                        }).filter(Boolean); // Eltávolítja a null elemeket
                }).catch((error) => {
                     // Logoljuk a hibát, de üres tömbbel folytatjuk
                     // A 400-as hibákat (Bad Request) különösen figyeljük, mert azok valószínűleg rossz slug-ot jeleznek
                     if (error.response?.status === 400) {
                        console.warn(`ESPN Hiba (400 - Bad Request): Valószínűleg rossz a slug '${slug}' (${leagueName}) ligához az URL-ben: ${url.substring(0,150)}...`);
                     } else {
                        console.error(`Hiba egy ESPN liga lekérésekor (${leagueName}, ${slug}): ${error.message}`);
                     }
                     return []; // Hiba esetén üres tömböt adunk vissza
                 })
            );
            // Kisebb késleltetés, hogy ne terheljük túl az ESPN API-t
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) uniqueFixturesMap.set(f.id, f); });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
        return finalFixtures;
    } catch (e) {
         console.error(`Váratlan hiba az ESPN meccsek feldolgozása során: ${e.message}`);
         return []; // Hiba esetén üres tömb
    }
}