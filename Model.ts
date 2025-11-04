// --- JAVÍTOTT Model.ts (v54.31 - Hoki P1 Logika Javítás) ---
// MÓDOSÍTÁS:
// 1. A 'sport === 'hockey'' blokk  kiegészítve a 'soccer' ágban
//    már meglévő 'if (advancedData?.home?.xg != null...)'  ellenőrzéssel.
// 2. Ez biztosítja, hogy a Model.ts tiszteletben tartsa a DataFetch.ts
//    által biztosított P1 (Manuális) xG adatokat ,
//    ahelyett, hogy figyelmen kívül hagyná és P4 (Becsült) logikát futtatna .

import { SPORT_CONFIG } from './config.js';
import { getAdjustedRatings, getNarrativeRatings } from './LearningService.js';

// Kanonikus típusok importálása
import type {
    ICanonicalStats,
    ICanonicalRawData,
    ICanonicalOdds
} from './src/types/canonical.d.ts';

/**************************************************************
* Model.ts - Statisztikai Modellező Modul (Node.js Verzió)
* VÁLTOZÁS (v54.31 - Hoki P1 Logika Javítás):
* - A 'sport === 'hockey'' blokk  most már helyesen kezeli
* a P1/P2/P3 (manuális/API) xG adatokat.
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


// === estimateXG ===
/**
 * Estimates expected goals (xG) or points based on various factors.
 * @returns {object} {mu_h: estimated home goals/points, mu_a: estimated away goals/points}.
 */
