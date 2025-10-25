import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
// --- MÓDOSÍTÁS KEZDETE: THESPORTSDB_API_KEY importálása ---
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY // <<< --- HOZZÁADVA
} from './config.js';
// --- MÓDOSÍTÁS VÉGE ---
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// findBestMatch importálása

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
// --- MÓDOSÍTÁS KEZDETE: TheSportsDB Cache ---
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600, useClones: false }); // Pl. 24 órás cache az ID-knak, statoknak
// --- MÓDOSÍTÁS VÉGE ---

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
* - Robusztusabb Odds API névkeresés (több variáció + string similarity).
* - Részletesebb logolás az Odds API-hoz.
* - getRichContextualData prompt bővítve: meccs fontossága, formációk, időjárás részletei.
* VÁLTOZÁS (Fejlesztési Csomag):
* - Prompt (V34) bővítve granuláris adatokkal.
* - Strukturált időjárás lekérése (Open-Meteo).
* - THESPORTSDB_API_KEY integrálva, példa API hívó funkciókkal.
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
                const error = new Error(`API hiba: Státusz kód ${response.status} URL: ${url.substring(0, 100)}...`);
                error.response = response;
                // Speciális TheSportsDB hibaüzenet kezelése (ha van)
                if (url.includes('thesportsdb') && response?.data?.message) {
                    error.message += ` - TheSportsDB: ${response.data.message}`;
                }
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                // Kulcs hiba vagy rate limit esetén nincs újrapróbálkozás
                if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key')) {
                    console.error(errorMessage);
                    return null; // Nincs értelme újrapróbálni
                }
            } else if (error.request) { // Timeout vagy nincs válasz
                errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
            } else { // Beállítási vagy egyéb hiba
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage, error.stack); // Stack trace is
                return null; // Itt is null-t adunk vissza
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
            } else {
                // Ha elfogytak a próbálkozások, adjunk vissza null-t
                console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 150)}...`);
                return null; // Fontos, hogy null-t adjunk vissza, ne dobjunk hibát
            }
        }
    }
    // Elvileg ide nem futhatna a kód a while ciklus miatt, de biztosítjuk a null visszatérést
    console.error(`API hívás váratlanul véget ért: ${url.substring(0, 150)}...`);
    return null;
}


// --- SPORTMONKS API --- // (Változatlan)
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') {
         sportmonksIdCache.set(cacheKey, 'not_found');
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
                let bestMatch = response.data.data[0];
                teamId = bestMatch.id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                 console.warn(`SportMonks API figyelmeztetés (${response.status}) Keresés: "${searchName}". Válasz: ${JSON.stringify(response.data)?.substring(0,100)}...`);
                 break;
            }
        } catch (error) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
         if (attempt < namesToTry.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}


// --- GEMINI API FUNKCIÓ (GOLYÓÁLLÓ JSON KÉNYSZERÍTŐVEL) --- // (Változatlan)
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        console.error("KRITIKUS HIBA: A GEMINI_API_KEY hiányzik vagy nincs beállítva!");
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) {
        console.error("KRITIKUS HIBA: A GEMINI_MODEL_ID hiányzik a config.js-ből!");
        throw new Error("Hiányzó GEMINI_MODEL_ID.");
    }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself. Ensure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
        },
    };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel...`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
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
            if (!blockReason && finishReason === 'SAFETY') blockReason = 'Safety';
            console.error(`Gemini nem adott vissza szöveges tartalmat. FinishReason: ${finishReason}. BlockReason: ${blockReason || 'N/A'}. Details: ${JSON.stringify(response.data)}`);
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}${blockReason ? ` (${blockReason})` : ''}`);
        }
        try {
            JSON.parse(responseText);
            console.log("Gemini API sikeresen visszaadott valid JSON-t.");
            return responseText;
        } catch (e) {
            console.error("A Gemini által visszaadott 'application/json' válasz mégsem volt valid JSON:", responseText.substring(0, 500));
            let cleanedJsonString = responseText.trim().match(/```json\n([\s\S]*?)\n```/)?.[1] || responseText.trim();
            const firstBrace = cleanedJsonString.indexOf('{');
            const lastBrace = cleanedJsonString.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanedJsonString = cleanedJsonString.substring(firstBrace, lastBrace + 1);
            } else {
                 console.error("A Gemini válasza nem tartalmazott felismerhető JSON struktúrát a tisztításhoz.");
                 throw new Error(`A Gemini válasza nem volt érvényes JSON formátumú még tisztítás után sem.`);
            }
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
        console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`, e.stack); // Stack trace logolása
        throw e; // Továbbdobjuk a hibát
    }
}

