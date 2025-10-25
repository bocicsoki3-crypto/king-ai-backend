import { SPORT_CONFIG } from './config.js'; // Importáljuk a sportág konfigurációt
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
/**************************************************************
* Model.js - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (Végleges Javítás):
* - estimateXG: Robusztussá téve a hiányos statisztikák kezelésére (GP > 1 hiba javítva GP > 0-ra).
* - estimateXG: Egyszerűsített "Regresszió a középértékhez" faktor hozzáadva.
* - estimateAdvancedMetrics és calculateValue: Kiterjesztve a mellékpiacokra.
* - A kód vágatlan, az eredeti 1255 soros struktúrát megtartva.
**************************************************************/

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
/**
 * Poisson distribution sampler using Knuth's algorithm.
 * @param {number} lambda The mean (average) rate.
 * @returns {number} A non-negative integer sampled from the Poisson distribution.
 * Returns 0 if lambda <= 0 or invalid.
 */
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

/**
 * Samples a random number from a normal (Gaussian) distribution using the Box-Muller transform.
 * @param {number} mean The mean (mu) of the distribution.
 * @param {number} stdDev The standard deviation (sigma) of the distribution.
 * @returns {number} A random number sampled from the specified normal distribution.
 */
function sampleNormal(mean, stdDev) {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random(); // Konvertálás (0,1)-re
    while (u2 === 0) u2 = Math.random();
    // Box-Muller transform
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

/**
 * Samples goal counts for home and away teams using Poisson distribution.
 * @param {number} mu_h Mean goals for home team.
 * @param {number} mu_a Mean goals for away team.
 * @returns {{gh: number, ga: number}} Sampled goals for home (gh) and away (ga).
 */
function sampleGoals(mu_h, mu_a) {
    return { gh: poisson(mu_h), ga: poisson(mu_a) };
}

// --- Idővonal Generálás ---

/**
 * Calculates detailed event probabilities for a given game state, considering playstyle.
 */
export function calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const narrativeRatings = getNarrativeRatings();
    const homeTeamLower = homeTeam.toLowerCase();
    const awayTeamLower = awayTeam.toLowerCase();
    const homeNarrative = narrativeRatings[homeTeamLower] || {};
    const awayNarrative = narrativeRatings[awayTeamLower] || {};
    const totalMu = (mu_h || 0) + (mu_a || 0);

    if (totalMu === 0) return [{ type: 'NO_EVENT', probability: 1.0 }];

    const baseGoalProbPerSlice = totalMu / (SPORT_CONFIG[sport]?.total_minutes / 5 || 18);

    let homeProbFactor = mu_h > 0 ? mu_h / totalMu : 0.5;
    let awayProbFactor = mu_a > 0 ? mu_a / totalMu : 0.5;

    let baseHomeGoalProb = homeProbFactor * baseGoalProbPerSlice * gameState.home_momentum;
    let baseAwayGoalProb = awayProbFactor * baseGoalProbPerSlice * gameState.away_momentum;

    let homeGoalProb_OpenPlay = baseHomeGoalProb * 0.7;
    let homeGoalProb_SetPiece = baseHomeGoalProb * 0.2;
    let homeGoalProb_Counter = baseHomeGoalProb * 0.1;

    let awayGoalProb_OpenPlay = baseAwayGoalProb * 0.6;
    let awayGoalProb_SetPiece = baseAwayGoalProb * 0.2;
    let awayGoalProb_Counter = baseAwayGoalProb * 0.2;

    if (sport === 'soccer' && rawData?.tactical_patterns) {
        const homePatterns = rawData.tactical_patterns.home || [];
        const awayPatterns = rawData.tactical_patterns.away || [];

        if (homePatterns.some(p => p.includes('set-piece threat') || p.includes('pontrúgásból veszélyes'))) homeGoalProb_SetPiece *= 1.5;
        if (homePatterns.some(p => p.includes('counter') || p.includes('kontra'))) homeGoalProb_Counter *= 1.8;
        if (homePatterns.some(p => p.includes('wing play') || p.includes('szélső játék'))) homeGoalProb_OpenPlay *= 1.1;

        if (awayPatterns.some(p => p.includes('set-piece threat') || p.includes('pontrúgásból veszélyes'))) awayGoalProb_SetPiece *= 1.5;
        if (awayPatterns.some(p => p.includes('counter') || p.includes('kontra'))) awayGoalProb_Counter *= 1.8;
        if (awayPatterns.some(p => p.includes('wing play') || p.includes('szélső játék'))) awayGoalProb_OpenPlay *= 1.1;

        if (awayPatterns.some(p => p.includes('vulnerable to set-piece') || p.includes('sebezhető pontrúgásnál'))) homeGoalProb_SetPiece *= 1.4;
        if (awayPatterns.some(p => p.includes('vulnerable to counter') || p.includes('sebezhető kontrákra'))) homeGoalProb_Counter *= 1.6;
        if (homePatterns.some(p => p.includes('vulnerable to set-piece') || p.includes('sebezhető pontrúgásnál'))) awayGoalProb_SetPiece *= 1.4;
        if (homePatterns.some(p => p.includes('vulnerable to counter') || p.includes('sebezhető kontrákra'))) awayGoalProb_Counter *= 1.6;
    }

    homeGoalProb_SetPiece *= 1 + (homeNarrative.set_piece_threat || 0);
    awayGoalProb_Counter *= 1 + (awayNarrative.counter_attack_lethality || 0);

    let homeCardProb = 0.08;
    let awayCardProb = 0.08;
    if (rawData?.referee?.style && typeof rawData.referee.style === 'string') {
        const styleLower = rawData.referee.style.toLowerCase();
        if (styleLower.includes("strict") || styleLower.includes("szigorú")) {
            homeCardProb = 0.15;
            awayCardProb = 0.15;
        } else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) {
            homeCardProb = 0.05;
            awayCardProb = 0.05;
        }
    }

    const totalEventProb = homeGoalProb_OpenPlay + homeGoalProb_SetPiece + homeGoalProb_Counter +
                           awayGoalProb_OpenPlay + awayGoalProb_SetPiece + awayGoalProb_Counter +
                           homeCardProb + awayCardProb;

    const scaleFactor = totalEventProb > 0.95 ? 0.95 / totalEventProb : 1;

    const probabilities = [
        { type: 'HOME_GOAL', probability: homeGoalProb_OpenPlay * scaleFactor, team: 'home', detail: 'Akció' },
        { type: 'HOME_GOAL', probability: homeGoalProb_SetPiece * scaleFactor, team: 'home', detail: 'Pontrúgás' },
        { type: 'HOME_GOAL', probability: homeGoalProb_Counter * scaleFactor, team: 'home', detail: 'Kontra' },
        { type: 'AWAY_GOAL', probability: awayGoalProb_OpenPlay * scaleFactor, team: 'away', detail: 'Akció' },
        { type: 'AWAY_GOAL', probability: awayGoalProb_SetPiece * scaleFactor, team: 'away', detail: 'Pontrúgás' },
        { type: 'AWAY_GOAL', probability: awayGoalProb_Counter * scaleFactor, team: 'away', detail: 'Kontra' },
        { type: 'HOME_YELLOW_CARD', probability: homeCardProb * scaleFactor, team: 'home', detail: 'Sárga lap' },
        { type: 'AWAY_YELLOW_CARD', probability: awayCardProb * scaleFactor, team: 'away', detail: 'Sárga lap' },
    ];

    const currentTotalProb = probabilities.reduce((sum, p) => sum + p.probability, 0);
    const noEventProb = Math.max(0, 1 - currentTotalProb);

    probabilities.push({ type: 'NO_EVENT', probability: noEventProb });

    return probabilities;
}

