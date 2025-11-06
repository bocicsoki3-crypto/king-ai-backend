// --- AI_Service.ts (v63.0 - 6 Fős Bizottsági Lánc - 3. Lépés) ---
// MÓDOSÍTÁS (Feladat 2.5):
// 1. TÖRÖLVE: A 'PROMPT_UNIFIED_STRATEGIST_V55'  (ez okozta a "Dupla Számítás" hibát).
// 2. TÖRÖLVE: A 'runStep_UnifiedAnalysis' [cite: 2083-2088] függvény.
// 3. ÚJ FÜGGVÉNY: 'runStep_Critic' (5. Ügynök - A Kritikus) és 'PROMPT_CRITIC_V63' hozzáadva.
// 4. ÚJ FÜGGVÉNY: 'runStep_Strategist' (6. Ügynök - A Stratéga) és 'PROMPT_STRATEGIST_V63' hozzáadva.
// 5. A 'getConfidenceCalibrationMap' és a Chat funkció változatlan marad.

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

// === TÖRÖLVE (v63.0): 'PROMPT_UNIFIED_STRATEGIST_V55' ===
// Ez a prompt okozta a "Dupla Számítás" hibát.


// === ÚJ (v63.0): 5. ÜGYNÖK (A KRITIKUS) PROMPT ===
const PROMPT_CRITIC_V63 = `
TASK: You are 'The Critic', the 5th Agent in a 6-agent analysis chain.
Your job is NOT to re-analyze the stats. Your job is to find **CONTRADICTIONS** between the simulation (Agent 4) and external factors (Market, Raw Data).

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (This sim was run on the FINAL Contextually-Weighted xG. P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Market Sentiment (Scout Data): "{marketIntel}"
3. Value Bets (Calculated): {valueBetsJson}
4. Model Confidence (Statistical): {modelConfidence}/10
5. Raw Contextual Data (for qualitative review): {rawDataJson}

[YOUR TASK - CRITIQUE]:
Review ALL inputs and identify the top 1-3 most significant contradictions or risks.
- Does the Market (2) agree with the Simulation (1)? (e.g., Sim favors Home, but market is moving towards Away?)
- Does the Model Confidence (4) align with the Value Bets (3)? (e.g., Confidence is 9/10, but there's no value?)
- Is there a "narrative trap" in the Raw Data (5) (e.g., a major rivalry) that the simulation (1) might be under-valuing?

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "key_contradictions": [
    "<List of 1-3 string bullet points describing the main contradictions or risks found. Example: 'KRITIKUS ELLENTMONDÁS: A szimuláció (1) 65%-ot ad a Hazaira, de a 'smart money' (2) a Vendégre mozog (+0.15 odds esés).'>",
    "<Example: 'FIGYELMEZTETÉS: A statisztikai modell (4) 9.0/10 bizalmat ad, de a csapat kulcsjátékosai (5) kétségesek (doubtful), ami magas kockázatot jelent.'>"
  ],
  "tactical_summary": "<A 2. (Scout) és 4. (Sim) Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása. Example: 'A Scout (2) jelentős piaci mozgást észlelt a hazaiak ellen, valószínűleg a tegnapi edzésen történt sérülés miatt (5). Ez ellentmond a szimulációnak (1), amely a statisztikák alapján még mindig a hazaiakat favorizálja.'>"
}
`;

// === ÚJ (v63.0): 6. ÜGYNÖK (A STRATÉGA) PROMPT ===
const PROMPT_STRATEGIST_V63 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent. You are the King.
Your job is to synthesize ALL previous reports into a single, final, decisive analysis and recommendation. You resolve all contradictions.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG" (Based on P1 Manual Input [cite: 2036-2038] or P4 Fallback): H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
   - P1 Input Used: {realXgJson}
3. Agent 3 (Specialist) Report:
   - "Final Weighted xG" (After applying context like injuries, weather): H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report:
   - Simulation based on Agent 3's Weighted xG: {simulatorReport}
5. Agent 5 (Critic) Report:
   - Contradictions Found: {criticReport.key_contradictions}
   - Tactical Summary: "{criticReport.tactical_summary}"
6. Statistical Model Confidence: {modelConfidence}/10

