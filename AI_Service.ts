// FÁJL: AI_Service.ts
// VERZIÓ: v107.0 (Recommended Market Awareness)
// MÓDOSÍTÁS (v107.0):
// 1. FEJLESZTÉS: A 'MASTER_AI_PROMPT_TEMPLATE' (Főnök Prompt) most már
//    elfogadja a 'recommendedMarket' (Matematikai Ajánlás) változót.
// 2. LOGIKA: Az AI mostantól "hallja", amit a Model.ts üzen.
//    Ha a 'recommendedMarket' pl. 'home_total', akkor az AI tudni fogja,
//    hogy a 9/10-es bizalom a Hazai Gólokra vonatkozik, és azt kell ajánlania.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData, ICanonicalOdds } from './src/types/canonical.d.ts';

// === ÚJ IMPORT A STRATÉGIÁHOZ ===
import type { ISportStrategy } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===


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
        console.error(`[AI_Service v106.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v106.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}


// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT (Változatlan) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT (Változatlan) ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze the qualitative, narrative, and psychological state of both teams.
[INPUTS]:
1. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   (Includes: H2H history, Form strings, Absentees, Coach names, Referee, Weather)
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

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT (Változatlan) ===
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

// === MIKROMODELL PROMPTOK (v105.0 alapokon) ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: The match is {home} vs {away}.
DO NOT mention any other teams.**

Start with the Statistical Model Confidence.
**NEW (v105.0) Statistical Scores:**
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10

Adjust these scores based on the Narrative Context ({richContext}) AND the Specialist/Psychologist reports.
CONTEXT: {richContext}
PSYCHOLOGIST: H: {psy_profile_home} / A: {psy_profile_away}
SPECIALIST: {specialist_reasoning}

Consider factors like injuries, form discrepancies, H2H, market moves etc. mentioned in the context.
If Winner Conf is low but Totals Conf is high, you MUST explain this discrepancy.
--- CRITICAL OUTPUT FORMAT ---
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{"confidence_report": "**SCORE/10** - Indoklás."}
Replace SCORE with a number between 1.0 and 10.0. This is your FINAL expert confidence.
--- END CRITICAL OUTPUT FORMAT ---`;

export const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
CONTEXT: First, read the Risk Assessment report: "{riskAssessment}". Reflect this context.
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Formation: H:{home_formation} vs A:{away_formation}, Key Players: Home: {key_players_home}, Away: {key_players_away}.
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
Focus ONLY on significant risks, potential upsets, or contradictions identified in the data.
**NEW (v105.0) Statistical Scores:**
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10
Highlight significant risks (e.g., low winner confidence, high totals confidence) with **asterisks**.
DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Context: News: H:{news_home}, A:{news_away}. Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Form: H:{form_home}, A:{form_away}.
Tension: {tension}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief.
Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
**CRITICAL CONTEXT: The match is {home} vs {away}.**
1st para: state the most likely outcome based purely on the statistical simulation (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; Expected Score: H {mu_h} - A {mu_a}).
Mention the model's confidence scores (v105.0): Stat. Winner Conf: {confidenceWinner}/10, Stat. Totals Conf: {confidenceTotals}/10.
2nd para: explain the 'why' behind the prediction by synthesizing insights from the tactical briefing ("{tacticalBriefing}") and the psychologist report ("{psy_profile_home}" / "{psy_profile_away}").
Highlight key conclusions or turning points with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}.
CONTEXT: First, read the Tactical Briefing: "{tacticalBriefing}". Your narrative MUST match this tactical assessment.
DATA: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}.
Weave a narrative. Highlight key moments and the outcome with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

// === MÓDOSÍTVA (v106.0): Team Totals említése ===
export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL available reports: Risk Assessment, Tactical Briefing, Specialist Report, Psychologist Report, Statistical Simulation results, Micromodel conclusions, and overall Context.
Discuss the most promising betting angles considering both potential value and risk. Focus recommendations on MAIN MARKETS (1X2, Totals, BTTS, Moneyline) AND now Team Totals if applicable.

