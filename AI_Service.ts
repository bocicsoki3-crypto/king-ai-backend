// --- JAVÍTOTT AI_service.ts (v52 - TypeScript & CoT) ---

/**
 * AI_Service.ts (Node.js Verzió)
 * VÁLTOZÁS (v52 - TS):
 * - A modul átalakítva TypeScript-re.
 * - A 3-lépcsős "Chain-of-Thought" (CoT) funkciók bemeneti paraméterei
 * szigorúan típusosítva lettek (pl. `simJson: any`, `detailedPlayerStatsJson: ICanonicalPlayerStats`).
 * - Ez biztosítja, hogy a megfelelő adatszerződések legyenek
 * kényszerítve a lánc lépései között.
 */
import { _callGemini } from './DataFetch.js';
import { getConfidenceCalibrationMap } from './LearningService.js';

// Kanonikus típusok importálása (opcionális, de ajánlott a szigorúbb ellenőrzéshez)
import { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// --- 1. LÉPÉS: TÉNYFELTÁRÓ PROMPT ---
const PROMPT_STEP_1_FACTS = `
TASK: You are a Data Analyst. Your job is to extract and structure critical facts from the provided raw data.
DO NOT ANALYZE. DO NOT SPECULATE. Only report confirmed facts.
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.

[DATA INPUTS]:
1. Rich Context (News, H2H, Form): {richContext}
2. Detailed Player Stats (API): {detailedPlayerStatsJson}
3. Market Intel (Single Source): "{marketIntel}"

[OUTPUT STRUCTURE]:
{
  "key_facts_home": "<List 1-3 critical facts for Home (e.g., 'Key player X (Rating 7.8) is confirmed_out'). 'N/A' if none.>",
  "key_facts_away": "<List 1-3 critical facts for Away. 'N/A' if none.>",
  "market_sentiment": "<Describe the market movement based on 'Market Intel'. e.g., 'Market shows movement towards Home (-5.0%)'. 'N/A' if none.>",
  "h2h_summary": "<A 1-2 sentence summary of the H2H data from 'Rich Context'.>",
  "contextual_notes": "<Note any other critical factors like weather or high tension from 'Rich Context'.>"
}
`;

// --- 2. LÉPÉS: ELEMZŐ PROMPT ---
const PROMPT_STEP_2_ANALYSIS = `
TASK: You are the Head Tactical Analyst. Analyze the provided simulations and structured facts.
DO NOT provide a final recommendation. Your job is deep analysis.
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.

[DATA INPUTS]:
1. Simulation (Sim): {simJson}
2. Structured Facts (from Step 1): {step1FactsJson}
3. Raw Context (Full Data): {rawDataJson} // Use for deep tactical context if needed

[OUTPUT STRUCTURE]:
{
  "risk_analysis": "<Részletes kockázatelemzés. Térj ki a szimuláció és a tények (pl. hiányzók) közötti ellentmondásokra.>",
  "tactical_briefing": "<Részletes taktikai elemzés. Elemezd a várható kulcspárharcokat a tények és a statisztikák alapján.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés>\\nBizalom: [Alacsony/Közepes/Magas]",
    "goals_ou_analysis": "<Gól O/U elemzés (a {sim_mainTotalsLine} vonal alapján)>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet elemzés (a {mu_corners_sim} átlag alapján)>\\nBizalom: [Alacsony/Közepes/Magas]",
    "card_analysis": "<Lap elemzés (a {mu_cards_sim} átlag alapján)>\\nBizalom: [Alacsony/Közepes/Magas]"
  },
  "player_markets": "<Játékospiaci meglátások (1-3 mondat). Ha nincs, 'Nincs kiemelkedő játékospiaci lehetőség.'>",
  "general_analysis": "<Általános elemzés (2-3 bekezdés). Szintetizáld a statisztikai modellt (sim) és a taktikai képet (facts).>",
  "key_questions": "- Kulcskérdés 1 (pl. 'Hogyan pótolja a Hazai csapat X hiányzását?')\\n- Kulcskérdés 2..."
}
`;

// --- 3. LÉPÉS: STRATÉGA PROMPT ---
const PROMPT_STEP_3_STRATEGY = `
TASK: You are the Head Strategist. Your decision is final.
Review the analysis, the model's confidence, and the available value.
You MUST provide the single best recommendation.
NOTE: The Odds data is from a single source (Bet365), not a market consensus. Factor this into your confidence.

[DATA INPUTS]:
1. Full Analysis (from Step 2): {step2AnalysisJson}
2. Model Confidence Score: {modelConfidence}/10
3. Value Bets (Calculated): {valueBetsJson}
4. Confidence Calibration Map (Historical Accuracy): {calibrationMapJson}

[OUTPUT STRUCTURE]:
{
  "strategic_thoughts": "<Stratégiai zárógondolatok (2-3 bekezdés). Elemezd a legjobb fogadási szögeket (value vs. risk) a fő piacokon.>",
  "expert_confidence_report": "**<SCORE/10>** - Részletes indoklás. Vessd össze a {modelConfidence} statisztikai bizalmat az elemzési tényekkel (pl. hiányzók, piaci mozgás) és a historikus kalibrációval (Calibration Map).>",
  "master_recommendation": {
    "recommended_bet": "<A végső ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number 1.0-10.0>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás>"
  }
}
`;

// --- TÍPUSOK a bemeneti adatokhoz ---
// Ezeket az AnalysisFlow.ts-ből kapjuk
interface Step1Input {
  richContext: string;
  detailedPlayerStatsJson: ICanonicalPlayerStats;
  marketIntel: string;
}

interface Step2Input {
  simJson: any; // ISimResult interfész lenne az ideális
  step1FactsJson: any; // Step1 kimenete
  rawDataJson: ICanonicalRawData;
  sim_mainTotalsLine: number;
  mu_corners_sim: number;
  mu_cards_sim: number;
}

interface Step3Input {
  step2AnalysisJson: any; // Step2 kimenete
  modelConfidence: number;
  valueBetsJson: any[]; // IValueBet[] interfész lenne az ideális
  calibrationMapJson?: any; // Ezt a függvény adja hozzá
}


// --- HELPER a promptok kitöltéséhez --- (Változatlan, de típusosított)
function fillPromptTemplate(template: string, data: any): string {
    if (!template || typeof template !== 'string') return '';
    try {
        return template.replace(/\{([\w_]+)\}/g, (match, key) => {
            let value = data;
            // Közvetlen kulcs keresése az adat objektumban
            if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
                 value = data[key];
            } 
            // Speciális kezelés JSON stringekhez
            else if (key.endsWith('Json')) {
                const baseKey = key.replace('Json', '');
                if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                    try { return JSON.stringify(data[baseKey]); } 
                    catch (e: any) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; }
                } else { return '{}'; } // Üres JSON, ha nincs adat
            }
            // Ha a kulcs nincs meg sehol
            else { 
                 console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
                return "N/A";
            }

            // Érték formázása
            if (value === null || value === undefined) { return "N/A"; }
            if (typeof value === 'number' && !isNaN(value)) {
                // Százalékok, bizalmi pontszámok
                if (key.startsWith('sim_p') || key.endsWith('_pct') || key === 'modelConfidence' || key === 'expertConfScore') return value.toFixed(1);
                // Várható értékek (xG, GSAx)
                if (key.startsWith('mu_') || key.startsWith('sim_mu_') || key === 'home_gsax' || key === 'away_gsax') return value.toFixed(2);
                // Kosár statok
                if (key.startsWith('pace') || key.endsWith('Rating')) return value.toFixed(1);
                // Szöglet, lap átlag
                if (key.includes('corner') || key.includes('card')) return value.toFixed(1);
                // Módosítók
                if (key.endsWith('advantage') || key.endsWith('mod')) return value.toFixed(2);
                // Vonalak (Totals, Corners, Cards)
                if (key === 'line' || key === 'likelyLine' || key === 'sim_mainTotalsLine') return value.toString();
                // Stringként adjuk vissza
                return String(value); 
            }
             if (typeof value === 'object') {
                 // Objektumokat JSON stringgé alakítunk (ha nem Json kulcs volt eleve)
                 try { return JSON.stringify(value); } catch (e) { return "[object]"; }
             }
            // Minden más stringgé alakítva
            return String(value);
        });
    } catch(e: any) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
         return template; // Hiba esetén az eredeti sablont adjuk vissza
    }
}


