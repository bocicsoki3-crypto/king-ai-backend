// providers/common/utils.js
// Ez a fájl tartalmazza az összes megosztott, általános segédfüggvényt.

import axios from 'axios';
import {
    GEMINI_API_KEY, GEMINI_MODEL_ID,
    SPORT_CONFIG, API_HOSTS // ESPN és Gemini hívásokhoz szükségesek
} from '../../config.js'; // Figyelj a relatív elérési útra!

/**
 * Általános, hibatűrő API hívó segédfüggvény (az eredeti DataFetch.js-ből)
 * Ezt minden provider használhatja, amelyiknek nincs szüksége egyedi kulcsrotációra.
 */
export async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 25000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };
            
            let response;
            if (method === 'POST') {
                response = await axios.post(url, currentConfig.data || {}, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }

            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                throw error;
            }
            return response;
        } catch (error) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.response.status === 429) {
                    const quotaError = new Error(errorMessage);
                    quotaError.response = error.response;
                    quotaError.isQuotaError = true;
                    throw quotaError; 
                }
                if ([401, 403].includes(error.response.status)) { console.error(`HITELESÍTÉSI HIBA: ${errorMessage}`);
                    return null; 
                }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 25000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
            }
            
            if (attempts > retries) {
                console.error(`API (${method}) hívás végleg sikertelen: ${errorMessage}`);
                throw new Error(`API hívás végleg sikertelen: ${error.message}`);
            }
            console.warn(errorMessage);
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    return null;
}

/**
 * Gemini API Hívó (az eredeti DataFetch.js-ből)
 */
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", }, };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true });
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }
        let potentialJson = responseText.trim();
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            potentialJson = jsonMatch[1].trim();
        }
        JSON.parse(potentialJson); // Validálás
        return potentialJson;
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        throw e;
    }
}

/**
 * Gemini Prompt Generátor (az eredeti DataFetch.js-ből)
 */
