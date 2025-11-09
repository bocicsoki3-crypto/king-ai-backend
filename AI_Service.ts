// FÁJL: AI_Service.ts
// VERZIÓ: v95.0 ("Narratíva-Vezérelt Stratéga")
// MÓDOSÍTÁS:
// 1. CÉL: A "Tippelgetés" (v94.0) megszüntetése.
// 2. MÓDOSÍTVA: PROMPT_STRATEGIST_V94 -> PROMPT_STRATEGIST_V95
// 3. LOGIKA: A 6. Ügynök (Stratéga) már nem vakon a legmagasabb
//    százalékot választja (pl. "Over 2.5"), hanem azt a tippet
//    (pl. "Strasbourg -0.5 AH"), amely a legjobban kifejezi
//    a lánc központi "Fő Témáját" (amit az 5. Ügynök bizalma is alátámaszt).

import { 
    _callGeminiWithJsonRetry, 
    _callGemini, 
    fillPromptTemplate 
} from './providers/common/utils.js';
import type { IPlayerStub } from './src/types/canonical.d.ts';

// Típus az AI JSON válaszaihoz
type GeminiJsonResponse = Record<string, any> | null;

// === ÜGYNÖK 2.5 (A PSZICHOLÓGUS) v93.0 ===
interface IPsychologistInput {
    homeTeamName: string;
    awayTeamName: string;
    leagueContext: string;
    homeRawNews: string;
    awayRawNews: string;
    homeRecentFormString: string;
    awayRecentFormString: string;
    h2hHistory: string;
    matchTension: string;
    // v94.0: Bővített bemenet
    homeNarrativeRating?: string;
    awayNarrativeRating?: string;
}

const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze raw text data (news, form, H2H) and generate a narrative psychological profile for both teams.
DO NOT analyze stats (like xG). Focus purely on morale, motivation, pressure, and narrative context.

[INPUT DATA]:
- Home Team: {homeTeamName}
- Away Team: {awayTeamName}
- Context: {leagueContext}
- Home Team Raw News/Intel: {homeRawNews}
- Away Team Raw News/Intel: {awayRawNews}
- Home Form (Last 5): {homeRecentFormString}
- Away Form (Last 5): {awayRecentFormString}
- H2H History (Narrative): {h2hHistory}
- Match Tension / Importance: {matchTension}

[SYSTEM LEARNINGS (From Agent 7)]
- Home Team Past Learnings: {homeNarrativeRating}
- Away Team Past Learnings: {awayNarrativeRating}

[YOUR TASK]:
Based *only* on the inputs above, generate a JSON object with two keys: "psyProfileHome" and "psyProfileAway".
For each profile, provide a 2-3 sentence analysis covering:
1.  **Morale:** Are they confident, crumbling, or desperate?
2.  **Motivation:** Is this a must-win? A derby? A revenge spot?
3.  **Pressure:** Are they under pressure from relegation, title race, or poor form?
4.  **Style Hint:** Does the context suggest an aggressive (all-out-attack) or defensive (bunker) mindset?

