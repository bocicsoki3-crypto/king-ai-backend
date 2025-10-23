import { SPORT_CONFIG } from './config.js'; // Importáljuk a sportág konfigurációt

// === DUMMY FÜGGVÉNYEK (HELYETTESÍTENDŐ!) ===
// Ezek a függvények az Apps Scriptben valószínűleg a Google Sheet-ből olvastak.
// Itt most csak üres objektumokat adnak vissza. Később pótolni kell!
function getAdjustedRatings() {
    // console.warn("Figyelmeztetés: getAdjustedRatings() dummy függvény hívva!");
    return {};
}

function getNarrativeRatings() {
    // console.warn("Figyelmeztetés: getNarrativeRatings() dummy függvény hívva!");
    return {};
}
// ===========================================

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
/**
 * Poisson distribution sampler using Knuth's algorithm.
 * @param {number} lambda The mean (average) rate.
 * @returns {number} A non-negative integer sampled from the Poisson distribution. Returns 0 if lambda <= 0 or invalid.
 */
function poisson(lambda) {
    if (lambda === null || typeof lambda !== 'number' || isNaN(lambda) || lambda < 0) return 0; // Hibás lambda -> 0
    if (lambda === 0) return 0; // Lambda 0 -> 0
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
 * Calculates event probabilities for a given game state.
 * Needs getNarrativeRatings to be implemented correctly.
 */
// Exportálva, mert buildPropheticTimeline hívja
export function calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const narrativeRatings = getNarrativeRatings(); // Dummy!
    const homeTeamLower = homeTeam.toLowerCase();
    const awayTeamLower = awayTeam.toLowerCase();
    const homeNarrative = narrativeRatings[homeTeamLower] || {};
    const awayNarrative = narrativeRatings[awayTeamLower] || {};
    const totalMu = (mu_h || 0) + (mu_a || 0); // Handle potential null/undefined mu
    if (totalMu === 0) return [{ type: 'NO_EVENT', probability: 1.0 }]; // Avoid division by zero
    const baseGoalProb = totalMu / (SPORT_CONFIG[sport]?.total_minutes / 5 || 18); // Base goal probability per time slice, default 18 (90/5)

    let homeGoalProb = (mu_h / totalMu) * baseGoalProb * gameState.home_momentum; // Home goal prob
    let awayGoalProb = (mu_a / totalMu) * baseGoalProb * gameState.away_momentum; // Away goal prob
    let homeCardProb = 0.08, awayCardProb = 0.08; // Base card probs
    if (sport === 'soccer') { // Soccer specific adjustments
        homeGoalProb *= 1 + (homeNarrative.set_piece_threat || 0); // Apply narrative rating
        awayGoalProb *= 1 + (awayNarrative.counter_attack_lethality || 0); // Apply narrative rating
        // Referee strictness adjustment for cards
        if (rawData?.referee && typeof rawData.referee.stats === 'string' && rawData.referee.stats.toLowerCase().includes("strict")) {
            homeCardProb = 0.15;
            awayCardProb = 0.15;
        }
    }
    const totalProb = homeGoalProb + awayGoalProb + homeCardProb + awayCardProb; // Sum of event probs
    const noEventProb = Math.max(0, 1 - totalProb); // Probability of no event

    // Return probabilities for all event types
    return [
        { type: 'HOME_GOAL', probability: homeGoalProb, team: 'home', detail: 'Gól' },
        { type: 'AWAY_GOAL', probability: awayGoalProb, team: 'away', detail: 'Gól' },
        { type: 'HOME_YELLOW_CARD', probability: homeCardProb, team: 'home', detail: 'Sárga lap' },
        { type: 'AWAY_YELLOW_CARD', probability: awayCardProb, team: 'away', detail: 'Sárga lap' },
        { type: 'NO_EVENT', probability: noEventProb },
    ];
}

/**
 * Selects an event based on calculated probabilities.
 */
function selectMostLikelyEvent(probabilities) {
    const totalP = probabilities.reduce((sum, p) => sum + (p.probability || 0), 0); // Calculate total probability safely
    if (totalP <= 0) return { type: 'NO_EVENT' }; // Handle zero or negative total probability
    const random = Math.random() * totalP; // Generate random number
    let cumulative = 0;
    for (const event of probabilities) { // Iterate through events
        cumulative += (event.probability || 0); // Add probability
        if (random < cumulative) { // Check if random number falls in this event's range
            return event; // Return the selected event
        }
    }
    return { type: 'NO_EVENT' }; // Fallback to no event
}

/**
 * Updates the game state based on the occurred event.
 */
function updateGameState(gameState, event) {
    switch (event.type) { // Update based on event type
        case 'HOME_GOAL':
            gameState.home_goals++; // Increment home goals
            gameState.home_momentum = 1.5; // Adjust momentum
            gameState.away_momentum = 0.7; // Adjust momentum
            break;
        case 'AWAY_GOAL':
            gameState.away_goals++; // Increment away goals
            gameState.away_momentum = 1.5; // Adjust momentum
            gameState.home_momentum = 0.7; // Adjust momentum
            break;
        // Card events currently don't change goals or momentum
    }
    return gameState; // Return updated state
}