**NEW (v106.0) Instructions:**
- Pay close attention to the separated confidence scores.
- Look for **TEAM TOTALS** opportunities in the 'Value Bets' list.
- If 'Totals' confidence is high and 'Winner' confidence is low, prioritize Totals (Match or Team).

DATA:
- Risk Assessment: "{riskAssessment}"
- Tactical Briefing: "{tacticalBriefing}"
- Specialist Report: "{specialist_reasoning}"
- Psychologist Report: "H: {psy_profile_home} / A: {psy_profile_away}"
- Stats: Sim Probs H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%.
- ExpertConf: "{expertConfidence}"
- Micromodels Summary: {microSummaryJson}
- Value Bets Found: {valueBetsJson}
- Context Summary: {richContext}
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

export const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist.
Suggest 1-2 potentially interesting player-specific betting markets in Hungarian.
Provide a very brief (1 sentence) justification.
Highlight player names & markets with **asterisks**.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}.
If no interesting market is found, state "Nincs kiemelkedő játékospiaci lehetőség."`;

export const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist.
Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}.
(v105.0) Stat. Confidence: Winner={confidenceWinner}/10, Totals={confidenceTotals}/10.
Consider team styles if available. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}.
(v105.0) Stat. Confidence (Totals): {confidenceTotals}/10.
Consider team styles/absentees. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs an estimated line around {likelyLine} based on mu={mu_corners}.
DATA: Calculated mu_corners: {mu_corners}. Consider team styles.
Conclude with confidence level towards Over or Under a likely line (e.g., 9.5 or 10.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs an estimated line around {likelyLine} based on mu={mu_cards}.
DATA: Calculated mu_cards: {mu_cards}. Consider context: Referee style: "{referee_style}", Match tension: "{tension}".
Conclude with confidence level towards Over or Under a likely line (e.g., 4.5 or 5.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}.
(v105.0) Stat. Confidence (Totals): {confidenceTotals}/10.
Consider goalie GSAx. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%.
(v105.0) Stat. Confidence (Winner): {confidenceWinner}/10.
Consider goalie GSAx, Form. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_WINNER_PROMPT = `You are an NBA/Basketball Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%.
(v105.0) Stat. Confidence (Winner): {confidenceWinner}/10.
Consider context: Form, Absentees. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

export const BASKETBALL_TOTAL_POINTS_PROMPT = `You are an NBA/Basketball O/U specialist. Analyze total points vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, Expected Points Sum: {sim_mu_sum}.
(v105.0) Stat. Confidence (Totals): {confidenceTotals}/10.
Consider context: Pace, Absentees. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_total_points_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;


// === A "FŐNÖK" PROMPTJA (v107.0 - RECOMMENDED MARKET AWARENESS) ===
const MASTER_AI_PROMPT_TEMPLATE_V107 = `
CRITICAL TASK: You are the Head Analyst (AI Advisor).
Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
**CRITICAL RULE: You MUST provide a concrete betting recommendation.**

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson} (Includes Team Totals, Main & Side markets)
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence (Statistical) (v105.0):
   - Winner Confidence: {confidenceWinner}/10
   - Totals Confidence: {confidenceTotals}/10
   - **MATHEMATICALLY RECOMMENDED MARKET: {recommendedMarket}** (This indicates which market has the highest statistical backing!)

4. Expert Confidence (Narrative): "{expertConfidence}"
5. Risk Assessment: "{riskAssessment}"
6. Specialist Conclusions: "{microSummary}"
7. General Analysis: "{generalAnalysis}"
8. Strategic Thoughts: "{strategicClosingThoughts}"
9. Psychologist (Agent 2.5) Report: {psychologistReportJson}
10. Specialist (Agent 3) Report: {specialistReportJson}

YOUR DECISION PROCESS (v107.0 - "THE HUNTER"):
1. **CHECK THE RECOMMENDED MARKET:** If the mathematical model recommends "home_total" or "away_total", it means it found EXTREME value in that team's performance. **PRIORITIZE THIS.**
   - Example: If 'recommendedMarket' is 'home_total', ignore the match Winner/Under and look for the best Home Team Over bet in 'Value Bets'.
