import { SPORT_CONFIG } from './config.js'; // Importáljuk a sportág konfigurációt
// Importáljuk a rating funkciókat (feltételezve, hogy sheets.js-ben lesznek)
// Még ha a sheets.js nem is exportálja őket, a Node.js szerver el fog indulni,
// de hibát fog dobni, ha hívjuk őket. A hiba alapján viszont a Model.js-ig eljutunk.
// Mivel a hiba a Model.js-ben van, a sheets.js importjai valószínűleg rendben vannak.
import { getAdjustedRatings, getNarrativeRatings } from './sheets.js'; 

/**************************************************************
* Model.js - Statisztikai és Szimulációs Modul (V12.3 - JAVÍTOTT)
* Feladata: A rendszer matematikai magja Node.js környezetben.
* V12.3 VÁLTOZÁSOK:
* - JAVÍTVA: A 'possessionFactor is not defined' ReferenceError
* az estimateAdvancedMetrics funkcióban (hiányzó változók pótolva).
* - Korábbi V12.2 (Final Sanity Cap) javítások megtartva.
**************************************************************/

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
/**
 * Poisson distribution sampler using Knuth's algorithm.
 * @param {number} lambda The mean (average) rate.
 * @returns {number} A non-negative integer sampled from the Poisson distribution. Returns 0 if lambda <= 0 or invalid.
 */
function poisson(lambda) {
    if (lambda === null || isNaN(lambda) || lambda < 0) return 0;
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
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
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

// --- Idővonal Generálás --- (Logika változatlan)
export function calculateEventProbabilities(gameState, mu_h, mu_a, rawData, sport, homeTeam, awayTeam) {
    const narrativeRatings = getNarrativeRatings();
    const homeTeamLower = homeTeam.toLowerCase();
    const awayTeamLower = awayTeam.toLowerCase();
    const homeNarrative = narrativeRatings[homeTeamLower] || {};
    const awayNarrative = narrativeRatings[awayTeamLower] || {};

    const totalMu = (mu_h || 0) + (mu_a || 0);
    if (totalMu === 0) return [{ type: 'NO_EVENT', probability: 1.0 }];

    const baseGoalProb = totalMu / (SPORT_CONFIG[sport]?.total_minutes / 5 || 18); // Default 18 (90/5)

    let homeGoalProb = (mu_h / totalMu) * baseGoalProb * gameState.home_momentum;
    let awayGoalProb = (mu_a / totalMu) * baseGoalProb * gameState.away_momentum;
    let homeCardProb = 0.08, awayCardProb = 0.08;

    if (sport === 'soccer') {
        homeGoalProb *= 1 + (homeNarrative.set_piece_threat || 0);
        awayGoalProb *= 1 + (awayNarrative.counter_attack_lethality || 0);
        if (rawData?.referee && typeof rawData.referee.stats === 'string' && rawData.referee.stats.toLowerCase().includes("strict")) {
            homeCardProb = 0.15;
            awayCardProb = 0.15;
        }
    }
    const totalProb = homeGoalProb + awayGoalProb + homeCardProb + awayCardProb;
    const noEventProb = Math.max(0, 1 - totalProb);

    return [
        { type: 'HOME_GOAL', probability: homeGoalProb, team: 'home', detail: 'Gól' },
        { type: 'AWAY_GOAL', probability: awayGoalProb, team: 'away', detail: 'Gól' },
        { type: 'HOME_YELLOW_CARD', probability: homeCardProb, team: 'home', detail: 'Sárga lap' },
        { type: 'AWAY_YELLOW_CARD', probability: awayCardProb, team: 'away', detail: 'Sárga lap' },
        { type: 'NO_EVENT', probability: noEventProb },
    ];
}

function selectMostLikelyEvent(probabilities) {
    const totalP = probabilities.reduce((sum, p) => sum + (p.probability || 0), 0); // Biztonságos összegzés
    if (totalP <= 0) return { type: 'NO_EVENT' }; // <= 0 ellenőrzés
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
    const totalMinutes = SPORT_CONFIG[sport]?.total_minutes || 90; // Default 90
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
            timeline.push(event);
            gameState = updateGameState(gameState, event);
        }
    }
    return timeline;
}

