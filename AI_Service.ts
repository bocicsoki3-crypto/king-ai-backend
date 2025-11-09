// --- AI_Service.ts (v92.0 - "Jövőbelátó" Modell) ---
// MÓDOSÍTÁS (v92.0):
// 1. ELAVULT: PROMPT_CRITIC_V81 (piaci "value" alapú)
// 2. ÚJ: PROMPT_CRITIC_V92 ("Belső Koherencia" alapú, piacot ignorálja)
// 3. ELAVULT: PROMPT_STRATEGIST_V83 (piaci kockázatkezelő)
// 4. ÚJ: PROMPT_STRATEGIST_V92 ("Maximális Valószínűség" választó)
// 5. JAVÍTVA: A TS1005 szintaktikai hiba (StrategistInput interfész)

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// === ÚJ (v77.0): 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT ===
// ... (Változatlan a v83.5-ből) ...
const PROMPT_TEAM_RESOLVER_V1 = `
TASK: You are 'The Mapper', an expert sports data mapping assistant.
Your goal is to find the correct team ID for a misspelled or alternative team name.
[CONTEXT]:
- Input Name (from ESPN): "{inputName}"
- Search Term (Normalized): "{searchTerm}"
- Available Roster (from API Provider): {rosterJson}
[INSTRUCTIONS]:
1. Analyze the 'Available Roster' (JSON array of {id, name} objects).
2. Find the *single best match* for the 'Search Term'.
3. The match must be logically sound (e.g., "Cologne" matches "1. FC Köln", "Man Utd" matches "Manchester United").
4. If the 'Search Term' is "N/A" or empty, you must return null.
5. If no logical match is found in the roster, you must return null.
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "matched_id": <Number | null>
}
`;

// === JAVÍTVA (v80.0): 3. ÜGYNÖK (AZ AI SPECIALISTA) PROMPT ===
// ... (Változatlan a v83.5-ből) ...
const PROMPT_SPECIALIST_V80 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to apply contextual modifiers to a baseline statistical model.

[GUIDING PRINCIPLE - THE "REALISM" OATH]:
You MUST be **CONSERVATIVE and PROPORTIONAL**.
A statistical model (Agent 1) is robust. Do NOT modify the xG values significantly unless the contextual factors (Agent 2) are EXTREME.
- Minor factors (light rain, 1-2 average players out, minor morale dip) should result in minimal or ZERO change (e.g., +/- 0.05 xG).
- Significant factors (key player >8.0 rating out, heavy snow, extreme pressure) should be proportional.
- DO NOT overreact.

[INPUTS]:
1. Baseline (Pure) xG (from Agent 1, Quant):
   - pure_mu_h: {pure_mu_h}
   - pure_mu_a: {pure_mu_a}
   - quant_source: "{quant_source}"

2. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   - (Includes: absentees, weather, tactics, morale)

3. Psychological Profiles (from Model):
   - psyProfileHome: {psyProfileHome}
   - psyProfileAway: {psyProfileAway}

[YOUR TASK - MODIFICATION & REASONING]:
1. Analyze the 'rawDataJson' and 'Psychological Profiles'.
2. Identify the TOP 3-5 *TRULY SIGNIFICANT* qualitative factors.
3. **PROPORTIONAL MODIFICATION:**
   - Example 1: "Hazai kulcs csatár (8.5 rating) hiányzik." -> Decrease 'pure_mu_h' proportionally (e.g., -0.25 xG).
   - Example 2: "Vendég 2. számú csatár (6.8 rating) hiányzik." -> Minimal/Zero change (e.g., -0.05 xG).
   - Example 3: "Szakadó eső és 50 km/h szél." -> Decrease both 'pure_mu_h' and 'pure_mu_a' significantly (e.g., -0.30 xG each).
   - Example 4: "Vendég csapat 'High Pressure' (psyProfileAway.pressureIndex > 8)." -> Slightly decrease 'pure_mu_a' due to pressure.
