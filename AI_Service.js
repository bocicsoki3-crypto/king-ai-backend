// === JAVÍTOTT AI_Service.js ===
// VERZIÓ: 2.0 (Robusztus JSON parsolás és refaktorált bizalmi logika)

import { getRichContextualData, _callGemini, _getFixturesFromEspn } from './DataFetch.js'; [cite: 24]
import {
    generateProTip, simulateMatchProgress, estimateXG,
    estimateAdvancedMetrics, calculateModelConfidence, calculatePsychologicalProfile,
    calculateValue, analyzeLineMovement, analyzePlayerDuels, buildPropheticTimeline
} from './Model.js'; [cite: 24]
import { SPORT_CONFIG } from './config.js'; [cite: 25]
import { getConfidenceCalibrationMap } from './LearningService.js'; [cite: 25]

// --- PROMPT SABLONOK ---

// === MÓDOSÍTOTT MASTER_AI_PROMPT_TEMPLATE ===
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst.
[cite: 27] Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
[cite: 28] **CRITICAL RULE: You MUST provide a concrete betting recommendation. Avoid "Nincs fogadás".
[cite: 29] Select the 'least bad' or most logical option even with uncertainty, and reflect this in the final_confidence score.**

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson} (Includes main & side markets like Corners/Cards if value found)
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence: {modelConfidence}/10
4. Expert Confidence: "{expertConfidence}" (This is the full report string including justification)
5. Risk Assessment: "{riskAssessment}"
6. Specialist Conclusions (Micromodels): "{microSummary}" (Includes Corners/Cards analysis if available)
7. General Analysis: "{generalAnalysis}"
8. Strategic Thoughts: "{strategicClosingThoughts}"
9. Contradiction Analysis: "{contradictionAnalysis}"

YOUR DECISION PROCESS:
1. Synthesize all reports.
[cite: 30] Find the betting angle with the most convergence across stats, narrative, and specialist models.
[cite: 31] 2. Prioritize Value Bets: If a reasonable Value Bet exists (especially >10% value) on a MAIN market (1X2, Totals, BTTS) AND it is not strongly contradicted by the narrative/specialists, it's a strong candidate.
[cite: 32] 3. Consider Main Markets: If no clear value bet, choose the main market outcome (1X2, O/U goals/points, BTTS) most supported by combined evidence (Sim Probs + Confidence levels + Narrative).
[cite: 33] 4. Side Market Check: Note the conclusions from specialist models (e.g., Corners, Cards) as context, but **DO NOT recommend them as the final bet.** Your recommended_bet MUST be from the main markets (1X2, Totals, BTTS, or Moneyline for non-soccer sports).
5. Reflect Uncertainty: Use the final_confidence score (1.0-10.0) accurately.
[cite: 35] Lower it significantly if risks are high, confidence scores conflict, or evidence is weak.
[cite: 36] OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this exact structure:
{"recommended_bet": "<The SINGLE most compelling market (e.g., Hazai győzelem, Over 2.5, BTTS Igen)>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the choice>"}
`;

const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician.
[cite: 38] Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
[cite: 39] CONTEXT: First, read the Risk Assessment report: "{riskAssessment}". Reflect this context (e.g., if risk is high, explain the tactical risk).
[cite: 40] DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Formation: H:{home_formation} vs A:{away_formation}, Duel: "{duelAnalysis}", Key Players: Home: {key_players_home}, Away: {key_players_away}.
[cite: 41] Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`; [cite: 41]
const PROPHETIC_EVENT_PROMPT = `You are a tactical pattern recognition expert.
[cite: 43] Based on the provided tactical patterns and key matchups for {home} vs {away}, identify the SINGLE most likely, specific, and recurring "Prophetic Snapshot" (a key event or tactical dynamic) that will define this match.
[cite: 44] Describe this specific event in 1-2 concise Hungarian sentences.

CRITICAL DATA:
- Tactical Patterns: {tacticalPatternsJson}
- Key Matchups: {keyMatchupsJson}
- Context: Key players: {keyPlayersJson}, Styles: {home_style} vs {away_style}

CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"event_snapshot": "<Your 1-2 sentence Hungarian prediction for the specific event>"}.`; [cite: 44]
const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}, based on the event timeline.
[cite: 46] CONTEXT: First, read the Tactical Briefing: "{tacticalBriefing}". Your narrative MUST match this tactical assessment.
[cite: 47] --- CRITICAL PROPHETIC SNAPSHOT (MUST INCLUDE!) ---
You MUST weave this specific predicted event into your narrative: "{propheticEvent}"
TIMELINE: {timelineJson}.
[cite: 48] Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}.
Weave a narrative. Highlight key moments and the outcome with **asterisks**.
[cite: 49] Use player names from Key Players if relevant to events: H: {key_players_home_names}, A: {key_players_away_names}.
[cite: 50] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here, including the Prophetic Snapshot>"}.`;

