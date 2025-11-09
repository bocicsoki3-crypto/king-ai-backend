// FÁJL: AnalysisFlow.ts
// VERZIÓ: v96.0 ("Karcsúsított Mentés")
// MÓDOSÍTÁS:
// 1. CÉL: A "50000 characters" mentési hiba javítása.
// 2. MÓDOSÍTVA: A `runFullAnalysis` funkció vége (mentési blokk).
// 3. LOGIKA (v96.0): Létrehozunk egy "leanAuditData" objektumot,
//    amely már NEM tartalmazza a "fullAnalysisReport.rawData"-t.
//    A `saveAnalysisToSheet` (v96.0) már ezt a kisebb JSON-t menti,
//    így elkerülve az 50k karakteres limitet.
// 4. MÓDOSÍTVA: A `saveAnalysisToSheet` hívása 1 argumentumosra javítva (v94.7).

import { 
    getRichContextualData, 
    type IDataFetchOptions, 
    type IDataFetchResponse, 
    type ICanonicalRichContext 
} from './DataFetch.js';
import { 
    calculateBaselineXG, 
    getContextualInputs, 
    simulateMatchProgress, 
    calculateValue,
    type ISimulatorReport
} from './Model.js';
import { 
    runStep_Psychologist, 
    runStep_Specialist, 
    runStep_Critic, 
    runStep_Strategist 
} from './AI_Service.js';
import { saveAnalysisToSheet, deleteHistoryItemFromSheet } from './sheets.js';
import { getNarrativeRatings } from './LearningService.js';
import NodeCache from 'node-cache';
import { v4 as uuidv4 } from 'uuid';

// === Globális Elemzési Cache ===
export const analysisCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

// Típusok
interface IAnalysisParams {
    options: IDataFetchOptions;
    mainLine: number;
    forceNew: boolean;
    // v94.7: A sheetUrl már nem kell, a sheets.ts (v96.0) tudja a .env-ből
}

// v96.0: Ezt a típust mentjük (karcsúsított)
export interface IAnalysisData {
    matchData: {
        id: string;
        sport: string;
        home: string;
        away: string;
        league: string;
        kickoff: string;
        mainLine: number;
        fixtureId: number | string | null;
        // v96.0: A DataFetch.ts-ből a csapatnevek mentése
        homeTeamName?: string; 
        awayTeamName?: string;
    };
    reports: {
        quant: any;
        psychologist: any;
        specialist: any;
        simulator: any; // Ez is karcsúsítva lesz mentés előtt
        critic: any;
        strategist: any;
    };
    finalRecommendation: {
        bet: string;
        confidence: number;
        reasoning: string;
    };
}

// Ezt a típust adjuk vissza a kliensnek (teljes)
interface IFullAnalysisReport {
    analysisData: IAnalysisData;
    rawData: ICanonicalRichContext; // Ezt NEM mentjük (v96.0)
}

/**
 * === A TELJES 8-ÜGYNÖKÖS AI LÁNC VEZÉRLÉSE (v96.0) ===
 */
