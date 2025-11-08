// --- AI_Service.ts (v70.0 - "Okos" Specialista) ---
// MÓDOSÍTÁS (v70.0):
// 1. HOZZÁADVA: Új 3. Ügynök (AI Specialista) a 'Model.ts' merev szabályainak leváltására.
// 2. HOZZÁADVA: PROMPT_SPECIALIST_V1 - Egy célzott prompt, ami az 1. Ügynök
//    (Quant) Tiszta xG-jét módosítja a 2. Ügynök (Scout) kontextusa alapján.
// 3. HOZZÁADVA: runStep_Specialist() - Az új aszinkron függvény az AI hívásához.
// 4. A v69.2-es "Prompt-Bleeding" javítások érvényben maradnak.

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

// === ÚJ (v70.0): 3. ÜGYNÖK (AZ AI SPECIALISTA) PROMPT ===
const PROMPT_SPECIALIST_V1 = `
TASK: You are 'The Specialist', the 3rd Agent in a 6-agent analysis chain.
Your job is to apply contextual modifiers (injuries, weather, morale) to a baseline statistical model.

[INPUTS]:
1. Baseline (Pure) xG (from Agent 1, Quant):
   - pure_mu_h: {pure_mu_h}
   - pure_mu_a: {pure_mu_a}
   - quant_source: "{quant_source}"

2. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   - (Includes: absentees, weather, tactics, morale)

[YOUR TASK - MODIFICATION & REASONING]:
1. Analyze the 'rawDataJson' (Agent 2) context. Identify the TOP 3-5 key qualitative factors that the 'pure_mu_h' and 'pure_mu_a' (Agent 1) statistical model DOES NOT account for.
2. Focus on injuries, confirmed absentees (P1 or P4), weather, pitch condition, morale, and match tension.
3. **CRITICAL:** Decide how these factors modify the baseline xG.
   - Example 1: "Hazai kulcs csatár (8.5 rating) hiányzik." -> Decrease 'pure_mu_h'.
   - Example 2: "Vendég kezdő kapus (8.2 rating) hiányzik." -> Increase 'pure_mu_h'.
   - Example 3: "Szakadó eső és 50 km/h szél." -> Decrease both 'pure_mu_h' and 'pure_mu_a'.
   - Example 4: "Vendég csapat 3 meccse nyert, hazai edző kirúgás szélén." -> Increase 'pure_mu_a', decrease 'pure_mu_h'.
4. **DO NOT** modify for factors already in the baseline. (If 'quant_source' is 'Manual (Components)', the model already knows the seasonal average xG, but it does NOT know about a *last-minute* injury).
5. Provide the FINAL 'modified_mu_h' and 'modified_mu_a' as numbers.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number, the final weighted xG for Home. Example: 1.35>,
  "modified_mu_a": <Number, the final weighted xG for Away. Example: 1.15>,
  "key_factors": [
    "<List of 3-5 string bullet points describing the qualitative factors you used. Example: 'A hazai csapat kulcsfontosságú támadója (Mané) hiányzik (P1 adat).'>",
    "<Example: 'A vendég csapat morálja kiváló (3 meccses győzelmi sorozat).'>",
    "<Example: 'Erős szél (35km/h) és eső várható, ami csökkenti a támadójáték hatékonyságát.'>"
  ],
  "reasoning": "<A concise, 1-2 sentence Hungarian explanation of HOW the key_factors led to the final modified xG numbers.>"
}
`;

// === MÓDOSÍTOTT (v69.0): 5. ÜGYNÖK (A KRITIKUS) PROMPT ===
// (Változatlan v70.0-ban)
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

// === MÓDOSÍTOTT (v69.2): 6. ÜGYNÖK (A STRATÉGA) PROMPT (JAVÍTVA) ===
// (Változatlan v70.0-ban)
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
Your response MUST be a single JSON object. You have 3 tasks:

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - FELADAT: Te vagy 'A Próféta', egy elit sport-történetmesélő.
   - BEMENETEK (Ezeket a fenti INPUTS részből vedd):
     1. Narratíva Téma (Ügynök 5): '{criticReport.narrative_theme}'
     2. Súlyozott xG (Ügynök 3): H={specialistReport.mu_h}, A={specialistReport.mu_a}
     3. Várható Lapok/Szögletek (Ügynök 4): {simulatorReport.mu_cards_sim} lap, {simulatorReport.mu_corners_sim} szöglet
   - UTASÍTÁSOK: Írj egy **élethű, részletes és magával ragadó narratívát** (magyarul) a meccs lefolyásáról, mintha már megtörtént volna. A történetednek **TÖKÉLETESEN tükröznie kell** a kapott xG adatokat és a narratív témát. Ne csak összefoglalj, hanem mesélj! Írd le a meccs hangulatát (a 'Téma' alapján). Írd le, hogyan születnek a gólok (az xG arányában). Fesd le a kulcspillanatokat (pl. egy piros lap a {simulatorReport.mu_cards_sim} alapján). A történetnek logikusan el kell vezetnie a legvalószínűbb végeredményhez (pl. 2-0, 1-1).
   - Ezt a szöveget helyezd a 'prophetic_timeline' mezőbe.