[OUTPUT STRUCTURE (JSON ONLY)]:
{
  "psyProfileHome": "<Your 2-3 sentence analysis for the Home team>",
  "psyProfileAway": "<Your 2-3 sentence analysis for the Away team>"
}
`;

export async function runStep_Psychologist(input: IPsychologistInput): Promise<GeminiJsonResponse> {
    const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, {
        ...input,
        homeNarrativeRating: input.homeNarrativeRating || "N/A",
        awayNarrativeRating: input.awayNarrativeRating || "N/A"
    });
    return _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
}


// === ÜGYNÖK 3 (A SPECIALISTA) v94.0 ===
interface ISpecialistInput {
    homeTeamName: string;
    awayTeamName: string;
    baselineHomeXG: number;
    baselineAwayXG: number;
    // Kontextus
    weather: string;
    pitch: string;
    refereeStyle: string;
    // Pszichológia (2.5-ös Ügynöktől)
    psyProfileHome: string;
    psyProfileAway: string;
    // Hiányzók (2-es Ügynöktől)
    homeAbsentees: string;
    awayAbsentees: string;
    // v94.0: Bővített bemenet
    homeNarrativeRating?: string;
    awayNarrativeRating?: string;
}

const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to take a purely statistical "Baseline xG" (from Agent 1) and adjust it based on qualitative context (from Agent 2 & 2.5).

[INPUT DATA]:
- Home Team: {homeTeamName}
- Away Team: {awayTeamName}
- Baseline Home xG (Statistical): {baselineHomeXG}
- Baseline Away xG (Statistical): {baselineAwayXG}

[QUALITATIVE CONTEXT]:
- Weather/Pitch: {weather} / {pitch}
- Referee Style: {refereeStyle}
- Home Absentees: {homeAbsentees}
- Away Absentees: {awayAbsentees}
- Home Psychological Profile (from Agent 2.5): {psyProfileHome}
- Away Psychological Profile (from Agent 2.5): {psyProfileAway}

[SYSTEM LEARNINGS (From Agent 7)]
- Home Team Past Learnings: {homeNarrativeRating}
- Away Team Past Learnings: {awayNarrativeRating}

[YOUR TASK]:
1.  Analyze the qualitative context. How much do these factors (weather, absentees, morale) impact the baseline xG?
2.  Provide a step-by-step reasoning ("adjustment_reasoning").
3.  Provide the final "adjusted_xg_home" and "adjusted_xg_away".
4.  The adjustment should be subtle (e.g., 1.50 -> 1.55 or 1.50 -> 1.40). Do NOT make drastic changes unless the context is extreme (e.g., "Entire starting defense is out").

[OUTPUT STRUCTURE (JSON ONLY)]:
{
  "adjustment_reasoning": "<Your step-by-step reasoning for the adjustment, referencing specific inputs like morale or key absentees.>",
  "adjusted_xg_home": <Final numeric value for Home xG (e.g., 1.55)>,
  "adjusted_xg_away": <Final numeric value for Away xG (e.g., 1.40)>
}
`;

export async function runStep_Specialist(input: ISpecialistInput): Promise<GeminiJsonResponse> {
    const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, {
        ...input,
        homeNarrativeRating: input.homeNarrativeRating || "N/A",
        awayNarrativeRating: input.awayNarrativeRating || "N/A"
    });
    return _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
}


// === ÜGYNÖK 5 (A PIAC-TUDATOS KRITIKUS) v94.0 ===
interface ICriticInput {
    // 4. Ügynöktől (Szimulátor)
    simulationSummary: string; // (1X2, O/U, BTTS valószínűségek)
    // 2. Ügynöktől (Scout)
    marketIntel: string; // (Odds mozgás, "sharp money")
    // 3. Ügynöktől (Specialista)
    keyFactors: string; // (A 3. Ügynök indoklása)
    // 1. Ügynöktől (Quant)
    xgSource: string; // (P1, P2, P4?)
    // v94.0: Bővített bemenet
    homeNarrativeRating?: string;
    awayNarrativeRating?: string;
}