// === v50: KONSZOLIDÁLT AI HÍVÓ (ELTÁVOLÍTVA) ===
// export async function getConsolidatedAnalysis(allData) { ... } // TÖRÖLVE

// === ÚJ, LÁNCOLT AI HÍVÓK (v51 / v52 TS) ===

/**
 * 1. LÉPÉS: Tények kinyerése
 */
export async function runStep1_GetFacts(data: Step1Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_1_FACTS, data);
        const jsonString = await _callGemini(filledPrompt);
        return JSON.parse(jsonString);
    } catch (e: any) {
        console.error(`AI Hiba (Step 1 - Facts): ${e.message}`);
        return { error: `AI Hiba (Step 1): ${e.message}` }; // Hiba objektum visszaadása
    }
}

/**
 * 2. LÉPÉS: Taktikai Elemzés
 */
export async function runStep2_GetAnalysis(data: Step2Input): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_2_ANALYSIS, data);
        const jsonString = await _callGemini(filledPrompt);
        return JSON.parse(jsonString);
    } catch (e: any) {
        console.error(`AI Hiba (Step 2 - Analysis): ${e.message}`);
        return { error: `AI Hiba (Step 2): ${e.message}` };
    }
}

/**
 * 3. LÉPÉS: Stratégiai Döntés
 */