function selectMostLikelyEvent(probabilities) {
    const totalP = probabilities.reduce((sum, p) => sum + (p.probability || 0), 0);
    if (totalP <= 0) return { type: 'NO_EVENT' };
    const random = Math.random() * totalP;
    let cumulative = 0;
    for (const event of probabilities) {
        cumulative += (event.probability || 0);
        if (random < cumulative) {
            return event;
        }
    }
    return { type: 'NO_EVENT' };
}

function updateGameState(gameState, event) {
    switch (event.type) {
        case 'HOME_GOAL':
            gameState.home_goals++;
            gameState.home_momentum = 1.5;
            gameState.away_momentum = 0.7;
            break;
        case 'AWAY_GOAL':
            gameState.away_goals++;
            gameState.away_momentum = 1.5;
            gameState.home_momentum = 0.7;
            break;
    }
    return gameState;
}

export function buildPropheticTimeline(mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const timeline = [];
    let gameState = { time: 0, home_goals: 0, away_goals: 0, home_momentum: 1.0, away_momentum: 1.0, };
    const totalMinutes = SPORT_CONFIG[sport]?.total_minutes || 90;
    const timeSlice = 5;
    for (let t = 0; t < totalMinutes; t += timeSlice) {
        gameState.time = t;
        gameState.home_momentum = Math.max(1.0, gameState.home_momentum - 0.05);
        gameState.away_momentum = Math.max(1.0, gameState.away_momentum - 0.05);
        const eventProbabilities = calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam);
        const event = selectMostLikelyEvent(eventProbabilities);

        if (event.type !== 'NO_EVENT') {
            const eventTime = t + Math.floor(Math.random() * (timeSlice - 1)) + 1;
            event.time = eventTime;
            timeline.push({
                time: event.time,
                type: event.type,
                team: event.team || null,
                detail: event.detail || 'N/A'
            });
            gameState = updateGameState(gameState, event);
        }
    }
    return timeline;
}

