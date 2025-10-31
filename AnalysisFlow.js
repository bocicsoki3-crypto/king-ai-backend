// /src/AnalysisFlow.js

import { getRichContextualData, _callGemini } from './DataFetch.js';
import { 
    runSimulation, 
    buildPropheticTimeline, 
    calculateModelConfidence, 
    calculateValueBets,
    getMarketIntel,
    analyzeLineMovement // Feltételezve, hogy ez a Model.js-ből jön
} from './Model.js';
import { 
    getTacticalBriefing, 
    getPropheticEvent,
    getPropheticScenario, 
    getExpertConfidence, 
    getRiskAssessment, 
    getFinalGeneralAnalysis, 
    getPlayerMarkets, 
    getBTTSAnalysis, 
    getSoccerGoalsOUAnalysis, 
    getCornerAnalysis, 
    getCardAnalysis, 
    getHockeyGoalsOUAnalysis, 
    getHockeyWinnerAnalysis, 
    getBasketballPointsOUAnalysis, 
    getStrategicClosingThoughts, 
    getMasterRecommendation 
} from './AI_Service.js';
import { saveAnalysisToSheet, getAnalysisFromCache, saveAnalysisToCache } from './sheets.js';
import { log, LogLevel } from './utils/logger.js'; // Feltételezve, hogy van egy logger
import { SPORT_CONFIG } from './config.js';

// === JAVÍTÁS: Importáld az új normalizálókat ===
import { normalizeLeagueName, normalizeTeamName } from './utils/dataNormalizer.js';


/**
 * A teljes elemzési folyamatot vezérli.
 */
