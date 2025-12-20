// FÁJL: AI_Service.ts
// VERZIÓ: v139.3 (NO LOW ODDS - PROFITABLE TIPS ONLY) 🧠
//
// JAVÍTÁS (v139.0):
// 1. PROMPTOK EGYSZERŰSÍTÉSE:
//    - Kigyomlálva a "Conservative", "Reality Check", "Defensive Match", "Caps" utasítások.
//    - Helyette: "Analyze the data and tell me the truth." (Elemezd és mondd az igazat).
//    - Az AI-ra bízzuk a súlyozást, nem mesterséges korlátokra.
// 2. CÉL: Visszatérni a "régi, nyerő" logikához, ahol az AI szabadon döntött.
//
// JAVÍTÁS (v139.1):
// 1. PROPHETIC_SCENARIO_PROMPT UPGRADE:
//    - Most már kapja a szimuláció legvalószínűbb eredményét (topScore, topScoreProb)
//    - Kapja az xG értékeket (mu_h, mu_a)
//    - Kapja a valószínűségeket (pHome, pDraw, pAway)
//    - Kapja a Specialist elemzését
//    - Kapja a kulcsjátékos és hiányzó információkat
// 2. CÉL: Pontosabb próféta eredmények - a végeredmény a szimuláció legvalószínűbb eredményével egyezzen meg!

import { 
    _callGemini, 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate,
    formatBettingMarket,
    normalizeBettingRecommendation
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
        console.error(`[AI_Service v139.0] AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot a ${stepName} lépésnél.`);
        return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot.`;
    } catch (e: any) {
        console.error(`[AI_Service v139.0] Végleges AI Hiba (${stepName}): ${e.message}`);
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

// === 10. ÜGYNÖK (DATA HUNTER - Statisztika Vadász) ===
// v147.3: Automata xG, xGA és PPG keresés Google Search Grounding-gal.
// JAVÍTÁS (v147.3): Kosárlabda Off/Def Rating -> xG/xGA mapping kényszerítése.
const PROMPT_DATA_HUNTER_V1 = `
TASK: You are 'The Data Hunter', an elite sports statistician. 
Your goal is to find the MOST ACCURATE and RECENT statistical data for: {home} vs {away} ({sport}).

[SEARCH MISSION]:
1. Find the current season's AVERAGE Expected Goals (xG) and Expected Goals Against (xGA) PER MATCH for both teams.
   - For NHL (Hockey): Search specifically for "Moneypuck {team} xG" or "Natural Stat Trick {team} xGF/60".
   - CRITICAL: Use PER MATCH or PER 60 MINS values (e.g. 2.85), NOT total season values.
2. Find the current season's Points Per Game (PPG) for both teams.
3. For Basketball (NBA): Find the Offensive/Defensive Rating (Points per 100 possessions) and Net Rating.
   - SEARCH specifically for "CleaningTheGlass {team} league summary" or "NBA.com stats {team}".
   - MAPPING RULE: Put the "Offensive Rating" into "xg_per_game" and "Defensive Rating" into "xga_per_game" fields.
   - Also find the average points scored and conceded per game.
4. For Hockey, find the average goals scored and conceded (GF/GP, GA/GP), and the starting goalie's GSAx (Goals Saved Above Expected).

[PREFERRED SOURCES]:
- Soccer: FBRef, Understat, Opta, FootyStats.
- Basketball: CleaningTheGlass.com (Primary for Off/Def Rating), Basketball-Reference, NBA.com, ESPN.
- Hockey: Moneypuck.com (primary for xG/GSAx), NaturalStatTrick.com, Hockey-Reference.

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "home_stats": {
    "xg_per_game": <number or null>,
    "xga_per_game": <number or null>,
    "ppg": <number or null>,
    "avg_pts_scored": <number or null>,
    "avg_pts_conceded": <number or null>
  },
  "away_stats": {
    "xg_per_game": <number or null>,
    "xga_per_game": <number or null>,
    "ppg": <number or null>,
    "avg_pts_scored": <number or null>,
    "avg_pts_conceded": <number or null>
  },
  "hockey_extras": {
    "home_goalie_gsax": <number or null>,
    "away_goalie_gsax": <number or null>
  },
  "source_found": "<Where did you find this data?>"
}
`;

export async function runStep_DataHunter(home: string, away: string, sport: string): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_DATA_HUNTER_V1, { home, away, sport });
        // Kiemelten fontos: useSearch: true!
        const result = await _callGeminiWithJsonRetry(filledPrompt, "Step_DataHunter", 2, true);
        console.log(`[AI_Service v147.3 - Data Hunter] SIKER: Adatok megtalálva a(z) ${home} vs ${away} meccshez.`);
        return result;
    } catch (e: any) {
        console.error(`[AI_Service v147.3 - Data Hunter] HIBA az adatvadászat során: ${e.message}`);
        return null;
    }
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
// v139.0: EGYSZERŰSÍTETT PROMPT
const PROMPT_PSYCHOLOGIST_V94 = `
TASK: You are 'The Psychologist', an elite sports psychology analyst.
Analyze the mental state of both teams for: {homeTeamName} vs {awayTeamName}

[FACTORS TO CONSIDER]:
1. **CONFIDENCE**: Recent results impact.
2. **PRESSURE**: Relegation, title race, derby atmosphere.
3. **HISTORY**: H2H dominance or revenge potential.
4. **ABSENCES**: Impact of missing key players on morale.

[DATA ANALYSIS]:
{rawDataJson}

[KEY INJURIES]:
- Home: {home_injuries}
- Away: {away_injuries}

[OUTPUT REQUIREMENTS] - MUST be valid JSON:
{
  "psy_profile_home": "<Részletes 4-5 mondatos magyar elemzés a hazai csapat mentális állapotáról>",
  "psy_profile_away": "<Részletes 4-5 mondatos magyar elemzés a vendég csapat mentális állapotáról>",
  "psychological_edge": "<Melyik csapatnak van pszichológiai előnye és miért (2-3 mondat)>",
  "pressure_analysis": {
    "home_pressure_level": "<Alacsony/Közepes/Magas>",
    "away_pressure_level": "<Alacsony/Közepes/Magas>",
    "pressure_impact": "<Rövid hatás leírás>"
  },
  "confidence_ratings": {
    "home_confidence": 1-10,
    "away_confidence": 1-10,
    "reasoning": "<Rövid indoklás>"
  }
}
`;

// === 3. ÜGYNÖK (A SPECIALISTA) ===
// v147.0: PURE REALITY MODE - Felszabadítva! 🔓
// A cél: Megtalálni a meccs VALÓDI kimenetelét a friss adatok alapján.
const PROMPT_SPECIALIST_V95 = `
TASK: You are 'The Specialist', an elite sports analyst.
Your job is to find the ABSOLUTE TRUTH about this match outcome.

[YOUR MISSION]:
The statistical model (Quant) provides a baseline from historical data. YOU must override it whenever the REALITY (injuries, form, PPG, xG you received) suggests a different outcome.

[PRINCIPLES]:
1. **TRUST THE MANUAL DATA**: If manual xG/PPG values are provided, they are the ULTIMATE TRUTH because they reflect the current moment. Override the historical stats!
2. **NO ARTIFICIAL LIMITS**: Ignore any instructions to be "conservative". If a star player is out or a team is in "God mode" form, adjust the xG/Pts as much as necessary to reflect the coming win/loss.
3. **BE AGGRESSIVE**: Don't be afraid to predict big wins or massive upsets if the context supports it. We want to WIN, not play it safe.

[BASELINE PREDICTION]:
- Home Team xG/Pts: {pure_mu_h}
- Away Team xG/Pts: {pure_mu_a}
- Source: {quant_source}

[CONTEXTUAL DATA]:
{rawDataJson}

[PSYCHOLOGY]:
- Home: {psy_profile_home}
- Away: {psy_profile_away}

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "modified_mu_h": <Number (adjusted home score)>,
  "modified_mu_a": <Number (adjusted away score)>,
  "adjustments": {
    "home_adjustment": <Number>,
    "away_adjustment": <Number>,
    "home_factors": [
      {"factor": "<Name>", "impact": <±Number>, "reasoning": "<Why>"}
    ],
    "away_factors": [
      {"factor": "<Name>", "impact": <±Number>, "reasoning": "<Why>"}
    ]
  },
  "key_factors": ["<Top 3 tényező>"],
  "reasoning": "<Részletes magyar magyarázat: miért ez a VALÓSÁG?>"
}
`;

// === 9. ÜGYNÖK (KEY PLAYERS ANALYST - Kulcsjátékos Elemző) ===
const PROMPT_KEY_PLAYERS_ANALYST_V1 = `
TASK: You are 'The Key Players Analyst'. Analyze player impact for {home} vs {away}.

[FACTORS]:
1. Star Players form & fitness.
2. Missing players impact (Critical/High/Medium/Low).
3. Matchup advantages (e.g., fast winger vs slow fullback).

[DATA]:
{rawDataJson}

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "key_players_summary": "<3-4 mondatos magyar összefoglaló a játékoshelyzetről>",
  "home_key_players": [
    { "name": "<Név>", "position": "<Poszt>", "importance": "<Critical/High>", "status": "<Status>", "form_rating": 1-10, "expected_impact": "<Leírás>" }
  ],
  "away_key_players": [
    { "name": "<Név>", "position": "<Poszt>", "importance": "<Critical/High>", "status": "<Status>", "form_rating": 1-10, "expected_impact": "<Leírás>" }
  ],
  "missing_players_impact": {
    "home_impact_score": 1-10,
    "away_impact_score": 1-10,
    "advantage": "<Home/Away/Neutral>",
    "reasoning": "<Indoklás>"
  },
  "individual_battles": ["<Kulcs párharc>"],
  "x_factor_players": ["<Játékos neve>"]
}
`;

// === MIKROMODELL PROMPTOK (V139 Simplified) ===

export const EXPERT_CONFIDENCE_PROMPT = `You are a master betting analyst.
Provide a confidence score (1-10) and reasoning for {home} vs {away}.