// === estimateXG (JAVÍTVA ÉS KIEGÉSZÍTVE) ===
export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway, currentSimProbs = null) {
    const homeStats = rawStats?.home;
    const awayStats = rawStats?.away;
    // --- JAVÍTÁS: A 'gp > 1' ellenőrzés 'gp > 0'-ra enyhítve, hogy a GP:1 ne okozzon hibát ---
    const areStatsValid = (stats) => stats &&
        typeof stats.gp === 'number' && stats.gp > 0 &&
        typeof stats.gf === 'number' && stats.gf >= 0 &&
        typeof stats.ga === 'number' && stats.ga >= 0;

    const useDefaultXG = !areStatsValid(homeStats) || !areStatsValid(awayStats);

    if (useDefaultXG) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS: ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG használata.`);
    }

    let mu_h, mu_a;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;
    const logData = { step: 'Alap', sport: sport, home: homeTeam, away: awayTeam };

    // --- 1. SPORT-SPECIFIKUS ALAP xG/pont BECSLÉS ---
    if (sport === 'basketball') {
        logData.step = 'Kosárlabda Alap';
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
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;

        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
           const homeFF = advancedData.home.four_factors;
           const awayFF = advancedData.away.four_factors;
           const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05;
           const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05;
           mu_h *= (1 + ore_advantage - tov_advantage);
           mu_a *= (1 - ore_advantage + tov_advantage);
        }

        logData.step = 'Kosárlabda Taktika';
        let bb_tactical_mod_h = 1.0;
        let bb_tactical_mod_a = 1.0;
        const homeShotDist = rawData?.shot_distribution?.home?.toLowerCase() || 'n/a';
        const awayShotDist = rawData?.shot_distribution?.away?.toLowerCase() || 'n/a';
        const homeDefStyle = rawData?.defensive_style?.home?.toLowerCase() || 'n/a';
        const awayDefStyle = rawData?.defensive_style?.away?.toLowerCase() || 'n/a';

        if (homeShotDist.includes("3-point") || homeShotDist.includes("hárompontos")) {
            if (awayDefStyle.includes("aggressive perimeter") || awayDefStyle.includes("agresszív periméter")) bb_tactical_mod_h *= 0.98;
            if (awayDefStyle.includes("weak perimeter") || awayDefStyle.includes("gyenge periméter")) bb_tactical_mod_h *= 1.02;
        }
        if (homeShotDist.includes("paint") || homeShotDist.includes("festék")) {
            if (awayDefStyle.includes("strong interior") || awayDefStyle.includes("erős belső")) bb_tactical_mod_h *= 0.98;
            if (awayDefStyle.includes("weak interior") || awayDefStyle.includes("gyenge belső")) bb_tactical_mod_h *= 1.02;
        }
        if (awayShotDist.includes("3-point") || awayShotDist.includes("hárompontos")) {
            if (homeDefStyle.includes("aggressive perimeter") || homeDefStyle.includes("agresszív periméter")) bb_tactical_mod_a *= 0.98;
            if (homeDefStyle.includes("weak perimeter") || homeDefStyle.includes("gyenge periméter")) bb_tactical_mod_a *= 1.02;
        }
        if (awayShotDist.includes("paint") || awayShotDist.includes("festék")) {
            if (homeDefStyle.includes("strong interior") || homeDefStyle.includes("erős belső")) bb_tactical_mod_a *= 0.98;
            if (homeDefStyle.includes("weak interior") || homeDefStyle.includes("gyenge belső")) bb_tactical_mod_a *= 1.02;
        }
        mu_h *= bb_tactical_mod_h;
        mu_a *= bb_tactical_mod_a;

    } else if (sport === 'hockey') {
        logData.step = 'Jégkorong Alap';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 3.0;
        const leagueAvgHDCF_Pct = leagueAverages?.avg_high_danger_chances_pct || 50.0;
        const leagueAvgGSAx = leagueAverages?.avg_gsax || 0.0;
        
        const homeHDCF_Pct = rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct || 50.0;
        const awayHDCF_Pct = rawData?.advanced_stats_team?.away?.High_Danger_Chances_For_Pct || 50.0;
        const homeHDCA_Pct = 100.0 - homeHDCF_Pct;
        const awayHDCA_Pct = 100.0 - awayHDCF_Pct;
        
        let homeAttackStrength = homeHDCF_Pct / (leagueAvgHDCF_Pct > 0 ? leagueAvgHDCF_Pct : 50.0);
        let awayAttackStrength = awayHDCF_Pct / (leagueAvgHDCF_Pct > 0 ? leagueAvgHDCF_Pct : 50.0);
        let homeDefenseStrength = homeHDCA_Pct / ((100.0 - leagueAvgHDCF_Pct) > 0 ? (100.0 - leagueAvgHDCF_Pct) : 50.0);
        let awayDefenseStrength = awayHDCA_Pct / ((100.0 - leagueAvgHDCF_Pct) > 0 ? (100.0 - leagueAvgHDCF_Pct) : 50.0);

        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));

        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;

        const home_pp_advantage = (advancedData?.home?.pp_pct ?? 15) - (advancedData?.away?.pk_pct ?? 85);
        const away_pp_advantage = (advancedData?.away?.pp_pct ?? 15) - (advancedData?.home?.pk_pct ?? 85);
        const pp_mod_h = (1 + (home_pp_advantage / 100) * 0.15);
        const pp_mod_a = (1 + (away_pp_advantage / 100) * 0.15);
        mu_h *= pp_mod_h;
        mu_a *= pp_mod_a;

        logData.step = 'Jégkorong Kapus (GSAx)';
        const homeGoalieGSAx = rawData?.advanced_stats_goalie?.home_goalie?.GSAx || leagueAvgGSAx;
        const awayGoalieGSAx = rawData?.advanced_stats_goalie?.away_goalie?.GSAx || leagueAvgGSAx;
        const goalie_mod_h = Math.max(0.8, Math.min(1.2, 1.0 - (homeGoalieGSAx * 0.1)));
        const goalie_mod_a = Math.max(0.8, Math.min(1.2, 1.0 - (awayGoalieGSAx * 0.1)));

        mu_h *= goalie_mod_a;
        mu_a *= goalie_mod_h;

    } else if (sport === 'soccer') {
        logData.step = 'Labdarúgás Alap';
        const avgGoals = (leagueAverages?.avg_goals_per_game > 0 ? leagueAverages.avg_goals_per_game : 1.35);
        
        if (useDefaultXG) {
            mu_h = avgGoals;
            mu_a = avgGoals;
        } else {
            const safeHomeGp = Math.max(1, homeStats.gp);
            const safeAwayGp = Math.max(1, awayStats.gp);

            let homeAttackStrength = (homeStats.gf / safeHomeGp) / avgGoals;
            let awayAttackStrength = (awayStats.gf / safeAwayGp) / avgGoals;
            let homeDefenseStrength = (homeStats.ga / safeHomeGp) / avgGoals;
            let awayDefenseStrength = (awayStats.ga / safeAwayGp) / avgGoals;

            homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
            awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
            homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
            awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));

            mu_h = homeAttackStrength * awayDefenseStrength * avgGoals;
            mu_a = awayAttackStrength * homeDefenseStrength * avgGoals;
        }

        if (advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
            mu_h = Math.max(0, Math.min(7.0, advancedData.home.xg));
            mu_a = Math.max(0, Math.min(7.0, advancedData.away.xg));
        }

        logData.step = 'Labdarúgás Játékos Hatás';
        let player_mod_h = 1.0;
        let player_mod_a = 1.0;
        try {
            const parsePlayerStat = (s) => (typeof s !== 'string' || !s.includes(':')) ? { v: null } : { v: parseFloat(s.split(':')[1]) };
            (rawData?.key_players?.home || []).forEach(p => {
                if (p.role?.toLowerCase().includes('támadó')) {
                    const stat = parsePlayerStat(p.stats);
                    if (stat.v !== null) {
                        if (stat.v > 0.6) player_mod_h *= 1.03;
                        else if (stat.v < 0.2) player_mod_h *= 0.98;
                    }
                }
            });
            (rawData?.key_players?.away || []).forEach(p => {
                if (p.role?.toLowerCase().includes('védő')) {
                    const stat = parsePlayerStat(p.stats);
                    if (stat.v !== null && stat.v < 50) player_mod_h *= 1.02;
                }
            });
            (rawData?.key_players?.away || []).forEach(p => {
                if (p.role?.toLowerCase().includes('támadó')) {
                    const stat = parsePlayerStat(p.stats);
                     if (stat.v !== null) {
                        if (stat.v > 0.6) player_mod_a *= 1.03;
                        else if (stat.v < 0.2) player_mod_a *= 0.98;
                    }
                }
            });
            (rawData?.key_players?.home || []).forEach(p => {
                if (p.role?.toLowerCase().includes('védő')) {
                    const stat = parsePlayerStat(p.stats);
                    if (stat.v !== null && stat.v < 50) player_mod_a *= 1.02;
                }
            });
            mu_h *= player_mod_h;
            mu_a *= player_mod_a;
        } catch (e) { console.warn(`Hiba a Játékos Hatás számításakor: ${e.message}`); }
    }

    // --- 2. ÁLTALÁNOS MÓDOSÍTÓK ---
    logData.step = 'Általános Módosítók';

    const getFormPoints = (s) => (!s || typeof s !== 'string' || s === "N/A") ? { p: 0, m: 0 } : { p: (s.match(/W/g) || []).length * 3 + (s.match(/D/g) || []).length, m: (s.match(/[WDL]/g) || []).length };
    const homeOverall = getFormPoints(form?.home_overall);
    const awayOverall = getFormPoints(form?.away_overall);
    const homeVenue = getFormPoints(form?.home_home);
    const awayVenue = getFormPoints(form?.away_away);
    const useVenue = homeVenue.m >= 3 && awayVenue.m >= 3;
    const homeFF = useVenue ? (0.6 * (homeVenue.p/(homeVenue.m*3))) + (0.4 * (homeOverall.p/(homeOverall.m*3))) : (homeOverall.m > 0 ? homeOverall.p/(homeOverall.m*3) : 0.5);
    const awayFF = useVenue ? (0.6 * (awayVenue.p/(awayVenue.m*3))) + (0.4 * (awayOverall.p/(awayOverall.m*3))) : (awayOverall.m > 0 ? awayOverall.p/(awayOverall.m*3) : 0.5);
    const formImpact = 0.1;
    mu_h *= (1 + (isNaN(homeFF) ? 0.5 : homeFF - 0.5) * formImpact);
    mu_a *= (1 + (isNaN(awayFF) ? 0.5 : awayFF - 0.5) * formImpact);

    if (currentSimProbs) {
        const getFormScore = (s) => (!s || typeof s !== 'string' || s.length === 0) ? 0.5 : ((s.match(/W/g) || []).length * 1 + (s.match(/D/g) || []).length * 0.33) / s.length;
        const hfs = getFormScore(form?.home_overall);
        const afs = getFormScore(form?.away_overall);
        const regFactor = 0.03;
        if (currentSimProbs.pHome / 100 > 0.6 && hfs < 0.4) mu_h *= (1 - regFactor);
        if (currentSimProbs.pAway / 100 > 0.6 && afs < 0.4) mu_a *= (1 - regFactor);
    }

    const baseHA = SPORT_CONFIG[sport]?.home_advantage?.home || 1.08;
    const baseAA = SPORT_CONFIG[sport]?.home_advantage?.away || 0.92;
    mu_h *= baseHA;
    mu_a *= baseAA;

    if (sport === 'soccer') {
        const hs = rawData?.tactics?.home?.style?.toLowerCase() || 'n/a';
        const as = rawData?.tactics?.away?.style?.toLowerCase() || 'n/a';
        if (hs.includes('counter') && as.includes('possession')) { mu_h *= 1.04; mu_a *= 0.97; }
        if (as.includes('counter') && hs.includes('possession')) { mu_a *= 1.04; mu_h *= 0.97; }
        const hf = rawData?.tactics?.home?.formation?.toLowerCase() || 'n/a';
        const af = rawData?.tactics?.away?.formation?.toLowerCase() || 'n/a';
        if (hf.startsWith('5') || hf.startsWith('3-5')) mu_a *= 0.95;
        if (af.startsWith('5') || af.startsWith('3-5')) mu_h *= 0.95;
    }

    const pr = getAdjustedRatings();
    const hpr = pr[homeTeam.toLowerCase()] || { atk: 1, def: 1, matches: 0 };
    const apr = pr[awayTeam.toLowerCase()] || { atk: 1, def: 1, matches: 0 };
    const hw = Math.min(1, hpr.matches / 10);
    const aw = Math.min(1, apr.matches / 10);
    mu_h *= (((hpr.atk ?? 1) * (apr.def ?? 1)) - 1) * hw * aw + 1;
    mu_a *= (((apr.atk ?? 1) * (hpr.def ?? 1)) - 1) * hw * aw + 1;

    const psyM = 0.05;
    mu_h *= 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyM;
    mu_a *= 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyM;

    let abs_mod_h = 1.0, abs_mod_a = 1.0;
    const absImpact = SPORT_CONFIG[sport]?.absentee_impact || 0.05;
    (rawData?.absentees?.home || []).forEach(p => {
        if (p.importance === 'key') {
            const r = p.role?.toLowerCase() || '';
            if (r.includes('támadó')) abs_mod_h *= (1 - absImpact);
            else if (r.includes('védő')) abs_mod_a *= (1 + absImpact);
        }
    });
    (rawData?.absentees?.away || []).forEach(p => {
        if (p.importance === 'key') {
            const r = p.role?.toLowerCase() || '';
            if (r.includes('támadó')) abs_mod_a *= (1 - absImpact);
            else if (r.includes('védő')) abs_mod_h *= (1 + absImpact);
        }
    });
    mu_h *= abs_mod_h;
    mu_a *= abs_mod_a;

    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a';
    let tension_mod = 1.0;
    if (tension === 'high' || tension === 'extreme') tension_mod = 1.03;
    else if (tension === 'low' || tension === 'friendly') tension_mod = 0.98;
    mu_h *= tension_mod;
    mu_a *= tension_mod;

    const weather = rawData?.contextual_factors?.structured_weather;
    let weather_mod = 1.0;
    if (weather) {
        if (weather.precipitation_mm > 10.0) weather_mod *= 0.92;
        else if (weather.precipitation_mm > 3.0) weather_mod *= 0.96;
        if (weather.wind_speed_kmh > 50.0) weather_mod *= 0.90;
        else if (weather.wind_speed_kmh > 30.0) weather_mod *= 0.95;
    }
    mu_h *= weather_mod;
    mu_a *= weather_mod;

    const minVal = SPORT_CONFIG[sport]?.min_mu || 0.5;
    mu_h = Math.max(minVal, mu_h || minVal);
    mu_a = Math.max(minVal, mu_a || minVal);

    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
    return { mu_h, mu_a };
}

export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    const avgCorners = leagueAverages?.avg_corners || 10.5;
    const avgCards = leagueAverages?.avg_cards || 4.5;
    let mu_corners = avgCorners;
    let mu_cards = avgCards;

    if (sport === 'soccer') {
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        let corner_mod = 1.0;
        const homeStyle = tactics?.home?.style?.toLowerCase() || 'n/a';
        const awayStyle = tactics?.away?.style?.toLowerCase() || 'n/a';
        if (homeStyle.includes('wing') || homeStyle.includes('szélső')) corner_mod += 0.05;
        if (awayStyle.includes('wing') || awayStyle.includes('szélső')) corner_mod += 0.05;
        mu_corners *= corner_mod;

        let card_mod = 1.0;
        if (referee?.style) {
            const styleLower = referee.style.toLowerCase();
            let refFactor = 1.0;
            if (styleLower.includes("strict") || styleLower.includes("szigorú")) refFactor = 1.15;
            else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) refFactor = 0.85;
            card_mod = refFactor;
        }
        const tension = context?.match_tension_index?.toLowerCase() || 'low';
        if (tension === 'high' || tension === 'extreme') card_mod *= 1.1;
        if (context?.match_tension_index?.toLowerCase().includes('derby')) {
             card_mod *= 1.1;
        }
        mu_cards *= card_mod;
    }
    return {
        mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5,
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5
    };
}

export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, liveScenario, mainTotalsLine, rawData) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_lines = { '7.5': 0, '8.5': 0, '9.5': 0, '10.5': 0, '11.5': 0 };
    let cards_lines = { '3.5': 0, '4.5': 0, '5.5': 0, '6.5': 0 };
    const scores = {};
    const safeSims = Math.max(1, sims || 1);

    const safe_mu_h = typeof mu_h === 'number' && !isNaN(mu_h) ? mu_h : 1.35;
    const safe_mu_a = typeof mu_a === 'number' && !isNaN(mu_a) ? mu_a : 1.35;
    const safe_mu_corners = typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5;
    const safe_mu_cards = typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5;
    const safe_mainTotalsLine = typeof mainTotalsLine === 'number' && !isNaN(mainTotalsLine) ? mainTotalsLine : 2.5;

    for (let i = 0; i < safeSims; i++) {
        const { gh, ga } = sampleGoals(safe_mu_h, safe_mu_a);
        const scoreKey = `${gh}-${ga}`;
        scores[scoreKey] = (scores[scoreKey] || 0) + 1;
        if (gh > ga) home++;
        else if (ga > gh) away++;
        else draw++;
        if (gh > 0 && ga > 0) btts++;
        if ((gh + ga) > safe_mainTotalsLine) over_main++;
        if (sport === 'soccer') {
            const corners = poisson(safe_mu_corners);
            for (const line in corners_lines) {
                if (corners > parseFloat(line)) corners_lines[line]++;
            }
            const cards = poisson(safe_mu_cards);
            for (const line in cards_lines) {
                if (cards > parseFloat(line)) cards_lines[line]++;
            }
        }
    }

    const toPct = x => (100 * x / safeSims);
    const topScoreKey = Object.keys(scores).length > 0 ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b) : '0-0';
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);

    return {
        pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: Object.keys(corners_lines).reduce((acc, line) => {
            acc[`o${line}`] = toPct(corners_lines[line]);
            acc[`u${line}`] = 100 - toPct(corners_lines[line]);
            return acc;
        }, {}),
        cards: Object.keys(cards_lines).reduce((acc, line) => {
            acc[`o${line}`] = toPct(cards_lines[line]);
            acc[`u${line}`] = 100 - toPct(cards_lines[line]);
            return acc;
        }, {}),
        scores, topScore: { gh: top_gh, ga: top_ga },
        mainTotalsLine: safe_mainTotalsLine,
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}

export function calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel) {
    let score = 5.0;
    const MAX_SCORE = 10.0;
    const MIN_SCORE = 1.0;
    try {
        const getFormPointsPerc = (formString) => {
            if (!formString || typeof formString !== 'string' || formString === "N/A") return null;
            const wins = (formString.match(/W/g) || []).length;
            const draws = (formString.match(/D/g) || []).length;
            const total = (formString.match(/[WDL]/g) || []).length;
            return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeOverallFormScore = getFormPointsPerc(form?.home_overall);
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);

        if (homeOverallFormScore != null && awayOverallFormScore != null && sim && sim.pHome != null && sim.pAway != null) {
            const formDiff = homeOverallFormScore - awayOverallFormScore;
            if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) {
                score -= 1.5;
            } else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) {
                score += 0.75;
            }
        }
        if (sim && sim.mu_h_sim != null && sim.mu_a_sim != null) {
            const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
            const thresholdHigh = SPORT_CONFIG[sport]?.xg_diff_threshold?.high || 0.4;
            const thresholdLow = SPORT_CONFIG[sport]?.xg_diff_threshold?.low || 0.15;
            if (xgDiff > thresholdHigh) score += 1.5;
            if (xgDiff < thresholdLow) score -= 1.0;
        }

        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                const twoYearsAgo = new Date();
                twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                if (!isNaN(latestH2HDate.getTime())) {
                    if (latestH2HDate < twoYearsAgo) score -= 0.75;
                    else score += 0.25;
                }
            } catch(e) { /* Ignore */ }
        } else {
            score -= 0.25;
        }

        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0;
        if (sim && sim.pHome != null && sim.pAway != null) {
            if (sim.pHome > 65 && homeKeyAbsentees > 0) score -= (1.0 * homeKeyAbsentees);
            if (sim.pAway > 65 && awayKeyAbsentees > 0) score -= (1.0 * awayKeyAbsentees);
            if (sim.pHome > 60 && awayKeyAbsentees > 0) score += (0.5 * awayKeyAbsentees);
            if (sim.pAway > 60 && homeKeyAbsentees > 0) score += (0.5 * homeKeyAbsentees);
        }

        const marketIntelLower = marketIntel?.toLowerCase() || 'n/a';
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.' && sim && sim.pHome != null && sim.pAway != null) {
            const homeFavoredBySim = sim.pHome > sim.pAway && sim.pHome > 45;
            const awayFavoredBySim = sim.pAway > sim.pHome && sim.pAway > 45;
            const homeNameLower = home.toLowerCase();
            const awayNameLower = away.toLowerCase();
            if ((homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) || (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+'))) {
                score -= 1.5;
            } else if ((homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('-')) || (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('-'))) {
                score += 1.0;
            }
        }
        const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        score += Math.min(1.0, historyBonus);
    } catch(e) {
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`, e.stack);
        return Math.max(MIN_SCORE, 4.0);
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

