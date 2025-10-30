// --- JAVÍTOTT Model.js (v42 - xG Integrációval) ---

import { SPORT_CONFIG } from './config.js';
// Importáljuk a sportág konfigurációt
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
/**************************************************************
* Model.js - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v42 - xG Integráció):
* - estimateXG: A 'soccer' logika frissítve. Most már
* elsőbbséget ad a 'datafetch.js'-ből érkező valós, mért
* xG adatoknak (az 'advancedData' mezőből).
* - Ha nem érkezik valós xG, a függvény visszavált
* a korábbi, statisztikán alapuló becslési modellre.
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
    // Hibás lambda -> 0
    if (lambda === 0) return 0;
    // Lambda 0 -> 0
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
    // Itt is a kisbetűs 'poisson' függvényt használjuk, ahogy kell
    return { gh: poisson(mu_h), ga: poisson(mu_a) };
}

// --- Idővonal Generálás ---

// --- MÓDOSÍTÁS KEZDETE: Részletesebb eseményvalószínűségek (Foci) ---
/**
 * Calculates detailed event probabilities for a given game state, considering playstyle.
 * Needs getNarrativeRatings to be implemented correctly.
 */
// Exportálva, mert buildPropheticTimeline hívja
export function calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const narrativeRatings = getNarrativeRatings();
    // Most már valós adatot hív
    const homeTeamLower = homeTeam.toLowerCase();
    const awayTeamLower = awayTeam.toLowerCase();
    const homeNarrative = narrativeRatings[homeTeamLower] || {};
    const awayNarrative = narrativeRatings[awayTeamLower] || {};
    const totalMu = (mu_h || 0) + (mu_a || 0);
    // Handle potential null/undefined mu
    if (totalMu === 0) return [{ type: 'NO_EVENT', probability: 1.0 }];
    // Avoid division by zero
    const baseGoalProbPerSlice = totalMu / (SPORT_CONFIG[sport]?.total_minutes / 5 || 18);
    // Base goal probability per time slice, default 18 (90/5)

    // Alap eloszlás (ha nincs specifikus adat)
    let homeProbFactor = mu_h > 0 ?
    mu_h / totalMu : 0.5;
    let awayProbFactor = mu_a > 0 ? mu_a / totalMu : 0.5;
    let baseHomeGoalProb = homeProbFactor * baseGoalProbPerSlice * gameState.home_momentum;
    let baseAwayGoalProb = awayProbFactor * baseGoalProbPerSlice * gameState.away_momentum;
    // Eseménytípusok inicializálása
    let homeGoalProb_OpenPlay = baseHomeGoalProb * 0.7;
    // Alapból 70% akcióból
    let homeGoalProb_SetPiece = baseHomeGoalProb * 0.2;
    // 20% pontrúgásból
    let homeGoalProb_Counter = baseHomeGoalProb * 0.1;
    // 10% kontrából (hazai csapatnál ritkább)

    let awayGoalProb_OpenPlay = baseAwayGoalProb * 0.6;
    // Vendég 60% akcióból
    let awayGoalProb_SetPiece = baseAwayGoalProb * 0.2;
    // 20% pontrúgásból
    let awayGoalProb_Counter = baseAwayGoalProb * 0.2;
    // 20% kontrából (vendégnél gyakoribb)

    // Stílus-alapú módosítók (ha vannak adatok)
    if (sport === 'soccer' && rawData?.tactical_patterns) {
        const homePatterns = rawData.tactical_patterns.home ||
        [];
        const awayPatterns = rawData.tactical_patterns.away || [];

        // Hazai támadás módosítók
        if (homePatterns.some(p => p.includes('set-piece threat') || p.includes('pontrúgásból veszélyes'))) homeGoalProb_SetPiece *= 1.5;
        if (homePatterns.some(p => p.includes('counter') || p.includes('kontra'))) homeGoalProb_Counter *= 1.8;
        if (homePatterns.some(p => p.includes('wing play') || p.includes('szélső játék'))) homeGoalProb_OpenPlay *= 1.1;
        // Szélen több az akció

        // Vendég támadás módosítók
        if (awayPatterns.some(p => p.includes('set-piece threat') || p.includes('pontrúgásból veszélyes'))) awayGoalProb_SetPiece *= 1.5;
        if (awayPatterns.some(p => p.includes('counter') || p.includes('kontra'))) awayGoalProb_Counter *= 1.8;
        if (awayPatterns.some(p => p.includes('wing play') || p.includes('szélső játék'))) awayGoalProb_OpenPlay *= 1.1;
        // Kereszt-módosítók (védelem gyengeségei)
         if (awayPatterns.some(p => p.includes('vulnerable to set-piece') || p.includes('sebezhető pontrúgásnál'))) homeGoalProb_SetPiece *= 1.4;
        if (awayPatterns.some(p => p.includes('vulnerable to counter') || p.includes('sebezhető kontrákra'))) homeGoalProb_Counter *= 1.6;
        if (homePatterns.some(p => p.includes('vulnerable to set-piece') || p.includes('sebezhető pontrúgásnál'))) awayGoalProb_SetPiece *= 1.4;
        if (homePatterns.some(p => p.includes('vulnerable to counter') || p.includes('sebezhető kontrákra'))) awayGoalProb_Counter *= 1.6;
    }

    // Narratív módosítók (meglévő)
    homeGoalProb_SetPiece *= 1 + (homeNarrative.set_piece_threat || 0);
    awayGoalProb_Counter *= 1 + (awayNarrative.counter_attack_lethality || 0);
    // Lapok valószínűsége (meglévő)
    let homeCardProb = 0.08;
    let awayCardProb = 0.08;
    // Javítás: A referee objektum létezését is ellenőrizzük
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


    // Összesítés és normalizálás (hogy a summa <= 1 legyen)
    const totalEventProb = homeGoalProb_OpenPlay + homeGoalProb_SetPiece + homeGoalProb_Counter +
                           awayGoalProb_OpenPlay + awayGoalProb_SetPiece + awayGoalProb_Counter +
                           homeCardProb + awayCardProb;
    const scaleFactor = totalEventProb > 0.95 ? 0.95 / totalEventProb : 1;
    // Max 95% esély eseményre

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
// --- MÓDOSÍTÁS VÉGE: Részletesebb eseményvalószínűségek (Foci) ---


/**
 * Selects an event based on calculated probabilities.
 */
function selectMostLikelyEvent(probabilities) {
    const totalP = probabilities.reduce((sum, p) => sum + (p.probability || 0), 0);
    // Calculate total probability safely
    if (totalP <= 0) return { type: 'NO_EVENT' };
    // Handle zero or negative total probability
    const random = Math.random() * totalP;
    // Generate random number
    let cumulative = 0;
    for (const event of probabilities) { // Iterate through events
        cumulative += (event.probability || 0);
        // Add probability
        if (random < cumulative) { // Check if random number falls in this event's range
            return event;
            // Return the selected event
        }
    }
    return { type: 'NO_EVENT' };
    // Fallback to no event
}

/**
 * Updates the game state based on the occurred event.
 */
function updateGameState(gameState, event) {
    switch (event.type) { // Update based on event type
        case 'HOME_GOAL':
            gameState.home_goals++;
            // Increment home goals
            gameState.home_momentum = 1.5;
            // Adjust momentum
            gameState.away_momentum = 0.7;
            // Adjust momentum
            break;
        case 'AWAY_GOAL':
            gameState.away_goals++;
            // Increment away goals
            
            gameState.away_momentum = 1.5;
            // Adjust momentum
            gameState.home_momentum = 0.7;
            // Adjust momentum
            break;
            // Card events currently don't change goals or momentum
    }
    return gameState;
    // Return updated state
}

/**
 * Builds a prophetic timeline simulation of the match.
 */
