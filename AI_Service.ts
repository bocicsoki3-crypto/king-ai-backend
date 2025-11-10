// --- AI_Service.ts (v103.0 "Hibrid Főnök") ---
//
// FILOZÓFIAI VÁLTÁS (v103.0):
// Visszatérés a "Nyerő" Hibrid Modellhez. A "Főnök" (a JS kód) visszatér.
//
// 1. MEGTARTVA (az Új v102.1-ből):
//    - Agent 8 (Mapper)
//    - Agent 2.5 (Psychologist): Kiváló narratív elemzést ad.
//    - Agent 3 (Specialist): Kiváló súlyozott xG elemzést ad.
//
// 2. TÖRÖLVE (az Új v102.1-ből):
//    - Agent 5 (Critic): A logikája felesleges, mert a JS Főnök kalibrál.
//    - Agent 6 (Strategist): A "buta" döntési logikája katasztrofális volt.
//
// 3. VISSZAÁLLÍTVA (a Régi, Nyerő "régi AI_Service.ts.txt"-ből):
//    - AZ ÖSSZES MIKROMODELL PROMPT (BTTS, O/U, Corners, Cards, Tactical stb.).
//    - AZ EXPERT_CONFIDENCE_PROMPT (Kritikus input a kalibrációhoz).
//    - A MASTER_AI_PROMPT_TEMPLATE (Az AI "Tanácsadó").
//    - A getMasterRecommendation() FÜGGVÉNY, benne a kulcsfontosságú
//      "// --- Utófeldolgozás: Bizalom finomítása ---" kalibrációs blokkal.
//
// 4. A "BRUTÁLIS" FEJLESZTÉS (v103.0):
//    - A "Régi" MASTER_AI_PROMPT_TEMPLATE (AI Tanácsadó) mostantól megkapja
//      az "Új" Agent 2.5 (Pszichológus) és Agent 3 (Specialista) jelentéseit is.
//    - Eredmény: Az AI egy okosabb javaslatot ad, amit a JS Főnök kalibrál.
//

import { 
    _callGemini, // Feltételezzük, hogy ez a sima hívó
    _callGeminiWithJsonRetry, // Ez a robusztus, JSON-t visszaadó hívó
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData, ICanonicalOdds } from './src/types/canonical.d.ts';

