// FÁJL: Model.ts
// VERZIÓ: v95.1 ("AH Szimuláció Javítás")
// MÓDOSÍTÁS:
// 1. CÉL: A `simulatorReport.pAH` hiba javítása.
// 2. MÓDOSÍTVA: A `simulateMatchProgress` (4. Ügynök) frissítve.
// 3. LOGIKA: A szimulátor (v95.1) már nem csak 1X2-t és O/U-t számol,
//    hanem az Ázsiai Hendikep (-1.5, -0.5, +0.5, +1.5)
//    valószínűségeket is, amire a v95.0-s Stratéga támaszkodik.

import { ICanonicalRichContext, IDataFetchResponse } from "./DataFetch.js";
import { getAdjustedRatings, getNarrativeRatings } from "./LearningService.js";
import { 
    poisson, 
    type PoissonResult, 
    type MatchSimulationResult 
} from './providers/common/poisson.js';

// Típusdefiníciók
interface IFactorWeights {
    weather: number;
    pitch: number;
    home_absentee: number;
    away_absentee: number;
    home_morale: number;
    away_morale: number;
}

interface IMarketIntel {
    preMatchOdds: { home: number, draw: number, away: number };
    currentOdds: { home: number, draw: number, away: number };
    marketMovementSignal: 'HOME' | 'AWAY' | 'DRAW' | 'NEUTRAL' | 'MIXED' | 'N/A';
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'N/A';
}

interface ISimulatorReport {
    p1X2: { pHome: number, pDraw: number, pAway: number };
    pOU: { pOver: number, pUnder: number, line: number };
    pBTTS: { pYes: number, pNo: number };
    // v95.1 JAVÍTÁS:
    pAH: {
        home_neg_1_5: number;
        home_neg_0_5: number;
        home_pos_0_5: number;
        home_pos_1_5: number;
        away_neg_1_5: number;
        away_neg_0_5: number;
        away_pos_0_5: number;
        away_pos_1_5: number;
    };
    commonScores: { score: string, probability: number }[];
    expectedGoals: { home: number, away: number };
}

// === 1. ÜGYNÖK (A KVANT) ===
/**
 * 1. Ügynök (A Kvant)
 * Kiszámítja a "Tiszta xG"-t a P1/P2/P4 adatok alapján.
 */
