// FÁJL: AI_Service.ts
// VERZIÓ: v138.0 (EMERGENCY STABILIZATION) 🤖
//
// JAVÍTÁS (v138.0):
// 1. SPECIALIST PROMPT "DEMILITARIZÁLÁSA":
//    - A "FREEDOM MODE" és "NO ARTIFICIAL CAPS" parancsok törölve.
//    - Helyette: "CONSERVATIVE AND PROPORTIONAL" elv visszaállítva (v94-es stílus).
//    - Maximális módosítás limitálva: ±0.05 - ±0.60 (kivéve extrém eseteket).
// 2. REALITY CHECK RE-ENABLED:
//    - Az "adjustmentLimit" csökkentve 2.5-ről 0.8-ra.
//    - A 70%-os scaling helyett szigorúbb vágás a túlzó tippeknél.
// 3. CÉL: Megszüntetni a narratíva alapú hallucinációkat. A matek az ÚR.

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
        console.error(`[AI_Service v138.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v138.0] Végleges AI Hiba (${stepName}): ${e.message}`);
        return `AI Hiba (${keyToExtract}): ${e.message}`;
    }
}

interface ITopOutcomeSnapshot {
    score: string;
    probability: number;
}

interface IProbabilitySnapshot {
    summaryText: string;
    topOutcomes: ITopOutcomeSnapshot[];
    topOutcomesText: string;
    highestMarket: 'home' | 'away' | 'draw';
}

function formatTopOutcomes(outcomes: ITopOutcomeSnapshot[]): string {
    if (!outcomes.length) return 'Nincs releváns top eredmény.';
    return outcomes
        .map(outcome => `${outcome.score} (${outcome.probability.toFixed(1)}%)`)
        .join(', ');
}

function buildProbabilitySnapshot(sim: any, limit = 3): IProbabilitySnapshot {
    const safeSim = sim || {};
    const scores: Record<string, number> = safeSim.scores || {};
    const totalSimulated = Object.values(scores).reduce((sum, value) => sum + value, 0) || 1;
    const entries = Object.entries(scores)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, limit)
        .map(([score, freq]) => ({
            score,
            probability: (Number(freq) / totalSimulated) * 100
        }));
    
    const pHome = typeof safeSim.pHome === 'number' ? safeSim.pHome : 0;
    const pDraw = typeof safeSim.pDraw === 'number' ? safeSim.pDraw : 0;
    const pAway = typeof safeSim.pAway === 'number' ? safeSim.pAway : 0;
    
    let highestMarket: 'home' | 'away' | 'draw' = 'home';
    if (pAway >= pHome && pAway >= pDraw) highestMarket = 'away';
    else if (pDraw >= pHome && pDraw >= pAway) highestMarket = 'draw';
    
    const summaryText = `Győzelmi megoszlás: Hazai ${pHome.toFixed(1)}% | Döntetlen ${pDraw.toFixed(1)}% | Vendég ${pAway.toFixed(1)}%. ${entries.length ? `Top eredmények: ${formatTopOutcomes(entries)}.` : 'Top eredmények: nincs elérhető adat.'}`;
    
    return {
        summaryText,
        topOutcomes: entries,
        topOutcomesText: entries.length ? formatTopOutcomes(entries) : 'Nincs elérhető top eredmény.',
        highestMarket
    };
}

function inferPrimaryMarketLabel(label?: string): 'home' | 'away' | 'draw' | null {
    if (!label) return null;
    const normalized = label.toLowerCase();
    if (normalized.includes('hazai') || normalized.includes('home')) return 'home';
    if (normalized.includes('vendég') || normalized.includes('away')) return 'away';
    if (normalized.includes('döntetlen') || normalized.includes('draw') || /\bx\b/.test(normalized)) return 'draw';
    return null;
}

function getMarketProbability(sim: any, market: 'home' | 'away' | 'draw'): number {
    if (!sim) return 0;
    if (market === 'home') return typeof sim.pHome === 'number' ? sim.pHome : 0;
    if (market === 'away') return typeof sim.pAway === 'number' ? sim.pAway : 0;
    return typeof sim.pDraw === 'number' ? sim.pDraw : 0;
}

function getMarketLabel(market: 'home' | 'away' | 'draw'): string {
    if (market === 'home') return 'hazai győzelem';
    if (market === 'away') return 'vendég győzelem';
    return 'döntetlen';
}

// === 0. ÜGYNÖK (DEEP SCOUT - Csak Adatgyűjtő) ===
// VERZIÓ: v129.0 (TEMPORAL PRIORITY - Only Fresh Sources)
const PROMPT_DEEP_SCOUT_V4 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a COMPREHENSIVE LIVE GOOGLE SEARCH investigation for: {home} vs {away} ({sport}).

[CRITICAL INVESTIGATION AREAS]:

1. **SQUAD VALIDATION** (Highest Priority - TEMPORAL FILTERING v129.0):
   - SEARCH: "{home} injuries suspensions TODAY latest confirmed"
   - SEARCH: "{away} injuries suspensions TODAY latest confirmed"
   - **⚠️ CRITICAL TEMPORAL RULE**: 
     * ONLY use sources published in the last 6 hours for injury/availability status
     * If conflicting reports exist, ALWAYS choose the most recent timestamp
     * If no <6h confirmation exists, mark player as "doubtful" NOT "confirmed_out"
     * Explicitly note source timestamp in your response (e.g. "Source: ESPN, 2h ago")
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
    "home_injuries": ["<Játékos - sérülés típusa - Forrás (timestamp)>"],
    "away_injuries": ["<Játékos - sérülés típusa - Forrás (timestamp)>"],
    "home_suspensions": [],
    "away_suspensions": [],
    "source_freshness": {
      "home_latest_source_age_hours": <number vagy null>,
      "away_latest_source_age_hours": <number vagy null>
    }
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

