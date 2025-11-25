// FÁJL: AI_Service.ts
// VERZIÓ: v130.3 (HOTFIX: TS2305 & Sniper Protocol)
// CÉL: Visszahozni a v103.6 "brutálisan jó" döntési logikáját + TS2305 Javítás.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalRawData } from './src/types/canonical.d.ts';

// --- Helper a Régi Promptok futtatásához ---
export async function getAndParse(
    promptTemplate: string, 
    data: any, 
    keyToExtract: string,
    stepName: string
): Promise<string> {
    try {
        const filledPrompt = fillPromptTemplate(promptTemplate, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, `getAndParse:${stepName}`);
        
        if (result && typeof result === 'object' && result.hasOwnProperty(keyToExtract)) {
            const value = result[keyToExtract];
            return value || "N/A (AI nem adott értéket)";
        }
        // Próbáljuk megkeresni máshol is a kulcsot (kisbetű/nagybetű hiba esetén)
        const lowerKey = keyToExtract.toLowerCase();
        const foundKey = Object.keys(result || {}).find(k => k.toLowerCase() === lowerKey);
        if (foundKey) return result[foundKey];

        console.warn(`[AI_Service v130.3] AI Figyelem: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot. Helyette ezeket: ${Object.keys(result || {}).join(', ')}`);
        return "N/A";
    } catch (e: any) {
        console.error(`[AI_Service v130.3] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

// === ÜGYNÖK PROMPTOK ===

const PROMPT_DEEP_SCOUT_V3 = `TASK: Investigate {home} vs {away} ({sport}). OUTPUT JSON: { "narrative_summary": "...", "key_news": [] }`;

// === JAVÍTÁS: VISSZAKERÜLT A HIÁNYZÓ PROMPT ===
const PROMPT_TEAM_RESOLVER_V1 = `
TASK: You are 'The Mapper', an expert sports data mapping assistant.
Your goal is to find the correct team ID for a misspelled or alternative team name.
[CONTEXT]:
- Input Name: "{inputName}"
- Search Term: "{searchTerm}"
- Roster: {rosterJson}
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object: { "matched_id": <Number | null> }
`;
// ===============================================

const PROMPT_PSYCHOLOGIST_V93 = `TASK: Analyze psychology for {homeTeamName} vs {awayTeamName}. OUTPUT JSON: { "psy_profile_home": "...", "psy_profile_away": "..." }`;
const PROMPT_SPECIALIST_V94 = `TASK: Adjust xG ({pure_mu_h}-{pure_mu_a}) based on context. OUTPUT JSON: { "modified_mu_h": number, "modified_mu_a": number, "reasoning": "..." }`;

// === A RÉGI, NYERŐ FŐNÖK PROMPT (SNIPER MODE) ===
const MASTER_AI_PROMPT_TEMPLATE_SNIPER = `
CRITICAL TASK: You are the Head Analyst.
Your task is to analyze ALL reports and determine the SINGLE most compelling betting recommendation.

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson} (Priority #1)
2. Sniper Choice (Math): {bestSafeBetJson} (Priority #2)
3. Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%, O/U:{sim_pOver}%
4. Expert Confidence: "{expertConfidence}"

**YOUR DECISION PROCESS (THE SNIPER PROTOCOL):**
1. **Seek Value First:** If there is a Value Bet (>5% EV) on a MAIN market (1X2, Totals, BTTS) that is supported by the narrative, THIS IS THE PICK.
2. **Analyze the Odds:** Do NOT recommend bets with extremely low odds (e.g., <1.25) unless they are absolute "Bankers" (90%+ probability). We want PROFIT, not just hits.
3. **The "Sniper" Fallback:** If no Value Bet is found, look at the 'Sniper Choice' (Math Pick). Does the Narrative support it? If yes, take it.
4. **No Forced Bets:** If the risks are too high and odds are bad, you CAN say "No Bet" or recommend a very safe "Double Chance".

OUTPUT FORMAT (Exact JSON):
{
  "recommended_bet": "<The single best market, e.g. 'Hazai győzelem' or 'Over 2.5'>",
  "final_confidence": <Number 1.0-10.0>,
  "brief_reasoning": "<One sentence Hungarian explanation. Mention if it's a Value Bet.>"
}
`;

// --- ÜGYNÖK FUTTATÓK ---

export async function runStep_DeepScout(data: any) { return _callGeminiWithJsonRetry(fillPromptTemplate(PROMPT_DEEP_SCOUT_V3, data), "DeepScout", 1, true); }

// === JAVÍTÁS: VISSZAKERÜLT A HIÁNYZÓ FÜGGVÉNY (TS2305 FIX) ===
export async function runStep_TeamNameResolver(data: { inputName: string; searchTerm: string; rosterJson: any[]; }): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        return result && result.matched_id ? Number(result.matched_id) : null;
    } catch (e: any) {
        console.error(`[AI_Service v130.3] Térképész Hiba: ${e.message}`);
        return null;
    }
}
// ==============================================================

export async function runStep_Psychologist(data: any) { return _callGeminiWithJsonRetry(fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data), "Psychologist"); }
export async function runStep_Specialist(data: any) { return _callGeminiWithJsonRetry(fillPromptTemplate(PROMPT_SPECIALIST_V94, data), "Specialist"); }

// === MIKROMODELL FUTTATÓK (Helpers) ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst. Provide a confidence score and justification in Hungarian.
CRITICAL OUTPUT FORMAT: {"confidence_report": "**SCORE/10** - Indoklás."}`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés". OUTPUT JSON: {"risk_analysis": "..."}`;
export const TACTICAL_BRIEFING_PROMPT = `You are a tactician. Write a briefing. OUTPUT JSON: {"analysis": "..."}`;
export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor. Write a summary. OUTPUT JSON: {"general_analysis": "..."}`;
export const PROPHETIC_SCENARIO_PROMPT = `You are a journalist. Write a scenario. OUTPUT JSON: {"scenario": "..."}`;
export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Write closing thoughts. OUTPUT JSON: {"strategic_analysis": "..."}`;
export const PLAYER_MARKETS_PROMPT = `Suggest player markets. OUTPUT JSON: {"player_market_analysis": "..."}`;

// Mikromodellek
export const BTTS_ANALYSIS_PROMPT = `Analyze BTTS. OUTPUT JSON: {"btts_analysis": "..."}`;
export const SOCCER_GOALS_OU_PROMPT = `Analyze Goals O/U. OUTPUT JSON: {"goals_ou_analysis": "..."}`;
export const CORNER_ANALYSIS_PROMPT = `Analyze Corners. OUTPUT JSON: {"corner_analysis": "..."}`;
export const CARD_ANALYSIS_PROMPT = `Analyze Cards. OUTPUT JSON: {"card_analysis": "..."}`;
export const HOCKEY_GOALS_OU_PROMPT = `Analyze Hockey Goals. OUTPUT JSON: {"hockey_goals_ou_analysis": "..."}`;
export const HOCKEY_WINNER_PROMPT = `Analyze Hockey Winner. OUTPUT JSON: {"hockey_winner_analysis": "..."}`;
export const BASKETBALL_WINNER_PROMPT = `Analyze NBA Winner. OUTPUT JSON: {"basketball_winner_analysis": "..."}`;
export const BASKETBALL_TOTAL_POINTS_PROMPT = `Analyze NBA Points. OUTPUT JSON: {"basketball_total_points_analysis": "..."}`;


async function getExpertConfidence(confidenceScores: { winner: number, totals: number, overall: number }, richContext: string, rawData: ICanonicalRawData, psyReport: any, specialistReport: any) {
     const data = {
         confidenceWinner: confidenceScores.winner.toFixed(1), confidenceTotals: confidenceScores.totals.toFixed(1), 
         richContext: richContext || "Nincs kontextus.",
         home: rawData?.home || 'Hazai', away: rawData?.away || 'Vendég',
         psy_profile_home: psyReport?.psy_profile_home || "N/A", psy_profile_away: psyReport?.psy_profile_away || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A"
     };
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, data, "confidence_report", "ExpertConfidence");
}

async function getRiskAssessment(sim: any, rawData: ICanonicalRawData, sport: string, confidenceScores: any) {
    const safeSim = sim || {};
    const data = {
        sport,
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        news_home: rawData?.team_news?.home || "N/A", news_away: rawData?.team_news?.away || "N/A",
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis", "RiskAssessment");
}

async function getTacticalBriefing(rawData: ICanonicalRawData, sport: string, home: string, away: string, riskAssessment: string) {
    const data = {
        sport, home, away, riskAssessment: riskAssessment || "N/A",
        home_style: rawData?.tactics?.home?.style || "N/A", away_style: rawData?.tactics?.away?.style || "N/A",
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis", "TacticalBriefing");
}

async function getFinalGeneralAnalysis(sim: any, tacticalBriefing: string, rawData: ICanonicalRawData, confidenceScores: any, psyReport: any) {
    const safeSim = sim || {};
    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A", psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai', away: rawData?.away || 'Vendég'
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis", "FinalGeneralAnalysis");
}

async function getPropheticTimeline(rawData: ICanonicalRawData, home: string, away: string, sport: string, tacticalBriefing: string) {
     const data = { sport, home, away, tacticalBriefing: tacticalBriefing || "N/A" };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario", "PropheticScenario");
}

async function getPlayerMarkets(keyPlayers: any, richContext: string) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, { keyPlayersJson: keyPlayers, richContext: richContext || "Nincs kontextus." }, "player_market_analysis", "PlayerMarkets");
}

async function getStrategicClosingThoughts(sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, riskAssessment: string, tacticalBriefing: string, valueBets: any[], confidenceScores: any, expertConfidence: string, psyReport: any, specialistReport: any, sport: string) {
    const safeSim = sim || {};
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
        const analysisPart = typeof val === 'string' ? val.split('\nBizalom:')[0].trim() : 'N/A';
        return `${key}: ${analysisPart}`;
    }).join('; ');

    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        tacticalBriefing: tacticalBriefing || "N/A",
        microSummaryJson: microSummary,
        richContext: richContext || "Nincs kontextus.",
        riskAssessment: riskAssessment || "N/A",
        valueBetsJson: valueBets,
        expertConfidence: expertConfidence || "N/A",
     };
     
    let template = STRATEGIC_CLOSING_PROMPT;
    if (sport === 'hockey' || sport === 'basketball') {
        template = template.replace(/BTTS, /g, ""); 
    }
    return await getAndParse(template, data, "strategic_analysis", "StrategicClosing");
}

