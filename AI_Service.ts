// --- AI_Service.ts (v102.0 - "AI Szintézis Visszaállítva") ---
// MÓDOSÍTÁS (v102.0):
// 1. FILOZÓFIAI VÁLTÁS (VISSZAÁLLÍTÁS): A rendszer visszatér a
//    "korábbi AI_Service.txt" (nyerő) logikájához. A tiszta statisztika
//    nem elég, az AI-nak SZINTETIZÁLNIA kell a statisztikát ÉS a
//    kontextust (hírek, pszichológia).
// 2. JAVÍTÁS (PROMPT_CRITIC_V102): Az 5. Ügynök (Kritikus) visszakapja
//    az "agyát". A parancsa mostantól az, hogy szintetizálja a
//    statisztikát (Agent 4) és a kontextust (Agent 2.5, RawData),
//    és GENERÁLJON egy "okos", kontextus-alapú bizalmi pontszámot.
// 3. JAVÍTÁS (PROMPT_STRATEGIST_V102): A 6. Ügynök (Stratéga) parancsa:
//    - A "TÁVOLMARADÁS" (STAY AWAY) parancs VÉGLEG TÖRÖLVE.
//    - Megkeresi a statisztikailag legerősebb tippet (legmagasabb P_Sim).
//    - A bizalmat 1:1-ben átveszi az 5. Ügynök (Kritikus) "okos",
//      szintetizált pontszámából.
// 4. JAVÍTÁS (runStep_Strategist): A "buta" külső JavaScript függvények
//    (_calculateStatConfidence, _findHighestPSimBet) TÖRÖLVE.
//    A döntést (a tippet ÉS a bizalmat) mostantól az AI lánc hozza meg.
// 5. CÉL: A rendszer visszaáll a nyerő, AI-vezérelt szintézis logikára.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData, ICanonicalOdds } from './src/types/canonical.d.ts';

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT_TEAM_RESOLVER_V1 (Változatlan v102.0) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT_PSYCHOLOGIST_V93 (Változatlan v102.0) ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
Your job is to analyze the qualitative, narrative, and psychological state of both teams.
[INPUTS]:
1. Full Raw Context (from Agent 2, Scout): {rawDataJson}
   (Includes: H2H history, Form strings, Absentees, Coach names, Referee, Weather)
2. Match Info: {homeTeamName} (Home) vs {awayTeamName} (Away)
[YOUR TASK]:
1. Analyze all inputs to understand the *story* of this match.
2. Go beyond simple stats. What is the narrative?
   - Is this a "must-win" relegation battle or a title decider?
   - Is this a revenge match (check H2H)?
   - Is one team in a "desperate" state (e.g., "LLLLL" form, coach just fired)?
   - Is one team "over-confident" (e.g., "WWWWW" form, easy opponent)?
   - How significant are the absentees (e.g., "Star Striker OUT")?
