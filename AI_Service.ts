// --- AI_Service.ts (v101.0 - "A Statisztika Diktatúrája") ---
// MÓDOSÍTÁS (v101.0):
// 1. FILOZÓFIAI VÁLTÁS (VÉGLEGES): A rendszernek TÖKÉLETESEN ki kell
//    elemeznie a P1 xG-t. A bizalmat a TISZTA statisztika (P_Sim) adja.
// 2. JAVÍTÁS (PROMPT_STRATEGIST_V101): A 6. Ügynök (Stratéga) logikája
//    teljesen átírva.
// 3. LOGIKA:
//    - A "TÁVOLMARADÁS" (STAY AWAY) parancs VÉGLEG TÖRÖLVE.
//    - Az 5. Ügynök (Kritikus) 'final_confidence_score'-ja (pl. 4.5/10)
//      TELJESEN FIGYELMEN KÍVÜL HAGYVA. A Kritikus már csak
//      szöveges elemzést (final_confidence_report) ad.
//    - A 6. Ügynök megkeresi a legmagasabb P_Sim-mel rendelkező tippet
//      (O/U, BTTS, 1X2, AH) az ÖSSZES piacról.
//    - A VÉGSŐ BIZALMAT KIZÁRÓLAG ez a P_Sim határozza meg
//      (pl. P_Sim 88.8% -> 7.6/10 Bizalom).
// 4. CÉL: A rendszer minden meccsre megtalálja a belsőleg legerősebb
//    statisztikai tippet, és azt a VALÓS statisztikai bizalommal
//    prezentálja, leszarva a pszichológiai ellentmondásokat.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData, ICanonicalOdds } from './src/types/canonical.d.ts';

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT_TEAM_RESOLVER_V1 (Változatlan v101.0) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT_PSYCHOLOGIST_V93 (Változatlan v101.0) ===
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

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT_SPECIALIST_V94 (Változatlan v101.0) ===
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


// === MÓDOSÍTÁS (v101.0): 5. ÜGYNÖK (A "BELSŐ" KRITIKUS) PROMPT ===
// LOGIKA: Az 5. Ügynök továbbra is generál egy szöveges jelentést
// (tactical_summary, reasoning), de a 'final_confidence_score'-ját
// a 6. Ügynök FIGYELMEN KÍVÜL FOGJA HAGYNI.
const PROMPT_CRITIC_V101 = `
TASK: You are 'The Critic', the 5th Agent.
Your job is to challenge the model's INTERNAL coherence and write a report.

[CRITICAL INSTRUCTION (v101.0)]:
You are FORBIDDEN from analyzing the market odds (Inputs 2, 7).
Your analysis must ONLY reflect the INTERNAL coherence (P1 xG, Psychology, Absentees).

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Market Intel (Line Movement): "{marketIntel}" (IGNORE THIS INPUT)
3. Model Confidence (Statistical): {modelConfidence}/10 (IGNORE THIS INPUT)
4. Raw Contextual Data (Agent 2 Output): {rawDataJson}
5. Psychological Profile (Agent 2.5 Output):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
6. Historical Learnings (Agent 7, Auditor's Cache):
   - homeNarrativeRating: {homeNarrativeRating}
   - awayNarrativeRating: {awayNarrativeRating}
7. Value Bets (Internal Model vs Market): {valueBetsJson} (IGNORE THIS INPUT)

[YOUR TASK (v101.0 - "Internal Trust")]:
**1. Find "Red Flags" (INTERNAL Contradictions ONLY):**
   - **Internal Contradiction:** Does the Simulation (1) contradict the Psychology (5) or History (6) or Absentees (4)?
     - (Pl. A szimuláció 70% Hazai győzelmet ad, de a Pszichológia (5) szerint "Hazai morál a béka segge alatt" ÉS a 3 legjobb támadó hiányzik (4)). EZ EGY VÖRÖS ZÁSZLÓ.
     - (Pl. A szimuláció 70% Hazai győzelmet ad, ÉS a Pszichológia (5) szerint "Hazai 'must-win' meccs" ÉS a vendég kulcsvédő hiányzik (4)). EZ TÖKÉLETES KOHERENCIA.

**2. Generate the Final Confidence Report:**
   - **Generate a "Final Confidence Score" (1.0-10.0).** (MEGJEGYZÉS: A 6. Ügynök ezt a pontszámot felülbírálhatja).
   - Generate a "Tactical Summary" capturing the core story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_analysis": {
    "internal_coherence": "<Belső koherencia elemzése (1 vs 4 vs 5 vs 6). Pl: 'Magas. A 4. Ügynök 70%-os hazai esélye összhangban van az 5. Ügynök 'must-win' pszichológiai profiljával.'>",
    "external_coherence_vs_market": "N/A (v101.0: Piaci elemzés letiltva)",
    "value_check": "N/A (v101.0: Piaci elemzés letiltva)"
  },
  "tactical_summary": "<A 2., 2.5 és 4. Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
  "final_confidence_report": {
    "final_confidence_score": <Number, from 1.0 to 10.0. Example: 8.5>,
    "reasoning": "<A 1-2 mondatos magyar nyelvű indoklás, amely elmagyarázza, miért ez a végső bizalmi pontszám (KIZÁRÓLAG a belső ellentmondások alapján).>"
  }
}
`;


