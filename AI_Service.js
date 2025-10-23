/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 */

// Importáljuk a szükséges függvényeket és konfigurációt
import { getRichContextualData, getOptimizedOddsData, _callGeminiWithSearch, _getFixturesFromEspn } from './DataFetch.js';
import { calculateProbabilities, generateProTip } from './Model.js';
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js'; // SPORT_CONFIG importálása

// --- PROMPT SABLONOK ---
// (Ezeket érdemes lehet külön fájlba szervezni később)

// Mester AI Prompt (a legutóbbi, Vertex AI + Search verzióhoz igazítva)
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

// Bizottsági Tag Prompt (referenciaként, de a hívása kikommentelve)
const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `
You are an AI Sports Analyst specializing in {specialization}.
Analyze the provided data for the match: {homeTeam} vs {awayTeam}.
Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5).

Data:
---
Match: {homeTeam} (Home) vs {awayTeam} (Away)
League: {leagueName}
Date: {matchDate}

Contextual Data (from Google Search and internal knowledge):
{richContext}

Odds Data (Pinnacle):
{oddsString}
---

Your Output (Plain Text, Max 3 sentences + prediction):
<Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;

// --- FŐ ELEMZÉSI FOLYAMAT ---

/**
 * A fő AI elemzési folyamatot vezérli. Meghívja az adatgyűjtést,
 * számításokat végez, majd meghívja a Mester AI-t a végső tippért.
 * @param {string} sport A sportág.
 * Pparam {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} leagueName Liga neve.
 * @param {string} matchDate Meccs dátuma (ISO string).
 * @param {object} openingOdds Nyitó szorzók (opcionális).
 * @returns {Promise<object>} A végső elemzés és tipp.
 * @throws {Error} Ha kritikus hiba történik az elemzés során.
 */
export async function runAnalysisFlow(sport, homeTeam, awayTeam, leagueName, matchDate, openingOdds = null) {
    console.log(`Elemzés indítása: ${homeTeam} vs ${awayTeam} (${leagueName})`); // Elemzés kezdete log

    let contextualData;
    let oddsData;
    let probabilities;
    let committeeAnalysis = "N/A"; // Alapértelmezett

    try {
        // 1. Adatgyűjtés (Vertex AI + Search + Odds)
        console.log("Adatgyűjtés (Vertex AI + Search)..."); // Logolás
        // Itt hívjuk meg a DataFetch.js fő függvényét
        contextualData = await getRichContextualData(sport, homeTeam, awayTeam, leagueName);
        oddsData = contextualData.oddsData; // Odds adatok kinyerése

        // Odds string formázása a promptokhoz
        const oddsString = oddsData?.current?.map(o => `${o.name}: ${o.price}`).join(', ') || "N/A"; // Oddsok formázása

        // Kritikus statisztikák ellenőrzése (getRichContextualData már hibát dob, ha gp <= 0)
        if (!contextualData || !contextualData.rawStats) {
             throw new Error("Kritikus hiba: Az adatgyűjtés nem adott vissza érvényes struktúrát."); // Extra ellenőrzés
        }
        console.log("Adatgyűjtés kész."); // Sikeres adatgyűjtés log

        // 2. Valószínűségek Számítása
        console.log("Valószínűségek számítása..."); // Logolás
        probabilities = calculateProbabilities(contextualData.rawStats, SPORT_CONFIG[sport]?.home_advantage, SPORT_CONFIG[sport]?.avg_goals); // Valószínűség számítás
        console.log("Becsült valószínűségek:", probabilities); // Eredmény logolása

        // 3. AI Bizottság (Kihagyva)
        console.log("AI Bizottság futtatása kihagyva."); // Logolás

        // 4. Mester AI Hívása
        console.log("Mester AI hívása (Vertex AI + Search)..."); // Logolás
        const masterPrompt = MASTER_AI_PROMPT_TEMPLATE // Prompt összeállítása
            .replace('{homeTeam}', homeTeam)
            .replace('{awayTeam}', awayTeam)
            .replace('{leagueName}', leagueName)
            .replace('{matchDate}', new Date(matchDate).toLocaleDateString('hu-HU')) // Magyar dátumformátum
            .replace('{richContext}', contextualData.richContext || "N/A")
            .replace('{oddsString}', oddsString)
            .replace('{committeeAnalysis}', committeeAnalysis);

        // Itt a DataFetch.js-ből importált _callGeminiWithSearch-t használjuk!
        const masterResponseJsonString = await _callGeminiWithSearch(masterPrompt); // Gemini hívás Vertex AI-on keresztül

        if (!masterResponseJsonString) { // Ha a Gemini hívás sikertelen volt
            throw new Error("Mester AI nem adott választ, vagy hiba történt a hívás során."); // Hiba dobása
        }

        let masterPrediction;
        try {
            // Próbáljuk meg tisztítani a JSON stringet, mielőtt parse-olnánk
            let cleanedJson = masterResponseJsonString.trim();
            const jsonMatch = cleanedJson.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch?.[1]) cleanedJson = jsonMatch[1];
            if (!cleanedJson.startsWith('{') && cleanedJson.includes('{')) cleanedJson = cleanedJson.substring(cleanedJson.indexOf('{'));
            if (!cleanedJson.endsWith('}') && cleanedJson.includes('}')) cleanedJson = cleanedJson.substring(0, cleanedJson.lastIndexOf('}') + 1);
            masterPrediction = JSON.parse(cleanedJson); // JSON feldolgozás
        } catch (e) {
            console.error("Mester AI válasza nem volt érvényes JSON:", masterResponseJsonString.substring(0, 500)); // Hiba logolása
            throw new Error(`Mester AI válasza feldolgozhatatlan volt (JSON parse error): ${e.message}`); // Hiba dobása
        }

        // 5. Eredmény Összeállítása és Mentése
        const finalResult = {
            match: `${homeTeam} vs ${awayTeam}`,
            league: leagueName,
            date: matchDate,
            probabilities: probabilities, // Számított valószínűségek
            context: contextualData.richContext, // Gemini által adott kontextus
            odds: oddsData?.current || [], // Aktuális oddsok (ha vannak)
            // Biztosítjuk, hogy a prediction objektum létezzen és meglegyenek a mezői
            prediction: {
                final_score: masterPrediction?.prediction?.final_score || "N/A",
                tip: masterPrediction?.prediction?.tip || "Hiba",
                confidence: masterPrediction?.prediction?.confidence || "Low",
                reasoning: masterPrediction?.prediction?.reasoning || "Nem sikerült tippet generálni."
            },
            fullRawData: contextualData.rawData // Nyers adatok debuggoláshoz
        };

        console.log("Végleges Tipp:", finalResult.prediction); // Tipp logolása

        // Mentés Google Sheet-be (aszinkron módon a háttérben, hibakezeléssel)
        saveToSheet(finalResult).catch(err => console.error("Hiba a Google Sheet mentés során:", err.message)); // Mentés és hibakezelés

        return finalResult; // Visszatérés az eredménnyel

    } catch (error) { // Átfogó hibakezelés az egész folyamatra
        console.error(`Súlyos hiba az elemzési folyamban (${homeTeam} vs ${awayTeam}): ${error.message}`); // Hiba logolása
        console.error("Hiba részletei:", error.stack); // Stack trace a részletesebb hibakereséshez
        // Dobjuk tovább a hibát, hogy a hívó API végpont (index.js) kezelhesse
        throw new Error(`Elemzési hiba (${homeTeam} vs ${awayTeam}): ${error.message}`);
    }
}

// --- CHAT FUNKCIÓ (ÁTALAKÍTVA NODE.JS-RE) ---
/**
 * Kezeli a chat kéréseket, kontextust és előzményeket használva.
 * @param {string} context Az elemzés kontextusa.
 * @param {Array} history A chat előzmények [{role: 'user'/'model', parts: [{text: ''}]}] formátumban.
 * @param {string} question A felhasználó aktuális kérdése.
 * @returns {Promise<object>} Válasz objektum { answer: "..." } vagy { error: "..." } formában.
 */
export async function getChatResponse(context, history, question) {
    if (!context || !question) { // Bemenet ellenőrzése
        console.error("Chat hiba: Hiányzó kontextus vagy kérdés.");
        return { error: "Hiányzó kontextus vagy kérdés." };
    }

    const validHistory = Array.isArray(history) ? history : []; // Előzmények validálása

    try {
        // Prompt összeállítása a kontextus, előzmények és kérdés alapján
        let historyString = validHistory.map(msg => {
            const role = msg.role === 'user' ? 'Felh' : 'AI';
            const text = msg.parts?.[0]?.text || msg.text || ''; // Kompatibilitás a régebbi formátummal
            return `${role}: ${text}`;
        }).join('\n');

        // A prompt lényegében ugyanaz maradhat, mint a GS verzióban
        const prompt = `You are an elite sports analyst AI assistant. Continue the conversation based on the context and history.
