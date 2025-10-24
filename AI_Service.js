import { _callGemini } from './DataFetch.js';

// --- PROMPT SABLONOK (STRUKTÚRA-KÉNYSZERÍTŐVEL ÉS JAVÍTOTT LOGIKÁVAL) ---

const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst. Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
**CRITICAL RULE: You MUST provide a concrete betting recommendation. Avoid "Nincs fogadás". Select the 'least bad' or most logical option even with uncertainty, and reflect this in the final_confidence score.**
CRITICAL INPUTS: 1. Value Bets: {valueBetsJson}, 2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%, 3. Model Confidence: {modelConfidence}/10, 4. Expert Confidence: "{expertConfidence}", 5. Risk Assessment: "{riskAssessment}", 6. Specialist Conclusions: "{microSummary}", 7. General Analysis: "{generalAnalysis}", 8. Strategic Thoughts: "{strategicClosingThoughts}".
YOUR DECISION PROCESS: Synthesize all reports. Find the betting angle with the most convergence. If a reasonable Value Bet exists and is supported by the narrative, it's a strong candidate. Otherwise, pick the outcome most supported by combined evidence.
OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this exact structure: {"recommended_bet": "<The SINGLE most compelling market>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence for the choice>"}`;

const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}. Highlight key elements with **asterisks**. DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Duel: "{duelAnalysis}", Key Players: Home: {key_players_home}, Away: {key_players_away}. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}, based on the event timeline. Weave a narrative. Highlight key moments and the outcome with **asterisks**. TIMELINE: {timelineJson}. CONTEXT: Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst. Your task is to provide a final confidence score and a brief justification in Hungarian.
Start with the objective Statistical Model Confidence ({modelConfidence}/10) as your baseline.
Then, analyze the subjective Narrative Context ({richContext}) which includes news, H2H, and absentee reports.
**YOUR LOGIC:
- If the Narrative Context is rich and STRONGLY SUPPORTS the statistical model's direction, INCREASE the baseline score by 1-2 points.
- If the Narrative Context is rich but CONTRADICTS the statistical model, DECREASE the baseline score by 2-4 points.
- If the Narrative Context is WEAK, POOR, or mostly "N/A", DO NOT drop the score to the minimum. Instead, rely on the statistical baseline and only slightly DECREASE it by 0.5-1.0 point to reflect the uncertainty.**
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"confidence_report": "**SCORE/10** - Indoklás."}.`;

const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian). Focus ONLY on risks/contradictions. Highlight significant risks with **asterisks**. DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Market Intel: "{marketIntel}". Context: News: H:{news_home}, A:{news_away}. Form: H:{form_home}, A:{form_away}. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian). 1st para: state likely outcome from stats (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; xG: H {mu_h} - A {mu_a}). 2nd para: explain the 'why' from tactical ("{tacticalBriefing}") and scenario ("{propheticScenario}") insights. Highlight key conclusions with **asterisks**. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst. Based on the context, formulate the two most critical strategic questions in Hungarian that will decide the match. Present as a bulleted list. CONTEXT: {richContext}. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"key_questions": "- Kérdés 1...\\n- Kérdés 2..."}.`;

const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 player-specific betting markets in Hungarian (2-3 sentences max). Highlight player names & markets with **asterisks**. DATA: Key Players: {keyPlayersJson}, Context: {richContext}. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}.`;

const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist. Analyze if both teams will score. DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}. Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}). DATA: Sim Over: {sim_pOver}%, xG Sum: {sim_mu_sum}. Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs line ({likelyLine}). Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs line ({likelyLine}). Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}). Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT). Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball O/U specialist. Analyze total points vs line ({line}). Conclude with confidence. CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_points_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs). Discuss promising angles AND risks from all data. DATA: Scenario: "{propheticScenario}", Stats: H:{sim_pHome}%, O/U: O:{sim_pOver}%, Market: "{marketIntel}", Micromodels: {microSummaryJson}, Context: {richContext}, Risk Assessment: "{riskAssessment}". CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your Hungarian strategic thoughts here>"}.`;


function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([\w_]+)\}/g, (match, key) => {
        try {
            let value = data[key];
            if (value === undefined) {
                 if (key.endsWith('Json')) {
                    const baseKey = key.slice(0, -4);
                    const objValue = data[baseKey];
                    return objValue !== undefined ? JSON.stringify(objValue) : '{}';
                 }
                 const keys = key.split('_');
                 let nestedValue = data;
                 for (const k of keys) {
                    if (nestedValue && typeof nestedValue === 'object' && k in nestedValue) {
                        nestedValue = nestedValue[k];
                    } else {
                        nestedValue = undefined;
                        break;
                    }
                 }
                 if (nestedValue !== undefined) {
                     value = nestedValue;
                 } else {
                     return "N/A";
                 }
            }
            if (typeof value === 'number') {
                if (key.startsWith('sim_p') || key.startsWith('modelConfidence')) return value.toFixed(1);
                if (key.startsWith('mu_') || key.startsWith('sim_mu_')) return value.toFixed(2);
                return value.toString();
            }
            if(typeof value === 'object' && value !== null) {
                return JSON.stringify(value);
            }
            return String(value ?? "N/A");
        } catch (e) {
            console.error(`Hiba a placeholder kitöltésekor: {${key}}`, e);
            return "HIBA";
        }
    });
}

