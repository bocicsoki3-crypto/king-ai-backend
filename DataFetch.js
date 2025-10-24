import axios from 'axios';
import NodeCache from 'node-cache';
import { SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });


/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: AI Studio API + Helyes ESPN URL + Robusztus JSON tisztító
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
                if ([401, 403, 429].includes(error.response.status)) {
                    console.error(errorMessage);
                    return null;
                }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
                console.error(errorMessage);
                return null;
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
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
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) { sportmonksIdCache.set(cacheKey, 'not_found'); return null; }
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
            }
        } catch (error) {
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}

// --- GEMINI API FUNKCIÓ (GOLYÓÁLLÓ JSON KÉNYSZERÍTŐVEL) ---
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<')) { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    
    // JAVÍTÁS: Technikai kényszerítő parancs hozzáadása minden egyes prompthoz
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: { 
            temperature: 0.2, // Alacsonyabb hőmérséklet a pontosabb, kevésbé kreatív válaszokért
            maxOutputTokens: 8192,
            // JAVÍTÁS: Kikényszerítjük, hogy az API JSON-t adjon vissza. Ez a legerősebb garancia.
            responseMimeType: "application/json", 
        },
    };

    console.log(`Gemini API (AI Studio) hívás indul a '${GEMINI_MODEL_ID}' modellel...`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        
        if (response.status !== 200) {
            const errorDetails = JSON.stringify(response.data);
            throw new Error(`Gemini API hiba: ${response.status} - ${errorDetails}`);
        }
        
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }

        // A responseMimeType miatt a válasz már eleve tiszta JSON kell legyen, a régi tisztításra nincs szükség.
        try {
            JSON.parse(responseText); // Csak validáljuk
            console.log("Gemini API sikeresen visszaadott valid JSON-t.");
            return responseText; // A tiszta JSON stringet adjuk vissza
        } catch (e) {
            console.error("A Gemini által visszaadott 'application/json' válasz mégsem volt valid JSON:", responseText.substring(0, 500));
            throw new Error(`A Gemini válasza nem volt érvényes JSON formátumú.`);
        }
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`);
        throw e;
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v32_aistudio_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzióváltás
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        return { ...cached, fromCache: true, oddsData: oddsResult };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése AI Studio segítségével...`);
    try {
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(`CRITICAL TASK: Based on your internal knowledge, find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also provide basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. The final output must be a single valid JSON object. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);
        let geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null;
        if (!geminiData) { geminiData = { stats: {}, key_players: {}, form: {}, tactics: {}, absentees: {}, team_news: {} }; }
        const finalData = {};
        const parseStat = (val, d = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0)) ? val : d;
        const defaultGpHome = (geminiData?.form?.home_overall && geminiData.form.home_overall !== "N/A") ? 5 : 1;
        const defaultGpAway = (geminiData?.form?.away_overall && geminiData.form.away_overall !== "N/A") ? 5 : 1;
        let homeGp = parseStat(geminiData?.stats?.home?.gp, null);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null) homeGp = defaultGpHome;
        if (awayGp === null) awayGp = defaultGpAway;
        finalData.stats = { home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf, null), ga: parseStat(geminiData?.stats?.home?.ga, null) }, away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf, null), ga: parseStat(geminiData?.stats?.away?.ga, null) } };
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: (geminiData?.key_players?.home || []).map(p => ({...p, stats: {}})), away: (geminiData?.key_players?.away || []).map(p => ({...p, stats: {}})) };
        finalData.advanced_stats = { home: { xg: null }, away: { xg: null } };
        finalData.referee = { name: 'N/A', stats: 'N/A' };
        finalData.league_averages = geminiData?.league_averages || {};
        const richContextParts = [ /* ... (VÁLTOZATLAN) ... */ ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni.";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData };
        if (!result.rawStats?.home?.gp || result.rawStats.home.gp <= 0) { throw new Error("Kritikus csapat statisztikák érvénytelenek."); }
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI Studio), cache mentve.`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };
    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData(AI Studio) során: ${e.message}`);
        throw e;
    }
}


// --- ODDS API FUNKCIÓK ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY || ODDS_API_KEY.includes('<')) return null;
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`;
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

async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey) return null;
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`;
    try {
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat, vagy üres a válasz.`);
            if (oddsApiKey !== sportConfig.odds_api_sport_key) {
                return getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
            }
            return null;
        }
        const oddsData = response.data;
        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();
        let bestMatch = null;
        let highestRating = 0.65;
        // JAVÍTÁS: Extra logolás a párosítási hibák felderítésére
        console.log(`Odds API: Keresem "${lowerHome}" vs "${lowerAway}". API-ból kapott meccsek száma: ${oddsData.length}`);
        for (const match of oddsData) {
            if (!match.home_team || !match.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeSim = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating;
            const awaySim = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating;
            const avgSim = (homeSim * 0.6 + awaySim * 0.4);
            if (avgSim > highestRating) {
                highestRating = avgSim;
                bestMatch = match;
            }
        }
        if (!bestMatch) {
            console.warn(`Odds API: Nem találtam megfelelő meccset "${lowerHome}" vs "${lowerAway}" párosításhoz.`);
            return null;
        }
        console.log(`Odds API: A legjobb találat "${bestMatch.home_team}" vs "${bestMatch.away_team}" (${(highestRating*100).toFixed(1)}% egyezés).`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) return null;
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes;
        if (h2h) {
            h2h.forEach(o => { if (o.price > 1) { let n = o.name; if (n === bestMatch.home_team) n = 'Hazai győzelem'; else if (n === bestMatch.away_team) n = 'Vendég győzelem'; else if (n === 'Draw') n = 'Döntetlen'; currentOdds.push({ name: n, price: o.price }); } });
        }
        const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;
        if (totals) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
            if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
            if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
        }
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;
    } catch (e) {
        console.error(`Hiba getOddsData feldolgozásakor: ${e.message}`);
        return null;
    }
}

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
    if (closestPair.diff !== Infinity) return closestPair.line;
    if (points.length > 0) return points.sort((a, b) => Math.abs(a - defaultLine) - Math.abs(b - defaultLine))[0];
    return defaultLine;
}

// --- ESPN MECCSLEKÉRDEZÉS ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) {
        return [];
    }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) continue;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                makeRequest(url, { timeout: 8000 }).then(response => {
                    if (!response?.data?.events) return [];
                    return response.data.events
                        .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                        .map(event => {
                            const competition = event.competitions?.[0];
                            const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team;
                            const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team;
                            if (event.id && home?.name && away?.name && event.date) {
                                return { id: String(event.id), home: String(home.shortDisplayName || home.displayName || home.name).trim(), away: String(away.shortDisplayName || away.displayName || away.name).trim(), utcKickoff: event.date, league: String(leagueName).trim() };
                            }
                            return null;
                        }).filter(Boolean);
                }).catch(() => [])
            );
            await new Promise(resolve => setTimeout(resolve, 30));
        }
    }
    const results = await Promise.all(promises);
    const uniqueFixturesMap = new Map();
    results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) uniqueFixturesMap.set(f.id, f); });
    const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    return finalFixtures;
}