// Exportálva
export function buildPropheticTimeline(mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
     const timeline = [];
    // Initialize timeline
    let gameState = { time: 0, home_goals: 0, away_goals: 0, home_momentum: 1.0, away_momentum: 1.0, };
    // Initial state
    const totalMinutes = SPORT_CONFIG[sport]?.total_minutes || 90;
    // Get total minutes or default to 90
    const timeSlice = 5;
    // Time slice duration
    for (let t = 0; t < totalMinutes; t += timeSlice) { // Loop through time slices
        gameState.time = t;
        // Update time
        // Decrease momentum slightly over time
        gameState.home_momentum = Math.max(1.0, gameState.home_momentum - 0.05);
        gameState.away_momentum = Math.max(1.0, gameState.away_momentum - 0.05);
        const eventProbabilities = calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam);
        // Calculate probs for this slice
        const event = selectMostLikelyEvent(eventProbabilities);
        // Select an event
        if (event.type !== 'NO_EVENT') { // If an event occurs
            const eventTime = t + Math.floor(Math.random() * (timeSlice - 1)) + 1;
            // Randomize time within slice
            event.time = eventTime;
            // Add time to event

          
             // --- MÓDOSÍTÁS KEZDETE: Részletes esemény rögzítése ---
            // A 'detail' mezőt már a calculateEventProbabilities hozzáadja
            timeline.push({
                time: event.time,
                type: event.type,
  
                team: event.team || null, // Csapat hozzáadása (ha van)
                detail: event.detail || 'N/A' // Rögzítjük a gólszerzés módját/lap típusát
            });
            // --- MÓDOSÍTÁS VÉGE: Részletes esemény rögzítése ---

            gameState = updateGameState(gameState, event);
            // Update game state
        }
    }
    return timeline;
    // Return the generated timeline
}

// === estimateXG ===
/**
 * Estimates expected goals (xG) or points based on various factors.
 * Uses getAdjustedRatings (now real data).
 * @returns {object} {mu_h: estimated home goals/points, mu_a: estimated away goals/points}.
 */
// Exportálva
// --- MÓDOSÍTÁS KEZDETE ---
// A TELJES 'estimateXG' FÜGGVÉNY CSERÉJE (v42 - xG Integrációval)