export async function runFullAnalysis(params: IAnalysisParams): Promise<IFullAnalysisReport> {
    
    const { options, mainLine, forceNew } = params;
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;

    const matchId = `analysis_v94.0_self_learning_loop_${sport}_${homeTeamName.replace(/\s/g, '_')}_vs_${awayTeamName.replace(/\s/g, '_')}`;

    // 1. Cache ellenőrzés
    if (!forceNew) {
        const cachedAnalysis = analysisCache.get<IFullAnalysisReport>(matchId);
        if (cachedAnalysis) {
            console.log(`Elemzés CACHE TALÁLAT (${matchId})`);
            return cachedAnalysis;
        }
    }
    console.log(forceNew ? `Újraelemzés kényszerítve (${matchId})` : `Nincs elemzés cache (${matchId}), új lánc indítása...`);

    // === LÁNC 2: FELDERÍTŐ (ADATGYŰJTÉS) ===
    console.log(`[Lánc 2/6] Scout Ügynök: Kontextus és Piac lekérése...`);
    const richContextData: IDataFetchResponse = await getRichContextualData(options);

    // v96.0: A DataFetch.ts-ből származó valós csapatnevek tárolása
    const finalHomeTeamName = richContextData.rawData.apiFootballData.homeTeamName || homeTeamName;
    const finalAwayTeamName = richContextData.rawData.apiFootballData.awayTeamName || awayTeamName;

    const analysisData: IAnalysisData = {
        matchData: {
            id: matchId,
            sport: sport,
            home: finalHomeTeamName, // v96.0
            away: finalAwayTeamName, // v96.0
            league: leagueName,
            kickoff: utcKickoff,
            mainLine: mainLine,
            fixtureId: richContextData.rawData.apiFootballData.fixtureId,
            homeTeamName: homeTeamName, // A P1-es bemenet mentése auditáláshoz
            awayTeamName: awayTeamName  // A P1-es bemenet mentése auditáláshoz
        },
        reports: {
            quant: null, psychologist: null, specialist: null, 
            simulator: null, critic: null, strategist: null
        },
        finalRecommendation: { bet: "N/A", confidence: 0.0, reasoning: "N/A" }
    };
    
    // Nyers adatok előkészítése az AI-oknak (2.5 és 3)
    const contextualInputs = getContextualInputs(richContextData, finalHomeTeamName, finalAwayTeamName);
    
    // === LÁNC 2.5: PSZICHOLÓGUS (AI NARRATÍVA) ===
    console.log(`[Lánc 2.5/6] Pszichológus Ügynök: Narratív profilalkotás...`);
    const psychologistReport = await runStep_Psychologist({
        homeTeamName: finalHomeTeamName,
        awayTeamName: finalAwayTeamName,
        leagueContext: `${leagueName} (${sport})`,
        homeRawNews: contextualInputs.homeNews,
        awayRawNews: contextualInputs.awayNews,
        homeRecentFormString: richContextData.form.home_overall || "N/A",
        awayRecentFormString: richContextData.form.away_overall || "N/A",
        h2hHistory: contextualInputs.h2hStr,
        matchTension: contextualInputs.tension,
        homeNarrativeRating: contextualInputs.homeNarrativeRating, // v94.0
        awayNarrativeRating: contextualInputs.awayNarrativeRating  // v94.0
    });
    analysisData.reports.psychologist = psychologistReport;
    console.log(`[Lánc 2.5/6] Pszichológus végzett.`);

    // === LÁNC 2.6: ÖNJAVÍTÓ HUROK (v94.0) ===
    console.log(`[Lánc 2.6/6] Önjavító Hurok: 7. Ügynök (Revizor) múltbeli tanulságainak beolvasása...`);
    // (A v94.0-s logika áthelyezve a contextualInputs-ba és az AI promptokba)
    if (contextualInputs.homeNarrativeRating === "N/A" && contextualInputs.awayNarrativeRating === "N/A") {
        console.log(`[Lánc 2.6/6] Nincsenek múltbeli tanulságok a Narratív Cache-ben ehhez a párosításhoz.`);
    } else {
        console.log(`[Lánc 2.6/6] Múltbeli tanulságok betöltve és átadva a láncnak.`);
    }

    // === LÁNC 1: KVANT (TISZTA XG) ===
    console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
    const { homeXG, awayXG, xgSource } = calculateBaselineXG(richContextData, sport);
    analysisData.reports.quant = {
        baseline_xg_home: homeXG,
        baseline_xg_away: awayXG,
        xg_source: xgSource
    };
    console.log(`Quant (Tiszta xG) [${xgSource}]: H=${homeXG}, A=${awayXG}`);

    // === LÁNC 3: SPECIALISTA (AI SÚLYOZÁS) ===
    console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása (v94.0)...`);
    const specialistReport = await runStep_Specialist({
        homeTeamName: finalHomeTeamName,
        awayTeamName: finalAwayTeamName,
        baselineHomeXG: homeXG,
        baselineAwayXG: awayXG,
        weather: contextualInputs.weatherString,
        pitch: contextualInputs.pitch,
        refereeStyle: contextualInputs.referee,
        psyProfileHome: psychologistReport?.psyProfileHome || "N/A",
        psyProfileAway: psychologistReport?.psyProfileAway || "N/A",
        homeAbsentees: contextualInputs.homeAbsenteesStr,
        awayAbsentees: contextualInputs.awayAbsenteesStr,
        homeNarrativeRating: contextualInputs.homeNarrativeRating, // v94.0
        awayNarrativeRating: contextualInputs.awayNarrativeRating  // v94.0
    });
    
    let adjustedHomeXG = homeXG;
    let adjustedAwayXG = awayXG;

    if (specialistReport && specialistReport.adjusted_xg_home != null && specialistReport.adjusted_xg_away != null) {
        adjustedHomeXG = parseFloat(specialistReport.adjusted_xg_home);
        adjustedAwayXG = parseFloat(specialistReport.adjusted_xg_away);
        analysisData.reports.specialist = specialistReport;
        console.log(`Specialista (AI) (Súlyozott xG): H=${adjustedHomeXG}, A=${adjustedAwayXG}`);
    } else {
        console.warn(`[Lánc 3/6] Specialista (AI) Hiba: Az AI nem adott vissza érvényes xG-t, a lánc a Tiszta xG-vel (Quant) folytatódik.`);
        analysisData.reports.specialist = { error: "AI válasz hiba", ...specialistReport };
    }

    // === LÁNC 4: SZIMULÁTOR (VALÓSZÍNŰSÉG) ===
    console.log(`[Lánc 4/6] Szimulátor Ügynök: 25000 szimuláció futtatása...`);
    const { report: simulatorReport, rawSimulation: simulationResult } = simulateMatchProgress(
        adjustedHomeXG,
        adjustedAwayXG,
        25000,
        mainLine
    );
    
    // Piaci elemzés (Érték és Modell Bizalom)
    const { marketIntel, modelConfidence, valueBets } = calculateValue(richContextData.oddsData, simulatorReport);
    
    analysisData.reports.simulator = {
        ...simulatorReport,
        market_intel: marketIntel,
        value_bets_found: valueBets,
        _model_confidence_v1: modelConfidence // Ezt az 5. Ügynök felülbírálja
    };
    console.log(`Szimulátor végzett. (Modell bizalom: ${modelConfidence})`);

    // === LÁNC 5: KRITIKUS (AI BIZALOM) ===
    console.log(`[Lánc 5/6] Kritikus Ügynök: Ellentmondások keresése (v94.0 - Önjavító)...`);
    const simulationSummaryForCritic = `1X2: H=${(simulatorReport.p1X2.pHome * 100).toFixed(1)}%, D=${(simulatorReport.p1X2.pDraw * 100).toFixed(1)}%, A=${(simulatorReport.p1X2.pAway * 100).toFixed(1)}%. O/U ${mainLine}: Over=${(simulatorReport.pOU.pOver * 100).toFixed(1)}%, Under=${(simulatorReport.pOU.pUnder * 100).toFixed(1)}%. BTTS: Yes=${(simulatorReport.pBTTS.pYes * 100).toFixed(1)}%, No=${(simulatorReport.pBTTS.pNo * 100).toFixed(1)}%`;
    
    const criticReport = await runStep_Critic({
        simulationSummary: simulationSummaryForCritic,
        marketIntel: marketIntel,
        keyFactors: specialistReport?.adjustment_reasoning || "N/A (Tiszta xG használatban)",
        xgSource: xgSource,
        homeNarrativeRating: contextualInputs.homeNarrativeRating, // v94.0
        awayNarrativeRating: contextualInputs.awayNarrativeRating  // v94.0
    });

    let finalConfidence = modelConfidence; // Alap bizalom
    if (criticReport && criticReport.final_confidence_score != null) {
        finalConfidence = parseFloat(criticReport.final_confidence_score);
        analysisData.reports.critic = criticReport;
        console.log(`[Lánc 5/6] Kritikus végzett. Végső (Piac-Tudatos) Bizalmi Pontszám: ${finalConfidence.toFixed(2)}`);
    } else {
        console.warn(`[Lánc 5/6] Kritikus (AI) Hiba: Az AI nem adott vissza érvényes bizalmi pontszámot, a lánc a Modell Bizalommal (${finalConfidence}) folytatódik.`);
        analysisData.reports.critic = { error: "AI válasz hiba", ...criticReport };
    }

    // === LÁNC 6: STRATÉGA (AI DÖNTÉS - v95.0) ===
    console.log(`[Lánc 6/6] Stratéga Ügynök: Végső döntés meghozatala (v95.0 - Narratíva)...`);
    const strategistReport = await runStep_Strategist({
        homeTeamName: finalHomeTeamName,
        awayTeamName: finalAwayTeamName,
        simulatorReport: JSON.stringify(simulatorReport),
        finalConfidence: finalConfidence,
        criticReasoning: criticReport?.confidence_reasoning || "N/A",
        adjustedHomeXG: adjustedHomeXG,
        adjustedAwayXG: adjustedAwayXG,
        specialistReasoning: specialistReport?.adjustment_reasoning || "N/A",
        homeNarrativeRating: contextualInputs.homeNarrativeRating, // v94.0
        awayNarrativeRating: contextualInputs.awayNarrativeRating  // v94.0
    });

    if (strategistReport && strategistReport.recommended_bet && strategistReport.final_confidence != null && strategistReport.brief_reasoning) {
        analysisData.reports.strategist = strategistReport;
        analysisData.finalRecommendation = {
            bet: strategistReport.recommended_bet,
            confidence: parseFloat(strategistReport.final_confidence),
            reasoning: strategistReport.brief_reasoning
        };
    } else {
        console.error(`[Lánc 6/6] KRITIKUS HIBA: A Stratéga (v95.0) nem adott vissza érvényes döntést!`, strategistReport);
        analysisData.reports.strategist = { error: "AI válasz hiba", ...strategistReport };
        // Fallback (Nagyon alacsony bizalmú)
        analysisData.finalRecommendation = {
            bet: "N/A (Stratéga Hiba)",
            confidence: 1.0,
            reasoning: "A 6. Ügynök (Stratéga) válasza érvénytelen volt."
        };
    }
    
    console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${analysisData.finalRecommendation.bet} (Végső bizalom: ${analysisData.finalRecommendation.confidence})`);

    // === TELJES JELENTÉS ÖSSZEÁLLÍTÁSA ===
    const fullAnalysisReport: IFullAnalysisReport = {
        analysisData: analysisData,
        rawData: richContextData // Ezt már nem mentjük (v96.0)
    };

    // Cache mentése
    analysisCache.set(matchId, fullAnalysisReport);
    console.log(`Elemzés befejezve és cache mentve (${matchId})`);

    // === MENTÉS A GOOGLE SHEET-BE (v96.0 JAVÍTÁS) ===
    // A "lean" (karcsúsított) adat létrehozása az 50k limit hiba elkerülésére.
    // Eltávolítjuk a "rawData"-t és a "simulatorReport" teljes JSON-jét.
    
    const leanAuditData: IAnalysisData = {
        ...analysisData,
        reports: {
            ...analysisData.reports,
            // A szimulátor riportot "karcsúsítjuk" a mentéshez
            simulator: {
                p1X2: analysisData.reports.simulator.p1X2,
                pOU: analysisData.reports.simulator.pOU,
                pBTTS: analysisData.reports.simulator.pBTTS,
                pAH: analysisData.reports.simulator.pAH, // v95.1
                expectedGoals: analysisData.reports.simulator.expectedGoals,
                market_intel: analysisData.reports.simulator.market_intel,
                value_bets_found: (analysisData.reports.simulator.value_bets_found || []).length, // v96.0 Biztonsági háló
                _model_confidence_v1: analysisData.reports.simulator._model_confidence_v1
            }
        }
    };
    
    // v94.7 JAVÍTÁS: A hívás már nem igényel "sheetUrl"-t.
    // v96.0 JAVÍTÁS: A "leanAuditData"-t adjuk át.
    try {
        await saveAnalysisToSheet(leanAuditData); // Csak az 1 argumentumos hívás
        console.log(`Elemzés (JSON) mentve a Google Sheet-be (${matchId})`);
    } catch (e: any) {
        console.error(`Hiba az elemzés mentésekor a táblázatba (ID: ${matchId}): ${e.message}`, e.stack);
        // A hiba ellenére visszaadjuk az elemzést a kliensnek.
    }

    return fullAnalysisReport;
}