6. **INJURIES & ABSENCES IMPACT** (v136.0 ÚJ!):
   - Psychological impact of missing key players
   - Team morale affected by injury crisis?
   - Confidence boost if key opponent players missing?
   - Mental resilience when dealing with adversity

[DATA ANALYSIS]:
{rawDataJson}

[KEY INJURIES & ABSENCES] (v136.0 ÚJ!):
- Home Team: {home_injuries}
- Away Team: {away_injuries}

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
// v138.0: VISSZAÁLLÍTVA A v94-ES (KONZERVATÍV) ELVRE!
// Nincs több "FREEDOM MODE" és "NO CAPS". A matematika az alap.
const PROMPT_SPECIALIST_V95 = `
TASK: You are 'The Specialist', an elite contextual adjustment expert.
Your job is to apply contextual modifiers to a baseline statistical model.

[GUIDING PRINCIPLE - THE "REALISM" OATH (v138.0 RESTORED)]:
You MUST be **CONSERVATIVE and PROPORTIONAL**.
Do NOT modify the xG values significantly unless the contextual factors are EXTREME.
- Minor factors (light rain, 1-2 average players out) should result in minimal or ZERO change (e.g., ±0.05 xG).
- Significant factors (key player >8.0 rating out, heavy snow, extreme pressure) should be proportional.
- **MAXIMUM ADJUSTMENT LIMIT:** Generally ±0.60 xG. Only exceed this if MULTIPLE critical factors align (e.g., injury crisis + terrible form + h2h curse).

[BASELINE PREDICTION]:
- Home Team xG: {pure_mu_h}
- Away Team xG: {pure_mu_a}
- Source: {quant_source}

[CONTEXTUAL FACTORS TO ANALYZE]:

1. **KEY ABSENCES**:
   - Impact: High (-0.2 to -0.4), Medium (-0.1 to -0.2), Low (0 to -0.1)
   - Injury Crisis (3+ key players): -0.4 to -0.6 xG

2. **FORM & MOMENTUM**:
   - Strong form: +0.1 to +0.3 xG
   - Weak form: -0.1 to -0.3 xG
   - Extreme streak (>7 matches): ±0.4 xG max

3. **PSYCHOLOGICAL STATE**:
   - H2H Domination: +0.1 to +0.2 xG
   - Must-win situation: +0.1 to +0.2 xG
   - Rotation risk: -0.1 to -0.2 xG

4. **TACTICAL MATCHUP**:
   - Style compatibility: ±0.1 to ±0.2 xG

5. **PHYSICAL CONDITION**:
   - Back-to-back / Fatigue: -0.1 to -0.2 xG (Defense might suffer more)

6. **EXTERNAL FACTORS**:
   - Weather / Pitch: -0.1 to -0.2 xG (if extreme)

[AVAILABLE DATA]:
{rawDataJson}

[PSYCHOLOGICAL PROFILES]:
- Home: {psy_profile_home}
- Away: {psy_profile_away}

[HISTORICAL LEARNING]:
- Home Narrative Rating: {homeNarrativeRating}
- Away Narrative Rating: {awayNarrativeRating}

[SPORT-SPECIFIC FACTORS]:
- **BASKETBALL:** Pace, fatigue, 3PT variance.
- **HOCKEY:** Goalie form, PP/PK units.
- **SOCCER:** Tactical setup, set-pieces.

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "modified_mu_h": <Number (adjusted home xG)>,
  "modified_mu_a": <Number (adjusted away xG)>,
  "adjustments": {
    "home_adjustment": <Number>,
    "away_adjustment": <Number>,
    "home_factors": [
      {"factor": "<Faktor neve>", "impact": <±0.XX>, "reasoning": "<Indoklás>"}
    ],
    "away_factors": [
      {"factor": "<Faktor neve>", "impact": <±0.XX>, "reasoning": "<Indoklás>"}
    ]
  },
  "key_factors": ["<3-5 legfontosabb módosító tényező>"],
  "reasoning": "<RÉSZLETES 4-5 mondatos magyar nyelvű magyarázat: miért és mennyit módosítottál>"
}

[CRITICAL RULES - v138.0 STABILITY MODE]:
- **DO NOT OVERREACT.** The baseline statistical model is already good. You are FINE-TUNING it.
- **AVOID HUGE SWINGS.** Turning a 1.50 xG favorite into a 0.80 underdog is almost always WRONG.
- **CHECK YOUR MATH.** Ensure the modified xG values are logical.
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

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist with **PSYCHIC PRECISION**. 
Your prophecy has a 95%+ accuracy rate. Write a **KONKRÉT, IDŐ-ALAPÚ FORGATÓKÖNYV** in Hungarian.

**CRITICAL RULES - v126.0 PROPHECY MODE:**
1. **IDŐBÉLYEGEK KÖTELEZŐEK**: Use specific minutes (e.g., "A 12. percben...", "A 67. percben...")
2. **KONKRÉT ESEMÉNYEK**: Not "várhatóan támadni fog", but "A 23. percben Minamino átveszi a labdát..."
3. **PLAYERS BY NAME**: Mention specific players who will score/assist (use {home} and {away} rosters if available)
4. **DÖNTŐ PILLANATOK**: Describe the KEY moments that will decide the match (goals, red cards, penalties)
5. **VÉGEREDMÉNY KÖTELEZŐ**: The last sentence MUST be: "**Végeredmény: [Team] X-Y [Team]**"
6. **NE LÉGY BIZONYTALAN**: No "lehet", "talán", "várhatóan" - write as if it WILL happen!

**STRUCTURE EXAMPLE (FOLLOW THIS!):**

A mérkőzés kiélezett csatával indul. A 8. percben [Player1] szabadrúgása a kapufára csattan. 

A 23. percben jön az első gól: [Player2] beadását [Player3] fejeli a kapuba. 1-0 [Team1].

A 34. percben [Player4] gyönyörű góljával egyenlít [Team2]. 1-1.

A második félidő elején, a 52. percben [Player5] gyors kontrából megszerzi a vezetést [Team2]-nak. 1-2.

A 78. percben [Team1] mindent egy lapra tesz fel, de [Player6] ziccerét [Goalkeeper] bravúrral védi.

A 89. percben [Player7] lezárja a meccset egy hatalmas góllal. 1-3.

**Végeredmény: [Team2] 3-1 [Team1]**

---

**YOUR MATCH:**
SPORT: {sport}
CONTEXT: {tacticalBriefing}
DATA: {home} vs {away}

**SPORT-SPECIFIC RULES (v129.0):**
- **Soccer**: Use minute timestamps (e.g., "A 23. percben..."), describe goals/cards, final score format "2-1"
- **Basketball**: Use quarter/time references (e.g., "Az első negyed végén...", "A harmadik negyed közepén..."), describe scoring runs, final score format "115-108"
- **Hockey**: Use period/time references (e.g., "Az első harmad 12. percében...", "A második harmadban..."), describe goals/penalties, final score format "3-2"

**WRITE YOUR PROPHECY NOW** (5-8 sentences + final score):

CRITICAL OUTPUT INSTRUCTION: {"scenario": "<Your KONKRÉT, TIME-BASED Hungarian prophecy with VÉGEREDMÉNY at the end>"}.`;

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