export async function runFullAnalysis(params, sport, openingOdds) {
    const { home, away, leagueName, utcKickoff, force, sheetUrl } = params;

    // === JAVÍTÁS: Normalizálási lépés ===
    // Lefordítjuk a frontend neveket API-barát nevekre, MIELŐTT bármit csinálnánk.
    // A kisbetűsítés és trimmelés már a normalizáló függvényekben megtörténik.
    const normalizedParams = {
        home: normalizeTeamName(home),
        away: normalizeTeamName(away),
        leagueName: normalizeLeagueName(leagueName),
        utcKickoff,
        force,
        sheetUrl
    };
    // === JAVÍTÁS VÉGE ===

    const config = SPORT_CONFIG[sport] || SPORT_CONFIG['default'];
    
    // Az elemzés azonosítóját már a normalizált nevekkel generáljuk
    const analysisId = `analysis_${config.version}_${sport}_${normalizedParams.home.toLowerCase().replace(/ /g, '')}_vs_${normalizedParams.away.toLowerCase().replace(/ /g, '')}`;
    log.info(`Elemzés indítása...`);

    // A 'force' paraméter kényszeríti az újraelemzést
    const forceReAnalysis = force === 'true';
    if (forceReAnalysis) {
        log.warn(`Újraelemzés kényszerítve (${analysisId})`);
    }

    try {
        // 1. Gyorsítótár ellenőrzése
        if (!forceReAnalysis) {
            const cachedAnalysis = await getAnalysisFromCache(analysisId);
            if (cachedAnalysis) {
                log.info(`Elemzés (${analysisId}) sikeresen betöltve a cache-ből.`);
                return cachedAnalysis; // Visszaadjuk a cache-elt adatot
            }
        }

        // 2. Adatgyűjtés (Már a normalizált adatokkal)
        log.info(`Adatgyűjtés indul: ${normalizedParams.home} vs ${normalizedParams.away}...`);
        
        // A `getRichContextualData` már a normalizált paramétereket kapja meg
        const richData = await getRichContextualData(
            normalizedParams, 
            sport,
            openingOdds,
            forceReAnalysis // A cache kikerülését is továbbadjuk
        );

        if (!richData || richData.error) {
            const errorMsg = `Adatgyűjtési hiba (${richData?.version || 'N/A'}): ${richData?.error || 'Ismeretlen hiba'}`;
            log.error(errorMsg, new Error(errorMsg));
            throw new Error(errorMsg);
        }
        log.info(`Adatgyűjtés kész (${richData.version}): ${richData.home} vs ${richData.away}.`);

        // 3. Modellezés és Szimuláció
        const mainTotalsLine = richData.mainTotalsLine || config.defaultTotalsLine;
        log.info(`Modellezés indul: ${richData.home} vs ${richData.away}...`);
        const sim = await runSimulation(richData, sport, mainTotalsLine);
        const modelConfidence = calculateModelConfidence(sim, richData.contextual_factors, sport);
        const valueBets = calculateValueBets(sim, richData.odds, config.valueThreshold);
        const propheticTimeline = buildPropheticTimeline(richData, sim, sport);
        const marketIntel = getMarketIntel(richData.odds); // Piaci intelligencia kinyerése
        const lineMovement = analyzeLineMovement(richData.oddsHistory); // Vonalmozgás elemzése
        
        log.info(`Modellezés kész: ${richData.home} vs ${richData.away}.`);

        // 4. AI Bizottság (AI Committee)
        log.info(`AI Bizottság (Kritikus Lánc / Vitázó) indul: ${richData.home} vs ${richData.away}...`);

        // 4a. Kritikus Lánc (Egymásra épülő AI hívások)
        const riskAssessment = await getRiskAssessment(sim, sim.mu_h_sim, sim.mu_a_sim, richData, sport, marketIntel);
        const tacticalBriefing = await getTacticalBriefing(richData, sport, richData.home, richData.away, "N/A", riskAssessment);
        const expertConfidenceObj = await getExpertConfidence(modelConfidence, richData.rich_context, richData); // Objektumot ad vissza: {score, report}
        const propheticEvent = await getPropheticEvent(richData, sport, richData.home, richData.away);
        const propheticScenario = await getPropheticScenario(propheticTimeline, richData, richData.home, richData.away, sport, tacticalBriefing, propheticEvent);
        const generalAnalysis = await getFinalGeneralAnalysis(sim, sim.mu_h_sim, sim.mu_a_sim, tacticalBriefing, propheticScenario, richData, modelConfidence);

        // 4b. Párhuzamos ág (Mikromodellek)
        log.info(`AI Bizottság (Párhuzamos ág) indul...`);
        const microAnalyses = {};
        
        const microModelPromises = [
            getPlayerMarkets(richData.key_players, richData.rich_context, richData).then(r => microAnalyses['player_markets'] = r),
            getBTTSAnalysis(sim, richData).then(r => microAnalyses['btts'] = r),
        ];

        // Sport-specifikus mikromodellek
        if (sport === 'soccer') {
            microModelPromises.push(getSoccerGoalsOUAnalysis(sim, richData, mainTotalsLine).then(r => microAnalyses['goals_ou'] = r));
            microModelPromises.push(getCornerAnalysis(sim, richData).then(r => microAnalyses['corners'] = r));
            microModelPromises.push(getCardAnalysis(sim, richData).then(r => microAnalyses['cards'] = r));
        } else if (sport === 'hockey') {
            microModelPromises.push(getHockeyGoalsOUAnalysis(sim, richData, mainTotalsLine).then(r => microAnalyses['goals_ou'] = r));
            microModelPromises.push(getHockeyWinnerAnalysis(sim, richData).then(r => microAnalyses['winner'] = r));
        } else if (sport === 'basketball') {
            microModelPromises.push(getBasketballPointsOUAnalysis(sim, richData, mainTotalsLine).then(r => microAnalyses['points_ou'] = r));
        }

        await Promise.allSettled(microModelPromises);
        log.info(`AI Bizottság kész: ${richData.home} vs ${richData.away}.`);

        // 5. Stratégiai Összegzés és Mester Ajánlás
        log.info(`Mester Ajánlás kérése indul: ${richData.home} vs ${richData.away}...`);
        const strategicClosingThoughts = await getStrategicClosingThoughts(
            sim, richData, richData.rich_context, marketIntel, microAnalyses, 
            riskAssessment, tacticalBriefing, propheticScenario, valueBets, 
            modelConfidence, expertConfidenceObj // Az objektumot adjuk át
        );
        
        const masterRecommendation = await getMasterRecommendation(
            valueBets, sim, modelConfidence, expertConfidenceObj, // Az objektumot adjuk át
            riskAssessment, microAnalyses, generalAnalysis, 
            strategicClosingThoughts, richData, "N/A"
        );
        log.info(`Mester Ajánlás megkapva: ${masterRecommendation.recommended_bet} (Bizalom: ${masterRecommendation.final_confidence})`);

        // 6. Végeredmény összeállítása
        const finalResult = {
            id: analysisId,
            version: config.version,
            sport: sport,
            home: richData.home,
            away: richData.away,
            league: richData.leagueName,
            utcKickoff: richData.utcKickoff,
            generatedAt: new Date().toISOString(),
            recommendation: masterRecommendation,
            analysis: {
                general_analysis: generalAnalysis,
                risk_assessment: riskAssessment,
                tactical_briefing: tacticalBriefing,
                prophetic_scenario: propheticScenario,
                strategic_thoughts: strategicClosingThoughts
            },
            details: {
                model_confidence: modelConfidence,
                expert_confidence: expertConfidenceObj.report, // Csak a szöveges riport
                simulation: sim,
                value_bets: valueBets,
                market_intel: marketIntel,
                line_movement: lineMovement
            },
            micromodels: microAnalyses,
            raw_data_summary: { // Csak egy kis összefoglaló, nem a teljes adat
                odds: richData.odds,
                h2h: richData.h2h_summary,
                form: richData.form,
                key_players: richData.key_players
            }
        };

        // 7. Mentés Cache-be és Google Sheet-be
        await saveAnalysisToCache(analysisId, finalResult);
        log.info(`Elemzés befejezve és cache mentve (${analysisId})`);
        
        if (sheetUrl) {
            await saveAnalysisToSheet(finalResult, sheetUrl);
            log.info(`Elemzés mentve a Google Sheet-be (${analysisId})`);
        }

        return finalResult;

    } catch (e) {
        log.error(`Súlyos hiba az elemzési folyamatban (${sport} - ${home} vs ${away}): ${e.message}`, e);
        // A hibát is visszaadjuk, hogy a frontend kezelni tudja
        return {
            error: `Elemzési hiba: ${e.message}`
        };
    }
}
