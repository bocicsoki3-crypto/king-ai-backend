import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY // <<< --- HOZZÁADVA
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// findBestMatch importálása

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600, useClones: false }); // Pl. 24 órás cache

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS (Fejlesztési Csomag):
* - Prompt (V35) bővítve granuláris adatokkal + TSDB inputtal.
* - Strukturált időjárás lekérése (Open-Meteo).
* - THESPORTSDB_API_KEY integrálva, példa API hívó funkciókkal.
* - GP (lejátszott meccs) kezelése robusztusabbá téve.
* - TheSportsDB V2 URL javítva.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config));
            currentConfig.timeout = currentConfig.timeout || 10000;
            currentConfig.validateStatus = (status) => status >= 200 && status < 500;
            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} URL: ${url.substring(0, 100)}...`);
                error.response = response;
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
                if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key')) {
                    console.error(errorMessage); return null;
                }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage, error.stack); return null;
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
            } else {
                console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 150)}...`);
                return null;
            }
        }
    }
    console.error(`API hívás váratlanul véget ért: ${url.substring(0, 150)}...`);
    return null;
}


// --- SPORTMONKS API --- //
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') {
         sportmonksIdCache.set(cacheKey, 'not_found'); return null;
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
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                teamId = response.data.data[0].id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${response.data.data[0].name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                 console.warn(`SportMonks API figyelmeztetés (${response.status}) Keresés: "${searchName}".`);
                 break;
            }
        } catch (error) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
         if (attempt < namesToTry.length - 1) await new Promise(resolve => setTimeout(resolve, 50));
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}


// --- GEMINI API FUNKCIÓ --- //
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself. Ensure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" } };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel...`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        if (response.status !== 200) { throw new Error(`Gemini API hiba: ${response.status} - ${JSON.stringify(response.data)}`); }
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
             const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
             const safetyRatings = response.data?.candidates?.[0]?.safetyRatings;
             let blockReason = safetyRatings?.find(r => r.blocked)?.category || (finishReason === 'SAFETY' ? 'Safety' : 'N/A');
             console.error(`Gemini nem adott vissza szöveges tartalmat. FinishReason: ${finishReason}. BlockReason: ${blockReason}. Details: ${JSON.stringify(response.data)}`);
             throw new Error(`Gemini nem adott vissza tartalmat. Ok: ${finishReason}${blockReason !== 'N/A' ? ` (${blockReason})` : ''}`);
        }
        try { JSON.parse(responseText); console.log("Gemini API sikeresen visszaadott valid JSON-t."); return responseText; }
        catch (e) {
             console.error("Gemini válasz nem valid JSON:", responseText.substring(0, 500));
             let cleanedJsonString = responseText.trim().match(/```json\n([\s\S]*?)\n```/)?.[1] || responseText.trim();
             const firstBrace = cleanedJsonString.indexOf('{'); const lastBrace = cleanedJsonString.lastIndexOf('}');
             if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) cleanedJsonString = cleanedJsonString.substring(firstBrace, lastBrace + 1);
             else { throw new Error(`Gemini válasza nem valid JSON (tisztítás után sem).`); }
             try { JSON.parse(cleanedJsonString); console.log("Gemini válasz tisztítva JSON-ná."); return cleanedJsonString; }
             catch (e2) { throw new Error(`Gemini válasza nem valid JSON (tisztítás után sem).`); }
        }
    } catch (e) { console.error(`Gemini API hiba: ${e.message}`, e.stack); throw e; }
}

// --- THESPORTSDB FUNKCIÓK ---
/**
 * Lekéri egy csapat TheSportsDB ID-ját név alapján (cache-elve).
 */
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    const cacheKey = `tsdb_teamid_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) {
        // console.log(`TheSportsDB Cache ${cachedId === 'not_found' ? 'miss (not found)' : 'hit'} for ${teamName}`);
        return cachedId === 'not_found' ? null : cachedId;
    }

    // Helyes V2 URL használata
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/search/teams?query=${encodeURIComponent(teamName)}`;
    // console.log(`TheSportsDB V2 Search URL: ${url}`);

    try {
        const response = await makeRequest(url);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const teamId = response?.data?.teams?.[0]?.idTeam;
        if (teamId) {
            console.log(`TheSportsDB (V2): ID találat "${teamName}" -> ${teamId}`);
            sportsDbCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`TheSportsDB (V2): Nem található ID ehhez: "${teamName}".`);
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getTeamId for ${teamName}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}
// async function getSportsDbPlayerList(teamId) { ... } // Placeholder
// async function getSportsDbTeamSchedule(teamId) { ... } // Placeholder


