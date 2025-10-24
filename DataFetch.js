import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import { SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP } from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// findBestMatch importálása

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
* - Robusztusabb Odds API névkeresés (több variáció + string similarity).
* - Részletesebb logolás az Odds API-hoz.
* - getRichContextualData prompt bővítve: meccs fontossága, formációk, időjárás részletei.
* VÁLTOZÁS (Fejlesztési Csomag):
* - Prompt (V34) bővítve granuláris adatokkal.
* - Strukturált időjárás lekérése (Open-Meteo).
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config));
            currentConfig.timeout = currentConfig.timeout || 10000;
            // Javítás: validateStatus-nak függvénynek kell lennie
            currentConfig.validateStatus = (status) => status >= 200 && status < 500;
            // Elfogadjuk a 4xx hibákat is
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
                return null; // Itt is null-t adunk vissza
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
                // Várakozás újrapróbálkozás előtt
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 150)}...`);
    return null;
}


// --- SPORTMONKS API --- // (Változatlan maradt)
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    // Ne logoljunk hibát, ha nincs kulcs, egyszerűen csak nem használjuk a funkciót
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') {
         sportmonksIdCache.set(cacheKey, 'not_found');
         // console.log("SportMonks API kulcs hiányzik vagy nincs beállítva, SportMonks ID keresés kihagyva.");
         // Opcionális log
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
            // Javítás: validateStatus itt is függvény kell legyen
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


// --- GEMINI API FUNKCIÓ (GOLYÓÁLLÓ JSON KÉNYSZERÍTŐVEL) --- // (Változatlan maradt)
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
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.
Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.`;

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
        // Javítás: validateStatus itt is függvény kell legyen
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        // Hosszabb timeout
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
             // Általános biztonsági blokk
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
            let cleanedJsonString = responseText.trim().match(/```json\n([\s\S]*?)\n```/)?.[1]
            || responseText.trim();
            // Biztosítjuk, hogy a JSON a '{' jellel kezdődjön és '}' jellel végződjön
            const firstBrace = cleanedJsonString.indexOf('{');
            const lastBrace = cleanedJsonString.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                 cleanedJsonString = cleanedJsonString.substring(firstBrace, lastBrace + 1);
            } else {
                 // Ha nem találunk kapcsos zárójeleket, akkor valószínűleg nem javítható
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
        console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`);
        throw e; // Továbbdobjuk a hibát, hogy a hívó kontextus kezelhesse
    }
}


// --- MÓDOSÍTÁS KEZDETE ---

/**
 * ÚJ FUNKCIÓ: Strukturált időjárási adatok lekérése a meccs helyszínére és idejére.
 * @param {string} stadiumLocation A meccs helyszíne (pl. "Gelsenkirchen, Germany" vagy "latitude=51.55&longitude=7.06")
 * @param {string} utcKickoff A meccs UTC kezdési időpontja (ISO 8601 formátum)
 * @returns {object} Strukturált időjárási adat (vagy null hiba esetén)
 */
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) {
        console.warn("Időjárás API: Hiányzó helyszín vagy kezdési időpont.");
        return null;
    }

    let lat, lon;
    // Javítás: A regex pontosítása a negatív koordináták és lehetséges szóközök kezelésére
    const latLonMatch = stadiumLocation.match(/latitude\s*=\s*([\d.-]+)[\s,&]*longitude\s*=\s*([\d.-]+)/i);

    if (latLonMatch && latLonMatch[1] && latLonMatch[2]) {
        lat = latLonMatch[1];
        lon = latLonMatch[2];
        console.log(`Időjárás API: Koordináták kinyerve a helyszínből: lat=${lat}, lon=${lon}`);
    } else {
        // Ha nem lat/lon, megpróbáljuk geokódolni a helyszínt
        console.log(`Időjárás API: Geokódolás indítása ehhez: ${stadiumLocation}`);
        try {
            const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stadiumLocation)}&count=1&language=hu&format=json`; // Nyelv és formátum hozzáadva
            const geoResponse = await makeRequest(geocodeUrl, { timeout: 5000 });
            if (!geoResponse?.data?.results?.[0]) {
                console.warn(`Időjárás API: Nem sikerült geokódolni a helyszínt: ${stadiumLocation}`);
                return null;
            }
            lat = geoResponse.data.results[0].latitude;
            lon = geoResponse.data.results[0].longitude;
            console.log(`Időjárás API: Geokódolás sikeres: lat=${lat}, lon=${lon}`);
        } catch (e) {
            console.warn(`Időjárás API geokódolási hiba: ${e.message}`);
            return null;
        }
    }

    if (!lat || !lon) {
        console.warn("Időjárás API: Érvénytelen vagy hiányzó koordináták.");
        return null;
    }

    try {
        const startTime = new Date(utcKickoff);
        if (isNaN(startTime.getTime())) {
            console.warn(`Időjárás API: Érvénytelen kezdési időpont: ${utcKickoff}`);
            return null;
        }
        // Az Open-Meteo órás előrejelzést igényel, ezért a kezdés óráját használjuk
        const forecastDate = startTime.toISOString().split('T')[0];
        const forecastHour = startTime.getUTCHours(); // UTC órát használunk

        // Javítás: Biztosítjuk, hogy a dátum formátuma YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate)) {
             console.warn(`Időjárás API: Érvénytelen dátum formátum: ${forecastDate}`);
             return null;
        }

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,wind_speed_10m&timezone=auto&start_date=${forecastDate}&end_date=${forecastDate}`; // Timezone hozzáadva
        console.log(`Időjárás API hívás: ${weatherUrl}`);

        const weatherResponse = await makeRequest(weatherUrl, { timeout: 5000 });
        const hourlyData = weatherResponse?.data?.hourly;

        if (!hourlyData || !hourlyData.time || !hourlyData.precipitation || !hourlyData.wind_speed_10m) {
            console.warn("Időjárás API: Hiányos válasz a meteorológiai adatokra.", weatherResponse?.data);
            return null;
        }

        // Megkeressük a meccs órájához tartozó időpontot az API válaszában
        // Az API a helyi időzóna szerinti órát adja vissza, ha timezone=auto
        // Ezért a startTime helyi óráját kell keresnünk
        // VAGY az UTC órát használjuk és az API válaszában is az UTC időt keressük (ha a timezone nincs megadva vagy GMT)
        // Most maradjunk az UTC-nél a konzisztencia érdekében, feltételezve, hogy az API UTC-t ad vissza ha nincs timezone
        const targetTimeISO = `${forecastDate}T${String(forecastHour).padStart(2, '0')}:00`;
        let timeIndex = -1;

        // Toleránsabb keresés: ha pontosan az óra nincs meg, a legközelebbit keressük
        for (let i = 0; i < hourlyData.time.length; i++) {
             // Javítás: Az API válaszában lévő idő formátumát is normalizáljuk ISO-ra a kereséshez
             const apiTime = new Date(hourlyData.time[i]).toISOString();
             if (apiTime.startsWith(targetTimeISO.substring(0, 13))) { // Óra pontossággal keresünk
                 timeIndex = i;
                 break;
             }
        }


        if (timeIndex === -1) {
            console.warn(`Időjárás API: Nem található a ${targetTimeISO} (UTC) időponthoz közeli adat az előrejelzésben. Elérhető idők:`, hourlyData.time);
            // Fallback: használjuk az első elérhető órát
            if (hourlyData.precipitation.length > 0 && hourlyData.wind_speed_10m.length > 0) {
                 console.log("Időjárás API: Fallback az első órás adatra.");
                 return {
                    precipitation_mm: hourlyData.precipitation[0],
                    wind_speed_kmh: hourlyData.wind_speed_10m[0]
                };
            }
            console.warn("Időjárás API: Nincs elérhető órás adat.");
            return null;
        }

        const structuredWeather = {
            precipitation_mm: hourlyData.precipitation[timeIndex],
            wind_speed_kmh: hourlyData.wind_speed_10m[timeIndex]
        };

        console.log(`Időjárás API: Sikeres adatlekérés (${stadiumLocation} @ ${targetTimeISO}): Csapadék: ${structuredWeather.precipitation_mm}mm, Szél: ${structuredWeather.wind_speed_kmh}km/h`);
        return structuredWeather;

    } catch (e) {
        console.error(`Időjárás API hiba a lekérés során: ${e.message}`, e.stack);
        return null;
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
// === MÓDOSÍTÁS: A prompt bővítve az új kérésekkel (V34) ===
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) { // utcKickoff hozzáadva
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v34_advanced_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzió növelve
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        // Odds lekérés itt is futhat, ha frissebb kell cache találat esetén is
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        // Frissítjük a cache-elt adat odds részét (ha van újabb)
        if (oddsResult && !oddsResult.fromCache) {
             cached.oddsData = oddsResult;
        }
        return { ...cached, fromCache: true }; // Visszaadjuk a (potenciálisan frissített odds-os) cache-elt adatot
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése AI Studio segítségével...`);

    try {
        // --- PROMPT V34: Kiterjesztve az új mezőkkel ---
        // Javítás: A JSON struktúra leírásában a key_players stat mezője opcionálisabbá téve
        const PROMPT_V34 = `CRITICAL TASK: Based on your internal knowledge, find data for the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on:

1.  **Basic Stats**: played (gp), goals for (gf), goals against (ga). Use league standings. Ensure numbers or null.
2.  **H2H**: last 5 structured (date, score) + concise overall summary.
3.  **Team News & Absentees**: Key absentees (name, importance [key/important/squad], role/position) + overall news summary + absentee impact analysis.
4.  **Recent Form**: overall & home/away W-D-L string.
5.  **Key Players**: name, role/position, and IF POSSIBLE (especially for key attackers/defenders) their recent key stat (e.g., "npxG/90: 0.8" or "Duels Won%: 65%"). Use "N/A" if stat is unknown.
6.  **Contextual Factors**:
    * **Stadium Location**: Crucial for weather. Provide City, Country if possible (e.g., "Veltins-Arena, Gelsenkirchen, Germany"). Use "N/A" if unknown.
    * **Match Tension**: (e.g., "relegation battle", "mid-table clash", "final", "friendly"). Use "medium" if unsure.
    * **Pitch Condition**: (e.g., "good", "poor", "average", "N/A"). Use "N/A" if unknown.
    * **Referee**: Name and brief style (e.g., "Felix Zwayer (Strict, high card avg)", "N/A (Lenient)"). Use "N/A" if unknown.

--- SPECIFIC DATA BY SPORT ---

IF **soccer**:
7.  **Tactics**: Probable style + expected formation (e.g., "High press, 4-3-3", "Counter-attack, 5-3-2"). Use "N/A" if unknown.
8.  **Tactical Patterns**: { "home": ["e.g., left-side overload", "vulnerable to counter"], "away": ["e.g., deep defensive block", "set-piece threat"] }. Use empty arrays [] if unknown.
9.  **Key Matchups**: { "key_attacker_vs_defender": ["e.g., Home_Player (fast, cuts inside)", "Away_Player (slow, weak 1v1)"] }. Use empty object {} if unknown.

IF **hockey**:
7.  **Advanced Stats**:
    * **Team**: { "home": {"Corsi_For_Pct": <num|null>, "High_Danger_Chances_For_Pct": <num|null>}, "away": {"Corsi_For_Pct": <num|null>, "High_Danger_Chances_For_Pct": <num|null>} }. Use null for unknown values.
    * **Goalie**: { "home_goalie": {"GSAx": <num|null>}, "away_goalie": {"GSAx": <num|null>} }. Use null for unknown values.

IF **basketball**:
7.  **Advanced Styles**:
    * **Shot Distribution**: { "home": "e.g., high 3-point volume", "away": "e.g., dominates in the paint" }. Use "N/A" if unknown.
    * **Defensive Style**: { "home": "e.g., aggressive perimeter defense", "away": "e.g., weak pick-and-roll defense" }. Use "N/A" if unknown.

Use "N/A" for missing string fields, null for missing number fields.
The final output must be a single valid JSON object.
STRUCTURE: {
    "stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},
    "h2h_summary":"<summary|N/A>",
    "h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],
    "team_news":{"home":"<news|N/A>","away":"<news|N/A>"},
    "absentees":{"home":[{"name":"<Player>","importance":"<key|imp|squad>","role":"<pos>"}],"away":[]},
    "absentee_impact_analysis":"<analysis|N/A>",
    "form":{"home_overall":"<WDL|N/A>","away_overall":"<WDL|N/A>","home_home":"<WDL|N/A>","away_away":"<WDL|N/A>"},
    "key_players":{
        "home":[{"name":"<Name>","role":"<Role>", "stat":"<Stat string|N/A>"}],
        "away":[{"name":"<Name>","role":"<Role>", "stat":"<Stat string|N/A>"}]
    },
    "contextual_factors":{
        "stadium_location":"<City, Country|N/A>",
        "match_tension_index":"<low|medium|high|extreme|friendly|N/A>",
        "pitch_condition":"<good|poor|average|N/A>",
        "referee": {"name": "<Name|N/A>", "style": "<Style|N/A>"}
    },
    // Sport-specific keys (include ONLY for the relevant sport)
    "tactics":{"home":{"style":"<Style|N/A>","formation":"<form|N/A>"},"away":{"style":"<Style|N/A>","formation":"<form|N/A>"}}, // soccer
    "tactical_patterns":{"home":["<pattern1>",...],"away":["<pattern1>",...]}, // soccer
    "key_matchups":{"key_attacker_vs_defender":["<attacker_desc>", "<defender_desc>"]}, // soccer
    "advanced_stats_team":{"home":{"Corsi_For_Pct": <num|null>, "High_Danger_Chances_For_Pct": <num|null>},"away":{...}}, // hockey
    "advanced_stats_goalie":{"home_goalie":{"GSAx": <num|null>},"away_goalie":{"GSAx": <num|null>}}, // hockey
    "shot_distribution":{"home":"<dist_desc|N/A>","away":"<dist_desc|N/A>"}, // basketball
    "defensive_style":{"home":"<style_desc|N/A>","away":"<style_desc|N/A>"} // basketball
}`;
        // --- PROMPT V34 VÉGE ---

        // Párhuzamosan futtatjuk az AI hívást és az odds lekérést
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V34), // Az új prompt használata
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
            // Létrehozzuk az alap struktúrát N/A és null értékekkel
            geminiData = {
                stats: { home: { gp: null, gf: null, ga: null }, away: { gp: null, gf: null, ga: null } },
                h2h_summary: "N/A", h2h_structured: [],
                team_news: { home: "N/A", away: "N/A" },
                absentees: { home: [], away: [] }, absentee_impact_analysis: "N/A",
                form: { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" },
                key_players: { home: [], away: [] },
                contextual_factors: { stadium_location: "N/A", match_tension_index: "N/A", pitch_condition: "N/A", referee: { name: "N/A", style: "N/A" } },
                // Sport specifikus alapértékek
                tactics: { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } },
                tactical_patterns: { home: [], away: [] }, key_matchups: {},
                advanced_stats_team: { home: { Corsi_For_Pct: null, High_Danger_Chances_For_Pct: null }, away: { Corsi_For_Pct: null, High_Danger_Chances_For_Pct: null } },
                advanced_stats_goalie: { home_goalie: { GSAx: null }, away_goalie: { GSAx: null } },
                shot_distribution: { home: "N/A", away: "N/A" }, defensive_style: { home: "N/A", away: "N/A" }
            };
        }

        // --- ÚJ LÉPÉS: Strukturált időjárás lekérése ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        // A 'utcKickoff' paramétert mostantól az 'AnalysisFlow' adja át
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
        // --- ÚJ LÉPÉS VÉGE ---


        const finalData = {};
        // Statisztikák normalizálása és validálása
        // Javítás: parseStat most null-t ad vissza alapértelmezetten, nem 0-t, ha a bemenet nem valid
        const parseStat = (val, d = null) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0)) ? val : d;
        // Próbáljuk meg kitalálni a meccsszámot a formából, ha a stats hiányzik
        const inferGp = (formString) => {
             if (!formString || typeof formString !== 'string' || formString === "N/A") return 1; // Ha nincs forma, legalább 1 meccset feltételezünk
             // Javítás: A forma stringből a meccsek számának pontosabb kinyerése
             const matches = formString.match(/[WDL]/g);
             return matches ? matches.length : 1;
        };
        let defaultGpHome = inferGp(geminiData?.form?.home_overall);
        let defaultGpAway = inferGp(geminiData?.form?.away_overall);

        let homeGp = parseStat(geminiData?.stats?.home?.gp, null);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        // Ha nincs gp adat, vagy 0, akkor próbáljuk a formából (de minimum 1 legyen)
        if (homeGp === null || homeGp <= 0) homeGp = Math.max(1, defaultGpHome);
        if (awayGp === null || awayGp <= 0) awayGp = Math.max(1, defaultGpAway);

        finalData.stats = {
            home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf), ga: parseStat(geminiData?.stats?.home?.ga) },
            away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf), ga: parseStat(geminiData?.stats?.away?.ga) }
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

        // Kulcsjátékosok statisztikákkal (az AI promptból) - Biztosítjuk, hogy tömbök legyenek
        finalData.key_players = {
            home: (Array.isArray(geminiData?.key_players?.home) ? geminiData.key_players.home : []).map(p => ({ name: p?.name || 'Ismeretlen', role: p?.role || 'N/A', stats: p?.stat || 'N/A' })),
            away: (Array.isArray(geminiData?.key_players?.away) ? geminiData.key_players.away : []).map(p => ({ name: p?.name || 'Ismeretlen', role: p?.role || 'N/A', stats: p?.stat || 'N/A' }))
        };

        // Kontektuális adatok + ÚJ strukturált időjárás
        finalData.contextual_factors = geminiData?.contextual_factors || { stadium_location: "N/A", match_tension_index: "N/A", pitch_condition: "N/A", referee: { name: "N/A", style: "N/A" } };
        // Biztosítjuk, hogy a referee objektum létezzen
        finalData.contextual_factors.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };
        finalData.contextual_factors.structured_weather = structuredWeather; // <-- IDE MENTJÜK

        // A referee adatot külön is tároljuk a könnyebb elérhetőségért
        finalData.referee = finalData.contextual_factors.referee;
        
        // Sport-specifikus adatok (biztosítjuk az alapértelmezett struktúrát)
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } }; // Foci
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] }; // Foci
        finalData.key_matchups = geminiData?.key_matchups || {}; // Foci

        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: { Corsi_For_Pct: null, High_Danger_Chances_For_Pct: null }, away: { Corsi_For_Pct: null, High_Danger_Chances_For_Pct: null } }; // Hoki
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: { GSAx: null }, away_goalie: { GSAx: null } }; // Hoki

        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" }; // Kosár
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" }; // Kosár
        
        // Ez a mező most már kevésbé releváns, de megtartjuk placeholderrként
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } };
        // League averages - ha az AI nem adja meg, üres objektum marad
        finalData.league_averages = geminiData?.league_averages || {};

        // Összefoglaló kontextus string generálása (bővítve)
        const richContextParts = [
            finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
            finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
            (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") && `- Hírek: H: ${finalData.team_news.home || 'Nincs'}, V: ${finalData.team_news.away || 'Nincs'}`, // Javítás: Üres string helyett 'Nincs'
            (finalData.absentees.home.length > 
            0 || finalData.absentees.away.length > 0) && `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name}(${p.importance || '?'}, ${p.role || '?'})`).join(', ') ||
            'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name}(${p.importance || '?'}, ${p.role || '?'})`).join(', ') ||
            'Nincs'}`,
            finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
            (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") && `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`,
            (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") && `- Taktika: H: ${finalData.tactics.home.style || 'N/A'} (${finalData.tactics.home.formation || '?'}), V: ${finalData.tactics.away.style || 'N/A'} (${finalData.tactics.away.formation || '?'})`, // Javítás: Style null check
            // Strukturált időjárás megjelenítése a kontextusban
            structuredWeather ? `- Időjárás: ${structuredWeather.precipitation_mm}mm csapadék, ${structuredWeather.wind_speed_kmh}km/h szél.` : `- Időjárás: N/A`,
            finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean); // Kiszűri a false értékeket (pl. üres stringeket)
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni.";
        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats, // Ez most kevésbé fontos
            form: finalData.form,
            rawData: finalData // Tartalmazza az összes normalizált adatot (ÚJ ADATOKKAL)
        };
        // KRITIKUS VALIDÁLÁS: A meccsszám (gp) nem lehet nulla vagy érvénytelen
        // Javítás: Ellenőrizzük, hogy a gp szám-e és nagyobb-e 0-nál
        if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 ||
            typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Az alap statisztikák (rawStats.gp) érvénytelenek (${result.rawStats.home.gp}, ${result.rawStats.away.gp}). Elemzés nem lehetséges.`);
            throw new Error(`Kritikus csapat statisztikák (gp) érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI Studio), cache mentve (${ck}).`);
        // Javítás: Az oddsData-t is hozzáadjuk a visszatérési értékhez
        return { ...result, fromCache: false, oddsData: fetchedOddsData };
    } catch (e) {
        // Logoljuk a hibát, de itt is továbbdobjuk, hogy a fő elemzési folyamat leálljon
        console.error(`KRITIKUS HIBA a getRichContextualData(AI Studio) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        // Javítás: Az Error objektumot dobjuk tovább
        throw new Error(`Adatgyűjtési hiba (AI Studio): ${e.message}`);
    }
}
// === MÓDOSÍTÁS VÉGE ===


// --- ODDS API FUNKCIÓK ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    // Ne logoljunk hibát, ha nincs kulcs, egyszerűen csak nem használjuk
    if (!ODDS_API_KEY || ODDS_API_KEY.includes('<') || ODDS_API_KEY === 'YOUR_ODDS_API_KEY') {
         // console.log("Odds API kulcs hiányzik vagy nincs beállítva, szorzó lekérés kihagyva.");
         // Opcionális log
         return null;
    }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    const cacheKey = `live_odds_v6_robust_${sport}_${key}_${leagueName || 'noliga'}`;
    // Cache verzió növelve
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
         // console.log(`Odds cache találat (${cacheKey})`);
         // Opcionális log
         return { ...cachedOdds, fromCache: true };
    }
    // console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`);
    // Opcionális log
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
    return null;
}

