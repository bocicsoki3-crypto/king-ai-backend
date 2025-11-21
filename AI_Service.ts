// FÁJL: AI_Service.ts
// VERZIÓ: v115.0 (Super Deep Scout: Sherlock Edition)
// MÓDOSÍTÁS (v115.0):
// 1. PROMPT: A 'PROMPT_DEEP_SCOUT_V3' jelentősen kibővítve.
//    Most már vadássza a bírói stílust, a hiányzók okát és a taktikai pletykákat is.
// 2. KIMENET: A JSON struktúra bővült 'referee_context' és 'tactical_leaks' mezőkkel.

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
        console.error(`[AI_Service v115.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v115.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

// === 0. ÜGYNÖK (SUPER DEEP SCOUT - v115.0) ===
const PROMPT_DEEP_SCOUT_V3 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a LIVE GOOGLE SEARCH investigation for the match: {home} vs {away} ({sport}).
Act as a cynical investigative journalist who digs deeper than standard stats.

[PRIORITY 1: THE "HIDDEN" VARIABLES]:
1. **REFEREE INTEL:** Find the referee's name and recent strictness (cards per game). Is he a "card-happy" ref?
2. **SQUAD NEWS & LEAKS:**
   - Who is DEFINITELY out? Why? (Injury, Suspension, Coach Beef?)
   - Are there rumors of rotation? (e.g. "resting players for Cup").
3. **ATMOSPHERE & WEATHER:**
   - Is the pitch in bad condition?
   - Is the weather extreme (heavy snow/rain/heat)? How do these teams cope?
   - Is there fan protest or toxic atmosphere?

[PRIORITY 2: STATISTICAL DATA HARVEST]:
(Only if standard stats are hard to find, but verify them)
1. **XG STATS:** Find recent xG/xGA form.
2. **H2H:** Last 5 meetings.
3. **STANDINGS:** Current table situation.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{
  "narrative_summary": "<Concise 3-4 sentence Hungarian summary of the most critical findings (Injuries, Motivation, Ref).>",
  "physical_factor": "<Note on fatigue/travel/schedule congestion>",
  "psychological_factor": "<Note on morale/pressure/motivation>",
  "weather_context": "<Weather + Pitch condition note>",
  "referee_context": "<Name + Strictness level (e.g. 'Kassai - Szigorú, sok lap') or 'N/A'>",
  "tactical_leaks": "<Any info on formation changes or rotation rumors>",
  "xg_stats": {
      "home_xg": <Number or null>,
      "home_xga": <Number or null>,
      "away_xg": <Number or null>,
      "away_xga": <Number or null>,
      "source": "<String>"
  },
  "structured_data": {
      "h2h": [
          { "date": "YYYY-MM-DD", "score": "H-A", "home_team": "Name", "away_team": "Name" },
          { "date": "YYYY-MM-DD", "score": "H-A", "home_team": "Name", "away_team": "Name" }
      ],
      "standings": {
          "home_pos": <Number or null>,
          "home_points": <Number or null>,
          "away_pos": <Number or null>,
          "away_points": <Number or null>
      },
      "probable_lineups": {
          "home": ["Player1", "Player2", ...],
          "away": ["Player1", "Player2", ...]
      },
      "form_last_5": {
          "home": "<String e.g. 'W,L,D,W,W'>",
          "away": "<String e.g. 'L,L,L,D,W'>"
      }
  },
  "key_news": [
      "<Specific News 1 (Source)>",
      "<Specific News 2 (Source)>"
  ]
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
   (Includes: H2H history, Form strings, Absentees, Coach names, Referee, Weather, DEEP SCOUT INTEL)
2. Match Info: {homeTeamName} (Home) vs {awayTeamName} (Away)
[YOUR TASK]:
1. Analyze all inputs to understand the *story* of this match.
2. Go beyond simple stats. What is the narrative?
   - Is this a "must-win" relegation battle or a title decider?
   - Is this a revenge match (check H2H)?
   - Is one team in a "desperate" state (e.g., "LLLLL" form, coach just fired)?
   - Is one team "over-confident" (e.g., "WWWWW" form, easy opponent)?
   - How significant are the absentees (e.g., "Star Striker OUT")?
3. Generate a concise psychological profile for BOTH teams.
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
Do NOT modify the xG values significantly unless the contextual factors are EXTREME.
- Minor factors (light rain, 1-2 average players out) should result in minimal or ZERO change (e.g., +/- 0.05 xG).
- Significant factors (key player >8.0 rating out, heavy snow, extreme pressure) should be proportional.
[INPUTS]:
1. Baseline (Pure) xG (from Agent 1, Quant):
   - pure_mu_h: {pure_mu_h}
   - pure_mu_a: {pure_mu_a}
   - quant_source: "{quant_source}"
2. Full Raw Context (from Agent 2, Scout): {rawDataJson}
3. Psychological Profiles (from Agent 2.5, Psychologist):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
4. Historical Learnings (from Agent 7, Auditor's Cache):
   - homeNarrativeRating: {homeNarrativeRating}
   - awayNarrativeRating: {awayNarrativeRating}
[YOUR TASK - MODIFICATION & REASONING]:
1. Analyze all inputs. Pay special attention to:
   - **Psychology (Agent 2.5):** How does the narrative (e.g., "must-win", "desperate") affect the baseline xG?
   -**Absentees (Agent 2):** Are key players missing? (e.g., "Star Striker OUT" -> Decrease xG).
   - **Historical Learnings (Agent 7):** Did the Auditor leave a note?
2. **PROPORTIONAL MODIFICATION:** Apply small, logical adjustments (+/- 0.05 to 0.30) to the 'pure_mu_h' and 'pure_mu_a' based *only* on the most significant factors.
3. Provide the FINAL 'modified_mu_h' and 'modified_mu_a' as numbers.
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number, the final weighted xG for Home. Example: 1.35>,
  "modified_mu_a": <Number, the final weighted xG for Away. Example: 1.15>,
  "key_factors": [
    "<List of 3-5 string bullet points describing the SIGNIFICANT qualitative factors used (from Agents 2, 2.5, 7).>"
  ],
  "reasoning": "<A concise, 1-2 sentence Hungarian explanation of HOW the key_factors led to the final (and proportional) modified xG numbers.>"
}
`;

// === MIKROMODELL PROMPTOK ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: The match is {home} vs {away}. DO NOT mention any other teams.**
Start with the Statistical Model Confidence.
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10
Adjust scores based on Narrative Context ({richContext}) AND Reports.
CONTEXT: {richContext}
PSYCHOLOGIST: H: {psy_profile_home} / A: {psy_profile_away}
SPECIALIST: {specialist_reasoning}
Consider injuries, form, H2H, market moves.
CRITICAL OUTPUT FORMAT:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{"confidence_report": "**SCORE/10** - Indoklás."}
Replace SCORE with a number between 1.0 and 10.0.`;

export const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
CONTEXT: Risk Assessment: "{riskAssessment}".
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Formation: H:{home_formation} vs A:{away_formation}, Key Players: Home: {key_players_home}, Away: {key_players_away}.
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
Focus ONLY on significant risks, potential upsets, or contradictions identified in the data.
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10
Highlight significant risks with **asterisks**.
DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Context: News: H:{news_home}, A:{news_away}. Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Form: H:{form_home}, A:{form_away}. Tension: {tension}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
**CRITICAL CONTEXT: The match is {home} vs {away}.**
1st para: state the most likely outcome based on statistical simulation (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; Expected Score: H {mu_h} - A {mu_a}).
Mention Model Conf: Winner {confidenceWinner}/10, Totals {confidenceTotals}/10.
2nd para: explain the 'why' using tactical briefing ("{tacticalBriefing}") and psychologist report ("{psy_profile_home}" / "{psy_profile_away}").
Highlight key conclusions with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}.
CONTEXT: Tactical Briefing: "{tacticalBriefing}". Narrative MUST match this.
DATA: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}.
Weave a narrative. Highlight key moments and outcome with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

// === MÓDOSÍTVA (v109.0): STRATÉGIA A HÁROM PILLÉRREL ===
export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL reports: Risk Assessment, Tactical Briefing, Scenario, Sim results, Micromodels, Context.
Discuss promising betting angles considering value and risk.

**STRATEGY PILLARS:**
1. **MARKET WISDOM:** Does context mention odds movement? (Smart Money).
2. **MOTIVATION MATRIX:** Is it "Must-Win"? If yes, overweight offensive potential.
3. **TACTICAL CLASH:** "Style vs Style".

DATA:
- Risk: "{riskAssessment}"
- Tactics: "{tacticalBriefing}"
- Scenario: "{propheticScenario}"
- Stats: Sim Probs H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%.
- ModelConf: Winner:{confidenceWinner}/10, Totals:{confidenceTotals}/10. ExpertConf: "{expertConfidence}"
- Micromodels: {microSummaryJson}
- Value Bets: {valueBetsJson}
- Context: {richContext}
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

export const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 interesting player-specific betting markets in Hungarian.
Provide a very brief (1 sentence) justification. Highlight player names with **asterisks**.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}. If no opportunity, state "Nincs kiemelkedő lehetőség."`;

export const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist. Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}.
Stat. Confidence: Winner={confidenceWinner}/10, Totals={confidenceTotals}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}.
Stat. Confidence (Totals): {confidenceTotals}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs line around {likelyLine} (mu={mu_corners}).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs line around {likelyLine} (mu={mu_cards}).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Stat. Confidence: {confidenceTotals}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%. Stat. Confidence: {confidenceWinner}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_WINNER_PROMPT = `You are an NBA/Basketball Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%. Stat. Confidence: {confidenceWinner}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_TOTAL_POINTS_PROMPT = `You are an NBA/Basketball O/U specialist. Analyze total points vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, Expected Sum: {sim_mu_sum}. Stat. Confidence: {confidenceTotals}/10.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_total_points_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;


