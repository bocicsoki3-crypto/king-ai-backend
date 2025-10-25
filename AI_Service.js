/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
 * - getMasterRecommendation: Ellenőrzi a modelConfidence vs expertConfidence közötti
 * nagy eltérést, és szükség esetén csökkenti a final_confidence-t,
 * valamint megemlíti ezt az indoklásban.
 * VÁLTOZÁS (Fejlesztési Csomag):
 * - Hozzáadva: getPropheticEvent AI szakértő.
 * - Módosítva: getPropheticScenario használja a Prophetic Event-et.
 * - Módosítva: getMasterRecommendation kalibrált bizalmat is kijelez.
 * - Módosítva: calculateValue kiterjesztve mellékpiacokra.
 * - Módosítva: getMasterRecommendation promptja figyelembe veszi a mellékpiacokat.
 */
import { getRichContextualData, getOptimizedOddsData, _callGemini, _getFixturesFromEspn } from './DataFetch.js'; // Adatlekérő importok
import {
    calculateProbabilities, generateProTip, simulateMatchProgress, estimateXG,
    estimateAdvancedMetrics, calculateModelConfidence, calculatePsychologicalProfile,
    calculateValue, analyzeLineMovement, analyzePlayerDuels, buildPropheticTimeline
} from './Model.js'; // Modell importok (bár néhány placeholder)
// Nincs szükség a SheetService importra itt
import { SPORT_CONFIG } from './config.js'; // Konfiguráció import

// --- MÓDOSÍTÁS KEZDETE ---
// Importáljuk a 'Learningservice'-ből az új kalibrációs térképet
import { getConfidenceCalibrationMap } from './LearningService.js';
// --- MÓDOSÍTÁS VÉGE ---

// --- PROMPT SABLONOK (STRUKTÚRA-KÉNYSZERÍTŐVEL) ---

// --- MÓDOSÍTÁS KEZDETE: Master AI prompt frissítése (3. Pont) ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Head Analyst.
Your task is to analyze ALL provided reports and determine the SINGLE most compelling betting recommendation.
**CRITICAL RULE: You MUST provide a concrete betting recommendation. Avoid "Nincs fogadás".
Select the 'least bad' or most logical option even with uncertainty, and reflect this in the final_confidence score.**

CRITICAL INPUTS:
1. Value Bets: {valueBetsJson} (Includes main & side markets like Corners/Cards if value found)
2. Sim Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%, O/U {sim_mainTotalsLine}: O:{sim_pOver}%
3. Model Confidence: {modelConfidence}/10
4. Expert Confidence: "{expertConfidence}"
5. Risk Assessment: "{riskAssessment}"
6. Specialist Conclusions (Micromodels): "{microSummary}" (Includes Corners/Cards analysis if available)
7. General Analysis: "{generalAnalysis}"
8. Strategic Thoughts: "{strategicClosingThoughts}"
9. Contradiction Analysis: "{contradictionAnalysis}"

YOUR DECISION PROCESS:
1. Synthesize all reports. Find the betting angle with the most convergence across stats, narrative, and specialist models.
2. Prioritize Value Bets: If a reasonable Value Bet exists (especially >10% value) AND it is supported or not strongly contradicted by the narrative/specialists, it's a strong candidate.
3. Consider Main Markets: If no clear value bet, choose the main market outcome (1X2, O/U goals/points) most supported by combined evidence (Sim Probs + Confidence levels + Narrative).
4. Consider Side Markets: If main markets are uncertain BUT a specialist model (e.g., Corners, Cards) shows high confidence AND potentially aligns with value bets or narrative, consider recommending that side market.
5. Reflect Uncertainty: Use the final_confidence score (1.0-10.0) accurately. Lower it significantly if risks are high, confidence scores conflict, or evidence is weak.

OUTPUT FORMAT: Your response MUST be ONLY a single, valid JSON object with this exact structure:
{"recommended_bet": "<The SINGLE most compelling market (e.g., Hazai győzelem, Over 2.5, Corners Over 9.5)>", "final_confidence": <Number between 1.0-10.0>, "brief_reasoning": "<SINGLE concise Hungarian sentence explaining the choice>"}
`;
// --- MÓDOSÍTÁS VÉGE ---

const TACTICAL_BRIEFING_PROMPT = `You are a world-class sports tactician. Provide a concise tactical briefing (2-4 sentences max, Hungarian) for {home} vs {away}.
CONTEXT: First, read the Risk Assessment report: "{riskAssessment}". Reflect this context (e.g., if risk is high, explain the tactical risk).
DATA: Styles: {home} ("{home_style}") vs {away} ("{away_style}"), Formation: H:{home_formation} vs A:{away_formation}, Duel: "{duelAnalysis}", Key Players: Home: {key_players_home}, Away: {key_players_away}.
Highlight key elements with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"analysis": "<Your Hungarian tactical briefing here>"}.`;

// --- MÓDOSÍTÁS KEZDETE ---
// --- ÚJ PROMPT SABLON: Prófétai Pillanatkép ---
const PROPHETIC_EVENT_PROMPT = `You are a tactical pattern recognition expert.
Based on the provided tactical patterns and key matchups for {home} vs {away}, identify the SINGLE most likely, specific, and recurring "Prophetic Snapshot" (a key event or tactical dynamic) that will define this match.
Describe this specific event in 1-2 concise Hungarian sentences.