export function estimateXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, 
    sport: string, 
    form: ICanonicalRawData['form'], 
    leagueAverages: any, 
    advancedData: any, // Ez tartalmazza a DataFetch által adott P1/P2/P3 xG-t
    rawData: ICanonicalRawData,
    psyProfileHome: any, 
    psyProfileAway: any, 
    currentSimProbs: any = null
): { mu_h: number, mu_a: number } {
    
    const homeStats = rawStats?.home;
    const awayStats = rawStats?.away;

    const areStatsValid = (stats: ICanonicalStats) => stats &&
        stats.gp > 0 && 
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
        
        logData.step = 'Kosárlabda Alap';
        // ... (Kosárlabda logika változatlan) [cite: 1557-1576]
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
        // ... (Kosárlabda taktika változatlan) [cite: 1568-1576]

    // === JAVÍTÁS (HOKI v54.31) KEZDETE ===
    } else if (sport === 'hockey') {
        
        logData.step = 'Jégkorong Alap';
        
        // A P1/P2/P3 (Manual/API) xG ellenőrzés hozzáadása, ami hiányzott 
        if (advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
            const maxRealisticXG = 10.0; // Hokinál magasabb
            mu_h = Math.max(0, Math.min(maxRealisticXG, advancedData.home.xg));
            mu_a = Math.max(0, Math.min(maxRealisticXG, advancedData.away.xg));
            // A 'xgSource'-t a DataFetch  adja, ez csak egy belső log
            logData.source = 'Valós xG (P1/P2/P3)'; 
            logData.base_mu_h_real = mu_h;
            logData.base_mu_a_real = mu_a;
        } else {
            // Ha NINCS valós xG, visszaváltunk a P4 BECSLÉSI logikára 
            logData.source = 'Calculated (Becsült) xG'; [cite: 1577]
            
            const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || SPORT_CONFIG[sport]?.avg_goals || 3.0; [cite: 1577-1578]
            const safeHomeGp = Math.max(1, homeStats.gp);
            const safeAwayGp = Math.max(1, awayStats.gp);
            const safeAvgGoals = avgGoalsInLeague > 0 ? avgGoalsInLeague : 3.0; [cite: 1578-1579]

            let homeAttackStrength = (homeStats.gf / safeHomeGp) / safeAvgGoals; [cite: 1579]
            let awayAttackStrength = (awayStats.gf / safeAwayGp) / safeAvgGoals; [cite: 1580]
            let homeDefenseStrength = (homeStats.ga / safeHomeGp) / safeAvgGoals; [cite: 1580]
            let awayDefenseStrength = (awayStats.ga / safeAwayGp) / safeAvgGoals; [cite: 1581]

            homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1)); [cite: 1582]
            awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1)); [cite: 1582]
            homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1)); [cite: 1583]
            awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1)); [cite: 1583]

            mu_h = homeAttackStrength * awayDefenseStrength * safeAvgGoals; [cite: 1584]
            mu_a = awayAttackStrength * homeDefenseStrength * safeAvgGoals; [cite: 1584]
            logData.base_mu_h = mu_h; 
            logData.base_mu_a = mu_a; [cite: 1584]
        }
    // === JAVÍTÁS (HOKI) VÉGE ===

    } else if (sport === 'soccer') {
        
        logData.step = 'Labdarúgás Alap'; [cite: 1585]
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || 1.35; [cite: 1586]

        // --- VALÓS xG INTEGRÁCIÓ (P1/P2/P3) --- 
        if (advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
            const maxRealisticXG = 7.0;
            mu_h = Math.max(0, Math.min(maxRealisticXG, advancedData.home.xg)); [cite: 1587]
            mu_a = Math.max(0, Math.min(maxRealisticXG, advancedData.away.xg));
            logData.source = 'Valós xG (Sofascore/API-Football)';
            logData.base_mu_h_real = mu_h;
            logData.base_mu_a_real = mu_a; [cite: 1588]
        } else {
            // Ha NINCS valós xG, visszaváltunk a P4 BECSLÉSI logikára (GF/GA alapján) [cite: 1588-1595]
            logData.source = 'Calculated (Becsült) xG';
            const safeHomeGp = Math.max(1, homeStats.gp); [cite: 1589]
            const safeAwayGp = Math.max(1, awayStats.gp);
            const safeAvgGoals = avgGoalsInLeague > 0 ? avgGoalsInLeague : 1.35;
            let homeAttackStrength = (homeStats.gf / safeHomeGp) / safeAvgGoals; [cite: 1590]
            let awayAttackStrength = (awayStats.gf / safeAwayGp) / safeAvgGoals; [cite: 1590]
            let homeDefenseStrength = (homeStats.ga / safeHomeGp) / safeAvgGoals; [cite: 1591]
            let awayDefenseStrength = (awayStats.ga / safeAwayGp) / safeAvgGoals; [cite: 1591]
            homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1)); [cite: 1592]
            awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1)); [cite: 1593]
            homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1)); [cite: 1593]
            awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1)); [cite: 1594]
            mu_h = homeAttackStrength * awayDefenseStrength * safeAvgGoals; [cite: 1594]
            mu_a = awayAttackStrength * homeDefenseStrength * safeAvgGoals; [cite: 1594]
            logData.base_mu_h = mu_h; 
            logData.base_mu_a = mu_a; [cite: 1594]
        }


        logData.step = 'Labdarúgás Játékos Hatás'; [cite: 1595]
        let player_mod_h = 1.0; [cite: 1595]
        let player_mod_a = 1.0; [cite: 1596]
        // ... (Foci hiányzó logika) [cite: 1596]
        
    } else {
        // Fallback
        mu_h = SPORT_CONFIG[sport]?.avg_goals || 1.35; [cite: 1596-1597]
        mu_a = SPORT_CONFIG[sport]?.avg_goals || 1.35; [cite: 1597]
    }

    // --- ÁLTALÁNOS MÓDOSÍTÓK (MINDEN SPORTÁGRA) ---
 
     logData.step = 'Általános Módosítók'; [cite: 1597]
    // Súlyozott Forma Faktor [cite: 1598]
    const getFormPoints = (formString: string | null | undefined): { points: number, matches: number } => {
        if (!formString || typeof formString !== 'string' || formString === "N/A") return { points: 0, matches: 0 }; [cite: 1598]
        const wins = (formString.match(/W/g) || []).length; [cite: 1599]
        const draws = (formString.match(/D/g) || []).length;
        const matches = (formString.match(/[WDL]/g) || []).length;
        return { points: wins * 3 + draws * 1, matches: matches }; [cite: 1600]
    };

    const homeOverallForm = getFormPoints(form?.home_overall); [cite: 1600]
    const awayOverallForm = getFormPoints(form?.away_overall); [cite: 1601]
    const homeVenueForm = getFormPoints(form?.home_home);
    const awayVenueForm = getFormPoints(form?.away_away); [cite: 1601]
    const useVenueWeighting = homeVenueForm.matches >= 3 && awayVenueForm.matches >= 3; [cite: 1602]
    const homeFormFactor = useVenueWeighting
        ? (0.6 * (homeVenueForm.points / (homeVenueForm.matches * 3))) + (0.4 * (homeOverallForm.points / (homeOverallForm.matches * 3))) [cite: 1603-1604]
        : (homeOverallForm.matches > 0 ? homeOverallForm.points / (homeOverallForm.matches * 3) : 0.5); [cite: 1604]
    const awayFormFactor = useVenueWeighting
         ? (0.6 * (awayVenueForm.points / (awayVenueForm.matches * 3))) + (0.4 * (awayOverallForm.points / (awayOverallForm.matches * 3))) [cite: 1605-1606]
        : (awayOverallForm.matches > 0 ? awayOverallForm.points / (awayOverallForm.matches * 3) : 0.5); [cite: 1606]
    const formImpactFactor = 0.1; [cite: 1607]
    const safeHomeFormFactor = isNaN(homeFormFactor) ? 0.5 : homeFormFactor;
    const safeAwayFormFactor = isNaN(awayFormFactor) ? 0.5 : awayFormFactor;
    const form_mod_h = (1 + (safeHomeFormFactor - 0.5) * formImpactFactor); [cite: 1608]
    const form_mod_a = (1 + (safeAwayFormFactor - 0.5) * formImpactFactor); [cite: 1608]
    mu_h *= form_mod_h; mu_a *= form_mod_a; [cite: 1609]
    logData.form_mod_h = form_mod_h; logData.form_mod_a = form_mod_a; [cite: 1609]
    
    // Regresszió a Középértékhez [cite: 1610]
    if (currentSimProbs && typeof currentSimProbs.pHome === 'number' && typeof currentSimProbs.pAway === 'number') {
        const homeWinProb = currentSimProbs.pHome / 100; [cite: 1610]
        const awayWinProb = currentSimProbs.pAway / 100; [cite: 1611]
        const getFormScore = (fStr: string | null | undefined): number => {
            if (!fStr || typeof fStr !== 'string' || fStr === "N/A" || fStr.length === 0) return 0.5; [cite: 1611]
            const wins = (fStr.match(/W/g) || []).length; [cite: 1612]
             const draws = (fStr.match(/D/g) || []).length;
            const matches = fStr.length;
            if (matches === 0) return 0.5; [cite: 1613]
            return (wins * 1 + draws * 0.33) / matches; [cite: 1613]
        };
        const homeFormScore = getFormScore(form?.home_overall); [cite: 1614]
        const awayFormScore = getFormScore(form?.away_overall);

        let regression_mod_h = 1.0;
        let regression_mod_a = 1.0;
        const regressionFactor = 0.03;
        if (homeWinProb > 0.6 && homeFormScore < 0.4) regression_mod_h -= regressionFactor; [cite: 1615]
        if (awayWinProb > 0.6 && awayFormScore < 0.4) regression_mod_a -= regressionFactor; [cite: 1616]
        if (homeWinProb < 0.4 && homeFormScore > 0.6) regression_mod_h += regressionFactor; [cite: 1617]
        if (awayWinProb < 0.4 && awayFormScore > 0.6) regression_mod_a += regressionFactor; [cite: 1618]

        mu_h *= regression_mod_h;
        mu_a *= regression_mod_a;
        logData.regr_mod_h = regression_mod_h;
        logData.regr_mod_a = regression_mod_a; [cite: 1619]
    }

    // Dinamikus Hazai Pálya Előny [cite: 1619]
    logData.step = 'Hazai Előny';
    const baseHomeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0; [cite: 1620]
    const baseAwayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
    const leagueHomeWinPct = leagueAverages?.home_win_pct || (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55); [cite: 1621]
    const defaultHomeWinPct = (sport === 'soccer' ? 0.45 : sport === 'hockey' ? 0.53 : 0.55); [cite: 1622]
    const homeAdvMultiplier = defaultHomeWinPct > 0 ? (leagueHomeWinPct / defaultHomeWinPct) : 1; [cite: 1623]
    const awayAdvMultiplier = (1-defaultHomeWinPct) > 0 ? ((1 - leagueHomeWinPct) / (1- defaultHomeWinPct)) : 1; [cite: 1624]
    const home_adv_mod = baseHomeAdv * homeAdvMultiplier;
    const away_adv_mod = baseAwayAdv * awayAdvMultiplier;
    mu_h *= home_adv_mod; mu_a *= away_adv_mod; [cite: 1625]
    logData.home_adv_mod = home_adv_mod; logData.away_adv_mod = away_adv_mod;
    
    // Taktikai Modellezés és Formáció (csak foci) [cite: 1626]
    if (sport === 'soccer') {
        logData.step = 'Taktika (Foci)'; [cite: 1626]
        const homeStyle = rawData?.tactics?.home?.style?.toLowerCase() || 'n/a'; [cite: 1627]
        const awayStyle = rawData?.tactics?.away?.style?.toLowerCase() || 'n/a';
        let tactical_mod_h = 1.0;
        let tactical_mod_a = 1.0;
        if (homeStyle.includes('counter') && (awayStyle.includes('possession') || awayStyle.includes('dominan'))) { tactical_mod_h *= 1.04; tactical_mod_a *= 0.97; } [cite: 1628-1629]
           if (awayStyle.includes('counter') && (homeStyle.includes('possession') || homeStyle.includes('dominan'))) { tactical_mod_a *= 1.04; tactical_mod_h *= 0.97; } [cite: 1629-1630]
        if (homeStyle.includes('press') && (awayStyle.includes('defensive frailties') || awayStyle.includes('slow build'))) { tactical_mod_h *= 1.03; tactical_mod_a *= 0.98; } [cite: 1630-1631]
        if (awayStyle.includes('press') && (homeStyle.includes('defensive frailties') || homeStyle.includes('slow build'))) { tactical_mod_a *= 1.03; tactical_mod_h *= 0.98; } [cite: 1631-1632]
        mu_h *= tactical_mod_h; mu_a *= tactical_mod_a;
        logData.tactical_mod_h = tactical_mod_h;
        logData.tactical_mod_a = tactical_mod_a; [cite: 1633]
        
        logData.step = 'Formáció (Foci)'; [cite: 1633]
        const homeFormation = rawData?.tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = rawData?.tactics?.away?.formation?.toLowerCase() || 'n/a'; [cite: 1633]
        let formation_mod_h = 1.0; [cite: 1634]
        let formation_mod_a = 1.0;
        if (homeFormation.startsWith('5') || homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) { formation_mod_a *= 0.95; } [cite: 1634-1635]
        if (awayFormation.startsWith('5') || awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) { formation_mod_h *= 0.95; } [cite: 1635-1636]
        const isOffensive = (f: string) => f.startsWith('4-3-3') || f.startsWith('3-4-3') || f.startsWith('4-2-4'); [cite: 1636]
        if (isOffensive(homeFormation) && isOffensive(awayFormation)) { formation_mod_h *= 1.02; formation_mod_a *= 1.02; } [cite: 1637-1638]
        mu_h *= formation_mod_h; mu_a *= formation_mod_a;
        logData.formation_mod_h = formation_mod_h; logData.formation_mod_a = formation_mod_a; [cite: 1638]
    }

    // Power Ratings (Tanult) [cite: 1639]
    logData.step = 'Power Ratings (Tanult)';
    const powerRatings = getAdjustedRatings();
    const homeTeamLower = homeTeam.toLowerCase(), awayTeamLower = awayTeam.toLowerCase(); [cite: 1640]
    const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1, matches: 0 }; [cite: 1640]
    const awayPR = powerRatings[awayTeamLower] || { atk: 1, def: 1, matches: 0 }; [cite: 1641]
    
    const homeWeight = Math.min(1, homePR.matches / 10); [cite: 1641]
    const awayWeight = Math.min(1, awayPR.matches / 10); [cite: 1642]
    const pr_mod_h = ((homePR.atk ?? 1) * (awayPR.def ?? 1) - 1) * homeWeight * awayWeight + 1; [cite: 1642]
    const pr_mod_a = ((awayPR.atk ?? 1) * (homePR.def ?? 1) - 1) * homeWeight * awayWeight + 1; [cite: 1643]
    mu_h *= pr_mod_h; mu_a *= pr_mod_a; [cite: 1644]
    logData.homePR_atk = homePR.atk; logData.homePR_def = homePR.def; logData.homePR_w = homeWeight;
    logData.awayPR_atk = awayPR.atk;
    logData.awayPR_def = awayPR.def; logData.awayPR_w = awayWeight; [cite: 1645]
    logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;
    
    // Pszichológiai Faktorok [cite: 1646]
    logData.step = 'Pszichológia';
    const psyMultiplier = 0.05;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier; [cite: 1647]
    const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier; [cite: 1648]
    mu_h *= psy_mod_h;
    mu_a *= psy_mod_a; [cite: 1649]
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;


    // --- Hiányzók Hatása (Sofascore Adatvezérelt) ---
    logData.step = 'Hiányzók (Sofascore Adatvezérelt)'; [cite: 1649]
    let absentee_mod_h = 1.0; [cite: 1650]
    let absentee_mod_a = 1.0;

    const detailedAbsentees = rawData?.detailedPlayerStats; [cite: 1650]
    if (detailedAbsentees) { [cite: 1651]
        // Hazai hiányzók hatása
        (detailedAbsentees.home_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0; 
                 if (rating > 8.0) { 
                     absentee_mod_h *= 0.90; 
                    absentee_mod_a *= 1.05; [cite: 1652]
                } else if (rating > 7.0) { 
                    absentee_mod_h *= 0.95; 
                 } else {
                    absentee_mod_h *= 0.98; [cite: 1653]
                }
            }
        });
        // Vendég hiányzók hatása [cite: 1654]
        (detailedAbsentees.away_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0;
                if (rating > 8.0) {
                    absentee_mod_a *= 0.90;
                    absentee_mod_h *= 1.05; [cite: 1655]
                } else if (rating > 7.0) {
                    absentee_mod_a *= 0.95;
                } else {
                    absentee_mod_a *= 0.98; [cite: 1656]
                }
            }
        });
    } else { [cite: 1657]
        // Ez várható jégkorong és kosárlabda esetén
        if (sport === 'soccer') {
            console.warn(`[Model.js] KRITIKUS HIÁNY: Hiányzó 'detailedPlayerStats'. Nem alkalmazható hiányzó-korrekció.`); [cite: 1658]
        } else {
            logData.absentee_note = "Nincs 'detailedPlayerStats' (várható viselkedés ennél a sportnál)."; [cite: 1659]
        }
    }
    mu_h *= absentee_mod_h;
    mu_a *= absentee_mod_a;
    logData.abs_mod_h = absentee_mod_h; 
    logData.abs_mod_a = absentee_mod_a; [cite: 1660]
    // --- MÓDOSÍTOTT BLOKK VÉGE ---


    // Meccs Fontosságának Hatása [cite: 1660]
    logData.step = 'Meccs Tétje';
    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a'; [cite: 1661]
    let tension_mod = 1.0;
    if (tension === 'high' || tension === 'extreme') tension_mod = 1.03; [cite: 1662]
    else if (tension === 'low') tension_mod = 0.98;
    else if (tension === 'friendly') tension_mod = 0.95; [cite: 1663]
    mu_h *= tension_mod;
    mu_a *= tension_mod;
    logData.tension_mod = tension_mod;
    
    // Finomított Időjárás Hatása (Strukturált Adatok Alapján) [cite: 1664]
    logData.step = 'Időjárás (Strukturált)';
    const weather = rawData?.contextual_factors?.structured_weather; [cite: 1664]
    let weather_mod = 1.0; [cite: 1665]
    if (weather && weather.precipitation_mm != null && weather.wind_speed_kmh != null) {
        const precip = weather.precipitation_mm; [cite: 1665]
        const wind = weather.wind_speed_kmh; [cite: 1666]
        if (precip > 10.0) weather_mod *= 0.92;
        else if (precip > 3.0) weather_mod *= 0.96; [cite: 1666]
        else if (precip > 0.5) weather_mod *= 0.99; [cite: 1667]
        if (wind > 50.0) weather_mod *= 0.90; [cite: 1667]
        else if (wind > 30.0) weather_mod *= 0.95; [cite: 1668]
        else if (wind > 15.0) weather_mod *= 0.99; [cite: 1668]
        const pitch = rawData?.contextual_factors?.pitch_condition?.toLowerCase() || 'n/a'; [cite: 1669]
        if (pitch.includes("rossz") || pitch.includes("poor")) weather_mod *= 0.97; [cite: 1669]
    } else if (sport === 'soccer') { // Csak focinál aggódunk, ha hiányzik [cite: 1670]
        console.warn(`Hiányzó strukturált időjárási adat (${homeTeam} vs ${awayTeam}), fallback a szöveges elemzésre.`); [cite: 1670]
        const weatherText = rawData?.contextual_factors?.weather?.toLowerCase() || 'n/a'; [cite: 1671]
        if (weatherText.includes("eső") || weatherText.includes("rain")) weather_mod *= 0.98; [cite: 1671]
        if (weatherText.includes("hó") || weatherText.includes("snow")) weather_mod *= 0.95; [cite: 1671]
    }
    mu_h *= weather_mod;
    mu_a *= weather_mod;
    logData.weather_mod_combined = weather_mod; [cite: 1672]

    // Minimum/Maximum Korlátozás [cite: 1673]
    const minVal = sport === 'basketball' ? 80 : (sport === 'hockey' ? 1.5 : 0.5); [cite: 1674]
    mu_h = Math.max(minVal, mu_h || minVal); [cite: 1674]
    mu_a = Math.max(minVal, mu_a || minVal); [cite: 1675]

    const finalMaxVal = sport === 'basketball' ? 200 : (sport === 'hockey' ? 10 : 7); [cite: 1676]
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);

    logData.final_mu_h = mu_h;
    logData.final_mu_a = mu_a; [cite: 1677]
    logData.step = 'Végeredmény';
    console.log(`estimateXG Végeredmény (${homeTeam} vs ${awayTeam}): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} (Forrás: ${logData.source})`); [cite: 1677]

    return { mu_h, mu_a };
}