[YOUR TASK - FINAL DECISION]:
Synthesize everything.
- Start with the Critic's summary (5).
- Acknowledge the Quant (2) vs Specialist (3) modification (e.g., "The model started at 2.1 xG, but the injury context correctly adjusted it down to 1.7").
- Address the Critic's contradictions (5). If the Sim (4) and Market (5) disagree, YOU MUST CHOOSE ONE AND JUSTIFY IT.
- Generate the Prophetic Timeline based ONLY on the FINAL Weighted xG (3) and Context (5).
- Generate the final confidence score, weighing the statistical confidence (6) against the Critic's risks (5).

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<(A PRÓFÉTA) Egy 2-3 mondatos, valósághű narratíva a meccs várható lefolyásáról. Szintetizáld a 'Final Weighted xG'-t (3) és a 'Critic's Tactical Summary'-t (5). Példa: 'A meccs tapogatózóan indul, de a Kritikus által jelzett (5) hiányzó hazai védő miatt a vendégek szereznek vezetést az első félidőben. A második félidőben a súlyozott xG (3) fölény érvényesül, és a 70. perc környékén kiegyenlítenek.'>",
  
  "strategic_synthesis": "<Egy 2-3 bekezdéses holisztikus elemzés. Magyarázd el a teljes láncot. Térj ki a 'Pure xG'-re (2), indokold meg, hogy a kontextus (3) miért módosította. **KRITIKUS: Kezeld a 'Critic's Contradictions'-t (5)!** Ha a piac (5) és a modell (4) ellentétes, dönts. Example: 'A Quant (2) 1.8-1.2-t javasolt, de a Specialista (3) ezt 1.5-1.5-re módosította a hiányzók miatt. Bár a modell (4) így döntetlent vár, a Kritikus (5) helyesen jelzi, hogy a piac erősen a hazaiak felé mozog. Bíva a piaci jelzésben a modell statikusságával szemben, a hazai győzelem felé hajlunk...'>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**<SCORE/10>** - Részletes indoklás. Vessd össze a {modelConfidence} (stat) bizalmat a 'Critic's Contradictions' (5) által jelzett kockázatokkal. A végső pontszám tükrözze a teljes kép összhangját vagy annak hiányát.",
  
  "master_recommendation": {
    "recommended_bet": "<A végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number 1.0-10.0>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a szintézist és a Kritikus (5) jelentésére adott választ>"
  }
}
`;


// --- TÍPUSOK az új egyesített bemenethez ---
// Ezek már nem relevánsak, de a chat miatt maradhatnak a típusok

// === MÓDOSÍTÁS (6 FŐS BIZOTTSÁG): Töröljük a régi UnifiedInput-ot ===
// interface UnifiedInput { ... } // TÖRÖLVE


// --- 
// HELPER a promptok kitöltéséhez (Változatlan) ---
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
                    try { return JSON.stringify(data[baseKey]); } 
                     catch (e: any) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; }
                } else { return '{}'; } 
            }
            else { 
                 console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
                 return "N/A";
            }

            if (value === null || value === undefined) { return "N/A"; }
            if (typeof value === 'object') {
                 try { return JSON.stringify(value); } catch (e) { return "[object]"; }
            }
            return String(value);
        });
    } catch(e: any) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
         return template; 
    }
}

// === TÖRÖLVE (v63.0): EGYESÍTETT (v55.1) AI Elemzési Lépés ===
/*
export async function runStep_UnifiedAnalysis(data: UnifiedInput): Promise<any> {
    // ... TÖRÖLVE ...
}
*/


// === ÚJ (v63.0): 5. LÉPÉS (KRITIKUS) ===
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
            key_contradictions: [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            tactical_summary: `AI Hiba (Critic): ${e.message}`
        };
    }
}

// === ÚJ (v63.0): 6. LÉPÉS (STRATÉGA) ===
interface StrategistInput {
    matchData: { home: string, away: string, sport: string, leagueName: string };
    quantReport: { pure_mu_h: number, pure_mu_a: number, source: string };
    specialistReport: { mu_h: number, mu_a: number, log: any };
    simulatorReport: any;
    criticReport: any; // Az 5. Ügynök kimenete
    modelConfidence: number;
    rawDataJson: ICanonicalRawData; // A teljes kontextus a biztonság kedvéért
    realXgJson: any; // A P1 tiszta xG
}
export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        // Biztosítjuk, hogy a simJson (a 4. Ügynök jelentése) a 'simulatorReport' kulcson legyen
        const dataForPrompt = { ...data, simulatorReport: data.simulatorReport };
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V63, dataForPrompt);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist");
    } catch (e: any) {
        console.error(`AI Hiba (Strategist): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            prophetic_timeline: `AI Hiba (Strategist): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_synthesis: `AI Hiba (Strategist): ${e.message}`,
            micromodels: {},
            final_confidence_report: "**1.0/10** - AI Hiba (Strategist)",
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0,
                brief_reasoning: `AI Hiba (Strategist): ${e.message}`
            }
        };
    }
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