// === estimateXG (V12.2 logika, Node.js formátumban) ===
export function estimateXG(homeTeam, awayTeam, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway) {
    const homeStats = rawStats?.home, awayStats = rawStats?.away; // Biztonságos hozzáférés
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

    // Sport-specifikus alap xG
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
            const homeFF = advancedData.home.four_factors; const awayFF = advancedData.away.four_factors;
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
        if (sport === 'soccer' && advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
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
    }

    // Általános Módosítók
    logData.step = 'Módosítók';
    // Súlyozott Forma Faktor (V11 logika)
    const getFormPoints = (formString) => {
        if (!formString || typeof formString !== 'string') return 0;
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        return wins * 3 + draws * 1;
    };
    const homeOverallFormPts = getFormPoints(form?.home_overall); const awayOverallFormPts = getFormPoints(form?.away_overall); const homeVenueFormPts = getFormPoints(form?.home_home); const awayVenueFormPts = getFormPoints(form?.away_away);
    const homeFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? (0.6 * (homeVenueFormPts / 15)) + (0.4 * (homeOverallFormPts / 15)) : (homeOverallFormPts / 15);
    const awayFormFactor = (homeVenueFormPts > 0 || awayVenueFormPts > 0) ? (0.6 * (awayVenueFormPts / 15)) + (0.4 * (awayOverallFormPts / 15)) : (awayOverallFormPts / 15);
    const formImpactFactor = 0.1;
    const form_mod_h = (1 + (homeFormFactor - 0.5) * formImpactFactor);
    const form_mod_a = (1 + (awayFormFactor - 0.5) * formImpactFactor);
    mu_h *= form_mod_h; mu_a *= form_mod_a;
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a;

    // Dinamikus Hazai Pálya Előny (V12 logika)
    const baseHomeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0;
    const baseAwayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
    const leagueHomeWinPct = leagueAverages?.home_win_pct || (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const defaultHomeWinPct = (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55);
    const homeAdvMultiplier = defaultHomeWinPct > 0 ? (leagueHomeWinPct / defaultHomeWinPct) : 1;
    const awayAdvMultiplier = (1-defaultHomeWinPct) > 0 ? ((1 - leagueHomeWinPct) / (1- defaultHomeWinPct)) : 1;
    const home_adv_mod = baseHomeAdv * homeAdvMultiplier;
    const away_adv_mod = baseAwayAdv * awayAdvMultiplier;
    mu_h *= home_adv_mod; mu_a *= away_adv_mod;
    logData.home_adv_mod = home_adv_mod; logData.away_adv_mod = away_adv_mod;

    // Power Ratings (V11 logika)
    const powerRatings = getAdjustedRatings();
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase();
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1 }; const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1 };
    const pr_mod_h = (homePR.atk ?? 1) * (awayPR.def ?? 1);
    const pr_mod_a = (awayPR.atk ?? 1) * (homePR.def ?? 1);
    mu_h *= pr_mod_h; mu_a *= pr_mod_a;
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def; logData.awayPR_atk = awayPR.atk; logData.awayPR_def = awayPR.def;
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;

    // Pszichológiai Faktorok (V12 logika)
    const psyMultiplier = 1.1;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    mu_h *= psy_mod_h; mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;

    // Hiányzók Hatásának Becslése (V12 logika)
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

    // Időjárás Hatása (V12 logika)
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

    // Minimum érték biztosítása
    const minVal = sport === 'basketball' ? 80 : (sport === 'hockey' ? 1.5 : 0.5);
    mu_h = Math.max(minVal, mu_h || minVal); // Null check
    mu_a = Math.max(minVal, mu_a || minVal); // Null check

    // === VÉGSŐ KORLÁTOZÁS (V12.2 logika) ===
    const finalMaxVal = sport === 'basketball' ? 200 : (sport === 'hockey' ? 10 : 7);
    if (mu_h > finalMaxVal || mu_a > finalMaxVal) {
        console.warn(`Figyelem: xG/Pont korlátozás (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} -> Max ${finalMaxVal}. Log: ${JSON.stringify(logData)}`);
        logData.step = 'Végső Korlátozás';
    }
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);
    // === VÉGSŐ KORLÁTOZÁS VÉGE ===

    logData.final_mu_h = mu_h; logData.final_mu_a = mu_a;
    logData.step = 'Végeredmény';
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
    // Részletes log opcionálisan:
    // console.log(`estimateXG Részletes Log (${homeTeam} vs ${awayTeam}): ${JSON.stringify(logData)}`);

    return { mu_h, mu_a };
}

