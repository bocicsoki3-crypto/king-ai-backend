// FÁJL: AI_Service.ts
// VERZIÓ: v125.0 (Confidence Penalty Finomhangolás)
// CÉL: VALÓSÁGHŰ, NYERŐ PREDIKCIÓK - Az ÖSSZES PROMPT bátor és konkrét!
// MÓDOSÍTÁS (v125.0):
// 1. Confidence Penalty ENYHÍTVE: Kevésbé konzervatív (disagreementThreshold változatlan 3.0, de penalty csökkentve)
// 2. Negatív narratíva threshold SZIGORÍTVA: 2.0 → 1.5
// 3. Várható: +2-3% pontosság (kevesebb hamis óvatosság)
//
// Korábbi módosítások (v124.2 - TELJES RENDSZER ÁTDOLGOZÁS):
// 1. MASTER AI PROMPT: topScore beépítve, bátor predikciókra ösztönzés, példák
// 2. EXPERT CONFIDENCE: Bátor, konkrét indoklások, nincs több "safe" válasz
// 3. RISK ASSESSMENT: Kiegyensúlyozott megközelítés, nem ijesztgető
// 4. BTTS ANALYSIS: Konkrét IGEN/NEM, példa eredményekkel
// 5. GOALS O/U (Soccer): Egyértelmű OVER/UNDER, várható eredményekkel
// 6. HOCKEY GOALS O/U: Bátor predikciók, konkrét eredmények (4-3, 2-1)
// 7. HOCKEY WINNER: Határozott győztes választás, várható eredmény
// 8. BASKETBALL WINNER: Konkrét győztes, várható pontszám különbség
// 9. BASKETBALL TOTALS: Egyértelmű OVER/UNDER, várható eredmény
// 10. EREDMÉNY: A TELJES RENDSZER most már KONKRÉT, VALÓSÁGHŰ tippeket ad!
//     Nincs több "várhatóan kiegyenlített" - csak GYŐZELEM! 🏆

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 
import { getConfidenceCalibrationMap } from './LearningService.js';
import type { ICanonicalRawData } from './src/types/canonical.d.ts';
import type { ISportStrategy } from './strategies/ISportStrategy.js';