**TASK 2: (A STRATÉGA) - A "strategic_synthesis" és "final_confidence_report" mezők generálása.**
   - FELADAT: Elemezd a 6-os (Stat Bizalom) és 7-es (Kockázati Pontszám) bemeneteket.
   - Válassz a "PATH A" (Standard) vagy "PATH B" (Káosz Kiaknázása) közül.
     * **PATH A (Standard):** A 'Statistical Confidence' (6) megbízható, a 'Contextual Risk' (7) egy logikus módosító. (Pl. Stat: 7.0, Risk: -1.5 -> Végső Bizalom: 5.5/10).
     * **PATH B ("Kurva Jó" Override):** A 'Contextual Risk' (7) extrém (pl. -10.0), ami a 'Statistical Confidence'-t (6) IRRELEVÁNSSÁ teszi. Felismerted, hogy a kockázat (pl. 8 hiányzó) valójában egy *lehetőséget* teremt. Ebben az esetben **adj MAGAS bizalmat** (7.0-9.0/10) a tippenek, ami kiaknázza ezt a káoszt.
   - Írj egy 2-3 bekezdéses holisztikus elemzés a 'strategic_synthesis'-be (magyarul). Magyarázd el a láncot, kezeld a 'Critic's Risks'-t (5), és támasszad alá a Próféta (TASK 1) narratíváját.
   - Írj egy részletes indoklást a 'final_confidence_report'-ba (magyarul), és **HATÁROZD MEG A VÉGSŐ BIZALMI PONTSZÁMOT (1.0-10.0)**.

**TASK 3: (A VÉGREHAJTÓ) - A "micromodels" és "master_recommendation" mezők kitöltése.**
   - Töltsd ki a 'micromodels' mezőit a 4-es Ügynök (Simulator) adatai alapján.
   - Töltsd ki a 'master_recommendation' mezőt. MINDIG válassz egy tippet (1X2, O/U, BTTS). A 'final_confidence' mezőbe a TASK 2-ben meghatározott végső bizalmi pontszámot írd.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, magyar nyelvű meccs-narratíva, amely a BEMENETEKRE épül.>",
  
  "strategic_synthesis": "<A (TASK 2) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul). Magyarázza el a láncot, a 'PATH A/B' döntést, és támassza alá a Próféta narratíváját.>",
  
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <A (TASK 2) alapján meghatározott VÉGSŐ pontszám és a 'PATH A/B' indoklása.>",
  
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** Soha ne adj 'No Bet' vagy 'Nincs Tipp' ajánlást. MINDIG válaszd ki a legvalószínűbb kimenetelt a fő piacok (1X2, O/U, BTTS) közül, még akkor is, ha a bizalom alacsony. A bizalmat a 'final_confidence' mezőben tükrözd, ne az ajánlás hiányával.",
    "recommended_bet": "<A (TASK 3) alapján meghatározott végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number, a (TASK 2) 'final_confidence_report'-ban meghatározott végső bizalmi pontszám 1.0-10.0 között.>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a szintézist és a Kritikus (5) jelentésére adott választ>"
  }
}
`;
// === MÓDOSÍTÁS VÉGE ===

// === ÚJ (v70.0): 3. LÉPÉS (AI SPECIALISTA) ===
interface SpecialistInput {
    pure_mu_h: number;
    pure_mu_a: number;
    quant_source: string;
    rawDataJson: ICanonicalRawData;
    sport: string;
    psyProfileHome: any;
    psyProfileAway: any;
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V1, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist");
    } catch (e: any) {
        console.error(`AI Hiba (Specialist): ${e.message}`);
        // Kritikus hiba esetén visszatérünk a Tiszta xG-vel, hogy a lánc ne álljon le
        return {
            "modified_mu_h": data.pure_mu_h,
            "modified_mu_a": data.pure_mu_a,
            "key_factors": [`KRITIKUS HIBA: A 3. Ügynök (Specialista) nem tudott lefutni: ${e.message}`],
            "reasoning": "AI Hiba: A 3. Ügynök (Specialista) hibát dobott, a Súlyozott xG megegyezik a Tiszta xG-vel."
        };
    }
}


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
    // MÓDOSÍTÁS (v70.0): A specialistReport most már az AI Specialista teljes JSON objektuma
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; // Az 5. Ügynök (v69) kimenete (benne a narrative_theme)
    modelConfidence: number; // A Statisztikai bizalom (Quant)
    rawDataJson: ICanonicalRawData; // A teljes kontextus a biztonság kedvéért
    realXgJson: any; // A P1 tiszta xG
}
export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        // Biztosítjuk, hogy a simJson (a 4. Ügynök jelentése) a 'simulatorReport' kulcson legyen
        // és a specialistReport (a 3. Ügynök) mu_h/mu_a értékei is elérhetők legyenek
        const dataForPrompt = { 
            ...data, 
            simulatorReport: data.simulatorReport,
            // A 6. Ügynök promptjának {specialistReport.mu_h} hivatkozásaihoz
            specialistReport: {
                ...data.specialistReport, // Tartalmazza a 'reasoning'-et, 'key_factors'-t
                mu_h: data.specialistReport.modified_mu_h, // Átnevezés a prompt kompatibilitáshoz
                mu_a: data.specialistReport.modified_mu_a  // Átnevezés a prompt kompatibilitáshoz
            }
        };
        
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V69, dataForPrompt); // v69-es (javított v69.2) prompt használata
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

// --- FŐ EXPORT (MÓDOSÍTVA v70.0) ---
export default {
    runStep_Specialist, // HOZZÁADVA
    runStep_Critic,
    runStep_Strategist,
    getChatResponse
};