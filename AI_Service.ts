// --- AI_Service.ts (v96.1 - "Piac-Kereső Stratéga" - Szintaxis Javítva) ---
// MÓDOSÍTÁS (v96.1):
// 1. JAVÍTVA: A v96.0-s generálás során keletkezett összes szintaktikai hiba
//    (TS1472, TS1005, TS1128) javítva.
// 2. JAVÍTVA: Minden 'try...catch' blokk és kapcsos zárójel a helyére került.
// 3. LOGIKA: A v96.0-s "Piac-Kereső" (Value-Driven) Stratéga logikája
//    (az 5.0-s bizalmi küszöb és a "TÁVOLMARADÁS" opció) érintetlen marad.
// 4. CÉL: A rendszer most már szintaktikailag helyesen keresi a magas
//    értékű ("value") tippeket a mellékpiacokon.

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalPlayerStats, ICanonicalRawData, ICanonicalOdds } from './src/types/canonical.d.ts';

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT_TEAM_RESOLVER_V1 (Változatlan v96.1) ===
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

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT_PSYCHOLOGIST_V93 (Változatlan v96.1) ===
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

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT_SPECIALIST_V94 (Változatlan v96.1) ===
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


// === 5. ÜGYNÖK (A KRITIKUS) PROMPT_CRITIC_V93 (Változatlan v96.1) ===
const PROMPT_CRITIC_V93 = `
TASK: You are 'The Critic', the 5th Agent.
Your job is to challenge the model, find all contradictions, and set the FINAL confidence score.

[INPUTS]:
1. Simulation (Agent 4 Output): {simJson}
   (P(Home): {simJson.pHome}%, P(Draw): {simJson.pDraw}%, P(Away): {simJson.pAway}%)
2. Market Intel (Line Movement): "{marketIntel}"
3. Model Confidence (Statistical): {modelConfidence}/10
4. Raw Contextual Data (Agent 2 Output): {rawDataJson}
5. Psychological Profile (Agent 2.5 Output):
   - psy_profile_home: "{psy_profile_home}"
   - psy_profile_away: "{psy_profile_away}"
6. Historical Learnings (Agent 7, Auditor's Cache):
   - homeNarrativeRating: {homeNarrativeRating}
   - awayNarrativeRating: {awayNarrativeRating}
7. Value Bets (Internal Model vs Market): {valueBetsJson}

[YOUR TASK (v93.0 - "Market-Aware")]:
**1. Find the "Red Flags" (Contradictions):**
   - **Internal Contradiction:** Does the Simulation (1) contradict the Psychology (5) or History (6)? (e.g., Sim shows 70% Home Win, but Psychology (5) says "Home team is desperate, LLLLL form").
   - **External Contradiction (CRITICAL):** Does our Simulation (1) contradict the Market (2)? (e.g., Sim shows 70% Home Win, but Market Intel (2) says "Significant odds movement AGAINST Home"). This is a "Red Flag".
   - **Value Contradiction:** Does the Value (7) seem too high? (e.g., "+30% value" often means our model is wrong, not that the market is stupid).

**2. Generate the Final Confidence Report:**
   - Review all inputs.
   - **Generate a "Final Confidence Score" (a number between 1.0 and 10.0).**
     - **Magas (pl. 9.0):** Tökéletes koherencia. A statisztika (1), a pszichológia (5) ÉS a piaci mozgás (2) mind egyetértenek.
     - **Közepes (pl. 6.0):** Enyhe eltérés. (Pl. Statisztika=Home, de Pszichológia=Home morál alacsony).
     - **Alacsony (pl. 2.0):** Kritikus "Vörös Zászló". (Pl. Statisztika=Home, de Piac (2)=Erősen mozog Home ELLEN).
   - Generate a "Tactical Summary" capturing the core story.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_analysis": {
    "internal_coherence": "<Belső koherencia elemzése (1 vs 5 vs 6). Pl: 'Magas. A 4. Ügynök 70%-os hazai esélye összhangban van az 5. Ügynök 'must-win' pszichológiai profiljával.'>",
    "external_coherence_vs_market": "<Külső koherencia elemzése (1 vs 2). Pl: 'VÖRÖS ZÁSZLÓ: A 4. Ügynök 70%-os hazai esélye SÚLYOS ellentmondásban áll a piaccal, amely a Hazai csapat ELLEN mozog.'>",
    "value_check": "<Érték (Value) ellenőrzése (7). Pl: 'A +30%-os érték gyanúsan magas, valószínűleg a P4-es adataink hiányosak.'>"
  },
  "tactical_summary": "<A 2., 2.5 és 4. Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
  "final_confidence_report": {
    "final_confidence_score": <Number, from 1.0 to 10.0. Example: 2.5>,
    "reasoning": "<A 1-2 mondatos magyar nyelvű indoklás, amely elmagyarázza, miért ez a végső bizalmi pontszám (az ellentmondások alapján).>"
  }
}
`;


