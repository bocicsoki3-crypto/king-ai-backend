import { SPORT_CONFIG } from './config.js'; // Importáljuk a sportág konfigurációt
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';
/**************************************************************
* Model.js - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
* - estimateXG: Figyelembe veszi a kulcshiányzók posztját, a meccs fontosságát,
* a formációkat és finomabban kezeli az időjárást.
* VÁLTOZÁS (Fejlesztési Csomag):
* - estimateXG: Teljesen átírva, sport-specifikus modellekkel (Kosár: Taktika; Hoki: HDCF%, GSAx; Foci: Játékos Hatás) és strukturált időjárással.
* - calculateEventProbabilities/buildPropheticTimeline: Bővítve a foci eseménygenerálás részletezéséhez (stílus alapján).
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
    let homeProbFactor = mu_h > 0 ? mu_h / totalMu : 0.5;
    let awayProbFactor = mu_a > 0 ? mu_a / totalMu : 0.5;

    let baseHomeGoalProb = homeProbFactor * baseGoalProbPerSlice * gameState.home_momentum;
    let baseAwayGoalProb = awayProbFactor * baseGoalProbPerSlice * gameState.away_momentum;

    // Eseménytípusok inicializálása
    let homeGoalProb_OpenPlay = baseHomeGoalProb * 0.7; // Alapból 70% akcióból
    let homeGoalProb_SetPiece = baseHomeGoalProb * 0.2; // 20% pontrúgásból
    let homeGoalProb_Counter = baseHomeGoalProb * 0.1; // 10% kontrából (hazai csapatnál ritkább)

    let awayGoalProb_OpenPlay = baseAwayGoalProb * 0.6; // Vendég 60% akcióból
    let awayGoalProb_SetPiece = baseAwayGoalProb * 0.2; // 20% pontrúgásból
    let awayGoalProb_Counter = baseAwayGoalProb * 0.2; // 20% kontrából (vendégnél gyakoribb)

    // Stílus-alapú módosítók (ha vannak adatok)
    if (sport === 'soccer' && rawData?.tactical_patterns) {
        const homePatterns = rawData.tactical_patterns.home || [];
        const awayPatterns = rawData.tactical_patterns.away || [];

        // Hazai támadás módosítók
        if (homePatterns.some(p => p.includes('set-piece threat') || p.includes('pontrúgásból veszélyes'))) homeGoalProb_SetPiece *= 1.5;
        if (homePatterns.some(p => p.includes('counter') || p.includes('kontra'))) homeGoalProb_Counter *= 1.8;
        if (homePatterns.some(p => p.includes('wing play') || p.includes('szélső játék'))) homeGoalProb_OpenPlay *= 1.1; // Szélen több az akció

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
    if (rawData?.referee?.style && typeof rawData.referee.style === 'string' && rawData.referee.style.toLowerCase().includes("strict")) {
        homeCardProb = 0.15;
        awayCardProb = 0.15;
    }

    // Összesítés és normalizálás (hogy a summa <= 1 legyen)
    const totalEventProb = homeGoalProb_OpenPlay + homeGoalProb_SetPiece + homeGoalProb_Counter +
                           awayGoalProb_OpenPlay + awayGoalProb_SetPiece + awayGoalProb_Counter +
                           homeCardProb + awayCardProb;

    const scaleFactor = totalEventProb > 0.95 ? 0.95 / totalEventProb : 1; // Max 95% esély eseményre

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
                team: event.team, 
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
// A TELJES 'estimateXG' FÜGGVÉNY CSERÉJE
// (Figyelem: Ez felülírja a korábbi estimateXG-t a feltöltött fájlban)

export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway) {
    const homeStats = rawStats?.home, awayStats = rawStats?.away;
    const areStatsValid = (stats) => stats &&
        typeof stats.gp === 'number' && stats.gp > 1 &&
        typeof stats.gf === 'number' && stats.gf >= 0 &&
        typeof stats.ga === 'number' && stats.ga >= 0;

    if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS (gp>1): ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG.`);
        const defaultGoals = sport === 'basketball' ? 110 : (sport === 'hockey' ? 3.0 : 1.35);
        return { mu_h: defaultGoals * 1.05, mu_a: defaultGoals * 0.95 };
    }

    let mu_h, mu_a;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;
    const logData = { step: 'Alap', sport: sport, home: homeTeam, away: awayTeam };

    // --- Sport-specifikus alap xG/pont ---

    if (sport === 'basketball') {
        // --- KOSÁRLABDA FEJLESZTÉS ---
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

        // Four Factors (marad)
        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
            const homeFF = advancedData.home.four_factors;
            const awayFF = advancedData.away.four_factors;
            const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05; // Null check
            const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05; // Null check
            mu_h *= (1 + ore_advantage - tov_advantage);
            mu_a *= (1 - ore_advantage + tov_advantage);
            logData.ff_mod_h = (1 + ore_advantage - tov_advantage);
            logData.ff_mod_a = (1 - ore_advantage + tov_advantage);
        }

        // --- ÚJ: Taktikai Párharc Módosító (Dobás Disztribúció) ---
        logData.step = 'Kosárlabda Taktika';
        let bb_tactical_mod_h = 1.0;
        let bb_tactical_mod_a = 1.0;
        const homeShotDist = rawData?.shot_distribution?.home?.toLowerCase() || 'n/a';
        const awayShotDist = rawData?.shot_distribution?.away?.toLowerCase() || 'n/a';
        const homeDefStyle = rawData?.defensive_style?.home?.toLowerCase() || 'n/a';
        const awayDefStyle = rawData?.defensive_style?.away?.toLowerCase() || 'n/a';

        // Hazai támadás vs Vendég védekezés
        if (homeShotDist.includes("3-point") || homeShotDist.includes("hárompontos")) {
            if (awayDefStyle.includes("aggressive perimeter") || awayDefStyle.includes("agresszív periméter")) bb_tactical_mod_h *= 0.98; // Rossz párharc
            if (awayDefStyle.includes("weak perimeter") || awayDefStyle.includes("gyenge periméter")) bb_tactical_mod_h *= 1.02; // Jó párharc
        }
        if (homeShotDist.includes("paint") || homeShotDist.includes("festék")) {
            if (awayDefStyle.includes("strong interior") || awayDefStyle.includes("erős belső")) bb_tactical_mod_h *= 0.98;
            if (awayDefStyle.includes("weak interior") || awayDefStyle.includes("gyenge belső")) bb_tactical_mod_h *= 1.02;
        }

        // Vendég támadás vs Hazai védekezés
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
        // --- KOSÁRLABDA FEJLESZTÉS VÉGE ---

    } else if (sport === 'hockey') {
        // --- JÉGKORONG FEJLESZTÉS ---
        logData.step = 'Jégkorong Alap';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 3.0;
        const leagueAvgHDCF_Pct = leagueAverages?.avg_high_danger_chances_pct || 50.0;
        const leagueAvgGSAx = leagueAverages?.avg_gsax || 0.0;
        
        // Alap támadóerő (GF/GP helyett High-Danger helyzetek alapján)
        const homeHDCF_Pct = rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct || 50.0;
        const awayHDCF_Pct = rawData?.advanced_stats_team?.away?.High_Danger_Chances_For_Pct || 50.0;
        
        // Alap védekezőerő (GA/GP helyett High-Danger helyzetek alapján)
        const homeHDCA_Pct = 100.0 - (rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct || 50.0);
        const awayHDCA_Pct = 100.0 - (rawData?.advanced_stats_team?.away?.High_Danger_Chances_For_Pct || 50.0);
        
        let homeAttackStrength = (homeHDCF_Pct / leagueAvgHDCF_Pct);
        let awayAttackStrength = (awayHDCF_Pct / leagueAvgHDCF_Pct);
        let homeDefenseStrength = (homeHDCA_Pct / (100.0 - leagueAvgHDCF_Pct)); // Védekezés (engedett HD helyzetek)
        let awayDefenseStrength = (awayHDCA_Pct / (100.0 - leagueAvgHDCF_Pct));

        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));

        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;

        // PP/PK (marad)
        const home_pp_advantage = (advancedData?.home?.pp_pct ?? 15) - (advancedData?.away?.pk_pct ?? 85);
        const away_pp_advantage = (advancedData?.away?.pp_pct ?? 15) - (advancedData?.home?.pk_pct ?? 85);
        const pp_mod_h = (1 + (home_pp_advantage / 100) * 0.15);
        const pp_mod_a = (1 + (away_pp_advantage / 100) * 0.15);
        mu_h *= pp_mod_h; mu_a *= pp_mod_a;
        logData.pp_mod_h = pp_mod_h; logData.pp_mod_a = pp_mod_a;

        // --- ÚJ: Kapus Modell (GSAx alapján) ---
        logData.step = 'Jégkorong Kapus (GSAx)';
        // GSAx (Goals Saved Above Expected) - A pozitív érték jó, a negatív rossz.
        // A kapusok hatása az ellenfél 'mu'-ját módosítja.
        const homeGoalieGSAx = rawData?.advanced_stats_goalie?.home_goalie?.GSAx || leagueAvgGSAx;
        const awayGoalieGSAx = rawData?.advanced_stats_goalie?.away_goalie?.GSAx || leagueAvgGSAx;
        
        // Egy 0.05-ös GSAx (meccsenként) 0.05 góllal csökkenti az ellenfél mu-ját.
        // Normalizáljuk (pl. 0.1-es GSAx = 1.01-es szorzó a *védekezésnek*, azaz 0.99-es az *ellenfél támadásának*)
        const goalie_mod_h = Math.max(0.8, Math.min(1.2, 1.0 - (homeGoalieGSAx * 0.1))); // Hazai kapus hatása a vendég mu-ra
        const goalie_mod_a = Math.max(0.8, Math.min(1.2, 1.0 - (awayGoalieGSAx * 0.1))); // Vendég kapus hatása a hazai mu-ra

        mu_h *= goalie_mod_a; // Vendég kapus hat
        mu_a *= goalie_mod_h; // Hazai kapus hat
        logData.goalie_mod_h_vs_away = goalie_mod_a; logData.goalie_mod_a_vs_home = goalie_mod_h;
        // --- JÉGKORONG FEJLESZTÉS VÉGE ---

    } else if (sport === 'soccer') {
        // --- LABDARÚGÁS FEJLESZTÉS ---
        logData.step = 'Labdarúgás Alap';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 1.35;
        
        let homeAttackStrength = (homeStats.gf / homeStats.gp) / avgGoalsInLeague;
        let awayAttackStrength = (awayStats.gf / awayStats.gp) / avgGoalsInLeague;
        let homeDefenseStrength = (homeStats.ga / homeStats.gp) / avgGoalsInLeague;
        let awayDefenseStrength = (awayStats.ga / awayStats.gp) / avgGoalsInLeague;
        
        // ... (A meglévő erősség-számítás változatlanul idekerül) ...
        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
        awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
        awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));

        mu_h = homeAttackStrength * awayDefenseStrength * avgGoalsInLeague;
        mu_a = awayAttackStrength * homeDefenseStrength * avgGoalsInLeague;
        logData.base_mu_h = mu_h; logData.base_mu_a = mu_a;

        // SportMonks xG (marad)
        if (sport === 'soccer' && advancedData?.home?.xg != null && advancedData?.away?.xg != null) { // Check for non-null xG
            const maxRealisticXG = 7.0;
            mu_h = Math.max(0, Math.min(maxRealisticXG, advancedData.home.xg));
            mu_a = Math.max(0, Math.min(maxRealisticXG, advancedData.away.xg));
            logData.source = 'SportMonks xG';
            if (advancedData.home.xg > maxRealisticXG || advancedData.away.xg > maxRealisticXG) {
                console.warn(`Figyelem: SportMonks irreális xG (${homeTeam} vs ${awayTeam}): H=${advancedData.home.xg}, A=${advancedData.away.xg}. Korlátozva ${maxRealisticXG}-ra.`);
                logData.source += ' (Korlátozva)';
            }
            logData.base_mu_h = mu_h;
            logData.base_mu_a = mu_a;
        } else if (sport === 'soccer') {
            logData.source = 'Calculated xG';
        }

        // --- ÚJ: Játékos-szintű Hatás Módosító ---
        logData.step = 'Labdarúgás Játékos Hatás';
        let player_mod_h = 1.0;
        let player_mod_a = 1.0;
        try {
            // Segédfüggvény a statisztikák (pl. "npxG/90: 0.8") parse-olásához
            const parsePlayerStat = (statString) => {
                if (typeof statString !== 'string' || !statString.includes(':')) return { metric: 'n/a', value: 0 };
                const parts = statString.split(':');
                const metric = parts[0]?.trim().toLowerCase();
                const value = parseFloat(parts[1]?.trim());
                return { metric, value: isNaN(value) ? 0 : value };
            };

            // Hazai támadók vs Vendég védők
            (rawData?.key_players?.home || []).forEach(player => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('npxg') && stat.value > 0.6) player_mod_h *= 1.03; // Elit csatár
                    if (stat.metric.includes('npxg') && stat.value < 0.2) player_mod_h *= 0.98; // Gyenge forma
                }
            });
            (rawData?.key_players?.away || []).forEach(player => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('duels') && stat.value < 50) player_mod_h *= 1.02; // Gyenge védő ellen
                }
            });

            // Vendég támadók vs Hazai védők
            (rawData?.key_players?.away || []).forEach(player => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('npxg') && stat.value > 0.6) player_mod_a *= 1.03;
                    if (stat.metric.includes('npxg') && stat.value < 0.2) player_mod_a *= 0.98;
                }
            });
            (rawData?.key_players?.home || []).forEach(player => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('duels') && stat.value < 50) player_mod_a *= 1.02; // Gyenge védő ellen
                }
            });

            mu_h *= player_mod_h;
            mu_a *= player_mod_a;
            logData.player_mod_h = player_mod_h; logData.player_mod_a = player_mod_a;

        } catch (e) { console.warn(`Hiba a Játékos Hatás számításakor: ${e.message}`); }
        // --- LABDARÚGÁS FEJLESZTÉS VÉGE ---
    }

    // --- ÁLTALÁNOS MÓDOSÍTÓK (MINDEN SPORTÁGRA) ---

    // Súlyozott Forma Faktor (marad)
    logData.step = 'Módosítók';
    const getFormPoints = (formString) => {
        if (!formString || typeof formString !== 'string') return 0; // Invalid -> 0 points
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        return wins * 3 + draws * 1;
    };
    const homeOverallFormPts = getFormPoints(form?.home_overall);
    const awayOverallFormPts = getFormPoints(form?.away_overall); const homeVenueFormPts = getFormPoints(form?.home_home); const awayVenueFormPts = getFormPoints(form?.away_away);
    const homeFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? // Use weighted only if venue form exists
                           (0.6 * (homeVenueFormPts / 15)) + (0.4 * (homeOverallFormPts / 15)) : (homeOverallFormPts / 15);
    const awayFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? // Use weighted only if venue form exists
                           (0.6 * (awayVenueFormPts / 15)) + (0.4 * (awayOverallFormPts / 15)) : (awayOverallFormPts / 15);
    const formImpactFactor = 0.1;
    const form_mod_h = (1 + (homeFormFactor - 0.5) * formImpactFactor);
    const form_mod_a = (1 + (awayFormFactor - 0.5) * formImpactFactor);
    mu_h *= form_mod_h; mu_a *= form_mod_a;
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a;

    // Dinamikus Hazai Pálya Előny (marad)
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

    // Taktikai Modellezés (Foci - marad, Kosár - áthelyezve)
    if (sport === 'soccer') {
        logData.step = 'Taktika (Foci)';
        const homeStyle = rawData?.tactics?.home?.style?.toLowerCase() || 'n/a';
        const awayStyle = rawData?.tactics?.away?.style?.toLowerCase() || 'n/a';
        let tactical_mod_h = 1.0;
        let tactical_mod_a = 1.0;
        // Kontra vs. Labdabirtoklás
        if (homeStyle.includes('counter') && (awayStyle.includes('possession') || awayStyle.includes('dominan'))) {
            tactical_mod_h *= 1.04; tactical_mod_a *= 0.97;
        }
        if (awayStyle.includes('counter') && (homeStyle.includes('possession') || homeStyle.includes('dominan'))) {
            tactical_mod_a *= 1.04; tactical_mod_h *= 0.97;
        }
        // Magas letámadás vs. Gyenge/Lassú védelem
        if (homeStyle.includes('press') && (awayStyle.includes('defensive frailties') || awayStyle.includes('slow build'))) {
            tactical_mod_h *= 1.03; tactical_mod_a *= 0.98;
        }
        if (awayStyle.includes('press') && (homeStyle.includes('defensive frailties') || homeStyle.includes('slow build'))) {
            tactical_mod_a *= 1.03; tactical_mod_h *= 0.98;
        }
        mu_h *= tactical_mod_h; mu_a *= tactical_mod_a;
        logData.tactical_mod_h = tactical_mod_h; logData.tactical_mod_a = tactical_mod_a;
    }
    
    // Formációk Hatása (Foci - marad)
    if (sport === 'soccer') {
        logData.step = 'Formáció (Foci)';
        const homeFormation = rawData?.tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = rawData?.tactics?.away?.formation?.toLowerCase() || 'n/a';
        let formation_mod_h = 1.0;
        let formation_mod_a = 1.0;
        if (homeFormation.startsWith('5') || homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) {
            formation_mod_a *= 0.95; 
        }
        if (awayFormation.startsWith('5') || awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) {
            formation_mod_h *= 0.95;
        }
        const isOffensive = (f) => f.startsWith('4-3-3') || f.startsWith('3-4-3') || f.startsWith('4-2-4');
        if (isOffensive(homeFormation) && isOffensive(awayFormation)) {
            formation_mod_h *= 1.02; formation_mod_a *= 1.02;
        }
        mu_h *= formation_mod_h; mu_a *= formation_mod_a;
        logData.formation_mod_h = formation_mod_h; logData.formation_mod_a = formation_mod_a;
    }

    // Power Ratings (Tanult) (marad)
    logData.step = 'Power Ratings (Tanult)';
    const powerRatings = getAdjustedRatings();
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase();
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1 };
    const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1 };
    const pr_mod_h = (homePR.atk ?? 1) * (awayPR.def ?? 1);
    const pr_mod_a = (awayPR.atk ?? 1) * (homePR.def ?? 1);
    mu_h *= pr_mod_h; mu_a *= pr_mod_a;
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def;
    logData.awayPR_atk = awayPR.atk; logData.awayPR_def = awayPR.def;
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;

    // Pszichológiai Faktorok (marad)
    logData.step = 'Pszichológia';
    const psyMultiplier = 1.1;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    mu_h *= psy_mod_h;
    mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;

    // Finomított Hiányzók Hatása (Poszt alapján) (marad)
    logData.step = 'Hiányzók (Poszt)';
    let absentee_mod_h = 1.0;
    let absentee_mod_a = 1.0;
    const impactFactor = sport === 'soccer' ? 0.05 : sport === 'hockey' ? 0.07 : 0.03; // Sport-specifikus hatás
    const gkImpactFactor = sport === 'soccer' ? 0.15 : sport === 'hockey' ? 0.20 : 0.05;

    (rawData?.absentees?.home || []).forEach(p => {
        if (p.importance === 'key') {
            const role = p.role?.toLowerCase() || '';
            if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) { absentee_mod_h *= (1 - impactFactor); }
            else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) { absentee_mod_a *= (1 + impactFactor); }
            else if (role.includes('kapus') || role.includes('goalkeeper')) { absentee_mod_a *= (1 + gkImpactFactor); }
        }
    });
    (rawData?.absentees?.away || []).forEach(p => {
        if (p.importance === 'key') {
            const role = p.role?.toLowerCase() || '';
            if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) { absentee_mod_a *= (1 - impactFactor); }
            else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) { absentee_mod_h *= (1 + impactFactor); }
            else if (role.includes('kapus') || role.includes('goalkeeper')) { absentee_mod_h *= (1 + gkImpactFactor); }
        }
    });
    mu_h *= absentee_mod_h; mu_a *= absentee_mod_a;
    logData.abs_mod_pos_h = absentee_mod_h; logData.abs_mod_pos_a = absentee_mod_a;
    // Általános impact analysis (csökkentett súllyal)
    const impactAnalysis = rawData?.absentee_impact_analysis?.toLowerCase();
    if (impactAnalysis && impactAnalysis !== "nincs jelentős hatás.") {
        let homeImpactGen = 1.0, awayImpactGen = 1.0;
        if (impactAnalysis.includes(homeTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) homeImpactGen -= 0.02;
        if (impactAnalysis.includes(awayTeam.toLowerCase()) && (impactAnalysis.includes("gyengült") || impactAnalysis.includes("hátrány"))) awayImpactGen -= 0.02;
        if (impactAnalysis.includes("nyíltabb játék") || impactAnalysis.includes("több gól")) { homeImpactGen += 0.01; awayImpactGen += 0.01; }
        if (impactAnalysis.includes("védekezőbb") || impactAnalysis.includes("kevesebb gól")) { homeImpactGen -= 0.01; awayImpactGen -= 0.01; }
        mu_h *= homeImpactGen; mu_a *= awayImpactGen;
        logData.abs_mod_gen_h = homeImpactGen; logData.abs_mod_gen_a = awayImpactGen;
    }

    // Meccs Fontosságának Hatása (marad)
    logData.step = 'Meccs Tétje';
    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a';
    let tension_mod = 1.0;
    if (tension === 'high' || tension === 'extreme') { tension_mod = 1.03; }
    else if (tension === 'low') { tension_mod = 1.01; }
    mu_h *= tension_mod;
    mu_a *= tension_mod;
    logData.tension_mod = tension_mod;

    // --- ÚJ: Finomított Időjárás Hatása (Strukturált Adatok Alapján) ---
    logData.step = 'Időjárás (Strukturált)';
    const weather = rawData?.contextual_factors?.structured_weather; // Az új adatforrás
    let weather_mod = 1.0; // Egységes módosító
    
    if (weather && weather.precipitation_mm != null && weather.wind_speed_kmh != null) {
        const precip = weather.precipitation_mm;
        const wind = weather.wind_speed_kmh;
        
        // Csapadék hatása (gólszámot csökkenti)
        if (precip > 10.0) weather_mod *= 0.92; // Extrém eső/hó, sár
        else if (precip > 3.0) weather_mod *= 0.96; // Erős eső
        else if (precip > 0.5) weather_mod *= 0.99; // Enyhe eső, csúszós
        
        // Szél hatása (gólszámot csökkenti)
        if (wind > 50.0) weather_mod *= 0.90; // Viharos
        else if (wind > 30.0) weather_mod *= 0.95; // Erős szél
        else if (wind > 15.0) weather_mod *= 0.99; // Mérsékelt szél

        // Pálya állapota (a Gemini-től kapott kvalitatív adat)
        const pitch = rawData?.contextual_factors?.pitch_condition?.toLowerCase() || 'n/a';
        if (pitch.includes("rossz") || pitch.includes("poor")) {
            weather_mod *= 0.97;
        }

    } else {
        // Fallback a régi (szöveges) logikára, ha a strukturált adat hiányzik
        console.warn(`Hiányzó strukturált időjárási adat (${homeTeam} vs ${awayTeam}), fallback a szöveges elemzésre.`);
        const weatherText = rawData?.contextual_factors?.weather?.toLowerCase() || 'n/a';
        if (weatherText.includes("eső") || weatherText.includes("rain")) weather_mod *= 0.98;
        if (weatherText.includes("hó") || weatherText.includes("snow")) weather_mod *= 0.95;
    }

    mu_h *= weather_mod;
    mu_a *= weather_mod;
    logData.weather_mod_combined = weather_mod;
    // --- IDŐJÁRÁS FEJLESZTÉS VÉGE ---

    // Minimum érték (marad)
    const minVal = sport === 'basketball' ? 80 : (sport === 'hockey' ? 1.5 : 0.5);
    mu_h = Math.max(minVal, mu_h || minVal);
    mu_a = Math.max(minVal, mu_a || minVal);
    
    // Végső Korlátozás (marad)
    const finalMaxVal = sport === 'basketball' ? 200 : (sport === 'hockey' ? 10 : 7);
    if (mu_h > finalMaxVal || mu_a > finalMaxVal) {
        console.warn(`Figyelem: xG/Pont korlátozás (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} -> Max ${finalMaxVal}.`);
        logData.step = 'Végső Korlátozás';
    }
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);
    
    logData.final_mu_h = mu_h; logData.final_mu_a = mu_a;
    logData.step = 'Végeredmény';
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
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
// === MÓDOSÍTÁS: Finomított időjárás hatás ===
export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    let mu_corners = leagueAverages?.avg_corners || 10.5;
    let mu_cards = leagueAverages?.avg_cards || 4.5;

    if (sport === 'soccer') {
        const adv = rawData?.advanced_stats;
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        // --- Corners ---
        const hasAdvCornerData = adv?.home && adv?.away && typeof adv.home.avg_corners_for_per_game === 'number' && typeof adv.away.avg_corners_for_per_game === 'number';
        if (!hasAdvCornerData) {
            mu_corners = leagueAverages?.avg_corners || 10.5;
            const homePossession = adv?.home?.possession_pct ?? 50; const awayPossession = adv?.away?.possession_pct ?? 50;
            const homeShots = adv?.home?.shots ?? 12;
            const awayShots = adv?.away?.shots ?? 12;
            const possessionFactor = ((homePossession - 50) - (awayPossession - 50)) / 100;
            const shotsFactor = ((homeShots - 12) + (awayShots - 12)) / 50;
            mu_corners *= (1 + possessionFactor * 0.2 + shotsFactor * 0.3);
        } else {
            mu_corners = adv.home.avg_corners_for_per_game + adv.away.avg_corners_for_per_game;
        }
        if (tactics?.home?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05;
        if (tactics?.away?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05;
        // --- Cards ---
        const hasAdvCardData = adv?.home && adv?.away && typeof adv.home.avg_cards_per_game === 'number' && typeof adv.away.avg_cards_per_game === 'number';
        if (!hasAdvCardData) {
             mu_cards = leagueAverages?.avg_cards || 4.5;
             const homeFouls = adv?.home?.fouls ?? 11; const awayFouls = adv?.away?.fouls ?? 11;
             const totalFoulsFactor = ((homeFouls - 11) + (awayFouls - 11)) / 30;
             mu_cards *= (1 + totalFoulsFactor * 0.4);
        } else {
            mu_cards = adv.home.avg_cards_per_game + adv.away.avg_cards_per_game;
        }

        // Referee impact
        if (referee?.style) { // Használjuk a 'style'-t a 'stats' helyett
            const styleLower = referee.style.toLowerCase();
            if (styleLower.includes("strict") || styleLower.includes("szigorú")) { 
                mu_cards *= 1.15; 
            } else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) { 
                mu_cards *= 0.85; 
            }
            // Ha van numerikus átlag a stílusban, azt is figyelembe vehetjük
            const cardMatch = referee.style.match(/(\d\.\d+)/);
            if (cardMatch) { 
                const refereeAvg = parseFloat(cardMatch[1]); 
                mu_cards = mu_cards * 0.6 + refereeAvg * 0.4; // Súlyozott átlag
            }
        }

        // Match tension impact
        const tension = context?.match_tension_index || 'low';
        if (tension.toLowerCase() === 'high') mu_cards *= 1.1;
        if (tension.toLowerCase() === 'extreme') mu_cards *= 1.25;

        // --- MÓDOSÍTÁS KEZDETE: Strukturált időjárás lapokra ---
        const weather = context?.structured_weather;
        const pitch = context?.pitch_condition?.toLowerCase() || 'n/a';
        if (weather && weather.precipitation_mm != null) {
            if (weather.precipitation_mm > 3.0) mu_cards *= 1.05; // Erős eső/hó -> több csúszkálás
        }
        if (pitch.includes("rossz") || pitch.includes("poor")) {
             mu_cards *= 1.08; // Rossz pálya -> több küzdelem, szabálytalanság
        }
        // --- MÓDOSÍTÁS VÉGE: Strukturált időjárás lapokra ---

        // Apply minimum values
        mu_corners = Math.max(3, mu_corners || 3);
        mu_cards = Math.max(1.5, mu_cards || 1.5);
    }
    return { mu_corners, mu_cards };
}


// --- A fájl többi része változatlan ---
export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, liveScenario, mainTotalsLine, rawData) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0;
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0;
    const scores = {};
    const safeSims = Math.max(1, sims || 1);

    if (sport === 'basketball') {
        const stdDev = 11.5;
        for (let i = 0; i < safeSims; i++) {
            const gh = Math.round(sampleNormal(mu_h, stdDev));
            const ga = Math.round(sampleNormal(mu_a, stdDev));
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if ((gh + ga) > mainTotalsLine) over_main++;
        }
    } else {
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(mu_h, mu_a);
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++;
            else if (ga > gh) away++; else draw++;
            if (gh > 0 && ga > 0) btts++;
            if (mainTotalsLine != null && (gh + ga) > mainTotalsLine) over_main++;
            if (sport === 'soccer') {
                const corners = poisson(mu_corners);
                if (corners > 7.5) corners_o7_5++; if (corners > 8.5) corners_o8_5++; if (corners > 9.5) corners_o9_5++; if (corners > 10.5) corners_o10_5++;
                if (corners > 11.5) corners_o11_5++;
                const cards = poisson(mu_cards);
                if (cards > 3.5) cards_o3_5++; if (cards > 4.5) cards_o4_5++;
                if (cards > 5.5) cards_o5_5++; if (cards > 6.5) cards_o6_5++;
            }
        }
    }

    if (sport !== 'soccer' && draw > 0) {
        const totalWinsBeforeOT = home + away;
        if (totalWinsBeforeOT > 0) { home += draw * (home / totalWinsBeforeOT); away += draw * (away / totalWinsBeforeOT); }
        else { home += draw / 2; away += draw / 2; }
        draw = 0;
    }

    const toPct = x => (100 * x / safeSims);
    const topScoreKey = Object.keys(scores).length > 0 ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0') : '0-0';
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);

    return {
        pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: { 'o7.5': toPct(corners_o7_5), 'o8.5': toPct(corners_o8_5), 'o9.5': toPct(corners_o9_5), 'o10.5': toPct(corners_o10_5), 'o11.5': toPct(corners_o11_5) },
        cards: { 'o3.5': toPct(cards_o3_5), 'o4.5': toPct(cards_o4_5), 'o5.5': toPct(cards_o5_5), 'o6.5': toPct(cards_o6_5) },
        scores,
        topScore: { gh: top_gh, ga: top_ga },
      
        mainTotalsLine: mainTotalsLine,
        mu_h_sim: mu_h, mu_a_sim: mu_a, mu_corners_sim: mu_corners, mu_cards_sim: mu_cards
    };
}

export function calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel) {
    let score = 5.0;
    const MAX_SCORE = 10.0; const MIN_SCORE = 1.0;
    try {
        const getFormPoints = (formString) => {
             if (!formString || typeof formString !== 'string') return null;
             const wins = (formString.match(/W/g) || []).length; const draws = (formString.match(/D/g) || []).length; const total = (formString.match(/[WDL]/g) || []).length;
             return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeOverallFormScore = getFormPoints(form?.home_overall); const awayOverallFormScore = getFormPoints(form?.away_overall);
        if (homeOverallFormScore != null && awayOverallFormScore != null) {
            const formDiff = homeOverallFormScore - awayOverallFormScore;
            const simDiff = (sim.pHome - sim.pAway) / 100;
            if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5; }
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75; }
        }
        const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
        const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4;
        const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
        if (xgDiff > thresholdHigh) score += 1.5; if (xgDiff < thresholdLow) score -= 1.0;
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try { const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                  const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                  if (latestH2HDate < twoYearsAgo) { score -= 0.75; } else { score += 0.25; }
            } catch(e) { /* Ignore */ }
        } else { score -= 0.25; }
        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0;
        if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.0 * homeKeyAbsentees); }
        if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.0 * awayKeyAbsentees); }
        if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.5 * awayKeyAbsentees); }
        if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.5 * homeKeyAbsentees); }
        const marketIntelLower = marketIntel?.toLowerCase() || 'n/a';
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.') {
            const homeFavored = sim.pHome > sim.pAway && sim.pHome > 45;
            const awayFavored = sim.pAway > sim.pHome && sim.pAway > 45;
            const homeNameLower = home.toLowerCase(); const awayNameLower = away.toLowerCase();
            if (homeFavored && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) { score -= 1.5; }
            else if (awayFavored && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+')) { score -= 1.5; }
            else if (homeFavored && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('-')) { score += 1.0; }
            else if (awayFavored && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('-')) { score += 1.0; }
        }
        const adjustedRatings = getAdjustedRatings();
        const homeHistory = adjustedRatings[home.toLowerCase()]; const awayHistory = adjustedRatings[away.toLowerCase()];
        if (homeHistory && homeHistory.matches > 10) score += 0.25;
        if (awayHistory && awayHistory.matches > 10) score += 0.25;
        if (homeHistory && homeHistory.matches > 25) score += 0.25;
        if (awayHistory && awayHistory.matches > 25) score += 0.25;
    } catch(e) { console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`);
    return Math.max(MIN_SCORE, 4.0); }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

export function calculatePsychologicalProfile(teamName, opponentName) { let moraleIndex = 1.0;
 let pressureIndex = 1.0; return { moraleIndex, pressureIndex }; }

export function calculateValue(sim, oddsData, sport, homeTeam, awayTeam) {
    const valueBets = [];
    if (!oddsData || !oddsData.current || oddsData.current.length === 0 || !sim) { return valueBets; }
    const findProb = (marketName) => {
        if (!marketName) return null;
        const lowerMarket = marketName.toLowerCase();
        if (lowerMarket.includes('hazai győzelem') || lowerMarket === homeTeam.toLowerCase()) return sim.pHome / 100;
        if (lowerMarket.includes('vendég győzelem') || lowerMarket === awayTeam.toLowerCase()) return sim.pAway / 100;
        if (lowerMarket.includes('döntetlen') || lowerMarket === 'draw') return sim.pDraw / 100;
        const ouMatch = lowerMarket.match(/(over|under|alatt|felett)\s*(\d+(\.\d+)?)/);
        if (ouMatch) {
            const line = parseFloat(ouMatch[2]);
            if (sim.mainTotalsLine != null && line === sim.mainTotalsLine) { const isOver = ouMatch[1] === "over" || ouMatch[1] === "felett";
            return isOver ? sim.pOver / 100 : sim.pUnder / 100; }
            if ((lowerMarket.includes('corners') || lowerMarket.includes('szöglet')) && sim.corners) { const key = `${ouMatch[1] === 'over' ||
            ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`; if(sim.corners[key] != null) return sim.corners[key] / 100; }
            if ((lowerMarket.includes('cards') || lowerMarket.includes('lap')) && sim.cards) { const key = `${ouMatch[1] === 'over' ||
            ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`; if(sim.cards[key] != null) return sim.cards[key] / 100; }
        }
        if (lowerMarket.includes('btts') || lowerMarket.includes('mindkét csapat szerez gólt')) { const bttsYes = lowerMarket.includes("igen") ||
        !lowerMarket.includes("nem"); return bttsYes ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100; }
        return null;
    };
    oddsData.current.forEach(outcome => {
        const probability = findProb(outcome.name);
        if (probability != null && typeof outcome.price === 'number' && outcome.price > 1) {
            const value = (probability * outcome.price) - 1;
            if (value > 0.05) { valueBets.push({ market: outcome.name, odds: outcome.price, probability: (probability * 100).toFixed(1) + '%', value: (value * 100).toFixed(1) + '%' }); }
        }
    
    });
    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
}

export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
     if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) { return "Nincs elég adat a piaci mozgás elemzéséhez."; }
    let awayTeam = '';
    const awayOutcome = currentOddsData.current.find(o => o.name.toLowerCase().includes('vendég') || (SPORT_CONFIG[sport]?.name === 'basketball' && o.name !== homeTeam && !o.name.toLowerCase().includes('döntetlen')));
    if (awayOutcome) { awayTeam = awayOutcome.name.replace('Vendég győzelem', '').trim(); if (sport === 'basketball') awayTeam = awayOutcome.name; }
    if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból a mozgáselemzéshez.";
    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`;
    const openingMatch = openingOddsData[key];
    const currentH2HMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h');
    const currentH2HOutcomes = currentH2HMarket?.outcomes;
    if (!openingMatch?.h2h || !currentH2HOutcomes) return "Hiányzó H2H adatok a mozgáselemzéshez.";
    let changes = [];
    currentH2HOutcomes.forEach(currentOutcome => {
        let simpleName = ''; const lowerCurrentName = currentOutcome.name.toLowerCase();
        if (lowerCurrentName === homeTeam.toLowerCase() || lowerCurrentName.includes('hazai')) simpleName = homeTeam;
        else if (lowerCurrentName === awayTeam.toLowerCase() || lowerCurrentName.includes('vendég')) simpleName = awayTeam;
        else if (lowerCurrentName.includes('döntetlen') || lowerCurrentName === 'draw') simpleName = 'Döntetlen';
        if (simpleName) {
            const openingOutcome = openingMatch.h2h.find(oo => {
      
                  const lowerOpeningName = oo.name.toLowerCase();
                 if (simpleName === homeTeam && (lowerOpeningName === homeTeam.toLowerCase() || lowerOpeningName.includes('hazai'))) return true;
                 if (simpleName === awayTeam && (lowerOpeningName === awayTeam.toLowerCase() || lowerOpeningName.includes('vendég'))) return true;
                 if (simpleName === 'Döntetlen' && (lowerOpeningName.includes('döntetlen') || lowerOpeningName === 'draw')) return true;
                 return false;
            });
            if (openingOutcome && typeof openingOutcome.price === 'number' && typeof currentOutcome.price === 'number') {
                const change = ((currentOutcome.price / openingOutcome.price) - 1) * 100;
                if (Math.abs(change) > 3) { changes.push(`${simpleName}: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`); }
            }
        }
    });
    return changes.length > 0 ? `Jelentős oddsmozgás: ${changes.join(', ')}` : "Nincs jelentős oddsmozgás.";
}

export function analyzePlayerDuels(keyPlayers, sport) {
    if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) return null;
    try {
        const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó') || p?.role?.toLowerCase().includes('csatár') || p?.role?.toLowerCase().includes('scorer'));
        const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő') || p?.role?.toLowerCase().includes('hátvéd') || p?.role?.toLowerCase().includes('defender'));
        if (homeAttacker?.name && awayDefender?.name) { return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`; }
        if (sport === 'basketball') {
            const homePG = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            const awayPG = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            if (homePG?.name && awayPG?.name) { return `Az irányítók csatája (${homePG.name} vs ${awayPG.name}) meghatározó lehet a játék tempójára.`; }
        }
    } catch (e) { console.error("Hiba a játékos párharc elemzésekor:", e.message); }
    return null;
}

export function generateProTip(probabilities, odds, market) { console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!");
    return "Pro Tipp generálása még nincs implementálva."; }
export function calculateProbabilities(rawStats, homeAdvantage, avgGoals) { console.warn("Figyelmeztetés: calculateProbabilities() placeholder függvény hívva...");
    return { pHome: null, pDraw: null, pAway: null, pBTTS: null, pOver: null, pUnder: null }; }