// FÁJL: AI_Service.ts
// VERZIÓ: v54.19 (Próféta Könyv Narratíva Integráció)
// MÓDOSÍTÁS:
// 1. A 'PROMPT_STEP_3_STRATEGIST' kiegészítve egy új, kötelező
//    JSON kulccsal: "prophetic_narrative".
// 2. Az AI Stratéga most már egy valósághű, prediktív
//    narratívát is generál a meccs lefolyásáról.

[cite_start]import { _callGemini } from './DataFetch.js'; [cite: 13]
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

[cite_start]// === ÚJ SEGÉDFÜGGVÉNY (v54.5): Robusztus AI hívó JSON parse retry logikával === [cite: 14]

/**
 * Behívja a _callGemini-t és ellenőrzi a JSON-feldolgozást.
 * [cite_start]Ha a JSON.parse hibát dob (pl. a Gemini hibás/hiányos JSON-t küldött), [cite: 15]
 * [cite_start]automatikusan újrapróbálja a hívást. [cite: 16]
 */
async function _callGeminiWithJsonRetry(
    prompt: string, 
    stepName: string, // Logoláshoz (pl. "Step 1 - Quant")
    maxRetries: number = 2 // Alap hívás + 2 újrapróbálkozás
): Promise<any> {
    
    let attempts = 0;
    [cite_start]while (attempts <= maxRetries) { [cite: 17]
        attempts++;
        [cite_start]try { [cite: 18]
            // 1. Hívjuk az alap Gemini függvényt
            [cite_start]const jsonString = await _callGemini(prompt, true); [cite: 19] // true = JSON kényszerítése
            
            // 2. Megpróbáljuk feldolgozni
            const result = JSON.parse(jsonString);
            
            [cite_start]// 3. Siker [cite: 20]
            if (attempts > 1) {
                [cite_start]console.log(`[AI_Service] Sikeres JSON feldolgozás (${stepName}) a(z) ${attempts}. próbálkozásra.`); [cite: 21]
            }
            return result;
        [cite_start]} catch (e: any) { [cite: 22]
            // 4. Hiba kezelése
            if (e instanceof SyntaxError) { // Ez a JSON.parse hiba
                console.warn(`[AI_Service] FIGYELMEZTETÉS: Gemini JSON parse hiba (${stepName}), ${attempts}/${maxRetries+1}. próbálkozás. Hiba: ${e.message}`);
                [cite_start]if (attempts > maxRetries) { [cite: 23]
                    console.error(`[AI_Service] KRITIKUS HIBA: A Gemini JSON feldolgozása végleg sikertelen (${stepName}) ${attempts-1} próbálkozás után.`);
                    [cite_start]throw new Error(`AI Hiba (${stepName}): A modell hibás JSON struktúrát adott vissza, ami nem feldolgozható. Hiba: ${e.message}`); [cite: 24]
                }
                [cite_start]// Várakozás az újrapróbálkozás előtt [cite: 25]
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            [cite_start]} else { [cite: 26]
                // Ez egy egyéb hiba (pl. hálózati), továbbdobjuk
                console.error(`[AI_Service] Kritikus nem-parse hiba (${stepName}): ${e.message}`);
                [cite_start]throw e; [cite: 27]
            }
        }
    }
    // Ez a sor elvileg elérhetetlen, de a TypeScript fordítónak kell
    [cite_start]throw new Error(`AI Hiba (${stepName}): Ismeretlen hiba az újrapróbálkozási ciklusban.`); [cite: 28]
}


// --- 1. LÉPÉS: A KVANTITATÍV ELEMZŐ (A "QUANT") ---
const PROMPT_STEP_1_QUANT = `
TASK: You are 'Quant 7', an elite quantitative sports analyst.
You only trust objective data. [cite_start]You are skeptical of narrative and context. [cite: 29]
[cite_start]Your job is to analyze the provided statistical data (Simulation, xG, Player Ratings) and identify the most probable outcome based *only* on the numbers. [cite: 30]
[cite_start]DO NOT analyze tactics or injuries unless they are numerically represented in the data. [cite: 31]
[cite_start]Your response MUST be ONLY a single, valid JSON object with this EXACT structure. [cite: 32]
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
    "<3. kulcsfontosságú adat (pl. 'A vendég 
[cite_start]kapus (Rating: 7.8) statisztikailag kiemelkedő.')>" [cite: 34]
  ],
  "value_opportunities": "<Listázd az 1-2 legjobb 'Value Bet'-et, ha van ilyen. Ha nincs, 'Nincs statisztikailag szignifikáns érték.'>"
}
`;

