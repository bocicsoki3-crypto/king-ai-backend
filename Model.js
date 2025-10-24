import { SPORT_CONFIG } from './config.js';

// ===================================================================================
// ===                                                                             ===
// ===               A D A T M O D E L L E Z É S  (A RENDSZER AGYA)                  ===
// ===     VÉGLEGES JAVÍTÁS: Helyes gólszimulációs szintaktika a NaN hiba ellen.     ===
// ===                                                                             ===
// ===================================================================================


// --- MATEMATIKAI SEGÉDFÜGGVÉNYEK ---

function factorial(num) {
    if (num < 0) return -1;
    if (num === 0) return 1;
    let result = 1;
    for (let i = num; i > 1; i--) {
        result *= i;
    }
    return result;
}

function poissonProbability(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function poisson(lambda) {
    if (lambda === null || typeof lambda !== 'number' || isNaN(lambda) || lambda < 0) return 0;
    if (lambda === 0) return 0;
    let l = Math.exp(-lambda), k = 0, p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > l);
    return k - 1;
}

function sampleNormal(mean, stdDev) {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}


// --- FŐ MODELLEZÉSI FÜGGVÉNYEK ---

export function calculateProbabilities(mu_h, mu_a, mainTotalsLine) {
    if (typeof mu_h !== 'number' || typeof mu_a !== 'number' || mu_h < 0 || mu_a < 0) {
        console.error(`Érvénytelen mu értékek a calculateProbabilities-ben: mu_h=${mu_h}, mu_a=${mu_a}`);
        return { pHome: 33.3, pDraw: 33.3, pAway: 33.3, pOver: 50.0, pUnder: 50.0, pBTTS: 50.0 };
    }

    const MAX_GOALS = 8;
    let scoreMatrix = Array(MAX_GOALS + 1).fill(0).map(() => Array(MAX_GOALS + 1).fill(0));

    for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {
            const homeProb = poissonProbability(h, mu_h);
            const awayProb = poissonProbability(a, mu_a);
            scoreMatrix[h][a] = homeProb * awayProb;
        }
    }

    let pHome = 0, pDraw = 0, pAway = 0, pOver = 0, pBTTS = 0;

    for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {
            const prob = scoreMatrix[h][a];
            if (h > a) pHome += prob;
            else if (a > h) pAway += prob;
            else pDraw += prob;

            if ((h + a) > mainTotalsLine) pOver += prob;
            if (h > 0 && a > 0) pBTTS += prob;
        }
    }

    const totalProb = pHome + pDraw + pAway;
    if (totalProb > 0) {
        pHome = (pHome / totalProb) * 100;
        pDraw = (pDraw / totalProb) * 100;
        pAway = (pAway / totalProb) * 100;
    }

    return {
        pHome: pHome,
        pDraw: pDraw,
        pAway: pAway,
        pOver: pOver * 100,
        pUnder: (1 - pOver) * 100,
        pBTTS: pBTTS * 100
    };
}