/**
 * Elemzés törlése (Cache és Sheet)
 */
export async function deleteAnalysis(analysisId: string): Promise<{ success: boolean, message: string }> {
    if (!analysisId) {
        return { success: false, message: "Hiányzó elemzés ID." };
    }

    try {
        // 1. Törlés a Google Sheet-ből (v94.7 javítás: 1 arg)
        const sheetDeleteSuccess = await deleteHistoryItemFromSheet(analysisId);
        
        if (!sheetDeleteSuccess) {
            // Ha a Sheet-ből való törlés sikertelen, nem töröljük a cache-ből,
            // de hibát jelzünk.
            console.warn(`[AnalysisFlow] Hiba: A(z) ${analysisId} törlése a Google Sheet-ből sikertelen.`);
            return { success: false, message: "Hiba a Google Sheet-ből való törlés során." };
        }
        
        // 2. Törlés a Cache-ből
        analysisCache.del(analysisId);
        
        console.log(`[AnalysisFlow] Elemzés sikeresen törölve (ID: ${analysisId})`);
        return { success: true, message: "Elemzés sikeresen törölve." };

    } catch (e: any) {
        console.error(`[AnalysisFlow] Kritikus hiba az elemzés törlése során (ID: ${analysisId}): ${e.message}`, e.stack);
        return { success: false, message: `Szerver hiba: ${e.message}` };
    }
}