export async function runStep3_GetStrategy(data: Step3Input): Promise<any> {
    try {
        // Kiegészítés a kalibrációs térképpel
        data.calibrationMapJson = getConfidenceCalibrationMap();
        
        const filledPrompt = fillPromptTemplate(PROMPT_STEP_3_STRATEGY, data);
        const jsonString = await _callGemini(filledPrompt);
        return JSON.parse(jsonString);
    } catch (e: any) {
        console.error(`AI Hiba (Step 3 - Strategy): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            strategic_thoughts: "AI Hiba",
            expert_confidence_report: "**1.0/10** - AI Hiba",
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0,
                brief_reasoning: `AI Hiba (Step 3): ${e.message}`
            }
        };
    }
}


// --- CHAT FUNKCIÓ --- (Változatlan, de típusosított)
interface ChatMessage {
  role: 'user' | 'model' | 'ai';
  parts: { text: string }[];
}

export async function getChatResponse(context: string, history: ChatMessage[], question: string): Promise<{ answer?: string; error?: string }> {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        // Előzmények formázása a prompt számára
        const historyString = (history || [])
            .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            .join('\n');
        // Prompt összeállítása
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
        
        // AI hívás (JSON kényszerítés nélkül)
        const rawAnswer = await _callGemini(prompt
             // Eltávolítjuk a JSON kényszerítő instrukciókat az alap _callGemini promptból
             .replace("Your entire response must be ONLY a single, valid JSON object.", "")
             .replace("Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.", "")
             .replace("Ensure the JSON is complete and well-formed.", "")
        );
        
        // Válasz tisztítása (eltávolítjuk az esetleges JSON körítést)
        let answerText = rawAnswer;
        try {
            // Megpróbáljuk parse-olni, hátha mégis JSON-t adott vissza
            const parsed = JSON.parse(rawAnswer);
            // Ha sikerült, keressük a szöveges választ benne
            answerText = parsed.answer || parsed.response || Object.values(parsed).find(v => typeof v === 'string') || rawAnswer;
        } catch (e) {
            // Ha nem JSON, csak a markdown tageket távolítjuk el
            answerText = rawAnswer.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        }

         // Visszaadjuk a választ, ha van
         return answerText ? { answer: answerText } : { error: "Az AI nem tudott válaszolni." };
    } catch (e: any) {
        console.error(`Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI hiba: ${e.message}` };
    }
}


// --- FŐ EXPORT --- (v51 - Frissítve a CoT lépésekre)
export default {
    runStep1_GetFacts,
    runStep2_GetAnalysis,
    runStep3_GetStrategy,
    getChatResponse
};