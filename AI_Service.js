/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * JAVÍTÁS: Hozzáadva a _getContradictionAnalysis placeholder export.
 */

// Importáljuk a szükséges függvényeket és konfigurációt
import { getRichContextualData, getOptimizedOddsData, _callGeminiWithSearch, _getFixturesFromEspn } from './DataFetch.js';
import { calculateProbabilities, generateProTip } from './Model.js'; // Placeholder lehet a calculateProbabilities
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Master AI Sports Analyst. Analyze the provided structured data for the match: {homeTeam} vs {awayTeam}.
Focus on predicting the final score and generating a single, concise betting tip based ONLY on the data provided. Use Google Search results included in the context.

Structured Data:
---
Match: {homeTeam} (Home) vs {awayTeam} (Away)
League: {leagueName}
Date: {matchDate}

Contextual Data (from Google Search and internal knowledge):
{richContext}

Odds Data (Pinnacle):
{oddsString}

AI Committee Analysis:
{committeeAnalysis}
---

Your Tasks:
1.  **Final Score Prediction:** Predict the most likely final score (e.g., 2-1).
2.  **Betting Tip Generation:** Generate ONE concise, actionable betting tip (e.g., "Over 2.5 Goals", "Home Team to Win", "Both Teams To Score: Yes"). Base your tip *strictly* on the analysis and probabilities, considering potential value against the provided odds and information gathered from search. Do NOT invent information.
3.  **Confidence Level:** Assign a confidence level to your tip (Low, Medium, High).
4.  **Reasoning:** Briefly explain your reasoning for the tip in 2-3 sentences max, referencing specific data points (e.g., recent news from search, H2H trends, form, key absentees, odds value).

Output Format (JSON ONLY, no extra text):
{{
  "prediction": {{
    "final_score": "H-A",
    "tip": "<Your Betting Tip>",
    "confidence": "<Low|Medium|High>",
    "reasoning": "<Brief explanation>"
  }}
}}
`;

const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `
You are an AI Sports Analyst specializing in {specialization}. Analyze the provided data for the match: {homeTeam} vs {awayTeam}. Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5). Data: --- Match: {homeTeam} (Home) vs {awayTeam} (Away) League: {leagueName} Date: {matchDate} Contextual Data (from Google Search and internal knowledge): {richContext} Odds Data (Pinnacle): {oddsString} --- Your Output (Plain Text, Max 3 sentences + prediction): <Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;

// === JAVÍTÁS: Placeholder függvény hozzáadása és exportálása ===
/**
 * Placeholder az ellentmondás-analízishez. Jelenleg nem csinál semmit.
 * @returns {string} Üres string vagy alapértelmezett üzenet.
 */
export async function _getContradictionAnalysis(context, probabilities, odds) {
    console.warn("_getContradictionAnalysis placeholder hívva - ez a funkció jelenleg nincs implementálva.");
    return "Ellentmondás-analízis kihagyva."; // Vagy return "";
}
// =============================================================

// === getAiKeyQuestions függvény hozzáadása és exportálása ===
/**
 * Generálja a meccs kulcskérdéseit a kontextus alapján.
 * @param {string} richContext Az elemzéshez gyűjtött szöveges kontextus.
 * @returns {Promise<string>} Az AI által generált kulcskérdések stringként, vagy hibaüzenet.
 */