export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway, currentSimProbs = null) { // currentSimProbs hozzáadva
    const homeStats = rawStats?.home, awayStats = rawStats?.away;
    const areStatsValid = (stats) => stats &&
        typeof stats.gp === 'number' && stats.gp > 0 && 
        (typeof stats.gf === 'number' || typeof stats.pointsFor === 'number') && // Működik focira (gf) és kosárra (pointsFor) is
        (typeof stats.ga === 'number' || typeof stats.pointsAgainst === 'number');
        
    if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS: ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG.`);
        const defaultGoals = SPORT_CONFIG[sport]?.avg_goals || (sport === 'basketball' ? 110 : (sport === 'hockey' ? 3.0 : 1.35));
        const homeAdv = SPORT_CONFIG[sport]?.home_advantage ||
        { home: 1.05, away: 0.95 };
        return { mu_h: defaultGoals * homeAdv.home, mu_a: defaultGoals * homeAdv.away };
    }

    let mu_h, mu_a;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;
    const logData = { step: 'Alap', sport: sport, home: homeTeam, away: awayTeam };
    
    // --- Sport-specifikus alap xG/pont ---
    if (sport === 'basketball') {
        // ... (Kosárlabda logika: Pace, Ratings, Four Factors, Taktikai Párharc) ...
        logData.step = 'Kosárlabda Alap';
        const avgOffRating = leagueAverages?.avg_offensive_rating || 110;
        const avgDefRating = leagueAverages?.avg_defensive_rating || 110;
        const avgPace = leagueAverages?.avg_pace || 98;
        const homePace = advancedData?.home?.pace || avgPace; // Placeholder, ha nincs advancedData
        const awayPace = advancedData?.away?.pace ||
        avgPace;
        const expectedPace = (homePace + awayPace) / 2;
        const homeOffRating = advancedData?.home?.offensive_rating || avgOffRating;
        const awayOffRating = advancedData?.away?.offensive_rating ||
        avgOffRating;
        const homeDefRating = advancedData?.home?.defensive_rating || avgDefRating;
        const awayDefRating = advancedData?.away?.defensive_rating || avgDefRating;
        mu_h = (homeOffRating / avgOffRating) * (awayDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
        mu_a = (awayOffRating / avgOffRating) * (homeDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
        logData.base_mu_h = mu_h;
        logData.base_mu_a = mu_a;

        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
            const homeFF = advancedData.home.four_factors;
            const awayFF = advancedData.away.four_factors;
            const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05;
            const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05;
            mu_h *= (1 + ore_advantage - tov_advantage);
            mu_a *= (1 - ore_advantage + tov_advantage);
            logData.ff_mod_h = (1 + ore_advantage - tov_advantage);
            logData.ff_mod_a = (1 - ore_advantage + tov_advantage);
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
        logData.bb_tactical_mod_h = bb_tactical_mod_h; logData.bb_tactical_mod_a = bb_tactical_mod_a;

    } else if (sport === 'hockey') {
        // ... (Jégkorong logika: HDCF%, GSAx, PP/PK) ...
        logData.step = 'Jégkorong Alap';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 3.0;
        const leagueAvgHDCF_Pct = typeof leagueAverages?.avg_high_danger_chances_pct === 'number' ?
        leagueAverages.avg_high_danger_chances_pct : 50.0;
        const leagueAvgGSAx = typeof leagueAverages?.avg_gsax === 'number' ? leagueAverages.avg_gsax : 0.0;
        const homeHDCF_Pct = typeof rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct === 'number' ? rawData.advanced_stats_team.home.High_Danger_Chances_For_Pct : 50.0;
        const awayHDCF_Pct = typeof rawData?.advanced_stats_team?.away?.High_Danger_Chances_For_Pct === 'number' ?
        rawData.advanced_stats_team.away.High_Danger_Chances_For_Pct : 50.0;
        const homeHDCA_Pct = 100.0 - homeHDCF_Pct; // Egyszerűsített számítás
        const awayHDCA_Pct = 100.0 - awayHDCF_Pct;
        const safeLeagueAvgHDCF = leagueAvgHDCF_Pct > 0 ?
        leagueAvgHDCF_Pct : 50.0;
        const safeLeagueAvgHDCA = (100.0 - leagueAvgHDCF_Pct) > 0 ? (100.0 - leagueAvgHDCF_Pct) : 50.0;
        let homeAttackStrength = homeHDCF_Pct / safeLeagueAvgHDCF;
        let awayAttackStrength = awayHDCF_Pct / safeLeagueAvgHDCF;
        let homeDefenseStrength = homeHDCA_Pct / safeLeagueAvgHDCA;
        let awayDefenseStrength = awayHDCA_Pct / safeLeagueAvgHDCA;

        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));
        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;
        const home_pp_pct = advancedData?.home?.pp_pct ?? 15;
        const away_pk_pct = advancedData?.away?.pk_pct ?? 85;
        const away_pp_pct = advancedData?.away?.pp_pct ?? 15;
        const home_pk_pct = advancedData?.home?.pk_pct ?? 85;
        const home_pp_advantage = home_pp_pct - away_pk_pct;
        const away_pp_advantage = away_pp_pct - home_pk_pct;
        const pp_mod_h = (1 + (home_pp_advantage / 100) * 0.15);
        const pp_mod_a = (1 + (away_pp_advantage / 100) * 0.15);
        mu_h *= pp_mod_h; mu_a *= pp_mod_a;
        logData.pp_mod_h = pp_mod_h; logData.pp_mod_a = pp_mod_a;

        logData.step = 'Jégkorong Kapus (GSAx)';
        const homeGoalieGSAx = typeof rawData?.advanced_stats_goalie?.home_goalie?.GSAx === 'number' ? rawData.advanced_stats_goalie.home_goalie.GSAx : leagueAvgGSAx;
        const awayGoalieGSAx = typeof rawData?.advanced_stats_goalie?.away_goalie?.GSAx === 'number' ?
        rawData.advanced_stats_goalie.away_goalie.GSAx : leagueAvgGSAx;
        const goalie_mod_h_effect_on_away = Math.max(0.8, Math.min(1.2, 1.0 - (homeGoalieGSAx * 0.1)));
        const goalie_mod_a_effect_on_home = Math.max(0.8, Math.min(1.2, 1.0 - (awayGoalieGSAx * 0.1)));
        mu_h *= goalie_mod_a_effect_on_home;
        mu_a *= goalie_mod_h_effect_on_away;
        logData.goalie_mod_h_vs_away = goalie_mod_a_effect_on_home;
        logData.goalie_mod_a_vs_home = goalie_mod_h_effect_on_away;

    } else if (sport === 'soccer') {
        
        logData.step = 'Labdarúgás Alap';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 1.35;

        // --- v42 JAVÍTÁS KEZDETE: VALÓS xG INTEGRÁCIÓ ---
        // Először ellenőrizzük, hogy a 'datafetch.js' adott-e valós xG adatot
        if (advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
            // Ha igen, ezt használjuk alapként
            const maxRealisticXG = 7.0;
            mu_h = Math.max(0, Math.min(maxRealisticXG, advancedData.home.xg));
            mu_a = Math.max(0, Math.min(maxRealisticXG, advancedData.away.xg));
            
            // Frissítjük a logolást, hogy az új API-ra hivatkozzon
            logData.source = 'Valós xG (Football xG Statistics API)';
            if (advancedData.home.xg > maxRealisticXG || advancedData.away.xg > maxRealisticXG) {
                 console.warn(`Figyelem: Valós xG irreális (${homeTeam} vs ${awayTeam}): H=${advancedData.home.xg}, A=${advancedData.away.xg}. Korlátozva ${maxRealisticXG}-ra.`);
                logData.source += ' (Korlátozva)';
            }
            logData.base_mu_h_real = mu_h; // Logolás 'real' néven
            logData.base_mu_a_real = mu_a;
        
        } else {
            // Ha NINCS valós xG, visszaváltunk a régi BECSLÉSI logikára (GF/GA alapján)
            logData.source = 'Calculated (Becsült) xG';
            
            const safeHomeGp = Math.max(1, homeStats.gp);
            const safeAwayGp = Math.max(1, awayStats.gp);
            const safeAvgGoals = avgGoalsInLeague > 0 ? avgGoalsInLeague : 1.35;
            let homeAttackStrength = (homeStats.gf / safeHomeGp) / safeAvgGoals;
            let awayAttackStrength = (awayStats.gf / safeAwayGp) / safeAvgGoals;
            let homeDefenseStrength = (homeStats.ga / safeHomeGp) / safeAvgGoals;
            let awayDefenseStrength = (awayStats.ga / safeAwayGp) / safeAvgGoals;
            homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
            awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
            homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
            awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));
            mu_h = homeAttackStrength * awayDefenseStrength * safeAvgGoals;
            mu_a = awayAttackStrength * homeDefenseStrength * safeAvgGoals;
            logData.base_mu_h = mu_h; 
            logData.base_mu_a = mu_a;
        }
        // --- v42 JAVÍTÁS VÉGE ---


        logData.step = 'Labdarúgás Játékos Hatás';
        let player_mod_h = 1.0;
        let player_mod_a = 1.0;
        try {
            const parsePlayerStat = (statString) => {
                if (typeof statString !== 'string' || !statString.includes(':')) return { metric: 'n/a', value: null };
                // Null, ha nem parse-olható
                const parts = statString.split(':');
                const metric = parts[0]?.trim().toLowerCase();
                const value = parseFloat(parts[1]?.trim());
                return { metric, value: isNaN(value) ? null : value };
            };
            (rawData?.key_players?.home || []).forEach(player => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                     if (stat.metric.includes('npxg') && stat.value !== null) {
                        if (stat.value > 
                        0.6) player_mod_h *= 1.03;
                         else if (stat.value < 0.2) player_mod_h *= 0.98;
                    }
                }
            });
            (rawData?.key_players?.away || []).forEach(player => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('duels') && stat.value !== null && stat.value < 50) {
   
                          player_mod_h *= 1.02; // Gyenge védő ellenfél -> hazai támadás erősödik
                    
 }
                }
            });
            (rawData?.key_players?.away || []).forEach(player => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                     if (stat.metric.includes('npxg') && stat.value !== null) {
                        if (stat.value 
                         > 0.6) player_mod_a *= 1.03;
                        else if (stat.value < 0.2) player_mod_a *= 0.98;
                    }
                }
             });
            (rawData?.key_players?.home || []).forEach(player => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    
 if (stat.metric.includes('duels') && stat.value !== null && stat.value < 50) {
                      player_mod_a 
                        *= 1.02; // Gyenge hazai védő -> vendég támadás erősödik
          
 }
                }
            });
            mu_h *= player_mod_h;
            mu_a *= player_mod_a;
            logData.player_mod_h = player_mod_h; logData.player_mod_a = player_mod_a;
        } catch (e) { console.warn(`Hiba a Játékos Hatás számításakor: ${e.message}`);
        }
    }

    // --- ÁLTALÁNOS MÓDOSÍTÓK (MINDEN SPORTÁGRA) ---

 
     logData.step = 'Általános Módosítók';
    // Súlyozott Forma Faktor
    const getFormPoints = (formString) => {
        if (!formString || typeof formString !== 'string' || formString === "N/A") return { points: 0, matches: 0 };
        // Javítás: N/A és validáció
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        const matches = (formString.match(/[WDL]/g) || []).length;
        // Javítás: Meccsszám kinyerése
        return { points: wins * 3 + draws * 1, matches: matches };
    };

    const homeOverallForm = getFormPoints(form?.home_overall);
    const awayOverallForm = getFormPoints(form?.away_overall);
    const homeVenueForm = getFormPoints(form?.home_home);
    // Hazai pályán
    const awayVenueForm = getFormPoints(form?.away_away);
    // Vendégként

    // Csak akkor használjuk a súlyozott formát, ha van elég adat (legalább 3 meccs hazai/vendég pályán)
    const useVenueWeighting = homeVenueForm.matches >= 3 && awayVenueForm.matches >= 3;
    const homeFormFactor = useVenueWeighting
        ?
    (0.6 * (homeVenueForm.points / (homeVenueForm.matches * 3))) + (0.4 * (homeOverallForm.points / (homeOverallForm.matches * 3)))
        : (homeOverallForm.matches > 0 ? homeOverallForm.points / (homeOverallForm.matches * 3) : 0.5);
    // Ha nincs overall forma sem, 0.5 (átlagos)
    const awayFormFactor = useVenueWeighting
        ?
    (0.6 * (awayVenueForm.points / (awayVenueForm.matches * 3))) + (0.4 * (awayOverallForm.points / (awayOverallForm.matches * 3)))
        : (awayOverallForm.matches > 0 ? awayOverallForm.points / (awayOverallForm.matches * 3) : 0.5);
    const formImpactFactor = 0.1; // Mennyire befolyásolja a forma az xG-t
    // Javítás: Biztosítjuk, hogy a faktorok számok legyenek
    const safeHomeFormFactor = isNaN(homeFormFactor) ?
    0.5 : homeFormFactor;
    const safeAwayFormFactor = isNaN(awayFormFactor) ? 0.5 : awayFormFactor;
    const form_mod_h = (1 + (safeHomeFormFactor - 0.5) * formImpactFactor);
    const form_mod_a = (1 + (safeAwayFormFactor - 0.5) * formImpactFactor);
    mu_h *= form_mod_h; mu_a *= form_mod_a;
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a;
    // --- ÚJ: Egyszerűsített Regresszió a Középértékhez ---
    // Ha a szimuláció valószínűsége és a forma között nagy az eltérés, korrigálunk
    if (currentSimProbs && typeof currentSimProbs.pHome === 'number' && typeof currentSimProbs.pAway === 'number') {
        logData.step = 'Regresszió';
        const homeWinProb = currentSimProbs.pHome / 100;
        const awayWinProb = currentSimProbs.pAway / 100;
        // Forma pontszám 0-1 skálán (W=1, D=0.33, L=0) - utolsó 5 meccs alapján
        const getFormScore = (fStr) => {
            if (!fStr || typeof fStr !== 'string' || fStr === "N/A" || fStr.length === 0) return 0.5;
            // Átlagos, ha nincs adat
    
             const wins = (fStr.match(/W/g) || []).length;
            const draws = (fStr.match(/D/g) || []).length;
            const matches = fStr.length;
            return (wins * 1 + draws * 0.33) / matches;
        };
        const homeFormScore = getFormScore(form?.home_overall);
        const awayFormScore = getFormScore(form?.away_overall);

        let regression_mod_h = 1.0;
        let regression_mod_a = 1.0;
        const regressionFactor = 0.03; // Kis mértékű korrekció

        // Ha a modell sokat vár (magas winProb), de a forma rossz (alacsony formScore) -> csökkentünk
        if (homeWinProb > 0.6 && homeFormScore < 0.4) regression_mod_h -= regressionFactor;
        if (awayWinProb > 0.6 && awayFormScore < 0.4) regression_mod_a -= regressionFactor;
        // Ha a modell keveset vár (alacsony winProb), de a forma jó (magas formScore) -> növelünk
        if (homeWinProb < 0.4 && homeFormScore > 0.6) regression_mod_h += regressionFactor;
        if (awayWinProb < 0.4 && awayFormScore > 0.6) regression_mod_a += regressionFactor;

        mu_h *= regression_mod_h;
        mu_a *= regression_mod_a;
        logData.regr_mod_h = regression_mod_h;
        logData.regr_mod_a = regression_mod_a;
    }
    // --- REGRESSZIÓ VÉGE ---

    // Dinamikus Hazai Pálya Előny (marad)
    logData.step = 'Hazai Előny';
    // ... (Logika változatlan) ...
    const baseHomeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0;
    const baseAwayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
    const leagueHomeWinPct = leagueAverages?.home_win_pct || (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const defaultHomeWinPct = (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const homeAdvMultiplier = defaultHomeWinPct > 0 ? (leagueHomeWinPct / defaultHomeWinPct) : 1;
    const awayAdvMultiplier = (1-defaultHomeWinPct) > 0 ?
    ((1 - leagueHomeWinPct) / (1- defaultHomeWinPct)) : 1;
    const home_adv_mod = baseHomeAdv * homeAdvMultiplier;
    const away_adv_mod = baseAwayAdv * awayAdvMultiplier;
    mu_h *= home_adv_mod; mu_a *= away_adv_mod;
    logData.home_adv_mod = home_adv_mod; logData.away_adv_mod = away_adv_mod;
    // Taktikai Modellezés (Foci - marad, Kosár - áthelyezve a sport-specifikus részbe)
    if (sport === 'soccer') {
        logData.step = 'Taktika (Foci)';
        // ... (Logika változatlan) ...
        const homeStyle = rawData?.tactics?.home?.style?.toLowerCase() || 'n/a';
        const awayStyle = rawData?.tactics?.away?.style?.toLowerCase() || 'n/a';
        let tactical_mod_h = 1.0;
        let tactical_mod_a = 1.0;
        if (homeStyle.includes('counter') && (awayStyle.includes('possession') || awayStyle.includes('dominan'))) { tactical_mod_h *= 1.04; tactical_mod_a *= 0.97;
        }
           if (awayStyle.includes('counter') && (homeStyle.includes('possession') || homeStyle.includes('dominan'))) { tactical_mod_a *= 1.04;
        tactical_mod_h *= 0.97; }
        if (homeStyle.includes('press') && (awayStyle.includes('defensive frailties') || awayStyle.includes('slow build'))) { tactical_mod_h *= 1.03;
        tactical_mod_a *= 0.98; }
        if (awayStyle.includes('press') && (homeStyle.includes('defensive frailties') || homeStyle.includes('slow build'))) { tactical_mod_a *= 1.03;
        tactical_mod_h *= 0.98; }
        mu_h *= tactical_mod_h; mu_a *= tactical_mod_a;
        logData.tactical_mod_h = tactical_mod_h;
        logData.tactical_mod_a = tactical_mod_a;

    }

    // Formációk Hatása (Foci - marad)
    if (sport === 'soccer') {
        logData.step = 'Formáció (Foci)';
        // ... (Logika változatlan) ...
        const homeFormation = rawData?.tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = rawData?.tactics?.away?.formation?.toLowerCase() || 'n/a';
        let formation_mod_h = 1.0;
        let formation_mod_a = 1.0;
        if (homeFormation.startsWith('5') || homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) { formation_mod_a *= 0.95;
 }
        if (awayFormation.startsWith('5') || awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) { formation_mod_h *= 0.95;
        }
        const isOffensive = (f) => f.startsWith('4-3-3') || f.startsWith('3-4-3') || f.startsWith('4-2-4');
        if (isOffensive(homeFormation) && isOffensive(awayFormation)) { formation_mod_h *= 1.02; formation_mod_a *= 1.02;
        }
        mu_h *= formation_mod_h; mu_a *= formation_mod_a;
        logData.formation_mod_h = formation_mod_h; logData.formation_mod_a = formation_mod_a;
    }

    // Power Ratings (Tanult) (marad)
 
     logData.step = 'Power Ratings (Tanult)';
    // ... (Logika változatlan) ...
    const powerRatings = getAdjustedRatings();
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase();
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1, matches: 0 };
    // matches hozzáadva
    const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1, matches: 0 };
    // Óvatosabb alkalmazás, ha kevés meccs alapján tanult
    const homeWeight = Math.min(1, homePR.matches / 10);
    const awayWeight = Math.min(1, awayPR.matches / 10);
    const pr_mod_h = ((homePR.atk ?? 1) * (awayPR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
    // Súlyozott hatás
    const pr_mod_a = ((awayPR.atk ?? 1) * (homePR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
    mu_h *= pr_mod_h; mu_a *= pr_mod_a;
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def; logData.homePR_w = homeWeight;
    logData.awayPR_atk = awayPR.atk;
    logData.awayPR_def = awayPR.def; logData.awayPR_w = awayWeight;
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;
    // Pszichológiai Faktorok (marad)
    logData.step = 'Pszichológia';
    // ... (Logika változatlan) ...
    const psyMultiplier = 0.05;
    // Csökkentett szorzó, finomabb hatás
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    mu_h *= psy_mod_h;
    mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;


    // Finomított Hiányzók Hatása (Poszt alapján) (marad)
    logData.step = 'Hiányzók (Poszt)';
    // ... (Logika változatlan) ...
    let absentee_mod_h = 1.0;
    let absentee_mod_a = 1.0;
    const impactFactor = sport === 'soccer' ? 0.05 : sport === 'hockey' ? 0.07 : 0.03;
    const gkImpactFactor = sport === 'soccer' ? 0.15 : sport === 'hockey' ? 0.20 : 0.05;
    (rawData?.absentees?.home || []).forEach(p => {
         if (p.importance === 'key') {
            const role = p.role?.toLowerCase() || '';
            if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) absentee_mod_h *= (1 - impactFactor);
            else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) absentee_mod_a *= (1 + impactFactor);
             else if (role.includes('kapus') || role.includes('goalkeeper')) absentee_mod_a *= (1 
            + gkImpactFactor);
        }
    });
    (rawData?.absentees?.away || []).forEach(p => {
        if (p.importance === 'key') {
            const role = p.role?.toLowerCase() || '';
     
             if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) absentee_mod_a *= (1 - impactFactor);
            else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) absentee_mod_h *= (1 + impactFactor);
            else if (role.includes('kapus') || role.includes('goalkeeper')) absentee_mod_h *= (1 
            + gkImpactFactor);
 
         }
    });
    mu_h *= absentee_mod_h; mu_a *= absentee_mod_a;
    logData.abs_mod_pos_h = absentee_mod_h; logData.abs_mod_pos_a = absentee_mod_a;

    const impactAnalysis = rawData?.absentee_impact_analysis?.toLowerCase();
    if (impactAnalysis && impactAnalysis !== "nincs jelentős hatás.") {
        let homeImpactGen = 1.0, awayImpactGen = 1.0;
        if (impactAnalysis.includes(homeTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) homeImpactGen -= 0.02;
        if (impactAnalysis.includes(awayTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) awayImpactGen -= 0.02;
        if (impactAnalysis.includes("nyíltabb játék") || impactAnalysis.includes("több gól")) {  homeImpactGen += 0.01; awayImpactGen += 0.01;
        }
        if (impactAnalysis.includes("védekezőbb") || impactAnalysis.includes("kevesebb gól")) { homeImpactGen -= 0.01; awayImpactGen -= 0.01;
        }
        mu_h *= homeImpactGen; mu_a *= awayImpactGen;
        logData.abs_mod_gen_h = homeImpactGen; logData.abs_mod_gen_a = awayImpactGen;
    }


    // Meccs Fontosságának Hatása (marad)
    logData.step = 'Meccs Tétje';
    // ... (Logika változatlan) ...
    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a';
 let tension_mod = 1.0;
    // Javítás: A barátságos meccs csökkentse a gólszámot (kevésbé intenzív)
    if (tension === 'high' || tension === 'extreme') tension_mod = 1.03;
    else if (tension === 'low') tension_mod = 0.98; // Alacsony tét -> kevesebb hajtás?
    else if (tension === 'friendly') tension_mod = 0.95; // Barátságos -> még kevesebb
    mu_h *= tension_mod;
    mu_a *= tension_mod;
    logData.tension_mod = tension_mod;


    // --- Finomított Időjárás Hatása (Strukturált Adatok Alapján) ---
 
     logData.step = 'Időjárás (Strukturált)';
    // ... (Logika változatlan) ...
    const weather = rawData?.contextual_factors?.structured_weather;
    let weather_mod = 1.0;
    if (weather && weather.precipitation_mm != null && weather.wind_speed_kmh != null) {
        const precip = weather.precipitation_mm;
        const wind = weather.wind_speed_kmh;
        if (precip > 10.0) weather_mod *= 0.92;
        else if (precip > 3.0) weather_mod *= 0.96;
        else if (precip > 0.5) weather_mod *= 0.99;
        if (wind > 50.0) weather_mod *= 0.90;
        else if (wind > 30.0) weather_mod *= 0.95;
        else if (wind > 15.0) weather_mod *= 0.99;
        const pitch = rawData?.contextual_factors?.pitch_condition?.toLowerCase() || 'n/a';
        if (pitch.includes("rossz") || pitch.includes("poor")) weather_mod *= 0.97;
    } else {
        console.warn(`Hiányzó strukturált időjárási adat (${homeTeam} vs ${awayTeam}), fallback a szöveges elemzésre.`);
        const weatherText = rawData?.contextual_factors?.weather?.toLowerCase() || 'n/a';
        if (weatherText.includes("eső") || weatherText.includes("rain")) weather_mod *= 0.98;
        if (weatherText.includes("hó") || weatherText.includes("snow")) weather_mod *= 0.95;
    }
     mu_h *= weather_mod;
    mu_a *= weather_mod;
    logData.weather_mod_combined = weather_mod;
    // Minimum érték (marad)
    const minVal = sport === 'basketball' ?
    80 : (sport === 'hockey' ? 1.5 : 0.5);
    mu_h = Math.max(minVal, mu_h || minVal);
    // Javítás: Ha mu_h NaN, akkor is minVal legyen
    mu_a = Math.max(minVal, mu_a || minVal);
    // Javítás: Ha mu_a NaN, akkor is minVal legyen

    // Végső Korlátozás (marad)
    
 const finalMaxVal = sport === 'basketball' ?
    200 : (sport === 'hockey' ? 10 : 7);
    if (mu_h > finalMaxVal || mu_a > finalMaxVal) {
        console.warn(`Figyelem: xG/Pont korlátozás (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} -> Max ${finalMaxVal}.`);
        logData.step = 'Végső Korlátozás';
    }
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);

    logData.final_mu_h = mu_h;
    logData.final_mu_a = mu_a;
    logData.step = 'Végeredmény';
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} (Forrás: ${logData.source})`);
    // console.log(`estimateXG Részletes Log (${homeTeam} vs ${awayTeam}): ${JSON.stringify(logData)}`);

    return { mu_h, mu_a };
}
// --- MÓDOSÍTÁS VÉGE ---


