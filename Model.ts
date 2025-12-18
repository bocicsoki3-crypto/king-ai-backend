// FÁJL: Model.ts
// VERZIÓ: v139.3 (NO LOW ODDS - PROFITABLE TIPS ONLY) ⚙️
//
// JAVÍTÁS (v138.0):
// 1. CONFIDENCE THRESHOLDS NORMALIZÁLVA: Visszaállítva a szigorúbb határokra.
//    - Basketball: 5% (high), 1.5% (low) - (Volt: 2.5% / 0.75%)
//    - Hockey: 12% (high), 3.5% (low) - (Volt: 6% / 1.75%)
//    - Totals: 2x szigorúbb határok!
// 2. LIGA QUALITY PENALTY RESTORED: Visszaállítva a gyenge ligák büntetése.
//    - Very Weak: -2.0 (Volt: -1.0)
//    - Weak: -1.0 (Volt: -0.5)
// 3. CÉL: Megszüntetni a "false high confidence" jelzéseket. Csak a tényleg erős tippek legyenek 8-9/10!

import { SPORT_CONFIG } from './config.js';
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
import { formatBettingMarket } from './providers/common/utils.js';
// Kanonikus típusok importálása
import type {
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds
} from './src/types/canonical.d.ts';

// === ÚJ IMPORT A STRATÉGIÁHOZ ===
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===

// === ÚJ (v127.0): Liga Minőség Faktor Importálás ===
import { getLeagueCoefficient, getLeagueQuality } from './config_league_coefficients.js';

/**************************************************************
* Model.ts - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v106.0): Team Totals Value Calculation.
**************************************************************/

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
function poisson(lambda: number | null | undefined): number {
    if (lambda === null || typeof lambda !== 'number' || isNaN(lambda) || lambda < 0) return 0;
    if (lambda === 0) return 0;
    let l = Math.exp(-lambda), k = 0, p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > l);
    return k - 1;
}

function sampleNormal(mean: number, stdDev: number): number {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

function sampleGoals(mu_h: number, mu_a: number): { gh: number, ga: number } {
    return { gh: poisson(mu_h), ga: poisson(mu_a) };
}

// === ÚJ (v106.0) Segédfüggvény: Valószínűség számítása a Scores Map-ből ===
function calculateProbabilityFromScores(
    scores: { [key: string]: number },
    totalSims: number,
    condition: (h: number, a: number) => boolean
): number {
    let count = 0;
    for (const [score, freq] of Object.entries(scores)) {
        const [h, a] = score.split('-').map(Number);
        if (condition(h, a)) {
            count += freq;
        }
    }
    return (count / totalSims) * 100;
}


// === 1. ÜGYNÖK (QUANT): Tiszta xG Számítása - v128.0 JAVÍTVA ===
export function estimatePureXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, 
    sport: string, 
    form: ICanonicalRawData['form'], 
    leagueAverages: any, 
    advancedData: any,
    strategy: ISportStrategy,
    absentees?: ICanonicalRawData['absentees'] // ÚJ v128.0: Kulcsjátékos hiányok
): { pure_mu_h: number, pure_mu_a: number, source: string, isDerby?: boolean, derbyName?: string } {
    
    const options: XGOptions = {
        homeTeam,
        awayTeam,
        rawStats,
        form,
        leagueAverages,
        advancedData,
        absentees // ÚJ v128.0: átadjuk az absentees-t is
    };
    const result = strategy.estimatePureXG(options);
    
    // v134.0: Derby információk logolása
    if (result.isDerby) {
        console.log(`[Model.ts - 1. Ügynök] 🔥 DERBY MECCS ÉSZLELVE: ${result.derbyName}`);
    }
    
    console.log(`[Model.ts - 1. Ügynök] Tiszta xG (${sport}): H=${result.pure_mu_h.toFixed(2)}, A=${result.pure_mu_a.toFixed(2)} (Forrás: ${result.source})`);
    return result;
}


