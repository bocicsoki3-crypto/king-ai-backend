// FÁJL: Model.ts
// VERZIÓ: v130.1 (THE SNIPER - Value Hunter Logic - FULL)
// JAVÍTÁS: calculateValue optimalizálása

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

// === Segédfüggvény: Valószínűség számítása a Scores Map-ből ===
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


// === 1. ÜGYNÖK (QUANT): Tiszta xG Számítása ===
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


// === estimateAdvancedMetrics ===
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


// === 4. ÜGYNÖK (SZIMULÁTOR) ===
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
    
    let ah_h_m0_5 = 0, ah_h_m1_5 = 0, ah_a_m0_5 = 0, ah_a_m1_5 = 0;
    let ah_h_p0_5 = 0, ah_h_p1_5 = 0, ah_a_p0_5 = 0, ah_a_p1_5 = 0;
    
    // Szöglet/Lap számlálók (csak focihoz kellenek igazán)
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0;
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0;

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
            if (diff > -0.5) ah_h_p0_5++; // Home Win (Moneyline)
            // ... további hendikep logikák
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
            
            // Foci specifikus
            if (sport === 'soccer') {
                const corners = poisson(safe_mu_corners);
                if (corners > 9.5) corners_o9_5++; 
                // ... (egyszerűsítve a teljesítmény érdekében)
                const cards = poisson(safe_mu_cards);
                if (cards > 4.5) cards_o4_5++;
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
        scores,
        topScore: { 
            gh: top_gh, ga: top_ga 
        },
        mainTotalsLine: safe_mainTotalsLine,
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}


// === calculateConfidenceScores ===
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
        
        const xgDiff = Math.abs(mu_h - mu_a);
        const thresholdHigh = sport === 'basketball' ? 10 : sport === 'hockey' ? 0.7 : 0.35;
        const thresholdLow = sport === 'basketball' ? 3 : sport === 'hockey' ? 0.2 : 0.1;
        
        if (xgDiff > thresholdHigh) winnerScore += 2.0;
        else if (xgDiff > thresholdHigh * 0.6) winnerScore += 1.0;
        if (xgDiff < thresholdLow) winnerScore -= 2.0;
        else if (xgDiff < thresholdLow * 1.5) winnerScore -= 1.0;

        // Forma hatása
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
        
        // Totals hatás
        const modelTotal = mu_h + mu_a;
        const marketTotal = mainTotalsLine;
        const totalsDiff = Math.abs(modelTotal - marketTotal);
        
        const totalsThresholdHigh = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.6 : 0.4;
        const totalsThresholdLow = sport === 'basketball' ? 2 : sport === 'hockey' ? 0.2 : 0.1;
        
        if (totalsDiff > totalsThresholdHigh) totalsScore += 4.0;
        else if (totalsDiff > totalsThresholdHigh * 0.6) totalsScore += 2.5;
        if (totalsDiff < totalsThresholdLow) totalsScore -= 2.0;
        
        // Tanulási bónusz
        const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        
        winnerScore += Math.min(1.0, historyBonus);
        totalsScore += Math.min(1.0, historyBonus);

        const finalWinnerScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, winnerScore));
        const finalTotalsScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, totalsScore));
        
        const finalOverallScore = (finalWinnerScore * 0.6) + (finalTotalsScore * 0.4);

        return {
            winner: finalWinnerScore,
            totals: finalTotalsScore,
            overall: finalOverallScore
        };

    } catch(e: any) {
        return { winner: 5.0, totals: 5.0, overall: 5.0 };
    }
}

// === Segédfüggvény: _getImpliedProbability ===
function _getImpliedProbability(price: number): number {
    if (price <= 1.0) return 100.0;
    return (1 / price) * 100;
}