3. Generate a concise psychological profile for BOTH teams.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "psy_profile_home": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a HAZAI csapatról.>",
  "psy_profile_away": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a VENDÉG csapatról.>"
}
`;

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT_SPECIALIST_V94 (Változatlan v102.0) ===
const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
Your job is to apply contextual modifiers (from Agents 2, 2.5, 7) to a baseline statistical model (from Agent 1).

[GUIDING PRINCIPLE - THE "REALISM" OATH]:
You MUST be **CONSERVATIVE and PROPORTIONAL**.
Do NOT modify the xG values significantly unless the contextual factors are EXTREME.
- Minor factors (light rain, 1-2 average players out) should result in minimal or ZERO change (e.g., +/- 0.05 xG).
- Significant factors (key player >8.0 rating out, heavy snow, extreme pressure) should be proportional.

[INPUTS]:
1. Baseline (Pure) xG (from Agent 1, Quant):
   - pure_mu_h: {pure_mu_h}
   - pure_mu_a: {pure_mu_a}
   - quant_source: "{quant_source}"

2. Full Raw Context (from Agent 2, Scout): {rawDataJson}

3. Psychological Profiles (from Agent 2.5, Psychologist):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
   
4. Historical Learnings (from Agent 7, Auditor's Cache):
   - homeNarrativeRating: {homeNarrativeRating}
   - awayNarrativeRating: {awayNarrativeRating}

[YOUR TASK - MODIFICATION & REASONING]:
1. Analyze all inputs. Pay special attention to:
   - **Psychology (Agent 2.5):** How does the narrative (e.g., "must-win", "desperate") affect the baseline xG?
   -**Absentees (Agent 2):** Are key players missing? (e.g., "Star Striker OUT" -> Decrease xG).
   - **Historical Learnings (Agent 7):** Did the Auditor leave a note? (e.g., "homeNarrativeRating.pressure_handling: -0.2" -> This team choked under pressure last time, slightly decrease their xG if pressure is high).
2. **PROPORTIONAL MODIFICATION:** Apply small, logical adjustments (+/- 0.05 to 0.30) to the 'pure_mu_h' and 'pure_mu_a' based *only* on the most significant factors.
3. Provide the FINAL 'modified_mu_h' and 'modified_mu_a' as numbers.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "modified_mu_h": <Number, the final weighted xG for Home. Example: 1.35>,
  "modified_mu_a": <Number, the final weighted xG for Away. Example: 1.15>,
  "key_factors": [
    "<List of 3-5 string bullet points describing the SIGNIFICANT qualitative factors used (from Agents 2, 2.5, 7).>"
  ],
  "reasoning": "<A concise, 1-2 sentence Hungarian explanation of HOW the key_factors led to the final (and proportional) modified xG numbers.>"
}
`;


// === MÓDOSÍTÁS (v102.0): 5. ÜGYNÖK (AZ "OKOS" KRITIKUS / SZINTETIZÁLÓ) PROMPT ===
// LOGIKA: Visszaállítva a régi, "nyerő" rendszer logikája.
// Az 5. Ügynök feladata a STATISZTIKA (Agent 4) és a KONTEXTUS
// (Agent 2.5, RawData) SZINTETIZÁLÁSA egyetlen, "okos" bizalmi pontszámmá.
const PROMPT_CRITIC_V102 = `
TASK: You are 'The Critic' (Agent 5), a master betting analyst synthesizing data.
Your job is to merge the COLD STATS (Simulation) with the WARM CONTEXT (Psychology, News)
to generate a SINGLE, FINAL, "smart" confidence score.

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%, P(Over {simJson.mainTotalsLine}): {simJson.pOver}%)
2. Full Raw Context (Agent 2 Output): {rawDataJson}
   (Includes: Absentees, Form, H2H, Weather)
3. Psychological Profile (Agent 2.5 Output):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
4. Historical Learnings (Agent 7, Auditor's Cache):
   - homeNarrativeRating: {homeNarrativeRating}
   - awayNarrativeRating: {awayNarrativeRating}

[YOUR TASK (v102.0 - "AI Synthesis")]:
**1. Find Contradictions (Stats vs. Context):**
   - Analyze the inputs. Where do the Stats (1) and Context (2, 3) disagree?
   - *Példa 1 (Vörös Zászló):* A statisztika (1) 70% Hazai győzelmet ad, DE a kontextus (2) szerint a Hazai 3 legjobb támadó hiányzik. EZ ALACSONY BIZALMAT (pl. 3.0/10) INDOKOL.
   - *Példa 2 (Zöld Zászló):* A statisztika (1) 70% Hazai győzelmet ad, ÉS a pszichológia (3) szerint a Hazai "must-win" meccsen van, ÉS a kontextus (2) szerint a Vendég kulcsvédő hiányzik. EZ TÖKÉLETES KOHERENCIA, MAGAS BIZALMAT (pl. 8.5/10) INDOKOL.
   - *Példa 3 (Semleges):* A statisztika (1) 55% Hazai győzelmet ad, és a kontextus (2, 3) semleges. EZ KÖZEPES BIZALMAT (pl. 6.0/10) INDOKOL.

**2. Generate the Final Confidence Report:**
   - **Generate a "Final Confidence Score" (a number between 1.0 and 10.0).**
   - Ez a pontszám a Te, mint Mester Elemző, végső, szintetizált bizalmad.
   - Generate a "Tactical Summary" capturing the core story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_analysis": {
    "internal_coherence": "<A Stats (1) vs. Context (2,3,4) szintézisének elemzése. Pl: 'A 70%-os hazai statisztika tökéletes összhangban van a 'must-win' pszichológiával és a vendég hiányzókkal.'>",
    "external_coherence_vs_market": "N/A (v102.0: Piaci elemzés letiltva)",
    "value_check": "N/A (v102.0: Piaci elemzés letiltva)"
  },
  "tactical_summary": "<A 2., 2.5 és 4. Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
  "final_confidence_report": {
    "final_confidence_score": <Number, from 1.0 to 10.0. A Te (AI) szintetizált "okos" bizalmi pontszámod. Example: 8.5>,
    "reasoning": "<A 1-2 mondatos magyar nyelvű indoklás, amely elmagyarázza, miért ez a végső, szintetizált bizalmi pontszám.>"
  }
}
`;