// === A "FŐNÖK" PROMPTJA (v114.0 - DUAL STRATEGY) ===
const MASTER_AI_PROMPT_TEMPLATE_V108 = `
CRITICAL TASK: You are the Head Analyst (The Boss).
Your task is to analyze ALL provided reports and determine TWO distinct betting recommendations.

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson}
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence: Winner:{confidenceWinner}/10, Totals:{confidenceTotals}/10
4. Narrative Context: "{expertConfidence}"
5. Risk Assessment: "{riskAssessment}"
6. Strategic Thoughts: "{strategicClosingThoughts}"

**DECISION ALGORITHM:**
1. **PRIMARY BET (The "Banker"):** Find the safest, most statistically supported outcome. (High confidence, aligns with Market & Motivation).
2. **SECONDARY BET (The "Alternative"):** Find a distinct option. It could be higher odds (Value), a different market (e.g. Corners/Player props), or a slightly riskier but logical outcome.

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
        console.log(`[AI_Service v115.0] 0. ÜGYNÖK (SUPER DEEP SCOUT v3) INDÍTÁSA: ${data.home} vs ${data.away}...`);
        const filledPrompt = fillPromptTemplate(PROMPT_DEEP_SCOUT_V3, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_DeepScout", 2, true);
        
        console.log(`[AI_Service v115.0] Deep Scout Jelentés: "${result?.narrative_summary?.substring(0, 50)}..."`);
        if (result?.referee_context) {
            console.log(`[AI_Service v115.0] Bírói Infó: ${result.referee_context}`);
        }
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v115.0] Deep Scout Hiba: ${e.message}`);
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
        console.error(`[AI_Service v115.0] Térképész Hiba: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
export async function runStep_Psychologist(data: { rawDataJson: ICanonicalRawData; homeTeamName: string; awayTeamName: string; }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
    } catch (e: any) {
        console.error(`[AI_Service v115.0] Pszichológus Hiba: ${e.message}`);
        return { "psy_profile_home": "AI Hiba", "psy_profile_away": "AI Hiba" };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) ===
export async function runStep_Specialist(data: any): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
    } catch (e: any) {
        console.error(`[AI_Service v115.0] Specialista Hiba: ${e.message}`);
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

        console.log(`[AI_Service v115.0 - Főnök] Két tipp generálva: 1. ${rec.primary.market}, 2. ${rec.secondary.market}`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v115.0 - Főnök] Hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack);
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
        console.error(`[AI_Service v115.0] KRITIKUS HIBA a runStep_FinalAnalysis során: ${e.message}`);
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
        console.error(`[AI_Service v115.0] Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}