// === estimateAdvancedMetrics (Változatlan) ===
export function estimateAdvancedMetrics(
    rawData: ICanonicalRawData, 
    sport: string, 
    leagueAverages: any,
    strategy: ISportStrategy
): { mu_corners: number, mu_cards: number } {
    
    const options: AdvancedMetricsOptions = {
        rawData,
        leagueAverages
    };
    const result = strategy.estimateAdvancedMetrics(options);
    console.log(`[Model.ts] Haladó metrikák (${sport}): Szöglet=${result.mu_corners.toFixed(2)}, Lap=${result.mu_cards.toFixed(2)}`);
    return result;
}


// === 4. ÜGYNÖK (SZIMULÁTOR) (Változatlan v104.0) ===
export function simulateMatchProgress(
    mu_h: number, 
    mu_a: number, 
    mu_corners: number, 
    mu_cards: number, 
    sims: number, 
    sport: string, 
    liveScenario: any, 
    mainTotalsLine: number, 
    rawData: ICanonicalRawData
): any { 
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0;
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0;
    
    let ah_h_m0_5 = 0, ah_h_m1_5 = 0, ah_a_m0_5 = 0, ah_a_m1_5 = 0;
    let ah_h_p0_5 = 0, ah_h_p1_5 = 0, ah_a_p0_5 = 0, ah_a_p1_5 = 0;
    
    const scores: { [key: string]: number } = {};
    const safeSims = Math.max(1, sims || 1);
    const safe_mu_h = typeof mu_h === 'number' && !isNaN(mu_h) ? mu_h : SPORT_CONFIG[sport]?.avg_goals || 1.35;
    const safe_mu_a = typeof mu_a === 'number' && !isNaN(mu_a) ? mu_a : SPORT_CONFIG[sport]?.avg_goals || 1.35;
    const safe_mu_corners = typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5;
    const safe_mu_cards = typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5;
    const safe_mainTotalsLine = typeof mainTotalsLine === 'number' && !isNaN(mainTotalsLine) ? mainTotalsLine : SPORT_CONFIG[sport]?.totals_line || 2.5;
    
    if (sport === 'basketball') {
        const stdDev = 11.5;
        for (let i = 0; i < safeSims; i++) {
            const gh = Math.max(0, Math.round(sampleNormal(safe_mu_h, stdDev)));
            const ga = Math.max(0, Math.round(sampleNormal(safe_mu_a, stdDev)));
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if ((gh + ga) > safe_mainTotalsLine) over_main++;
            
            const diff = gh - ga;
            if (diff > -0.5) ah_h_p0_5++;
            if (diff > -1.5) ah_h_p1_5++;
            if (diff > 0.5) ah_h_m0_5++;
            if (diff > 1.5) ah_h_m1_5++;
            
            if (diff < 0.5) ah_a_p0_5++;
            if (diff < 1.5) ah_a_p1_5++;
            if (diff < -0.5) ah_a_m0_5++;
            if (diff < -1.5) ah_a_m1_5++;
        }
    } else { 
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(safe_mu_h, safe_mu_a);
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++;
            else if (ga > gh) away++;
            else draw++;
            if (gh > 0 && ga > 0) btts++;
            if ((gh + ga) > safe_mainTotalsLine) over_main++;
            
            const diff = gh - ga;
            if (diff > -0.5) ah_h_p0_5++;
            if (diff > -1.5) ah_h_p1_5++;
            if (diff > 0.5) ah_h_m0_5++;
            if (diff > 1.5) ah_h_m1_5++;
            
            if (diff < 0.5) ah_a_p0_5++;
            if (diff < 1.5) ah_a_p1_5++;
            if (diff < -0.5) ah_a_m0_5++;
            if (diff < -1.5) ah_a_m1_5++;

            if (sport === 'soccer') {
                const corners = poisson(safe_mu_corners);
                if (corners > 7.5) corners_o7_5++;
                if (corners > 8.5) corners_o8_5++;
                if (corners > 9.5) corners_o9_5++;
                if (corners > 10.5) corners_o10_5++;
                if (corners > 11.5) corners_o11_5++;
                const cards = poisson(safe_mu_cards);
                if (cards > 3.5) cards_o3_5++;
                if (cards > 4.5) cards_o4_5++;
                if (cards > 5.5) cards_o5_5++;
                if (cards > 6.5) cards_o6_5++;
            }
        }
    }
    
    if (sport === 'hockey' && draw > 0) {
        const homeOTWinPct = 0.55; 
        const awayOTWinPct = 0.45;
        home += draw * homeOTWinPct;
        away += draw * awayOTWinPct;
        draw = 0;
    }
    
    const toPct = (x: number) => (100 * x / safeSims);
    const topScoreKey = Object.keys(scores).length > 0
        ?
        Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0')
        : '0-0';
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);
    
    return {
         pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        
        pAH: {
            'h-0.5': toPct(ah_h_m0_5),
            'h-1.5': toPct(ah_h_m1_5),
            'a-0.5': toPct(ah_a_m0_5),
            'a-1.5': toPct(ah_a_m1_5),
            'h+0.5': toPct(ah_h_p0_5),
            'h+1.5': toPct(ah_h_p1_5),
            'a+0.5': toPct(ah_a_p0_5),
            'a+1.5': toPct(ah_a_p1_5),
        },
        
        corners: sport === 'soccer' ?
        {
             'o7.5': toPct(corners_o7_5), 'u7.5': 100 - toPct(corners_o7_5),
             'o8.5': toPct(corners_o8_5), 'u8.5': 100 - toPct(corners_o8_5),
             'o9.5': toPct(corners_o9_5), 'u9.5': 100 - toPct(corners_o9_5),
             'o10.5': toPct(corners_o10_5), 'u10.5': 100 - toPct(corners_o10_5),
             'o11.5': toPct(corners_o11_5), 'u11.5': 100 - toPct(corners_o11_5)
        } : 
        {},
        cards: sport === 'soccer' ?
        {
             'o3.5': toPct(cards_o3_5), 'u3.5': 100 - toPct(cards_o3_5),
             'o4.5': toPct(cards_o4_5), 'u4.5': 100 - toPct(cards_o4_5),
             'o5.5': toPct(cards_o5_5), 'u5.5': 100 - toPct(cards_o5_5),
             'o6.5': toPct(cards_o6_5), 'u6.5': 100 - toPct(cards_o6_5)
        } : {},
        scores,
        topScore: { 
            gh: top_gh, ga: top_ga 
        },
        mainTotalsLine: safe_mainTotalsLine,
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}


