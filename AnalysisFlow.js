import NodeCache from 'node-cache'; // CacheService helyett
import { SPORT_CONFIG } from './config.js';
// Konfiguráció importálása
import { getOptimizedOddsData, findMainTotalsLine, getRichContextualData } from './DataFetch.js';
// Adatgyűjtő funkciók
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
// --- MÓDOSÍTÁS KEZDETE ---
// Importáljuk az új 'getPropheticEvent' funkciót az AI Service-ből
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
    getPropheticEvent, // <<< --- EZ AZ ÚJ
    getMasterRecommendation,
    getStrategicClosingThoughts
} from './AI_Service.js';
// --- MÓDOSÍTÁS VÉGE ---
import { saveAnalysisToSheet } from './sheets.js'; // Mentés funkció
import { buildAnalysisHtml } from './htmlBuilder.js';
// HTML építő funkció

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.js - Fő Elemzési Munkafolyamat (V15.1 - Önreflexív Memória 1. Lépés)
* Feladata: A központi elemzési logika Node.js környezetben.
* VÁLTOZÁS: A saveAnalysisToSheet most már megkapja a masterRecommendation
* objektumot, hogy a tipp és a bizalom naplózásra kerülhessen.
* VÁLTOZÁS (Fejlesztési Csomag):
* - Meghívja az új getPropheticEvent AI-t.
* - Átadja a propheticEvent eredményét a getPropheticScenario-nak.
* - Átadja az utcKickoff időt a getRichContextualData-nak.
**************************************************************/