// === REFAKTORÁLÁS: EXPERT_CONFIDENCE_PROMPT ===
// A pontszámot és az indoklást külön kulcsokra kérjük
// a törékeny regex parsolás  elkerülése érdekében.
const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst.
[cite: 52] Provide a confidence score and justification in Hungarian.
**CRITICAL CONTEXT: The match is {home} vs {away}.
[cite: 53] DO NOT mention any other teams (e.g., Ferencváros, Debrecen).**
Start with Statistical Model Confidence ({modelConfidence}/10) and adjust it based on the Narrative Context ({richContext}).
[cite: 54] Consider factors like injuries, form discrepancies, H2H, market moves etc. mentioned in the context.
[cite: 55] --- CRITICAL OUTPUT FORMAT ---
Your response MUST be ONLY a single, valid JSON object with this EXACT structure:
{"score": <Number between 1.0-10.0>, "justification": "Indoklás."}
--- END CRITICAL OUTPUT FORMAT ---`;
// === REFAKTORÁLÁS VÉGE ===

// MÓDOSÍTOTT FINAL_GENERAL_ANALYSIS_PROMPT (CSAPATNÉV KÉNYSZERÍTÉSSEL)
const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief.
[cite: 58] Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
**CRITICAL CONTEXT: The match is {home} vs {away}.
[cite: 59] DO NOT mention any other teams or leagues.**
1st para: state the most likely outcome based purely on the statistical simulation (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; Expected Score: H {mu_h} - A {mu_a}).
[cite: 60] Mention the model's confidence: {modelConfidence}/10.
2nd para: explain the 'why' behind the prediction by synthesizing insights from the tactical briefing ("{tacticalBriefing}") and the prophetic scenario ("{propheticScenario}").
[cite: 61] Highlight key conclusions or turning points with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`; [cite: 61]
const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian).
[cite: 63] Focus ONLY on significant risks, potential upsets, or contradictions identified in the data.
Highlight significant risks with **asterisks**.
[cite: 64] DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Market Intel: "{marketIntel}". Context: News: H:{news_home}, A:{news_away}. Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Form: H:{form_home}, A:{form_away}.
[cite: 65] Tension: {tension}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`; [cite: 65]
const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst. Based ONLY on the provided context, formulate the two most critical strategic questions in Hungarian whose answers will likely decide the outcome of the match between {home} and {away}.
[cite: 67] Present as a bulleted list, starting each with '- '. CONTEXT: {richContext}.
[cite: 68] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"key_questions": "- Kérdés 1...\\n- Kérdés 2..."}.`;
const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist.
[cite: 70] Suggest 1-2 potentially interesting player-specific betting markets in Hungarian (e.g., player shots on target, assists, cards, points).
[cite: 71] Provide a very brief (1 sentence) justification. Max 3 sentences total.
Highlight player names & markets with **asterisks**.
[cite: 72] DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}.
[cite: 73] If no interesting market is found, state "Nincs kiemelkedő játékospiaci lehetőség."`; [cite: 73]
const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist.
[cite: 74] Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}.
[cite: 75] Consider team styles if available: H:{home_style}, A:{away_style}. Conclude with confidence level.
[cite: 76] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
[cite: 78] DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Consider team styles/absentees: H:{home_style}, A:{away_style}, Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key.
[cite: 79] Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`; [cite: 79]
const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs an estimated line around {likelyLine} based on mu={mu_corners}.
[cite: 81] DATA: Calculated mu_corners: {mu_corners}. Consider team styles (wing play?): H:{home_style}, A:{away_style}.
[cite: 82] Conclude with confidence level towards Over or Under a likely line (e.g., 9.5 or 10.5).
[cite: 83] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs an estimated line around {likelyLine} based on mu={mu_cards}.
[cite: 85] DATA: Calculated mu_cards: {mu_cards}. Consider context: Referee style: "{referee_style}", Match tension: "{tension}", Derby: {is_derby}.
[cite: 86] Conclude with confidence level towards Over or Under a likely line (e.g., 4.5 or 5.5).
[cite: 87] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}).
[cite: 89] DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Consider goalie GSAx: H:{home_gsax}, A:{away_gsax}. Conclude with confidence level.
[cite: 90] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%.
[cite: 92] Consider goalie GSAx: H:{home_gsax}, A:{away_gsax}, Form: H:{form_home}, A:{away_form}. Conclude with confidence level.
[cite: 93] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball O/U specialist. Analyze total points vs line ({line}).
[cite: 95] DATA: Sim Over {line}: {sim_pOver}%, Estimated Pace: {pace}, Team Styles: H: {home_style}, A: {away_style}. Conclude with confidence level.
[cite: 96] CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_points_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
[cite: 98] Synthesize ALL available reports: Risk Assessment, Tactical Briefing, Prophetic Scenario, Statistical Simulation results, Market Intelligence, Micromodel conclusions, and overall Context.
[cite: 99] Discuss the most promising betting angles considering both potential value and risk.
[cite: 100] Focus recommendations on MAIN MARKETS (1X2, Totals, BTTS, Moneyline). Briefly mention side market insights (Corners/Cards) as context if relevant, but do not suggest them as primary bets.
[cite: 101] Explicitly mention significant risks or contradictions if they heavily influence the strategy. Conclude with a summary of the strategic approach.
[cite: 102] DATA:
- Risk Assessment: "{riskAssessment}"
- Tactical Briefing: "{tacticalBriefing}"
- Scenario: "{propheticScenario}"
- Stats: Sim Probs H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. ModelConf: {modelConfidence}/10.
[cite: 103] ExpertConf: "{expertConfidence}"
- Market Intel: "{marketIntel}"
- Micromodels Summary: {microSummaryJson}
- Value Bets Found: {valueBetsJson}
- Context Summary: {richContext}
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`; [cite: 103]

// --- HELPER a promptok kitöltéséhez --- (Változatlan)
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return ''; [cite: 104]
    try { [cite: 105]
        return template.replace(/\{([\w_]+)\}/g, (match, key) => {
            let value = data;
            // Közvetlen kulcs keresése az adat objektumban
            if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
                 value = data[key];
            }
 
            // Speciális kezelés JSON stringekhez
            else if (key.endsWith('Json')) { [cite: 106]
                const baseKey = key.replace('Json', '');
                if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                    try { return JSON.stringify(data[baseKey]); }
  
                   catch (e) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; } [cite: 107]
                } else { return '{}'; } // Üres JSON, ha nincs adat
            }
            // Ha a kulcs nincs meg sehol
            else {
 
                console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`); [cite: 108]
                return "N/A";
            }

            // Érték formázása
            if (value === null || value === undefined) { return "N/A"; } [cite: 109]
            if (typeof value === 'number' && !isNaN(value)) {
                // Százalékok, bizalmi pontszámok
                if (key.startsWith('sim_p') || key.endsWith('_pct') || key === 'modelConfidence' || key === 'expertConfScore') return value.toFixed(1);
                // Várható értékek (xG, GSAx)
                if (key.startsWith('mu_') || key.startsWith('sim_mu_') || key === 'home_gsax' || key === 'away_gsax') return value.toFixed(2); [cite: 110]
                // Kosár statok
                if (key.startsWith('pace') || key.endsWith('Rating')) return value.toFixed(1); [cite: 111]
                // Szöglet, lap átlag
                if (key.includes('corner') || key.includes('card')) return value.toFixed(1); [cite: 112]
                // Módosítók
                if (key.endsWith('advantage') || key.endsWith('mod')) return value.toFixed(2); [cite: 113]
                // Vonalak (Totals, Corners, Cards)
                if (key === 'line' || key === 'likelyLine' || key === 'sim_mainTotalsLine') return value.toString(); [cite: 114]
                // Stringként adjuk vissza
                return value; [cite: 115]
            }
             if (typeof value === 'object') {
                 // Objektumokat JSON stringgé alakítunk (ha nem Json kulcs volt eleve)
                 try { return JSON.stringify(value); } [cite: 116]
                 catch (e) { return "[object]"; } [cite: 117]
             }
            // Minden más stringgé alakítva
            return String(value); [cite: 118]
        });
    } catch(e) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
         return template; [cite: 119]
    }
}

