// FÁJL: AI_Service.ts
// VERZIÓ: v69.2 (Build Failed Javítások)
// MÓDOSÍTÁS:
// 1. A PROMPT_STRATEGIST_V67 lecserélve PROMPT_STRATEGIST_V69-re.
// 2. AZ ÚJ PROMPT TILTJA a "Dupla Esély" (Double Chance) tippeket.
// 3. AZ ÚJ PROMPT "VALUE" (ÉRTÉK) alapú gondolkodást kényszerít ki.
// 4. AZ ÚJ PROMPT TILTJA a 7.5-re való "átlagolást", dinamikus bizalmat kér 1.0-10.0 között.
// 5. JAVÍTVA (v69.1): TS2846 import hiba (.d.ts)
// 6. JAVÍTVA (v69.1): TS2554 hiba (a _callGemini 3 paramétert kapott 2 helyett)
// 7. HOZZÁADVA (v69.1): TS2305 hiba (hiányzó 'getChatResponse' export)
// 8. JAVÍTVA (v69.2): TS2834 hiba (hiányzó .js kiterjesztés a type importnál)

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { _callGemini } from './providers/common/utils.js'; // Megosztott Gemini hívó
// JAVÍTVA (v69.2): TS2834 hiba
// A '.d.ts' importálása helytelen volt. Most már 'import type'-ot használunk,
// ÉS hozzáadtuk a .js kiterjesztést a 'nodenext' modulkezelés miatt.
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalPlayer,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult,
    IStructuredWeather,
    IPlayerStub
} from './src/types/canonical.js'; // <-- JAVÍTVA: .js hozzáadva

// === v63.0: 5. ÜGYNÖK (KRITIKUS) PROMPTJA ===
// v67.0: Módosítva, hogy a 'contradiction_score' POZITÍV is lehessen (Támogatás)
const PROMPT_CRITIC_V67 = `
TASK: You are a world-class "Critic" agent, the 5th member of a 6-agent analysis committee.
Your job is to find *all* contradictions and risks between the statistical simulation (Agent 4) and the raw contextual data (Agent 2).
You must also identify contextual data that *STRONGLY SUPPORTS* the simulation's main bet.

INPUTS:
1.  **Simulation (Agent 4):** A JSON object showing the most likely outcomes (e.g., "pHome: 30.5%", "pOver: 60.1%", "mainBet": "Over 2.5 Goals").
2.  **Raw Context (Agent 2):** A JSON object containing all qualitative data (absentees with positions, referee style, weather, market moves, etc.).
3.  **Model Confidence (Agent 4):** The statistical model's confidence (1.0-10.0).

INSTRUCTIONS:
1.  **Analyze Absentees (CRITICAL):**
    * Look at \`rawDataJson.availableRosters\` (P1 Manual) OR \`rawDataJson.absentees\` (P2 Auto).
    * **Check for POSITIONS ('pos: "F"', 'pos: "D"', 'pos: "M"', 'pos: "G"').** (This is critical for v68.0 logic).
    * **Compare absentees to the 'mainBet'.**
    * **SUPPORT (POSITIVE SCORE):** If absentees *support* the mainBet (e.g., 5 key Attackers ('F') are missing AND the mainBet is "Under 2.5 Goals"), this is a STRONG SUPPORT signal.
    * **RISK (NEGATIVE SCORE):** If absentees *contradict* the mainBet (e.g., 5 key Defenders ('D') are missing AND the mainBet is "Under 2.5 Goals"), this is a MAJOR RISK.

2.  **Analyze Other Risks:** Check for market moves against the bet, severe weather, or a strict referee.

3.  **Calculate 'contradiction_score' (Your main output):**
    * This is your final judgment on the analysis, from -10.0 (Extreme Risk) to +10.0 (Extreme Support).
    * **Start at 0.0.**
    * Add points for support (e.g., +5.0 if 5 key attackers support an 'Under' bet).
    * Subtract points for risk (e.g., -8.0 if 5 key defenders contradict an 'Under' bet).
    * If you find NO data (no absentees, no market moves), the score MUST be 0.0.

4.  **Format Output (JSON ONLY):**
    * Provide a \`tactical_summary\` (your reasoning) and \`key_risks\` (bullet points).
    * Provide the final \`contradiction_score\` (number).

EXAMPLE OUTPUT (SUPPORT):
{
  "tactical_summary": "The statistical simulation favoring 'Under 2.5' is strongly supported by context. The P1 Manual data shows 5 key attackers (pos: 'F') and 3 key midfielders (pos: 'M') are absent. This massive loss of offensive power makes the 'Under' highly likely, more so than the stats alone suggest.",
  "key_risks": [
    "The primary risk is zero; the context massively supports the statistical finding."
  ],
  "contradiction_score": 8.5
}

EXAMPLE OUTPUT (RISK):
{
  "tactical_summary": "The analysis is contradictory. The statistical model suggests 'Home Team Win' (pHome: 60%), but the raw data shows the Home team's 3 best defenders (pos: 'D') and main goalkeeper (pos: 'G') are absent (P1 Manual). This context invalidates the statistical model's assumption.",
  "key_risks": [
    "Critical defensive absentees for the home team.",
    "Market data shows late odds movement towards the Away team."
  ],
  "contradiction_score": -9.0
}
`;