/**
 * Builds a prophetic timeline simulation of the match.
 */
// Exportálva
export function buildPropheticTimeline(mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const timeline = []; // Initialize timeline
    let gameState = { time: 0, home_goals: 0, away_goals: 0, home_momentum: 1.0, away_momentum: 1.0, }; // Initial state
    const totalMinutes = SPORT_CONFIG[sport]?.total_minutes || 90; // Get total minutes or default to 90
    const timeSlice = 5; // Time slice duration
    for (let t = 0; t < totalMinutes; t += timeSlice) { // Loop through time slices
        gameState.time = t; // Update time
        // Decrease momentum slightly over time
        gameState.home_momentum = Math.max(1.0, gameState.home_momentum - 0.05);
        gameState.away_momentum = Math.max(1.0, gameState.away_momentum - 0.05);
        const eventProbabilities = calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam); // Calculate probs for this slice
        const event = selectMostLikelyEvent(eventProbabilities); // Select an event
        if (event.type !== 'NO_EVENT') { // If an event occurs
            const eventTime = t + Math.floor(Math.random() * (timeSlice - 1)) + 1; // Randomize time within slice
            event.time = eventTime; // Add time to event
            timeline.push(event); // Add event to timeline
            gameState = updateGameState(gameState, event); // Update game state
        }
    }
    return timeline; // Return the generated timeline
}

// === estimateXG ===
/**
 * Estimates expected goals (xG) or points based on various factors.
 * Uses dummy getAdjustedRatings.
 * @returns {object} {mu_h: estimated home goals/points, mu_a: estimated away goals/points}.
 */