// --- Helper a Régi Promptok futtatásához ---
export async function getAndParse(
    promptTemplate: string, 
    data: any, 
    keyToExtract: string,
    stepName: string
): Promise<string> {
    try {
        const filledPrompt = fillPromptTemplate(promptTemplate, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, `getAndParse:${stepName}`);
        
        if (result && typeof result === 'object' && result.hasOwnProperty(keyToExtract)) {
            const value = result[keyToExtract];
            return value || "N/A (AI nem adott értéket)";
        }
        console.error(`[AI_Service v123.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v123.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

// === 0. ÜGYNÖK (DEEP SCOUT - Csak Adatgyűjtő) ===
const PROMPT_DEEP_SCOUT_V4 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a COMPREHENSIVE LIVE GOOGLE SEARCH investigation for: {home} vs {away} ({sport}).

[CRITICAL INVESTIGATION AREAS]:

1. **SQUAD VALIDATION** (Highest Priority):
   - SEARCH: "{home} top scorers current season", "{home} injuries suspensions latest"
   - SEARCH: "{away} top scorers current season", "{away} injuries suspensions latest"
   - VERIFY: Are key players available? Any late changes?
   - CHECK: Recent transfers (departures/arrivals in last 2 months)

2. **TACTICAL INTELLIGENCE**:
   - SEARCH: "{home} formation tactics recent matches"
   - SEARCH: "{away} formation tactics recent matches"
   - IDENTIFY: Formation changes, tactical shifts, manager quotes

3. **MOMENTUM & FORM**:
   - SEARCH: "{home} last 3 matches results performance"
   - SEARCH: "{away} last 3 matches results performance"
   - ANALYZE: Winning/losing streak, confidence levels, scoring patterns

4. **MARKET INTELLIGENCE**:
   - SEARCH: "opening odds {home} vs {away}", "odds movement {home} {away}"
   - DETECT: Line movements, public sentiment, sharp money indicators

5. **HEAD-TO-HEAD PSYCHOLOGY**:
   - SEARCH: "{home} vs {away} recent history"
   - IDENTIFY: Psychological edges, historical dominance patterns

6. **CONTEXT FACTORS**:
   - SEARCH: "weather forecast {home} stadium", "referee {home} vs {away}"
   - NOTE: Weather conditions, referee tendencies

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "narrative_summary": "<4-5 magyar mondatos összefoglaló, amely tartalmazza a legfontosabb megállapításokat>",
  "transferred_players": ["<Név - csapat, pozíció>"],
  "squad_news": {
    "home_injuries": ["<Játékos - sérülés típusa>"],
    "away_injuries": ["<Játékos - sérülés típusa>"],
    "home_suspensions": [],
    "away_suspensions": []
  },
  "tactical_intel": {
    "home_formation": "<Alapfelállás>",
    "away_formation": "<Alapfelállás>",
    "home_style": "<Játékstílus röviden>",
    "away_style": "<Játékstílus röviden>",
    "tactical_notes": "<Taktikai megfigyelések>"
  },
  "momentum_analysis": {
    "home_streak": "<Sorozat leírása>",
    "away_streak": "<Sorozat leírása>",
    "home_confidence": "<Alacsony/Közepes/Magas>",
    "away_confidence": "<Alacsony/Közepes/Magas>"
  },
  "market_movement": "<Konkrét szorzó mozgások és értelmezésük>",
  "h2h_psychology": "<Pszichológiai előnyök, történelmi minták>",
  "physical_factor": "<Fáradtság, sűrű program, utazás hatása>",
  "psychological_factor": "<Morál, nyomás, elvárások>",
  "weather_context": "<Időjárás és várható hatása>",
  "referee_context": "<Játékvezető neve és stílusa>",
  "key_news": ["<Legfontosabb hírek listája>"]
}
`;

// === 8. ÜGYNÖK (A TÉRKÉPÉSZ) ===
const PROMPT_TEAM_RESOLVER_V1 = `
TASK: You are 'The Mapper', an expert sports data mapping assistant.
Your goal is to find the correct team ID for a misspelled or alternative team name.
[CONTEXT]:
- Input Name: "{inputName}"
- Search Term: "{searchTerm}"
- Roster: {rosterJson}
[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object: { "matched_id": <Number | null> }
`;

// === 2.5 ÜGYNÖK (A PSZICHOLÓGUS) ===
const PROMPT_PSYCHOLOGIST_V94 = `
TASK: You are 'The Psychologist', an elite sports psychology analyst.
Conduct a DEEP psychological profiling of both teams for: {homeTeamName} vs {awayTeamName}

[ANALYTICAL FRAMEWORK]:

1. **TEAM MORALE & CONFIDENCE**:
   - Current psychological state based on recent results
   - Pressure levels (expectations vs reality)
   - Team cohesion indicators

2. **MOMENTUM PSYCHOLOGY**:
   - Impact of winning/losing streaks on mindset
   - Confidence trajectory (rising, stable, declining)
   - Response to adversity patterns

3. **CONTEXTUAL PRESSURE**:
   - Home advantage psychological impact
   - Away team mental resilience
   - Stakes of the match (relegation battle, title race, etc.)

4. **HISTORICAL PSYCHOLOGY**:
   - Head-to-head mental edges
   - Previous traumatic defeats or confidence-boosting wins
   - Psychological dominance patterns

5. **LEADERSHIP & CHARACTER**:
   - Key leaders' influence on team mentality
   - Experienced players' stabilizing effect
   - Youth vs experience balance

[DATA ANALYSIS]:
{rawDataJson}

[OUTPUT REQUIREMENTS] - MUST be valid JSON:
{
  "psy_profile_home": "<RÉSZLETES 4-5 mondatos elemzés MAGYARUL. Tartalmazza: jelenlegi mentális állapot, forma hatása a magabiztosságra, nyomás szintje, vezetők szerepe, kulcstényezők>",
  "psy_profile_away": "<RÉSZLETES 4-5 mondatos elemzés MAGYARUL. Tartalmazza: jelenlegi mentális állapot, forma hatása a magabiztosságra, nyomás szintje, vezetők szerepe, kulcstényezők>",
  "psychological_edge": "<Melyik csapatnak van pszichológiai előnye és miért (2-3 mondat MAGYARUL)>",
  "pressure_analysis": {
    "home_pressure_level": "<Alacsony/Közepes/Magas>",
    "away_pressure_level": "<Alacsony/Közepes/Magas>",
    "pressure_impact": "<A nyomás várható hatása a teljesítményre>"
  },
  "confidence_ratings": {
    "home_confidence": 1-10,
    "away_confidence": 1-10,
    "reasoning": "<Indoklás a pontszámokra>"
  }
}

[CRITICAL INSTRUCTIONS]:
- Be specific and evidence-based
- Consider recent form, injuries, and context
- Identify psychological advantages/disadvantages
- Write in professional Hungarian
- Focus on actionable psychological insights
`;

// === 3. ÜGYNÖK (A SPECIALISTA) ===
const PROMPT_SPECIALIST_V95 = `
TASK: You are 'The Specialist', an elite contextual adjustment expert.
Apply precise, evidence-based modifiers to baseline xG predictions.

[GUIDING PRINCIPLES]:
1. **EVIDENCE-BASED APPROACH**: Adjustments should reflect evidence strength (typically ±0.2 to ±0.5, can go up to ±0.8 for extreme cases)
2. **QUANT RESPECT**: If Quant shows clear direction (>12% xG difference), PRESERVE THE DIRECTION! Don't reverse it.
3. **FORM PRIORITY**: Recent form (last 5 matches) is MORE important than old narratives
4. **PROPORTIONAL IMPACT**: Stronger evidence = larger adjustment
5. **MULTI-FACTOR**: Consider ALL contextual elements

[BASELINE PREDICTION]:
- Home Team xG: {pure_mu_h}
- Away Team xG: {pure_mu_a}
- Source: {quant_source}

[CONTEXTUAL FACTORS TO ANALYZE]:

1. **KEY ABSENCES**:
   - Missing star players (attack/defense/midfield)
   - Impact: High (-0.2 to -0.4), Medium (-0.1 to -0.2), Low (0 to -0.1)

2. **FORM & MOMENTUM** (HIGH PRIORITY - USE LAST 5 MATCHES):
   - Strong form (4-5 good results from last 5): +0.25 to +0.45 xG
   - Average form (2-3 good results): ±0.05 to ±0.15 xG
   - Weak form (0-1 good results): -0.25 to -0.45 xG
   - Form streak >7 matches: Consider DOUBLING the adjustment (max ±0.6)
   - Recent scoring/defensive patterns
   - Confidence trajectory
   - Adjustment: ±0.2 to ±0.5 per team (can go higher for extreme form differences)

3. **PSYCHOLOGICAL STATE**:
   - Pressure levels and response
   - Mental edge from H2H history
   - Adjustment: ±0.05 to ±0.15

4. **TACTICAL MATCHUP**:
   - Style compatibility (e.g., high press vs weak buildup)
   - Formation advantages
   - Adjustment: ±0.1 to ±0.2

5. **PHYSICAL CONDITION**:
   - Fatigue from fixture congestion
   - Travel impact
   - Adjustment: -0.05 to -0.15

6. **EXTERNAL FACTORS**:
   - Weather (extreme conditions)
   - Referee strictness (affects flow)
   - Adjustment: ±0.05 to ±0.1

[AVAILABLE DATA]:
{rawDataJson}

[PSYCHOLOGICAL PROFILES]:
- Home: {psy_profile_home}
- Away: {psy_profile_away}

[HISTORICAL LEARNING]:
- Home Narrative Rating: {homeNarrativeRating}
- Away Narrative Rating: {awayNarrativeRating}

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "modified_mu_h": <Number (adjusted home xG)>,
  "modified_mu_a": <Number (adjusted away xG)>,
  "adjustments": {
    "home_adjustment": <Number (e.g., +0.15)>,
    "away_adjustment": <Number (e.g., -0.20)>,
    "home_factors": [
      {"factor": "<Faktor neve>", "impact": <±0.XX>, "reasoning": "<Indoklás>"}
    ],
    "away_factors": [
      {"factor": "<Faktor neve>", "impact": <±0.XX>, "reasoning": "<Indoklás>"}
    ]
  },
  "key_factors": ["<3-5 legfontosabb módosító tényező>"],
  "reasoning": "<RÉSZLETES 4-5 mondatos magyar nyelvű magyarázat: miért és mennyit módosítottál, mely tényezők voltak a legfontosabbak, hogyan hatnak a várható gólokra>"
}

[CRITICAL RULES]:
- modified_mu_h and modified_mu_a MUST be numbers
- Total adjustments can go up to ±0.8 per team for significant contextual factors
- If no strong evidence for change, keep close to baseline
- Be specific about WHY each adjustment is made
- Consider counterbalancing factors

[CRITICAL RULE - QUANT DIRECTION PRESERVATION]:
⚠️ **DO NOT REVERSE QUANT'S DIRECTION!**

If Quant Agent calculated xG difference >12% (e.g., Home 1.50 vs Away 1.10 = +36% Home advantage):
  → Your adjustments MUST NOT reverse or eliminate this direction
  → You CAN reduce the gap moderately (e.g., 1.50→1.40, 1.10→1.18)
  → But you CANNOT make it nearly equal (e.g., 1.35 vs 1.30 would be WRONG!)
  → Reason: Quant uses pure mathematical statistics. Your job is to ADJUST based on context, not OVERRIDE the math.

**Example BAD adjustment (DON'T DO THIS!):**
  Quant: H=1.60, A=1.00 (+60% Home favor)
  ❌ Your adjustment: H=1.35, A=1.15 (+17% Home favor) 
  Problem: You eliminated 71% of the statistical advantage! TOO MUCH!
  
**Example GOOD adjustment:**
  Quant: H=1.60, A=1.00 (+60% Home favor)
  ✅ Your adjustment: H=1.45, A=1.10 (+32% Home favor)
  Good: You preserved the direction and magnitude, just adjusted moderately.

**Another Example - Small Quant difference:**
  Quant: H=1.35, A=1.28 (+5% Home favor - SMALL)
  ✅ OK to make nearly equal: H=1.32, A=1.30 (+1.5% Home)
  ✅ OR even reverse if strong evidence: H=1.28, A=1.35 (Away favor)
  Reason: When Quant shows <8% difference, you have more freedom to adjust.
`;

// === 9. ÜGYNÖK (KEY PLAYERS ANALYST - Kulcsjátékos Elemző) ===
const PROMPT_KEY_PLAYERS_ANALYST_V1 = `
TASK: You are 'The Key Players Analyst', specializing in individual impact assessment.
Analyze how KEY PLAYERS will influence this match: {home} vs {away}

[ANALYSIS FRAMEWORK]:

1. **STAR PLAYERS IDENTIFICATION**:
   - Identify the 2-3 most impactful players per team
   - Consider: form, fitness, importance to system

2. **AVAILABILITY IMPACT**:
   - Assess impact of missing key players (injuries/suspensions)
   - Rate severity: Critical, High, Medium, Low

3. **FORM & MOMENTUM**:
   - Recent performance levels (goals, assists, key stats)
   - Confidence and fitness indicators

4. **MATCHUP ADVANTAGES**:
   - Individual battles (e.g., striker vs CB, winger vs fullback)
   - Tactical mismatches that favor specific players

5. **X-FACTOR POTENTIAL**:
   - Players capable of game-changing moments
   - Clutch performers in big matches

[AVAILABLE DATA]:
{rawDataJson}

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "key_players_summary": "<3-4 mondatos összefoglaló MAGYARUL: kik a kulcsjátékosok, ki hiányzik, várható hatásuk>",
  "home_key_players": [
    {
      "name": "<Név>",
      "position": "<Poszt>",
      "importance": "<Critical/High/Medium>",
      "status": "<Available/Injured/Suspended/Doubtful>",
      "form_rating": 1-10,
      "expected_impact": "<Várható hatás leírása>"
    }
  ],
  "away_key_players": [
    {
      "name": "<Név>",
      "position": "<Poszt>",
      "importance": "<Critical/High/Medium>",
      "status": "<Available/Injured/Suspended/Doubtful>",
      "form_rating": 1-10,
      "expected_impact": "<Várható hatás leírása>"
    }
  ],
  "missing_players_impact": {
    "home_impact_score": 1-10,
    "away_impact_score": 1-10,
    "advantage": "<Home/Away/Neutral>",
    "reasoning": "<Indoklás MAGYARUL>"
  },
  "individual_battles": [
    "<Kulcs párharcok leírása, pl: 'Salah vs Robertson: gyorsaság vs tapasztalat'>"
  ],
  "x_factor_players": [
    "<Játékosok akik eldönthetik a meccset>"
  ]
}

[CRITICAL INSTRUCTIONS]:
- Focus on players who can genuinely change the outcome
- Be realistic about injury/suspension impacts
- Consider tactical roles, not just names
- Write in Hungarian
`;

// === MIKROMODELL PROMPTOK (V103 Standard) ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst with 20+ years of experience AND a PROVEN WINNER.
Provide a COMPREHENSIVE confidence assessment in Hungarian with **ACTIONABLE, REALISTIC PREDICTIONS**.

**MATCH CONTEXT: {home} vs {away}**

[QUANTITATIVE CONFIDENCE SCORES]:
- Winner Market Confidence: {confidenceWinner}/10
- Totals Market Confidence: {confidenceTotals}/10

[CONTEXTUAL DATA]:
{richContext}

[PSYCHOLOGICAL PROFILES]:
- Home: {psy_profile_home}
- Away: {psy_profile_away}

[SPECIALIST ANALYSIS]:
{specialist_reasoning}

[KEY PLAYERS IMPACT]:
{keyPlayersImpact}

[YOUR TASK]:
Synthesize ALL information and provide a FINAL CONFIDENCE rating (1-10) with **SPECIFIC, BOLD REASONING**.

**CONFIDENCE SCALE (v124.1 - REVISED FOR BOLD PREDICTIONS)**:
- 9-10: Exceptionally strong bet, rare opportunity → **MONDJ KONKRÉT EREDMÉNYT!**
- 7-8: Strong confidence, favorable conditions → **MONDJ KONKRÉT TIPPET!**
- 5-6: Moderate confidence, some uncertainty → **MONDJ VALÓSZÍNŰBB IRÁNYT!**
- 3-4: Low confidence, significant risks → **LÉGY ÓVATOS, DE KONKRÉT!**
- 1-2: Very risky, avoid → **MONDD MEG MIÉRT!**

[CRITICAL OUTPUT FORMAT] - MUST be valid JSON:
{
  "confidence_report": "**VÉGLEGES BIZALOM: X/10**\\n\\n**INDOKLÁS (KONKRÉT ÉS BÁTOR):**\\n1. Statisztikai Alap: <Mennyire erősek a matematikai mutatók? KONKRÉT SZÁMOKKAL!>\\n2. Várható Eredmény: <Milyen konkrét eredmény várható? NE LÉGY ÓVATOS!>\\n3. Kontextuális Tényezők: <Hogyan hatnak a körülmények? SPECIFIKUS HATÁSOK!>\\n4. Pszichológiai Elem: <Ki van mentális előnyben és MENNYIRE?>\\n5. Kulcsjátékosok: <Hiányzó/elérhető sztárok KONKRÉT HATÁSA gólokra>\\n6. Piaci Helyzet: <Mit mondanak az oddsok? Van VALUE?>\\n\\n**ÖSSZEGZÉS (BÁTOR ÉS KONKRÉT):** <Milyen KONKRÉT TIPPRE fogadsz? Milyen KONKRÉT EREDMÉNY VÁRHATÓ? Ne rejtőzz a 'lehet' mögé! 3-4 mondat.>"
}

[CRITICAL INSTRUCTIONS - v124.1 BOLD MODE]:
- **NE LÉGY "SAFE"** - A fogadók KONKRÉT tippeket akarnak!
- **MONDJ KONKRÉT EREDMÉNYT** - pl: "Norwich 2-1-re nyeri" NE "várhatóan 1-2 gól"
- Highlight RISKS but also OPPORTUNITIES  
- Consider variance but BE DECISIVE
- Write in professional, CONFIDENT Hungarian
- **PÉLDÁK:**
  ✅ "8/10 bizalom. A Norwich 2-1-re nyeri ezt a meccset. A statisztika (42% home win) és a forma mind ezt támasztja alá."
  ❌ "6/10 bizalom. Kiegyenlített mérkőzés várható, mindkét eredmény elképzelhető."
`;

export const TACTICAL_BRIEFING_PROMPT = `You are a world-class tactical analyst (think Pep Guardiola's analyst).
Provide a DEEP tactical analysis for: {home} vs {away} ({sport})

[TACTICAL FRAMEWORK]:

1. **FORMATION & SYSTEM ANALYSIS**:
   - Home: {home_formation} - {home_style}
   - Away: {away_formation} - {away_style}
   - Formation compatibility and mismatches

2. **STYLE CLASH ANALYSIS**:
   - How will these styles interact?
   - Who has tactical advantage?
   - Key battles in different thirds

3. **STRENGTHS vs WEAKNESSES**:
   - Home team's attacking strengths vs Away defense
   - Away team's attacking strengths vs Home defense
   - Exploitable vulnerabilities

4. **TACTICAL GAME PLAN**:
   - Expected approach from both managers
   - In-possession vs out-of-possession strategies
   - Set-piece importance

5. **KEY TACTICAL BATTLES**:
   - Specific areas where match will be won/lost
   - Individual duels that matter most

[RISK ASSESSMENT CONTEXT]:
{riskAssessment}

[AVAILABLE TACTICAL DATA]:
- Home Style: {home_style}
- Away Style: {away_style}
- Recent Tactical Trends: {tacticalTrends}

[CRITICAL OUTPUT FORMAT] - MUST be valid JSON:
{
  "tactical_briefing": "<RÉSZLETES 5-6 mondatos elemzés MAGYARUL:\\n\\n**Formációk & Stílus:** <Alapfelállások és játékfilozófiák elemzése>\\n\\n**Taktikai Párosítás:** <Ki van előnyben és miért? Stílusok összecsapása>\\n\\n**Kulcs Csataterületek:** <Hol dől el a meccs? Melyik harmadban lesz a legtöbb aktivitás?>\\n\\n**Várható Játékmenet:** <Hogyan fog kinézni a meccs? Ki dominálja a labdát? Ki kontrázik?>\\n\\n**Döntő Tényezők:** <Mi lesz a győzelem kulcsa? Melyik taktikai elem a legfontosabb?>>",
  "tactical_advantage": "<Home/Away/Neutral>",
  "key_battles": [
    "<3-5 kulcsfontosságú taktikai csata/párosítás>"
  ],
  "expected_approach": {
    "home_approach": "<Várható játékstratégia>",
    "away_approach": "<Várható játékstratégia>"
  }
}

[INSTRUCTIONS]:
- Be specific and evidence-based
- Focus on HOW tactics will influence the result
- Identify concrete advantages and vulnerabilities
- Consider both teams' recent tactical patterns
- Write in professional Hungarian
`;

export const RISK_ASSESSMENT_PROMPT = `You are an elite risk management specialist in sports betting.
Provide a COMPREHENSIVE risk assessment report in Hungarian.

**MATCH: {home} vs {away} ({sport})**

[STATISTICAL PROBABILITIES]:
- Home Win: {sim_pHome}%
- Draw: {sim_pDraw}%
- Away Win: {sim_pAway}%

[TEAM NEWS & CONTEXT]:
- Home Team News: {news_home}
- Away Team News: {news_away}

[YOUR TASK]:
Identify and quantify ALL significant risks that could affect betting outcomes.

**RISK CATEGORIES TO ANALYZE**:

1. **VARIANCE RISK**:
   - How unpredictable is this match?
   - Score distribution width
   - Upset potential

2. **INJURY/ABSENCE RISK**:
   - Impact of missing key players
   - Late lineup change possibilities
   - Depth quality concerns

3. **FORM VOLATILITY**:
   - Recent performance consistency
   - Trend sustainability
   - Momentum reversal risk

4. **TACTICAL RISK**:
   - Manager unpredictability
   - Formation/approach changes
   - Tactical mismatch uncertainty

5. **PSYCHOLOGICAL RISK**:
   - Pressure handling
   - Motivational factors
   - Mental fragility indicators

6. **EXTERNAL RISK**:
   - Weather impact potential
   - Referee influence
   - Travel/fatigue factors

[CRITICAL OUTPUT FORMAT] - MUST be valid JSON:
{
  "risk_analysis": "<TELJES KOCKÁZATI JELENTÉS MAGYARUL (6-8 mondat):\\n\\n**ÁLTALÁNOS KOCKÁZATI SZINT:** <Alacsony/Közepes/Magas> - <Rövid indoklás>\\n\\n**FŐ KOCKÁZATOK:**\\n1. <Első kockázat és hatása>\\n2. <Második kockázat és hatása>\\n3. <Harmadik kockázat és hatása>\\n\\n**VÉDEKEZŐ STRATÉGIA:** <Hogyan lehet csökkenteni a kockázatot? Milyen tippeket érdemes kerülni?>\\n\\n**BIZTONSÁGOS ZÓNÁK:** <Mely piacok/tippek a legkevésbé kockázatosak?>>",
  "risk_level": "<Alacsony/Közepes/Magas/Kritikus>",
  "main_risks": [
    {"risk": "<Kockázat neve>", "severity": "<Alacsony/Közepes/Magas>", "description": "<Leírás>"}
  ],
  "upset_potential": "<1-10 skála, mennyire valószínű a meglepetés>",
  "variance_score": "<1-10 skála, mennyire kiszámíthatatlan>",
  "recommendation": "<Általános kockázatkezelési javaslat>"
}

[INSTRUCTIONS - v124.1 BALANCED BOLD MODE]:
- Be thorough and identify hidden risks
- Quantify risks where possible (pl: "20% esély a meglepetésre")
- **BALANCED APPROACH**: Mutasd a kockázatokat, DE NE IJESZTGESD el a felhasználót!
- Ha a kockázat "Közepes", **MONDD MEG**, hogy ez NORMÁLIS, nem feltétlenül rossz!
- **PÉLDÁK HELYES MEGKÖZELÍTÉSRE:**
  ✅ "Közepes kockázat: van 15-20% esély meglepetésre, de a statisztika egyértelmű"
  ❌ "Magas kockázat: nagyon bizonytalan meccs, bármi megtörténhet"
- Write in clear, PROFESSIONAL Hungarian
- **NE RIOGASS** - Ha a főtipp erős, a kockázat NEM kell hogy "ijesztő" legyen!
`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
1st para: Stats (Probs: H:{sim_pHome}%, A:{sim_pAway}%; xG: {mu_h}-{mu_a}).
2nd para: Narrative (Tactics, Psychology).
CRITICAL OUTPUT INSTRUCTION: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian.
CONTEXT: {tacticalBriefing}.
DATA: {home} vs {away}.
CRITICAL OUTPUT INSTRUCTION: {"scenario": "<Your Hungarian prophetic narrative here>"}.`;

export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL reports.
DATA:
- Risk: "{riskAssessment}"
- Tactics: "{tacticalBriefing}"
- Stats: Sim Probs H:{sim_pHome}%, A:{sim_pAway}%.
- Context: {richContext}
CRITICAL OUTPUT INSTRUCTION: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

export const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Suggest 1-2 interesting player-specific betting markets in Hungarian.
DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: {"player_market_analysis": "<Your Hungarian player market analysis here>". If no safe option, state "Nincs kiemelkedő lehetőség."}`;

// --- SPORT SPECIFIKUS PROMPTOK (V104 - Fejlesztett) ---
export const BTTS_ANALYSIS_PROMPT = `You are an elite BTTS (Both Teams To Score) specialist with a **BOLD, PREDICTIVE** approach.

**STATISTICAL DATA**:
- BTTS Probability: {sim_pBTTS}%
- Home xG: {sim_mu_h}
- Away xG: {sim_mu_a}

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Both teams' attacking potency → **KONKRÉT PÉLDÁK a gólképességre!**
2. Defensive vulnerabilities → **SPECIFIKUS GYENGESÉGEK!**
3. Tactical likelihood → **EGYÉRTELMŰ ELŐREJELZÉS: Nyílt vagy zárt?**
4. Key factors → **KONKRÉT HATÁS gólokra!**

**CRITICAL INSTRUCTION - v124.1:**
- **NE LÉGY BIZONYTALAN!** Ha {sim_pBTTS}% > 50%, **MONDJ IGENT BTTS-re!**
- **KONKRÉT SZÁMOK:** "Mindkét csapat átlagban X gólt szerez", "Az elmúlt Y meccsen Z% volt BTTS"
- **PÉLDÁK HELYES VÁLASZRA:**
  ✅ "BTTS: IGEN - 58% esély. Mindkét csapat kiváló támadósorral rendelkezik, a védelmek sebezhetőek. Várható: 2-1 vagy 2-2."
  ❌ "BTTS: Bizonytalan. Lehet, hogy mindkét csapat gólt szerez, de zárt meccs is elképzelhető."

[OUTPUT FORMAT] - JSON:
{"btts_analysis": "**BTTS ELEMZÉS**\\n\\nValószínűség: {sim_pBTTS}% - <EGYÉRTELMŰ Értékelés: Erős/Közepes/Gyenge esély>\\n\\n**Támadójáték:** <Mindkét csapat KONKRÉT gólképessége számokkal, 2 mondat>\\n\\n**Védekezés:** <Védelmek KONKRÉT sebezhetőségei példákkal, 2 mondat>\\n\\n**Várható Játékmenet:** <EGYÉRTELMŰ: Nyílt meccs (2-1, 2-2) vagy Zárt meccs (1-0, 0-0), 1-2 mondat>\\n\\n**Ajánlás (BÁTOR ÉS KONKRÉT):** <IGEN/NEM BTTS-re EGYÉRTELMŰEN, részletes indoklás 2-3 mondatban KONKRÉT ADATOKKAL>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const SOCCER_GOALS_OU_PROMPT = `You are a Soccer Over/Under goals specialist with **BOLD, DATA-DRIVEN PREDICTIONS**.

**STATISTICAL DATA**:
- Over {line} Probability: {sim_pOver}%
- Expected Total Goals: {sim_mu_sum}
- Home xG: {sim_mu_h}, Away xG: {sim_mu_a}

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Goal expectation vs the line {line} → **EGYÉRTELMŰ ELŐREJELZÉS!**
2. Attacking/defensive styles → **KONKRÉT INTERAKCIÓ ÉS HATÁS!**
3. Tempo and possession patterns → **SPECIFIKUS JÁTÉKSTÍLUS HATÁSA!**

**CRITICAL INSTRUCTION - v124.1:**
- **NE LÉGY BIZONYTALAN!** Ha Expected Total ({sim_mu_sum}) > {line}, **MONDJ OVERT!**
- **KONKRÉT EREDMÉNY PÉLDÁK:** "Várható: 2-1, 3-1 vagy 2-2 → OVER" NE "1-3 gól várható"
- **PÉLDÁK HELYES VÁLASZRA:**
  ✅ "OVER {line} - 62% esély. Várható össz gól: {sim_mu_sum} ({sim_mu_h} + {sim_mu_a}). Mindkét csapat támadóan játszik. Legvalószínűbb eredmények: 2-1, 3-1."
  ❌ "Bizonytalan. Az Over és Under esélye is közel van 50%-hoz. Mindkettő elképzelhető."
4. Key absences affecting scoring/defending
5. Historical trends and recent goal-scoring

[OUTPUT FORMAT] - JSON:
{"goals_ou_analysis": "**GÓLLAL KAPCSOLATOS O/U ELEMZÉS ({line})**\\n\\nVárható gólszám: {sim_mu_sum} | Over valószínűség: {sim_pOver}%\\n\\n**Statisztikai Alapok:** <xG értékek értékelése a {line} vonalhoz képest, 2 mondat>\\n\\n**Taktikai Kontextus:** <Játékstílusok hatása a gólszámra, tempó, labdabirtoklás, 2-3 mondat>\\n\\n**Kulcstényezők:** <Hiányzó játékosok, form, múltbeli trendek hatása, 2 mondat>\\n\\n**Ajánlás:** <OVER/UNDER {line}, részletes indoklás miért, 2-3 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners market specialist.

**DATA**:
- Expected Corners: {mu_corners}
- Likely Line: {likelyLine}

**ANALYSIS FRAMEWORK**:
1. Team attacking patterns (crosses, wing play, set-pieces)
2. Defensive style (deep block = more corners)
3. Possession and territorial dominance
4. Historical corner statistics

[OUTPUT FORMAT] - JSON:
{"corner_analysis": "**SZÖGLET ELEMZÉS**\\n\\nVárható szögletek: {mu_corners} | Vonal: ~{likelyLine}\\n\\n**Támadási Minták:** <Mindkét csapat szögletgeneráló képessége, szárnyak használata, 2 mondat>\\n\\n**Védekezési Stílus:** <Mély védelem vs presszingelés hatása szögletekre, 2 mondat>\\n\\n**Várható Dominancia:** <Melyik csapat lesz támadó fölényben, 1 mondat>\\n\\n**Ajánlás:** <OVER/UNDER {likelyLine}, indoklás, 2 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards market specialist.

**DATA**:
- Expected Cards: {mu_cards}
- Likely Line: {likelyLine}
- Referee Style: {referee_style}
- Match Tension: {tension}

**ANALYSIS FRAMEWORK**:
1. Referee strictness and card-giving tendencies
2. Match intensity and rivalry level
3. Team discipline records
4. Tactical fouls likelihood (e.g., stopping counters)

[OUTPUT FORMAT] - JSON:
{"card_analysis": "**KÁRTYA ELEMZÉS**\\n\\nVárható kártyák: {mu_cards} | Vonal: ~{likelyLine}\\n\\n**Játékvezető:** <Bíró stílusa, szigorúsága, kártyaadási tendencia, 1-2 mondat>\\n\\n**Meccs Jellege:** <Intenzitás, rivalizálás, feszültség, 1-2 mondat>\\n\\n**Csapatok Fegyelme:** <Disciplina rekordok, taktikai szabálytalanságok gyakorisága, 2 mondat>\\n\\n**Ajánlás:** <OVER/UNDER {likelyLine}, részletes indoklás, 2 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;


export const HOCKEY_GOALS_OU_PROMPT = `You are an elite Ice Hockey Over/Under specialist with **BOLD PREDICTIONS**.

**STATISTICAL DATA**:
- Over {line} Probability: {sim_pOver}%
- Expected Total Goals: {sim_mu_sum}
- Home Goalie GSAx: {home_gsax}
- Away Goalie GSAx: {away_gsax}

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Goal expectation vs line {line} → **EGYÉRTELMŰ ELŐREJELZÉS!**
2. Goalie performance → **KONKRÉT HATÁS gólokra!**
3. Offensive firepower and PP → **SPECIFIKUS TÁMADÓERŐ!**
4. Defensive systems and PK → **KONKRÉT VÉDELMI KÉPESSÉG!**
5. Pace and shooting volume → **VÁRHATÓ TEMPÓ ÉS LÖVÉSSZÁM!**

**CRITICAL INSTRUCTION - v124.1:**
- **NE LÉGY BIZONYTALAN!** Ha {sim_mu_sum} > {line}, **MONDJ OVERT!**
- **KONKRÉT EREDMÉNY PÉLDÁK:** "Várható: 4-3, 5-2 → OVER" vagy "Várható: 2-1, 3-1 → UNDER"
- **PÉLDÁK:**
  ✅ "OVER 6.5 - 65% esély. Várható: 7.2 gól. Mindkét csapat támadó, gyenge kapusok. Legvalószínűbb: 4-3 vagy 5-2."
  ❌ "Bizonytalan. A vonal körül várható a gólszám, nehéz megjósolni."

[OUTPUT FORMAT] - JSON:
{"hockey_goals_ou_analysis": "**JÉGKORONG GÓLSZÁM O/U ELEMZÉS ({line})**\\n\\nVárható gólszám: {sim_mu_sum} | Over valószínűség: {sim_pOver}%\\n\\n**Kapusteljesítmény:** <Mindkét kapus formája KONKRÉTAN, GSAx értékek ÉRTELMEZÉSE, 2 mondat>\\n\\n**Támadójáték & Emberelőny:** <Támadóerő SZÁMOKKAL, powerplay hatékonyság SZÁZALÉKKAL, 2 mondat>\\n\\n**Védekezés & Emberhátrány:** <Védekezési rendszerek KONKRÉT ÉRTÉKELÉSE, PK erőssége ADATOKKAL, 2 mondat>\\n\\n**Várható Tempó:** <EGYÉRTELMŰ: Gyors lövésekkel teli VAGY lassú védekezős, 1-2 mondat>\\n\\n**Ajánlás (BÁTOR ÉS KONKRÉT):** <OVER/UNDER {line} EGYÉRTELMŰEN, VÁRHATÓ EREDMÉNY (pl: 4-3, 2-1), részletes indoklás ADATOKKAL, 2-3 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const HOCKEY_WINNER_PROMPT = `You are an elite Ice Hockey Winner market specialist with **BOLD, DECISIVE PREDICTIONS**.

**STATISTICAL DATA**:
- Home Win Probability: {sim_pHome}%
- Away Win Probability: {sim_pAway}%
- Home Goalie GSAx: {home_gsax}
- Away Goalie GSAx: {away_gsax}
- Home Form: {form_home}
- Away Form: {form_away}

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Overall team strength and form → **KONKRÉT ERŐVISZONYOK!**
2. Goaltending matchup → **KRITIKUS! SPECIFIKUS KAPUS ELŐNY!**
3. Special teams → **SZÁMOKKAL TÁMASZTOTT PP/PK ELŐNY!**
4. Home ice advantage → **KONKRÉT HATÁS!**
5. Recent momentum → **EGYÉRTELMŰ TREND!**

**CRITICAL INSTRUCTION - v124.1:**
- **DÖNTSD EL!** Ha {sim_pHome}% > 55%, **MONDJ HAZAI GYŐZELMET!**
- **KONKRÉT EREDMÉNY:** "Várható: Hazai 3-2" vagy "Vendég 4-2"
- **PÉLDÁK:**
  ✅ "HAZAI GYŐZELEM - 58% esély. A hazai kapus kiváló formában, erősebb PP egység. Várható: 3-2 vagy 4-2 hazai."
  ❌ "Kiegyenlített meccs. Mindkét csapat nyerhet. Nehéz megjósolni."

[OUTPUT FORMAT] - JSON:
{"hockey_winner_analysis": "**JÉGKORONG GYŐZTES ELEMZÉS**\\n\\nGYŐZELMI VALÓSZÍNŰSÉGEK: Hazai {sim_pHome}% | Vendég {sim_pAway}%\\n\\n**Kapusmeccs:** <EGYÉRTELMŰEN melyik kapus van előnyben, GSAx KONKRÉT értékek, formák SZÁMOKKAL, 2-3 mondat>\\n\\n**Csapaterő & Forma:** <Összesített erőviszonyok EGYÉRTELMŰ ÉRTÉKELÉSE, jelenlegi formák trendje KONKRÉTAN, 2 mondat>\\n\\n**Speciális Egységek:** <PP/PK előnyök SZÁZALÉKOKKAL, KONKRÉT HATÁS, 1-2 mondat>\\n\\n**Hazai Pálya:** <Hazai környezet KONKRÉT hatása, 1 mondat>\\n\\n**Ajánlás (BÁTOR ÉS KONKRÉT):** <MELYIK CSAPAT GYŐZ EGYÉRTELMŰEN, VÁRHATÓ EREDMÉNY (pl: 3-2), részletes indoklás ADATOKKAL, 3 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const BASKETBALL_WINNER_PROMPT = `You are an elite NBA/Basketball Winner specialist with **BOLD, DECISIVE PREDICTIONS**.

**STATISTICAL DATA**:
- Home Win Probability: {sim_pHome}%
- Away Win Probability: {sim_pAway}%

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Overall team quality → **KONKRÉT OFF/DEF RATINGS!**
2. Key players → **SPECIFIKUS JÁTÉKOSOK HATÁSA!**
3. Pace and style → **EGYÉRTELMŰ STÍLUS ELŐNY!**
4. Home court → **KONKRÉT HAZAI PÁLYA HATÁS!**
5. Recent form and back-to-back → **SPECIFIKUS FÁRADTSÁG/FORMA!**
6. Playoff implications → **KONKRÉT MOTIVÁCIÓ!**

**CRITICAL INSTRUCTION - v124.1:**
- **DÖNTSD EL!** Ha {sim_pHome}% > 55%, **MONDJ HAZAI GYŐZELMET!**
- **KONKRÉT EREDMÉNY KÜLÖNBSÉG:** "Várható: 115-107 hazai" vagy "Vendég nyeri 8-10 ponttal"
- **PÉLDÁK:**
  ✅ "HAZAI GYŐZELEM - 62% esély. Jobb védekezés, sztárjátékosok elérhetőek. Várható: 115-107 (8 pont különbség)."
  ❌ "Kiegyenlített meccs. Mindkét csapat jó formában. Mindkettő nyerhet."

[OUTPUT FORMAT] - JSON:
{"basketball_winner_analysis": "**KOSÁRLABDA GYŐZTES ELEMZÉS**\\n\\nGYŐZELMI VALÓSZÍNŰSÉGEK: Hazai {sim_pHome}% | Vendég {sim_pAway}%\\n\\n**Csapaterő:** <Támadás/védelem értékelések SZÁMOKKAL, általános képességek KONKRÉTAN, 2 mondat>\\n\\n**Kulcsjátékosok:** <Elérhető sztárok NÉVRE SZÓLÓAN, párosítások SPECIFIKUSAN, 2-3 mondat>\\n\\n**Stílus & Tempó:** <Játékstílusok kompatibilitása EGYÉRTELMŰEN, tempó hatása KONKRÉTAN, 2 mondat>\\n\\n**Forma & Kontextus:** <Jelenlegi forma SZÁMOKKAL, motiváció, fáradtság KONKRÉTAN, 2 mondat>\\n\\n**Ajánlás (BÁTOR ÉS KONKRÉT):** <MELYIK CSAPAT GYŐZ, VÁRHATÓ KÜLÖNBSÉG (pl: 115-107, 8 pont), részletes indoklás ADATOKKAL, 3 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;

export const BASKETBALL_TOTAL_POINTS_PROMPT = `You are an elite NBA/Basketball Over/Under specialist with **BOLD, DATA-DRIVEN PREDICTIONS**.

**STATISTICAL DATA**:
- Over {line} Probability: {sim_pOver}%
- Expected Total Points: {sim_mu_sum}

**ANALYSIS FRAMEWORK (v124.1 - BOLD MODE)**:
1. Offensive efficiency → **KONKRÉT RATINGS ÉS PPOSSESSION!**
2. Defensive efficiency → **SPECIFIKUS DEF RATINGS!**
3. Pace → **PONTOS POSSESSIONS/GAME SZÁM!**
4. Three-point volume → **HÁRMASOK SZÁMA ÉS %!**
5. Back-to-back fatigue → **KONKRÉT FÁRADTSÁG HATÁS!**
6. Recent scoring trends → **UTOLSÓ X MECCS ÁTLAG!**

**CRITICAL INSTRUCTION - v124.1:**
- **NE LÉGY BIZONYTALAN!** Ha {sim_mu_sum} > {line}, **MONDJ OVERT!**
- **KONKRÉT EREDMÉNY:** "Várható: 115-107 = 222 total → OVER" vagy "Várható: 105-98 = 203 → UNDER"
- **PÉLDÁK:**
  ✅ "OVER {line} - 67% esély. Várható: 225 pont. Gyors pace (102 poss/game), gyenge védelmek. Várható: 115-110."
  ❌ "Bizonytalan. A vonal körül várható a pontszám. Over és Under is lehetséges."

[OUTPUT FORMAT] - JSON:
{"basketball_total_points_analysis": "**KOSÁRLABDA PONTSZÁM O/U ELEMZÉS ({line})**\\n\\nVárható pontszám: {sim_mu_sum} | Over valószínűség: {sim_pOver}%\\n\\n**Támadóhatékonyság:** <Mindkét csapat támadó képességei SZÁMOKKAL (PPG, eFG%), 2 mondat>\\n\\n**Védekezési Képesség:** <Védelmek erőssége RATINGS-szel, hármasok elleni védelem %, 2 mondat>\\n\\n**Tempó:** <Várható játéktempó POSSESSIONS-szel, KONKRÉT SZÁM, 2 mondat>\\n\\n**Forma & Fáradtság:** <Közelmúltbeli pontozási trendek ÁTLAGOKKAL, back-to-back hatás PONTOKBAN, 2 mondat>\\n\\n**Ajánlás (BÁTOR ÉS KONKRÉT):** <OVER/UNDER {line} EGYÉRTELMŰEN, VÁRHATÓ EREDMÉNY (pl: 115-110 = 225), részletes indoklás ADATOKKAL, 2-3 mondatban>\\n\\nBizalom: <Alacsony/Közepes/Magas>"}`;



// === A FŐNÖK PROMPTJA (GOD MODE V2.0 - COMPREHENSIVE) ===
// Az ultimate döntéshozó, aki MINDEN adatot szintetizál
const MASTER_AI_PROMPT_TEMPLATE_GOD_MODE = `
═══════════════════════════════════════════════════════════════
               KING AI - MASTER ANALYST PROTOCOL V2.0
                    "Where Data Meets Destiny"
═══════════════════════════════════════════════════════════════

You are the **SUPREME DECISION ENGINE** of King AI - the final arbiter who synthesizes ALL intelligence.

Your mission: Identify the **ABSOLUTE BEST BET** based on mathematical convergence, narrative strength, and risk-reward optimization.

═══════════════════════════════════════════════════════════════
📊 CRITICAL DATA INPUTS
═══════════════════════════════════════════════════════════════

**STATISTICAL FOUNDATION:**
- Home Win: {sim_pHome}%
- Draw: {sim_pDraw}%
- Away Win: {sim_pAway}%
- Over/Under {sim_mainTotalsLine}: Over {sim_pOver}%

**🎯 LEGVALÓSZÍNŰBB EREDMÉNY (25,000 SZIMULÁCIÓ ALAPJÁN):**
- **Leggyakoribb eredmény:** {sim_topScore} ({sim_topScoreProb}% eséllyel)
- **Várható xG:** Hazai {sim_mu_h} vs Vendég {sim_mu_a}
- **FONTOS:** Ez nem csak átlag - ez a TÉNYLEGESEN LEGGYAKRABBAN előforduló eredmény a szimulációkban!

**VALUE BETS IDENTIFIED:**
{valueBetsJson}

**CONFIDENCE SCORES:**
- Model Confidence (Mathematical): {modelConfidence}/10
- Expert Confidence (Narrative): {expertConfidence}

**RISK ASSESSMENT:**
{riskAssessment}

**STRATEGIC SYNTHESIS:**
{strategicClosingThoughts}

**TACTICAL ANALYSIS:**
{tacticalBriefing}

**PSYCHOLOGICAL FACTORS:**
{psychologistReportJson}

**SPECIALIST ADJUSTMENTS:**
{specialistReportJson}

═══════════════════════════════════════════════════════════════
🎯 THE GOD MODE DECISION PROTOCOL
═══════════════════════════════════════════════════════════════

**STEP 1: CONVERGENCE ANALYSIS**
- Identify where MATH + NARRATIVE + TACTICS align
- Strong convergence: Math >65% + Positive Narrative + Tactical Edge
- Moderate convergence: Math 55-65% + Mixed Narrative
- Weak convergence: Math <55% OR Negative Narrative

**STEP 1.5: DRAW BIAS PREVENTION** 🚨🚨🚨
⚠️ **CRITICAL: DON'T DEFAULT TO DRAW JUST BECAUSE IT'S "SAFE"!**

Championship average draw rate: ~25% (NOT 33%!)
Yet we often predict draw 50%+ of the time. This is WRONG!

**Decision Logic:**
  • If Home Win prob ≥45% AND (Home - Draw) ≥4% → **STRONGLY CONSIDER HOME WIN**
  • If Away Win prob ≥40% AND (Away - Draw) ≥4% → **STRONGLY CONSIDER AWAY WIN**  
  • If Draw prob ≥30% AND clearly >5% better than BOTH Home/Away → Then Draw is valid
  • If all 3 within 3% of each other AND overall confidence <5 → Only then consider Draw

**Examples:**
  ✅ CORRECT: Home 46%, Draw 27%, Away 27% → **PICK HOME** (46% is clearly highest, 19% gap to draw!)
  ✅ CORRECT: Home 37%, Draw 26%, Away 37% → Toss-up, lean towards team with better **current form**
  ❌ WRONG: Home 42%, Draw 28%, Away 30% → Picking Draw is COWARDLY! 42% > 28%, so **PICK HOME!**
  ✅ CORRECT: Home 33%, Draw 35%, Away 32% → NOW Draw is justified (genuinely highest)

**Remember:** 
- Oddsmakers WANT bettors to pick draws (safer for them)
- We want VALUE, which is often in picking the winner!
- If simulation says 46% Home Win, have the COURAGE to pick it!
- Don't let psychological fear of being wrong push you to "safe" draws

**STEP 2: RISK-REWARD OPTIMIZATION**
- High confidence = Low odds acceptable (1.30-1.70)
- Medium confidence = Medium odds needed (1.70-2.20)
- Lower confidence = Higher odds required (2.20+)
- NEVER recommend low odds with low confidence

**STEP 3: EDGE IDENTIFICATION**
- Market inefficiency (odds vs probability)
- Information advantage (injuries, form)
- Tactical mismatch
- Psychological edge

**STEP 4: ALTERNATIVE BACKUP**
- Identify a STRONG secondary option
- Should be uncorrelated with primary
- Safety net if primary seems risky

**STEP 5: BÁTOR PREDIKCIÓRA ÖSZTÖNZÉS 🔥**
- **NE FÉLJ KONKRÉT EREDMÉNYT MONDANI!**
- Ha a szimuláció azt mondja {sim_topScore} a legvalószínűbb, akkor **AZT MONDD**!
- Ne rejtőzz a "várhatóan kiegyenlített" mögé
- Ha Home Win 42%, **MONDD HOGY HAZAI GYŐZELEM** (ne csak "lehet")
- Ha a topScore 2-1, **MONDD HOGY 2-1 LESZ** (ne csak "várhatóan 1-2 gól")
- A fogadók KONKRÉT tippeket akarnak, nem statisztikai bizonytalanságot!
- **PÉLDÁK HELYES MEGFOGALMAZÁSRA:**
  ✅ "A Norwich 2-1-re fogja győzni az Oxfordot"
  ✅ "Hazai győzelem várható, legvalószínűbb eredmény: 2-1"
  ❌ "Kiegyenlített mérkőzés várható, döntetlen is elképzelhető"
  ❌ "Várhatóan mindkét csapat 1-2 gólt szerez"

═══════════════════════════════════════════════════════════════
📋 OUTPUT REQUIREMENTS (MANDATORY STRUCTURE)
═══════════════════════════════════════════════════════════════

You MUST provide a valid JSON with this EXACT structure:

{
  "primary": {
    "market": "<Elsődleges tipp - pl: 'Hazai Győzelem', 'Over 2.5', 'BTTS: Igen'>",
    "confidence": <Szám 1.0-10.0>,
    "reason": "<RÉSZLETES 6-8 MONDATOS INDOKLÁS MAGYARUL, amely tartalmazza:\\n\\n1. **Statisztikai Alap:** Miért támogatják a számok ezt a tippet? (Valószínűségek, xG, forma)\\n\\n2. **Taktikai Elemzés:** Hogyan támogatja a taktikai felállás/stílus ezt az eredményt?\\n\\n3. **Pszichológiai/Narratív Elem:** Mentális/motivációs tényezők, forma, nyomás\\n\\n4. **Kulcstényezők:** Hiányzó/elérhető játékosok, injuries, speciális körülmények\\n\\n5. **Piaci Helyzet:** Oddsok értéke, piaci mozgások\\n\\n6. **Miért ez a LEGJOBB tipp:** Végső összegzés - konvergencia, előny, value>"
  },
  "secondary": {
    "market": "<Alternatív tipp>",
    "confidence": <Szám 1.0-10.0>,
    "reason": "<RÉSZLETES 4-5 MONDATOS INDOKLÁS MAGYARUL: Miért jó ez másodlagos opcióként? Hogyan különbözik az elsődlegestől? Milyen forgatókönyvben lehet jobb?>"
  },
  "verdict": "<A LÉNYEG - 2-3 MONDATOS ÖSSZEFOGLALÓ MAGYARUL: Miért ez a 'BIZTOS' tipp? KÖTELEZŐ konkrét eredményt említeni (pl: 'Norwich 2-1-re nyeri a meccset'). Mi az a 1-2 kulcsfontosságú tényező, ami miatt ez valószínűleg bejön? Legyen magabiztos és BÁTOR! Használd a {sim_topScore} eredményt ha releváns!>",
  "betting_strategy": {
    "stake_recommendation": "<1-5 egység ajánlás, ahol 5 = maximális bizalom>",
    "market_timing": "<Fogadj most / Várj jobb oddsra / Nincs időzítési előny>",
    "hedge_suggestion": "<Opcionális fedezési stratégia, ha alkalmazható>"
  },
  "key_risks": [
    "<3-4 fő kockázat ami meghiúsíthatja a tippet>"
  ],
  "why_not_alternatives": "<Rövid magyarázat (2-3 mondat): Miért NEM a másik nyilvánvaló opciót választottuk? Pl: miért nem Away Win, ha az is jó oddsot kínál?>"
}

═══════════════════════════════════════════════════════════════
⚠️  CRITICAL RULES & GUIDELINES
═══════════════════════════════════════════════════════════════

1. **BE SPECIFIC & DETAILED**: Generic reasoning is useless
2. **EVIDENCE-BASED**: Every claim must be backed by data
3. **BÁTOR PREDIKCIÓ**: Konkrét eredményt KÖTELEZŐ mondani! Használd a {sim_topScore} értéket!
4. **CONSIDER ALL ANGLES**: Stats, tactics, psychology, value
5. **FOCUS ON VALUE**: Not just "who will win" but "where is the edge"
6. **MAIN MARKETS PRIORITY**: 1X2/Moneyline, Over/Under, BTTS first
7. **REALISTIC CONFIDENCE**: Don't inflate scores without justification
8. **HUNGARIAN LANGUAGE**: All reasoning must be in clear, professional Hungarian
9. **NE LÉGY "SAFE"**: A felhasználó nyerni akar, nem bizonytalan válaszokat olvasni!
10. **KONKRÉT SZÁMOK**: Ha mondasz eredményt, mondd: "2-1", "1-0", stb. - NE "1-2 gól várható"
11. **ANTI-DRAW BIAS RULE**: 
    - If simulation shows Home >45% OR Away >42%, DON'T default to Draw unless there's overwhelming narrative evidence
    - Draw should only win if it's genuinely >30% AND clearly the best option (not just "safe")
    - When in doubt between Home/Away/Draw, pick the one with: HIGHEST probability (≥4% gap) + BEST current form
12. **FORM PRIORITY RULE**:
    - Last 5 matches form is MORE important than H2H history >6 months old
    - If one team has 4-5 good results and opponent has 0-2, this is MASSIVE (±0.4-0.6 xG impact)
    - Don't let old narratives ("mumus-komplexus", old H2H) override current momentum
13. **QUANT RESPECT RULE**:
    - If Quant (pure stats) shows >12% xG difference, it found something REAL in the data
    - If Specialist reduced it too much (>50% reduction), you can note: "Pure stats showed stronger advantage, possibly underweighted by contextual adjustments"
    - Example: Quant H=1.60 vs A=1.00 (+60%), Specialist reduced to H=1.35 vs A=1.15 (+17%) → You can say "The baseline statistical model showed stronger Home dominance"
14. **CONFIDENCE-PROBABILITY ALIGNMENT**:
    - If win probability is 60%+ → Confidence should be 7-10
    - If win probability is 50-60% → Confidence should be 6-7.5
    - If win probability is 45-50% → Confidence should be 5-6.5
    - If win probability is 40-45% → Confidence should be 4-5.5
    - If probability is <40% → Don't recommend it as primary unless extremely high value odds!

═══════════════════════════════════════════════════════════════
💡 PÉLDÁK HELYES VÁLASZRA (v2.0 - ANTI-DRAW BIAS)
═══════════════════════════════════════════════════════════════

PÉLDA 1 - Tiszta győztes (NE válassz döntetlent!)
════════════════════════════════════════════════
Adatok: Home Win 46.1%, Draw 27.1%, Away 26.8%
        xG: H=1.35, A=1.15 (+17% Home)
        Form: Home 4W-1D (80%), Away 1W-4L (20%) = 60pp gap!

{
  "primary": {
    "market": "Hazai Győzelem",
    "confidence": 6.8,
    "reason": "1. **Statisztikai Alap:** A szimuláció 46.1% esélyt ad a hazai győzelemre, ami **EGYÉRTELMŰEN** a legmagasabb valószínűség (Draw csak 27.1%, +19pp különbség!). Az xG is támogatja: 1.35 vs 1.15 (+17% Home előny). A leggyakoribb eredmény a 25,000 szimulációból a **2-1 hazai javára** (11.2% esély).\\n\\n2. **Forma Dominancia (KRITIKUS!):** A hazai csapat KIVÁLÓ formában van (4W-1D az utolsó 5-ből, 80%-os forma-score), míg a vendég KÜZD (1W-4L, csak 20%-os forma-score). Ez **60 százalékpontos forma-különbség** - óriási előny!\\n\\n3. **Taktikai Elemzés:** A hazai csapat támadóbb felállással játszik hazai pályán, kulcsjátékosai elérhetőek. A vendég védekezésre kényszerül.\\n\\n4. **Miért NE Döntetlen?** Bár a Draw 27.1%, ez CSAK a második legjövedelmezőbb kimenetel. A 46.1% Home Win +70% magasabb valószínűség mint a Draw! Ne essünk a 'biztonságos döntetlen' csapdájába.\\n\\n5. **Konkrét Predikció:** A **hazai csapat 2-1-re fogja nyerni ezt a meccset**. A statisztika (46% vs 27%), a forma-dominancia és az xG előny mind ezt támasztja alá. Ez nem remény, ez MATEMATIKA!"
  },
  "secondary": {
    "market": "Over 2.5",
    "confidence": 5.8,
    "reason": "Várható összgól: 2.50. Mindkét csapat támadóan játszik. Biztonságosabb alternatíva ha a hazai győzelem nem jön be, de a gólok megszületnek."
  },
  "verdict": "A hazai csapat 2-1-es győzelme a legvalószínűbb kimenetel. A 46.1%-os győzelmi esély (19pp-tal több mint a Draw!) és a **domináns forma-előny (80% vs 20%)** egyértelművé teszik: a hazai győzelem NEM csak lehetőség, hanem a **LEGJOBB TIPP**. Bátran válasszuk a győztest, ne a 'safe' döntetlent!"
}


PÉLDA 2 - Mikor VÁLASZD a döntetlent (ritka eset!)
══════════════════════════════════════════════════
Adatok: Home Win 34%, Draw 33%, Away 33%
        xG: H=1.28, A=1.30 (gyakorlatilag EGYENLŐ!)
        Form: Home 2W-3D, Away 2W-3D (AZONOS!)
        Most likely score: 1-1 (14.2%)

{
  "primary": {
    "market": "Döntetlen (X)",
    "confidence": 5.8,
    "reason": "Ez az a **ritka eset**, ahol a döntetlen valóban a LEGJOBB választás, NEM csak 'safe' opció:\\n\\n1. **Három-utas egyenlőség:** Home 34%, Draw 33%, Away 33% - matematikailag TELJESEN egyenlő, nincs 4%+ különbség\\n\\n2. **xG tökéletes egyensúly:** 1.28 vs 1.30 - gyakorlatilag azonos támadóerő\\n\\n3. **Forma azonos:** Mindkét csapat 2W-3D az utolsó 5-ből - ugyanaz a momentum, ugyanaz a pontszám (9 pont)\\n\\n4. **Leggyakoribb eredmény:** 1-1 (14.2% esély) - a szimuláció is ezt jósolja\\n\\n5. **Miért MOST döntetlen?** Mert MINDEN mutató egyenlőséget jelez. Ez NEM 'biztonságos választás' pszichológiából, hanem MATEMATIKAILAG a legjobb tipp amikor MINDEN adat egyensúlyt mutat. Nincs tiszta favorit, nincs forma-különbség, nincs xG-különbség.\\n\\nEz a helyes döntetlen választás - amikor a SZÁMOK mondják, nem a félelem!"
  }
}


PÉLDA 3 - ROSSZ döntetlen választás (ne csináld!)
══════════════════════════════════════════════════
Adatok: Home Win 42%, Draw 31%, Away 27%
        xG: H=1.45, A=1.10 (+32% Home)

❌ ROSSZ VÁLASZ:
{
  "primary": {
    "market": "Döntetlen",
    "confidence": 6.0,
    "reason": "Kiegyenlített mérkőzés várható..."
  }
}

✅ HELYES VÁLASZ:
{
  "primary": {
    "market": "Hazai Győzelem",
    "confidence": 6.5,
    "reason": "A 42%-os Home Win EGYÉRTELMŰEN meghaladja a 31%-os Draw-t (+11pp!). Az xG is Home előnyt mutat (+32%). NE válasszuk a döntetlent csak mert 'biztonságos'!"
  }
}

═══════════════════════════════════════════════════════════════
🚀 DECISION TIME - ANALYZE & EXECUTE
═══════════════════════════════════════════════════════════════
`;



// --- ÜGYNÖK FUTTATÓ FÜGGVÉNYEK ---

// === 0. ÜGYNÖK (DEEP SCOUT) ===
export async function runStep_DeepScout(data: { home: string, away: string, sport: string }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_DEEP_SCOUT_V4, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_DeepScout", 2, true);
    } catch (e: any) {
        console.error(`[AI_Service v124.0] Deep Scout Hiba: ${e.message}`);
        return null;
    }
}

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) ===
export async function runStep_TeamNameResolver(data: { inputName: string; searchTerm: string; rosterJson: any[]; }): Promise<number | null> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_TEAM_RESOLVER_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_TeamNameResolver");
        return result && result.matched_id ? Number(result.matched_id) : null;
    } catch (e: any) {
        console.error(`[AI_Service v123.0] Térképész Hiba: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
export async function runStep_Psychologist(data: { rawDataJson: ICanonicalRawData; homeTeamName: string; awayTeamName: string; }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V94, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v94)");
        // Visszamenőleges kompatibilitás biztosítása
        if (!result.psy_profile_home || !result.psy_profile_away) {
            console.warn("[AI_Service v124.0] Pszichológus nem adott vissza teljes választ.");
            return { 
                "psy_profile_home": result.psy_profile_home || "Nincs adat",
                "psy_profile_away": result.psy_profile_away || "Nincs adat",
                "psychological_edge": result.psychological_edge || "Nincs meghatározva",
                "pressure_analysis": result.pressure_analysis || {},
                "confidence_ratings": result.confidence_ratings || {}
            };
        }
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v124.0] Pszichológus Hiba: ${e.message}`);
        return { 
            "psy_profile_home": "AI Hiba", 
            "psy_profile_away": "AI Hiba",
            "psychological_edge": "Nincs adat",
            "pressure_analysis": {},
            "confidence_ratings": {}
        };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) ===
export async function runStep_Specialist(data: any): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V95, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v95)");
        
        // Validálás és fallback
        if (typeof result.modified_mu_h !== 'number' || isNaN(result.modified_mu_h)) {
            console.warn("[AI_Service v124.0] Specialista érvénytelen modified_mu_h-t adott. Fallback alapértékre.");
            result.modified_mu_h = data.pure_mu_h;
        }
        if (typeof result.modified_mu_a !== 'number' || isNaN(result.modified_mu_a)) {
            console.warn("[AI_Service v124.0] Specialista érvénytelen modified_mu_a-t adott. Fallback alapértékre.");
            result.modified_mu_a = data.pure_mu_a;
        }
        
        // Extrém eltérések ellenőrzése
        const homeDiff = Math.abs(result.modified_mu_h - data.pure_mu_h);
        const awayDiff = Math.abs(result.modified_mu_a - data.pure_mu_a);
        if (homeDiff > 1.0 || awayDiff > 1.0) {
            console.warn(`[AI_Service v124.0] Specialista túl nagy módosítást javasolt (H: ${homeDiff.toFixed(2)}, A: ${awayDiff.toFixed(2)}). Limitálás.`);
            result.modified_mu_h = data.pure_mu_h + Math.max(-0.5, Math.min(0.5, result.modified_mu_h - data.pure_mu_h));
            result.modified_mu_a = data.pure_mu_a + Math.max(-0.5, Math.min(0.5, result.modified_mu_a - data.pure_mu_a));
        }
        
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v124.0] Specialista Hiba: ${e.message}`);
        return { 
            "modified_mu_h": data.pure_mu_h, 
            "modified_mu_a": data.pure_mu_a, 
            "adjustments": {},
            "key_factors": [],
            "reasoning": `AI Hiba: ${e.message}` 
        };
    }
}

// === 9. ÜGYNÖK (KEY PLAYERS ANALYST) ===
export async function runStep_KeyPlayersAnalyst(data: { rawDataJson: ICanonicalRawData; home: string; away: string; }): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_KEY_PLAYERS_ANALYST_V1, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_KeyPlayersAnalyst (v1)");
        
        if (!result.key_players_summary) {
            console.warn("[AI_Service v124.0] Key Players Analyst nem adott vissza teljes választ.");
            return {
                "key_players_summary": "Nincs elérhető játékos adat.",
                "home_key_players": [],
                "away_key_players": [],
                "missing_players_impact": {
                    "home_impact_score": 5,
                    "away_impact_score": 5,
                    "advantage": "Neutral",
                    "reasoning": "Nincs adat"
                },
                "individual_battles": [],
                "x_factor_players": []
            };
        }
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v124.0] Key Players Analyst Hiba: ${e.message}`);
        return {
            "key_players_summary": "AI Hiba",
            "home_key_players": [],
            "away_key_players": [],
            "missing_players_impact": {
                "home_impact_score": 5,
                "away_impact_score": 5,
                "advantage": "Neutral",
                "reasoning": "AI Hiba"
            },
            "individual_battles": [],
            "x_factor_players": []
        };
    }
}

// === MIKROMODELL FUTTATÓK (Helpers) ===

async function getExpertConfidence(confidenceScores: { winner: number, totals: number, overall: number }, richContext: string, rawData: ICanonicalRawData, psyReport: any, specialistReport: any, keyPlayersReport: any) {
     const data = {
         confidenceWinner: confidenceScores.winner.toFixed(1), 
         confidenceTotals: confidenceScores.totals.toFixed(1), 
         richContext: richContext || "Nincs kontextus.",
         home: rawData?.home || 'Hazai', 
         away: rawData?.away || 'Vendég',
         psy_profile_home: psyReport?.psy_profile_home || "N/A", 
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A",
         keyPlayersImpact: keyPlayersReport?.key_players_summary || "Nincs játékos adat"
     };
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, data, "confidence_report", "ExpertConfidence");
}

async function getRiskAssessment(sim: any, rawData: ICanonicalRawData, sport: string, confidenceScores: any) {
    const safeSim = sim || {};
    const data = {
        sport,
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        news_home: rawData?.team_news?.home || "N/A", news_away: rawData?.team_news?.away || "N/A",
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis", "RiskAssessment");
}

async function getTacticalBriefing(rawData: ICanonicalRawData, sport: string, home: string, away: string, riskAssessment: string) {
    const data = {
        sport, home, away, 
        riskAssessment: riskAssessment || "N/A",
        home_style: rawData?.tactics?.home?.style || "N/A", 
        away_style: rawData?.tactics?.away?.style || "N/A",
        home_formation: rawData?.tactics?.home?.formation || "N/A",
        away_formation: rawData?.tactics?.away?.formation || "N/A",
        tacticalTrends: rawData?.tactics?.notes || "Nincs taktikai megjegyzés"
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "tactical_briefing", "TacticalBriefing");
}

async function getFinalGeneralAnalysis(sim: any, tacticalBriefing: string, rawData: ICanonicalRawData, confidenceScores: any, psyReport: any) {
    const safeSim = sim || {};
    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A", psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai', away: rawData?.away || 'Vendég'
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis", "FinalGeneralAnalysis");
}

async function getPropheticTimeline(rawData: ICanonicalRawData, home: string, away: string, sport: string, tacticalBriefing: string) {
     const data = { sport, home, away, tacticalBriefing: tacticalBriefing || "N/A" };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario", "PropheticScenario");
}

async function getPlayerMarkets(keyPlayers: any, richContext: string) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, { keyPlayersJson: keyPlayers, richContext: richContext || "Nincs kontextus." }, "player_market_analysis", "PlayerMarkets");
}

