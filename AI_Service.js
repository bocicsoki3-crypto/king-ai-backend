import axios from 'axios'; // Axios API hívásokhoz
import { GEMINI_API_URL, GEMINI_API_KEY } from './config.js'; // Konfiguráció importálása

/**************************************************************
* AI_Service.js - Központi AI Szolgáltató Modul (Node.js Verzió - V17 alapokon)
* Feladata: Az "AI Bizottság", a Mester Ajánlás és az összes Gemini AI
* kommunikáció központi kezelése Node.js környezetben.
* Változások a .gs verzióhoz képest:
* - `import`/`export` használata.
* - `UrlFetchApp` helyett `axios` használata Gemini API hívásokhoz (`_callGeminiForSpecificTask`).
* - `Logger.log` helyett `console.log`/`console.warn`/`console.error`.
* - `ContentService` eltávolítva (a funkciók közvetlenül az adatot/stringet adják vissza).
* - Minden AI hívó funkció `async`, mert `axios`-t használnak.
* - Hozzáadva a `getFinalCheck` funkció a `runFinalCheck` frontend híváshoz.
**************************************************************/

// --- KÖZPONTI AI HÍVÁS KEZELŐK ---

/**
 * Létrehoz egy Gemini API kérés objektumot axios számára.
 * @param {object} opts Opciók ({ prompt: string, tools?: Array<object> })
 * @returns {object} Az axios számára szükséges kérés objektum ({ url, method, headers, data }).
 * @throws {Error} Hiba, ha a prompt érvénytelen.
 */
function createGeminiRequestConfig(opts) {
    if (!opts || !opts.prompt || typeof opts.prompt !== 'string' || opts.prompt.trim() === '') {
        console.error("Hiba: Érvénytelen prompt a createGeminiRequestConfig-ben.");
        throw new Error("Érvénytelen vagy hiányzó prompt a Gemini kérés létrehozásakor.");
    }
    const payload = {
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192
        },
        tools: opts.tools || [] // Google Search Tool itt kerülhet hozzáadásra, ha szükséges
    };
    if (opts.tools && !Array.isArray(opts.tools)) {
        console.warn("Figyelmeztetés: Az 'tools' opciónak tömbnek kell lennie a createGeminiRequestConfig-ben.");
        payload.tools = [];
    }
    return {
        url: GEMINI_API_URL,
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        data: payload,
        validateStatus: () => true // Elfogadjuk a nem 200-as válaszokat is a jobb hibakezelésért
    };
}

/**
 * Feldolgozza a Gemini API válaszát.
 * @param {object} response Az axios válasz objektuma.
 * @returns {string} A Gemini által generált szöveges válasz.
 * @throws {Error} Hiba, ha a válasz érvénytelen vagy a Gemini hibát jelzett.
 */
function parseGeminiResponseData(response) {
    const code = response.status;
    const data = response.data;

    if (code !== 200) {
        console.error(`Gemini API HTTP hiba (${code}): ${JSON.stringify(data)?.substring(0, 500)}`);
        throw new Error(`Gemini API hiba (${code}).`);
    }

    try {
        const candidate = data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
            console.error(`Gemini API válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. Válasz: ${JSON.stringify(data)?.substring(0, 500)}`);
            if (finishReason === 'SAFETY') throw new Error("Az AI válaszát biztonsági szűrők blokkolták.");
            if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt.");
            console.error("Teljes Gemini válasz (hiba esetén):", JSON.stringify(data, null, 2));
            throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Ismeretlen'}`);
        }
        return responseText;
    } catch (e) {
        console.error(`Hiba a Gemini válasz feldolgozása közben: ${e.message}. Nyers adat: ${JSON.stringify(data)?.substring(0, 500)}`);
        // Ha van nyers text a legfelső szinten (bár nem valószínű a struktúra miatt), visszaadjuk
        if (typeof data === 'string') return data;
        throw new Error(`Hiba a Gemini válasz feldolgozása közben: ${e.message}`);
    }
}


/**
 * Meghívja a Gemini API-t egy adott prompttal.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string>} Az AI által generált válasz.
 * @throws {Error} Hiba az API hívás vagy feldolgozás során.
 */
async function _callGeminiForSpecificTask(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error("Hiányzó GEMINI_API_KEY.");
    }
    try {
        const requestConfig = createGeminiRequestConfig({ prompt: prompt });
        const response = await axios(requestConfig);
        return parseGeminiResponseData(response);
    } catch (e) {
        // Logoljuk a hibát, de a hívó felelőssége kezelni (pl. default értékkel)
        console.error(`Hiba egyedi AI feladat hívása során: ${e.message} Prompt eleje: ${prompt.substring(0, 200)}`);
        // Továbbdobjuk a hibát, hogy a hívó tudjon róla
        throw e;
    }
}


// --- ÁLTALÁNOS AI BIZOTTSÁGI FUNKCIÓK (async axios hívásokkal) ---

export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis, riskAnalysisResult) {
    if (!rawData?.tactics?.home?.style || !rawData?.tactics?.away?.style) {
        console.warn("getTacticalBriefing: Hiányos taktikai stílus adatok.");
        return "A taktikai elemzéshez szükséges stílusleírások hiányosak.";
    }
    const homeAbsenteesText = rawData?.absentees?.home?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
    const awayAbsenteesText = rawData?.absentees?.away?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';

    const prompt = `You are a world-class sports tactician.
Your SOLE TASK is to provide a concise, expert tactical briefing (2-4 sentences max) in Hungarian for the ${sport} match: ${home} vs ${away}.
CRITICAL RULE: Highlight key tactical terms, player/team names with **asterisks** (use sparingly for maximum impact, only on the most crucial elements).
STRICT RULES: Hungarian only. No headers, questions, intro/conclusion. Just the briefing.
DATA: Clash of Styles: ${home} ("${rawData.tactics.home.style}") vs ${away} ("${rawData.tactics.away.style}"). Key Absentees Impact: Home: ${homeAbsenteesText}. Away: ${awayAbsenteesText}. Consider impact on tactics. Key Duel: "${duelAnalysis || 'N/A'}". Critical Risk: "${riskAnalysisResult || 'N/A'}". Key Players: H: ${rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A'}, A: ${rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'}.
Synthesize data. Identify key battleground. Address Risk and Absentees impact tactically if relevant.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Taktikai elemzési hiba: ${e.message}`; } // Hiba esetén adjon vissza hibaüzenetet
}

