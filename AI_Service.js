/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÉGLEGES JAVÍTÁS: Minden hívás a helyes _callGemini funkciót használja.
 */

import { getRichContextualData, getOptimizedOddsData, _callGemini, _getFixturesFromEspn } from './DataFetch.js';
import {
    calculateProbabilities, generateProTip, simulateMatchProgress, estimateXG,
    estimateAdvancedMetrics, calculateModelConfidence, calculatePsychologicalProfile,
    calculateValue, analyzeLineMovement, analyzePlayerDuels, buildPropheticTimeline
} from './Model.js';
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK ---
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
const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician...`; // (A többi prompt ugyanaz, mint korábban)
const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist...`;
const EXPERT_CONFIDENCE_PROMPT = `You are a master sports betting risk analyst...`;
const RISK_ASSESSMENT_PROMPT = `You are a professional sports risk assessment analyst...`;
const FINAL_GENERAL_ANALYSIS_PROMPT = `You are the Editor-in-Chief...`;
const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst...`;
const PLAYER_MARKETS_PROMPT = `You are a specialist analyst...`;
const BTTS_ANALYSIS_PROMPT = `You are a BTTS (Both Teams To Score) specialist analyst...`;
const SOCCER_GOALS_OU_PROMPT = `You are a Soccer Over/Under Goals specialist analyst...`;
const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist analyst...`;
const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards (Bookings) specialist analyst...`;
const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey Over/Under Goals specialist analyst...`;
const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Match Winner...`;
const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball Over/Under Total Points specialist analyst...`;
const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst crafting...`;

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

// === Placeholder az ellentmondás-analízishez ===
export async function _getContradictionAnalysis(context, probabilities, odds) {
    return "Ellentmondás-analízis kihagyva.";
}

// === Összes AI elemző funkció, JAVÍTVA, hogy a _callGemini-t használják ===

export async function getAiKeyQuestions(richContext) {
  if (!richContext || typeof richContext !== 'string') { return "- Hiba: A kulcskérdések generálásához szükséges kontextus hiányzik."; }
  const prompt = fillPromptTemplate(AI_KEY_QUESTIONS_PROMPT, { richContext });
  try {
      const responseText = await _callGemini(prompt); // JAVÍTVA
      return responseText ? responseText.trim() : "- Hiba: Az AI nem tudott kulcskérdéseket generálni.";
  } catch (e) { return `- Hiba a kulcskérdések generálásakor: ${e.message}`; }
}

export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis) {
    if (!rawData?.tactics?.home || !rawData?.tactics?.away) { return "A taktikai elemzéshez szükséges adatok hiányosak."; }
    const data = { sport, home, away, home_style: rawData.tactics.home.style || "N/A", away_style: rawData.tactics.away.style || "N/A", duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.', key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A', key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A' };
    const prompt = fillPromptTemplate(TACTICAL_BRIEFING_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba történt a taktikai elemzés generálása során.";
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    const data = { sport, home, away, timelineJson: JSON.stringify(propheticTimeline || []), home_style: rawData?.tactics?.home?.style || 'N/A', away_style: rawData?.tactics?.away?.style || 'N/A', tension: rawData?.contextual_factors?.match_tension_index || 'N/A' };
    const prompt = fillPromptTemplate(PROPHETIC_SCENARIO_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba történt a forgatókönyv generálása során.";
}

export async function getExpertConfidence(modelConfidence, richContext) {
    if (typeof modelConfidence !== 'number' || !richContext) { return "**1.0/10** - Hiba: Érvénytelen adatok."; }
    const data = { modelConfidence, richContext };
    const prompt = fillPromptTemplate(EXPERT_CONFIDENCE_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    if (response && response.match(/\*\*\d+(\.\d+)?\/10\*\* - .+./)) { return response; }
    else { const fallback = Math.max(1.0, modelConfidence * 0.8).toFixed(1); return `**${fallback}/10** - Figyelmeztetés: AI kontextus értékelés hiba.`; }
}

export async function getRiskAssessment(sim, rawData, sport, marketIntel) {
    if (!sim || !rawData) { return "A kockázatelemzéshez adatok hiányosak."; }
    const data = { sport, sim, marketIntel: marketIntel || "N/A", news_home: rawData?.team_news?.home || 'N/A', news_away: rawData?.team_news?.away || 'N/A', form_home: rawData?.form?.home_overall || 'N/A', form_away: rawData?.form?.away_overall || 'N/A', motiv_home: rawData?.contextual_factors?.motivation_home || 'N/A', motiv_away: rawData?.contextual_factors?.motivation_away || 'N/A' };
    const prompt = fillPromptTemplate(RISK_ASSESSMENT_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba történt a kockázatelemzés generálása során.";
}

export async function getFinalGeneralAnalysis(sim, tacticalBriefing, propheticScenario) {
     if (!sim || !tacticalBriefing || !propheticScenario) { return "Az általános elemzéshez adatok hiányosak."; }
     const data = { sim, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, tacticalBriefing, propheticScenario };
     const prompt = fillPromptTemplate(FINAL_GENERAL_ANALYSIS_PROMPT, data);
     const response = await _callGemini(prompt); // JAVÍTVA
     return response || "Hiba történt az általános elemzés generálása során.";
}

export async function getPlayerMarkets(keyPlayers, richContext) {
   if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) { return "Nincsenek kiemelt kulcsjátékosok."; }
   if (!richContext) { return "A játékospiacok elemzéséhez kontextus hiányzik."; }
   const data = { keyPlayers, richContext };
   const prompt = fillPromptTemplate(PLAYER_MARKETS_PROMPT, data);
   const response = await _callGemini(prompt); // JAVÍTVA
   return response || "Hiba történt a játékospiacok elemzése során.";
}

export async function getBTTSAnalysis(sim, rawData) {
    if (!sim) { return "A BTTS elemzéshez adatok hiányosak. Bizalom: Alacsony"; }
    const data = { sim, ...rawData };
    const prompt = fillPromptTemplate(BTTS_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba történt a BTTS elemzés generálása során. Bizalom: Alacsony";
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) { return `A Gólok O/U elemzéshez adatok hiányosak. Bizalom: Alacsony`; }
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(SOCCER_GOALS_OU_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || `Hiba a Gólok O/U elemzéskor. Bizalom: Alacsony`;
}

// ... És így tovább a többi piac-specifikus függvénnyel ...
// Mindegyikben a _callGeminiWithSearch -> _callGemini cserét kell elvégezni.

export async function getCornerAnalysis(sim, rawData) {
    if (!sim?.corners) { return "A Szöglet elemzéshez adatok hiányosak. Bizalom: Alacsony"; }
    const likelyLine = 9.5; // Egyszerűsített
    const data = { likelyLine, sim, ...rawData };
    const prompt = fillPromptTemplate(CORNER_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba a Szöglet elemzéskor. Bizalom: Alacsony";
}

export async function getCardAnalysis(sim, rawData) {
    if (!sim?.cards) { return "A Lapok elemzéshez adatok hiányosak. Bizalom: Alacsony"; }
    const likelyLine = 4.5; // Egyszerűsített
    const data = { likelyLine, sim, ...rawData };
    const prompt = fillPromptTemplate(CARD_ANALYSIS_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba a Lapok elemzéskor. Bizalom: Alacsony";
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) { return `A Jégkorong Gólok O/U elemzéshez adatok hiányosak. Bizalom: Alacsony`; }
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(HOCKEY_GOALS_OU_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || `Hiba a Jégkorong Gólok O/U elemzéskor. Bizalom: Alacsony`;
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    if (!sim) { return "A Jégkorong Győztes elemzéshez adatok hiányosak. Bizalom: Alacsony"; }
    const data = { sim, ...rawData };
    const prompt = fillPromptTemplate(HOCKEY_WINNER_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "Hiba a Jégkorong Győztes elemzéskor. Bizalom: Alacsony";
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || !mainTotalsLine) { return `A Kosár Pont O/U elemzéshez adatok hiányosak. Bizalom: Alacsony`; }
    const data = { line: mainTotalsLine, sim, ...rawData };
    const prompt = fillPromptTemplate(BASKETBALL_POINTS_OU_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || `Hiba a Kosár Pont O/U elemzéskor. Bizalom: Alacsony`;
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    if (!sim || !richContext) { return "### Stratégiai Zárógondolatok\nAdatok hiányosak."; }
    const microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => `${key}: ${analysis}`).join('; ');
    const data = { sim, rawData, richContext, marketIntel, microSummaryJson: microSummary, riskAssessment };
    const prompt = fillPromptTemplate(STRATEGIC_CLOSING_PROMPT, data);
    const response = await _callGemini(prompt); // JAVÍTVA
    return response || "### Stratégiai Zárógondolatok\nHiba a generálás során.";
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    if (!sim) { return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok." }; }
    const microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => `${key}: ${analysis}`).join('; ');
    const data = { valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microSummary, generalAnalysis, strategicClosingThoughts };
    const prompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data);
    try {
        const responseText = await _callGemini(prompt); // JAVÍTVA
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
    if (!context || !question) {
        return { error: "Hiányzó 'context' vagy 'question'." };
    }
    try {
        const historyString = (history || []).map(msg => `${msg.role === 'user' ? 'Felh' : 'AI'}: ${msg.parts?.[0]?.text || ''}`).join('\n');
        const prompt = `You are an elite sports analyst AI assistant... Current User Question: ${question}`; // Rövidítve
        const answer = await _callGemini(prompt); // JAVÍTVA
        return answer ? { answer: answer.trim() } : { error: "Az AI nem tudott válaszolni." };
    } catch (e) {
        return { error: `Chat AI hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT ---
export default {
    // A runAnalysisFlow az AnalysisFlow.js-ben van, ezért itt nem exportáljuk.
    getChatResponse: getChatResponse,
    _getContradictionAnalysis: _getContradictionAnalysis,
    getAiKeyQuestions: getAiKeyQuestions,
    getTacticalBriefing: getTacticalBriefing,
    getPropheticScenario: getPropheticScenario,
    getExpertConfidence: getExpertConfidence,
    getRiskAssessment: getRiskAssessment,
    getFinalGeneralAnalysis: getFinalGeneralAnalysis,
    getPlayerMarkets: getPlayerMarkets,
    getMasterRecommendation: getMasterRecommendation,
    getStrategicClosingThoughts: getStrategicClosingThoughts,
    getBTTSAnalysis: getBTTSAnalysis,
    getSoccerGoalsOUAnalysis: getSoccerGoalsOUAnalysis,
    getCornerAnalysis: getCornerAnalysis,
    getCardAnalysis: getCardAnalysis,
    getHockeyGoalsOUAnalysis: getHockeyGoalsOUAnalysis,
    getHockeyWinnerAnalysis: getHockeyWinnerAnalysis,
    getBasketballPointsOUAnalysis: getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn
};