export async function getAiKeyQuestions(richContext) {
  if (!richContext || typeof richContext !== 'string') { // Bemenet ellenőrzése
      console.error("getAiKeyQuestions: Hiányzó vagy érvénytelen kontextus.");
      return "- Hiba: A kulcskérdések generálásához szükséges kontextus hiányzik."; // Hiba visszaadása
  }
  // Prompt összeállítása (az Apps Script verzióból)
  const prompt = `You are a strategic analyst preparing for a pre-match briefing.
STRICT RULE: Your response must be ONLY in Hungarian.
Based SOLELY on the provided context below, formulate the two (2) most critical strategic questions that will likely decide the outcome of the match.
These questions should highlight the core uncertainties or key battlegrounds.
Present them ONLY as a bulleted list, starting each question with a hyphen (-).
Do not add any introduction, explanation, or conclusion.

    CONTEXT:
    ${richContext}`;

  try {
      // AI hívása (Vertex AI + Search)
      const responseText = await _callGeminiWithSearch(prompt); // Hívás a DataFetch.js függvényével
      if (responseText) {
          // Egyszerűsített válasz: feltételezzük, hogy a válasz a kért formátumban van
          return responseText.trim(); // Visszaadjuk a trimmelt választ
      } else {
          console.error("getAiKeyQuestions: Nem érkezett válasz a Geminitől.");
          return "- Hiba: Az AI nem tudott kulcskérdéseket generálni."; // Hiba, ha nincs válasz
      }
  } catch (e) {
      console.error(`getAiKeyQuestions hiba: ${e.message}`); // Hiba logolása
      return `- Hiba a kulcskérdések generálásakor: ${e.message}`; // Hiba visszaadása
  }
}
// =============================================================

// --- FŐ ELEMZÉSI FOLYAMAT ---
export async function runAnalysisFlow(sport, homeTeam, awayTeam, leagueName, matchDate, openingOdds = null) {
    console.log(`Elemzés indítása: ${homeTeam} vs ${awayTeam} (${leagueName})`);

    let contextualData;
    let oddsData;
    let probabilities;
    let committeeAnalysis = "N/A";

    try {
        // 1. Adatgyűjtés (Vertex AI + Search + Odds)
        console.log("Adatgyűjtés (Vertex AI + Search)...");
        contextualData = await getRichContextualData(sport, homeTeam, awayTeam, leagueName);
        oddsData = contextualData.oddsData;

        const oddsString = oddsData?.current?.map(o => `${o.name}: ${o.price}`).join(', ') || "N/A";

        if (!contextualData || !contextualData.rawStats) {
             throw new Error("Kritikus hiba: Az adatgyűjtés nem adott vissza érvényes struktúrát.");
        }
        console.log("Adatgyűjtés kész.");

        // 2. Valószínűségek Számítása (Placeholder hívása)
        console.log("Valószínűségek számítása (Placeholder)...");
        // Figyelem: Ez a calculateProbabilities jelenleg csak null értékeket ad vissza a Model.js-ben!
        // Az igazi valószínűségek a Model.js simulateMatchProgress függvényében vannak.
        probabilities = calculateProbabilities(contextualData.rawStats, SPORT_CONFIG[sport]?.home_advantage, SPORT_CONFIG[sport]?.avg_goals);
        console.log("Placeholder valószínűségek:", probabilities);

        // 3. AI Bizottság (Kihagyva)
        console.log("AI Bizottság futtatása kihagyva.");

        // 4. Mester AI Hívása
        console.log("Mester AI hívása (Vertex AI + Search)...");
        const masterPrompt = MASTER_AI_PROMPT_TEMPLATE
            .replace('{homeTeam}', homeTeam)
            .replace('{awayTeam}', awayTeam)
            .replace('{leagueName}', leagueName)
            .replace('{matchDate}', new Date(matchDate).toLocaleDateString('hu-HU'))
            .replace('{richContext}', contextualData.richContext || "N/A")
            .replace('{oddsString}', oddsString)
            .replace('{committeeAnalysis}', committeeAnalysis);

        const masterResponseJsonString = await _callGeminiWithSearch(masterPrompt);

        if (!masterResponseJsonString) {
            throw new Error("Mester AI nem adott választ, vagy hiba történt a hívás során.");
        }

        let masterPrediction;
        try {
            let cleanedJson = masterResponseJsonString.trim();
            const jsonMatch = cleanedJson.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch?.[1]) cleanedJson = jsonMatch[1];
            if (!cleanedJson.startsWith('{') && cleanedJson.includes('{')) cleanedJson = cleanedJson.substring(cleanedJson.indexOf('{'));
            if (!cleanedJson.endsWith('}') && cleanedJson.includes('}')) cleanedJson = cleanedJson.substring(0, cleanedJson.lastIndexOf('}') + 1);
            masterPrediction = JSON.parse(cleanedJson);
        } catch (e) {
            console.error("Mester AI válasza nem volt érvényes JSON:", masterResponseJsonString.substring(0, 500));
            throw new Error(`Mester AI válasza feldolgozhatatlan volt (JSON parse error): ${e.message}`);
        }

        // 5. Eredmény Összeállítása és Mentése
        const finalResult = {
            match: `${homeTeam} vs ${awayTeam}`,
            league: leagueName,
            date: matchDate,
            probabilities: probabilities, // Placeholder null értékekkel!
            context: contextualData.richContext,
            odds: oddsData?.current || [],
            prediction: {
                final_score: masterPrediction?.prediction?.final_score || "N/A",
                tip: masterPrediction?.prediction?.tip || "Hiba",
                confidence: masterPrediction?.prediction?.confidence || "Low",
                reasoning: masterPrediction?.prediction?.reasoning || "Nem sikerült tippet generálni."
            },
            fullRawData: contextualData.rawData
        };

        console.log("Végleges Tipp:", finalResult.prediction);

        saveToSheet(finalResult).catch(err => console.error("Hiba a Google Sheet mentés során:", err.message));

        return finalResult;

    } catch (error) {
        console.error(`Súlyos hiba az elemzési folyamban (${homeTeam} vs ${awayTeam}): ${error.message}`);
        console.error("Hiba részletei:", error.stack);
        throw new Error(`Elemzési hiba (${homeTeam} vs ${awayTeam}): ${error.message}`);
    }
}