// === MÓDOSÍTÁS (v102.0): 6. ÜGYNÖK (AZ "AI VÉGREHAJTÓ") PROMPT ===
// LOGIKA: A Stratéga VÉGREHAJT.
// 1. Megkeresi a legmagasabb P_Sim tippet (a "MIT").
// 2. Átveszi az 5. Ügynök "okos" bizalmát (a "MENNYIRE").
// 3. TILOS a "TÁVOLMARADÁS".
const PROMPT_STRATEGIST_V102 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
Your job is to synthesize ALL reports into a single, decisive recommendation.
**Your goal (v102.0): Find the statistically best bet, and pair it with the "smart" AI-synthesized confidence.**

[DEFINÍCIÓ: A "TUTI TIPP" (v102.0)]
1. A TIPP (a "MIT"): Az az EGYETLEN fogadás (O/U, BTTS, 1X2, AH), amely a legmagasabb BELSŐ statisztikai valószínűséggel (P_Sim) bír.
2. A BIZALOM (a "MENNYIRE"): KIZÁRÓLAG az 5. Ügynök (Kritikus) által generált "okos", szintetizált 'final_confidence_score'.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 3 (Specialist) Report (Weighted xG):
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
3. Agent 4 (Simulator) Report (FULL PROBABILITIES): {simulatorReport}
   (P(Home), P(Draw), P(Away), pBTTS, pOver, pUnder, pAH, etc.)
4. Agent 5 (Critic) Report (THE "SMART" CONFIDENCE):
   - **Internal "Smart" Confidence Score: {criticReport.final_confidence_report.final_confidence_score}/10**
   - Tactical Summary: "{criticReport.tactical_summary}"
   - Reasoning: "{criticReport.final_confidence_report.reasoning}"

[YOUR TASK - FINAL DECISION (v102.0)]:
Your response MUST be a single JSON object.

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - Írj egy élethű, taktikai alapú narratívát (magyarul) a meccs lefolyásáról.
   - BEMENETEK: Használd a 2., 3., és 5. Ügynökök adatait.

