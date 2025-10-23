import axios from 'axios';
import NodeCache from 'node-cache';
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY } from './config.js';

const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
const sportmonksIdCache = new NodeCache({ stdTTL: 0 });

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* JAVÍTÁS: A SportMonks ID keresés lecserélve egy robusztus,
* dinamikus kereső és név-összevető logikára.
* A Player API hívás pedig a valós API-SPORTS URL-re cserélve.
**************************************************************/

// --- BELSŐ SEGÉDFÜGGVÉNYEK AZ API-KHOZ ---

async function findSportMonksTeamId(teamName) {
    // JAVÍTÁS: Manuális név-hozzárendelési térkép a leggyakoribb problémás csapatokhoz
    const TEAM_NAME_MAP = {
        'genk': 'KRC Genk',
        'betis': 'Real Betis',
        'red star': 'Red Star Belgrade',
        'sparta': 'Sparta Prague',
        // Ide jöhetnek a jövőben további problémás nevek
    };

    const lowerTeamName = teamName.toLowerCase();
    const searchName = TEAM_NAME_MAP[lowerTeamName] || teamName; // Ha van a térképben, azt használjuk, ha nincs, az eredetit

    const cacheKey = `sportmonks_id_${searchName.toLowerCase().replace(/\s+/g, '')}`;
    const cachedId = sportmonksIdCache.get(cacheKey);
    if (cachedId) {
        return cachedId === 'not_found' ? null : cachedId;
    }

    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return null;
    }

    try {
        const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
        const response = await axios.get(url);

        if (response.data && response.data.data && response.data.data.length > 0) {
            // JAVÍTÁS: Intelligens keresés a találati listában a legjobb egyezésért
            let bestMatch = response.data.data[0];
            if (response.data.data.length > 1) {
                const perfectMatch = response.data.data.find(team => team.name.toLowerCase() === lowerTeamName);
                if (perfectMatch) {
                    bestMatch = perfectMatch;
                }
            }
            const teamId = bestMatch.id;
            console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
            sportmonksIdCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`SportMonks: Nem található ID a következő névvel: "${searchName}" (eredeti: "${teamName}")`);
            sportmonksIdCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`Hiba a SportMonks csapat ID lekérésekor (${searchName}): ${error.message}`);
        return null;
    }
}

