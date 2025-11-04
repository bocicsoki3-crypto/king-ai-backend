// --- AI_Service.ts (v54.41 - Gólvonal Hallucináció Javítása) ---
// MÓDOSÍTÁS:
// 1. A 'PROMPT_STEP_3_STRATEGIST' 'goals_ou_analysis'
//    utasítása kiegészítve egy KRITIKUS paranccsal,
//    amely arra kényszeríti az AI-t, hogy kizárólag a
//    '{sim_mainTotalsLine}' változót használja,
//    megelőzve a "6.5-ös" vonal elemzését
//    foci meccseknél.
// 2. Tartalmazza a 'prophetic_timeline' (Próféta) mezőt is.

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


// --- 1. LÉPÉS: A KVANTITATÍV ELEMZŐ (A "QUANT") ---
const PROMPT_STEP_1_QUANT = `
TASK: You are 'Quant 7', an elite quantitative sports analyst.
You only trust objective data. You are skeptical of narrative and context.
Your job is to analyze the provided statistical data (Simulation, xG, Player Ratings) and identify the most probable outcome based *only* on the numbers.
DO NOT analyze tactics or injuries unless they are numerically represented in the data.
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
[DATA INPUTS]:
1. Simulation (Sim): {simJson}
2. Real xG Data (from Sofascore/API-Football or Manual Override): {realXgJson}
3. Key Player Ratings (Avg. per position, from Sofascore): {keyPlayerRatingsJson}
4. Value Bets (Calculated): {valueBetsJson}

[OUTPUT STRUCTURE]:
{
  "quantitative_summary": "<Egy 2-3 mondatos összefoglaló, amely *csak* a számokra (xG, sim%) fókuszál.>",
  "data_driven_conclusion": "<Mi a legvalószínűbb kimenetel (1X2, O/U) *kizárólag* a statisztikák alapján?>",
  "key_statistical_insights": [
    "<1. kulcsfontosságú statisztikai adat (pl. 'A hazai xG (2.1) szignifikánsan magasabb, mint a vendég xG (0.8).')>",
    "<2. kulcsfontosságú statisztikai adat (pl. 'A szimuláció 65%-os esélyt ad a Hazai győzelemre.')>",
    "<3. kulcsfontosságú adat (pl. 'A vendég kapus (Rating: 7.8) statisztikailag kiemelkedő.')>"
  ],
  "value_opportunities": "<Listázd az 1-2 legjobb 'Value Bet'-et, ha van ilyen. Ha nincs, 'Nincs statisztikailag szignifikáns érték.'>"
}
`;

// --- 2. LÉPÉS: A TAKTIKAI FELDERÍTŐ (A "SCOUT") ---
const PROMPT_STEP_2_SCOUT = `
TASK: You are 'Scout 3', an expert tactical scout.
You trust what you see (context, tactics, injuries), not what the spreadsheet says.
Your job is to analyze the provided *qualitative* data (injuries, team news, tactical styles) and identify the most likely *narrative* of the match.
DO NOT mention xG or simulation results. Focus on *why* the numbers might be wrong.
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
[DATA INPUTS]:
1. Raw Data (Full Context): {rawDataJson}
2. Confirmed Absentees (from Sofascore): {detailedPlayerStatsJson}
3. Market Sentiment (Odds Movement): "{marketIntel}"

[OUTPUT STRUCTURE]:
{
  "tactical_summary": "<Egy 2-3 mondatos taktikai összefoglaló (stílus-párharc, motiváció).>",
  "narrative_conclusion": "<Mi a legvalószínűbb kimenetel (1X2, O/U) *kizárólag* a kontextus (sérülések, forma) alapján?>",
  "key_contextual_insights": [
    "<1. kulcsfontosságú kontextuális adat (pl. 'A hazai kulcsjátékos (Kovács) sérülése (confirmed_out) kritikus, a védelem instabil lesz.')>",
    "<2. kulcsfontosságú kontextuális adat (pl. 'A vendég csapat stílusa (magas letámadás) közvetlen ellenszere a hazai lassú építkezésnek.')>",
    "<3. kulcsfontosságú adat (pl. 'A piaci mozgás (-5%) a vendégcsapatot favorizálja, ellentmondva a tabellának.')>"
  ],
  "contextual_risks": "<Listázd az 1-2 legnagyobb kockázatot (pl. 'Derbi meccs, a feszültség magas, sok lap várható.')>"
}
`;

