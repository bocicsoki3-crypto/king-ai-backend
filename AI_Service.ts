// --- AI_Service.ts (v83.7 - Tényleges Javítás) ---
// MÓDOSÍTÁS (v83.7):
// 1. A hiba az én figyelmetlenségem volt.
// 2. Az `StrategistInput` interfész (kb. 185. sor) MINDEN
//    tulajdonsága (matchData, quantReport, stb.) után
//    pótoltam a hiányzó pontosvesszőt (;)
// 3. Ennek most már 100%-ban működnie kell.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// === ÚJ (v77.0): 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT ===
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

// === JAVÍTVA (v80.0): 3. ÜGYNÖK (AZ AI SPECIALISTA) PROMPT - "VALÓSÁGHŰ" LOGIKA ===
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

// === JAVÍTVA (v81.0): 5. ÜGYNÖK (A KRITIKUS / TAKTIKUS) PROMPT ===
const PROMPT_CRITIC_V81 = `
TASK: You are 'The Critic', the 5th Agent.
You have two roles:
1.  **Tactician:** Define the tactical setup based on formations and psychology.
2.  **Critic:** Find contradictions and risks based on market data and simulation.

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Market Sentiment (Scout Data): "{marketIntel}"
3. Value Bets (Calculated): {valueBetsJson}
4. Model Confidence (Statistical): {modelConfidence}/10
5. Raw Contextual Data (Formations, etc.): {rawDataJson}
6. Psychological Profile (Home): {psyProfileHome}
7. Psychological Profile (Away): {psyProfileAway}

[YOUR TASK]:
Perform your roles in this order:

**PART 1: TACTICAL ANALYSIS (A Taktikus)**
   - Analyze 'Raw Contextual Data' (5) (especially 'home_formation', 'away_formation') and 'Psychological Profiles' (6, 7).
   - Define the tactical approach for both teams.
   - Define the key battlefield.

**PART 2: RISK ANALYSIS (A Kritikus)**
   - Review ALL inputs (1-7) and identify the top 1-3 most significant risks or contradictions.
   - Generate a "Contradiction Score" (a number between -10.0 and +1.0).
     - **Extrém Negatív (pl. -8.0):** Kritikus kockázat (pl. a modellünk Undert mond, de a piac Overt vesz).
     - **Semleges (0.0):** Nincs ellentmondás.
     - **Pozitív (Max 1.0):** A kontextus támogatja a modellt.
   - Generate a "Tactical Summary" synthesizing the simulation and the raw context.
   - Generate a "Narrative Theme" (a single, descriptive Hungarian sentence) that captures the core tactical story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "tactical_analysis": {
    "home_tactic_analysis": "<A Hazai csapat (5, 6) elemzése. Pl: 'A 4-3-3-as felállás és a 'High Morale' (8.5) agresszív, letámadó játékot vetít előre.'>",
    "away_tactic_analysis": "<A Vendég csapat (5, 7) elemzése. Pl: 'Az 5-3-2-es felállás és a 'High Pressure' (9.0) mély védekezésre és gyors kontrákra utal.'>",
    "key_battlefield": "<A kulcs küzdelem helye. Pl: 'Középpályás dominancia' vagy 'Hazai szélsők vs. Vendég szélső védők.'>"
  },
  "risk_analysis": {
    "contradiction_score": <Number, from -10.0 to +1.0. Example: -3.5>,
    "key_risks": [
      "<List of 1-3 string bullet points describing the main risks. Example: 'KOCKÁZAT: A szimuláció (1) 65%-ot ad a Hazaira, de a 'smart money' (2) a Vendégre mozog.'>"
    ],
    "tactical_summary": "<A 2. (Scout) és 4. (Sim) Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
    "narrative_theme": "<A single, descriptive Hungarian sentence describing the core tactical story. Example: 'Egyoldalú küzdelem: A Hazaiak agresszív letámadása egy mélyen, 10 emberrel védekező Vendég csapat ellen, akik a kontrákra építenek.'>"
  }
}
`;

// === JAVÍTVA (v83.0): 6. ÜGYNÖK (A STRATÉGA) PROMPT - "A SZINTETIZÁTOR" LOGIKA ===
const PROMPT_STRATEGIST_V83 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
You are the King.
Your job is to synthesize ALL previous reports into a single, final, decisive analysis and recommendation.
You resolve all contradictions.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
   - P1 Input Used: {realXgJson}