[cite_start]// --- 2. LÉPÉS: A TAKTIKAI FELDERÍTŐ (A "SCOUT") --- [cite: 35]
const PROMPT_STEP_2_SCOUT = `
TASK: You are 'Scout 3', an expert tactical scout.
[cite_start]You trust what you see (context, tactics, injuries), not what the spreadsheet says. [cite: 36]
[cite_start]Your job is to analyze the provided *qualitative* data (injuries, team news, tactical styles) and identify the most likely *narrative* of the match. [cite: 37]
DO NOT mention xG or simulation results. [cite_start]Focus on *why* the numbers might be wrong. [cite: 38]
[cite_start]Your response MUST be ONLY a single, valid JSON object with this EXACT structure. [cite: 39]
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
  [cite_start]], [cite: 41]
  "contextual_risks": "<Listázd az 1-2 legnagyobb kockázatot (pl. 'Derbi meccs, a feszültség magas, sok lap várható.')>"
}
`;

[cite_start]// --- 3. LÉPÉS: A VEZETŐ STRATÉGA (A "SYNTHESIS") --- [cite: 42]
// === JAVÍTÁS (v54.19): "prophetic_narrative" kulcs hozzáadva ===
const PROMPT_STEP_3_STRATEGIST = `
TASK: You are the Head Strategist.
[cite_start]Your decision is final. [cite: 43]
You have received two conflicting reports:
1. QUANT REPORT (Data-driven): {step1QuantJson}
2. SCOUT REPORT (Context-driven): {step2ScoutJson}

[cite_start]Your job is to *resolve the conflict* between these two reports. [cite: 44]
Acknowledge their findings but provide a superior, synthesized final decision.
[cite_start]Your response MUST be ONLY a single, valid JSON object with this EXACT structure. [cite: 45]
[DATA INPUTS]:
1. Quant Report (Step 1): {step1QuantJson}
2. Scout Report (Step 2): {step2ScoutJson}
3. Model Confidence (Statistical): {modelConfidence}/10
4. Simulation (Full Sim): {simJson}

[OUTPUT STRUCTURE]:
{
  "strategic_conflict_resolution": "<Egy 2-3 bekezdéses elemzés. Szintetizáld a Quant és a Scout jelentését. Ha ellentmondanak (pl. Quant a Hazait, Scout a Vendéget favorizálja), oldd fel az ellentmondást (pl. 'A Quant helyesen azonosította a hazai statisztikai fölényt, de a Scout jelentése a kulcsjátékos sérüléséről felülírja ezt. A kockázat túl magas.')>",
  
  "prophetic_narrative": "<Egy 3-5 mondatos, 'Próféta Könyv' stílusú narratíva. Írd le a meccs legvalószínűbb lefolyását (pl. 'Az első félidő tapogatózó lesz, de a vendégek kulcsjátékosának (Kovács) hiánya miatt a hazaiak a 60. perc környékén átveszik az irányítást...'). Használd a Quant (xG) és a Scout (sérülések, időjárás, bíró) adatait a történet megírásához.>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés a Quant és Scout adatok alapján>\\nBizalom: [Alacsony/Közepes/Magas]",
    [cite_start]"goals_ou_analysis": "<Gól O/U elemzés (a {sim_mainTotalsLine} vonal alapján)>\\nBizalom: [Alacsony/Közepes/Magas]" [cite: 47]
  },
  
  "final_confidence_report": "**<SCORE/10>** - Részletes indoklás. Vessd össze a {modelConfidence} (stat) bizalmat a Scout által jelzett kockázatokkal (pl. 
[cite_start]sérülések, piaci mozgás). A végső pontszám tükrözze a Quant és a Scout közötti összhangot vagy annak hiányát.>", [cite: 48]
  
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
  step2ScoutJson: any; [cite_start]// Step2 kimenete [cite: 49]
  modelConfidence: number;
  simJson: any;
  sim_mainTotalsLine: number;
}


// --- HELPER a promptok kitöltéséhez (Változatlan) ---
function fillPromptTemplate(template: string, data: any): string {
    [cite_start]if (!template || typeof template !== 'string') return ''; [cite: 50]
    try {
        return template.replace(/\{([\w_]+)\}/g, (match, key) => {
            let value: any;
            
            if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
                 value = data[key];
            } 
            [cite_start]else if (key.endsWith('Json')) { [cite: 51]
                const baseKey = key.replace('Json', '');
                if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                    try { return JSON.stringify(data[baseKey]); } 
                    catch (e: any) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; [cite_start]} [cite: 52]
                } else { return '{}'; } 
            }
            else { 
                 console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
                 [cite_start]return "N/A"; [cite: 53]
            }

            if (value === null || value === undefined) { return "N/A"; }
            if (typeof value === 'object') {
                 try { return JSON.stringify(value); } catch (e) { return "[object]"; [cite_start]} [cite: 54]
            }
            [cite_start]return String(value); [cite: 55]
        });
    } catch(e: any) {
         [cite_start]console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`); [cite: 56]
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
        [cite_start]// JAVÍTÁS: A robusztus hívót használjuk [cite: 57]
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 1 - Quant");
    [cite_start]} catch (e: any) { [cite: 58]
        console.error(`AI Hiba (Step 1 - Quant): ${e.message}`);
        [cite_start]return { error: `AI Hiba (Step 1 - Quant): ${e.message}` }; [cite: 59]
    [cite_start]} [cite: 60]
}