// === MÓDOSÍTÁS: Robusztusabb névkeresés az Odds API-hoz === (Ez a rész változatlan maradt a korábbi javításhoz képest)
/**
 * Létrehoz névváltozatokat a kereséshez.
 * @param {string} teamName Eredeti csapatnév.
 * @returns {string[]} Névváltozatok tömbje.
 */
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([
        teamName, // Eredeti
        lowerName, // Kisbetűs
        ODDS_TEAM_NAME_MAP[lowerName] || teamName // A térképből
    ]);
    // FC, SC, stb. eltávolítása
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.)\s+/i, '').trim());
    // Csak az első szó (gyakran ez a város)
    variations.add(lowerName.split(' ')[0]);
    // Javítás: Szűrjük ki az üres stringeket a Set hozzáadás előtt
    return Array.from(variations).filter(name => name && name.length > 2); // Üres vagy túl rövid nevek kiszűrése
}

async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ?
    getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey) {
        console.warn(`Odds API: Hiányzó API kulcs (${ODDS_API_KEY ? 'OK' : 'HIÁNYZIK'}) vagy Sport Kulcs (${oddsApiKey || 'HIÁNYZIK'}) ehhez: ${leagueName || sport}`);
        return null; // API kulcs ellenőrzés itt is
    }

    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&oddsFormat=decimal`;
    try {
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat, vagy üres a válasz.`);
            // Ha specifikus liga kulccsal nem ment, és az nem az alap sport kulcs volt, próbáljuk az alap sport kulccsal
            if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Odds API: Próbálkozás az alap odds sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                 // Javítás: Az eredeti leagueName-et nem adjuk át a rekurzív hívásnak
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        const oddsData = response.data;

        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        console.log(`Odds API (${oddsApiKey}): Keresem "${homeTeam}" vs "${awayTeam}". Változatok: H[${homeVariations.join(', ')}], A[${awayVariations.join(', ')}]. API meccsek: ${oddsData.length}`);

        let bestMatch = null;
        let highestCombinedRating = 0.60; // Minimum küszöb a kombinált hasonlóságra

        for (const match of oddsData) {
            // Javítás: Ellenőrizzük, hogy a match objektum és a csapatnevek léteznek-e
            if (!match || !match.home_team || !match.away_team) {
                console.warn("Odds API: Hiányos meccs adat:", match);
                continue;
            }
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();

            // Legjobb hasonlóság keresése a változatok között
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);

            // Javítás: Ellenőrizzük, hogy a findBestMatch visszaadott-e érvényes eredményt
            if (!homeMatchResult || !homeMatchResult.bestMatch || !awayMatchResult || !awayMatchResult.bestMatch) {
                console.warn(`Odds API: Hasonlósági hiba a ${apiHomeLower} vs ${apiAwayLower} meccsnél.`);
                continue;
            }

            const homeSim = homeMatchResult.bestMatch.rating;
            const awaySim = awayMatchResult.bestMatch.rating;
            // Súlyozott átlag, hogy mindkét név számítson
            const combinedSim = (homeSim * 0.5 + awaySim * 0.5);
            // Részletes logolás (csak ha van esély az egyezésre)
            if (combinedSim > 0.5 || homeSim > 0.7 || awaySim > 0.7) {
                 console.log(` -> Odds API hasonlítás: "${match.home_team}" vs "${match.away_team}" | Hasonlóság H:"${homeMatchResult.bestMatch.target}"(${homeSim.toFixed(2)}), A:"${awayMatchResult.bestMatch.target}"(${awaySim.toFixed(2)}) => Kombinált: ${combinedSim.toFixed(2)}`);
            }

            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = match;
            }
        }

        if (!bestMatch) {
            console.warn(`Odds API (${oddsApiKey}): Nem találtam megfelelő meccset "${homeTeam}" vs "${awayTeam}" párosításhoz. Legjobb kombinált egyezés: ${(highestCombinedRating*100).toFixed(0)}%.`);
            // Ha specifikus liga kulccsal nem ment, próbálkozhatunk az alap sport kulccsal
            if (leagueName && oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.log(`Odds API: Próbálkozás az alap odds sport kulccsal (${sportConfig.odds_api_sport_key})...`);
                 // Javítás: Az eredeti leagueName-et nem adjuk át a rekurzív hívásnak
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }

        console.log(`Odds API (${oddsApiKey}): Legjobb találat "${bestMatch.home_team}" vs "${bestMatch.away_team}" (${(highestCombinedRating*100).toFixed(1)}% egyezés). Kezdés: ${bestMatch.commence_time}`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
             console.warn(`Odds API: A legjobb találat (${bestMatch.home_team}) nem tartalmazott Pinnacle piacokat.`);
             return null;
        }
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        // H2H piac (győztes)
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const h2h = h2hMarket?.outcomes;
        if (h2h && Array.isArray(h2h)) {
            h2h.forEach(o => {
                // Javítás: Ellenőrizzük, hogy 'o' és 'o.price' létezik
                if (o && o.price && o.price > 1) {
                    let name = o.name;
                    // Név normalizálása a KÖVETKEZETESSÉG érdekében
                    if (name.toLowerCase() === bestMatch.home_team.toLowerCase()) name = 'Hazai győzelem';
                    else if (name.toLowerCase() === bestMatch.away_team.toLowerCase()) name = 'Vendég győzelem';
                    else if (name.toLowerCase() === 'draw') name = 'Döntetlen';
                    else name = o.name; // Ha nem standard, marad az eredeti
                    // Javítás: Biztosítjuk, hogy a price szám legyen
                    const priceNum = parseFloat(o.price);
                    if (!isNaN(priceNum)) {
                        currentOdds.push({ name: name, price: priceNum });
                    }
                }
            });
        } else {
             console.warn(`Odds API: Nem találtam H2H piacot vagy kimeneteket a ${bestMatch.home_team} meccshez.`);
        }

        // Totals piac (Over/Under)
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totals = totalsMarket?.outcomes;
        if (totals && Array.isArray(totals)) {
            // Itt a findMainTotalsLine-nak át kell adni a sportot is
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ??
            sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
            // Javítás: Biztosítjuk, hogy a price szám legyen
            if (over?.price && over.price > 1) {
                const priceNum = parseFloat(over.price);
                if (!isNaN(priceNum)) currentOdds.push({ name: `Over ${mainLine}`, price: priceNum });
            }
            if (under?.price && under.price > 1) {
                const priceNum = parseFloat(under.price);
                if (!isNaN(priceNum)) currentOdds.push({ name: `Under ${mainLine}`, price: priceNum });
            }
        } else {
            console.warn(`Odds API: Nem találtam Totals piacot vagy kimeneteket a ${bestMatch.home_team} meccshez.`);
        }

        // Javítás: Csak akkor adjunk vissza adatot, ha van legalább egy érvényes odds
        return currentOdds.length > 0 ?
        { current: currentOdds, allMarkets, sport } : null;
    } catch (e) {
        console.error(`Hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`, e.stack); // Stack trace hozzáadva
        return null;
    }
}
// === MÓDOSÍTÁS VÉGE ===