const PROMPT_CRITIC_V93 = `
TASK: You are 'The Critic', the 5th Agent. (v93.0 "Market-Aware")
Your job is to determine the *final confidence score* (from 1.0 to 10.0) by checking for contradictions ("Red Flags").
You DO NOT pick the bet. You ONLY provide the confidence score for Agent 6.

[INPUT 1: THE INTERNAL MODEL (From Agent 1, 3, 4)]
- Simulation Summary (Agent 4): {simulationSummary}
- Key Factors Used (Agent 3): {keyFactors}
- Data Source Quality (Agent 1): {xgSource}

[INPUT 2: THE EXTERNAL WORLD (From Agent 2)]
- Market Intelligence (Odds Movement): {marketIntel}

[INPUT 3: SYSTEM LEARNINGS (From Agent 7)]
- Home Team Past Learnings: {homeNarrativeRating}
- Away Team Past Learnings: {awayNarrativeRating}

[YOUR TASK]:
1.  **Check Internal Coherence:** Do the Key Factors (Agent 3) strongly support the Simulation (Agent 4)? (e.g., If factors say "strong defense" but sim says "3-2", that's a Red Flag).
2.  **Check External Coherence (The "Red Flag Check"):** Does the Internal Model contradict the External Market?
    -   (e.g., If our Sim says "70% Home Win" but Market Intel says "Odds drifting, sharp money is on Away", that is a CRITICAL RED FLAG.)
3.  **Check Data Quality:** Is the {xgSource} "Manual (P1)"? If so, confidence is capped (max 7.0), as P1 data is less reliable than P2/P4.
4.  **Factor in System Learnings:** Do the Past Learnings (Agent 7) warn about this situation (e.g., "This team performs poorly under pressure")?
5.  **Generate Final Score:** Based on the number of Red Flags, provide a "final_confidence_score" and a brief "confidence_reasoning".

[OUTPUT STRUCTURE (JSON ONLY)]:
{
  "confidence_reasoning": "<Your 1-2 sentence justification for the score, explicitly mentioning any Red Flags found (e.g., 'Red Flag: Market contradicts simulation.')>",
  "final_confidence_score": <A final numeric score from 1.0 (No Confidence) to 10.0 (Perfect Confidence)>
}
`;

export async function runStep_Critic(input: ICriticInput): Promise<GeminiJsonResponse> {
     const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V93, { // v93-as prompt használata (v94-ben nem változott)
        ...input,
        homeNarrativeRating: input.homeNarrativeRating || "N/A",
        awayNarrativeRating: input.awayNarrativeRating || "N/A"
    });
    return _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v94 - Self-Learning)");
}


// === ÜGYNÖK 6 (A NARRATÍVA-VEZÉRELT STRATÉGA) v95.0 ===
interface IStrategistInput {
    homeTeamName: string;
    awayTeamName: string;
    // 4. Ügynöktől (Szimulátor)
    simulatorReport: string; // (Teljes JSON riport 1X2, O/U, BTTS, pAH)
    // 5. Ügynöktől (Kritikus)
    finalConfidence: number;
    criticReasoning: string;
    // 3. Ügynöktől (Specialista)
    adjustedHomeXG: number;
    adjustedAwayXG: number;
    specialistReasoning: string;
    // v94.0: Bővített bemenet
    homeNarrativeRating?: string;
    awayNarrativeRating?: string;
}

// EZ A "FASZOM FASZA" LÁNC.
// EZ A STRATÉGA MÁR NEM "TIPPELGET".
const PROMPT_STRATEGIST_V95 = `
TASK: You are 'The Strategist', the 6th Agent. (v95.0 "Narrative-Driven")
Your job is to select the *single best bet* that represents the system's core narrative, NOT just the highest percentage.
You are NOT a "tippelgető" (guesser). You are an elite analyst.

[INPUT 1: THE SIMULATION (From Agent 4)]
{simulatorReport}

[INPUT 2: THE CONTEXT (From Agent 3 & 5)]
- Adjusted Home xG: {adjustedHomeXG}
- Adjusted Away xG: {adjustedAwayXG}
- Specialist Reasoning (Agent 3): {specialistReasoning}
- Critic Reasoning (Agent 5): {criticReasoning}
- Final Confidence (Agent 5): {finalConfidence}

[INPUT 3: SYSTEM LEARNINGS (From Agent 7)]
- Home Team Past Learnings: {homeNarrativeRating}
- Away Team Past Learnings: {awayNarrativeRating}

[YOUR TASK]:
1.  **Identify the "Main Thesis":** Look at the xG (H: {adjustedHomeXG}, A: {adjustedAwayXG}) and the Specialist/Critic reasoning. What is the *story* of this match?
    -   (e.g., "Rangers Dominance", "Boring 0-0", "Defensive Collapse", "Strasbourg Home Fortress").
2.  **Analyze Key Markets:** Review the simulator report (1X2, O/U, BTTS, Asian Handicap).
3.  **Select the "Thesis Bet":**
    -   **DO NOT** just pick the highest percentage (like the primitive v94.0 model).
    -   **DO** pick the bet that *best expresses* the "Main Thesis".
    -   *Example 1:* If Thesis is "Rangers Dominance" (xG 0.97 vs 1.57, Conf: 8.2), the v94.0 "tippelgető" picked "Under 2.5" (math %). The v95.0 YOU will pick "Rangers Win" or "Rangers -0.5 AH" (Thesis Bet).
    -   *Example 2:* If Thesis is "Boring 0-0" (xG 1.0 vs 1.0, Conf: 4.0), YOU will pick "Under 2.5".
    -   *Example 3:* If Thesis is "Strasbourg Home Fortress" (xG 2.15 vs 1.55, Conf: 1.5), YOU will pick "Over 2.5" or "Strasbourg +0.5 AH", as both express the high-scoring thesis.
4.  **Finalize:** Package the "Thesis Bet" (recommended_bet), the {finalConfidence} (final_confidence), and summarize the "Main Thesis" (brief_reasoning).

[OUTPUT STRUCTURE (JSON ONLY)]:
{
  "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** A (TASK 2) alapján válaszd ki a 'Fő Témát' legjobban kifejező tippet (1X2, O/U, vagy AH).",
  "recommended_bet": "<The single best bet (e.g., 'Rangers -0.5 AH', 'Over 2.5 Goals', 'BTTS - Yes', 'Metz Win')>",
  "final_confidence": {finalConfidence},
  "brief_reasoning": "<A 1-2 mondatos indoklás, amely a 'Fő Témát' (Main Thesis) összeköti a választott tippel.>"
}
`;