// === MÓDOSÍTÁS (v101.0): 6. ÜGYNÖK (A "STATISZTIKAI DIKTÁTOR") PROMPT ===
// LOGIKA: A Stratéga FIGYELMEN KÍVÜL HAGYJA az 5. Ügynök pontszámát.
// A Stratéga megkeresi a legmagasabb P_Sim-et (bármely piacról),
// és abból számolja a VÉGSŐ bizalmat.
const PROMPT_STRATEGIST_V101 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
Your job is to synthesize ALL reports into a single, decisive recommendation.
**Your goal (v101.0): Find the "Tuti Tipp" (The Perfect Bet) based on PURE statistics.**

[DEFINÍCIÓ: A "TUTI TIPP" (v101.0)]
A "Tuti Tipp" az az EGYETLEN fogadás (O/U, BTTS, 1X2, AH), amely a legmagasabb BELSŐ statisztikai valószínűséggel (P_Sim) bír.
A VÉGSŐ BIZALOM (Final Confidence) KIZÁRÓLAG ebből a P_Sim-ből származik.
Az 5. Ügynök (Kritikus) pontszáma (Input 4) IRRELEVÁNS.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 3 (Specialist) Report (Weighted xG):
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
3. Agent 4 (Simulator) Report (FULL PROBABILITIES): {simulatorReport}
   (P(Home), P(Draw), P(Away), pBTTS, pOver, pUnder, pAH, etc.)
4. Agent 5 (Critic) Report (INTERNAL/PSYCHOLOGICAL CONFIDENCE):
   - Internal Confidence Score: {criticReport.final_confidence_report.final_confidence_score}/10 (IGNORE THIS SCORE)
   - Tactical Summary: "{criticReport.tactical_summary}" (Use for text only)

[YOUR TASK - FINAL DECISION (v101.0)]:
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

   - 3. **Rendeld hozzá a STATISZTIKAI Bizalmat (A FELHASZNÁLÓ KÉRÉSE):**
      - A 'final_confidence' KIZÁRÓLAG a (TASK 2)-ben talált legmagasabb P_Sim-ből származik.
      - **A 'final_confidence' KISZÁMÍTÁSA KÜLSŐLEG TÖRTÉNIK (a _calculateStatConfidence függvénnyel).**
      - (Pl. P_Sim=88.8% -> 7.6/10 bizalom; P_Sim=63.7% -> 3.5/10 bizalom).
      - Az 5. Ügynök (Kritikus) pontszáma (Input 4) FELÜLBÍRÁLVA.
   - 4. **Töltsd ki a "master_recommendation" mezőt.** **"TÁVOLMARADÁS" (STAY AWAY) HASZNÁLATA TILOS!**