export async function runFullAnalysis(params, sport, openingOdds) {
    let analysisCacheKey = 'unknown_analysis';
    try {
        // --- MÓDOSÍTÁS KEZDETE ---
        // Parameter validation and extraction
        const { home: rawHome, away: rawAway, force: forceNewStr, sheetUrl, utcKickoff, leagueName } = params; // <<< --- utcKickoff és leagueName hozzáadva
        // --- MÓDOSÍTÁS VÉGE ---
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
        let oddsData = await getOptimizedOddsData(home, away, sport, sportConfig, openingOdds, leagueName); // <<< --- leagueName átadva
        if (!oddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez.`);
            oddsData = { current: [], allMarkets: [], fromCache: false, sport: sport };
            // Dummy object
        }

        const marketIntel = analyzeLineMovement(oddsData, openingOdds, sport, home);
        // Model.js-ből importálva
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        // --- MÓDOSÍTÁS: A 'utcKickoff' és 'leagueName' átadása a DataFetch-nek ---
        const { rawStats, richContext, advancedData, form, rawData, leagueAverages = {} } = await getRichContextualData(sport, home, away, leagueName, utcKickoff); // <<< --- leagueName, utcKickoff hozzáadva
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        if (!rawStats || !rawStats.home || typeof rawStats.home.gp !== 'number') {
            throw new Error("Kritikus csapat statisztikák (rawStats) lekérése sikertelen vagy hiányos.");
        }

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players, sport);
        // Model.js-ből importálva
        const psyProfileHome = calculatePsychologicalProfile(home, away);
        // Model.js-ből importálva
        const psyProfileAway = calculatePsychologicalProfile(away, home);
        // Model.js-ből importálva
        const mainTotalsLine = findMainTotalsLine(oddsData) || sportConfig.totals_line;
        // DataFetch.js-ből importálva
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);

        // --- 2. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        // === IDŐLIMIT JAVÍTÁS: Szimulációk számának csökkentése ===
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        // Csökkentve 25000-re
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a; sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        // marketIntel átadása a calculateModelConfidence-nek
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, oddsData, sport, home, away); // Model.js-ből importálva
        console.log(`Modellezés kész: ${home} vs ${away}.`);

        // --- 3. ÁLTALÁNOS AI BIZOTTSÁG (SZAKÉRTŐI LÁNC) ---
        // === MÓDOSÍTÁS: "Vitázó Bizottság" Lánc + Új Prophetic Event ===
        
        console.log(`AI Bizottság (Kritikus Lánc / Vitázó) indul: ${home} vs ${away}...`);
        const safeRichContext = typeof richContext === 'string' ? richContext : "Kontextus adatok hiányosak.";
        const richContextWithDuels = `${safeRichContext}\n- **Kulcs Párharc Elemzés:** ${duelAnalysis || 'N/A'}`;
        const propheticTimeline = buildPropheticTimeline(mu_h, mu_a, rawData, sport, home, away);
        const committeeResults = {};

        // LÉPÉS 1: Kockázat (Ez fut először, egyedül)
        console.log("Kritikus Lánc 1/6: Kockázatelemzés...");
        try {
            committeeResults.riskAssessment = await getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel);
        } catch (e) {
            console.error(`AI Hiba (Risk): ${e.message}`);
            committeeResults.riskAssessment = "Kockázatelemzés hiba."; 
        }

        // LÉPÉS 2: Taktika (Megkapja a Kockázat eredményét)
        console.log("Kritikus Lánc 2/6: Taktikai Elemzés...");
        try {
            committeeResults.tacticalBriefing = await getTacticalBriefing(rawData, sport, home, away, duelAnalysis, committeeResults.riskAssessment);
        } catch (e) {
            console.error(`AI Hiba (Tactical): ${e.message}`);
            committeeResults.tacticalBriefing = "Taktikai elemzés hiba."; 
        }

        // LÉPÉS 3: Szcenárió (EZT ÁTHELYEZZÜK A PÁRHUZAMOS ÁG UTÁNRA, MERT SZÜKSÉGE VAN A PROPHETIC EVENTRE)
        
        // LÉPÉS 4 (Korábban 4): Szakértői Bizalom (A lánc része a stabilitásért)
        console.log("Kritikus Lánc 3/6: Szakértői Bizalom..."); // Sorszám javítva
        try {
            committeeResults.expertConfidence = await getExpertConfidence(modelConfidence, richContextWithDuels, rawData);
        } catch (e) {
             console.error(`AI Hiba (ExpertConf): ${e.message}`);
             committeeResults.expertConfidence = "**1.0/10** - Hiba."; // A fallback marad!
        }

        // LÉPÉS 5: Általános Elemzés (EZT IS ÁTHELYEZZÜK A SZCENÁRIÓ UTÁNRA)
        
        // LÉPÉS 6 (Korábban 6): Párhuzamos Ág (Bővítve)
        console.log("AI Bizottság (Párhuzamos ág) indul...");
        const parallelPromises = {};

        // Kulcskérdések
        parallelPromises.keyQuestions = getAiKeyQuestions(richContextWithDuels, rawData)
            .catch(e => { console.error(`AI Hiba (Questions): ${e.message}`); return "- Kulcskérdés hiba."; });
        // Játékos piacok
        parallelPromises.playerMarkets = getPlayerMarkets(rawData?.key_players, richContextWithDuels, rawData)
            .catch(e => { console.error(`AI Hiba (Player Markets): ${e.message}`); return "Játékospiac hiba."; });

        // --- ÚJ: Prófétai Pillanatkép (Párhuzamosan) ---
        parallelPromises.propheticEvent = getPropheticEvent(rawData, sport, home, away) // home, away átadva
            .catch(e => { console.error(`AI Hiba (PropheticEvent): ${e.message}`); return "Prófétai esemény hiba."; });

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
        
        parallelPromises.microResults = Promise.all(Object.values(microPromises));
        // Várjuk meg a teljes párhuzamos ág befejeződését
        // A Promise.all sorrendje fontos!
        const parallelPromiseKeys = ['keyQuestions', 'playerMarkets', 'propheticEvent', 'microResults'];
        const parallelResults = await Promise.all(parallelPromiseKeys.map(key => parallelPromises[key]));
        
        // Eredmények összegyűjtése a párhuzamos ágból a kulcsok alapján
        committeeResults.keyQuestions = parallelResults[parallelPromiseKeys.indexOf('keyQuestions')];
        committeeResults.playerMarkets = parallelResults[parallelPromiseKeys.indexOf('playerMarkets')];
        committeeResults.propheticEvent = parallelResults[parallelPromiseKeys.indexOf('propheticEvent')]; // <<< --- ÚJ EREDMÉNY MENTÉSE
        
        // MicroAnalyses objektum újraépítése (marad)
        const microResults = parallelResults[parallelPromiseKeys.indexOf('microResults')];
        const microAnalyses = {};
        const microKeys = Object.keys(microPromises);
        microResults.forEach((result, index) => {
            microAnalyses[microKeys[index]] = result;
        });
        committeeResults.microAnalyses = microAnalyses;
        
        // --- KRITIKUS LÁNC FOLYTATÁSA (A PÁRHUZAMOS ÁG EREDMÉNYEIVEL) ---

        // LÉPÉS 3 (Most fut, korábban 3): Szcenárió (Megkapja a Taktikát és az ÚJ Prófétai Eseményt)
        console.log("Kritikus Lánc 4/6: Forgatókönyv..."); // Sorszám javítva
        try {
            committeeResults.propheticScenario = await getPropheticScenario(
                propheticTimeline, rawData, home, away, sport, 
                committeeResults.tacticalBriefing, 
                committeeResults.propheticEvent // <<< --- ÚJ PARAMÉTER ÁTADVA
            );
        } catch (e) {
            console.error(`AI Hiba (Scenario): ${e.message}`);
            committeeResults.propheticScenario = "Forgatókönyv hiba."; 
        }

        // LÉPÉS 5 (Most fut, korábban 5): Általános Elemzés (Megkapja a Taktikát és a Szcenáriót)
        console.log("Kritikus Lánc 5/6: Általános Elemzés..."); // Sorszám javítva
        try {
            committeeResults.generalAnalysis = await getFinalGeneralAnalysis(sim, mu_h, mu_a, committeeResults.tacticalBriefing, committeeResults.propheticScenario, rawData);
        } catch (e) {
            console.error(`AI Hiba (General): ${e.message}`);
            committeeResults.generalAnalysis = "Ált. elemzés hiba.";
        }

        // LÉPÉS 7 (Korábban 5): Stratégiai Zárógondolatok (A LÁNC VÉGÉN) ---
        // Ez már minden adatot felhasznál (lánc + párhuzamos)
        console.log("Kritikus Lánc 6/6: Stratégiai Zárógondolatok..."); // Sorszám javítva
        try {
            committeeResults.strategicClosingThoughts = await getStrategicClosingThoughts(
                sim, rawData, richContextWithDuels, marketIntel, 
                committeeResults.microAnalyses, 
                committeeResults.riskAssessment, 
                committeeResults.tacticalBriefing, 
                committeeResults.propheticScenario
            );
        } catch (e) {
            console.error(`AI Hiba (Strategic): ${e.message}`);
            committeeResults.strategicClosingThoughts = "### Stratégiai Zárógondolatok\nStratégiai elemzési hiba.";
        }


        // === IDŐLIMIT JAVÍTÁS: Ellentmondás Elemzés Kikapcsolva ===
        const contradictionAnalysisResult = "Ellentmondás elemzés kikapcsolva (időlimit).";
        // Placeholder
        committeeResults.contradictionAnalysis = contradictionAnalysisResult;


        console.log(`AI Bizottság kész: ${home} vs ${away}.`);
        // --- 6. Mester Ajánlás Lekérése ---
        // (A hívás változatlan, de a benne lévő 'getMasterRecommendation' már az új, kalibrációs logikát használja!)
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
            playerDataFetched: rawData?.key_players && (rawData.key_players.home?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A') || rawData.key_players.away?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A')) ? // Módosított ellenőrzés
            `Igen, ${(rawData.key_players.home?.length || 0) + (rawData.key_players.away?.length || 0)} játékosra` : "Nem (vagy nem talált adatot)",
            sportMonksUsedInXG: (sport === 'soccer' && advancedData?.home?.xg != null) ?
            "Igen (valós xG)" : (sport === 'hockey' && rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct != null) ? // Új ellenőrzés
            "Igen (HDCF%)" : (sport === 'basketball' && advancedData?.home?.pace != null) ?
            "Igen (Pace/Rating)" : "Nem (becsült adatok)",
            fromCache_RichContext: rawData?.fromCache ??
            'Ismeretlen'
        };
        const jsonResponse = { html: finalHtml, debugInfo: debugInfo };
        // Mentés a NodeCache-be
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        
        // === MÓDOSÍTÁS: A masterRecommendation átadása a mentéshez ===
        if (params.sheetUrl && typeof params.sheetUrl === 'string') { // Használjuk a params-ból az URL-t
            saveAnalysisToSheet(params.sheetUrl, { 
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: finalHtml, 
                id: analysisCacheKey,
                recommendation: masterRecommendation // <-- EZ AZ ÚJ SOR
            })
                .then(() => console.log(`Elemzés mentve a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
        }
        // === MÓDOSÍTÁS VÉGE ===

        return jsonResponse;
        // Visszaadjuk a kész objektumot

    } catch (error) {
        const homeParam = params?.home || 'N/A';
        const awayParam = params?.away || 'N/A';
        const sportParam = sport || params?.sport || 'N/A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        // Hiba objektumot adunk vissza
        return { error: `Elemzési hiba: ${error.message}` };
    }
}