// === MÓDOSÍTVA v105.1: calculateConfidenceScores ===
export function calculateConfidenceScores(
    sport: string, 
    home: string, 
    away: string, 
    rawData: ICanonicalRawData, 
    form: ICanonicalRawData['form'], 
    mu_h: number, 
    mu_a: number, 
    mainTotalsLine: number,
    marketIntel: string
): { winner: number, totals: number, overall: number } {
    
    const MAX_SCORE = 10.0;
    const MIN_SCORE = 1.0;
    
    let winnerScore = 5.0;
    let totalsScore = 5.0;

    try {
        let generalBonus = 0;
        let generalPenalty = 0;
        
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                 if (!isNaN(latestH2HDate.getTime())) {
                      if (latestH2HDate < twoYearsAgo) { generalPenalty += 0.75; 
                    }
                      else { generalBonus += 0.25; 
                    }
                 }
            } catch(e: any) { console.warn("H2H dátum parse hiba:", e.message);
            }
        } 
        // v136.0: MISSING H2H PENALTY TÖRLVE - Ez normális! Nincs penalty!
        // else { generalPenalty += 0.25; } // TÖRÖLVE v136.0

        const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        generalBonus += Math.min(1.0, historyBonus);

        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        generalPenalty += (homeKeyAbsentees + awayKeyAbsentees) * 0.5;

        // === v139.0: NO ARTIFICIAL PENALTIES! ===
        // A liga minőségi penalty-k (v138.0) tévesen büntették a kisebb ligákat.
        // KIKAPCSOLVA! A tiszta statisztika beszéljen.
        /* 
        const leagueName = rawData?.league_name;
        if (leagueName && sport === 'soccer') {
            // ... régi penalty logika törölve ...
        }
        */
        
        // --- A. GYŐZTES (WINNER) PIACOK BIZALMA - v139.0 NORMALIZÁLT THRESHOLDS ---
        const xgDiff = Math.abs(mu_h - mu_a);
        const totalExpected = mu_h + mu_a;
        const xgDiffPercent = (xgDiff / totalExpected) * 100;
        
        // Sport-specifikus százalékos küszöbök (v145.0: FINOMHANGOLVA - TÖKÉLETES TIPPEK)
        // Finomhangolva, hogy pontosabb confidence-t kapjunk
        let thresholdHighPct: number, thresholdLowPct: number;
        
        if (sport === 'basketball') {
            thresholdHighPct = 2.5;  // v145.0: 3.0 → 2.5 (finomhangolva)
            thresholdLowPct = 0.4;   // v145.0: 0.5 → 0.4 (finomhangolva)
        } else if (sport === 'hockey') {
            thresholdHighPct = 6.0;  // v145.0: 7.0 → 6.0 (finomhangolva)
            thresholdLowPct = 1.5;    // v145.0: 2.0 → 1.5 (finomhangolva)
        } else { // soccer
            thresholdHighPct = 5.0;  // v145.0: 6.0 → 5.0 (finomhangolva)
            thresholdLowPct = 1.2;   // v145.0: 1.5 → 1.2 (finomhangolva)
        }
        
        // === v145.0: FINOMHANGOLT CONFIDENCE BÓNUSZ/PENALTY ===
        if (xgDiffPercent > thresholdHighPct) winnerScore += 2.5; // v145.0: 2.0 → 2.5 (nagyobb bónusz)
        else if (xgDiffPercent > thresholdHighPct * 0.6) winnerScore += 1.5; // v145.0: 1.0 → 1.5
        if (xgDiffPercent < thresholdLowPct) winnerScore -= 1.5; // v145.0: 2.0 → 1.5 (kevésbé szigorú)
        else if (xgDiffPercent < thresholdLowPct * 1.5) winnerScore -= 0.5; // v145.0: 1.0 → 0.5 (kevésbé szigorú)
        
        console.log(`[Confidence] xG Diff: ${xgDiff.toFixed(2)} (${xgDiffPercent.toFixed(1)}%) | Thresholds: High=${thresholdHighPct.toFixed(1)}%, Low=${thresholdLowPct.toFixed(1)}%`);

        // === FORM POINTS CALCULATION (v139.0 SIMPLIFIED) ===
        const getFormPointsPerc = (formString: string | null | undefined): number | null => {
             if (!formString || typeof formString !== 'string' || formString === "N/A") return null;
            const wins = (formString.match(/W/g) || []).length;
             const draws = (formString.match(/D/g) || []).length;
             const total = (formString.match(/[WDL]/g) || []).length;
            return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeOverallFormScore = getFormPointsPerc(form?.home_overall);
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);
        
        // === v139.2: FORM-XG ELLENTMONDÁS DINAMIKUS BÜNTETÉS ===
        // Minél nagyobb az ellentmondás, annál nagyobb a büntetés
        if (homeOverallFormScore != null && awayOverallFormScore != null) {
             const formDiff = homeOverallFormScore - awayOverallFormScore; 
             const simDiff = (mu_h - mu_a); 
             
             if ((simDiff > 0.5 && formDiff < -0.4) || (simDiff < -0.5 && formDiff > 0.4)) {
                const contradictionSeverity = Math.abs(simDiff) + Math.abs(formDiff);
                if (contradictionSeverity > 1.0) {
                    winnerScore -= 2.0; // Erős ellentmondás (pl. statisztika +1.0, forma -0.8)
                    console.log(`[Confidence v139.2] ⚠️ ERŐS FORM-XG ELLENTMONDÁS észlelve! Severity: ${contradictionSeverity.toFixed(2)} → -2.0 penalty`);
                } else {
                    winnerScore -= 1.0; // Enyhe ellentmondás
                    console.log(`[Confidence v139.2] ⚠️ Enyhe form-xG ellentmondás észlelve → -1.0 penalty`);
                }
            }
        }
        
        // --- B. PONTOK (TOTALS) PIACOK BIZALMA - v139.0 ---
        const modelTotal = mu_h + mu_a;
        const marketTotal = mainTotalsLine;
        const totalsDiff = Math.abs(modelTotal - marketTotal);
        const totalsDiffPercent = (totalsDiff / marketTotal) * 100;
        
        let totalsThresholdHighPct: number, totalsThresholdLowPct: number;
        
        // v145.0: Totals threshold-ok finomhangolva (TÖKÉLETES TIPPEK)
        if (sport === 'basketball') {
            totalsThresholdHighPct = 2.0;  // v145.0: 2.5 → 2.0 (finomhangolva)
            totalsThresholdLowPct = 0.4;   // v145.0: 0.5 → 0.4 (finomhangolva)
        } else if (sport === 'hockey') {
            totalsThresholdHighPct = 7.0;   // v145.0: 8.0 → 7.0 (finomhangolva)
            totalsThresholdLowPct = 2.0;    // v145.0: 2.5 → 2.0 (finomhangolva)
        } else { // soccer
            totalsThresholdHighPct = 8.0;   // v145.0: 10.0 → 8.0 (finomhangolva)
            totalsThresholdLowPct = 2.5;    // v145.0: 3.0 → 2.5 (finomhangolva)
        }
        
        // === v145.0: FINOMHANGOLT TOTALS CONFIDENCE BÓNUSZ/PENALTY ===
        if (totalsDiffPercent > totalsThresholdHighPct) totalsScore += 4.5; // v145.0: 4.0 → 4.5 (nagyobb bónusz)
        else if (totalsDiffPercent > totalsThresholdHighPct * 0.6) totalsScore += 3.0; // v145.0: 2.5 → 3.0
        if (totalsDiffPercent < totalsThresholdLowPct) totalsScore -= 1.5; // v145.0: 2.0 → 1.5 (kevésbé szigorú)
        
        console.log(`[Confidence] Totals Diff: ${totalsDiff.toFixed(2)} (${totalsDiffPercent.toFixed(1)}%) | Thresholds: High=${totalsThresholdHighPct.toFixed(1)}%, Low=${totalsThresholdLowPct.toFixed(1)}%`);
        
        winnerScore = winnerScore + generalBonus - generalPenalty;
        totalsScore = totalsScore + generalBonus - generalPenalty;

        const finalWinnerScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, winnerScore));
        const finalTotalsScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, totalsScore));
        
        const finalOverallScore = (finalWinnerScore * 0.6) + (finalTotalsScore * 0.4);

        return {
            winner: finalWinnerScore,
            totals: finalTotalsScore,
            overall: finalOverallScore
        };

    } catch(e: any) {
        console.error(`Hiba bizalom számításakor (${home} vs ${away}): ${e.message}`, e.stack);
        return { winner: 4.0, totals: 4.0, overall: 4.0 };
    }
}