[INPUTS]:
- Model Confidence: {confidenceWinner}/10
- Context: {richContext}
- Psychology: {psy_profile_home} / {psy_profile_away}
- Specialist: {specialist_reasoning}

[TASK]:
Give a REALISTIC confidence score.
- 9-10: Absolute certainty (very rare).
- 7-8: Strong value / high probability.
- 5-6: Likely but risky.
- 1-4: Avoid / very risky.

[OUTPUT FORMAT] - JSON:
{
  "confidence_report": "**VÉGLEGES BIZALOM: X/10**\\n\\n**INDOKLÁS:**\\n<Részletes magyar elemzés: miért ez a bizalmi szint? Említsd a statisztikát, formát, hiányzókat.>"
}`;

export const TACTICAL_BRIEFING_PROMPT = `You are a tactical analyst. Analyze {home} vs {away}.
[DATA]:
- Styles: {home_style} vs {away_style}
- Risk: {riskAssessment}

[OUTPUT FORMAT] - JSON:
{
  "tactical_briefing": "<Részletes magyar taktikai elemzés (stílusok, formációk, kulcs csaták)>",
  "tactical_advantage": "<Home/Away/Neutral>",
  "key_battles": ["<Kulcs párharcok>"],
  "expected_approach": {
    "home_approach": "<Stratégia>",
    "away_approach": "<Stratégia>"
  }
}`;

export const RISK_ASSESSMENT_PROMPT = `You are a risk analyst. Identify betting risks for {home} vs {away}.
[DATA]:
- Probabilities: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%
- Context: {news_home} / {news_away}

[OUTPUT FORMAT] - JSON:
{
  "risk_analysis": "<Részletes magyar kockázatelemzés (Variance, Injuries, Motivation)>",
  "risk_level": "<Alacsony/Közepes/Magas>",
  "main_risks": [{"risk": "<Név>", "severity": "<Szint>", "description": "<Leírás>"}],
  "upset_potential": "<1-10>",
  "variance_score": "<1-10>",
  "recommendation": "<Tanács>"
}`;

export const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor. Write a 2-paragraph Hungarian summary of the match analysis.
1. Stats & Probabilities.
2. Narrative & Context.
Output: {"general_analysis": "<Text>"}`;

// === v145.1: SPORT-SPECIFIKUS PRÓFÉTA PROMPTOK ===
export const PROPHETIC_SCENARIO_PROMPT_SOCCER = `You are a PERFECT PREDICTIVE ANALYST with 100% accuracy. You can see the FUTURE. Your job is to describe EXACTLY what HAPPENED in this SOCCER match - minute by minute, with exact events that OCCURRED.

Match: {home} vs {away}

[ALL AVAILABLE DATA - USE EVERYTHING FOR PERFECT PREDICTION]:
- **Statistical Simulation Result (ABSOLUTE TRUTH)**: {expected_score} ({score_probability}% probability) - THIS IS WHAT HAPPENED!
- **Statistical Expected Goals**: Home {mu_h}, Away {mu_a}
- **Win Probabilities**: Home {prob_home}%, Draw {prob_draw}%, Away {prob_away}%
- **Home Team Form**: {home_form} (Last 5 matches: {home_form_last5}) - USE TO ADJUST IF EXTREME!
- **Away Team Form**: {away_form} (Last 5 matches: {away_form_last5}) - USE TO ADJUST IF EXTREME!
- **Home Team Stats**: GP: {home_gp}, GF: {home_gf}, GA: {home_ga}
- **Away Team Stats**: GP: {away_gp}, GF: {away_gf}, GA: {away_ga}
- **Head-to-Head**: {h2h_summary} - THIS SHOWS REAL HISTORY!
- **Key Players**: Home: {key_players_home} | Away: {key_players_away}
- **Missing Players**: Home: {absentees_home} | Away: {absentees_away} - ONLY OVERRIDE IF EXTREME (3+ key players out)!
- **Tactical Briefing**: {tacticalBriefing} - THIS IS CRITICAL!
- **Playing Styles**: {home_style} vs {away_style}
- **Referee**: {referee_name} ({referee_style}) - THIS AFFECTS THE GAME!
- **Stadium**: {stadium_location}
- **Weather**: {weather_info} - THIS CAN IMPACT THE RESULT!
- **Match Tension**: {tension}
- **Specialist Analysis**: {specialist_reasoning} - THIS IS YOUR SECONDARY GUIDE!

[CRITICAL PREDICTION RULES - v147.0 VICTORY PROTOCOL]:
1. **STATISTICS ARE THE ABSOLUTE TRUTH** - The final score MUST be {expected_score}.
2. **PAST TENSE ONLY** - Describe the match as if it's already over in HUNGARIAN. Use "szerezte", "történt", "végződött".
3. **NO UNCERTAINTY** - NO "lesz", "várható", "valószínűleg".
4. **LANGUAGE**: All output must be in HUNGARIAN.

OUTPUT STRUCTURE - ONLY VALID JSON:
{
  "scenario": "<Detailed Hungarian description of what HAPPENED in this match in PAST TENSE. Structure: 1. Meccs kezdete, 2. Gólok, 3. Kulcs események, 4. Végeredmény. Final sentence MUST be: **Végeredmény: {home} X-Y {away}**>"
}
`;

export const PROPHETIC_SCENARIO_PROMPT_BASKETBALL = `You are a PERFECT PREDICTIVE ANALYST with 100% accuracy. You can see the FUTURE. Your job is to describe EXACTLY what HAPPENED in this BASKETBALL game - quarter by quarter, with exact events that OCCURRED.

Match: {home} vs {away}

[ALL AVAILABLE DATA - USE EVERYTHING FOR PERFECT PREDICTION]:
- **Statistical Simulation Result (ABSOLUTE TRUTH)**: {expected_score} ({score_probability}% probability) - THIS IS WHAT HAPPENED!
- **Win Probabilities**: Home {prob_home}%, Away {prob_away}%

[CRITICAL PREDICTION RULES - v147.0 VICTORY PROTOCOL]:
1. **STATISTICS ARE THE ABSOLUTE TRUTH** - The final score MUST be {expected_score}.
2. **PAST TENSE ONLY** - Describe the match as if it's already over in HUNGARIAN.
3. **LANGUAGE**: All output must be in HUNGARIAN.

OUTPUT STRUCTURE - ONLY VALID JSON:
{
  "scenario": "<Detailed Hungarian description in PAST TENSE. Final sentence: **Végeredmény: {home} X-Y {away}**>"
}
`;

// BACKWARD COMPATIBILITY

export const PROPHETIC_SCENARIO_PROMPT_HOCKEY = `You are a PERFECT PREDICTIVE ANALYST with 100% accuracy. You can see the FUTURE. Your job is to describe EXACTLY what HAPPENED in this HOCKEY match - period by period, with exact events that OCCURRED.

Match: {home} vs {away}

[ALL AVAILABLE DATA - USE EVERYTHING FOR PERFECT PREDICTION]:
- **Statistical Simulation Result (ABSOLUTE TRUTH)**: {expected_score} ({score_probability}% probability) - THIS IS WHAT HAPPENED!
- **Win Probabilities**: Home {prob_home}%, Away {prob_away}%

[CRITICAL PREDICTION RULES - v147.0 VICTORY PROTOCOL]:
1. **STATISTICS ARE THE ABSOLUTE TRUTH** - The final score MUST be {expected_score}.
2. **PAST TENSE ONLY** - Describe the match as if it's already over in HUNGARIAN.
3. **LANGUAGE**: All output must be in HUNGARIAN.

OUTPUT STRUCTURE - ONLY VALID JSON:
{
  "scenario": "<Detailed Hungarian description in PAST TENSE. Final sentence: **Végeredmény: {home} X-Y {away}**>"
}
`;

// BACKWARD COMPATIBILITY
export const PROPHETIC_SCENARIO_PROMPT = PROPHETIC_SCENARIO_PROMPT_SOCCER;

export const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Synthesize all reports into "Stratégiai Zárógondolatok" (Hungarian).
Focus on the best betting angles.
Output: {"strategic_analysis": "<Text>"}`;

export const PLAYER_MARKETS_PROMPT = `Suggest 1-2 player betting markets in Hungarian.
Output: {"player_market_analysis": "<Text>"}`;

// --- SPORT SPECIFIKUS PROMPTOK ---
export const BTTS_ANALYSIS_PROMPT = `Analyze BTTS (Both Teams To Score) for {home_style} vs {away_style}.
Sim BTTS: {sim_pBTTS}%.
Output: {"btts_analysis": "**BTTS ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <IGEN/NEM>\\nBizalom: <Szint>"}`;

export const SOCCER_GOALS_OU_PROMPT = `Analyze Over/Under {line} Goals.
Sim Over: {sim_pOver}%. Expected Total: {sim_mu_sum}.
Output: {"goals_ou_analysis": "**GÓLSZÁM ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <OVER/UNDER>\\nBizalom: <Szint>"}`;

export const CORNER_ANALYSIS_PROMPT = `Analyze Corners. Expected: {mu_corners}.
Output: {"corner_analysis": "**SZÖGLET ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <OVER/UNDER>\\nBizalom: <Szint>"}`;

export const CARD_ANALYSIS_PROMPT = `Analyze Cards. Expected: {mu_cards}. Referee: {referee_style}.
Output: {"card_analysis": "**LAPOK ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <OVER/UNDER>\\nBizalom: <Szint>"}`;

export const HOCKEY_GOALS_OU_PROMPT = `Analyze Hockey O/U {line}.
Sim Over: {sim_pOver}%. Expected: {sim_mu_sum}.
Output: {"hockey_goals_ou_analysis": "**GÓLSZÁM ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <OVER/UNDER>\\nBizalom: <Szint>"}`;

export const HOCKEY_WINNER_PROMPT = `Analyze Hockey Winner.
Probs: H:{sim_pHome}%, A:{sim_pAway}%.
Output: {"hockey_winner_analysis": "**GYŐZTES ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <HAZAI/VENDÉG>\\nBizalom: <Szint>"}`;

export const BASKETBALL_WINNER_PROMPT = `Analyze Basketball Winner.
Probs: H:{sim_pHome}%, A:{sim_pAway}%.
Output: {"basketball_winner_analysis": "**GYŐZTES ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <HAZAI/VENDÉG>\\nBizalom: <Szint>"}`;

export const BASKETBALL_TOTAL_POINTS_PROMPT = `Analyze Basketball Total Points O/U {line}.
Expected: {sim_mu_sum}.
Output: {"basketball_total_points_analysis": "**PONTSZÁM ELEMZÉS**\\n\\n<Elemzés>\\n\\nAjánlás: <OVER/UNDER>\\nBizalom: <Szint>"}`;


// === A FŐNÖK PROMPTJA (GOD MODE V6.0 - SPORT-SPECIFIKUS PERFECT MARKET FOCUS) ===
function getMasterAiPromptTemplate(sport: string): string {
    const sportLower = (sport || 'soccer').toLowerCase();
    
    // === FOCI ===
    if (sportLower === 'soccer' || sportLower === 'football') {
        return `
