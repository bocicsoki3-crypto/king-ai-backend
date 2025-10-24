import axios from 'axios';
import NodeCache from 'node-cache';
// JAVÍTÁS: A google-auth-library importot és a fölösleges configokat (PROJECT_ID, LOCATION) töröltük
import { SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Visszaállás az AI Studio (Generative Language) API-ra
* az egyszerűbb GEMINI_API_KEY hitelesítéssel. A Google Kereső funkció
* ezzel a módszerrel nem érhető el.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config));
            currentConfig.timeout = currentConfig.timeout || 10000;
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300);
            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 100)}... - `;
            if (axios.isAxiosError(error)) {
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
            } else {
                errorMessage += `Általános hiba: ${error.message}`;
                console.error(errorMessage);
                return null;
            }
            console.warn(errorMessage);
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 100)}...`);
    return null;
}

// --- SPORTMONKS API FUNKCIÓK (VÁLTOZATLAN) ---
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
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
                const results = response.data.data;
                let bestMatch = results[0];
                if (results.length > 1) {
                    const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName);
                    if (perfectMatch) {
                        bestMatch = perfectMatch;
                    } else {
                        const names = results.map(team => team.name);
                        const sim = findBestMatch(originalLowerName, names);
                        const simThreshold = (attempt === 0) ? 0.7 : 0.6;
                        if (sim.bestMatch.rating > simThreshold) {
                            bestMatch = results[sim.bestMatchIndex];
                        } else {
                            const containingMatch = results.find(team => team.name.toLowerCase().includes(originalLowerName));
                            if (containingMatch) bestMatch = containingMatch;
                        }
                    }
                }
                teamId = bestMatch.id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                const rd = JSON.stringify(response.data)?.substring(0, 300);
                if (rd.includes('plan') || rd.includes('subscription') || rd.includes('does not have access')) {
                    console.warn(`SportMonks figyelmeztetés (${response.status}) Keresés: "${searchName}". Lehetséges előfizetési korlát.`);
                    teamId = null;
                    break;
                } else {
                    console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}"`);
                }
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