// --- Strukturált Időjárás ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
     if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) { return null; }
    let lat, lon;
    const latLonMatch = stadiumLocation.match(/latitude\s*=\s*([\d.-]+)[\s,&]*longitude\s*=\s*([\d.-]+)/i);
    if (latLonMatch && latLonMatch[1] && latLonMatch[2]) { lat = latLonMatch[1]; lon = latLonMatch[2]; }
    else { try {
        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stadiumLocation)}&count=1&language=hu&format=json`;
        const geoResponse = await makeRequest(geocodeUrl, { timeout: 5000 });
        if (!geoResponse?.data?.results?.[0]) { console.warn(`Időjárás API: Geokódolás sikertelen: ${stadiumLocation}`); return null; }
        lat = geoResponse.data.results[0].latitude; lon = geoResponse.data.results[0].longitude;
    } catch (e) { console.warn(`Időjárás API geokódolási hiba: ${e.message}`); return null; } }
    if (!lat || !lon) { console.warn("Időjárás API: Érvénytelen koordináták."); return null; }
    try {
        const startTime = new Date(utcKickoff); if (isNaN(startTime.getTime())) { console.warn(`Időjárás API: Érvénytelen kezdési idő: ${utcKickoff}`); return null; }
        const forecastDate = startTime.toISOString().split('T')[0]; const forecastHour = startTime.getUTCHours();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate)) { console.warn(`Időjárás API: Érvénytelen dátum: ${forecastDate}`); return null; }
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,wind_speed_10m&timezone=auto&start_date=${forecastDate}&end_date=${forecastDate}`;
        const weatherResponse = await makeRequest(weatherUrl, { timeout: 5000 }); const hourlyData = weatherResponse?.data?.hourly;
        if (!hourlyData?.time || !hourlyData?.precipitation || !hourlyData?.wind_speed_10m) { console.warn("Időjárás API: Hiányos válasz.", weatherResponse?.data); return null; }
        const targetTimeISO = `${forecastDate}T${String(forecastHour).padStart(2, '0')}:00`; let timeIndex = -1;
        for (let i = 0; i < hourlyData.time.length; i++) { const apiTime = new Date(hourlyData.time[i]).toISOString(); if (apiTime.startsWith(targetTimeISO.substring(0, 13))) { timeIndex = i; break; } }
        if (timeIndex === -1) {
            console.warn(`Időjárás API: Nem található adat ${targetTimeISO}-hoz.`);
            if (hourlyData.precipitation.length > 0) { console.log("Időjárás API: Fallback az első órára."); return { precipitation_mm: hourlyData.precipitation[0], wind_speed_kmh: hourlyData.wind_speed_10m[0] }; }
            console.warn("Időjárás API: Nincs órás adat."); return null;
        }
        const structuredWeather = { precipitation_mm: hourlyData.precipitation[timeIndex], wind_speed_kmh: hourlyData.wind_speed_10m[timeIndex] };
        console.log(`Időjárás API: Adat (${stadiumLocation} @ ${targetTimeISO}): Csap: ${structuredWeather.precipitation_mm}mm, Szél: ${structuredWeather.wind_speed_kmh}km/h`);
        return structuredWeather;
    } catch (e) { console.error(`Időjárás API hiba: ${e.message}`); return null; }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v35_tsdb_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
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
        const [homeTeamId, awayTeamId] = await Promise.all([
             getSportsDbTeamId(homeTeamName), getSportsDbTeamId(awayTeamName)
        ]);
        const sportsDbData = { homeTeamId, awayTeamId };
        console.log(`TheSportsDB adatok lekérve: H_ID=${homeTeamId || 'N/A'}, A_ID=${awayTeamId || 'N/A'}`);

        // --- 2. LÉPÉS: Gemini AI Hívás ---
        // Prompt V35 (A TSDB adatokkal kiegészítve)
        const PROMPT_V35 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. AVAILABLE FACTUAL DATA (From TheSportsDB - Use this as primary source if available): - Home Team ID: ${sportsDbData.homeTeamId || 'N/A'} - Away Team ID: ${sportsDbData.awayTeamId || 'N/A'} REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data): 1. Basic Stats: gp, gf, ga. Numbers or null. 2. H2H: Last 5 structured (date, score) + summary. 3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact. 4. Recent Form: W-D-L strings. 5. Key Players: name, role, recent key stat ("N/A" if unknown). 6. Contextual Factors: Stadium Location (City, Country), Match Tension (low/medium/high/extreme/friendly), Pitch Condition (good/poor/average/N/A), Referee (Name, Style). --- SPECIFIC DATA BY SPORT --- IF soccer: 7. Tactics: Style + formation. 8. Tactical Patterns: { home: ["pattern1",...], away: ["pattern1",...] }. 9. Key Matchups: { "attacker_vs_defender": ["attacker_desc", "defender_desc"] }. IF hockey: 7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. Null if unknown. IF basketball: 7. Advanced Styles: Shot Distribution { home, away }, Defensive Style { home, away }. "N/A" if unknown. OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately. STRUCTURE: { "stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}}, "h2h_summary":"<summary|N/A>", "h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}], "team_news":{"home":"<news|N/A>","away":"<news|N/A>"}, "absentees":{"home":[{"name":"<Player>","importance":"<key|imp|squad>","role":"<pos>"}],"away":[]}, "absentee_impact_analysis":"<analysis|N/A>", "form":{"home_overall":"<WDL|N/A>","away_overall":"<WDL|N/A>","home_home":"<WDL|N/A>","away_away":"<WDL|N/A>"}, "key_players":{ "home":[{"name":"<Name>","role":"<Role>", "stat":"<Stat string|N/A>"}],"away":[{"name":"<Name>","role":"<Role>", "stat":"<Stat string|N/A>"}] }, "contextual_factors":{ "stadium_location":"<City, Country|N/A>", "match_tension_index":"<low|medium|high|extreme|friendly|N/A>", "pitch_condition":"<good|poor|average|N/A>", "referee": {"name": "<Name|N/A>", "style": "<Style|N/A>"} }, "tactics":{"home":{"style":"<Style|N/A>","formation":"<form|N/A>"},"away":{"style":"<Style|N/A>","formation":"<form|N/A>"}}, "tactical_patterns":{"home":["<pattern1>",...],"away":["<pattern1>",...]}, "key_matchups":{"key_attacker_vs_defender":["<attacker_desc>", "<defender_desc>"]}, "advanced_stats_team":{"home":{"Corsi_For_Pct": <num|null>, "High_Danger_Chances_For_Pct": <num|null>},"away":{...}}, "advanced_stats_goalie":{"home_goalie":{"GSAx": <num|null>},"away_goalie":{"GSAx": <num|null>}}, "shot_distribution":{"home":"<dist_desc|N/A>","away":"<dist_desc|N/A>"}, "defensive_style":{"home":"<style_desc|N/A>","away":"<style_desc|N/A>"} }`;

        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V35),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);

        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; }
        catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}`, geminiJsonString); }

        if (!geminiData) {
            console.warn("Gemini API hívás sikertelen. Alapértelmezett adatok.");
            geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home:{}, away:{} }, tactical_patterns:{ home:[], away:[] }, key_matchups:{}, advanced_stats_team:{ home:{}, away:{} }, advanced_stats_goalie:{ home_goalie:{}, away_goalie:{} }, shot_distribution:{}, defensive_style:{} }; // Robusztusabb üres struktúra
        }

        // --- 3. LÉPÉS: Strukturált időjárás lekérése ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);

        // --- 4. LÉPÉS: Adatok Összefésülése és Visszaadása ---
        const finalData = {};
        const parseStat = (val, d = null) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0)) ? val : d;
        const inferGp = (formString) => {
             if (!formString || typeof formString !== 'string' || formString === "N/A") return 1;
             const matches = formString.match(/[WDL]/g); return matches ? matches.length : 1;
        };
        let defaultGpHome = inferGp(geminiData?.form?.home_overall);
        let defaultGpAway = inferGp(geminiData?.form?.away_overall);

        let homeGp = parseStat(geminiData?.stats?.home?.gp, null);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null || homeGp <= 0) homeGp = Math.max(1, defaultGpHome);
        if (awayGp === null || awayGp <= 0) awayGp = Math.max(1, defaultGpAway);
        homeGp = (typeof homeGp === 'number' && homeGp > 0) ? homeGp : 1;
        awayGp = (typeof awayGp === 'number' && awayGp > 0) ? awayGp : 1;

        finalData.stats = {
            home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf), ga: parseStat(geminiData?.stats?.home?.ga) },
            away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf), ga: parseStat(geminiData?.stats?.away?.ga) }
        };
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

        const result = {
            rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext,
            advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData
        };

        // KRITIKUS VALIDÁLÁS
        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' ||
            typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || // GP ellenőrzés itt marad
            typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen statisztikák. HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + TSDB(ID) + Időjárás), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) return null;
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v7_${key}`; // Verzió növelve, ha változik a logika
    const cached = oddsCache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };
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
                    const priceNum = parseFloat(o.price);
                    if (!isNaN(priceNum)) currentOdds.push({ name: name, price: priceNum });
                }
            });
        } else { console.warn(`Odds API: Nincs H2H: ${bestMatch.home_team}`); }
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totals = totalsMarket?.outcomes;
        if (totals && Array.isArray(totals)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
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
                        if (event.id && homeName && awayName && event.date) {
                             // Fontos: Az event.date már ISO 8601 UTC string
                             return { id: String(event.id), home: homeName, away: awayName, utcKickoff: event.date, league: safeLeagueName };
                        }
                        return null;
                    }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400) console.warn(`ESPN Hiba (400): Rossz slug '${slug}' (${leagueName})? URL: ${url.substring(0,100)}...`);
                else console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`); // Csak a hibaüzenet logolása
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
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