// --- v103.0: Modernizált Helper a Régi Promptok futtatásához ---
// Ez a függvény a "régi" getAndParse logikáját követi, de a
// "v102.1"-es modern, robusztus _callGeminiWithJsonRetry hívót használja.
async function getAndParse(
    promptTemplate: string, 
    data: any, 
    keyToExtract: string,
    stepName: string // Logoláshoz
): Promise<string> {
    try {
        const filledPrompt = fillPromptTemplate(promptTemplate, data);
        // Az új, robusztus JSON hívó használata
        const result = await _callGeminiWithJsonRetry(filledPrompt, `getAndParse:${stepName}`);
        
        if (result && typeof result === 'object' && result.hasOwnProperty(keyToExtract)) {
            const value = result[keyToExtract];
            // Ha az érték null/undefined/üres string, akkor is 'N/A'-t adunk vissza
            return value || "N/A";
        }
        console.error(`[AI_Service v103.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v103.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}


// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT_TEAM_RESOLVER_V1 (MEGTARTVA v102.1-ből) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT_PSYCHOLOGIST_V93 (MEGTARTVA v102.1-ből) ===
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

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT_SPECIALIST_V94 (MEGTARTVA v102.1-ből) ===
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

// === MIKROMODELL PROMPTOK (VISSZAÁLLÍTVA a "régi, nyerő" fájlból) ===

// Ez a prompt generálja a "modelConfidence" és az "expertConfScore" kalibrációjához
// szükséges kritikus "expertConfidence" stringet.
const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: The match is {home} vs {away}.
DO NOT mention any other teams (e.g., Ferencváros, Debrecen).**
Start with Statistical Model Confidence ({modelConfidence}/10) and adjust it based on the Narrative Context ({richContext}) AND the Specialist/Psychologist reports.
CONTEXT: {richContext}
PSYCHOLOGIST: H: {psy_profile_home} / A: {psy_profile_away}
SPECIALIST: {specialist_reasoning}
Consider factors like injuries, form discrepancies, H2H, market moves etc. mentioned in the context.
--- CRITICAL OUTPUT FORMAT ---
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{"confidence_report": "**SCORE/10** - Indoklás."}
Replace SCORE with a number between 1.0 and 10.0.
The asterisks around the score/10 part are MANDATORY. The hyphen (-) and space after it before the justification are also MANDATORY.
--- END CRITICAL OUTPUT FORMAT ---`;

const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
CONTEXT: First, read the Risk Assessment report: "{riskAssessment}". Reflect this context (e.g., if risk is high, explain the tactical risk).
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Formation: H:{home_formation} vs A:{away_formation}, Key Players: Home: {key_players_home}, Away: {key_players_away}.
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
Focus ONLY on significant risks, potential upsets, or contradictions identified in the data.
Highlight significant risks with **asterisks**.
DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Context: News: H:{news_home}, A:{news_away}. Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Form: H:{form_home}, A:{form_away}.
Tension: {tension}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief.
Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
**CRITICAL CONTEXT: The match is {home} vs {away}.
DO NOT mention any other teams or leagues.**
1st para: state the most likely outcome based purely on the statistical simulation (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; Expected Score: H {mu_h} - A {mu_a}).
Mention the model's confidence: {modelConfidence}/10.
2nd para: explain the 'why' behind the prediction by synthesizing insights from the tactical briefing ("{tacticalBriefing}") and the psychologist report ("{psy_profile_home}" / "{psy_profile_away}").
Highlight key conclusions or turning points with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL available reports: Risk Assessment, Tactical Briefing, Specialist Report, Psychologist Report, Statistical Simulation results, Micromodel conclusions, and overall Context.
Discuss the most promising betting angles considering both potential value and risk. Focus recommendations on MAIN MARKETS (1X2, Totals, BTTS, Moneyline).
Explicitly mention significant risks or contradictions if they heavily influence the strategy. Conclude with a summary of the strategic approach.
DATA:
- Risk Assessment: "{riskAssessment}"
- Tactical Briefing: "{tacticalBriefing}"
- Specialist Report: "{specialist_reasoning}"
- Psychologist Report: "H: {psy_profile_home} / A: {psy_profile_away}"
- Stats: Sim Probs H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. ModelConf: {modelConfidence}/10. ExpertConf: "{expertConfidence}"
- Micromodels Summary: {microSummaryJson}
- Value Bets Found: {valueBetsJson}
- Context Summary: {richContext}
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist.
Suggest 1-2 potentially interesting player-specific betting markets in Hungarian (e.g., player shots on target, assists, cards, points).
Provide a very brief (1 sentence) justification. Max 3 sentences total.
Highlight player names & markets with **asterisks**.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}.
If no interesting market is found, state "Nincs kiemelkedő játékospiaci lehetőség."`;

const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist.
Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}.
Consider team styles if available: H:{home_style}, A:{away_style}. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Consider team styles/absentees: H:{home_style}, A:{away_style}, Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key.
Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs an estimated line around 9.5-10.5 based on mu={mu_corners}.
DATA: Calculated mu_corners: {mu_corners}. Consider team styles (wing play?): H:{home_style}, A:{away_style}.
Conclude with confidence level towards Over or Under a likely line (e.g., 9.5 or 10.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs an estimated line around 4.5-5.5 based on mu={mu_cards}.
DATA: Calculated mu_cards: {mu_cards}. Consider context: Referee style: "{referee_style}", Match tension: "{tension}", Derby: {is_derby}.
Conclude with confidence level towards Over or Under a likely line (e.g., 4.5 or 5.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;


// === A "BRUTÁLIS" FŐNÖK (v103.0) PROMPTJA (VISSZAÁLLÍTVA ÉS FEJLESZTVE) ===
// Ez a "régi, nyerő" MASTER prompt, KIEGÉSZÍTVE a "brutális" új
// Agent 2.5 (Pszichológus) és Agent 3 (Specialista) riportjaival.
const MASTER_AI_PROMPT_TEMPLATE_V103 = `
CRITICAL TASK: You are the Head Analyst (AI Advisor).
Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
**CRITICAL RULE: You MUST provide a concrete betting recommendation. Avoid "Nincs fogadás".
Select the 'least bad' or most logical option even with uncertainty, and reflect this in the final_confidence score.**

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson} (Includes main & side markets)
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence (Statistical): {modelConfidence}/10
4. Expert Confidence (Narrative): "{expertConfidence}" (This is the full report string from your colleague)
5. Risk Assessment: "{riskAssessment}"
6. Specialist Conclusions (Micromodels): "{microSummary}" (Includes Corners/Cards analysis)
7. General Analysis: "{generalAnalysis}"
8. Strategic Thoughts: "{strategicClosingThoughts}"
9. Contradiction Analysis: "{contradictionAnalysis}"

--- NEW (v103) ELITE AGENT REPORTS ---
10. Psychologist (Agent 2.5) Report: {psychologistReportJson}
11. Specialist (Agent 3) Report: {specialistReportJson}
---

YOUR DECISION PROCESS (v103.0):
1. Synthesize ALL reports, especially the new (v103) Psychologist and Specialist reports.
2. Find the betting angle with the most convergence across stats, narrative, and specialist models.
3. Prioritize Value Bets: If a reasonable Value Bet exists (especially >10% value) on a MAIN market (1X2, Totals, BTTS) AND it is supported or not strongly contradicted by the new agent reports (10, 11) and the micro-models (6), it's a strong candidate.
4. Consider Main Markets: If no clear value bet, choose the main market outcome (1X2, O/U goals/points, BTTS) most supported by combined evidence (Sim Probs + Confidence levels + Narrative + Agent Reports).
5. Side Market Check: Note the conclusions from specialist models (e.g., Corners, Cards) as context, but **DO NOT recommend them as the final bet.** Your recommended_bet MUST be from the main markets (1X2, Totals, BTTS, or Moneyline).
6. Reflect Uncertainty: Use the final_confidence score (1.0-10.0) accurately. Lower it significantly if risks are high, confidence scores conflict, or evidence is weak.

OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this exact structure:
{"recommended_bet": "<The SINGLE most compelling market (e.g., Hazai győzelem, Over 2.5, BTTS Igen)>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the choice>"}
`;


// --- ÜGYNÖK FUTTATÓ FÜGGVÉNYEK (v103.0) ---

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (MEGTARTVA v102.1-ből) ===
interface TeamNameResolverInput {
    inputName: string;
    searchTerm: string;
    rosterJson: any[]; // Lista a {id, name} objektumokból
}
export async function runStep_TeamNameResolver(data: TeamNameResolverInput): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        
        if (result && result.matched_id) {
            const foundId = Number(result.matched_id);
            const matchedTeam = data.rosterJson.find(t => t.id === foundId);
            console.log(`[AI_Service v103.0 - Térképész] SIKER: Az AI a "${data.searchTerm}" nevet ehhez a csapathoz rendelte: "${matchedTeam?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI_Service v103.0 - Térképész] HIBA: Az AI nem talált egyezést (matched_id: null) a "${data.searchTerm}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service v103.0 - Térképész] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (MEGTARTVA v102.1-ből) ===
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
        console.error(`[AI_Service v103.0] AI Hiba (Psychologist): ${e.message}`);
        return {
            "psy_profile_home": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni.",
            "psy_profile_away": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni."
        };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (MEGTARTVA v102.1-ből) ===
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
        console.error(`[AI_Service v103.0] AI Hiba (Specialist): ${e.message}`);
        // Kritikus hiba esetén visszatérünk a Tiszta xG-vel, hogy a lánc ne álljon le
        return {
            "modified_mu_h": data.pure_mu_h,
            "modified_mu_a": data.pure_mu_a,
            "key_factors": [`KRITIKUS HIBA: A 3. Ügynök (Specialista) nem tudott lefutni: ${e.message}`],
            "reasoning": "AI Hiba: A 3. Ügynök (Specialista) hibát dobott, a Súlyozott xG megegyezik a Tiszta xG-vel."
        };
    }
}

