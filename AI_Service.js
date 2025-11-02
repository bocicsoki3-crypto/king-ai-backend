// --- JAVÍTOTT AI_service.js (v50 - Konszolidált Architektúra) ---

/**
 * AI_Service.js (Node.js Verzió)
 * VÁLTOZÁS (v50): Az összes egyedi AI funkció (getTacticalBriefing, getRiskAssessment,
 * getPropheticScenario, getMasterRecommendation stb.) ELTÁVOLÍTVA.
 * Helyettük egyetlen, konszolidált 'getConsolidatedAnalysis' funkció lép
 * egy robusztus, magas kontextusú prompttal.
 * OK: A 'Prófétai Forgatókönyv' (propheticScenario) modul logikai hiba
 * (Math.random alapú spekuláció) miatt végleg eltávolítva.
 * OK: A mesterséges korlátozások ("2-4 mondat") eltávolítva a mélyebb elemzés érdekében.
 */
import { _callGemini } from './DataFetch.js';
import { getConfidenceCalibrationMap } from './LearningService.js';
import { SPORT_CONFIG } from './config.js';

// --- v50: ÚJ KONSZOLIDÁLT PROMPT ---
const CONSOLIDATED_ANALYSIS_PROMPT = `
CRITICAL TASK: You are the Head Analyst.
Analyze ALL provided raw data and generate a complete, multi-faceted tactical report in Hungarian.
[DATA INPUTS]:
1. Simulation (Sim): {simJson}
2. Value Bets: {valueBetsJson}
3. Model Confidence: {modelConfidence}/10
4. Raw Context (News, H2H, Form, Absentees): {richContext}
5. Tactical/Player Data: {rawDataJson}
6. Market Intel: "{marketIntel}"

[CRITICAL OUTPUT INSTRUCTION]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
Provide deep, comprehensive analysis for each text field (do not use "2-4 sentences max").
{
  "risk_analysis": "<Részletes kockázatelemzői jelentés. Térj ki a piaci anomáliákra, formai ellentmondásokra, a szimuláció gyengeségeire és a lehetséges meglepetés kimenetelekre.>",
  "tactical_briefing": "<Részletes taktikai elemzés. Elemezd a várható kulcspárharcokat, a labdabirtoklási dinamikát, a kontratámadási potenciált és a formációk várható ütközését.>",
  "expert_confidence_report": "**<SCORE/10>** - Részletes indoklás, amely figyelembe veszi a kontextuális tényezőket (hírek, piaci mozgás) a statisztikai modell bizalmával szemben.>",
  "key_questions": "- Kulcskérdés 1...\\n- Kulcskérdés 2...",
  "player_markets": "<Játékospiaci meglátások (1-3 mondat). Ha nincs, 'Nincs kiemelkedő játékospiaci lehetőség.'>",
  "general_analysis": "<Általános elemzés (2-3 bekezdés). Szintetizáld a statisztikai modellt (várható eredmény, valószínűségek) és a taktikai képet.>",
  "strategic_thoughts": "<Stratégiai zárógondolatok (2-3 bekezdés). Elemezd a legjobb fogadási szögeket (value vs. risk) a fő piacokon (1X2, O/U, BTTS).>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés>\\nBizalom: [Alacsony/Közepes/Magas]",
    "goals_ou_analysis": "<Gól O/U elemzés (a {sim_mainTotalsLine} vonal alapján)>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet elemzés (a {mu_corners_sim} átlag alapján)>\\nBizalom: [Alacsony/Közepes/Magas]",
    "card_analysis": "<Lap elemzés (a {mu_cards_sim} átlag alapján)>\\nBizalom: [Alacsony/Közepes/Magas]"
  },
  "master_recommendation": {
    "recommended_bet": "<A végső ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number 1.0-10.0>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás>"
  }
}
`;

// --- HELPER a promptok kitöltéséhez --- (Változatlan)
function fillPromptTemplate(template, data) {
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
                   catch (e) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; }
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
                return value;
                // Egyéb számok változatlanul
            }
             if (typeof value === 'object') {
                 // Objektumokat JSON stringgé alakítunk (ha nem Json kulcs volt eleve)
                 try { return JSON.stringify(value); } catch (e) { return "[object]"; }
             }
            // Minden más stringgé alakítva
            return String(value);
        });
    } catch(e) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
         return template; // Hiba esetén az eredeti sablont adjuk vissza
    }
}


// === v50: ÚJ KONSZOLIDÁLT AI HÍVÓ ===
/**
 * Egyetlen AI hívást indít, amely legenerálja a teljes elemzési riportot.
 * @param {object} allData - Az összes adat (sim, valueBets, richContext, rawData, marketIntel).
 * @returns {Promise<object>} A teljes, strukturált JSON elemzési riport.
 */
export async function getConsolidatedAnalysis(allData) {
    let attempts = 0;
    const retries = 1; // 1 újrapróbálkozás hiba esetén

    while (attempts <= retries) {
        try {
            const filledPrompt = fillPromptTemplate(CONSOLIDATED_ANALYSIS_PROMPT, allData);
            const jsonString = await _callGemini(filledPrompt);
            const result = JSON.parse(jsonString);

            // Alapvető struktúra validálása
            if (result && result.master_recommendation && result.tactical_briefing && result.micromodels) {
                return result; // SIKER
            }
            console.error(`AI Hiba: A konszolidált válasz JSON nem tartalmazta a várt kulcsokat. Válasz:`, jsonString.substring(0, 500));
            throw new Error("AI Hiba: A konszolidált válasz JSON hiányos struktúrájú.");
        
        } catch (e) {
            attempts++;
            console.warn(`AI Hiba a konszolidált elemzés feldolgozásakor (Próba: ${attempts}/${retries + 1}): ${e.message}`);
            if (attempts > retries) {
                console.error(`Végleges AI Hiba (getConsolidatedAnalysis) ${attempts} próbálkozás után.`);
                const errorDetails = (e instanceof SyntaxError && e.message.includes('JSON')) ?
                    ` Invalid JSON received.` : e.message;
                // Visszaadunk egy HIBÁS objektumot, hogy a flow kezelni tudja
                return {
                    "risk_analysis": `AI Hiba: ${errorDetails}`,
                    "tactical_briefing": "AI Hiba",
                    "expert_confidence_report": "**1.0/10** - AI Hiba",
                    "key_questions": "- AI Hiba",
                    "player_markets": "AI Hiba",
                    "general_analysis": "AI Hiba",
                    "strategic_thoughts": "AI Hiba",
                    "micromodels": {},
                    "master_recommendation": {
                        "recommended_bet": "Hiba",
                        "final_confidence": 1.0,
                        "brief_reasoning": `AI Hiba: ${errorDetails}`
                    }
                };
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts)); // Várakozás
        }
    }
}


// --- CHAT FUNKCIÓ --- (Változatlan)
export async function getChatResponse(context, history, question) {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        // Előzmények formázása a prompt számára
        const historyString = (history || [])
            .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            .join('\n');
        // Prompt összeállítása
        const prompt = `You are an elite sports analyst AI assistant specialized in the provided match analysis.
CONTEXT of the analysis:
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
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI hiba: ${e.message}` };
    }
}


// --- FŐ EXPORT --- (v50 - Frissítve)
export default {
    getConsolidatedAnalysis,
    getChatResponse
};