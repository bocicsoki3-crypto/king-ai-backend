// --- JAVÍTOTT Model.ts (v52.2 - 'import type' javítás) ---

import { SPORT_CONFIG } from './config.js';
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';

// Kanonikus típusok importálása
// === JAVÍTÁS (TS2846) ===
// A 'import' helyett 'import type'-ot használunk, mivel a .d.ts fájlok
// nem tartalmaznak futásidejű kódot, csak típus-deklarációkat.
import type {
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds
} from './src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

/**************************************************************
* Model.ts - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v52.2 - TS):
* - Javítva a TS2846 hiba: Az 'import' ki lett cserélve 'import type'-ra
* a canonical.d.ts típusdefiníciós fájl importálásakor.
**************************************************************/

// --- Segédfüggvények (Poisson és Normális eloszlás mintavétel) ---
/**
 * Poisson distribution sampler using Knuth's algorithm.
 * @param {number} lambda The mean (average) rate.
 * @returns {number} A non-negative integer sampled from the Poisson distribution.
 * Returns 0 if lambda <= 0 or invalid.
 */
function poisson(lambda: number | null | undefined): number {
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
 * @param {number} mu_h Mean goals for home team.
 * @param {number} mu_a Mean goals for away team.
 * @returns {{gh: number, ga: number}} Sampled goals for home (gh) and away (ga).
 */
function sampleGoals(mu_h: number, mu_a: number): { gh: number, ga: number } {
    // Itt is a kisbetűs 'poisson' függvényt használjuk, ahogy kell
    return { gh: poisson(mu_h), ga: poisson(mu_a) };
}

// --- Idővonal Generálás (v50 - ELTÁVOLÍTVA) ---
// export function buildPropheticTimeline(...) // TÖRÖLVE


// === estimateXG ===
/**
 * Estimates expected goals (xG) or points based on various factors.
 * @returns {object} {mu_h: estimated home goals/points, mu_a: estimated away goals/points}.
 */
export function estimateXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, // TÍPUSOSÍTVA
    sport: string, 
    form: ICanonicalRawData['form'], // TÍPUSOSÍTVA
    leagueAverages: any, 
    advancedData: any, 
    rawData: ICanonicalRawData, // TÍPUSOSÍTVA
    psyProfileHome: any, 
    psyProfileAway: any, 
    currentSimProbs: any = null
): { mu_h: number, mu_a: number } {
    
    const homeStats = rawStats?.home;
    const awayStats = rawStats?.away;

    // Az ICanonicalStats interfész már garantálja a 'gp: number' meglétét
    const areStatsValid = (stats: ICanonicalStats) => stats &&
        stats.gp > 0 && // A 'gp' kulcs garantáltan létezik és 'number'
        (typeof stats.gf === 'number') && 
        (typeof stats.ga === 'number');

    if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS: ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG.`);
        const defaultGoals = SPORT_CONFIG[sport]?.avg_goals || (sport === 'basketball' ? 110 : (sport === 'hockey' ? 3.0 : 1.35));
        const homeAdv = SPORT_CONFIG[sport]?.home_advantage ||
        { home: 1.05, away: 0.95 };
        return { mu_h: defaultGoals * homeAdv.home, mu_a: defaultGoals * homeAdv.away };
    }

    let mu_h: number, mu_a: number;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;
    const logData: any = { step: 'Alap', sport: sport, home: homeTeam, away: awayTeam };
    
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
        const homeHDCF_Pct = typeof rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct === 'number' ?
        rawData.advanced_stats_team.home.High_Danger_Chances_For_Pct : 50.0;
        const awayHDCF_Pct = typeof rawData?.advanced_stats_team?.away?.High_Danger_Chances_For_Pct === 'number' ?
        rawData.advanced_stats_team.away.High_Danger_Chances_For_Pct : 50.0;
        const homeHDCA_Pct = 100.0 - homeHDCF_Pct;
        // Egyszerűsített számítás
        const awayHDCA_Pct = 100.0 - awayHDCF_Pct;
        const safeLeagueAvgHDCF = leagueAvgHDCF_Pct > 0 ?
        leagueAvgHDCF_Pct : 50.0;
        const safeLeagueAvgHDCA = (100.0 - leagueAvgHDCF_Pct) > 0 ?
        (100.0 - leagueAvgHDCF_Pct) : 50.0;
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
            logData.source = 'Valós xG (API-Football)';
            // MÓDOSÍTVA (v50)
            if (advancedData.home.xg > maxRealisticXG || advancedData.away.xg > maxRealisticXG) {
                 console.warn(`Figyelem: Valós xG irreális (${homeTeam} vs ${awayTeam}): H=${advancedData.home.xg}, A=${advancedData.away.xg}. Korlátozva ${maxRealisticXG}-ra.`);
                 logData.source += ' (Korlátozva)';
            }
            logData.base_mu_h_real = mu_h;
            // Logolás 'real' néven
            logData.base_mu_a_real = mu_a;
        } else {
            // Ha NINCS valós xG, visszaváltunk a régi BECSLÉSI logikára (GF/GA alapján)
            logData.source = 'Calculated (Becsült) xG';
            // A TÍPUSBIZTOS ICanonicalStats használata
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
            const parsePlayerStat = (statString: string | null | undefined): { metric: string, value: number | null } => {
                if (typeof statString !== 'string' || !statString.includes(':')) return { metric: 'n/a', value: null };
                // Null, ha nem parse-olható
                const parts = statString.split(':');
                const metric = parts[0]?.trim().toLowerCase() || 'n/a';
                const value = parseFloat(parts[1]?.trim());
                return { metric, value: isNaN(value) ? null : value };
            };
            (rawData?.key_players?.home || []).forEach((player: any) => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                     if (stat.metric.includes('npxg') && stat.value !== null) {
                        if (stat.value > 0.6) player_mod_h *= 1.03;
                        else if (stat.value < 0.2) player_mod_h *= 0.98;
                     }
                }
            });
            (rawData?.key_players?.away || []).forEach((player: any) => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('duels') && stat.value !== null && stat.value < 50) {
                      player_mod_h *= 1.02; // Gyenge védő ellenfél -> hazai támadás erősödik
                    }
                }
            });
            (rawData?.key_players?.away || []).forEach((player: any) => {
                if (player.role?.toLowerCase().includes('támadó') || player.role?.toLowerCase().includes('csatár')) {
                    const stat = parsePlayerStat(player.stats);
                     if (stat.metric.includes('npxg') && stat.value !== null) {
                        if (stat.value > 0.6) player_mod_a *= 1.03;
                        else if (stat.value < 0.2) player_mod_a *= 0.98;
                     }
                }
             });
            (rawData?.key_players?.home || []).forEach((player: any) => {
                if (player.role?.toLowerCase().includes('védő') || player.role?.toLowerCase().includes('hátvéd')) {
                    const stat = parsePlayerStat(player.stats);
                    if (stat.metric.includes('duels') && stat.value !== null && stat.value < 50) {
                      player_mod_a *= 1.02; // Gyenge hazai védő -> vendég támadás erősödik
                    }
                }
             });
            mu_h *= player_mod_h;
            mu_a *= player_mod_a;
            logData.player_mod_h = player_mod_h; logData.player_mod_a = player_mod_a;
        } catch (e: any) { console.warn(`Hiba a Játékos Hatás számításakor: ${e.message}`);
        }
    } else {
        // Fallback or initialization if sport is not defined (TS requires mu_h/mu_a to be assigned)
         mu_h = SPORT_CONFIG[sport]?.avg_goals || 1.35;
        mu_a = SPORT_CONFIG[sport]?.avg_goals || 1.35;
    }

    // --- ÁLTALÁNOS MÓDOSÍTÓK (MINDEN SPORTÁGRA) ---
 
     logData.step = 'Általános Módosítók';
    // Súlyozott Forma Faktor
    const getFormPoints = (formString: string | null | undefined): { points: number, matches: number } => {
        if (!formString || typeof formString !== 'string' || formString === "N/A") return { points: 0, matches: 0 };
        const wins = (formString.match(/W/g) || []).length;
        const draws = (formString.match(/D/g) || []).length;
        const matches = (formString.match(/[WDL]/g) || []).length;
        return { points: wins * 3 + draws * 1, matches: matches };
    };

    const homeOverallForm = getFormPoints(form?.home_overall);
    const awayOverallForm = getFormPoints(form?.away_overall);
    const homeVenueForm = getFormPoints(form?.home_home);
    const awayVenueForm = getFormPoints(form?.away_away);
    const useVenueWeighting = homeVenueForm.matches >= 3 && awayVenueForm.matches >= 3;
    const homeFormFactor = useVenueWeighting
        ? (0.6 * (homeVenueForm.points / (homeVenueForm.matches * 3))) + (0.4 * (homeOverallForm.points / (homeOverallForm.matches * 3)))
        : (homeOverallForm.matches > 0 ? homeOverallForm.points / (homeOverallForm.matches * 3) : 0.5);
    const awayFormFactor = useVenueWeighting
         ? (0.6 * (awayVenueForm.points / (awayVenueForm.matches * 3))) + (0.4 * (awayOverallForm.points / (awayOverallForm.matches * 3)))
        : (awayOverallForm.matches > 0 ? awayOverallForm.points / (awayOverallForm.matches * 3) : 0.5);
    
    const formImpactFactor = 0.1;
    const safeHomeFormFactor = isNaN(homeFormFactor) ? 0.5 : homeFormFactor;
    const safeAwayFormFactor = isNaN(awayFormFactor) ? 0.5 : awayFormFactor;
    const form_mod_h = (1 + (safeHomeFormFactor - 0.5) * formImpactFactor);
    const form_mod_a = (1 + (safeAwayFormFactor - 0.5) * formImpactFactor);
    
    mu_h *= form_mod_h; mu_a *= form_mod_a;
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a;
    
    // --- ÚJ: Egyszerűsített Regresszió a Középértékhez ---
    if (currentSimProbs && typeof currentSimProbs.pHome === 'number' && typeof currentSimProbs.pAway === 'number') {
        logData.step = 'Regresszió';
        const homeWinProb = currentSimProbs.pHome / 100;
        const awayWinProb = currentSimProbs.pAway / 100;
        
        const getFormScore = (fStr: string | null | undefined): number => {
            if (!fStr || typeof fStr !== 'string' || fStr === "N/A" || fStr.length === 0) return 0.5;
             const wins = (fStr.match(/W/g) || []).length;
             const draws = (fStr.match(/D/g) || []).length;
            const matches = fStr.length;
            if (matches === 0) return 0.5;
            return (wins * 1 + draws * 0.33) / matches;
        };
        const homeFormScore = getFormScore(form?.home_overall);
        const awayFormScore = getFormScore(form?.away_overall);

        let regression_mod_h = 1.0;
        let regression_mod_a = 1.0;
        const regressionFactor = 0.03;

        if (homeWinProb > 0.6 && homeFormScore < 0.4) regression_mod_h -= regressionFactor;
        if (awayWinProb > 0.6 && awayFormScore < 0.4) regression_mod_a -= regressionFactor;
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
        const homeFormation = rawData?.tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = rawData?.tactics?.away?.formation?.toLowerCase() || 'n/a';
        let formation_mod_h = 1.0;
        let formation_mod_a = 1.0;
        if (homeFormation.startsWith('5') || homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) { formation_mod_a *= 0.95;
        }
        if (awayFormation.startsWith('5') || awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) { formation_mod_h *= 0.95;
        }
        const isOffensive = (f: string) => f.startsWith('4-3-3') || f.startsWith('3-4-3') || f.startsWith('4-2-4');
        if (isOffensive(homeFormation) && isOffensive(awayFormation)) { formation_mod_h *= 1.02; formation_mod_a *= 1.02;
        }
        mu_h *= formation_mod_h; mu_a *= formation_mod_a;
        logData.formation_mod_h = formation_mod_h; logData.formation_mod_a = formation_mod_a;
    }

    // Power Ratings (Tanult) (marad)
     logData.step = 'Power Ratings (Tanult)';
    const powerRatings = getAdjustedRatings();
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase();
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1, matches: 0 };
    const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1, matches: 0 };
    
    const homeWeight = Math.min(1, homePR.matches / 10);
    const awayWeight = Math.min(1, awayPR.matches / 10);
    const pr_mod_h = ((homePR.atk ?? 1) * (awayPR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
    const pr_mod_a = ((awayPR.atk ?? 1) * (homePR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
    
    mu_h *= pr_mod_h; mu_a *= pr_mod_a;
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def; logData.homePR_w = homeWeight;
    logData.awayPR_atk = awayPR.atk;
    logData.awayPR_def = awayPR.def; logData.awayPR_w = awayWeight;
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;
    
    // Pszichológiai Faktorok (marad)
    logData.step = 'Pszichológia';
    const psyMultiplier = 0.05;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    mu_h *= psy_mod_h;
    mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;


    // --- MÓDOSÍTOTT BLOKK: Hiányzók Hatása (2. Javaslat / v52 TS) ---
    logData.step = 'Hiányzók (Adatvezérelt)';
    let absentee_mod_h = 1.0;
    let absentee_mod_a = 1.0;

    // Az új, megbízható ICanonicalRawData forrást használjuk
    const detailedAbsentees = rawData?.detailedPlayerStats; 

    if (detailedAbsentees) {
        // Hazai hiányzók hatása
        (detailedAbsentees.home_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0; // Fallback átlag
                // Minél jobb a hiányzó játékos, annál nagyobb a negatív hatás
                 if (rating > 8.0) { // Elit játékos
                    absentee_mod_h *= 0.90; // 10% csökkenés a hazai támadásban/védekezésben
                    absentee_mod_a *= 1.05; // 5% növekedés a vendégnek
                } else if (rating > 7.0) { // Jó játékos
                    absentee_mod_h *= 0.95; // 5% csökkenés
                 } else {
                    absentee_mod_h *= 0.98; // 2% csökkenés
                }
            }
        });
        
        // Vendég hiányzók hatása
        (detailedAbsentees.away_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0;
                if (rating > 8.0) {
                    absentee_mod_a *= 0.90;
                    absentee_mod_h *= 1.05;
                } else if (rating > 7.0) {
                    absentee_mod_a *= 0.95;
                } else {
                    absentee_mod_a *= 0.98;
                }
            }
        });
        
    } else {
        // Fallback a régi (megbízhatatlan) LLM-alapú logikára, ha az új API hibát dob
        console.warn(`[Model.js] Hiányzó 'detailedPlayerStats'. Visszaállás a heurisztikus hiányzó-elemzésre.`);
        const impactFactor = sport === 'soccer' ? 0.05 : sport === 'hockey' ? 0.07 : 0.03;
        const gkImpactFactor = sport === 'soccer' ? 0.15 : sport === 'hockey' ? 0.20 : 0.05;
        (rawData?.absentees?.home || []).forEach(p => {
             if (p.importance === 'key') {
                const role = p.role?.toLowerCase() || '';
                if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) absentee_mod_h *= (1 - impactFactor);
                else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) absentee_mod_a *= (1 + impactFactor);
                 else if (role.includes('kapus') || role.includes('goalkeeper')) absentee_mod_a 
    *= (1 
                 + gkImpactFactor);
            }
        });
        (rawData?.absentees?.away || []).forEach(p => {
            if (p.importance === 'key') {
                 const role = p.role?.toLowerCase() || '';
         
                 if (role.includes('támadó') || role.includes('csatár') || role.includes('forward') || role.includes('striker')) absentee_mod_a *= (1 - impactFactor);
                else if (role.includes('védő') || role.includes('hátvéd') || role.includes('defender')) absentee_mod_h *= (1 + impactFactor);
                else if 
    (role.includes('kapus') || role.includes('goalkeeper')) absentee_mod_h *= (1 
                + gkImpactFactor);
     
             }
        });
    }

    mu_h *= absentee_mod_h;
    mu_a *= absentee_mod_a;
    logData.abs_mod_h = absentee_mod_h; 
    logData.abs_mod_a = absentee_mod_a;
    // --- MÓDOSÍTOTT BLOKK VÉGE ---


    // Meccs Fontosságának Hatása (marad)
    logData.step = 'Meccs Tétje';
    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a';
    let tension_mod = 1.0;
    if (tension === 'high' || tension === 'extreme') tension_mod = 1.03;
    else if (tension === 'low') tension_mod = 0.98;
    else if (tension === 'friendly') tension_mod = 0.95;
    mu_h *= tension_mod;
    mu_a *= tension_mod;
    logData.tension_mod = tension_mod;


    // --- Finomított Időjárás Hatása (Strukturált Adatok Alapján) ---
     logData.step = 'Időjárás (Strukturált)';
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
    mu_a = Math.max(minVal, mu_a || minVal);

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
export function estimateAdvancedMetrics(rawData: ICanonicalRawData, sport: string, leagueAverages: any): { mu_corners: number, mu_cards: number } {
    // Alapértékek a liga átlagokból vagy default értékek
    const avgCorners = leagueAverages?.avg_corners || 10.5;
    const avgCards = leagueAverages?.avg_cards || 4.5;
    let mu_corners = avgCorners;
    let mu_cards = avgCards;
    const logData: any = { sport };

    if (sport === 'soccer') {
        const adv = rawData?.advanced_stats;
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        logData.base_corners = mu_corners;
        logData.base_cards = mu_cards;
        
        // --- Szögletek ---
         let corner_mod = 1.0;
        const homeStyle = tactics?.home?.style?.toLowerCase() || 'n/a';
        const awayStyle = tactics?.away?.style?.toLowerCase() || 'n/a';
        if (homeStyle.includes('wing') || homeStyle.includes('szélső')) corner_mod += 0.05;
        if (awayStyle.includes('wing') || awayStyle.includes('szélső')) corner_mod += 0.05;
        if (homeStyle.includes('central') || homeStyle.includes('középen')) corner_mod -= 0.03;
        if (awayStyle.includes('central') || awayStyle.includes('középen')) corner_mod -= 0.03;
        const homeFormation = tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = tactics?.away?.formation?.toLowerCase() || 'n/a';
        if (awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) corner_mod += 0.03;
        if (homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) corner_mod += 0.03;
        mu_corners *= corner_mod;
        logData.corner_tactics_mod = corner_mod;

        // --- Lapok ---
        let card_mod = 1.0;
        if (referee?.style) {
            const styleLower = referee.style.toLowerCase();
            let refFactor = 1.0;
            if (styleLower.includes("strict") || styleLower.includes("szigorú")) refFactor = 1.15;
            else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) refFactor = 0.85;
            
            const cardMatch = referee.style.match(/(\d\.\d+)/);
            if (cardMatch) {
                const refereeAvg = parseFloat(cardMatch[1]);
                 card_mod = (refFactor * 0.5) + ((refereeAvg / avgCards) * 0.5);
            } else {
                 card_mod = refFactor;
            }
    
             logData.card_ref_mod = card_mod;
        }

        const tension = context?.match_tension_index?.toLowerCase() || 'low';
        if (tension === 'high') card_mod *= 1.1;
        else if (tension === 'extreme') card_mod *= 1.25;
        
        if (context?.match_tension_index?.toLowerCase().includes('derby') || rawData?.h2h_summary?.toLowerCase().includes('rivalry')) {
               card_mod *= 1.1;
             logData.is_derby = true;
        }
        logData.card_tension_mod = card_mod / (logData.card_ref_mod || 1);

        if (homeStyle.includes('press') || homeStyle.includes('aggressive')) card_mod += 0.05;
        if (awayStyle.includes('press') || awayStyle.includes('aggressive')) card_mod += 0.05;
        if (homeStyle.includes('counter')) card_mod += 0.03;
        if (awayStyle.includes('counter')) card_mod += 0.03;
        logData.card_tactics_mod = card_mod / (logData.card_ref_mod * logData.card_tension_mod || 1);
        
        const weather = context?.structured_weather;
        const pitch = context?.pitch_condition?.toLowerCase() || 'n/a';
        let weatherPitchMod = 1.0;
        if (weather && weather.precipitation_mm != null && weather.precipitation_mm > 3.0) {
            weatherPitchMod *= 1.05;
        }
        if (pitch.includes("rossz") || pitch.includes("poor")) {
            weatherPitchMod *= 1.08;
        }
     
         card_mod *= weatherPitchMod;
        logData.card_wp_mod = weatherPitchMod;

        mu_cards *= card_mod;

        mu_corners = Math.max(3.0, mu_corners || avgCorners);
        mu_cards = Math.max(1.5, mu_cards || avgCards);

        logData.final_mu_corners = mu_corners;
        logData.final_mu_cards = mu_cards;
    } else {
        mu_corners = avgCorners;
        mu_cards = avgCards;
    }
    
    return {
        mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5,
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5
    };
}
// --- MÓDOSÍTÁS VÉGE: Finomítás + Taktikai inputok ---


// --- simulateMatchProgress (Poisson javítással) ---
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
): any { // Az 'any' típus egyelőre marad, de egy 'ISimResult' interfész javasolt
    
    let home = 0, draw = 0, away = 0, btts = 0, over_main = 0;
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

    if (sport !== 'soccer' && draw > 0) {
        const totalWinsBeforeOT = home + away;
        if (totalWinsBeforeOT > 0) {
              home += draw * (home / totalWinsBeforeOT);
            away += draw * (away / totalWinsBeforeOT);
        } else {
             home += draw / 2;
            away += draw / 2;
        }
        draw = 0;
    }

    const toPct = (x: number) => (100 * x / safeSims);
    const topScoreKey = Object.keys(scores).length > 0
        ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0')
        : '0-0';
    
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number);
    
    return {
         pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: sport === 'soccer' ? {
             'o7.5': toPct(corners_o7_5), 'u7.5': 100 - toPct(corners_o7_5),
             'o8.5': toPct(corners_o8_5), 'u8.5': 100 - toPct(corners_o8_5),
             'o9.5': toPct(corners_o9_5), 'u9.5': 100 - toPct(corners_o9_5),
             'o10.5': toPct(corners_o10_5), 'u10.5': 100 - toPct(corners_o10_5),
             'o11.5': toPct(corners_o11_5), 'u11.5': 100 - toPct(corners_o11_5)
        } : {},
        cards: sport === 'soccer' ? {
             'o3.5': toPct(cards_o3_5), 'u3.5': 100 - toPct(cards_o3_5),
             'o4.5': toPct(cards_o4_5), 'u4.5': 100 - toPct(cards_o4_5),
             'o5.5': toPct(cards_o5_5), 'u5.5': 100 - toPct(cards_o5_5),
             'o6.5': toPct(cards_o6_5), 'u6.5': 100 - toPct(cards_o6_5)
        } : {},
        scores,
        topScore: { gh: top_gh, ga: top_ga },
        mainTotalsLine: safe_mainTotalsLine,
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}


// --- calculateModelConfidence (Változatlan, de típusosított bemenettel) ---
export function calculateModelConfidence(
    sport: string, 
    home: string, 
    away: string, 
    rawData: ICanonicalRawData, // TÍPUSOSÍTVA
    form: ICanonicalRawData['form'], // TÍPUSOSÍTVA
    sim: any, 
    marketIntel: string
): number {
    let score = 5.0;
    const MAX_SCORE = 10.0; const MIN_SCORE = 1.0;
    try {
        const getFormPointsPerc = (formString: string | null | undefined): number | null => {
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
            const simDiff = (sim.pHome - sim.pAway) / 100;
             if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5;
             }
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75;
             }
        }

        if (sim && sim.mu_h_sim != null && sim.mu_a_sim != null) {
            const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
            const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4;
            const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
            if (xgDiff > thresholdHigh) score += 1.5;
            if (xgDiff < thresholdLow) score -= 1.0;
        }

        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date);
                 const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                 if (!isNaN(latestH2HDate.getTime())) {
                      if (latestH2HDate < twoYearsAgo) { score -= 0.75;
                      }
                      else { score += 0.25;
                      }
                 }
            } catch(e: any) { console.warn("H2H dátum parse hiba:", e.message);
            }
        } else { score -= 0.25;
        }

        // Kulcshiányzók hatása (Már az adatvezérelt modell alapján)
        // Az ICanonicalRawData-ból olvasunk
        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        
        if (sim && sim.pHome != null && sim.pAway != null) {
            if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.5 * homeKeyAbsentees); // Nagyobb büntetés
            }
            if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.5 * awayKeyAbsentees);
            }
             if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.75 * awayKeyAbsentees); // Nagyobb bónusz
            }
             if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.75 * homeKeyAbsentees);
            }
        }

        // Piaci mozgás ellentmondása
         const marketIntelLower = marketIntel?.toLowerCase() || 'n/a';
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.' && sim && sim.pHome != null && sim.pAway != null) {
            const homeFavoredBySim = sim.pHome > sim.pAway && sim.pHome > 45;
            const awayFavoredBySim = sim.pAway > sim.pHome && sim.pAway > 45;
            const homeNameLower = home.toLowerCase();
            const awayNameLower = away.toLowerCase();
            
            if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
            }
             else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
            }
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
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        score += Math.min(1.0, historyBonus);


     } catch(e: any) {
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`, e.stack);
        return Math.max(MIN_SCORE, 4.0);
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

