// --- AI_Service.ts (v64.0 - Banker & Gambler Személyiségek) ---
// MÓDOSÍTÁS (Fejlesztési Javaslat 4.):
// 1. A 'PROMPT_STRATEGIST_V63' átnevezve 'PROMPT_STRATEGIST_BANKER_V64'-re,
//    és kiegészítve konzervatív, tőkevédelmi utasításokkal.
// 2. ÚJ PROMPT: 'PROMPT_STRATEGIST_GAMBLER_V64' létrehozva,
//    amely az érték (value) és a kontextuális (P1) felülbírálásra fókuszál.
// 3. MÓDOSÍTVA: A 'runStep_Strategist' függvény most már paraméterként
//    kapja a promptot, hogy az 'AnalysisFlow' mindkét személyiséget hívhassa.
// 4. A Kritikus (5. Ügynök) promptja változatlan (v63.1).

import { _callGemini } from './DataFetch.js';
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';
// === Robusztus AI hívó JSON parse retry logikával (Változatlan) ===
async function _callGeminiWithJsonRetry(
    prompt: string, 
    stepName: string, 
    maxRetries: number = 2
): Promise<any> {
    
    let attempts = 0;
while (attempts <= maxRetries) {
        attempts++;
try {
            const jsonString = await _callGemini(prompt, true);
const result = JSON.parse(jsonString);
            
            if (attempts > 1) {
                console.log(`[AI_Service] Sikeres JSON feldolgozás (${stepName}) a(z) ${attempts}. próbálkozásra.`);
}
            return result;
} catch (e: any) {
            if (e instanceof SyntaxError) {
                console.warn(`[AI_Service] FIGYELMEZTETÉS: Gemini JSON parse hiba (${stepName}), ${attempts}/${maxRetries+1}. próbálkozás. Hiba: ${e.message}`);
if (attempts > maxRetries) {
                    console.error(`[AI_Service] KRITIKUS HIBA: A Gemini JSON feldolgozása végleg sikertelen (${stepName}) ${attempts-1} próbálkozás után.`);
throw new Error(`AI Hiba (${stepName}): A modell hibás JSON struktúrát adott vissza, ami nem feldolgozható. Hiba: ${e.message}`);
}
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
} else {
                console.error(`[AI_Service] Kritikus nem-parse hiba (${stepName}): ${e.message}`);
throw e;
            }
        }
    }
    throw new Error(`AI Hiba (${stepName}): Ismeretlen hiba az újrapróbálkozási ciklusban.`);
}

// --- 
// HELPER a promptok kitöltéséhez 
// (Változatlan)
function fillPromptTemplate(template: string, data: any): string {
    if (!template || typeof template !== 'string') return '';
    try {
        // Kiegészített regex, hogy a {simJson.mu_h_sim} formátumot is kezelje
        return template.replace(/\{([\w_.]+)\}/g, (match, key) => {
            let value: any;
// Pontozott kulcsok kezelése (pl. simJson.mu_h_sim)
            if (key.includes('.')) {
                const keys = key.split('.');
let currentData = data;
                let found = true;
                for (const k of keys) {
                    if (currentData && typeof currentData === 'object' && currentData.hasOwnProperty(k)) {
                        currentData = currentData[k];
} else if (k.endsWith('Json')) {
                        // Speciális eset: {simJson.mu_h_sim} esetén a 'simJson' már objektum, nem kell stringify
                        const baseKey = k.replace('Json', '');
if (currentData && currentData.hasOwnProperty(baseKey) && currentData[baseKey] !== undefined) {
                            try { 
                                currentData = currentData[baseKey];
} catch (e: any) { 
                                console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál (bejövő objektum)`);
currentData = {}; 
                            }
                         }
                    } else {
                        found = false;
break;
                    }
                }
                if (found) {
                    value = currentData;
} else {
                    console.warn(`Hiányzó pontozott kulcs a prompt kitöltéséhez: ${key}`);
return "N/A";
                }
            
            } else if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
                 value = data[key];
} 
 
            else if (key.endsWith('Json')) {
                const baseKey = key.replace('Json', '');
if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                    try { return JSON.stringify(data[baseKey]);
} 
                     catch (e: any) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`);
return '{}'; }
                } else { return '{}';
} 
            }
            else { 
                 console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
return "N/A";
            }

            if (value === null || value === undefined) { return "N/A";
}
            if (typeof value === 'object') {
                 try { return JSON.stringify(value);
} catch (e) { return "[object]"; }
            }
            return String(value);
});
    } catch(e: any) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
return template; 
    }
}