4. Provide the FINAL 'modified_mu_h' and 'modified_mu_a' as numbers.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number, the final weighted xG for Home. Example: 1.35>,
  "modified_mu_a": <Number, the final weighted xG for Away. Example: 1.15>,
  "key_factors": [
    "<List of 3-5 string bullet points describing the SIGNIFICANT qualitative factors used.>"
  ],
  "reasoning": "<A concise, 1-2 sentence Hungarian explanation of HOW the key_factors led to the final (and proportional) modified xG numbers.>"
}
`;


// === ÚJ (v92.0): 5. ÜGYNÖK (A "JÖVŐBELÁTÓ" KRITIKUSA) PROMPT ===
// FELÜLBÍRJA: PROMPT_CRITIC_V81
// LOGIKA: Eltávolítva minden piaci "value" és "contradiction" elemzés.
// A cél a BELSŐ KOHERENCIA mérése.
const PROMPT_CRITIC_V92 = `
TASK: You are 'The Critic', the 5th Agent.
Your job is to determine the INTERNAL CONFIDENCE of the system, ignoring the market.

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Model Confidence (Statistical): {modelConfidence}/10
3. Raw Contextual Data (Agent 2 Output): {rawDataJson}
   (Includes: Formations, Absentees, Weather, Morale)
4. Psychological Profile (Home): {psyProfileHome}
5. Psychological Profile (Away): {psyProfileAway}

[YOUR TASK (v92.0 - "Maximum Confidence" Model)]:
**PIACI ADATOK (ODDS, MARKET INTEL, VALUE BETS) SZÁNDÉKOSAN IGNORÁLVA.**
Your goal is to find the INTERNAL COHERENCE (Belső Koherencia).

**1. Taktikai Elemzés (A Taktikus):**
   - Analyze 'Raw Contextual Data' (3) and 'Psychological Profiles' (4, 5).
   - Define the tactical approach for both teams.