// --- CHAT FUNKCIÓ ---
export async function getChatResponse(context, history, question) {
    if (!context || !question) {
        console.error("Chat hiba: Hiányzó kontextus vagy kérdés.");
        return { error: "Hiányzó kontextus vagy kérdés." };
    }
    const validHistory = Array.isArray(history) ? history : [];

    try {
        let historyString = validHistory.map(msg => {
            const role = msg.role === 'user' ? 'Felh' : 'AI';
            const text = msg.parts?.[0]?.text || msg.text || '';
            return `${role}: ${text}`;
        }).join('\n');

        const prompt = `You are an elite sports analyst AI assistant. Continue the conversation based on the context and history.
Analysis Context (DO NOT repeat, just use): --- ANALYSIS START --- ${context} --- ANALYSIS END ---
Chat History:
${historyString}
Current User Question: ${question}
Your Task: Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History. If the answer isn't there, say so politely. Stay professional. Keep answers brief.`;

        // Itt is a keresős hívás marad (tokenpazarló lehet)
        const answer = await _callGeminiWithSearch(prompt);

        if (answer) {
            let cleanedAnswer = answer.trim();
            const jsonMatch = cleanedAnswer.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch?.[1]) cleanedAnswer = jsonMatch[1];
            return { answer: cleanedAnswer };
        } else {
            console.error("Chat AI hiba: Nem érkezett válasz a Geminitől.");
            return { error: "Az AI nem tudott válaszolni." };
        }
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`);
        return { error: `Chat AI hiba: ${e.message}` };
    }
}

// --- MARADÉK HIÁNYZÓ AI FUNKCIÓK (PLACEHOLDER VAGY ÁTALAKÍTOTT GS KÓD) ---
// Ezeket az AnalysisFlow hívja, ezért definiálni és exportálni kell őket

export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis) {
    console.warn("getTacticalBriefing hívva (átalakított GS kód)");
    if (!rawData?.tactics?.home || !rawData?.tactics?.away) {
        return "A taktikai elemzéshez szükséges adatok hiányosak.";
    }
    const data = {
        sport: sport, home: home, away: away,
        home_style: rawData.tactics.home.style || "N/A",
        away_style: rawData.tactics.away.style || "N/A",
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.',
        key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
        key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
    };
    const prompt = fillPromptTemplate(TACTICAL_BRIEFING_PROMPT, data); // Itt a fillPromptTemplate kellene! Definiálni kell.
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a taktikai elemzés generálása során.";
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    console.warn("getPropheticScenario hívva (átalakított GS kód)");
     if (!propheticTimeline || !Array.isArray(propheticTimeline) || propheticTimeline.length === 0) {
        return `A mérkőzés várhatóan kiegyenlített küzdelmet hoz... **kevés gólos döntetlen** reális kimenetel.`; // Alap
    }
     const data = {
        sport: sport, home: home, away: away,
        timelineJson: JSON.stringify(propheticTimeline),
        home_style: rawData?.tactics?.home?.style || 'N/A',
        away_style: rawData?.tactics?.away?.style || 'N/A',
        tension: rawData?.contextual_factors?.match_tension_index || 'N/A'
    };
    const prompt = fillPromptTemplate(PROPHETIC_SCENARIO_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a forgatókönyv generálása során.";
}

export async function getExpertConfidence(modelConfidence, richContext) {
    console.warn("getExpertConfidence hívva (átalakított GS kód)");
    if (typeof modelConfidence !== 'number' || !richContext || typeof richContext !== 'string') {
        return "**1.0/10** - Hiba: Érvénytelen adatok.";
    }
    const data = { modelConfidence: modelConfidence.toFixed(1), richContext: richContext };
    const prompt = fillPromptTemplate(EXPERT_CONFIDENCE_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    if (response && response.match(/\*\*\d+(\.\d+)?\/10\*\* - .+./)) {
        return response;
    } else {
        return `**${Math.max(1.0, modelConfidence - 2.0).toFixed(1)}/10** - Figyelmeztetés: AI kontextus értékelés hiba.`;
    }
}

export async function getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel) {
    console.warn("getRiskAssessment hívva (átalakított GS kód)");
    if (!sim || typeof sim.pHome !== 'number' || !rawData || !marketIntel) {
        return "A kockázatelemzéshez adatok hiányosak.";
    }
     const data = {
        sport: sport, sim_pHome: sim.pHome.toFixed(1), sim_pDraw: sim.pDraw.toFixed(1), sim_pAway: sim.pAway.toFixed(1),
        marketIntel: marketIntel,
        news_home: rawData?.team_news?.home || 'N/A', news_away: rawData?.team_news?.away || 'N/A',
        form_home: rawData?.form?.home_overall || 'N/A', form_away: rawData?.form?.away_overall || 'N/A',
        motiv_home: rawData?.contextual_factors?.motivation_home || 'N/A',
        motiv_away: rawData?.contextual_factors?.motivation_away || 'N/A'
    };
    const prompt = fillPromptTemplate(RISK_ASSESSMENT_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a kockázatelemzés generálása során.";
}

export async function getFinalGeneralAnalysis(sim, mu_h, mu_a, tacticalBriefing, propheticScenario) {
     console.warn("getFinalGeneralAnalysis hívva (átalakított GS kód)");
     if (!sim || typeof sim.pHome !== 'number' || typeof mu_h !== 'number' || !tacticalBriefing || !propheticScenario) {
         return "Az általános elemzéshez adatok hiányosak.";
     }
     const data = {
         sim_pHome: sim.pHome.toFixed(1), sim_pDraw: sim.pDraw.toFixed(1), sim_pAway: sim.pAway.toFixed(1),
         mu_h: mu_h.toFixed(2), mu_a: mu_a.toFixed(2),
         tacticalBriefing: tacticalBriefing, propheticScenario: propheticScenario
     };
     const prompt = fillPromptTemplate(FINAL_GENERAL_ANALYSIS_PROMPT, data); // Itt a fillPromptTemplate kellene!
     const response = await _callGeminiWithSearch(prompt);
     return response || "Hiba történt az általános elemzés generálása során.";
 }

export async function getPlayerMarkets(keyPlayers, richContext) {
   console.warn("getPlayerMarkets hívva (átalakított GS kód)");
   if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) {
       return "Nincsenek kiemelt kulcsjátékosok.";
   }
   if (!richContext || typeof richContext !== 'string') {
       return "A játékospiacok elemzéséhez kontextus hiányzik.";
   }
   const data = { keyPlayersJson: JSON.stringify(keyPlayers), richContext: richContext };
   const prompt = fillPromptTemplate(PLAYER_MARKETS_PROMPT, data); // Itt a fillPromptTemplate kellene!
   const response = await _callGeminiWithSearch(prompt);
   return response || "Hiba történt a játékospiacok elemzése során.";
}

export async function getBTTSAnalysis(sim, rawData) {
    console.warn("getBTTSAnalysis hívva (átalakított GS kód)");
    if (typeof sim?.pBTTS !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData) {
        return "A BTTS elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { /* ... adatok feltöltése sim és rawData alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(BTTS_ANALYSIS_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a BTTS elemzés generálása során. Bizalom: Alacsony";
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    console.warn("getSoccerGoalsOUAnalysis hívva (átalakított GS kód)");
    if (typeof sim?.pOver !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData || typeof mainTotalsLine !== 'number') {
       return `A Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { /* ... adatok feltöltése sim, rawData, line alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(SOCCER_GOALS_OU_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getCornerAnalysis(sim, rawData) {
    console.warn("getCornerAnalysis hívva (átalakított GS kód)");
    if (!sim?.corners || !rawData?.advanced_stats) {
       return "A Szöglet elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cornerProbs = sim.corners;
    const cornerKeys = Object.keys(cornerProbs).filter(k => k.startsWith('o'));
    const likelyLine = cornerKeys.length > 0 ? parseFloat(cornerKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cornerKeys.length / 2)].substring(1)) : 9.5;
    const overProbKey = `o${likelyLine}`;
    const overProb = sim.corners[overProbKey];
    const data = { /* ... adatok feltöltése sim, rawData, likelyLine, overProb alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(CORNER_ANALYSIS_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Szöglet elemzés generálása során. Bizalom: Alacsony";
}

export async function getCardAnalysis(sim, rawData) {
    console.warn("getCardAnalysis hívva (átalakított GS kód)");
    if (!sim?.cards || !rawData?.advanced_stats || !rawData.referee) {
       return "A Lapok elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cardProbs = sim.cards;
    const cardKeys = Object.keys(cardProbs).filter(k => k.startsWith('o'));
    const likelyLine = cardKeys.length > 0 ? parseFloat(cardKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cardKeys.length / 2)].substring(1)) : 4.5;
    const overProbKey = `o${likelyLine}`;
    const overProb = sim.cards[overProbKey];
    const data = { /* ... adatok feltöltése sim, rawData, likelyLine, overProb alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(CARD_ANALYSIS_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Lapok elemzés generálása során. Bizalom: Alacsony";
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    console.warn("getHockeyGoalsOUAnalysis hívva (átalakított GS kód)");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Jégkorong Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { /* ... adatok feltöltése sim, rawData, line alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(HOCKEY_GOALS_OU_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Jégkorong Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    console.warn("getHockeyWinnerAnalysis hívva (átalakított GS kód)");
    if (typeof sim?.pHome !== 'number' || !rawData?.advanced_stats || !rawData.form) {
       return "A Jégkorong Győztes elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { /* ... adatok feltöltése sim, rawData alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(HOCKEY_WINNER_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Jégkorong Győztes elemzés generálása során. Bizalom: Alacsony";
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    console.warn("getBasketballPointsOUAnalysis hívva (átalakított GS kód)");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Kosár Pont O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { /* ... adatok feltöltése sim, rawData, line alapján ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(BASKETBALL_POINTS_OU_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Kosár Pont O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    console.warn("getStrategicClosingThoughts hívva (átalakított GS kód)");
    if (!sim || !rawData || !richContext || !marketIntel || !microAnalyses || !riskAssessment) {
        return "### Stratégiai Zárógondolatok\nA stratégiai összefoglalóhoz adatok hiányosak.";
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {/* ... (kód ugyanaz) ... */}).filter(Boolean).join('; ');
    const data = { /* ... adatok feltöltése ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(STRATEGIC_CLOSING_PROMPT, data); // Itt a fillPromptTemplate kellene!
    const response = await _callGeminiWithSearch(prompt);
    return response || "### Stratégiai Zárógondolatok\nHiba történt a stratégiai elemzés generálása során.";
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    console.warn("getMasterRecommendation hívva (átalakított GS kód)");
    if (!sim || typeof modelConfidence !== 'number' || !expertConfidence || !riskAssessment || !generalAnalysis || !strategicClosingThoughts) {
         return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok." };
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {/* ... (kód ugyanaz) ... */}).filter(Boolean).join('; ');
    const data = { /* ... adatok feltöltése ... */ }; // Adatokat be kell tölteni
    const prompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data); // Itt a fillPromptTemplate kellene!
    try {
        const responseText = await _callGeminiWithSearch(prompt);
        if (!responseText) { throw new Error("Nem érkezett válasz."); }
        let jsonString = responseText;
        // ... (JSON tisztítás ugyanaz) ...
        const recommendation = JSON.parse(jsonString);
        if (recommendation?.recommended_bet && typeof recommendation.final_confidence === 'number' && recommendation.brief_reasoning) {
            recommendation.final_confidence = Math.max(1.0, Math.min(10.0, recommendation.final_confidence));
            return recommendation;
        } else { throw new Error("Érvénytelen JSON struktúra."); }
    } catch (e) {
        console.error(`Hiba a Mester Ajánlás generálása során: ${e.message}`);
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `Hiba: ${e.message.substring(0,100)}` };
    }
}

