// FÁJL: AI_Service.ts
// VERZIÓ: v120.0 (THE HYBRID MASTER - Strict Logic + Dual Output)
// CÉL: A "Tökéletes Tipp" (v103) szigorúságát ötvözni a "Két Tipp" (v114) igényével.
// MECHANIZMUS:
// 1. Primary (Banker): A v103-as "Single Best" logika alapján választva. Szigorúan büntetve, ha nincs statisztikai fedezet.
// 2. Secondary (Value): Alternatív opció, de szintén matematikai szűrőn átengedve.
// 3. Hard Math Guardrails: A kód kíméletlenül felülbírálja az AI-t, ha a számok nem stimmelnek.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalRawData } from './src/types/canonical.d.ts';
import type { ISportStrategy } from './strategies/ISportStrategy.js';

// --- Helper a Régi Promptok futtatásához ---
export async function getAndParse(
    promptTemplate: string, 
    data: any, 
    keyToExtract: string,
    stepName: string // Logoláshoz
): Promise<string> {
    try {
        const filledPrompt = fillPromptTemplate(promptTemplate, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, `getAndParse:${stepName}`);
        
        if (result && typeof result === 'object' && result.hasOwnProperty(keyToExtract)) {
            const value = result[keyToExtract];
            return value || "N/A (AI nem adott értéket)";
        }
        console.error(`[AI_Service v120.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v120.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

// === 0. ÜGYNÖK (DEEP SCOUT - Csak Adatgyűjtő) ===
const PROMPT_DEEP_SCOUT_V3 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a LIVE GOOGLE SEARCH investigation for the match: {home} vs {away} ({sport}).

[PRIORITY 1: SQUAD VALIDATION]:
**SEARCH FOR:** "{home} top scorers current season" AND "{home} transfers departures 2024 2025".
- Verify if the top scorers are STILL at the club.

[PRIORITY 2: MARKET INTEL]:
**SEARCH FOR:** "opening odds {home} vs {away}" OR "dropping odds {home} {away}".

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object:
{
  "narrative_summary": "<Concise 3-4 sentence Hungarian summary.>",
  "transferred_players": ["<Name>"],
  "market_movement": "<Specific note on odds changes>",
  "physical_factor": "<Note on fatigue>",
  "psychological_factor": "<Note on morale>",
  "weather_context": "<Weather>",
  "referee_context": "<Name + Strictness>",
  "tactical_leaks": "<Rumors>",
  "xg_stats": { "home_xg": null, "home_xga": null, "away_xg": null, "away_xga": null, "source": "Web" },
  "structured_data": { "h2h": [], "standings": {}, "probable_lineups": { "home": [], "away": [] }, "form_last_5": { "home": "", "away": "" } },
  "key_news": []
}
`;

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze the qualitative, narrative, and psychological state of both teams.
[INPUTS]: {rawDataJson}, {homeTeamName} vs {awayTeamName}
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object:
{
  "psy_profile_home": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a HAZAI csapatról.>",
  "psy_profile_away": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a VENDÉG csapatról.>"
}
`;

// === 3. ÜGYNÖK (A SPECIALISTA) ===
const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to apply contextual modifiers (from Agents 2, 2.5, 7) to a baseline statistical model.
[GUIDING PRINCIPLE]: **CONSERVATIVE and PROPORTIONAL**.
[INPUTS]: Pure xG: {pure_mu_h} - {pure_mu_a}, Context: {rawDataJson}, Psy: {psy_profile_home} / {psy_profile_away}
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object:
{
  "modified_mu_h": <Number>,
  "modified_mu_a": <Number>,
  "key_factors": ["<Factor 1>", "<Factor 2>"],
  "reasoning": "<Concise Hungarian explanation.>"
}
`;

// === MIKROMODELL PROMPTOK (V103 Standard) ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: {home} vs {away}.**
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10
CONTEXT: {richContext}
PSYCHOLOGIST: {psy_profile_home} / {psy_profile_away}
SPECIALIST: {specialist_reasoning}
CRITICAL OUTPUT FORMAT:
{"confidence_report": "**SCORE/10** - Indoklás."}`;

export const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian).
CONTEXT: Risk Assessment: "{riskAssessment}".
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}").
CRITICAL OUTPUT INSTRUCTION: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
DATA: Sim: H:{sim_pHome}%, A:{sim_pAway}%. Context: {news_home}, {news_away}.
CRITICAL OUTPUT INSTRUCTION: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
1st para: Stats (Probs: H:{sim_pHome}%, A:{sim_pAway}%; xG: {mu_h}-{mu_a}).
2nd para: Narrative (Tactics, Psychology).
CRITICAL OUTPUT INSTRUCTION: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian.
CONTEXT: {tacticalBriefing}.
DATA: {home} vs {away}.
CRITICAL OUTPUT INSTRUCTION: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL reports.
DATA:
- Risk: "{riskAssessment}"
- Tactics: "{tacticalBriefing}"
- Stats: Sim Probs H:{sim_pHome}%, A:{sim_pAway}%.
- Context: {richContext}
CRITICAL OUTPUT INSTRUCTION: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

export const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 interesting player-specific betting markets in Hungarian.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: {"player_market_analysis": "<Your Hungarian player market analysis here>". If no safe option, state "Nincs kiemelkedő lehetőség."}`;

// --- SPORT SPECIFIKUS PROMPTOK (V103) ---
export const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist. Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}.
CRITICAL OUTPUT INSTRUCTION: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}.
CRITICAL OUTPUT INSTRUCTION: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs line around {likelyLine} (mu={mu_corners}).
CRITICAL OUTPUT INSTRUCTION: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs line around {likelyLine} (mu={mu_cards}).
CRITICAL OUTPUT INSTRUCTION: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}.
CRITICAL OUTPUT INSTRUCTION: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%.
CRITICAL OUTPUT INSTRUCTION: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_WINNER_PROMPT = `You are an NBA/Basketball Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%.
CRITICAL OUTPUT INSTRUCTION: {"basketball_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_TOTAL_POINTS_PROMPT = `You are an NBA/Basketball O/U specialist. Analyze total points vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, Expected Sum: {sim_mu_sum}.
CRITICAL OUTPUT INSTRUCTION: {"basketball_total_points_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;


// === A "HIBRID MESTER" PROMPT (ÚJ: v103 Szigorúság + v114 Struktúra) ===
// Ez a prompt két tippet kér, de a döntési logikája a régi, szigorú rendszerre épül.
const MASTER_AI_PROMPT_TEMPLATE_HYBRID = `
CRITICAL TASK: You are the Head Analyst (AI Advisor).
Your task is to determine TWO betting recommendations: a "Banker" (Sure thing) and an "Alternative" (Value/Risk).

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson}
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence (Math): {modelConfidence}/10
4. Expert Confidence (Narrative): "{expertConfidence}"
5. Risk Assessment: "{riskAssessment}"
6. Strategic Thoughts: "{strategicClosingThoughts}"

**DECISION PROTOCOL (STRICT):**
1. **PRIMARY BET (THE BANKER):** - This must be the SINGLE SAFEST bet.
   - It MUST be supported by the Mathematical Simulation (Sim Probs).
   - If Math Confidence is high (>6) but you choose something else, you fail.
   - Focus on Main Markets: 1X2, Moneyline, Over/Under, BTTS.

2. **SECONDARY BET (VALUE/ALT):**
   - Find a second option. Can be higher risk/reward.
   - Look at Value Bets list.

OUTPUT FORMAT (Exact JSON):
{
  "primary": {
      "market": "<The SAFEST bet>",
      "confidence": <Number 1.0-10.0>,
      "reason": "<Short Hungarian reason>"
  },
  "secondary": {
      "market": "<Alternative bet>",
      "confidence": <Number 1.0-10.0>,
      "reason": "<Short Hungarian reason>"
  }
}
`;


// --- ÜGYNÖK FUTTATÓ FÜGGVÉNYEK ---

// === 0. ÜGYNÖK (DEEP SCOUT) ===
export async function runStep_DeepScout(data: { home: string, away: string, sport: string }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_DEEP_SCOUT_V3, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_DeepScout", 2, true);
    } catch (e: any) {
        console.error(`[AI_Service v120.0] Deep Scout Hiba: ${e.message}`);
        return null;
    }
}

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) ===
export async function runStep_TeamNameResolver(data: { inputName: string; searchTerm: string; rosterJson: any[]; }): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        return result && result.matched_id ? Number(result.matched_id) : null;
    } catch (e: any) {
        console.error(`[AI_Service v120.0] Térképész Hiba: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
export async function runStep_Psychologist(data: { rawDataJson: ICanonicalRawData; homeTeamName: string; awayTeamName: string; }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
    } catch (e: any) {
        return { "psy_profile_home": "AI Hiba", "psy_profile_away": "AI Hiba" };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) ===
export async function runStep_Specialist(data: any): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
    } catch (e: any) {
        return { "modified_mu_h": data.pure_mu_h, "modified_mu_a": data.pure_mu_a, "reasoning": "AI Hiba" };
    }
}

// === MIKROMODELL FUTTATÓK (Helpers) ===

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

// === A FŐNÖK: getMasterRecommendation (HIBRID VERZIÓ) ===
// Ez a kulcs: Két tippet ad, de MINDIG lefuttatja a matematikai büntetést a Fő Tippre.
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
    sport: string
) {
    try {
        const safeSim = sim || {};
        const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; ');

        // 1. Expert Confidence kinyerése
        let expertConfScore = 1.0;
        try {
            let match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
            if (match && match[1]) expertConfScore = parseFloat(match[1]);
        } catch(e) {}

        // 2. Modell Confidence (A "Matek") - Referencia pont
        const safeModelConfidence = typeof confidenceScores.winner === 'number' ? confidenceScores.winner : 5.0;

        const data = {
            valueBetsJson: valueBets,
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

        // HASZNÁLJUK A HIBRID PROMPTOT (Két Tipp, Szigorú Elvek)
        let template = MASTER_AI_PROMPT_TEMPLATE_HYBRID;
        if (sport === 'hockey') {
            template = template.replace(/BTTS, /g, ""); 
        }
        
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        if (!rec || (!rec.primary && !rec.recommended_bet)) throw new Error("Master AI hiba: Érvénytelen válasz struktúra.");
        
        // Struktúra egységesítése (ha a régi formátumot adná véletlenül)
        if (!rec.primary) {
            rec = {
                primary: { market: rec.recommended_bet, confidence: rec.final_confidence, reason: rec.brief_reasoning },
                secondary: { market: "Nincs második tipp", confidence: 0, reason: "Az AI egyetlen tippet generált." }
            };
        }

        // --- A "RÉGI VARÁZSLAT": MATEMATIKAI BÜNTETÉS (Guardrails) A FŐ TIPPRE ---
        // Ez garantálja, hogy a Fő Tipp (Banker) ne legyen hallucináció.
        
        const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
        const disagreementThreshold = 3.0;
        let confidencePenalty = 0;
        let disagreementNote = "";
        
        // Ha az Expert bizalom (Narratív) alacsony, de az AI tipp magas:
        if (expertConfScore < 1.5 && rec.primary.confidence > 5.0) {
            confidencePenalty = Math.max(0, rec.primary.confidence - 3.0);
            disagreementNote = " (KORREKCIÓ: A narratív elemzés negatív volt!)";
        }
        // Ha a Matek és az Expert nagyon eltér:
        else if (confidenceDiff > disagreementThreshold) {
            confidencePenalty = Math.min(2.0, confidenceDiff / 1.5);
            disagreementNote = ` (KORREKCIÓ: Statisztikai ellentmondás miatt csökkentve.)`;
        }
        
        // Büntetés alkalmazása a FŐ tippre
        rec.primary.confidence -= confidencePenalty;
        rec.primary.confidence = Math.max(1.0, Math.min(10.0, rec.primary.confidence));
        
        // Indoklás kiegészítése
        rec.primary.reason = (rec.primary.reason || "N/A") + disagreementNote;

        // Második tipp ellenőrzése (Enyhébb szűrő)
        if (rec.secondary.confidence > 8.0 && safeModelConfidence < 4.0) {
             rec.secondary.confidence -= 2.0; // Csak ha nagyon elszállt
             rec.secondary.reason += " (Kockázatos)";
        }

        // Visszamenőleges kompatibilitás a frontenddel
        rec.recommended_bet = rec.primary.market;
        rec.final_confidence = rec.primary.confidence;
        rec.brief_reasoning = rec.primary.reason;

        console.log(`[AI_Service v120.0 - Főnök] HIBRID Tippek Generálva. Fő: ${rec.primary.market} (${rec.primary.confidence}/10), Másodlagos: ${rec.secondary.market}`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v120.0 - Főnök] Hiba: ${e.message}`, e.stack);
        return { 
            recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: `Hiba: ${e.message}`,
            primary: { market: "Hiba", confidence: 1.0, reason: "Hiba" },
            secondary: { market: "Hiba", confidence: 0.0, reason: "Hiba" }
        };
    }
}


