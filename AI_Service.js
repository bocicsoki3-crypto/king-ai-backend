/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
 * - getMasterRecommendation: Ellenőrzi a modelConfidence vs expertConfidence közötti
 * nagy eltérést, és szükség esetén csökkenti a final_confidence-t,
 * valamint megemlíti ezt az indoklásban.
 */
import { getRichContextualData, getOptimizedOddsData, _callGemini, _getFixturesFromEspn } from './DataFetch.js'; //
import {
    calculateProbabilities, generateProTip, simulateMatchProgress, estimateXG,
    estimateAdvancedMetrics, calculateModelConfidence, calculatePsychologicalProfile,
    calculateValue, analyzeLineMovement, analyzePlayerDuels, buildPropheticTimeline
} from './Model.js';
//
import { saveToSheet } from './SheetService.js'; //
import { SPORT_CONFIG } from './config.js';
//

// --- PROMPT SABLONOK (STRUKTÚRA-KÉNYSZERÍTŐVEL) ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst.
Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
//
**CRITICAL RULE: You MUST provide a concrete betting recommendation. Avoid "Nincs fogadás".
Select the 'least bad' or most logical option even with uncertainty, and reflect this in the final_confidence score.** //
CRITICAL INPUTS: 1. Value Bets: {valueBetsJson}, 2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%, 3. Model Confidence: {modelConfidence}/10, 4. Expert Confidence: "{expertConfidence}", 5. Risk Assessment: "{riskAssessment}", 6. Specialist Conclusions: "{microSummary}", 7. General Analysis: "{generalAnalysis}", 8. Strategic Thoughts: "{strategicClosingThoughts}".
//
YOUR DECISION PROCESS: Synthesize all reports. Find the betting angle with the most convergence.
//
If a reasonable Value Bet exists and is supported by the narrative, it's a strong candidate.
//
Otherwise, pick the outcome most supported by combined evidence. //
OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this exact structure: {"recommended_bet": "<The SINGLE most compelling market>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence for the choice>"} //
`;
const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
//
CONTEXT: First, read the Risk Assessment report: "{riskAssessment}". Reflect this context (e.g., if risk is high, explain the tactical risk).
//
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Duel: "{duelAnalysis}", Key Players: Home: {key_players_home}, Away: {key_players_away}.
//
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;
const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}, based on the event timeline.
//
CONTEXT: First, read the Tactical Briefing: "{tacticalBriefing}". Your narrative MUST match this tactical assessment (e.g., if tactics are defensive, the scenario should be low-scoring).
//
TIMELINE: {timelineJson}. Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}.
//
Weave a narrative. Highlight key moments and the outcome with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;
const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst. Provide a confidence score and justification in Hungarian.
//
Start with Statistical Model Confidence ({modelConfidence}/10) and adjust it based on the Narrative Context ({richContext}).
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"confidence_report": "**SCORE/10** - Indoklás."}.`;
const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian). Focus ONLY on risks/contradictions.
//
Highlight significant risks with **asterisks**. DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Market Intel: "{marketIntel}". Context: News: H:{news_home}, A:{news_away}. Form: H:{form_home}, A:{form_away}.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;
const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
//
1st para: state likely outcome from stats (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; xG: H {mu_h} - A {mu_a}).
//
2nd para: explain the 'why' from tactical ("{tacticalBriefing}") and scenario ("{propheticScenario}") insights. Highlight key conclusions with **asterisks**.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;
const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst. Based on the context, formulate the two most critical strategic questions in Hungarian that will decide the match.
//
Present as a bulleted list. CONTEXT: {richContext}. //
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"key_questions": "- Kérdés 1...\\n- Kérdés 2..."}.`;
const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 player-specific betting markets in Hungarian (2-3 sentences max).
//
Highlight player names & markets with **asterisks**. DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}.`;
const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist. Analyze if both teams will score.
//
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}. Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
//
DATA: Sim Over: {sim_pOver}%, xG Sum: {sim_mu_sum}. Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs line ({likelyLine}). Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs line ({likelyLine}). Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}). Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT). Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball O/U specialist. Analyze total points vs line ({line}). Conclude with confidence.
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_points_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
//
Synthesize ALL reports. Discuss promising angles AND risks.
//
DATA:
- Risk Assessment: "{riskAssessment}"
- Tactical Briefing: "{tacticalBriefing}"
- Scenario: "{propheticScenario}"
- Stats: H:{sim_pHome}%, O/U: O:{sim_pOver}%
- Market: "{marketIntel}"
- Micromodels: {microSummaryJson}
- Context: {richContext}
//
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your Hungarian strategic thoughts here>"}.`;


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
                if (!found) {
                    if (key.endsWith('Json')) {
                        const baseKey = key.replace('Json', '');
                        if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) { try { return JSON.stringify(data[baseKey]); } catch (e) { return '{}'; } } else { return '{}'; }
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
        } catch (e) { console.error(`Hiba a placeholder kitöltésekor: {${key}}`, e); return "HIBA"; }
    });
}

