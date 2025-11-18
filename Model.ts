// FÁJL: Model.ts
// VERZIÓ: v105.1 ("Bátrabb Bizalom" Finomhangolás)
// MÓDOSÍTÁS (v105.1):
// 1. FINOMHANGOLÁS: A 'calculateConfidenceScores' funkcióban a 'totalsThresholdHigh'
//    értékek csökkentve lettek kosárlabdánál (8 -> 5) és jégkorongnál (0.8 -> 0.6).
// 2. CÉL: A rendszer így már kisebb (de statisztikailag szignifikáns) eltérésekre
//    is magasabb bizalmi pontszámot (bónuszt) ad, elkerülve a "túl óvatos"
//    (pl. 4.8-as) értékeléseket egyértelműnek tűnő helyzetekben.
// 3. Megtartja a v105.0 összes strukturális változtatását (szétválasztott bizalom).

import { SPORT_CONFIG } from './config.js';
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
// Kanonikus típusok importálása
import type {
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds
} from './src/types/canonical.d.ts';

// === ÚJ IMPORT A STRATÉGIÁHOZ ===
// A .js kiterjesztések fontosak a Node.js importokhoz
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===

/**************************************************************
* Model.ts - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v105.1): Bátrabb Bizalom Finomhangolás.
**************************************************************/

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
/**
 * Poisson distribution sampler using Knuth's algorithm.
 */
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

/**
 * Samples a random number from a normal (Gaussian) distribution using the Box-Muller transform.
 */
function sampleNormal(mean: number, stdDev: number): number {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random(); // Konvertálás (0,1)-re
    while (u2 === 0) u2 = Math.random();
    // Box-Muller transform
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

/**
 * Samples goal counts for home and away teams using Poisson distribution.
 */
function sampleGoals(mu_h: number, mu_a: number): { gh: number, ga: number } {
    return { gh: poisson(mu_h), ga: poisson(mu_a) };
}


// === 1. ÜGYNÖK (QUANT): Tiszta xG Számítása (Változatlan v104.0) ===
/**
 * Ez a függvény most már csak egy "wrapper", ami meghívja
 * a sportág-specifikus stratégia megfelelő metódusát.
 */
export function estimatePureXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, 
    sport: string, // Megtartjuk a sport stringet a logoláshoz
    form: ICanonicalRawData['form'], 
    leagueAverages: any, 
    advancedData: any,
    strategy: ISportStrategy // === A stratégia objektum ===
): { pure_mu_h: number, pure_mu_a: number, source: string } {
    
    // A sport-specifikus logikát most már a stratégia végzi.
    const options: XGOptions = {
        homeTeam,
        awayTeam,
        rawStats,
        form,
        leagueAverages,
        advancedData
    };
    
    // Meghívjuk a megfelelő implementációt (SoccerStrategy, HockeyStrategy stb.)
    const result = strategy.estimatePureXG(options);

    // A logolás itt marad, a fő Model-ben
    console.log(`[Model.ts - 1. Ügynök] Tiszta xG (${sport}): H=${result.pure_mu_h.toFixed(2)}, A=${result.pure_mu_a.toFixed(2)} (Forrás: ${result.source})`);
    return result;
}


// === estimateAdvancedMetrics (Változatlan v104.0) ===
/**
 * Ez a függvény most már csak egy "wrapper", ami meghívja
 * a sportág-specifikus stratégia megfelelő metódusát.
 */
export function estimateAdvancedMetrics(
    rawData: ICanonicalRawData, 
    sport: string, // Megtartjuk a logoláshoz
    leagueAverages: any,
    strategy: ISportStrategy // === A stratégia objektum ===
): { mu_corners: number, mu_cards: number } {
    
    const options: AdvancedMetricsOptions = {
        rawData,
        leagueAverages
    };

    // Meghívjuk a megfelelő implementációt (SoccerStrategy, HockeyStrategy stb.)
    const result = strategy.estimateAdvancedMetrics(options);
    
    // A logolás itt marad
    console.log(`[Model.ts] Haladó metrikák (${sport}): Szöglet=${result.mu_corners.toFixed(2)}, Lap=${result.mu_cards.toFixed(2)}`);
    return result;
}