// === Változatlan (v63.1): 5. ÜGYNÖK (A KRITIKUS) PROMPT ===
// Ez továbbra is a 'contradiction_score'-t adja vissza.
const PROMPT_CRITIC_V63 = `
TASK: You are 'The Critic', the 5th Agent in a 6-agent analysis chain.
Your job is to find **CONTRADICTIONS** and **RISKS** between the simulation (Agent 4) and external factors (Market, Raw Data).
[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (This sim was run on the FINAL Contextually-Weighted xG. P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Market Sentiment (Scout Data): "{marketIntel}"
3. Value Bets (Calculated): {valueBetsJson}
4. Model Confidence (Statistical): {modelConfidence}/10
5. Raw Contextual Data (for qualitative review): {rawDataJson}

[YOUR TASK - CRITIQUE & SCORING]:
1. Review ALL inputs and identify the top 1-3 most significant risks or contradictions.
2. Generate a "Tactical Summary" synthesizing the simulation and the raw context (injuries, market moves).
3. Generate a "Contradiction Score" (a number between -10.0 and +10.0).
   - A negatív pontszám JELENTŐS KOCKÁZATOT jelent (pl. a statisztika 70%-ot ad a Hazaira, de a kulcsjátékosuk hiányzik ÉS a piac ellenük mozog).
   - A 0 körüli pontszám azt jelenti, hogy nincsenek jelentős ellentmondások.
   - A pozitív pontszám azt jelenti, hogy a kontextus (pl. hiányzók) ERŐSEN TÁMOGATJA a szimuláció eredményét.
(e.g., Confidence is 9/10, but there's no value?)
- Is there a "narrative trap" in the Raw Data (5) (e.g., a major rivalry) that the simulation (1) might be under-valuing?
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_score": <Number, from -10.0 to +10.0. Example: -3.5 (ha a piac ellentmond) or 0.0 (ha nincs ellentmondás) or 2.0 (ha a hiányzók alátámasztják)>,
  "key_risks": [
    "<List of 1-3 string bullet points describing the main risks. Example: 'KOCKÁZAT: A szimuláció (1) 65%-ot ad a Hazaira, de a 'smart money' (2) a Vendégre mozog.'>"
  ],
  "tactical_summary": "<A 2. (Scout) és 4. (Sim) Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása. Example: 'A Scout (2) jelentős piaci mozgást észlelt a hazaiak ellen, valószínűleg a tegnapi edzésen történt sérülés miatt (5). 
Ez ellentmond a szimulációnak (1), amely a statisztikák alapján még mindig a hazaiakat favorizálja.'>"
}
`;