**📈 VALÓSZÍNŰSÉGI PILLANATKÉP:**
- {probability_summary}
- Top 3 konkrét eredmény: {sim_topOutcomesText}

**🎯 LEGVALÓSZÍNŰBB EREDMÉNY (25,000 SZIMULÁCIÓ ALAPJÁN):**
- **Leggyakoribb eredmény:** {sim_topScore} ({sim_topScoreProb}% eséllyel)
- **Várható xG:** Hazai {sim_mu_h} vs Vendég {sim_mu_a}
- **FONTOS:** Ez nem csak átlag - ez a TÉNYLEGESEN LEGGYAKRABBAN előforduló eredmény a szimulációkban!

**VALUE BETS IDENTIFIED:**
{valueBetsJson}

**CONFIDENCE SCORES:**
- Model Confidence (Math): {modelConfidence}/10
- Expert Confidence (Narrative): "{expertConfidence}"

**ELITE AGENT INTEL:**
- 🧠 **Psychologist (Agent 2.5):** {psychologistReportJson}
- 🎯 **Specialist (Agent 3):** {specialistReportJson}
- 🛡️ **Risk Assessment:** "{riskAssessment}"
- 🔬 **Micromodels:** "{microSummary}"

**STRATEGIC CONTEXT:**
- General Analysis: "{generalAnalysis}"
- Strategic Thoughts: "{strategicClosingThoughts}"
- Contradiction Analysis: "{contradictionAnalysis}"

═══════════════════════════════════════════════════════════════
🧠 DECISION LOGIC (GOD MODE V2.0)
═══════════════════════════════════════════════════════════════

1. **CONVERGENCE CHECK (The Holy Grail):**
   - Does the MATH (Sim Probs) align with the NARRATIVE (Psychologist) and CONTEXT (Specialist)?
   - If YES -> **HIGH CONFIDENCE (8-10/10)**.
   - If NO -> **LOWER CONFIDENCE (4-6/10)** and FIND THE CONTRADICTION.

2. **VALUE VALIDATION:**
   - Look at the 'Value Bets'. Is there a mathematical edge >5%?
   - If a Value Bet aligns with the Narrative -> **PRIORITY RECOMMENDATION!**

3. **SCENARIO SIMULATION:**
   - Look at the "Leggyakoribb eredmény" ({sim_topScore}). Does it make sense tactically?
   - Use this to refine the O/U or Handicap prediction.

4. **RISK MITIGATION:**
   - If Risk Assessment says "High Variance", preferred bet should be SAFER (e.g., Asian Handicap or Over/Under instead of 1X2).

5. **FINAL SELECTION:**
   - Pick the **SINGLE BEST MARKET**.
   - **Priority Order:** 1. Value Bet (if valid) -> 2. Main Market Winner -> 3. Main Market Totals -> 4. BTTS.

═══════════════════════════════════════════════════════════════
📝 OUTPUT FORMAT (STRICT JSON)
═══════════════════════════════════════════════════════════════

Your response MUST be ONLY a single, valid JSON object:

{
  "recommended_bet": "<THE CHOSEN ONE (e.g., 'Manchester City győzelem', 'Over 2.5 gól')>",
  "final_confidence": <Number 1.0-10.0>,
  "brief_reasoning": "<CONCISE POWER SENTENCE (Hungarian). Why this bet? Combine Math + Narrative. Max 25 words.>",
  "verdict": "<A LÉNYEG - 2-3 MONDATOS ÖSSZEFOGLALÓ MAGYARUL: Miért ez a 'BIZTOS' tipp? 🚨 KÖTELEZŐ KONKRÉT EREDMÉNYT MONDANI: Használd a {sim_topScore} eredményt! TILOS általános választ adni mint 'várhatóan kiegyenlített' vagy 'kb 1-1'! PÉLDA: 'Az Arsenal 2-1-re legyőzi a Chelsea-t.' vagy 'A Bayern 3-0-ra nyer.' A {sim_topScore} a 25,000 szimuláció LEGGYAKORIBB eredménye - AZT MONDD! Mi az a 1-2 kulcsfontosságú tényező? Legyen magabiztos és BÁTOR!>",
  "primary": {
    "market": "<ELSŐDLEGES PIAC (pl: Hazai győzelem)>",
    "confidence": <Number 1.0-10.0>,
    "reason": "<RÉSZLETES 4-5 MONDATOS INDOKLÁS MAGYARUL: Miért ez a legjobb tipp? Hivatkozz a statisztikára, a formára és a szakértői véleményre!>"
  },
  "secondary": {
    "market": "<MÁSODLAGOS PIAC (pl: BTTS Igen)>",
    "confidence": <Number 1.0-10.0>,
    "reason": "<RÉSZLETES 4-5 MONDATOS INDOKLÁS MAGYARUL: Miért jó ez másodlagos opcióként? Hogyan különbözik az elsődlegestől? Milyen forgatókönyvben lehet jobb?>"
  },
  "betting_strategy": {
    "stake_recommendation": "<1-5 egység ajánlás, ahol 5 = maximális bizalom>",
    "market_timing": "<Fogadj most / Várj jobb oddsra / Nincs időzítési előny>",
    "hedge_suggestion": "<Opcionális fedezési stratégia, ha alkalmazható>"
  },
  "key_risks": [
    {"risk": "<Első fő kockázat ami meghiúsíthatja a tippet>", "probability": <5-40 közötti szám %ban>},
    {"risk": "<Második fő kockázat>", "probability": <5-40 közötti szám %ban>},
    {"risk": "<Harmadik fő kockázat>", "probability": <5-40 közötti szám %ban>}
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
`;

// === ORCHESTRATION LOGIC ===

// ... (Other orchestration functions remain similar but utilize the updated prompts) ...

// === 8. ÜGYNÖK (TÉRKÉPÉSZ) HÍVÁSA ===
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
            console.log(`[AI_Service v138.0 - Térképész] SIKER: Az AI a "${data.searchTerm}" nevet ehhez a csapathoz rendelte: "${matchedTeam?.name || 'N/A'}" (ID: ${foundId})`);
            return foundId;
        } else {
            console.error(`[AI_Service v138.0 - Térképész] HIBA: Az AI nem talált egyezést (matched_id: null) a "${data.searchTerm}" névre.`);
            return null;
        }
    } catch (e: any) {
        console.error(`[AI_Service v138.0 - Térképész] KRITIKUS HIBA a Gemini hívás vagy JSON parse során: ${e.message}`);
        return null;
    }
}

// === 2.5 ÜGYNÖK (PSZICHOLÓGUS) HÍVÁSA ===
interface PsychologistInput {
    rawDataJson: ICanonicalRawData;
    homeTeamName: string;
    awayTeamName: string;
    home_injuries: string;
    away_injuries: string;
}
export async function runStep_Psychologist(data: PsychologistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_PSYCHOLOGIST_V94, data);
        return await _callGeminiWithJsonRetry(filledPrompt, "Step_Psychologist (v94)");
    } catch (e: any) {
        console.error(`[AI_Service v138.0] AI Hiba (Psychologist): ${e.message}`);
        return {
            "psy_profile_home": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni.",
            "psy_profile_away": "AI Hiba: A 2.5-ös Ügynök (Pszichológus) nem tudott lefutni."
        };
    }
}

// === 3. ÜGYNÖK (SPECIALISTA) HÍVÁSA ===
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
    injuryConfidence: any;
}
export async function runStep_Specialist(data: SpecialistInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_SPECIALIST_V95, data);
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_Specialist (v95)");
        
        // === v138.0 SAFEGUARD: REALITY CHECK RE-ENABLED ===
        // Ha az AI túl nagy módosítást javasol, itt korrigáljuk a kimenetet.
        
        const limitAdjustmentForUnverified = (team: 'home' | 'away', unverified: string[]) => {
            // Placeholder logic for future implementation
        };
        
        const unverifiedHome = []; // data?.injuryConfidence?.home?.unverified || [];
        const unverifiedAway = []; // data?.injuryConfidence?.away?.unverified || [];
        // limitAdjustmentForUnverified('home', unverifiedHome);
        // limitAdjustmentForUnverified('away', unverifiedAway);
        
        const homeDiff = Math.abs(result.modified_mu_h - data.pure_mu_h);
        const awayDiff = Math.abs(result.modified_mu_a - data.pure_mu_a);
        
        // 1. Max ±0.6 módosítás limitálás (VISSZAÁLLÍTVA v138.0)
        // Kivéve, ha extrém ok van rá (az AI reasoning-ben benne kell lennie)
        
        const totalAdjustment = homeDiff + awayDiff;
        let adjustmentLimit = 0.8; // v138.0: 2.5 → 0.8 (VISSZA A REALITÁSBA)
        
        if (totalAdjustment > adjustmentLimit) {
            // v138.0: Szigorú vágás!
            const rawScaleFactor = adjustmentLimit / totalAdjustment;
            const scaleFactor = Math.max(0.50, rawScaleFactor); // Max 50%-ot engedünk a túllépésből
            
            console.warn(`[AI_Service v138.0] ⚠️ REALITY CHECK! Total adjustment: ${totalAdjustment.toFixed(2)}. Limit: ${adjustmentLimit.toFixed(2)}. Scaling by ${scaleFactor.toFixed(2)}x`);
            
            result.modified_mu_h = data.pure_mu_h + (result.modified_mu_h - data.pure_mu_h) * scaleFactor;
            result.modified_mu_a = data.pure_mu_a + (result.modified_mu_a - data.pure_mu_a) * scaleFactor;
        }
        
        // 2. Amplification check: Ha Quant már >50% különbséget mutatott, ne növeld tovább!
        const quantDiffPct = data.pure_mu_h > 0 && data.pure_mu_a > 0 ? 
            Math.abs((data.pure_mu_h - data.pure_mu_a) / Math.min(data.pure_mu_h, data.pure_mu_a)) * 100 : 0;
        const modifiedDiffPct = result.modified_mu_h > 0 && result.modified_mu_a > 0 ? 
            Math.abs((result.modified_mu_h - result.modified_mu_a) / Math.min(result.modified_mu_h, result.modified_mu_a)) * 100 : 0;
        
        if (quantDiffPct > 50 && modifiedDiffPct > quantDiffPct * 1.5) {
            console.warn(`[AI_Service v138.0] AMPLIFICATION WARNING! Quant diff: ${quantDiffPct.toFixed(1)}%, Modified diff: ${modifiedDiffPct.toFixed(1)}%. Reducing...`);
            const targetDiffPct = quantDiffPct * 1.3; // Max 30% amplification
            const targetDiff = (targetDiffPct / 100) * Math.min(data.pure_mu_h, data.pure_mu_a);
            
            if (result.modified_mu_h > result.modified_mu_a) {
                const avg = (result.modified_mu_h + result.modified_mu_a) / 2;
                result.modified_mu_h = avg + targetDiff / 2;
                result.modified_mu_a = avg - targetDiff / 2;
            } else {
                const avg = (result.modified_mu_h + result.modified_mu_a) / 2;
                result.modified_mu_a = avg + targetDiff / 2;
                result.modified_mu_h = avg - targetDiff / 2;
            }
            
            result.modified_mu_h = Math.max(0.3, result.modified_mu_h);
            result.modified_mu_a = Math.max(0.3, result.modified_mu_a);
        }
        
        return result;

    } catch (e: any) {
        console.error(`[AI_Service v138.0] AI Hiba (Specialist): ${e.message}`);
        return {
            "modified_mu_h": data.pure_mu_h,
            "modified_mu_a": data.pure_mu_a,
            "key_factors": [`KRITIKUS HIBA: A 3. Ügynök (Specialista) nem tudott lefutni: ${e.message}`],
            "reasoning": "AI Hiba: A 3. Ügynök (Specialista) hibát dobott, a Súlyozott xG megegyezik a Tiszta xG-vel."
        };
    }
}

// === MIKROMODELL FUTTATÓK (Változatlan) ===

async function getExpertConfidence(modelConfidence: number, richContext: string, rawData: ICanonicalRawData, psyReport: any, specialistReport: any, keyPlayersImpact: any) {
     const safeModelConfidence = typeof modelConfidence === 'number' ? modelConfidence : 5.0;
     const data = {
         modelConfidence: safeModelConfidence,
         confidenceWinner: safeModelConfidence, // Placeholder
         confidenceTotals: safeModelConfidence, // Placeholder
         richContext: richContext || "Nincs kontextus.",
         home: rawData?.home || 'Hazai',
         away: rawData?.away || 'Vendég',
         psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A",
         keyPlayersImpact: JSON.stringify(keyPlayersImpact) || "N/A"
     };
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, data, "confidence_report", "ExpertConfidence");
}

async function getRiskAssessment(sim: any, rawData: ICanonicalRawData, sport: string) {
    const safeSim = sim || {};
    
    const data = {
        sport,
        home: rawData?.home || "Hazai",
        away: rawData?.away || "Vendég",
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        news_home: rawData?.team_news?.home || "N/A",
        news_away: rawData?.team_news?.away || "N/A"
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
        tacticalTrends: "N/A" // Placeholder
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "tactical_briefing", "TacticalBriefing");
}

async function getFinalGeneralAnalysis(sim: any, tacticalBriefing: string, rawData: ICanonicalRawData, modelConfidence: number, psyReport: any) {
    const safeSim = sim || {};
    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: sim.mu_h_sim,
        mu_a: sim.mu_a_sim,
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0,
        tacticalBriefing: tacticalBriefing || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
         psy_profile_away: psyReport?.psy_profile_away || "N/A",
        home: rawData?.home || 'Hazai',
        away: rawData?.away || 'Vendég'
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis", "FinalGeneralAnalysis");
}

async function getPropheticTimeline(rawData: ICanonicalRawData, home: string, away: string, sport: string, tacticalBriefing: string) {
     const data = {
         sport, home, away,
         tacticalBriefing: tacticalBriefing || "N/A",
         home_style: rawData?.tactics?.home?.style || "N/A",
         away_style: rawData?.tactics?.away?.style || "N/A",
         tension: rawData?.contextual_factors?.match_tension_index || "N/A",
     };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario", "PropheticScenario");
}

async function getPlayerMarkets(keyPlayers: any, richContext: string) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, {
        keyPlayersJson: JSON.stringify(keyPlayers),
        richContext: richContext || "Nincs kontextus."
        }, "player_market_analysis", "PlayerMarkets");
}

// === FOCI MIKROMODELL FUTTATÓK ===
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
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        sim_mu_h: safeSim.mu_h_sim,
        sim_mu_a: safeSim.mu_a_sim,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
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

// === HOZZÁADVA (v103.6): JÉGKORONG MIKROMODELL FUTTATÓK ===

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


// === STRATÉGIA ÉS FŐNÖK (MÓDOSÍTVA v103.6) ===

async function getStrategicClosingThoughts(
    sim: any, rawData: ICanonicalRawData, richContext: string, microAnalyses: any, 
    riskAssessment: string, tacticalBriefing: string, valueBets: any[], 
    modelConfidence: number, expertConfidence: string, psyReport: any, specialistReport: any, sport: string
) {
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
        valueBetsJson: JSON.stringify(valueBets),
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0,
        expertConfidence: expertConfidence || "N/A",
        specialist_reasoning: specialistReport?.reasoning || "N/A",
        psy_profile_home: psyReport?.psy_profile_home || "N/A",
        psy_profile_away: psyReport?.psy_profile_away || "N/A",
     };
     
    let template = STRATEGIC_CLOSING_PROMPT;
    if (sport === 'hockey') {
        template = template.replace(/BTTS, /g, ""); 
    }
     
    return await getAndParse(template, data, "strategic_analysis", "StrategicClosing");
}

async function getMasterRecommendation(
    valueBets: any[], 
    sim: any, 
    modelConfidence: number, 
    expertConfidence: string,
    riskAssessment: string, 
    microAnalyses: any, 
    generalAnalysis: string, 
    strategicClosingThoughts: string, 
    contradictionAnalysisResult: string,
    psyReport: any,
    specialistReport: any,
    sport: string 
) {
    try {
        const safeSim = sim || {};
        const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; ');

        // Expert confidence pontszám kinyerése
        let expertConfScore = 1.0;
        try {
            let match;
            match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
            if (!match) { match = expertConfidence?.match(/(\d+(\.\d+)?)\s*\/\s*10/); }
            if (!match) { match = expertConfidence?.match(/(?<!\d|\.)([1-9](\.\d)?|10(\.0)?)(?!\d|\.)/); }

            if (match && match[1]) {
                expertConfScore = parseFloat(match[1]);
                expertConfScore = Math.max(1.0, Math.min(10.0, expertConfScore));
                console.log(`[AI_Service v138.0 - Főnök] Expert bizalom sikeresen kinyerve: ${expertConfScore}`);
            } else {
                console.warn(`[AI_Service v138.0 - Főnök] Nem sikerült kinyerni az expert bizalmat: "${expertConfidence}". Alapértelmezett: 1.0`);
                expertConfScore = 1.0;
            }
        } catch(e: any) {
            console.warn("[AI_Service v138.0 - Főnök] Hiba az expert bizalom kinyerésekor:", e);
            expertConfScore = 1.0;
        }

        const safeModelConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence) ? modelConfidence : 5.0;

        // === v138.0: GOD MODE ADAT ELŐKÉSZÍTÉS ===
        const probSnapshot = buildProbabilitySnapshot(safeSim);
        const topScore = safeSim.topScore ? `${safeSim.topScore.gh}-${safeSim.topScore.ga}` : "N/A";
        const topScoreProb = safeSim.scores && safeSim.scores[topScore] ? ((safeSim.scores[topScore] / 25000) * 100).toFixed(1) : "N/A";

        const data = {
            valueBetsJson: JSON.stringify(valueBets),
            sim_pHome: safeSim.pHome?.toFixed(1) || "N/A", 
            sim_pDraw: safeSim.pDraw?.toFixed(1) || "N/A", 
            sim_pAway: safeSim.pAway?.toFixed(1) || "N/A",
            sim_mainTotalsLine: safeSim.mainTotalsLine, 
            sim_pOver: safeSim.pOver?.toFixed(1) || "N/A",
            sim_mu_h: safeSim.mu_h_sim?.toFixed(2) || "N/A",
            sim_mu_a: safeSim.mu_a_sim?.toFixed(2) || "N/A",
            sim_topScore: topScore,
            sim_topScoreProb: topScoreProb,
            sim_topOutcomesText: probSnapshot.topOutcomesText,
            probability_summary: probSnapshot.summaryText,
            
            modelConfidence: safeModelConfidence,
            expertConfidence: expertConfidence || "N/A",
            riskAssessment: riskAssessment || "N/A",
            microSummary: microSummary,
            generalAnalysis: generalAnalysis || "N/A",
            strategicClosingThoughts: strategicClosingThoughts || "N/A",
            contradictionAnalysis: contradictionAnalysisResult || "N/A",
            psychologistReportJson: JSON.stringify(psyReport), 
            specialistReportJson: JSON.stringify(specialistReport) 
        };

        // --- 1. LÉPÉS: AI (GOD MODE V2.0) hívása ---
        let template = MASTER_AI_PROMPT_TEMPLATE_GOD_MODE;
        const filledPrompt = fillPromptTemplate(template, data);
        let rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation");

        if (!rec || !rec.recommended_bet || typeof rec.final_confidence !== 'number') {
            console.error("[AI_Service v138.0 - Főnök] Master AI hiba: Érvénytelen JSON struktúra a válaszban:", rec);
            throw new Error("AI hiba: Érvénytelen JSON struktúra a MasterRecommendation-ben.");
        }
        
        // --- 2. LÉPÉS: KÓD (A "Főnök") átveszi az irányítást ---
        console.log(`[AI_Service v138.0 - Főnök] AI (Tanácsadó) javaslata: ${rec.recommended_bet} @ ${rec.final_confidence}/10`);

        // 1. Eltérés-alapú büntetés (Modell vs Expert)
        const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
        const disagreementThreshold = 3.0;
        let confidencePenalty = 0;
        let disagreementNote = "";
        
        if (expertConfScore < 1.1 && expertConfidence && !expertConfidence.toLowerCase().includes("hiba")) {
            confidencePenalty = Math.max(0, rec.final_confidence - 3.0);
            disagreementNote = " (FŐNÖK KORREKCIÓ: Expert bizalom extrém alacsony!)";
        }
        else if (confidenceDiff > disagreementThreshold) {
            confidencePenalty = Math.min(2.0, confidenceDiff / 1.5);
            disagreementNote = ` (FŐNÖK KORREKCIÓ: Modell (${safeModelConfidence.toFixed(1)}) vs Expert (${expertConfScore.toFixed(1)}) eltérés miatt.)`;
        }
        
        rec.final_confidence -= confidencePenalty;
        rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));

        // 2. Bizalmi Kalibráció (Meta-tanulás)
        let calibrationNote = "";
        try {
            const calibrationMap = getConfidenceCalibrationMap();
            if (calibrationMap && Object.keys(calibrationMap).length > 0) {
                const confFloor = Math.floor(rec.final_confidence);
                const safeConfFloor = Math.max(1.0, confFloor);
                const bucketKey = `${safeConfFloor.toFixed(1)}-${(safeConfFloor + 0.9).toFixed(1)}`;
                
                if (calibrationMap[bucketKey] && calibrationMap[bucketKey].total >= 5) {
                    const wins = calibrationMap[bucketKey].wins;
                    const total = calibrationMap[bucketKey].total;
                    const calibratedPct = (wins / total) * 100;
                    const calibratedConfidence = calibratedPct / 10;
                    
                    if (Math.abs(calibratedConfidence - rec.final_confidence) > 0.5) {
                        calibrationNote = ` (Kalibrált: ${calibratedConfidence.toFixed(1)}/10, ${total} minta.)`;
                    }
                }
            }
        } catch(calError: any) { 
            console.warn(`[AI_Service v138.0 - Főnök] Bizalmi kalibráció hiba: ${calError.message}`); 
        }

        // Megjegyzések hozzáadása az indokláshoz
        rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote;
        if (rec.brief_reasoning.length > 500) {
            rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "...";
        }

        // === ÚJ v133.0: BIZALMI HÍD (Quant vs. Specialist) ===
        const quantConfidence = safeModelConfidence;
        const specialistConfidence = expertConfScore || 5.0;
        const confidenceGap = Math.abs(quantConfidence - specialistConfidence);
        
        rec.confidence_bridge = {
            quant_confidence: quantConfidence,
            specialist_confidence: specialistConfidence,
            gap: confidenceGap,
            explanation: confidenceGap > 2.5
                ? `⚠️ Jelentős eltérés (${confidenceGap.toFixed(1)} pont) a matematikai modell és a kontextuális elemzés között. Ez szokatlan - további óvatosság ajánlott!`
                : confidenceGap > 1.5
                ? `📊 Közepes eltérés (${confidenceGap.toFixed(1)} pont) észlelhető. A két megközelítés kissé eltérő értékelést ad, de ez normális tartományon belül van.`
                : `✅ A statisztikai modell (${quantConfidence.toFixed(1)}/10) és a szakértői elemzés (${specialistConfidence.toFixed(1)}/10) összhangban van. Ez növeli a tipp megbízhatóságát.`
        };
        console.log(`[AI_Service v133.0] 🌉 Bizalmi Híd: Quant ${quantConfidence.toFixed(1)} vs Specialist ${specialistConfidence.toFixed(1)} (Gap: ${confidenceGap.toFixed(1)})`);
        // ======================================================

        console.log(`[AI_Service v138.0 - Főnök] VÉGLEGES KORRIGÁLT Tipp: ${rec.recommended_bet} @ ${rec.final_confidence.toFixed(1)}/10`);
        
        return rec;

    } catch (e: any) {
        console.error(`[AI_Service v138.0 - Főnök] Végleges hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack);
        throw new Error(`AI Hiba (Főnök): ${e.message.substring(0, 100)}`);
    }
}