2. **Confidence Divergence:** If 'Totals Confidence' is HIGH (>8.0) but Winner is LOW, stick to Totals (Match or Team).
3. **Team Totals:** Always check if a Team Total bet (e.g., "Warriors Over 115.5") offers better security than a match total.
4. **Reflect Uncertainty:** Use the final_confidence score (1.0-10.0) accurately.

OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{"recommended_bet": "<The SINGLE most compelling market (e.g., Hazai győzelem, Over 224, Warriors Over 115.5)>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the choice>"}
`;


// --- ÜGYNÖK FUTTATÓ FÜGGVÉNYEK ---

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (Változatlan) ===
interface TeamNameResolverInput {
    inputName: string;
    searchTerm: string;
    rosterJson: any[];
}
export async function runStep_TeamNameResolver(data: TeamNameResolverInput): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        
        if (result && result.matched_id) {
            const foundId = Number(result.matched_id);
            const matchedTeam = data.rosterJson.find(t => t.id === foundId);
            console.log(`[AI_Service v106.0 - Térképész] SIKER: Az AI a "${data.searchTerm}" nevet ehhez a csapathoz rendelte: "${matchedTeam?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI_Service v106.0 - Térképész] HIBA: Az AI nem talált egyezést (matched_id: null) a "${data.searchTerm}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service v106.0 - Térképész] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (Változatlan) ===
interface PsychologistInput {
    rawDataJson: ICanonicalRawData;
    homeTeamName: string;
    awayTeamName: string;
}
export async function runStep_Psychologist(data: PsychologistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
    } catch (e: any) {
        console.error(`[AI_Service v106.0] AI Hiba (Psychologist): ${e.message}`);
        return {
            "psy_profile_home": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni.",
            "psy_profile_away": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni."
        };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (Változatlan) ===
interface SpecialistInput {
    pure_mu_h: number;
    pure_mu_a: number;
    quant_source: string;
    rawDataJson: ICanonicalRawData;
    sport: string;
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
    } catch (e: any) {
        console.error(`[AI_Service v106.0] AI Hiba (Specialist): ${e.message}`);
        return {
            "modified_mu_h": data.pure_mu_h,
            "modified_mu_a": data.pure_mu_a,
            "key_factors": [`KRITIKUS HIBA: A 3. Ügynök (Specialista) nem tudott lefutni: ${e.message}`],
            "reasoning": "AI Hiba: A 3. Ügynök (Specialista) hibát dobott, a Súlyozott xG megegyezik a Tiszta xG-vel."
        };
    }
}

