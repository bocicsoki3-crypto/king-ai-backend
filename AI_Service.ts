// FÁJL: AI_Service.ts
// VERZIÓ: v139.1 (PROPHETIC ACCURACY UPGRADE) 🧠
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
// v139.0: PURE AI MODE - Vissza az egyszerűséghez!
// Nincs "Conservative", "Proportional", "Limits". Csak az IGAZSÁG.
const PROMPT_SPECIALIST_V95 = `
TASK: You are 'The Specialist', an expert sports analyst.
Your job is to adjust the baseline statistical prediction based on CONTEXT.

[YOUR MISSION]:
The statistical model (Quant) provides a baseline. It doesn't know about injuries, weather, or tactical matchups.
YOU DO.
Analyze the context and adjust the Expected Goals (xG) to reflect REALITY.

[PRINCIPLES]:
1. **BE HONEST**: If the stats say Home wins, but their star striker is out and they lost 5 in a row, ADJUST IT DOWN!
2. **NO ARTIFICIAL LIMITS**: If the context changes the game completely, make a BIG adjustment. If it's minor, make a small one.
3. **USE YOUR BRAIN**: Don't just follow rules. Look at the matchup. Who is actually better RIGHT NOW?

[BASELINE PREDICTION]:
- Home Team xG: {pure_mu_h}
- Away Team xG: {pure_mu_a}
- Source: {quant_source}

[CONTEXTUAL DATA]:
{rawDataJson}

[PSYCHOLOGY]:
- Home: {psy_profile_home}
- Away: {psy_profile_away}

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "modified_mu_h": <Number (adjusted home xG)>,
  "modified_mu_a": <Number (adjusted away xG)>,
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
  "reasoning": "<Részletes magyar magyarázat a módosítás okairól>"
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

export const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist with perfect predictive abilities.
Write a REALISTIC and DETAILED match scenario (timeline) in Hungarian for: {home} vs {away}

[CRITICAL DATA - USE THESE FOR ACCURACY]:
- **Expected Score (Most Likely)**: {expected_score} ({score_probability}% probability)
- **Expected Goals**: Home {mu_h}, Away {mu_a}
- **Win Probabilities**: Home {prob_home}%, Draw {prob_draw}%, Away {prob_away}%
- **Specialist Analysis**: {specialist_reasoning}
- **Key Players**: Home: {key_players_home} | Away: {key_players_away}
- **Missing Players**: Home: {absentees_home} | Away: {absentees_away}
- **Tactical Briefing**: {tacticalBriefing}
- **Styles**: {home_style} vs {away_style}

[RULES FOR ACCURACY]:
1. **MUST END WITH**: "**Végeredmény: {home} X-Y {away}**" - Use the {expected_score} as your primary guide!
2. Use specific minutes (e.g., "12. perc", "67. perc")
3. Mention key players by name when they score or create chances
4. Reflect the expected goals (mu_h, mu_a) in the narrative - if mu_h is higher, Home should score more
5. If {prob_home} > 50%, Home should win. If {prob_away} > 50%, Away should win. If {prob_draw} > 30%, consider a draw.
6. Consider missing players' impact on the match flow
7. Make it REALISTIC - not fantasy. Base it on the statistical probabilities.
8. The final score MUST match {expected_score} exactly!

[OUTPUT FORMAT] - STRICT JSON:
{
  "scenario": "<Detailed Hungarian timeline with specific minutes, player actions, and the EXACT final score: **Végeredmény: {home} X-Y {away}**>"
}`;

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