export function PROMPT_V43(sport, homeTeamName, awayTeamName, apiSportsHomeSeasonStats, apiSportsAwaySeasonStats, apiSportsH2HData, apiSportsLineups) {
    // ... (Az eredeti PROMPT_V43 teljes tartalma ide kerül) ...
    // (A rövidség kedvéért itt nem másolom be a 100+ sort,
    // de neked át kell másolnod a teljes PROMPT_V43 függvényt ide.)

    // --- PROMPT (NEM VÁLTOZOTT) ---
    // (A DataFetch.gs.txt 253. sorától indul)
    let calculatedStatsInfo = "NOTE ON STATS: No reliable API-Sports season stats available. Please use your best knowledge for the CURRENT SEASON/COMPETITION stats.\n";
    if (apiSportsHomeSeasonStats || apiSportsAwaySeasonStats) {
        calculatedStatsInfo = `CRITICAL NOTE ON STATS: The following basic stats have been PRE-CALCULATED from API-Sports.
Use these exact numbers; do not rely on your internal knowledge for these specific stats.\n`;
        if (apiSportsHomeSeasonStats) {
            calculatedStatsInfo += `Home Calculated (GP=${apiSportsHomeSeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsHomeSeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Home Calculated: N/A\n`; }
        if (apiSportsAwaySeasonStats) {
            calculatedStatsInfo += `Away Calculated (GP=${apiSportsAwaySeasonStats.gamesPlayed ?? 'N/A'}, Form=${apiSportsAwaySeasonStats.form ?? 'N/A'})\n`;
        } else { calculatedStatsInfo += `Away Calculated: N/A\n`; }
    }
    let h2hInfo = "NOTE ON H2H: No reliable H2H data available from API-Sports. Use your general knowledge for H2H summary and potentially older structured data.\n";
    if (apiSportsH2HData && Array.isArray(apiSportsH2HData) && apiSportsH2HData.length > 0) {
        const h2hString = apiSportsH2HData.map(m => `${m.date} (${m.competition}): ${m.home_team} ${m.score} ${m.away_team}`).join('; ');
        h2hInfo = `CRITICAL H2H DATA (from API-Sports, Last ${apiSportsH2HData.length}): ${h2hString}\nUse THIS data to generate the h2h_summary and h2h_structured fields.
Do not use your internal knowledge for H2H.\n`;
        h2hInfo += `Structured H2H (for JSON output): ${JSON.stringify(apiSportsH2HData)}\n`;
    }
    let lineupInfo = "NOTE ON LINEUPS: No API-Sports lineup data available (this is normal if the match is far away). Analyze absentees and formation based on your general knowledge and recent news.\n";
    if (apiSportsLineups && apiSportsLineups.length > 0) {
        const relevantLineupData = apiSportsLineups.map(t => ({
             team: t.team?.name,
             formation: t.formation,
             startXI: t.startXI?.map(p => p.player?.name),
             substitutes: t.substitutes?.map(p => p.player?.name)
        }));
        lineupInfo = `CRITICAL LINEUP DATA (from API-Sports): ${JSON.stringify(relevantLineupData)}\nUse THIS data *first* to determine absentees, key players, and formation.
This is more reliable than general knowledge.\n`;
    }
    return `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.
**CRITICAL: You MUST use the latest factual data provided below (API-Sports) over your general knowledge.**
${calculatedStatsInfo}
${h2hInfo}
${lineupInfo}
AVAILABLE FACTUAL DATA (From API-Sports):
- Home Season Stats: ${JSON.stringify(apiSportsHomeSeasonStats || 'N/A')}
- Away Season Stats: ${JSON.stringify(apiSportsAwaySeasonStats || 'N/A')}
- Recent H2H: ${h2hInfo.substring(0, 500)}... (See full data above if provided)
- Lineups: ${lineupInfo.substring(0, 500)}... (See full data above if provided)
- (NOTE: Real xG data may have been fetched separately and will be used by the model.)

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga (vagy points).
**USE THE PRE-CALCULATED STATS PROVIDED ABOVE.** If not available, use your knowledge.
2. H2H: **Generate 'h2h_summary' AND 'h2h_structured' based PRIMARILY on the API-Sports H2H DATA provided above.**
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis.
**(CRITICAL: Use the API-Sports LINEUP DATA first. If a key player is missing from the 'startXI' or 'substitutes', list them as an absentee).**
4. Recent Form: W-D-L strings (overall).
**(CRITICAL: Use the 'Form' string from the API-Sports Season Stats provided above.)** Provide home_home and away_away based on general knowledge if season stats are limited.
5. Key Players: name, role, recent key stat. **(Use API-Sports LINEUP data to see who is STARTING).**
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation.
**(CRITICAL: Infer formation from the 'formation' field in the API-Sports LINEUP data. If N/A, use your knowledge but state it's an estimate).**
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }.
  9. Key Matchups: Identify 1-2 key positional or player battles.
IF hockey:
  7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }.
IF basketball:
  7. Advanced Styles: Shot Distribution { home: "...", away: "..." }, Defensive Style { home: "...", away: "..." }.
OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately.
STRUCTURE: {
  "stats":{ "home":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> }, "away":{ "gp": <number_or_null>, "gf": <number_or_null>, "ga": <number_or_null> } },
  "h2h_summary":"...",
  "h2h_structured":[...],
  "team_news":{ "home":"...", "away":"..." },
  "absentees":{ "home":[{name, importance, role}], "away":[] },
  "absentee_impact_analysis":"...",
  "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." },
  "key_players":{ "home":[{name, role, stat}], "away":[] },
  "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } },
  "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} },
  "tactical_patterns":{ "home":[], "away":[] },
  "key_matchups":{ "description":"..." },
  "advanced_stats_team":{ "home":{...}, "away":{...} },
  "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} },
  "shot_distribution":{ "home":"...", "away":"..." },
  "defensive_style":{ "home":"...", "away":"..." }, 
  
  "league_averages": { /* Optional: avg_goals_per_game, etc. */ }
}`;
}

/**
 * Időjárás (az eredeti DataFetch.js-ből)
 */
export async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
    console.log(`Időjárás lekérés (placeholder): Helyszín=${stadiumLocation}, Időpont=${utcKickoff}`);
    return {
        temperature_celsius: null,
        description: "N/A"
    };
}

/**
 * ESPN Meccslekérdező (az eredeti DataFetch.js-ből)
 * Ezt a fő DataFetch.js hívja, nem a providerek.
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues) return [];
    
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) return [];
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, leagueData] of Object.entries(sportConfig.espn_leagues)) {
            const slug = leagueData.slug;
            if (!slug) {
                console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`);
                continue;
            }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            // Az 'makeRequest' hívást az utils.js-ből importáltra cseréljük
            promises.push(makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => {
            
                        const competition = event.competitions?.[0];
                        if (!competition) return null;
                        const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                        const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                        if (event.id && homeTeam?.name && awayTeam?.name && event.date) {
                            return {
                                id: String(event.id),
                                home: homeTeam.name.trim(),
                                away: awayTeam.name.trim(),
                                utcKickoff: event.date,
                                league: leagueName.trim()
                            };
                        }
                        return null;
            }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400) {
                    console.warn(`ESPN Hiba (400): Valószínűleg rossz slug '${slug}' (${leagueName})?`);
                } else {
                    console.error(`ESPN Hiba (${leagueName}): ${error.message}`);
                }
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    try {
        const results = await Promise.all(promises);
        const uniqueFixtures = Array.from(new Map(results.flat().map(f => [`${f.home}-${f.away}-${f.utcKickoff}`, f])).values());
        uniqueFixtures.sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
        console.log(`ESPN: ${uniqueFixtures.length} egyedi meccs lekérve a következő ${daysInt} napra.`);
        return uniqueFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}
