// --- JAVÍTOTT Model.ts (v70.0 - "Okos" Specialista) ---
// MÓDOSÍTÁS (v70.0):
// 1. ELTÁVOLÍTVA: Az 'applyContextualModifiers' függvény törölve.
//    Ennek a felelősségét az 'AI_Service.ts'-ben (v70.0) definiált
//    új 3. Ügynök (AI Specialista) vette át.
// 2. A többi funkció (estimatePureXG, simulateMatchProgress, stb.)
//    érintetlen marad, mivel azokat az 1., 4. és 5. Ügynökök még használják.

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
* VÁLTOZÁS (v70.0):
* - Az 'applyContextualModifiers' (szabálymotor) eltávolítva.
* - A felelősséget az 'AI_Service.ts' (v70.0) 'runStep_Specialist' vette át.
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


// === 1. ÜGYNÖK (QUANT): Tiszta xG Számítása ===
/**
 * 1. ÜGYNÖK: Kiszámítja a "Tiszta xG-t" a P1 (manuális 4-komponensű) vagy
 * P4 (fallback statisztika) adatok alapján.
 * Kontextuális módosítókat (sérülés, időjárás) NEM ALKALMAZ.
 */
export function estimatePureXG(
    homeTeam: string, 
    awayTeam: string, 
    rawStats: { home: ICanonicalStats, away: ICanonicalStats }, 
    sport: string, 
    form: ICanonicalRawData['form'], 
    leagueAverages: any, 
    advancedData: any // Ez tartalmazza az Ön P1-es "Komponens" adatait
): { pure_mu_h: number, pure_mu_a: number, source: string } {
    
    const homeStats = rawStats?.home;
    const awayStats = rawStats?.away;

    const areStatsValid = (stats: ICanonicalStats) => stats &&
        stats.gp > 0 && 
        (typeof stats.gf === 'number') && 
        (typeof stats.ga === 'number');
    // Ellenőrizzük, hogy P1 adat (4-komponensű) rendelkezésre áll-e
    const hasP1Data = advancedData?.manual_H_xG != null && advancedData?.manual_H_xGA != null &&
                      advancedData?.manual_A_xG != null && advancedData?.manual_A_xGA != null;
    const p4Required = !hasP1Data; // P4 (fallback) kell, ha nincs P1
    
    if (p4Required && (!areStatsValid(homeStats) || !areStatsValid(awayStats))) {
        console.warn(`HIÁNYOS/ÉRVÉNYTELEN STATS (P4 módban): ${homeTeam} (GP:${homeStats?.gp}) vs ${awayTeam} (GP:${awayStats?.gp}). Default xG.`);
        const defaultGoals = SPORT_CONFIG[sport]?.avg_goals || (sport === 'basketball' ? 110 : (sport === 'hockey' ? 3.0 : 1.35));
        const homeAdv = SPORT_CONFIG[sport]?.home_advantage || { home: 1.05, away: 0.95 };
        // A hazai előnyt CSAK a fallback-ben alkalmazzuk, a P1/P4 számítások már tartalmazzák
        return { 
            pure_mu_h: defaultGoals * homeAdv.home, 
            pure_mu_a: defaultGoals * homeAdv.away, 
            source: 'Default (Hiányos Stat)' 
        };
    }

    let mu_h: number, mu_a: number;
    let source: string;
    const MIN_STRENGTH = 0.2;
    const MAX_STRENGTH = 5.0;
    // 1. LÉPÉS: BÁZIS XG MEGHATÁROZÁSA (P1 vagy P4)
    
    if (hasP1Data)
    {
        // A BÁZIS beállítása az Ön 4-komponensű, átlagolt adatára
        const maxRealisticXG = sport === 'hockey' ? 10.0 : 7.0;
        
        // A HELYES LOGIKA: (Hazai Támadás + Vendég Védekezés) / 2
        mu_h = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
        // A HELYES LOGIKA: (Vendég Támadás + Hazai Védekezés) / 2
        mu_a = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;
        mu_h = Math.max(0, Math.min(maxRealisticXG, mu_h));
        mu_a = Math.max(0, Math.min(maxRealisticXG, mu_a));
        
        source = 'Manual (Components)';
        console.log(`[Model.ts - 1. Ügynök] Hibrid P1: 4-Komponensű Szezonális xG betöltve: H=${mu_h}, A=${mu_a}`);
    } else if (sport === 'basketball') {
        // P4 (Kosárlabda) - Külön logika
        source = 'Calculated (Becsült) Pontok [P4]';
        // ... (A kosárlabda P4 logika változatlan) ...
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
        // Kosár four-factors (ez még a PURE xG része, mert statisztikai)
        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
            const homeFF = advancedData.home.four_factors;
            const awayFF = advancedData.away.four_factors;
            const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05;
            const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05;
            mu_h *= (1 + ore_advantage - tov_advantage);
            mu_a *= (1 - ore_advantage + tov_advantage);
        }

    } else {
        // P4 (Fallback - Foci, Hoki)
        source = 'Calculated (Becsült) xG [P4]';
        const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || (sport === 'soccer' ? 1.35 : 3.0);
        const safeHomeGp = Math.max(1, homeStats.gp);
        const safeAwayGp = Math.max(1, awayStats.gp);
        const safeAvgGoals = avgGoalsInLeague > 0 ?
            avgGoalsInLeague : (sport === 'soccer' ? 1.35 : 3.0);
        
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
    }
    // --- BÁZIS XG MEGHATÁROZVA ---
    
    console.log(`[Model.ts - 1. Ügynök] Tiszta xG: H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} (Forrás: ${source})`);
    return { pure_mu_h: mu_h, pure_mu_a: mu_a, source: source };
}