export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData) {
    const homeStats = rawStats?.home, awayStats = rawStats?.away;
    const areStatsValid = (stats) => stats &&
        typeof stats.gp === 'number' && stats.gp > 0 &&
        typeof stats.gf === 'number' && stats.gf >= 0 &&
        typeof stats.ga === 'number' && stats.ga >= 0;

    if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS: ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG használata.`);
        const defaultGoals = SPORT_CONFIG[sport]?.avg_goals || 1.35;
        const homeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.08;
        const awayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 0.92;
        return { mu_h: defaultGoals * homeAdv, mu_a: defaultGoals * awayAdv };
    }

    let mu_h, mu_a;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;

    if (sport === 'basketball') {
        const avgOffRating = leagueAverages?.avg_offensive_rating || 110;
        const avgDefRating = leagueAverages?.avg_defensive_rating || 110;
        const avgPace = leagueAverages?.avg_pace || 98;
        const homePace = advancedData?.home?.pace || avgPace;
        const awayPace = advancedData?.away?.pace || avgPace;
        const expectedPace = (homePace + awayPace) / 2;
        const homeOffRating = advancedData?.home?.offensive_rating || avgOffRating;
        const awayOffRating = advancedData?.away?.offensive_rating || avgOffRating;
        const homeDefRating = advancedData?.home?.defensive_rating || avgDefRating;
        const awayDefRating = advancedData?.away?.defensive_rating || avgDefRating;
        mu_h = (homeOffRating / avgOffRating) * (awayDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
        mu_a = (awayOffRating / avgOffRating) * (homeDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
    } else {
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || SPORT_CONFIG[sport]?.avg_goals || 1.35;
        
        let homeAttackStrength = (homeStats.gf / homeStats.gp) / avgGoalsInLeague;
        let awayAttackStrength = (awayStats.gf / awayStats.gp) / avgGoalsInLeague;
        let homeDefenseStrength = (homeStats.ga / homeStats.gp) / avgGoalsInLeague;
        let awayDefenseStrength = (awayStats.ga / awayStats.gp) / avgGoalsInLeague;
        
        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));

        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
    }

    const getFormPoints = (formString) => {
        if (!formString || typeof formString !== 'string') return 0;
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        return wins * 3 + draws * 1;
    };
    const homeOverallFormPts = getFormPoints(form?.home_overall);
    const awayOverallFormPts = getFormPoints(form?.away_overall);
    const formDiff = (homeOverallFormPts / 15) - (awayOverallFormPts / 15);
    const formImpact = 0.10;
    mu_h *= (1 + (formDiff * formImpact));
    mu_a *= (1 - (formDiff * formImpact));

    const home_adv_mod = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0;
    const away_adv_mod = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
    mu_h *= home_adv_mod;
    mu_a *= away_adv_mod;

    const impactAnalysis = rawData?.absentee_impact_analysis?.toLowerCase();
    let homeImpact = 1.0, awayImpact = 1.0;
    if (impactAnalysis && impactAnalysis !== "nincs jelentős hatás.") {
        if (impactAnalysis.includes(homeTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) homeImpact -= 0.07;
        if (impactAnalysis.includes(awayTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) awayImpact -= 0.07;
        mu_h *= homeImpact;
        mu_a *= awayImpact;
    }
    
    const minVal = sport === 'basketball' ? 80 : (sport === 'hockey' ? 1.5 : 0.5);
    const maxVal = sport === 'basketball' ? 200 : (sport === 'hockey' ? 8 : 6);
    
    mu_h = Math.max(minVal, Math.min(maxVal, mu_h || minVal));
    mu_a = Math.max(minVal, Math.min(maxVal, mu_a || minVal));
    
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
    return { mu_h, mu_a };
}

export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, mainTotalsLine) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_lines = { '7.5': 0, '8.5': 0, '9.5': 0, '10.5': 0, '11.5': 0 };
    let cards_lines = { '3.5': 0, '4.5': 0, '5.5': 0, '6.5': 0 };
    const scores = {};
    const safeSims = Math.max(1, sims || 1);

    if (sport === 'basketball') {
        const stdDev = 11.5;
        for (let i = 0; i < safeSims; i++) {
            const gh = Math.round(sampleNormal(mu_h, stdDev));
            const ga = Math.round(sampleNormal(mu_a, stdDev));
            if (gh > ga) home++; else if (ga > gh) away++;
            if ((gh + ga) > mainTotalsLine) over_main++;
        }
        draw = 0;
    } else {
        for (let i = 0; i < safeSims; i++) {
            // === EZ VOLT A HIBA, ITT A JAVÍTÁS ===
            const gh = poisson(mu_h);
            const ga = poisson(mu_a);
            // =====================================
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if (gh > 0 && ga > 0) btts++;
            if (mainTotalsLine != null && (gh + ga) > mainTotalsLine) over_main++;
            
            if (sport === 'soccer') {
                const corners = poisson(mu_corners);
                for (const line in corners_lines) { if (corners > parseFloat(line)) corners_lines[line]++; }
                const cards = poisson(mu_cards);
                for (const line in cards_lines) { if (cards > parseFloat(line)) cards_lines[line]++; }
            }
        }
    }
    
    const toPct = x => (100 * x / safeSims);
    const topScoreKey = Object.keys(scores).length > 0 ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0') : '0-0';
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);

    const sim_corners = {};
    for (const line in corners_lines) { sim_corners[`o${line}`] = toPct(corners_lines[line]); }
    const sim_cards = {};
    for (const line in cards_lines) { sim_cards[`o${line}`] = toPct(cards_lines[line]); }

    return {
        pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: sim_corners,
        cards: sim_cards,
        topScore: { gh: top_gh, ga: top_ga },
        mainTotalsLine: mainTotalsLine,
        mu_h_sim: mu_h, mu_a_sim: mu_a, mu_corners_sim: mu_corners, mu_cards_sim: mu_cards
    };
}

export function calculateModelConfidence(sport, home, away, rawData, form, sim) {
    let score = 5.0;
    const MAX_SCORE = 10.0, MIN_SCORE = 1.0;
    
    try {
        const getFormScore = (formString) => {
            if (!formString || typeof formString !== 'string') return null;
            const wins = (formString.match(/W/g) || []).length;
            const draws = (formString.match(/D/g) || []).length;
            const total = (formString.match(/[WDL]/g) || []).length;
            return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeFormScore = getFormScore(form?.home_overall);
        const awayFormScore = getFormScore(form?.away_overall);

        if (homeFormScore != null && awayFormScore != null) {
            const formDiff = homeFormScore - awayFormScore;
            const simDiff = (sim.pHome - sim.pAway) / 100;
            if (Math.sign(formDiff) === Math.sign(simDiff) && Math.abs(simDiff) > 0.2) {
                score += 1.0;
            }
            if (Math.abs(formDiff - simDiff) > 0.5) {
                score -= 1.5;
            }
        }

        const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
        const highDiffThreshold = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.5;
        const lowDiffThreshold = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
        if (xgDiff > highDiffThreshold) score += 1.5;
        if (xgDiff < lowDiffThreshold) score -= 1.0;

        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0;
        if (sim.pHome > 65 && homeKeyAbsentees > 0) score -= (1.0 * homeKeyAbsentees);
        if (sim.pAway > 65 && awayKeyAbsentees > 0) score -= (1.0 * awayKeyAbsentees);

    } catch (e) {
        console.error(`Hiba a model konfidencia számításakor (${home} vs ${away}): ${e.message}`);
        return 4.0;
    }
    
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

export function calculateValue(sim, oddsData) {
    const valueBets = [];
    if (!oddsData || !oddsData.current || !sim) { return valueBets; }

    const marketProbMap = {
        'hazai győzelem': sim.pHome / 100,
        'vendég győzelem': sim.pAway / 100,
        'döntetlen': sim.pDraw / 100,
        [`over ${sim.mainTotalsLine}`]: sim.pOver / 100,
        [`under ${sim.mainTotalsLine}`]: sim.pUnder / 100,
    };

    oddsData.current.forEach(outcome => {
        const lowerMarketName = outcome.name.toLowerCase().replace(' gól', '').trim();
        const probability = marketProbMap[lowerMarketName];
        
        if (probability && typeof outcome.price === 'number' && outcome.price > 1) {
            const value = (probability * outcome.price) - 1;
            if (value > 0.05) {
                valueBets.push({ 
                    market: outcome.name, 
                    odds: outcome.price, 
                    probability: (probability * 100).toFixed(1) + '%', 
                    value: (value * 100).toFixed(1) + '%' 
                });
            }
        }
    });

    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
}

export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    let mu_corners = leagueAverages?.avg_corners || 10.5;
    let mu_cards = leagueAverages?.avg_cards || 4.5;
    return { mu_corners, mu_cards };
}

export function generateProTip(probabilities, odds, market) {
    return "Pro Tipp generálása még nincs implementálva.";
}

export function calculatePsychologicalProfile(teamName, opponentName) {
    return { moraleIndex: 1.0, pressureIndex: 1.0 };
}

export function analyzePlayerDuels(keyPlayers, sport) {
    if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) return null;
    const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó'));
    const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő'));
    if (homeAttacker?.name && awayDefender?.name) {
        return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`;
    }
    return null;
}

export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
    return "Nincs elég adat a piaci mozgás elemzéséhez.";
}

export function buildPropheticTimeline(mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    return [];
}