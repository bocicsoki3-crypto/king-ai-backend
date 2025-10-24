/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÉGLEGES JAVÍTÁS: Minden hiányzó AI elemző funkció hozzáadva és exportálva,
 * beleértve a getChatResponse-t is.
 */

// Importáljuk a szükséges függvényeket és konfigurációt
import { getRichContextualData, getOptimizedOddsData, _callGeminiWithSearch, _getFixturesFromEspn } from './DataFetch.js';
import { calculateProbabilities, // Placeholder
         generateProTip,         // Placeholder
         simulateMatchProgress,  // Szükséges lehet
         estimateXG, estimateAdvancedMetrics, calculateModelConfidence,
         calculatePsychologicalProfile, calculateValue, analyzeLineMovement,
         analyzePlayerDuels, buildPropheticTimeline
       } from './Model.js';
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst, the final decision-maker. Your task is to deeply analyze ALL provided reports and determine the SINGLE most compelling betting recommendation based on the holistic synthesis of the narrative and data. **You MUST provide a concrete betting recommendation unless there are EXTREME contradictions AND very low confidence across the board.** Avoid "Nincs fogadás" if possible, instead select the relatively best option and reflect uncertainty in the confidence score. CRITICAL INPUTS (Synthesize these): 1. Value Bets Found: {valueBetsJson} (Consider top value, weigh against risks). 2. Simulation Probabilities: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. (Baseline). 3. Model Confidence (Stats): {modelConfidence}/10 (Data consistency). 4. Expert Confidence (Context): "{expertConfidence}" (Crucial context check - score & reasoning). 5. Risk Assessment: "{riskAssessment}" (MAJOR FOCUS - warnings, contradictions?). 6. Specialist Conclusions: "{microSummary}" (Alignment or disagreement?). 7. General Analysis Narrative: "{generalAnalysis}" (The overall story). 8. Strategic Closing Thoughts: "{strategicClosingThoughts}" (Highlights key angles & risks). YOUR DECISION PROCESS (Narrative Synthesis - PRIORITIZE A TIP): - READ and UNDERSTAND all reports. What is the dominant narrative? - Identify the betting angle most strongly supported by the *convergence* of different analytical perspectives (stats + narrative + risk + specialists). - **If a Value Bet exists:** Is it reasonably supported by the narrative (Expert Confidence > 4.5, Risk Assessment doesn't have critical red flags directly against it)? If yes, lean towards this Value Bet. - **If no compelling Value Bet (or it's too risky):** Identify the outcome most strongly supported by the *combined narrative and statistical evidence* (General Analysis, Strategic Thoughts, high Expert/Model Confidence). This might be the highest probability outcome if confidence is high and risks low, OR it might be an angle highlighted by specialists IF their confidence is high and it aligns with the general narrative. - **Select the Relatively Best Option:** Even if confidence isn't perfect, choose the single market that emerges as the most logical conclusion from the synthesis. - **"Nincs fogadás" is the LAST RESORT:** Only recommend this if there are *multiple, strong, direct contradictions* between key reports (e.g., market moves strongly against ALL indicators), if confidence levels (Model AND Expert) are very low (< 4.5), OR if the reports paint an extremely confusing/contradictory picture. - **Final Confidence (1.0-10.0):** This MUST reflect your synthesized confidence in the chosen bet. If you selected a tip despite some moderate risks or lower confidence scores, the final score should reflect that (e.g., 4.5-6.0). High alignment and low risk warrant higher scores (7.0+). - **Reasoning:** Explain *why this specific bet* is the most compelling choice based on the *synthesis* and what the confidence score implies about its likelihood/risk. If recommending "No Bet", clearly state the extreme contradictions/risks that force this decision. OUTPUT FORMAT: Return ONLY a single, valid JSON object. NO other text or markdown. {"recommended_bet": "<The SINGLE most compelling market (e.g., 'Hazai győzelem', 'Over 2.5', 'Monaco -1.5 AH') OR (rarely) 'Nincs fogadás'>", "final_confidence": <Number between 1.0-10.0 (one decimal) based on synthesis>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the CORE reason for the choice based on SYNTHESIS, reflecting the confidence level. e.g., 'A narratíva és a statisztika egyaránt az Over 2.5 felé mutat, a 6.5/10 bizalom mérsékelt kockázatot jelez.' OR 'Extrém ellentmondások és általánosan alacsony bizalom mellett a 'Nincs fogadás' javasolt.'>"}
`;

const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `
You are an AI Sports Analyst specializing in {specialization}. Analyze the provided data for the match: {homeTeam} vs {awayTeam}. Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5). Data: --- Match: {homeTeam} (Home) vs {awayTeam} (Away) League: {leagueName} Date: {matchDate} Contextual Data (from Google Search and internal knowledge): {richContext} Odds Data (Pinnacle): {oddsString} --- Your Output (Plain Text, Max 3 sentences + prediction): <Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;