export function calculateBaselineXG(
    data: IDataFetchResponse,
    sport: string
): { homeXG: number, awayXG: number, xgSource: string } {
    
    const { rawData, advancedData, leagueAverages, xgSource } = data;
    const powerRatings = getAdjustedRatings();

    let homeXG: number;
    let awayXG: number;
    let finalXgSource = xgSource; // Átvesszük a DataFetch.ts-től

    // v96.0: Biztonsági háló a hiányzó nevekre
    const homeTeamName = (rawData.apiFootballData.homeTeamName || "unknown_home").toLowerCase();
    const awayTeamName = (rawData.apiFootballData.awayTeamName || "unknown_away").toLowerCase();

    const homeRating = powerRatings[homeTeamName] || { atk: 1, def: 1, matches: 0 };
    const awayRating = powerRatings[awayTeamName] || { atk: 1, def: 1, matches: 0 };

    // Súlyozás: Ha egy csapatnak 0 meccse van a PR-ben, a súlya 0. Ha 20+, a súlya 1.
    const getWeight = (matches: number) => Math.min(1, Math.max(0, matches / 20.0));
    const homeWeight = getWeight(homeRating.matches);
    const awayWeight = getWeight(awayRating.matches);

    // === P1 (MANUÁLIS) LOGIKA (LEG MAGASABB PRIORITÁS) ===
    if (finalXgSource === "Manual (Components)" && 
        advancedData.manual_H_xG != null && advancedData.manual_H_xGA != null &&
        advancedData.manual_A_xG != null && advancedData.manual_A_xGA != null) 
    {
        console.log(`[Model.ts - 1. Ügynök] Hibrid P1: 4-Komponensű Szezonális xG betöltve: H=${advancedData.manual_H_xG}, A=${advancedData.manual_A_xG}`);
        
        // Hibrid xG számítás (P1 adatokból)
        const h_xg = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
        const a_xg = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;

        // Keverjük a P1 hibrid xG-t a Power Rating (PR) alapú xG-vel
        const pr_h_xg = (homeRating.atk + awayRating.def) / 2;
        const pr_a_xg = (awayRating.atk + homeRating.def) / 2;

        // A végső xG a P1 hibrid és a PR keveréke, a PR súlya alapján.
        // Ha a PR-nek 0 meccse van (súly=0), 100% P1-et használunk.
        // Ha a PR-nek 20+ meccse van (súly=1), 50-50% P1-et és PR-t használunk (v94.0 logika)
        homeXG = (h_xg * (1 - (homeWeight * 0.5))) + (pr_h_xg * (homeWeight * 0.5));
        awayXG = (a_xg * (1 - (awayWeight * 0.5))) + (pr_a_xg * (awayWeight * 0.5));
        
        finalXgSource = "Manual (Components)";
    }
    // === P2/P4 (AUTOMATIKUS API) LOGIKA (MÁSODIK PRIORITÁS) ===
    else if (finalXgSource === "API (Real)" && advancedData.home.xg != null && advancedData.away.xg != null) {
        console.log(`[Model.ts - 1. Ügynök] P2/P4 (API Valós): xG betöltve: H=${advancedData.home.xg}, A=${advancedData.away.xg}`);
        
        const h_xg = advancedData.home.xg;
        const a_xg = advancedData.away.xg;
        
        // Keverjük az API xG-t a Power Rating (PR) alapú xG-vel
        const pr_h_xg = (homeRating.atk + awayRating.def) / 2;
        const pr_a_xg = (awayRating.atk + homeRating.def) / 2;

        homeXG = (h_xg * (1 - (homeWeight * 0.5))) + (pr_h_xg * (homeWeight * 0.5));
        awayXG = (a_xg * (1 - (awayWeight * 0.5))) + (pr_a_xg * (awayWeight * 0.5));

        finalXgSource = "API (Real) + PR";
    }
    // === P4 (SZÁMÍTOTT FALLBACK) LOGIKA (LEGALACSONYABB PRIORITÁS) ===
    else {
        console.warn(`[Model.ts - 1. Ügynök] P4 (Fallback): Nincs P1 vagy P2 xG. Alap statisztikák (GF/GA) és Power Ratingek használata.`);
        
        // v96.0: Biztonsági háló a hiányzó statisztikákra
        const safeStats = {
            home_gp: rawData.stats?.home?.gp || 1,
            home_gf: rawData.stats?.home?.gf || 0,
            home_ga: rawData.stats?.home?.ga || 0,
            away_gp: rawData.stats?.away?.gp || 1,
            away_gf: rawData.stats?.away?.gf || 0,
            away_ga: rawData.stats?.away?.ga || 0,
        };

        const homeGF = safeStats.home_gf / safeStats.home_gp;
        const homeGA = safeStats.home_ga / safeStats.home_gp;
        const awayGF = safeStats.away_gf / safeStats.away_gp;
        const awayGA = safeStats.away_ga / safeStats.away_gp;
        
        const avgHomeGF = leagueAverages.avgHomeGF || 1.45;
        const avgAwayGF = leagueAverages.avgAwayGF || 1.15;

        const homeAtkStrength = homeGF / avgHomeGF;
        const homeDefStrength = homeGA / avgAwayGF; // Figyelem: Fordított logika
        const awayAtkStrength = awayGF / avgAwayGF;
        const awayDefStrength = awayGA / avgHomeGF; // Figyelem: Fordított logika

        const calculated_h_xg = homeAtkStrength * awayDefStrength * avgHomeGF;
        const calculated_a_xg = awayAtkStrength * homeDefStrength * avgAwayGF;

        // Keverjük a számított xG-t a Power Rating (PR) alapú xG-vel
        const pr_h_xg = (homeRating.atk + awayRating.def) / 2;
        const pr_a_xg = (awayRating.atk + homeRating.def) / 2;

        homeXG = (calculated_h_xg * (1 - homeWeight)) + (pr_h_xg * homeWeight);
        awayXG = (calculated_a_xg * (1 - awayWeight)) + (pr_a_xg * awayWeight);
        
        finalXgSource = "Calculated (Fallback) + PR";
    }

    // Biztonsági ellenőrzés (Min/Max xG)
    const MIN_XG = 0.5;
    const MAX_XG = 3.5;
    homeXG = Math.max(MIN_XG, Math.min(MAX_XG, homeXG));
    awayXG = Math.max(MIN_XG, Math.min(MAX_XG, awayXG));

    console.log(`[Model.ts - 1. Ügynök] Tiszta xG: H=${homeXG.toFixed(2)}, A=${awayXG.toFixed(2)} (Forrás: ${finalXgSource})`);

    return {
        homeXG: parseFloat(homeXG.toFixed(2)),
        awayXG: parseFloat(awayXG.toFixed(2)),
        xgSource: finalXgSource
    };
}