// Exportálva
export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway) {
    const homeStats = rawStats?.home, awayStats = rawStats?.away; // Safe access
    const areStatsValid = (stats) => stats &&
        typeof stats.gp === 'number' && stats.gp > 1 && // Check gp > 1
        typeof stats.gf === 'number' && stats.gf >= 0 &&
        typeof stats.ga === 'number' && stats.ga >= 0;
    if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) { // If stats invalid
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS (gp>1): ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG.`); // Log
        const defaultGoals = sport === 'basketball' ? 110 : (sport === 'hockey' ? 3.0 : 1.35); // Defaults
        return { mu_h: defaultGoals * 1.05, mu_a: defaultGoals * 0.95 }; // Return defaults
    }

    let mu_h, mu_a;
    const MIN_STRENGTH = 0.2; // Min strength
    const MAX_STRENGTH = 5.0; // Max strength
    const logData = { step: 'Alap', sport: sport, home: homeTeam, away: awayTeam }; // Logging
    // Sport-specific base xG/points
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
        logData.avgOffRating = avgOffRating; logData.avgDefRating = avgDefRating; logData.avgPace = avgPace;
        logData.homePace = homePace; logData.awayPace = awayPace; logData.expectedPace = expectedPace;
        logData.homeOffRating = homeOffRating; logData.awayOffRating = awayOffRating; logData.homeDefRating = homeDefRating; logData.awayDefRating = awayDefRating;
        mu_h = (homeOffRating / avgOffRating) * (awayDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
        mu_a = (awayOffRating / avgOffRating) * (homeDefRating / avgDefRating) * avgOffRating * (expectedPace / 100);
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;
        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
            const homeFF = advancedData.home.four_factors;
            const awayFF = advancedData.away.four_factors;
            const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05; // Null check
            const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05; // Null check
            mu_h *= (1 + ore_advantage - tov_advantage);
            mu_a *= (1 - ore_advantage + tov_advantage);
            logData.ff_mod_h = (1 + ore_advantage - tov_advantage); logData.ff_mod_a = (1 - ore_advantage + tov_advantage);
        }
    } else if (sport === 'hockey' || sport === 'soccer') {
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || (sport === 'hockey' ? 3.0 : 1.35);
        logData.leagueAvgGoals = avgGoalsInLeague;
        logData.homeGP = homeStats.gp; logData.homeGF = homeStats.gf; logData.homeGA = homeStats.ga;
        logData.awayGP = awayStats.gp; logData.awayGF = awayStats.gf; logData.awayGA = awayStats.ga;
        let homeAttackStrength = (homeStats.gf / homeStats.gp) / avgGoalsInLeague;
        let awayAttackStrength = (awayStats.gf / awayStats.gp) / avgGoalsInLeague;
        let homeDefenseStrength = (homeStats.ga / homeStats.gp) / avgGoalsInLeague;
        let awayDefenseStrength = (awayStats.ga / awayStats.gp) / avgGoalsInLeague;
        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1)); // Null check
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1)); // Null check
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1)); // Null check
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1)); // Null check
        logData.homeAtkStr = homeAttackStrength; logData.awayAtkStr = awayAttackStrength;
        logData.homeDefStr = homeDefenseStrength; logData.awayDefStr = awayDefenseStrength;
        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;
        if (sport === 'hockey') {
            const home_pp_advantage = (advancedData?.home?.pp_pct ?? 15) - (advancedData?.away?.pk_pct ?? 85); // Null check
            const away_pp_advantage = (advancedData?.away?.pp_pct ?? 15) - (advancedData?.home?.pk_pct ?? 85); // Null check
            const pp_mod_h = (1 + (home_pp_advantage / 100) * 0.15);
            const pp_mod_a = (1 + (away_pp_advantage / 100) * 0.15);
            mu_h *= pp_mod_h; mu_a *= pp_mod_a;
            logData.pp_mod_h = pp_mod_h; logData.pp_mod_a = pp_mod_a;
            const leagueAvgSavePct = leagueAverages?.avg_goalie_save_pct || 0.905;
            const homeGoalieSavePct = advancedData?.home?.starting_goalie_save_pct_last5 || advancedData?.home?.goalie_save_pct_season || leagueAvgSavePct;
            const awayGoalieSavePct = advancedData?.away?.starting_goalie_save_pct_last5 || advancedData?.away?.goalie_save_pct_season || leagueAvgSavePct;
            const homeGoalieFactor = Math.max(0.8, Math.min(1.2, (homeGoalieSavePct || leagueAvgSavePct) / leagueAvgSavePct)); // Null check
            const awayGoalieFactor = Math.max(0.8, Math.min(1.2, (awayGoalieSavePct || leagueAvgSavePct) / leagueAvgSavePct)); // Null check
            mu_h /= awayGoalieFactor; mu_a /= homeGoalieFactor;
            logData.goalie_mod_h = 1 / awayGoalieFactor; logData.goalie_mod_a = 1 / homeGoalieFactor;
        }
        if (sport === 'soccer' && advancedData?.home?.xg != null && advancedData?.away?.xg != null) { // Check for non-null xG
            const maxRealisticXG = 7.0;
            mu_h = Math.max(0, Math.min(maxRealisticXG, advancedData.home.xg));
            mu_a = Math.max(0, Math.min(maxRealisticXG, advancedData.away.xg));
            logData.source = 'SportMonks xG';
            if (advancedData.home.xg > maxRealisticXG || advancedData.away.xg > maxRealisticXG) {
                console.warn(`Figyelem: SportMonks irreális xG (${homeTeam} vs ${awayTeam}): H=${advancedData.home.xg}, A=${advancedData.away.xg}. Korlátozva ${maxRealisticXG}-ra.`);
                logData.source += ' (Korlátozva)';
            }
            logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;
        } else if (sport === 'soccer') {
            logData.source = 'Calculated xG';
        }
    }

    // Általános Módosítók
    logData.step = 'Módosítók';
    // Súlyozott Forma Faktor
    const getFormPoints = (formString) => {
        if (!formString || typeof formString !== 'string') return 0; // Invalid -> 0 points
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        return wins * 3 + draws * 1;
    };
    const homeOverallFormPts = getFormPoints(form?.home_overall); const awayOverallFormPts = getFormPoints(form?.away_overall); const homeVenueFormPts = getFormPoints(form?.home_home); const awayVenueFormPts = getFormPoints(form?.away_away);
    const homeFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? // Use weighted only if venue form exists
                           (0.6 * (homeVenueFormPts / 15)) + (0.4 * (homeOverallFormPts / 15)) : (homeOverallFormPts / 15);
    const awayFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? // Use weighted only if venue form exists
                           (0.6 * (awayVenueFormPts / 15)) + (0.4 * (awayOverallFormPts / 15)) : (awayOverallFormPts / 15);
    const formImpactFactor = 0.1;
    const form_mod_h = (1 + (homeFormFactor - 0.5) * formImpactFactor);
    const form_mod_a = (1 + (awayFormFactor - 0.5) * formImpactFactor);
    mu_h *= form_mod_h; mu_a *= form_mod_a;
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a;
    // Dinamikus Hazai Pálya Előny
    const baseHomeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0;
    const baseAwayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
    const leagueHomeWinPct = leagueAverages?.home_win_pct || (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const defaultHomeWinPct = (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const homeAdvMultiplier = defaultHomeWinPct > 0 ? (leagueHomeWinPct / defaultHomeWinPct) : 1; // Avoid division by zero
    const awayAdvMultiplier = (1-defaultHomeWinPct) > 0 ? ((1 - leagueHomeWinPct) / (1- defaultHomeWinPct)) : 1; // Avoid division by zero
    const home_adv_mod = baseHomeAdv * homeAdvMultiplier;
    const away_adv_mod = baseAwayAdv * awayAdvMultiplier;
    mu_h *= home_adv_mod; mu_a *= away_adv_mod;
    logData.home_adv_mod = home_adv_mod; logData.away_adv_mod = away_adv_mod;
    // Power Ratings (Dummy!)
    const powerRatings = getAdjustedRatings(); // Dummy!
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase();
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1 }; const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1 }; // Defaults
    const pr_mod_h = (homePR.atk ?? 1) * (awayPR.def ?? 1); // Null check
    const pr_mod_a = (awayPR.atk ?? 1) * (homePR.def ?? 1); // Null check
    mu_h *= pr_mod_h; mu_a *= pr_mod_a;
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def; logData.awayPR_atk = awayPR.atk; logData.awayPR_def = awayPR.def;
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;
    // Pszichológiai Faktorok
    const psyMultiplier = 1.1;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier; // Null check
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier; // Null check
    mu_h *= psy_mod_h; mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;
    // Hiányzók Hatása
    const impactAnalysis = rawData?.absentee_impact_analysis?.toLowerCase();
    let homeImpact = 1.0, awayImpact = 1.0;
    if (impactAnalysis && impactAnalysis !== "nincs jelentős hatás.") {
        if (impactAnalysis.includes(homeTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány") || impactAnalysis.includes("weakened"))) homeImpact -= 0.05;
        if (impactAnalysis.includes(awayTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány") || impactAnalysis.includes("weakened"))) awayImpact -= 0.05;
        if (impactAnalysis.includes("nyíltabb játék") || impactAnalysis.includes("több gól") || impactAnalysis.includes("open game")) { homeImpact += 0.02; awayImpact += 0.02; }
        if (impactAnalysis.includes("védekezőbb") || impactAnalysis.includes("kevesebb gól") || impactAnalysis.includes("defensive") || impactAnalysis.includes("fewer goals")) { homeImpact -= 0.02; awayImpact -= 0.02; }
        mu_h *= homeImpact; mu_a *= awayImpact;
    }
    logData.abs_mod_h = homeImpact; logData.abs_mod_a = awayImpact;
    // Időjárás Hatása
    const weather = rawData?.contextual_factors?.weather?.toLowerCase();
    let weatherFactor = 1.0;
    if (weather) {
        if (weather.includes("eső") || weather.includes("rain")) weatherFactor -= 0.03;
        if (weather.includes("hó") || weather.includes("snow")) weatherFactor -= 0.05;
        if (weather.includes("erős szél") || weather.includes("strong wind")) weatherFactor -= 0.02;
        if (weather.includes("rossz pálya") || weather.includes("poor pitch")) weatherFactor -= 0.04;
        if (weatherFactor < 1.0) { mu_h *= weatherFactor; mu_a *= weatherFactor; }
    }
    logData.weather_mod = weatherFactor;
    // Minimum érték
    const minVal = sport === 'basketball' ? 80 : (sport === 'hockey' ? 1.5 : 0.5);
    mu_h = Math.max(minVal, mu_h || minVal); // Null check
    mu_a = Math.max(minVal, mu_a || minVal); // Null check
    // Végső Korlátozás
    const finalMaxVal = sport === 'basketball' ? 200 : (sport === 'hockey' ? 10 : 7);
    if (mu_h > finalMaxVal || mu_a > finalMaxVal) {
        console.warn(`Figyelem: xG/Pont korlátozás (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} -> Max ${finalMaxVal}. Log: ${JSON.stringify(logData)}`);
        logData.step = 'Végső Korlátozás';
    }
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);
    // Végső Log
    logData.final_mu_h = mu_h; logData.final_mu_a = mu_a;
    logData.step = 'Végeredmény';
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
    // Részletes log (kikommentelve)
    // console.log(`estimateXG Részletes Log (${homeTeam} vs ${awayTeam}): ${JSON.stringify(logData)}`);
    return { mu_h, mu_a };
}

// === estimateAdvancedMetrics ===
/**
 * Estimates expected corners and cards based on available data.
 * @returns {object} {mu_corners: estimated corners, mu_cards: estimated cards}.
 */
// Exportálva
export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    let mu_corners = leagueAverages?.avg_corners || 10.5; // Default from league or constant
    let mu_cards = leagueAverages?.avg_cards || 4.5; // Default from league or constant

    if (sport === 'soccer') { // Only for soccer
        const adv = rawData?.advanced_stats; // Safe access
        const tactics = rawData?.tactics; // Safe access
        const referee = rawData?.referee; // Safe access
        const context = rawData?.contextual_factors; // Safe access

        // --- Corners ---
        const hasAdvCornerData = adv?.home && adv?.away &&
            typeof adv.home.avg_corners_for_per_game === 'number' &&
            typeof adv.away.avg_corners_for_per_game === 'number'; // Check if corner data exists
        if (!hasAdvCornerData) { // If missing
            mu_corners = leagueAverages?.avg_corners || 10.5; // Use defaults
            // Estimate based on possession and shots (using defaults if missing)
            const homePossession = adv?.home?.possession_pct ?? 50; // Use default 50 if missing
            const awayPossession = adv?.away?.possession_pct ?? 50; // Use default 50 if missing
            const homeShots = adv?.home?.shots ?? 12; // Use default 12 if missing
            const awayShots = adv?.away?.shots ?? 12; // Use default 12 if missing
            const possessionFactor = ((homePossession - 50) - (awayPossession - 50)) / 100; // Calculate factor
            const shotsFactor = ((homeShots - 12) + (awayShots - 12)) / 50; // Calculate factor
            mu_corners *= (1 + possessionFactor * 0.2 + shotsFactor * 0.3); // Apply factors
        } else { // If data exists
            const homeCorners = adv.home.avg_corners_for_per_game; //
            const awayCorners = adv.away.avg_corners_for_per_game; //
            mu_corners = homeCorners + awayCorners; // Use sum of averages
        }

        // Tactical modifier
        if (tactics?.home?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05; //
        if (tactics?.away?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05; //

        // --- Cards ---
        const hasAdvCardData = adv?.home && adv?.away &&
            typeof adv.home.avg_cards_per_game === 'number' &&
            typeof adv.away.avg_cards_per_game === 'number'; // Check if card data exists
        if (!hasAdvCardData) { // If missing
            mu_cards = leagueAverages?.avg_cards || 4.5; // Use defaults
            // Estimate based on fouls
            const homeFouls = adv?.home?.fouls ?? 11; // Use default 11 if missing
            const awayFouls = adv?.away?.fouls ?? 11; // Use default 11 if missing
            const totalFoulsFactor = ((homeFouls - 11) + (awayFouls - 11)) / 30; // Calculate factor
            mu_cards *= (1 + totalFoulsFactor * 0.4); // Apply factor
        } else { // If data exists
            mu_cards = adv.home.avg_cards_per_game + adv.away.avg_cards_per_game; // Use sum of averages
        } //

        // Referee impact
        if (referee?.stats) { //
            const cardMatch = referee.stats.match(/(\d\.\d+)/); // Extract avg cards
            if (cardMatch) { // If avg found
                const refereeAvg = parseFloat(cardMatch[1]); // Parse
                mu_cards = mu_cards * 0.6 + refereeAvg * 0.4; // Blend
            } else if (referee.stats.toLowerCase().includes("strict") || referee.stats.toLowerCase().includes("szigorú")) { // Strict?
                mu_cards *= 1.15; // Increase
            } else if (referee.stats.toLowerCase().includes("lenient") || referee.stats.toLowerCase().includes("engedékeny")) { // Lenient?
                mu_cards *= 0.85; // Decrease
            } //
        } //

        // Match tension impact
        const tension = context?.match_tension_index || 'low'; // Default low
        if (tension.toLowerCase() === 'high') mu_cards *= 1.1; // Increase
        if (tension.toLowerCase() === 'extreme') mu_cards *= 1.25; // Increase more
        // Weather impact on cards
        const weather = context?.weather?.toLowerCase(); //
        if (weather && (weather.includes("eső") || weather.includes("hó") || weather.includes("rain") || weather.includes("snow"))) { //
            mu_cards *= 1.05; // Slight increase
        } //

        // Apply minimum values
        mu_corners = Math.max(3, mu_corners || 3); // Min 3, null check
        mu_cards = Math.max(1.5, mu_cards || 1.5); // Min 1.5, null check
    } //
    return { mu_corners, mu_cards }; // Return estimates
}

// === simulateMatchProgress ===
/**
 * Simulates match outcomes based on expected values.
 * @returns {object} Object containing probabilities for various markets.
 */
// Exportálva
export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, liveScenario, mainTotalsLine, rawData) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0; // Counters
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0; // Corner counters
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0; // Card counters
    const scores = {}; // Score map
    const safeSims = Math.max(1, sims || 1); // Ensure sims > 0

    if (sport === 'basketball') { // Basketball simulation
        const stdDev = 11.5; //
        for (let i = 0; i < safeSims; i++) { //
            const gh = Math.round(sampleNormal(mu_h, stdDev)); //
            const ga = Math.round(sampleNormal(mu_a, stdDev)); //
            const scoreKey = `${gh}-${ga}`; scores[scoreKey] = (scores[scoreKey] || 0) + 1; //
            if (gh > ga) home++; else if (ga > gh) away++; else draw++; //
            if ((gh + ga) > mainTotalsLine) over_main++; //
        } //
    } else { // Soccer & Hockey simulation
        for (let i = 0; i < safeSims; i++) { //
            const { gh, ga } = sampleGoals(mu_h, mu_a); // Sample goals
            const scoreKey = `${gh}-${ga}`; scores[scoreKey] = (scores[scoreKey] || 0) + 1; //
            if (gh > ga) home++; else if (ga > gh) away++; else draw++; // Update winner
            if (gh > 0 && ga > 0) btts++; // Update BTTS
            if (mainTotalsLine != null && (gh + ga) > mainTotalsLine) over_main++; // Update Over (check line exists)
            if (sport === 'soccer') { // Soccer specific
                const corners = poisson(mu_corners); // Sample corners
                if (corners > 7.5) corners_o7_5++; if (corners > 8.5) corners_o8_5++; if (corners > 9.5) corners_o9_5++; if (corners > 10.5) corners_o10_5++; if (corners > 11.5) corners_o11_5++; // Update corners
                const cards = poisson(mu_cards); // Sample cards
                if (cards > 3.5) cards_o3_5++; if (cards > 4.5) cards_o4_5++; if (cards > 5.5) cards_o5_5++; if (cards > 6.5) cards_o6_5++; // Update cards
            } //
        } //
    }

    // Adjust for OT/SO
    if (sport !== 'soccer' && draw > 0) { //
        const totalWinsBeforeOT = home + away; //
        if (totalWinsBeforeOT > 0) { home += draw * (home / totalWinsBeforeOT); away += draw * (away / totalWinsBeforeOT); } // Distribute proportionally
        else { home += draw / 2; away += draw / 2; } // Split 50/50
        draw = 0; // Reset draw count
    } //

    const toPct = x => (100 * x / safeSims); // Percent helper
    const topScoreKey = Object.keys(scores).length > 0 ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0') : '0-0'; // Find top score
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number); // Get top score goals

    return { // Return results
        pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts), // Basic probs
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main), // Main line O/U
        corners: { 'o7.5': toPct(corners_o7_5), 'o8.5': toPct(corners_o8_5), 'o9.5': toPct(corners_o9_5), 'o10.5': toPct(corners_o10_5), 'o11.5': toPct(corners_o11_5) }, // Corner probs
        cards: { 'o3.5': toPct(cards_o3_5), 'o4.5': toPct(cards_o4_5), 'o5.5': toPct(cards_o5_5), 'o6.5': toPct(cards_o6_5) }, // Card probs
        scores, topScore: { gh: top_gh, ga: top_ga }, // Score details
        mainTotalsLine: mainTotalsLine, // Include the line used for O/U calculation
        mu_h_sim: mu_h, mu_a_sim: mu_a, mu_corners_sim: mu_corners, mu_cards_sim: mu_cards // Input mus for reference
    }; //
}

// === calculateModelConfidence ===
/**
 * Calculates a confidence score for the model's prediction.
 * Uses dummy getAdjustedRatings.
 * @returns {number} Confidence score between 1.0 and 10.0.
 */
// Exportálva
export function calculateModelConfidence(sport, home, away, rawData, form, sim) {
    let score = 5.0; // Base score
    const MAX_SCORE = 10.0; const MIN_SCORE = 1.0; // Limits
    try { // Error handling
        // Form helper
        const getFormPoints = (formString) => { //
             if (!formString || typeof formString !== 'string') return null; // Invalid -> null
             const wins = (formString.match(/W/g) || []).length; const draws = (formString.match(/D/g) || []).length; const total = (formString.match(/[WDL]/g) || []).length; // Count W,D,L
             return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null; // Calculate score (0 to 1)
        }; //
        const homeOverallFormScore = getFormPoints(form?.home_overall); const awayOverallFormScore = getFormPoints(form?.away_overall); // Get form scores
        // Form vs Sim contradiction check
        if (homeOverallFormScore != null && awayOverallFormScore != null) { //
            const formDiff = homeOverallFormScore - awayOverallFormScore; // Form diff
            const simDiff = (sim.pHome - sim.pAway) / 100; // Sim diff
            if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5; } // Decrease if contradicts
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75; } // Increase if aligns
        } //

        // xG difference impact
        const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim); // xG diff
        const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4; // High threshold
        const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15; // Low threshold
        if (xgDiff > thresholdHigh) score += 1.5; if (xgDiff < thresholdLow) score -= 1.0; // Adjust score
        // H2H recency impact
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) { // If H2H exists
            try { const latestH2HDate = new Date(rawData.h2h_structured[0].date); // Get latest date
                  const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2); // 2 years ago
                  if (latestH2HDate < twoYearsAgo) { score -= 0.75; } else { score += 0.25; } // Adjust score based on recency
            } catch(e) { /* Ignore date errors */ } //
        } else { score -= 0.25; } // Decrease if no H2H

        // Key absentee impact
        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length || 0; // Count key absentees
        const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0; // Count key absentees
        if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.0 * homeKeyAbsentees); } // Decrease if fav has absentees
        if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.0 * awayKeyAbsentees); } // Decrease if fav has absentees
        if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.5 * awayKeyAbsentees); } // Increase if opp has absentees
        if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.5 * homeKeyAbsentees); } // Increase if opp has absentees

        // Historical data availability (Dummy!)
        const adjustedRatings = getAdjustedRatings(); // Dummy!
        const homeHistory = adjustedRatings[home.toLowerCase()]; const awayHistory = adjustedRatings[away.toLowerCase()]; //
        if (homeHistory && homeHistory.matches > 10) score += 0.25; if (awayHistory && awayHistory.matches > 10) score += 0.25; // Increase if >10
        if (homeHistory && homeHistory.matches > 25) score += 0.25; if (awayHistory && awayHistory.matches > 25) score += 0.25; // Increase more if >25

    } catch(e) { // Error handling
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`); // Log error
        return Math.max(MIN_SCORE, 4.0); // Return default low-mid confidence
    } //
    // Return final score capped
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score)); //
}

