// FÁJL: AI_Service.ts
// VERZIÓ: v117.0 (Super Deep Scout: Market Spy Edition)
// MÓDOSÍTÁS (v117.0):
// 1. PROMPT: A 'PROMPT_DEEP_SCOUT_V3' kiegészítve a [PRIORITY 3: MARKET INTEL] blokkal.
//    A Deep Scout mostantól aktívan keresi a "dropping odds", "opening odds" kifejezéseket.
// 2. STRUKTÚRA: A kimeneti JSON bővült a 'market_movement' mezővel.

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
        console.error(`[AI_Service v117.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v117.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

// === 0. ÜGYNÖK (SUPER DEEP SCOUT - v117.0 MARKET SPY) ===
const PROMPT_DEEP_SCOUT_V3 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a LIVE GOOGLE SEARCH investigation for the match: {home} vs {away} ({sport}).
Act as a cynical investigative journalist.

[PRIORITY 1: SQUAD VALIDATION & GHOST HUNT (CRITICAL)]:
**SEARCH FOR:** "{home} top scorers current season" AND "{home} transfers departures 2024 2025".
- Verify if the top scorers from last season are STILL at the club.
- Did any key player leave recently (e.g. Haris Tabakovic, star strikers)?
- **Output any confirmed departures in 'transferred_players' list.**

[PRIORITY 2: MARKET INTEL & ODDS MOVEMENT (NEW)]:
**SEARCH FOR:** "opening odds {home} vs {away}" OR "dropping odds {home} {away}".
- Find the opening price vs current price.
- Is there a "Smart Money" move? (e.g. Home opened @ 2.10, now 1.85).
- **Output findings in 'market_movement' field.**

[PRIORITY 3: THE "HIDDEN" VARIABLES]:
1. **REFEREE INTEL:** Find the referee's name and recent strictness.
2. **SQUAD NEWS:** Who is injured/suspended?
3. **ATMOSPHERE:** Pitch condition, weather.

[PRIORITY 4: STATISTICAL DATA HARVEST]:
(Only if standard stats are hard to find)
1. **XG STATS:** Recent xG form.
2. **H2H:** Last 5 meetings.
3. **STANDINGS:** Current table.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{
  "narrative_summary": "<Concise 3-4 sentence Hungarian summary. MENTION transfers and market moves!>",
  "transferred_players": [
      "<Name of player who left>",
      "<Name of another player>"
  ],
  "market_movement": "<Specific note on odds changes (e.g. 'Hazai szorzó 2.10-ről 1.80-ra esett'). If none found, 'Stagnáló piac'.>",
  "physical_factor": "<Note on fatigue/travel>",
  "psychological_factor": "<Note on morale/pressure>",
  "weather_context": "<Weather + Pitch>",
  "referee_context": "<Name + Strictness>",
  "tactical_leaks": "<Formation rumors>",
  "xg_stats": {
      "home_xg": <Number or null>,
      "home_xga": <Number or null>,
      "away_xg": <Number or null>,
      "away_xga": <Number or null>,
      "source": "<String>"
  },
  "structured_data": {
      "h2h": [],
      "standings": {},
      "probable_lineups": { "home": [], "away": [] },
      "form_last_5": { "home": "", "away": "" }
  },
  "key_news": []
}
`;

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT ===
const PROMPT_TEAM_RESOLVER_V1 = `
TASK: You are 'The Mapper', an expert sports data mapping assistant.
Your goal is to find the correct team ID for a misspelled or alternative team name.
[CONTEXT]:
- Input Name (from ESPN): "{inputName}"
- Search Term (Normalized): "{searchTerm}"
- Available Roster (from API Provider): {rosterJson}
[INSTRUCTIONS]:
1. Analyze the 'Available Roster' (JSON array of {id, name} objects).
2. Find the *single best match* for the 'Search Term'.
3. The match must be logically sound (e.g., "Cologne" matches "1. FC Köln", "Man Utd" matches "Manchester United").
4. If the 'Search Term' is "N/A" or empty, you must return null.
5. If no logical match is found in the roster, you must return null.
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "matched_id": <Number | null>
}
`;

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze the qualitative, narrative, and psychological state of both teams.
[INPUTS]:
1. Full Raw Context (from Deep Scout & APIs): {rawDataJson}
2. Match Info: {homeTeamName} (Home) vs {awayTeamName} (Away)
[YOUR TASK]:
1. Analyze all inputs. Look for the 'transferred_players' list from Deep Scout.
2. If a key player left, mention how this affects the team's psyche (e.g. "Missing their top scorer").
3. Analyze motivation, pressure, and revenge narratives.
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "psy_profile_home": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a HAZAI csapatról.>",
  "psy_profile_away": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a VENDÉG csapatról.>"
}
`;

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT ===
const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to apply contextual modifiers (from Agents 2, 2.5, 7) to a baseline statistical model (from Agent 1).
[GUIDING PRINCIPLE - THE "REALISM" OATH]:
You MUST be **CONSERVATIVE and PROPORTIONAL**.
[INPUTS]:
1. Baseline (Pure) xG: {pure_mu_h} - {pure_mu_a}
2. Full Raw Context: {rawDataJson}
3. Psychological Profiles: {psy_profile_home} / {psy_profile_away}
4. Historical Learnings: {homeNarrativeRating} / {awayNarrativeRating}
[YOUR TASK]:
1. Check 'transferred_players' in the context. If a key scorer (like Tabakovic) is listed as transferred, REDUCE the team's expected goals (xG) significantly (-0.15 to -0.30).
2. Apply other modifiers (injuries, weather).
3. Provide the FINAL 'modified_mu_h' and 'modified_mu_a'.
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number>,
  "modified_mu_a": <Number>,
  "key_factors": ["<Factor 1>", "<Factor 2>"],
  "reasoning": "<Concise Hungarian explanation. Mention if xG was reduced due to transfers.>"
}
`;