// === MIKROMODELL FUTTATÓK (VISSZAÁLLÍTVA a "régi" fájlból) ===
// Ezek a "régi" AI_Service.ts-ből származnak, modernizálva.

async function getExpertConfidence(modelConfidence: number, richContext: string, rawData: ICanonicalRawData, psyReport: any, specialistReport: any) {
     const safeModelConfidence = typeof modelConfidence === 'number' ? modelConfidence : 5.0;
     const data = {
         modelConfidence: safeModelConfidence,
         richContext: richContext || "Nincs kontextus.",
         home: rawData?.home || 'Hazai',
         away: rawData?.away || 'Vendég',
         psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A"
     };
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, data, "confidence_report", "ExpertConfidence");
}

async function getRiskAssessment(sim: any, rawData: ICanonicalRawData, sport: string) {
    const safeSim = sim || {};
    const countKeyAbsentees = (absentees: any) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0;

    const data = {
        sport,
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

async function getFinalGeneralAnalysis(sim: any, tacticalBriefing: string, rawData: ICanonicalRawData, modelConfidence: number, psyReport: any) {
    const safeSim = sim || {};
    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim, // A szimuláció alapjául szolgáló mu
        mu_a: sim.mu_a_sim,
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai',
        away: rawData?.away || 'Vendég'
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis", "FinalGeneralAnalysis");
}

async function getPlayerMarkets(keyPlayers: any, richContext: string) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, {
        keyPlayersJson: keyPlayers,
        richContext: richContext || "Nincs kontextus."
        }, "player_market_analysis", "PlayerMarkets");
}

