import axios from 'axios';
import NodeCache from 'node-cache';
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, SHEET_URL } from './config.js';

const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (JAVÍTOTT - TELJES)
* VÁLTOZÁS: A SportMonks API bekötése a Search végpont használatával,
* a Google Sheet olvasás kiváltására.
**************************************************************/

// --- ÚJ SEGÉDFÜGGVÉNY: SportMonks Csapat ID Keresése Név Alapján (Cache-sel) ---
async function getSportMonksTeamId(teamName, sport) {
    if (!teamName) return null;
    const safeName = teamName.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `sm_id_${sport}_${safeName}`;

    const cachedId = scriptCache.get(cacheKey);
    if (cachedId) {
        return cachedId;
    }

    const sportmonksSportKey = sport === 'soccer' ? 'football' : sport;
    const searchUrl = `https://api.sportmonks.com/v3/${sportmonksSportKey}/teams/search/${encodeURIComponent(teamName)}?api_token=${SPORTMONKS_API_KEY}`;
    
    try {
        const response = await axios.get(searchUrl);
        const teams = response.data?.data;
        
        if (!teams || teams.length === 0) {
            console.warn(`SportMonks: Nem található csapat a '${teamName}' névre.`);
            return null;
        }

        const teamData = teams[0];
        const teamId = teamData.id;

        if (teamId) {
            console.log(`SportMonks ID lekérve API-ból: ${teamName} -> ${teamId}`);
            scriptCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`SportMonks: A talált csapatnak nincs ID-ja: ${teamName}`);
            return null;
        }
    } catch (e) {
        console.error(`Hiba a SportMonks csapat ID lekérésekor (${teamName}): ${e.message}`);
        return null;
    }
}