// === AI elemzők, automatikus újrapróbálkozással ===
async function getAndParse(prompt, data, key, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const jsonString = await _callGemini(fillPromptTemplate(prompt, data));
            const result = JSON.parse(jsonString);
            if (result && typeof result === 'object' && key in result) { return result[key]; }
            console.error(`AI Hiba: A válasz JSON (${key}) nem tartalmazta a várt kulcsot. Válasz:`, jsonString.substring(0, 200));
            return `AI Hiba: A válasz JSON nem tartalmazta a '${key}' kulcsot.`;
        } catch (e) {
            attempts++;
            console.warn(`AI Hiba a(z) ${key} feldolgozásakor (Próba: ${attempts}/${retries + 1}): ${e.message}`);
            if (attempts > retries) { console.error(`Végleges AI Hiba (${key}) ${attempts} próbálkozás után.`); return `AI Hiba (${key}): ${e.message}`; }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
    }
}

// --- AI Funkciók ---
export async function _getContradictionAnalysis(context, probabilities, odds) { return "Ellentmondás-analízis kihagyva."; }
export async function getAiKeyQuestions(richContext) { return await getAndParse(AI_KEY_QUESTIONS_PROMPT, { richContext }, "key_questions"); }
export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis, riskAssessment) {
    const data = { sport, home, away, riskAssessment: riskAssessment || "N/A", home_style: rawData.tactics?.home?.style || "N/A", away_style: rawData.tactics?.away?.style || "N/A", duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.', key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A', key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A' };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis");
}
export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport, tacticalBriefing) {
     const data = { sport, home, away, tacticalBriefing: tacticalBriefing || "N/A", timelineJson: JSON.stringify(propheticTimeline || []), home_style: rawData.tactics?.home?.style || "N/A", away_style: rawData.tactics?.away?.style || "N/A", tension: rawData.contextual_factors?.match_tension_index || "N/A" };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario");
}
export async function getExpertConfidence(modelConfidence, richContext) { return await getAndParse(EXPERT_CONFIDENCE_PROMPT, { modelConfidence, richContext }, "confidence_report"); }
export async function getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel) {
    const data = { sport, sim_pHome: sim.pHome, sim_pDraw: sim.pDraw, sim_pAway: sim.pAway, marketIntel: marketIntel || "N/A", news_home: rawData.team_news?.home || "N/A", news_away: rawData.team_news?.away || "N/A", form_home: rawData.form?.home_overall || "N/A", form_away: rawData.form?.away_overall || "N/A" };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis");
}
export async function getFinalGeneralAnalysis(sim, mu_h, mu_a, tacticalBriefing, propheticScenario, rawData) {
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, { sim_pHome: sim.pHome, sim_pDraw: sim.pDraw, sim_pAway: sim.pAway, mu_h: mu_h, mu_a: mu_a, tacticalBriefing: tacticalBriefing || "N/A", propheticScenario: propheticScenario || "N/A" }, "general_analysis");
}
export async function getPlayerMarkets(keyPlayers, richContext) { return await getAndParse(PLAYER_MARKETS_PROMPT, { keyPlayersJson: JSON.stringify(keyPlayers), richContext }, "player_market_analysis"); }
export async function getBTTSAnalysis(sim, rawData) { return await getAndParse(BTTS_ANALYSIS_PROMPT, { sim_pBTTS: sim.pBTTS, sim_mu_h: sim.mu_h_sim, sim_mu_a: sim.mu_a_sim }, "btts_analysis"); }
export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) { return await getAndParse(SOCCER_GOALS_OU_PROMPT, { line: mainTotalsLine, sim_pOver: sim.pOver, sim_mu_sum: (sim.mu_h_sim + sim.mu_a_sim) }, "goals_ou_analysis"); }
export async function getCornerAnalysis(sim, rawData) { const likelyLine = 9.5; return await getAndParse(CORNER_ANALYSIS_PROMPT, { likelyLine, sim, ...rawData.advanced_stats, ...rawData.tactics }, "corner_analysis"); }
export async function getCardAnalysis(sim, rawData) { const likelyLine = 4.5; return await getAndParse(CARD_ANALYSIS_PROMPT, { likelyLine, sim, ...rawData.advanced_stats, ...rawData.referee, ...rawData.contextual_factors }, "card_analysis"); }
export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) { return await getAndParse(HOCKEY_GOALS_OU_PROMPT, { line: mainTotalsLine, sim, ...rawData.advanced_stats }, "hockey_goals_ou_analysis"); }
export async function getHockeyWinnerAnalysis(sim, rawData) { return await getAndParse(HOCKEY_WINNER_PROMPT, { sim, ...rawData.advanced_stats, ...rawData.form }, "hockey_winner_analysis"); }
export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) { return await getAndParse(BASKETBALL_POINTS_OU_PROMPT, { line: mainTotalsLine, sim, ff_home_json: JSON.stringify(rawData.advanced_stats?.home?.four_factors || {}), ff_away_json: JSON.stringify(rawData.advanced_stats?.away?.four_factors || {}), ...rawData.advanced_stats, ...rawData.team_news }, "basketball_points_ou_analysis"); }
export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment, tacticalBriefing, propheticScenario) {
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val}`).join('; ');
    return await getAndParse(STRATEGIC_CLOSING_PROMPT, { sim_pHome: sim.pHome, sim_pOver: sim.pOver, propheticScenario: propheticScenario || "N/A", tacticalBriefing: tacticalBriefing || "N/A", marketIntel, microSummaryJson: microSummary, richContext, riskAssessment }, "strategic_analysis");
}

// === MÓDOSÍTÁS: Dinamikus Bizalomkezelés ===
export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts, rawData, contradictionAnalysisResult) {
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val}`).join('; ');

    let expertConfScore = 1.0;
    try { const match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/); if (match && match[1]) { expertConfScore = parseFloat(match[1]); } }
    catch(e) { console.warn("Nem sikerült kinyerni az expert confidence pontszámot a Master AI számára."); }

    const data = { valueBetsJson: JSON.stringify(valueBets || []), sim_pHome: sim.pHome, sim_pDraw: sim.pDraw, sim_pAway: sim.pAway, sim_mainTotalsLine: sim.mainTotalsLine, sim_pOver: sim.pOver, modelConfidence, expertConfidence, riskAssessment, microSummary, generalAnalysis, strategicClosingThoughts, contradictionAnalysis: contradictionAnalysisResult };

    try {
        const jsonString = await _callGemini(fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data));
        let rec = JSON.parse(jsonString);

        if (rec && rec.recommended_bet && typeof rec.final_confidence === 'number') {
            const confidenceDiff = Math.abs(modelConfidence - expertConfScore);
            const disagreementThreshold = 3.0;
            let confidencePenalty = 0; let disagreementNote = "";

            if (expertConfScore < 1.1 && !expertConfidence.toLowerCase().includes("hiba")) {
                 confidencePenalty = Math.max(0, rec.final_confidence - 3.0);
                 disagreementNote = " (A Szakértői Bizalom extrém alacsony értéke miatt jelentősen csökkentve.)";
                 console.log(`Master AI: Extrém alacsony Expert Confidence (${expertConfScore}) felülbírálta a bizalmat.`);
            } else if (confidenceDiff > disagreementThreshold) {
                confidencePenalty = Math.min(2.0, confidenceDiff / 2);
                disagreementNote = " (A Statisztikai Modell és a Szakértői Bizalom közötti jelentős eltérés miatt csökkentve.)";
                console.log(`Master AI: Jelentős bizalmi eltérés (${modelConfidence.toFixed(1)} vs ${expertConfScore.toFixed(1)}), büntetés: ${confidencePenalty.toFixed(1)}`);
            }

            rec.final_confidence -= confidencePenalty;
            rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));
            rec.brief_reasoning += disagreementNote;

            return rec;
        }
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "AI hiba: Érvénytelen JSON struktúra." };
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`);
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `AI Hiba: ${e.message.substring(0, 100)}` };
    }
}
// === MÓDOSÍTÁS VÉGE ===

// --- CHAT FUNKCIÓ ---
export async function getChatResponse(context, history, question) {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        const historyString = (history || []).map(msg => `${msg.role === 'user' ? 'Felh' : 'AI'}: ${msg.parts?.[0]?.text || ''}`).join('\n');
        const prompt = `You are an elite sports analyst AI assistant.
Context: ${context}. History: ${historyString}. Current User Question: ${question}. Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History.
If the answer isn't there, say so politely.`;
        const jsonAnswer = await _callGemini(prompt);
        let answerText = jsonAnswer;
        try {
            const parsed = JSON.parse(jsonAnswer);
            answerText = parsed.answer || parsed.response || Object.values(parsed).find(v => typeof v === 'string') || jsonAnswer;
        } catch (e) {
            answerText = jsonAnswer.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        }
         return answerText ? { answer: answerText.trim() } : { error: "Az AI nem tudott válaszolni." };
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`);
        return { error: `Chat AI hiba: ${e.message}` };
    }
}


// --- FŐ EXPORT ---
export default {
    getChatResponse, _getContradictionAnalysis, getAiKeyQuestions, getTacticalBriefing, getPropheticScenario,
    getExpertConfidence, getRiskAssessment, getFinalGeneralAnalysis, getPlayerMarkets, getMasterRecommendation,
    getStrategicClosingThoughts, getBTTSAnalysis, getSoccerGoalsOUAnalysis, getCornerAnalysis, getCardAnalysis,
    getHockeyGoalsOUAnalysis, getHockeyWinnerAnalysis, getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn
};