// === MIKROMODELL FUTTATÓK (V121.1) ===
export async function getBTTSAnalysis(sim: any, rawData: ICanonicalRawData) {
     const safeSim = sim || {};
     const data = {
        sim_pBTTS: safeSim.pBTTS,
        sim_mu_h: safeSim.mu_h_sim,
        sim_mu_a: safeSim.mu_a_sim,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
     };
     return await getAndParse(BTTS_ANALYSIS_PROMPT, data, "btts_analysis", "BTTSAnalysis");
}

export async function getSoccerGoalsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
     const safeSim = sim || {};
     const countKeyAbsentees = (absentees: any) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0;
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        absentees_home_count: countKeyAbsentees(rawData?.absentees?.home),
        absentees_away_count: countKeyAbsentees(rawData?.absentees?.away)
     };
    return await getAndParse(SOCCER_GOALS_OU_PROMPT, data, "goals_ou_analysis", "GoalsOUAnalysis");
}

export async function getCornerAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCorners = safeSim.mu_corners_sim;
    const likelyLine = muCorners ? (Math.round(muCorners - 0.1)) + 0.5 : 9.5;
    const data = {
        mu_corners: muCorners,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        likelyLine: likelyLine 
    };
    return await getAndParse(CORNER_ANALYSIS_PROMPT, data, "corner_analysis", "CornerAnalysis");
}