// --- FŐ ORCHESTRÁCIÓS LÉPÉS (V103 Logika + Sportág specifikus) ---
export async function runStep_FinalAnalysis(data: any): Promise<any> {
    
    const { rawDataJson, specialistReport, simulatorReport, psyReport, valueBetsJson, richContext, matchData, sportStrategy, confidenceScores } = data;
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
        // 1. Általános modellek futtatása
        const expertConfidencePromise = getExpertConfidence(confidenceScores, richContext, rawDataJson, psyReport, specialistReport);
        const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport, confidenceScores);
        const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext);

        // 2. Sportág-specifikus mikromodellek (V103.6 logika)
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
                getAndParse(BASKETBALL_WINNER_PROMPT, { sim_pHome: sim.pHome, sim_pAway: sim.pAway }, "basketball_winner_analysis", "Bask.Winner"),
                getAndParse(BASKEBALL_TOTAL_POINTS_PROMPT, { line: sim.mainTotalsLine, sim_pOver: sim.pOver, sim_mu_sum: (sim.mu_h_sim+sim.mu_a_sim) }, "basketball_total_points_analysis", "Bask.Totals")
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

        // 3. Szöveges elemzések
        try { tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment); } catch (e) {}
        try { generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, confidenceScores, psyReport); } catch (e) {}
        
        if (sport === 'soccer') {
            try { propheticTimeline = await getPropheticTimeline(rawDataJson, home, away, sport, tacticalBriefing); } catch (e) {}
        }

        try { strategic_synthesis = await getStrategicClosingThoughts(sim, rawDataJson, richContext, microAnalyses, riskAssessment, tacticalBriefing, valueBetsJson, confidenceScores, expertConfidence, psyReport, specialistReport, sport); } catch (e) {}

        // 4. A "FŐNÖK" HÍVÁSA (HIBRID MÓD)
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
            sport
        );

    } catch (e: any) {
        console.error(`[AI_Service v120.0] KRITIKUS HIBA: ${e.message}`);
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