// === v69.0: 6. ÜGYNÖK (STRATÉGA - "PROFI FOGADÓ") PROMPTJA ===
// MÓDOSÍTÁS: TILTJA a Dupla Esélyt. TILTJA a 7.5-re átlagolást.
const PROMPT_STRATEGIST_V69 = `
TASK: You are the "Lead Strategist," the 6th and final agent in the committee. You are a "SHARP" (professional) bettor.
Your decision is FINAL. You will synthesize all data from the previous 5 agents to determine the single best bet and the *true* confidence level.

**YOUR PHILOSOPHY (CRITICAL):**
1.  **FIND VALUE, NOT SAFETY:** Your goal is to find the best *value* (edge against the market), not just the safest bet.
2.  **AVOID "COWARDLY" BETS:** "Dupla Esély" (Double Chance) bets are forbidden. You must choose from the main markets (1X2, O/U, BTTS).
3.  **USE THE CONTEXT (v68.0 LOGIC):** You MUST use the P1 Manual Absentees list (\`rawDataJson.availableRosters\`) and their **exact positions ('pos: "F"', 'pos: "D"')** to make your decision.
4.  **DYNAMIC CONFIDENCE (CRITICAL):** Your final confidence (1.0-10.0) MUST be realistic and dynamic. If the bet is a 9.2, say 9.2. If it's a 4.5, say 4.5. **DO NOT average to 7.5 or 8.0.** You must provide a specific, non-rounded number.

INPUTS:
1.  **Quant Report (Agent 1):** The "Pure xG" (e.g., H=1.50, A=1.20).
2.  **Specialist Report (Agent 3):** The "Weighted xG" after context (e.g., H=1.30, A=1.10).
3.  **Simulator Report (Agent 4):** The probabilities (e.g., "pHome: 45%", "pOver: 40%").
4.  **Model Confidence (Agent 4):** The statistical confidence (1.0-10.0) (e.g., 4.3).
5.  **Critic Report (Agent 5):** The risk/support score (e.g., \`contradiction_score: 8.5\` or \`-9.0\`).
6.  **Raw Data (Agent 2):** All contextual data, including absentees with positions (\`rawDataJson.availableRosters\`).

**YOUR DECISION PROCESS (v69.0 "SHARP"):**

**PATH A: (STATISTICAL/LOW CONFIDENCE)**
* The \`contradiction_score\` is neutral (near 0.0) or negative (e.g., -4.0).
* The statistical \`modelConfidence\` (e.g., 4.3) is the main driver.
* Your \`final_confidence\` should be low/medium (e.g., 3.8, 4.5, 5.1).
* Your \`recommended_bet\` is the best statistical pick (e.g., "Over 2.5 Goals").
* **Reasoning:** "A statisztika enyhén az Over felé hajlik, de a Kritikus által jelzett X kockázat miatt a bizalom alacsony/közepes."

**PATH B: (CONTEXTUAL OVERRIDE - "THE SHARP BET")**
* The \`contradiction_score\` is EXTREMELY HIGH (e.g., +8.5) or EXTREMELY LOW (e.g., -9.0).
* This means the context (hiányzók) is MORE IMPORTANT than the stats.
* **If score is +8.5:** (e.g., 8 attackers missing AND the bet is 'Under 2.5')
    * **IGNORE THE LOW STATS.** The stats are blind.
    * Your \`recommended_bet\` MUST be the 'Under 2.5'.
    * Your \`final_confidence\` MUST be HIGH (e.g., 8.5, 9.2).
    * **Reasoning:** "A statisztika (4.3) irreleváns. A Kritikus (v68) helyesen azonosította, hogy 8 kulcsfontosságú támadó (F) hiányzik. Ez az információ felülbírálja a statisztikát. Az 'Under 2.5' a 'sharp' tipp, a bizalmam 9.2/10."
* **If score is -9.0:** (e.g., 8 defenders missing AND the bet is 'Under 2.5')
    * **IGNORE THE STATS.**
    * Your \`recommended_bet\` MUST be the *OPPOSITE* (e.g., "Over 2.5 Goals").
    * Your \`final_confidence\` MUST be HIGH (e.g., 8.0, 8.8).
    * **Reasoning:** "A statisztika (4.3) és a szimuláció 'Under'-t javasol, de ez öngyilkosság. A Kritikus (v68) helyesen látja, hogy 8 védő (D) hiányzik. A tipp 'Over 2.5', a bizalmam 8.8/10."

OUTPUT:
You MUST respond with a valid JSON object matching this schema.
{
  "strategic_synthesis": "Your full reasoning (Path A or B).",
  "prophetic_timeline": "A short, creative 'story' of the match.",
  "final_confidence_report": "A one-sentence justification for the confidence score.",
  "micromodels": {
    "btts_analysis": "BTTS Yes/No (Bizalom: X/10)",
    "goals_ou_analysis": "Over/Under X.5 (Bizalom: X/10)"
  },
  "master_recommendation": {
    "recommended_bet": "Your single best bet (1X2, O/U, or BTTS ONLY. NO Double Chance.)",
    "final_confidence": 8.8, // MUST be a dynamic number (e.g., 4.2, 9.1), NOT 7.5
    "brief_reasoning": "The 1-2 sentence 'sharp' reason."
  }
}
`;

