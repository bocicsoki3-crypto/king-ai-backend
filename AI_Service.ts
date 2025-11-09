// --- AI_Service.ts (v94.0 - "Önjavító Hurok") ---
// MÓDOSÍTÁS (v94.0):
// 1. MÓDOSÍTVA: A 3-as, 5-ös és 6-os Ügynökök (Specialista, Kritikus, Stratéga)
//    promptjai (v94.0) most már fogadják a `homeNarrativeRating` és
//    `awayNarrativeRating` bemeneteket.
// 2. LOGIKA: Az AI ügynökök most már explicit parancsot kapnak, hogy vegyék
//    figyelembe a 7. Ügynök (Revizor) múltbeli tanulságait az elemzés során.
// 3. MÓDOSÍTVA: Az összes érintett TypeScript `interface` (SpecialistInput,
//    CriticInput, StrategistInput) frissítve az új mezők fogadására.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT (Változatlan) ===
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

// === 2.5-ös ÜGYNÖK (A PSZICHOLÓGUS) PROMPT (Változatlan v93.0) ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze the narrative, morale, and situational pressure of a match,
based *only* on the raw data provided by Agent 2 (The Scout).

[INPUTS]:
1. Home Team Name: "{homeTeamName}"
2. Away Team Name: "{awayTeamName}"
3. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   (Includes: H2H history, form strings, absentees, league name, match tension index)

[YOUR TASK - NARRATIVE PROFILE]:
Analyze the 'Full Raw Context'. Do not hallucinate, but infer logical narrative context.
1.  **Form/Morale:** Look at the 'form.home_overall' and 'form.away_overall'. Is a team desperate (e.g., "LLLDL") or confident (e.g., "WWWWL")?
2.  **Pressure/Tension:** Look at 'contextual_factors.match_tension_index'. Is this a "high" pressure (e.g., derby, relegation, title) match?
3.  **H2H:** Look at 'h2h_structured'. Is there a history of dominance or a "revenge" narrative?
4.  **Squad:** Look at 'absentees'. Is a team missing its core (high morale impact) or just fringe players?

Synthesize these factors into two concise, 1-2 sentence Hungarian summaries.
Focus on the *psychological impact* (morale, pressure, confidence, desperation).

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "psy_profile_home": "<1-2 mondatos magyar nyelvű pszichológiai profil a HAZAI ({homeTeamName}) csapatról. Pl. 'A hazai csapat (WWLWW) magabiztosan érkezik, de a 'high' tenzió (bajnoki döntő) miatt a nyomás is óriási.'>",
  "psy_profile_away": "<1-2 mondatos magyar nyelvű pszichológiai profil a VENDÉG ({awayTeamName}) csapatról. Pl. 'A vendégek (LLDLW) morálja a béka alatt van, és a 3 kulcsjátékos hiánya (absentees) tovább rontja a kilátásaikat, valószínűleg a védekezésre fókuszálnak.'>"
}
`;

// === MÓDOSÍTVA (v94.0): 3. ÜGYNÖK (AZ AI SPECIALISTA) PROMPT ===
// Ez a prompt most már fogadja a 'homeNarrativeRating'-et (a 7. Ügynök tanulságait)
const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to apply contextual modifiers to a baseline statistical model.

[GUIDING PRINCIPLE - THE "REALISM" OATH]:
You MUST be **CONSERVATIVE and PROPORTIONAL**.
A statistical model (Agent 1) is robust. Do NOT modify the xG values significantly unless the contextual factors (Agent 2) are EXTREME.

[INPUTS]:
1. Baseline (Pure) xG (from Agent 1, Quant):
   - pure_mu_h: {pure_mu_h}
   - pure_mu_a: {pure_mu_a}
   - quant_source: "{quant_source}"

2. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   (Includes: absentees, weather, tactics, morale)

3. Narrative Psychological Profiles (from Agent 2.5, Psychologist):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"

4. **Self-Learned Insights (from Agent 7, Auditor's past findings):**
   - home_narrative_ratings: {homeNarrativeRating}
   - away_narrative_ratings: {awayNarrativeRating}

[YOUR TASK - MODIFICATION & REASONING]:
1. Analyze the 'rawDataJson' (2) and 'Psychological Profiles' (3).
2. **Crucially, check the 'Self-Learned Insights' (4).** These are PAST mistakes.
   - Example: If 'home_narrative_ratings' contains '{"pressure_handling": -0.3}' and the 'psy_profile_home' (3) says "high pressure match", you MUST apply a negative modifier to 'pure_mu_h'.
   - Example: If 'away_narrative_ratings' contains '{"rain_performance": 0.2}' and 'rawDataJson' (2) shows 'weather: "Rain"', you should apply a *positive* modifier to 'pure_mu_a'.
3. Identify the TOP 3-5 *TRULY SIGNIFICANT* qualitative factors (combining 2, 3, and 4).
4. **PROPORTIONAL MODIFICATION:** Apply proportional changes based on all inputs.
5. Provide the FINAL 'modified_mu_h' and 'modified_mu_a' as numbers.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number, the final weighted xG for Home. Example: 1.35>,
  "modified_mu_a": <Number, the final weighted xG for Away. Example: 1.15>,
  "key_factors": [
    "<List of 3-5 string bullet points describing the SIGNIFICANT qualitative factors used, INCLUDING any self-learned insights from (4).>"
  ],
  "reasoning": "<A concise, 1-2 sentence Hungarian explanation of HOW the key_factors (especially 3 and 4) led to the final modified xG numbers.>"
}
`;