async function getBTTSAnalysis(sim: any, rawData: ICanonicalRawData) {
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

async function getSoccerGoalsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
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

async function getCornerAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCorners = safeSim.mu_corners_sim;
    const data = {
        mu_corners: muCorners,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
    };
    const likelyLine = muCorners ? (Math.round(muCorners - 0.1)) + 0.5 : 9.5;
    data.likelyLine = likelyLine;
    return await getAndParse(CORNER_ANALYSIS_PROMPT, data, "corner_analysis", "CornerAnalysis");
}

async function getCardAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCards = safeSim.mu_cards_sim;
    const data = {
        mu_cards: muCards,
        referee_style: rawData?.referee?.style || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A",
        is_derby: rawData?.contextual_factors?.match_tension_index?.toLowerCase().includes('derby') ||
                  rawData?.h2h_summary?.toLowerCase().includes('rivalry')
    };
    const likelyLine = muCards ? (Math.round(muCards - 0.1)) + 0.5 : 4.5;
    data.likelyLine = likelyLine;
    return await getAndParse(CARD_ANALYSIS_PROMPT, data, "card_analysis", "CardAnalysis");
}

async function getStrategicClosingThoughts(
    sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, 
    riskAssessment: string, tacticalBriefing: string, valueBets: any[], 
    modelConfidence: number, expertConfidence: string, psyReport: any, specialistReport: any
) {
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
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0,
        expertConfidence: expertConfidence || "N/A",
        specialist_reasoning: specialistReport?.reasoning || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
        psy_profile_away: psyReport?.psy_profile_away || "N/A",
     };
    return await getAndParse(STRATEGIC_CLOSING_PROMPT, data, "strategic_analysis", "StrategicClosing");
}