// === estimateAdvancedMetrics ===
/**
 * Estimates expected corners and cards based on available data.
 * @returns {object} {mu_corners: estimated corners, mu_cards: estimated cards}.
 */
// Exportálva
// --- MÓDOSÍTÁS KEZDETE: Finomítás + Taktikai inputok (3. Pont) ---
export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    // Alapértékek a liga átlagokból vagy default értékek
    const avgCorners = leagueAverages?.avg_corners ||
    10.5;
    const avgCards = leagueAverages?.avg_cards || 4.5;
    let mu_corners = avgCorners;
    let mu_cards = avgCards;
    const logData = { sport };

    if (sport === 'soccer') {
        const adv = rawData?.advanced_stats;
        // Placeholder, jelenleg nem használjuk
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        logData.base_corners = mu_corners;
        logData.base_cards = mu_cards;
        // --- Szögletek ---
         let corner_mod = 1.0;
        // Taktika hatása: Szélső játék növeli, középen erőltetett játék csökkenti?
        const homeStyle = tactics?.home?.style?.toLowerCase() || 'n/a';
        const awayStyle = tactics?.away?.style?.toLowerCase() || 'n/a';
        if (homeStyle.includes('wing') || homeStyle.includes('szélső')) corner_mod += 0.05;
        if (awayStyle.includes('wing') || awayStyle.includes('szélső')) corner_mod += 0.05;
        if (homeStyle.includes('central') || homeStyle.includes('középen')) corner_mod -= 0.03;
        if (awayStyle.includes('central') || awayStyle.includes('középen')) corner_mod -= 0.03;
        // Formáció hatása: Szélső védőkkel (pl. 3-5-2) játszó csapat ellen több szöglet lehet?
        const homeFormation = tactics?.home?.formation?.toLowerCase() || 'n/a';
 const awayFormation = tactics?.away?.formation?.toLowerCase() || 'n/a';
        if (awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) corner_mod += 0.03;
        if (homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) corner_mod += 0.03;
        mu_corners *= corner_mod;
        logData.corner_tactics_mod = corner_mod;

        // --- Lapok ---
        let card_mod = 1.0;
        // Játékvezető hatása (a korábbi logika finomítva)
        if (referee?.style) {
            const styleLower = referee.style.toLowerCase();
            let refFactor = 1.0;
            if (styleLower.includes("strict") || styleLower.includes("szigorú")) refFactor = 1.15;
            else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) refFactor = 0.85;
            // Átlag figyelembe vétele (ha van)
            const cardMatch = referee.style.match(/(\d\.\d+)/);
            if (cardMatch) {
                const refereeAvg = parseFloat(cardMatch[1]);
                // Súlyozzuk az átlagot a ligaátlaggal és a stílussal
                 card_mod = (refFactor * 0.5) + ((refereeAvg / avgCards) * 0.5);
                // 50-50% súly
            } else {
                card_mod = refFactor;
                // Ha nincs átlag, csak a stílus számít
            }
    
             logData.card_ref_mod = card_mod;
        }

        // Meccs tétje (marad)
        const tension = context?.match_tension_index?.toLowerCase() ||
        'low';
        if (tension === 'high') card_mod *= 1.1;
        else if (tension === 'extreme') card_mod *= 1.25;
        // Derby jelleg (AI adhatja a kontextusban?)
        if (context?.match_tension_index?.toLowerCase().includes('derby') || rawData?.h2h_summary?.toLowerCase().includes('rivalry')) {
       
               card_mod *= 1.1;
             // Derbiken több lap lehet
             logData.is_derby = true;
        }
        logData.card_tension_mod = card_mod / (logData.card_ref_mod || 1);
        // Csak a tension hatása

        // Taktika hatása: Magas letámadás, agresszív stílus növeli
        if (homeStyle.includes('press') || homeStyle.includes('aggressive')) card_mod += 0.05;
        if (awayStyle.includes('press') || awayStyle.includes('aggressive')) card_mod += 0.05;
        // Kontra csapatok ellen több taktikai szabálytalanság lehet
        if (homeStyle.includes('counter')) card_mod += 0.03;
        if (awayStyle.includes('counter')) card_mod += 0.03;
        logData.card_tactics_mod = card_mod / (logData.card_ref_mod * logData.card_tension_mod || 1);
        // Időjárás és Pálya (marad)
        const weather = context?.structured_weather;
        const pitch = context?.pitch_condition?.toLowerCase() || 'n/a';
        let weatherPitchMod = 1.0;
        if (weather && weather.precipitation_mm != null && weather.precipitation_mm > 3.0) {
            weatherPitchMod *= 1.05;
            // Eső -> több csúszás
        }
        if (pitch.includes("rossz") || pitch.includes("poor")) {
             weatherPitchMod *= 1.08;
             // Rossz pálya -> több küzdelem
        }
     
         card_mod *= weatherPitchMod;
        logData.card_wp_mod = weatherPitchMod;

        mu_cards *= card_mod;

        // Minimum értékek (marad)
        mu_corners = Math.max(3.0, mu_corners || avgCorners);
        // Biztosítjuk, hogy szám legyen
        mu_cards = Math.max(1.5, mu_cards || avgCards);
        // Biztosítjuk, hogy szám legyen

        logData.final_mu_corners = mu_corners;
        logData.final_mu_cards = mu_cards;
        // console.log(`estimateAdvancedMetrics Log: ${JSON.stringify(logData)}`);
    } else {
     
         // Más sportágaknál egyelőre marad az átlag
        mu_corners = avgCorners;
        // Vagy sport-specifikus átlag?
        mu_cards = avgCards;
    }
    // Javítás: Biztosítjuk, hogy számokat adjunk vissza
    return {
        mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ?
        mu_corners : 10.5,
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ?
 mu_cards : 4.5
    };
}
// --- MÓDOSÍTÁS VÉGE: Finomítás + Taktikai inputok ---