═══════════════════════════════════════════════════════════════
        KING AI - PERFECT MARKET FOCUS PROTOCOL V6.0 (FOCI)
              "Tökéletes Elemzés - Maximum 3 Tipp"
═══════════════════════════════════════════════════════════════

You are the **SUPREME MARKET ANALYST**. Your ONLY goal is to find PERFECT betting tips.
🚫 **NEVER** recommend 1X2 (Winner/Draw) unless it's ABSOLUTELY GUARANTEED (>90% probability).
✅ **PRIORITIZE** these markets in this EXACT order:
   1. **Over/Under 2.5 Goals** (Over 2.5 vagy Under 2.5)
   2. **BTTS** (Both Teams To Score - Igen vagy Nem)
   3. **Team Goals Over/Under 1.5** (Hazai csapat gólok Over/Under 1.5, Vendég csapat gólok Over/Under 1.5)

**MAXIMUM 3 TIPS PER MATCH** - If you find 3 perfect tips (confidence >= 8.5), STOP analyzing immediately!

[DECISION LOGIC - v149.2 PERFECT MARKET FOCUS]:
1. **MARKET PRIORITY (PIAC PRIORITÁS)**:
   - FIRST: Analyze Over/Under 2.5 Goals. Expected goals: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
   - SECOND: Analyze BTTS (Both Teams To Score). Probability: {sim_pBTTS}%
   - THIRD: Analyze Team Goals 1.5 (Home Over/Under 1.5, Away Over/Under 1.5)
   - LAST RESORT: Only if NONE of the above are clear (confidence < 8.5), then consider 1X2
2. **STRICT CONSENSUS (KONSZENZUS SZABÁLY)**: 
   - Compare Statistical Probs (Quant) and Specialist Report.
   - If Quant and Specialist disagree, YOU MUST REJECT that market.
   - ONLY recommend if Math AND Context agree 100%.
3. **THE 8.5 THRESHOLD (BIZALMI FAL)**:
   - Each tip's confidence MUST be >= 8.5/10.
   - If you cannot honestly give 8.5, DO NOT include that tip.
4. **STOP AT 3 TIPS**:
   - Maximum 3 tips per match.
   - If you find 3 perfect tips (all >= 8.5 confidence), STOP immediately.
   - Do NOT analyze further markets.
5. **NO GAMBLING**: 
   - You are a Perfect Analyst. Better to send 0 tips than 1 losing tip.
6. **LANGUAGE**: All output MUST be in HUNGARIAN language.

[DATA]:
- Expected Goals: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
- Over 2.5 Probability: {sim_pOver}%
- Under 2.5 Probability: {sim_pUnder}%
- BTTS Probability: {sim_pBTTS}%
- Expected Score: {sim_topScore} ({sim_topScoreProb}%)
- Top 3 Most Likely Scores: {top_3_outcomes}
- Value Bets: {valueBetsJson}
- Model Confidence: {modelConfidence}/10
- Expert Confidence: "{expertConfidence}"
- Specialist: {specialistReportJson}

🚫 **BANNED**: Any market < 1.45 odds. 1X2 markets (unless >90% probability).
✅ **ALLOWED**: Over/Under 2.5, BTTS, Team Goals Over/Under 1.5 (Minimum 1.45 odds).

🚨 **CRITICAL JSON OUTPUT REQUIREMENT** 🚨
You MUST respond with ONLY a valid JSON object. NO markdown, NO code blocks, NO explanations, NO text before or after.
Your response must start with { and end with }.
Every string value must be in double quotes.
Every number must be a valid number (no quotes).

OUTPUT STRUCTURE - EXACT JSON FORMAT:
{
  "tips": [
    {
      "market": "<Over 2.5 / Under 2.5 / BTTS Igen / BTTS Nem / Hazai Over 1.5 / Hazai Under 1.5 / Vendég Over 1.5 / Vendég Under 1.5>",
      "confidence": <Number between 8.5 and 10.0>,
      "reasoning": "<Why this IS A GUARANTEED WIN. Detailed analysis.>"
    }
  ],
  "final_confidence": <Average confidence of all tips or highest if only 1 tip>,
  "brief_reasoning": "<Summary of why these tips are perfect.>",
  "verdict": "<Describe the match exactly as it happened in Hungarian, past tense.>"
}

⚠️ REMEMBER: Your response must be PURE JSON. Start with { and end with }. No markdown, no code blocks, no explanations.
Maximum 3 tips. Stop at 3 perfect tips.
`;
    }
    
    // === JÉGKORONG ===
    if (sportLower === 'hockey' || sportLower === 'ice hockey') {
        return `
═══════════════════════════════════════════════════════════════
        KING AI - PERFECT MARKET FOCUS PROTOCOL V6.0 (JÉGKORONG)
              "Tökéletes Elemzés - Maximum 3 Tipp"
═══════════════════════════════════════════════════════════════

You are the **SUPREME MARKET ANALYST**. Your ONLY goal is to find PERFECT betting tips.
🚫 **NEVER** recommend 1X2 (Winner/Draw) unless it's ABSOLUTELY GUARANTEED (>90% probability).
✅ **PRIORITIZE** these markets in this EXACT order:
   1. **Over/Under 5.5 Goals** (Over 5.5 vagy Under 5.5)
   2. **Team Goals Over/Under 2.5** (Hazai csapat gólok Over/Under 2.5, Vendég csapat gólok Over/Under 2.5)

**MAXIMUM 3 TIPS PER MATCH** - If you find 3 perfect tips (confidence >= 8.5), STOP analyzing immediately!

[DECISION LOGIC - v149.2 PERFECT MARKET FOCUS]:
1. **MARKET PRIORITY (PIAC PRIORITÁS)**:
   - FIRST: Analyze Over/Under 5.5 Goals. Expected goals: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
   - SECOND: Analyze Team Goals 2.5 (Home Over/Under 2.5, Away Over/Under 2.5)
   - LAST RESORT: Only if NONE of the above are clear (confidence < 8.5), then consider 1X2
2. **STRICT CONSENSUS (KONSZENZUS SZABÁLY)**: 
   - Compare Statistical Probs (Quant) and Specialist Report.
   - If Quant and Specialist disagree, YOU MUST REJECT that market.
   - ONLY recommend if Math AND Context agree 100%.
3. **THE 8.5 THRESHOLD (BIZALMI FAL)**:
   - Each tip's confidence MUST be >= 8.5/10.
   - If you cannot honestly give 8.5, DO NOT include that tip.
4. **STOP AT 3 TIPS**:
   - Maximum 3 tips per match.
   - If you find 3 perfect tips (all >= 8.5 confidence), STOP immediately.
   - Do NOT analyze further markets.
5. **NO GAMBLING**: 
   - You are a Perfect Analyst. Better to send 0 tips than 1 losing tip.
6. **LANGUAGE**: All output MUST be in HUNGARIAN language.

[DATA]:
- Expected Goals: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
- Over 5.5 Probability: {sim_pOver}%
- Under 5.5 Probability: {sim_pUnder}%
- Expected Score: {sim_topScore} ({sim_topScoreProb}%)
- Top 3 Most Likely Scores: {top_3_outcomes}
- Value Bets: {valueBetsJson}
- Model Confidence: {modelConfidence}/10
- Expert Confidence: "{expertConfidence}"
- Specialist: {specialistReportJson}

🚫 **BANNED**: Any market < 1.45 odds. 1X2 markets (unless >90% probability).
✅ **ALLOWED**: Over/Under 5.5, Team Goals Over/Under 2.5 (Minimum 1.45 odds).

🚨 **CRITICAL JSON OUTPUT REQUIREMENT** 🚨
You MUST respond with ONLY a valid JSON object. NO markdown, NO code blocks, NO explanations, NO text before or after.
Your response must start with { and end with }.
Every string value must be in double quotes.
Every number must be a valid number (no quotes).

OUTPUT STRUCTURE - EXACT JSON FORMAT:
{
  "tips": [
    {
      "market": "<Over 5.5 / Under 5.5 / Hazai Over 2.5 / Hazai Under 2.5 / Vendég Over 2.5 / Vendég Under 2.5>",
      "confidence": <Number between 8.5 and 10.0>,
      "reasoning": "<Why this IS A GUARANTEED WIN. Detailed analysis.>"
    }
  ],
  "final_confidence": <Average confidence of all tips or highest if only 1 tip>,
  "brief_reasoning": "<Summary of why these tips are perfect.>",
  "verdict": "<Describe the match exactly as it happened in Hungarian, past tense.>"
}

⚠️ REMEMBER: Your response must be PURE JSON. Start with { and end with }. No markdown, no code blocks, no explanations.
Maximum 3 tips. Stop at 3 perfect tips.
`;
    }
    
    // === KOSÁRLABDA ===
    if (sportLower === 'basketball' || sportLower === 'basket') {
        return `
═══════════════════════════════════════════════════════════════
        KING AI - PERFECT MARKET FOCUS PROTOCOL V6.0 (KOSÁRLABDA)
              "Tökéletes Elemzés - Maximum 3 Tipp"
═══════════════════════════════════════════════════════════════