async function getAndParse(prompt, data, key) {
    try {
        const filledPrompt = fillPromptTemplate(prompt, data);
        const jsonString = await _callGemini(filledPrompt);
        const result = JSON.parse(jsonString);
        if (result && typeof result === 'object' && key in result) {
            return result[key];
        }
        console.error(`AI Hiba: A válasz JSON (${key}) nem tartalmazta a várt kulcsot. Válasz:`, jsonString.substring(0, 200));
        return `AI Hiba: A válasz JSON nem tartalmazta a '${key}' kulcsot.`;
    } catch (e) {
        console.error(`AI Hiba a(z) ${key} feldolgozásakor:`, e.message);
        return `AI Hiba (${key}): ${e.message}`;
    }
}

// === EZ A HIÁNYZÓ FÜGGVÉNY VISSZAKERÜLT ==================================
export async function _getContradictionAnalysis(context, probabilities, odds) { 
    return "Ellentmondás-analízis kihagyva.";
}
// =======================================================================

export async function getAiKeyQuestions(richContext) { return await getAndParse(AI_KEY_QUESTIONS_PROMPT, { richContext }, "key_questions"); }

export async function getTacticalBriefing(rawData, home, away, duelAnalysis) {
    const data = {
        home, away,
        home_style: rawData.tactics?.home?.style || "N/A",
        away_style: rawData.tactics?.away?.style || "N/A",
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.',
        key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
        key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis");
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away) {
     const data = {
        home, away,
        timelineJson: JSON.stringify(propheticTimeline || []),
        home_style: rawData.tactics?.home?.style || "N/A",
        away_style: rawData.tactics?.away?.style || "N/A",
        tension: rawData.contextual_factors?.match_tension_index || "N/A"
    };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario");
}

export async function getExpertConfidence(modelConfidence, richContext) { return await getAndParse(EXPERT_CONFIDENCE_PROMPT, { modelConfidence, richContext }, "confidence_report"); }

export async function getRiskAssessment(sim, rawData, marketIntel) {
    const data = {
        sim,
        marketIntel: marketIntel || "N/A",
        news_home: rawData.team_news?.home || "N/A",
        news_away: rawData.team_news?.away || "N/A",
        form_home: rawData.form?.home_overall || "N/A",
        form_away: rawData.form?.away_overall || "N/A",
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis");
}

export async function getFinalGeneralAnalysis(sim, tacticalBriefing, propheticScenario) {
    const data = { sim, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, tacticalBriefing, propheticScenario };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis");
}

export async function getPlayerMarkets(keyPlayers, richContext) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, { keyPlayersJson: keyPlayers, richContext }, "player_market_analysis");
}

export async function getBTTSAnalysis(sim) {
    const data = { sim_pBTTS: sim.pBTTS, sim_mu_h: sim.mu_h_sim, sim_mu_a: sim.mu_a_sim };
    return await getAndParse(BTTS_ANALYSIS_PROMPT, data, "btts_analysis");
}

export async function getSoccerGoalsOUAnalysis(sim, mainTotalsLine) {
    const data = { line: mainTotalsLine, sim_pOver: sim.pOver, sim_mu_sum: sim.mu_h_sim + sim.mu_a_sim };
    return await getAndParse(SOCCER_GOALS_OU_PROMPT, data, "goals_ou_analysis");
}

export async function getCornerAnalysis(sim) {
    const likelyLine = 9.5;
    return await getAndParse(CORNER_ANALYSIS_PROMPT, { likelyLine, sim }, "corner_analysis");
}

export async function getCardAnalysis(sim) {
    const likelyLine = 4.5;
    return await getAndParse(CARD_ANALYSIS_PROMPT, { likelyLine, sim }, "card_analysis");
}

export async function getHockeyGoalsOUAnalysis(sim, mainTotalsLine) {
    return await getAndParse(HOCKEY_GOALS_OU_PROMPT, { line: mainTotalsLine, sim }, "hockey_goals_ou_analysis");
}

export async function getHockeyWinnerAnalysis(sim) {
    return await getAndParse(HOCKEY_WINNER_PROMPT, { sim }, "hockey_winner_analysis");
}

export async function getBasketballPointsOUAnalysis(sim, mainTotalsLine) {
    return await getAndParse(BASKETBALL_POINTS_OU_PROMPT, { line: mainTotalsLine, sim }, "basketball_points_ou_analysis");
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val}`).join('; ');
    const data = { sim, propheticScenario: rawData.propheticScenario, marketIntel, microSummaryJson: microSummary, richContext, riskAssessment };
    return await getAndParse(STRATEGIC_CLOSING_PROMPT, data, "strategic_analysis");
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val}`).join('; ');
    const data = {
        valueBetsJson: valueBets,
        sim, modelConfidence, expertConfidence, riskAssessment, microSummary, generalAnalysis, strategicClosingThoughts
    };
    try {
        const filledPrompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data);
        const jsonString = await _callGemini(filledPrompt);
        const rec = JSON.parse(jsonString);
        if (rec && rec.recommended_bet && typeof rec.final_confidence === 'number') {
            rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));
            return rec;
        }
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "AI hiba: Érvénytelen JSON struktúra." };
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`);
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `AI Hiba: ${e.message.substring(0, 100)}` };
    }
}

// --- FŐ EXPORT (VISSZAÁLLÍTVA) ---
export default {
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
    _getContradictionAnalysis // Visszatéve a kompatibilitás miatt
};