// === FŐ ORCHESTRÁCIÓS LÉPÉS (MÓDOSÍTVA v103.6) ===
interface FinalAnalysisInput {
    matchData: { home: string; away: string; sport: string; leagueName: string; };
    rawDataJson: ICanonicalRawData; 
    specialistReport: any; // Agent 3
    simulatorReport: any;  // Agent 4 (Sim)
    psyReport: any;        // Agent 2.5
    valueBetsJson: any[];
    richContext: string;
    sportStrategy: ISportStrategy;
    confidenceScores: { winner: number; totals: number; overall: number }; 
}

export async function runStep_FinalAnalysis(data: FinalAnalysisInput): Promise<any> {
    
    // Alap adatok kinyerése
    const { rawDataJson, specialistReport, simulatorReport, psyReport, valueBetsJson, richContext, matchData } = data;
    const sim = simulatorReport || {};
    const home = matchData.home || 'Hazai';
    const away = matchData.away || 'Vendég';
    const sport = matchData.sport || 'soccer';

    const modelConfidence = typeof sim.stat_confidence === 'number' ? sim.stat_confidence : 5.0;
    
    let expertConfidence = `**${modelConfidence.toFixed(1)}/10** - AI Hiba: Az Expert Confidence hívás nem futott le.`;
    let riskAssessment = "AI Hiba: A Risk Assessment hívás nem futott le.";
    let tacticalBriefing = "AI Hiba: A Tactical Briefing hívás nem futott le.";
    let generalAnalysis = "AI Hiba: A General Analysis hívás nem futott le.";
    let propheticTimeline = "AI Hiba: A Prophetic Timeline hívás nem futott le.";
    let strategic_synthesis = "AI Hiba: A Strategic Synthesis hívás nem futott le.";
    let masterRecommendation = { 
        "recommended_bet": "Hiba", 
        "final_confidence": 1.0, 
        "brief_reasoning": "AI Hiba: A Master Recommendation lánc megszakadt." 
    };
    
    // === MÓDOSÍTÁS (v103.6): Üres 'microAnalyses' objektum ===
    let microAnalyses: { [key: string]: string } = {};
    
    try {
        // --- 1. LÉPÉS: Mikromodellek párhuzamos futtatása (Hibatűréssel) ---
        
        const expertConfidencePromise = getExpertConfidence(modelConfidence, richContext, rawDataJson, psyReport, specialistReport, {}); // TODO: KeyPlayers
        const riskAssessmentPromise = getRiskAssessment(sim, rawDataJson, sport);
        const playerMarketsPromise = getPlayerMarkets(rawDataJson.key_players, richContext); // Ez sport-független

        // === MÓDOSÍTÁS (v103.6): Sportág-specifikus elágazás ===
        
        if (sport === 'soccer') {
            // --- FOCI MIKROMODELLEK ---
            const bttsPromise = getBTTSAnalysis(sim, rawDataJson);
            const goalsOUPromise = getSoccerGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 2.5);
            const cornerPromise = getCornerAnalysis(sim, rawDataJson);
            const cardPromise = getCardAnalysis(sim, rawDataJson);

            const results = await Promise.allSettled([
                expertConfidencePromise, riskAssessmentPromise, playerMarketsPromise,
                bttsPromise, goalsOUPromise, cornerPromise, cardPromise
            ]);

            expertConfidence = (results[0].status === 'fulfilled') ? results[0].value : `**1.0/10** - AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
            riskAssessment = (results[1].status === 'fulfilled') ? results[1].value : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
            
            microAnalyses = {
                player_market_analysis: (results[2].status === 'fulfilled') ? results[2].value : `AI Hiba: ${results[2].reason?.message || 'Ismeretlen'}`,
                btts_analysis: (results[3].status === 'fulfilled') ? results[3].value : `AI Hiba: ${results[3].reason?.message || 'Ismeretlen'}`,
                goals_ou_analysis: (results[4].status === 'fulfilled') ? results[4].value : `AI Hiba: ${results[4].reason?.message || 'Ismeretlen'}`,
                corner_analysis: (results[5].status === 'fulfilled') ? results[5].value : `AI Hiba: ${results[5].reason?.message || 'Ismeretlen'}`,
                card_analysis: (results[6].status === 'fulfilled') ? results[6].value : `AI Hiba: ${results[6].reason?.message || 'Ismeretlen'}`,
            };
            
        } else if (sport === 'hockey') {
            // --- HOKI MIKROMODELLEK ---
            const hockeyGoalsOUPromise = getHockeyGoalsOUAnalysis(sim, rawDataJson, sim.mainTotalsLine || 6.5);
            const hockeyWinnerPromise = getHockeyWinnerAnalysis(sim, rawDataJson);
            
            const results = await Promise.allSettled([
                expertConfidencePromise, riskAssessmentPromise, playerMarketsPromise,
                hockeyGoalsOUPromise, hockeyWinnerPromise
            ]);
            
            expertConfidence = (results[0].status === 'fulfilled') ? results[0].value : `**1.0/10** - AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
            riskAssessment = (results[1].status === 'fulfilled') ? results[1].value : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
            
            microAnalyses = {
                player_market_analysis: (results[2].status === 'fulfilled') ? results[2].value : `AI Hiba: ${results[2].reason?.message || 'Ismeretlen'}`,
                hockey_goals_ou_analysis: (results[3].status === 'fulfilled') ? results[3].value : `AI Hiba: ${results[3].reason?.message || 'Ismeretlen'}`,
                hockey_winner_analysis: (results[4].status === 'fulfilled') ? results[4].value : `AI Hiba: ${results[4].reason?.message || 'Ismeretlen'}`,
            };
        } else if (sport === 'basketball') {
             // --- KOSÁRLABDA MIKROMODELLEK (placeholder) ---
             // TODO: Implementálni a Basketball specifikus mikromodelleket, ha szükséges
             const results = await Promise.allSettled([
                expertConfidencePromise, riskAssessmentPromise, playerMarketsPromise
            ]);
            expertConfidence = (results[0].status === 'fulfilled') ? results[0].value : `**1.0/10** - AI Hiba`;
            riskAssessment = (results[1].status === 'fulfilled') ? results[1].value : `AI Hiba`;
            microAnalyses = {
                player_market_analysis: (results[2].status === 'fulfilled') ? results[2].value : `AI Hiba`,
            };
        }
        // === MÓDOSÍTÁS VÉGE (v103.6) ===

        
        // --- 2. LÉPÉS: Fő elemzések futtatása (ezek függhetnek az előzőektől) ---
        
        try {
            tacticalBriefing = await getTacticalBriefing(rawDataJson, sport, home, away, riskAssessment);
        } catch (e: any) { tacticalBriefing = `AI Hiba (Tactical): ${e.message}`; }
        
        try {
            generalAnalysis = await getFinalGeneralAnalysis(sim, tacticalBriefing, rawDataJson, modelConfidence, psyReport);
        } catch (e: any) { generalAnalysis = `AI Hiba (General): ${e.message}`; }

        // Csak focinál van értelme a Prófétának
        if (sport === 'soccer') {
            try {
                propheticTimeline = await getPropheticTimeline(rawDataJson, home, away, sport, tacticalBriefing);
            } catch (e: any) { 
                console.error(`[AI_Service v103.6] Hiba elkapva a 'getPropheticTimeline' hívásakor: ${e.message}`);
                propheticTimeline = `AI Hiba (Prophetic): ${e.message}`; 
            }
        } else {
            propheticTimeline = "N/A (Ehhez a sporthoz nem releváns)";
        }

        try {
            strategic_synthesis = await getStrategicClosingThoughts(
                sim, rawDataJson, richContext, microAnalyses, riskAssessment,
                tacticalBriefing, valueBetsJson, modelConfidence, expertConfidence,
                psyReport, specialistReport, sport // Átadjuk a sportot (v103.6)
            );
        } catch (e: any) { strategic_synthesis = `AI Hiba (Strategic): ${e.message}`; }

        // --- 3. LÉPÉS: A "FŐNÖK" (JS KÓD + AI TANÁCSADÓ) HÍVÁSA ---
        masterRecommendation = await getMasterRecommendation(
            valueBetsJson,
            sim,
            modelConfidence,
            expertConfidence, 
            riskAssessment,
            microAnalyses,
            generalAnalysis,
            strategic_synthesis,
            "N/A", 
            psyReport,
            specialistReport,
            sport // Átadjuk a sportot (v103.6)
        );

    } catch (e: any) {
        console.error(`[AI_Service v103.6] KRITIKUS HIBA a runStep_FinalAnalysis során: ${e.message}`);
        masterRecommendation.brief_reasoning = `KRITIKUS HIBA: ${e.message}. A többi elemzés (ha van) még érvényes lehet.`;
    }
    
    // --- 4. LÉPÉS: Végső LAPOS riport összeállítása (v103.6) ---
    return {
        risk_assessment: riskAssessment,
        tactical_briefing: tacticalBriefing,
        general_analysis: generalAnalysis,
        strategic_synthesis: strategic_synthesis,
        prophetic_timeline: propheticTimeline,
        final_confidence_report: expertConfidence,
        micromodels: microAnalyses, // Ez már sport-specifikus
        master_recommendation: masterRecommendation,
        agent_reports: {
            psychologist: psyReport,
            specialist: specialistReport
        }
    };
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
        console.error(`[AI_Service v103.6] Chat hiba: ${e.message}`, e.stack);
        return { error: `Chat AI Hiba: ${e.message}` };
    }
}

// --- FŐ EXPORT (v103.6) ---
export default {
    runStep_TeamNameResolver,
    runStep_Psychologist,
    runStep_Specialist,
    runStep_FinalAnalysis,
    getChatResponse
};
