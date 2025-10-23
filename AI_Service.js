/**
 * AI_Service.js
 * Felelős az AI modellel való kommunikációért, a promptok összeállításáért
 * és a válaszok feldolgozásáért.
 */
import { GEMINI_API_KEY } from './config.js'; // JAVÍTÁS: Csak a GEMINI_API_KEY importálása
import { getRichContextualData, getOptimizedOddsData } from './DataFetch.js'; // Adatgyűjtő függvények
import { calculateProbabilities, generateProTip } from './Model.js'; // Modellező függvények
import { saveToSheet } from './SheetService.js'; // Google Sheet mentés

// Konstansok a promptokhoz (példa)
const MASTER_AI_PROMPT_TEMPLATE = `
CRITICAL TASK: You are the Master AI Sports Analyst. Analyze the provided structured data for the match: {homeTeam} vs {awayTeam}.
Focus on predicting the final score and generating a single, concise betting tip based ONLY on the data provided.

Structured Data:
---
Match: {homeTeam} (Home) vs {awayTeam} (Away)
League: {leagueName}
Date: {matchDate}

Contextual Data:
{richContext}

Odds Data (Pinnacle):
{oddsString}

AI Committee Analysis:
{committeeAnalysis}
---

Your Tasks:
1.  **Final Score Prediction:** Predict the most likely final score (e.g., 2-1).
2.  **Betting Tip Generation:** Generate ONE concise, actionable betting tip (e.g., "Over 2.5 Goals", "Home Team to Win", "Both Teams To Score: Yes"). Base your tip *strictly* on the analysis and probabilities, considering potential value against the provided odds. Do NOT invent information.
3.  **Confidence Level:** Assign a confidence level to your tip (Low, Medium, High).
4.  **Reasoning:** Briefly explain your reasoning for the tip in 2-3 sentences max, referencing specific data points (e.g., H2H trends, form, key absentees, odds value).

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
You are an AI Sports Analyst specializing in {specialization}.
Analyze the provided data for the match: {homeTeam} vs {awayTeam}.
Provide a concise analysis (max 3 sentences) focusing on your area of expertise and predict the most likely outcome from your perspective (Home Win, Draw, Away Win, Over/Under X.5).

Data:
---
Match: {homeTeam} (Home) vs {awayTeam} (Away)
League: {leagueName}
Date: {matchDate}

Contextual Data:
{richContext}

Odds Data (Pinnacle):
{oddsString}
---

Your Output (Plain Text, Max 3 sentences + prediction):
<Your concise analysis focused on {specialization}>. Prediction: <Outcome>
`;


/**
 * A fő AI elemzési folyamatot vezérli.
 * @param {string} sport A sportág.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} leagueName Liga neve.
 * @param {string} matchDate Meccs dátuma (ISO string).
 * @param {object} openingOdds Nyitó szorzók (opcionális).
 * @returns {Promise<object>} A végső elemzés és tipp.
 */
