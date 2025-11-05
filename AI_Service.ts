// --- AI_Service.ts (v55.1 - Egyesített Holisztikus Modell) ---
// MÓDOSÍTÁS:
// 1. A 3-lépéses "Dialektikus CoT" (Quant, Scout, Strategist)
//    teljesen eltávolítva.
// 2. Helyettesítve egyetlen, holisztikus "Strategist Prime" prompttal
//    (PROMPT_UNIFIED_STRATEGIST_V55), amely az összes "6 láncszemet"
//    egyszerre kapja meg.
// 3. Az elavult runStep1/2/3 függvények eltávolítva, helyettük
//    az új 'runStep_UnifiedAnalysis' exportálva.

import { _callGemini } from './DataFetch.js';
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// === Robusztus AI hívó JSON parse retry logikával (v54.5) ===
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


// === ÚJ (v55.1) EGYESÍTETT STRATÉGA PROMPT ===
const PROMPT_UNIFIED_STRATEGIST_V55 = `
TASK: You are 'Strategist Prime', an elite, holistic sports analyst.
Your job is to synthesize ALL available data (quantitative, contextual, and qualitative) into a single, decisive analysis.
Your decision is final.

[DATA INPUTS]:
1. Simulation (Sim): {simJson}
   (This sim was run using the 'Final Weighted xG' [mu_h_sim, mu_a_sim])
2. "Pure" xG (P1 Manual Input): {realXgJson}
   (This is the baseline xG *before* contextual modifiers like injuries/weather were applied.)
3. Final Weighted xG (Model.ts Output): { "home": {simJson.mu_h_sim}, "away": {simJson.mu_a_sim} }
   (This is the 'Pure xG' *after* applying modifiers for absentees, tactics, weather, etc.)
4. Key Player Ratings & Absentees (from Sofascore/Provider): {detailedPlayerStatsJson}
5. Value Bets (Calculated): {valueBetsJson}
6. Market Sentiment (Odds Movement): "{marketIntel}"
7. Raw Contextual Data (H2H, Form, etc.): {rawDataJson}
8. Model Confidence (Statistical): {modelConfidence}/10
9. The correct main totals line to analyze: {sim_mainTotalsLine}

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.

{
  "prophetic_timeline": "<(A PRÓFÉTA) Egy 2-3 mondatos, valósághű narratíva a meccs várható lefolyásáról. Szintetizáld a 'Final Weighted xG'-t (3) és a 'Key Player Absentees'-t (4). Példa: 'A meccs tapogatózóan indul, de a hiányzó hazai védő (4) miatt a vendégek szereznek vezetést az első félidőben. A második félidőben a súlyozott xG (3) fölény érvényesül, és a 70. perc környékén kiegyenlítenek.'>",
  
  "strategic_synthesis": "<Egy 2-3 bekezdéses holisztikus elemzés. Ne említs külön 'Quant' vagy 'Scout' jelentést. Elemezd a teljes képet. Térj ki a 'Pure xG'-re (2), majd indokold meg, hogy a kontextuális tényezők (4, 6, 7) miért módosították azt a 'Final Weighted xG'-re (3). Indokold meg, hogy a kontextus miért erősíti vagy gyengíti a statisztikai modellt.>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. Ha nem foci, írj 'N/A'-t.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {sim_mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!**>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simJson.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simJson.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**<SCORE/10>** - Részletes indoklás. Vessd össze a {modelConfidence} (stat) bizalmat a kontextuális kockázatokkal (sérülések (4), piaci mozgás (5)). A végső pontszám tükrözze a teljes kép összhangját vagy annak hiányát.",
  
  "master_recommendation": {
    "recommended_bet": "<A végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number 1.0-10.0>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a szintézist>"
  }
}
`;

// === TÍPUSOK az új egyesített bemenethez ===
interface UnifiedInput {
  simJson: any;
  realXgJson: any; // P1 Tiszta xG
  xgSource: string; // P1, P2, P4...
  keyPlayerRatingsJson: any;
  detailedPlayerStatsJson: ICanonicalPlayerStats;
  valueBetsJson: any[];
  marketIntel: string;
  rawDataJson: ICanonicalRawData;
  modelConfidence: number;
  sim_mainTotalsLine: number;
}


// --- HELPER a promptok kitöltéséhez (Változatlan) ---
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

// === EGYESÍTETT (v55.1) AI Elemzési Lépés ===

/**
 * 1. LÉPÉS: Egyesített Holisztikus Elemzés
 */
export async function runStep_UnifiedAnalysis(data: UnifiedInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_UNIFIED_STRATEGIST_V55, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_UnifiedAnalysis");
    } catch (e: any) {
        console.error(`AI Hiba (UnifiedAnalysis): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            prophetic_timeline: `AI Hiba (UnifiedAnalysis): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_synthesis: `AI Hiba (UnifiedAnalysis): ${e.message}`,
            micromodels: {},
            final_confidence_report: "**1.0/10** - AI Hiba (UnifiedAnalysis)",
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0,
                 brief_reasoning: `AI Hiba (UnifiedAnalysis): ${e.message}`
            }
        };
    }
}


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

// --- FŐ EXPORT --- (v55.1 - Frissítve az Egyesített Lépésre)
export default {
    runStep_UnifiedAnalysis,
    getChatResponse
};