export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    if (!propheticTimeline || !Array.isArray(propheticTimeline) || propheticTimeline.length === 0) { // Ellenőrizzük, hogy üres-e
        console.warn("getPropheticScenario: Nincs érvényes (vagy üres) idővonal, alapértelmezett forgatókönyv.");
        const likelyScore = (rawData?.mu_h_sim != null && rawData?.mu_a_sim != null) ? `${Math.round(rawData.mu_h_sim)}-${Math.round(rawData.mu_a_sim)}` : "kevés gólos döntetlen"; // Null check
        return `A mérkőzés várhatóan kiegyenlített küzdelmet hoz, óvatos kezdéssel. A második játékrész hozhat döntést, de a **${likelyScore}** reális kimenetel.`;
    }
    const prompt = `You are an elite sports journalist. Your SOLE TASK is to write a compelling, *highly descriptive*, prophetic scenario in Hungarian for the ${sport} match: ${home} vs ${away}, based ONLY on the sparse timeline. Write as a flowing narrative commentary. CRITICAL: Timeline has key points; weave them into a realistic story. Describe ebb/flow, momentum shifts, near-misses, atmosphere between events. *BE DECISIVE*. STRICT RULES: Hungarian only. Third person. No instructions/confirmation. No intro/conclusion. Start directly. No placeholders. Build story AROUND events. Highlight key moments (goals, cards), names (from key_players if available, else generic), teams, final outcome with **asterisks** (use thoughtfully). EVENT TIMELINE: ${JSON.stringify(propheticTimeline)}. OTHER CONTEXT: Tactics: ${home} (${rawData?.tactics?.home?.style || 'N/A'}) vs ${away} (${rawData?.tactics?.away?.style || 'N/A'}). Tension: ${rawData?.contextual_factors?.match_tension_index || 'N/A'}. Key Absentees: Home: ${rawData?.absentees?.home?.map(p => p.name).join(', ') || 'Nincs'}, Away: ${rawData?.absentees?.away?.map(p => p.name).join(', ') || 'Nincs'}. EXAMPLE (Away goal 28', Home goal 72'): "A levegő vibrál... **${away}** vezetést szerez... **${home}** egyenlít... **igazságos döntetlen**."`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Forgatókönyv generálási hiba: ${e.message}`; }
}

export async function getExpertConfidence(modelConfidence, richContext, rawData) {
    if (typeof modelConfidence !== 'number' || !richContext || typeof richContext !== 'string' || !rawData) {
        console.warn("getExpertConfidence: Érvénytelen bemeneti adatok.");
        return "**1.0/10** - Hiba: hiányos adatok.";
    }
    const h2hText = rawData.h2h_structured?.length > 0 ? `Legutóbbi H2H: ${rawData.h2h_structured[0].date} ${rawData.h2h_structured[0].venue} ${rawData.h2h_structured[0].score}.` : "Nincs friss H2H.";
    const homeAbsenteesText = rawData.absentees?.home?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'; const awayAbsenteesText = rawData.absentees?.away?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs';
    const prompt = `You are a master sports betting risk analyst. Your SOLE TASK is to provide a final confidence score (1.0-10.0) and a single, concise justification sentence in Hungarian. STRICT RULES: Hungarian only. Format: **SCORE/10** - Indoklás. (Example: **7.5/10** - Statisztika erős, de kulcsjátékos hiánya bizonytalanságot okoz.). No methodology explanation. No questions. Single sentence justification. DATA: Stat Model Confidence: ${modelConfidence.toFixed(1)}/10. Narrative Context Summary: ${richContext}. Key Structured Context: Recent H2H: ${h2hText}. Key Absentees: Home: ${homeAbsenteesText}. Away: ${awayAbsenteesText}. Venue Form: H(home): ${rawData.form?.home_home || 'N/A'}. A(away): ${rawData.form?.away_away || 'N/A'}. METHOD: Start with Stat Confidence. Adjust based *primarily* on Key Structured Context (Absentees, H2H, Venue Form), using Narrative for nuance. Decrease significantly for 'key' absentees on favored side OR strong H2H contradiction. Decrease moderately for venue form contradiction. Increase for 'key' absentees on underdog OR supporting H2H/Venue Form. Minor context = minimal impact. Significant factors: +/- 1.0 to 3.0 points. Final score 1.0-10.0. EXAMPLE: "**8.5/10** - Statisztikai modell magabiztos, és az ellenfél **kulcs védőjének (Név) hiánya**, valamint a **hazai csapat jó otthoni formája** erősíti a győzelmi esélyt."`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `**1.0/10** - Szakértői bizalom meghatározási hiba: ${e.message}`; }
}

export async function getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel) {
    if (!sim || typeof sim.pHome !== 'number' || !rawData || marketIntel == null) { // marketIntel lehet üres string
        console.warn("getRiskAssessment: Hiányos bemeneti adatok.");
        return "A kockázatelemzéshez szükséges adatok hiányosak.";
    }
    const homeAbsenteesText = rawData.absentees?.home?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'; const awayAbsenteesText = rawData.absentees?.away?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'; const h2hText = rawData.h2h_structured?.length > 0 ? `Legutóbbi H2H: ${rawData.h2h_structured[0].date} ${rawData.h2h_structured[0].venue} ${rawData.h2h_structured[0].score}.` : "Nincs friss H2H.";
    const prompt = `You are a professional sports risk assessment analyst. Identify pitfalls/reasons why the main statistical prediction might fail, focusing on contradictions. CRITICAL DATA: Stat Prediction: H ${sim.pHome.toFixed(1)}%, D ${sim.pDraw.toFixed(1)}%, A ${sim.pAway.toFixed(1)}%. Stat xG: H ${mu_h?.toFixed(2) ?? 'N/A'} vs A ${mu_a?.toFixed(2) ?? 'N/A'}. OTHER DATA (Focus on these): Market Intel: "${marketIntel}". Key Absentees: H: ${homeAbsenteesText}. A: ${awayAbsenteesText}. Recent H2H: ${h2hText}. Venue Form: H(home): ${rawData.form?.home_home || 'N/A'}. A(away): ${rawData.form?.away_away || 'N/A'}. General Context: News: H: ${rawData.team_news?.home || 'N/A'}, V: ${rawData.team_news?.away || 'N/A'}. Motivation: H: ${rawData.contextual_factors?.motivation_home || 'N/A'}, V: ${rawData.contextual_factors?.motivation_away || 'N/A'}. TASK: Based PRIMARILY on Market Intel, Key Absentees, Recent H2H, and Venue Form, what is the SINGLE biggest risk or contradiction undermining the Stat Model's *most likely* outcome? Be specific, explain *why* it's a risk. (e.g., "Modell favorizálja hazait (65%), de **piaci mozgás ellene megy (-8%)**, utalva piaci infóra (sérülés?)." or "Statisztika szoros (H 45%), de **vendég kulcs irányító (Név) hiánya** miatt hazaiak könnyebben nyerhetnek."). STRICT RULES: Hungarian only. No methodology. No questions/solutions. Focus ONLY on most significant risk/contradiction. Highlight key risk factors/data with **asterisks** (sparingly). Concise: 2-3 sentences max.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Kockázatkezelői elemzési hiba: ${e.message}`; }
}

export async function getFinalGeneralAnalysis(sim, mu_h, mu_a, tacticalBriefing, propheticScenario, rawData) {
    if (!sim || typeof sim.pHome !== 'number' || typeof mu_h !== 'number' || !tacticalBriefing || !propheticScenario || !rawData) {
        console.warn("getFinalGeneralAnalysis: Hiányos bemeneti adatok.");
        return "Az általános elemzéshez szükséges adatok hiányosak.";
    }
    const homeAbsenteesText = rawData.absentees?.home?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs kulcs'; const awayAbsenteesText = rawData.absentees?.away?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs kulcs';
    const prompt = `You are Editor-in-Chief. SOLE TASK: Write final summary ("Általános Elemzés") for match preview, synthesizing data. STRICT RULES: Hungarian only. No letters/placeholders. No intro/self-explanation. Exactly TWO paragraphs. **P1:** State most likely outcome (probs, xG), core statistical reasoning AND *critically acknowledge potential impact of key absentees*. **P2:** Explain 'why' by blending tactical briefing & prophetic scenario. How will it likely unfold? Highlight most important conclusions (predicted winner/outcome type, key tactical factor, impact of absentees) with **asterisks** (SPARINGLY, 2-4 max). DATA: Key Probs: H ${sim.pHome.toFixed(1)}%, D ${sim.pDraw.toFixed(1)}%, A ${sim.pAway.toFixed(1)}%. xG: H ${mu_h?.toFixed(2) ?? 'N/A'} - A ${mu_a?.toFixed(2) ?? 'N/A'}. Key Absentees: H: ${homeAbsenteesText}. A: ${awayAbsenteesText}. Tactical Briefing: "${tacticalBriefing}". Prophetic Scenario: "${propheticScenario}". Generate two-paragraph Hungarian summary.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Általános elemzési hiba: ${e.message}`; }
}

export async function getAiKeyQuestions(richContext, rawData) {
    if (!richContext || typeof richContext !== 'string' || !rawData) {
        console.warn("getAiKeyQuestions: Hiányzó kontextus/rawData.");
        return "- Hiba: Adatok hiányosak.";
    }
    const homeAbsenteesText = rawData.absentees?.home?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'; const awayAbsenteesText = rawData.absentees?.away?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'; const h2hText = rawData.h2h_structured?.length > 0 ? `Legutóbbi H2H: ${rawData.h2h_structured[0].score} (${rawData.h2h_structured[0].venue})` : "Nincs friss H2H.";
    const prompt = `You are a strategic analyst. STRICT RULE: Hungarian only. Based SOLELY on provided context, formulate the two (2) most critical strategic questions deciding the match outcome. Highlight core uncertainties/battlegrounds considering tactics, absentees, H2H trends. Present ONLY as a bulleted list (-). No intro/explanation/conclusion. CONTEXT SUMMARY: ${richContext}. KEY STRUCTURED DATA: Key Absentees: H: ${homeAbsenteesText}. A: ${awayAbsenteesText}. Recent H2H: ${h2hText}. Tactics: H: ${rawData.tactics?.home?.style || 'N/A'}, A: ${rawData.tactics?.away?.style || 'N/A'}.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `- Hiba a kulcskérdések generálásakor: ${e.message}`; }
}