// === MIKROMODELL FUTTATÓK (Sportág-független) ===

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
    const countKeyAbsentees = (absentees: any) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0;

    const data = {
        sport,
        confidenceWinner: confidenceScores.winner.toFixed(1),
        confidenceTotals: confidenceScores.totals.toFixed(1),
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        news_home: rawData?.team_news?.home || "N/A",
        news_away: rawData?.team_news?.away || "N/A",
        absentees_home_count: countKeyAbsentees(rawData?.absentees?.home),
        absentees_away_count: countKeyAbsentees(rawData?.absentees?.away),
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

async function getFinalGeneralAnalysis(
    sim: any, 
    tacticalBriefing: string, 
    rawData: ICanonicalRawData, 
    confidenceScores: { winner: number, totals: number, overall: number }, 
    psyReport: any
) {
    const safeSim = sim || {};
    const data = {
        confidenceWinner: confidenceScores.winner.toFixed(1), 
        confidenceTotals: confidenceScores.totals.toFixed(1), 
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim,
        mu_a: sim.mu_a_sim,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai',
        away: rawData?.away || 'Vendég'
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
    return await getAndParse(PLAYER_MARKETS_PROMPT, {
        keyPlayersJson: keyPlayers,
        richContext: richContext || "Nincs kontextus."
        }, "player_market_analysis", "PlayerMarkets");
}


// === STRATÉGIA ÉS FŐNÖK (MÓDOSÍTVA v106.0) ===

async function getStrategicClosingThoughts(
    sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, 
    riskAssessment: string, tacticalBriefing: string, valueBets: any[], 
    confidenceScores: { winner: number, totals: number, overall: number }, 
    expertConfidence: string, psyReport: any, specialistReport: any, sport: string
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

async function getMasterRecommendation(
    valueBets: any[], 
    sim: any, 
    confidenceScores: { winner: number, totals: number, overall: number, recommended_market?: string }, // v107.0: recommended_market
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
            let match;
            match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
            if (!match) { match = expertConfidence?.match(/(?<!\d|\.)([1-9](\.\d)?|10(\.0)?)(?!\d|\.)/); }

            if (match && match[1]) {
                expertConfScore = parseFloat(match[1]);
                expertConfScore = Math.max(1.0, Math.min(10.0, expertConfScore));
                console.log(`[AI_Service v106.0 - Főnök] Expert bizalom sikeresen kinyerve: ${expertConfScore}`);
            } else {
                console.warn(`[AI_Service v106.0 - Főnök] Nem sikerült kinyerni az expert bizalmat: "${expertConfidence}". Alapértelmezett: 1.0`);
                expertConfScore = 1.0;
            }
        } catch(e: any) { 
            console.warn("[AI_Service v106.0 - Főnök] Hiba az expert bizalom kinyerésekor:", e);
            expertConfScore = 1.0;
        }

        const safeConfidenceOverall = typeof confidenceScores.overall === 'number' && !isNaN(confidenceScores.overall) ? confidenceScores.overall : 5.0;

        const data = {
            valueBetsJson: valueBets,
            sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
            sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
            confidenceWinner: confidenceScores.winner.toFixed(1), 
            confidenceTotals: confidenceScores.totals.toFixed(1), 
            confidenceOverall: confidenceScores.overall.toFixed(1),
            recommendedMarket: confidenceScores.recommended_market || "N/A", // v107.0: Átadjuk az AI-nak
            expertConfidence: expertConfidence || "N/A",
            riskAssessment: riskAssessment || "N/A",
            microSummary: microSummary,
            generalAnalysis: generalAnalysis || "N/A",
            strategicClosingThoughts: strategicClosingThoughts || "N/A",
            contradictionAnalysis: contradictionAnalysisResult || "N/A",
            psychologistReportJson: psyReport, 
            specialistReportJson: specialistReport 
        };

        // === 1. LÉPÉS: AI (Tanácsadó) hívása az ÚJ (v107.0) Prompttal ===
        let template = MASTER_AI_PROMPT_TEMPLATE_V107; // v107-es "Hunter" prompt
        if (sport === 'hockey' || sport === 'basketball') {
            template = template.replace(/BTTS, /g, ""); 
        }
        
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        if (!rec || !rec.recommended_bet || typeof rec.final_confidence !== 'number') {
            console.error("[AI_Service v106.0 - Főnök] Master AI hiba: Érvénytelen JSON struktúra a válaszban:", rec);
            throw new Error("AI hiba: Érvénytelen JSON struktúra a MasterRecommendation-ben.");
        }
        
        // --- 2. LÉPÉS: KÓD (A "Főnök") átveszi az irányítást ---
        console.log(`[AI_Service v106.0 - Főnök] AI (Tanácsadó) javaslata: ${rec.recommended_bet} @ ${rec.final_confidence}/10`);

        // 1. Eltérés-alapú büntetés
        const confidenceDiff = Math.abs(safeConfidenceOverall - expertConfScore);
        const disagreementThreshold = 3.0;
        let confidencePenalty = 0;
        let disagreementNote = "";
        
        if (expertConfScore < 1.1 && expertConfidence && !expertConfidence.toLowerCase().includes("hiba")) {
            confidencePenalty = Math.max(0, rec.final_confidence - 3.0);
            disagreementNote = " (FŐNÖK KORREKCIÓ: Expert bizalom extrém alacsony!)";
        }
        else if (confidenceDiff > disagreementThreshold) {
            confidencePenalty = Math.min(2.0, confidenceDiff / 1.5);
            disagreementNote = ` (FŐNÖK KORREKCIÓ: Modell (Átlag ${safeConfidenceOverall.toFixed(1)}) vs Expert (${expertConfScore.toFixed(1)}) eltérés miatt.)`;
        }
        
        rec.final_confidence -= confidencePenalty;
        rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));

        // 2. Bizalmi Kalibráció
        let calibrationNote = "";
        try {
            const calibrationMap = getConfidenceCalibrationMap();
            if (calibrationMap && Object.keys(calibrationMap).length > 0) {
                const confFloor = Math.floor(rec.final_confidence);
                const safeConfFloor = Math.max(1.0, confFloor);
                const bucketKey = `${safeConfFloor.toFixed(1)}-${(safeConfFloor + 0.9).toFixed(1)}`;
                
                if (calibrationMap[bucketKey] && calibrationMap[bucketKey].total >= 5) {
                    const wins = calibrationMap[bucketKey].wins;
                    const total = calibrationMap[bucketKey].total;
                    const calibratedPct = (wins / total) * 100;
                    const calibratedConfidence = calibratedPct / 10;
                    
                    if (Math.abs(calibratedConfidence - rec.final_confidence) > 0.5) {
                        calibrationNote = ` (Kalibrált: ${calibratedConfidence.toFixed(1)}/10, ${total} minta.)`;
                    }
                }
            }
        } catch(calError: any) { 
            console.warn(`[AI_Service v106.0 - Főnök] Bizalmi kalibráció hiba: ${calError.message}`); 
        }

        rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote;
        if (rec.brief_reasoning.length > 500) {
            rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "...";
        }

        console.log(`[AI_Service v106.0 - Főnök] VÉGLEGES KORRIGÁLT Tipp: ${rec.recommended_bet} @ ${rec.final_confidence.toFixed(1)}/10`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v106.0 - Főnök] Végleges hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack);
        throw new Error(`AI Hiba (Főnök): ${e.message.substring(0, 100)}`);
    }
}