async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    const homeTeamId = await findSportMonksTeamId(homeTeamName);
    const awayTeamId = await findSportMonksTeamId(awayTeamName);

    if (!homeTeamId || !awayTeamId) {
        console.log(`_fetchSportMonksData: Hiányzó SportMonks ID a meccshez (${homeTeamName} vs ${awayTeamName}), a lekérdezés kihagyva.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureDate = new Date();
    let fixtureData = null;
    let attempts = 0;

    while (!fixtureData && attempts < 2) {
        const dateString = fixtureDate.toISOString().split('T')[0];
        let url;
        let sportmonksSportKey;
        let include = "statistics";
        
        try {
            switch (sport) {
                case 'soccer': sportmonksSportKey = 'football'; break;
                default: 
                    console.log(`_fetchSportMonksData: A SportMonks jelenleg nem támogatja ezt a sportágat: ${sport}`);
                    return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
            }

            url = `https://api.sportmonks.com/v3/${sportmonksSportKey}/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&include=${include}`;
            console.log(`SportMonks API kérés (${attempts + 1}. próbálkozás): ${homeTeamName} vs ${awayTeamName}`);

            const response = await axios.get(url, { validateStatus: () => true });

            if (response.status !== 200) {
                console.error(`SportMonks API hiba (${response.status}) Dátum: ${dateString}, Válasz: ${JSON.stringify(response.data)?.substring(0, 500)}`);
            } else if (response.data && Array.isArray(response.data.data)) {
                const allFixtures = response.data.data;
                const targetFixture = allFixtures.find(f =>
                    (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                );
                if (targetFixture) {
                    fixtureData = targetFixture;
                    console.log(`SportMonks meccs találat (${dateString}): ${homeTeamName} vs ${awayTeamName}`);
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
        const extractedData = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
        const fixtureStats = fixtureData.statistics || [];
        const homeStatsSM = fixtureStats.find(s => String(s.participant_id) === String(homeTeamId));
        const awayStatsSM = fixtureStats.find(s => String(s.participant_id) === String(awayTeamId));
        
        if (sport === 'soccer' && homeStatsSM) {
            extractedData.advanced_stats.home = {
                xg: homeStatsSM.xg ?? null,
                shots: homeStatsSM.shots_total ?? null,
                shots_on_target: homeStatsSM.shots_on_goal ?? null,
                possession_pct: homeStatsSM.possessiontime ?? null,
                fouls: homeStatsSM.fouls ?? null,
                avg_corners_for_per_game: homeStatsSM.corners ?? null,
            };
        }
        if (sport === 'soccer' && awayStatsSM) {
            extractedData.advanced_stats.away = {
                xg: awayStatsSM.xg ?? null,
                shots: awayStatsSM.shots_total ?? null,
                shots_on_target: awayStatsSM.shots_on_goal ?? null,
                possession_pct: awayStatsSM.possessiontime ?? null,
                fouls: awayStatsSM.fouls ?? null,
                avg_corners_for_per_game: awayStatsSM.corners ?? null,
            };
        }

        console.log(`SportMonks adatok feldolgozva: ${homeTeamName} vs ${awayTeamName}`);
        return extractedData;

    } catch (e) {
        console.error(`Hiba SportMonks adatok feldolgozásakor (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }
}

async function _fetchPlayerData(playerNames) {
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<')) {
        console.log("Player API hívás kihagyva: Nincs valós API kulcs beállítva.");
        return {};
    }
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) { 
        return {};
    }

    const playerData = {};
    const currentYear = new Date().getFullYear();

    for (const playerName of playerNames) {
        try {
            const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(playerName)}&season=${currentYear}`;
            console.log(`Player API kérés: ${playerName}`);

            const response = await axios.get(url, {
                headers: {
                    'x-rapidapi-host': 'v3.football.api-sports.io',
                    'x-rapidapi-key': PLAYER_API_KEY
                }
            });

            if (response.data && response.data.response && response.data.response.length > 0) {
                const playerInfo = response.data.response[0];
                const stats = playerInfo.statistics[0];

                if (stats) {
                    playerData[playerName] = {
                        recent_goals_or_points: stats.goals?.total ?? 0,
                        key_passes_or_assists_avg: stats.passes?.key ?? 0,
                        tackles_or_rebounds_avg: stats.tackles?.total ?? 0
                    };
                } else {
                    playerData[playerName] = {};
                }
            } else {
                 playerData[playerName] = {};
            }
        } catch (error) {
            console.error(`Hiba a Player API hívás során (${playerName}): ${error.response?.data?.message || error.message}`);
            playerData[playerName] = {};
        }
    }
    
    console.log(`Player API adatok lekérve ${Object.keys(playerData).filter(k => Object.keys(playerData[k]).length > 0).length} játékosra.`);
    return playerData;
}

async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error("Hiányzó GEMINI_API_KEY.");
    }
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192
        },
        // A keresés itt szándékosan KI van kapcsolva, hogy a gemini-2.5-pro modell működjön
        // tools: [{ "googleSearchRetrieval": {} }] 
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
            console.error("Teljes Gemini válasz (hiba esetén):", JSON.stringify(result, null, 2));
            throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Ismeretlen'}`);
        }
        return responseText;
    } catch (e) {
        console.error(`Hiba a Gemini API hívás során: ${e.message}`);
        if (e.response?.data) {
            console.error("Axios hiba részletei:", JSON.stringify(e.response.data).substring(0, 500));
        }
        throw e;
    }
}