const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Your SOLE TASK is to provide a concise, expert tactical briefing (2-4 sentences max) in Hungarian for the {sport} match: {home} vs {away}. CRITICAL RULE: Highlight key tactical terms, player/team names with **asterisks** (use sparingly for maximum impact, only on the most crucial elements). STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT use markdown headers like '###'. Start directly with the analysis. - DO NOT ask questions or ask for clarification. - DO NOT write a letter, introduction, or conclusion. Just the briefing. DATA FOR ANALYSIS: - Clash of Styles: {home} ("{home_style}") vs {away} ("{away_style}"). - Key Duel Analysis: "{duelAnalysis}". - Key Players (Home): {key_players_home} - Key Players (Away): {key_players_away} Synthesize this data. Identify the key tactical battleground on the pitch and predict the likely flow of the game based ONLY on tactics.`;

const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist known for vivid, atmospheric match reports. Your SOLE TASK is to write a compelling, *highly descriptive*, prophetic scenario in Hungarian for the {sport} match: {home} vs {away}, based ONLY on the provided sparse timeline of key events. Write it as a flowing, engaging narrative, like a live match commentary unfolding. CRITICAL: The timeline provides *only* the key inflection points (goals, cards). Your job is to *weave them into a realistic narrative*. Describe the ebb and flow of the game between these events, potential momentum shifts, near-misses, and the general atmosphere. *BE DECISIVE* and specific in your descriptions. Write what *will* happen based on the timeline, not vague possibilities. STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - Write in the *third person*. - DO NOT ask for instructions or confirmation. - DO NOT write a letter or introduction/conclusion. Start directly with the match beginning. - DO NOT include placeholders like '[Esemény]' or repeat the timeline data verbatim. Build a story AROUND the events. - Highlight key moments (goals, cards mentioned in the timeline), player names (if available, otherwise generic terms), team names, and the final predicted outcome with **asterisks**. Use asterisks thoughtfully for emphasis. EVENT TIMELINE (Key moments to build around): {timelineJson} OTHER CONTEXT (Use if helpful for narrative flavor): Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension} EXAMPLE OF A PERFECT RESPONSE (Assuming timeline has an away goal at 28' and home goal at 72'): "A levegő szinte vibrál a stadionban a kezdősípszó pillanatában. Az első percek a **{home}** meddő fölényét hozzák, több pontatlan lövéssel. A 28. percben aztán jön a hidegzuhany: egy villámgyors kontra végén **{away}** megszerzi a vezetést, a stadion elhalkul. A szünetig a vendégek stabilan védekeznek. A második félidőre feltüzelt hazai csapat érkezik, akik beszorítják ellenfelüket. A nyomás a 72. percben érik góllá, egy szöglet utáni kavarodásból **{home}** egyenlít. A véghajrában mindkét oldalon adódik még lehetőség, de az eredmény már nem változik: a lefújáskor **igazságos döntetlen** az állás."`;

const EXPERT_CONFIDENCE_PROMPT = `You are a master sports betting risk analyst. Your SOLE TASK is to provide a final confidence score (out of 10) and a single, concise justification sentence, considering both statistical and contextual factors. STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - The output format must be EXACTLY: **SCORE/10** - Indoklás. (Example: **7.5/10** - A statisztika erős, de a kulcsjátékos hiánya bizonytalanságot okoz.) - DO NOT explain your role or methodology. - DO NOT ask questions. - The justification MUST be a single sentence. DATA: - Statistical Model Confidence: {modelConfidence}/10 - Narrative Context (H2H, News, Tactics, Motivation, Referee, etc.): {richContext} METHOD: Start with the Statistical Model Confidence. Adjust it up or down based on the Narrative Context. - **Decrease score** if context contradicts the stats (e.g., key player injured for the favorite, favorite has very poor recent form despite good season stats, strong H2H record against the favorite, high motivation for underdog). - **Increase score** if context strongly supports the stats (e.g., key player returns for favorite, opponent has key injuries, strong motivation aligns with stats, tactical matchup favors favorite). - Minor contextual factors should have minimal impact; significant factors (key injuries, major motivation difference) should have a larger impact ( +/- 1.0 to 2.5 points). - The final score MUST remain between 1.0 and 10.0. EXAMPLE OF A PERFECT RESPONSE: "**8.5/10** - A statisztikai modell magabiztos, és a kulcsjátékosok hiánya az ellenfélnél tovább erősíti a hazai győzelem esélyét."`;

const RISK_ASSESSMENT_PROMPT = `You are a professional sports risk assessment analyst. Your job is to identify potential pitfalls and reasons why the main prediction might fail. Your SOLE TASK is to write a "Kockázatkezelői Jelentés" in Hungarian. STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT explain your methodology or risk frameworks. - DO NOT ask for more data or offer solutions. - Focus ONLY on the potential risks, uncertainties, and contradictions that could undermine the most likely predicted outcome. Be specific. - Highlight the most significant risk factors with **asterisks**. Use asterisks sparingly for key points. - Keep it concise: 2-4 sentences maximum. DATA FOR ANALYSIS: - Sport: {sport} - Simulation's Most Likely Scenario: Probabilities - H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}% - Market Intelligence (Odds Movement): "{marketIntel}" - Contextual Data Snippets: Team News: H: {news_home}, V: {news_away}. Form: H: {form_home}, V: {form_away}. Motivation: H: {motiv_home}, V: {motiv_away}. TASK: Identify the biggest potential issues. Examples: Does market movement contradict the simulation? Does a key injury (mentioned in Team News) significantly weaken the predicted favorite? Is the favorite's form poor despite the simulation favoring them? Is there a strong motivational factor for the underdog? Focus on concrete points from the data provided.`;

const FINAL_GENERAL_ANALYSIS_PROMPT = `You are the Editor-in-Chief of a prestigious sports analysis publication. Your SOLE TASK is to write the final, overarching summary ("Általános Elemzés") for the match preview, synthesizing the provided data. STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT write a letter, email, or use placeholders like '[Csapat]'. - DO NOT introduce yourself or explain the data sources. - Write a concise, professional summary consisting of exactly TWO paragraphs. - In the first paragraph, clearly state the most likely outcome based on the overall analysis (probabilities and xG) and briefly mention the core statistical reasoning. - In the second paragraph, explain the 'why' behind the prediction by blending insights from the tactical briefing and the prophetic scenario. How is the predicted outcome likely to unfold on the pitch? - Highlight the absolute most important conclusions (e.g., the predicted winner, key tactical factor, expected goal count type like 'kevés gólos') with **asterisks**. Use asterisks SPARINGLY (2-3 times max). DATA TO SYNTHESIZE: - Key Probabilities: Home Win: {sim_pHome}%, Draw: {sim_pDraw}%, Away Win: {sim_pAway}% - Expected Goals (xG): Home {mu_h} - Away {mu_a} - Tactical Briefing Snippet: "{tacticalBriefing}" - Prophetic Scenario Snippet: "{propheticScenario}" Generate the two-paragraph Hungarian summary.`;