// === A FŐNÖK PROMPTJA (GOD MODE V2.0 - PURE AI) ===
const MASTER_AI_PROMPT_TEMPLATE_GOD_MODE = `
═══════════════════════════════════════════════════════════════
               KING AI - MASTER ANALYST PROTOCOL V2.0
                    "Pure Intelligence Mode"
═══════════════════════════════════════════════════════════════

You are the **SUPREME DECISION ENGINE**.
Your goal: Find the SINGLE BEST BET for this match.

[DATA]:
- Statistical Probs: Home {sim_pHome}%, Draw {sim_pDraw}%, Away {sim_pAway}%
- Expected Score: {sim_topScore} ({sim_topScoreProb}%)
- Value Bets: {valueBetsJson}
- Model Confidence: {modelConfidence}/10
- Expert Confidence: "{expertConfidence}"
- Risk: "{riskAssessment}"
- Specialist: {specialistReportJson}

[DECISION LOGIC]:
1. Look at the STATS.
2. Look at the CONTEXT (Injuries, Form, Motivation).
3. If they agree -> HIGH CONFIDENCE.
4. If they disagree -> Find out WHY and pick the side with STRONGER EVIDENCE.
5. **BE DECISIVE.** Don't hedge. Pick a winner.

[OUTPUT FORMAT] - STRICT JSON:
{
  "recommended_bet": "<THE CHOSEN BET (e.g. 'Arsenal győzelem', 'Over 2.5 gól')>",
  "final_confidence": <Number 1.0-10.0>,
  "brief_reasoning": "<One powerful Hungarian sentence explaining WHY.>",
  "verdict": "<2-3 sentences Hungarian summary. BE CONCRETE. State the expected outcome clearly.>",
  "primary": {
    "market": "<Primary Market>",
    "confidence": <Number>,
    "reason": "<Detailed reason>"
  },
  "secondary": {
    "market": "<Alternative Market>",
    "confidence": <Number>,
    "reason": "<Detailed reason>"
  },
  "betting_strategy": {
    "stake_recommendation": "<1-5 units>",
    "market_timing": "<Advice>",
    "hedge_suggestion": "<Advice>"
  },
  "key_risks": [
    {"risk": "<Risk 1>", "probability": <%>},
    {"risk": "<Risk 2>", "probability": <%>}
  ],
  "why_not_alternatives": "<Short explanation>"
}
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
     const topScoreProb = sim?.scores && sim?.scores[topScoreKey] ? 
         ((sim.scores[topScoreKey] / 25000) * 100).toFixed(1) : "N/A";
     
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
         prob_draw: sim?.pDraw?.toFixed(1) || "N/A",
         prob_away: sim?.pAway?.toFixed(1) || "N/A",
         specialist_reasoning: specialistReport?.reasoning || "N/A",
         key_players_home: rawData?.key_players?.home?.map((p: any) => p.name || p.player_name).filter(Boolean).join(', ') || "N/A",
         key_players_away: rawData?.key_players?.away?.map((p: any) => p.name || p.player_name).filter(Boolean).join(', ') || "N/A",
         absentees_home: rawData?.absentees?.home?.map((p: any) => p.name).filter(Boolean).join(', ') || "Nincs",
         absentees_away: rawData?.absentees?.away?.map((p: any) => p.name).filter(Boolean).join(', ') || "Nincs"
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

        // === v139.0: NINCS TÖBB CONFIDENCE PENALTY! ===
        // Hagyjuk, hogy az AI döntse el a bizalmat.
        // Töröljük a mesterséges büntetéseket (League Quality, Contradiction, stb.)
        
        rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));

        // 2. Bizalmi Kalibráció (Meta-tanulás) - Ez marad, mert hasznos
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
        rec.brief_reasoning = (rec.brief_reasoning || "N/A") + calibrationNote;
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
                ? `⚠️ Jelentős eltérés (${confidenceGap.toFixed(1)} pont) a matematikai modell és a kontextuális elemzés között.`
                : confidenceGap > 1.5
                ? `📊 Közepes eltérés (${confidenceGap.toFixed(1)} pont) észlelhető.`
                : `✅ A statisztikai modell (${quantConfidence.toFixed(1)}/10) és a szakértői elemzés (${specialistConfidence.toFixed(1)}/10) összhangban van.`
        };
        console.log(`[AI_Service v133.0] 🌉 Bizalmi Híd: Quant ${quantConfidence.toFixed(1)} vs Specialist ${specialistConfidence.toFixed(1)} (Gap: ${confidenceGap.toFixed(1)})`);
        // ======================================================

        console.log(`[AI_Service v138.0 - Főnök] VÉGLEGES TIPP: ${rec.recommended_bet} @ ${rec.final_confidence.toFixed(1)}/10`);
        
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
