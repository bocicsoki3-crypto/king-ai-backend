// FÁJL: Model.ts
// VERZIÓ: v107.0 (Multi-Market Confidence & Hockey Hunt)
// MÓDOSÍTÁS (v107.0):
// 1. ÚJ LOGIKA: A 'calculateConfidenceScores' most már nem csak a Fő Piacot (Totals)
//    nézi, hanem megvizsgálja a Csapat Totals (Home/Away) piacokat is.
// 2. VADÁSZ ÜZEMMÓD: Ha a Csapat Totals piacokon nagyobb az eltérés (Value),
//    mint a Fő Piacon, akkor a rendszer a 'totals' bizalmi pontszámot
//    felhúzza a legjobb részpiac szintjére.
// 3. CÉL: Ha a meccs Totals (pl. Under 6) necces, de az egyik csapat gólja
//    (pl. Flames Over 2.5) "Tökéletes", akkor a rendszer azt a magas bizalmat adja vissza.

import { SPORT_CONFIG } from './config.js';
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
// Kanonikus típusok importálása
import type {
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds
} from './src/types/canonical.d.ts';

// === ÚJ IMPORT A STRATÉGIÁHOZ ===
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===

/**************************************************************
* Model.ts - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v107.0): Multi-Market Confidence & Hockey Hunt.
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


// === 1. ÜGYNÖK (QUANT): Tiszta xG Számítása (Változatlan) ===
export function estimatePureXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, 
    sport: string, 
    form: ICanonicalRawData['form'], 
    leagueAverages: any, 
    advancedData: any,
    strategy: ISportStrategy
): { pure_mu_h: number, pure_mu_a: number, source: string } {
    
    const options: XGOptions = {
        homeTeam,
        awayTeam,
        rawStats,
        form,
        leagueAverages,
        advancedData
    };
    const result = strategy.estimatePureXG(options);
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


// === MÓDOSÍTVA v107.0: calculateConfidenceScores (Hockey Multi-Market) ===
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
        } else { generalPenalty += 0.25; 
        }

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

        
        // --- A. GYŐZTES (WINNER) PIACOK BIZALMA ---
        const xgDiff = Math.abs(mu_h - mu_a);
        const thresholdHigh = sport === 'basketball' ? 10 : sport === 'hockey' ? 0.7 : 0.35;
        const thresholdLow = sport === 'basketball' ? 3 : sport === 'hockey' ? 0.2 : 0.1;
        
        if (xgDiff > thresholdHigh) winnerScore += 2.0;
        else if (xgDiff > thresholdHigh * 0.6) winnerScore += 1.0;
        if (xgDiff < thresholdLow) winnerScore -= 2.0;
        else if (xgDiff < thresholdLow * 1.5) winnerScore -= 1.0;

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
             const formDiff = homeOverallFormScore - awayOverallFormScore; 
             const simDiff = (mu_h - mu_a); 
             
             if ((simDiff > thresholdLow && formDiff < -0.2) || (simDiff < -thresholdLow && formDiff > 0.2)) {
                winnerScore -= 1.5; 
            }
            else if ((simDiff > thresholdHigh && formDiff > 0.25) || (simDiff < -thresholdHigh && formDiff < -0.25)) {
                winnerScore += 1.0; 
            }
        }
        
        // --- B. PONTOK (TOTALS) PIACOK BIZALMA (FŐPIAC) ---
        const modelTotal = mu_h + mu_a;
        const marketTotal = mainTotalsLine;
        const totalsDiff = Math.abs(modelTotal - marketTotal);
        
        const totalsThresholdHigh = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.9 : 0.4; // v106.1-hez képest kicsit finomítva
        const totalsThresholdLow = sport === 'basketball' ? 2 : sport === 'hockey' ? 0.4 : 0.1;
        
        let mainMarketBonus = 0;
        if (totalsDiff > totalsThresholdHigh) mainMarketBonus += 4.0;
        else if (totalsDiff > totalsThresholdHigh * 0.6) mainMarketBonus += 2.5;
        if (totalsDiff < totalsThresholdLow) mainMarketBonus -= 2.0;
        
        // === ÚJ (v107.0): CSAPAT TOTALS VADÁSZAT (HOCKEY/BASKETBALL) ===
        // Ha a fő piac bizonytalan (kicsi az eltérés), megvizsgáljuk a részpiacokat.
        let teamTotalsBonus = -99; // Alapértelmezett: nem találtunk jobbat

        if (sport === 'hockey' || sport === 'basketball') {
            // Becsült "piaci" vonalak a csapatokra (általában a Total fele)
            // Ezt pontosíthatnánk, ha az API visszaadná a Team Total vonalat, 
            // de most becsüljük a Main Line / 2 alapján.
            const impliedLineH = mainTotalsLine / 2;
            const impliedLineA = mainTotalsLine / 2;
            
            const diffH = Math.abs(mu_h - impliedLineH);
            const diffA = Math.abs(mu_a - impliedLineA);
            
            // Keresünk "Kiugró" értéket a csapatoknál
            const teamThreshold = totalsThresholdHigh * 0.8; // Kicsit alacsonyabb küszöb, mert a csapatgól kevesebb
            
            let bestTeamBonus = 0;
            if (diffH > teamThreshold) bestTeamBonus = 4.5; // Magasabb mint a Fő Piac bónusza!
            else if (diffH > teamThreshold * 0.6) bestTeamBonus = 3.0;
            
            if (diffA > teamThreshold) bestTeamBonus = Math.max(bestTeamBonus, 4.5);
            else if (diffA > teamThreshold * 0.6) bestTeamBonus = Math.max(bestTeamBonus, 3.0);
            
            if (bestTeamBonus > 0) {
                console.log(`[Model.ts v107.0] CSAPAT TOTALS VADÁSZAT: Találat! Jobb lehetőség a csapatoknál. (Bonus: ${bestTeamBonus})`);
                teamTotalsBonus = bestTeamBonus;
            }
        }
        
        // A 'totalsScore' a JOBBIK érték lesz: vagy a Fő Piac, vagy a legjobb Csapat Piac
        const bestMarketBonus = Math.max(mainMarketBonus, teamTotalsBonus > -90 ? teamTotalsBonus : -99);
        
        // Ha a Csapat Totals jobb volt, akkor azt használjuk, és nem vonunk le büntetést a fő piac bizonytalansága miatt
        if (teamTotalsBonus > mainMarketBonus) {
             totalsScore += teamTotalsBonus;
        } else {
             totalsScore += mainMarketBonus;
        }
        // === VÉGE (v107.0) ===
        
        winnerScore = winnerScore + generalBonus - generalPenalty;
        totalsScore = totalsScore + generalBonus - generalPenalty;

        const finalWinnerScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, winnerScore));
        const finalTotalsScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, totalsScore));
        
        // Ha a Totals (bármelyik) nagyon erős, az húzza fel az átlagot is
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
        const mainLine = String(sim.mainTotalsLine);
        
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
    
    // === 4. ÚJ (v106.0): CSAPAT TOTALS (Home/Away) PIACOK ===
    const safeTotalSims = 25000; // A szimulátorból tudjuk
    
    const evaluateTeamTotal = (marketKey: string, teamName: string, isHome: boolean) => {
        const market = oddsData.allMarkets.find(m => m.key === marketKey);
        if (!market || !market.outcomes) return;

        market.outcomes.forEach(outcome => {
            const line = outcome.point;
            if (line === undefined || line === null) return;

            let simProb = 0;
            // Használjuk az új segédfüggvényt a 'sim.scores'-ból való számoláshoz
            if (outcome.name.toLowerCase().includes('over')) {
                simProb = calculateProbabilityFromScores(sim.scores, safeTotalSims, (h, a) => isHome ? h > line : a > line);
            } else if (outcome.name.toLowerCase().includes('under')) {
                simProb = calculateProbabilityFromScores(sim.scores, safeTotalSims, (h, a) => isHome ? h < line : a < line);
            } else {
                return;
            }

            const marketProb = _getImpliedProbability(outcome.price);
            const value = simProb - marketProb;
            
            if (value > MIN_VALUE_THRESHOLD) {
                valueBets.push({
                    market: `${teamName} ${outcome.name}`, // Pl. "Warriors Over 115.5"
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
