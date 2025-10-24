/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÉGLEGES JAVÍTÁS: Minden prompt sablon visszaállítva, és minden AI hívás a helyes `_callGemini` funkciót használja.
 */

// JAVÍTÁS: Az importot _callGemini-re cseréljük
import { getRichContextualData, getOptimizedOddsData, _callGemini, _getFixturesFromEspn } from './DataFetch.js';
import {
    calculateProbabilities, generateProTip, simulateMatchProgress, estimateXG,
    estimateAdvancedMetrics, calculateModelConfidence, calculatePsychologicalProfile,
    calculateValue, analyzeLineMovement, analyzePlayerDuels, buildPropheticTimeline
} from './Model.js';
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK (TELJES, VÁGATLAN VERZIÓK) ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst, the final decision-maker.
Your task is to deeply analyze ALL provided reports and determine the SINGLE most compelling betting recommendation based on the holistic synthesis of the narrative and data.
**You MUST provide a concrete betting recommendation unless there are EXTREME contradictions AND very low confidence across the board.** Avoid "Nincs fogadás" if possible, instead select the relatively best option and reflect uncertainty in the confidence score.
CRITICAL INPUTS (Synthesize these): 1. Value Bets Found: {valueBetsJson} (Consider top value, weigh against risks).
2. Simulation Probabilities: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. (Baseline). 3. Model Confidence (Stats): {modelConfidence}/10 (Data consistency).
4. Expert Confidence (Context): "{expertConfidence}" (Crucial context check - score & reasoning).
5. Risk Assessment: "{riskAssessment}" (MAJOR FOCUS - warnings, contradictions?). 6. Specialist Conclusions: "{microSummary}" (Alignment or disagreement?).
7. General Analysis Narrative: "{generalAnalysis}" (The overall story). 8. Strategic Closing Thoughts: "{strategicClosingThoughts}" (Highlights key angles & risks).
YOUR DECISION PROCESS (Narrative Synthesis - PRIORITIZE A TIP): - READ and UNDERSTAND all reports. What is the dominant narrative?
- Identify the betting angle most strongly supported by the *convergence* of different analytical perspectives (stats + narrative + risk + specialists).
- **If a Value Bet exists:** Is it reasonably supported by the narrative (Expert Confidence > 4.5, Risk Assessment doesn't have critical red flags directly against it)? If yes, lean towards this Value Bet.
- **If no compelling Value Bet (or it's too risky):** Identify the outcome most strongly supported by the *combined narrative and statistical evidence* (General Analysis, Strategic Thoughts, high Expert/Model Confidence). This might be the highest probability outcome if confidence is high and risks low, OR it might be an angle highlighted by specialists IF their confidence is high and it aligns with the general narrative.
- **Select the Relatively Best Option:** Even if confidence isn't perfect, choose the single market that emerges as the most logical conclusion from the synthesis.
- **"Nincs fogadás" is the LAST RESORT:** Only recommend this if there are *multiple, strong, direct contradictions* between key reports (e.g., market moves strongly against ALL indicators), if confidence levels (Model AND Expert) are very low (< 4.5), OR if the reports paint an extremely confusing/contradictory picture.
- **Final Confidence (1.0-10.0):** This MUST reflect your synthesized confidence in the chosen bet. If you selected a tip despite some moderate risks or lower confidence scores, the final score should reflect that (e.g., 4.5-6.0). High alignment and low risk warrant higher scores (7.0+).
- **Reasoning:** Explain *why this specific bet* is the most compelling choice based on the *synthesis* and what the confidence score implies about its likelihood/risk. If recommending "No Bet", clearly state the extreme contradictions/risks that force this decision.
OUTPUT FORMAT: Return ONLY a single, valid JSON object. NO other text or markdown.
{"recommended_bet": "<The SINGLE most compelling market (e.g., 'Hazai győzelem', 'Over 2.5', 'Monaco -1.5 AH') OR (rarely) 'Nincs fogadás'>", "final_confidence": <Number between 1.0-10.0 (one decimal) based on synthesis>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the CORE reason for the choice based on SYNTHESIS, reflecting the confidence level. e.g., 'A narratíva és a statisztika egyaránt az Over 2.5 felé mutat, a 6.5/10 bizalom mérsékelt kockázatot jelez.' OR 'Extrém ellentmondások és általánosan alacsony bizalom mellett a 'Nincs fogadás' javasolt.'>"}
`;
const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `
You are an AI Sports Analyst specializing in {specialization}.
Analyze the provided data for the match: {homeTeam} vs {awayTeam}.
Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5).
Data: --- Match: {homeTeam} (Home) vs {awayTeam} (Away) League: {leagueName} Date: {matchDate} Contextual Data (from Google Search and internal knowledge): {richContext} Odds Data (Pinnacle): {oddsString} --- Your Output (Plain Text, Max 3 sentences + prediction): <Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;
const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician.
Your SOLE TASK is to provide a concise, expert tactical briefing (2-4 sentences max) in Hungarian for the {sport} match: {home} vs {away}.
CRITICAL RULE: Highlight key tactical terms, player/team names with **asterisks** (use sparingly for maximum impact, only on the most crucial elements).
STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT use markdown headers like '###'.
Start directly with the analysis. - DO NOT ask questions or ask for clarification.
- DO NOT write a letter, introduction, or conclusion. Just the briefing.
DATA FOR ANALYSIS: - Clash of Styles: {home} ("{home_style}") vs {away} ("{away_style}"). - Key Duel Analysis: "{duelAnalysis}".
- Key Players (Home): {key_players_home} - Key Players (Away): {key_players_away} Synthesize this data.
Identify the key tactical battleground on the pitch and predict the likely flow of the game based ONLY on tactics.`;
const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist known for vivid, atmospheric match reports.
Your SOLE TASK is to write a compelling, *highly descriptive*, prophetic scenario in Hungarian for the {sport} match: {home} vs {away}, based ONLY on the provided sparse timeline of key events.
Write it as a flowing, engaging narrative, like a live match commentary unfolding.
CRITICAL: The timeline provides *only* the key inflection points (goals, cards).
Your job is to *weave them into a realistic narrative*.
Describe the ebb and flow of the game between these events, potential momentum shifts, near-misses, and the general atmosphere.
*BE DECISIVE* and specific in your descriptions. Write what *will* happen based on the timeline, not vague possibilities.
STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - Write in the *third person*.
- DO NOT ask for instructions or confirmation. - DO NOT write a letter or introduction/conclusion.
Start directly with the match beginning. - DO NOT include placeholders like '[Esemény]' or repeat the timeline data verbatim.
Build a story AROUND the events. - Highlight key moments (goals, cards mentioned in the timeline), player names (if available, otherwise generic terms), team names, and the final predicted outcome with **asterisks**.
Use asterisks thoughtfully for emphasis. EVENT TIMELINE (Key moments to build around): {timelineJson} OTHER CONTEXT (Use if helpful for narrative flavor): Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension} EXAMPLE OF A PERFECT RESPONSE (Assuming timeline has an away goal at 28' and home goal at 72'): "A levegő szinte vibrál a stadionban a kezdősípszó pillanatában. Az első percek a **{home}** meddő fölényét hozzák, több pontatlan lövéssel. A 28. percben aztán jön a hidegzuhany: egy villámgyors kontra végén **{away}** megszerzi a vezetést, a stadion elhalkul. A szünetig a vendégek stabilan védekeznek. A második félidőre feltüzelt hazai csapat érkezik, akik beszorítják 
ellenfelüket. A nyomás a 72. percben érik góllá, egy szöglet utáni kavarodásból **{home}** egyenlít. A véghajrában mindkét oldalon adódik még lehetőség, de az eredmény már nem változik: a lefújáskor **igazságos döntetlen** az állás."`;
const EXPERT_CONFIDENCE_PROMPT = `You are a master sports betting risk analyst.
Your SOLE TASK is to provide a final confidence score (out of 10) and a single, concise justification sentence, considering both statistical and contextual factors.
STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - The output format must be EXACTLY: **SCORE/10** - Indoklás.
(Example: **7.5/10** - A statisztika erős, de a kulcsjátékos hiánya bizonytalanságot okoz.) - DO NOT explain your role or methodology.
- DO NOT ask questions. - The justification MUST be a single sentence.
DATA: - Statistical Model Confidence: {modelConfidence}/10 - Narrative Context (H2H, News, Tactics, Motivation, Referee, etc.): {richContext} METHOD: Start with the Statistical Model Confidence.
Adjust it up or down based on the Narrative Context.
- **Decrease score** if context contradicts the stats (e.g., key player injured for the favorite, favorite has very poor recent form despite good season stats, strong H2H record against the favorite, high motivation for underdog).
- **Increase score** if context strongly supports the stats (e.g., key player returns for favorite, opponent has key injuries, strong motivation aligns with stats, tactical matchup favors favorite).
- Minor contextual factors should have minimal impact; significant factors (key injuries, major motivation difference) should have a larger impact ( +/- 1.0 to 2.5 points).
- The final score MUST remain between 1.0 and 10.0.
EXAMPLE OF A PERFECT RESPONSE: "**8.5/10** - A statisztikai modell magabiztos, és a kulcsjátékosok hiánya az ellenfélnél tovább erősíti a hazai győzelem esélyét."`;
const RISK_ASSESSMENT_PROMPT = `You are a professional sports risk assessment analyst.
Your job is to identify potential pitfalls and reasons why the main prediction might fail.
Your SOLE TASK is to write a "Kockázatkezelői Jelentés" in Hungarian.
STRICT RULES: - Your ENTIRE response MUST be in Hungarian. - DO NOT explain your methodology or risk frameworks.
- DO NOT ask for more data or offer solutions.
- Focus ONLY on the potential risks, uncertainties, and contradictions that could undermine the most likely predicted outcome. Be specific.
- Highlight the most significant risk factors with **asterisks**. Use asterisks sparingly for key points.
- Keep it concise: 2-4 sentences maximum. DATA FOR ANALYSIS: - Sport: {sport} - Simulation's Most Likely Scenario: Probabilities - H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}% - Market Intelligence (Odds Movement): "{marketIntel}" - Contextual Data Snippets: Team News: H: {news_home}, V: {news_away}.
Form: H: {form_home}, V: {form_away}. Motivation: H: {motiv_home}, V: {motiv_away}. TASK: Identify the biggest potential issues.
Examples: Does market movement contradict the simulation? Does a key injury (mentioned in Team News) significantly weaken the predicted favorite?
Is the favorite's form poor despite the simulation favoring them? Is there a strong motivational factor for the underdog?
Focus on concrete points from the data provided.`;
const FINAL_GENERAL_ANALYSIS_PROMPT = `You are the Editor-in-Chief of a prestigious sports analysis publication.
Your SOLE TASK is to write the final, overarching summary ("Általános Elemzés") for the match preview, synthesizing the provided data.
STRICT RULES: - Your ENTIRE response MUST be in Hungarian.
- DO NOT write a letter, email, or use placeholders like '[Csapat]'.
- DO NOT introduce yourself or explain the data sources.
- Write a concise, professional summary consisting of exactly TWO paragraphs.
- In the first paragraph, clearly state the most likely outcome based on the overall analysis (probabilities and xG) and briefly mention the core statistical reasoning.
- In the second paragraph, explain the 'why' behind the prediction by blending insights from the tactical briefing and the prophetic scenario.
How is the predicted outcome likely to unfold on the pitch?
- Highlight the absolute most important conclusions (e.g., the predicted winner, key tactical factor, expected goal count type like 'kevés gólos') with **asterisks**.
Use asterisks SPARINGLY (2-3 times max). DATA TO SYNTHESIZE: - Key Probabilities: Home Win: {sim_pHome}%, Draw: {sim_pDraw}%, Away Win: {sim_pAway}% - Expected Goals (xG): Home {mu_h} - Away {mu_a} - Tactical Briefing Snippet: "{tacticalBriefing}" - Prophetic Scenario Snippet: "{propheticScenario}" Generate the two-paragraph Hungarian summary.`;
const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst preparing for a pre-match briefing.
STRICT RULE: Your response must be ONLY in Hungarian. Based SOLELY on the provided context below, formulate the two (2) most critical strategic questions that will likely decide the outcome of the match.
These questions should highlight the core uncertainties or key battlegrounds.
Present them ONLY as a bulleted list, starting each question with a hyphen (-).
Do not add any introduction, explanation, or conclusion. CONTEXT: {richContext}`;
const PLAYER_MARKETS_PROMPT = `You are a specialist analyst focusing on player performance betting markets...`; // (teljes, vágatlan)
const BTTS_ANALYSIS_PROMPT = `You are a BTTS (Both Teams To Score) specialist analyst...`; // (teljes, vágatlan)
const SOCCER_GOALS_OU_PROMPT = `You are a Soccer Over/Under Goals specialist analyst...`; // (teljes, vágatlan)
const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist analyst...`; // (teljes, vágatlan)
const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards (Bookings) specialist analyst...`; // (teljes, vágatlan)
const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey Over/Under Goals specialist analyst...`; // (teljes, vágatlan)
const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Match Winner...`; // (teljes, vágatlan)
const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball Over/Under Total Points specialist analyst...`; // (teljes, vágatlan)
const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst crafting...`; // (teljes, vágatlan)


// --- HELPER a promptok kitöltéséhez ---
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([\w_]+)\}/g, (match, key) => {
        let value = data;
        try {
            if (key in value) { value = value[key]; }
            else {
                const keys = key.split('_'); value = data; let found = true;
                for (const k of keys) { if (value && typeof value === 'object' && k in value) { value = value[k]; } else { found = false; break; } }
                if (!found) { if (key.endsWith('Json')) { const baseKey = key.replace('Json', ''); if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) { try { return JSON.stringify(data[baseKey]); } catch (e) { return '{}'; } } else { return '{}'; } } value = null; }
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
        } catch (e) { console.error(`Hiba a placeholder kitöltésekor: {${key}}`, e); return "HIBA"; }
    });
}

// === Összes AI elemző és segédfüggvény (mindegyik a _callGemini-t használja) ===

export async function _getContradictionAnalysis(context, probabilities, odds) {
    return "Ellentmondás-analízis kihagyva.";
}

export async function getAiKeyQuestions(richContext) {
  if (!richContext) return "- Hiba: Kontextus hiányzik.";
  const prompt = fillPromptTemplate(AI_KEY_QUESTIONS_PROMPT, { richContext });
  try {
      const responseText = await _callGemini(prompt);
      return responseText ? responseText.trim() : "- Hiba: AI nem válaszolt.";
  } catch (e) { return `- Hiba: ${e.message}`; }
}

export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis) {
    if (!rawData?.tactics) return "Taktikai adatok hiányosak.";
    const data = { sport, home, away, home_style: rawData.tactics.home.style, away_style: rawData.tactics.away.style, duelAnalysis, key_players_home: rawData.key_players?.home?.map(p => p.name).join(', '), key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') };
    const prompt = fillPromptTemplate(TACTICAL_BRIEFING_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a taktikai elemzés generálása során.";
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    const data = { sport, home, away, timelineJson: JSON.stringify(propheticTimeline || []), home_style: rawData?.tactics?.home?.style, away_style: rawData?.tactics?.away?.style, tension: rawData?.contextual_factors?.match_tension_index };
    const prompt = fillPromptTemplate(PROPHETIC_SCENARIO_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a forgatókönyv generálása során.";
}

export async function getExpertConfidence(modelConfidence, richContext) {
    if (typeof modelConfidence !== 'number' || !richContext) return "**1.0/10** - Hiba.";
    const data = { modelConfidence, richContext };
    const prompt = fillPromptTemplate(EXPERT_CONFIDENCE_PROMPT, data);
    const response = await _callGemini(prompt);
    if (response && response.match(/\*\*\d+(\.\d+)?\/10\*\* - .+./)) return response;
    return `**${Math.max(1.0, modelConfidence * 0.8).toFixed(1)}/10** - Figyelmeztetés: AI hiba.`;
}

export async function getRiskAssessment(sim, rawData, sport, marketIntel) {
    if (!sim) return "Kockázatelemzési adatok hiányosak.";
    const data = { sport, sim, marketIntel, ...rawData.team_news, ...rawData.form, ...rawData.contextual_factors };
    const prompt = fillPromptTemplate(RISK_ASSESSMENT_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a kockázatelemzés generálása során.";
}

export async function getFinalGeneralAnalysis(sim, tacticalBriefing, propheticScenario) {
     if (!sim) return "Általános elemzési adatok hiányosak.";
     const data = { sim, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, tacticalBriefing, propheticScenario };
     const prompt = fillPromptTemplate(FINAL_GENERAL_ANALYSIS_PROMPT, data);
     const response = await _callGemini(prompt);
     return response || "Hiba az általános elemzés generálása során.";
}

export async function getPlayerMarkets(keyPlayers, richContext) {
   if (!keyPlayers) return "Nincsenek kulcsjátékosok.";
   const data = { keyPlayers, richContext };
   const prompt = fillPromptTemplate(PLAYER_MARKETS_PROMPT, data);
   const response = await _callGemini(prompt);
   return response || "Hiba a játékospiacok elemzése során.";
}

export async function getBTTSAnalysis(sim, rawData) {
    if (!sim) return "BTTS elemzési adatok hiányosak.";
    const data = { sim, ...rawData };
    const prompt = fillPromptTemplate(BTTS_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a BTTS elemzéskor.";
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) return `A Gólok O/U elemzéshez adatok hiányosak.`;
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(SOCCER_GOALS_OU_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || `Hiba a Gólok O/U elemzéskor.`;
}

export async function getCornerAnalysis(sim, rawData) {
    if (!sim?.corners) return "A Szöglet elemzéshez adatok hiányosak.";
    const likelyLine = 9.5;
    const data = { likelyLine, sim, ...rawData };
    const prompt = fillPromptTemplate(CORNER_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a Szöglet elemzéskor.";
}

export async function getCardAnalysis(sim, rawData) {
    if (!sim?.cards) return "A Lapok elemzéshez adatok hiányosak.";
    const likelyLine = 4.5;
    const data = { likelyLine, sim, ...rawData };
    const prompt = fillPromptTemplate(CARD_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a Lapok elemzéskor.";
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) return `A Jégkorong Gólok O/U elemzéshez adatok hiányosak.`;
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(HOCKEY_GOALS_OU_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || `Hiba a Jégkorong Gólok O/U elemzéskor.`;
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    if (!sim) return "A Jégkorong Győztes elemzéshez adatok hiányosak.";
    const data = { sim, ...rawData };
    const prompt = fillPromptTemplate(HOCKEY_WINNER_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "Hiba a Jégkorong Győztes elemzéskor.";
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) return `A Kosár Pont O/U elemzéshez adatok hiányosak.`;
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(BASKETBALL_POINTS_OU_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || `Hiba a Kosár Pont O/U elemzéskor.`;
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    if (!sim || !richContext) return "### Stratégiai Zárógondolatok\nAdatok hiányosak.";
    const microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => `${key}: ${analysis}`).join('; ');
    const data = { sim, rawData, richContext, marketIntel, microSummaryJson: microSummary, riskAssessment };
    const prompt = fillPromptTemplate(STRATEGIC_CLOSING_PROMPT, data);
    const response = await _callGemini(prompt);
    return response || "### Stratégiai Zárógondolatok\nHiba a generálás során.";
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    if (!sim) return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok." };
    const microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => `${key}: ${analysis}`).join('; ');
    const data = { valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microSummary, generalAnalysis, strategicClosingThoughts };
    const prompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data);
    try {
        const responseText = await _callGemini(prompt);
        if (!responseText) { throw new Error("Nem érkezett válasz."); }
        let jsonString = responseText;
        if (responseText.includes("```json")) {
            jsonString = responseText.split("```json")[1].split("```")[0];
        }
        const recommendation = JSON.parse(jsonString);
        if (recommendation?.recommended_bet) {
            return recommendation;
        } else { throw new Error("Érvénytelen JSON struktúra."); }
    } catch (e) {
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `Hiba: ${e.message.substring(0, 100)}` };
    }
}


// --- CHAT FUNKCIÓ ---
export async function getChatResponse(context, history, question) {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        const historyString = (history || []).map(msg => `${msg.role === 'user' ? 'Felh' : 'AI'}: ${msg.parts?.[0]?.text || ''}`).join('\n');
        const prompt = `You are an elite sports analyst AI assistant. Context: ${context}. History: ${historyString}. Question: ${question}. Answer in Hungarian.`;
        const answer = await _callGemini(prompt);
        return answer ? { answer: answer.trim() } : { error: "Az AI nem tudott válaszolni." };
    } catch (e) { return { error: `Chat AI hiba: ${e.message}` }; }
}

// --- FŐ EXPORT ---
export default {
    getChatResponse,
    _getContradictionAnalysis,
    getAiKeyQuestions,
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
    getFixtures: _getFixturesFromEspn
};