// === HIÁNYZÓ fillPromptTemplate HELPER ===
// Ezt a függvényt hozzá kell adni, mert sok AI funkció használja!
/**
 * Helper to replace placeholders in a prompt template.
 * Handles missing data gracefully by replacing with "N/A".
 * @param {string} template The prompt template string.
 * @param {object} data The data object containing values for placeholders.
 * @returns {string} The filled prompt string.
 */
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return ''; // Védelmi ellenőrzés
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        // Kezeli az egyszerű kulcsokat és az alobjektumok kulcsait (pl. sim_pHome)
        const keys = key.split('_');
        let value = data;
        try { // Hibakezelés a bejáráshoz
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else {
                    // Speciális kezelések (ha kellenek, pl. JSON stringgé alakítás)
                    if (key.endsWith('Json')) {
                        const baseKey = key.replace('Json', '');
                        if (data && data[baseKey] !== undefined) {
                            try { return JSON.stringify(data[baseKey]); } catch (e) { return '{}'; }
                        }
                    }
                     // Alapértelmezett, ha nem található a kulcs
                    value = null; // null-ra állítjuk, hogy a ?? "N/A" működjön
                    break;
                }
            }
             // Ha a végső érték szám, formázzuk, ha kell (példa)
            if (typeof value === 'number' && !isNaN(value)) {
                 if (key.startsWith('sim_p') || key.startsWith('modelConfidence') ) return value.toFixed(1);
                 if (key.startsWith('mu_') || key.startsWith('sim_mu_')) return value.toFixed(2);
            }

            return value ?? "N/A"; // ?? operátor: null vagy undefined esetén "N/A"
        } catch (e) {
            console.error(`Hiba a placeholder kitöltésekor: ${key}`, e);
            return "HIBA"; // Hiba jelzése a promptban
        }
    });
}
// ===================================

// --- EXPORT ---
export default {
    runAnalysisFlow,
    getChatResponse,
    _getContradictionAnalysis, // Placeholder
    getAiKeyQuestions,
    // Összes többi AI elemző funkció exportálása
    getTacticalBriefing,
    getPropheticScenario,
    getExpertConfidence,
    getRiskAssessment,
    getFinalGeneralAnalysis,
    getPlayerMarkets,
    getMasterRecommendation,
    getStrategicClosingThoughts,
    getBTTSAnalysis,
    getSoccerGoalsOUAnalysis,
    getCornerAnalysis,
    getCardAnalysis,
    getHockeyGoalsOUAnalysis,
    getHockeyWinnerAnalysis,
    getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn
};