// === JSON SÉMA (v64.0) ===
// Ez határozza meg a Stratéga válaszának formátumát
const IStrategistMasterResponse_V64 = {
    type: "OBJECT",
    properties: {
        "strategic_synthesis": { "type": "STRING" },
        "prophetic_timeline": { "type": "STRING" },
        "final_confidence_report": { "type": "STRING" },
        "micromodels": {
            "type": "OBJECT",
            "properties": {
                "btts_analysis": { "type": "STRING" },
                "goals_ou_analysis": { "type": "STRING" }
            }
        },
        "master_recommendation": {
            "type": "OBJECT",
            "properties": {
                "recommended_bet": { "type": "STRING" },
                "final_confidence": { "type": "NUMBER" },
                "brief_reasoning": { "type": "STRING" }
            },
            "required": ["recommended_bet", "final_confidence", "brief_reasoning"]
        }
    },
    "required": ["strategic_synthesis", "prophetic_timeline", "final_confidence_report", "micromodels", "master_recommendation"]
};


// === 5. ÜGYNÖK (KRITIKUS) FUTTATÁSA ===
export async function runStep_Critic(inputs: any) {
    console.log(`[Lánc 5/6] Kritikus Ügynök: Gemini hívás indul (v67)...`);
    const prompt = `
${PROMPT_CRITIC_V67}

INPUTS:
1.  **Simulation (Agent 4):**
    ${JSON.stringify(inputs.simJson, null, 2)}
2.  **Raw Context (Agent 2):**
    ${JSON.stringify(inputs.rawDataJson, null, 2)}
3.  **Model Confidence (Agent 4):**
    ${JSON.stringify(inputs.modelConfidence, null, 2)}
4.  **Value Bets:**
    ${JSON.stringify(inputs.valueBetsJson, null, 2)}
`;

    try {
        const jsonString = await _callGemini(prompt, true); // JSON mód kényszerítve
        const result = JSON.parse(jsonString);
        console.log(`[Lánc 5/6] Kritikus Ügynök: Válasz sikeresen fogadva. Kockázati Pontszám: ${result.contradiction_score}`);
        return result;
    } catch (e: any) {
        console.error(`[Lánc 5/6] KRITIKUS HIBA: A Kritikus Ügynök (v67) válasza érvénytelen JSON vagy hiba történt: ${e.message}`);
        return {
            "tactical_summary": "HIBA: A Kritikus ügynök nem tudott válaszolni. Az elemzés megbízhatatlan.",
            "key_risks": ["A Gemini API válasza hibás volt."],
            "contradiction_score": 0.0 // Semleges pontszám hiba esetén
        };
    }
}