**TASK 2: (A STRATÉGA) - A "master_recommendation" ("Tuti Tipp") kiválasztása.**
   - 1. **Azonosítsd a "Fő Témát":** Mi a rendszer központi narratívája? (Pl. "Magas xG (2), 'must-win' (5) -> Gólfieszta").
   - 2. **Keress "Tuti Tippet" (MINDEN PIACON):**
      - **Fésüld át a Szimulációt (3):** Keresd meg a legmagasabb BELSŐ valószínűségű tippet (P_Sim) az ÖSSZES piacról (O/U, BTTS, 1X2, AH).
      - *Példa 1 (Corinthians):* xG (1.21 vs 0.89). P(Under 2.5)=63.7%, P(BTTS Nem)=55%, P(Home)=48%. A legjobb tipp: "Under 2.5 Goals" (63.7%).
      - *Példa 2 (Vitória):* xG (1.38 vs 0.93). P(Home+1.5)=88.8%, P(Under 2.5)=59%. A legjobb tipp: "Vitória +1.5 AH" (88.8%).

   - 3. **Rendeld hozzá az "Okos" Bizalmat (A FELHASZNÁLÓ KÉRÉSE):**
      - A 'final_confidence' KIZÁRÓLAG az 5. Ügynök (Kritikus) által adott 'Internal "Smart" Confidence Score' (Input 4).
      - (Pl. Ha a Kritikus 8.5/10-et adott, a bizalom 8.5/10. Ha 3.2/10-et adott, a bizalom 3.2/10).
   - 4. **Töltsd ki a "master_recommendation" mezőt.** **"TÁVOLMARADÁS" (STAY AWAY) HASZNÁLATA TILOS!**