// --- Pszichológiai Profil (Egyszerűsített) ---
// Exportálva
export function calculatePsychologicalProfile(teamName, opponentName) {
    let moraleIndex = 1.0; // Neutral
    let pressureIndex = 1.0; // Neutral
    // Placeholder for future logic
    return { moraleIndex, pressureIndex };
}

// --- Érték Számítás ---
/**
 * Calculates potential value bets by comparing simulation probabilities to market odds.
 * @returns {Array<object>} Sorted array of value bets found (value > 5%).
 */
// Exportálva
export function calculateValue(sim, oddsData, sport, homeTeam, awayTeam) {
    const valueBets = []; // Init
    if (!oddsData || !oddsData.current || oddsData.current.length === 0 || !sim) { return valueBets; } // Check data

    // Helper to find probability
    const findProb = (marketName) => {
        if (!marketName) return null; //
        const lowerMarket = marketName.toLowerCase(); //

        if (lowerMarket.includes('hazai győzelem') || lowerMarket === homeTeam.toLowerCase()) return sim.pHome / 100; // Home
        if (lowerMarket.includes('vendég győzelem') || lowerMarket === awayTeam.toLowerCase()) return sim.pAway / 100; // Away
        if (lowerMarket.includes('döntetlen') || lowerMarket === 'draw') return sim.pDraw / 100; // Draw (only relevant for soccer?)

        const ouMatch = lowerMarket.match(/(over|under|alatt|felett)\s*(\d+(\.\d+)?)/); // O/U regex
        if (ouMatch) { //
            const line = parseFloat(ouMatch[2]); // Extract line
            // Check main total line first
            if (sim.mainTotalsLine != null && line === sim.mainTotalsLine) { // Use mainTotalsLine from sim object
                const isOver = ouMatch[1] === "over" || ouMatch[1] === "felett"; // Check Over
                return isOver ? sim.pOver / 100 : sim.pUnder / 100; // Return prob
            }
            // Check corners
            if ((lowerMarket.includes('corners') || lowerMarket.includes('szöglet')) && sim.corners) { //
                const key = `${ouMatch[1] === 'over' || ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`; // Create key (e.g., o9.5)
                if(sim.corners[key] != null) return sim.corners[key] / 100; // Return if exists
            } //
            // Check cards
            if ((lowerMarket.includes('cards') || lowerMarket.includes('lap')) && sim.cards) { //
                const key = `${ouMatch[1] === 'over' || ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`; // Create key (e.g., o4.5)
                if(sim.cards[key] != null) return sim.cards[key] / 100; // Return if exists
            } //
        } //

        // Check BTTS
        if (lowerMarket.includes('btts') || lowerMarket.includes('mindkét csapat szerez gólt')) { //
            const bttsYes = lowerMarket.includes("igen") || !lowerMarket.includes("nem"); // Check Yes
            return bttsYes ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100; // Return prob
        } //

        return null; // Market not found
    }; //

    oddsData.current.forEach(outcome => { // Iterate odds
        const probability = findProb(outcome.name); // Find prob
        if (probability != null && typeof outcome.price === 'number' && outcome.price > 1) { // Check valid prob and price
            const value = (probability * outcome.price) - 1; // Calculate value
            if (value > 0.05) { // Threshold 5%
                valueBets.push({ market: outcome.name, odds: outcome.price, probability: (probability * 100).toFixed(1) + '%', value: (value * 100).toFixed(1) + '%' }); // Add bet
            } //
        } //
    }); //
    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value)); // Sort and return
}