export async function getRichContextualData(sport, homeTeamName, awayTeamName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v21_advanced_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    } else {
        console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    }
    
    const [geminiResult, sportMonksData] = await Promise.all([
        (async () => {
            let jsonString = "";
            try {
                let contextualFactorsPrompt = `"motivation_home": "<Motivation>", "motivation_away": "<Motivation>", "fatigue_factors": "<Fatigue notes>", "weather": "<Expected weather if relevant>"`;
                if (sport === 'soccer') contextualFactorsPrompt += `, "match_tension_index": "<A 'Low', 'Medium', 'High', or 'Extreme' rating>"`;
                const geminiPrompt = `
                  CRITICAL TASK: Based on your internal knowledge, gather DETAILED NARRATIVE and STRUCTURED data for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}".
                  Focus ONLY on H2H (structured last 5 + tactical pattern analysis), team news (structured key absentees with IMPORTANCE + overall impact analysis), recent form (overall AND home/away separately), expected tactics/style, key players (2-3 per team: name & role), contextual factors (motivation, fatigue, weather, tension), and basic league averages.
                  Provide ONLY a single, valid JSON object as the ENTIRE response. NO other text, markdown (###), or formatting (\`\`\`).
                  DO NOT include xG, PP%, Pace, referee, corner/card stats.
                  JSON STRUCTURE:
                  {
                    "stats": { "home": { "gp": <number>, "gf": <number>, "ga": <number> }, "away": { "gp": <number>, "gf": <number>, "ga": <number> } },
                    "h2h_summary": "<Overall H2H textual summary>",
                    "h2h_structured": [ { "date": "YYYY-MM-DD", "venue": "${homeTeamName} or ${awayTeamName}", "score": "H-A" }, ... ],
                    "h2h_tactical_analysis": "<Brief analysis of tactical patterns observed... N/A if no clear pattern.>",
                    "team_news": { "home": "<General news/morale string>", "away": "<General news/morale string>" },
                    "absentees": { "home": [ { "name": "<Player Name>", "position": "<Position>", "importance": "<'key', 'important', 'squad'>" } ], "away": [ ... ] },
                    "absentee_impact_analysis": "<Brief analysis of the OVERALL impact of absentees... E.g., 'Home team significantly weakened...'>",
                    "form": { "home_overall": "<Last 5 W-D-L>", "away_overall": "<Last 5 W-D-L>", "home_home": "<Last 5 HOME W-D-L>", "away_away": "<Last 5 AWAY W-D-L>" },
                    "tactics": { "home": { "style": "<Style>" }, "away": { "style": "<Style>" } },
                    "key_players": { "home": [ { "name": "<Name>", "role": "<Role>" } ], "away": [ ... ] },
                    "contextual_factors": { ${contextualFactorsPrompt} },
                    "league_averages": { "avg_goals_per_game": <num|null>, "avg_corners": <num|null>, "avg_cards": <num|null>, "avg_offensive_rating": <num|null>, "avg_pace": <num|null>, "home_win_pct": <num|null> }
                  }`;
                const geminiResponseText = await _callGeminiWithSearch(geminiPrompt);
                jsonString = geminiResponseText;
                let geminiData;
                try {
                    geminiData = JSON.parse(jsonString);
                } catch (e1) {
                    const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        jsonString = codeBlockMatch[1];
                    } else {
                        const firstBrace = jsonString.indexOf('{');
                        const lastBrace = jsonString.lastIndexOf('}');
                        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                        } else {
                            throw new Error(`Nem sikerült érvényes JSON-t kinyerni a Gemini válaszból.`);
                        }
                    }
                    geminiData = JSON.parse(jsonString);
                }
                return geminiData;
            } catch (e) {
                console.error(`Súlyos hiba a Gemini adatgyűjtés során: ${e.message}`);
                if (jsonString) console.error("Gemini nyers válasz (hiba esetén):", jsonString.substring(0, 500));
                throw e;
            }
        })(),
        _fetchSportMonksData(sport, homeTeamName, awayTeamName)
    ]);

    try {
        let geminiData = geminiResult;
        let detailedPlayerData = {};
        
        geminiData.stats = geminiData.stats || {};
        geminiData.stats.home = geminiData.stats.home || {};
        geminiData.stats.away = geminiData.stats.away || {};
        geminiData.stats.home.gp = (typeof geminiData.stats.home.gp === 'number' && !isNaN(geminiData.stats.home.gp)) ? geminiData.stats.home.gp : 0;
        geminiData.stats.home.gf = (typeof geminiData.stats.home.gf === 'number' && !isNaN(geminiData.stats.home.gf)) ? geminiData.stats.home.gf : 0;
        geminiData.stats.home.ga = (typeof geminiData.stats.home.ga === 'number' && !isNaN(geminiData.stats.home.ga)) ? geminiData.stats.home.ga : 0;
        geminiData.stats.away.gp = (typeof geminiData.stats.away.gp === 'number' && !isNaN(geminiData.stats.away.gp)) ? geminiData.stats.away.gp : 0;
        geminiData.stats.away.gf = (typeof geminiData.stats.away.gf === 'number' && !isNaN(geminiData.stats.away.gf)) ? geminiData.stats.away.gf : 0;
        geminiData.stats.away.ga = (typeof geminiData.stats.away.ga === 'number' && !isNaN(geminiData.stats.away.ga)) ? geminiData.stats.away.ga : 0;

        const homePlayerNames = geminiData?.key_players?.home?.map(p => p?.name).filter(name => name) || [];
        const awayPlayerNames = geminiData?.key_players?.away?.map(p => p?.name).filter(name => name) || [];
        const playerNames = [...homePlayerNames, ...awayPlayerNames];
        if (playerNames.length > 0) {
            detailedPlayerData = await _fetchPlayerData(playerNames);
        }
        
        let finalData = { ...geminiData };
        finalData.h2h_tactical_analysis = finalData.h2h_tactical_analysis || "N/A";
        finalData.absentee_impact_analysis = finalData.absentee_impact_analysis || "Nincs jelentős hatás.";
        finalData.h2h_summary = finalData.h2h_summary || "Nincs adat";
        finalData.h2h_structured = Array.isArray(finalData.h2h_structured) ? finalData.h2h_structured : [];
        finalData.absentees = finalData.absentees || { home: [], away: [] };
        finalData.absentees.home = Array.isArray(finalData.absentees.home) ? finalData.absentees.home : [];
        finalData.absentees.away = Array.isArray(finalData.absentees.away) ? finalData.absentees.away : [];
        finalData.form = finalData.form || {};
        finalData.form.home_overall = finalData.form.home_overall || "N/A";
        finalData.form.away_overall = finalData.form.away_overall || "N/A";
        finalData.form.home_home = finalData.form.home_home || "N/A";
        finalData.form.away_away = finalData.form.away_away || "N/A";
        finalData.advanced_stats = { ...(sportMonksData.advanced_stats || {}), ...(finalData.advanced_stats || {}) };
        finalData.advanced_stats.home = { ...(sportMonksData.advanced_stats?.home || {}), ...(finalData.advanced_stats?.home || {}) };
        finalData.advanced_stats.away = { ...(sportMonksData.advanced_stats?.away || {}), ...(finalData.advanced_stats?.away || {}) };
        finalData.referee = sportMonksData?.referee?.name && sportMonksData.referee.name !== 'N/A' ? { ...sportMonksData.referee } : (finalData.referee || { name: 'N/A', stats: 'N/A' });
        finalData.tactics = finalData.tactics || { home: { style: "Ismeretlen" }, away: { style: "Ismeretlen" } };
        finalData.team_news = finalData.team_news || { home: "Nincs adat", away: "Nincs adat" };
        finalData.key_players = finalData.key_players || { home: [], away: [] };
        (finalData.key_players.home || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; else if (p) p.stats = {}; });
        (finalData.key_players.away || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; else if (p) p.stats = {}; });

        let richContextParts = [];
        if (finalData.h2h_summary) richContextParts.push(`- **H2H Összefoglaló:** ${finalData.h2h_summary}`);
        if (finalData.h2h_tactical_analysis && finalData.h2h_tactical_analysis !== "N/A") richContextParts.push(`- **H2H Taktikai Minta:** ${finalData.h2h_tactical_analysis}`);
        richContextParts.push(`- **Hírek/Morál:** H: ${finalData.team_news?.home ?? 'N/A'}, V: ${finalData.team_news?.away ?? 'N/A'}`);
        const homeAbsenteesText = finalData.absentees.home.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
        const awayAbsenteesText = finalData.absentees.away.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
        richContextParts.push(`- **Fontos Hiányzók:** H: ${homeAbsenteesText}; V: ${awayAbsenteesText}.`);
        if (finalData.absentee_impact_analysis && finalData.absentee_impact_analysis !== "Nincs jelentős hatás.") richContextParts.push(`- **Hiányzók Összhatása:** ${finalData.absentee_impact_analysis}`);
        richContextParts.push(`- **Forma (Össz):** H: ${finalData.form.home_overall ?? 'N/A'}, V: ${finalData.form.away_overall ?? 'N/A'}`);
        richContextParts.push(`- **Forma (H/V):** H hazai: ${finalData.form.home_home ?? 'N/A'}, V vendég: ${finalData.form.away_away ?? 'N/A'}`);
        richContextParts.push(`- **Taktika:** H: ${finalData.tactics?.home?.style ?? 'N/A'}, V: ${finalData.tactics?.away?.style ?? 'N/A'}`);
        if (finalData.contextual_factors?.match_tension_index) richContextParts.push(`- **Meccs Feszültsége:** ${finalData.contextual_factors.match_tension_index}`);
        const homeGoalie = finalData.advanced_stats?.home?.starting_goalie_name;
        const awayGoalie = finalData.advanced_stats?.away?.starting_goalie_name;
        if (homeGoalie || awayGoalie) richContextParts.push(`- **Kapusok:** H: ${homeGoalie ?? 'N/A'}, V: ${awayGoalie ?? 'N/A'}`);
        if (finalData.referee?.name && finalData.referee.name !== 'N/A') richContextParts.push(`- **Bíró:** ${finalData.referee.name} (${finalData.referee.stats ?? 'N/A'})`);
        let contextLine = '- **Körülmények:** '; let contextDetails = [];
        if (finalData.contextual_factors?.motivation_home || finalData.contextual_factors?.motivation_away) contextDetails.push(`Motiváció: H(${finalData.contextual_factors?.motivation_home ?? 'N/A'}) V(${finalData.contextual_factors?.motivation_away ?? 'N/A'})`);
        if (finalData.contextual_factors?.fatigue_factors) contextDetails.push(`Fáradtság: ${finalData.contextual_factors.fatigue_factors}`);
        if (finalData.contextual_factors?.weather) contextDetails.push(`Időjárás: ${finalData.contextual_factors.weather}`);
        if (contextDetails.length > 0) richContextParts.push(contextLine + contextDetails.join('. '));
        const richContext = richContextParts.join('\n');

        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats,
            form: finalData.form,
            rawData: finalData
        };

        if (typeof result.rawStats.home.gp !== 'number' || typeof result.rawStats.away.gp !== 'number') {
            console.error(`HIBA: Alapértelmezés után is érvénytelen rawStats! ${JSON.stringify(result.rawStats)}`);
            throw new Error("Kritikus hiba: A statisztikai adatok alapértelmezése sikertelen.");
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) {
        console.error(`Súlyos hiba a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        throw new Error(`Bővített adatgyűjtési hiba: ${e.message}`);
    }
}

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
            if (matchData.h2h && Array.isArray(matchData.h2h)) {
                matchData.h2h.forEach(o => {
                    let name = o.name;
                    if (o.name && typeof o.name === 'string') {
                        const lowerName = o.name.toLowerCase();
                        if (lowerName === homeTeam.toLowerCase()) name = sport === 'basketball' ? homeTeam : 'Hazai győzelem';
                        else if (lowerName === awayTeam.toLowerCase()) name = sport === 'basketball' ? awayTeam : 'Vendég győzelem';
                        else if (lowerName === 'draw') name = 'Döntetlen';
                        else name = o.name;
                    } else { name = 'Ismeretlen'; }
                    const price = parseFloat(o.price);
                    if (!isNaN(price) && price > 1) { currentOdds.push({ name: name, price: price }); }
                });
            }
            if (matchData.totals && Array.isArray(matchData.totals)) {
                const mainLine = findMainTotalsLine({ allMarkets: [{ key: 'totals', outcomes: matchData.totals }], sport: sport }) ?? sportConfig.totals_line;
                const overOutcome = matchData.totals.find(o => o.point === mainLine && o.name === 'Over');
                const underOutcome = matchData.totals.find(o => o.point === mainLine && o.name === 'Under');
                if (overOutcome) { const price = parseFloat(overOutcome.price); if (!isNaN(price) && price > 1) { currentOdds.push({ name: `Over ${mainLine}`, price: price }); } }
                if (underOutcome) { const price = parseFloat(underOutcome.price); if (!isNaN(price) && price > 1) { currentOdds.push({ name: `Under ${mainLine}`, price: price }); } }
            }

            if (currentOdds.length > 0) {
                console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`);
                const reconstructedMarkets = [];
                if (matchData.h2h) reconstructedMarkets.push({ key: 'h2h', outcomes: matchData.h2h });
                if (matchData.totals) reconstructedMarkets.push({ key: 'totals', outcomes: matchData.totals });
                return { current: currentOdds, allMarkets: reconstructedMarkets, fromCache: true, sport: sport };
            } else {
                console.log(`Nem sikerült érvényes szorzókat feldolgozni az openingOdds-ból (${key}), friss lekérés indul...`);
            }
        } catch (e) {
            console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}. Friss lekérés indul...`);
        }
    } else {
         console.log(`Nincs nyitó szorzó (frontendről) a ${key} meccshez, friss lekérés indul...`);
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
    if (!sportConfig || !sportConfig.odds_api_leagues) { console.error(`getOddsData: Hiányzó 'odds_api_leagues' konfig ${sport}-hoz.`); return null; }
    const oddsLeagues = sportConfig.odds_api_leagues;
    const url = `https://api.the-odds-api.com/v4/sports/${oddsLeagues}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

    try {
        const response = await axios.get(url, { validateStatus: () => true });
        if (response.status !== 200) {
            console.error(`Odds API hiba (GetOne - ${sport} - ${oddsLeagues}): ${response.status} ${JSON.stringify(response.data)?.substring(0, 500)}`);
            return null;
        }
        const data = response.data;
        if (!Array.isArray(data)) { console.error(`Odds API válasz nem tömb: ${JSON.stringify(data)?.substring(0, 500)}`); return null; }

        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();
        const match = data.find(m => {
             if (!m || !m.home_team || !m.away_team) return false;
             const apiHome = m.home_team.toLowerCase().trim();
             const apiAway = m.away_team.toLowerCase().trim();
             if (apiHome === lowerHome && apiAway === lowerAway) return true;
             if ((apiHome.includes(lowerHome) || lowerHome.includes(apiHome)) && (apiAway.includes(lowerAway) || lowerAway.includes(apiAway)) && Math.abs(apiHome.length - lowerHome.length) < 5 && Math.abs(apiAway.length - lowerAway.length) < 5) {
                console.warn(`Részleges odds egyezés: '${homeTeam}' vs '${awayTeam}' illesztve erre: '${m.home_team}' vs '${m.away_team}'`);
                return true;
             }
             return false;
        });

        if (!match) { console.warn(`Odds API: Nem található meccs: ${homeTeam} vs ${awayTeam} (Ligák: ${oddsLeagues})`); return null; }
        const bookmaker = match.bookmakers?.find(b => b?.key?.toLowerCase() === 'pinnacle');
        if (!bookmaker) { console.warn(`Odds API: Nincs 'pinnacle' odds: ${homeTeam} vs ${awayTeam}`); return null; }

        const h2hMarket = bookmaker.markets?.find(m => m?.key === 'h2h');
        const totalsMarket = bookmaker.markets?.find(m => m?.key === 'totals');
        const currentOdds = [];
        if (h2hMarket?.outcomes && Array.isArray(h2hMarket.outcomes)) {
            h2hMarket.outcomes.forEach(o => {
              if (!o || !o.name) return; let name = o.name;
              if (name === match.home_team) name = sport === 'basketball' ? homeTeam : 'Hazai győzelem';
              else if (name === match.away_team) name = sport === 'basketball' ? awayTeam : 'Vendég győzelem';
              else if (name === 'Draw') name = 'Döntetlen';
              const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { currentOdds.push({name: name, price: price}); }
            });
        }
        if (totalsMarket?.outcomes && Array.isArray(totalsMarket.outcomes)) {
             const mainLine = findMainTotalsLine({ allMarkets: [totalsMarket], sport: sport }) ?? sportConfig.totals_line;
             const overOutcome = totalsMarket.outcomes.find(o => o?.point === mainLine && o?.name === 'Over');
             const underOutcome = totalsMarket.outcomes.find(o => o?.point === mainLine && o?.name === 'Under');
             if (overOutcome) { const price = parseFloat(overOutcome.price); if (!isNaN(price) && price > 1) { currentOdds.push({name: `Over ${mainLine}`, price: price}); } }
             if (underOutcome) { const price = parseFloat(underOutcome.price); if (!isNaN(price) && price > 1) { currentOdds.push({name: `Under ${mainLine}`, price: price}); } }
        }

        if (currentOdds.length > 0) {
           console.log(`Friss szorzók sikeresen lekérve: ${homeTeam} vs ${awayTeam}`);
           return { current: currentOdds, bookmaker: bookmaker.title || 'Pinnacle', allMarkets: bookmaker.markets || [], sport: sport };
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
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) { return defaultLine; }
    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o?.point).filter(p => typeof p === 'number' && !isNaN(p)))];
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o?.point === point && o?.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o?.point === point && o?.name === 'Under');
        if (over?.price && under?.price && typeof over.price === 'number' && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price);
            if (diff < closestPair.diff) { closestPair = { diff, line: point }; }
        }
    }
    return closestPair.line;
}