export async function getPlayerMarkets(keyPlayers, richContext, rawData) {
    if (!keyPlayers || ((keyPlayers.home || []).length === 0 && (keyPlayers.away || []).length === 0)) {
        console.warn("getPlayerMarkets: Nincsenek kulcsjátékosok.");
        return "Nincsenek kiemelt kulcsjátékosok ehhez a mérkőzéshez.";
    }
    if (!richContext || typeof richContext !== 'string' || !rawData) {
        console.warn("getPlayerMarkets: Hiányzó kontextus/rawData.");
        return "A játékospiacok elemzéséhez szükséges kontextus hiányzik.";
    }
    const refereeText = rawData.referee?.name !== 'N/A' ? `Játékvezető: ${rawData.referee.name} (${rawData.referee.stats || 'N/A'}).` : ""; const tensionText = rawData.contextual_factors?.match_tension_index ? `Meccsfeszültség: ${rawData.contextual_factors.match_tension_index}.` : "";
    const prompt = `You are a specialist analyst focusing on player performance betting markets. SOLE TASK: Analyze key players & context, suggest 1-2 potentially interesting player-specific markets. STRICT RULES: Hungarian only. No questions/explanations. Direct, concise analysis (2-3 sentences max). Start directly. Identify specific players & markets (e.g., "Gólt szerez", "2+ lövés", "Sárga lap", "Gólpassz"). MUST highlight player names & suggested markets with **asterisks** (only these). DATA: Key Players (roles/stats): ${JSON.stringify(keyPlayers)}. Match Context Summary: ${richContext}. Additional Context: ${refereeText} ${tensionText} Tactics: H: ${rawData.tactics?.home?.style || 'N/A'}, V: ${rawData.tactics?.away?.style || 'N/A'}. Based on roles, stats, context (tactics, opponent weakness), referee strictness, tension, what are the most logical player angles? Focus on likelihood/reasoning. EXAMPLE: "**Erling Haaland** kiváló formája és a védelem sebezhetősége miatt a **Gólt szerez bármikor** piac tűnik valószínűnek. **James Ward-Prowse** pontrúgás-specialista, **Gólpasszt ad** fogadásban lehet érték, ha **szigorú a bíró**."`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Játékospiaci elemzési hiba: ${e.message}`; }
}


// --- PIAC-SPECIFIKUS MIKROMODELLEK ---

export async function getBTTSAnalysis(sim, rawData) {
    if (!sim || typeof sim.pBTTS !== 'number' || typeof sim.mu_h_sim !== 'number' || !rawData?.form || !rawData.absentees) {
        console.warn("getBTTSAnalysis: Hiányos adatok."); return "Adatok hiányosak. Bizalom: Alacsony";
    }
    const homeAttackersMissing = rawData.absentees.home?.filter(p => p.position?.toLowerCase().includes('támadó')).map(p => p.name).join(', ') || 'Nincs'; const awayAttackersMissing = rawData.absentees.away?.filter(p => p.position?.toLowerCase().includes('támadó')).map(p => p.name).join(', ') || 'Nincs'; const homeDefendersMissing = rawData.absentees.home?.filter(p => p.position?.toLowerCase().includes('védő')).map(p => p.name).join(', ') || 'Nincs'; const awayDefendersMissing = rawData.absentees.away?.filter(p => p.position?.toLowerCase().includes('védő')).map(p => p.name).join(', ') || 'Nincs';
    const prompt = `You are a BTTS specialist. Analyze ONLY potential for both teams to score based strictly on data. DATA: Sim Prob (BTTS Yes): ${sim.pBTTS.toFixed(1)}%. xG: H ${sim.mu_h_sim?.toFixed(2) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(2) ?? 'N/A'}. Form (Overall): H: ${rawData.form.home_overall || 'N/A'}, A: ${rawData.form.away_overall || 'N/A'}. Key Attacker Abs: H: ${homeAttackersMissing}. A: ${awayAttackersMissing}. Key Defender Abs: H: ${homeDefendersMissing}. A: ${awayDefendersMissing}. H2H Sum: ${rawData.h2h_summary || 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on BTTS (Yes/No). MUST highlight final conclusion (**BTTS: Igen valószínű** / **BTTS: Nem valószínű**) & 1-2 key supporting points (**magas xG**, **kulcs védők hiánya**, **formák**, **gyenge támadósorok**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `BTTS elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || typeof sim.pOver !== 'number' || typeof sim.mu_h_sim !== 'number' || !rawData?.tactics || typeof mainTotalsLine !== 'number' || !rawData.absentees) {
        console.warn("getSoccerGoalsOUAnalysis: Hiányos adatok."); return `Adatok hiányosak (O/U ${mainTotalsLine ?? '?'}). Bizalom: Alacsony`;
    }
    const line = mainTotalsLine; const homeAttackersMissing = rawData.absentees.home?.filter(p => p.position?.toLowerCase().includes('támadó')).map(p => p.name).join(', ') || 'Nincs'; const awayAttackersMissing = rawData.absentees.away?.filter(p => p.position?.toLowerCase().includes('támadó')).map(p => p.name).join(', ') || 'Nincs';
    const prompt = `You are a Soccer O/U Goals specialist. Analyze potential total goals (O/U line) based ONLY on data. DATA: Line: ${line}. Sim Prob (Over ${line}): ${sim.pOver.toFixed(1)}%. xG: H ${sim.mu_h_sim?.toFixed(2) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(2) ?? 'N/A'} (Sum: ${(sim.mu_h_sim + sim.mu_a_sim)?.toFixed(2) ?? 'N/A'}). Styles: H: ${rawData.tactics.home?.style || 'N/A'}, A: ${rawData.tactics.away?.style || 'N/A'}. Key Attacker Abs: H: ${homeAttackersMissing}. A: ${awayAttackersMissing}. Form (Overall): H: ${rawData.form?.home_overall || 'N/A'}, A: ${rawData.form?.away_overall || 'N/A'}. H2H Sum: ${rawData.h2h_summary || 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on O/U ${line}. MUST highlight final conclusion (**Over ${line} gól várható** / **Under ${line} gól a valószínűbb**) & 1-2 key supporting points (**magas xG**, **óvatos stílusok**, **kulcs támadók hiánya**, **H2H kevés gól**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Gól O/U elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getCornerAnalysis(sim, rawData) {
    if (!sim?.corners || !rawData?.advanced_stats || typeof sim.mu_corners_sim !== 'number' || !rawData.tactics) {
        console.warn("getCornerAnalysis: Hiányos adatok."); return "Adatok hiányosak. Bizalom: Alacsony";
    }
    const likelyLine = Math.round(sim.mu_corners_sim * 10 / 5) * 0.5; const overProbKey = `o${likelyLine}`; const overProb = sim.corners[overProbKey];
    const prompt = `You are a Soccer Corners specialist. Analyze potential total corners based ONLY on data, relative to likely line ${likelyLine}. DATA: Est Avg Corners: ${sim.mu_corners_sim.toFixed(1)}. Sim Prob (Over ${likelyLine}): ${overProb != null ? overProb.toFixed(1) + '%' : 'N/A'}. Avg Corners Hist: H For:${rawData.advanced_stats.home?.avg_corners_for_per_game?.toFixed(1) || 'N/A'} / H Ag:${rawData.advanced_stats.home?.avg_corners_against_per_game?.toFixed(1) || 'N/A'}; A For:${rawData.advanced_stats.away?.avg_corners_for_per_game?.toFixed(1) || 'N/A'} / A Ag:${rawData.advanced_stats.away?.avg_corners_against_per_game?.toFixed(1) || 'N/A'}. Styles: H: ${rawData.tactics.home?.style || 'N/A'}, A: ${rawData.tactics.away?.style || 'N/A'}. Poss Est: H: ${rawData.advanced_stats.home?.possession_pct ?? 'N/A'}% vs A: ${rawData.advanced_stats.away?.possession_pct ?? 'N/A'}%. Shots Est: H: ${rawData.advanced_stats.home?.shots ?? 'N/A'} vs A: ${rawData.advanced_stats.away?.shots ?? 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on Corners relative to ${likelyLine}. MUST highlight final conclusion (**Over ${likelyLine} szöglet várható** / **Under ${likelyLine} szöglet a valószínűbb**) & 1-2 key supporting points (**széleken támadás**, **alacsony lövésszám**, **magas hist. szögletszámok**, **domináns birtoklás**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Szöglet elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getCardAnalysis(sim, rawData) {
    if (!sim?.cards || !rawData?.advanced_stats || typeof sim.mu_cards_sim !== 'number' || !rawData.referee || !rawData.contextual_factors || !rawData.tactics) {
        console.warn("getCardAnalysis: Hiányos adatok."); return "Adatok hiányosak. Bizalom: Alacsony";
    }
    const likelyLine = Math.round(sim.mu_cards_sim * 10 / 5) * 0.5; const overProbKey = `o${likelyLine}`; const overProb = sim.cards[overProbKey];
    const prompt = `You are a Soccer Cards specialist. Analyze potential total cards based ONLY on data, relative to likely line ${likelyLine}. DATA: Est Avg Cards: ${sim.mu_cards_sim.toFixed(1)}. Sim Prob (Over ${likelyLine}): ${overProb != null ? overProb.toFixed(1) + '%' : 'N/A'}. Avg Cards Hist: H: ${rawData.advanced_stats.home?.avg_cards_per_game?.toFixed(1) || 'N/A'}, A: ${rawData.advanced_stats.away?.avg_cards_per_game?.toFixed(1) || 'N/A'}. Referee: ${rawData.referee.name || 'N/A'} (${rawData.referee.stats || 'N/A'}). Tension: ${rawData.contextual_factors.match_tension_index || 'Alacsony'}. Styles/Aggression: H: ${rawData.tactics.home?.style || 'N/A'}, A: ${rawData.tactics.away?.style || 'N/A'}. Est Fouls: H: ${rawData.advanced_stats.home?.fouls ?? 'N/A'} vs A: ${rawData.advanced_stats.away?.fouls ?? 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on Cards relative to ${likelyLine}. MUST highlight final conclusion (**Over ${likelyLine} lap várható** / **Under ${likelyLine} lap a valószínűbb**) & 1-2 key supporting points (**szigorú bíró**, **magas feszültség/sok fault**, **csapatok alacsony lapszáma**, **engedékeny bíró**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Lapok elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || typeof sim.pOver !== 'number' || typeof sim.mu_h_sim !== 'number' || !rawData?.advanced_stats || typeof mainTotalsLine !== 'number' || !rawData.form) {
        console.warn("getHockeyGoalsOUAnalysis: Hiányos adatok."); return `Adatok hiányosak (O/U ${mainTotalsLine ?? '?'}). Bizalom: Alacsony`;
    }
    const line = mainTotalsLine; const homeGoalieSavePct = rawData.advanced_stats.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats.home?.goalie_save_pct_season; const awayGoalieSavePct = rawData.advanced_stats.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats.away?.goalie_save_pct_season;
    const prompt = `You are an Ice Hockey O/U Goals specialist. Analyze potential total goals (focus on goalies, ST) based ONLY on data. DATA: Line: ${line}. Sim Prob (Over ${line}): ${sim.pOver.toFixed(1)}%. xG: H ${sim.mu_h_sim?.toFixed(2) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(2) ?? 'N/A'} (Sum: ${(sim.mu_h_sim + sim.mu_a_sim)?.toFixed(2) ?? 'N/A'}). Goalies (Save %): H: ${rawData.advanced_stats.home?.starting_goalie_name || 'N/A'} (${homeGoalieSavePct ? homeGoalieSavePct + '%' : 'N/A'}). A: ${rawData.advanced_stats.away?.starting_goalie_name || 'N/A'} (${awayGoalieSavePct ? awayGoalieSavePct + '%' : 'N/A'}). Special Teams: H PP(${rawData.advanced_stats.home?.pp_pct?.toFixed(1) || 'N/A'}%) vs A PK(${rawData.advanced_stats.away?.pk_pct?.toFixed(1) || 'N/A'}%); A PP(${rawData.advanced_stats.away?.pp_pct?.toFixed(1) || 'N/A'}%) vs H PK(${rawData.advanced_stats.home?.pk_pct?.toFixed(1) || 'N/A'}%). Form (Venue): H(home): ${rawData.form?.home_home || 'N/A'}. A(away): ${rawData.form?.away_away || 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on O/U ${line}. MUST highlight final conclusion (**Over ${line} gól várható** / **Under ${line} gól a valószínűbb**) & 1-2 key supporting points (**gyenge kapusok (Save%)**, **PP vs PK mismatch**, **kevés gól helyszínen**, **alacsony xG**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Hoki Gól O/U elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    if (!sim || typeof sim.pHome !== 'number' || typeof sim.mu_h_sim !== 'number' || !rawData?.advanced_stats || !rawData.form || !rawData.absentees) {
        console.warn("getHockeyWinnerAnalysis: Hiányos adatok."); return "Adatok hiányosak. Bizalom: Alacsony";
    }
    const homeGoalieSavePct = rawData.advanced_stats.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats.home?.goalie_save_pct_season; const awayGoalieSavePct = rawData.advanced_stats.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats.away?.goalie_save_pct_season; const homeAbsenteesText = rawData.absentees.home?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs'; const awayAbsenteesText = rawData.absentees.away?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs';
    const prompt = `You are an Ice Hockey Match Winner (incl. OT/SO) specialist. Analyze likely winner based ONLY on data. DATA: Sim Probs (Incl. OT): H ${sim.pHome.toFixed(1)}%, A ${sim.pAway.toFixed(1)}%. xG (5v5 Est): H ${sim.mu_h_sim?.toFixed(2) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(2) ?? 'N/A'}. Goalies (Save %): H: ${rawData.advanced_stats.home?.starting_goalie_name || 'N/A'} (${homeGoalieSavePct ? homeGoalieSavePct + '%' : 'N/A'}). A: ${rawData.advanced_stats.away?.starting_goalie_name || 'N/A'} (${awayGoalieSavePct ? awayGoalieSavePct + '%' : 'N/A'}). Special Teams Edge: Analyze H PP(${rawData.advanced_stats.home?.pp_pct?.toFixed(1) || 'N/A'}%) vs A PK(${rawData.advanced_stats.away?.pk_pct?.toFixed(1) || 'N/A'}%) and A PP(${rawData.advanced_stats.away?.pp_pct?.toFixed(1) || 'N/A'}%) vs H PK(${rawData.advanced_stats.home?.pk_pct?.toFixed(1) || 'N/A'}%). Clear advantage? Form (Venue): H(home): ${rawData.form?.home_home || 'N/A'}. A(away): ${rawData.form?.away_away || 'N/A'}. Key Absentees: H: ${homeAbsenteesText}. A: ${awayAbsenteesText}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on Match Winner (incl. OT). MUST highlight final conclusion (**Hazai győzelem (OT-t is bel.)** / **Vendég győzelem (OT-t is bel.)**) & 1-2 key supporting points (**jobb kapus**, **special teams fölény**, **kiemelkedő hazai forma/kulcs hiányzó ellenfélnél**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Hoki Győztes elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    if (!sim || typeof sim.pOver !== 'number' || typeof sim.mu_h_sim !== 'number' || !rawData?.advanced_stats || typeof mainTotalsLine !== 'number' || !rawData.absentees || !rawData.form) {
        console.warn("getBasketballPointsOUAnalysis: Hiányos adatok."); return `Adatok hiányosak (O/U ${mainTotalsLine ?? '?'}). Bizalom: Alacsony`;
    }
    const line = mainTotalsLine; const homeAbsenteesText = rawData.absentees.home?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs'; const awayAbsenteesText = rawData.absentees.away?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs';
    const prompt = `You are a Basketball O/U Total Points specialist. Analyze potential total points (focus on pace, efficiency, absentees, form) based ONLY on data. DATA: Line: ${line}. Sim Prob (Over ${line}): ${sim.pOver.toFixed(1)}%. Est Points: H ${sim.mu_h_sim?.toFixed(1) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(1) ?? 'N/A'} (Total: ${(sim.mu_h_sim + sim.mu_a_sim)?.toFixed(1) ?? 'N/A'}). Pace Est (Avg): ${( (rawData.advanced_stats.home?.pace ?? 98) + (rawData.advanced_stats.away?.pace ?? 98) ) / 2 .toFixed(1)}. Ratings: H Off: ${rawData.advanced_stats.home?.offensive_rating?.toFixed(1) || 'N/A'}, H Def: ${rawData.advanced_stats.home?.defensive_rating?.toFixed(1) || 'N/A'}. A Off: ${rawData.advanced_stats.away?.offensive_rating?.toFixed(1) || 'N/A'}, A Def: ${rawData.advanced_stats.away?.defensive_rating?.toFixed(1) || 'N/A'}. Key Absentees (Scorers?): H: ${homeAbsenteesText}. A: ${awayAbsenteesText}. Form (Venue): H(home): ${rawData.form?.home_home || 'N/A'}. A(away): ${rawData.form?.away_away || 'N/A'}. H2H Sum: ${rawData.h2h_summary || 'N/A'}. STRICT RULES: Concise, one-para Hungarian analysis ONLY on O/U ${line}. MUST highlight final conclusion (**Over ${line} pont várható** / **Under ${line} pont a valószínűbb**) & 1-2 key supporting points (**magas tempó/hatékony támadók**, **erős védelmek/kulcs scorer hiányzik**, **lassú stílus/gyenge H2H pontátlagok**) with **asterisks** (sparingly). Conclude: "Bizalom: [Alacsony/Közepes/Magas]".`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `Kosár Pont O/U elemzési hiba: ${e.message}. Bizalom: Alacsony`; }
}


// --- STRATÉGIAI ÉS ÖSSZEGZŐ FUNKCIÓK ---

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    if (!sim || !rawData || !richContext || marketIntel == null || !microAnalyses) { console.warn("getStrategicClosingThoughts: Hiányos adatok."); return "### Stratégiai Zárógondolatok\nAdatok hiányosak."; }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => { if (!analysis || typeof analysis !== 'string') return null; const concMatch = analysis.match(/\*\*(.*?)\*\*/); const confMatch = analysis.match(/Bizalom:\s*(.*)/i); return `${key.toUpperCase()}: ${concMatch?.[1] ?? 'N/A'} (${confMatch?.[1] ?? 'N/A'})`; }).filter(Boolean).join('; ');
    const prompt = `You are Master Analyst crafting "Stratégiai Zárógondolatok". Provide actionable insights by synthesizing all data. Focus on opportunities AND risks. CRITICAL RULE: Highlight key arguments, markets, names, risks with **asterisks** (judiciously). STRICT RULES: Hungarian only. Start EXACTLY "### Stratégiai Zárógondolatok". 2-3 paragraphs (no bullets). DO NOT give single best bet; discuss angles & risks. DATA: Scenario: "${rawData.propheticScenario || 'N/A'}". Stats: H:${sim.pHome.toFixed(1)}%, D:${sim.pDraw.toFixed(1)}%, A:${sim.pAway.toFixed(1)}%. O/U ${sim.mainTotalsLine}: O:${sim.pOver.toFixed(1)}%. xG: H ${sim.mu_h_sim?.toFixed(2) ?? 'N/A'} - A ${sim.mu_a_sim?.toFixed(2) ?? 'N/A'}. Market: "${marketIntel}". Specialists: "${microSummary || 'Nincsenek'}". Context: ${richContext}. Key Absentees: H: ${rawData.absentees?.home?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}. A: ${rawData.absentees?.away?.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}. Identified Risk: "${riskAssessment || 'N/A'}". TASK: 1. Summarize likely match flow. 2. Discuss **micromodel** findings (confirmation/contradiction/confidence). 3. Identify promising markets from synthesis. 4. Point out **biggest risks** (market moves, **key absentees**, low confidence, contradictions, Identified Risk). Provide balanced insights.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { return `### Stratégiai Zárógondolatok\nStratégiai elemzési hiba: ${e.message}`; }
}


// === ÚJ FUNKCIÓ: Ellentmondás Elemzés ===
export async function _getContradictionAnalysis(sim, expertConfidence, riskAssessment, valueBets, microAnalyses, rawData) {
    if (!sim || !expertConfidence || !riskAssessment || !rawData) { console.warn("_getContradictionAnalysis: Hiányos adatok."); return "Az ellentmondás elemzéséhez adatok hiányosak."; }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => { if (!analysis || typeof analysis !== 'string') return null; const concMatch = analysis.match(/\*\*(.*?)\*\*/); const confMatch = analysis.match(/Bizalom:\s*(.*)/i); return `${key.toUpperCase()}: ${concMatch?.[1] ?? 'N/A'} (${confMatch?.[1] ?? 'N/A'})`; }).filter(Boolean).join('; ');
    const valueBetSummary = valueBets ? JSON.stringify(valueBets.slice(0, 1)) : "Nincs";
    const homeKeyAbsentees = rawData.absentees?.home?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs'; const awayKeyAbsentees = rawData.absentees?.away?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs';
    const prompt = `You are Head Risk Analyst. TASK: Identify MOST SIGNIFICANT CONTRADICTION(S) among data points & suggest weight against stat prediction/value bet. Output: Concise Hungarian text (max 2-3 sentences). DATA POINTS: 1. Sim (Stats): H:${sim.pHome.toFixed(1)}%, D:${sim.pDraw.toFixed(1)}%, A:${sim.pAway.toFixed(1)}%. O/U ${sim.mainTotalsLine}: O:${sim.pOver.toFixed(1)}%. 2. Expert Confidence (Context): "${expertConfidence}". 3. Risk Assessment: "${riskAssessment}". 4. Value Bets: ${valueBetSummary}. 5. Specialists: "${microSummary || 'Nincsenek'}". 6. Key Absentees: H: ${homeKeyAbsentees}. A: ${awayKeyAbsentees}. ANALYSIS: Look for major disagreements (Sim vs Expert/Absentees; Value vs Risk/Market; Sim vs Specialists; Expert vs Risk). Identify *strongest* contradiction. State it & recommend weight ("jelentős ellentmondás, óvatosság indokolt", "kritikus ellentmondás, magas kockázat", "enyhe ellentmondás", "Nincs jelentős ellentmondás"). Hungarian only.`;

    try { return await _callGeminiForSpecificTask(prompt); }
    catch (e) { console.error(`Hiba az ellentmondás elemzés során: ${e.message}`); return "Hiba az ellentmondások elemzésekor."; }
}


// === MÓDOSÍTOTT FUNKCIÓ: Mester Ajánlás ===
export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, finalGeneralAnalysis, strategicClosingThoughts, rawData, contradictionAnalysis) {
    // Input validation
    if (!sim || !expertConfidence || !riskAssessment || !finalGeneralAnalysis || !strategicClosingThoughts || !rawData || !contradictionAnalysis) {
        console.error("getMasterRecommendation: Hiányos kritikus bemeneti adatok.");
        return { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok a végső ajánlás generálásához." };
    }

    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => { if (!analysis || typeof analysis !== 'string') return null; const concMatch = analysis.match(/\*\*(.*?)\*\*/); const confMatch = analysis.match(/Bizalom:\s*(.*)/i); return `${key.toUpperCase()}: ${concMatch?.[1] ?? 'N/A'} (${confMatch?.[1] ?? 'N/A'})`; }).filter(Boolean).join('; ');
    const homeKeyAbsentees = rawData.absentees?.home?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs';
    const awayKeyAbsentees = rawData.absentees?.away?.filter(p => p.importance === 'key').map(p => p.name).join(', ') || 'Nincs';
    // Próbáljuk kinyerni a pontszámot az expert confidence stringből
    const expertConfScoreMatch = expertConfidence.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
    const expertConfScore = expertConfScoreMatch ? parseFloat(expertConfScoreMatch[1]) : 1.0; // Alapértelmezett 1.0, ha nem található

    const prompt = `
        You are the Head Analyst, the final decision-maker.
        Analyze ALL reports, including the Contradiction Analysis, to determine the SINGLE most compelling betting recommendation.
        *** KRITIKUS SZABÁLY: MUST provide a concrete bet. NEVER "No Bet". Use 'final_confidence' to reflect risk. ***

        CRITICAL INPUTS:
        1.  **Value Bets:** ${valueBets ? JSON.stringify(valueBets) : "Nincs"}
        2.  **Simulation:** H:${sim.pHome.toFixed(1)}%, D:${sim.pDraw.toFixed(1)}%, A:${sim.pAway.toFixed(1)}%. O/U ${sim.mainTotalsLine}: O:${sim.pOver.toFixed(1)}%.
        3.  **Model Confidence:** ${modelConfidence.toFixed(1)}/10
        4.  **Expert Confidence:** "${expertConfidence}" (Score: ${expertConfScore}/10)
        5.  **Risk Assessment:** "${riskAssessment}"
        6.  **Key Absentees:** Home: ${homeKeyAbsentees}. Away: ${awayKeyAbsentees}. (CRITICAL!)
        7.  **Specialists:** "${microSummary || 'Nincsenek'}"
        8.  **General Analysis:** "${finalGeneralAnalysis}"
        9.  **Strategic Thoughts:** "${strategicClosingThoughts}"
        10. **Contradiction Analysis:** "${contradictionAnalysis}" (KEY FOR FINAL CONFIDENCE!)

        DECISION PROCESS (Synthesize ALL - ALWAYS TIP):
        - Understand the dominant narrative and the conclusion from the **Contradiction Analysis**.
        - **Value Bet Check:** If a Value Bet exists, evaluate its risk based on Risk Assessment, Expert Confidence Score, Key Absentees, AND the Contradiction Analysis. Recommend ONLY if value is high AND risks are deemed manageable (even if confidence is low). Discard if Contradiction Analysis flags it as critically risky.
        - **If No Safe Value Bet:** Find the outcome most supported by the convergence of Simulation, Expert Confidence, Specialists, General Analysis, and Strategic Thoughts, WHILE heavily considering Key Absentees and the Contradiction Analysis.
        - **Select Best Option:** Choose the most logical market, even if uncertain.
        - **Final Confidence (1.0-10.0):** This MUST heavily reflect the **Contradiction Analysis**, Expert Confidence Score, Risk Assessment, and Key Absentees.
            - If Contradiction Analysis indicates "kritikus ellentmondás" OR ${expertConfScore} < 3.0 OR Risk Assessment has major flags OR Key Absentees strongly oppose the tip -> **Confidence MUST BE LOW (1.0 - 3.5)**.
            - If Contradiction Analysis indicates "jelentős ellentmondás" or "óvatosság indokolt" -> **Confidence should be LOW-MEDIUM (3.0 - 5.5)**.
            - If Contradiction Analysis finds "nincs jelentős ellentmondás" AND other factors align (Expert Score > 5.0) -> **Confidence can be MEDIUM-HIGH (5.5+)**.
        - **Reasoning:** Explain the choice based on synthesis, explicitly mentioning the influence of the Contradiction Analysis or Key Absentees if they significantly impacted the decision or confidence score.

        OUTPUT FORMAT: Single valid JSON object ONLY.
        {
          "recommended_bet": "<Market>",
          "final_confidence": <Number 1.0-10.0 (one decimal)>,
          "brief_reasoning": "<Hungarian sentence explaining choice, confidence, key factors like contradictions/absentees. e.g., 'Bár a statisztika hazait sugall, a kulcs támadó hiánya és a piaci mozgás kritikus ellentmondást jelez, így az Under a legkevésbé kockázatos opció (2.5/10).' OR 'Az adatok többnyire összhangban vannak, a hazai csapat mellett szól a forma és a kevesebb hiányzó, így a Hazai DNB ajánlott (7.0/10).'>"
        }`;

    try {
        const responseText = await _callGeminiForSpecificTask(prompt);
        let jsonString = responseText;
        let recommendation;
        // Robusztusabb JSON parse
        try {
            recommendation = JSON.parse(jsonString);
        } catch (e1) {
            const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                jsonString = codeBlockMatch[1];
                try { recommendation = JSON.parse(jsonString); } catch (e2) { throw new Error(`Nem sikerült JSON-t parse-olni a code blockból sem: ${e2.message}`); }
            } else {
                const firstBrace = jsonString.indexOf('{'); const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                    try { recommendation = JSON.parse(jsonString); } catch (e3) { throw new Error(`Nem sikerült JSON-t parse-olni {} között sem: ${e3.message}`); }
                } else {
                    throw new Error("Nem sikerült érvényes JSON struktúrát találni a Mester Ajánlás válaszban.");
                }
            }
        }

        // Validáljuk a parse-olt objektumot
        if (recommendation?.recommended_bet && typeof recommendation.final_confidence === 'number' && recommendation.brief_reasoning) {
            recommendation.final_confidence = Math.max(1.0, Math.min(10.0, parseFloat(recommendation.final_confidence.toFixed(1))));
            console.log(`Mester Ajánlás: ${recommendation.recommended_bet} (${recommendation.final_confidence}/10)`);
            return recommendation;
        } else {
            console.error(`Érvénytelen JSON struktúra a Mester Ajánlásnál: ${JSON.stringify(recommendation)}`);
            throw new Error("A Mester Ajánlás érvénytelen formátumú választ adott.");
        }
    } catch (e) {
        console.error(`Hiba a Mester Ajánlás generálása során: ${e.message}`);
        // Továbbdobjuk a hibát, hogy az AnalysisFlow kezelje
        throw new Error(`Hiba a Mester Ajánlás generálásakor: ${e.message.substring(0, 150)}`);
    }
}