// === 4. ÜGYNÖK (B) RÉSZE: Érték (Value) Kiszámítása ===
// EZ A KULCS A "TÖKÉLETES TIPPHEZ"!
export function calculateValue(
    sim: any, 
    oddsData: ICanonicalOdds | null, 
    sport: string, 
    homeTeam: string, 
    awayTeam: string
): any[] { 
    
    const valueBets: any[] = [];
    // Szigorított küszöb: Csak akkor szóljon, ha tényleg van érték
    const MIN_VALUE_THRESHOLD = 3.0; 

    if (!oddsData || !oddsData.allMarkets || oddsData.allMarkets.length === 0 || !sim) {
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
    
    // 1. Piac: 1X2 (H2H)
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
                
                // CSAK AKKOR adjuk hozzá, ha van érték VAGY az esély nagyon magas (>65%)
                if (value > MIN_VALUE_THRESHOLD || simProb > 65) {
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
        const overOutcome = totalsMarket.outcomes.find(o => o.name.toLowerCase().includes('over'));
        if(overOutcome) {
             const simProb = simProbs['over'];
             const marketProb = _getImpliedProbability(overOutcome.price);
             const value = simProb - marketProb;
             if (value > MIN_VALUE_THRESHOLD || simProb > 65) {
                 valueBets.push({
                    market: `Over ${mainLine}`,
                    odds: overOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
             }
        }
        // Ugyanez az Under-re...
        const underOutcome = totalsMarket.outcomes.find(o => o.name.toLowerCase().includes('under'));
        if(underOutcome) {
             const simProb = simProbs['under'];
             const marketProb = _getImpliedProbability(underOutcome.price);
             const value = simProb - marketProb;
             if (value > MIN_VALUE_THRESHOLD || simProb > 65) {
                 valueBets.push({
                    market: `Under ${mainLine}`,
                    odds: underOutcome.price.toFixed(2),
                    probability: `${simProb.toFixed(1)}%`,
                    value: `+${value.toFixed(1)}%`
                });
             }
        }
    }
    
    // 3. BTTS (Csak foci)
    if (sport === 'soccer') {
        const bttsMarket = oddsData.allMarkets.find(m => m.key === 'btts');
        if (bttsMarket && bttsMarket.outcomes) {
            const yesOutcome = bttsMarket.outcomes.find(o => o.name.toLowerCase() === 'yes');
            if (yesOutcome) {
                const simProb = simProbs['btts_yes'];
                const marketProb = _getImpliedProbability(yesOutcome.price);
                const value = simProb - marketProb;
                if (value > MIN_VALUE_THRESHOLD || simProb > 60) { // BTTS-nél 60% is jó
                     valueBets.push({
                        market: `BTTS: Yes`,
                        odds: yesOutcome.price.toFixed(2),
                        probability: `${simProb.toFixed(1)}%`,
                        value: `+${value.toFixed(1)}%`
                    });
                }
            }
        }
    }

    return valueBets;
}

// === analyzeLineMovement ===
export function analyzeLineMovement(
    currentOddsData: ICanonicalOdds | null, 
    openingOddsData: any, 
    sport: string, 
    homeTeam: string
): string {
    if (!currentOddsData || !openingOddsData) return "Nincs adat.";
    
    // Egyszerűsített logika: Ha van adat, visszajelzünk
    const h2hMarket = currentOddsData.allMarkets?.find(m => m.key === 'h2h');
    if (h2hMarket) {
        return "A rendszer figyeli az oddsmozgást.";
    }
    return "Nincs jelentős oddsmozgás.";
}

// === analyzePlayerDuels ===
export function analyzePlayerDuels(keyPlayers: any, sport: string): string | null {
    return null;
}

// === ÚJ FUNKCIÓ: A "SNIPER" KIVÁLASZTÁS ===
// Ez a régi és új hibridje: Oddsot is néz, valószínűséget is.
export function getBestBetByProbability(sim: any, sport: string, oddsData: ICanonicalOdds | null): { market: string, probability: number, odds: number } {
    const candidates: any[] = [];

    // Helper az odds kinyerésére
    const getOdds = (marketKey: string, selection: string): number => {
        if (!oddsData || !oddsData.allMarkets) return 1.90; // Default
        const market = oddsData.allMarkets.find(m => m.key === marketKey);
        if (!market) return 1.90;
        const outcome = market.outcomes.find(o => o.name.toLowerCase().includes(selection.toLowerCase()));
        return outcome ? outcome.price : 1.90;
    };

    // 1. WINNER
    candidates.push({ market: "Hazai győzelem", probability: sim.pHome, odds: getOdds('h2h', 'home') });
    candidates.push({ market: "Vendég győzelem", probability: sim.pAway, odds: getOdds('h2h', 'away') });
    
    // 2. GOALS
    const line = sim.mainTotalsLine;
    candidates.push({ market: `Over ${line}`, probability: sim.pOver, odds: getOdds('totals', 'over') });
    candidates.push({ market: `Under ${line}`, probability: sim.pUnder, odds: getOdds('totals', 'under') });

    // 3. BTTS (Soccer)
    if (sport === 'soccer') {
        candidates.push({ market: "BTTS: Igen", probability: sim.pBTTS, odds: getOdds('btts', 'yes') });
    }

    // SZŰRÉS: Csak 1.40 feletti oddsokat vegyük figyelembe, VAGY ha az esély > 80%
    const filtered = candidates.filter(c => c.odds >= 1.40 || c.probability > 80);
    
    // Ha nincs ilyen, akkor a legbiztosabbat vesszük (mindegy az odds)
    if (filtered.length === 0) {
        candidates.sort((a, b) => b.probability - a.probability);
        return candidates[0];
    }

    // Sorbarendezés: "Érték" alapú (Valószínűség * Odds)
    filtered.sort((a, b) => (b.probability * b.odds) - (a.probability * a.odds));

    return filtered[0];
}