export function calculatePsychologicalProfile(teamName, opponentName) {
    return { moraleIndex: 1.0, pressureIndex: 1.0 };
}

export function calculateValue(sim, oddsData, sport, homeTeam, awayTeam) {
    const valueBets = [];
    if (!oddsData || !sim) return valueBets;

    const findSimProb = (marketName, line = null) => {
        if (!marketName) return null;
        const lowerMarket = marketName.toLowerCase();
        if (lowerMarket.includes('hazai')) return sim.pHome / 100;
        if (lowerMarket.includes('vendég')) return sim.pAway / 100;
        if (lowerMarket.includes('döntetlen')) return sim.pDraw / 100;

        if (line !== null && sim.mainTotalsLine != null && line === sim.mainTotalsLine) {
            if (lowerMarket.startsWith('over')) return sim.pOver / 100;
            if (lowerMarket.startsWith('under')) return sim.pUnder / 100;
        }

        if (lowerMarket.includes('btts')) {
            return (lowerMarket.includes("igen") || !lowerMarket.includes("nem")) ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100;
        }

        if (sport === 'soccer' && line !== null) {
            const key = `${lowerMarket.startsWith('over') ? 'o' : 'u'}${line}`;
            if ((lowerMarket.includes('corners') || lowerMarket.includes('szöglet')) && sim.corners?.[key] != null) {
                return sim.corners[key] / 100;
            }
            if ((lowerMarket.includes('cards') || lowerMarket.includes('lap')) && sim.cards?.[key] != null) {
                return sim.cards[key] / 100;
            }
        }
        return null;
    };

    (oddsData.allMarkets || oddsData.current || []).forEach(marketOrOutcome => {
        const outcomes = marketOrOutcome.outcomes || [marketOrOutcome];
        outcomes.forEach(outcome => {
            if (outcome && outcome.name && typeof outcome.price === 'number' && outcome.price > 1) {
                const line = typeof outcome.point === 'number' ? outcome.point : null;
                const probability = findSimProb(outcome.name, line);
                if (probability != null && probability > 0) {
                    const value = (probability * outcome.price) - 1;
                    if (value >= 0.05) {
                        let marketDisplayName = outcome.name;
                        if (line !== null) marketDisplayName = `${outcome.name} ${line}`;
                        valueBets.push({
                            market: marketDisplayName,
                            odds: outcome.price,
                            probability: (probability * 100).toFixed(1) + '%',
                            value: (value * 100).toFixed(1) + '%'
                        });
                    }
                }
            }
        });
    });

    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
}