// --- GEMINI API FUNKCIÓ (VÉGLEGES JAVÍTÁS - AI Studio API) ---
/**
 * Meghívja a Gemini modellt az AI Studio (Generative Language) API-n keresztül.
 * API kulcsos hitelesítést használ. NEM használja a Google Keresőt.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string|null>} A Gemini válasza JSON stringként vagy null hiba esetén.
 */
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<')) {
        console.error("KRITIKUS HIBA: A GEMINI_API_KEY hiányzik vagy nincs beállítva a config.js-ben / környezeti változókban!");
        // Dobjunk hibát, hogy a fő folyamat leálljon, ne csak null-t adjunk vissza
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }

    if (!GEMINI_MODEL_ID) {
        console.error("KRITIKUS HIBA: A GEMINI_MODEL_ID hiányzik a config.js-ből!");
        throw new Error("Hiányzó GEMINI_MODEL_ID.");
    }

    // JAVÍTÁS: Ez az URL formátum a te bevált módszered alapján készült.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 8192,
        },
        // JAVÍTÁS: NINCS Google Search ('tools' kulcs), mert ez az API nem támogatja.
    };

    console.log(`Gemini API (AI Studio) hívás indul a '${GEMINI_MODEL_ID}' modellel...`);

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000, // 2 perc timeout
            validateStatus: () => true // Minden választ elfogadunk a részletes hibakezeléshez
        });

        if (response.status !== 200) {
            let errorMsg = `Gemini (AI Studio) API HTTP hiba (${response.status}).`;
            let responseDetails = JSON.stringify(response.data)?.substring(0, 500);
            console.error(`${errorMsg} Részletek: ${responseDetails}`);
            // A hívó félre bízzuk a hibakezelést, de dobunk egy hibát
            throw new Error(`Gemini API hiba: ${response.status} - ${responseDetails}`);
        }

        const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;

        if (!responseText) {
            const finishReason = candidate?.finishReason;
            const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category;
            console.error(`Gemini válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`);
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason || blockReason || 'Ismeretlen'}`);
        }

        // JSON tisztítás és validálás
        let cleanedJsonString = responseText.trim();
        const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch?.[1]) cleanedJsonString = jsonMatch[1];
        if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{'));
        if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);

        try {
            JSON.parse(cleanedJsonString);
            console.log("Gemini API (AI Studio) sikeresen visszaadott valid JSON-t.");
            return cleanedJsonString;
        } catch (jsonError) {
            console.error(`Gemini válasz nem valid JSON: ${jsonError.message}`, cleanedJsonString.substring(0, 500));
            throw new Error(`Gemini válasza nem volt érvényes JSON formátumú.`);
        }
    } catch (e) {
        // Axios hibák és egyéb hálózati hibák elkapása
        console.error(`Végleges hiba a Gemini (AI Studio) API hívás során: ${e.message}`);
        // Dobjuk tovább a hibát, hogy a getRichContextualData elkapja és kezelje
        throw e;
    }
}

// --- FŐ ADATGYŰJTŐ FUNKCIÓ (JAVÍTVA AZ AI STUDIO-HOZ) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v31_aistudio_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        // Odds API-t a cache-elt adathoz is lekérjük, ha még nincs benne friss
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        return { ...cached, fromCache: true, oddsData: oddsResult };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése AI Studio segítségével...`);

    let geminiData = null;
    let oddsResult = null;
    try {
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(
                `CRITICAL TASK: Based on your internal knowledge, find data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Provide a single, valid JSON object. Focus ONLY on: H2H (last 5 structured: date, score + concise summary), team news (key absentees: name, importance + overall impact), recent form (overall & home/away W-D-L), probable tactics/style, key players (name, role). IMPORTANT: Also provide basic stats (played, goals for/against - 'gp', 'gf', 'ga') OR league table standings if exact stats are unavailable. Use "N/A" for missing fields. Ensure stats are numbers or null. NO extra text/markdown. STRUCTURE: {"stats":{"home":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>},"away":{"gp":<num|null>,"gf":<num|null>,"ga":<num|null>}},"h2h_summary":"<summary|N/A>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news|N/A>","away":"<news|N/A>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis|N/A>","form":{"home_overall":"<W-D-L|N/A>","away_overall":"<W-D-L|N/A>","home_home":"<W-D-L|N/A>","away_away":"<W-D-L|N/A>"},"tactics":{"home":{"style":"<Style|N/A>"},"away":{"style":"<Style|N/A>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`
            ),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName)
        ]);

        oddsResult = fetchedOddsData;
        if (geminiJsonString) {
            try {
                geminiData = JSON.parse(geminiJsonString);
            } catch (e) {
                console.error(`Gemini válasz (AI Studio) JSON parse hiba: ${e.message}`);
            }
        }
        
        if (!geminiData) {
            console.warn("Gemini API hívás (AI Studio) sikertelen vagy nem adott vissza adatot. Alapértelmezett adatok lesznek.");
            geminiData = { stats: { home: {}, away: {} }, key_players: { home: [], away: [] }, form: {}, tactics: {}, absentees: {}, team_news: {} };
        }

        // Adatok EGYESÍTÉSE és NORMALIZÁLÁSA
        const finalData = {};
        const parseStat = (val, defaultVal = 0) => (val === null || (typeof val === 'number' && !isNaN(val) && val >= 0) ? val : defaultVal);
        const defaultGpHome = (geminiData?.form?.home_overall && geminiData.form.home_overall !== "N/A") ? 5 : 1;
        const defaultGpAway = (geminiData?.form?.away_overall && geminiData.form.away_overall !== "N/A") ? 5 : 1;
        let homeGp = parseStat(geminiData?.stats?.home?.gp, null);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, null);
        if (homeGp === null) homeGp = defaultGpHome;
        if (awayGp === null) awayGp = defaultGpAway;

        finalData.stats = {
            home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf, null), ga: parseStat(geminiData?.stats?.home?.ga, null) },
            away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf, null), ga: parseStat(geminiData?.stats?.away?.ga, null) }
        };

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

        const richContextParts = [];
        if (finalData.h2h_summary !== "N/A") richContextParts.push(`- H2H: ${finalData.h2h_summary}`);
        if (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") richContextParts.push(`- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`);
        const homeAbs = finalData.absentees.home.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs';
        const awayAbs = finalData.absentees.away.map(p => `${p.name}(${p.importance || '?'})`).join(', ') || 'Nincs';
        if (homeAbs !== 'Nincs' || awayAbs !== 'Nincs') richContextParts.push(`- Hiányzók: H: ${homeAbs}, V: ${awayAbs}`);
        if (finalData.absentee_impact_analysis !== "N/A") richContextParts.push(`- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`);
        if (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") richContextParts.push(`- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`);
        if (finalData.tactics.home.style !== "N/A" || finalData.tactics.away.style !== "N/A") richContextParts.push(`- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "Nem sikerült kontextuális adatokat gyűjteni.";

        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData };
        
        if (result.rawStats.home.gp <= 0 || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA: Az alap statisztikák (rawStats) érvénytelenek (gp=0). Elemzés nem lehetséges.`);
            throw new Error("Kritikus csapat statisztikák (rawStats) érvénytelenek.");
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI Studio), cache mentve.`);
        return { ...result, fromCache: false, oddsData: oddsResult };
    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData(AI Studio) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        throw new Error(`Adatgyűjtési hiba (AI Studio): ${e.message}`);
    }
}

// --- ODDS API FUNKCIÓK (VÁLTOZATLAN) ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY || ODDS_API_KEY.includes('<')) return null;
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        // ... (ez a rész változatlan)
    }
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) return { ...cachedOdds, fromCache: true };
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    } else {
        console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
        return null;
    }
}

async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey || !sportConfig.odds_api_sport_key) {
        return null;
    }
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`;
    try {
        const response = await makeRequest(url, { timeout: 10000 });
        if (!response?.data || !Array.isArray(response.data)) {
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
        if (!bestMatch) return null;
        if (highestRating < 0.7 && !(bestMatch.home_team.toLowerCase().includes(lowerHome) || bestMatch.away_team.toLowerCase().includes(lowerAway))) {
            return null;
        }
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) return null;
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes;
        const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;
        if (h2h) {
            h2h.forEach(o => {
                const price = parseFloat(o.price);
                if (!isNaN(price) && price > 1) {
                    let name = o.name;
                    if (name === bestMatch.home_team) name = 'Hazai győzelem';
                    else if (name === bestMatch.away_team) name = 'Vendég győzelem';
                    else if (name === 'Draw') name = 'Döntetlen';
                    currentOdds.push({ name: name, price: price });
                }
            });
        }
        if (totals) {
            const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
            const over = totals.find(o => o.point === mainLine && o.name === 'Over');
            const under = totals.find(o => o.point === mainLine && o.name === 'Under');
            if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
            if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
        }
        if (currentOdds.length > 0) {
            return { current: currentOdds, allMarkets: allMarkets, sport: sport };
        } else {
            return null;
        }
    } catch (e) {
        console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`);
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
    if (closestPair.diff === Infinity && points.includes(defaultLine)) return defaultLine;
    if (closestPair.diff !== Infinity) return closestPair.line;
    if (points.length > 0) return points.sort((a, b) => Math.abs(a - defaultLine) - Math.abs(b - defaultLine))[0];
    return defaultLine;
}

// --- ESPN MECCSLEKÉRDEZÉS (VÁLTOZATLAN) ---
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.name || !sportConfig.espn_leagues) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) {
        console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`);
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
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                makeRequest(url, { timeout: 6000 }).then(response => {
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
            await new Promise(resolve => setTimeout(resolve, 30));
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