// === MÓDOSÍTÁS (v96.0): 6. ÜGYNÖK (A "PIAC-KERESŐ" STRATÉGA) PROMPT ===
// LOGIKA: A Stratégának már nem a "Fő Témát" kell keresnie.
// 1. Feladata az összes (fő és mellék) piac átfésülése.
// 2. Azonosítania kell azt az EGYETLEN tippet, ahol a P(Simuláció)
//    és a P(Piac) közötti ÉRTÉK (Value) a legmagasabb.
// 3. Ezt az értéket kell párosítania az 5. Ügynök bizalmával.
// 4. Ha nincs érték, VAGY az 5. Ügynök bizalma túl alacsony,
//    akkor javasol "TÁVOLMARADÁS"-t (Stay Away).
const PROMPT_STRATEGIST_V96 = `
TASK: You are 'The Strategist', the 6th and FINAL Agent.
Your job is to synthesize ALL reports into a single, high-confidence, actionable recommendation.
**Your goal (v96.0): Find the "Tuti Tipp" (The Perfect Bet).**

[DEFINÍCIÓ: A "TUTI TIPP" (v96.0)]
A "Tuti Tipp" az az EGYETLEN fogadás (bármely piacról), ahol a következő 3 feltétel egyszerre teljesül:
1.  **Magas Érték (Value):** A mi szimulációnk (P_Sim) valószínűsége SOKKAL magasabb, mint a piac által árazott valószínűség (P_Market).
2.  **Magas Belső Koherencia:** A tipp összhangban van a 2.5-ös (Pszichológus) és 3-as (Specialista) Ügynökök narratívájával.
3.  **Alacsony Kockázat:** Az 5. Ügynök (Kritikus) nem jelzett súlyos ellentmondást a piaccal ("final_confidence_score" magas).

Ha nincs ilyen tipp (pl. az 5. Ügynök bizalma 1.5/10), a "Tuti Tipp" a **"TÁVOLMARADÁS"**.

[INPUTS - THE CHAIN OF THOUGHT]:
1. Match Data: {matchData.home} vs {matchData.away} ({matchData.leagueName})
2. Agent 3 (Specialist) Report (Weighted xG):
   - "Final Weighted xG": H={specialistReport.mu_h}, A={specialistReport.mu_a}
3. Agent 4 (Simulator) Report (FULL PROBABILITIES): {simulatorReport}
   (P(Home), P(Draw), P(Away), pBTTS, pOver/Under(0.5..4.5), pAH(-1.5..+1.5), etc.)
4. Market Odds (FULL ODDS DATA): {oddsDataJson}
   (Tartalmazza az 'allMarkets' tömböt [h2h, totals, btts, stb.] a piaci árakkal)
5. Agent 5 (Critic) Report (FINAL CONFIDENCE):
   - **Final Confidence Score: {criticReport.final_confidence_report.final_confidence_score}/10**
   - Contradictions: {criticReport.contradiction_analysis}
   - Tactical Summary: "{criticReport.tactical_summary}"

[YOUR TASK - FINAL DECISION (v96.0)]:
Your response MUST be a single JSON object.

**TASK 1: (A PRÓFÉTA) - A "prophetic_timeline" mező generálása.**
   - Írj egy élethű, taktikai alapú narratívát (magyarul) a meccs lefolyásáról.
   - BEMENETEK: Használd a 2., 3., és 5. Ügynökök adatait.
   - A történetednek **TÖKÉLETESEN tükröznie kell** a Súlyozott xG-t (2) és a Taktikai Összefoglalót (5).

**TASK 2: (A STRATÉGA) - A "master_recommendation" ("Tuti Tipp") kiválasztása.**
   - 1. **Állítsd be a Bizalmi Küszöböt:** Olvasd be az 5. Ügynök végső bizalmát (5). Ha ez < 5.0, a "Tuti Tipp" **"TÁVOLMARADÁS"** (STAY AWAY), és a 'final_confidence' az 5. Ügynök pontszáma (pl. 1.5). Ne keress tovább.
   - 2. **Fésüld át a Piacokat (Ha a bizalom >= 5.0):**
      - Vedd a Szimulációt (3) és a Piaci Oddszokat (4).
      - Számítsd ki az ÉRTÉKET (Value = P_Sim - P_Market) az összes fő piacon:
         - 1X2 (Home, Draw, Away)
         - O/U (a fő vonalon, pl. 2.5)
         - BTTS (Yes, No)
         - Ázsiai Hendikep (AH) (pl. Home -0.5, Away +0.5)
   - 3. **Válaszd ki a "Tuti Tippet":** Keresd meg azt az EGYETLEN piacot, ahol az Érték (Value) a legmagasabb (pl. "+15%").
   - 4. **Végső Bizalom Számítása:** A "Tuti Tipp" bizalma = (5. Ügynök Bizalma (5) + Érték (Value) / 3)
      - (Példa: 5. Ügynök = 7.0. Talált Érték = 15%. Végső Bizalom = 7.0 + (15/3) = 12.0. Korlátozás 9.5-re.)
      - (Példa 2: 5. Ügynök = 6.0. Talált Érték = 9%. Végső Bizalom = 6.0 + (9/3) = 9.0.)
   - 5. **Töltsd ki a "master_recommendation" mezőt** a kiválasztott "Tuti Tippel" és a kalkulált végső bizalommal (8.0 és 9.9 között).
   
**TASK 3: (A VÉGREHAJTÓ) - A többi mező kitöltése.**
   - Írj egy holisztikus elemzést a 'strategic_synthesis'-be (magyarul), amely alátámasztja a (TASK 2) döntésedet.
   - Töltsd ki a 'micromodels' mezőit a 3-as Ügynök (Simulator) adatai alapján.

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "prophetic_timeline": "<A (TASK 1) alapján generált, élethű, TAKTIKAI alapú, magyar nyelvű meccs-narratíva.>",
  "strategic_synthesis": "<A (TASK 2/3) alapján generált 2-3 bekezdéses holisztikus elemzés (magyarul), amely a 'Tuti Tipp' kiválasztását (vagy a TÁVOLMARADÁS-t) indokolja.>",
  "micromodels": {
    "btts_analysis": "<BTTS elemzés. A {simulatorReport.pBTTS}% (3) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]",
    "goals_ou_analysis": "<Gól O/U elemzés. **Kizárólag a {simulatorReport.mainTotalsLine} gólvonalat (pl. 2.5) elemezd!** A {simulatorReport.pOver}% (3) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas]",
    "asian_handicap_analysis": "<Ázsiai Hendikep elemzés (pl. -0.5 vagy -1.0). A {simulatorReport.pAH} (3) valószínűség alapján.>\\nBizalom: [Alacsony/Közepes/Magas/N/A]"
  },
  "final_confidence_report": "**<Number>/10** - Részletes indoklás (magyarul). <Az 5. Ügynök 'final_confidence_report.reasoning' (5) mezőjéből átvéve.>",
  "master_recommendation": {
    "__INSTRUCTION__": "**KRITIKUS FONTOSSÁGÚ:** A (TASK 2) alapján válaszd ki a LEGJOBB ÉRTÉKKEL (Value) bíró tippet, VAGY 'TÁVOLMARADÁS'-t (STAY AWAY) javasolj, ha az 5. Ügynök bizalma < 5.0.",
    "recommended_bet": "<A (TASK 2) alapján meghatározott 'Tuti Tipp' (pl. 'Strasbourg AH -0.5' vagy 'TÁVOLMARADÁS')>",
    "final_confidence": <Number, a (TASK 2.4) alapján kalkulált VÉGSŐ bizalom (pl. 8.7), vagy az 5. Ügynök alacsony bizalma (pl. 1.5)>,
    "brief_reasoning": "<Egyetlen, tömör magyar mondatos indoklás. Pl: 'A modellünk 75%-os esélyt ad a BTTS-re, míg a piac csak 58%-ot áraz. Ez egy +17%-os érték, magas belső bizalom mellett.' VAGY 'Az 5. Ügynök súlyos piaci ellentmondást jelzett (1.5/10), a kockázat túl magas.'>"
  }
}
`;