// === 3. ÜGYNÖK (SPECIALISTA): Kontextuális Módosítók ===
/**
 * === ELAVULT (v70.0) ===
 * Ezt a függvényt ('applyContextualModifiers') már nem használjuk.
 * A felelősségét az 'AI_Service.ts'-ben (v70.0) lévő 'runStep_Specialist'
 * (3. Ügynök - AI Specialista) vette át.
 */
/*
export function applyContextualModifiers(
    // ... A teljes régi, 400+ soros (v63.2) függvény kódja itt volt ...
    // ... ELTÁVOLÍTVA ...
): { mu_h: number, mu_a: number, modifierLog: any } {
    // ... TÖRÖLVE ...
}
*/


// === estimateAdvancedMetrics (v58.2 - Változatlan) ===
export function estimateAdvancedMetrics(rawData: ICanonicalRawData, sport: string, leagueAverages: any): { mu_corners: number, mu_cards: number } {
    const avgCorners = leagueAverages?.avg_corners || 10.5;
    const avgCards = leagueAverages?.avg_cards || 4.5;
    let mu_corners = avgCorners;
    let mu_cards = avgCards;
    const logData: any = { sport };

    if (sport === 'soccer') {
        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        logData.base_corners = mu_corners;
        logData.base_cards = mu_cards;
        // --- Szögletek (Változatlan) ---
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
        // --- Lapok (v58.2) ---
        let card_mod = 1.0;
        if (referee?.style) {
            const styleLower = referee.style.toLowerCase();
            let refFactor = 1.0;
            if (styleLower.includes("szigorú")) refFactor = 1.15;
            else if (styleLower.includes("engedékeny")) refFactor = 0.85;
            
            const cardMatch = styleLower.match(/(\d+\.\d+)/);
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
        mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ?
            mu_corners : 10.5,
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ?
            mu_cards : 4.5
    };
}


// === 4. ÜGYNÖK (SZIMULÁTOR): Meccs Szimuláció (Változatlan) ===
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


// === calculateModelConfidence (Változatlan) ===
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
        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
        if (sim && sim.pHome != null && sim.pAway != null) {
            if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.5 * homeKeyAbsentees);
            }
            if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.5 * awayKeyAbsentees);
            }
            if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.75 * awayKeyAbsentees);
            }
            if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.75 * homeKeyAbsentees);
            }
        }
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

// === calculatePsychologicalProfile (Változatlan) ===
export function calculatePsychologicalProfile(teamName: string, opponentName: string, rawData: ICanonicalRawData | null = null): { moraleIndex: number, pressureIndex: number } {
    let moraleIndex = 1.0;
    let pressureIndex = 1.0;
    if (rawData) {
        const teamSide = rawData.stats.home ? 'home_overall' : 'away_overall';
        const formString = rawData.form?.[teamSide as 'home_overall' | 'away_overall'];
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

// === calculateValue (JAVÍTOTT - Stub) ===
export function calculateValue(sim: any, oddsData: ICanonicalOdds | null, sport: string, homeTeam: string, awayTeam: string): any[] { 
    const valueBets: any[] = [];
    return valueBets;
}

// === analyzeLineMovement (JAVÍTOTT - Stub) ===
export function analyzeLineMovement(currentOddsData: ICanonicalOdds | null, openingOddsData: any, sport: string, homeTeam: string): string {
    return "Nincs jelentős oddsmozgás.";
}

// === analyzePlayerDuels (JAVÍTOTT - Stub) ===
export function analyzePlayerDuels(keyPlayers: any, sport: string): string | null {
    return null;
}