// === 2. ÜGYNÖK (A FELDERÍTŐ) ===
/**
 * 2. Ügynök (A Felderítő)
 * Előkészíti a nyers adatokat az AI számára (kivonatolás).
 */
export function getContextualInputs(data: ICanonicalRichContext, homeTeamName: string, awayTeamName: string) {
    
    const { rawData } = data;
    
    // v96.0: Robusztusabb hibakezelés (ha a 'rawData' hiányos a P1 Stub miatt)
    const safeRawData = {
        contextual_factors: rawData.contextual_factors || { structured_weather: {} },
        referee: rawData.referee || {},
        detailedPlayerStats: rawData.detailedPlayerStats || { home_absentees: [], away_absentees: [] },
        h2h_structured: rawData.h2h_structured || [],
    };

    // 1. Időjárás és Pálya
    const weather = safeRawData.contextual_factors.structured_weather || {};
    let weatherString = "Mérsékelt";
    if (weather.temperature_celsius != null && weather.temperature_celsius > 30) weatherString = "Extrém hőség";
    if (weather.temperature_celsius != null && weather.temperature_celsius < 0) weatherString = "Extrém hideg";
    if (weather.precipitation_mm != null && weather.precipitation_mm > 1.0) weatherString += ", Erős esőzés";
    if (weather.wind_speed_kmh != null && weather.wind_speed_kmh > 25) weatherString += ", Erős szél";
    const pitch = safeRawData.contextual_factors.pitch_condition || "Ismeretlen";
    
    // 2. Bíró
    const referee = safeRawData.referee.style || "Átlagos";

    // 3. Hiányzók (Kivonatolás)
    const mapAbsentees = (absentees: any[]): string => {
        if (!absentees || absentees.length === 0) return "Nincsenek jelentős hiányzók.";
        const keyPlayers = absentees
            .filter(p => p.importance === 'key' || p.rating_last_5 > 7.0)
            .map(p => `${p.name} (${p.role})`);
        if (keyPlayers.length === 0) return "Csak cserejátékosok hiányoznak.";
        return `Kulcsfontosságú hiányzók: ${keyPlayers.join(', ')}.`;
    };
    const homeAbsenteesStr = mapAbsentees(safeRawData.detailedPlayerStats.home_absentees);
    const awayAbsenteesStr = mapAbsentees(safeRawData.detailedPlayerStats.away_absentees);

    // 4. Pszichológiai Bemenetek (Nyers adatok a 2.5-ös Ügynöknek)
    const homeNews = safeRawData.contextual_factors.home_news || "Nincsenek hírek.";
    const awayNews = safeRawData.contextual_factors.away_news || "Nincsenek hírek.";
    const h2hStr = safeRawData.h2h_structured.length > 0 
        ? safeRawData.h2h_structured.map(m => `${m.date}: ${m.home_team} ${m.score} ${m.away_team}`).join('\n')
        : "Nincs releváns H2H előzmény.";
    const tension = safeRawData.contextual_factors.match_tension_index 
        ? `Magas (Index: ${safeRawData.contextual_factors.match_tension_index})`
        : "Normál";

    // 5. Narratív Tanulságok (v94.0)
    const narrativeRatings = getNarrativeRatings();
    const homeNarrative = narrativeRatings[homeTeamName.toLowerCase()];
    const awayNarrative = narrativeRatings[awayTeamName.toLowerCase()];

    return {
        // 3. Ügynöknek
        weatherString,
        pitch,
        referee,
        homeAbsenteesStr,
        awayAbsenteesStr,
        // 2.5 Ügynöknek
        homeNews,
        awayNews,
        h2hStr,
        tension,
        // v94.0: Visszacsatolás a 7. Ügynöktől
        homeNarrativeRating: homeNarrative ? JSON.stringify(homeNarrative) : "N/A",
        awayNarrativeRating: awayNarrative ? JSON.stringify(awayNarrative) : "N/A"
    };
}