/**
 * 2. LÉPÉS: Scout Elemzés
 */
export async function runStep2_GetScout(data: Step2Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_2_SCOUT, data);
        [cite_start]// JAVÍTÁS: A robusztus hívót használjuk [cite: 61]
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 2 - Scout");
    [cite_start]} catch (e: any) { [cite: 62]
        console.error(`AI Hiba (Step 2 - Scout): ${e.message}`);
        [cite_start]return { error: `AI Hiba (Step 2 - Scout): ${e.message}` }; [cite: 63]
    [cite_start]} [cite: 64]
}

/**
 * 3. LÉPÉS: Stratégiai Döntés (Szintézis)
 */
export async function runStep3_GetStrategy(data: Step3Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_3_STRATEGIST, data);
        [cite_start]// JAVÍTÁS: A robusztus hívót használjuk (ez volt a hibás lépés a logban) [cite: 65]
        return await _callGeminiWithJsonRetry(filledPrompt, "Step 3 - Strategy");
    [cite_start]} catch (e: any) { [cite: 66]
        console.error(`AI Hiba (Step 3 - Strategy): ${e.message}`);
        [cite_start]// Kritikus hiba esetén is adjunk vissza egy alap ajánlást [cite: 67]
        return {
            strategic_conflict_resolution: `AI Hiba (Step 3): ${e.message}`,
            micromodels: {},
            final_confidence_report: "**1.0/10** - AI Hiba (Step 3)",
            master_recommendation: {
                recommended_bet: "Hiba",
                [cite_start]final_confidence: 1.0, [cite: 68]
                brief_reasoning: `AI Hiba (Step 3): ${e.message}`
            }
        };
    [cite_start]} [cite: 69]
}


// --- CHAT FUNKCIÓ --- (Változatlan)
interface ChatMessage {
  role: 'user' | 'model' | 'ai';
  [cite_start]parts: { text: string }[]; [cite: 70]
}

[cite_start]export async function getChatResponse(context: string, history: ChatMessage[], question: string): Promise<{ answer?: string; [cite: 71]
error?: string }> {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." [cite_start]}; [cite: 72]
    try {
        const historyString = (history || [])
             .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            [cite_start].join('\n'); [cite: 73]
        const prompt = `You are an elite sports analyst AI assistant specialized in the provided match analysis.
[CONTEXT of the analysis]:
--- START CONTEXT ---
${context}
--- END CONTEXT ---

CONVERSATION HISTORY:
${historyString}

Current User Question: ${question}

Answer concisely and accurately in Hungarian based ONLY on the provided Analysis Context and Conversation History.
Do not provide betting advice. [cite_start]Do not make up information not present in the context. [cite: 75]
[cite_start]If the answer isn't in the context or history, politely state that the information is not available in the analysis.`; [cite: 76]
        [cite_start]// A chat funkció nem kényszerít JSON-t, ezért a sima _callGemini-t hívja [cite: 77]
        const rawAnswer = await _callGemini(prompt, false);
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni." [cite_start]}; [cite: 78]
    [cite_start]} catch (e: any) { [cite: 79]
        console.error(`Chat hiba: ${e.message}`, e.stack);
        [cite_start]return { error: `Chat AI hiba: ${e.message}` }; [cite: 80]
    }
}

// --- FŐ EXPORT --- (v54.5 - Frissítve a Dialektikus CoT lépésekre)
export default {
    runStep1_GetQuant,
    runStep2_GetScout,
    runStep3_GetStrategy,
    getChatResponse
};