async function getStrategicClosingThoughts(sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, riskAssessment: string, tacticalBriefing: string, valueBets: any[], confidenceScores: any, expertConfidence: string, psyReport: any, specialistReport: any, sport: string) {
    const safeSim = sim || {};
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
        const analysisPart = typeof val === 'string' ? val.split('\nBizalom:')[0].trim() : 'N/A';
        return `${key}: ${analysisPart}`;
    }).join('; ');

    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        tacticalBriefing: tacticalBriefing || "N/A",
        microSummaryJson: microSummary,
        richContext: richContext || "Nincs kontextus.",
        riskAssessment: riskAssessment || "N/A",
        valueBetsJson: valueBets,
        expertConfidence: expertConfidence || "N/A",
     };
     
    let template = STRATEGIC_CLOSING_PROMPT;
    if (sport === 'hockey' || sport === 'basketball') {
        template = template.replace(/BTTS, /g, ""); 
    }
    return await getAndParse(template, data, "strategic_analysis", "StrategicClosing");
}

// === MIKROMODELL FUTTATÓK (V121.1) ===
async function getBTTSAnalysis(sim: any, rawData: ICanonicalRawData) {
     const safeSim = sim || {};
     const data = {
        sim_pBTTS: safeSim.pBTTS,
        sim_mu_h: safeSim.mu_h_sim,
        sim_mu_a: safeSim.mu_a_sim,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
     };
     return await getAndParse(BTTS_ANALYSIS_PROMPT, data, "btts_analysis", "BTTSAnalysis");
}

