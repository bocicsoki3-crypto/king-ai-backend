// --- AI_Service.ts (v96.0 - "Piac-Kereső Stratéga") ---
// MÓDOSÍTÁS (v96.0):
// 1. FILOZÓFIAI VÁLTÁS: A v95.0-s "Narratíva-Vezérelt" Stratéga
//    (ami a "Fő Témát" kereste) helyett egy új, "Piac-Kereső"
//    (Value-Driven) Stratéga kerül bevezetésre.
// 2. ÚJ LOGIKA (PROMPT_STRATEGIST_V96): A 6. Ügynök feladata már
//    nem a "Fő Téma" kiválasztása, hanem az összes (fő- és mellék-)
//    piac átfésülése, hogy megtalálja azt az EGYETLEN tippet,
//    ahol a modellünk valószínűsége (pl. P(Sim)=70%)
//    jelentősen meghaladja a piac által implikált valószínűséget
//    (P(Piac)=50%), MIKÖZBEN a belső bizalom (5. Ügynök) is magas.
// 3. CÉL: A rendszer már nem "tippelget" alacsony bizalmú fő piacokat,
//    hanem aktívan megkeresi a rejtett, magas bizalmú, nyerő
//    lehetőséget a mellékpiacokon (pl. "BTTS Igen", "Hazai AH -1.0").

import { 
// ... existing code ...
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
// ... existing code ...
import type { ICanonicalPlayerStats, ICanonicalRawData } from './src/types/canonical.d.ts';

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) PROMPT_TEAM_RESOLVER_V1 (Változatlan v96.0) ===
const PROMPT_TEAM_RESOLVER_V1 = `
TASK: You are 'The Mapper', an expert sports data mapping assistant.
// ... existing code ...
{
  "matched_id": <Number | null>
}
`;

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) PROMPT_PSYCHOLOGIST_V93 (Változatlan v96.0) ===
const PROMPT_PSYCHOLOGIST_V93 = `
TASK: You are 'The Psychologist', the 2.5th Agent.
// ... existing code ...
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "psy_profile_home": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a HAZAI csapatról.>",
  "psy_profile_away": "<A 2-3 mondatos, magyar nyelvű pszichológiai elemzés a VENDÉG csapatról.>"
}
`;

// === 3. ÜGYNÖK (A SPECIALISTA) PROMPT_SPECIALIST_V94 (Változatlan v96.0) ===
const PROMPT_SPECIALIST_V94 = `
TASK: You are 'The Specialist', the 3rd Agent.
// ... existing code ...
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


// === 5. ÜGYNÖK (A KRITIKUS) PROMPT_CRITIC_V93 (Változatlan v96.0) ===
const PROMPT_CRITIC_V93 = `
TASK: You are 'The Critic', the 5th Agent.
// ... existing code ...
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "contradiction_analysis": {
// ... existing code ...
  },
  "tactical_summary": "<A 2., 2.5 és 4. Ügynök adatainak rövid, 1-2 mondatos narratív összefoglalása.>",
  "final_confidence_report": {
    "final_confidence_score": <Number, from 1.0 to 10.0. Example: 2.5>,
    "reasoning": "<A 1-2 mondatos magyar nyelvű indoklás, amely elmagyarázza, miért ez a végső bizalmi pontszám (az ellentmondások alapján).>"
  }
}
`;


// === MÓDOSÍTÁS (v96.0): 6. ÜGYNÖK (A "PIAC-KERESŐ" STRATÉGA) PROMPT ===
// FELÜLBÍRJA: PROMPT_STRATEGIST_V95
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


// --- 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA (Változatlan v96.0) ---
interface TeamNameResolverInput {
// ... existing code ...
}
export async function runStep_TeamNameResolver(data: TeamNameResolverInput): Promise<number | null> {
    try {
// ... existing code ...
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        
// ... existing code ...
            return foundId;
        } else {
// ... existing code ...
            return null;
        }
    } catch (e: any) {
// ... existing code ...
        return null;
    }
}


// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA (Változatlan v96.0) ===
interface PsychologistInput {
// ... existing code ...
}
export async function runStep_Psychologist(data: PsychologistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V93, data);
// ... existing code ...
    } catch (e: any) {
        console.error(`AI Hiba (Psychologist): ${e.message}`);
// ... existing code ...
        };
    }
}


// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA (Változatlan v96.0) ===
interface SpecialistInput {
// ... existing code ...
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V94, data);
// ... existing code ...
    } catch (e: any) {
        console.error(`AI Hiba (Specialist): ${e.message}`);
// ... existing code ...
        };
    }
}


// === 5. ÜGYNÖK (KRITIKUS) HÍVÁSA (Változatlan v96.0) ===
interface CriticInput {
// ... existing code ...
}
export async function runStep_Critic(data: CriticInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_CRITIC_V93, data); 
// ... existing code ...
    } catch (e: any) {
        console.error(`AI Hiba (Critic): ${e.message}`);
// ... existing code ...
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
// ... existing code ...
            master_recommendation: {
                recommended_bet: "Hiba",
                final_confidence: 1.0, 
                brief_reasoning: `AI Hiba (Strategist): ${e.message}`
            }
        };
    }
}


// --- CHAT FUNKCIÓ --- (Változatlan v96.0)
interface ChatMessage {
// ... existing code ...
}

export async function getChatResponse(context: string, history: ChatMessage[], question: string): Promise<{ answer?: string; error?: string }> {
// ... existing code ...
    try {
// ... existing code ...
        
        const rawAnswer = await _callGemini(prompt, false); // forceJson = false
// ... existing code ...
    } catch (e: any) {
// ... existing code ...
    }
}

// --- FŐ EXPORT (Változatlan v96.0) ---
export default {
// ... existing code ...
    runStep_Critic, 
    runStep_Strategist, 
    getChatResponse
};