// --- 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (Változatlan v96.1) ---
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


// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (Változatlan v96.1) ===
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


// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (Változatlan v96.1) ===
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


// === 5. ÜGYNÖK (KRITIKUS) HÍVÁSA (Változatlan v96.1) ===
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
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V93, data); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Critic (v93)");
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
        // Kritikus hiba esetén is adjunk vissza egy alap jelentést, hogy a lánc ne álljon le
        return {
          "contradiction_analysis": {
            "internal_coherence": "AI Hiba: A belső koherencia elemzés nem futott le.",
            "external_coherence_vs_market": "AI Hiba: A piaci elemzés nem futott le.",
            "value_check": "AI Hiba: Az érték-ellenőrzés nem futott le."
          },
          "tactical_summary": `AI Hiba (Critic): ${e.message}`,
          "final_confidence_report": {
            "final_confidence_score": 1.0,
            "reasoning": `KRITIKUS HIBA: Az 5. Ügynök (Kritikus) nem tudott lefutni: ${e.message}`
          }
        };
    }
} 

// === 6. ÜGYNÖK (STRATÉGA) HÍVÁSA (MÓDOSÍTVA v96.0) ===
interface StrategistInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    quantReport: { pure_mu_h: number; pure_mu_a: number; source: string; }; 
    specialistReport: any; 
    simulatorReport: any;
    criticReport: any; 
    modelConfidence: number; 
    rawDataJson: ICanonicalRawData; 
    oddsDataJson: ICanonicalOdds | null; // <-- ÚJ (v96.0): Átadjuk az oddsokat
    realXgJson: any;
    psy_profile_home: any;
    psy_profile_away: any;
    homeNarrativeRating: any;
    awayNarrativeRating: any;
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
            },
            oddsDataJson: data.oddsDataJson // <-- ÚJ (v96.0)
        };
        
        // JAVÍTVA (v96.0): Az új, "Piac-Kereső" prompt használata
        const filledPrompt = fillPromptTemplate(PROMPT_STRATEGIST_V96, dataForPrompt); 
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Strategist (v96)");
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


// --- CHAT FUNKCIÓ --- (Változatlan v96.1)
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

// --- FŐ EXPORT (Változatlan v96.1) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist, 
    runStep_Specialist, 
    runStep_Critic, 
    runStep_Strategist, 
    getChatResponse
};