Analysis Context (DO NOT repeat, just use): --- ANALYSIS START --- ${context} --- ANALYSIS END ---
Chat History:
${historyString}
Current User Question: ${question}
Your Task: Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History. If the answer isn't there, say so politely. Stay professional. Keep answers brief.`;

        // Itt is a DataFetch.js-ben lévő AI hívót használjuk
        // FIGYELEM: A chathez valószínűleg NEM kell a Google Search, ezért egy külön AI hívó kellhetne,
        // ami nem kapcsolja be a 'tools'-t, vagy a _callGeminiWithSearch-t módosítani kell,
        // hogy opcionálisan ki lehessen kapcsolni a keresést.
        // MOST AZ EGYSZERŰSÉG KEDVÉÉRT MARAD A KERESŐS HÍVÁS, DE EZ TOKENPAZARLÓ LEHET A CHATHEZ.
        const answer = await _callGeminiWithSearch(prompt); // Hívás kereséssel

        if (answer) {
            // Egyszerűsített válasz: csak a szöveget adjuk vissza
            let cleanedAnswer = answer.trim();
            // Esetleges ```json ... ``` blokk eltávolítása, ha mégis azt adna vissza
            const jsonMatch = cleanedAnswer.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch?.[1]) cleanedAnswer = jsonMatch[1];

            return { answer: cleanedAnswer }; // Sikeres válasz
        } else {
            console.error("Chat AI hiba: Nem érkezett válasz a Geminitől.");
            return { error: "Az AI nem tudott válaszolni." }; // Hiba, ha nincs válasz
        }
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`); // Hiba logolása
        return { error: `Chat AI hiba: ${e.message}` }; // Hiba visszaadása
    }
}


// --- EXPORT ---
// Exportáljuk a fő funkciókat, hogy az index.js (vagy más modulok) használhassák.
export default {
    runAnalysisFlow,
    getChatResponse,
    // Ha az ESPN lekérdezést is innen akarjuk indítani (pl. egy külön API végponttal):
    getFixtures: _getFixturesFromEspn // Átnevezzük az exportot, hogy érthetőbb legyen
};