export async function getCardAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCards = safeSim.mu_cards_sim;
    const likelyLine = muCards ? (Math.round(muCards - 0.1)) + 0.5 : 4.5;
    const data = {
        mu_cards: muCards,
        referee_style: rawData?.referee?.style || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A",
        likelyLine: likelyLine 
    };
    return await getAndParse(CARD_ANALYSIS_PROMPT, data, "card_analysis", "CardAnalysis");
}

export async function getHockeyGoalsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
     const safeSim = sim || {};
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx || "N/A", 
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx || "N/A"
     };
     return await getAndParse(HOCKEY_GOALS_OU_PROMPT, data, "hockey_goals_ou_analysis", "HockeyGoalsOUAnalysis");
}

export async function getHockeyWinnerAnalysis(sim: any, rawData: ICanonicalRawData) {
     const safeSim = sim || {};
     const data = {
        sim_pHome: safeSim.pHome,
        sim_pAway: safeSim.pAway,
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx || "N/A",
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx || "N/A",
        form_home: rawData?.form?.home_overall || "N/A",
        form_away: rawData?.form?.away_overall || "N/A"
     };
    return await getAndParse(HOCKEY_WINNER_PROMPT, data, "hockey_winner_analysis", "HockeyWinnerAnalysis");
}

export async function getBasketballPointsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
     const safeSim = sim || {};
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        pace: 98, // Egyszerűsítve
        home_style: rawData?.shot_distribution?.home || "N/A",
        away_style: rawData?.shot_distribution?.away || "N/A"
     };
     return await getAndParse(BASKETBALL_TOTAL_POINTS_PROMPT, data, "basketball_total_points_analysis", "BasketballPointsOUAnalysis");
}