// === MIKROMODELL PROMPTOK ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: {home} vs {away}.**
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10
CONTEXT: {richContext}
PSYCHOLOGIST: {psy_profile_home} / {psy_profile_away}
SPECIALIST: {specialist_reasoning}
**CHECK FOR TRANSFERS & MARKET:**
- If context mentions a key player left, reduce confidence.
- If 'market_movement' indicates "Smart Money" supports the data, INCREASE confidence.
CRITICAL OUTPUT FORMAT:
{"confidence_report": "**SCORE/10** - Indoklás."}`;

export const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian).
CONTEXT: Risk Assessment: "{riskAssessment}".
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}").
**TRANSFERS:** If a key player is listed as 'transferred_players' in the context, DO NOT mention them as a key player.
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
Focus on risks.
**MARKET & TRANSFERS:** Mention if odds are drifting against the favorite or if key players left.
DATA: Sim: H:{sim_pHome}%, A:{sim_pAway}%. Context: {news_home}, {news_away}.
CRITICAL OUTPUT INSTRUCTION: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
1st para: Stats (Probs: H:{sim_pHome}%, A:{sim_pAway}%; xG: {mu_h}-{mu_a}).
2nd para: Narrative (Tactics, Psychology). Mention any key departures if relevant.
CRITICAL OUTPUT INSTRUCTION: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian.
CONTEXT: {tacticalBriefing}.
DATA: {home} vs {away}.
Weave a narrative.
CRITICAL OUTPUT INSTRUCTION: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL reports.
**STRATEGY PILLARS:**
1. **MARKET WISDOM:** Check 'market_movement' in Context! If odds dropped, confirm it.
2. **MOTIVATION MATRIX:** Must-Win?
3. **TACTICAL CLASH:** Style vs Style.
DATA:
- Risk: "{riskAssessment}"
- Tactics: "{tacticalBriefing}"
- Stats: Sim Probs H:{sim_pHome}%, A:{sim_pAway}%.
- Context: {richContext}
CRITICAL OUTPUT INSTRUCTION: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

export const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 interesting player-specific betting markets in Hungarian.
**CRITICAL RULE: GHOST PLAYER CHECK.**
- Check the 'richContext' and 'transferred_players' list.
- DO NOT suggest a player who has left the club (e.g. Haris Tabakovic).
- Verify the player is currently active in the team.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: {"player_market_analysis": "<Your Hungarian player market analysis here>". If no safe option, state "Nincs kiemelkedő lehetőség."}`;

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