async function getSoccerGoalsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
     const safeSim = sim || {};
     const countKeyAbsentees = (absentees: any) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0;
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        absentees_home_count: countKeyAbsentees(rawData?.absentees?.home),
        absentees_away_count: countKeyAbsentees(rawData?.absentees?.away)
     };
    return await getAndParse(SOCCER_GOALS_OU_PROMPT, data, "goals_ou_analysis", "GoalsOUAnalysis");
}

async function getCornerAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCorners = safeSim.mu_corners_sim;
    const likelyLine = muCorners ? (Math.round(muCorners - 0.1)) + 0.5 : 9.5;
    const data = {
        mu_corners: muCorners,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        likelyLine: likelyLine 
    };
    return await getAndParse(CORNER_ANALYSIS_PROMPT, data, "corner_analysis", "CornerAnalysis");
}

async function getCardAnalysis(sim: any, rawData: ICanonicalRawData) {
    const safeSim = sim || {};
    const muCards = safeSim.mu_cards_sim;
    const likelyLine = muCards ? (Math.round(muCards - 0.1)) + 0.5 : 4.5;
    const data = {
        mu_cards: muCards,
        referee_style: rawData?.referee?.style || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A",
        likelyLine: likelyLine 
    };
    return await getAndParse(CARD_ANALYSIS_PROMPT, data, "card_analysis", "CardAnalysis");
}