You are the **SUPREME MARKET ANALYST**. Your ONLY goal is to find PERFECT betting tips.
🚫 **NEVER** recommend 1X2 (Winner/Draw) unless it's ABSOLUTELY GUARANTEED (>90% probability).
✅ **PRIORITIZE** these markets in this EXACT order:
   1. **Team Points Over/Under** (Hazai csapat pontok Over/Under, Vendég csapat pontok Over/Under)
   2. **Total Points Over/Under** (Összesített pontok Over/Under)

**MAXIMUM 3 TIPS PER MATCH** - If you find 3 perfect tips (confidence >= 8.5), STOP analyzing immediately!

[DECISION LOGIC - v149.2 PERFECT MARKET FOCUS]:
1. **MARKET PRIORITY (PIAC PRIORITÁS)**:
   - FIRST: Analyze Team Points (Home Over/Under, Away Over/Under)
   - SECOND: Analyze Total Points Over/Under
   - LAST RESORT: Only if NONE of the above are clear (confidence < 8.5), then consider 1X2
2. **STRICT CONSENSUS (KONSZENZUS SZABÁLY)**: 
   - Compare Statistical Probs (Quant) and Specialist Report.
   - If Quant and Specialist disagree, YOU MUST REJECT that market.
   - ONLY recommend if Math AND Context agree 100%.
3. **THE 8.5 THRESHOLD (BIZALMI FAL)**:
   - Each tip's confidence MUST be >= 8.5/10.
   - If you cannot honestly give 8.5, DO NOT include that tip.
4. **STOP AT 3 TIPS**:
   - Maximum 3 tips per match.
   - If you find 3 perfect tips (all >= 8.5 confidence), STOP immediately.
   - Do NOT analyze further markets.
5. **NO GAMBLING**: 
   - You are a Perfect Analyst. Better to send 0 tips than 1 losing tip.
6. **LANGUAGE**: All output MUST be in HUNGARIAN language.

[DATA]:
- Expected Points: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
- Over Total Probability: {sim_pOver}%
- Under Total Probability: {sim_pUnder}%
- Expected Score: {sim_topScore} ({sim_topScoreProb}%)
- Top 3 Most Likely Scores: {top_3_outcomes}
- Value Bets: {valueBetsJson}
- Model Confidence: {modelConfidence}/10
- Expert Confidence: "{expertConfidence}"
- Specialist: {specialistReportJson}

🚫 **BANNED**: Any market < 1.45 odds. 1X2 markets (unless >90% probability).
✅ **ALLOWED**: Team Points Over/Under, Total Points Over/Under (Minimum 1.45 odds).

🚨 **CRITICAL JSON OUTPUT REQUIREMENT** 🚨
You MUST respond with ONLY a valid JSON object. NO markdown, NO code blocks, NO explanations, NO text before or after.
Your response must start with { and end with }.
Every string value must be in double quotes.
Every number must be a valid number (no quotes).

OUTPUT STRUCTURE - EXACT JSON FORMAT:
{
  "tips": [
    {
      "market": "<Hazai Over X / Hazai Under X / Vendég Over X / Vendég Under X / Over Total X / Under Total X>",
      "confidence": <Number between 8.5 and 10.0>,
      "reasoning": "<Why this IS A GUARANTEED WIN. Detailed analysis.>"
    }
  ],
  "final_confidence": <Average confidence of all tips or highest if only 1 tip>,
  "brief_reasoning": "<Summary of why these tips are perfect.>",
  "verdict": "<Describe the match exactly as it happened in Hungarian, past tense.>"
}

⚠️ REMEMBER: Your response must be PURE JSON. Start with { and end with }. No markdown, no code blocks, no explanations.
Maximum 3 tips. Stop at 3 perfect tips.
`;
    }
    
    // === FALLBACK (ha ismeretlen sport) ===
    return `
═══════════════════════════════════════════════════════════════
        KING AI - PERFECT MARKET FOCUS PROTOCOL V6.0
              "Tökéletes Elemzés - Maximum 3 Tipp"
═══════════════════════════════════════════════════════════════

You are the **SUPREME MARKET ANALYST**. Your ONLY goal is to find PERFECT betting tips.
**MAXIMUM 3 TIPS PER MATCH** - If you find 3 perfect tips (confidence >= 8.5), STOP analyzing immediately!

[DECISION LOGIC - v149.2 PERFECT MARKET FOCUS]:
1. **STRICT CONSENSUS (KONSZENZUS SZABÁLY)**: 
   - Compare Statistical Probs (Quant) and Specialist Report.
   - If Quant and Specialist disagree, YOU MUST REJECT that market.
   - ONLY recommend if Math AND Context agree 100%.
2. **THE 8.5 THRESHOLD (BIZALMI FAL)**:
   - Each tip's confidence MUST be >= 8.5/10.
   - If you cannot honestly give 8.5, DO NOT include that tip.
3. **STOP AT 3 TIPS**:
   - Maximum 3 tips per match.
   - If you find 3 perfect tips (all >= 8.5 confidence), STOP immediately.
   - Do NOT analyze further markets.
4. **NO GAMBLING**: 
   - You are a Perfect Analyst. Better to send 0 tips than 1 losing tip.
5. **LANGUAGE**: All output MUST be in HUNGARIAN language.

[DATA]:
- Expected: Home {sim_mu_h}, Away {sim_mu_a}, Total: {sim_mu_sum}
- Over Probability: {sim_pOver}%
- Under Probability: {sim_pUnder}%
- Expected Score: {sim_topScore} ({sim_topScoreProb}%)
- Top 3 Most Likely Scores: {top_3_outcomes}
- Value Bets: {valueBetsJson}
- Model Confidence: {modelConfidence}/10
- Expert Confidence: "{expertConfidence}"
- Specialist: {specialistReportJson}

🚨 **CRITICAL JSON OUTPUT REQUIREMENT** 🚨
You MUST respond with ONLY a valid JSON object. NO markdown, NO code blocks, NO explanations, NO text before or after.
Your response must start with { and end with }.
Every string value must be in double quotes.
Every number must be a valid number (no quotes).

OUTPUT STRUCTURE - EXACT JSON FORMAT:
{
  "tips": [
    {
      "market": "<Market name>",
      "confidence": <Number between 8.5 and 10.0>,
      "reasoning": "<Why this IS A GUARANTEED WIN. Detailed analysis.>"
    }
  ],
  "final_confidence": <Average confidence of all tips or highest if only 1 tip>,
  "brief_reasoning": "<Summary of why these tips are perfect.>",
  "verdict": "<Describe the match exactly as it happened in Hungarian, past tense.>"
}