// === A FŐNÖK: getMasterRecommendation (SNIPER EDITION) ===
async function getMasterRecommendation(
    valueBets: any[], 
    sim: any, 
    confidenceScores: { winner: number, totals: number, overall: number }, 
    expertConfidence: string,
    riskAssessment: string, 
    microAnalyses: any, 
    generalAnalysis: string, 
    strategicClosingThoughts: string, 
    contradictionAnalysisResult: string,
    psyReport: any,
    specialistReport: any,
    sport: string,
    bestSafeBet: any
) {
    try {
        const safeSim = sim || {};
        const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; ');

        let expertConfScore = 1.0;
        try {
            let match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
            if (match && match[1]) expertConfScore = parseFloat(match[1]);
        } catch(e) {}

        const safeModelConfidence = typeof confidenceScores.winner === 'number' ? confidenceScores.winner : 5.0;

        const data = {
            valueBetsJson: valueBets,
            bestSafeBetJson: JSON.stringify(bestSafeBet),
            sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
            sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
            modelConfidence: safeModelConfidence, 
            expertConfidence: expertConfidence || "N/A",
            riskAssessment: riskAssessment || "N/A",
            microSummary: microSummary,
            strategicClosingThoughts: strategicClosingThoughts || "N/A",
            psychologistReportJson: psyReport, 
            specialistReportJson: specialistReport 
        };

        let template = MASTER_AI_PROMPT_TEMPLATE_SNIPER;
        if (sport === 'hockey') {
            template = template.replace(/BTTS, /g, ""); 
        }
        
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        if (!rec || (!rec.recommended_bet && !rec.primary)) throw new Error("Master AI hiba: Érvénytelen válasz struktúra.");
        
        if (!rec.primary) {
            rec = {
                primary: { market: rec.recommended_bet, confidence: rec.final_confidence, reason: rec.brief_reasoning },
                secondary: { market: "Nincs második tipp", confidence: 0, reason: "Az AI egyetlen tippet generált." },
                verdict: rec.brief_reasoning || "Nincs szöveges ítélet."
            };
        }

        const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
        const disagreementThreshold = 3.0;
        let confidencePenalty = 0;
        let disagreementNote = "";
        
        if (expertConfScore < 1.5 && rec.primary.confidence > 5.0) {
            confidencePenalty = Math.max(0, rec.primary.confidence - 3.0);
            disagreementNote = " (KORREKCIÓ: A narratív elemzés negatív volt!)";
        }
        else if (confidenceDiff > disagreementThreshold) {
            confidencePenalty = Math.min(2.0, confidenceDiff / 1.5);
            disagreementNote = ` (KORREKCIÓ: Statisztikai ellentmondás miatt csökkentve.)`;
        }
        
        rec.primary.confidence -= confidencePenalty;
        rec.primary.confidence = Math.max(1.0, Math.min(10.0, rec.primary.confidence));
        
        if (rec.verdict) {
            rec.primary.reason = (rec.primary.reason || "") + `\n\n💡 A LÉNYEG: ${rec.verdict}` + disagreementNote;
        } else {
            rec.primary.reason = (rec.primary.reason || "") + disagreementNote;
        }

        rec.recommended_bet = rec.primary.market;
        rec.final_confidence = rec.primary.confidence;
        rec.brief_reasoning = rec.primary.reason;

        console.log(`[AI_Service v130.3 - Főnök] SNIPER MODE Tipp. Fő: ${rec.primary.market} (${rec.primary.confidence}/10).`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v130.3 - Főnök] Hiba: ${e.message}`, e.stack);
        return { 
            recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: `Hiba: ${e.message}`,
            primary: { market: "Hiba", confidence: 1.0, reason: "Hiba" },
            secondary: { market: "Hiba", confidence: 0.0, reason: "Hiba" }
        };
    }
}


// --- FŐ ORCHESTRÁCIÓS LÉPÉS ---
export async function runStep_FinalAnalysis(data: any): Promise<any> {
    
    const { rawDataJson, specialistReport, simulatorReport, psyReport, valueBetsJson, richContext, matchData, sportStrategy, confidenceScores, bestSafeBet } = data;
    const sim = simulatorReport || {};
    const home = matchData.home || 'Hazai';
    const away = matchData.away || 'Vendég';
    const sport = matchData.sport || 'soccer';
    
    let expertConfidence = "Hiba";
    let riskAssessment = "Hiba";
    let tacticalBriefing = "Hiba";
    let generalAnalysis = "Hiba";
    let propheticTimeline = "N/A";
    let strategic_synthesis = "Hiba";
    let masterRecommendation = { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    let microAnalyses: { [key: string]: string } = {};
    
    try {
        const expertConfidencePromise = getExpertConfidence(confidenceScores, richContext, rawDataJson, psyReport, specialistReport);
        const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport, confidenceScores);
        const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext);

        let sportSpecificPromises: Promise<any>[] = [];
        
        if (sport === 'soccer') {
            sportSpecificPromises = [
                getBTTSAnalysis(sim, rawDataJson),
                getSoccerGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 2.5),
                getCornerAnalysis(sim, rawDataJson),
                getCardAnalysis(sim, rawDataJson)
            ];
        } else if (sport === 'hockey') {
            sportSpecificPromises = [
                getHockeyGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 6.5),
                getHockeyWinnerAnalysis(sim, rawDataJson)
            ];
        } else if (sport === 'basketball') {
             sportSpecificPromises = [
                getBasketballPointsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 220.5)
             ];
        }

        const results = await Promise.allSettled([
            expertConfidencePromise, 
            riskAssessmentPromise, 
            playerMarketsPromise, 
            ...sportSpecificPromises
        ]);

        expertConfidence = (results[0].status === 'fulfilled') ? (results[0].value as string) : "Hiba";
        riskAssessment = (results[1].status === 'fulfilled') ? (results[1].value as string) : "Hiba";
        microAnalyses['player_market_analysis'] = (results[2].status === 'fulfilled') ? (results[2].value as string) : "Hiba";

        if (sport === 'soccer') {
            microAnalyses['btts_analysis'] = (results[3].status === 'fulfilled') ? (results[3].value as string) : "Hiba";
            microAnalyses['goals_ou_analysis'] = (results[4].status === 'fulfilled') ? (results[4].value as string) : "Hiba";
            microAnalyses['corner_analysis'] = (results[5].status === 'fulfilled') ? (results[5].value as string) : "Hiba";
            microAnalyses['card_analysis'] = (results[6].status === 'fulfilled') ? (results[6].value as string) : "Hiba";
        } else if (sport === 'hockey') {
            microAnalyses['hockey_goals_ou_analysis'] = (results[3].status === 'fulfilled') ? (results[3].value as string) : "Hiba";
            microAnalyses['hockey_winner_analysis'] = (results[4].status === 'fulfilled') ? (results[4].value as string) : "Hiba";
        }

        try { tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment); } catch (e) {}
        try { generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, confidenceScores, psyReport); } catch (e) {}
        
        if (sport === 'soccer') {
            try { propheticTimeline = await getPropheticTimeline(rawDataJson, home, away, sport, tacticalBriefing); } catch (e) {}
        }

        try { strategic_synthesis = await getStrategicClosingThoughts(sim, rawDataJson, richContext, microAnalyses, riskAssessment, tacticalBriefing, valueBetsJson, confidenceScores, expertConfidence, psyReport, specialistReport, sport); } catch (e) {}

        // 4. A "FŐNÖK" HÍVÁSA (SNIPER MODE)
        masterRecommendation = await getMasterRecommendation(
            valueBetsJson, 
            sim, 
            confidenceScores, 
            expertConfidence, 
            riskAssessment, 
            microAnalyses, 
            generalAnalysis, 
            strategic_synthesis, 
            "N/A", 
            psyReport, 
            specialistReport, 
            sport,
            bestSafeBet // <--- ÚJ: ÁTADÁS
        );

    } catch (e: any) {
        console.error(`[AI_Service v130.3] KRITIKUS HIBA: ${e.message}`);
        masterRecommendation.brief_reasoning = `KRITIKUS HIBA: ${e.message}`;
    }
    
    return {
        risk_assessment: riskAssessment,
        tactical_briefing: tacticalBriefing,
        general_analysis: generalAnalysis,
        strategic_synthesis: strategic_synthesis,
        prophetic_timeline: propheticTimeline,
        final_confidence_report: expertConfidence,
        micromodels: microAnalyses,
        master_recommendation: masterRecommendation, 
        agent_reports: { psychologist: psyReport, specialist: specialistReport }
    };
}

// --- CHAT FUNKCIÓ (Változatlan) ---
export async function getChatResponse(context: string, history: any[], question: string): Promise<{ answer?: string; error?: string }> {
    if (!context || !question) return { error: "Hiányzó adatok." };
    try {
        const historyString = (history || []).map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`).join('\n');
        const prompt = `You are an elite sports analyst AI. Context:\n${context}\nHistory:\n${historyString}\nUser Question: ${question}\nAnswer concisely in Hungarian.`;
        const rawAnswer = await _callGemini(prompt, false); 
        return rawAnswer ? { answer: rawAnswer } : { error: "Hiba." };
    } catch (e: any) { return { error: e.message }; }
}