// === A "FŐNÖK" PROMPTJA (v114.0) ===
const MASTER_AI_PROMPT_TEMPLATE_V108 = `
CRITICAL TASK: You are the Head Analyst (The Boss).
Your task is to analyze ALL provided reports and determine TWO distinct betting recommendations.

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson}
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence: Winner:{confidenceWinner}/10, Totals:{confidenceTotals}/10
4. Narrative Context: "{expertConfidence}" (Contains MARKET INTEL)
5. Risk Assessment: "{riskAssessment}"
6. Strategic Thoughts: "{strategicClosingThoughts}"

**DECISION ALGORITHM:**
1. **PRIMARY BET (The "Banker"):** Find the safest, most statistically supported outcome.
2. **SECONDARY BET (The "Alternative"):** Find a distinct option (Value or different market).

**MARKET & GHOST CHECK:**
- Check 'market_movement' in context. If odds are dropping on your pick -> INCREASE CONFIDENCE.
- Triple check 'transferred_players'.

OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{
  "primary": {
      "market": "<The SAFEST market (e.g., Over 2.5)>",
      "confidence": <Number between 1.0-10.0>,
      "reason": "<Concise Hungarian reason>"
  },
  "secondary": {
      "market": "<The ALTERNATIVE market (e.g., Home Win or BTTS)>",
      "confidence": <Number between 1.0-10.0>,
      "reason": "<Concise Hungarian reason>"
  }
}
`;


// --- ÜGYNÖK FUTTATÓ FÜGGVÉNYEK ---