async function getHockeyGoalsOUAnalysis(sim: any, rawData: ICanonicalRawData, mainTotalsLine: number) {
     const safeSim = sim || {};
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx || "N/A", 
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx || "N/A"
     };
     return await getAndParse(HOCKEY_GOALS_OU_PROMPT, data, "hockey_goals_ou_analysis", "HockeyGoalsOUAnalysis");
}

async function getHockeyWinnerAnalysis(sim: any, rawData: ICanonicalRawData) {
     const safeSim = sim || {};
     const data = {
        sim_pHome: safeSim.pHome,
        sim_pAway: safeSim.pAway,
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx || "N/A",
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx || "N/A",
        form_home: rawData?.form?.home_overall || "N/A",
        form_away: rawData?.form?.away_overall || "N/A"
     };
    return await getAndParse(HOCKEY_WINNER_PROMPT, data, "hockey_winner_analysis", "HockeyWinnerAnalysis");
}


// === A FŐNÖK: getMasterRecommendation (GOD MODE V2.0) ===
// Ez a döntési motor lelke - minden adat szintézise
async function getMasterRecommendation(
    valueBets: any[], 
    sim: any, 
    confidenceScores: { winner: number, totals: number, overall: number }, 
    expertConfidence: string,
    riskAssessment: string, 
    microAnalyses: any, 
    generalAnalysis: string, 
    strategicClosingThoughts: string, 
    contradictionAnalysisResult: string,
    psyReport: any,
    specialistReport: any,
    sport: string,
    tacticalBriefing?: string,
    keyPlayersReport?: any
) {
    try {
        const safeSim = sim || {};
        const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; ');

        // Expert confidence score kinyerése
        let expertConfScore = 1.0;
        try {
            let match = expertConfidence?.match(/\*\*VÉGLEGES BIZALOM:\s*(\d+(\.\d+)?)\/10\*\*/i);
            if (!match) match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/);
            if (match && match[1]) expertConfScore = parseFloat(match[1]);
        } catch(e) {
            console.warn("[AI_Service v124.0] Expert confidence score kinyerése sikertelen.");
        }

        const safeModelConfidence = typeof confidenceScores.winner === 'number' ? confidenceScores.winner : 5.0;

        // === ÚJ v124.1: LEGVALÓSZÍNŰBB EREDMÉNY (topScore) HOZZÁADÁSA ===
        const topScoreHome = safeSim.topScore?.gh ?? Math.round(safeSim.mu_h_sim || 1);
        const topScoreAway = safeSim.topScore?.ga ?? Math.round(safeSim.mu_a_sim || 1);
        const topScoreString = `${topScoreHome}-${topScoreAway}`;
        const topScoreProb = safeSim.scores?.[topScoreString] ? ((safeSim.scores[topScoreString] / 25000) * 100).toFixed(1) : "N/A";
        
        const data = {
            valueBetsJson: JSON.stringify(valueBets, null, 2),
            sim_pHome: safeSim.pHome?.toFixed(1) || "N/A", 
            sim_pDraw: safeSim.pDraw?.toFixed(1) || "N/A", 
            sim_pAway: safeSim.pAway?.toFixed(1) || "N/A",
            sim_mainTotalsLine: safeSim.mainTotalsLine || "N/A", 
            sim_pOver: safeSim.pOver?.toFixed(1) || "N/A",
            // === ÚJ v124.1: TOP SCORE ADATOK ===
            sim_topScore: topScoreString,
            sim_topScoreProb: topScoreProb,
            sim_mu_h: safeSim.mu_h_sim?.toFixed(2) || "N/A",
            sim_mu_a: safeSim.mu_a_sim?.toFixed(2) || "N/A",
            // ====================================
            modelConfidence: safeModelConfidence.toFixed(1), 
            expertConfidence: expertConfidence || "N/A",
            riskAssessment: riskAssessment || "N/A",
            microSummary: microSummary,
            strategicClosingThoughts: strategicClosingThoughts || "N/A",
            tacticalBriefing: tacticalBriefing || "N/A",
            psychologistReportJson: JSON.stringify(psyReport, null, 2), 
            specialistReportJson: JSON.stringify(specialistReport, null, 2)
        };

        // GOD MODE PROMPT HASZNÁLATA
        let template = MASTER_AI_PROMPT_TEMPLATE_GOD_MODE;
        if (sport === 'hockey') {
            template = template.replace(/BTTS, /g, ""); 
        }
        
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        // === VÁLASZ VALIDÁCIÓ ===
        if (!rec || (!rec.primary && !rec.recommended_bet)) {
            throw new Error("Master AI hiba: Érvénytelen válasz struktúra.");
        }
        
        // Struktúra normalizálás (régi formátum támogatása)
        if (!rec.primary) {
            rec = {
                primary: { 
                    market: rec.recommended_bet || "Nincs tipp", 
                    confidence: rec.final_confidence || 1.0, 
                    reason: rec.brief_reasoning || "Nincs indoklás" 
                },
                secondary: { 
                    market: "Nincs második tipp", 
                    confidence: 0, 
                    reason: "Az AI egyetlen tippet generált." 
                },
                verdict: rec.verdict || "Nem érkezett szöveges ítélet.",
                betting_strategy: {},
                key_risks: [],
                why_not_alternatives: "Nincs adat"
            };
        }

        // === BIZTONSÁGI ELLENŐRZÉSEK ===
        // 1. Confidence számok validálása
        if (typeof rec.primary.confidence !== 'number' || isNaN(rec.primary.confidence)) {
            console.warn("[AI_Service v124.0] Elsődleges confidence érvénytelen, alapértelmezett: 5.0");
            rec.primary.confidence = 5.0;
        }
        if (typeof rec.secondary?.confidence !== 'number' || isNaN(rec.secondary.confidence)) {
            console.warn("[AI_Service v124.0] Másodlagos confidence érvénytelen, alapértelmezett: 0");
            rec.secondary.confidence = 0;
        }

        // 2. Indoklás ellenőrzés
        if (!rec.primary.reason || rec.primary.reason.length < 50) {
            console.warn("[AI_Service v124.0] Túl rövid indoklás az elsődleges tippnél!");
            rec.primary.reason = (rec.primary.reason || "") + "\n[FIGYELEM: Az AI nem adott részletes indoklást.]";
        }

        // === MATEMATIKAI GUARDRAILS (KORREKCIÓS LOGIKA) - v125.0 FINOMHANGOLVA ===
        // MÓDOSÍTÁS (v125.0): Kevésbé konzervatív penalty rendszer
        const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
        const disagreementThreshold = 3.0; // Unchanged (jó érték)
        let confidencePenalty = 0;
        let disagreementNote = "";
        
        // 1. Negatív narratíva + magas confidence esetén büntetés (SZIGORÍTVA)
        if (expertConfScore < 1.5 && rec.primary.confidence > 5.0) { // 2.0 → 1.5 (szigorúbb)
            confidencePenalty = Math.max(0, rec.primary.confidence - 3.5);
            disagreementNote = "\n\n⚠️ KORREKCIÓ: A narratív elemzés negatív, ezért a bizalom csökkentve.";
        }
        // 2. Matematikai és narratív ellentmondás (ENYHÍTVE v125.0)
        else if (confidenceDiff > disagreementThreshold) {
            confidencePenalty = Math.min(2.0, confidenceDiff / 2.0); // 1.5 → 2.0, max 2.5 → 2.0 (kisebb büntetés)
            disagreementNote = `\n\n⚠️ KORREKCIÓ: Statisztikai vs narratív ellentmondás (${confidenceDiff.toFixed(1)} pont különbség).`;
        }
        // 3. Túl magas confidence általában (ENYHÍTVE v125.0)
        else if (rec.primary.confidence > 9.5 && safeModelConfidence < 8.0) {
            confidencePenalty = 0.7; // 1.0 → 0.7 (kisebb büntetés)
            disagreementNote = "\n\n⚠️ KORREKCIÓ: Túlzottan optimista értékelés, realisztikus szintre módosítva.";
        }
        
        rec.primary.confidence -= confidencePenalty;
        rec.primary.confidence = Math.max(1.0, Math.min(10.0, rec.primary.confidence));
        
        // === VERDICT BEOLVASZTÁS ===
        if (rec.verdict) {
            rec.primary.reason = (rec.primary.reason || "") + `\n\n💡 **A LÉNYEG:** ${rec.verdict}` + disagreementNote;
        } else {
            rec.primary.reason = (rec.primary.reason || "") + disagreementNote;
        }

        // === MÁSODLAGOS TIPP VALIDÁCIÓ ===
        if (rec.secondary && rec.secondary.confidence > 8.0 && safeModelConfidence < 4.5) {
             rec.secondary.confidence -= 2.0;
             rec.secondary.reason = (rec.secondary.reason || "") + "\n⚠️ (Kockázatosabb opció - alacsony modell bizalom)";
        }

        // === VISSZAMENŐLEGES KOMPATIBILITÁS ===
        rec.recommended_bet = rec.primary.market;
        rec.final_confidence = rec.primary.confidence;
        rec.brief_reasoning = rec.primary.reason;

        console.log(`[AI_Service v124.0 - Főnök] GOD MODE V2 Tipp generálva.`);
        console.log(`  - Elsődleges: ${rec.primary.market} (Bizalom: ${rec.primary.confidence.toFixed(1)}/10)`);
        console.log(`  - Másodlagos: ${rec.secondary?.market || "Nincs"} (${rec.secondary?.confidence?.toFixed(1) || 0}/10)`);
        console.log(`  - Ítélet: ${rec.verdict?.substring(0, 80)}...`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v123.0 - Főnök] Hiba: ${e.message}`, e.stack);
        return { 
            recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: `Hiba: ${e.message}`,
            primary: { market: "Hiba", confidence: 1.0, reason: "Hiba" },
            secondary: { market: "Hiba", confidence: 0.0, reason: "Hiba" }
        };
    }
}


// --- FŐ ORCHESTRÁCIÓS LÉPÉS ---
export async function runStep_FinalAnalysis(data: any): Promise<any> {
    
    const { rawDataJson, specialistReport, simulatorReport, psyReport, valueBetsJson, richContext, matchData, sportStrategy, confidenceScores } = data;
    const sim = simulatorReport || {};
    const home = matchData.home || 'Hazai';
    const away = matchData.away || 'Vendég';
    const sport = matchData.sport || 'soccer';
    
    let expertConfidence = "Hiba";
    let riskAssessment = "Hiba";
    let tacticalBriefing = "Hiba";
    let generalAnalysis = "Hiba";
    let propheticTimeline = "N/A";
    let strategic_synthesis = "Hiba";
    let masterRecommendation = { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    let microAnalyses: { [key: string]: string } = {};
    let keyPlayersReport: any = null;
    
    try {
        // === ÚJ: KEY PLAYERS ANALYST HÍVÁSA ===
        console.log(`[AI_Service v124.0] Key Players Analyst futtatása...`);
        try {
            keyPlayersReport = await runStep_KeyPlayersAnalyst({
                rawDataJson: rawDataJson,
                home: home,
                away: away
            });
            console.log(`[AI_Service v124.0] Key Players Analyst kész: ${keyPlayersReport?.key_players_summary?.substring(0, 80)}...`);
        } catch (e: any) {
            console.error(`[AI_Service v124.0] Key Players Analyst hiba: ${e.message}`);
            keyPlayersReport = { key_players_summary: "Hiba a játékos elemzésben" };
        }
        
        const expertConfidencePromise = getExpertConfidence(confidenceScores, richContext, rawDataJson, psyReport, specialistReport, keyPlayersReport);
        const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport, confidenceScores);
        const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext);

        let sportSpecificPromises: Promise<any>[] = [];
        
        if (sport === 'soccer') {
            sportSpecificPromises = [
                getBTTSAnalysis(sim, rawDataJson),
                getSoccerGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 2.5),
                getCornerAnalysis(sim, rawDataJson),
                getCardAnalysis(sim, rawDataJson)
            ];
        } else if (sport === 'hockey') {
            sportSpecificPromises = [
                getHockeyGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 6.5),
                getHockeyWinnerAnalysis(sim, rawDataJson)
            ];
        } else if (sport === 'basketball') {
             sportSpecificPromises = [
                getAndParse(BASKETBALL_WINNER_PROMPT, { sim_pHome: sim.pHome, sim_pAway: sim.pAway }, "basketball_winner_analysis", "Bask.Winner"),
                getAndParse(BASKETBALL_TOTAL_POINTS_PROMPT, { line: sim.mainTotalsLine, sim_pOver: sim.pOver, sim_mu_sum: (sim.mu_h_sim+sim.mu_a_sim) }, "basketball_total_points_analysis", "Bask.Totals")
             ];
        }

        const results = await Promise.allSettled([
            expertConfidencePromise, 
            riskAssessmentPromise, 
            playerMarketsPromise, 
            ...sportSpecificPromises
        ]);

        expertConfidence = (results[0].status === 'fulfilled') ? (results[0].value as string) : "Hiba";
        riskAssessment = (results[1].status === 'fulfilled') ? (results[1].value as string) : "Hiba";
        microAnalyses['player_market_analysis'] = (results[2].status === 'fulfilled') ? (results[2].value as string) : "Hiba";

        if (sport === 'soccer') {
            microAnalyses['btts_analysis'] = (results[3].status === 'fulfilled') ? (results[3].value as string) : "Hiba";
            microAnalyses['goals_ou_analysis'] = (results[4].status === 'fulfilled') ? (results[4].value as string) : "Hiba";
            microAnalyses['corner_analysis'] = (results[5].status === 'fulfilled') ? (results[5].value as string) : "Hiba";
            microAnalyses['card_analysis'] = (results[6].status === 'fulfilled') ? (results[6].value as string) : "Hiba";
        } else if (sport === 'hockey') {
            microAnalyses['hockey_goals_ou_analysis'] = (results[3].status === 'fulfilled') ? (results[3].value as string) : "Hiba";
            microAnalyses['hockey_winner_analysis'] = (results[4].status === 'fulfilled') ? (results[4].value as string) : "Hiba";
        }

        try { tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment); } catch (e) {}
        try { generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, confidenceScores, psyReport); } catch (e) {}
        
        if (sport === 'soccer') {
            try { propheticTimeline = await getPropheticTimeline(rawDataJson, home, away, sport, tacticalBriefing); } catch (e) {}
        }

        try { strategic_synthesis = await getStrategicClosingThoughts(sim, rawDataJson, richContext, microAnalyses, riskAssessment, tacticalBriefing, valueBetsJson, confidenceScores, expertConfidence, psyReport, specialistReport, sport); } catch (e) {}

        // 4. A "FŐNÖK" HÍVÁSA (GOD MODE V2.0)
        console.log(`[AI_Service v124.0] Master Recommendation (Főnök) futtatása...`);
        masterRecommendation = await getMasterRecommendation(
            valueBetsJson, 
            sim, 
            confidenceScores, 
            expertConfidence, 
            riskAssessment, 
            microAnalyses, 
            generalAnalysis, 
            strategic_synthesis, 
            "N/A", // contradictionAnalysisResult (deprecated)
            psyReport, 
            specialistReport, 
            sport,
            tacticalBriefing,  // ÚJ paraméter
            keyPlayersReport   // ÚJ paraméter
        );

    } catch (e: any) {
        console.error(`[AI_Service v124.0] KRITIKUS HIBA a Final Analysis-ben: ${e.message}`);
        masterRecommendation.brief_reasoning = `KRITIKUS HIBA: ${e.message}`;
    }
    
    return {
        risk_assessment: riskAssessment,
        tactical_briefing: tacticalBriefing,
        general_analysis: generalAnalysis,
        strategic_synthesis: strategic_synthesis,
        prophetic_timeline: propheticTimeline,
        final_confidence_report: expertConfidence,
        micromodels: microAnalyses,
        master_recommendation: masterRecommendation, 
        agent_reports: { 
            psychologist: psyReport, 
            specialist: specialistReport,
            key_players: keyPlayersReport  // ÚJ: Key Players Analyst report hozzáadása
        }
    };
}

// --- CHAT FUNKCIÓ (Változatlan) ---
export async function getChatResponse(context: string, history: any[], question: string): Promise<{ answer?: string; error?: string }> {
    if (!context || !question) return { error: "Hiányzó adatok." };
    try {
        const historyString = (history || []).map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`).join('\n');
        const prompt = `You are an elite sports analyst AI. Context:\n${context}\nHistory:\n${historyString}\nUser Question: ${question}\nAnswer concisely in Hungarian.`;
        const rawAnswer = await _callGemini(prompt, false); 
        return rawAnswer ? { answer: rawAnswer } : { error: "Hiba." };
    } catch (e: any) { return { error: e.message }; }
}