CRITICAL DATA:
- Tactical Patterns: {tacticalPatternsJson}
- Key Matchups: {keyMatchupsJson}
- Context: Key players: {keyPlayersJson}, Styles: {home_style} vs {away_style}

CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"event_snapshot": "<Your 1-2 sentence Hungarian prediction for the specific event>"}.`;


// --- MÓDOSÍTOTT PROMPT SABLON: Prófétai Forgatókönyv ---
const PROPHETIC_SCENARIO_PROMPT = `You are an elite sports journalist. Write a compelling, descriptive, prophetic scenario in Hungarian for {home} vs {away}, based on the event timeline.
CONTEXT: First, read the Tactical Briefing: "{tacticalBriefing}". Your narrative MUST match this tactical assessment.
--- CRITICAL PROPHETIC SNAPSHOT (MUST INCLUDE!) ---
You MUST weave this specific predicted event into your narrative: "{propheticEvent}"
TIMELINE: {timelineJson}. Tactics: {home} ({home_style}) vs {away} ({away_style}), Tension: {tension}.
Weave a narrative. Highlight key moments and the outcome with **asterisks**. Use player names from Key Players if relevant to events: H: {key_players_home_names}, A: {key_players_away_names}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"scenario": "<Your Hungarian prophetic narrative here, including the Prophetic Snapshot>"}.`;
// --- MÓDOSÍTÁS VÉGE ---

const EXPERT_CONFIDENCE_PROMPT = `You are a master betting risk analyst. Provide a confidence score and justification in Hungarian.
Start with Statistical Model Confidence ({modelConfidence}/10) and adjust it based on the Narrative Context ({richContext}). Consider factors like injuries, form discrepancies, H2H, market moves etc. mentioned in the context.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"confidence_report": "**SCORE/10** - Indoklás."}. Score MUST be between 1.0 and 10.0.`;

const RISK_ASSESSMENT_PROMPT = `You are a risk assessment analyst. Write a "Kockázatkezelői Jelentés" (2-4 sentences, Hungarian). Focus ONLY on significant risks, potential upsets, or contradictions identified in the data.
Highlight significant risks with **asterisks**. DATA: Sim: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. Market Intel: "{marketIntel}". Context: News: H:{news_home}, A:{news_away}. Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Form: H:{form_home}, A:{form_away}. Tension: {tension}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"risk_analysis": "<Your Hungarian risk report here>"}.`;

const FINAL_GENERAL_ANALYSIS_PROMPT = `You are an Editor-in-Chief. Write "Általános Elemzés" (exactly TWO paragraphs, Hungarian).
1st para: state the most likely outcome based purely on the statistical simulation (Probs: H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%; Expected Score: H {mu_h} - A {mu_a}). Mention the model's confidence: {modelConfidence}/10.
2nd para: explain the 'why' behind the prediction by synthesizing insights from the tactical briefing ("{tacticalBriefing}") and the prophetic scenario ("{propheticScenario}"). Highlight key conclusions or turning points with **asterisks**.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"general_analysis": "<Your two-paragraph Hungarian summary here>"}.`;

const AI_KEY_QUESTIONS_PROMPT = `You are a strategic analyst. Based ONLY on the provided context, formulate the two most critical strategic questions in Hungarian whose answers will likely decide the outcome of the match between {home} and {away}.
Present as a bulleted list, starting each with '- '. CONTEXT: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"key_questions": "- Kérdés 1...\\n- Kérdés 2..."}.`;

const PLAYER_MARKETS_PROMPT = `You are a player performance markets specialist. Based on the key players and context, suggest 1-2 potentially interesting player-specific betting markets in Hungarian (e.g., player shots on target, assists, cards, points). Provide a very brief (1 sentence) justification. Max 3 sentences total.
Highlight player names & markets with **asterisks**. DATA: Key Players: {keyPlayersJson}, Context: {richContext}.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"player_market_analysis": "<Your Hungarian player market analysis here>"}. If no interesting market is found, state "Nincs kiemelkedő játékospiaci lehetőség."`;

// --- Mellékpiaci Promptok (Változatlanok) ---
const BTTS_ANALYSIS_PROMPT = `You are a BTTS specialist. Analyze if both teams will score (Igen/Nem).
DATA: Sim BTTS: {sim_pBTTS}%, xG: H {sim_mu_h} - A {sim_mu_a}. Consider team styles if available: H:{home_style}, A:{away_style}. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"btts_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const SOCCER_GOALS_OU_PROMPT = `You are a Soccer O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Consider team styles/absentees: H:{home_style}, A:{away_style}, Absentees: H:{absentees_home_count} key, A:{absentees_away_count} key. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const CORNER_ANALYSIS_PROMPT = `You are a Soccer Corners specialist. Analyze total corners vs an estimated line around 9.5-10.5 based on mu={mu_corners}.
DATA: Calculated mu_corners: {mu_corners}. Consider team styles (wing play?): H:{home_style}, A:{away_style}. Conclude with confidence level towards Over or Under a likely line (e.g., 9.5 or 10.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"corner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const CARD_ANALYSIS_PROMPT = `You are a Soccer Cards specialist. Analyze total cards vs an estimated line around 4.5-5.5 based on mu={mu_cards}.
DATA: Calculated mu_cards: {mu_cards}. Consider context: Referee style: "{referee_style}", Match tension: "{tension}", Derby: {is_derby}. Conclude with confidence level towards Over or Under a likely line (e.g., 4.5 or 5.5).
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"card_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_GOALS_OU_PROMPT = `You are an Ice Hockey O/U specialist. Analyze total goals vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, xG Sum: {sim_mu_sum}. Consider goalie GSAx: H:{home_gsax}, A:{away_gsax}. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_goals_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const HOCKEY_WINNER_PROMPT = `You are an Ice Hockey Winner specialist. Analyze the winner (incl. OT).
DATA: Sim Probs: H:{sim_pHome}%, A:{sim_pAway}%. Consider goalie GSAx: H:{home_gsax}, A:{away_gsax}, Form: H:{form_home}, A:{form_away}. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"hockey_winner_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;
const BASKETBALL_POINTS_OU_PROMPT = `You are a Basketball O/U specialist. Analyze total points vs line ({line}).
DATA: Sim Over {line}: {sim_pOver}%, Estimated Pace: {pace}, Team Styles: H: {home_style}, A: {away_style}. Conclude with confidence level.
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"basketball_points_ou_analysis": "<Your one-paragraph Hungarian analysis>\\nBizalom: [Alacsony/Közepes/Magas]"}.`;

// --- Stratégiai Zárógondolatok Prompt (Változatlan) ---
const STRATEGIC_CLOSING_PROMPT = `You are the Master Analyst. Craft "Stratégiai Zárógondolatok" (2-3 Hungarian paragraphs).
Synthesize ALL available reports: Risk Assessment, Tactical Briefing, Prophetic Scenario, Statistical Simulation results, Market Intelligence, Micromodel conclusions, and overall Context.
Discuss the most promising betting angles considering both potential value and risk. Explicitly mention significant risks or contradictions if they heavily influence the strategy. Conclude with a summary of the strategic approach.
DATA:
- Risk Assessment: "{riskAssessment}"
- Tactical Briefing: "{tacticalBriefing}"
- Scenario: "{propheticScenario}"
- Stats: Sim Probs H:{sim_pHome}%, D:{sim_pDraw}%, A:{sim_pAway}%. O/U {sim_mainTotalsLine}: O:{sim_pOver}%. ModelConf: {modelConfidence}/10. ExpertConf: "{expertConfidence}"
- Market Intel: "{marketIntel}"
- Micromodels Summary: {microSummaryJson}
- Value Bets Found: {valueBetsJson}
- Context Summary: {richContext}
CRITICAL OUTPUT INSTRUCTION: Your response MUST be ONLY a single, valid JSON object with this structure: {"strategic_analysis": "<Your comprehensive Hungarian strategic thoughts here>"}.`;

// --- HELPER a promptok kitöltéséhez (Változatlan) ---
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    // Hozzáadunk egy try-catch blokkot a teljes cserére
    try {
        return template.replace(/\{([\w_]+)\}/g, (match, key) => {
            let value = data;
            // Egyszerűsített kulcs keresés
            if (data && typeof data === 'object' && key in data) {
                 value = data[key];
            } else {
                // Ha nincs direkt kulcs, próbáljuk meg JSON-ként kezelni, ha Json-ra végződik
                 if (key.endsWith('Json')) {
                    const baseKey = key.replace('Json', '');
                    if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                        try { return JSON.stringify(data[baseKey]); } catch (e) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`); return '{}'; }
                    } else { return '{}'; } // Üres JSON, ha nincs adat
                }
                // Ha más kulcs nincs meg, 'N/A'
                console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
                return "N/A"; // Visszaadjuk az N/A-t, ha a kulcs nem található
            }

            // Érték formázása
            if (value === null || value === undefined) {
                 return "N/A"; // Null vagy undefined -> N/A
            }
            if (typeof value === 'number' && !isNaN(value)) {
                // Specifikus formázások számokra
                if (key.startsWith('sim_p') || key.endsWith('_pct') || key === 'modelConfidence' || key === 'expertConfScore') return value.toFixed(1);
                if (key.startsWith('mu_') || key.startsWith('sim_mu_') || key === 'home_gsax' || key === 'away_gsax') return value.toFixed(2); // GSAx is lehet tizedes
                if (key.startsWith('pace') || key.endsWith('Rating')) return value.toFixed(1); // Kosár statok
                if (key.includes('corner') || key.includes('card')) return value.toFixed(1); // Szöglet/lap mu
                if (key.endsWith('advantage') || key.endsWith('mod')) return value.toFixed(2); // Módosítók
                if (key === 'line' || key === 'likelyLine' || key === 'sim_mainTotalsLine') return value.toString(); // Vonalak stringként
                return value; // Egyéb számok változatlanul
            }
             if (typeof value === 'object') { // Ha objektum maradt (pl. JSON stringify nélkül), próbáljuk meg stringgé alakítani
                 try { return JSON.stringify(value); } catch (e) { return "[object]"; }
             }

            // String értékek (vagy egyéb típusok)
            return String(value);
        });
    } catch(e) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
         return template; // Hiba esetén visszaadjuk az eredeti template-et
    }
}


// === AI elemzők, automatikus újrapróbálkozással (Változatlan) ===
async function getAndParse(promptTemplate, data, keyToExtract, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            // Prompt kitöltése
            const filledPrompt = fillPromptTemplate(promptTemplate, data);
            // Gemini hívás
            const jsonString = await _callGemini(filledPrompt);
            // JSON Parse
            const result = JSON.parse(jsonString);
            // Kulcs ellenőrzése és érték visszaadása
            if (result && typeof result === 'object' && keyToExtract in result) {
                // Javítás: Üres string helyett adjunk vissza N/A-t, ha az érték üres
                return result[keyToExtract] || "N/A";
            }
            console.error(`AI Hiba: A válasz JSON (${keyToExtract}) nem tartalmazta a várt kulcsot, vagy az értéke üres volt. Válasz:`, jsonString.substring(0, 200));
            return `AI Hiba: A válasz JSON nem tartalmazta a '${keyToExtract}' kulcsot, vagy üres volt.`; // Részletesebb hibaüzenet
        } catch (e) {
            attempts++;
            console.warn(`AI Hiba a(z) ${keyToExtract} feldolgozásakor (Próba: ${attempts}/${retries + 1}): ${e.message}`);
            if (attempts > retries) { // Ha elfogytak a próbálkozások
                console.error(`Végleges AI Hiba (${keyToExtract}) ${attempts} próbálkozás után.`);
                return `AI Hiba (${keyToExtract}): ${e.message}`; // Visszaadjuk a hibaüzenetet
            }
            // Várakozás exponenciális backoff-fal
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    // Ha a ciklus valamiért véget ér anélkül, hogy visszatértünk volna (elvileg nem történhet meg)
    return `AI Hiba (${keyToExtract}): Ismeretlen hiba a próbálkozások során.`;
}


// --- AI Funkciók ---

// Placeholder (Változatlan)
export async function _getContradictionAnalysis(context, probabilities, odds) { return "Ellentmondás-analízis kihagyva."; }

// Kulcskérdések (Változatlan)
export async function getAiKeyQuestions(richContext, rawData) {
    // Javítás: Átadjuk a home és away nevet is a pontosabb kérdésekért
    return await getAndParse(AI_KEY_QUESTIONS_PROMPT, {
         richContext,
         home: rawData?.home || 'Hazai',
         away: rawData?.away || 'Vendég'
    }, "key_questions");
}

// Taktikai eligazítás (Változatlan)
export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis, riskAssessment) {
    const data = {
        sport, home, away,
        riskAssessment: riskAssessment || "N/A",
        home_style: rawData.tactics?.home?.style || "N/A",
        away_style: rawData.tactics?.away?.style || "N/A",
        // Hozzáadjuk a formációkat is a prompt adataihoz
        home_formation: rawData.tactics?.home?.formation || "N/A",
        away_formation: rawData.tactics?.away?.formation || "N/A",
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.',
        key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
        key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
    };
    return await getAndParse(TACTICAL_BRIEFING_PROMPT, data, "analysis");
}

// --- MÓDOSÍTÁS KEZDETE ---
// --- ÚJ AI FUNKCIÓ: Prófétai Pillanatkép ---
export async function getPropheticEvent(rawData, sport, home, away) { // home, away hozzáadva
    if (sport !== 'soccer') return "N/A"; // Jelenleg csak focira
    const data = {
        sport,
        home: home, // Használjuk a paramétert
        away: away,
        // Javítás: Biztosítjuk, hogy a JSON.stringify ne dobjon hibát, ha az adat nem létezik
        tacticalPatternsJson: JSON.stringify(rawData?.tactical_patterns || {}),
        keyMatchupsJson: JSON.stringify(rawData?.key_matchups || {}),
        keyPlayersJson: JSON.stringify(rawData?.key_players || {}),
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
    };
    return await getAndParse(PROPHETIC_EVENT_PROMPT, data, "event_snapshot");
}


// --- MÓDOSÍTOTT AI FUNKCIÓ: Prófétai Forgatókönyv ---
export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport, tacticalBriefing, propheticEvent) { // propheticEvent hozzáadva
     const data = {
         sport,
         home,
         away,
         tacticalBriefing: tacticalBriefing || "N/A",
         propheticEvent: propheticEvent || "N/A", // Új adat átadása
         timelineJson: JSON.stringify(propheticTimeline || []),
         home_style: rawData?.tactics?.home?.style || "N/A",
         away_style: rawData?.tactics?.away?.style || "N/A",
         tension: rawData?.contextual_factors?.match_tension_index || "N/A",
         // Hozzáadjuk a kulcsjátékosok neveit a narratívához
         key_players_home_names: rawData?.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
         key_players_away_names: rawData?.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
     };
    return await getAndParse(PROPHETIC_SCENARIO_PROMPT, data, "scenario");
}
// --- MÓDOSÍTÁS VÉGE ---

// Szakértői bizalom (Változatlan)
export async function getExpertConfidence(modelConfidence, richContext, rawData = null) { // rawData hozzáadva opcionálisan
     // Javítás: Biztosítjuk, hogy a modelConfidence szám legyen
     const safeModelConfidence = typeof modelConfidence === 'number' ? modelConfidence : 5.0; // Default 5.0
     return await getAndParse(EXPERT_CONFIDENCE_PROMPT, {
         modelConfidence: safeModelConfidence,
         richContext: richContext || "Nincs kontextus." // Default érték
        }, "confidence_report");
}

// Kockázatértékelés (Változatlan)
export async function getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel) {
    const data = {
        sport,
        sim_pHome: sim?.pHome, sim_pDraw: sim?.pDraw, sim_pAway: sim?.pAway, // Biztonságos hozzáférés
        marketIntel: marketIntel || "N/A",
        news_home: rawData?.team_news?.home || "N/A",
        news_away: rawData?.team_news?.away || "N/A",
        // Javítás: Hiányzók számának biztonságos kinyerése
        absentees_home_count: Array.isArray(rawData?.absentees?.home) ? rawData.absentees.home.filter(p => p.importance === 'key').length : 0,
        absentees_away_count: Array.isArray(rawData?.absentees?.away) ? rawData.absentees.away.filter(p => p.importance === 'key').length : 0,
        form_home: rawData?.form?.home_overall || "N/A",
        form_away: rawData?.form?.away_overall || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A"
    };
    return await getAndParse(RISK_ASSESSMENT_PROMPT, data, "risk_analysis");
}

// Általános elemzés (Változatlan)
export async function getFinalGeneralAnalysis(sim, mu_h, mu_a, tacticalBriefing, propheticScenario, rawData, modelConfidence) { // modelConfidence hozzáadva
    // Javítás: Biztonságos hozzáférés a sim tulajdonságaihoz és mu értékekhez
    const data = {
        sim_pHome: sim?.pHome, sim_pDraw: sim?.pDraw, sim_pAway: sim?.pAway,
        mu_h: mu_h, mu_a: mu_a,
        modelConfidence: modelConfidence, // Átadjuk a modell bizalmát
        tacticalBriefing: tacticalBriefing || "N/A",
        propheticScenario: propheticScenario || "N/A"
    };
    return await getAndParse(FINAL_GENERAL_ANALYSIS_PROMPT, data, "general_analysis");
}


// Játékospiacok (Változatlan)
export async function getPlayerMarkets(keyPlayers, richContext, rawData = null) { // rawData hozzáadva opcionálisan
    return await getAndParse(PLAYER_MARKETS_PROMPT, {
        // Javítás: Biztosítjuk, hogy a keyPlayers objektum létezzen
        keyPlayersJson: JSON.stringify(keyPlayers || { home: [], away: [] }),
        richContext: richContext || "Nincs kontextus."
        }, "player_market_analysis");
}

// BTTS Elemzés (Változatlan)
export async function getBTTSAnalysis(sim, rawData) {
    // Javítás: Biztonságos hozzáférés a sim és rawData tulajdonságaihoz
     const data = {
        sim_pBTTS: sim?.pBTTS,
        sim_mu_h: sim?.mu_h_sim,
        sim_mu_a: sim?.mu_a_sim,
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
     };
     return await getAndParse(BTTS_ANALYSIS_PROMPT, data, "btts_analysis");
}

// Foci Gól O/U Elemzés (Változatlan)
export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // Javítás: Biztonságos hozzáférés + hiányzók számának átadása
     const data = {
        line: mainTotalsLine,
        sim_pOver: sim?.pOver,
        sim_mu_sum: (sim?.mu_h_sim ?? 0) + (sim?.mu_a_sim ?? 0), // Default 0, ha hiányzik
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A",
        absentees_home_count: Array.isArray(rawData?.absentees?.home) ? rawData.absentees.home.filter(p => p.importance === 'key').length : 0,
        absentees_away_count: Array.isArray(rawData?.absentees?.away) ? rawData.absentees.away.filter(p => p.importance === 'key').length : 0
     };
    return await getAndParse(SOCCER_GOALS_OU_PROMPT, data, "goals_ou_analysis");
}

// Foci Szöglet Elemzés (Változatlan)
export async function getCornerAnalysis(sim, rawData) {
    // Javítás: Átadjuk a becsült mu_corners értéket
    const data = {
        mu_corners: sim?.mu_corners_sim, // A Model.js által számított érték
        home_style: rawData?.tactics?.home?.style || "N/A",
        away_style: rawData?.tactics?.away?.style || "N/A"
    };
    return await getAndParse(CORNER_ANALYSIS_PROMPT, data, "corner_analysis");
}

// Foci Lap Elemzés (Változatlan)
export async function getCardAnalysis(sim, rawData) {
    // Javítás: Átadjuk a becsült mu_cards értéket és a releváns kontextust
    const data = {
        mu_cards: sim?.mu_cards_sim, // A Model.js által számított érték
        referee_style: rawData?.referee?.style || "N/A",
        tension: rawData?.contextual_factors?.match_tension_index || "N/A",
        // Egyszerűsített derby ellenőrzés
        is_derby: rawData?.contextual_factors?.match_tension_index?.toLowerCase().includes('derby') || rawData?.h2h_summary?.toLowerCase().includes('rivalry')
    };
    return await getAndParse(CARD_ANALYSIS_PROMPT, data, "card_analysis");
}

// Hoki Gól O/U Elemzés (Változatlan)
export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // Javítás: Biztonságos hozzáférés a GSAx értékekhez
     const data = {
        line: mainTotalsLine,
        sim_pOver: sim?.pOver,
        sim_mu_sum: (sim?.mu_h_sim ?? 0) + (sim?.mu_a_sim ?? 0),
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx?.toFixed(2) || "N/A", // Formázva adjuk át
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx?.toFixed(2) || "N/A"
     };
    return await getAndParse(HOCKEY_GOALS_OU_PROMPT, data, "hockey_goals_ou_analysis");
}

// Hoki Győztes Elemzés (Változatlan)
export async function getHockeyWinnerAnalysis(sim, rawData) {
    // Javítás: Biztonságos hozzáférés + formátum
     const data = {
        sim_pHome: sim?.pHome,
        sim_pAway: sim?.pAway,
        home_gsax: rawData?.advanced_stats_goalie?.home_goalie?.GSAx?.toFixed(2) || "N/A",
        away_gsax: rawData?.advanced_stats_goalie?.away_goalie?.GSAx?.toFixed(2) || "N/A",
        form_home: rawData?.form?.home_overall || "N/A",
        form_away: rawData?.form?.away_overall || "N/A"
     };
    return await getAndParse(HOCKEY_WINNER_PROMPT, data, "hockey_winner_analysis");
}

// Kosár Pont O/U Elemzés (Változatlan)
export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    // Javítás: Biztonságos hozzáférés + pace átadása
     const data = {
        line: mainTotalsLine,
        sim_pOver: sim?.pOver,
        pace: ((rawData?.advancedData?.home?.pace || 98) + (rawData?.advancedData?.away?.pace || 98)) / 2, // Becsült pace
        home_style: rawData?.shot_distribution?.home || "N/A", // Új mezőnevek
        away_style: rawData?.shot_distribution?.away || "N/A"
     };
    return await getAndParse(BASKETBALL_POINTS_OU_PROMPT, data, "basketball_points_ou_analysis");
}


// Stratégiai Zárógondolatok (Változatlan)
export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment, tacticalBriefing, propheticScenario, valueBets, modelConfidence, expertConfidence) { // valueBets, modelConfidence, expertConfidence hozzáadva
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
        // Csak a releváns részt adjuk át, a "Bizalom:" nélkül, ha van
        const analysisPart = typeof val === 'string' ? val.split('\nBizalom:')[0] : 'N/A';
        return `${key}: ${analysisPart}`;
    }).join('; ');
    // Javítás: Biztosítjuk, hogy a valueBets JSON string legyen
    const valueBetsString = JSON.stringify(valueBets || []);
    const data = {
        sim_pHome: sim?.pHome, sim_pDraw: sim?.pDraw, sim_pAway: sim?.pAway, // Sim hozzáadva
        sim_mainTotalsLine: sim?.mainTotalsLine, sim_pOver: sim?.pOver, // Sim O/U hozzáadva
        propheticScenario: propheticScenario || "N/A",
        tacticalBriefing: tacticalBriefing || "N/A",
        marketIntel: marketIntel || "N/A",
        microSummaryJson: microSummary,
        richContext: richContext || "Nincs kontextus.",
        riskAssessment: riskAssessment || "N/A",
        valueBetsJson: valueBetsString, // Value bets átadása
        modelConfidence: modelConfidence, // Modell bizalom átadása
        expertConfidence: expertConfidence || "N/A" // Szakértői bizalom átadása
     };
    return await getAndParse(STRATEGIC_CLOSING_PROMPT, data, "strategic_analysis");
}


// --- MÓDOSÍTÁS KEZDETE: Dinamikus Bizalomkezelés + Kalibráció + Mellékpiacok (3. Pont) ---
export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts, rawData, contradictionAnalysisResult) {
    const microSummary = Object.entries(microAnalyses || {}).map(([key, val]) => {
         // Tartalmazza a bizalmat is, ha van
         return `${key}: ${val || 'N/A'}`;
    }).join('; ');
    let expertConfScore = 1.0;
    try {
        const match = expertConfidence?.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
        if (match && match[1]) {
             expertConfScore = parseFloat(match[1]);
             // Biztosítjuk, hogy a score 1.0 és 10.0 között legyen
             expertConfScore = Math.max(1.0, Math.min(10.0, expertConfScore));
        } else {
             console.warn("Nem sikerült kinyerni az expert confidence pontszámot a Master AI számára. Alapértelmezett: 1.0");
             expertConfScore = 1.0;
        }
    }
    catch(e) {
         console.warn("Hiba az expert confidence pontszám kinyerésekor:", e);
         expertConfScore = 1.0; // Hiba esetén is alapértelmezett
    }
    // Javítás: Biztosítjuk, hogy a modelConfidence is érvényes szám legyen
    const safeModelConfidence = typeof modelConfidence === 'number' && !isNaN(modelConfidence) ? modelConfidence : 5.0; // Default 5.0

    const data = {
        valueBetsJson: JSON.stringify(valueBets || []), // Tartalmazza a mellékpiaci value beteket is
        sim_pHome: sim?.pHome, sim_pDraw: sim?.pDraw, sim_pAway: sim?.pAway,
        sim_mainTotalsLine: sim?.mainTotalsLine, sim_pOver: sim?.pOver,
        modelConfidence: safeModelConfidence, // Biztonságos érték használata
        expertConfidence: expertConfidence || "N/A", // Tartalmazza a szöveges indoklást is
        expertConfScore: expertConfScore, // Csak a szám érték
        riskAssessment: riskAssessment || "N/A",
        microSummary: microSummary, // Tartalmazza a mellékpiaci elemzéseket is
        generalAnalysis: generalAnalysis || "N/A",
        strategicClosingThoughts: strategicClosingThoughts || "N/A",
        contradictionAnalysis: contradictionAnalysisResult || "N/A"
    };

    try {
        const jsonString = await getAndParse(MASTER_AI_PROMPT_TEMPLATE, data, 'recommended_bet', 2); // getAndParse használata, 2 újrapróbálkozással
        // Mivel a getAndParse már JSON.parse-olja, itt nem kell újra
        // Viszont a teljes JSON objektum kell nekünk, nem csak a recommended_bet
        // Ezért módosítjuk a getAndParse-t vagy itt hívjuk máshogy

        // Hívjuk újra a teljes objektumért (vagy módosítjuk a getAndParse-t)
        // Most egyszerűbb újra hívni, de hosszabb távon a getAndParse módosítása jobb lenne
         const fullResponseString = await _callGemini(fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data));
         let rec = JSON.parse(fullResponseString);


        if (rec && rec.recommended_bet && typeof rec.final_confidence === 'number') {

            // 1. Eltérés-alapú büntetés (A meglévő logika)
            const confidenceDiff = Math.abs(safeModelConfidence - expertConfScore);
            const disagreementThreshold = 3.0;
            let confidencePenalty = 0;
            let disagreementNote = "";

            if (expertConfScore < 1.1 && !expertConfidence.toLowerCase().includes("hiba")) {
                 confidencePenalty = Math.max(0, rec.final_confidence - 3.0);
                 disagreementNote = " (A Szakértői Bizalom extrém alacsony értéke miatt jelentősen csökkentve.)";
                 console.log(`Master AI: Extrém alacsony Expert Confidence (${expertConfScore}) felülbírálta a bizalmat.`);
            } else if (confidenceDiff > disagreementThreshold) {
                confidencePenalty = Math.min(2.0, confidenceDiff / 2); // Max 2.0 büntetés
                disagreementNote = " (A Statisztikai Modell és a Szakértői Bizalom közötti jelentős eltérés miatt csökkentve.)";
                console.log(`Master AI: Jelentős bizalmi eltérés (${safeModelConfidence.toFixed(1)} vs ${expertConfScore.toFixed(1)}), büntetés: ${confidencePenalty.toFixed(1)}`);
            }

            rec.final_confidence -= confidencePenalty;
            // Biztosítjuk, hogy a bizalom 1.0 és 10.0 között maradjon
            rec.final_confidence = Math.max(1.0, Math.min(10.0, rec.final_confidence));

            // 2. --- Bizalmi Kalibráció (Meta-tanulás) ---
            let calibrationNote = "";
            try {
                const calibrationMap = getConfidenceCalibrationMap(); // Behívjuk a cache-elt térképet
                if (calibrationMap && Object.keys(calibrationMap).length > 0) {
                    const confFloor = Math.floor(rec.final_confidence); // Pl. 7.8 -> 7.0
                    // Módosítás: Biztosítjuk, hogy a confFloor legalább 1 legyen
                    const safeConfFloor = Math.max(1.0, confFloor);
                    // Kulcs formátum: "alsó_határ-felső_határ"
                    const bucketKey = `${safeConfFloor.toFixed(1)}-${(safeConfFloor + 0.9).toFixed(1)}`;

                    // Csak akkor használjuk, ha van elég adat a bucket-ben (min 5 W/L)
                    if (calibrationMap[bucketKey] && calibrationMap[bucketKey].total >= 5) {
                        const wins = calibrationMap[bucketKey].wins;
                        const total = calibrationMap[bucketKey].total;
                        const calibratedPct = (wins / total) * 100;
                        // Kalibrált bizalom = (Valós Nyerési Esély %) / 10
                        const calibratedConfidence = calibratedPct / 10;

                        // Hozzáadjuk az indokláshoz, ha jelentősen eltér (>0.5 pont)
                        if (Math.abs(calibratedConfidence - rec.final_confidence) > 0.5) {
                             calibrationNote = ` (Kalibrált bizalom: ${calibratedConfidence.toFixed(1)}/10, ${total} minta alapján.)`;
                        }
                    }
                }
            } catch(calError) { console.warn(`Bizalmi kalibráció hiba: ${calError.message}`); }
            // --- KALIBRÁCIÓ VÉGE ---

            // Összefűzzük az indoklást a megjegyzésekkel
            rec.brief_reasoning = (rec.brief_reasoning || "N/A") + disagreementNote + calibrationNote;

            // Javítás: Biztosítjuk, hogy a reasoning ne legyen túl hosszú
            if (rec.brief_reasoning.length > 500) {
                 rec.brief_reasoning = rec.brief_reasoning.substring(0, 497) + "...";
            }

            return rec; // Visszaadjuk a teljes, módosított ajánlás objektumot
        }
        // Ha a válasz struktúrája nem megfelelő
        console.error("Master AI hiba: Érvénytelen JSON struktúra a válaszban:", rec);
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": "AI hiba: Érvénytelen JSON struktúra." };
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`, e.stack); // Stack trace hozzáadva
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": `AI Hiba: ${e.message.substring(0, 100)}` };
    }
}
// --- MÓDOSÍTÁS VÉGE ---

// --- CHAT FUNKCIÓ (Változatlan) ---
export async function getChatResponse(context, history, question) {
    if (!context || !question) return { error: "Hiányzó 'context' vagy 'question'." };
    try {
        // Előzmények formázása szöveggé
        const historyString = (history || [])
            .map(msg => `${msg.role === 'user' ? 'Felhasználó' : 'AI'}: ${msg.parts?.[0]?.text || ''}`)
            .join('\n');
        // Prompt összeállítása
        const prompt = `You are an elite sports analyst AI assistant specialized in the provided match analysis.
CONTEXT of the analysis:
--- START CONTEXT ---
${context}
--- END CONTEXT ---

CONVERSATION HISTORY:
${historyString}

Current User Question: ${question}

Answer concisely and accurately in Hungarian based ONLY on the provided Analysis Context and Conversation History.
Do not provide betting advice. Do not make up information not present in the context.
If the answer isn't in the context or history, politely state that the information is not available in the analysis.`;

        // Gemini hívás (nem JSON választ várunk)
        const rawAnswer = await _callGemini(prompt
             // Eltávolítjuk a JSON kényszerítést a prompt végéről
             .replace("Your entire response must be ONLY a single, valid JSON object.", "")
             .replace("Do not add any text, explanation, or introductory phrases outside of the JSON structure itself.", "")
        );

        let answerText = rawAnswer;
        // Próbáljuk meg eltávolítani a JSON körítést, ha mégis lenne
        try {
            const parsed = JSON.parse(rawAnswer);
            // Ha sikerült parse-olni, megpróbáljuk kinyerni a szöveget
            answerText = parsed.answer || parsed.response || Object.values(parsed).find(v => typeof v === 'string') || rawAnswer;
        } catch (e) {
            // Ha nem JSON, akkor valószínűleg már a tiszta válasz, csak trimmelni kell
            answerText = rawAnswer.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        }

         return answerText ?
         { answer: answerText } : { error: "Az AI nem tudott válaszolni." };
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`, e.stack); // Stack trace hozzáadva
        return { error: `Chat AI hiba: ${e.message}` };
    }
}


// --- FŐ EXPORT ---
export default {
    getChatResponse, _getContradictionAnalysis, getAiKeyQuestions, getTacticalBriefing, getPropheticScenario,
    getExpertConfidence, getRiskAssessment, getFinalGeneralAnalysis, getPlayerMarkets, getMasterRecommendation,
    getStrategicClosingThoughts, getBTTSAnalysis, getSoccerGoalsOUAnalysis, getCornerAnalysis, getCardAnalysis,
    getHockeyGoalsOUAnalysis, getHockeyWinnerAnalysis, getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn, // Ezt valószínűleg nem itt kellene exportálni, de most marad
    // --- MÓDOSÍTÁS KEZDETE ---
    getPropheticEvent // Hozzáadjuk az új funkciót az exporthoz
    // --- MÓDOSÍTÁS VÉGE ---
};