// === MÓDOSÍTVA (v94.0): 5. ÜGYNÖK (A "PIAC-TUDATOS" KRITIKUS) PROMPT ===
// Ez a prompt most már fogadja a 'homeNarrativeRating'-et (a 7. Ügynök tanulságait)
const PROMPT_CRITIC_V94 = `
TASK: You are 'The Critic', the 5th Agent.
Your job is to determine the FINAL CONFIDENCE of the system by analyzing
internal coherence and external market contradictions.

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Model Confidence (Statistical): {modelConfidence}/10
3. Raw Contextual Data (Agent 2 Output): {rawDataJson}
   (Includes: Formations, Absentees, Weather)
4. Narrative Psychological Profiles (Agent 2.5 Output):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
5. Market Intel (Line Movement Analysis): "{marketIntel}"
6. **Self-Learned Insights (from Agent 7, Auditor's past findings):**
   - home_narrative_ratings: {homeNarrativeRating}
   - away_narrative_ratings: {awayNarrativeRating}

[YOUR TASK (v94.0 - "Self-Learning" Model)]:
Your goal is to find the FINAL, REALISTIC confidence score.

**1. Taktikai Elemzés (A Taktikus):**
   - Analyze 'Raw Contextual Data' (3) and 'Psychological Profiles' (4).
   - Define the tactical approach for both teams.

**2. Kockázat Elemzés (A Kritikus):**
   - Review ALL inputs (1-6).
   - **Internal Coherence (Belső Koherencia):** Does the simulation (1) align with the context (3, 4) AND the past learnings (6)?
     - (Pl. Sim=Over, Context=Két támadó csapat -> Magas koherencia)
     - (Pl. Sim=Home, de a Pszichológus (4) 'low_morale'-t és a Tanulságok (6) 'pressure_handling: -0.4'-et jelez -> **Alacsony koherencia**)
   - **External Contradiction (Külső Ellentmondás - VÖRÖS ZÁSZLÓ):**
     - Does our simulation (1) contradict the "Smart Money" (5)?
     - (Pl. Sim=70% Home, de a 'Market Intel' azt mondja: "Jelentős odds-növekedés... a piac a favorit ellen mozog." -> **VÖRÖS ZÁSZLÓ!**)
   - **Generate a "Final Confidence Score" (a number between 1.0 and 10.0).**
     - **Magas (pl. 9.5):** Tökéletes belső koherencia (1+3+4+6) ÉS a piac (5) egyetért.
     - **Alacsony (pl. 2.0):** Kritikus belső ellentmondás (Sim vs Taktika/Tanulságok) VAGY egy "VÖRÖS ZÁSZLÓ" (Sim vs Piac).
   - Generate a "Narrative Theme" capturing the core tactical story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "tactical_analysis": {
    "home_tactic_analysis": "<A Hazai csapat (3, 4) elemzése. Pl: 'A 4-3-3-as felállás és a 'magabiztos' profil (4) agresszív letámadást vetít előre.'>",
    "away_tactic_analysis": "<A Vendég csapat (3, 4) elemzése. Pl: 'Az 5-3-2-es felállás és a 'morál a béka alatt' profil (4) mély védekezésre utal.'>",
    "key_battlefield": "<A kulcs küzdelem helye. Pl: 'Középpályás dominancia'>"
  },
  "final_confidence_report": {
    "final_confidence_score": <Number, from 1.0 to 10.0. Example: 9.0>,
    "key_risk_factors": [
      "<List of 1-3 string bullet points describing the key internal/external factors (INCLUDING 5 and 6). Example: 'VÖRÖS ZÁSZLÓ: A Piac (5) erősen a Hazai ellen mozog. Ez, párosulva a múltbeli tanulsággal (6) ('pressure_handling: -0.4'), drasztikusan csökkenti a bizalmat.'>"
    ],
    "tactical_summary": "<A 2., 2.5, 4. és 6. Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
    "narrative_theme": "<A single, descriptive Hungarian sentence describing the core tactical story. Example: 'Nyílt sisakos küzdelem várható, ahol a statisztika és a hiányzók is gólzáport jósolnak.'>"
  }
}
`;