// --- MÓDOSÍTOTT FUNKCIÓ: A SportMonks Adatgyűjtés Aktiválása ---
async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    if (!SPORTMONKS_API_KEY) {
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    console.log(`SportMonks ID keresés indul: ${homeTeamName} vs ${awayTeamName}...`);
    const [homeTeamId, awayTeamId] = await Promise.all([
        getSportMonksTeamId(homeTeamName, sport),
        getSportMonksTeamId(awayTeamName, sport)
    ]);

    if (!homeTeamId || !awayTeamId) {
        console.warn(`_fetchSportMonksData: Hiányzó SportMonks ID (${homeTeamName}: ${homeTeamId}, ${awayTeamName}: ${awayTeamId}). A funkció leáll.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureDate = new Date();
    let fixtureData = null;
    let attempts = 0;

    while (!fixtureData && attempts < 2) {
        const dateString = fixtureDate.toISOString().split('T')[0];
        let url;
        let sportmonksSportKey;
        let include = "statistics;lineups;referee";

        try {
            switch (sport) {
                case 'soccer': sportmonksSportKey = 'football'; include = "statistics;lineups;referee"; break;
                case 'hockey': sportmonksSportKey = 'hockey'; include = "lineups;statistics"; break;
                case 'basketball': sportmonksSportKey = 'basketball'; include = "statistics"; break;
                default:
                    console.log(`_fetchSportMonksData: Nem támogatott sportág: ${sport}`);
                    return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
            }

            url = `https://api.sportmonks.com/v3/${sportmonksSportKey}/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&include=${include}`;
            console.log(`SportMonks meccskereső API kérés (${attempts + 1}. nap): ${url}`);

            const response = await axios.get(url, { validateStatus: () => true });

            if (response.status !== 200) {
                console.error(`SportMonks API hiba (${response.status}) Dátum: ${dateString}, Válasz: ${JSON.stringify(response.data)?.substring(0, 500)}`);
            } else {
                const allFixtures = response.data?.data;
                if (allFixtures && Array.isArray(allFixtures)) {
                    const targetFixture = allFixtures.find(f =>
                        (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                    );
                    if (targetFixture) {
                        fixtureData = targetFixture;
                        console.log(`SportMonks meccs találat (${dateString}): ${homeTeamName} vs ${awayTeamName}`);
                    }
                }
            }
        } catch (e) {
            console.error(`Általános hiba SportMonks API hívásakor (${dateString}): ${e.message}`);
        }

        if (!fixtureData) {
            fixtureDate.setDate(fixtureDate.getDate() - 1);
        }
        attempts++;
    }

    if (!fixtureData) {
        console.log(`SportMonks: Nem található meccs ${homeTeamName} vs ${awayTeamName} az elmúlt 2 napban.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    try {
        const extractedData = { advanced_stats: { home: {}, away: {} }, referee: {} };
        const fixtureStats = fixtureData.statistics || [];
        const homeStatsSM = fixtureStats.find(s => String(s.participant_id) === String(homeTeamId));
        const awayStatsSM = fixtureStats.find(s => String(s.participant_id) === String(awayTeamId));

        if (sport === 'soccer' && fixtureData.referee && typeof fixtureData.referee === 'object') {
             extractedData.referee = { name: fixtureData.referee.common_name || fixtureData.referee.fullname || 'N/A', stats: String(fixtureData.referee.stats || 'N/A') };
        } else {
             extractedData.referee = { name: 'N/A', stats: 'N/A' };
        }

        if (sport === 'soccer' && homeStatsSM && awayStatsSM) {
            extractedData.advanced_stats.home = {
                xg: homeStatsSM.xg ?? null,
                avg_corners_for_per_game: homeStatsSM.corners_for_avg ?? null,
                shots: homeStatsSM.shots_total ?? null,
                possession_pct: homeStatsSM.possession ?? null,
                fouls: homeStatsSM.fouls ?? null
            };
            extractedData.advanced_stats.away = {
                xg: awayStatsSM.xg ?? null,
                avg_corners_for_per_game: awayStatsSM.corners_for_avg ?? null,
                shots: awayStatsSM.shots_total ?? null,
                possession_pct: awayStatsSM.possession ?? null,
                fouls: awayStatsSM.fouls ?? null
            };
        }

        console.log(`SportMonks adatok feldolgozva: ${homeTeamName} vs ${awayTeamName}`);
        return extractedData;

    } catch (e) {
        console.error(`Hiba SportMonks adatok feldolgozásakor (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }
}

// --- Player API (Változatlan) ---
async function _fetchPlayerData(playerNames) {
    if (!PLAYER_API_KEY) { return {}; }
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) { return {}; }

    const playerData = {};
    const BATCH_SIZE = 5;

    const promises = [];
    for (let i = 0; i < playerNames.length; i += BATCH_SIZE) {
        const batchNames = playerNames.slice(i, i + BATCH_SIZE).map(name => String(name || '').trim()).filter(name => name);
        if (batchNames.length === 0) continue;

        const encodedNames = batchNames.map(name => encodeURIComponent(name));
        const apiUrl = `https://api.playerprovider.com/v1/stats?players=${encodedNames.join(',')}&apiKey=${PLAYER_API_KEY}`;
        console.log(`Player API kérés (batch): ${batchNames.join(', ')}`);

        promises.push(
            axios.get(apiUrl, { validateStatus: () => true })
                .then(response => {
                    if (response.status !== 200) {
                        console.error(`Player API hiba (${response.status}) URL: ${apiUrl} Válasz: ${JSON.stringify(response.data)?.substring(0, 500)}`);
                        return { batchNames, data: [] };
                    }
                    return { batchNames, data: response.data?.data || [] };
                })
                .catch(e => {
                    console.error(`Hiba a Player API hívás során (${batchNames.join(', ')}): ${e.message}`);
                    return { batchNames, data: [] };
                })
        );
    }

    const results = await Promise.all(promises);
    results.forEach(result => {
        result.batchNames.forEach(name => {
            const statsData = result.data.find(p => p?.name?.toLowerCase() === name.toLowerCase());
            const stats = statsData?.stats;
            playerData[name] = stats ? {
                recent_goals_or_points: stats.last5_goals ?? stats.last5_points ?? 0,
                key_passes_or_assists_avg: stats.avg_key_passes ?? stats.avg_assists ?? 0,
                tackles_or_rebounds_avg: stats.avg_tackles ?? stats.avg_rebounds ?? 0
            } : {};
        });
    });

    console.log(`Player API adatok lekérve ${Object.keys(playerData).filter(k => Object.keys(playerData[k]).length > 0).length} játékosra.`);
    return playerData;
}


// --- Gemini API (Változatlan, Keresés Kikapcsolva) ---
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Hiányzó GEMINI_API_KEY.");
    
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192
        }
        // tools: [{ "googleSearchRetrieval": {} }] // KIKAPCSOLVA A KOMPATIBILITÁS MIATT
    };

    try {
        const response = await axios.post(GEMINI_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        if (response.status !== 200) {
            console.error(`Gemini API HTTP hiba (${response.status}): ${JSON.stringify(response.data)?.substring(0, 500)}`);
            throw new Error(`Gemini API hiba (${response.status}).`);
        }

        const result = response.data;
        const candidate = result?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
            console.error(`Gemini API válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. Válasz: ${JSON.stringify(result)?.substring(0, 500)}`);
            if (finishReason === 'SAFETY') throw new Error("Az AI válaszát biztonsági szűrők blokkolták.");
            if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt.");
            throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Ismeretlen'}`);
        }
        return responseText;
    } catch (e) {
        console.error(`Hiba a Gemini API hívás során: ${e.message}`);
        throw e;
    }
}