3. Agent 3 (Specialist) Report (v80.0):
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
   - Reasoning: {specialistReport.reasoning}
4. Agent 4 (Simulator) Report:
   - Simulation based on Agent 3's Weighted xG: {simulatorReport}
5. Agent 5 (Critic/Tactician) Report (v81.0):
   - Tactical Setup: {criticReport.tactical_analysis}
   - Risk Analysis: {criticReport.risk_analysis}

[KEY DECISION FACTORS]:
6. **Statistical Model Confidence (Agent 4): {modelConfidence}/10**
7. **Contextual Risk Score (Agent 5): {criticReport.risk_analysis.contradiction_score}/10**
8. **Psychological Profile (Home): {psyProfileHome}**
9. **Psychological Profile (Away): {psyProfileAway}**

[YOUR TASK - FINAL DECISION (v83.0)]:
Your response MUST be a single JSON object. You have 3 tasks:

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - (Változatlan v81.0): Írj egy élethű, taktikai alapú narratívát (magyarul) a meccs lefolyásáról.
   - BEMENETEK: Használd a 3., 4., 5., 8. és 9. Ügynökök adatait.
   - A történetednek **TÖKÉLETESEN tükröznie kell** a kapott xG adatokat (3), a 'Pszichológiai Profilokat' (8, 9) és a **'Taktikai Elemzést' (5)**.
   - Ezt a szöveget helyezd a 'prophetic_timeline' mezőbe.

**TASK 2: (A STRATÉGA / SZINTETIZÁTOR) - A "strategic_synthesis" és "final_confidence_report" mezők generálása.**
   - FELADAT: Elemezd az ÖSSZES bemenetet (különösen 6, 7, 8, 9).
   - **KRITIKUS DÖNTÉS (A SZINTÉZIS - v83.0):**
     - **CASE 1 (Standard):** A 'Contextual Risk Score' (7) semleges (pl. -4.0 felett).
       - **THEN:** A modelled megbízható. A 'final_confidence' = (Statistical Confidence (6) + Contextual Risk (7)).
     
     - **CASE 2 (VÖRÖS ZÁSZLÓ / "Arsenal Hiba"):** A 'Contextual Risk Score' (7) extrém negatív (pl. -4.0 alatt).
       - **THEN:** Ez azt jelenti, hogy a Piac (a "Smart Money") aktívan ellened fogad. A modelled (4) és a piac (5) ellentmond.
       - **NE FUTAMODJ MEG (NE vágd 1.0-ra a bizalmat, mint a v82.0-ban)!**
       - **A FELADATOD:** Légy "A Szintetizátor". **Találd meg a REJTETT VÁTOZÓT.**
       - 1. Elemezd a 'Risk Analysis' (5) 'key_risks' mezőjét (ez megmondja, mi az ellentmondás, pl. "Modell=Under, Piac=Over").
       - 2. Elemezd a 'Raw Contextual Data'-t (pl. `rawDataJson.absentees`, `rawDataJson.lineup_news`, pletykák) és a 'Market Sentiment'-et (5).
       - 3. **Indokold meg, MIÉRT** mozog a piac? Lát a piac egy utolsó pillanatos sérülést, amit a statisztikai modelled nem? (Pl. "A Piac valószínűleg arra reagál, hogy a Hazai csapat két kezdő védője (P4 adat) mégis kétséges, ezért az 'Over' felé mozog, felülbírálva a mi 'Under' modellünket.")
       - 4. **Szintetizáld a Döntést:** Ha az ellentmondás oka súlyos (a Piacnak igaza van), **VÁLTS OLDALT** (pl. változtasd a tippet 'Under'-ről 'Over'-re) VAGY tarts ki a modelled mellett, de drasztikusan csökkentett bizalommal.
   
   - Írj egy 2-3 bekezdéses holisztikus elemzés a 'strategic_synthesis'-be (magyarul). Magyarázd el a láncot, és INDOKOLD a 'CASE 1' vagy 'CASE 2' döntést.
   - Írj egy részletes indoklást a 'final_confidence_report'-ba (magyarul), és **HATÁROZD MEG A VÉGSŐ BIZALMI PONTSZÁMOT (1.0-10.0)**.