// === 4. ÜGYNÖK (A SZIMULÁTOR) (JAVÍTVA v95.1) ===
/**
 * 4. Ügynök (A Szimulátor)
 * Lefuttat 25 000 Poisson-szimulációt a súlyozott xG alapján.
 * JAVÍTVA (v95.1): Már Ázsiai Hendikep (pAH) valószínűségeket is számol.
 */
export function simulateMatchProgress(
    homeXG: number, 
    awayXG: number, 
    iterations: number = 25000, 
    mainLine: number = 2.5
): { report: ISimulatorReport, rawSimulation: MatchSimulationResult } {

    // A Poisson.js hívása
    const simulation: MatchSimulationResult = poisson.simulate(homeXG, awayXG, iterations);

    // v95.1 JAVÍTÁS: Ázsiai Hendikep Számítás
    let p_home_neg_1_5 = 0;
    let p_home_neg_0_5 = 0;
    let p_home_pos_0_5 = 0;
    let p_home_pos_1_5 = 0;
    let p_away_neg_1_5 = 0;
    let p_away_neg_0_5 = 0;
    let p_away_pos_0_5 = 0;
    let p_away_pos_1_5 = 0;

    for (const score of simulation.scoreMap.values()) {
        const h = score.home;
        const a = score.away;
        const prob = score.probability;

        // Home AH
        if (h - a > 1.5) p_home_neg_1_5 += prob;
        if (h - a > 0.5) p_home_neg_0_5 += prob;
        if (h - a > -0.5) p_home_pos_0_5 += prob;
        if (h - a > -1.5) p_home_pos_1_5 += prob;
        
        // Away AH
        if (a - h > 1.5) p_away_neg_1_5 += prob;
        if (a - h > 0.5) p_away_neg_0_5 += prob;
        if (a - h > -0.5) p_away_pos_0_5 += prob;
        if (a - h > -1.5) p_away_pos_1_5 += prob;
    }

    const report: ISimulatorReport = {
        p1X2: {
            pHome: simulation.probabilities.homeWin,
            pDraw: simulation.probabilities.draw,
            pAway: simulation.probabilities.awayWin
        },
        pOU: {
            pOver: simulation.probabilities.over[mainLine] || 0.0,
            pUnder: simulation.probabilities.under[mainLine] || 0.0,
            line: mainLine
        },
        pBTTS: {
            pYes: simulation.probabilities.bttsYes,
            pNo: simulation.probabilities.bttsNo
        },
        // v95.1 JAVÍTÁS:
        pAH: {
            home_neg_1_5: p_home_neg_1_5,
            home_neg_0_5: p_home_neg_0_5,
            home_pos_0_5: p_home_pos_0_5,
            home_pos_1_5: p_home_pos_1_5,
            away_neg_1_5: p_away_neg_1_5,
            away_neg_0_5: p_away_neg_0_5,
            away_pos_0_5: p_away_pos_0_5,
            away_pos_1_5: p_away_pos_1_5,
        },
        commonScores: simulation.commonScores.slice(0, 5),
        expectedGoals: {
            home: homeXG,
            away: awayXG
        }
    };

    return { report, rawSimulation: simulation };
}