export function findMainTotalsLine(oddsData) {
    // MÓDOSÍTÁS: A sportot is figyelembe vesszük a default line-hoz
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    // Javítás: Ellenőrizzük, hogy az outcomes tömb-e
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    // Csak a szám típusú pontokat vegyük figyelembe
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number' && !isNaN(p)))]; // NaN szűrés
    if (points.length === 0) return defaultLine; // Ha nincsenek szám pontok, default

    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        // Javítás: Ellenőrizzük az árak típusát is
        if (over?.price && typeof over.price === 'number' && under?.price && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price); // Nincs szükség parseFloat-ra, ha már számok
            if (diff < closestPair.diff) { // Nincs szükség isNaN ellenőrzésre
                closestPair = { diff, line: point };
            }
        }
    }
    // Ha találtunk párt, ami közel van egymáshoz, azt adjuk vissza
    if (closestPair.diff < 0.5) { // Növeltük a toleranciát picit
        return closestPair.line;
    }
    // Ha nincs egyértelműen legközelebbi pár, a default line-hoz legközelebbit adjuk vissza
    // Javítás: Biztosítjuk, hogy a defaultLine szám legyen az összehasonlításhoz
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return points[0]; // A default line-hoz legközelebbi pont
}


// --- ESPN MECCSLEKÉRDEZÉS --- //
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
                    // Javítás: response lehet null, ha a makeRequest null-t ad vissza
                    if (!response?.data?.events) {
                         // Ha nincs esemény, az nem feltétlenül hiba (lehet, hogy nincs
                         // meccs aznap)
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
                            const homeName = home ?
                            String(home.shortDisplayName || home.displayName || home.name || '').trim() : null;
                            const awayName = away ?
                            String(away.shortDisplayName || away.displayName || away.name || '').trim() : null;

                            // Javítás: A trim() csak akkor hívható meg, ha leagueName string
                            const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;

                            if (event.id && homeName && awayName && event.date) {
                                return {
                                    id: String(event.id),
                                    home: homeName,
                                    away: awayName,
                                    utcKickoff: event.date, // Ez UTC idő
                                    league: safeLeagueName // Javított liga név használata
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
                        // Javítás: Logoljuk a teljes hibaüzenetet
                        console.error(`Hiba egy ESPN liga lekérésekor (${leagueName}, ${slug}): ${error.message}`, error.stack);
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
        // Javítás: Duplikátum szűrés ID alapján
        const uniqueFixturesMap = new Map();
        // A flat() metódus létrehoz egy új, laposított tömböt
        results.flat().forEach(f => {
             // Biztosítjuk, hogy f.id létezik és nem null/undefined
             if (f?.id && !uniqueFixturesMap.has(f.id)) {
                 uniqueFixturesMap.set(f.id, f);
             }
        });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
             // Javítás: Dátum objektumokká alakítjuk az összehasonlításhoz
             const dateA = new Date(a.utcKickoff);
             const dateB = new Date(b.utcKickoff);
             // Kezeljük az érvénytelen dátumokat
             if (isNaN(dateA.getTime())) return 1;
             if (isNaN(dateB.getTime())) return -1;
             return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
        return finalFixtures;
    } catch (e) {
         console.error(`Váratlan hiba az ESPN meccsek feldolgozása során: ${e.message}`, e.stack); // Stack trace hozzáadva
         return []; // Hiba esetén üres tömb
    }
}