**2. Belső Bizalom Elemzés (A Kritikus):**
   - Review ALL inputs (1-5).
   - Identify the TOP 1-3 most significant risks or confirmations *based ONLY on the internal data chain*.
   - **Generate an "Internal Confidence Score" (a number between 1.0 and 10.0).**
     - **Magas (pl. 9.5):** Tökéletes koherencia. A statisztika (1) és a kontextus (3) tökéletesen egyetért. (Pl. Statisztika=Over, Kontextus=Nincsenek védők, Morál=Magas).
     - **Közepes (pl. 6.0):** Enyhe eltérés. (Pl. Statisztika=Home, de a Hazai morál (3) alacsony).
     - **Alacsony (pl. 2.0):** Kritikus belső ellentmondás. (Pl. a Statisztikai modell (1) 3.5 xG-t ad (Over), de a kontextus (3) -10°C havazást és két parkoló buszt jelez (Under)).
   - Generate a "Narrative Theme" capturing the core tactical story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "tactical_analysis": {
    "home_tactic_analysis": "<A Hazai csapat (3, 4) elemzése. Pl: 'A 4-3-3-as felállás és a 'High Morale' (8.5) agresszív, letámadó játékot vetít előre.'>",
    "away_tactic_analysis": "<A Vendég csapat (3, 5) elemzése. Pl: 'Az 5-3-2-es felállás és a 'High Pressure' (9.0) mély védekezésre és gyors kontrákra utal.'>",
    "key_battlefield": "<A kulcs küzdelem helye. Pl: 'Középpályás dominancia'>"
  },
  "internal_coherence_report": {
    "internal_confidence_score": <Number, from 1.0 to 10.0. Example: 9.0>,
    "key_coherence_factors": [
      "<List of 1-3 string bullet points describing the internal coherence factors. Example: 'MEGERŐSÍTÉS: A Szimuláció (1) 85% BTTS-t ad, amit a kontextus (3) (mindkét csapat 4-3-3, kulcs védők hiányoznak) erősen támogat.'>"
    ],
    "tactical_summary": "<A 2. (Scout) és 4. (Sim) Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
    "narrative_theme": "<A single, descriptive Hungarian sentence describing the core tactical story. Example: 'Nyílt sisakos küzdelem várható, ahol a statisztika és a hiányzók is gólzáport jósolnak.'>"
  }
}
`;

// === ÚJ (v92.0): 6. ÜGYNÖK (A "MAXIMUM CONFIDENCE" STRATÉGA) PROMPT ===
// FELÜLBÍRJA: PROMPT_STRATEGIST_V83
// LOGIKA: Eltávolítva minden piaci kockázatkezelés ("CASE 2", "Contradiction Score").
// A cél a legmagasabb valószínűségű kimenet kiválasztása.
const PROMPT_STRATEGIST_V92 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
Your job is to synthesize ALL previous reports into a single, final, decisive recommendation.
**Your goal (v92.0): Find the single MOST PROBABLE outcome, ignoring market price.**

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
3. Agent 3 (Specialist) Report:
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report (FULL PROBABILITIES): {simulatorReport}
   (P(Home), P(Draw), P(Away), pBTTS, pOver/Under(0.5..4.5), etc.)
5. Agent 5 (Critic/Tactician) Report (v92.0):
   - Tactical Setup: {criticReport.tactical_analysis}
   - **Internal Coherence Report: {criticReport.internal_coherence_report}**

[KEY DECISION FACTORS]:
6. **Internal Confidence Score (Agent 5): {criticReport.internal_coherence_report.internal_confidence_score}/10**
7. Psychological Profile (Home): {psyProfileHome}
8. Psychological Profile (Away): {psyProfileAway}

[YOUR TASK - FINAL DECISION (v92.0)]:
Your response MUST be a single JSON object.

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - Írj egy élethű, taktikai alapú narratívát (magyarul) a meccs lefolyásáról.
   - BEMENETEK: Használd a 3., 4., 5., 7. és 8. Ügynökök adatait.
   - A történetednek **TÖKÉLETESEN tükröznie kell** a kapott xG adatokat (3), a 'Pszichológiai Profilokat' (7, 8) és a **'Taktikai Elemzést' (5)**.

**TASK 2: (A STRATÉGA / JÖVŐBELÁTÓ) - A "strategic_synthesis" és "final_confidence_report" mezők generálása.**
   - FELADAT: Elemezd az ÖSSZES bemenetet (különösen 4, 5, 6, 7, 8).
   - **KRITIKUS DÖNTÉS (A "Jövőbelátó" - v92.0):**
     - 1. Vizsgáld meg a 4. Ügynök (Simulator) teljes valószínűségi listáját ({simulatorReport}).
     - 2. **Válaszd ki a legmagasabb százalékos valószínűséggel rendelkező kimenetelt** a fő piacok közül (1X2, O/U 2.5, BTTS).
     - 3. A 'final_confidence' PONTOSAN egyenlő az 5. Ügynök 'internal_confidence_score'-jával (6). A piacot ignoráljuk.
   
   - Írj egy 2-3 bekezdéses holisztikus elemzést a 'strategic_synthesis'-be (magyarul). Magyarázd el a láncot, és INDOKOLD, miért a kiválasztott kimenetel a legvalószínűbb.
   - Írj egy részletes indoklást a 'final_confidence_report'-ba (magyarul), amely az 5. Ügynök 'internal_coherence_factors' mezőjére (5) épül.

**TASK 3: (A VÉGREHAJTÓ) - A "micromodels" és "master_recommendation" mezők kitöltése.**
   - Töltsd ki a 'micromodels' mezőit a 4-es Ügynök (Simulator) adatai alapján.
   - Töltsd ki a 'master_recommendation' mezőt a (TASK 2) döntése alapján.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, TAKTIKAI alapú, magyar nyelvű meccs-narratíva.>",
  "strategic_synthesis": "<A (TASK 2) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul), amely a taktikát (5) és a pszichológiát (7, 8) szintetizálja.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <Az 5. Ügynök 'internal_confidence_score'-ja (5) és a (TASK 2) döntése alapján.>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** Soha ne adj 'No Bet' vagy 'Nincs Tipp' ajánlást. MINDIG válaszd ki a (TASK 2) alapján meghatározott legvalószínűbb kimenetelt.",
    "recommended_bet": "<A (TASK 2) alapján meghatározott, legmagasabb valószínűségű kimenetel (CSAK fő piac: 1X2, O/U, BTTS)>",
    "final_confidence": <Number, az 5. Ügynök 'internal_confidence_score'-ja (5) alapján (1.0-10.0).>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely a belső koherenciára (5) épül.>"
  }
}
`;