// === ÚJ (v64.0): 6. ÜGYNÖK (A BANKÁR) PROMPT ===
// Ez az alapértelmezett, konzervatív Stratéga
export const PROMPT_STRATEGIST_BANKER_V64 = `
TASK: You are 'The Banker', the 6th and FINAL Agent.
Your job is to synthesize all reports into a final, decisive recommendation.
**YOUR PERSONALITY: You are a CONSERVATIVE risk manager. Your primary goal is capital protection.**

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
3. Agent 3 (Specialist) Report:
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report:
   - Simulation based on Agent 3's Weighted xG: {simulatorReport}
5. Agent 5 (Critic) Report:
   - Risks Found: {criticReport.key_risks}
   - Tactical Summary: "{criticReport.tactical_summary}"
   - Calculated Risk/Support Score: {criticReport.contradiction_score}
6. Statistical Model Confidence: {modelConfidence}/10
7. **Final Calculated Confidence (Quant + Critic): {final_confidence_score}/10**

[YOUR TASK - FINAL DECISION (BANKER)]:
1. Synthesize everything, starting with the Critic's summary (5).
2. Generate the Prophetic Timeline based on the Final Weighted xG (3) and Context (5).
3. **Justify the "Final Calculated Confidence" (7).** Explain HOW the "Statistical Confidence" (6) was adjusted by the "Critic's Report" (5) to reach the final score.
4. **Generate the "Banker's Recommendation":**
   - **PRIORITY 1 (Capital Protection):** If the Final Confidence (7) is low (< 5.0) OR the Critic's Risks (5) are high, you MUST choose the safest possible recommendation. (e.g., If the tip is "Home Win", suggest "Home 1X" or "Home DNB". If the tip is "Over 2.5", suggest "Over 2.0" or avoid it).
   - **PRIORITY 2 (Clarity):** Always pick a clear 1X2, O/U, or BTTS bet. Do not recommend "No Bet".

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<(A PRÓFÉTA) Egy 2-3 mondatos, valósághű narratíva a meccs várható lefolyásáról. Szintetizáld a 'Final Weighted xG'-t (3) és a 'Critic's Tactical Summary'-t (5).>",
  
  "strategic_synthesis": "<Egy 2-3 bekezdéses holisztikus elemzés. Magyarázd el a teljes láncot. Térj ki a 'Pure xG'-re (2), indokold meg, hogy a kontextus (3) miért módosította. Kezeld a 'Critic's Risks'-t (5)!>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés.
A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés.
**KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés.
Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés.
Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**{final_confidence_score}/10** - Részletes indoklás. <INDOKOLD MEG a {final_confidence_score}-es végső pontszámot. Vessd össze a {modelConfidence} (stat) bizalmat a 'Critic's Risks' (5) és a {criticReport.contradiction_score} (kockázati pontszám) által jelzett tényezőkkel.>",
  
  "master_recommendation": {
    "recommended_bet": "<A KONZERVATÍV, 'Bankár' ajánlás (pl. 'Home Win 1X' vagy 'Over 2.0')>",
    "final_confidence": {final_confidence_score},
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely a konzervatív döntést és a kockázatokat hangsúlyozza>"
  }
}
`;

// === ÚJ (v64.0): 6. ÜGYNÖK (A SZERENCSEJÁTÉKOS) PROMPT ===
// Ez az agresszív, értékközpontú Stratéga
export const PROMPT_STRATEGIST_GAMBLER_V64 = `
TASK: You are 'The Gambler', the 6th and FINAL Agent.
Your job is to synthesize all reports into a final, decisive recommendation.
**YOUR PERSONALITY: You are an AGGRESSIVE value investor. Your primary goal is finding high-value opportunities, even if they are high risk.**

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
3. Agent 3 (Specialist) Report:
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report:
   - Simulation based on Agent 3's Weighted xG: {simulatorReport}
5. Agent 5 (Critic) Report:
   - Risks Found: {criticReport.key_risks}
   - Tactical Summary: "{criticReport.tactical_summary}"
   - Calculated Risk/Support Score: {criticReport.contradiction_score}
6. Statistical Model Confidence: {modelConfidence}/10
7. **Final Calculated Confidence (Quant + Critic): {final_confidence_score}/10**
8. Value Bets Found (from Scout): {valueBetsJson}

[YOUR TASK - FINAL DECISION (GAMBLER)]:
1. Synthesize everything, starting with the Critic's summary (5).
2. Generate the Prophetic Timeline based on the Final Weighted xG (3) and Context (5).
3. **Justify the "Final Calculated Confidence" (7).**
4. **Generate the "Gambler's Recommendation":**
   - **PRIORITY 1 (Find Value):** Look for opportunities where the model (4) and the context (5) CONTRADICT the market, even if confidence (7) is low.
   - **PRIORITY 2 (Act on Context):** If the Critic's score (5) is strongly negative (e.g., -5.0) because of major absentees (like the FC Utrecht log), you MUST recommend betting AGAINST the favored team, regardless of the statistical model.
   - **PRIORITY 3 (Use Value Bets):** If `valueBetsJson` (8) is not empty, prioritize those bets.
   - **PRIORITY 4 (Clarity):** Always pick a clear 1X2, O/U, or BTTS bet. Do not recommend "No Bet".

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<(A PRÓFÉTA) Egy 2-3 mondatos, valósághű narratíva a meccs várható lefolyásáról. Szintetizáld a 'Final Weighted xG'-t (3) és a 'Critic's Tactical Summary'-t (5).>",
  
  "strategic_synthesis": "<Egy 2-3 bekezdéses holisztikus elemzés. Magyarázd el a teljes láncot. Térj ki a 'Pure xG'-re (2), indokold meg, hogy a kontextus (3) miért módosította. Kezeld a 'Critic's Risks'-t (5)!>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés.
A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés.
**KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés.
Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés.
Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**{final_confidence_score}/10** - Részletes indoklás. <INDOKOLD MEG a {final_confidence_score}-es végső pontszámot. Vessd össze a {modelConfidence} (stat) bizalmat a 'Critic's Risks' (5) és a {criticReport.contradiction_score} (kockázati pontszám) által jelzett tényezőkkel.>",
  
  "master_recommendation": {
    "recommended_bet": "<Az AGGRESSZÍV, 'Gambler' ajánlás (pl. 'Away Win', 'Over 2.5')>",
    "final_confidence": {final_confidence_score},
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely az értékre vagy a kontextuális felülbírálásra fókuszál>"
  }
}
`;