const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst preparing for a pre-match briefing. STRICT RULE: Your response must be ONLY in Hungarian. Based SOLELY on the provided context below, formulate the two (2) most critical strategic questions that will likely decide the outcome of the match. These questions should highlight the core uncertainties or key battlegrounds. Present them ONLY as a bulleted list, starting each question with a hyphen (-). Do not add any introduction, explanation, or conclusion. CONTEXT: {richContext}`;

const PLAYER_MARKETS_PROMPT = `You are a specialist analyst focusing on player performance betting markets. Your SOLE TASK is to analyze the provided key players and match context, then suggest 1-2 potentially interesting betting markets related *specifically* to these players. STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT ask what I want you to do or explain your capabilities. - Provide a direct, concise analysis (2-3 sentences maximum). Start directly with the analysis. - Identify specific players by name and suggest concrete markets (e.g., "Gólt szerez", "Lesz 2+ kaput eltaláló lövése", "Kap sárga lapot", "Gólpasszt ad"). - You MUST highlight player names and the specific suggested markets with **asterisks**. Use asterisks only for these elements. DATA: - Key Players (with roles & recent stats if available): {keyPlayersJson} - Match Context (H2H, News, Tactics, Referee): {richContext} Based on the players' roles, their available stats (if any), and the overall match context (e.g., expected tactics, opponent's weakness, referee strictness), what are the most logical player-specific betting angles? Focus on likelihood and reasoning. EXAMPLE OF A PERFECT RESPONSE: "**Erling Haaland** kiváló formája (**5 gól/utolsó 3 meccs**) és a védelem sebezhetősége miatt a **Gólt szerez bármikor** piac tűnik valószínűnek. A másik oldalon **James Ward-Prowse** pontrúgás-specialista, így egy esetleges **Gólpasszt ad** fogadásban lehet érték, különösen, ha sok szabadrúgásra számítunk."`;

const BTTS_ANALYSIS_PROMPT = `You are a BTTS (Both Teams To Score) specialist analyst. Analyze ONLY the potential for both teams to score based strictly on the provided data. DATA: - Simulation Probability (BTTS Yes): {sim_pBTTS}% - Expected Goals (xG): Home {sim_mu_h} - Away {sim_mu_a} - Form (Goals Scored/Conceded Last 5): Home GF/GA: {form_home_gf}/{form_home_ga}, Away GF/GA: {form_away_gf}/{form_away_ga} - Key Attacker News (Home): {news_home_att} - Key Attacker News (Away): {news_away_att} - Key Defender News (Home): {news_home_def} - Key Defender News (Away): {news_away_def} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the likelihood of BTTS (Yes/No). - You MUST highlight your final conclusion (e.g., "**BTTS: Igen valószínű**" or "**BTTS: Nem valószínű**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**magas xG értékek mindkét oldalon**", "**kulcs védők hiánya**", "**mindkét csapat gólerős formája**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data to make your assessment.`;

const SOCCER_GOALS_OU_PROMPT = `You are a Soccer Over/Under Goals specialist analyst. Analyze the potential for total goals scored (Over/Under the main line) based ONLY on the data provided. DATA: - Main Market Line: {line} goals - Simulation Probability (Over {line}): {sim_pOver}% - Expected Goals (xG): Home {sim_mu_h} - Away {sim_mu_a} (Sum: {sim_mu_sum}) - Combined Goals Scored/Conceded Last 5 (Avg per match): {form_avg_goals} - Playing Styles: Home: {style_home}, Away: {style_away} - Key Attacker News (Home): {news_home_att} - Key Attacker News (Away): {news_away_att} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the Over/Under {line} goals market. - You MUST highlight your final conclusion (e.g., "**Over {line} gól várható**" or "**Under {line} gól a valószínűbb**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**magas összesített xG**", "**óvatos játékstílusok**", "**kulcs támadók hiánya**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data to make your assessment relative to the {line} line.`;

const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist analyst. Analyze the potential for total corners based ONLY on the data provided. Suggest a conclusion relative to a likely line (around {likelyLine}). DATA: - Simulation Probabilities (Example for Over {likelyLine}): {sim_oProb}% - Avg Corners For (Home): {adv_home_cor_for} - Avg Corners Against (Home): {adv_home_cor_ag} - Avg Corners For (Away): {adv_away_cor_for} - Avg Corners Against (Away): {adv_away_cor_ag} - Playing Styles: Home: {style_home}, Away: {style_away} (Note tendencies for wide play, crosses, shots) - Combined Shots Per Game: {adv_shots_sum} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the Corners market. Suggest a likely outcome relative to a line like {likelyLine} (e.g., Over/Under 9.5 or 10.5). - You MUST highlight your final conclusion (e.g., "**Over {likelyLine} szöglet várható**" or "**Under {likelyLine} szöglet a valószínűbb**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**mindkét csapat széleken támad**", "**alacsony lövési számok**", "**magas átlagos szögletszámok**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data, considering team styles and historical corner counts.`;

const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards (Bookings) specialist analyst. Analyze the potential for total cards based ONLY on the data provided. Suggest a conclusion relative to a likely line (around {likelyLine}). DATA: - Simulation Probabilities (Example for Over {likelyLine}): {sim_oProb}% - Avg Cards Per Game (Home): {adv_home_cards} - Avg Cards Per Game (Away): {adv_away_cards} - Referee Profile: {ref_name} ({ref_stats}) - Match Tension Index: {tension} - Playing Styles / Aggressiveness: Home: {style_home}, Away: {style_away} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the Cards market. Suggest a likely outcome relative to a line like {likelyLine} (e.g., Over/Under 4.5 or 5.5). - You MUST highlight your final conclusion (e.g., "**Over {likelyLine} lap várható**" or "**Under {likelyLine} lap a valószínűbb**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**szigorú játékvezető**", "**magas meccsfeszültség**", "**csapatok átlagos lapszáma**", "**agresszív játékstílus**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data, giving weight to referee strictness, match tension, and team disciplinary records/styles.`;

const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey Over/Under Goals specialist analyst. Analyze the potential for total goals, focusing heavily on goaltending and special teams performance, based ONLY on the data provided. DATA: - Main Market Line: {line} goals - Simulation Probability (Over {line}): {sim_pOver}% - Expected Goals (xG): Home {sim_mu_h} - Away {sim_mu_a} (Sum: {sim_mu_sum}) - Starting Goalies (Save % - Use recent if available, otherwise season avg): - Home: {goalie_home_name} ({goalie_home_svp}%) - Away: {goalie_away_name} ({goalie_away_svp}%) - Special Teams Matchup: - Home PP ({pp_home}%) vs Away PK ({pk_away}%) - Away PP ({pp_away}%) vs Home PK ({pk_home}%) STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the Over/Under {line} goals market. - You MUST highlight your final conclusion (e.g., "**Over {line} gól várható**" or "**Under {line} gól a valószínűbb**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**mindkét kapus gyenge formában**", "**hatékony emberelőnyös játék**", "**gyenge emberhátrányos védekezés**", "**alacsony xG várakozások**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data. Give significant weight to goalie form and the potential impact of special teams.`;

const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Match Winner (including OT/SO) specialist analyst. Analyze who is more likely to win the match overall based ONLY on the data provided. DATA: - Simulation Probabilities (Incl. OT/SO): Home Win: {sim_pHome}%, Away Win: {sim_pAway}% - Expected Goals (xG, 5v5 Estimate): Home {sim_mu_h} - Away {sim_mu_a} - Starting Goalies (Save % - Use recent if available): - Home: {goalie_home_name} ({goalie_home_svp}%) - Away: {goalie_away_name} ({goalie_away_svp}%) - Special Teams Edge: Analyze Home PP vs Away PK and Away PP vs Home PK. Which team has the clearer advantage? - Home PP ({pp_home}%) vs Away PK ({pk_away}%) - Away PP ({pp_away}%) vs Home PK ({pk_home}%) - Recent Form (Last 5): Home: {form_home}, Away: {form_away} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on predicting the Match Winner (including potential OT/SO). - You MUST highlight your final conclusion (e.g., "**Hazai győzelem (OT-t is beleértve)**" or "**Vendég győzelem (OT-t is beleértve)**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**jobb kapusteljesítmény**", "**határozott speciális egység fölény**", "**kiemelkedő hazai forma**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data. Consider 5v5 play (xG), goaltending, special teams impact, and recent form to determine the most likely winner.`;

const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball Over/Under Total Points specialist analyst. Analyze the potential for total points scored, focusing on pace, offensive/defensive efficiency, and key player availability, based ONLY on the data provided. DATA: - Main Market Line: {line} points - Simulation Probability (Over {line}): {sim_pOver}% - Expected Points (Simulation): Home {sim_mu_h} - Away {sim_mu_a} (Total: {sim_mu_sum}) - Pace: Home: {pace_home}, Away: {pace_away}. (Consider if the pace is likely high or low). - Offensive/Defensive Ratings (if available): Home Off: {off_rtg_home}, Def: {def_rtg_home}. Away Off: {off_rtg_away}, Def: {def_rtg_away} - Key Four Factors Mismatches (Focus on eFG%, TOV%, OREB%, FTR): Where are the biggest mismatches favoring offense or potentially hindering it? - Home FF: {ff_home_json} - Away FF: {ff_away_json} - Key Offensive Player News: Home: {news_home_score}, Away: {news_away_score} STRICT RULES: - Provide a concise, one-paragraph analysis in Hungarian focusing ONLY on the Over/Under {line} points market. - You MUST highlight your final conclusion (e.g., "**Over {line} pont várható**" or "**Under {line} pont a valószínűbb**") with **asterisks**. - You MUST also highlight the 1-2 most important supporting data points or reasons (e.g., "**magas várható tempó**", "**mindkét csapat hatékony támadójátéka**", "**kulcsfontosságú pontszerző hiánya**", "**erős védekezések dominanciája várható**") with **asterisks**. Use asterisks sparingly otherwise. - Conclude the entire response with your confidence level on a new line: "Bizalom: [Alacsony/Közepes/Magas]". Synthesize the data. Pace, offensive ratings vs defensive ratings, and the potential impact of missing key scorers are crucial factors.`;

const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst crafting the "Stratégiai Zárógondolatok". Provide actionable insights by synthesizing all data (specialists included). Focus on promising opportunities AND significant risks. CRITICAL RULE: MUST highlight key arguments, potential markets, team/player names, major risks with **asterisks** (judiciously). STRICT RULES: Hungarian only. Start EXACTLY with "### Stratégiai Zárógondolatok". Write 2-3 paragraphs (no bullets). DO NOT give a single "best bet"; discuss angles & risks. DATA: Scenario: "{propheticScenario}". Stats: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. Market: "{marketIntel}". Micromodels: {microSummaryJson}. Context: {richContext}. Risk Assessment: "{riskAssessment}". TASK: 1. Summarize likely match flow/narrative based on Scenario and Tactical Briefing. 2. Discuss key findings from **micromodels** (confirmation/contradiction/confidence levels). 3. Identify 1-2 promising betting angles suggested by the synthesis (consider Value Bets, specialist confidence, alignment). 4. Point out the **biggest risks or uncertainties** identified in the Risk Assessment or context. Provide balanced insights for strategic decision-making.`;

// --- HELPER a promptok kitöltéséhez ---
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([\w_]+)\}/g, (match, key) => {
        let value = data;
        try {
            if (key in value) {
                value = value[key];
            } else {
                const keys = key.split('_');
                value = data;
                let found = true;
                for (const k of keys) {
                    if (value && typeof value === 'object' && k in value) {
                        value = value[k];
                    } else {
                        found = false;
                        break;
                    }
                }
                if (!found) {
                    if (key.endsWith('Json')) {
                        const baseKey = key.replace('Json', '');
                        if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                            try { return JSON.stringify(data[baseKey]); } catch (e) { return '{}'; }
                        } else {
                            return '{}';
                        }
                    }
                    value = null;
                }
            }
            if (typeof value === 'number' && !isNaN(value)) {
                 if (key.startsWith('sim_p') || key.startsWith('modelConfidence') || key.endsWith('_svp') || key.endsWith('_pct')) return value.toFixed(1);
                 if (key.startsWith('mu_') || key.startsWith('sim_mu_')) return value.toFixed(2);
                 if (key.startsWith('pace_') || key.startsWith('off_rtg_') || key.startsWith('def_rtg_')) return value.toFixed(1);
                 if (key.includes('_cor_') || key.includes('_cards') || key.endsWith('_advantage')) return value.toFixed(1);
                 if (key === 'line' || key === 'likelyLine' || key === 'sim_mainTotalsLine') return value.toString();
                 return value;
            }
            return String(value ?? "N/A");
        } catch (e) {
            console.error(`Hiba a placeholder kitöltésekor: {${key}}`, e);
            return "HIBA";
        }
    });
}

// === Placeholder az ellentmondás-analízishez ===
export async function _getContradictionAnalysis(context, probabilities, odds) {
    console.warn("_getContradictionAnalysis placeholder hívva - ez a funkció jelenleg nincs implementálva.");
    return "Ellentmondás-analízis kihagyva.";
}

// === getAiKeyQuestions ===
export async function getAiKeyQuestions(richContext) {
  if (!richContext || typeof richContext !== 'string') {
      console.error("getAiKeyQuestions: Hiányzó vagy érvénytelen kontextus.");
      return "- Hiba: A kulcskérdések generálásához szükséges kontextus hiányzik.";
  }
  const prompt = fillPromptTemplate(AI_KEY_QUESTIONS_PROMPT, { richContext });
  try {
      const responseText = await _callGeminiWithSearch(prompt);
      return responseText ? responseText.trim() : "- Hiba: Az AI nem tudott kulcskérdéseket generálni.";
  } catch (e) {
      console.error(`getAiKeyQuestions hiba: ${e.message}`);
      return `- Hiba a kulcskérdések generálásakor: ${e.message}`;
  }
}

// === getTacticalBriefing ===
export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis) {
    // console.warn("getTacticalBriefing hívva");
    if (!rawData?.tactics?.home || !rawData?.tactics?.away) {
        return "A taktikai elemzéshez szükséges adatok hiányosak.";
    }
    const data = {
        sport: sport, home: home, away: away,
        home_style: rawData.tactics.home.style || "N/A",
        away_style: rawData.tactics.away.style || "N/A",
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.',
        key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
        key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
    };
    const prompt = fillPromptTemplate(TACTICAL_BRIEFING_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a taktikai elemzés generálása során.";
}

// === getPropheticScenario ===
export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    // console.warn("getPropheticScenario hívva");
     if (!propheticTimeline || !Array.isArray(propheticTimeline)) {
        console.warn("getPropheticScenario: Nincs érvényes idővonal (nem tömb), alapértelmezett forgatókönyv.");
        return `A mérkőzés várhatóan kiegyenlített küzdelmet hoz. Óvatos kezdés után a második félidő hozhatja meg a döntést, de a **kevés gólos döntetlen** reális kimenetel.`;
    }
     const data = {
        sport: sport, home: home, away: away,
        timelineJson: JSON.stringify(propheticTimeline),
        home_style: rawData?.tactics?.home?.style || 'N/A',
        away_style: rawData?.tactics?.away?.style || 'N/A',
        tension: rawData?.contextual_factors?.match_tension_index || 'N/A'
    };
    const prompt = fillPromptTemplate(PROPHETIC_SCENARIO_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a forgatókönyv generálása során.";
}

// === getExpertConfidence ===
export async function getExpertConfidence(modelConfidence, richContext) {
    // console.warn("getExpertConfidence hívva");
    if (typeof modelConfidence !== 'number' || !richContext || typeof richContext !== 'string') {
        console.error("getExpertConfidence: Érvénytelen bemeneti adatok.");
        return "**1.0/10** - Hiba: Érvénytelen adatok a kontextuális bizalomhoz.";
    }
    const data = { modelConfidence: modelConfidence, richContext: richContext };
    const prompt = fillPromptTemplate(EXPERT_CONFIDENCE_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    if (response && response.match(/\*\*\d+(\.\d+)?\/10\*\* - .+./)) {
        return response;
    } else {
        console.error("getExpertConfidence: Az AI válasza érvénytelen formátumú:", response);
        const fallbackConfidence = Math.max(1.0, Math.min(10.0, modelConfidence * 0.8)).toFixed(1);
        return `**${fallbackConfidence}/10** - Figyelmeztetés: Az AI kontextus értékelése sikertelen, a modell bizalma csökkentve.`;
    }
}

// === getRiskAssessment ===
export async function getRiskAssessment(sim, rawData, sport, marketIntel) {
    // console.warn("getRiskAssessment hívva");
    if (!sim || typeof sim.pHome !== 'number' || !rawData || marketIntel === undefined) {
        console.warn("getRiskAssessment: Hiányos bemeneti adatok.");
        return "A kockázatelemzéshez szükséges adatok hiányosak.";
    }
     const data = {
        sport: sport, sim: sim, marketIntel: marketIntel || "N/A",
        news_home: rawData?.team_news?.home || 'N/A', news_away: rawData?.team_news?.away || 'N/A',
        form_home: rawData?.form?.home_overall || 'N/A', form_away: rawData?.form?.away_overall || 'N/A',
        motiv_home: rawData?.contextual_factors?.motivation_home || 'N/A',
        motiv_away: rawData?.contextual_factors?.motivation_away || 'N/A'
    };
    const prompt = fillPromptTemplate(RISK_ASSESSMENT_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a kockázatelemzés generálása során.";
}

// === getFinalGeneralAnalysis ===
export async function getFinalGeneralAnalysis(sim, tacticalBriefing, propheticScenario) {
     // console.warn("getFinalGeneralAnalysis hívva");
     if (!sim || typeof sim.pHome !== 'number' || typeof sim.mu_h_sim !== 'number' || !tacticalBriefing || !propheticScenario) {
         console.warn("getFinalGeneralAnalysis: Hiányos bemeneti adatok.");
         return "Az általános elemzéshez szükséges adatok hiányosak.";
     }
     const data = { sim: sim, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, tacticalBriefing: tacticalBriefing, propheticScenario: propheticScenario };
     const prompt = fillPromptTemplate(FINAL_GENERAL_ANALYSIS_PROMPT, data);
     const response = await _callGeminiWithSearch(prompt);
     return response || "Hiba történt az általános elemzés generálása során.";
 }

// === getPlayerMarkets ===
export async function getPlayerMarkets(keyPlayers, richContext) {
   // console.warn("getPlayerMarkets hívva");
   if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) {
       return "Nincsenek kiemelt kulcsjátékosok.";
   }
   if (!richContext || typeof richContext !== 'string') {
       return "A játékospiacok elemzéséhez kontextus hiányzik.";
   }
   const data = { keyPlayers: keyPlayers, richContext: richContext };
   const prompt = fillPromptTemplate(PLAYER_MARKETS_PROMPT, data);
   const response = await _callGeminiWithSearch(prompt);
   return response || "Hiba történt a játékospiacok elemzése során.";
}

// === PIAC-SPECIFIKUS AI HÍVÁSOK ===

export async function getBTTSAnalysis(sim, rawData) {
    // console.warn("getBTTSAnalysis hívva");
    if (typeof sim?.pBTTS !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData) {
        return "A BTTS elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { sim: sim, form_home_gf: rawData.form?.home_gf ?? 'N/A', form_home_ga: rawData.form?.home_ga ?? 'N/A', form_away_gf: rawData.form?.away_gf ?? 'N/A', form_away_ga: rawData.form?.away_ga ?? 'N/A', news_home_att: rawData.team_news?.home_attackers_missing || 'Nincs hír', news_away_att: rawData.team_news?.away_attackers_missing || 'Nincs hír', news_home_def: rawData.team_news?.home_defenders_missing || 'Nincs hír', news_away_def: rawData.team_news?.away_defenders_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(BTTS_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a BTTS elemzés generálása során. Bizalom: Alacsony";
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getSoccerGoalsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData || typeof mainTotalsLine !== 'number') {
       return `A Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim, form_avg_goals: (((rawData.form?.home_gf ?? 0) + (rawData.form?.home_ga ?? 0) + (rawData.form?.away_gf ?? 0) + (rawData.form?.away_ga ?? 0)) / 10).toFixed(2) || 'N/A', style_home: rawData.tactics?.home?.style || 'N/A', style_away: rawData.tactics?.away?.style || 'N/A', news_home_att: rawData.team_news?.home_attackers_missing || 'Nincs hír', news_away_att: rawData.team_news?.away_attackers_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(SOCCER_GOALS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getCornerAnalysis(sim, rawData) {
    // console.warn("getCornerAnalysis hívva");
    if (!sim?.corners || !rawData?.advanced_stats) {
       return "A Szöglet elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cornerProbs = sim.corners; const cornerKeys = Object.keys(cornerProbs).filter(k => k.startsWith('o')); const likelyLine = cornerKeys.length > 0 ? parseFloat(cornerKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cornerKeys.length / 2)].substring(1)) : 9.5; const overProbKey = `o${likelyLine}`; const overProb = sim.corners[overProbKey];
    const data = { likelyLine: likelyLine, sim: sim, sim_oProb: overProb, // Itt már nem kell toFixed
                   adv_home_cor_for: rawData.advanced_stats?.home?.avg_corners_for_per_game, adv_home_cor_ag: rawData.advanced_stats?.home?.avg_corners_against_per_game,
                   adv_away_cor_for: rawData.advanced_stats?.away?.avg_corners_for_per_game, adv_away_cor_ag: rawData.advanced_stats?.away?.avg_corners_against_per_game,
                   style_home: rawData.tactics?.home?.style, style_away: rawData.tactics?.away?.style,
                   adv_shots_sum: ((rawData.advanced_stats?.home?.shots_per_game || 0) + (rawData.advanced_stats?.away?.shots_per_game || 0)) };
    const prompt = fillPromptTemplate(CORNER_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Szöglet elemzés generálása során. Bizalom: Alacsony";
}

export async function getCardAnalysis(sim, rawData) {
    // console.warn("getCardAnalysis hívva");
    if (!sim?.cards || !rawData?.advanced_stats || !rawData.referee) {
       return "A Lapok elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cardProbs = sim.cards; const cardKeys = Object.keys(cardProbs).filter(k => k.startsWith('o')); const likelyLine = cardKeys.length > 0 ? parseFloat(cardKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cardKeys.length / 2)].substring(1)) : 4.5; const overProbKey = `o${likelyLine}`; const overProb = sim.cards[overProbKey];
    const data = { likelyLine: likelyLine, sim: sim, sim_oProb: overProb, // Nem kell toFixed
                   adv_home_cards: rawData.advanced_stats?.home?.avg_cards_per_game, adv_away_cards: rawData.advanced_stats?.away?.avg_cards_per_game,
                   ref_name: rawData.referee?.name, ref_stats: rawData.referee?.stats,
                   tension: rawData.contextual_factors?.match_tension_index,
                   style_home: rawData.tactics?.home?.style, style_away: rawData.tactics?.away?.style };
    const prompt = fillPromptTemplate(CARD_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Lapok elemzés generálása során. Bizalom: Alacsony";
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getHockeyGoalsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Jégkorong Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim,
                   goalie_home_name: rawData.advanced_stats?.home?.starting_goalie_name, goalie_home_svp: rawData.advanced_stats?.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.home?.goalie_save_pct_season,
                   goalie_away_name: rawData.advanced_stats?.away?.starting_goalie_name, goalie_away_svp: rawData.advanced_stats?.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.away?.goalie_save_pct_season,
                   pp_home: rawData.advanced_stats?.home?.pp_pct, pk_away: rawData.advanced_stats?.away?.pk_pct,
                   pp_away: rawData.advanced_stats?.away?.pp_pct, pk_home: rawData.advanced_stats?.home?.pk_pct };
    const prompt = fillPromptTemplate(HOCKEY_GOALS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Jégkorong Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    // console.warn("getHockeyWinnerAnalysis hívva");
    if (typeof sim?.pHome !== 'number' || !rawData?.advanced_stats || !rawData.form) {
       return "A Jégkorong Győztes elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { sim: sim,
                   goalie_home_name: rawData.advanced_stats?.home?.starting_goalie_name, goalie_home_svp: rawData.advanced_stats?.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.home?.goalie_save_pct_season,
                   goalie_away_name: rawData.advanced_stats?.away?.starting_goalie_name, goalie_away_svp: rawData.advanced_stats?.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.away?.goalie_save_pct_season,
                   pp_home: rawData.advanced_stats?.home?.pp_pct, pk_away: rawData.advanced_stats?.away?.pk_pct,
                   pp_away: rawData.advanced_stats?.away?.pp_pct, pk_home: rawData.advanced_stats?.home?.pk_pct,
                   form_home: rawData.form?.home_overall, form_away: rawData.form?.away_overall };
    const prompt = fillPromptTemplate(HOCKEY_WINNER_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Jégkorong Győztes elemzés generálása során. Bizalom: Alacsony";
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getBasketballPointsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Kosár Pont O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim,
                   pace_home: rawData.advanced_stats?.home?.pace, pace_away: rawData.advanced_stats?.away?.pace,
                   off_rtg_home: rawData.advanced_stats?.home?.offensive_rating, def_rtg_home: rawData.advanced_stats?.home?.defensive_rating,
                   off_rtg_away: rawData.advanced_stats?.away?.offensive_rating, def_rtg_away: rawData.advanced_stats?.away?.defensive_rating,
                   ff_home: rawData.advanced_stats?.home?.four_factors || {}, ff_away: rawData.advanced_stats?.away?.four_factors || {}, // A fillPromptTemplate kezeli a JSON-ná alakítást
                   news_home_score: rawData.team_news?.home_scorers_missing || 'Nincs hír', news_away_score: rawData.team_news?.away_scorers_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(BASKETBALL_POINTS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Kosár Pont O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    // console.warn("getStrategicClosingThoughts hívva");
    if (!sim || !rawData || !richContext || marketIntel === undefined || !microAnalyses || !riskAssessment) {
        return "### Stratégiai Zárógondolatok\nA stratégiai összefoglalóhoz adatok hiányosak.";
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {
        if (!analysis || typeof analysis !== 'string') return null;
        const conclusionMatch = analysis.match(/\*\*(.*?)\*\*/); const confidenceMatch = analysis.match(/Bizalom:\s*(.*)/i);
        return `${key.toUpperCase()}: ${conclusionMatch ? conclusionMatch[1] : 'N/A'} (Bizalom: ${confidenceMatch ? confidenceMatch[1] : 'N/A'})`;
    }).filter(Boolean).join('; ');
    const data = {
        propheticScenario: rawData?.propheticScenario || 'N/A', // Ez a rawData-ban van? Vagy a committeeResults-ban kellene lennie?
        sim: sim, marketIntel: marketIntel || "N/A", microSummary: microSummary || 'Nincsenek', // JSON helyett string
        richContext: richContext, riskAssessment: riskAssessment
     };
     // A fillPromptTemplate kezeli a microSummaryJson kulcsot is
    const prompt = fillPromptTemplate(STRATEGIC_CLOSING_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "### Stratégiai Zárógondolatok\nHiba történt a stratégiai elemzés generálása során.";
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    // console.warn("getMasterRecommendation hívva");
    if (!sim || typeof modelConfidence !== 'number' || !expertConfidence || !riskAssessment || !generalAnalysis || !strategicClosingThoughts) {
         console.error("getMasterRecommendation: Hiányos kritikus bemeneti adatok.");
         return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok." };
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {
        if (!analysis || typeof analysis !== 'string') return null;
        const conclusionMatch = analysis.match(/\*\*(.*?)\*\*/); const confidenceMatch = analysis.match(/Bizalom:\s*(.*)/i);
        return `${key.toUpperCase()}: ${conclusionMatch ? conclusionMatch[1] : 'N/A'} (Bizalom: ${confidenceMatch ? confidenceMatch[1] : 'N/A'})`;
    }).filter(Boolean).join('; ');
    const data = {
        valueBets: valueBets || [], // A fillPromptTemplate kezeli a Json-t
        sim: sim, modelConfidence: modelConfidence, expertConfidence: expertConfidence,
        riskAssessment: riskAssessment, microSummary: microSummary || 'Nincsenek',
        generalAnalysis: generalAnalysis, strategicClosingThoughts: strategicClosingThoughts
    };
    const prompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data);
    try {
        const responseText = await _callGeminiWithSearch(prompt);
        if (!responseText) { throw new Error("Nem érkezett válasz."); }
        let jsonString = responseText;
        let recommendation;
        try { recommendation = JSON.parse(jsonString); } catch (e1) {
             const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/); if (codeBlockMatch && codeBlockMatch[1]) { jsonString = codeBlockMatch[1]; } else { const firstBrace = jsonString.indexOf('{'); const lastBrace = jsonString.lastIndexOf('}'); if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) { jsonString = jsonString.substring(firstBrace, lastBrace + 1); } else { throw new Error("Nem sikerült JSON-t kinyerni: " + responseText.substring(0, 300)); } }
             try { recommendation = JSON.parse(jsonString); } catch(e2) { console.error("Érvénytelen JSON tisztítás után is:", jsonString.substring(0, 500)); throw new Error(`Érvénytelen JSON formátum: ${e2.message}`); }
        }
        if (recommendation?.recommended_bet && typeof recommendation.final_confidence === 'number' && recommendation.brief_reasoning) {
            recommendation.final_confidence = Math.max(1.0, Math.min(10.0, recommendation.final_confidence));
            console.log(`Mester Ajánlás: ${recommendation.recommended_bet} (${recommendation.final_confidence}/10)`);
            return recommendation;
        } else { throw new Error("Érvénytelen JSON struktúra."); }
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`);
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `Hiba: ${e.message.substring(0,100)}` };
    }
}