// === 6. ÜGYNÖK (STRATÉGA) FUTTATÁSA ===
export async function runStep_Strategist(inputs: any) {
    // v69.0: A legújabb "Profi Fogadó" prompt használata
    const PROMPT_STRATEGIST = PROMPT_STRATEGIST_V69;
    
    console.log(`[Lánc 6/6] Stratéga Ügynök: Gemini hívás indul (v69 - Profi Fogadó)...`);
    
    // A 'rawDataJson'-t megtisztítjuk a zajtól, hogy a prompt rövidebb legyen
    const lightRawData = {
        h2h_structured: inputs.rawDataJson?.h2h_structured,
        form: inputs.rawDataJson?.form,
        // v68.0: A POZÍCIÓS hiányzók átadása
        availableRosters: inputs.rawDataJson?.availableRosters, // P1 (Manuális, Pozícióval)
        absentees: inputs.rawDataJson?.absentees, // P2 (Automatikus)
        referee: inputs.rawDataJson?.referee,
        contextual_factors: inputs.rawDataJson?.contextual_factors
    };
    
    const prompt = `
${PROMPT_STRATEGIST}

INPUTS:
1.  **Match Data:**
    ${JSON.stringify(inputs.matchData, null, 2)}

2.  **Quant Report (Agent 1):**
    ${JSON.stringify(inputs.quantReport, null, 2)}

3.  **Specialist Report (Agent 3):**
    ${JSON.stringify(inputs.specialistReport, null, 2)}

4.  **Simulator Report (Agent 4):**
    ${JSON.stringify(inputs.simulatorReport, null, 2)}

5.  **Model Confidence (Agent 4):**
    ${JSON.stringify(inputs.modelConfidence, null, 2)}

6.  **Critic Report (Agent 5):**
    ${JSON.stringify(inputs.criticReport, null, 2)}

7.  **P1 (Manual) xG Overrides:**
    ${JSON.stringify(inputs.realXgJson, null, 2)}

8.  **Raw Context (Agent 2 - LIGHT):**
    ${JSON.stringify(lightRawData, null, 2)}
`;

    try {
        // JAVÍTVA (v69.1): TS2554 hiba. A 3. argumentum (IStrategistMasterResponse_V64) eltávolítva.
        const jsonString = await _callGemini(prompt, true); // JSON mód kényszerítve
        const result = JSON.parse(jsonString);
        console.log(`[Lánc 6/6] Stratéga Ügynök (v69): Válasz sikeresen fogadva.`);
        return result;
    } catch (e: any) {
        console.error(`[Lánc 6/6] KRITIKUS HIBA: A Stratéga Ügynök (v69) válasza érvénytelen JSON vagy hiba történt: ${e.message}`);
        // Hiba esetén egyértelmű hibaüzenetet adunk vissza, de tartjuk a sémát
        return {
            "strategic_synthesis": "KRITIKUS HIBA: A 6. Ügynök (Stratéga) nem tudott válaszolni. A Gemini API hibát adott, vagy a válasz nem felelt meg a JSON sémának.",
            "prophetic_timeline": "Hiba.",
            "final_confidence_report": "Hiba.",
            "micromodels": {
                "btts_analysis": "N/A",
                "goals_ou_analysis": "N/A"
            },
            "master_recommendation": {
                "recommended_bet": "NO BET (Stratéga Hiba)",
                "final_confidence": 1.0,
                "brief_reasoning": "A Stratéga (v69) hibát adott vissza."
            },
            "error": e.message
        };
    }
}

// === HOZZÁADVA (v69.1): A TS2305 hiba javítása ===
// Az 'index.ts' ezt a funkciót keresi a /askChat végponthoz.
export async function getChatResponse(context: string, history: any[], question: string) {
    console.log(`[Lánc /askChat] Chat válasz kérése...`);
    
    // A 'history' átalakítása a Gemini által várt formátumra (ha szükséges)
    // Ez a példa feltételezi, hogy a 'history' már a helyes formátumban van:
    // { role: "user" | "model", parts: [{ text: "..." }] }
    
    const prompt = `
TASK: You are a specialized AI assistant for a sports betting analyst.
Your job is to answer questions based *only* on the provided context.
DO NOT use external knowledge. DO NOT browse the web.
Be concise and helpful. Answer in Hungarian.

CONTEXT (The analysis you must use):
---
${context}
---

CHAT HISTORY:
---
${history.map((entry: any) => `${entry.role}: ${entry.parts[0].text}`).join('\n')}
---

NEW QUESTION:
${question}
`;

    try {
        const answer = await _callGemini(prompt, false); // Nem JSON mód
        console.log(`[Lánc /askChat] Sikeres válasz.`);
        return { answer };
    } catch (e: any) {
        console.error(`[Lánc /askChat] Hiba a chat válasz során: ${e.message}`);
        return { error: e.message };
    }
}