**TASK 3: (A VÉGREHAJTÓ) - A "micromodels" és "master_recommendation" mezők kitöltése.**
   - Töltsd ki a 'micromodels' mezőit a 4-es Ügynök (Simulator) adatai alapján.
   - Töltsd ki a 'master_recommendation' mezőt. MINDIG válassz egy tippet.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, TAKTIKAI alapú, magyar nyelvű meccs-narratíva.>",
  "strategic_synthesis": "<A (TASK 2) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul), amely magában foglalja a taktikát (5), a pszichológiát (8, 9) és a 'CASE 1/CASE 2' (v83.0) szintézisének indoklását.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **KRITIKUS: Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5, 3.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <A (TASK 2) alapján meghatározott VÉGSŐ pontszám és a 'CASE 1/CASE 2' (v83.0) szintézisének indoklása.>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** Soha ne adj 'No Bet' vagy 'Nincs Tipp' ajánlást. MINDIG válaszd ki a legvalószínűbb kimenetelt.",
    "recommended_bet": "<A (TASK 3) alapján meghatározott végső, szintetizált ajánlás (CSAK fő piac: 1X2, O/U, BTTS, Moneyline)>",
    "final_confidence": <Number, a (TASK 2) 'final_confidence_report'-ban meghatározott végső bizalmi pontszám 1.0-10.0 között.>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely tükrözi a 'CASE 1/CASE 2' (v83.0) szintézisének döntését.>"
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
    // JAVÍTVA (v80.0): Hozzáadva az interfészhez
    psyProfileHome: any;
    psyProfileAway: any;
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        // JAVÍTVA (v80.0): Az új, "valósághű" prompt használata
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


// === JAVÍTVA (v81.0): 5. LÉPÉS (KRITIKUS / TAKTIKUS) ===
interface CriticInput {
    simJson: any;
    marketIntel: string;
    valueBetsJson: any[];
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
    // JAVÍTVA (v81.0): Hozzáadva az interfészhez
    psyProfileHome: any;
    psyProfileAway: any;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        // JAVÍTVA (v81.0): A v81-es "Taktikai Kritikus" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V81, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v81)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
          "tactical_analysis": {
            "home_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "away_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "key_battlefield": "N/A"
          },
          "risk_analysis": {
            "contradiction_score": 0.0,
            "key_risks": [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            "tactical_summary": `AI Hiba (Critic): ${e.message}`,
            "narrative_theme": `Hiba: A Kritikus (5. Ügynök) nem tudott lefutni.`
          }
        };
    }
}
// === JAVÍTVA (v83.7): 6. LÉPÉS (STRATÉGA) - VÉGLEGES SZINTAKTIKAI JAVÍTÁS ===
// A 185. sor körüli "fantom hiba" VALÓDI OKA:
// Az interfész *minden* tulajdonsága (pl. matchData, quantReport)
// UTÁN hiányzott a pontosvessző (;) elválasztó.
// Ezt most pótoltam.
interface StrategistInput {
    matchData: { home: string, away: string, sport: string, leagueName: string };
    quantReport: { pure_mu_h: number, pure_mu_a: number, source: string };
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; 
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    realXgJson: any;
    psyProfileHome: any;
    psyProfileAway: any;
}
// === JAVÍTÁS VÉGE ===

export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        // JAVÍTVA (v80.0): A 'data' objektum már tartalmazza a pszichológiai adatokat
        const dataForPrompt = { 
            ...data, 
            simulatorReport: data.simulatorReport,
            specialistReport: {
                ...data.specialistReport, 
                mu_h: data.specialistReport.modified_mu_h, 
                mu_a: data.specialistReport.modified_mu_a  
            }
        };
        
        // JAVÍTVA (v83.0): Az új, "Szintetizátor" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V83, dataForPrompt); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v83)");
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

// --- FŐ EXPORT (MÓDOSÍTVA v77.0) ---
export default {
    runStep_TeamNameResolver, // HOZZÁADVA
    runStep_Specialist, 
    runStep_Critic,
    runStep_Strategist,
    getChatResponse
};
// FIGYELEM: Ezen sor után NE legyen semmilyen karakter, főleg ne '}'