// === PIACI ELEMZŐ (A 2. ÜGYNÖK RÉSZE) ===
/**
 * Kiszámítja a piaci mozgást és az implikált valószínűségeket.
 */
export function calculateValue(
    oddsData: ICanonicalRichContext['oddsData'],
    simulation: ISimulatorReport
): { marketIntel: string, modelConfidence: number, valueBets: any[] } {

    if (!oddsData || !oddsData.current || oddsData.current.length < 3) {
        console.warn(`[Model.ts/calculateValue] Kihagyva: Nincsenek érvényes 1X2 odds adatok.`);
        return {
            marketIntel: "N/A (Hiányzó Odds Adatok)",
            modelConfidence: 5.0, // Alap bizalom
            valueBets: []
        };
    }
    
    // 1. Implikált Valószínűség Számítása
    const odds = {
        home: oddsData.current.find(o => o.name === 'Hazai győzelem')?.price || 0,
        draw: oddsData.current.find(o => o.name === 'Döntetlen')?.price || 0,
        away: oddsData.current.find(o => o.name === 'Vendég győzelem')?.price || 0,
    };

    if (odds.home === 0 || odds.draw === 0 || odds.away === 0) {
        console.warn(`[Model.ts/calculateValue] Kihagyva: Hiányos 1X2 odds árak.`);
        return {
            marketIntel: "N/A (Hiányos Odds Árak)",
            modelConfidence: 5.0,
            valueBets: []
        };
    }

    const margin = (1 / odds.home) + (1 / odds.draw) + (1 / odds.away);
    const pMarket = {
        home: (1 / odds.home) / margin,
        draw: (1 / odds.draw) / margin,
        away: (1 / odds.away) / margin
    };

    // 2. Piaci Mozgás Elemzése (v93.0 logika)
    let marketIntelStr = "Stabil piac.";
    // TODO: Implementálni a pre-match vs current odds összehasonlítást, ha az oddsData támogatja.
    // Jelenleg (v94.0) az oddsProvider nem ad "pre-match" adatot, csak "current"-et.
    // Ezért a "marketIntel" primitív marad.
    
    // 3. Érték (Value) Keresése
    const pModel = simulation.p1X2;
    const value = {
        home: pModel.pHome - pMarket.home,
        draw: pModel.pDraw - pMarket.draw,
        away: pModel.pAway - pMarket.away
    };

    const VALUE_THRESHOLD = 0.05; // 5% érték
    let valueBets: any[] = [];
    if (value.home > VALUE_THRESHOLD) valueBets.push({ market: '1X2', pick: 'Home', value: value.home, model: pModel.pHome, market: pMarket.home });
    if (value.draw > VALUE_THRESHOLD) valueBets.push({ market: '1X2', pick: 'Draw', value: value.draw, model: pModel.pDraw, market: pMarket.draw });
    if (value.away > VALUE_THRESHOLD) valueBets.push({ market: '1X2', pick: 'Away', value: value.away, model: pModel.pAway, market: pMarket.away });

    if (valueBets.length > 0) {
        console.log(`[Model.ts/calculateValue] ${valueBets.length} db értékes fogadás azonosítva.`);
    }

    // 4. Modell Bizalom Számítása (Alap)
    // Ez egy "alap" bizalom, amit az 5. Ügynök (Kritikus) felülbírál.
    // Azt méri, mennyire ért egyet a modell és a piac.
    const divergence = Math.abs(value.home) + Math.abs(value.draw) + Math.abs(value.away);
    // Max divergencia = 2.0 (pl. Piac 100% Home, Modell 100% Away)
    // (1 - (divergencia / 2)) -> 0.0 (teljes ellentmondás) és 1.0 (tökéletes egyetértés) között.
    // Skálázás 1-10 közé.
    const agreementScore = (1 - (divergence / 2.0)) * 9 + 1;
    
    return {
        marketIntel: marketIntelStr,
        modelConfidence: parseFloat(agreementScore.toFixed(1)),
        valueBets: valueBets
    };
}