// === A "FŐNÖK" (v103.0) HÍVÁSA: A "régi, nyerő" getMasterRecommendation ===
// Ez a függvény a "régi" fájlból származik, modernizálva, hogy
// _callGeminiWithJsonRetry-t használjon, és megkapja az új ügynökök riportjait.
// Ez tartalmazza a KRITIKUS fontosságú JS-alapú kalibrációs logikát.
async function getMasterRecommendation(
    valueBets: any[], 
    sim: any, 
    modelConfidence: number, 
    expertConfidence: string, // A getExpertConfidence() teljes stringje
    riskAssessment: string, 
    microAnalyses: any, 
    generalAnalysis: string, 
    strategicClosingThoughts: string, 
    contradictionAnalysisResult: string,
    psyReport: any, // ÚJ (v103)
    specialistReport: any // ÚJ (v103)
) {
    const safeSim = sim || {};
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; ');

    // Expert confidence pontszám kinyerése (a "régi" robusztus kód)
    let expertConfScore = 1.0;
    try {
        let match;
        match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
        if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
        if (!match) { match = expertConfidence?.match(/(?<!\d|\.)([1-9](\.\d)?|10(\.0)?)(?!\d|\.)/); }

        if (match && match[1]) {
             expertConfScore = parseFloat(match[1]);
             expertConfScore = Math.max(1.0, Math.min(10.0, expertConfScore));
             console.log(`[AI_Service v103.0 - Főnök] Expert bizalom sikeresen kinyerve: ${expertConfScore}`);
        } else {
             console.warn(`[AI_Service v103.0 - Főnök] Nem sikerült kinyerni az expert bizalmat: "${expertConfidence}". Alapértelmezett: 1.0`);
             expertConfScore = 1.0;
        }
    } catch(e: any) {
         console.warn("[AI_Service v103.0 - Főnök] Hiba az expert bizalom kinyerésekor:", e);
         expertConfScore = 1.0;
    }

    const safeModelConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence) ? modelConfidence : 5.0;

    const data = {
        valueBetsJson: valueBets,
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        modelConfidence: safeModelConfidence,
        expertConfidence: expertConfidence || "N/A",
        riskAssessment: riskAssessment || "N/A",
        microSummary: microSummary,
        generalAnalysis: generalAnalysis || "N/A",
        strategicClosingThoughts: strategicClosingThoughts || "N/A",
        contradictionAnalysis: contradictionAnalysisResult || "N/A",
        // --- A "BRUTÁLIS" BŐVÍTÉS (v103.0) ---
        psychologistReportJson: psyReport, // Az új Agent 2.5 riportja
        specialistReportJson: specialistReport // Az új Agent 3 riportja
    };

    try {
         // --- 1. LÉPÉS: AI (Tanácsadó) hívása ---
         // Az AI a "régi, nyerő" promptot használja, de a "brutális" új adatokkal.
         const filledPrompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE_V103, data);
         // A modern, robusztus JSON hívót használjuk
         let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

         if (!rec || !rec.recommended_bet || typeof rec.final_confidence !== 'number') {
             console.error("[AI_Service v103.0 - Főnök] Master AI hiba: Érvénytelen JSON struktúra a válaszban:", rec);
             throw new Error("AI hiba: Érvénytelen JSON struktúra a MasterRecommendation-ben.");
         }
         
         // --- 2. LÉPÉS: KÓD (A "Főnök") átveszi az irányítást ---
         // --- Ez a "régi, nyerő" kalibrációs logika ---
         // --- Utófeldolgozás: Bizalom finomítása ---
         console.log(`[AI_Service v103.0 - Főnök] AI (Tanácsadó) javaslata: ${rec.recommended_bet} @ ${rec.final_confidence}/10`);

         // 1. Eltérés-alapú büntetés (Modell vs Expert)
         const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
         const disagreementThreshold = 3.0;
         let confidencePenalty = 0;
         let disagreementNote = "";
         
         if (expertConfScore < 1.1 && expertConfidence && !expertConfidence.toLowerCase().includes("hiba")) {
              confidencePenalty = Math.max(0, rec.final_confidence - 3.0); // Max 3.0-ra csökkenti
              disagreementNote = " (FŐNÖK KORREKCIÓ: Expert bizalom extrém alacsony!)";
         }
         else if (confidenceDiff > disagreementThreshold) {
             confidencePenalty = Math.min(2.0, confidenceDiff / 1.5); // Büntetés max 2.0
             disagreementNote = ` (FŐNÖK KORREKCIÓ: Modell (${safeModelConfidence.toFixed(1)}) vs Expert (${expertConfScore.toFixed(1)}) eltérés miatt.)`;
         }
         
         rec.final_confidence -= confidencePenalty;
         rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));

         // 2. Bizalmi Kalibráció (Meta-tanulás)
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
         } catch(calError: any) { console.warn(`[AI_Service v103.0 - Főnök] Bizalmi kalibráció hiba: ${calError.message}`); }

         // Megjegyzések hozzáadása az indokláshoz
         rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote;
         if (rec.brief_reasoning.length > 500) {
              rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "...";
         }

         console.log(`[AI_Service v103.0 - Főnök] VÉGLEGES KORRIGÁLT Tipp: ${rec.recommended_bet} @ ${rec.final_confidence.toFixed(1)}/10`);
         
         // Visszaadjuk a "Főnök" által finomított ajánlást
         return rec;

    } catch (e: any) {
        console.error(`[AI_Service v103.0 - Főnök] Végleges hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack);
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": `AI Hiba (Főnök): ${e.message.substring(0, 100)}` };
    }
}


// === FŐ ORCHESTRÁCIÓS LÉPÉS (v103.0) ===
// Ez váltja a régi runStep_Critic és runStep_Strategist lépéseket.
// Ez a "Hibrid Főnök" futtatója.
interface FinalAnalysisInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    rawDataJson: ICanonicalRawData; 
    specialistReport: any; // Agent 3
    simulatorReport: any;  // Agent 4 (Sim)
    psyReport: any;        // Agent 2.5
    valueBetsJson: any[];
    richContext: string;
}

export async function runStep_FinalAnalysis(data: FinalAnalysisInput): Promise<any> {
    
    // Alap adatok kinyerése
    const { rawDataJson, specialistReport, simulatorReport, psyReport, valueBetsJson, richContext, matchData } = data;
    const sim = simulatorReport || {};
    const home = matchData.home || 'Hazai';
    const away = matchData.away || 'Vendég';
    const sport = matchData.sport || 'soccer';

    // Statisztikai bizalom kinyerése a szimulátorból (KRITIKUS)
    const modelConfidence = typeof sim.stat_confidence === 'number' ? sim.stat_confidence : 5.0;
    
    // --- 1. LÉPÉS: Mikromodellek párhuzamos futtatása ---
    // A "régi, nyerő" rendszerhez hasonlóan összegyűjtjük az összes
    // kontextuális riportot.
    
    // A. Expert Confidence (A legfontosabb a kalibrációhoz)
    const expertConfidencePromise = getExpertConfidence(modelConfidence, richContext, rawDataJson, psyReport, specialistReport);

    // B. Kockázat
    const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport);
    
    // C. Piac-specifikus mikromodellek
    const bttsPromise = getBTTSAnalysis(sim, rawDataJson);
    const goalsOUPromise = getSoccerGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 2.5);
    const cornerPromise = getCornerAnalysis(sim, rawDataJson);
    const cardPromise = getCardAnalysis(sim, rawDataJson);
    const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext);

    // Eredmények összegyűjtése
    const [
        expertConfidence,
        riskAssessment,
        bttsAnalysis,
        goalsOUAnalysis,
        cornerAnalysis,
        cardAnalysis,
        playerMarketAnalysis
    ] = await Promise.all([
        expertConfidencePromise,
        riskAssessmentPromise,
        bttsPromise,
        goalsOUPromise,
        cornerPromise,
        cardPromise,
        playerMarketsPromise
    ]);

    const microAnalyses = {
        bttsAnalysis,
        goalsOUAnalysis,
        cornerAnalysis,
        cardAnalysis,
        playerMarketAnalysis
    };

    // --- 2. LÉPÉS: Fő elemzések futtatása (ezek függhetnek az előzőektől) ---
    
    // A. Taktikai elemzés (függ a kockázattól)
    const tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment);
    
    // B. Általános elemzés (függ a taktikától és pszichológiától)
    const generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, modelConfidence, psyReport);

    // C. Stratégiai zárógondolatok (függ szinte mindentől)
    const strategicClosingThoughts = await getStrategicClosingThoughts(
        sim, rawDataJson, richContext, microAnalyses, riskAssessment,
        tacticalBriefing, valueBetsJson, modelConfidence, expertConfidence,
        psyReport, specialistReport
    );

    // --- 3. LÉPÉS: A "FŐNÖK" (JS KÓD + AI TANÁCSADÓ) HÍVÁSA ---
    // Itt hívjuk meg a "régi, nyerő" getMasterRecommendation függvényt,
    // de a "brutális" új adatokkal (psyReport, specialistReport).
    const masterRecommendation = await getMasterRecommendation(
        valueBetsJson,
        sim,
        modelConfidence,
        expertConfidence, // A kritikus string, pl. "**8.5/10** - Indoklás..."
        riskAssessment,
        microAnalyses,
        generalAnalysis,
        strategicClosingThoughts,
        "N/A", // ContradictionAnalysis (a régiből, most N/A)
        psyReport, // ÚJ (v103)
        specialistReport // ÚJ (v103)
    );

    // --- 4. LÉPÉS: Végső riport összeállítása ---
    // A kimeneti struktúrát a "régi" fájl fő elemzési objektumához
    // (vagy az "új" runStep_Strategist kimenetéhez) hasonlóan építjük fel.
    return {
        // A "régi" elemzői mezők
        risk_assessment: riskAssessment,
        tactical_briefing: tacticalBriefing,
        general_analysis: generalAnalysis,
        strategic_closing_thoughts: strategicClosingThoughts,
        expert_confidence_report: expertConfidence, // Ez az AI által generált teljes string
        
        // Mikromodellek (az "új" struktúra szerint)
        micromodels: microAnalyses,

        // A "régi, nyerő" JS Főnök által kalibrált végső ajánlás
        master_recommendation: masterRecommendation,

        // Az "új" ügynökök riportjai (logoláshoz, kontextushoz)
        agent_reports: {
            psychologist: psyReport,
            specialist: specialistReport
        },
        
        // A "régi" prophetic_timeline (az újban nem volt, a régiben igen, de a logikája hiányzik)
        // Ezt a master prompt is generálhatná, de a v103-ból kivettük az egyszerűsítésért.
        // A v102-es `runStep_Strategist` generálta. Most kihagyjuk.
        prophetic_timeline: "N/A (v103.0: A Hibrid Főnök a tippre fókuszál.)"
    };
}

// --- CHAT FUNKCIÓ --- (MEGTARTVA v102.1-ből, Változatlan)
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
        
        // A _callGemini-t (nem a JSON-t kényszerítőt) hívjuk, ha létezik,
        // vagy a _callGemini-t a (prompt, false) kapcsolóval, ahogy a v102.1 tette.
        // Feltételezzük, hogy a _callGemini(prompt, false) a helyes hívás.
        // Ha a _callGemini a default, sima hívó, akkor az is jó.
        // Maradjunk a v102.1-es implementációnál:
        const rawAnswer = await _callGemini(prompt, false); // forceJson = false
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni." };
    } catch (e: any) {
        console.error(`[AI_Service v103.0] Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT (v103.0) ---
export default {
    runStep_TeamNameResolver,   // Újból (MEGTARTVA)
    runStep_Psychologist,     // Újból (MEGTARTVA)
    runStep_Specialist,       // Újból (MEGTARTVA)
    runStep_FinalAnalysis,    // ÚJ (v103.0) - Ez futtatja a "régi, nyerő" logikát
    getChatResponse           // Újból (MEGTARTVA)
};