**TASK 3: (A VÉGREHAJTÓ) - A többi mező kitöltése.**
   - Írj egy holisztikus elemzést a 'strategic_synthesis'-be (magyarul), amely alátámasztja a (TASK 2) döntésedet.
   - A 'final_confidence_report' szövegét vedd át 1:1-ben az 5. Ügynöktől.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, TAKTIKAI alapú, magyar nyelvű meccs-narratíva.>",
  "strategic_synthesis": "<A (TASK 2/3) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul), amely a 'Tuti Tipp' kiválasztását indokolja.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (3) valószínűség alapján.>",
    "goals_ou_analysis": "<Gól O/U elemzés. A {simulatorReport.pOver}% (3) valószínűség alapján.>",
    "asian_handicap_analysis": "<AH elemzés. A {simulatorReport.pAH} (3) valószínűség alapján.>"
  },
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <Az 5. Ügynök 'final_confidence_report' mezőjéből (Input 4) ÁTVÉVE.>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** A (TASK 2) alapján válaszd ki a BELSŐLEG legmagasabb P_Sim tippet. A bizalmat (final_confidence) az 5. Ügynök (Input 4) adja.",
    "recommended_bet": "<A (TASK 2) alapján meghatározott 'Tuti Tipp' (pl. 'Under 2.5 Goals' vagy 'Vitória +1.5 AH')>",
    "final_confidence": <Number, (pl. 8.5 vagy 3.2). Ezt az 5. ÜGYNÖK (Input 4) 'final_confidence_score'-jából kell átvenni.>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás. Pl: 'A statisztika (P_Sim 88.8%) és a kontextus (5. Ügynök) egyaránt a Vitória +1.5 AH-t támogatja.'>"
  }
}
`;


// --- 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (Változatlan v102.0) ---
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


// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (Változatlan v102.0) ===
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
        // Hiba esetén is adjunk vissza egy alap profilt, hogy a lánc ne álljon le
        return {
            "psy_profile_home": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni.",
            "psy_profile_away": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni."
        };
    }
}


// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (Változatlan v102.0) ===
interface SpecialistInput {
    pure_mu_h: number;
    pure_mu_a: number;
    quant_source: string;
    rawDataJson: ICanonicalRawData;
    sport: string;
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v94)");
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


// === 5. ÜGYNÖK (KRITIKUS) HÍVÁSA (MÓDOSÍTVA v102.0) ===
interface CriticInput {
    simJson: any;
    marketIntel: string; // Ezt a v102 prompt már ignorálja, de az interfészben marad
    modelConfidence: number; // Ezt a v102 prompt már ignorálja
    rawDataJson: ICanonicalRawData;
    valueBetsJson: any[]; // Ezt a v102 prompt már ignorálja
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        // JAVÍTVA (v102.0): Az új, "Okos Szintetizáló" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V102, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v102)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
          "contradiction_analysis": {
            "internal_coherence": `AI Hiba: ${e.message}`,
            "external_coherence_vs_market": "N/A (v102.0: Piaci elemzés letiltva)",
            "value_check": "N/A (v102.0: Piaci elemzés letiltva)"
          },
          "tactical_summary": `AI Hiba (Critic): ${e.message}`,
          "final_confidence_report": {
            "final_confidence_score": 1.0,
            "reasoning": `KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`
          }
        };
    }
} 

// === 6. ÜGYNÖK (STRATÉGA) HÍVÁSA (MÓDOSÍTVA v102.0) ===
interface StrategistInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    quantReport: { pure_mu_h: number; pure_mu_a: number; source: string; }; 
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; // Ez mostantól tartalmazza az "okos" bizalmat
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    oddsDataJson: ICanonicalOdds | null;
    realXgJson: any;
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}

// === TÖRÖLVE (v102.0): A "buta" külső JavaScript függvények ===
// function _calculateStatConfidence(pSim: number): number { ... }
// function _findHighestPSimBet(sim: any): { bet: string, pSim: number } { ... }
// Ezt a logikát mostantól az AI (PROMPT_STRATEGIST_V102) végzi.


export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        const dataForPrompt = { 
            ...data, 
            simulatorReport: {
                ...data.simulatorReport,
                mainTotalsLine: String(data.simulatorReport.mainTotalsLine || '2.5'),
                matchData: { home: data.matchData.home, away: data.matchData.away }
            },
            specialistReport: {
                ...data.specialistReport, 
                mu_h: data.specialistReport.modified_mu_h, 
                mu_a: data.specialistReport.modified_mu_a  
            },
            oddsDataJson: data.oddsDataJson, // A prompt ignorálja, de az interfész része
            criticReport: data.criticReport // KRITIKUS: Ez tartalmazza az "okos" bizalmat
        };
        
        // JAVÍTVA (v102.0): Az új, "AI Végrehajtó" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V102, dataForPrompt); 
        const strategistReport = await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v102)");

        // === KÜLSŐ LOGIKA (v102.0): NINCS FELÜLBÍRÁLÁS ===
        // A Stratéga (AI) által adott tipp és bizalom a VÉGLEGES.
        // A "buta" v101.0-s JS felülbírálás törölve.
        if (strategistReport && strategistReport.master_recommendation) {
            console.log(`[AI_Service - v102.0 "AI Szintézis" Logika] Az AI által választott tipp: "${strategistReport.master_recommendation.recommended_bet}" @ ${strategistReport.master_recommendation.final_confidence}/10 bizalom.`);
        } else {
            console.error("[AI_Service - v102.0] KRITIKUS HIBA: A Stratéga (AI) nem adott vissza érvényes 'master_recommendation' objektumot.");
        }
        
        return strategistReport;
        
    } catch (e: any) {
        console.error(`AI Hiba (Strategist): ${e.message}`);
        return {
            prophetic_timeline: `AI Hiba (Strategist): A Próféta nem tudott jósolni. ${e.message}`,
            strategic_synthesis: `AI Hiba (Strategist): ${e.message}`,
            micromodels: {
                btts_analysis: "N/A",
                goals_ou_analysis: "N/A",
                asian_handicap_analysis: "N/A"
            },
            final_confidence_report: `**1.0/10** - AI Hiba (Strategist): ${e.message}`,
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0, 
                brief_reasoning: `AI Hiba (Strategist): ${e.message}`
            }
        };
    }
}


// --- CHAT FUNKCIÓ --- (Változatlan v102.0)
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

// --- FŐ EXPORT (Változatlan v102.0) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist, 
    runStep_Specialist, 
    runStep_Critic, 
    runStep_Strategist, 
    getChatResponse
};
