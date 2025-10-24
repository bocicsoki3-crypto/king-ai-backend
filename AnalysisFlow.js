import NodeCache from 'node-cache'; // CacheService helyett
import { SPORT_CONFIG } from './config.js'; // Konfiguráció importálása
import { getOptimizedOddsData, findMainTotalsLine, getRichContextualData } from './DataFetch.js'; // Adatgyűjtő funkciók
import { 
    estimateXG, 
    estimateAdvancedMetrics, 
    simulateMatchProgress, 
    calculateModelConfidence, 
    buildPropheticTimeline, 
    calculatePsychologicalProfile, 
    calculateValue, 
    analyzeLineMovement, 
    analyzePlayerDuels 
} from './Model.js';
import { 
    getRiskAssessment, 
    getTacticalBriefing, 
    getPropheticScenario, 
    getAiKeyQuestions, 
    getPlayerMarkets, 
    getFinalGeneralAnalysis, 
    getExpertConfidence, 
    getBTTSAnalysis, 
    getSoccerGoalsOUAnalysis, 
    getCornerAnalysis, 
    getCardAnalysis, 
    getHockeyGoalsOUAnalysis, 
    getHockeyWinnerAnalysis, 
    getBasketballPointsOUAnalysis, 
    _getContradictionAnalysis, 
    getMasterRecommendation,
    getStrategicClosingThoughts // <<< --- EZ A SOR LETT HOZZÁADVA (JAVÍTÁS)
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; // Mentés funkció
import { buildAnalysisHtml } from './htmlBuilder.js'; // HTML építő funkció

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.js - Fő Elemzési Munkafolyamat (V14.1 - VÉGLEGES STABILITÁS JAVÍTÁS)
* Feladata: A központi elemzési logika Node.js környezetben.
* VÁLTOZÁS: Az 'expertConfidence' (Szakértői Bizalom) áthelyezve
* a párhuzamos ágból a szekvenciális "kritikus láncba",
* hogy garantáltan lefusson és elkerülje a rate limit hibát.
**************************************************************/

export async function runFullAnalysis(params, sport, openingOdds) {
    let analysisCacheKey = 'unknown_analysis';
    try {
        // Parameter validation and extraction
        const { home: rawHome, away: rawAway, force: forceNewStr, sheetUrl } = params;
        if (!rawHome || !rawAway || !sport) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport'.");
        }
        const home = String(rawHome).trim();
        const away = String(rawAway).trim();
        const forceNew = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        analysisCacheKey = `analysis_v21_advanced_${sport}_${safeHome}_vs_${safeAway}`;

        // Cache check (node-cache használatával)
        if (!forceNew) {
            const cachedResult = scriptCache.get(analysisCacheKey);
            if (cachedResult) {
                console.log(`Cache találat (${analysisCacheKey})`);
                return cachedResult; // Visszaadjuk a cache-elt objektumot
            } else {
                console.log(`Nincs cache (${analysisCacheKey}), friss elemzés indul...`);
            }
        } else {
            console.log(`Újraelemzés kényszerítve (${analysisCacheKey})`);
        }

        // --- 1. Adatgyűjtés ---
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) {
            throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);
        }
        let oddsData = await getOptimizedOddsData(home, away, sport, sportConfig, openingOdds);
        if (!oddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez.`);
            oddsData = { current: [], allMarkets: [], fromCache: false, sport: sport }; // Dummy object
        }

        const marketIntel = analyzeLineMovement(oddsData, openingOdds, sport, home); // Model.js-ből importálva
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        const { rawStats, richContext, advancedData, form, rawData, leagueAverages = {} } = await getRichContextualData(sport, home, away);
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        if (!rawStats || !rawStats.home || typeof rawStats.home.gp !== 'number') {
            throw new Error("Kritikus csapat statisztikák (rawStats) lekérése sikertelen vagy hiányos.");
        }

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players, sport); // Model.js-ből importálva
        const psyProfileHome = calculatePsychologicalProfile(home, away); // Model.js-ből importálva
        const psyProfileAway = calculatePsychologicalProfile(away, home); // Model.js-ből importálva
        const mainTotalsLine = findMainTotalsLine(oddsData) || sportConfig.totals_line; // DataFetch.js-ből importálva
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);
        // --- 2. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        // === IDŐLIMIT JAVÍTÁS: Szimulációk számának csökkentése ===
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData); // Csökkentve 25000-re
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a; sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        // marketIntel átadása a calculateModelConfidence-nek
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        
        const valueBets = calculateValue(sim, oddsData, sport, home, away); // Model.js-ből importálva
        console.log(`Modellezés kész: ${home} vs ${away}.`);
        
        // --- 3. ÁLTALÁNOS AI BIZOTTSÁG (SZAKÉRTŐI LÁNC) ---
        // === MÓDOSÍTÁS: A "Kritikus Lánc" bővítése ===
        
        console.log(`AI Bizottság (Kritikus Lánc) indul: ${home} vs ${away}...`);
        const safeRichContext = typeof richContext === 'string' ? richContext : "Kontextus adatok hiányosak.";
        const richContextWithDuels = `${safeRichContext}\n- **Kulcs Párharc Elemzés:** ${duelAnalysis || 'N/A'}`;
        const propheticTimeline = buildPropheticTimeline(mu_h, mu_a, rawData, sport, home, away);
        
        const committeeResults = {};

        // LÉPÉS 1: Kockázat (Ez fut először, egyedül)
        try {
            committeeResults.riskAssessment = await getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel);
        } catch (e) {
            console.error(`AI Hiba (Risk): ${e.message}`); 
            committeeResults.riskAssessment = "Kockázatelemzés hiba."; 
        }

        // LÉPÉS 2: Taktika
        try {
            committeeResults.tacticalBriefing = await getTacticalBriefing(rawData, sport, home, away, duelAnalysis, committeeResults.riskAssessment);
        } catch (e) {
            console.error(`AI Hiba (Tactical): ${e.message}`); 
            committeeResults.tacticalBriefing = "Taktikai elemzés hiba."; 
        }

        // LÉPÉS 3: Szcenárió
        try {
            committeeResults.propheticScenario = await getPropheticScenario(propheticTimeline, rawData, home, away, sport);
        } catch (e) {
            console.error(`AI Hiba (Scenario): ${e.message}`); 
            committeeResults.propheticScenario = "Forgatókönyv hiba."; 
        }
        
        // LÉPÉS 4: Szakértői Bizalom (MÓDOSÍTÁS: ÁTHELYEZVE IDE)
        // Ezt a hívást kivettük a párhuzamos ágból, hogy garantáltan lefusson.
        console.log("AI Bizottság (Kritikus Lánc): Szakértői Bizalom lekérése...");
        try {
            committeeResults.expertConfidence = await getExpertConfidence(modelConfidence, richContextWithDuels, rawData);
        } catch (e) {
             console.error(`AI Hiba (ExpertConf): ${e.message}`); 
             committeeResults.expertConfidence = "**1.0/10** - Hiba."; // A fallback marad!
        }

        // LÉPÉS 5: Párhuzamos Ág (A maradék)
        console.log("AI Bizottság (Párhuzamos ág) indul...");
        const parallelPromises = {};

        // Kulcskérdések
        parallelPromises.keyQuestions = getAiKeyQuestions(richContextWithDuels, rawData)
            .catch(e => { console.error(`AI Hiba (Questions): ${e.message}`); return "- Kulcskérdés hiba."; });
        
        // Játékos piacok
        parallelPromises.playerMarkets = getPlayerMarkets(rawData?.key_players, richContextWithDuels, rawData)
            .catch(e => { console.error(`AI Hiba (Player Markets): ${e.message}`); return "Játékospiac hiba."; });

        // Piac-specifikus mikromodellek párhuzamosítása
        const microPromises = {};
        if (sport === 'soccer') {
            microPromises.btts = getBTTSAnalysis(sim, rawData).catch(e => `BTTS hiba: ${e.message}`);
            microPromises.goalsOU = getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine).catch(e => `Gól O/U hiba: ${e.message}`);
            microPromises.corners = getCornerAnalysis(sim, rawData).catch(e => `Szöglet hiba: ${e.message}`);
            microPromises.cards = getCardAnalysis(sim, rawData).catch(e => `Lapok hiba: ${e.message}`);
        } else if (sport === 'hockey') {
            microPromises.goalsOU = getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine).catch(e => `Hoki O/U hiba: ${e.message}`);
            microPromises.winner = getHockeyWinnerAnalysis(sim, rawData).catch(e => `Hoki Győztes hiba: ${e.message}`);
        } else if (sport === 'basketball') {
            microPromises.pointsOU = getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine).catch(e => `Kosár Pont O/U hiba: ${e.message}`);
        }
        
        // Hozzáadjuk a mikromodellek ígéretét a párhuzamos hívásokhoz
        parallelPromises.microResults = Promise.all(Object.values(microPromises));

        // Várjuk meg a teljes párhuzamos ág befejeződését
        // MÓDOSÍTÁS: expertConfidenceResult eltávolítva innen
        const [
            keyQuestionsResult, 
            playerMarketsResult, 
            microResults
        ] = await Promise.all(Object.values(parallelPromises));

        // Eredmények összegyűjtése a párhuzamos ágból
        committeeResults.keyQuestions = keyQuestionsResult;
        committeeResults.playerMarkets = playerMarketsResult;

        // MicroAnalyses objektum újraépítése a nevekkel
        const microAnalyses = {};
        const microKeys = Object.keys(microPromises);
        microResults.forEach((result, index) => {
            microAnalyses[microKeys[index]] = result;
        });
        committeeResults.microAnalyses = microAnalyses;
        // === MÓDOSÍTÁS VÉGE ===

        // Most már futtathatjuk a General Analysist (mivel megvan a tactical és a scenario)
        try {
            committeeResults.generalAnalysis = await getFinalGeneralAnalysis(sim, mu_h, mu_a, committeeResults.tacticalBriefing, committeeResults.propheticScenario, rawData);
        } catch (e) {
            console.error(`AI Hiba (General): ${e.message}`);
            committeeResults.generalAnalysis = "Ált. elemzés hiba.";
        }

        // --- 5. STRATÉGIAI ZÁRÓGONDOLATOK ---
        try {
            committeeResults.strategicClosingThoughts = await getStrategicClosingThoughts(sim, rawData, richContextWithDuels, marketIntel, committeeResults.microAnalyses, committeeResults.riskAssessment);
        } catch (e) {
            console.error(`AI Hiba (Strategic): ${e.message}`);
            committeeResults.strategicClosingThoughts = "### Stratégiai Zárógondolatok\nStratégiai elemzési hiba.";
        }


        // === IDŐLIMIT JAVÍTÁS: Ellentmondás Elemzés Kikapcsolva ===
        const contradictionAnalysisResult = "Ellentmondás elemzés kikapcsolva (időlimit)."; // Placeholder
        committeeResults.contradictionAnalysis = contradictionAnalysisResult;


        console.log(`AI Bizottság kész: ${home} vs ${away}.`);
        // --- 6. Mester Ajánlás Lekérése ---
        console.log(`Mester Ajánlás kérése indul: ${home} vs ${away}...`);
        const masterRecommendation = await getMasterRecommendation(
            valueBets, sim, modelConfidence, committeeResults.expertConfidence,
            committeeResults.riskAssessment, committeeResults.microAnalyses, committeeResults.generalAnalysis,
            committeeResults.strategicClosingThoughts, rawData, contradictionAnalysisResult // Placeholder átadva
        );
        console.log(`Mester Ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);

        // --- 7. Végső HTML Generálás ---
        console.log(`HTML generálás indul: ${home} vs ${away}...`);
        const finalHtml = buildAnalysisHtml(
            committeeResults,
            { home, away, sport, mainTotalsLine, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, propheticTimeline },
            oddsData,
            valueBets,
            modelConfidence,
            sim,
            masterRecommendation
   
         );
        console.log(`HTML generálás kész: ${home} vs ${away}.`);
        // --- 8. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataFetched: rawData?.key_players && (rawData.key_players.home?.some(p => p.stats && Object.keys(p.stats).length > 0) || rawData.key_players.away?.some(p => p.stats && Object.keys(p.stats).length > 0)) ?
                `Igen, ${(rawData.key_players.home?.length || 0) + (rawData.key_players.away?.length || 0)} játékosra` : "Nem (vagy nem talált adatot)",
            sportMonksUsedInXG: (sport === 'soccer' && advancedData?.home?.xg != null) ?
                "Igen (valós xG)" : (sport === 'hockey' && advancedData?.home?.pp_pct != null) ?
                "Igen (PP/PK)" : (sport === 'basketball' && advancedData?.home?.pace != null) ?
                "Igen (Pace/Rating)" : "Nem (becsült adatok)",
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        const jsonResponse = { html: finalHtml, debugInfo: debugInfo };
        // Mentés a NodeCache-be
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        // Mentés Google Sheet-be (async módon, nem várjuk meg)
        if (params.sheetUrl && typeof params.sheetUrl === 'string') { // Használjuk a params-ból az URL-t
            saveAnalysisToSheet(params.sheetUrl, { sport, home, away, date: new Date(), html: finalHtml, id: analysisCacheKey })
                .then(() => console.log(`Elemzés mentve a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor 
(${analysisCacheKey}): ${sheetError.message}`));
        }

        return jsonResponse; // Visszaadjuk a kész objektumot

    } catch (error) {
        const homeParam = params?.home || 'N/A';
        const awayParam = params?.away || 'N/A';
        const sportParam = sport || params?.sport || 'N/A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        // Hiba objektumot adunk vissza
        return { error: `Elemzési hiba: ${error.message}` };
    }
}