// --- MÓDOSÍTÁS KEZDETE: TheSportsDB Funkciók ---

/**
 * Lekéri egy csapat TheSportsDB ID-ját név alapján (cache-elve).
 * @param {string} teamName Csapatnév.
 * @returns {Promise<string|null>} Csapat ID vagy null.
 */
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) {
        console.warn("TheSportsDB API kulcs hiányzik, ID keresés kihagyva.");
        return null;
    }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    const cacheKey = `tsdb_teamid_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId) return cachedId === 'not_found' ? null : cachedId;

    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/searchteams.php?t=${encodeURIComponent(teamName)}`;
    try {
        const response = await makeRequest(url);
        const teamId = response?.data?.teams?.[0]?.idTeam; // Vesszük az első találat ID-ját
        if (teamId) {
            console.log(`TheSportsDB: ID találat "${teamName}" -> ${teamId}`);
            sportsDbCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`TheSportsDB: Nem található ID ehhez: "${teamName}"`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (getTeamId for ${teamName}): ${error.message}`);
        sportsDbCache.set(cacheKey, 'not_found'); // Hiba esetén is cache-eljük, hogy ne próbálkozzunk újra azonnal
        return null;
    }
}

/**
 * PLACEHOLDER: Lekéri egy csapat játékoskeretét TheSportsDB ID alapján.
 * @param {string} teamId Csapat TheSportsDB ID.
 * @returns {Promise<Array|null>} Játékosok listája vagy null.
 */
async function getSportsDbPlayerList(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/listplayers.php?id=${teamId}`;
    try {
        const response = await makeRequest(url);
        // TODO: Feldolgozni a response?.data?.player tömböt
        console.log(`TheSportsDB: Játékoslista lekérve a ${teamId} csapathoz (implementáció szükséges).`);
        return response?.data?.player || null;
    } catch (error) {
        console.error(`TheSportsDB Hiba (getPlayerList for ${teamId}): ${error.message}`);
        return null;
    }
}

/**
 * PLACEHOLDER: Lekéri egy csapat menetrendjét TheSportsDB ID alapján.
 * @param {string} teamId Csapat TheSportsDB ID.
 * @returns {Promise<Array|null>} Meccsek listája vagy null.
 */
async function getSportsDbTeamSchedule(teamId) {
     if (!THESPORTSDB_API_KEY || !teamId) return null;
     // Példa: Következő 5 meccs lekérése
     const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/eventsnext.php?id=${teamId}`;
     try {
         const response = await makeRequest(url);
         // TODO: Feldolgozni a response?.data?.events tömböt a terhelés elemzéséhez
         console.log(`TheSportsDB: Menetrend lekérve a ${teamId} csapathoz (implementáció szükséges).`);
         return response?.data?.events || null;
     } catch (error) {
         console.error(`TheSportsDB Hiba (getTeamSchedule for ${teamId}): ${error.message}`);
         return null;
     }
}

// --- IDE JÖHETNÉNEK TOVÁBBI FUNKCIÓK PL. STATISZTIKÁKHOZ, KEZDŐCSAPATOKHOZ, HA AZ API TUDJA ---
// async function getSportsDbPlayerStats(playerId) { ... }
// async function getSportsDbLineup(matchId) { ... }

// --- MÓDOSÍTÁS VÉGE ---

// --- Strukturált Időjárás (Változatlan) ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    // ... (A függvény kódja változatlan) ...
    if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) {
        console.warn("Időjárás API: Hiányzó helyszín vagy kezdési időpont.");
        return null;
    }
    let lat, lon;
    const latLonMatch = stadiumLocation.match(/latitude\s*=\s*([\d.-]+)[\s,&]*longitude\s*=\s*([\d.-]+)/i);
    if (latLonMatch && latLonMatch[1] && latLonMatch[2]) {
        lat = latLonMatch[1];
        lon = latLonMatch[2];
    } else {
        try {
            const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stadiumLocation)}&count=1&language=hu&format=json`;
            const geoResponse = await makeRequest(geocodeUrl, { timeout: 5000 });
            if (!geoResponse?.data?.results?.[0]) {
                console.warn(`Időjárás API: Nem sikerült geokódolni: ${stadiumLocation}`); return null;
            }
            lat = geoResponse.data.results[0].latitude;
            lon = geoResponse.data.results[0].longitude;
        } catch (e) { console.warn(`Időjárás API geokódolási hiba: ${e.message}`); return null; }
    }
    if (!lat || !lon) { console.warn("Időjárás API: Érvénytelen koordináták."); return null; }
    try {
        const startTime = new Date(utcKickoff);
        if (isNaN(startTime.getTime())) { console.warn(`Időjárás API: Érvénytelen kezdési idő: ${utcKickoff}`); return null; }
        const forecastDate = startTime.toISOString().split('T')[0];
        const forecastHour = startTime.getUTCHours();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate)) { console.warn(`Időjárás API: Érvénytelen dátum: ${forecastDate}`); return null; }
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,wind_speed_10m&timezone=auto&start_date=${forecastDate}&end_date=${forecastDate}`;
        const weatherResponse = await makeRequest(weatherUrl, { timeout: 5000 });
        const hourlyData = weatherResponse?.data?.hourly;
        if (!hourlyData || !hourlyData.time || !hourlyData.precipitation || !hourlyData.wind_speed_10m) {
             console.warn("Időjárás API: Hiányos válasz.", weatherResponse?.data); return null;
        }
        const targetTimeISO = `${forecastDate}T${String(forecastHour).padStart(2, '0')}:00`;
        let timeIndex = -1;
        for (let i = 0; i < hourlyData.time.length; i++) {
             const apiTime = new Date(hourlyData.time[i]).toISOString();
             if (apiTime.startsWith(targetTimeISO.substring(0, 13))) { timeIndex = i; break; }
        }
        if (timeIndex === -1) {
            console.warn(`Időjárás API: Nem található adat ${targetTimeISO}-hoz. Elérhető:`, hourlyData.time);
            if (hourlyData.precipitation.length > 0 && hourlyData.wind_speed_10m.length > 0) {
                 console.log("Időjárás API: Fallback az első órára.");
                 return { precipitation_mm: hourlyData.precipitation[0], wind_speed_kmh: hourlyData.wind_speed_10m[0] };
            }
            console.warn("Időjárás API: Nincs órás adat."); return null;
        }
        const structuredWeather = { precipitation_mm: hourlyData.precipitation[timeIndex], wind_speed_kmh: hourlyData.wind_speed_10m[timeIndex] };
        console.log(`Időjárás API: Adat (${stadiumLocation} @ ${targetTimeISO}): Csap: ${structuredWeather.precipitation_mm}mm, Szél: ${structuredWeather.wind_speed_kmh}km/h`);
        return structuredWeather;
    } catch (e) { console.error(`Időjárás API hiba: ${e.message}`, e.stack); return null; }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
// === MÓDOSÍTÁS: TheSportsDB integrációs pontok + Prompt frissítés ===
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v35_tsdb_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzió növelve
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) { cached.oddsData = oddsResult; }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        // --- 1. LÉPÉS: TheSportsDB Adatok Lekérése (Párhuzamosan) ---
        console.log(`TheSportsDB adatok lekérése indul: ${homeTeamName} vs ${awayTeamName}`);
        const [homeTeamId, awayTeamId] = await Promise.all([
             getSportsDbTeamId(homeTeamName),
             getSportsDbTeamId(awayTeamName)
        ]);
        // TODO: További lekérések itt, pl.:
        // const homePlayers = homeTeamId ? await getSportsDbPlayerList(homeTeamId) : null;
        // const awayPlayers = awayTeamId ? await getSportsDbPlayerList(awayTeamId) : null;
        // const homeSchedule = homeTeamId ? await getSportsDbTeamSchedule(homeTeamId) : null;
        // const awaySchedule = awayTeamId ? await getSportsDbTeamSchedule(awayTeamId) : null;
        const sportsDbData = { homeTeamId, awayTeamId /*, homePlayers, awayPlayers, homeSchedule, awaySchedule */ }; // Összegyűjtjük az adatokat
        console.log(`TheSportsDB adatok lekérve.`);

        // --- 2. LÉPÉS: Gemini AI Hívás (A TheSportsDB adatokkal kiegészítve) ---
        // Prompt V35: Utasítjuk az AI-t, hogy használja a megadott TSDB adatokat
        const PROMPT_V35 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.

AVAILABLE FACTUAL DATA (From TheSportsDB - Use this as primary source if available):
- Home Team ID: ${sportsDbData.homeTeamId || 'N/A'}
- Away Team ID: ${sportsDbData.awayTeamId || 'N/A'}
- Home Players (Sample): [IMPLEMENTATION NEEDED]
- Away Players (Sample): [IMPLEMENTATION NEEDED]
- Recent Schedule (Sample): [IMPLEMENTATION NEEDED]

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1.  **Basic Stats**: gp, gf, ga (Use league standings if specific stats unavailable). Numbers or null.
2.  **H2H**: Last 5 structured (date, score) + concise summary.
3.  **Team News & Absentees**: Key absentees (name, importance, role) + news summary + impact. (Cross-reference with player lists if available).
4.  **Recent Form**: W-D-L strings.
5.  **Key Players**: name, role, recent key stat (e.g., "npxG/90: 0.8", "GSAx: 0.15"). Use "N/A" if unknown. (Cross-reference with player lists).
6.  **Contextual Factors**: Stadium Location (City, Country), Match Tension (low/medium/high/extreme/friendly), Pitch Condition (good/poor/average/N/A), Referee (Name, Style).
--- SPECIFIC DATA BY SPORT ---
IF **soccer**:
7.  **Tactics**: Style + formation (e.g., "High press, 4-3-3").
8.  **Tactical Patterns**: { home: ["pattern1",...], away: ["pattern1",...] }.
9.  **Key Matchups**: { "attacker_vs_defender": ["attacker_desc", "defender_desc"] }.
IF **hockey**:
7.  **Advanced Stats**: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. Null if unknown.
IF **basketball**:
7.  **Advanced Styles**: Shot Distribution { home, away }, Defensive Style { home, away }. "N/A" if unknown.

OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately.
STRUCTURE: { ... (A V34-es prompt struktúrája változatlanul idekerül) ... }`;

        // Párhuzamosan futtatjuk az AI hívást és az odds lekérést
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V35), // Az új prompt és a TSDB adatokkal
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);

        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; }
        catch (e) { console.error(`getRichContextualData: Gemini JSON parse hiba: ${e.message}`, geminiJsonString); }

        if (!geminiData) {
            console.warn("getRichContextualData: Gemini API hívás sikertelen. Alapértelmezett adatok.");
            // ... (Alapértelmezett geminiData struktúra létrehozása, mint korábban)
             geminiData = { /* ... üres struktúra ... */ };
        }

        // --- 3. LÉPÉS: Strukturált időjárás lekérése (Változatlan) ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);

        // --- 4. LÉPÉS: Adatok Összefésülése és Visszaadása ---
        const finalData = {};
        // ... (Az adatok normalizálása és a 'finalData' objektum feltöltése, mint a korábbi verzióban)
        // Fontos: Itt lehetne logikát beépíteni, hogy a Gemini által adott adatot felülírjuk a TSDB-ből származó megbízhatóbb adattal, ha van átfedés.
        finalData.stats = { /* ... */ };
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        // ... stb ...
        finalData.contextual_factors = geminiData?.contextual_factors || {};
        finalData.contextual_factors.structured_weather = structuredWeather; // Időjárás hozzáadása
        finalData.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };
        // TSDB adatok hozzáadása a rawData-hoz (későbbi felhasználásra)
        finalData.sportsDbData = sportsDbData;

        // Rich context string generálása (mint korábban, az időjárást is belevéve)
        const richContextParts = [ /* ... */ ];
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";

        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages || {}, // Biztosítjuk, hogy létezzen
            richContext,
            advancedData: finalData.advanced_stats || { home: {}, away: {} }, // Biztosítjuk, hogy létezzen
            form: finalData.form || {}, // Biztosítjuk, hogy létezzen
            rawData: finalData // Tartalmazza az összes normalizált adatot + TSDB adatokat
        };

        // KRITIKUS VALIDÁLÁS (mint korábban)
        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 ||
            typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen gp értékek.`);
            throw new Error(`Kritikus gp statisztikák érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + TSDB + Időjárás), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`); // Dobjuk tovább a hibát
    }
}
// === MÓDOSÍTÁS VÉGE ===


// --- ODDS API FUNKCIÓK (Változatlanok a legutóbbi javítás óta) ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    // ... (Kód változatlan) ...
    if (!ODDS_API_KEY || ODDS_API_KEY.includes('<') || ODDS_API_KEY === 'YOUR_ODDS_API_KEY') return null;
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    const cacheKey = `live_odds_v6_robust_${sport}_${key}_${leagueName || 'noliga'}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) return { ...cachedOdds, fromCache: true };
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
    return null;
}
function generateTeamNameVariations(teamName) {
    // ... (Kód változatlan) ...
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.)\s+/i, '').trim());
    variations.add(lowerName.split(' ')[0]);
    return Array.from(variations).filter(name => name && name.length > 2);
}
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    // ... (Kód változatlan, a hibakezeléssel és rekurzív hívással együtt) ...
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
            console.warn(`Odds API (${oddsApiKey}): Nincs meccs ${homeTeam} vs ${awayTeam}. Legjobb: ${(highestCombinedRating*100).toFixed(0)}%`);
             if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Odds API: Próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) { console.warn(`Odds API: Nincs Pinnacle piac: ${bestMatch.home_team}`); return null; }
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        if (h2hMarket?.outcomes) { h2hMarket.outcomes.forEach(o => { /* ... */ }); } else { console.warn(`Odds API: Nincs H2H: ${bestMatch.home_team}`); }
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        if (totalsMarket?.outcomes) { const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line; /* ... */ } else { console.warn(`Odds API: Nincs Totals: ${bestMatch.home_team}`); }
        // ... (Az oddsok kinyerése a currentOdds tömbbe, mint korábban) ...
        // Javítás: A H2H és Totals feldolgozás (forEach, find) részletes kódja ide másolandó a korábbi verzióból
         const h2h = h2hMarket?.outcomes;
        if (h2h && Array.isArray(h2h)) {
            h2h.forEach(o => {
                if (o && o.price && o.price > 1) {
                    let name = o.name;
                    if (name.toLowerCase() === bestMatch.home_team.toLowerCase()) name = 'Hazai győzelem';
                    else if (name.toLowerCase() === bestMatch.away_team.toLowerCase()) name = 'Vendég győzelem';
                    else if (name.toLowerCase() === 'draw') name = 'Döntetlen';
                    else name = o.name;
                    const priceNum = parseFloat(o.price);
                    if (!isNaN(priceNum)) currentOdds.push({ name: name, price: priceNum });
                }
            });
        }
        const totals = totalsMarket?.outcomes;
        if (totals && Array.isArray(totals)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
            if (over?.price && over.price > 1) { const priceNum = parseFloat(over.price); if (!isNaN(priceNum)) currentOdds.push({ name: `Over ${mainLine}`, price: priceNum }); }
            if (under?.price && under.price > 1) { const priceNum = parseFloat(under.price); if (!isNaN(priceNum)) currentOdds.push({ name: `Under ${mainLine}`, price: priceNum }); }
        }

        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) { console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}): ${e.message}`, e.stack); return null; }
}
export function findMainTotalsLine(oddsData) {
    // ... (Kód változatlan) ...
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


// --- ESPN MECCSLEKÉRDEZÉS (Változatlan a legutóbbi javítás óta) --- //
export async function _getFixturesFromEspn(sport, days) {
    // ... (Kód változatlan) ...
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig (${sport}).`); return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { /* ... dátum generálás ... */
        const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) { console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`); continue; }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push( makeRequest(url, { timeout: 8000 }).then(response => { /* ... válasz feldolgozása ... */
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => { /* ... meccs adat kinyerése ... */
                        const competition = event.competitions?.[0]; if (!competition) return null;
                        const home = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                        const away = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        const homeName = home ? String(home.shortDisplayName || home.displayName || home.name || '').trim() : null;
                        const awayName = away ? String(away.shortDisplayName || away.displayName || away.name || '').trim() : null;
                        const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;
                        if (event.id && homeName && awayName && event.date) {
                             return { id: String(event.id), home: homeName, away: awayName, utcKickoff: event.date, league: safeLeagueName };
                        }
                        return null;
                    }).filter(Boolean);
            }).catch(error => { /* ... hibakezelés ... */
                if (error.response?.status === 400) console.warn(`ESPN Hiba (400): Rossz slug '${slug}' (${leagueName})? URL: ${url.substring(0,100)}...`);
                else console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`, error.stack);
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) uniqueFixturesMap.set(f.id, f); });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => { /* ... dátum rendezés ... */
            const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve.`);
        return finalFixtures;
    } catch (e) { console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack); return []; }
}