// === Változatlan (v63.1): 5. LÉPÉS (KRITIKUS) ===
interface CriticInput {
    simJson: any;
marketIntel: string;
    valueBetsJson: any[];
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V63, data);
return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
// Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
            "contradiction_score": 0.0, // Semleges pontszám hiba esetén
            "key_risks": [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            "tactical_summary": `AI Hiba (Critic): ${e.message}`
        };
}
}

// === MÓDOSÍTVA (v64.0): 6. LÉPÉS (STRATÉGA) ===
// Most már paraméterként kapja a promptot
interface StrategistInput {
    matchData: { home: string, away: string, sport: string, leagueName: string };
quantReport: { pure_mu_h: number, pure_mu_a: number, source: string };
    specialistReport: { mu_h: number, mu_a: number, log: any };
    simulatorReport: any;
criticReport: any; // Az 5. Ügynök kimenete
    modelConfidence: number;
    final_confidence_score: number;
    valueBetsJson: any[]; // ÚJ: Átadjuk a Gamblernek
    rawDataJson: ICanonicalRawData;
// A teljes kontextus a biztonság kedvéért
    realXgJson: any;
// A P1 tiszta xG
}
export async function runStep_Strategist(
    data: StrategistInput, 
    promptTemplate: string, 
    stepName: string
): Promise<any> {
    try {
        // Biztosítjuk, hogy a simJson (a 4. Ügynök jelentése) a 'simulatorReport' kulcson legyen
        const dataForPrompt = { ...data, simulatorReport: data.simulatorReport };
const filledPrompt = fillPromptTemplate(promptTemplate, dataForPrompt);
        return await _callGeminiWithJsonRetry(filledPrompt, stepName);
    } catch (e: any) {
        console.error(`AI Hiba (${stepName}): ${e.message}`);
// Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            prophetic_timeline: `AI Hiba (${stepName}): A Próféta nem tudott jósolni.
${e.message}`,
            strategic_synthesis: `AI Hiba (${stepName}): ${e.message}`,
            micromodels: {},
            final_confidence_report: `**${data.final_confidence_score || 1.0}/10** - AI Hiba (${stepName}): ${e.message}`,
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: data.final_confidence_score || 1.0,
       
         brief_reasoning: `AI Hiba (${stepName}): ${e.message}`
            }
        };
}
}
// === MÓDOSÍTÁS VÉGE ===


// --- CHAT FUNKCIÓ --- (Változatlan)
interface ChatMessage {
  role: 'user' | 'model' | 'ai';
  parts: { text: string }[];
}

export async function getChatResponse(context: string, history: ChatMessage[], question: string): Promise<{ answer?: string;
error?: string }> {
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
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni."
};
    } catch (e: any) {
        console.error(`Chat hiba: ${e.message}`, e.stack);
return { error: `Chat AI Hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT --- (v63.0 - Frissítve a Lánc Lépéseire)
export default {
    runStep_Critic,
    runStep_Strategist,
    getChatResponse
};