// === JAVÍTÁS: Robusztus AI JSON Válasz Feldolgozás ===

/**
 * Megtisztítja az AI által adott stringet,
 * eltávolítva a gyakori markdown címkéket és egyéb felesleget,
 * majd kinyeri a tiszta JSON stringet.
 * @param {string} rawResponse - Az AI-tól kapott nyers válasz.
 * @returns {string | null} - A tiszta JSON string, vagy null, ha nem található.
 */
function sanitizeAiResponse(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') return null;

    // Eltávolítja a ```json ... ``` burkolást és a felesleges szóközöket
    let sanitized = rawResponse
        .replace(/```json\n?/g, '')
        .replace(/\n?```/g, '')
        .trim();

    // Keresi az első '{' és az utolsó '}' karaktert
    const firstBrace = sanitized.indexOf('{');
    const lastBrace = sanitized.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        // Ha nincs érvényes JSON objektumra utaló jel
        console.warn("AI válasz tisztítása sikertelen: Nem található érvényes JSON objektum.");
        return null;
    }

    // Kivágja a JSON-nak tűnő részt
    return sanitized.substring(firstBrace, lastBrace + 1);
}

/**
 * Robusztus AI hívás, amely egy kulcsot nyer ki.
 * A `sanitizeAiResponse` használatával védekezik a JSON parsolási hibák ellen.
 */