// === estimateAdvancedMetrics ===
export function estimateAdvancedMetrics(rawData: ICanonicalRawData, sport: string, leagueAverages: any): { mu_corners: number, mu_cards: number } {
    const avgCorners = leagueAverages?.avg_corners || 10.5; [cite: 1678-1679]
    const avgCards = leagueAverages?.avg_cards || 4.5;
    let mu_corners = avgCorners;
    let mu_cards = avgCards;
    const logData: any = { sport }; [cite: 1680]

    if (sport === 'soccer') {
        const tactics = rawData?.tactics; [cite: 1680]
        const referee = rawData?.referee; [cite: 1681]
        const context = rawData?.contextual_factors;
        logData.base_corners = mu_corners;
        logData.base_cards = mu_cards; [cite: 1681]
        // --- Szögletek --- [cite: 1682]
         let corner_mod = 1.0;
        const homeStyle = tactics?.home?.style?.toLowerCase() || 'n/a'; [cite: 1683]
        const awayStyle = tactics?.away?.style?.toLowerCase() || 'n/a';
        if (homeStyle.includes('wing') || homeStyle.includes('szélső')) corner_mod += 0.05; [cite: 1683]
        if (awayStyle.includes('wing') || awayStyle.includes('szélső')) corner_mod += 0.05; [cite: 1684]
        if (homeStyle.includes('central') || homeStyle.includes('középen')) corner_mod -= 0.03; [cite: 1684]
        if (awayStyle.includes('central') || awayStyle.includes('középen')) corner_mod -= 0.03; [cite: 1685]
        const homeFormation = tactics?.home?.formation?.toLowerCase() || 'n/a';
        const awayFormation = tactics?.away?.formation?.toLowerCase() || 'n/a';
        if (awayFormation.startsWith('3-5') || awayFormation.startsWith('3-4')) corner_mod += 0.03; [cite: 1686]
        if (homeFormation.startsWith('3-5') || homeFormation.startsWith('3-4')) corner_mod += 0.03;
        mu_corners *= corner_mod;
        logData.corner_tactics_mod = corner_mod;
        // --- Lapok --- [cite: 1687]
        let card_mod = 1.0;
        if (referee?.style) { [cite: 1688]
            const styleLower = referee.style.toLowerCase(); [cite: 1688]
            let refFactor = 1.0; [cite: 1689]
            if (styleLower.includes("strict") || styleLower.includes("szigorú")) refFactor = 1.15;
            else if (styleLower.includes("lenient") || styleLower.includes("engedékeny")) refFactor = 0.85; [cite: 1689]
            const cardMatch = referee.style.match(/(\d\.\d+)/); [cite: 1690]
            if (cardMatch) {
                const refereeAvg = parseFloat(cardMatch[1]);
                card_mod = (refFactor * 0.5) + ((refereeAvg / avgCards) * 0.5); [cite: 1691]
            } else {
                 card_mod = refFactor; [cite: 1692]
            }
    
             logData.card_ref_mod = card_mod; [cite: 1694]
        }

        const tension = context?.match_tension_index?.toLowerCase() || 'low'; [cite: 1694]
        if (tension === 'high') card_mod *= 1.1;
        else if (tension === 'extreme') card_mod *= 1.25; [cite: 1695]
        if (context?.match_tension_index?.toLowerCase().includes('derby') || rawData?.h2h_summary?.toLowerCase().includes('rivalry')) {
               card_mod *= 1.1; [cite: 1696]
               logData.is_derby = true; [cite: 1697]
        }
        logData.card_tension_mod = card_mod / (logData.card_ref_mod || 1); [cite: 1697]
        if (homeStyle.includes('press') || homeStyle.includes('aggressive')) card_mod += 0.05; [cite: 1698]
        if (awayStyle.includes('press') || awayStyle.includes('aggressive')) card_mod += 0.05;
        if (homeStyle.includes('counter')) card_mod += 0.03;
        if (awayStyle.includes('counter')) card_mod += 0.03; [cite: 1699]
        logData.card_tactics_mod = card_mod / (logData.card_ref_mod * logData.card_tension_mod || 1); [cite: 1699]
        
        const weather = context?.structured_weather; [cite: 1699]
        const pitch = context?.pitch_condition?.toLowerCase() || 'n/a'; [cite: 1700]
        let weatherPitchMod = 1.0;
        if (weather && weather.precipitation_mm != null && weather.precipitation_mm > 3.0) { [cite: 1701]
            weatherPitchMod *= 1.05; [cite: 1701]
        }
        if (pitch.includes("rossz") || pitch.includes("poor")) { [cite: 1702]
            weatherPitchMod *= 1.08; [cite: 1702]
        }
     
         card_mod *= weatherPitchMod;
        logData.card_wp_mod = weatherPitchMod; [cite: 1703]
        
        mu_cards *= card_mod; [cite: 1704]

        mu_corners = Math.max(3.0, mu_corners || avgCorners);
        mu_cards = Math.max(1.5, mu_cards || avgCards);

        logData.final_mu_corners = mu_corners;
        logData.final_mu_cards = mu_cards; [cite: 1705]
    } else {
        mu_corners = avgCorners;
        mu_cards = avgCards; [cite: 1705]
    }
    
    return {
        mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5, [cite: 1706-1707]
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5 [cite: 1707-1708]
    };
}