// === estimateAdvancedMetrics (V12.3 JAVÍTOTT) ===
export function estimateAdvancedMetrics(rawData, sport, leagueAverages) {
    let mu_corners = leagueAverages?.avg_corners || 10.5;
    let mu_cards = leagueAverages?.avg_cards || 4.5;

    if (sport === 'soccer') {
        const adv = rawData?.advanced_stats;
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;

        // --- Szögletek ---
        const hasAdvCornerData = adv?.home && adv?.away &&
            typeof adv.home.avg_corners_for_per_game === 'number' &&
            typeof adv.away.avg_corners_for_per_game === 'number';
            // Megjegyzés: Az 'against' adatok hiányozhatnak, ezért csak a 'for'-t nézzük
            // typeof adv.away.avg_corners_against_per_game === 'number' &&
            // typeof adv.home.avg_corners_against_per_game === 'number';

        if (!hasAdvCornerData) {
            mu_corners = leagueAverages?.avg_corners || 10.5;
            
            // === JAVÍTÁS KEZDETE: Hiányzó változók definiálása ===
            const homePossession = adv?.home?.possession_pct ?? 50;
            const awayPossession = adv?.away?.possession_pct ?? 50;
            const homeShots = adv?.home?.shots ?? 12;
            const awayShots = adv?.away?.shots ?? 12;
            
            const possessionFactor = ((homePossession - 50) - (awayPossession - 50)) / 100;
            const shotsFactor = ((homeShots - 12) + (awayShots - 12)) / 50; 
            // === JAVÍTÁS VÉGE ===

            mu_corners *= (1 + possessionFactor * 0.2 + shotsFactor * 0.3);
        } else {
            // Ha van adat (még ha nem is átlag), használjuk azt
            const homeCorners = adv.home.avg_corners_for_per_game; 
            const awayCorners = adv.away.avg_corners_for_per_game;
            mu_corners = homeCorners + awayCorners;
        }

        // Taktikai módosító
        if (tactics?.home?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05;
        if (tactics?.away?.style?.toLowerCase().includes('wing')) mu_corners *= 1.05;

        // --- Lapok ---
        const hasAdvCardData = adv?.home && adv?.away &&
            typeof adv.home.avg_cards_per_game === 'number' &&
            typeof adv.away.avg_cards_per_game === 'number';

        if (!hasAdvCardData) {
            mu_cards = leagueAverages?.avg_cards || 4.5;
            const homeFouls = adv?.home?.fouls ?? 11; 
            const awayFouls = adv?.away?.fouls ?? 11;
            const totalFoulsFactor = ((homeFouls - 11) + (awayFouls - 11)) / 30;
            mu_cards *= (1 + totalFoulsFactor * 0.4);
        } else {
            mu_cards = adv.home.avg_cards_per_game + adv.away.avg_cards_per_game;
        }

        // Játékvezető hatása
        if (referee?.stats) {
            const cardMatch = referee.stats.match(/(\d\.\d+)/);
            if (cardMatch) {
                const refereeAvg = parseFloat(cardMatch[1]);
                mu_cards = mu_cards * 0.6 + refereeAvg * 0.4;
            } else if (referee.stats.toLowerCase().includes("strict") || referee.stats.toLowerCase().includes("szigorú")) {
                mu_cards *= 1.15;
            } else if (referee.stats.toLowerCase().includes("lenient") || referee.stats.toLowerCase().includes("engedékeny")) {
                mu_cards *= 0.85;
            }
        }
        
        // Meccsfeszültség hatása
        const tension = context?.match_tension_index || 'low';
        if (tension.toLowerCase() === 'high') mu_cards *= 1.1;
        if (tension.toLowerCase() === 'extreme') mu_cards *= 1.25;

        // Időjárás Hatása Lapokra
        const weather = context?.weather?.toLowerCase();
        if (weather && (weather.includes("eső") || weather.includes("hó") || weather.includes("rain") || weather.includes("snow"))) {
            mu_cards *= 1.05;
        }

        mu_corners = Math.max(3, mu_corners || 3); // Null check
        mu_cards = Math.max(1.5, mu_cards || 1.5); // Null check
    }
    return { mu_corners, mu_cards };
}

// === simulateMatchProgress (Változatlan V12.1 óta) ===
export function simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, sims, sport, liveScenario, mainTotalsLine, rawData) {
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0;
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0;
    const scores = {};
    const safeSims = Math.max(1, sims || 1); // Biztosítjuk, hogy sims > 0

    if (sport === 'basketball') {
        const stdDev = 11.5;
        for (let i = 0; i < safeSims; i++) {
            const gh = Math.round(sampleNormal(mu_h, stdDev)); const ga = Math.round(sampleNormal(mu_a, stdDev));
            const scoreKey = `${gh}-${ga}`; scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if ((gh + ga) > mainTotalsLine) over_main++;
        }
    } else { // Soccer & Hockey
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(mu_h, mu_a);
            const scoreKey = `${gh}-${ga}`; scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++;
            if (gh > 0 && ga > 0) btts++; if ((gh + ga) > mainTotalsLine) over_main++;
            if (sport === 'soccer') {
                const corners = poisson(mu_corners);
                if (corners > 7.5) corners_o7_5++; if (corners > 8.5) corners_o8_5++; if (corners > 9.5) corners_o9_5++; if (corners > 10.5) corners_o10_5++; if (corners > 11.5) corners_o11_5++;
                const cards = poisson(mu_cards);
                if (cards > 3.5) cards_o3_5++; if (cards > 4.5) cards_o4_5++; if (cards > 5.5) cards_o5_5++; if (cards > 6.5) cards_o6_5++;
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
        scores, topScore: { gh: top_gh, ga: top_ga },
        mu_h_sim: mu_h, mu_a_sim: mu_a, mu_corners_sim: mu_corners, mu_cards_sim: mu_cards
    };
}

// === calculateModelConfidence (Változatlan V12.1 óta) ===
export function calculateModelConfidence(sport, home, away, rawData, form, sim) {
    let score = 5.0; const MAX_SCORE = 10.0; const MIN_SCORE = 1.0;
    try {
        const getFormPoints = (formString) => {
             if (!formString || typeof formString !== 'string') return null;
             const wins = (formString.match(/W/g) || []).length; const draws = (formString.match(/D/g) || []).length; const total = (formString.match(/[WDL]/g) || []).length;
             return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
        const homeOverallFormScore = getFormPoints(form?.home_overall); const awayOverallFormScore = getFormPoints(form?.away_overall);
        if (homeOverallFormScore != null && awayOverallFormScore != null) {
            const formDiff = homeOverallFormScore - awayOverallFormScore; const simDiff = (sim.pHome - sim.pAway) / 100;
            if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5; }
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75; }
        }

        const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
        const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4; const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
        if (xgDiff > thresholdHigh) score += 1.5; if (xgDiff < thresholdLow) score -= 1.0;

        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try { const latestH2HDate = new Date(rawData.h2h_structured[0].date); const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2); if (latestH2HDate < twoYearsAgo) { score -= 0.75; } else { score += 0.25; } } catch(e) { /* Hiba esetén nincs módosítás */ }
        } else { score -= 0.25; }

        const homeKeyAbsentees = rawData?.absentees?.home?.filter(p => p.importance === 'key').length || 0; const awayKeyAbsentees = rawData?.absentees?.away?.filter(p => p.importance === 'key').length || 0;
        if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.0 * homeKeyAbsentees); } if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.0 * awayKeyAbsentees); }
        if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.5 * awayKeyAbsentees); } if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.5 * homeKeyAbsentees); }

        const adjustedRatings = getAdjustedRatings(); const homeHistory = adjustedRatings[home.toLowerCase()]; const awayHistory = adjustedRatings[away.toLowerCase()];
        if (homeHistory && homeHistory.matches > 10) score += 0.25; if (awayHistory && awayHistory.matches > 10) score += 0.25; if (homeHistory && homeHistory.matches > 25) score += 0.25; if (awayHistory && awayHistory.matches > 25) score += 0.25;
    } catch(e) { console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`); return Math.max(MIN_SCORE, 4.0); }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

// --- Pszichológiai Profil (Egyszerűsített - változatlan a .gs verzióból) ---
export function calculatePsychologicalProfile(teamName, opponentName) {
    let moraleIndex = 1.0; // Neutrális
    let pressureIndex = 1.0; // Neutrális
    // ... (itt lehetne bonyolultabb logika, ha lennének adatok) ...
    return { moraleIndex, pressureIndex };
}

// --- Érték Számítás (Változatlan a .gs verzióból) ---
export function calculateValue(sim, oddsData, sport, homeTeam, awayTeam) {
    const valueBets = [];
    if (!oddsData || !oddsData.current || oddsData.current.length === 0 || !sim) {
        return valueBets;
    }

    const findProb = (marketName) => {
        if (!marketName) return null;
        const lowerMarket = marketName.toLowerCase();
        
        if (lowerMarket.includes('hazai győzelem') || lowerMarket === homeTeam.toLowerCase()) return sim.pHome / 100;
        if (lowerMarket.includes('vendég győzelem') || lowerMarket === awayTeam.toLowerCase()) return sim.pAway / 100;
        if (lowerMarket.includes('döntetlen')) return sim.pDraw / 100;

        const ouMatch = lowerMarket.match(/(over|under|alatt|felett)\s*(\d+(\.\d+)?)/);
        if (ouMatch) {
            const line = parseFloat(ouMatch[2]);
            if (line === sim.mainTotalsLine) {
                const isOver = ouMatch[1] === "over" || ouMatch[1] === "felett";
                return isOver ? sim.pOver / 100 : sim.pUnder / 100;
            }
            // Szöglet/Lapok kezelése (ha a sim tartalmazza)
            if ((lowerMarket.includes('corners') || lowerMarket.includes('szöglet')) && sim.corners) {
                const key = `${ouMatch[1] === 'over' || ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`;
                if(sim.corners[key] != null) return sim.corners[key] / 100;
            }
            if ((lowerMarket.includes('cards') || lowerMarket.includes('lap')) && sim.cards) {
                const key = `${ouMatch[1] === 'over' || ouMatch[1] === 'felett' ? 'o' : 'u'}${line}`;
                if(sim.cards[key] != null) return sim.cards[key] / 100;
            }
        }
        
        if (lowerMarket.includes('btts') || lowerMarket.includes('mindkét csapat szerez gólt')) {
            const bttsYes = lowerMarket.includes("igen") || !lowerMarket.includes("nem");
            return bttsYes ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100;
        }

        return null;
    };

    oddsData.current.forEach(outcome => {
        const probability = findProb(outcome.name);
        if (probability != null && typeof outcome.price === 'number' && outcome.price > 1) {
            const value = (probability * outcome.price) - 1;
            if (value > 0.05) { // Csak 5% feletti értéket mutatunk
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

// --- Piaci Mozgás Elemzése (Változatlan a .gs verzióból) ---
export function analyzeLineMovement(currentOddsData, openingOddsData, sport, homeTeam) {
     if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) {
        return "Nincs elég adat a piaci mozgás elemzéséhez.";
    }

    let awayTeam = '';
    const awayOutcome = currentOddsData.current.find(o =>
        o.name.toLowerCase().includes('vendég') || (SPORT_CONFIG[sport].name === 'basketball' && o.name !== homeTeam && !o.name.toLowerCase().includes('döntetlen'))
    );
    if (awayOutcome) {
        awayTeam = awayOutcome.name.replace('Vendég győzelem', '').trim();
        if (sport === 'basketball') awayTeam = awayOutcome.name;
    }
    if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból a mozgáselemzéshez.";

    const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`;
    const openingMatch = openingOddsData[key];
    const currentH2HMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h');
    const currentH2HOutcomes = currentH2HMarket?.outcomes;

    if (!openingMatch?.h2h || !currentH2HOutcomes) return "Hiányzó H2H adatok a mozgáselemzéshez.";

    let changes = [];
    currentH2HOutcomes.forEach(currentOutcome => {
        let simpleName = '';
        const lowerCurrentName = currentOutcome.name.toLowerCase();
        if (lowerCurrentName === homeTeam.toLowerCase() || lowerCurrentName.includes('hazai')) simpleName = homeTeam;
        else if (lowerCurrentName === awayTeam.toLowerCase() || lowerCurrentName.includes('vendég')) simpleName = awayTeam;
        else if (lowerCurrentName.includes('döntetlen')) simpleName = 'Döntetlen';

        if (simpleName) {
            const openingOutcome = openingMatch.h2h.find(oo => {
                const lowerOpeningName = oo.name.toLowerCase();
                if (simpleName === homeTeam && (lowerOpeningName === homeTeam.toLowerCase() || lowerOpeningName.includes('hazai'))) return true;
                if (simpleName === awayTeam && (lowerOpeningName === awayTeam.toLowerCase() || lowerOpeningName.includes('vendég'))) return true;
                if (simpleName === 'Döntetlen' && lowerOpeningName.includes('döntetlen')) return true;
                return false;
            });

            if (openingOutcome && typeof openingOutcome.price === 'number' && typeof currentOutcome.price === 'number') {
                const change = ((currentOutcome.price / openingOutcome.price) - 1) * 100;
                if (Math.abs(change) > 3) { // Csak 3% feletti változást jelzünk
                    changes.push(`${simpleName}: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
                }
            }
        }
    });

    return changes.length > 0 ? `Jelentős oddsmozgás: ${changes.join(', ')}` : "Nincs jelentős oddsmozgás.";
}

// --- Játékos Párharcok (Változatlan a .gs verzióból) ---
export function analyzePlayerDuels(keyPlayers, sport) {
    if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) return null;
    try {
        const homeAttacker = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('támadó') || p?.role?.toLowerCase().includes('csatár') || p?.role?.toLowerCase().includes('scorer'));
        const awayDefender = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('védő') || p?.role?.toLowerCase().includes('hátvéd') || p?.role?.toLowerCase().includes('defender'));
        if (homeAttacker?.name && awayDefender?.name) {
            return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`;
        }
        if (sport === 'basketball') {
            const homePG = keyPlayers.home?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            const awayPG = keyPlayers.away?.find(p => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            if (homePG?.name && awayPG?.name) {
                return `Az irányítók csatája (${homePG.name} vs ${awayPG.name}) meghatározó lehet a játék tempójára.`;
            }
        }
    } catch (e) {
        console.error("Hiba a játékos párharc elemzésekor:", e.message);
    }
    return null;
}