export async function runAnalysisFlow(sport, homeTeam, awayTeam, leagueName, matchDate, openingOdds = null) {
    console.log(`Elemzés indítása: ${homeTeam} vs ${awayTeam} (${leagueName})`);

    let contextualData;
    let oddsData;
    let probabilities;
    let committeeAnalysis = "N/A"; // Alapértelmezett

    try {
        // 1. Adatgyűjtés (Gemini+Search + Odds)
        console.log("Adatgyűjtés...");
        contextualData = await getRichContextualData(sport, homeTeam, awayTeam, leagueName);
        // Az oddsData mostantól a contextualData része lehet, vagy külön kezeljük
        oddsData = contextualData.oddsData; // Az új struktúra szerint

        // Odds string formázása a promptokhoz
        const oddsString = oddsData?.current?.map(o => `${o.name}: ${o.price}`).join(', ') || "N/A";

        // Ellenőrizzük a kritikus statisztikákat
        if (!contextualData || !contextualData.rawStats || contextualData.rawStats.home.gp <= 0 || contextualData.rawStats.away.gp <= 0) {
            throw new Error("Kritikus csapat statisztikák (rawStats) lekérése sikertelen vagy hiányos.");
        }

        // 2. Valószínűségek Számítása (ha van elég adat)
        console.log("Valószínűségek számítása...");
        probabilities = calculateProbabilities(contextualData.rawStats, SPORT_CONFIG[sport]?.home_advantage, SPORT_CONFIG[sport]?.avg_goals);
        console.log("Becsült valószínűségek:", probabilities);

        // 3. AI Bizottság (Opcionális - most kihagyva az egyszerűség kedvéért és a token spórolás miatt)
        // Ha szükség lenne rá, itt hívnánk meg a _callGeminiWithSearch-t a COMMITTEE_MEMBER_PROMPT_TEMPLATE-tel többször.
        // committeeAnalysis = await runCommitteeAnalysis(contextualData, oddsString, matchDate, homeTeam, awayTeam, leagueName);
        console.log("AI Bizottság futtatása kihagyva.");

        // 4. Mester AI Hívása
        console.log("Mester AI hívása...");
        const masterPrompt = MASTER_AI_PROMPT_TEMPLATE
            .replace('{homeTeam}', homeTeam)
            .replace('{awayTeam}', awayTeam)
            .replace('{leagueName}', leagueName)
            .replace('{matchDate}', new Date(matchDate).toLocaleDateString())
            .replace('{richContext}', contextualData.richContext || "N/A")
            .replace('{oddsString}', oddsString)
            .replace('{committeeAnalysis}', committeeAnalysis);

        // Itt most már a _callGeminiWithSearch-t használjuk, ami a DataFetch.js-ben van!
        // Ez biztosítja, hogy a Vertex AI végpontot hívjuk meg kereséssel.
        const masterResponseJsonString = await _callGeminiWithSearch(masterPrompt);

        if (!masterResponseJsonString) {
            throw new Error("Mester AI nem adott választ.");
        }

        let masterPrediction;
        try {
            masterPrediction = JSON.parse(masterResponseJsonString);
        } catch (e) {
            console.error("Mester AI válasza nem volt érvényes JSON:", masterResponseJsonString.substring(0, 500));
            throw new Error("Mester AI válasza feldolgozhatatlan volt.");
        }

        // 5. Eredmény Összeállítása és Mentése
        const finalResult = {
            match: `${homeTeam} vs ${awayTeam}`,
            league: leagueName,
            date: matchDate,
            probabilities: probabilities, // Számított valószínűségek
            context: contextualData.richContext,
            odds: oddsData?.current || [], // Aktuális oddsok
            prediction: masterPrediction.prediction || { tip: "Hiba", confidence: "Low", reasoning: "Nem sikerült tippet generálni." }, // AI tippje
            fullRawData: contextualData.rawData // Nyers adatok debuggoláshoz
        };

        console.log("Végleges Tipp:", finalResult.prediction);

        // Mentés Google Sheet-be (aszinkron módon a háttérben)
        saveToSheet(finalResult).catch(err => console.error("Hiba a Google Sheet mentés során:", err.message));

        return finalResult;

    } catch (error) {
        console.error("Súlyos hiba az elemzési folyamban:", error.message);
        // Dobjuk tovább a hibát, hogy a hívó API végpont kezelhesse (pl. 500-as hibát adjon vissza)
        throw new Error(`Elemzési hiba (${homeTeam} vs ${awayTeam}): ${error.message}`);
    }
}

// Segédfüggvény az AI Bizottság futtatásához (jelenleg nincs használatban)
/*
async function runCommitteeAnalysis(contextualData, oddsString, matchDate, homeTeam, awayTeam, leagueName) {
    const specializations = ["Offensive", "Defensive", "Form/Momentum"]; // Példa szakterületek
    let committeeResults = [];
    console.log("AI Bizottság elemzése indul...");

    for (const spec of specializations) {
        try {
            const prompt = COMMITTEE_MEMBER_PROMPT_TEMPLATE
                .replace('{specialization}', spec)
                .replace('{homeTeam}', homeTeam)
                .replace('{awayTeam}', awayTeam)
                .replace('{leagueName}', leagueName)
                .replace('{matchDate}', new Date(matchDate).toLocaleDateString())
                .replace('{richContext}', contextualData.richContext || "N/A")
                .replace('{oddsString}', oddsString);

            // Itt is a _callGeminiWithSearch-t kellene használni
            const responseText = await _callGeminiWithSearch(prompt); // Figyelem: ez JSON-t vár vissza, a prompt sima szöveget kér! Át kellene írni.

            if (responseText) {
                // Egyszerűsített feldolgozás: feltételezzük, hogy a válasz a kért formátumban van
                committeeResults.push(`- ${spec} Analyst: ${responseText.trim()}`);
            } else {
                committeeResults.push(`- ${spec} Analyst: Nem sikerült elemzést adni.`);
            }
        } catch (e) {
            console.error(`Hiba a(z) ${spec} bizottsági tag futtatásakor:`, e.message);
            committeeResults.push(`- ${spec} Analyst: Hiba történt az elemzés során.`);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Kis szünet a hívások között
    }
    console.log("AI Bizottság elemzése kész.");
    return committeeResults.join('\n');
}
*/

// Itt lehetnek további segédfüggvények vagy exportok, ha szükségesek voltak a fájlban.