// --- Piaci Mozgás Elemzése ---
/**
 * Analyzes significant line movement between opening and current odds.
 * @returns {string} A summary of significant line movements or a message indicating none.
 */
// Exportálva
export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
     if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) { // Check data
        return "Nincs elég adat a piaci mozgás elemzéséhez."; //
     } //

    let awayTeam = ''; // Init away team
    // Find away team name
    const awayOutcome = currentOddsData.current.find(o => //
        o.name.toLowerCase().includes('vendég') || // Soccer/Hockey
        (SPORT_CONFIG[sport]?.name === 'basketball' && o.name !== homeTeam && !o.name.toLowerCase().includes('döntetlen')) // Basketball
    ); //
    if (awayOutcome) { awayTeam = awayOutcome.name.replace('Vendég győzelem', '').trim(); if (sport === 'basketball') awayTeam = awayOutcome.name; } // Extract name
    if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból a mozgáselemzéshez."; // Error if not found

    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`; // Create key
    const openingMatch = openingOddsData[key]; // Get opening odds
    const currentH2HMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h'); // Get current H2H
    const currentH2HOutcomes = currentH2HMarket?.outcomes; // Get outcomes
    if (!openingMatch?.h2h || !currentH2HOutcomes) return "Hiányzó H2H adatok a mozgáselemzéshez."; // Check data

    let changes = []; // Init changes array
    currentH2HOutcomes.forEach(currentOutcome => { // Iterate current outcomes
        let simpleName = ''; // Standardized name
        const lowerCurrentName = currentOutcome.name.toLowerCase(); // Lowercase name
        if (lowerCurrentName === homeTeam.toLowerCase() || lowerCurrentName.includes('hazai')) simpleName = homeTeam; // Home
        else if (lowerCurrentName === awayTeam.toLowerCase() || lowerCurrentName.includes('vendég')) simpleName = awayTeam; // Away
        else if (lowerCurrentName.includes('döntetlen') || lowerCurrentName === 'draw') simpleName = 'Döntetlen'; // Draw

        if (simpleName) { // If name found
            const openingOutcome = openingMatch.h2h.find(oo => { // Find opening equivalent
                 const lowerOpeningName = oo.name.toLowerCase(); // Lowercase opening name
                 if (simpleName === homeTeam && (lowerOpeningName === homeTeam.toLowerCase() || lowerOpeningName.includes('hazai'))) return true; // Match home
                 if (simpleName === awayTeam && (lowerOpeningName === awayTeam.toLowerCase() || lowerOpeningName.includes('vendég'))) return true; // Match away
                 if (simpleName === 'Döntetlen' && (lowerOpeningName.includes('döntetlen') || lowerOpeningName === 'draw')) return true; // Match draw
                 return false; // No match
            }); //

            if (openingOutcome && typeof openingOutcome.price === 'number' && typeof currentOutcome.price === 'number') { // If found and prices valid
                const change = ((currentOutcome.price / openingOutcome.price) - 1) * 100; // Calculate change %
                if (Math.abs(change) > 3) { // Threshold 3%
                    changes.push(`${simpleName}: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`); // Add change
                } //
            } //
        } //
    }); //
    return changes.length > 0 ? `Jelentős oddsmozgás: ${changes.join(', ')}` : "Nincs jelentős oddsmozgás."; // Return result string
} //

// --- Játékos Párharcok ---
/**
 * Analyzes potential key player duels based on roles.
 * @returns {string|null} A description of a key duel or null if none identified.
 */
// Exportálva
export function analyzePlayerDuels(keyPlayers, sport) {
    if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) return null; // Check data
    try { // Error handling
        // Home Attacker vs Away Defender
        const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó') || p?.role?.toLowerCase().includes('csatár') || p?.role?.toLowerCase().includes('scorer')); // Null checks
        const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő') || p?.role?.toLowerCase().includes('hátvéd') || p?.role?.toLowerCase().includes('defender')); // Null checks
        if (homeAttacker?.name && awayDefender?.name) { // If found
            return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`; // Return duel
        } //
        // Basketball Point Guards
        if (sport === 'basketball') { //
            const homePG = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard')); // Null checks
            const awayPG = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard')); // Null checks
            if (homePG?.name && awayPG?.name) { // If found
                return `Az irányítók csatája (${homePG.name} vs ${awayPG.name}) meghatározó lehet a játék tempójára.`; // Return duel
            } //
        } //
    } catch (e) { console.error("Hiba a játékos párharc elemzésekor:", e.message); } // Log error
    return null; // No duel found
}