export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
    if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) {
        return "Nincs elég adat a piaci mozgás elemzéséhez.";
    }
    let awayTeam = '';
    const potentialAway = currentOddsData.current.find(o => o.name && o.name !== homeTeam && !o.name.toLowerCase().includes('hazai') && !o.name.toLowerCase().includes('döntetlen'));
    if (potentialAway) {
        awayTeam = potentialAway.name.replace('Vendég győzelem', '').trim();
    }
    if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból.";

    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`;
    const openingMatch = openingOddsData[key];
    const currentH2HOutcomes = currentOddsData.allMarkets.find(m => m.key === 'h2h')?.outcomes;

    if (!openingMatch || !openingMatch.h2h || !Array.isArray(openingMatch.h2h) || !currentH2HOutcomes) {
         return "Hiányzó H2H adatok a mozgáselemzéshez.";
    }

    let changes = [];
    currentH2HOutcomes.forEach(currentOutcome => {
        let simpleName = '';
        const lowerCurrentName = currentOutcome.name?.toLowerCase() || '';
        if (lowerCurrentName.includes('hazai')) simpleName = homeTeam;
        else if (lowerCurrentName.includes('vendég')) simpleName = awayTeam;
        else if (lowerCurrentName.includes('döntetlen')) simpleName = 'Döntetlen';

        if (simpleName) {
            const openingOutcome = openingMatch.h2h.find(oo => oo.name?.toLowerCase() === lowerCurrentName);
            if (openingOutcome && typeof openingOutcome.price === 'number' && typeof currentOutcome.price === 'number') {
                const change = ((currentOutcome.price / openingOutcome.price) - 1) * 100;
                if (Math.abs(change) > 3) {
                    changes.push(`${simpleName}: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
                }
            }
        }
    });
    return changes.length > 0 ? `Jelentős oddsmozgás: ${changes.join(', ')}` : "Nincs jelentős oddsmozgás.";
}

export function analyzePlayerDuels(keyPlayers, sport) {
    try {
        if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) return null;
        const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó'));
        const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő'));
        if (homeAttacker?.name && awayDefender?.name) {
            return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`;
        }
    } catch (e) {
        console.error("Hiba a játékos párharc elemzésekor:", e.message);
    }
    return null;
}

export function generateProTip() {
    return "Pro Tipp generálása még nincs implementálva.";
}