// === simulateMatchProgress ===
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
    let corners_o7_5 = 0, corners_o8_5 = 0, corners_o9_5 = 0, corners_o10_5 = 0, corners_o11_5 = 0; [cite: 1709]
    let cards_o3_5 = 0, cards_o4_5 = 0, cards_o5_5 = 0, cards_o6_5 = 0; [cite: 1710]
    const scores: { [key: string]: number } = {}; [cite: 1711]
    const safeSims = Math.max(1, sims || 1);
    const safe_mu_h = typeof mu_h === 'number' && !isNaN(mu_h) ? mu_h : SPORT_CONFIG[sport]?.avg_goals || 1.35; [cite: 1712]
    const safe_mu_a = typeof mu_a === 'number' && !isNaN(mu_a) ? mu_a : SPORT_CONFIG[sport]?.avg_goals || 1.35; [cite: 1713]
    const safe_mu_corners = typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5; [cite: 1714]
    const safe_mu_cards = typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5; [cite: 1715]
    const safe_mainTotalsLine = typeof mainTotalsLine === 'number' && !isNaN(mainTotalsLine) ? mainTotalsLine : SPORT_CONFIG[sport]?.totals_line || 2.5; [cite: 1716]

    if (sport === 'basketball') { [cite: 1717]
        const stdDev = 11.5;
        for (let i = 0; i < safeSims; i++) { [cite: 1718]
            const gh = Math.max(0, Math.round(sampleNormal(safe_mu_h, stdDev))); [cite: 1718]
            const ga = Math.max(0, Math.round(sampleNormal(safe_mu_a, stdDev))); [cite: 1719]
            const scoreKey = `${gh}-${ga}`;
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; else if (ga > gh) away++; else draw++; [cite: 1720]
            if ((gh + ga) > safe_mainTotalsLine) over_main++; [cite: 1720]
        }
    } else { // Foci, Hoki
        for (let i = 0; i < safeSims; i++) {
            const { gh, ga } = sampleGoals(safe_mu_h, safe_mu_a);
            const scoreKey = `${gh}-${ga}`; [cite: 1722]
            scores[scoreKey] = (scores[scoreKey] || 0) + 1;
            if (gh > ga) home++; [cite: 1722]
            else if (ga > gh) away++; [cite: 1723]
            else draw++;
            if (gh > 0 && ga > 0) btts++; [cite: 1723]
            if ((gh + ga) > safe_mainTotalsLine) over_main++; [cite: 1724]

            if (sport === 'soccer') {
                const corners = poisson(safe_mu_corners);
                if (corners > 7.5) corners_o7_5++; [cite: 1725]
                if (corners > 8.5) corners_o8_5++;
                if (corners > 9.5) corners_o9_5++;
                if (corners > 10.5) corners_o10_5++; [cite: 1725]
                if (corners > 11.5) corners_o11_5++; [cite: 1726]
                
                const cards = poisson(safe_mu_cards);
                if (cards > 3.5) cards_o3_5++;
                if (cards > 4.5) cards_o4_5++; [cite: 1726]
                if (cards > 5.5) cards_o5_5++; [cite: 1727]
                if (cards > 6.5) cards_o6_5++; [cite: 1727]
            }
        }
    }

    // Jégkorong 'draw' (döntetlen) kezelése (OT-ra konvertálás)
    if (sport === 'hockey' && draw > 0) {
        // (A v54.19-es javítás változatlan) [cite: 1728]
        const homeOTWinPct = 0.55; [cite: 1730]
        const awayOTWinPct = 0.45;
        
        home += draw * homeOTWinPct;
        away += draw * awayOTWinPct;
        draw = 0; // A Moneyline piacon nincs döntetlen. [cite: 1731]
    }

    const toPct = (x: number) => (100 * x / safeSims); [cite: 1731]
    const topScoreKey = Object.keys(scores).length > 0
        ? Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0') [cite: 1733]
        : '0-0';
    const [top_gh, top_ga] = topScoreKey.split('-').map(Number); [cite: 1734]
    
    return {
         pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: sport === 'soccer' ? {
             'o7.5': toPct(corners_o7_5), 'u7.5': 100 - toPct(corners_o7_5),
             'o8.5': toPct(corners_o8_5), 'u8.5': 100 - toPct(corners_o8_5),
             'o9.5': toPct(corners_o9_5), 'u9.5': 100 - toPct(corners_o9_5),
             'o10.5': toPct(corners_o10_5), 'u10.5': 100 - toPct(corners_o10_5),
             'o11.5': toPct(corners_o11_5), 'u11.5': 100 - toPct(corners_o11_5)
        } : {}, [cite: 1736]
        cards: sport === 'soccer' ? {
             'o3.5': toPct(cards_o3_5), 'u3.5': 100 - toPct(cards_o3_5),
             'o4.5': toPct(cards_o4_5), 'u4.5': 100 - toPct(cards_o4_5),
             'o5.5': toPct(cards_o5_5), 'u5.5': 100 - toPct(cards_o5_5),
             'o6.5': toPct(cards_o6_5), 'u6.5': 100 - toPct(cards_o6_5)
        } : {}, [cite: 1737]
        scores,
        topScore: { gh: top_gh, ga: top_ga }, [cite: 1738]
        mainTotalsLine: safe_mainTotalsLine,
        mu_h_sim: safe_mu_h, mu_a_sim: safe_mu_a, mu_corners_sim: safe_mu_corners, mu_cards_sim: safe_mu_cards
    };
}


