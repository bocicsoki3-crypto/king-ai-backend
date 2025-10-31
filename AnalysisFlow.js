// /src/AnalysisFlow.js

import { getRichContextualData, _callGemini } from './DataFetch.js';
import { 
    simulateMatchProgress,
    estimateXG,
    estimateAdvancedMetrics,
    buildPropheticTimeline, 
    calculateModelConfidence, 
    calculateValue,
    analyzeLineMovement
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
import { saveAnalysisToSheet } from './sheets.js';
import { SPORT_CONFIG } from './config.js';

// === JAVÍTÁS: 'normalizeLeague'-t importálunk 'normalizeLeagueName' helyett ===
import { normalizeLeague, normalizeTeamName } from './utils/dataNormalizer.js';


/**
 * A teljes elemzési folyamatot vezérli.
 */
export async function runFullAnalysis(params, sport, openingOdds) {
    // 1. Paraméterek és normalizálás
    const { home, away, leagueName, utcKickoff, force, sheetUrl } = params;

    // === JAVÍTÁS: Az új normalizálási logika ===
    const normalizedHome = normalizeTeamName(home);
    const normalizedAway = normalizeTeamName(away);

    // Az új függvény egy objektumot ad vissza: { officialName, country }
    const leagueInfo = normalizeLeague(leagueName);
    const normalizedLeagueName = leagueInfo.officialName;
    const normalizedCountry = leagueInfo.country; // Ez a kulcsfontosságú új adat!
    // === JAVÍTÁS VÉGE ===

    const config = SPORT_CONFIG[sport] || SPORT_CONFIG['default'];
    
    const analysisId = `analysis_${config.version}_${sport}_${normalizedHome.toLowerCase().replace(/ /g, '')}_vs_${normalizedAway.toLowerCase().replace(/ /g, '')}`;
    console.log(`Elemzés indítása...`);

    const forceReAnalysis = force === 'true';
    if (forceReAnalysis) {
        console.warn(`Újraelemzés kényszerítve (${analysisId})`);
    }

    try {
        // Gyorsítótár-kezelés (getAnalysisFromCache) már ki van kapcsolva

        // 2. Adatgyűjtés
        console.log(`Adatgyűjtés indul: ${normalizedHome} vs ${normalizedAway}...`);
        
        // === JAVÍTÁS: Az új 'normalizedCountry' argumentum hozzáadása ===
        // Most már átadjuk az országot is, hogy az API-provider
        // fel tudja oldani a "Serie B" kétértelműséget.
        const richData = await getRichContextualData(
            sport,
            normalizedHome,
            normalizedAway,
            normalizedLeagueName,
            normalizedCountry, // <-- AZ ÚJ, MEGOLDÁST JELENTŐ PARAMÉTER
            utcKickoff,
            openingOdds,
            forceReAnalysis
        );
        // === JAVÍTÁS VÉGE ===

        if (!richData || richData.error) {
            const errorMsg = `Adatgyűjtési hiba (${richData?.version || 'N/A'}): ${richData?.error || 'Ismeretlen hiba'}`;
            console.error(errorMsg, new Error(errorMsg));
            throw new Error(errorMsg);
        }
        console.log(`Adatgyűjtés kész (${richData.version}): ${richData.home} vs ${richData.away}.`);

        // 3. Modellezés és Szimuláció
        console.log(`Modellezés indul: ${richData.home} vs ${richData.away}...`);
        const mainTotalsLine = richData.mainTotalsLine || config.defaultTotalsLine;
        
        const psyProfileHome = calculatePsychologicalProfile(richData.home, richData.away, richData);
        const psyProfileAway = calculatePsychologicalProfile(richData.away, richData.home, richData);

        const { mu_h, mu_a } = estimateXG(
            richData.home, 
            richData.away,
            richData.stats, 
            sport, 
            richData.form, 
            richData.league_averages,
            richData.advancedData, 
            richData, 
            psyProfileHome,
            psyProfileAway,
            null
        );
        
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(
            richData, 
            sport, 
            richData.league_averages
        );

        const sim = await simulateMatchProgress(
            mu_h,
            mu_a,
            mu_corners,
            mu_cards,
            config.simulations || 10000,
            sport,
            null, 
            mainTotalsLine,
            richData
        );
        
        const marketIntel = "N/A";

        const modelConfidence = calculateModelConfidence(
            sport, 
            richData.home, 
            richData.away, 
            richData, 
            richData.form, 
            sim, 
            marketIntel
        );

        const valueBets = calculateValue(
            sim, 
            richData.odds, 
            sport, 
            richData.home, 
            richData.away
        );

        const propheticTimeline = buildPropheticTimeline(
            mu_h, 
            mu_a,
            richData, 
            sport, 
            richData.home, 
            richData.away
        );
        
        const lineMovement = analyzeLineMovement(
            richData.odds, 
            openingOdds, 
            sport, 
            richData.home
        );
        
        console.log(`Modellezés kész: ${richData.home} vs ${richData.away}.`);

        // 4. AI Bizottság (AI Committee)
        console.log(`AI Bizottság (Kritikus Lánc / Vitázó) indul: ${richData.home} vs ${richData.away}...`);

        // 4a. Kritikus Lánc
        const riskAssessment = await getRiskAssessment(sim, sim.mu_h_sim, sim.mu_a_sim, richData, sport, marketIntel);
        const tacticalBriefing = await getTacticalBriefing(richData, sport, richData.home, richData.away, "N/A", riskAssessment);
        const expertConfidenceObj = await getExpertConfidence(modelConfidence, richData.rich_context, richData);
        const propheticEvent = await getPropheticEvent(richData, sport, richData.home, richData.away);
        const propheticScenario = await getPropheticScenario(propheticTimeline, richData, richData.home, richData.away, sport, tacticalBriefing, propheticEvent);
        const generalAnalysis = await getFinalGeneralAnalysis(sim, sim.mu_h_sim, sim.mu_a_sim, tacticalBriefing, propheticScenario, richData, modelConfidence);

        // 4b. Párhuzamos ág (Mikromodellek)
        console.log(`AI Bizottság (Párhuzamos ág) indul...`);
        const microAnalyses = {};
        
        const microModelPromises = [
            getPlayerMarkets(richData.key_players, richData.rich_context, richData).then(r => microAnalyses['player_markets'] = r),
            getBTTSAnalysis(sim, richData).then(r => microAnalyses['btts'] = r),
        ];

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
        console.log(`AI Bizottság kész: ${richData.home} vs ${richData.away}.`);

        // 5. Stratégiai Összegzés és Mester Ajánlás
        console.log(`Mester Ajánlás kérése indul: ${richData.home} vs ${richData.away}...`);
        const strategicClosingThoughts = await getStrategicClosingThoughts(
            sim, richData, richData.rich_context, marketIntel, microAnalyses, 
            riskAssessment, tacticalBriefing, propheticScenario, valueBets, 
            modelConfidence, expertConfidenceObj
        );
        
        const masterRecommendation = await getMasterRecommendation(
            valueBets, sim, modelConfidence, expertConfidenceObj, 
            riskAssessment, microAnalyses, generalAnalysis, 
            strategicClosingThoughts, richData, "N/A"
        );
        console.log(`Mester Ajánlás megkapva: ${masterRecommendation.recommended_bet} (Bizalom: ${masterRecommendation.final_confidence})`);

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
                expert_confidence: expertConfidenceObj.report,
                simulation: sim,
                value_bets: valueBets,
                market_intel: marketIntel,
                line_movement: lineMovement
            },
            micromodels: microAnalyses,
            raw_data_summary: {
                odds: richData.odds,
                h2h: richData.h2h_summary,
                form: richData.form,
                key_players: richData.key_players
            }
        };

        // 7. Mentés Google Sheet-be (Cache-elés ki van kapcsolva)
        if (sheetUrl) {
            await saveAnalysisToSheet(finalResult, sheetUrl);
            console.log(`Elemzés mentve a Google Sheet-be (${analysisId})`);
        }

        return finalResult;

    } catch (e) {
        console.error(`Súlyos hiba az elemzési folyamatban (${sport} - ${home} vs ${away}): ${e.message}`, e);
        return {
            error: `Elemzési hiba: ${e.message}`
        };
    }
}