export async function runStep_Strategist(input: IStrategistInput): Promise<GeminiJsonResponse> {
    const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V95, {
        ...input,
        homeNarrativeRating: input.homeNarrativeRating || "N/A",
        awayNarrativeRating: input.awayNarrativeRating || "N/A"
    });
    // A v95.0-s Stratéga már kezeli a hiányzó pAH-t (a Model.ts v95.1-gyel lesz tökéletes)
    return _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v95 - Narrative)");
}


// === ÜGYNÖK 8 (A TÉRKÉPÉSZ) v77.3 ===
interface ITeamNameResolverInput {
    inputName: string; // (pl. "fc utrecht")
    searchTerm: string; // (pl. "utrecht")
    rosterJson: IPlayerStub[]; // (A liga teljes csapatinas listája)
}

const PROMPT_TEAM_NAME_RESOLVER_V1 = `
TASK: You are 'The Cartographer', the 8th Agent.
Your job is to find the correct Team ID from a JSON list, based on a fuzzy input name.
You must return ONLY the numeric ID.

[INPUT NAME]: "{inputName}" (Searching for: "{searchTerm}")
[ROSTER JSON]:
{rosterJson}

[YOUR TASK]:
1.  Find the team in the JSON whose "name" field is the *most likely* match for the "{inputName}" or "{searchTerm}".
2.  If a clear match is found (e.g., "Utrecht" matches "fc utrecht"), return its "id".
3.  If no match is found, return null.

[OUTPUT STRUCTURE (JSON ONLY)]:
{
  "matched_id": <number | null>
}
`;

export async function runStep_TeamNameResolver(input: ITeamNameResolverInput): Promise<number | null> {
    const filledPrompt = fillPromptTemplate(PROMPT_TEAM_NAME_RESOLVER_V1, {
        inputName: input.inputName,
        searchTerm: input.searchTerm,
        rosterJson: JSON.stringify(input.rosterJson, null, 2)
    });
    
    try {
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver (v1)");
        if (result && typeof result.matched_id === 'number') {
            console.log(`[AI_Service - Térképész] SIKER: Az AI a(z) "${input.inputName}" nevet ehhez a csapathoz rendelte: (ID: ${result.matched_id})`);
            return result.matched_id;
        } else {
            console.warn(`[AI_Service - Térképész] Az AI nem talált egyértelmű egyezést a(z) "${input.inputName}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service - Térkápész] KRITIKUS HIBA a(z) "${input.inputName}" név feloldása közben: ${e.message}`);
        return null;
    }
}