// === ÚJ (v77.0): 8. LÉPÉS (AI TÉRKÉPÉSZ) ===
interface TeamNameResolverInput {
    inputName: string;
    searchTerm: string;
    rosterJson: any[]; // Lista a {id, name} objektumokból
}
export async function runStep_TeamNameResolver(data: TeamNameResolverInput): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        
        if (result && result.matched_id) {
            const foundId = Number(result.matched_id);
            const matchedTeam = data.rosterJson.find(t => t.id === foundId);
            console.log(`[AI_Service - Térképész] SIKER: Az AI a "${data.searchTerm}" nevet ehhez a csapathoz rendelte: "${matchedTeam?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI_Service - Térképész] HIBA: Az AI nem talált egyezést (matched_id: null) a "${data.searchTerm}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service - Térképész] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}


// === JAVÍTVA (v80.0): 3. LÉPÉS (AI SPECIALISTA) ===
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
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V80, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v80)");
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


// === JAVÍTVA (v92.0): 5. LÉPÉS (KRITIKUS / JÖVŐBELÁTÓ) ===
interface CriticInput {
    simJson: any;
    // TÖRÖLVE (v92.0): marketIntel: string;
    // TÖRÖLVE (v92.0): valueBetsJson: any[];
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
    psyProfileHome: any;
    psyProfileAway: any;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        // JAVÍTVA (v92.0): Az új, "Belső Koherencia" (piacot ignoráló) prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V92, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v92)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
          "tactical_analysis": {
            "home_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "away_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "key_battlefield": "N/A"
          },
          "internal_coherence_report": {
            "internal_confidence_score": 1.0, // HIBA esetén a bizalom 1.0
            "key_coherence_factors": [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            "tactical_summary": `AI Hiba (Critic): ${e.message}`,
            "narrative_theme": `Hiba: A Kritikus (5. Ügynök) nem tudott lefutni.`
          }
        };
    }
} // <-- Biztosítva a helyes lezárás (v83.5 javítás)

// === JAVÍTVA (v83.5): 6. LÉPÉS (STRATÉGA) - Szintaktikai javítás ===
interface StrategistInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; }; // <-- JAVÍTVA (;)
    quantReport: { pure_mu_h: number; pure_mu_a: number; source: string; }; // <-- JAVÍTVA (;)
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; // Ez most már a v92-es Critic riportot fogja tartalmazni
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    realXgJson: any;
    psyProfileHome: any;
    psyProfileAway: any;
}
// === JAVÍTÁS VÉGE ===

// === JAVÍTVA (v92.0): 6. LÉPÉS (STRATÉGA) - "Maximum Confidence" Logika ===
export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        const dataForPrompt = { 
            ...data, 
            simulatorReport: data.simulatorReport,
            specialistReport: {
                ...data.specialistReport, 
                mu_h: data.specialistReport.modified_mu_h, 
                mu_a: data.specialistReport.modified_mu_a  
            }
            // A 'criticReport' most már a v92-es ('internal_coherence_report')
        };
        
        // JAVÍTVA (v92.0): Az új, "Maximális Valószínűség" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V92, dataForPrompt); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v92)");
    } catch (e: any) {
        console.error(`AI Hiba (Strategist): ${e.message}`);
        return {
            prophetic_timeline: `AI Hiba (Strategist): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_synthesis: `AI Hiba (Strategist): ${e.message}`,
            micromodels: {},
            final_confidence_report: `**1.0/10** - AI Hiba (Strategist): ${e.message}`,
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
        
        const rawAnswer = await _callGemini(prompt, false); // forceJson = false
        return rawAnswer ? { answer: rawAnswer } : { error: "Az AI nem tudott válaszolni." };
    } catch (e: any) {
        console.error(`Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT (MÓDOSÍTVA v92.0) ---
export default {
    runStep_TeamNameResolver,
    runStep_Specialist, 
    runStep_Critic, // Most már a v92-es Critic-re mutat
    runStep_Strategist, // Most már a v92-es Strategist-re mutat
    getChatResponse
};