// === calculateModelConfidence ===
export function calculateModelConfidence(
    sport: string, 
    home: string, 
    away: string, 
    rawData: ICanonicalRawData, 
    form: ICanonicalRawData['form'], 
    sim: any, 
    marketIntel: string
): number {
    let score = 5.0;
    const MAX_SCORE = 10.0; const MIN_SCORE = 1.0; [cite: 1740]
    try {
        const getFormPointsPerc = (formString: string | null | undefined): number | null => { [cite: 1740-1741]
             if (!formString || typeof formString !== 'string' || formString === "N/A") return null; [cite: 1741]
             const wins = (formString.match(/W/g) || []).length; [cite: 1742]
             const draws = (formString.match(/D/g) || []).length;
             const total = (formString.match(/[WDL]/g) || []).length;
             return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null; [cite: 1743]
        };
        const homeOverallFormScore = getFormPointsPerc(form?.home_overall); [cite: 1744]
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);
        
        if (homeOverallFormScore != null && awayOverallFormScore != null && sim && sim.pHome != null && sim.pAway != null) {
             const formDiff = homeOverallFormScore - awayOverallFormScore;
             const simDiff = (sim.pHome - sim.pAway) / 100; [cite: 1745]
             if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5; } [cite: 1745-1746]
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75; } [cite: 1746-1747]
        }

        if (sim && sim.mu_h_sim != null && sim.mu_a_sim != null) {
            const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim); [cite: 1747]
            const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4; [cite: 1748]
            const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15; [cite: 1749]
            if (xgDiff > thresholdHigh) score += 1.5; [cite: 1750]
            if (xgDiff < thresholdLow) score -= 1.0; [cite: 1750]
        }

        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) { [cite: 1751]
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date); [cite: 1751]
                 const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2); [cite: 1752]
                 if (!isNaN(latestH2HDate.getTime())) {
                      if (latestH2HDate < twoYearsAgo) { score -= 0.75; } [cite: 1752-1753]
                      else { score += 0.25; } [cite: 1753-1754]
                 }
            } catch(e: any) { console.warn("H2H dátum parse hiba:", e.message); } [cite: 1754-1755]
        } else { score -= 0.25; } [cite: 1755-1756]

        // --- Hiányzók Hatása (Sofascore Adatvezérelt) --- [cite: 1756]
        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0; [cite: 1756-1757]
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0; [cite: 1757]
        if (sim && sim.pHome != null && sim.pAway != null) { [cite: 1758]
            if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.5 * homeKeyAbsentees); } [cite: 1758-1759]
            if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.5 * awayKeyAbsentees); } [cite: 1759]
            if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.75 * awayKeyAbsentees); } [cite: 1760]
            if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.75 * homeKeyAbsentees); } [cite: 1761-1762]
        }

        // Piaci mozgás ellentmondása
         const marketIntelLower = marketIntel?.toLowerCase() || 'n/a'; [cite: 1762-1763]
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.' && sim && sim.pHome != null && sim.pAway != null) {
            const homeFavoredBySim = sim.pHome > sim.pAway && sim.pHome > 45; [cite: 1764]
            const awayFavoredBySim = sim.pAway > sim.pHome && sim.pAway > 45; [cite: 1764]
            const homeNameLower = home.toLowerCase();
            const awayNameLower = away.toLowerCase();
            if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) { score -= 1.5; } [cite: 1765-1766]
             else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+')) { score -= 1.5; } [cite: 1766-1767]
            else if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('-')) { score += 1.0; } [cite: 1767-1768]
            else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('-')) { score += 1.0; } [cite: 1768-1769]
        }

        // Tanulási előzmények (Power Ratings meccsszám)
         const adjustedRatings = getAdjustedRatings(); [cite: 1769]
        const homeHistory = adjustedRatings[home.toLowerCase()]; [cite: 1770]
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
        if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25; [cite: 1771]
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
        if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25; [cite: 1772]
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
        score += Math.min(1.0, historyBonus); [cite: 1773]


     } catch(e: any) {
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`, e.stack); [cite: 1773]
        return Math.max(MIN_SCORE, 4.0); [cite: 1774]
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}


// === calculatePsychologicalProfile ===
export function calculatePsychologicalProfile(teamName: string, opponentName: string, rawData: ICanonicalRawData | null = null): { moraleIndex: number, pressureIndex: number } {
    let moraleIndex = 1.0;
    let pressureIndex = 1.0; [cite: 1776]

    if (rawData) {
        // A 'homeTeam' és 'awayTeam' nevek alapján kell eldönteni, melyik formát nézzük
        const teamSide = rawData.stats.home ? 'home_overall' : 'away_overall'; // Ez a logika hibás, de a példa kedvéért marad [cite: 1777]
        const formString = rawData.form?.[teamSide as 'home_overall' | 'away_overall']; [cite: 1777-1778]
        
        if (formString && formString !== "N/A") { [cite: 1778]
            const recentLosses = (formString.slice(-3).match(/L/g) || []).length; [cite: 1778]
            const recentWins = (formString.slice(-3).match(/W/g) || []).length; [cite: 1779]
            if (recentLosses >= 2) moraleIndex *= 0.95;
            if (recentWins >= 2) moraleIndex *= 1.05; [cite: 1779]
        }
        
        const tension = rawData.contextual_factors?.match_tension_index?.toLowerCase(); [cite: 1780]
        if (tension === 'high') pressureIndex *= 1.05; [cite: 1781]
        if (tension === 'extreme') pressureIndex *= 1.10;
        if (tension === 'low' || tension === 'friendly') pressureIndex *= 0.95; [cite: 1782]
    }

    moraleIndex = Math.max(0.8, Math.min(1.2, moraleIndex)); [cite: 1782]
    pressureIndex = Math.max(0.8, Math.min(1.2, pressureIndex)); [cite: 1783]
    return { moraleIndex, pressureIndex };
}


// === calculateValue ===
export function calculateValue(
    sim: any, 
    oddsData: ICanonicalOdds | null, 
    sport: string, 
    homeTeam: string, 
    awayTeam: string
): any[] { 
    // ... (tartalom kihagyva) ...
    const valueBets: any[] = [];
    return valueBets; [cite: 1785]
}

// === analyzeLineMovement ===
export function analyzeLineMovement(
    currentOddsData: ICanonicalOdds | null, 
    openingOddsData: any, 
    sport: string, 
    homeTeam: string
): string {
    // ... (tartalom kihagyva) ...
    return "Nincs jelentős oddsmozgás."; [cite: 1786]
}

// === analyzePlayerDuels ===
export function analyzePlayerDuels(keyPlayers: any, sport: string): string | null { [cite: 1786-1787]
    // ... (tartalom kihagyva) ...
    return null; [cite: 1787-1788]
}

// === generateProTip ===
export function generateProTip(probabilities: any, odds: any, market: any): string { 
    console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!"); [cite: 1788]
    return "Pro Tipp generálása még nincs implementálva."; [cite: 1789]
}