// === 0. ÜGYNÖK (DEEP SCOUT) ===
export async function runStep_DeepScout(data: { home: string, away: string, sport: string }): Promise<any> {
    try {
        console.log(`[AI_Service v117.0] 0. ÜGYNÖK (SUPER DEEP SCOUT v3 - MARKET SPY) INDÍTÁSA: ${data.home} vs ${data.away}...`);
        const filledPrompt = fillPromptTemplate(PROMPT_DEEP_SCOUT_V3, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_DeepScout", 2, true);
        
        console.log(`[AI_Service v117.0] Deep Scout Jelentés: "${result?.narrative_summary?.substring(0, 50)}..."`);
        if (result?.market_movement) {
            console.log(`[AI_Service v117.0] PIACI HÍRSZERZÉS (AI): ${result.market_movement}`);
        }
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v117.0] Deep Scout Hiba: ${e.message}`);
        return null;
    }
}

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) ===
export async function runStep_TeamNameResolver(data: { inputName: string; searchTerm: string; rosterJson: any[]; }): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        
        if (result && result.matched_id) {
            return Number(result.matched_id);
        } else {
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service v116.0] Térképész Hiba: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
export async function runStep_Psychologist(data: { rawDataJson: ICanonicalRawData; homeTeamName: string; awayTeamName: string; }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
    } catch (e: any) {
        console.error(`[AI_Service v116.0] Pszichológus Hiba: ${e.message}`);
        return { "psy_profile_home": "AI Hiba", "psy_profile_away": "AI Hiba" };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) ===
export async function runStep_Specialist(data: any): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
    } catch (e: any) {
        console.error(`[AI_Service v116.0] Specialista Hiba: ${e.message}`);
        return { "modified_mu_h": data.pure_mu_h, "modified_mu_a": data.pure_mu_a, "reasoning": "AI Hiba" };
    }
}

// === MIKROMODELL FUTTATÓK ===

async function getExpertConfidence(
    confidenceScores: { winner: number, totals: number, overall: number }, 
    richContext: string, 
    rawData: ICanonicalRawData, 
    psyReport: any, 
    specialistReport: any
) {
     const data = {
         confidenceWinner: confidenceScores.winner.toFixed(1), 
         confidenceTotals: confidenceScores.totals.toFixed(1), 
         richContext: richContext || "Nincs kontextus.",
         home: rawData?.home || 'Hazai',
         away: rawData?.away || 'Vendég',
         psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A"
     };
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, data, "confidence_report", "ExpertConfidence");
}

async function getRiskAssessment(
    sim: any, 
    rawData: ICanonicalRawData, 
    sport: string,
    confidenceScores: { winner: number, totals: number, overall: number }
) {
    const safeSim = sim || {};
    const data = {
        sport,
        confidenceWinner: confidenceScores.winner.toFixed(1),
        confidenceTotals: confidenceScores.totals.toFixed(1),
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        news_home: rawData?.team_news?.home || "N/A",
        news_away: rawData?.team_news?.away || "N/A",
        absentees_home_count: rawData?.absentees?.home?.length || 0,
        absentees_away_count: rawData?.absentees?.away?.length || 0,
        form_home: rawData?.form?.home_overall || "N/A",
        form_away: rawData?.form?.away_overall || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A"
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis", "RiskAssessment");
}

async function getTacticalBriefing(rawData: ICanonicalRawData, sport: string, home: string, away: string, riskAssessment: string) {
    const data = {
        sport, home, away,
        riskAssessment: riskAssessment || "N/A",
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        home_formation: rawData?.tactics?.home?.formation || "N/A",
        away_formation: rawData?.tactics?.away?.formation || "N/A",
        key_players_home: rawData?.key_players?.home?.map((p: any) => p.name).join(', ') || 'N/A',
        key_players_away: rawData?.key_players?.away?.map((p: any) => p.name).join(', ') || 'N/A'
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis", "TacticalBriefing");
}

async function getFinalGeneralAnalysis(sim: any, tacticalBriefing: string, rawData: ICanonicalRawData, confidenceScores: any, psyReport: any) {
    const safeSim = sim || {};
    const data = {
        confidenceWinner: confidenceScores.winner.toFixed(1), 
        confidenceTotals: confidenceScores.totals.toFixed(1), 
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
        psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai', away: rawData?.away || 'Vendég'
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis", "FinalGeneralAnalysis");
}

async function getPropheticTimeline(rawData: ICanonicalRawData, home: string, away: string, sport: string, tacticalBriefing: string) {
     const data = {
         sport, home, away,
         tacticalBriefing: tacticalBriefing || "N/A",
         home_style: rawData?.tactics?.home?.style || "N/A",
         away_style: rawData?.tactics?.away?.style || "N/A",
         tension: rawData?.contextual_factors?.match_tension_index || "N/A",
     };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario", "PropheticScenario");
}

async function getPlayerMarkets(keyPlayers: any, richContext: string) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, { keyPlayersJson: keyPlayers, richContext: richContext || "Nincs kontextus." }, "player_market_analysis", "PlayerMarkets");
}


// === STRATÉGIA ÉS FŐNÖK ===

async function getStrategicClosingThoughts(
    sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, 
    riskAssessment: string, tacticalBriefing: string, valueBets: any[], 
    confidenceScores: any, expertConfidence: string, psyReport: any, specialistReport: any, sport: string
) {
    const safeSim = sim || {};
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
        const analysisPart = typeof val === 'string' ? val.split('\nBizalom:')[0].trim() : 'N/A';
        return `${key}: ${analysisPart}`;
    }).join('; ');

    const data = {
        confidenceWinner: confidenceScores.winner.toFixed(1), 
        confidenceTotals: confidenceScores.totals.toFixed(1), 
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        tacticalBriefing: tacticalBriefing || "N/A",
        microSummaryJson: microSummary,
        richContext: richContext || "Nincs kontextus.",
        riskAssessment: riskAssessment || "N/A",
        valueBetsJson: valueBets,
        expertConfidence: expertConfidence || "N/A",
        specialist_reasoning: specialistReport?.reasoning || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
        psy_profile_away: psyReport?.psy_profile_away || "N/A",
     };
     
    let template = STRATEGIC_CLOSING_PROMPT;
    if (sport === 'hockey' || sport === 'basketball') {
        template = template.replace(/BTTS, /g, ""); 
    }
     
    return await getAndParse(template, data, "strategic_analysis", "StrategicClosing");
}

// === JAVÍTOTT FŐNÖK FELDOLGOZÓ (v114.0) ===
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

        let expertConfScore = 1.0;
        try {
            let match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
            if (!match) { match = expertConfidence?.match(/(?<!\d|\.)([1-9](\.\d)?|10(\.0)?)(?!\d|\.)/); }
            if (match && match[1]) expertConfScore = parseFloat(match[1]);
        } catch(e) {}

        const data = {
            valueBetsJson: valueBets,
            sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
            sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
            confidenceWinner: confidenceScores.winner.toFixed(1), 
            confidenceTotals: confidenceScores.totals.toFixed(1), 
            expertConfidence: expertConfidence || "N/A",
            riskAssessment: riskAssessment || "N/A",
            microSummary: microSummary,
            strategicClosingThoughts: strategicClosingThoughts || "N/A"
        };

        let template = MASTER_AI_PROMPT_TEMPLATE_V108; 
        if (sport === 'hockey' || sport === 'basketball') {
            template = template.replace(/BTTS, /g, ""); 
        }
        
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        // Validáció és Fallback
        if (!rec) throw new Error("Üres válasz a Master AI-tól.");

        // Ha az AI a régi formátumban válaszolna, átalakítjuk
        if (rec.recommended_bet && !rec.primary) {
            rec = {
                primary: {
                    market: rec.recommended_bet,
                    confidence: rec.final_confidence,
                    reason: rec.brief_reasoning
                },
                secondary: {
                    market: "Nincs második tipp",
                    confidence: 0,
                    reason: "Az AI egyetlen tippet generált."
                }
            };
        }

        // Visszamenőleges kompatibilitás
        rec.recommended_bet = rec.primary.market;
        rec.final_confidence = rec.primary.confidence;
        rec.brief_reasoning = rec.primary.reason;

        console.log(`[AI_Service v116.0 - Főnök] Két tipp generálva: 1. ${rec.primary.market}, 2. ${rec.secondary.market}`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v116.0 - Főnök] Hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack);
        // Hiba esetén biztonsági objektum
        return {
            recommended_bet: "Hiba",
            final_confidence: 1.0,
            brief_reasoning: "Hiba történt.",
            primary: { market: "Hiba", confidence: 1.0, reason: e.message },
            secondary: { market: "Hiba", confidence: 0.0, reason: "Hiba" }
        };
    }
}

// --- FŐ ORCHESTRÁCIÓS LÉPÉS (Változatlan v105.0) ===
export async function runStep_FinalAnalysis(data: any): Promise<any> {
    
    const { 
        rawDataJson, 
        specialistReport, 
        simulatorReport, 
        psyReport, 
        valueBetsJson, 
        richContext, 
        matchData, 
        sportStrategy,
        confidenceScores 
    } = data;

    const sim = simulatorReport || {};
    const home = matchData.home || 'Hazai';
    const away = matchData.away || 'Vendég';
    const sport = matchData.sport || 'soccer';
    
    let expertConfidence = `**${confidenceScores.overall.toFixed(1)}/10** - AI Hiba: Az Expert Confidence hívás nem futott le.`;
    let riskAssessment = "AI Hiba: A Risk Assessment hívás nem futott le.";
    let tacticalBriefing = "AI Hiba: A Tactical Briefing hívás nem futott le.";
    let generalAnalysis = "AI Hiba: A General Analysis hívás nem futott le.";
    let propheticTimeline = "AI Hiba: A Prophetic Timeline hívás nem futott le.";
    let strategic_synthesis = "AI Hiba: A Strategic Synthesis hívás nem futott le.";
    let masterRecommendation = { 
        "recommended_bet": "Hiba", 
        "final_confidence": 1.0, 
        "brief_reasoning": "AI Hiba: A Master Recommendation lánc megszakadt." 
    };
    
    let microAnalyses: { [key: string]: string } = {};
    
    try {
        // Mikromodellek
        const expertConfidencePromise = getExpertConfidence(confidenceScores, richContext, rawDataJson, psyReport, specialistReport);
        const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport, confidenceScores);
        const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext);

        const microModelResultsPromise = sportStrategy.runMicroModels({
            sim: sim,
            rawDataJson: rawDataJson,
            mainTotalsLine: sim.mainTotalsLine,
            confidenceScores: confidenceScores 
        });

        const results = await Promise.allSettled([
            expertConfidencePromise, 
            riskAssessmentPromise, 
            playerMarketsPromise,
            microModelResultsPromise 
        ]);

        expertConfidence = (results[0].status === 'fulfilled') ? (results[0].value as string) : `**1.0/10** - AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
        riskAssessment = (results[1].status === 'fulfilled') ? (results[1].value as string) : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
        
        if (results[3].status === 'fulfilled') {
            microAnalyses = results[3].value as { [key: string]: string };
        } else {
            microAnalyses = { "error": `Stratégia hiba: ${results[3].reason?.message}` };
        }
        
        microAnalyses['player_market_analysis'] = (results[2].status === 'fulfilled') ? (results[2].value as string) : `AI Hiba: ${results[2].reason?.message || 'Ismeretlen'}`;

        // Fő elemzések
        try {
            tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment);
        } catch (e: any) { tacticalBriefing = `AI Hiba (Tactical): ${e.message}`; }
        
        try {
            generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, confidenceScores, psyReport);
        } catch (e: any) { generalAnalysis = `AI Hiba (General): ${e.message}`; }

        if (sport === 'soccer') {
            try {
                propheticTimeline = await getPropheticTimeline(rawDataJson, home, away, sport, tacticalBriefing);
            } catch (e: any) { propheticTimeline = `AI Hiba (Prophetic): ${e.message}`; }
        } else {
            propheticTimeline = "N/A (Nem focihoz nem releváns)";
        }

        try {
            strategic_synthesis = await getStrategicClosingThoughts(
                sim, rawDataJson, richContext, microAnalyses, riskAssessment,
                tacticalBriefing, valueBetsJson, confidenceScores, expertConfidence,
                psyReport, specialistReport, sport
            );
        } catch (e: any) { strategic_synthesis = `AI Hiba (Strategic): ${e.message}`; }

        // Főnök hívása (v114.0)
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
        console.error(`[AI_Service v116.0] KRITIKUS HIBA a runStep_FinalAnalysis során: ${e.message}`);
        masterRecommendation.brief_reasoning = `KRITIKUS HIBA: ${e.message}. A többi elemzés (ha van) még érvényes lehet.`;
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
        agent_reports: {
            psychologist: psyReport,
            specialist: specialistReport
        }
    };
}

// --- CHAT FUNKCIÓ ---
export async function getChatResponse(context: string, history: any[], question: string): Promise<{ answer?: string; error?: string }> {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        const historyString = (history || [])
             .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            .join('\n');
        
        const prompt = `You are an elite sports analyst AI assistant specialized in the provided match analysis.
[CONTEXT of the analysis]:
--- START CONTEXT ---
${context}
--- END CONTEXT ---

CONVERSATION HISTORY:
${historyString}

Current User Question: ${question}

Answer concisely and accurately in Hungarian based ONLY on the provided Analysis Context and Conversation History.
Do not provide betting advice. Do not make up information not present in the context.`;
        
        const rawAnswer = await _callGemini(prompt, false); 
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni." };
    } catch (e: any) {
        console.error(`[AI_Service v116.0] Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}