// === generateProTip PLACEHOLDER ===
/**
 * Placeholder function for generating a pro tip.
 * Needs to be implemented based on requirements.
 * @returns {string} Placeholder text.
 */
// JAVÍTÁS: Exportálva, mert AI_Service hívja
export function generateProTip(probabilities, odds, market) {
    console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!");
    return "Pro Tipp generálása még nincs implementálva.";
}

// === calculateProbabilities PLACEHOLDER ===
/**
 * Placeholder function for calculateProbabilities.
 * The actual probabilities are calculated within simulateMatchProgress.
 * This exists because AI_Service.js currently imports it.
 * @returns {object} A placeholder object with null values.
 */
// JAVÍTÁS: Exportálva, mert AI_Service hívja
export function calculateProbabilities(rawStats, homeAdvantage, avgGoals) {
    console.warn("Figyelmeztetés: calculateProbabilities() placeholder függvény hívva. A valós számítás a simulateMatchProgress-ben történik.");
    return { // Return placeholder structure with nulls
        pHome: null, pDraw: null, pAway: null, pBTTS: null,
        pOver: null, pUnder: null
        // Add other keys if AI_Service expects them (e.g., corners, cards)
    };
}

// === Fő Export (opcionális, de maradhat kommentelve) ===
/*
export default {
    estimateXG,
    estimateAdvancedMetrics,
    simulateMatchProgress,
    calculateModelConfidence,
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement,
    analyzePlayerDuels,
    buildPropheticTimeline,
    calculateEventProbabilities, // Ezt valószínűleg nem kellene exportálni
    generateProTip, // Placeholder
    calculateProbabilities // Placeholder
};
*/