// --- 3. LÉPÉS: A VEZETŐ STRATÉGA (A "SYNTHESIS") ---
// === JAVÍTÁS (v54.41) Gólvonal Hallucináció Javítása ===
const PROMPT_STEP_3_STRATEGIST = `
TASK: You are the Head Strategist.
Your decision is final.
You have received two conflicting reports:
1. QUANT REPORT (Data-driven): {step1QuantJson}
2. SCOUT REPORT (Context-driven): {step2ScoutJson}

Your job is to *resolve the conflict* between these two reports.
Acknowledge their findings but provide a superior, synthesized final decision.
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
[DATA INPUTS]:
1. Quant Report (Step 1): {step1QuantJson}
2. Scout Report (Step 2): {step2ScoutJson}
3. Model Confidence (Statistical): {modelConfidence}/10
4. Simulation (Full Sim): {simJson}
5. The correct main totals line to analyze: {sim_mainTotalsLine}

[OUTPUT STRUCTURE]:
{
  "prophetic_timeline": "<(A PRÓFÉTA) Egy 2-3 mondatos, valósághű narratíva a meccs várható lefolyásáról. Szintetizáld a Quant (xG, sim) és a Scout (taktika, hiányzók) adatait. Példa: 'A meccs tapogatózóan indul, de a Scout által jelzett hazai védelmi hiba miatt a vendégek szereznek vezetést az első félidőben. A második félidőben a Quant által jelzett hazai xG fölény érvényesül, és a 70. perc környékén kiegyenlítenek.'>",
  
  "strategic_conflict_resolution": "<Egy 2-3 bekezdéses elemzés. Szintetizáld a Quant és a Scout jelentését. Ha ellentmondanak (pl. Quant a Hazait, Scout a Vendéget favorizálja), oldd fel az ellentmondást (pl. 'A Quant helyesen azonosította a hazai statisztikai fölényt, de a Scout jelentése a kulcsjátékos sérüléséről felülírja ezt. A kockázat túl magas.')>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. Ha nem foci (pl. simJson.pBTTS N/A), írj 'N/A'-t.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {sim_mainTotalsLine} gólvonalat (pl. 2.5, 3.5, 6.5) elemezd!** Ne használj semmilyen más gólvonalat a 'simJson'-ból. Az elemzésednek erre a vonalra kell vonatkoznia.>\\nBizalom: [Alacsony/Közepes/Magas]",
    
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simJson.mu_corners_sim > 0 (azaz focinál). Különben írj 'N/A'-t.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simJson.mu_cards_sim > 0 (azaz focinál). Különben írj 'N/A'-t.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**<SCORE/10>** - Részletes indoklás. Vessd össze a {modelConfidence} (stat) bizalmat a Scout által jelzett kockázatokkal (pl. sérülések, piaci mozgás). A végső pontszám tükrözze a Quant és a Scout közötti összhangot vagy annak hiányát.>",
  
  "master_recommendation": {
    "recommended_bet": "<A végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number 1.0-10.0>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a szintézist>"
  }
}
`;
// === JAVÍTÁS VÉGE ===


// --- TÍPUSOK a bemeneti adatokhoz ---
interface Step1Input {
  simJson: any;
  realXgJson: any;
  keyPlayerRatingsJson: any;
  valueBetsJson: any[];
}

interface Step2Input {
  rawDataJson: ICanonicalRawData;
  detailedPlayerStatsJson: ICanonicalPlayerStats;
  marketIntel: string;
}

interface Step3Input {
  step1QuantJson: any; // Step1 kimenete
  step2ScoutJson: any; // Step2 kimenete
  modelConfidence: number;
  simJson: any;
  sim_mainTotalsLine: number;
}


// --- HELPER a promptok kitöltéséhez (Változatlan) ---
function fillPromptTemplate(template: string, data: any): string {
    if (!template || typeof template !== 'string') return '';
    try {
        return template.replace(/\{([\w_]+)\}/g, (match, key) => {
            let value: any;
            
            if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
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

// === LÁNCOLT AI HÍVÓK (v54.5 - Retry logikával) ===

/**
 * 1. LÉPÉS: Quant Elemzés
 */
export async function runStep1_GetQuant(data: Step1Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_1_QUANT, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 1 - Quant");
    } catch (e: any) {
        console.error(`AI Hiba (Step 1 - Quant): ${e.message}`);
        return { error: `AI Hiba (Step 1 - Quant): ${e.message}` };
    }
}

/**
 * 2. LÉPÉS: Scout Elemzés
 */
export async function runStep2_GetScout(data: Step2Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_2_SCOUT, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 2 - Scout");
    } catch (e: any) {
        console.error(`AI Hiba (Step 2 - Scout): ${e.message}`);
        return { error: `AI Hiba (Step 2 - Scout): ${e.message}` };
    }
}

/**
 * 3. LÉPÉS: Stratégiai Döntés (Szintézis)
 */
export async function runStep3_GetStrategy(data: Step3Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_3_STRATEGIST, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 3 - Strategy");
    } catch (e: any) {
        console.error(`AI Hiba (Step 3 - Strategy): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            prophetic_timeline: `AI Hiba (Step 3): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_conflict_resolution: `AI Hiba (Step 3): ${e.message}`,
            micromodels: {},
            final_confidence_report: "**1.0/10** - AI Hiba (Step 3)",
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0,
                brief_reasoning: `AI Hiba (Step 3): ${e.message}`
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

// --- FŐ EXPORT --- (v54.5 - Frissítve a Dialektikus CoT lépésekre)
export default {
    runStep1_GetQuant,
    runStep2_GetScout,
    runStep3_GetStrategy,
    getChatResponse
};