// --- FŐ ELEMZÉSI FOLYAMAT (runAnalysisFlow) ---
// (Ennek a definíciója már a fájl elején van)

// --- CHAT FUNKCIÓ ---
// JAVÍTÁS: Export kulcsszó hozzáadva a definícióhoz
export async function getChatResponse(context, history, question) {
    if (!context || !question) { // Input validation
        console.error("Chat hiba: Hiányzó kontextus vagy kérdés.");
        return { error: "Hiányzó kontextus vagy kérdés." };
    }
    const validHistory = Array.isArray(history) ? history : []; // History validation

    try {
        // Build history string
        let historyString = validHistory.map(msg => { //
            const role = msg.role === 'user' ? 'Felh' : 'AI'; // Map role
            const text = msg.parts?.[0]?.text || msg.text || ''; // Get text safely
            return `${role}: ${text}`; // Format message
        }).join('\n'); // Join messages

        // Construct prompt
        const prompt = `You are an elite sports analyst AI assistant. Continue the conversation based on the context and history.
Analysis Context (DO NOT repeat, just use): --- ANALYSIS START --- ${context} --- ANALYSIS END ---
Chat History:
${historyString}
Current User Question: ${question}
Your Task: Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History. If the answer isn't there, say so politely. Stay professional. Keep answers brief.`; // Chat prompt

        // Call AI (using search-enabled function - potentially wasteful)
        // TODO: Consider adding a parameter to _callGeminiWithSearch to disable 'tools' for chat
        const answer = await _callGeminiWithSearch(prompt); //

        if (answer) { // If answer received
            let cleanedAnswer = answer.trim(); // Trim whitespace
            // Remove potential markdown code blocks
            const jsonMatch = cleanedAnswer.match(/```json\n([\s\S]*?)\n```/); //
            if (jsonMatch?.[1]) cleanedAnswer = jsonMatch[1]; //

            return { answer: cleanedAnswer }; // Return successful answer
        } else { // If AI call returned null
            console.error("Chat AI hiba: Nem érkezett válasz a Geminitől."); // Log error
            return { error: "Az AI nem tudott válaszolni." }; // Return error object
        }
    } catch (e) { // Catch errors during AI call or processing
        console.error(`Chat hiba: ${e.message}`); // Log error
        return { error: `Chat AI hiba: ${e.message}` }; // Return error object
    }
}


// --- FŐ EXPORT ---
// Exportáljuk az összes szükséges funkciót.
export default {
    runAnalysisFlow,
    getChatResponse, // Most már itt is szerepel
    _getContradictionAnalysis, // Placeholder
    getAiKeyQuestions,
    // Összes többi AI elemző funkció exportálása
    getTacticalBriefing,
    getPropheticScenario,
    getExpertConfidence,
    getRiskAssessment,
    getFinalGeneralAnalysis,
    getPlayerMarkets,
    getMasterRecommendation,
    getStrategicClosingThoughts,
    getBTTSAnalysis,
    getSoccerGoalsOUAnalysis,
    getCornerAnalysis,
    getCardAnalysis,
    getHockeyGoalsOUAnalysis,
    getHockeyWinnerAnalysis,
    getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn // Alias az ESPN lekérdezőhöz
};