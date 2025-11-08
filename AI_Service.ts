// --- AI_Service.ts (v69.0 - Elit Narrátor) ---
// MÓDOSÍTÁS (v69.0):
// 1. A Kritikus (Ügynök 5) promptja (PROMPT_CRITIC_V69) kibővítve.
//    Most már kötelezően azonosítania kell a meccs "narratív témáját" (narrative_theme).
// 2. A Stratéga (Ügynök 6) promptja (PROMPT_STRATEGIST_V69) drasztikusan átírva.
// 3. A 'prophetic_timeline' (Próféta) már nem egy rövid összefoglaló, hanem
//    egy részletes, élethű narratíva generálását kéri, amely a 'narrative_theme'-re
//    és a részletes xG/lap/szöglet adatokra épül.
// 4. A 'strategic_synthesis' most már expliciten elvárja, hogy a Próféta
//    narratíváját támassza alá.

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


// === MÓDOSÍTOTT (v69.0): 5. ÜGYNÖK (A KRITIKUS) PROMPT ===
// Most már "narrative_theme"-et is generál.
const PROMPT_CRITIC_V69 = `
TASK: You are 'The Critic', the 5th Agent in a 6-agent analysis chain.
Your job is to find **CONTRADICTIONS** and **RISKS** and define the **NARRATIVE THEME** of the match.
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
4. **Generate a "Narrative Theme" (a single, descriptive sentence in Hungarian) that captures the core tactical story.** (e.g., "Agresszív hazai letámadás egy mélyen védekező, kontrára építő vendégcsapat ellen." or "Káosz meccs: Mindkét csapat kulcsfontosságú védői hiányoznak, nyílt, adok-kapok várható.")

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_score": <Number, from -10.0 to +10.0. Example: -3.5>,
  "key_risks": [
    "<List of 1-3 string bullet points describing the main risks. Example: 'KOCKÁZAT: A szimuláció (1) 65%-ot ad a Hazaira, de a 'smart money' (2) a Vendégre mozog.'>"
  ],
  "tactical_summary": "<A 2. (Scout) és 4. (Sim) Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
  "narrative_theme": "<A single, descriptive Hungarian sentence describing the core tactical story. Example: 'Egyoldalú küzdelem: A Hazaiak agresszív letámadása egy mélyen, 10 emberrel védekező Vendég csapat ellen, akik a kontrákra építenek.'>"
}
`;

// === MÓDOSÍTOTT (v69.0): 6. ÜGYNÖK (A STRATÉGA) PROMPT ===
// Most már a "narrative_theme"-re építi a "prophetic_timeline"-t.
const PROMPT_STRATEGIST_V69 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
You are the King.
Your job is to synthesize ALL previous reports into a single, final, decisive analysis and recommendation.
You resolve all contradictions.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
   - P1 Input Used: {realXgJson}
3. Agent 3 (Specialista) Report:
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report:
   - Simulation based on Agent 3's Weighted xG: {simulatorReport}
   - (Details: mu_corners: {simulatorReport.mu_corners_sim}, mu_cards: {simulatorReport.mu_cards_sim})
5. Agent 5 (Critic) Report (v69):
   - Narrative Theme: "{criticReport.narrative_theme}"
   - Risks Found: {criticReport.key_risks}
   - Tactical Summary: "{criticReport.tactical_summary}"
6. **Statistical Model Confidence (Agent 4): {modelConfidence}/10**
7. **Contextual Risk Score (Agent 5): {criticReport.contradiction_score}/10**

[YOUR TASK - FINAL DECISION]:
Your main task is to find the *smartest bet* (the 'sharp' bet) and **DECIDE the "Final Confidence Score"** (a number from 1.0 to 10.0).
Do not just average the two scores (6) and (7). High risk (e.g., Risk Score -10.0) does NOT automatically mean low confidence. 
**High risk can *create* a high-confidence opportunity if the market is wrong.**

Analyze the relationship between (6) and (7) and choose one of these two paths:

* **PATH A (Standard):** The 'Statistical Confidence' (6) is reliable and the 'Contextual Risk' (7) is a logical adjustment.
    * (Example: Stat is 7.0, Risk is -1.5 -> Final Confidence: 5.5/10).
    * (Example: Stat is 4.0, Risk is -9.0 -> Final Confidence: 1.5/10. The match is true chaos.)

* **PATH B (The "Kurva Jó" Override):** The 'Contextual Risk' (7) is EXTREME (e.g., -10.0 due to 10 missing players), which makes the 'Statistical Confidence' (6) IRRELEVANT.
    * You realize that the *reason* for the risk (e.g., 10 players missing) actually *creates* the best bet (e.g., "Under 2.5").
    * You see that the B-team players who *are* playing are underestimated, or the market hasn't reacted properly.
    * **In this case, assign a HIGH confidence score (e.g., 7.0/10, 8.0/10, or 9.0/10) to the tip that exploits this chaos.**