// --- getRichContextualData (Párhuzamosítva) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v21_advanced_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;

    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    let geminiData = {};
    let sportMonksData = {};
    let jsonString = "";

    try {
        const [geminiResponseText, sportMonksResult] = await Promise.all([
            _callGeminiWithSearch(`CRITICAL TASK: Based on your internal knowledge, provide structured data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Focus on H2H (last 5), team news (key absentees), form (overall/home/away), tactics, key players, contextual factors, and basic league averages. Provide ONLY a single, valid JSON object. DO NOT use Google Search. JSON STRUCTURE: {"stats":{...},"h2h_summary":"...","h2h_structured":[...],"team_news":{...},"absentees":{...},"absentee_impact_analysis":"...","form":{...},"tactics":{...},"key_players":{...},"contextual_factors":{...},"league_averages":{...}}`),
            _fetchSportMonksData(sport, homeTeamName, awayTeamName)
        ]);

        jsonString = geminiResponseText;
        sportMonksData = sportMonksResult;

        try {
            geminiData = JSON.parse(jsonString);
        } catch (e1) {
            const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                jsonString = codeBlockMatch[1];
            } else {
                const firstBrace = jsonString.indexOf('{');
                const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                } else {
                    throw new Error(`Nem sikerült érvényes JSON-t kinyerni a Gemini válaszból.`);
                }
            }
            geminiData = JSON.parse(jsonString);
        }

        geminiData.stats = geminiData.stats || {};
        geminiData.stats.home = geminiData.stats.home || { gp: 0, gf: 0, ga: 0 };
        geminiData.stats.away = geminiData.stats.away || { gp: 0, gf: 0, ga: 0 };
        geminiData.h2h_tactical_analysis = geminiData.h2h_tactical_analysis || "N/A";
        geminiData.absentee_impact_analysis = geminiData.absentee_impact_analysis || "Nincs jelentős hatás.";
        geminiData.h2h_summary = geminiData.h2h_summary || "Nincs adat";
        geminiData.h2h_structured = Array.isArray(geminiData.h2h_structured) ? geminiData.h2h_structured : [];
        geminiData.absentees = geminiData.absentees || { home: [], away: [] };
        geminiData.form = geminiData.form || {};
        geminiData.tactics = geminiData.tactics || { home: { style: "Ismeretlen" }, away: { style: "Ismeretlen" } };
        geminiData.team_news = geminiData.team_news || { home: "Nincs adat", away: "Nincs adat" };
        geminiData.key_players = geminiData.key_players || { home: [], away: [] };
        geminiData.contextual_factors = geminiData.contextual_factors || {};
        geminiData.league_averages = geminiData.league_averages || {};
        
        const playerNames = [...(geminiData?.key_players?.home?.map(p => p.name) || []), ...(geminiData?.key_players?.away?.map(p => p.name) || [])].filter(Boolean);
        const detailedPlayerData = playerNames.length > 0 ? await _fetchPlayerData(playerNames) : {};

        const finalData = { ...geminiData };
        finalData.advanced_stats = { ...(sportMonksData.advanced_stats || {}), ...(finalData.advanced_stats || {}) };
        finalData.referee = sportMonksData?.referee?.name && sportMonksData.referee.name !== 'N/A' ? { ...sportMonksData.referee } : (finalData.referee || { name: 'N/A', stats: 'N/A' });
        
        (finalData.key_players.home || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; });
        (finalData.key_players.away || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; });

        let richContextParts = [];
        if (finalData.h2h_summary) richContextParts.push(`- **H2H Összefoglaló:** ${finalData.h2h_summary}`);
        if (finalData.h2h_tactical_analysis && finalData.h2h_tactical_analysis !== "N/A") richContextParts.push(`- **H2H Taktikai Minta:** ${finalData.h2h_tactical_analysis}`);
        richContextParts.push(`- **Hírek/Morál:** H: ${finalData.team_news?.home ?? 'N/A'}, V: ${finalData.team_news?.away ?? 'N/A'}`);
        const homeAbsenteesText = (finalData.absentees.home || []).map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
        const awayAbsenteesText = (finalData.absentees.away || []).map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
        richContextParts.push(`- **Fontos Hiányzók:** H: ${homeAbsenteesText}; V: ${awayAbsenteesText}.`);
        if (finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "Nincs jelentős hatás.") richContextParts.push(`- **Hiányzók Összhatása:** ${finalData.absentee_impact_analysis}`);
        richContextParts.push(`- **Forma (Össz):** H: ${finalData.form.home_overall ?? 'N/A'}, V: ${finalData.form.away_overall ?? 'N/A'}`);
        richContextParts.push(`- **Forma (H/V):** H hazai: ${finalData.form.home_home ?? 'N/A'}, V vendég: ${finalData.form.away_away ?? 'N/A'}`);
        richContextParts.push(`- **Taktika:** H: ${finalData.tactics?.home?.style ?? 'N/A'}, V: ${finalData.tactics?.away?.style ?? 'N/A'}`);
        if (finalData.contextual_factors?.match_tension_index) richContextParts.push(`- **Meccs Feszültsége:** ${finalData.contextual_factors.match_tension_index}`);
        if (finalData.referee?.name && finalData.referee.name !== 'N/A') richContextParts.push(`- **Bíró:** ${finalData.referee.name} (${finalData.referee.stats ?? 'N/A'})`);
        const richContext = richContextParts.join('\n');
        
        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats,
            form: finalData.form,
            rawData: finalData
        };

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) {
        console.error(`Súlyos hiba a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        if (jsonString) console.error("Gemini nyers válasz (hiba esetén):", jsonString.substring(0, 500));
        throw e;
    }
}


// --- Odds Data Functions ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds) {
    if (!ODDS_API_KEY) {
        console.log("Nincs ODDS_API_KEY beállítva.");
        return null;
    }
    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`;

    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key];
            const currentOdds = [];
            if (matchData.h2h) {
                matchData.h2h.forEach(o => {
                    let name = o.name;
                    if (o.name.toLowerCase() === homeTeam.toLowerCase()) name = sport === 'basketball' ? homeTeam : 'Hazai győzelem';
                    else if (o.name.toLowerCase() === awayTeam.toLowerCase()) name = sport === 'basketball' ? awayTeam : 'Vendég győzelem';
                    else if (o.name.toLowerCase() === 'draw') name = 'Döntetlen';
                    currentOdds.push({ name: name, price: o.price });
                });
            }
            if (matchData.totals) {
                const mainLine = findMainTotalsLine({ allMarkets: [{ key: 'totals', outcomes: matchData.totals }], sport: sport }) ?? sportConfig.totals_line;
                const overOutcome = matchData.totals.find(o => o.point === mainLine && o.name === 'Over');
                const underOutcome = matchData.totals.find(o => o.point === mainLine && o.name === 'Under');
                if (overOutcome) currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price });
                if (underOutcome) currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price });
            }

            if (currentOdds.length > 0) {
                console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`);
                const reconstructedMarkets = [];
                if (matchData.h2h) reconstructedMarkets.push({ key: 'h2h', outcomes: matchData.h2h });
                if (matchData.totals) reconstructedMarkets.push({ key: 'totals', outcomes: matchData.totals });
                return { current: currentOdds, allMarkets: reconstructedMarkets, fromCache: true, sport: sport };
            }
        } catch (e) {
             console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}. Friss lekérés indul...`);
        }
    }

    const cacheKey = `live_odds_${sport}_${key}`;
    const cachedOdds = scriptCache.get(cacheKey);
    if (cachedOdds) {
        console.log(`Élő szorzók használva (cache) a ${key} meccshez.`);
        return { ...cachedOdds, fromCache: true };
    }

    console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam}`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig);

    if (liveOddsData && liveOddsData.current.length > 0) {
        scriptCache.set(cacheKey, liveOddsData, 60 * 15);
    }

    return liveOddsData;
}

async function getOddsData(homeTeam, awayTeam, sport, sportConfig) {
    if (!ODDS_API_KEY) { console.error("getOddsData: Nincs ODDS_API_KEY."); return null; }
    const oddsApiKey = sportConfig.odds_api_sport_key || sportConfig.odds_api_key;
    if (!oddsApiKey) { console.error(`getOddsData: Hiányzó konfig/kulcs ${sport}-hoz.`); return null; }
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

    try {
        const response = await axios.get(url, { validateStatus: () => true });
        if (response.status !== 200) {
            console.error(`Odds API hiba (GetOne - ${sport}): ${response.status} ${JSON.stringify(response.data)?.substring(0, 500)}`);
            return null;
        }
        const data = response.data;
        if (!Array.isArray(data)) { console.error(`Odds API válasz nem tömb.`); return null; }

        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();
        const match = data.find(m => {
             const apiHome = m.home_team.toLowerCase().trim();
             const apiAway = m.away_team.toLowerCase().trim();
             if (apiHome === lowerHome && apiAway === lowerAway) return true;
             if ((apiHome.includes(lowerHome) || lowerHome.includes(apiHome)) && (apiAway.includes(lowerAway) || lowerAway.includes(apiAway))) {
                console.warn(`Részleges odds egyezés: '${homeTeam}' vs '${awayTeam}' illesztve erre: '${m.home_team}' vs '${m.away_team}'`);
                return true;
             }
             return false;
        });

        if (!match) { console.warn(`Odds API: Nem található meccs: ${homeTeam} vs ${awayTeam}`); return null; }
        const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker) { console.warn(`Odds API: Nincs 'pinnacle' odds: ${homeTeam} vs ${awayTeam}`); return null; }

        const h2hMarket = bookmaker.markets?.find(m => m.key === 'h2h');
        const totalsMarket = bookmaker.markets?.find(m => m.key === 'totals');
        const currentOdds = [];
        if (h2hMarket?.outcomes) {
            h2hMarket.outcomes.forEach(o => {
              let name = o.name;
              if (name === match.home_team) name = sport === 'basketball' ? homeTeam : 'Hazai győzelem';
              else if (name === match.away_team) name = sport === 'basketball' ? awayTeam : 'Vendég győzelem';
              else if (name === 'Draw') name = 'Döntetlen';
              currentOdds.push({name: name, price: o.price});
            });
        }
        if (totalsMarket?.outcomes) {
             const mainLine = findMainTotalsLine({ allMarkets: [totalsMarket], sport: sport }) ?? sportConfig.totals_line;
             const overOutcome = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Over');
             const underOutcome = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Under');
             if (overOutcome) currentOdds.push({name: `Over ${mainLine}`, price: overOutcome.price});
             if (underOutcome) currentOdds.push({name: `Under ${mainLine}`, price: underOutcome.price});
        }

        if (currentOdds.length > 0) {
           console.log(`Friss szorzók sikeresen lekérve: ${homeTeam} vs ${awayTeam}`);
           return { current: currentOdds, bookmaker: bookmaker.title, allMarkets: bookmaker.markets, sport: sport };
        } else {
           console.warn(`Nem sikerült érvényes friss szorzókat lekérni: ${homeTeam} vs ${awayTeam}`);
           return null;
        }
    } catch (e) {
        console.error(`getOddsData hiba (${homeTeam} vs ${awayTeam}): ${e.message}`);
        return null;
    }
}

export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    if (!oddsData?.allMarkets || !Array.isArray(oddsData.allMarkets) || !oddsData.sport) { return defaultLine; }
    const totalsMarket = oddsData.allMarkets.find(m => m?.key === 'totals');
    if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) { return defaultLine; }
    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        if (over?.price && under?.price) {
            const diff = Math.abs(over.price - under.price);
            if (diff < closestPair.diff) { closestPair = { diff, line: point }; }
        }
    }
    return closestPair.line;
}


// --- Fixture Fetching ---
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul...");
    let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) {
        const sportConfig = SPORT_CONFIG[sport];
        const oddsApiKey = sportConfig?.odds_api_sport_key;
        if (!ODDS_API_KEY || !oddsApiKey) continue;
        const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

        try {
            const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
            if (response.status !== 200) {
                console.error(`Odds API hiba (GetAll Odds - ${sport}): ${response.status}`);
                continue;
            }
            const data = response.data;
            if (!Array.isArray(data)) continue;

            data.forEach(match => {
                if (!match?.home_team || !match?.away_team) return;
                const key = `${match.home_team.toLowerCase().trim()}_vs_${match.away_team.toLowerCase().trim()}`;
                const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
                if (!bookmaker) return;
                const h2hMarket = bookmaker.markets?.find(m => m.key === 'h2h');
                const totalsMarket = bookmaker.markets?.find(m => m.key === 'totals');
                const odds = {};
                if (h2hMarket?.outcomes) odds.h2h = h2hMarket.outcomes;
                if (totalsMarket?.outcomes) odds.totals = totalsMarket.outcomes;
                if (Object.keys(odds).length > 0) allOdds[key] = odds;
            });
        } catch (e) {
            console.error(`_fetchOpeningOddsForAllSports hiba (${sport}): ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`);
    return allOdds;
}

export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.name || !sportConfig.espn_leagues) return [];
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0) return [];

    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setDate(date.getDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });

    const promises = [];
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) continue;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                axios.get(url, { timeout: 10000, validateStatus: () => true })
                    .then(response => {
                        if (response.status === 200 && response.data?.events) {
                            return response.data.events.map(event => {
                                const competition = event.competitions[0];
                                const homeTeamData = competition.competitors.find(c => c.homeAway === 'home');
                                const awayTeamData = competition.competitors.find(c => c.homeAway === 'away');
                                const homeTeamName = homeTeamData?.team?.displayName;
                                const awayTeamName = awayTeamData?.team?.displayName;
                                const state = event?.status?.type?.state?.toLowerCase();
                                if (homeTeamName && awayTeamName && (state === 'pre' || state === 'scheduled')) {
                                    return {
                                        id: event.id,
                                        home: homeTeamName.trim(),
                                        away: awayTeamName.trim(),
                                        utcKickoff: event.date,
                                        league: leagueName.trim()
                                    };
                                }
                                return null;
                            }).filter(Boolean);
                        }
                        return [];
                    })
                    .catch(e => {
                        console.error(`Hiba ${leagueName} (${slug}, ${dateString}) ESPN lekérésekor: ${e.message}`);
                        return [];
                    })
            );
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    const results = await Promise.all(promises);
    const uniqueFixtures = {};
    results.flat().forEach(fixture => {
        if (!uniqueFixtures[fixture.id]) uniqueFixtures[fixture.id] = fixture;
    });

    const finalFixtures = Object.values(uniqueFixtures);
    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    return finalFixtures;
}