// === 4. ÜGYNÖK (SZIMULÁTOR) (Változatlan v104.0) ===
// (Ez a függvény tartalmazza a v95.1-es "AH Szimuláció Fix"-et)
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
    
    // === v95.1: AH Számlálók ===
    let ah_h_m0_5 = 0, ah_h_m1_5 = 0, ah_a_m0_5 = 0, ah_a_m1_5 = 0;
    let ah_h_p0_5 = 0, ah_h_p1_5 = 0, ah_a_p0_5 = 0, ah_a_p1_5 = 0;
    // =============================
    
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
            
            // === v95.1: AH Számítás (Kosárlabda) ===
            const diff = gh - ga;
            if (diff > -0.5) ah_h_p0_5++;
            if (diff > -1.5) ah_h_p1_5++;
            if (diff > 0.5) ah_h_m0_5++;
            if (diff > 1.5) ah_h_m1_5++;
            
            if (diff < 0.5) ah_a_p0_5++;
            if (diff < 1.5) ah_a_p1_5++;
            if (diff < -0.5) ah_a_m0_5++;
            if (diff < -1.5) ah_a_m1_5++;
            // ==========================================
        }
    } else { // Foci, Hoki
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(safe_mu_h, safe_mu_a);
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++;
            else if (ga > gh) away++;
            else draw++;
            if (gh > 0 && ga > 0) btts++;
            if ((gh + ga) > safe_mainTotalsLine) over_main++;
            
            // === v95.1: AH Számítás (Foci/Hoki) ===
            const diff = gh - ga;
            if (diff > -0.5) ah_h_p0_5++; // H +0.5
            if (diff > -1.5) ah_h_p1_5++; // H +1.5
            if (diff > 0.5) ah_h_m0_5++;  // H -0.5
            if (diff > 1.5) ah_h_m1_5++;  // H -1.5
            
            if (diff < 0.5) ah_a_p0_5++;  // A +0.5
            if (diff < 1.5) ah_a_p1_5++;  // A +1.5
            if (diff < -0.5) ah_a_m0_5++; // A -0.5
            if (diff < -1.5) ah_a_m1_5++; // A -1.5
            // ========================================

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
        // Hoki "Moneyline" szimuláció: A döntetleneket szétosztjuk
        const homeOTWinPct = 0.55; // Hazai pálya előnye hosszabbításban
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
        
        // === v95.1: pAH objektum ===
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
        // ======================================
        
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


// === MÓDOSÍTVA v105.0: calculateConfidenceScores ===
// A régi 'calculateModelConfidence' függvényt cseréli.
// Mostantól egy objektumot ad vissza, szétválasztott bizalommal.
export function calculateConfidenceScores(
    sport: string, 
    home: string, 
    away: string, 
    rawData: ICanonicalRawData, 
    form: ICanonicalRawData['form'], 
    mu_h: number, // Figyelem: A súlyozott mu_h-t (Agent 3) kapja
    mu_a: number, // Figyelem: A súlyozott mu_a-t (Agent 3) kapja
    mainTotalsLine: number,
    marketIntel: string
): { winner: number, totals: number, overall: number } {
    
    const MAX_SCORE = 10.0;
    const MIN_SCORE = 1.0;
    
    // Alap pontszámok
    let winnerScore = 5.0;
    let totalsScore = 5.0;

    try {
        // === 1. ÁLTALÁNOS MODIFIKÁTOROK (Mindkét piacra hatnak) ===
        
        let generalBonus = 0;
        let generalPenalty = 0;
        
        // H2H Adat (Frissesség)
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                 if (!isNaN(latestH2HDate.getTime())) {
                      if (latestH2HDate < twoYearsAgo) { generalPenalty += 0.75; // Elavult H2H
                    }
                      else { generalBonus += 0.25; // Friss, releváns H2H
                    }
                 }
            } catch(e: any) { console.warn("H2H dátum parse hiba:", e.message);
            }
        } else { generalPenalty += 0.25; // Nincs H2H adat
        }

        // Öntanuló Bónusz (Tapasztalat)
         const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        generalBonus += Math.min(1.0, historyBonus); // Max +1.0 bónusz tapasztalt csapatokra

        // Kulcsfontosságú hiányzók (Általános bizonytalanság)
        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        generalPenalty += (homeKeyAbsentees + awayKeyAbsentees) * 0.5; // 0.5 büntetés / kulcs hiányzó

        
        // === 2. PIAC-SPECIFIKUS LOGIKA ===

        // --- A. GYŐZTES (WINNER) PIACOK BIZALMA ---
        
        // xG Különbség (Magabiztosság)
        const xgDiff = Math.abs(mu_h - mu_a);
        const thresholdHigh = sport === 'basketball' ? 10 : sport === 'hockey' ? 0.7 : 0.35;
        const thresholdLow = sport === 'basketball' ? 3 : sport === 'hockey' ? 0.2 : 0.1;
        
        if (xgDiff > thresholdHigh) winnerScore += 2.0; // Magabiztos xG különbség
        else if (xgDiff > thresholdHigh * 0.6) winnerScore += 1.0;
        if (xgDiff < thresholdLow) winnerScore -= 2.0; // Túl szoros xG (Ez volt a 3.8-as hiba oka)
        else if (xgDiff < thresholdLow * 1.5) winnerScore -= 1.0;

        // Forma vs Szimuláció (Koherencia)
        const getFormPointsPerc = (formString: string | null | undefined): number | null => {
             if (!formString || typeof formString !== 'string' || formString === "N/A") return null;
            const wins = (formString.match(/W/g) || []).length;
             const draws = (formString.match(/D/g) || []).length;
             const total = (formString.match(/[WDL]/g) || []).length;
            return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeOverallFormScore = getFormPointsPerc(form?.home_overall);
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);
        
        if (homeOverallFormScore != null && awayOverallFormScore != null) {
             const formDiff = homeOverallFormScore - awayOverallFormScore; // Pozitív = Hazai jobb formában
             const simDiff = (mu_h - mu_a); // Pozitív = Szimuláció a hazait várja
             
             // Ellentmondás: A szimuláció favorizálja, de a forma rossz
             if ((simDiff > thresholdLow && formDiff < -0.2) || (simDiff < -thresholdLow && formDiff > 0.2)) {
                winnerScore -= 1.5; // Nagy ellentmondás
            }
            // Egyetértés: A szimuláció favorizálja ÉS a forma is jó
            else if ((simDiff > thresholdHigh && formDiff > 0.25) || (simDiff < -thresholdHigh && formDiff < -0.25)) {
                winnerScore += 1.0; // Koherencia
            }
        }
        
        // --- B. PONTOK (TOTALS) PIACOK BIZALMA ---
        
        // Totals Különbség (Modell vs Piac)
        const modelTotal = mu_h + mu_a;
        const marketTotal = mainTotalsLine;
        const totalsDiff = Math.abs(modelTotal - marketTotal);
        
        // === MÓDOSÍTÁS (v105.1): BÁTRABB KÜSZÖBÖK (Kosár: 8->5, Hoki: 0.8->0.6) ===
        const totalsThresholdHigh = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.6 : 0.4;
        const totalsThresholdLow = sport === 'basketball' ? 2 : sport === 'hockey' ? 0.2 : 0.1;
        
        if (totalsDiff > totalsThresholdHigh) totalsScore += 4.0; // Extrém eltérés a piactól (Most már a 4.45 pont is közel lesz ehhez)
        else if (totalsDiff > totalsThresholdHigh * 0.6) totalsScore += 2.5; // Közepes bónusz (Most már a 3.0 pont is megkapja)
        if (totalsDiff < totalsThresholdLow) totalsScore -= 2.0; // A modell egyetért a piaccal (nincs "value")
        
        // TODO: Forma alapú O/U bizalom (pl. mindkét csapat "Overes")


        // === 3. VÉGLEGESÍTÉS ===
        
        // Általános módosítók alkalmazása
        winnerScore = winnerScore + generalBonus - generalPenalty;
        totalsScore = totalsScore + generalBonus - generalPenalty;

        // Normalizálás (1.0 - 10.0)
        const finalWinnerScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, winnerScore));
        const finalTotalsScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, totalsScore));
        
        // Az "Overall" egy súlyozott átlag, de a 'winner' a fontosabb
        const finalOverallScore = (finalWinnerScore * 0.6) + (finalTotalsScore * 0.4);

        return {
            winner: finalWinnerScore,
            totals: finalTotalsScore,
            overall: finalOverallScore
        };

    } catch(e: any) {
        console.error(`Hiba bizalom számításakor (${home} vs ${away}): ${e.message}`, e.stack);
        return { winner: 4.0, totals: 4.0, overall: 4.0 }; // Hiba esetén alacsony-közepes bizalom
    }
}