**You MUST choose a path and justify it.**

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<(A PRÓFÉTA) FELADAT: Te vagy 'A Próféta', egy elit sport-történetmesélő. BEMENETEK: 1. Narratíva Téma (Ügynök 5): '{criticReport.narrative_theme}'. 2. Súlyozott xG (Ügynök 3): H={specialistReport.mu_h}, A={specialistReport.mu_a}. 3. Várható Lapok/Szögletek (Ügynök 4): {simulatorReport.mu_cards_sim} lap, {simulatorReport.mu_corners_sim} szöglet. UTASÍTÁSOK: Írj egy **élethű, részletes és magával ragadó narratívát** (magyarul) a meccs lefolyásáról, mintha már megtörtént volna. A történetednek **TÖKÉLETESEN tükröznie kell** a kapott xG adatokat és a narratív témát. Ne csak összefoglalj, hanem mesélj! Írd le a meccs hangulatát (a 'Téma' alapján). Írd le, hogyan születnek a gólok (az xG arányában). Fesd le a kulcspillanatokat (pl. egy piros lap a {mu_cards_sim} alapján). A történetnek logikusan el kell vezetnie a legvalószínűbb végeredményhez (pl. 2-0, 1-1).>",
  
  "strategic_synthesis": "<Egy 2-3 bekezdéses holisztikus elemzés (magyarul). Magyarázd el a teljes láncot. **KRITIKUS: Kezeld a 'Critic's Risks'-t (5) és fejtsd ki a 'Próféta' (prophetic_timeline) által vázolt meccsképet!** Indokold meg, hogy a 'PATH A' vagy 'PATH B' mellett döntöttél.>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <**ELŐSZÖR HATÁROZD MEG A VÉGSŐ PONTOT (pl. 8.0/10)**, majd indokold meg. Vessd össze a {modelConfidence} (stat) bizalmat a {criticReport.contradiction_score} (kockázati pontszám) által jelzett tényezőkkel, és indokold meg, hogy a 'PATH A' vagy 'PATH B' mellett döntöttél.>",
  
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** Soha ne adj 'No Bet' vagy 'Nincs Tipp' ajánlást. MINDIG válaszd ki a legvalószínűbb kimenetelt a fő piacok (1X2, O/U, BTTS) közül, még akkor is, ha a bizalom alacsony. A bizalmat a 'final_confidence' mezőben tükrözd, ne az ajánlás hiányával.",
    "recommended_bet": "<A végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number, a végső bizalmi pontszám 1.0-10.0 között, amit te határoztál meg a 'final_confidence_report'-ban.>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a szintézist és a Kritikus (5) jelentésére adott választ>"
  }
}
`;
// === MÓDOSÍTÁS VÉGE ===


// === MÓDOSÍTOTT (v69.0): 5. LÉPÉS (KRITIKUS) ===
interface CriticInput {
    simJson: any;
    marketIntel: string;
    valueBetsJson: any[];
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V69, data); // v69-es prompt használata
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
            "contradiction_score": 0.0, // Semleges pontszám hiba esetén
            "key_risks": [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            "tactical_summary": `AI Hiba (Critic): ${e.message}`,
            "narrative_theme": `Hiba: A Kritikus (5. Ügynök) nem tudott lefutni.` // v69.0 Fallback
        };
    }
}

// === MÓDOSÍTOTT (v69.0): 6. LÉPÉS (STRATÉGA) ===
interface StrategistInput {
    matchData: { home: string, away: string, sport: string, leagueName: string };
    quantReport: { pure_mu_h: number, pure_mu_a: number, source: string };
    specialistReport: { mu_h: number, mu_a: number, log: any };
    simulatorReport: any;
    criticReport: any; // Az 5. Ügynök (v69) kimenete (benne a narrative_theme)
    modelConfidence: number; // A Statisztikai bizalom (Quant)
    rawDataJson: ICanonicalRawData; // A teljes kontextus a biztonság kedvéért
    realXgJson: any; // A P1 tiszta xG
}
export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        // Biztosítjuk, hogy a simJson (a 4. Ügynök jelentése) a 'simulatorReport' kulcson legyen
        const dataForPrompt = { ...data, simulatorReport: data.simulatorReport };
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V69, dataForPrompt); // v69-es prompt használata
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist");
    } catch (e: any) {
        console.error(`AI Hiba (Strategist): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap ajánlást
        return {
            prophetic_timeline: `AI Hiba (Strategist): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_synthesis: `AI Hiba (Strategist): ${e.message}`,
            micromodels: {},
            final_confidence_report: `**1.0/10** - AI Hiba (Strategist): ${e.message}`,
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0, // Hiba esetén 1.0
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
        
        const rawAnswer = await _callGemini(prompt, false); // forceJson = false
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