export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul...");
    let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) {
        console.log(`Nyitó szorzók lekérése: ${sport}...`);
        const sportConfig = SPORT_CONFIG[sport];
        if (!ODDS_API_KEY || !sportConfig.odds_api_leagues) {
            console.warn(`ODDS_API_KEY vagy odds_api_leagues hiányzik ${sport}-hoz.`);
            continue;
        }
        const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_leagues}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

        try {
            const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
            if (response.status !== 200) {
                console.error(`Odds API hiba (GetAll Odds - ${sport}): ${response.status} ${JSON.stringify(response.data)?.substring(0, 500)}`);
                continue;
            }
            const data = response.data;
            if (!Array.isArray(data)) {
                console.error(`Odds API (GetAll Odds - ${sport}): Válasz nem tömb.`);
                continue;
            }

            data.forEach(match => {
                if (!match?.home_team || !match?.away_team) return;
                const key = `${match.home_team.toLowerCase().trim()}_vs_${match.away_team.toLowerCase().trim()}`;
                const bookmaker = match.bookmakers?.find(b => b?.key?.toLowerCase() === 'pinnacle');
                if (!bookmaker) return;
                const h2hMarket = bookmaker.markets?.find(m => m?.key === 'h2h');
                const totalsMarket = bookmaker.markets?.find(m => m?.key === 'totals');
                const odds = {};
                if (h2hMarket?.outcomes) odds.h2h = h2hMarket.outcomes;
                if (totalsMarket?.outcomes) odds.totals = totalsMarket.outcomes;
                if (Object.keys(odds).length > 0) {
                    allOdds[key] = odds;
                }
            });
            console.log(`Odds API (GetAll Odds - ${sport}): ${Object.keys(allOdds).length} meccs szorzója sikeresen feldolgozva (összesen).`);

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
    if (!sportConfig?.name || !sportConfig.espn_leagues) { console.error(`_getFixturesFromEspn: Hiányzó konfig ${sport}-hoz.`); return []; }
    const fixtures = [];
    const today = new Date();
    const espnLeagues = sportConfig.espn_leagues;
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }
    if (!espnLeagues || Object.keys(espnLeagues).length === 0) { console.warn(`Nincs ESPN liga ${sport}-hoz.`); return []; }

    const datesToFetch = [];
    for (let d = 0; d < daysInt; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        datesToFetch.push(`${year}${month}${day}`);
    }

    const promises = [];
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(espnLeagues)) {
            if (!slug) continue;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;

            promises.push(
                axios.get(url, { timeout: 10000, validateStatus: () => true })
                    .then(response => {
                        if (response.status === 200) {
                            const schedule = response.data;
                            const leagueFixtures = [];
                            if (schedule?.events?.length > 0) {
                                schedule.events.forEach(event => {
                                    if (!event?.competitions?.[0]?.competitors || !event.date || !event.id) return;
                                    const competition = event.competitions[0];
                                    const homeTeamData = competition.competitors.find(c => c?.homeAway === 'home');
                                    const awayTeamData = competition.competitors.find(c => c?.homeAway === 'away');
                                    const homeTeamName = homeTeamData?.team?.shortDisplayName || homeTeamData?.team?.displayName || homeTeamData?.team?.name;
                                    const awayTeamName = awayTeamData?.team?.shortDisplayName || awayTeamData?.team?.displayName || awayTeamData?.team?.name;
                                    const eventDate = event.date;
                                    const state = event?.status?.type?.state?.toLowerCase();

                                    if (homeTeamName && awayTeamName && eventDate && (state === 'pre' || state === 'scheduled')) {
                                        leagueFixtures.push({
                                            id: String(event.id),
                                            home: String(homeTeamName).trim(),
                                            away: String(awayTeamName).trim(),
                                            utcKickoff: eventDate,
                                            league: String(leagueName).trim()
                                        });
                                    }
                                });
                            }
                            return leagueFixtures;
                        } else if (response.status !== 404) {
                            console.error(`ESPN hiba ${leagueName} (${slug}, ${dateString}): ${response.status}`);
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
        if (!uniqueFixtures[fixture.id]) {
            uniqueFixtures[fixture.id] = fixture;
        }
    });

    const finalFixtures = Object.values(uniqueFixtures);
    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    return finalFixtures;
}