⚠️ REMEMBER: Your response must be PURE JSON. Start with { and end with }. No markdown, no code blocks, no explanations.
Maximum 3 tips. Stop at 3 perfect tips.
`;
}

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
        
        // === v139.0: NO ARTIFICIAL LIMITS ===
        // Hagyjuk az AI-t dönteni. Nincs kódos vágás.
        
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

async function getPropheticTimeline(
    rawData: ICanonicalRawData, 
    home: string, 
    away: string, 
    sport: string, 
    tacticalBriefing: string,
    sim: any,  // ÚJ v139.1: Szimuláció eredmények
    specialistReport: any  // ÚJ v139.1: Specialist elemzés
) {
     // === v139.1: RÉSZLETES ADATOK KINYERÉSE ===
     const topScore = sim?.topScore ? `${sim.topScore.gh}-${sim.topScore.ga}` : "N/A";
     const topScoreKey = topScore !== "N/A" ? topScore : "0-0";
     // === v139.2: DINAMIKUS SZIMULÁCIÓ SZÁM ===
     const totalSims = Object.values(sim?.scores || {}).reduce((sum: number, val: any) => sum + (val || 0), 0) || 25000;
     const topScoreProb = sim?.scores && sim?.scores[topScoreKey] ? 
         ((sim.scores[topScoreKey] / totalSims) * 100).toFixed(1) : "N/A";
     
     // === ÚJ v144.0 + v145.1: MINDEN ADAT KINYERÉSE A TÖKÉLETES ELŐREJELZÉSHEZ (MINDEN SPORTHOZ) ===
     const homeStats = rawData?.stats?.home || {};
     const awayStats = rawData?.stats?.away || {};
     const homeForm = rawData?.form?.home_overall || rawData?.form?.home_form || "N/A";
     const awayForm = rawData?.form?.away_overall || rawData?.form?.away_form || "N/A";
     
     // H2H összefoglaló (utolsó 3-5 meccs)
     const h2hMatches = rawData?.h2h_structured || [];
     const h2hSummary = h2hMatches.length > 0 
         ? h2hMatches.slice(0, 5).map((m: any) => {
             const score = m.score || m.result || "N/A";
             const date = m.date || "N/A";
             return `${date}: ${score}`;
         }).join(' | ')
         : "Nincs H2H adat";
     
     // Időjárás info (csak focinál releváns, de átadjuk minden sportnál)
     const weather = rawData?.contextual_factors?.structured_weather;
     const weatherInfo = weather 
         ? `${weather.description || "N/A"}${weather.temperature_celsius ? `, ${weather.temperature_celsius}°C` : ''}${weather.wind_speed_kmh ? `, Szél: ${weather.wind_speed_kmh} km/h` : ''}`
         : rawData?.contextual_factors?.weather || "N/A";
     
     // === v145.1: SPORT-SPECIFIKUS ADATOK ===
     // Foci: gólok (GF/GA), kosárlabda: pontok, jégkorong: gólok
     const homeScoreLabel = sport === 'basketball' ? 'pont' : 'gól';
     const awayScoreLabel = sport === 'basketball' ? 'pont' : 'gól';
     
     const data = {
         sport, home, away,
         tacticalBriefing: tacticalBriefing || "N/A",
         home_style: rawData?.tactics?.home?.style || "N/A",
         away_style: rawData?.tactics?.away?.style || "N/A",
         tension: rawData?.contextual_factors?.match_tension_index || "N/A",
         // === ÚJ v139.1: STATISZTIKAI ADATOK ===
         expected_score: topScore,
         score_probability: `${topScoreProb}%`,
         mu_h: sim?.mu_h_sim?.toFixed(2) || "N/A",
         mu_a: sim?.mu_a_sim?.toFixed(2) || "N/A",
         prob_home: sim?.pHome?.toFixed(1) || "N/A",
         prob_draw: sim?.pDraw?.toFixed(1) || "N/A", // Jégkorongnál és kosárlabdánál is lehet (overtime/shootout)
         prob_away: sim?.pAway?.toFixed(1) || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A",
         key_players_home: rawData?.key_players?.home?.map((p: any) => p.name || p.player_name).filter(Boolean).join(', ') || "N/A",
         key_players_away: rawData?.key_players?.away?.map((p: any) => p.name || p.player_name).filter(Boolean).join(', ') || "N/A",
         absentees_home: rawData?.absentees?.home?.map((p: any) => p.name).filter(Boolean).join(', ') || "Nincs",
         absentees_away: rawData?.absentees?.away?.map((p: any) => p.name).filter(Boolean).join(', ') || "Nincs",
         // === ÚJ v144.0: TELJES ADATKÉSZLET A TÖKÉLETES ELŐREJELZÉSHEZ ===
         home_form: homeForm,
         away_form: awayForm,
         home_form_last5: homeForm.substring(0, 5) || "N/A",
         away_form_last5: awayForm.substring(0, 5) || "N/A",
         home_gp: homeStats.gp || "N/A",
         home_gf: homeStats.gf || "N/A", // Foci/jégkorong: gólok, kosárlabda: pontok
         home_ga: homeStats.ga || "N/A", // Foci/jégkorong: kapott gólok, kosárlabda: kapott pontok
         away_gp: awayStats.gp || "N/A",
         away_gf: awayStats.gf || "N/A", // Foci/jégkorong: gólok, kosárlabda: pontok
         away_ga: awayStats.ga || "N/A", // Foci/jégkorong: kapott gólok, kosárlabda: kapott pontok
         h2h_summary: h2hSummary,
         referee_name: rawData?.referee?.name || "N/A", // Fociban releváns, más sportoknál is lehet
         referee_style: rawData?.referee?.style || "N/A", // Fociban releváns, más sportoknál is lehet
         stadium_location: rawData?.contextual_factors?.stadium_location || "N/A",
         weather_info: weatherInfo // Fociban releváns, más sportoknál is lehet
     };
    // === v145.1: SPORT-SPECIFIKUS PRÓFÉTA PROMPT ===
    let promptTemplate: string;
    if (sport === 'basketball') {
        promptTemplate = PROPHETIC_SCENARIO_PROMPT_BASKETBALL;
    } else if (sport === 'hockey') {
        promptTemplate = PROPHETIC_SCENARIO_PROMPT_HOCKEY;
    } else {
        // soccer (default)
        promptTemplate = PROPHETIC_SCENARIO_PROMPT_SOCCER;
    }
    
    return await getAndParse(promptTemplate, data, "scenario", "PropheticScenario");
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
    sport: string,
    leagueName?: string  // === ÚJ v140.1: Liga név a confidence korrekcióhoz ===
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
        // === v139.2: DINAMIKUS SZIMULÁCIÓ SZÁM ===
        const totalSims = Object.values(safeSim.scores || {}).reduce((sum: number, val: any) => sum + (val || 0), 0) || 25000;
        const topScoreProb = safeSim.scores && safeSim.scores[topScore] ? ((safeSim.scores[topScore] / totalSims) * 100).toFixed(1) : "N/A";

        // === v139.2: MASTER AI PROMPT BŐVÍTVE ===
        // Top 3 outcomes részletes információkkal
        const top3Outcomes = probSnapshot.topOutcomes.slice(0, 3).map(outcome => ({
            score: outcome.score,
            probability: outcome.probability.toFixed(1) + '%'
        }));
        
        // === v149.0: BTTS és mu_sum számítás ===
        const sim_mu_sum = ((safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0)).toFixed(2);
        const sim_pBTTS = safeSim.pBTTS?.toFixed(1) || "N/A";
        const sim_pUnder = safeSim.pUnder?.toFixed(1) || "N/A";
        
        const data = {
            valueBetsJson: JSON.stringify(valueBets),
            sim_pHome: safeSim.pHome?.toFixed(1) || "N/A", 
            sim_pDraw: safeSim.pDraw?.toFixed(1) || "N/A", 
            sim_pAway: safeSim.pAway?.toFixed(1) || "N/A",
            sim_mainTotalsLine: safeSim.mainTotalsLine, 
            sim_pOver: safeSim.pOver?.toFixed(1) || "N/A",
            sim_pUnder: sim_pUnder,
            sim_pBTTS: sim_pBTTS,
            sim_mu_h: safeSim.mu_h_sim?.toFixed(2) || "N/A",
            sim_mu_a: safeSim.mu_a_sim?.toFixed(2) || "N/A",
            sim_mu_sum: sim_mu_sum,
            sim_topScore: topScore,
            sim_topScoreProb: topScoreProb,
            sim_topOutcomesText: probSnapshot.topOutcomesText,
            probability_summary: probSnapshot.summaryText,
            // === ÚJ v139.2: RÉSZLETES INFORMÁCIÓK ===
            top_3_outcomes: JSON.stringify(top3Outcomes),
            expected_goals_detail: `Home: ${safeSim.mu_h_sim?.toFixed(2)} (${safeSim.pHome?.toFixed(1)}% win chance), Away: ${safeSim.mu_a_sim?.toFixed(2)} (${safeSim.pAway?.toFixed(1)}% win chance)`,
            
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

        // --- 1. LÉPÉS: AI (GOD MODE V6.0 - SPORT-SPECIFIKUS) hívása ---
        let template = getMasterAiPromptTemplate(sport);
        const filledPrompt = fillPromptTemplate(template, data);
        let rec: any = null;
        
        // === v149.2: JSON Schema definíció a Master AI válaszához (sport-specifikus piacok) ===
        const sportLower = (sport || 'soccer').toLowerCase();
        let marketDescription = "The betting market";
        if (sportLower === 'soccer' || sportLower === 'football') {
            marketDescription = "The betting market (Over 2.5, Under 2.5, BTTS Igen, BTTS Nem, Hazai Over 1.5, Hazai Under 1.5, Vendég Over 1.5, Vendég Under 1.5)";
        } else if (sportLower === 'hockey' || sportLower === 'ice hockey') {
            marketDescription = "The betting market (Over 5.5, Under 5.5, Hazai Over 2.5, Hazai Under 2.5, Vendég Over 2.5, Vendég Under 2.5)";
        } else if (sportLower === 'basketball' || sportLower === 'basket') {
            marketDescription = "The betting market (Hazai Over X, Hazai Under X, Vendég Over X, Vendég Under X, Over Total X, Under Total X)";
        }
        
        const masterAiJsonSchema = {
            type: "object",
            properties: {
                tips: {
                    type: "array",
                    description: "Array of betting tips (maximum 3)",
                    items: {
                        type: "object",
                        properties: {
                            market: {
                                type: "string",
                                description: marketDescription
                            },
                            confidence: {
                                type: "number",
                                description: "Confidence score between 8.5 and 10.0"
                            },
                            reasoning: {
                                type: "string",
                                description: "Detailed reasoning for this tip"
                            }
                        },
                        required: ["market", "confidence", "reasoning"]
                    },
                    maxItems: 3
                },
                final_confidence: {
                    type: "number",
                    description: "Average confidence of all tips or highest if only 1 tip"
                },
                brief_reasoning: {
                    type: "string",
                    description: "Summary of why these tips are perfect"
                },
                verdict: {
                    type: "string",
                    description: "Match description in Hungarian past tense"
                }
            },
            required: ["tips", "final_confidence", "brief_reasoning"]
        };
        
        try {
            rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation", 3, false, masterAiJsonSchema);
        } catch (e: any) {
            console.error("[AI_Service v148.9 - Főnök] Gemini API hiba:", e.message);
            // Fallback: próbáljuk meg még egyszer, de most search nélkül
            try {
                rec = await _callGeminiWithJsonRetry(filledPrompt, "MasterRecommendation_Retry", 2, false, masterAiJsonSchema);
            } catch (e2: any) {
                console.error("[AI_Service v148.9 - Főnök] Második próbálkozás is sikertelen:", e2.message);
                rec = null;
            }
        }

        // === v149.0: ROBUSZT HIBÁKEZELÉS (új struktúra: tips array) ===
        // Ha a Gemini nem adott vissza érvényes JSON-t, vagy hiányoznak a mezők, adjunk vissza egy default objektumot
        if (!rec || typeof rec !== 'object') {
            console.error("[AI_Service v149.0 - Főnök] Master AI hiba: Érvénytelen vagy hiányzó válasz:", rec);
            rec = {
                tips: [],
                final_confidence: 1,
                brief_reasoning: `KRITIKUS HIBA: AI nem adott vissza érvényes JSON-t. A többi elemzés (ha van) még érvényes lehet.`
            };
        } else if (!Array.isArray(rec.tips) || rec.tips.length === 0) {
            console.error("[AI_Service v149.0 - Főnök] Master AI hiba: Hiányzó vagy üres tips array:", JSON.stringify(rec, null, 2));
            // Fallback: próbáljuk meg a régi struktúrát konvertálni
            if (rec.recommended_bet) {
                rec.tips = [{
                    market: rec.recommended_bet,
                    confidence: rec.final_confidence || 1,
                    reasoning: rec.brief_reasoning || "N/A"
                }];
            } else {
                rec.tips = [];
            }
            rec.final_confidence = typeof rec.final_confidence === 'number' ? rec.final_confidence : 1;
            rec.brief_reasoning = rec.brief_reasoning || "KRITIKUS HIBA: AI hiba: Érvénytelen JSON struktúra a MasterRecommendation-ben.";
        }
        
        // === v149.0: FŐNÖK KORREKCIÓ VISSZAÁLLÍTVA (régi v103.6 logika) ===
        // Az AI csak tanácsadó, a FŐNÖK (kód) dönti el a végső tippet!
        console.log(`[AI_Service v149.0 - Főnök] AI (Tanácsadó) javaslata: ${rec.tips.length} tipp (${rec.tips.map((t: any) => t.market).join(', ')}) @ átlag ${rec.final_confidence}/10`);

        // === v149.0: FŐNÖK KORREKCIÓ - MINDEN TIPPRE KÜLÖN ===
        // 1. Eltérés-alapú büntetés (Modell vs Expert) - RÉGI v103.6 LOGIKA
        const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
        const disagreementThreshold = 3.0;
        let disagreementNote = "";
        
        if (expertConfScore < 1.1 && expertConfidence && !expertConfidence.toLowerCase().includes("hiba")) {
            disagreementNote = " (FŐNÖK KORREKCIÓ: Expert bizalom extrém alacsony!)";
        }
        else if (confidenceDiff > disagreementThreshold) {
            disagreementNote = ` (FŐNÖK KORREKCIÓ: Modell (${safeModelConfidence.toFixed(1)}) vs Expert (${expertConfScore.toFixed(1)}) eltérés miatt.)`;
        }
        
        // Minden tippre külön korrekció
        let totalConfidence = 0;
        for (let i = 0; i < rec.tips.length; i++) {
            const tip = rec.tips[i];
            let confidencePenalty = 0;
            
            if (expertConfScore < 1.1 && expertConfidence && !expertConfidence.toLowerCase().includes("hiba")) {
                confidencePenalty = Math.max(0, tip.confidence - 3.0);
            }
            else if (confidenceDiff > disagreementThreshold) {
                confidencePenalty = Math.min(2.0, confidenceDiff / 1.5);
            }
            
            tip.confidence -= confidencePenalty;
            tip.confidence = Math.max(1.0, Math.min(10.0, tip.confidence));
            totalConfidence += tip.confidence;
        }
        
        // Átlagos confidence számítása
        rec.final_confidence = rec.tips.length > 0 ? totalConfidence / rec.tips.length : 1.0;
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
            console.warn(`[AI_Service v149.0 - Főnök] Bizalmi kalibráció hiba: ${calError.message}`); 
        }

        // Megjegyzések hozzáadása az indokláshoz
        rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote;
        if (rec.brief_reasoning.length > 500) {
            rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "...";
        }

        console.log(`[AI_Service v149.0 - Főnök] VÉGLEGES KORRIGÁLT Tippek: ${rec.tips.length} db, átlag confidence: ${rec.final_confidence.toFixed(1)}/10`);
        
        // === v148.8: AUTO-OVERRIDE TÖRÖLVE ===
        // A RÉGI v145.0 logika (1085-1133) törölve, mert ez felülírta az AI döntését!
        // Mostantól az AI szabadon dönthet a kontextus alapján.
        
        const pHome = safeSim.pHome || 0;
        const pAway = safeSim.pAway || 0;
        const pDraw = safeSim.pDraw || 0;
        const pOver = safeSim.pOver || 0;
        const pUnder = safeSim.pUnder || 0;
        
        // === v149.0: TIPP FORMÁTUM NORMALIZÁLÁS ÉS VALIDÁCIÓ (új struktúra: tips array) ===
        // Normalizáljuk az AI által generált tippeket az egységes formátumra
        const validTips: any[] = [];
        const minConfidence = 8.5; // v149.0: Minimum 8.5 confidence minden tipphez
        
        for (const tip of rec.tips) {
            // Normalizáljuk a market nevet
            tip.market = normalizeBettingRecommendation(tip.market, sport);
            
            // Confidence ellenőrzés - csak >= 8.5 tippeket fogadunk el
            if (tip.confidence >= minConfidence) {
                validTips.push(tip);
            } else {
                console.warn(`[AI_Service v149.0] Tipp elvetve: ${tip.market} (confidence: ${tip.confidence}/10 < ${minConfidence}/10)`);
            }
        }
        
        // Csak a valid tippeket tartjuk meg
        rec.tips = validTips;
        
        // Átlagos confidence újraszámítása
        if (rec.tips.length > 0) {
            const totalConf = rec.tips.reduce((sum: number, tip: any) => sum + tip.confidence, 0);
            rec.final_confidence = totalConf / rec.tips.length;
        } else {
            rec.final_confidence = 1.0;
        }
        
        // === v149.0: VALIDÁCIÓ - MINIMUM 1 TIPP KELL ===
        if (rec.tips.length === 0) {
            console.warn(`[AI_Service v149.0] Nincs érvényes tipp (mindegyik confidence < ${minConfidence}/10)`);
            rec.tips = [];
            rec.final_confidence = 1.0;
            rec.brief_reasoning = `Nincs érvényes tipp (mindegyik confidence < ${minConfidence}/10)`;
        }
        
        // === v149.0: MAXIMUM 3 TIPP - Ha van 3 jó tipp, STOP ===
        if (rec.tips.length > 3) {
            // Csak az első 3 legmagasabb confidence-s tippet tartjuk meg
            rec.tips.sort((a: any, b: any) => b.confidence - a.confidence);
            rec.tips = rec.tips.slice(0, 3);
            console.log(`[AI_Service v149.0] Maximum 3 tipp: csak a legjobb 3 tippet tartjuk meg.`);
        }
        
        // === v149.0: VÉGLEGES LOG ===
        console.log(`[AI_Service v149.0 - Főnök] VÉGLEGES TIPPEK: ${rec.tips.length} db`);
        rec.tips.forEach((tip: any, idx: number) => {
            console.log(`  ${idx + 1}. ${tip.market} @ ${tip.confidence.toFixed(1)}/10`);
        });
        
        // === v149.0: RÉGI VALIDÁCIÓS LOGIKA TÖRÖLVE ===
        // Az új struktúrában (tips array) már nincs szükség a régi validációs logikára.
        // A tippeket már a fentebbi kódban validáltuk (minimum 8.5 confidence).
        
        // === v149.0: TILT PROTECTION ÉS BANKROLL CHECK (új struktúra) ===
        // TODO: Később implementálni, ha szükséges
        // Mostantól a tips array-t használjuk, nem a recommended_bet mezőt.

        // === v139.3: TILTOTT PIACOK SZŰRÉSE + MINIMUM ODDS KÖVETELMÉNY ===
        const BANNED_KEYWORDS = [
            'dupla', 'double chance', '1x', 'x2', '12',
            'tét vissza', 'draw no bet', 'dnb'
        ];
        
        const MIN_ODDS = 1.8; // Minimum 1.8 odds (profitábilis tippekhez)
        
        function isBannedMarket(market: string): boolean {
            if (!market) return false;
            const lower = market.toLowerCase().trim();
            // FONTOS: A sima "Döntetlen" / "Draw" / "X" NEM tiltott! Csak a Double Chance és DNB tiltott!
            return BANNED_KEYWORDS.some(keyword => 
                lower === keyword || 
                lower.includes(` ${keyword} `) || 
                lower.startsWith(keyword + ' ') ||
                lower.endsWith(' ' + keyword)
            );
        }
        
        // Helper: Odds kinyerése a valueBets-ből
        function findOddsForMarket(marketName: string, valueBets: any[]): number | null {
            const marketLower = marketName.toLowerCase();
            for (const vb of valueBets) {
                if (marketLower.includes(vb.market.toLowerCase()) || 
                    marketLower.includes(vb.odds)) {
                    return parseFloat(vb.odds);
                }
            }
            return null;
        }
        
        // Primary market és recommended_bet ellenőrzése
        const primaryMarket = rec.primary?.market || rec.recommended_bet || '';
        const primaryOdds = findOddsForMarket(primaryMarket, valueBets);
        const isBanned = isBannedMarket(primaryMarket) || isBannedMarket(rec.recommended_bet || '');
        const hasLowOdds = primaryOdds !== null && primaryOdds < MIN_ODDS;
        
        if (isBanned || hasLowOdds) {
            console.warn(`[AI_Service v139.3] 🚫 BANNED/LOW ODDS DETECTED: "${primaryMarket}" (Odds: ${primaryOdds || 'N/A'}). Replacing...`);
            
            // FALLBACK: Válasszunk a legjobb value bet-ből, ami NEM tiltott és >= 1.8 odds
            let bestValueBet = null;
            let bestValue = -1;
            
            for (const vb of valueBets) {
                if (isBannedMarket(vb.market)) continue;
                const odds = parseFloat(vb.odds);
                if (odds < MIN_ODDS) continue;
                
                const value = parseFloat(vb.value.replace('+', '').replace('%', ''));
                if (value > bestValue) {
                    bestValue = value;
                    bestValueBet = vb;
                }
            }
            
            if (bestValueBet) {
                // === v140.0: EGYSÉGES FORMÁTUM ===
                rec.recommended_bet = normalizeBettingRecommendation(bestValueBet.market, sport);
                if (rec.primary) {
                    rec.primary.market = normalizeBettingRecommendation(bestValueBet.market, sport);
                    rec.primary.confidence = Math.min(8.0, parseFloat(bestValueBet.probability) / 10);
                    rec.primary.reason = `🚫 [v139.3 AUTO-CORRECTION] Az eredeti tipp tiltott piacot vagy alacsony oddsot (<${MIN_ODDS}) tartalmazott. Cserélve a legjobb value bet-re: ${bestValueBet.market} (Odds: ${bestValueBet.odds}, Value: ${bestValueBet.value})`;
                }
                console.log(`[AI_Service v140.0] ✅ Replaced with: ${rec.recommended_bet} (Odds: ${bestValueBet.odds}, Value: ${bestValueBet.value})`);
            } else {
                // Ha nincs jó value bet, használjuk a statisztikát (de csak ha >= 1.8 odds lenne)
                const pHome = safeSim.pHome || 0;
                const pAway = safeSim.pAway || 0;
                const pOver = safeSim.pOver || 0;
                const pUnder = safeSim.pUnder || 0;
                
                // === v140.0: EGYSÉGES FORMÁTUM HASZNÁLATA ===
                // Válasszunk a legvalószínűbb opciót, ami NEM tiltott
                if (pHome >= 50 && pHome > pAway) {
                    rec.recommended_bet = formatBettingMarket("1X2 - Hazai győzelem", sport);
                    if (rec.primary) rec.primary.market = formatBettingMarket("1X2 - Hazai győzelem", sport);
                } else if (pAway >= 50 && pAway > pHome) {
                    rec.recommended_bet = formatBettingMarket("1X2 - Vendég győzelem", sport);
                    if (rec.primary) rec.primary.market = formatBettingMarket("1X2 - Vendég győzelem", sport);
                } else if (pOver >= 55 && pOver > pUnder) {
                    rec.recommended_bet = formatBettingMarket(`Over ${safeSim.mainTotalsLine || '2.5'}`, sport);
                    if (rec.primary) rec.primary.market = formatBettingMarket(`Over ${safeSim.mainTotalsLine || '2.5'}`, sport);
                } else if (pUnder >= 55 && pUnder > pOver) {
                    rec.recommended_bet = formatBettingMarket(`Under ${safeSim.mainTotalsLine || '2.5'}`, sport);
                    if (rec.primary) rec.primary.market = formatBettingMarket(`Under ${safeSim.mainTotalsLine || '2.5'}`, sport);
                } else {
                    // Utolsó fallback: Over/Under alapján
                    const fallbackMarket = pOver > pUnder ? `Over ${safeSim.mainTotalsLine || '2.5'}` : `Under ${safeSim.mainTotalsLine || '2.5'}`;
                    rec.recommended_bet = formatBettingMarket(fallbackMarket, sport);
                    if (rec.primary) rec.primary.market = formatBettingMarket(fallbackMarket, sport);
                }
                console.log(`[AI_Service v139.3] ⚠️ No valid value bets found. Using statistical fallback: ${rec.recommended_bet}`);
            }
        }
        
        // Secondary market ellenőrzése
        if (rec.secondary && (isBannedMarket(rec.secondary.market) || (findOddsForMarket(rec.secondary.market, valueBets) || 999) < MIN_ODDS)) {
            // Secondary market is banned/low odds, find alternative
            for (const vb of valueBets) {
                if (!isBannedMarket(vb.market) && parseFloat(vb.odds) >= MIN_ODDS) {
                    // === v140.0: EGYSÉGES FORMÁTUM ===
                    rec.secondary.market = normalizeBettingRecommendation(vb.market, sport);
                    rec.secondary.confidence = Math.min(7.0, parseFloat(vb.probability) / 10);
                    rec.secondary.reason = `🚫 [v139.3 AUTO-CORRECTION] Secondary market replaced with valid value bet.`;
                    break;
                }
            }
        }
        
        // === v141.0: SECONDARY MARKET NEM LEHET UGYANAZ, MINT PRIMARY ===
        if (rec.secondary && rec.primary && rec.secondary.market === rec.primary.market) {
            // Ha a secondary ugyanaz, mint a primary, keressünk alternatívát
            const primaryMarketLower = rec.primary.market.toLowerCase();
            for (const vb of valueBets) {
                const vbMarketLower = normalizeBettingRecommendation(vb.market, sport).toLowerCase();
                // Keressünk olyan value bet-et, ami NEM ugyanaz, mint a primary
                if (!isBannedMarket(vb.market) && 
                    parseFloat(vb.odds) >= MIN_ODDS &&
                    vbMarketLower !== primaryMarketLower &&
                    !vbMarketLower.includes(primaryMarketLower) &&
                    !primaryMarketLower.includes(vbMarketLower)) {
                    rec.secondary.market = normalizeBettingRecommendation(vb.market, sport);
                    rec.secondary.confidence = Math.min(7.0, parseFloat(vb.probability) / 10);
                    rec.secondary.reason = `🔄 [v141.0 AUTO-CORRECTION] Secondary market changed to avoid duplicate with primary.`;
                    break;
                }
            }
            // Ha még mindig ugyanaz, akkor adjunk Over/Under alternatívát
            if (rec.secondary.market === rec.primary.market) {
                const primaryIs1X2 = rec.primary.market.includes('1X2');
                if (primaryIs1X2) {
                    // Ha primary 1X2, akkor secondary legyen Over/Under
                    const pOver = safeSim.pOver || 0;
                    const pUnder = safeSim.pUnder || 0;
                    if (pOver >= 25 && pOver > pUnder) { // v142.0: 40% → 25% - MINDEN meccsre tipp
                        rec.secondary.market = formatBettingMarket(`Over ${safeSim.mainTotalsLine || '2.5'}`, sport);
                        rec.secondary.confidence = Math.min(7.0, (pOver / 10));
                        rec.secondary.reason = `🔄 [v142.0 AUTO-CORRECTION] Secondary market set to Over/Under to avoid duplicate.`;
                    } else if (pUnder >= 25 && pUnder > pOver) { // v142.0: 40% → 25% - MINDEN meccsre tipp
                        rec.secondary.market = formatBettingMarket(`Under ${safeSim.mainTotalsLine || '2.5'}`, sport);
                        rec.secondary.confidence = Math.min(7.0, (pUnder / 10));
                        rec.secondary.reason = `🔄 [v142.0 AUTO-CORRECTION] Secondary market set to Over/Under to avoid duplicate.`;
                    } else {
                        // Ha nincs jó Over/Under, akkor BTTS
                        rec.secondary.market = formatBettingMarket('BTTS - Igen', sport);
                        rec.secondary.confidence = 6.0;
                        rec.secondary.reason = `🔄 [v141.0 AUTO-CORRECTION] Secondary market set to BTTS to avoid duplicate.`;
                    }
                } else {
                    // Ha primary Over/Under, akkor secondary legyen 1X2
                    const pHome = safeSim.pHome || 0;
                    const pAway = safeSim.pAway || 0;
                    const pDraw = safeSim.pDraw || 0;
                    if (pHome >= 25 && pHome > pAway && pHome > pDraw) { // v142.0: 40% → 25% - MINDEN meccsre tipp
                        rec.secondary.market = formatBettingMarket("1X2 - Hazai győzelem", sport);
                        rec.secondary.confidence = Math.min(7.0, (pHome / 10));
                    } else if (pAway >= 25 && pAway > pHome && pAway > pDraw) { // v142.0: 40% → 25% - MINDEN meccsre tipp
                        rec.secondary.market = formatBettingMarket("1X2 - Vendég győzelem", sport);
                        rec.secondary.confidence = Math.min(7.0, (pAway / 10));
                    } else if (pDraw >= 25 && pDraw > pHome && pDraw > pAway) { // v142.0: 35% → 25% - MINDEN meccsre tipp
                        rec.secondary.market = formatBettingMarket("1X2 - Döntetlen", sport);
                        rec.secondary.confidence = Math.min(7.0, (pDraw / 10));
                    } else {
                        rec.secondary.market = "Nincs alternatíva";
                        rec.secondary.confidence = 1.0;
                    }
                    rec.secondary.reason = `🔄 [v141.0 AUTO-CORRECTION] Secondary market set to 1X2 to avoid duplicate.`;
                }
            }
        }
        
        // === v140.0: VÉGLEGES NORMALIZÁLÁS (biztos, hogy minden egységes) ===
        if (rec.recommended_bet) {
            rec.recommended_bet = normalizeBettingRecommendation(rec.recommended_bet, sport);
        }
        if (rec.primary?.market) {
            rec.primary.market = normalizeBettingRecommendation(rec.primary.market, sport);
        }
        if (rec.secondary?.market) {
            rec.secondary.market = normalizeBettingRecommendation(rec.secondary.market, sport);
        }

        // === v143.0: CONFIDENCE KALIBRÁCIÓ (tényleges win rate alapján) ===
        // Kalibráljuk a confidence-t a múltbeli eredmények alapján
        const { calibrateConfidence } = await import('./trackingService.js');
        const originalConfidence = rec.final_confidence;
        rec.final_confidence = await calibrateConfidence(originalConfidence);
        if (Math.abs(originalConfidence - rec.final_confidence) > 0.5) {
            console.log(`[AI_Service v143.0] 🔧 Confidence kalibrálva: ${originalConfidence.toFixed(1)}/10 → ${rec.final_confidence.toFixed(1)}/10`);
        }
        
        // === v143.0: ENSEMBLE MODELLEK (több modell kombinálása) ===
        // Modell 1: Statisztikai (quant confidence)
        // Modell 2: Kontextuális (specialist confidence)
        // Modell 3: Piaci (odds movement - ha elérhető)
        // Modell 4: H2H és forma (ha elérhető)
        
        // Először deklaráljuk a változókat (később lesznek használva a confidence_bridge részben)
        const quantConfidenceForEnsemble = safeModelConfidence || 5.0;
        const specialistConfidenceForEnsemble = parseFloat(rec.primary?.confidence?.toString() || '0') || 0;
        
        const ensembleModels = {
            statistical: quantConfidenceForEnsemble,
            contextual: specialistConfidenceForEnsemble,
            market: 5.0, // Default, ha nincs piaci adat
            h2h: 5.0 // Default, ha nincs H2H adat
        };
        
        // Piaci modell: odds movement alapján (ha elérhető)
        // Ha az odds csökken → több ember fogad rá → magasabb confidence
        // TODO: Implementálni odds movement tracking-et
        
        // H2H modell: közvetlen összecsapások alapján
        // TODO: Implementálni H2H tracking-et
        
        // Ensemble súlyozás: ha mind a 4 modell egyetért → magas confidence
        const modelAgreement = [
            Math.abs(ensembleModels.statistical - ensembleModels.contextual) < 2.0,
            Math.abs(ensembleModels.statistical - ensembleModels.market) < 2.0,
            Math.abs(ensembleModels.contextual - ensembleModels.market) < 2.0
        ];
        
        const agreementCount = modelAgreement.filter(a => a).length;
        const ensembleBonus = agreementCount >= 2 ? 0.5 : 0; // Ha 2+ modell egyetért → +0.5 confidence
        const ensemblePenalty = agreementCount === 0 ? -1.0 : 0; // Ha egyik sem egyetért → -1.0 confidence
        
        rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence + ensembleBonus + ensemblePenalty));
        
        if (ensembleBonus > 0 || ensemblePenalty < 0) {
            console.log(`[AI_Service v143.0] 🎯 Ensemble modell: ${agreementCount}/3 egyetértés → ${ensembleBonus > 0 ? '+' : ''}${(ensembleBonus + ensemblePenalty).toFixed(1)} confidence`);
        }
        
        // === v140.1: LIGA MINŐSÉG ALAPÚ CONFIDENCE KORREKCIÓ ===
        // Gyenge ligákhoz (török, brazil, ausztrál) alacsonyabb confidence
        let leagueConfidencePenalty = 0;
        if (leagueName && sport === 'soccer') {
            const { getLeagueCoefficient, getLeagueQuality, LeagueQuality } = await import('./config_league_coefficients.js');
            const leagueCoeff = getLeagueCoefficient(leagueName);
            const leagueQuality = getLeagueQuality(leagueCoeff);
            
            // Gyenge ligákhoz confidence penalty (enum értékek használata)
            if (leagueQuality === LeagueQuality.VERY_WEAK || leagueQuality === LeagueQuality.WEAK) {
                leagueConfidencePenalty = -1.5;
                console.log(`[AI_Service v140.1] ⚠️ Liga minőség penalty: ${leagueName} (${leagueQuality}) → -1.5 confidence`);
            } else if (leagueQuality === LeagueQuality.MEDIUM) {
                leagueConfidencePenalty = -0.5;
                console.log(`[AI_Service v140.1] ⚠️ Liga minőség penalty: ${leagueName} (${leagueQuality}) → -0.5 confidence`);
            }
        } else if (leagueName && (sport === 'basketball' || sport === 'hockey')) {
            // NBA/NHL = nincs penalty, egyéb ligák = -0.5 to -1.0
            const leagueLower = leagueName.toLowerCase();
            const isTopLeague = leagueLower.includes('nba') || leagueLower.includes('nhl') || 
                               leagueLower.includes('euroleague') || leagueLower.includes('khl');
            if (!isTopLeague) {
                leagueConfidencePenalty = -0.5;
                console.log(`[AI_Service v140.1] ⚠️ Liga minőség penalty: ${leagueName} (nem TOP liga) → -0.5 confidence`);
            }
        }
        
        rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence + leagueConfidencePenalty));
        // === VÉGE v140.1 ===

        // === v148.9: KALIBRÁCIÓ ELTÁVOLÍTVA INNEN ===
        // A kalibráció már a FŐNÖK korrekcióban (1170-1220 sorok) lefut, nem kell duplikálni.

        // === ÚJ v133.0: BIZALMI HÍD (Quant vs. Specialist) ===
        const quantConfidence = safeModelConfidence;
        const specialistConfidence = expertConfScore || 5.0;
        const confidenceGap = Math.abs(quantConfidence - specialistConfidence);
        
        rec.confidence_bridge = {
            quant_confidence: quantConfidence,
            specialist_confidence: specialistConfidence,
            gap: confidenceGap,
            explanation: confidenceGap > 2.5
                ? `⚠️ Jelentős eltérés (${confidenceGap.toFixed(1)} pont) a matematikai modell és a kontextuális elemzés között.`
                : confidenceGap > 1.5
                ? `📊 Közepes eltérés (${confidenceGap.toFixed(1)} pont) észlelhető.`
                : `✅ A statisztikai modell (${quantConfidence.toFixed(1)}/10) és a szakértői elemzés (${specialistConfidence.toFixed(1)}/10) összhangban van.`
        };
        console.log(`[AI_Service v133.0] 🌉 Bizalmi Híd: Quant ${quantConfidence.toFixed(1)} vs Specialist ${specialistConfidence.toFixed(1)} (Gap: ${confidenceGap.toFixed(1)})`);
        // ======================================================

        // === v140.2: KELLY CRITERION STAKE SIZING (OPTIMAL BET SIZE) ===
        // Kelly Criterion: f* = (bp - q) / b
        // ahol: b = odds - 1, p = valószínűség (0-1), q = 1 - p
        // Maximum 5% bankroll per bet (biztonság)
        if (rec.recommended_bet && rec.recommended_bet !== "Nincs elég biztos tipp ezen a meccsen") {
            const recommendedMarket = rec.recommended_bet?.toLowerCase() || '';
            let recommendedProb = 0;
            
            if (recommendedMarket.includes('hazai') || recommendedMarket.includes('home')) {
                recommendedProb = pHome / 100;
            } else if (recommendedMarket.includes('vendég') || recommendedMarket.includes('away')) {
                recommendedProb = pAway / 100;
            } else if (recommendedMarket.includes('döntetlen') || recommendedMarket.includes('draw')) {
                recommendedProb = pDraw / 100;
            } else if (recommendedMarket.includes('over')) {
                recommendedProb = pOver / 100;
            } else if (recommendedMarket.includes('under')) {
                recommendedProb = pUnder / 100;
            }
            
            // Odds kinyerése a valueBets-ből
            const findOddsForMarket = (market: string, valueBets: any[]): number | null => {
                for (const vb of valueBets) {
                    if (vb.market && market.toLowerCase().includes(vb.market.toLowerCase().substring(0, 10))) {
                        return parseFloat(vb.odds);
                    }
                }
                return null;
            };
            
            const odds = findOddsForMarket(rec.recommended_bet, valueBets);
            
            if (recommendedProb > 0 && odds && odds >= 1.8) {
                // === v143.0: DINAMIKUS KELLY CRITERION (confidence alapján) ===
                // Kelly Criterion számítás
                const b = odds - 1; // Net odds
                const p = recommendedProb; // Valószínűség (0-1)
                const q = 1 - p;
                const kellyFraction = (b * p - q) / b;
                
                // Csak pozitív Kelly értékek (value bet)
                if (kellyFraction > 0) {
                    // Dinamikus fractional Kelly (confidence alapján)
                    // Ha confidence 9.0+ → 75% Kelly (agresszívabb)
                    // Ha confidence 8.0-8.9 → 60% Kelly
                    // Ha confidence 7.0-7.9 → 50% Kelly (konzervatív)
                    // Ha confidence 6.0-6.9 → 35% Kelly (nagyon konzervatív)
                    // Ha confidence < 6.0 → 25% Kelly (ultra konzervatív)
                    let fractionalMultiplier = 0.5; // Default 50%
                    if (rec.final_confidence >= 9.0) fractionalMultiplier = 0.75;
                    else if (rec.final_confidence >= 8.0) fractionalMultiplier = 0.60;
                    else if (rec.final_confidence >= 7.0) fractionalMultiplier = 0.50;
                    else if (rec.final_confidence >= 6.0) fractionalMultiplier = 0.35;
                    else fractionalMultiplier = 0.25;
                    
                    const fractionalKelly = kellyFraction * fractionalMultiplier;
                    // Maximum 5% bankroll per bet
                    const maxStakePercent = 5.0;
                    const optimalStakePercent = Math.min(maxStakePercent, fractionalKelly * 100);
                    
                    rec.kelly_stake = {
                        optimal_percent: optimalStakePercent.toFixed(2),
                        kelly_fraction: (kellyFraction * 100).toFixed(2),
                        recommended_stake: optimalStakePercent > 0 ? `${optimalStakePercent.toFixed(1)}% bankroll` : 'Nincs ajánlás (negatív value)',
                        explanation: optimalStakePercent > 0
                            ? `Kelly Criterion alapján: ${optimalStakePercent.toFixed(1)}% bankroll (${(kellyFraction * 100).toFixed(1)}% full Kelly, ${(fractionalMultiplier * 100).toFixed(0)}% fractional - confidence: ${rec.final_confidence.toFixed(1)}/10)`
                            : 'Nincs value bet (negatív Kelly)'
                    };
                    
                    console.log(`[AI_Service v143.0] 💰 Dinamikus Kelly Stake: ${optimalStakePercent.toFixed(1)}% bankroll (Odds: ${odds}, Prob: ${(recommendedProb * 100).toFixed(1)}%, Value: ${((odds * recommendedProb - 1) * 100).toFixed(1)}%, Confidence: ${rec.final_confidence.toFixed(1)}/10, Fractional: ${(fractionalMultiplier * 100).toFixed(0)}%)`);
                } else {
                    rec.kelly_stake = {
                        optimal_percent: '0.00',
                        kelly_fraction: (kellyFraction * 100).toFixed(2),
                        recommended_stake: 'Nincs ajánlás (negatív value)',
                        explanation: 'Nincs value bet (negatív Kelly)'
                    };
                }
            }
        }
        // === VÉGE v140.2 ===

        // === v149.0: VÉGLEGES RETURN (új struktúra: tips array) ===
        console.log(`[AI_Service v149.0 - Főnök] VÉGLEGES TIPPEK: ${rec.tips.length} db, átlag confidence: ${rec.final_confidence.toFixed(1)}/10`);
        
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
                // === v139.1: RÉSZLETES ADATOK ÁTADÁSA ===
                propheticTimeline = await getPropheticTimeline(
                    rawDataJson, 
                    home, 
                    away, 
                    sport, 
                    tacticalBriefing,
                    sim,  // ÚJ: Szimuláció eredmények
                    specialistReport  // ÚJ: Specialist elemzés
                );
            } catch (e: any) { 
                console.error(`[AI_Service v139.1] Hiba elkapva a 'getPropheticTimeline' hívásakor: ${e.message}`);
                propheticTimeline = `AI Hiba (Prophetic): ${e.message}`; 
            }
        } else {
            // === v145.1: MINDEN SPORTHOZ PRÓFÉTA ===
            // Még ha nincs külön logika, akkor is generálunk prófétát
            try {
                propheticTimeline = await getPropheticTimeline(
                    rawDataJson, 
                    home, 
                    away, 
                    sport, 
                    tacticalBriefing,
                    sim,
                    specialistReport
                );
            } catch (e: any) {
                console.error(`[AI_Service v145.1] Hiba elkapva a 'getPropheticTimeline' hívásakor (${sport}): ${e.message}`);
                propheticTimeline = `AI Hiba (Prophetic): ${e.message}`; 
            }
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
            sport, // Átadjuk a sportot (v103.6)
            matchData.leagueName  // === ÚJ v140.1: Liga név átadása ===
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

CRITICAL: Answer concisely and accurately in HUNGARIAN language only.
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