// === Segédfüggvény: _getImpliedProbability (Változatlan) ===
function _getImpliedProbability(price: number): number {
    if (price <= 1.0) return 100.0;
    return (1 / price) * 100;
}

// === 4. ÜGYNÖK (B) RÉSZE: Érték (Value) Kiszámítása (MÓDOSÍTVA v106.0) ===
export function calculateValue(
    sim: any, 
    oddsData: ICanonicalOdds | null, 
    sport: string, 
    homeTeam: string, 
    awayTeam: string
): any[] { 
    
    const valueBets: any[] = [];
    // === v147.0: VICTORY PROTOCOL VALUE THRESHOLD ===
    // 3% -> 7%: Csak a brutális érték marad meg.
    const MIN_VALUE_THRESHOLD = 7.0; // Minimum 7% észlelt érték (volt: 6.0%)

    if (!oddsData || !oddsData.allMarkets || oddsData.allMarkets.length === 0 || !sim) {
        console.log("[Model.ts/calculateValue] Kihagyva: Hiányzó odds adatok vagy szimulációs eredmény.");
        return [];
    }
    
    const simProbs = {
        'home': sim.pHome,
        'draw': sim.pDraw,
        'away': sim.pAway,
        'over': sim.pOver,
        'under': sim.pUnder,
        'btts_yes': sim.pBTTS,
        'btts_no': 100.0 - sim.pBTTS
    };
    
    // 1. Piac: 1X2 (H2H) vagy Moneyline
    const h2hMarket = oddsData.allMarkets.find(m => m.key === 'h2h');
    if (h2hMarket && h2hMarket.outcomes) {
        h2hMarket.outcomes.forEach(outcome => {
            let simKey: 'home' | 'draw' | 'away' | null = null;
            const name = outcome.name.toLowerCase();
            
            if (name === 'home' || name === '1' || name === homeTeam.toLowerCase()) simKey = 'home';
            else if (name === 'draw' || name === 'x') simKey = 'draw';
            else if (name === 'away' || name === '2' || name === awayTeam.toLowerCase()) simKey = 'away';
            
            if (simKey && simProbs[simKey] != null) {
                const marketProb = _getImpliedProbability(outcome.price);
                const simProb = simProbs[simKey];
                const value = simProb - marketProb;
                
                // === v139.3: MINIMUM ODDS SZŰRÉS ===
                // === v140.0: EGYSÉGES FORMÁTUM ===
                // Csak akkor adjuk hozzá, ha value > threshold ÉS odds >= 1.8
                const MIN_ODDS_FOR_VALUE = 1.8;
                if (value > MIN_VALUE_THRESHOLD && outcome.price >= MIN_ODDS_FOR_VALUE) {
                    // Standardizált formátum használata
                    let marketLabel = '';
                    if (simKey === 'home') marketLabel = '1X2 - Hazai győzelem';
                    else if (simKey === 'away') marketLabel = '1X2 - Vendég győzelem';
                    else if (simKey === 'draw') marketLabel = '1X2 - Döntetlen';
                    else marketLabel = formatBettingMarket(`1X2 - ${simKey}`, sport);
                    
                    valueBets.push({
                        market: marketLabel,
                        odds: outcome.price.toFixed(2),
                        probability: `${simProb.toFixed(1)}%`,
                        value: `+${value.toFixed(1)}%`
                    });
                }
            }
        });
    }

    // 2. Piac: Fő Totals (Over/Under)
    const totalsMarket = oddsData.allMarkets.find(m => m.key === 'totals');
    if (totalsMarket && totalsMarket.outcomes && sim.mainTotalsLine) {
        const mainLine = String(sim.mainTotalsLine);
        
        const overOutcome = totalsMarket.outcomes.find(o => 
            o.name.toLowerCase().includes('over') && o.name.includes(mainLine)
        );
        const underOutcome = totalsMarket.outcomes.find(o => 
            o.name.toLowerCase().includes('under') && o.name.includes(mainLine)
        );

        // === v139.3: MINIMUM ODDS SZŰRÉS ===
        const MIN_ODDS_FOR_VALUE = 1.8;
        
        if (overOutcome) {
            const marketProb = _getImpliedProbability(overOutcome.price);
            const simProb = simProbs['over'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD && overOutcome.price >= MIN_ODDS_FOR_VALUE) {
                 valueBets.push({
                    market: formatBettingMarket(`Over ${mainLine}`, sport), // === v140.0: EGYSÉGES FORMÁTUM ===
                    odds: overOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        }
        if (underOutcome) {
            const marketProb = _getImpliedProbability(underOutcome.price);
            const simProb = simProbs['under'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD && underOutcome.price >= MIN_ODDS_FOR_VALUE) {
                 valueBets.push({
                    market: formatBettingMarket(`Under ${mainLine}`, sport), // === v140.0: EGYSÉGES FORMÁTUM ===
                    odds: underOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        }
    }
    
    // === 4. ÚJ (v106.0): CSAPAT TOTALS (Home/Away) PIACOK ===
    const safeTotalSims = 25000; // A szimulátorból tudjuk
    
    const evaluateTeamTotal = (marketKey: string, teamName: string, isHome: boolean) => {
        const market = oddsData.allMarkets.find(m => m.key === marketKey);
        if (!market || !market.outcomes) return;

        market.outcomes.forEach(outcome => {
            const lineValue = outcome.point;
            if (lineValue === undefined || lineValue === null) return;

            let simProb = 0;
            // Használjuk az új segédfüggvényt a 'sim.scores'-ból való számoláshoz
            if (outcome.name.toLowerCase().includes('over')) {
                simProb = calculateProbabilityFromScores(sim.scores, safeTotalSims, (h, a) => isHome ? h > lineValue : a > lineValue);
            } else if (outcome.name.toLowerCase().includes('under')) {
                simProb = calculateProbabilityFromScores(sim.scores, safeTotalSims, (h, a) => isHome ? h < lineValue : a < lineValue);
            } else {
                return;
            }

            const marketProb = _getImpliedProbability(outcome.price);
            const value = simProb - marketProb;
            
            // === v139.3: MINIMUM ODDS SZŰRÉS ===
            // === v140.0: EGYSÉGES FORMÁTUM ===
            const MIN_ODDS_FOR_VALUE = 1.8;
            if (value > MIN_VALUE_THRESHOLD && outcome.price >= MIN_ODDS_FOR_VALUE) {
                const direction = outcome.name.toLowerCase().includes('over') ? 'Over' : 'Under';
                const lineStr = String(lineValue);
                const formattedMarket = formatBettingMarket(`${teamName} ${direction} ${lineStr}`, sport);
                valueBets.push({
                    market: formattedMarket, // === v140.0: EGYSÉGES FORMÁTUM ===
                    odds: outcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        });
    };

    evaluateTeamTotal('home_total', homeTeam, true);
    evaluateTeamTotal('away_total', awayTeam, false);
    // =========================================================

    // 3. Piac: BTTS
    const bttsMarket = oddsData.allMarkets.find(m => m.key === 'btts');
    if (bttsMarket && bttsMarket.outcomes) {
        const yesOutcome = bttsMarket.outcomes.find(o => o.name.toLowerCase() === 'yes');
        const noOutcome = bttsMarket.outcomes.find(o => o.name.toLowerCase() === 'no');

        // === v139.3: MINIMUM ODDS SZŰRÉS ===
        const MIN_ODDS_FOR_VALUE = 1.8;
        
        if (yesOutcome) {
            const marketProb = _getImpliedProbability(yesOutcome.price);
            const simProb = simProbs['btts_yes'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD && yesOutcome.price >= MIN_ODDS_FOR_VALUE) {
                 valueBets.push({
                    market: formatBettingMarket('BTTS - Igen', sport), // === v140.0: EGYSÉGES FORMÁTUM ===
                    odds: yesOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        }
        if (noOutcome) {
            const marketProb = _getImpliedProbability(noOutcome.price);
            const simProb = simProbs['btts_no'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD && noOutcome.price >= MIN_ODDS_FOR_VALUE) {
                 valueBets.push({
                    market: formatBettingMarket('BTTS - Nem', sport), // === v140.0: EGYSÉGES FORMÁTUM ===
                    odds: noOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        }
    }
    
    if (valueBets.length > 0) {
        console.log(`[Model.ts/calculateValue] ${valueBets.length} db értékes fogadás azonosítva.`);
    }

    return valueBets;
}

// === 4. ÜGYNÖK (C) RÉSZE: Piaci Mozgás Elemzése (Változatlan) ===
export function analyzeLineMovement(
    currentOddsData: ICanonicalOdds | null, 
    openingOddsData: any, 
    sport: string, 
    homeTeam: string
): string {
    
    if (!currentOddsData || !currentOddsData.allMarkets || currentOddsData.allMarkets.length === 0) {
        return "Nincs elérhető jelenlegi piaci adat.";
    }
    if (!openingOddsData || Object.keys(openingOddsData).length === 0) {
        return "Nincs elérhető nyitó piaci adat.";
    }

    try {
        const h2hMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h');
        if (!h2hMarket || !h2hMarket.outcomes) {
            return "Nincs 1X2 piac a jelenlegi adatokban.";
        }

        const homeOutcome = h2hMarket.outcomes.find(o => o.name.toLowerCase() === 'home' || o.name === '1' || o.name.toLowerCase() === homeTeam.toLowerCase());
        const awayOutcome = h2hMarket.outcomes.find(o => o.name.toLowerCase() === 'away' || o.name === '2' || o.name.toLowerCase() !== homeTeam.toLowerCase());
        
        if (!homeOutcome || !awayOutcome) {
            return "Hiányos 1X2 piac a jelenlegi adatokban.";
        }

        const isHomeFavored = homeOutcome.price < awayOutcome.price;
        const favoredTeamName = isHomeFavored ? homeTeam : "Vendég";
        const currentFavoredPrice = isHomeFavored ? homeOutcome.price : awayOutcome.price;

        let openingPrice = null;
        const openingOddsKey = Object.keys(openingOddsData).find(key => 
            key.toLowerCase().includes(homeTeam.toLowerCase())
        );
        
        if (openingOddsKey && openingOddsData[openingOddsKey] && openingOddsData[openingOddsKey].length > 0) {
            const market = openingOddsData[openingOddsKey][0]; 
            if (isHomeFavored) {
                const outcome = market.outcomes.find((o: any) => o.name.toLowerCase() === homeTeam.toLowerCase());
                if(outcome) openingPrice = outcome.price;
            } else {
                const outcome = market.outcomes.find((o: any) => o.name.toLowerCase() !== homeTeam.toLowerCase());
                if(outcome) openingPrice = outcome.price;
            }
        }
        
        if (!openingPrice) {
            return "Nincs összehasonlítható nyitó odds adat.";
        }

        const openingFavoredPrice = parseFloat(String(openingPrice));
        if (isNaN(openingFavoredPrice)) {
            return "Nyitó odds formátum hiba.";
        }

        const change = currentFavoredPrice - openingFavoredPrice;
        const changePercent = (change / openingFavoredPrice) * 100;
        
        const changeThreshold = 5.0; 
        
        if (changePercent < -changeThreshold) {
            return `Jelentős odds-csökkenés (Line Movement) a favoritra (${favoredTeamName}): ${openingFavoredPrice.toFixed(2)} -> ${currentFavoredPrice.toFixed(2)} (${changePercent.toFixed(0)}%). A "Smart Money" erre a kimenetelre mozog.`;
        }
        if (changePercent > changeThreshold) {
            return `Jelentős odds-növekedés (Line Movement) a favorittal (${favoredTeamName}) szemben: ${openingFavoredPrice.toFixed(2)} -> ${currentFavoredPrice.toFixed(2)} (+${changePercent.toFixed(0)}%). A piac a favorit ellen mozog.`;
        }

        return `Nincs jelentős oddsmozgás (${changePercent.toFixed(0)}%).`;

    } catch (e: any) {
        console.error(`[Model.ts/analyzeLineMovement] Hiba: ${e.message}`);
        return "Hiba történt a piaci mozgás elemzésekor.";
    }
}

// === analyzePlayerDuels (Változatlan v104.0 - Stub) ===
export function analyzePlayerDuels(keyPlayers: any, sport: string): string | null {
    // TODO: Jövőbeli implementáció
    return null;
}
