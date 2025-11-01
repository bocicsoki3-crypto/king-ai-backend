import NodeCache from 'node-cache'; // CacheService helyett
import { SPORT_CONFIG } from './config.js';
// Konfiguráció importálása
import { findMainTotalsLine, getRichContextualData } from './DataFetch.js';
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
// --- MÓDOSÍTÁS KEZDETE: Helyes, teljes lista az AI_Service.js exportjaiból ---
import {
    getRiskAssessment,
    getTacticalBriefing,
    getPropheticScenario,
    getAiKeyQuestions, // <<< --- Ez a funkció volt a hiba forrása
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
    getPropheticEvent,
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
* AnalysisFlow.js - Fő Elemzési Munkafolyamat
* VÁLTOZÁS: Import hiba (getAiKeyQuestions, _getContradictionAnalysis) javítva.
* VÁLTOZÁS (v36): A 'runFullAnalysis' logikai sorrendje javítva,
* hogy a 'getRichContextualData' fusson le először és adja vissza
* az 'oddsData'-t, mielőtt azt felhasználnánk.
**************************************************************/

export async function runFullAnalysis(params, sport, openingOdds) {
    let analysisCacheKey = 'unknown_analysis';
    try {
        // Parameter validation and extraction
        const { home: rawHome, away: rawAway, force: forceNewStr, sheetUrl, utcKickoff, leagueName } = params;
        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        const home = String(rawHome).trim();
        const away = String(rawAway).trim();
        const forceNew = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        analysisCacheKey = `analysis_v21_advanced_${sport}_${safeHome}_vs_${safeAway}`;

        // Cache check
        if (!forceNew) {
            const cachedResult = scriptCache.get(analysisCacheKey);
            if (cachedResult) {
                console.log(`Cache találat (${analysisCacheKey})`);
                return cachedResult;
            } else {
                console.log(`Nincs cache (${analysisCacheKey}), friss elemzés indul...`);
            }
        } else {
            console.log(`Újraelemzés kényszerítve (${analysisCacheKey})`);
        }

        // --- *** JAVÍTOTT BLOKK KEZDETE (v36) *** ---
        // A logikai sorrend javítva, hogy az oddsData definiálva legyen.

        // --- 1. Alapkonfiguráció ---
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) {
            throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);
        }

        // --- 2. Fő Adatgyűjtés (Ez adja vissza az oddsData-t IS) ---
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        const { 
            rawStats, 
            richContext, 
            advancedData, 
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData // <-- Az 'oddsData' itt jön létre
        } = await getRichContextualData(sport, home, away, leagueName, utcKickoff);
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);

        // --- 3. Odds és kontextus függő elemzések (Most már biztonságos) ---
        
        // Hozzunk létre egy 'mutableOddsData' változót, hogy a régi hibakezelés működjön
        let mutableOddsData = oddsData; 
        if (!mutableOddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez (API-Football).`);
            // Default üres objektum létrehozása, hogy a kód többi része ne haljon el
            mutableOddsData = { current: [], allMarkets: [], fromCache: false, sport: sport, fullApiData: null }; 
        }

        // Ezek a hívások [cite: 75, 78] most már az 'oddsData' LÉTREHOZÁSA UTÁN vannak:
        const marketIntel = analyzeLineMovement(mutableOddsData, openingOdds, sport, home);
        const mainTotalsLine = findMainTotalsLine(mutableOddsData) || sportConfig.totals_line;
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);

        // A többi elemzés, ami nem függ az oddsData-tól (ezek már helyesen voltak)
        const duelAnalysis = analyzePlayerDuels(rawData?.key_players, sport);
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // --- *** JAVÍTOTT BLOKK VÉGE (v36) *** ---


        // --- 2. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a; sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away); // 'mutableOddsData' használata
        console.log(`Modellezés kész: ${home} vs ${away}.`);

        // --- 3. ÁLTALÁNOS AI BIZOTTSÁG (SZAKÉRTŐI LÁNC) ---
        console.log(`AI Bizottság (Kritikus Lánc / Vitázó) indul: ${home} vs ${away}...`);
        const safeRichContext = typeof richContext === 'string' ? richContext : "Kontextus adatok hiányosak.";
        const richContextWithDuels = `${safeRichContext}\n- **Kulcs Párharc Elemzés:** ${duelAnalysis || 'N/A'}`;
        const propheticTimeline = buildPropheticTimeline(mu_h, mu_a, rawData, sport, home, away);
        const committeeResults = {};

        // LÉPÉS 1: Kockázat
        console.log("Kritikus Lánc 1/6: Kockázatelemzés...");
        try { committeeResults.riskAssessment = await getRiskAssessment(sim, mu_h, mu_a, rawData, sport, marketIntel);
        }
        catch (e) { console.error(`AI Hiba (Risk): ${e.message}`); committeeResults.riskAssessment = "Kockázatelemzés hiba.";
        }

        // LÉPÉS 2: Taktika
        console.log("Kritikus Lánc 2/6: Taktikai Elemzés...");
        try { committeeResults.tacticalBriefing = await getTacticalBriefing(rawData, sport, home, away, duelAnalysis, committeeResults.riskAssessment);
        }
        catch (e) { console.error(`AI Hiba (Tactical): ${e.message}`); committeeResults.tacticalBriefing = "Taktikai elemzés hiba.";
        }

        // LÉPÉS 3: Szakértői Bizalom
        console.log("Kritikus Lánc 3/6: Szakértői Bizalom...");
        try { committeeResults.expertConfidence = await getExpertConfidence(modelConfidence, richContextWithDuels, rawData); }
        catch (e) { console.error(`AI Hiba (ExpertConf): ${e.message}`);
        committeeResults.expertConfidence = "**1.0/10** - Hiba."; }

        // LÉPÉS 4: Párhuzamos Ág (Prophetic Event, Key Questions itt fut)
        console.log("AI Bizottság (Párhuzamos ág) indul...");
        const parallelPromises = {};
        parallelPromises.keyQuestions = getAiKeyQuestions(richContextWithDuels, rawData).catch(e => { console.error(`AI Hiba (Questions): ${e.message}`); return "- Kulcskérdés hiba."; });
        parallelPromises.playerMarkets = getPlayerMarkets(rawData?.key_players, richContextWithDuels, rawData).catch(e => { console.error(`AI Hiba (Player Markets): ${e.message}`); return "Játékospiac hiba."; });
        parallelPromises.propheticEvent = getPropheticEvent(rawData, sport, home, away).catch(e => { console.error(`AI Hiba (PropheticEvent): ${e.message}`); return "Prófétai esemény hiba."; });
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
        // Várjuk meg a párhuzamos ág befejeződését
        const parallelPromiseKeys = ['keyQuestions', 'playerMarkets', 'propheticEvent', 'microResults'];
        const parallelResults = await Promise.all(parallelPromiseKeys.map(key => parallelPromises[key]));
        committeeResults.keyQuestions = parallelResults[parallelPromiseKeys.indexOf('keyQuestions')];
        committeeResults.playerMarkets = parallelResults[parallelPromiseKeys.indexOf('playerMarkets')];
        committeeResults.propheticEvent = parallelResults[parallelPromiseKeys.indexOf('propheticEvent')];

        const microResults = parallelResults[parallelPromiseKeys.indexOf('microResults')];
        const microAnalyses = {};
        const microKeys = Object.keys(microPromises);
        microResults.forEach((result, index) => { microAnalyses[microKeys[index]] = result; });
        committeeResults.microAnalyses = microAnalyses;
        // --- KRITIKUS LÁNC FOLYTATÁSA ---
        // LÉPÉS 5: Szcenárió (Most már megkapja a propheticEvent-et)
        console.log("Kritikus Lánc 4/6: Forgatókönyv...");
        try { committeeResults.propheticScenario = await getPropheticScenario(propheticTimeline, rawData, home, away, sport, committeeResults.tacticalBriefing, committeeResults.propheticEvent);
        }
        catch (e) { console.error(`AI Hiba (Scenario): ${e.message}`); committeeResults.propheticScenario = "Forgatókönyv hiba.";
        }

        // LÉPÉS 6: Általános Elemzés
        console.log("Kritikus Lánc 5/6: Általános Elemzés...");
        try { committeeResults.generalAnalysis = await getFinalGeneralAnalysis(sim, mu_h, mu_a, committeeResults.tacticalBriefing, committeeResults.propheticScenario, rawData, modelConfidence);
        }
        catch (e) { console.error(`AI Hiba (General): ${e.message}`); committeeResults.generalAnalysis = "Ált. elemzés hiba.";
        }

        // LÉPÉS 7: Stratégiai Zárógondolatok
        console.log("Kritikus Lánc 6/6: Stratégiai Zárógondolatok...");
        try { committeeResults.strategicClosingThoughts = await getStrategicClosingThoughts(sim, rawData, richContextWithDuels, marketIntel, committeeResults.microAnalyses, committeeResults.riskAssessment, committeeResults.tacticalBriefing, committeeResults.propheticScenario, valueBets, modelConfidence, committeeResults.expertConfidence);
        }
        catch (e) { console.error(`AI Hiba (Strategic): ${e.message}`); committeeResults.strategicClosingThoughts = "Stratégiai elemzési hiba.";
        }

        // Ellentmondás Elemzés (Kikapcsolva)
        const contradictionAnalysisResult = "Ellentmondás elemzés kikapcsolva.";
        committeeResults.contradictionAnalysis = contradictionAnalysisResult;
        console.log(`AI Bizottság kész: ${home} vs ${away}.`);

        // --- 6. Mester Ajánlás Lekérése ---
        console.log(`Mester Ajánlás kérése indul: ${home} vs ${away}...`);
        const masterRecommendation = await getMasterRecommendation(
            valueBets, sim, modelConfidence, committeeResults.expertConfidence,
            committeeResults.riskAssessment, committeeResults.microAnalyses, committeeResults.generalAnalysis,
            committeeResults.strategicClosingThoughts, rawData, contradictionAnalysisResult
        );
        console.log(`Mester Ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);

        // --- 7. Végső HTML Generálás ---
        console.log(`HTML generálás indul: ${home} vs ${away}...`);
        const finalHtml = buildAnalysisHtml(
            committeeResults,
            { home, away, sport, mainTotalsLine, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, propheticTimeline },
            mutableOddsData, // 'mutableOddsData' használata
            valueBets,
            modelConfidence,
            sim,
            masterRecommendation
   
         );
        console.log(`HTML generálás kész: ${home} vs ${away}.`);
        // --- 8. Válasz Elküldése és Naplózás ---
        const debugInfo = {
             // ... (Debug infók)
             playerDataFetched: rawData?.key_players && (rawData.key_players.home?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A') || rawData.key_players.away?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A')) ?
            `Igen, ${(rawData.key_players.home?.length || 0) + (rawData.key_players.away?.length || 0)} játékosra` : "Nem (vagy nem talált adatot)",
             sportMonksUsedInXG: (sport === 'soccer' && advancedData?.home?.xg != null) ?
            "Igen (valós xG)" : (sport === 'hockey' && rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct != null) ?
            "Igen (HDCF%)" : (sport === 'basketball' && rawData?.advanced_data?.home?.pace != null) ?
            // Javítva a data path-ja
            "Igen (Pace/Rating)" : "Nem (becsült adatok)",
            fromCache_RichContext: rawData?.fromCache ??
            'Ismeretlen'
        };
        const jsonResponse = { html: finalHtml, debugInfo: debugInfo };
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);

        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            saveAnalysisToSheet(params.sheetUrl, {
                sport, home, away, date: new Date(), html: finalHtml, id: analysisCacheKey,
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés mentve 
a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
        }

        return jsonResponse;
    } catch (error) {
        const homeParam = params?.home || 'N/A';
        const awayParam = params?.away || 'N/A';
        const sportParam = sport || params?.sport || 'N/A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}