// === FŐ ORCHESTRÁCIÓS LÉPÉS (Változatlan v105.0) ===
interface FinalAnalysisInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    rawDataJson: ICanonicalRawData; 
    specialistReport: any;
    simulatorReport: any;
    psyReport: any;
    valueBetsJson: any[];
    richContext: string;
    sportStrategy: ISportStrategy;
    confidenceScores: { winner: number, totals: number, overall: number, recommended_market?: string }; // v107.0 Update
}

export async function runStep_FinalAnalysis(data: FinalAnalysisInput): Promise<any> {
    
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
            console.error(`[AI_Service] KRITIKUS HIBA: A sportág-specifikus mikromodellek (${sport}) futtatása sikertelen: ${results[3].reason?.message}`);
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
            } catch (e: any) { 
                propheticTimeline = `AI Hiba (Prophetic): ${e.message}`; 
            }
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

        // Főnök hívása (v106.0)
        masterRecommendation = await getMasterRecommendation(
            valueBetsJson,
            sim,
            confidenceScores, // Ez tartalmazza a v107.0-ás recommended_market-et
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
        console.error(`[AI_Service v106.0] KRITIKUS HIBA a runStep_FinalAnalysis során: ${e.message}`);
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

// --- CHAT FUNKCIÓ --- (Változatlan)
interface ChatMessage {
  role: 'user' | 'model' | 'ai';
  parts: { text: string }[];
}

export async function getChatResponse(context: string, history: ChatMessage[], question: string): Promise<{ answer?: string; error?: string }> {
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
Do not provide betting advice. Do not make up information not present in the context.
If the answer isn't in the context or history, politely state that the information is not available in the analysis.`;
        
        const rawAnswer = await _callGemini(prompt, false); 
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni." };
    } catch (e: any) {
        console.error(`[AI_Service v106.0] Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT (v106.0) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist,
    runStep_Specialist,
    runStep_FinalAnalysis,
    getChatResponse
};
