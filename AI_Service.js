/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * JAVÍTÁS: Hozzáadva a getAiKeyQuestions függvény és exportálása.
 */

// Importáljuk a szükséges függvényeket és konfigurációt
import { getRichContextualData, getOptimizedOddsData, _callGeminiWithSearch, _getFixturesFromEspn } from './DataFetch.js';
import { calculateProbabilities, generateProTip } from './Model.js'; // Placeholder lehet a calculateProbabilities
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK ---
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Master AI Sports Analyst. Analyze the provided structured data for the match: {homeTeam} vs {awayTeam}. Focus on predicting the final score and generating a single, concise betting tip based ONLY on the data provided. Use Google Search results included in the context. Structured Data: --- Match: {homeTeam} (Home) vs {awayTeam} (Away) League: {leagueName} Date: {matchDate} Contextual Data (from Google Search and internal knowledge): {richContext} Odds Data (Pinnacle): {oddsString} AI Committee Analysis: {committeeAnalysis} --- Your Tasks: 1. Final Score Prediction: Predict the most likely final score (e.g., 2-1). 2. Betting Tip Generation: Generate ONE concise, actionable betting tip (e.g., "Over 2.5 Goals", "Home Team to Win", "Both Teams To Score: Yes"). Base your tip *strictly* on the analysis and probabilities, considering potential value against the provided odds and information gathered from search. Do NOT invent information. 3. Confidence Level: Assign a confidence level to your tip (Low, Medium, High). 4. Reasoning: Briefly explain your reasoning for the tip in 2-3 sentences max, referencing specific data points (e.g., recent news from search, H2H trends, form, key absentees, odds value). Output Format (JSON ONLY, no extra text): {{"prediction": {{"final_score": "H-A", "tip": "<Your Betting Tip>", "confidence": "<Low|Medium|High>", "reasoning": "<Brief explanation>"}}}}
`;

const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `
You are an AI Sports Analyst specializing in {specialization}. Analyze the provided data for the match: {homeTeam} vs {awayTeam}. Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5). Data: --- Match: {homeTeam} (Home) vs {awayTeam} (Away) League: {leagueName} Date: {matchDate} Contextual Data (from Google Search and internal knowledge): {richContext} Odds Data (Pinnacle): {oddsString} --- Your Output (Plain Text, Max 3 sentences + prediction): <Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;

// === Placeholder az ellentmondás-analízishez ===
export async function _getContradictionAnalysis(context, probabilities, odds) {
    console.warn("_getContradictionAnalysis placeholder hívva - ez a funkció jelenleg nincs implementálva.");
    return "Ellentmondás-analízis kihagyva.";
}

// === JAVÍTÁS: getAiKeyQuestions függvény hozzáadása és exportálása ===
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
        probabilities = calculateProbabilities(contextualData.rawStats, SPORT_CONFIG[sport]?.home_advantage, SPORT_CONFIG[sport]?.avg_goals);
        console.log("Placeholder valószínűségek:", probabilities); // Ez null értékeket fog mutatni

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


// --- EXPORT ---
export default {
    runAnalysisFlow,
    getChatResponse,
    _getContradictionAnalysis, // Placeholder
    getAiKeyQuestions,          // Hozzáadva az exporthoz
    getFixtures: _getFixturesFromEspn
};