// --- simulateMatchProgress (Poisson javítással) ---
export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, liveScenario, mainTotalsLine, rawData) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0;
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0;
    const scores = {};
    const safeSims = Math.max(1, sims || 1); // Biztonság, minimum 1 szimuláció

    // Javítás: Biztosítjuk, hogy a bemeneti mu értékek számok legyenek
    const safe_mu_h = typeof mu_h === 'number' && !isNaN(mu_h) ?
    mu_h : SPORT_CONFIG[sport]?.avg_goals || 1.35;
    const safe_mu_a = typeof mu_a === 'number' && !isNaN(mu_a) ? mu_a : SPORT_CONFIG[sport]?.avg_goals || 1.35;
    const safe_mu_corners = typeof mu_corners === 'number' && !isNaN(mu_corners) ?
 mu_corners : 10.5;
    const safe_mu_cards = typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5;
    const safe_mainTotalsLine = typeof mainTotalsLine === 'number' && !isNaN(mainTotalsLine) ? mainTotalsLine : SPORT_CONFIG[sport]?.totals_line || 2.5;
    if (sport === 'basketball') {
        const stdDev = 11.5;
        // Kosárnál normális eloszlást használunk
        for (let i = 0; i < safeSims; i++) {
        
             // Javítás: Biztosítjuk, hogy a sampleNormal érvényes számokat kapjon
            const gh = Math.max(0, Math.round(sampleNormal(safe_mu_h, stdDev)));
            const ga = Math.max(0, Math.round(sampleNormal(safe_mu_a, stdDev)));
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if ((gh + ga) > safe_mainTotalsLine) over_main++;
        }
    } else { // Foci, 
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(safe_mu_h, safe_mu_a);
            // Biztonságos mu értékek használata
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++;
            else if (ga > gh) 
 away++; else draw++;
            if (gh > 0 && ga > 0) btts++; // Both Teams To Score
            if ((gh + ga) > safe_mainTotalsLine) over_main++;
            // Over a fő vonalon

            // Mellékpiacok szimulálása (csak foci esetén)
            if (sport === 'soccer') {
    
                 // *** JAVÍTÁS: Poisson -> poisson ***
                const corners = poisson(safe_mu_corners);
                // Biztonságos mu érték
                if (corners > 7.5) corners_o7_5++;
                if (corners > 8.5) corners_o8_5++;
                if (corners > 9.5) corners_o9_5++;
                if (corners > 10.5) 
 corners_o10_5++;
                if (corners > 11.5) corners_o11_5++;
                // *** JAVÍTÁS: Poisson -> poisson ***
                const cards = poisson(safe_mu_cards);
                // Biztonságos mu érték
                if (cards > 3.5) cards_o3_5++;
                if (cards > 4.5) cards_o4_5++;
                if (cards > 5.5) cards_o5_5++;
                if (cards > 6.5) cards_o6_5++;
            }
     
         }
    }

    // Hoki/Kosár: Döntetlenek elosztása hosszabbítás/büntetők alapján (egyszerűsített)
    if (sport !== 'soccer' && draw > 0) {
        const totalWinsBeforeOT = home + away;
        // Arányosan osztjuk el a döntetleneket a győztesek között
        if (totalWinsBeforeOT > 0) {
             
              home += draw * (home / totalWinsBeforeOT);
             away += draw * (away / totalWinsBeforeOT);
        } else { // Ha csak döntetlenek voltak (nagyon ritka)
             home += draw / 2;
             away += draw / 2;
        }
        draw = 0;
        // Nincs döntetlen a végeredményben
    }

    // Eredmények százalékosítása
    const toPct = x => (100 * x / safeSims);
    // Leggyakoribb eredmény megkeresése
    const topScoreKey = Object.keys(scores).length > 0
        ?
    Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0')
        : '0-0';
    // Alapértelmezett, ha nincs eredmény
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);
    // Visszatérési objektum összeállítása
    return {
     
         pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        // Szöglet valószínűségek (csak ha foci)
        corners: sport === 'soccer' ?
        {
             'o7.5': toPct(corners_o7_5), 'u7.5': 100 - toPct(corners_o7_5),
         
          'o8.5': toPct(corners_o8_5), 'u8.5': 100 - toPct(corners_o8_5),
             'o9.5': toPct(corners_o9_5), 'u9.5': 100 - toPct(corners_o9_5),
             'o10.5': toPct(corners_o10_5), 'u10.5': 100 - toPct(corners_o10_5),
             'o11.5': toPct(corners_o11_5), 'u11.5': 100 - toPct(corners_o11_5)
        } : 
   
           {}, // Üres objektum más sportnál
        // Lap valószínűségek (csak ha foci)
        cards: sport === 'soccer' ?
        {
             'o3.5': toPct(cards_o3_5), 'u3.5': 100 - toPct(cards_o3_5),
             'o4.5': toPct(cards_o4_5), 'u4.5': 100 - toPct(cards_o4_5),
    
              'o5.5': toPct(cards_o5_5), 'u5.5': 100 - toPct(cards_o5_5),
             'o6.5': toPct(cards_o6_5), 'u6.5': 100 - toPct(cards_o6_5)
        } : {}, // Üres objektum más sportnál
        scores, // Pontos eredmények gyakorisága
 
               topScore: 
 { gh: top_gh, ga: top_ga }, // Leggyakoribb eredmény

        mainTotalsLine: safe_mainTotalsLine, // Használt fő vonal
        // Visszaadjuk a szimulációhoz használt (biztonságos) mu értékeket is
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}