**TASK 3: (A VÉGREHAJTÓ) - A többi mező kitöltése.**
   - Írj egy holisztikus elemzést a 'strategic_synthesis'-be (magyarul), amely alátámasztja a (TASK 2) döntésedet.

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
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <Az 5. Ügynök 'final_confidence_report.reasoning' (5) mezőjéből átvéve, DE a pontszám felülbírálva a P_Sim által.>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** A (TASK 2) alapján válaszd ki a BELSŐLEG legmagasabb P_Sim tippet. A bizalmat a KÜLSŐ (v101.0) logika számolja.",
    "recommended_bet": "<A (TASK 2) alapján meghatározott 'Tuti Tipp' (pl. 'Under 2.5 Goals' vagy 'Vitória +1.5 AH')>",
    "final_confidence": <Number, (pl. 7.6 vagy 3.5). Ezt a KÜLSŐ v101.0 logika fogja beállítani.>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás. Pl: 'A tiszta statisztikai modell (P1 xG: 1.38 vs 0.93) 88.8%-os esélyt ad a Vitória +1.5 AH-ra, ez a legerősebb statisztikai jel.'>"
  }
}
`;


// --- 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (Változatlan v101.0) ---
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


// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (Változatlan v101.0) ===
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


// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (Változatlan v101.0) ===
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


// === 5. ÜGYNÖK (KRITIKUS) HÍVÁSA (MÓDOSÍTVA v101.0) ===
interface CriticInput {
    simJson: any;
    marketIntel: string;
    modelConfidence: number;
    rawDataJson: ICanonicalRawData;
    valueBetsJson: any[];
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        // JAVÍTVA (v101.0): A "Belső Kritikus" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V101, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v101)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
          "contradiction_analysis": {
            "internal_coherence": `AI Hiba: ${e.message}`,
            "external_coherence_vs_market": "N/A (v101.0: Piaci elemzés letiltva)",
            "value_check": "N/A (v101.0: Piaci elemzés letiltva)"
          },
          "tactical_summary": `AI Hiba (Critic): ${e.message}`,
          "final_confidence_report": {
            "final_confidence_score": 1.0,
            "reasoning": `KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`
          }
        };
    }
} 

// === 6. ÜGYNÖK (STRATÉGA) HÍVÁSA (MÓDOSÍTVA v101.0) ===
interface StrategistInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    quantReport: { pure_mu_h: number; pure_mu_a: number; source: string; }; 
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; 
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    oddsDataJson: ICanonicalOdds | null;
    realXgJson: any;
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
}

/**
 * Segédfüggvény (v101.0): Átszámolja a P_Sim-et (50-100%) egy 1.0-9.5 skálára.
 * EZ A VÉGSŐ BIZALOM FORRÁSA.
 */
function _calculateStatConfidence(pSim: number): number {
    if (pSim < 50) pSim = 100 - pSim; // Kezeli az 'Under' vagy 'BTTS No' esélyeit
    if (pSim < 50) return 1.0; // Alap bizalom
    
    // (P_Sim - 50) / 50 -> Normalizálja 0.0 - 1.0 skálára
    // * 8.5 -> Skálázza 0.0 - 8.5-re
    // + 1.0 -> Eltolja 1.0 - 9.5 skálára
    const confidence = ((pSim - 50) / 50) * 8.5 + 1.0;
    
    return Math.min(Math.max(confidence, 1.0), 9.5); // Biztosíték
}

/**
 * Segédfüggvény (v101.0): Megkeresi a legmagasabb P_Sim-et
 * az ÖSSZES piacról (O/U, BTTS, 1X2, AH).
 */
function _findHighestPSimBet(sim: any): { bet: string, pSim: number } {
    let bestBet = "N/A";
    let maxPSim = 0.0;

    const mainLine = String(sim.mainTotalsLine || '2.5');

    // Piacok ellenőrzése
    const markets = [
        // 1X2
        { bet: `${sim.matchData?.home || 'Home'} Win`, pSim: sim.pHome || 0 },
        { bet: `Draw`, pSim: sim.pDraw || 0 },
        { bet: `${sim.matchData?.away || 'Away'} Win`, pSim: sim.pAway || 0 },
        // O/U
        { bet: `Over ${mainLine} Goals`, pSim: sim.pOver || 0 },
        { bet: `Under ${mainLine} Goals`, pSim: sim.pUnder || 0 },
        // BTTS
        { bet: `BTTS Igen`, pSim: sim.pBTTS || 0 },
        { bet: `BTTS Nem`, pSim: 100.0 - (sim.pBTTS || 0) },
    ];

    // AH piacok hozzáadása (ha léteznek)
    if (sim.pAH) {
        for (const [key, value] of Object.entries(sim.pAH)) {
            // key pl. "h-0.5"
            // value pl. 65.4
            let betName = "AH";
            const parts = key.split('-');
            const team = parts[0] === 'h' ? (sim.matchData?.home || 'Home') : (sim.matchData?.away || 'Away');
            const line = parts[1];
            const sign = (key.includes('m')) ? '-' : '+'; // 'm' = minus, 'p' = plus

            betName = `${team} ${sign}${line}`;
            markets.push({ bet: betName, pSim: value as number });
        }
    }

    // A legjobb tipp megkeresése
    for (const market of markets) {
        if (market.pSim > maxPSim) {
            maxPSim = market.pSim;
            bestBet = market.bet;
        }
    }

    return { bet: bestBet, pSim: maxPSim };
}


export async function runStep_Strategist(data: StrategistInput): Promise<any> {
    try {
        const dataForPrompt = { 
            ...data, 
            simulatorReport: {
                ...data.simulatorReport,
                mainTotalsLine: String(data.simulatorReport.mainTotalsLine || '2.5'),
                matchData: { home: data.matchData.home, away: data.matchData.away } // Hozzáadjuk a csapatneveket a Sim-hez
            },
            specialistReport: {
                ...data.specialistReport, 
                mu_h: data.specialistReport.modified_mu_h, 
                mu_a: data.specialistReport.modified_mu_a  
            },
            oddsDataJson: data.oddsDataJson,
            criticReport: data.criticReport
        };
        
        // JAVÍTVA (v101.0): Az új, "Statisztikai Diktátor" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V101, dataForPrompt); 
        const strategistReport = await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v101)");

        // === KÜLSŐ LOGIKA (v101.0): A bizalom ÉS a tipp FELÜLBÍRÁLÁSA ===
        // A Stratéga (AI) csak szöveget generál. A "Tuti Tippet" és
        // a bizalmat mi számoljuk ki a TISZTA statisztika (P_Sim) alapján.
        if (strategistReport && strategistReport.master_recommendation) {
            
            // 1. A legjobb tipp megkeresése
            const simData = { ...data.simulatorReport, matchData: { home: data.matchData.home, away: data.matchData.away }};
            const { bet, pSim } = _findHighestPSimBet(simData);
            
            // 2. A bizalom kiszámítása a P_Sim alapján
            const finalConfidence = _calculateStatConfidence(pSim);
            
            // 3. Az AI által adott tipp és bizalom felülbírálása
            strategistReport.master_recommendation.recommended_bet = bet;
            strategistReport.master_recommendation.final_confidence = parseFloat(finalConfidence.toFixed(1));
            
            // 4. A szöveges indoklás frissítése (opcionális, de ajánlott)
            strategistReport.master_recommendation.brief_reasoning = `A tiszta statisztikai modell (P1 xG: ${data.quantReport.pure_mu_h.toFixed(2)} vs ${data.quantReport.pure_mu_a.toFixed(2)}) ${pSim.toFixed(1)}%-os esélyt ad a legerősebb jelre: ${bet}.`;
            
            // 5. A 'final_confidence_report' szöveg frissítése a valós bizalommal
            strategistReport.final_confidence_report = `**${finalConfidence.toFixed(1)}/10** - ${data.criticReport?.final_confidence_report?.reasoning || 'Statisztikai elemzés alapján.'}`;

            console.log(`[AI_Service - v101.0 "Diktatúra" Logika] Legjobb P_Sim: "${bet}" @ ${pSim.toFixed(1)}%. Végső Bizalom: ${finalConfidence.toFixed(1)}.`);
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


// --- CHAT FUNKCIÓ --- (Változatlan v101.0)
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

// --- FŐ EXPORT (Változatlan v101.0) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist, 
    runStep_Specialist, 
    runStep_Critic, 
    runStep_Strategist, 
    getChatResponse
};