// === MÓDOSÍTVA (v94.0): 6. ÜGYNÖK (A "PIAC-TUDATOS" STRATÉGA) PROMPT ===
// Ez a prompt most már fogadja a 'homeNarrativeRating'-et (a 7. Ügynök tanulságait)
const PROMPT_STRATEGIST_V94 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
Your job is to synthesize ALL previous reports into a single, final, decisive recommendation.
**Your goal (v94.0): Find the single MOST PROBABLE outcome, using the Market-Aware, Self-Learned Confidence.**

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 1 (Quant) Report:
   - "Pure xG": H={quantReport.pure_mu_h}, A={quantReport.pure_mu_a}
3. Agent 3 (Specialist) Report (v94):
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
4. Agent 4 (Simulator) Report (FULL PROBABILITIES): {simulatorReport}
   (P(Home), P(Draw), P(Away), pBTTS, pOver/Under(0.5..4.5), etc.)
5. Agent 5 (Critic/Tactician) Report (v94):
   - Tactical Setup: {criticReport.tactical_analysis}
   - **Market-Aware Confidence Report: {criticReport.final_confidence_report}**

[KEY DECISION FACTORS]:
6. **Final Confidence Score (Agent 5): {criticReport.final_confidence_report.final_confidence_score}/10**
7. Narrative Psychological Profiles (Agent 2.5):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
8. **Self-Learned Insights (from Agent 7, Auditor's past findings):**
   - home_narrative_ratings: {homeNarrativeRating}
   - away_narrative_ratings: {awayNarrativeRating}

[YOUR TASK - FINAL DECISION (v94.0)]:
Your response MUST be a single JSON object.

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - Írj egy élethű, taktikai alapú narratívát (magyarul) a meccs lefolyásáról.
   - BEMENETEK: Használd a 3., 4., 5., 7. és 8. bemeneteket.
   - A történetednek **TÖKÉLETESEN tükröznie kell** a kapott xG adatokat (3), a 'Pszichológiai Profilokat' (7), a 'Taktikai Elemzést' (5) és a 'Múltbeli Tanulságokat' (8).

**TASK 2: (A STRATÉGA / JÖVŐBELÁTÓ) - A "strategic_synthesis" és "final_confidence_report" mezők generálása.**
   - FELADAT: Elemezd az ÖSSZES bemenetet (különösen 4, 5, 6, 7, 8).
   - **KRITIKUS DÖNTÉS (A "Jövőbelátó" - v94.0):**
     - 1. Vizsgáld meg a 4. Ügynök (Simulator) teljes valószínűségi listáját ({simulatorReport}).
     - 2. **Válaszd ki a legmagasabb százalékos valószínűséggel rendelkező kimenetelt** a fő piacok közül (1X2, O/U 2.5, BTTS). (Ez a v92-es logika marad).
     - 3. A 'final_confidence' PONTOSAN egyenlő az 5. Ügynök 'final_confidence_score'-jával (6). Ez a pontszám már TARTALMAZZA a piaci vészjelzéseket ÉS a múltbeli tanulságokat.
   
   - Írj egy 2-3 bekezdéses holisztikus elemzést a 'strategic_synthesis'-be (magyarul). Magyarázd el a láncot (beleértve a 8-as pontot), és INDOKOLD, miért a kiválasztott kimenetel a legvalószínűbb.
   - Írj egy részletes indoklást a 'final_confidence_report'-ba (magyarul), amely az 5. Ügynök 'key_risk_factors' mezőjére (5) épül.

**TASK 3: (A VÉGREHAJTÓ) - A "micromodels" és "master_recommendation" mezők kitöltése.**
   - Töltsd ki a 'micromodels' mezőit a 4-es Ügynök (Simulator) adatai alapján.
   - Töltsd ki a 'master_recommendation' mezőt a (TASK 2) döntése alapján.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, TAKTIKAI alapú, magyar nyelvű meccs-narratíva.>",
  "strategic_synthesis": "<A (TASK 2) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul), amely a taktikát (5), a pszichológiát (7) ÉS a múltbeli tanulságokat (8) szintetizálja.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5) elemezd!** A {simulatorReport.pOver}% (4) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "corner_analysis": "<Szöglet O/U elemzés. Csak ha a simulatorReport.mu_corners_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "card_analysis": "<Lap O/U elemzés. Csak ha a simulatorReport.mu_cards_sim > 0.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <Az 5. Ügynök 'final_confidence_score'-ja (5) és a (TASK 2) döntése alapján. Ha 'Vörös Zászló' (5) vagy 'Múltbeli Tanulság' (8) volt, itt említsd meg!>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** Soha ne adj 'No Bet' vagy 'Nincs Tipp' ajánlást. MINDIG válaszd ki a (TASK 2) alapján meghatározott legvalószínűbb kimenetelt.",
    "recommended_bet": "<A (TASK 2) alapján meghatározott, legmagasabb valószínűségű kimenetel (CSAK fő piac: 1X2, O/U, BTTS)>",
    "final_confidence": <Number, az 5. Ügynök 'final_confidence_score'-ja (5) alapján (1.0-10.0).>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás, amely az 5. Ügynök 'narrative_theme'-jére (5) épül.>"
  }
}
`;

// === 8. LÉPÉS (AI TÉRKÉPÉSZ) (Változatlan) ===
interface TeamNameResolverInput {
    inputName: string;
    searchTerm: string;
    rosterJson: any[]; 
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

// === 2.5 LÉPÉS (AI PSZICHOLÓGUS) (Változatlan v93.0) ===
interface PsychologistInput {
    rawDataJson: ICanonicalRawData;
    homeTeamName: string;
    awayTeamName: string;
}
export async function runStep_Psychologist(data: PsychologistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v93)");
    } catch (e: any) {
        console.error(`AI Hiba (Psychologist): ${e.message}`);
        return {
            "psy_profile_home": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni. Semleges morál feltételezve.",
            "psy_profile_away": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni. Semleges morál feltételezve."
        };
    }
}

// === MÓDOSÍTVA (v94.0): 3. LÉPÉS (AI SPECIALISTA) ===
interface SpecialistInput {
    pure_mu_h: number;
    pure_mu_a: number;
    quant_source: string;
    rawDataJson: ICanonicalRawData;
    sport: string;
    psy_profile_home: string; 
    psy_profile_away: string;
    homeNarrativeRating: any; // ÚJ (v94.0)
    awayNarrativeRating: any; // ÚJ (v94.0)
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
    } catch (e: any) {
        console.error(`AI Hiba (Specialist): ${e.message}`);
        return {
            "modified_mu_h": data.pure_mu_h,
            "modified_mu_a": data.pure_mu_a,
            "key_factors": [`KRITIKUS HIBA: A 3. Ügynök (Specialista) nem tudott lefutni: ${e.message}`],
            "reasoning": "AI Hiba: A 3. Ügynök (Specialista) hibát dobott, a Súlyozott xG megegyezik a Tiszta xG-vel."
        };
    }
}


// === MÓDOSÍTVA (v94.0): 5. LÉPÉS (KRITIKUS / PIAC-TUDATOS) ===
interface CriticInput {
    simJson: any;
    marketIntel: string; 
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
    psy_profile_home: string;
    psy_profile_away: string;
    homeNarrativeRating: any; // ÚJ (v94.0)
    awayNarrativeRating: any; // ÚJ (v94.0)
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V94, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v94)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        return {
          "tactical_analysis": {
            "home_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "away_tactic_analysis": "AI Hiba: A taktikai elemzés nem futott le.",
            "key_battlefield": "N/A"
          },
          "final_confidence_report": {
            "final_confidence_score": 1.0, 
            "key_risk_factors": [`KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`],
            "tactical_summary": `AI Hiba (Critic): ${e.message}`,
            "narrative_theme": `Hiba: A Kritikus (5. Ügynök) nem tudott lefutni.`
          }
        };
    }
}

// === MÓDOSÍTVA (v94.0): 6. LÉPÉS (STRATÉGA) ===
interface StrategistInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; }; 
    quantReport: { pure_mu_h: number; pure_mu_a: number; source: string; }; 
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; 
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    realXgJson: any;
    psy_profile_home: string;
    psy_profile_away: string;
    homeNarrativeRating: any; // ÚJ (v94.0)
    awayNarrativeRating: any; // ÚJ (v94.0)
}

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
        };
        
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V94, dataForPrompt); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v94)");
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

// --- FŐ EXPORT (MÓDOSÍTVA v94.0) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist, 
    runStep_Specialist, 
    runStep_Critic, 
    runStep_Strategist, 
    getChatResponse
};