// --- CHAT FUNKCIÓ (async axios hívással) ---
export async function getChatResponse(context, history, question) {
    if (!context || !question) {
        console.warn("getChatResponse: Hiányzó kontextus vagy kérdés.");
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
Analysis Context (DO NOT repeat, just use): --- ANALYSIS START ---
${context}
--- ANALYSIS END ---
Chat History:
${historyString}
Current User Question: ${question}
Your Task: Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History. If the answer isn't there, say so politely. Stay professional. Keep answers brief.`;

        const requestConfig = createGeminiRequestConfig({ prompt: prompt });
        const response = await axios(requestConfig);
        const answer = parseGeminiResponseData(response);

        return { answer: answer }; // Közvetlenül adjuk vissza az objektumot
    } catch (e) {
        console.error(`Chat hiba: ${e.message}`);
        return { error: `Chat AI hiba: ${e.message}` }; // Hiba objektum visszaadása
    }
}

// === ÚJ FUNKCIÓ: a runFinalCheck-hez (Main.gs-ből) ===
export async function getFinalCheck(sport, home, away, openingOdds) {
    console.log(`Final Check indítva: ${home} vs ${away}`);
    
    // Prompt rekonstruálva a script.js-ben várt válasz alapján
    const prompt = `
        Task: Provide a final "gut check" signal (GREEN, YELLOW, RED) and a brief justification in Hungarian for the ${sport} match: ${home} vs ${away}.
        Consider all factors including late-breaking news, market sentiment (implied from openingOdds), and any subtle red flags not captured by standard stats.
        Opening Odds context: ${JSON.stringify(openingOdds).substring(0, 500)}...
        Provide ONLY a single valid JSON object with "signal" (string) and "justification" (string).
        Example: {"signal": "GREEN", "justification": "Minden jel kedvező, a piac stabil, nincs új sérült."}
        Example: {"signal": "RED", "justification": "Nagy, megmagyarázhatatlan odds-mozgás történt a favorit ellen. Óvatosságra intek."}
    `;
    
    try {
        const responseText = await _callGeminiForSpecificTask(prompt);
        let jsonString = responseText;
        let result;
        // Robusztus JSON parse
        try {
            result = JSON.parse(jsonString);
        } catch (e1) {
            const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                jsonString = codeBlockMatch[1];
                try { result = JSON.parse(jsonString); } catch (e2) { throw new Error(`Invalid JSON in code block: ${e2.message}`); }
            } else {
                const firstBrace = jsonString.indexOf('{'); const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                    try { result = JSON.parse(jsonString); } catch (e3) { throw new Error(`Invalid JSON in {}: ${e3.message}`); }
                } else {
                    throw new Error("Invalid JSON response from FinalCheck AI.");
                }
            }
        }
        // Validáljuk a választ
        if (result && result.signal && result.justification) {
            return result;
        } else {
            throw new Error("Incomplete JSON response from FinalCheck AI (missing signal or justification).");
        }

    } catch (e) {
        console.error(`Hiba a getFinalCheck során (${home} vs ${away}): ${e.message}`);
        return { error: `Final Check AI hiba: ${e.message}` };
    }
}