// --- calculateModelConfidence (Változatlan) ---
export function calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel) {
    let score = 5.0;
    const MAX_SCORE = 10.0; const MIN_SCORE = 1.0;
    try {
        const getFormPointsPerc = (formString) => { // Átnevezve, hogy százalékot adjon vissza
             if (!formString || typeof formString !== 'string' || formString === "N/A") return null;
             const wins = (formString.match(/W/g) || []).length;
             const draws = (formString.match(/D/g) || []).length;
             const total = (formString.match(/[WDL]/g) || []).length;
             return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
             // 0-1 közötti érték
        };
        const homeOverallFormScore = getFormPointsPerc(form?.home_overall);
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);
        // Forma vs Szimuláció ellentmondás
        if (homeOverallFormScore != null && awayOverallFormScore != null && sim && sim.pHome != null && sim.pAway != null) {
             const formDiff = homeOverallFormScore - awayOverallFormScore;
            // Pozitív, ha a hazai jobb formában van
            const simDiff = (sim.pHome - sim.pAway) / 100;
            // Pozitív, ha a szimuláció a hazait favorizálja
            // Ha a szimuláció erősen favorizál valakit (>65% esély), de annak a formája sokkal rosszabb (<-0.2)
             if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5;
            }
            // Ha a szimuláció favorizál valakit (>60%) és a formája is ezt támasztja alá (>0.25 diff)
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75;
            }
        }

        // xG különbség alapján bizalom növelés/csökkentés
        if (sim && sim.mu_h_sim != null && sim.mu_a_sim != null) {
            const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
            const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4;
            const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
            if (xgDiff > thresholdHigh) score += 1.5; // Nagy különbség -> magabiztosabb modell
            if (xgDiff < thresholdLow) score -= 1.0;
            // Kicsi különbség -> bizonytalanabb modell
        }

        // H2H adatok frissessége
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                 const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                 if (!isNaN(latestH2HDate.getTime())) { // Csak ha érvényes a dátum
                      if (latestH2HDate < twoYearsAgo) { score -= 0.75;
                      } // Régi H2H -> kevésbé releváns
                      else { score += 0.25;
                      } // Friss H2H -> kicsit relevánsabb
                 
 }
            } catch(e) { console.warn("H2H dátum parse hiba:", e);
            }
        } else { score -= 0.25;
        } // Nincs H2H adat -> kicsit bizonytalanabb

        // Kulcshiányzók hatása
        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length ||
        0;
        const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0;
        if (sim && sim.pHome != null && sim.pAway != null) {
            if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.0 * homeKeyAbsentees);
            } // Favoritnál hiányzó -> nagy csökkenés
            if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.0 * awayKeyAbsentees);
            }
             if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.5 * awayKeyAbsentees);
            } // Ellenfélnél hiányzó -> kis növelés
            if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.5 * homeKeyAbsentees);
            }
        }

        // Piaci mozgás ellentmondása
    
         const marketIntelLower = marketIntel?.toLowerCase() ||
        'n/a';
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.' && sim && sim.pHome != null && sim.pAway != null) {
            const homeFavoredBySim = sim.pHome > sim.pAway && sim.pHome > 45;
            const awayFavoredBySim = sim.pAway > sim.pHome && sim.pAway > 45;
            const homeNameLower = home.toLowerCase();
            const awayNameLower = away.toLowerCase();
            // Ha a modell favorizál valakit, de a piac ellene mozog (odds nő: + jel)
            if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
            }
            else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
            }
            // Ha a modell favorizál valakit, és a piac is támogatja (odds csökken: - jel)
            else if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('-')) { score += 1.0;
            }
            else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('-')) { score += 1.0;
            }
        }

        // Tanulási előzmények (Power Ratings meccsszám)
      
         const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25; // Extra bónusz több adatnál
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        score += Math.min(1.0, historyBonus); // Max 1.0 bónusz az előzményekért


 
     } catch(e) {
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`, e.stack);
        return Math.max(MIN_SCORE, 4.0); // Hiba esetén óvatos default
    }
    // Végső pontszám korlátozása 1.0 és 10.0 közé
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

// --- calculatePsychologicalProfile (Változatlan) ---
export function calculatePsychologicalProfile(teamName, opponentName, rawData = null) {
    // Alapértékek
    let moraleIndex = 1.0;
 // 1.0 = átlagos morál
    let pressureIndex = 1.0;
    // 1.0 = átlagos nyomás

    // Egyszerű heurisztikák a rawData alapján (ha elérhető)
    if (rawData) {
        // Forma hatása a morálra
        const formString = rawData.form?.home_overall;
        // Feltételezzük, hogy a hazai csapatét nézzük
        if (formString && formString !== "N/A") {
            const recentLosses = (formString.slice(-3).match(/L/g) || []).length;
            // Utolsó 3 meccs vereségei
            const recentWins = (formString.slice(-3).match(/W/g) || []).length;
            // Utolsó 3 meccs győzelmei
            if (recentLosses >= 2) moraleIndex *= 0.95;
            // Rossz forma -> rosszabb morál
       
             if (recentWins >= 2) moraleIndex *= 1.05;
            // Jó forma -> jobb morál
        }
        // Meccs tétjének hatása a nyomásra
        const tension = rawData.contextual_factors?.match_tension_index?.toLowerCase();
        if (tension === 'high') pressureIndex *= 1.05; // Nagyobb nyomás
        if (tension === 'extreme') pressureIndex *= 1.10;
        // Még nagyobb nyomás
        if (tension === 'low' || tension === 'friendly') pressureIndex *= 0.95;
        // Kisebb nyomás
    }

    // Korlátozzuk az indexeket, pl.
    0.8 és 1.2 közé
    moraleIndex = Math.max(0.8, Math.min(1.2, moraleIndex));
    pressureIndex = Math.max(0.8, Math.min(1.2, pressureIndex));
    return { moraleIndex, pressureIndex };
}


// --- calculateValue ---
// --- MÓDOSÍTÁS KEZDETE: Kiterjesztés szöglet/lap piacokra (3. Pont) ---
export function calculateValue(sim, oddsData, sport, homeTeam, awayTeam) {
    const valueBets = [];
    if (!oddsData || !sim) return valueBets; // Ha nincs odds vagy szimuláció, nincs érték

    // Segédfüggvény a szimulációs valószínűség megtalálásához
    const findSimProb = (marketName, line = null) => {
        if (!marketName || !sim) return null;
        const lowerMarket = marketName.toLowerCase();

        // 1X2 piacok
        if (lowerMarket.includes('hazai') || lowerMarket === homeTeam.toLowerCase()) return sim.pHome / 100;
        if (lowerMarket.includes('vendég') || lowerMarket === awayTeam.toLowerCase()) return sim.pAway / 100;
        if (lowerMarket.includes('döntetlen') || lowerMarket === 'draw') return sim.pDraw / 100;
        // Fő O/U (gól/pont)
        if (line !== null && sim.mainTotalsLine != null && line === sim.mainTotalsLine) {
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) return sim.pOver / 100;
            if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) return sim.pUnder / 100;
        }

 
         // BTTS (Mindkét csapat szerez gólt)
        if (lowerMarket.includes('btts') || lowerMarket.includes('mindkét csapat szerez gólt')) {
            const isYes = lowerMarket.includes("igen") ||
            !lowerMarket.includes("nem");
            return isYes ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100;
        }

        // Szöglet O/U (csak foci és ha van adat)
   
         if (sport === 'soccer' && sim.corners && line !== null && (lowerMarket.includes('corners') || lowerMarket.includes('szöglet'))) {
            const overKey = `o${line}`;
            const underKey = `u${line}`;
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) {
                return sim.corners[overKey] != null ?
                sim.corners[overKey] / 100 : null;
            }
       
             if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) {
                return sim.corners[underKey] != null ?
                sim.corners[underKey] / 100 : null;
            }
        }

        // Lap O/U (csak foci és ha van adat)
        if (sport === 'soccer' && sim.cards && line !== null && (lowerMarket.includes('cards') || lowerMarket.includes('lap'))) {
            const overKey = `o${line}`;
            const underKey = `u${line}`;
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) {
                return sim.cards[overKey] != null ?
                sim.cards[overKey] / 100 : null;
            }
            if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) {
     
                 return sim.cards[underKey] != null ?
                sim.cards[underKey] / 100 : null;
            }
        }

        return null;
        // Ha nem találtunk megfelelő piacot
    };
    // Végigmegyünk az ÖSSZES elérhető piacon az oddsData-ból
    (oddsData.allMarkets || []).forEach(market => {
        // Csak a H2H, Totals, BTTS, Szöglet (Corners Over/Under), Lapok (Cards Over/Under) piacokat nézzük most
        const marketKey = market.key?.toLowerCase();
        const isSupportedMarket = marketKey === 'h2h' || marketKey === 'totals' || marketKey === 'btts' || marketKey === 'corners_over_under' || marketKey === 'cards_over_under';

        if (isSupportedMarket && Array.isArray(market.outcomes)) {
           
   
                 market.outcomes.forEach(outcome => {
                // Kell név, ár (szám), és esetleg 'point' (line) az O/U piacokhoz
                if (outcome && outcome.name && typeof outcome.price === 'number' && outcome.price > 1) {
       
                   const line = typeof outcome.point === 'number' ? outcome.point : null;
          
                     const probability = findSimProb(outcome.name, line); // Megkeressük a szimulált valószínűséget

             
                 if (probability != null && probability > 0) { // Csak ha találtunk valószínűséget
                        const value = (probability * outcome.price) - 1;
                        // Érték = (Valószínűség * Odds) - 1
                 
                         const valueThreshold = 0.05;
                        // Minimum 5% értéket keresünk

                        if (value >= valueThreshold) {
                            // Egységesítjük a piac nevét a kimenethez
                            let marketDisplayName = outcome.name;
                            if (line !== null) { // O/U piacoknál hozzáadjuk a vonalat
                                marketDisplayName = `${outcome.name} ${line}`;
                            }
                            // BTTS Yes/No normalizálása
                            if (marketKey === 'btts') {
          
                                marketDisplayName = `Mindkét csapat 
 szerez gólt - ${outcome.name}`;
                            }

                            valueBets.push({
                
                                 market: marketDisplayName,
                                odds: outcome.price,
  
                        
                                         probability: (probability * 100).toFixed(1) + '%', // Százalékosan
                               
                                 value: (value * 100).toFixed(1) + '%' // Százalékosan
                        
                            });
                        }
               
             }
                }
            });
        }
    });

    // Érték szerint csökkenő sorrendbe rendezzük
    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
}
// --- MÓDOSÍTÁS VÉGE ---


// --- analyzeLineMovement (Változatlan) ---
export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
     if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) { return "Nincs elég adat a piaci mozgás elemzéséhez.";
     }
    let awayTeam = '';
    // Javítás: Robusztusabb ellenfél keresés (figyelmen kívül hagyja a 'Draw'-t)
    const potentialAway = currentOddsData.current.find(o =>
        o.name && o.name !== homeTeam && !o.name.toLowerCase().includes('hazai') && !o.name.toLowerCase().includes('döntetlen')
    );
    if (potentialAway) {
        // Próbáljuk meg kinyerni a nevet a standard formátumokból
        awayTeam = potentialAway.name.replace('Vendég győzelem', '').trim();
        // Ha nem standard a név (pl. kosárnál csak a csapatnév van), akkor azt használjuk
        if (awayTeam === potentialAway.name) { // Ha a replace nem csinált semmit
             awayTeam = potentialAway.name;
        }
    }

   
     if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból a mozgáselemzéshez.";
    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`; // Ez a kulcs formátum nem biztos, hogy jó, ha az openingOdds másképp van strukturálva
    const openingMatch = openingOddsData[key];
    // Feltételezzük, hogy az openingOdds így van tárolva

    const currentH2HMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h');
    const currentH2HOutcomes = currentH2HMarket?.outcomes;

    // Javítás: Ellenőrizzük az openingOdds struktúráját is
    if (!openingMatch || !openingMatch.h2h || !Array.isArray(openingMatch.h2h) || !currentH2HOutcomes) {
         console.warn(`Hiányzó H2H adatok a mozgáselemzéshez: Key=${key}, Opening data found=${!!openingMatch}, Current data found=${!!currentH2HOutcomes}`);
         return "Hiányzó H2H adatok a mozgáselemzéshez.";
    }

    let changes = [];
    currentH2HOutcomes.forEach(currentOutcome => {
        let simpleName = '';
        // Javítás: Biztonságosabb név ellenőrzés
        const lowerCurrentName = currentOutcome.name?.toLowerCase() || '';
        const lowerHome = homeTeam.toLowerCase();
        const lowerAway = awayTeam.toLowerCase();

        if (lowerCurrentName === lowerHome || lowerCurrentName.includes('hazai')) simpleName = homeTeam;
        else if (lowerCurrentName === lowerAway || lowerCurrentName.includes('vendég')) simpleName = awayTeam;
       
          else if (lowerCurrentName.includes('döntetlen') || lowerCurrentName === 'draw') simpleName = 'Döntetlen';

        if (simpleName) {
            const openingOutcome = openingMatch.h2h.find(oo => {
                const lowerOpeningName = oo.name?.toLowerCase() || '';
                 if (simpleName === homeTeam && (lowerOpeningName === lowerHome || lowerOpeningName.includes('hazai'))) return true;
             
                  if (simpleName === awayTeam && (lowerOpeningName === lowerAway || lowerOpeningName.includes('vendég'))) return true;
                  if (simpleName === 'Döntetlen' && (lowerOpeningName.includes('döntetlen') || lowerOpeningName === 'draw')) return true;
                 return false;
            });
            // Javítás: Ellenőrizzük az árak típusát is
      
             if (openingOutcome && typeof openingOutcome.price === 'number' && typeof currentOutcome.price === 'number') {
                const change = ((currentOutcome.price / openingOutcome.price) - 1) * 100;
                // Csak a jelentős (>3%) változásokat jelezzük
                if (Math.abs(change) > 3) {
      
                                 changes.push(`${simpleName}: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
                }
            }
        }
    });
    return changes.length > 0 ? `Jelentős oddsmozgás: ${changes.join(', ')}` : "Nincs jelentős oddsmozgás.";
}


// --- analyzePlayerDuels (Változatlan) ---
export function analyzePlayerDuels(keyPlayers, sport) {
    if (!keyPlayers || (!Array.isArray(keyPlayers.home) && !Array.isArray(keyPlayers.away))) return null;
    // Robusztusabb ellenőrzés
    try {
        const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó') || p?.role?.toLowerCase().includes('csatár') || p?.role?.toLowerCase().includes('scorer'));
        const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő') || p?.role?.toLowerCase().includes('hátvéd') || p?.role?.toLowerCase().includes('defender'));
        if (homeAttacker?.name && awayDefender?.name) { return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`;
        }
        if (sport === 'basketball') {
            
 const homePG = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            const awayPG = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            if (homePG?.name && awayPG?.name) { return `Az irányítók csatája (${homePG.name} vs ${awayPG.name}) meghatározó lehet a játék tempójára.`;
            }
        }
    } catch (e) { console.error("Hiba a játékos párharc elemzésekor:", e.message);
    }
    return null; // Ha nincs specifikus párharc, null-t adunk vissza
}

// --- Placeholder Funkciók (Változatlan) ---
export function generateProTip(probabilities, odds, market) { console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!");
    return "Pro Tipp generálása még nincs implementálva."; }
// calculateProbabilities már nem használt, mert a simulateMatchProgress adja a valószínűségeket
// export function calculateProbabilities(rawStats, homeAdvantage, avgGoals) { ... }