// === Segédfüggvény: _getImpliedProbability (Változatlan v104.0) ===
/**
 * Segédfüggvény: Decimális odds átalakítása implikált valószínűséggé (vig nélkül).
 */
function _getImpliedProbability(price: number): number {
    if (price <= 1.0) return 100.0; // Érvénytelen odds
    return (1 / price) * 100;
}

// === 4. ÜGYNÖK (B) RÉSZE: Érték (Value) Kiszámítása (Változatlan v104.0) ===
export function calculateValue(
    sim: any, 
    oddsData: ICanonicalOdds | null, 
    sport: string, 
    homeTeam: string, 
    awayTeam: string
): any[] { 
    
    const valueBets: any[] = [];
    const MIN_VALUE_THRESHOLD = 5.0; // Minimum 5% észlelt érték

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
                
                if (value > MIN_VALUE_THRESHOLD) {
                    valueBets.push({
                        market: `1X2 - ${simKey.toUpperCase()}`,
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
        const mainLine = String(sim.mainTotalsLine); // Pl. "2.5"
        
        const overOutcome = totalsMarket.outcomes.find(o => 
            o.name.toLowerCase().includes('over') && o.name.includes(mainLine)
        );
        const underOutcome = totalsMarket.outcomes.find(o => 
            o.name.toLowerCase().includes('under') && o.name.includes(mainLine)
        );

        if (overOutcome) {
            const marketProb = _getImpliedProbability(overOutcome.price);
            const simProb = simProbs['over'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD) {
                 valueBets.push({
                    market: `Over ${mainLine}`,
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
            if (value > MIN_VALUE_THRESHOLD) {
                 valueBets.push({
                    market: `Under ${mainLine}`,
                    odds: underOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
            }
        }
    }

    // 3. Piac: BTTS (Both Teams To Score)
    const bttsMarket = oddsData.allMarkets.find(m => m.key === 'btts');
    if (bttsMarket && bttsMarket.outcomes) {
        const yesOutcome = bttsMarket.outcomes.find(o => o.name.toLowerCase() === 'yes');
        const noOutcome = bttsMarket.outcomes.find(o => o.name.toLowerCase() === 'no');

        if (yesOutcome) {
            const marketProb = _getImpliedProbability(yesOutcome.price);
            const simProb = simProbs['btts_yes'];
            const value = simProb - marketProb;
            if (value > MIN_VALUE_THRESHOLD) {
                 valueBets.push({
                    market: `BTTS: Yes`,
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
            if (value > MIN_VALUE_THRESHOLD) {
                 valueBets.push({
                    market: `BTTS: No`,
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

// === 4. ÜGYNÖK (C) RÉSZE: Piaci Mozgás Elemzése (Változatlan v104.0) ===
export function analyzeLineMovement(
    currentOddsData: ICanonicalOdds | null, 
    openingOddsData: any, // Ez a 'sessionStorage'-ból jön, nincs garantált típusa
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

        // 1. Jelenlegi favorit azonosítása
        const homeOutcome = h2hMarket.outcomes.find(o => o.name.toLowerCase() === 'home' || o.name === '1' || o.name.toLowerCase() === homeTeam.toLowerCase());
        const awayOutcome = h2hMarket.outcomes.find(o => o.name.toLowerCase() === 'away' || o.name === '2' || o.name.toLowerCase() !== homeTeam.toLowerCase());
        
        if (!homeOutcome || !awayOutcome) {
            return "Hiányos 1X2 piac a jelenlegi adatokban.";
        }

        const isHomeFavored = homeOutcome.price < awayOutcome.price;
        const favoredTeamName = isHomeFavored ? homeTeam : "Vendég";
        const currentFavoredPrice = isHomeFavored ? homeOutcome.price : awayOutcome.price;

        // 2. Nyitó oddsok keresése (strukturálatlan adatokból)
        let openingPrice = null;
        const openingOddsKey = Object.keys(openingOddsData).find(key => 
            key.toLowerCase().includes(homeTeam.toLowerCase())
        );
        
        if (openingOddsKey && openingOddsData[openingOddsKey] && openingOddsData[openingOddsKey].length > 0) {
            const market = openingOddsData[openingOddsKey][0]; // Feltételezzük az első piacot
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

        // 3. Elemzés
        const openingFavoredPrice = parseFloat(String(openingPrice));
        if (isNaN(openingFavoredPrice)) {
            return "Nyitó odds formátum hiba.";
        }

        const change = currentFavoredPrice - openingFavoredPrice;
        const changePercent = (change / openingFavoredPrice) * 100;
        
        const changeThreshold = 5.0; // 5% mozgás
        
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