// --- calculatePsychologicalProfile (Változatlan) ---
export function calculatePsychologicalProfile(teamName: string, opponentName: string, rawData: ICanonicalRawData | null = null): { moraleIndex: number, pressureIndex: number } {
    let moraleIndex = 1.0;
    let pressureIndex = 1.0;

    if (rawData) {
        const formString = rawData.form?.home_overall;
        if (formString && formString !== "N/A") {
            const recentLosses = (formString.slice(-3).match(/L/g) || []).length;
            const recentWins = (formString.slice(-3).match(/W/g) || []).length;
            if (recentLosses >= 2) moraleIndex *= 0.95;
            if (recentWins >= 2) moraleIndex *= 1.05;
        }
        
        const tension = rawData.contextual_factors?.match_tension_index?.toLowerCase();
        if (tension === 'high') pressureIndex *= 1.05;
        if (tension === 'extreme') pressureIndex *= 1.10;
        if (tension === 'low' || tension === 'friendly') pressureIndex *= 0.95;
    }

    moraleIndex = Math.max(0.8, Math.min(1.2, moraleIndex));
    pressureIndex = Math.max(0.8, Math.min(1.2, pressureIndex));
    return { moraleIndex, pressureIndex };
}


// --- calculateValue (Típusosítva) ---
export function calculateValue(
    sim: any, 
    oddsData: ICanonicalOdds | null, 
    sport: string, 
    homeTeam: string, 
    awayTeam: string
): any[] { // Típus: { market: string, odds: number, probability: string, value: string }[]
    
    const valueBets: any[] = [];
    if (!oddsData || !sim) return valueBets;

    const findSimProb = (marketName: string, line: number | null = null): number | null => {
        if (!marketName || !sim) return null;
        const lowerMarket = marketName.toLowerCase();

        if (lowerMarket.includes('hazai') || lowerMarket === homeTeam.toLowerCase()) return sim.pHome / 100;
        if (lowerMarket.includes('vendég') || lowerMarket === awayTeam.toLowerCase()) return sim.pAway / 100;
        if (lowerMarket.includes('döntetlen') || lowerMarket === 'draw') return sim.pDraw / 100;
        
        if (line !== null && sim.mainTotalsLine != null && line === sim.mainTotalsLine) {
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) return sim.pOver / 100;
            if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) return sim.pUnder / 100;
        }

         if (lowerMarket.includes('btts') || lowerMarket.includes('mindkét csapat szerez gólt')) {
            const isYes = lowerMarket.includes("igen") || !lowerMarket.includes("nem");
            return isYes ? sim.pBTTS / 100 : (100 - sim.pBTTS) / 100;
        }

         if (sport === 'soccer' && sim.corners && line !== null && (lowerMarket.includes('corners') || lowerMarket.includes('szöglet'))) {
            const overKey = `o${line}`;
            const underKey = `u${line}`;
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) {
                return sim.corners[overKey] != null ? sim.corners[overKey] / 100 : null;
            }
            if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) {
                return sim.corners[underKey] != null ? sim.corners[underKey] / 100 : null;
            }
        }

        if (sport === 'soccer' && sim.cards && line !== null && (lowerMarket.includes('cards') || lowerMarket.includes('lap'))) {
            const overKey = `o${line}`;
            const underKey = `u${line}`;
            if (lowerMarket.startsWith('over') || lowerMarket.startsWith('felett')) {
                return sim.cards[overKey] != null ? sim.cards[overKey] / 100 : null;
            }
            if (lowerMarket.startsWith('under') || lowerMarket.startsWith('alatt')) {
                 return sim.cards[underKey] != null ? sim.cards[underKey] / 100 : null;
            }
        }
        return null;
    };

    (oddsData.allMarkets || []).forEach(market => {
        const marketKey = market.key?.toLowerCase();
        const isSupportedMarket = marketKey === 'h2h' || marketKey === 'totals' || marketKey === 'btts' || marketKey === 'corners_over_under' || marketKey === 'cards_over_under';

        if (isSupportedMarket && Array.isArray(market.outcomes)) {
                 market.outcomes.forEach(outcome => {
                 if (outcome && outcome.name && typeof outcome.price === 'number' && outcome.price > 1) {
       
                    const line = typeof outcome.point === 'number' ? outcome.point : null;
                     const probability = findSimProb(outcome.name, line);

                     if (probability != null && probability > 0) {
                         const value = (probability * outcome.price) - 1;
                         const valueThreshold = 0.05;

                         if (value >= valueThreshold) {
                            let marketDisplayName = outcome.name;
                            if (line !== null) {
                                marketDisplayName = `${outcome.name} ${line}`;
                            }
                            if (marketKey === 'btts') {
                                 marketDisplayName = `Mindkét csapat szerez gólt - ${outcome.name}`;
                            }

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
        }
    });

    return valueBets.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
}
// --- MÓDOSÍTÁS VÉGE ---


// --- analyzeLineMovement (Típusosítva) ---
export function analyzeLineMovement(
    currentOddsData: ICanonicalOdds | null, 
    openingOddsData: any, 
    sport: string, 
    homeTeam: string
): string {
     if (!openingOddsData || !currentOddsData || !currentOddsData.current || currentOddsData.current.length === 0 || !currentOddsData.allMarkets) { 
         return "Nincs elég adat a piaci mozgás elemzéséhez.";
     }
    let awayTeam = '';
    const potentialAway = currentOddsData.current.find(o =>
        o.name && o.name !== homeTeam && !o.name.toLowerCase().includes('hazai') && !o.name.toLowerCase().includes('döntetlen')
    );
    if (potentialAway) {
        awayTeam = potentialAway.name.replace('Vendég győzelem', '').trim();
        if (awayTeam === potentialAway.name) {
             awayTeam = potentialAway.name;
        }
    }
   
     if (!awayTeam) return "Nem sikerült azonosítani az ellenfelet az oddsokból a mozgáselemzéshez.";
     const key = `${homeTeam.toLowerCase()}_vs_${awayTeam.toLowerCase()}`;
    const openingMatch = openingOddsData[key];

    const currentH2HMarket = currentOddsData.allMarkets.find(m => m.key === 'h2h');
    const currentH2HOutcomes = currentH2HMarket?.outcomes;

    if (!openingMatch || !openingMatch.h2h || !Array.isArray(openingMatch.h2h) || !currentH2HOutcomes) {
         console.warn(`Hiányzó H2H adatok a mozgáselemzéshez: Key=${key}, Opening data found=${!!openingMatch}, Current data found=${!!currentH2HOutcomes}`);
         return "Hiányzó H2H adatok a mozgáselemzéshez.";
    }

    let changes: string[] = [];
    currentH2HOutcomes.forEach(currentOutcome => {
        let simpleName = '';
        const lowerCurrentName = currentOutcome.name?.toLowerCase() || '';
        const lowerHome = homeTeam.toLowerCase();
        const lowerAway = awayTeam.toLowerCase();

        if (lowerCurrentName === lowerHome || lowerCurrentName.includes('hazai')) simpleName = homeTeam;
        else if (lowerCurrentName === lowerAway || lowerCurrentName.includes('vendég')) simpleName = awayTeam;
        else if (lowerCurrentName.includes('döntetlen') || lowerCurrentName === 'draw') simpleName = 'Döntetlen';

        if (simpleName) {
            const openingOutcome = openingMatch.h2h.find((oo: any) => {
                const lowerOpeningName = oo.name?.toLowerCase() || '';
                 if (simpleName === homeTeam && (lowerOpeningName === lowerHome || lowerOpeningName.includes('hazai'))) return true;
                 if (simpleName === awayTeam && (lowerOpeningName === lowerAway || lowerOpeningName.includes('vendég'))) return true;
                 if (simpleName === 'Döntetlen' && (lowerOpeningName.includes('döntetlen') || lowerOpeningName === 'draw')) return true;
                 return false;
            });
      
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


// --- analyzePlayerDuels (Változatlan) ---
export function analyzePlayerDuels(keyPlayers: any, sport: string): string | null {
    if (!keyPlayers || (!Array.isArray(keyPlayers.home) && !Array.isArray(keyPlayers.away))) return null;
    try {
        const homeAttacker = keyPlayers.home?.find((p: any) => p?.role?.toLowerCase().includes('támadó') || p?.role?.toLowerCase().includes('csatár') || p?.role?.toLowerCase().includes('scorer'));
        const awayDefender = keyPlayers.away?.find((p: any) => p?.role?.toLowerCase().includes('védő') || p?.role?.toLowerCase().includes('hátvéd') || p?.role?.toLowerCase().includes('defender'));
        if (homeAttacker?.name && awayDefender?.name) { return `${homeAttacker.name} vs ${awayDefender.name} párharca kulcsfontosságú lehet.`;
        }
        if (sport === 'basketball') {
            const homePG = keyPlayers.home?.find((p: any) => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            const awayPG = keyPlayers.away?.find((p: any) => p?.role?.toLowerCase().includes('irányító') || p?.role?.toLowerCase().includes('point guard'));
            if (homePG?.name && awayPG?.name) { return `Az irányítók csatája (${homePG.name} vs ${awayPG.name}) meghatározó lehet a játék tempójára.`;
            }
        }
    } catch (e: any) { console.error("Hiba a játékos párharc elemzésekor:", e.message);
    }
    return null;
}

// --- Placeholder Funkciók (Változatlan) ---
export function generateProTip(probabilities: any, odds: any, market: any): string { console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!");
    return "Pro Tipp generálása még nincs implementálva."; }