async function getAndParse(promptTemplate, data, keyToExtract, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) { [cite: 120]
        try {
            const filledPrompt = fillPromptTemplate(promptTemplate, data);
            const rawResponse = await _callGemini(filledPrompt); [cite: 121]

            // === JAVÍTÁS: Robusztus parsolás ===
            const jsonString = sanitizeAiResponse(rawResponse);
            if (!jsonString) {
                throw new Error("AI response was empty or not valid JSON after sanitization.");
            }
            // === JAVÍTÁS VÉGE ===

            const result = JSON.parse(jsonString);
            
            if (result && typeof result === 'object' && result.hasOwnProperty(keyToExtract)) {
                return result[keyToExtract] || "N/A"; [cite: 122]
            }
            console.error(`AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot... Válasz:`, jsonString.substring(0, 200)); [cite: 122]
            return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot, vagy üres volt.`; [cite: 123]
        } catch (e) { [cite: 124]
            attempts++;
            console.warn(`AI Hiba a(z) ${keyToExtract} feldolgozásakor (Próba: ${attempts}/${retries + 1}): ${e.message}`); [cite: 125]
            if (attempts > retries) { [cite: 126]
                console.error(`Végleges AI Hiba (${keyToExtract}) ${attempts} próbálkozás után.`);
                const errorDetails = (e instanceof SyntaxError) ? ` Invalid JSON received.` : e.message; [cite: 128]
                return `AI Hiba (${keyToExtract}): ${errorDetails}`; [cite: 129]
            }
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); [cite: 130]
        }
    }
    return `AI Hiba (${keyToExtract}): Ismeretlen hiba a próbálkozások során.`; [cite: 131]
}

/**
 * === ÚJ HELPER FUNKCIÓ ===
 * Robusztus AI hívás, amely a teljes, parsolt JSON objektumot adja vissza.
 * Szükséges a refaktorált `getExpertConfidence` számára.
 */
async function _getFullParsedResponse(promptTemplate, data, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const filledPrompt = fillPromptTemplate(promptTemplate, data);
            const rawResponse = await _callGemini(filledPrompt);
            
            const jsonString = sanitizeAiResponse(rawResponse); // Az új tisztító függvény!
            if (!jsonString) {
                throw new Error("AI response empty or not valid JSON after sanitization.");
            }

            const result = JSON.parse(jsonString);
            
            if (result && typeof result === 'object') {
                return result; // Visszaadjuk a teljes JSON objektumot
            }
            throw new Error("AI response was not a valid object.");
        } catch (e) {
            attempts++;
            console.warn(`AI Hiba a _getFullParsedResponse során (Próba: ${attempts}/${retries + 1}): ${e.message}`);
            if (attempts > retries) {
                 console.error(`Végleges AI Hiba a _getFullParsedResponse során ${attempts} próbálkozás után.`);
                 return null; // Hiba esetén null-t adunk vissza
            }
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    return null;
}

// === JAVÍTÁS VÉGE ===


// --- FŐ EXPORTÁLT AI FUNKCIÓK ---

export async function _getContradictionAnalysis(context, probabilities, odds) { 
    return "Ellentmondás-analízis kikapcsolva."; [cite: 132]
}

export async function getAiKeyQuestions(richContext, rawData) {
    return await getAndParse(AI_KEY_QUESTIONS_PROMPT, {
         richContext,
         home: rawData?.home || 'Hazai',
         away: rawData?.away || 'Vendég'
    }, "key_questions"); [cite: 133]
}

export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis, riskAssessment) {
    const data = {
        sport, home, away,
        riskAssessment: riskAssessment || "N/A", [cite: 134]
        home_style: rawData?.tactics?.home?.style || "N/A", [cite: 135]
        away_style: rawData?.tactics?.away?.style || "N/A", [cite: 136]
        home_formation: rawData?.tactics?.home?.formation || "N/A", [cite: 137]
        away_formation: rawData?.tactics?.away?.formation || "N/A", [cite: 138]
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.', [cite: 139]
        key_players_home: rawData?.key_players?.home?.map(p => p.name).join(', ') || 'N/A', [cite: 140]
        key_players_away: rawData?.key_players?.away?.map(p => p.name).join(', ') || 'N/A' [cite: 140]
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis"); [cite: 141]
}

export async function getPropheticEvent(rawData, sport, home, away) {
    if (sport !== 'soccer') return "N/A"; [cite: 141]
    const data = { [cite: 142]
        sport, home, away,
        tacticalPatternsJson: rawData?.tactical_patterns,
        keyMatchupsJson: rawData?.key_matchups,
        keyPlayersJson: rawData?.key_players,
        home_style: rawData?.tactics?.home?.style || "N/A", [cite: 143]
        away_style: rawData?.tactics?.away?.style || "N/A" [cite: 143]
    };
    return await getAndParse(PROPHETIC_EVENT_PROMPT, data, "event_snapshot"); [cite: 144]
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport, tacticalBriefing, propheticEvent) {
     const data = {
         sport, home, away,
         tacticalBriefing: tacticalBriefing || "N/A", [cite: 145]
         propheticEvent: propheticEvent || "N/A", [cite: 146]
         timelineJson: propheticTimeline,
         home_style: rawData?.tactics?.home?.style || "N/A", [cite: 147]
         away_style: rawData?.tactics?.away?.style || "N/A", [cite: 148]
         tension: rawData?.contextual_factors?.match_tension_index || "N/A", [cite: 149]
         key_players_home_names: rawData?.key_players?.home?.map(p => p.name).join(', ') || 'N/A', [cite: 150]
         key_players_away_names: rawData?.key_players?.away?.map(p => p.name).join(', ') || 'N/A' [cite: 151]
     };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario"); [cite: 152]
}

// === REFAKTORÁLÁS: getExpertConfidence ===
// A függvény most már egy OBJEKTUMOT ad vissza: { score: number, report: string }
// Így nincs szükség többé a törékeny regex-alapú parsolásra  a `getMasterRecommendation`-ben.
export async function getExpertConfidence(modelConfidence, richContext, rawData = null) {
     const safeModelConfidence = typeof modelConfidence === 'number' ? modelConfidence : 5.0; [cite: 153]
     const data = {
         modelConfidence: safeModelConfidence,
         richContext: richContext || "Nincs kontextus.", [cite: 154]
         home: rawData?.home || 'Hazai', [cite: 155]
         away: rawData?.away || 'Vendég' [cite: 156]
     };
     
     // Az új, robusztus, teljes objektumot visszaadó helper hívása
     const result = await _getFullParsedResponse(EXPERT_CONFIDENCE_PROMPT, data);

     // Sikeres és érvényes válasz esetén
     if (result && typeof result.score === 'number' && typeof result.justification === 'string') {
        const score = Math.max(1.0, Math.min(10.0, result.score)); // Biztonsági korlátok
        return {
            score: score,
            report: `**${score.toFixed(1)}/10** - ${result.justification}`
        };
     }
     
     // Hiba esetén fallback
     console.warn(`Nem sikerült az expert confidence meghatározása. Fallback 1.0-ra. Kapott válasz:`, result);
     return {
         score: 1.0,
         report: "**1.0/10** - AI Hiba: Nem sikerült az expert bizalom meghatározása."
     };
}
// === REFAKTORÁLÁS VÉGE ===

export async function getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel) {
    const safeSim = sim || {}; [cite: 158]
    const countKeyAbsentees = (absentees) => Array.isArray(absentees) ?
        absentees.filter(p => p.importance === 'key').length : 0; [cite: 159]

    const data = {
        sport,
        sim_pHome: safeSim.pHome,
        sim_pDraw: safeSim.pDraw,
        sim_pAway: safeSim.pAway,
        marketIntel: marketIntel || "N/A", [cite: 160]
        news_home: rawData?.team_news?.home || "N/A", [cite: 161]
        news_away: rawData?.team_news?.away || "N/A", [cite: 162]
        absentees_home_count: countKeyAbsentees(rawData?.absentees?.home),
        absentees_away_count: countKeyAbsentees(rawData?.absentees?.away),
        form_home: rawData?.form?.home_overall || "N/A", [cite: 163]
        form_away: rawData?.form?.away_overall || "N/A", [cite: 164]
        tension: rawData?.contextual_factors?.match_tension_index || "N/A" [cite: 164]
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis"); [cite: 165]
}

export async function getFinalGeneralAnalysis(sim, mu_h, mu_a, tacticalBriefing, propheticScenario, rawData, modelConfidence) {
    const safeSim = sim || {}; [cite: 166]
    const data = {
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        mu_h: mu_h, mu_a: mu_a,
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0, [cite: 167]
        tacticalBriefing: tacticalBriefing || "N/A", [cite: 168]
        propheticScenario: propheticScenario || "N/A", [cite: 169]
        home: rawData?.home || 'Hazai', [cite: 170]
        away: rawData?.away || 'Vendég' [cite: 170]
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis"); [cite: 171]
}

export async function getPlayerMarkets(keyPlayers, richContext, rawData = null) {
    return await getAndParse(PLAYER_MARKETS_PROMPT, {
        keyPlayersJson: keyPlayers,
        richContext: richContext || "Nincs kontextus."
        }, "player_market_analysis"); [cite: 172]
}

// --- Mikromodell AI Hívások ---

export async function getBTTSAnalysis(sim, rawData) {
     const safeSim = sim || {}; [cite: 173]
     const data = {
        sim_pBTTS: safeSim.pBTTS,
        sim_mu_h: safeSim.mu_h_sim,
        sim_mu_a: safeSim.mu_a_sim,
        home_style: rawData?.tactics?.home?.style || "N/A", [cite: 174]
        away_style: rawData?.tactics?.away?.style || "N/A" [cite: 174]
     };
    return await getAndParse(BTTS_ANALYSIS_PROMPT, data, "btts_analysis"); [cite: 175]
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
     const safeSim = sim || {}; [cite: 176]
     const countKeyAbsentees = (absentees) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0; [cite: 176]
     const data = { [cite: 177]
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_style: rawData?.tactics?.home?.style || "N/A", [cite: 178]
        away_style: rawData?.tactics?.away?.style || "N/A", [cite: 179]
        absentees_home_count: countKeyAbsentees(rawData?.absentees?.home),
        absentees_away_count: countKeyAbsentees(rawData?.absentees?.away)
     };
    return await getAndParse(SOCCER_GOALS_OU_PROMPT, data, "goals_ou_analysis"); [cite: 180]
}

export async function getCornerAnalysis(sim, rawData) {
    const safeSim = sim || {}; [cite: 181]
    const muCorners = safeSim.mu_corners_sim; [cite: 181]
    const data = {
        mu_corners: muCorners,
        home_style: rawData?.tactics?.home?.style || "N/A", [cite: 182]
        away_style: rawData?.tactics?.away?.style || "N/A" [cite: 182]
    };
    const likelyLine = muCorners ? (Math.round(muCorners - 0.1)) + 0.5 : 9.5; [cite: 184]
    data.likelyLine = likelyLine; [cite: 185]
    return await getAndParse(CORNER_ANALYSIS_PROMPT, data, "corner_analysis"); [cite: 186]
}

export async function getCardAnalysis(sim, rawData) {
    const safeSim = sim || {}; [cite: 186]
    const muCards = safeSim.mu_cards_sim; [cite: 187]
    const data = {
        mu_cards: muCards,
        referee_style: rawData?.referee?.style || "N/A", [cite: 188]
        tension: rawData?.contextual_factors?.match_tension_index || "N/A", [cite: 189]
        is_derby: rawData?.contextual_factors?.match_tension_index?.toLowerCase().includes('derby') || [cite: 190]
                  rawData?.h2h_summary?.toLowerCase().includes('rivalry') ||
                  rawData?.h2h_summary?.toLowerCase().includes('derby')
    };
    const likelyLine = muCards ? (Math.round(muCards - 0.1)) + 0.5 : 4.5; [cite: 191]
    data.likelyLine = likelyLine; [cite: 192]
    return await getAndParse(CARD_ANALYSIS_PROMPT, data, "card_analysis"); [cite: 192]
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
     const safeSim = sim || {}; [cite: 193]
     const data = {
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx,
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx
     };
    return await getAndParse(HOCKEY_GOALS_OU_PROMPT, data, "hockey_goals_ou_analysis"); [cite: 194]
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
     const safeSim = sim || {}; [cite: 195]
     const data = {
        sim_pHome: safeSim.pHome,
        sim_pAway: safeSim.pAway,
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx,
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx,
        form_home: rawData?.form?.home_overall || "N/A", [cite: 196]
        form_away: rawData?.form?.away_overall || "N/A" [cite: 196]
     };
    return await getAndParse(HOCKEY_WINNER_PROMPT, data, "hockey_winner_analysis"); [cite: 197]
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
     const safeSim = sim || {}; [cite: 198]
     const homePace = rawData?.advancedData?.home?.pace; [cite: 199]
     const awayPace = rawData?.advancedData?.away?.pace; [cite: 200]
     const paceEstimate = (homePace && awayPace) ? (homePace + awayPace) / 2 : 98; [cite: 200]

     const data = { [cite: 201]
        line: mainTotalsLine,
        sim_pOver: safeSim.pOver,
        pace: paceEstimate,
        home_style: rawData?.shot_distribution?.home || "N/A", [cite: 202]
        away_style: rawData?.shot_distribution?.away || "N/A" [cite: 202]
     };
    return await getAndParse(BASKETBALL_POINTS_OU_PROMPT, data, "basketball_points_ou_analysis"); [cite: 203]
}

// --- Stratégiai és Mester AI ---

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment, tacticalBriefing, propheticScenario, valueBets, modelConfidence, expertConfidence) {
    // === FIGYELEM: A 'getExpertConfidence' refaktorálása miatt ===
    // 'expertConfidence' itt mostantól az objektum {score, report}
    // De a prompt [cite: 103] a teljes szöveges reportot várja "{expertConfidence}" kulcson.
    // Biztosítjuk, hogy a helyes (szöveges) értéket adjuk át.
    
    const safeSim = sim || {}; [cite: 204]
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
        const analysisPart = typeof val === 'string' ? val.split('\nBizalom:')[0].trim() : 'N/A';
        return `${key}: ${analysisPart}`;
    }).join('; '); [cite: 204]

    const data = { [cite: 205]
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        propheticScenario: propheticScenario || "N/A", [cite: 206]
        tacticalBriefing: tacticalBriefing || "N/A", [cite: 207]
        marketIntel: marketIntel || "N/A", [cite: 208]
        microSummaryJson: microSummary,
        richContext: richContext || "Nincs kontextus.", [cite: 209]
        riskAssessment: riskAssessment || "N/A", [cite: 210]
        valueBetsJson: valueBets,
        modelConfidence: typeof modelConfidence === 'number' ? modelConfidence : 5.0, [cite: 211]
        expertConfidence: expertConfidence?.report || "N/A" // A szöveges report átadása [cite: 212]
     };
    return await getAndParse(STRATEGIC_CLOSING_PROMPT, data, "strategic_analysis"); [cite: 212]
}

// === REFAKTORÁLÁS: getMasterRecommendation ===
// A függvény most már `expertConfidenceData` objektumot fogad
export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidenceData, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts, rawData, contradictionAnalysisResult) {
    const safeSim = sim || {}; [cite: 213]
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => `${key}: ${val || 'N/A'}`).join('; '); [cite: 213]

    // === REFAKTORÁLÁS KEZDETE: Regex blokk  eltávolítva ===
    // A pontszámot és a reportot közvetlenül az objektumból olvassuk.
    let expertConfScore = expertConfidenceData?.score;
    let expertConfidenceReportString = expertConfidenceData?.report;

    if (expertConfScore === undefined || expertConfScore === null) {
        console.warn(`Érvénytelen expertConfidenceData objektum a Master AI számára. Fallback 1.0-ra.`);
        expertConfScore = 1.0; [cite: 215, 222, 223]
    }
    if (!expertConfidenceReportString) {
        expertConfidenceReportString = "N/A"; [cite: 225]
    }
    
    console.log(`Expert confidence pontszám sikeresen beolvasva: ${expertConfScore}`); [cite: 221]
    // === REFAKTORÁLÁS VÉGE ===

    const safeModelConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence) ?
        modelConfidence : 5.0; [cite: 224]

    const data = {
        valueBetsJson: valueBets,
        sim_pHome: safeSim.pHome, sim_pDraw: safeSim.pDraw, sim_pAway: safeSim.pAway,
        sim_mainTotalsLine: safeSim.mainTotalsLine, sim_pOver: safeSim.pOver,
        modelConfidence: safeModelConfidence,
        expertConfidence: expertConfidenceReportString, // A teljes szöveg a promptnak [cite: 225]
        expertConfScore: expertConfScore, // A tiszta szám (bár a prompt ezt már nem használja, az utófeldolgozás igen)
        riskAssessment: riskAssessment || "N/A", [cite: 226]
        microSummary: microSummary,
        generalAnalysis: generalAnalysis || "N/A", [cite: 227]
        strategicClosingThoughts: strategicClosingThoughts || "N/A", [cite: 228]
        contradictionAnalysis: contradictionAnalysisResult || "N/A"
    };

    try { [cite: 229]
         const rawResponse = await _callGemini(fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data));
         // === JAVÍTÁS: Robusztus parsolás ===
         const jsonString = sanitizeAiResponse(rawResponse);
         if (!jsonString) {
            throw new Error("Master AI response was empty or not valid JSON after sanitization.");
         }
         // === JAVÍTÁS VÉGE ===

         let rec = JSON.parse(jsonString); [cite: 230]

         if (rec && rec.recommended_bet && typeof rec.final_confidence === 'number') {

            // --- Utófeldolgozás: Bizalom finomítása ---
            const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
            const disagreementThreshold = 3.0; [cite: 231]
            let confidencePenalty = 0;
            let disagreementNote = ""; [cite: 232]
            
            if (expertConfScore < 1.1 && expertConfidenceReportString && !expertConfidenceReportString.toLowerCase().includes("hiba")) {
                 confidencePenalty = Math.max(0, rec.final_confidence - 3.0); [cite: 233]
                 disagreementNote = " (Expert bizalom extrém alacsony!)"; [cite: 234]
            }
            else if (confidenceDiff > disagreementThreshold) {
                confidencePenalty = Math.min(2.0, confidenceDiff / 1.5); [cite: 235]
                disagreementNote = " (Modell vs Expert eltérés miatt korrigálva.)"; [cite: 236]
            }
            
            rec.final_confidence -= confidencePenalty;
            rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence)); [cite: 237]

            // 2. Bizalmi Kalibráció (Meta-tanulás)
            let calibrationNote = ""; [cite: 238]
            try {
                const calibrationMap = getConfidenceCalibrationMap(); [cite: 239]
                if (calibrationMap && Object.keys(calibrationMap).length > 0) { [cite: 239]
                    const confFloor = Math.floor(rec.final_confidence); [cite: 240]
                    const safeConfFloor = Math.max(1.0, confFloor);
                    const bucketKey = `${safeConfFloor.toFixed(1)}-${(safeConfFloor + 0.9).toFixed(1)}`; [cite: 240]
                    
                    if (calibrationMap[bucketKey] && calibrationMap[bucketKey].total >= 5) { [cite: 241]
                        const wins = calibrationMap[bucketKey].wins; [cite: 241]
                        const total = calibrationMap[bucketKey].total; [cite: 242]
                        const calibratedPct = (wins / total) * 100; [cite: 243]
                        const calibratedConfidence = calibratedPct / 10; [cite: 244]
                        
                        if (Math.abs(calibratedConfidence - rec.final_confidence) > 0.5) { [cite: 244]
                             calibrationNote = ` (Kalibrált: ${calibratedConfidence.toFixed(1)}/10, ${total} minta.)`; [cite: 245]
                        }
                    }
                }
            } catch(calError) { console.warn(`Bizalmi kalibráció hiba: ${calError.message}`); } [cite: 246]

            rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote; [cite: 247]
            if (rec.brief_reasoning.length > 500) {
                 rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "..."; [cite: 248]
            }

            return rec; [cite: 249]
         }
        
        console.error("Master AI hiba: Érvénytelen JSON struktúra a válaszban:", rec); [cite: 250]
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": "AI hiba: Érvénytelen JSON struktúra." }; [cite: 250]
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack); [cite: 252]
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": `AI Hiba: ${e.message.substring(0, 100)}` }; [cite: 253]
    }
}


// --- CHAT FUNKCIÓ --- (Változatlan, de a robusztus parsolást itt is alkalmazzuk)
export async function getChatResponse(context, history, question) {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." }; [cite: 254]
    try {
        const historyString = (history || [])
            .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            .join('\n'); [cite: 255]
        
        const prompt = `You are an elite sports analyst AI assistant specialized in the provided match analysis.
[cite: 256] CONTEXT of the analysis:
--- START CONTEXT ---
${context}
--- END CONTEXT ---

CONVERSATION HISTORY:
${historyString}

Current User Question: ${question}

Answer concisely and accurately in Hungarian based ONLY on the provided Analysis Context and Conversation History.
[cite: 257] Do not provide betting advice. Do not make up information not present in the context.
[cite: 258] If the answer isn't in the context or history, politely state that the information is not available in the analysis.`;
[cite: 259] 
        const rawAnswer = await _callGemini(prompt
             .replace("Your entire response must be ONLY a single, valid JSON object.", "")
             .replace("Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.", "")
             .replace("Ensure the JSON is complete and well-formed.", "") [cite: 260]
        );
        
        // === JAVÍTÁS: Robusztus tisztítás itt is ===
        let answerText = rawAnswer; [cite: 261]
        try {
            // Megpróbáljuk parse-olni, hátha mégis JSON-t adott vissza
            const jsonString = sanitizeAiResponse(rawAnswer); // Tisztítás
            if (jsonString) {
                const parsed = JSON.parse(jsonString); [cite: 263]
                answerText = parsed.answer || parsed.response || Object.values(parsed).find(v => typeof v === 'string') || rawAnswer; [cite: 264]
            } else {
                // Ha nem JSON, csak a markdown tageket távolítjuk el
                answerText = rawAnswer.replace(/```json\n?/, '').replace(/```\n?/, '').trim(); [cite: 265]
            }
        } catch (e) {
            // Ha a tiszta JSON parse-olása hibás, marad a nyers (de tisztított) szöveg
            answerText = rawAnswer.replace(/```json\n?/, '').replace(/```\n?/, '').trim(); [cite: 266]
        }
        // === JAVÍTÁS VÉGE ===

         return answerText ? { answer: answerText } : { error: "Az AI nem tudott válaszolni." }; [cite: 267]
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`, e.stack); [cite: 269]
        return { error: `Chat AI hiba: ${e.message}` }; [cite: 269]
    }
}

// --- FŐ EXPORT ---
// A felesleges `export default` blokk [cite: 270] eltávolítva.
// Minden függvény már nevesítve van exportálva (`export async function ...`).
