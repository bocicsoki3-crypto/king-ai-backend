// --- JAVÍTOTT Model.ts (v63.2 - xG Finomhangolás) ---
// MÓDOSÍTÁS (Feladat 4):
// 1. JAVÍTVA: A 'applyContextualModifiers' függvényben a hiányzók hatása
//    most már figyelembe veszi a (Támadó/Védő) szerepkört, finomítva a
//    mu_h/mu_a módosítások irányát.
// 2. JAVÍTVA: A Bírói Faktor (referee_mod) eltávolítva az xG számításból
//    a 'applyContextualModifiers' függvényben, mivel a lapokra koncentrál.

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
* VÁLTOZÁS (v63.2):
* - Hiányzók szerepkör-érzékeny súlyozása.
* - Bírói faktor eltávolítva az xG láncból.
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
        const maxRealisticXG = sport === 'hockey' ?
10.0 : 7.0;
        
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
        const avgOffRating = leagueAverages?.avg_offensive_rating ||
110;
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
1673] avgGoalsInLeague : (sport === 'soccer' ? 1.35 : 3.0);
        
        let homeAttackStrength = (homeStats.gf / safeHomeGp) / safeAvgGoals;
let awayAttackStrength = (awayStats.gf / safeAwayGp) / safeAvgGoals;
        let homeDefenseStrength = (homeStats.ga / safeHomeGp) / safeAvgGoals;
let awayDefenseStrength = (awayStats.ga / safeAwayGp) / safeAvgGoals;
        
        homeAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeAttackStrength || 1));
let awayAttackStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayAttackStrength || 1));
        homeDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, homeDefenseStrength || 1));
let awayDefenseStrength = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, awayDefenseStrength || 1));
        
        mu_h = homeAttackStrength * awayDefenseStrength * safeAvgGoals;
mu_a = awayAttackStrength * homeDefenseStrength * safeAvgGoals;
    }
    // --- BÁZIS XG MEGHATÁROZVA ---
    
    console.log(`[Model.ts - 1. Ügynök] Tiszta xG: H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)} (Forrás: ${source})`);
return { pure_mu_h: mu_h, pure_mu_a: mu_a, source: source };
}


// === 3. ÜGYNÖK (SPECIALISTA): Kontextuális Módosítók ===
/**
 * 3. ÜGYNÖK: Fogadja a "Tiszta xG-t" (1. Ügynöktől) és a "Kontextust" (2. Ügynöktől),
 * és létrehozza a "Súlyozott Végleges xG-t".
 * Ez a függvény tartalmazza a "Dupla Számítás" hibajavítását.
 */
export function applyContextualModifiers(
    pure_mu_h: number,
    pure_mu_a: number,
    quantSource: string, // Az 1. Ügynök forrása (P1 vagy P4)
    rawData: ICanonicalRawData,
    sport: string, 
    psyProfileHome: any, 
    psyProfileAway: any, 
    currentSimProbs: any = null
): { mu_h: number, mu_a: number, modifierLog: any } {

    let mu_h = pure_mu_h;
let mu_a = pure_mu_a;
    
    const logData: any = { 
        step: 'Specialista Indul', 
        base_mu_h: pure_mu_h, 
        base_mu_a: pure_mu_a, 
        quant_source: quantSource 
    };
// === A "DUPLA SZÁMÍTÁS" HIBA JAVÍTÁSA ===
    // Ez a kapcsoló az 1. Ügynök kimenete alapján dől el.
// Ha P1-es (szezonális átlag) adatot használtunk, a Forma és Power Rating
    // módosítók már be vannak építve, ezért KIHAGYJUK őket.
const p1_is_seasonal_avg = quantSource.includes('Manual (Components)');
    // ==========================================

    // 2. LÉPÉS: KONTEXTUÁLIS MÓDOSÍTÓK ALKALMAZÁSA
    console.log(`[Model.ts - 3. Ügynök] Kontextuális lánc indítása... (P1 Szezonális: ${p1_is_seasonal_avg})`);
// === Forma és Regresszió (CSAK P4 ESETÉN) ===
    if (!p1_is_seasonal_avg) {
        logData.step = 'Általános Módosítók (P4 Ág)';
// Súlyozott Forma Faktor
        const getFormPoints = (formString: string | null | undefined): { points: number, matches: number } => {
            if (!formString || typeof formString !== 'string' || formString === "N/A") return { points: 0, matches: 0 };
let wins = (formString.match(/W/g) || []).length;
            const draws = (formString.match(/D/g) || []).length;
            const matches = (formString.match(/[WDL]/g) || []).length;
return { points: wins * 3 + draws * 1, matches: matches };
        };
        const homeOverallForm = getFormPoints(rawData?.form?.home_overall);
const awayOverallForm = getFormPoints(rawData?.form?.away_overall);
        const homeVenueForm = getFormPoints(rawData?.form?.home_home);
        const awayVenueForm = getFormPoints(rawData?.form?.away_away);
const useVenueWeighting = homeVenueForm.matches >= 3 && awayVenueForm.matches >= 3;
        
        let homeFormPoints = 0.5;
if (useVenueWeighting && homeVenueForm.matches * homeOverallForm.matches > 0) {
            homeFormPoints = (0.6 * (homeVenueForm.points / (homeVenueForm.matches * 3))) + (0.4 * (homeOverallForm.points / (homeOverallForm.matches * 3)));
} else if (homeOverallForm.matches > 0) {
            homeFormPoints = homeOverallForm.points / (homeOverallForm.matches * 3);
}
        
        let awayFormPoints = 0.5;
if (useVenueWeighting && awayVenueForm.matches * awayOverallForm.matches > 0) {
            awayFormPoints = (0.6 * (awayVenueForm.points / (awayVenueForm.matches * 3))) + (0.4 * (awayOverallForm.points / (awayOverallForm.matches * 3)));
} else if (awayOverallForm.matches > 0) {
            awayFormPoints = awayOverallForm.points / (awayOverallForm.matches * 3);
}
        
        const formImpactFactor = 0.1;
const safeHomeFormFactor = isNaN(homeFormPoints) ? 0.5 : homeFormPoints;
        const safeAwayFormFactor = isNaN(awayFormPoints) ? 0.5 : awayFormPoints;
const form_mod_h = (1 + (safeHomeFormFactor - 0.5) * formImpactFactor);
        const form_mod_a = (1 + (safeAwayFormFactor - 0.5) * formImpactFactor);
mu_h *= form_mod_h; mu_a *= form_mod_a;
        logData.form_mod_h = form_mod_h;
        logData.form_mod_a = form_mod_a;
// Regresszió a Középértékhez
        if (currentSimProbs && typeof currentSimProbs.pHome === 'number' && typeof currentSimProbs.pAway === 'number') {
            const homeWinProb = currentSimProbs.pHome / 100;
const awayWinProb = currentSimProbs.pAway / 100;
            const getFormScore = (fStr: string | null | undefined): number => {
                if (!fStr || typeof fStr !== 'string' || fStr === "N/A" || fStr.length === 0) return 0.5;
let wins = (fStr.match(/W/g) || []).length;
                 const draws = (fStr.match(/D/g) || []).length;
                const matches = fStr.length;
if (matches === 0) return 0.5;
                return (wins * 1 + draws * 0.33) / matches;
            };
const homeFormScore = getFormScore(rawData?.form?.home_overall);
            const awayFormScore = getFormScore(rawData?.form?.away_overall);
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
    } else {
        console.log(`[Model.ts - 3. Ügynök] MODOSÍTÓ KIHAGYVA: Forma Faktor & Regresszió (P1 Szezonális Adat).`);
logData.form_mod_h = 1.0;
        logData.form_mod_a = 1.0;
        logData.regr_mod_h = 1.0;
        logData.regr_mod_a = 1.0;
}

    // === Power Rating (CSAK P4 ESETÉN) ===
    if (!p1_is_seasonal_avg) {
        logData.step = 'Power Ratings (Tanult) (P4 Ág)';
const powerRatings = getAdjustedRatings();
        const homeTeamLower = rawData?.apiFootballData?.homeTeamName?.toLowerCase() || 'unknown';
        const awayTeamLower = rawData?.apiFootballData?.awayTeamName?.toLowerCase() || 'unknown';
const homePR = powerRatings[homeTeamLower] || { atk: 1, def: 1, matches: 0 };
        const awayPR = powerRatings[awayTeamLower] ||
{ atk: 1, def: 1, matches: 0 };
        const homeWeight = Math.min(1, homePR.matches / 10);
const awayWeight = Math.min(1, awayPR.matches / 10);
        
        const pr_mod_h = ((homePR.atk ?? 1) * (awayPR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
const pr_mod_a = ((awayPR.atk ?? 1) * (homePR.def ?? 1) - 1) * homeWeight * awayWeight + 1;
mu_h *= pr_mod_h; mu_a *= pr_mod_a;
        logData.pr_mod_h = pr_mod_h; logData.pr_mod_a = pr_mod_a;
} else {
         console.log(`[Model.ts - 3. Ügynök] MODOSÍTÓ KIHAGYVA: Power Ratings (P1 Szezonális Adat).`);
logData.pr_mod_h = 1.0;
         logData.pr_mod_a = 1.0;
    }
    // === JAVÍTÁS VÉGE ===


    // === ÁLTALÁNOS MÓDOSÍTÓK (MINDIG ALKALMAZVA) ===

    // Dinamikus Hazai Pálya Előny (Meccs-Specifikus -> ALKALMAZZUK)
    logData.step = 'Hazai Előny';
const baseHomeAdv = SPORT_CONFIG[sport]?.home_advantage?.home || 1.0;
    const baseAwayAdv = SPORT_CONFIG[sport]?.home_advantage?.away || 1.0;
// A P1-es adatok már tartalmazzák a hazai előnyt, de a P4-esek nem.
// Döntés: A P4-es ágban alkalmazzuk, a P1-esben nem (mivel az már "Home" és "Away" specifikus xG/xGA)
    let home_adv_mod = 1.0;
let away_adv_mod = 1.0;
    
    if (!p1_is_seasonal_avg) {
        // Ha P4 (fallback) adatot használunk, alkalmazzuk a hazai előnyt
        home_adv_mod = baseHomeAdv;
away_adv_mod = baseAwayAdv;
        logData.home_adv_source = "P4 Fallback";
    } else {
        // Ha P1 (szezonális) adatot használunk, az már tartalmazza a hazai előnyt
        logData.home_adv_source = "P1 (Beépítve)";
}
    mu_h *= home_adv_mod; mu_a *= away_adv_mod;
    logData.home_adv_mod = home_adv_mod; logData.away_adv_mod = away_adv_mod;
// Taktikai Modellezés és Formáció (csak foci) (Meccs-Specifikus -> ALKALMAZZUK)
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

    // Kosárlabda Taktika (csak kosár)
    if (sport === 'basketball' && !p1_is_seasonal_avg) { // P1 esetén feltételezzük, hogy ez már benne van
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
    }

    // Pszichológiai Faktorok (Meccs-Specifikus -> ALKALMAZZUK)
    logData.step = 'Pszichológia';
const psyMultiplier = 0.05;
    const psy_mod_h = 1 + (((psyProfileHome?.moraleIndex ?? 1) * (psyProfileHome?.pressureIndex ?? 1)) - 1) * psyMultiplier;
const psy_mod_a = 1 + (((psyProfileAway?.moraleIndex ?? 1) * (psyProfileAway?.pressureIndex ?? 1)) - 1) * psyMultiplier;
    mu_h *= psy_mod_h;
mu_a *= psy_mod_a;
    logData.psy_mod_h = psy_mod_h; logData.psy_mod_a = psy_mod_a;

    // Hiányzók Hatása (Adatvezérelt) (Meccs-Specifikus -> ALKALMAZZUK)
    logData.step = 'Hiányzók (Adatvezérelt)';
    let absentee_mod_h = 1.0;
    let absentee_mod_a = 1.0;
    // A 'rawData' a 2. Ügynöktől (Scout) érkezik, és már a "Plan A / Plan B" logikát tartalmazza
    const detailedAbsentees = rawData?.detailedPlayerStats;

    // MÓDOSÍTÁS (v63.2): Szerepkör alapú súlyozás
    if (detailedAbsentees) {
        // Hazai hiányzók hatása
        (detailedAbsentees.home_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0; 
                const role = p.role.toLowerCase();
                
                let attackPenalty = 1.0;
                let defensePenalty = 1.0;
                
                const isAttacker = role.includes('attacker') || role.includes('forward') || role.includes('támadó') || role.startsWith('f');
                const isDefender = role.includes('defender') || role.includes('védő') || role.startsWith('d') || role.startsWith('g');

                if (rating > 8.0) { 
                    attackPenalty = 0.92; defensePenalty = 1.03; 
                } else if (rating > 7.0) { 
                    attackPenalty = 0.96; defensePenalty = 1.01; 
                } else {
                    attackPenalty = 0.98; defensePenalty = 1.00;
                }
                
                if (isAttacker || !isDefender) {
                    // Ha Támadó (vagy Ismeretlen): Büntetjük a Hazai Támadást, enyhén növeljük a Vendég Védekezést
                    absentee_mod_h *= attackPenalty; 
                    absentee_mod_a *= defensePenalty; 
                } else if (isDefender) {
                    // Ha Védő: Enyhén növeljük a Hazai Támadást (csökken a védelem), Büntetjük a Vendég Támadást (jobb minőségű, ha a védő nem véd)
                    absentee_mod_h *= defensePenalty; 
                    absentee_mod_a *= attackPenalty; 
                }
            }
        });
        
        // Vendég hiányzók hatása
        (detailedAbsentees.away_absentees || []).forEach(p => {
            if (p.status === 'confirmed_out' && p.importance === 'key') {
                const rating = p.rating_last_5 || 7.0;
                const role = p.role.toLowerCase();

                let attackPenalty = 1.0;
                let defensePenalty = 1.0;
                
                const isAttacker = role.includes('attacker') || role.includes('forward') || role.includes('támadó') || role.startsWith('f');
                const isDefender = role.includes('defender') || role.includes('védő') || role.startsWith('d') || role.startsWith('g');

                if (rating > 8.0) {
                    attackPenalty = 0.92; defensePenalty = 1.03;
                } else if (rating > 7.0) {
                    attackPenalty = 0.96; defensePenalty = 1.01;
                } else {
                    attackPenalty = 0.98; defensePenalty = 1.00;
                }

                if (isAttacker || !isDefender) {
                    // Ha Támadó (vagy Ismeretlen): Büntetjük a Vendég Támadást, enyhén növeljük a Hazai Védekezést
                    absentee_mod_a *= attackPenalty; 
                    absentee_mod_h *= defensePenalty;
                } else if (isDefender) {
                    // Ha Védő: Enyhén növeljük a Vendég Támadást (csökken a védelem), Büntetjük a Hazai Támadást (jobb minőségű, ha a védő nem véd)
                    absentee_mod_a *= defensePenalty;
                    absentee_mod_h *= attackPenalty;
                }
            }
        });
    } else {
        logData.absentee_note = "Nincs 'detailedPlayerStats' adat.";
    }
    
    mu_h *= absentee_mod_h;
    mu_a *= absentee_mod_a;
    logData.abs_mod_h = absentee_mod_h; 
    logData.abs_mod_a = absentee_mod_a;
// Meccs Fontosságának Hatása (Meccs-Specifikus -> ALKALMAZZUK)
    logData.step = 'Meccs Tétje';
    const tension = rawData?.contextual_factors?.match_tension_index?.toLowerCase() || 'n/a';
let tension_mod = 1.0;
    if (tension === 'high' || tension === 'extreme') tension_mod = 1.03;
else if (tension === 'low') tension_mod = 0.98;
    else if (tension === 'friendly') tension_mod = 0.95;
    mu_h *= tension_mod;
mu_a *= tension_mod;
    logData.tension_mod = tension_mod;

    // === (v58.2) Bíró Faktor (MÓDOSÍTVA v63.2 - Eltávolítva az xG-ből) ===
    logData.step = 'Bíró Faktor';
    let referee_mod = 1.0; // Visszaállítva 1.0-ra
    const refereeStyle = rawData?.referee?.style?.toLowerCase() || 'n/a';
    
    // A bírói tényező már NEM befolyásolja az xG-t.
    // Csak a lap- és szöglet modelleknél használjuk (estimateAdvancedMetrics).
    
    mu_h *= referee_mod;
    mu_a *= referee_mod;
    logData.referee_mod = referee_mod;
    logData.referee_style_used = refereeStyle;
// === (v58.2) Edző Faktor (Meccs-Specifikus -> ALKALMAZZUK) ===
    logData.step = 'Edző Faktor';
    let coach_mod_h = 1.0;
let coach_mod_a = 1.0;
    const attackingCoaches = ['klopp', 'guardiola', 'ancelotti', 'arteta', 'xabi alonso', 'enrique'];
    const homeCoach = rawData?.contextual_factors?.coach?.home_name?.toLowerCase() || 'n/a';
const awayCoach = rawData?.contextual_factors?.coach?.away_name?.toLowerCase() || 'n/a';
    if (attackingCoaches.some(c => homeCoach.includes(c))) {
        coach_mod_h *= 1.02;
}
    if (attackingCoaches.some(c => awayCoach.includes(c))) {
        coach_mod_a *= 1.02;
}
    mu_h *= coach_mod_h;
    mu_a *= coach_mod_a;
    logData.coach_mod_h = coach_mod_h;
    logData.coach_mod_a = coach_mod_a;
// Finomított Időjárás Hatása (Strukturált Adatok Alapján) (Meccs-Specifikus -> ALKALMAZZUK)
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
} else if (sport === 'soccer' && (!weather || weather.source !== 'Open-Meteo')) { 
        console.warn(`Hiányzó strukturált időjárási adat, fallback a szöveges elemzésre.`);
const weatherText = rawData?.contextual_factors?.weather?.toLowerCase() || 'n/a';
        if (weatherText.includes("eső") || weatherText.includes("rain")) weather_mod *= 0.98;
        if (weatherText.includes("hó") || weatherText.includes("snow")) weather_mod *= 0.95;
}
    mu_h *= weather_mod;
    mu_a *= weather_mod;
    logData.weather_mod_combined = weather_mod;
// Minimum/Maximum Korlátozás
    const minVal = sport === 'basketball' ?
1783] 80 : (sport === 'hockey' ? 1.5 : 0.5);
    mu_h = Math.max(minVal, mu_h || minVal);
mu_a = Math.max(minVal, mu_a || minVal);
    const finalMaxVal = sport === 'basketball' ?
1785] 200 : (sport === 'hockey' ? 10 : 7);
    mu_h = Math.min(finalMaxVal, mu_h);
    mu_a = Math.min(finalMaxVal, mu_a);

    logData.final_mu_h = mu_h;
logData.final_mu_a = mu_a;
    logData.step = 'Végeredmény';
    
    console.log(`[Model.ts - 3. Ügynök] Súlyozott xG: H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
return { mu_h, mu_a, modifierLog: logData };
}


// === estimateAdvancedMetrics (v58.2 - Változatlan) ===
export function estimateAdvancedMetrics(rawData: ICanonicalRawData, sport: string, leagueAverages: any): { mu_corners: number, mu_cards: number } {
    const avgCorners = leagueAverages?.avg_corners ||
10.5;
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
1816] mu_corners : 10.5,
        mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ?
1817] mu_cards : 4.5
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
let ga = Math.max(0, Math.round(sampleNormal(safe_mu_a, stdDev)));
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
1841] Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, '0-0')
        : '0-0';
const [top_gh, top_ga] = topScoreKey.split('-').map(Number);
    
    return {
         pHome: toPct(home), pDraw: toPct(draw), pAway: toPct(away), pBTTS: toPct(btts),
        pOver: toPct(over_main), pUnder: 100 - toPct(over_main),
        corners: sport === 'soccer' ?
1843] {
             'o7.5': toPct(corners_o7_5), 'u7.5': 100 - toPct(corners_o7_5),
             'o8.5': toPct(corners_o8_5), 'u8.5': 100 - toPct(corners_o8_5),
             'o9.5': toPct(corners_o9_5), 'u9.5': 100 - toPct(corners_o9_5),
             'o10.5': toPct(corners_o10_5), 'u10.5': 100 - toPct(corners_o10_5),
             'o11.5': toPct(corners_o11_5), 'u11.5': 100 - toPct(corners_o11_5)
        } : 
1844] {},
        cards: sport === 'soccer' ?
1845] {
             'o3.5': toPct(cards_o3_5), 'u3.5': 100 - toPct(cards_o3_5),
             'o4.5': toPct(cards_o4_5), 'u4.5': 100 - toPct(cards_o4_5),
             'o5.5': toPct(cards_o5_5), 'u5.5': 100 - toPct(cards_o5_5),
             'o6.5': toPct(cards_o6_5), 'u6.5': 100 - toPct(cards_o6_5)
        } : {},
        scores,
        topScore: { 
1846] gh: top_gh, ga: top_ga },
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
1848] const MAX_SCORE = 10.0; const MIN_SCORE = 1.0;
    try {
        const getFormPointsPerc = (formString: string | null | undefined): number |
1849] null => {
             if (!formString || typeof formString !== 'string' || formString === "N/A") return null;
1850] const wins = (formString.match(/W/g) || []).length;
             const draws = (formString.match(/D/g) || []).length;
             const total = (formString.match(/[WDL]/g) || []).length;
1851] return total > 0 ? (wins * 3 + draws * 1) / (total * 3) : null;
        };
1852] const homeOverallFormScore = getFormPointsPerc(form?.home_overall);
        const awayOverallFormScore = getFormPointsPerc(form?.away_overall);
        if (homeOverallFormScore != null && awayOverallFormScore != null && sim && sim.pHome != null && sim.pAway != null) {
             const formDiff = homeOverallFormScore - awayOverallFormScore;
1853] const simDiff = (sim.pHome - sim.pAway) / 100;
             if ((sim.pHome > 65 && formDiff < -0.2) || (sim.pAway > 65 && formDiff > 0.2)) { score -= 1.5;
1854] }
            else if ((sim.pHome > 60 && formDiff > 0.25) || (sim.pAway > 60 && formDiff < -0.25)) { score += 0.75;
1855] }
        }
        if (sim && sim.mu_h_sim != null && sim.mu_a_sim != null) {
            const xgDiff = Math.abs(sim.mu_h_sim - sim.mu_a_sim);
1856] const thresholdHigh = sport === 'basketball' ? 15 : sport === 'hockey' ? 0.8 : 0.4;
1857] const thresholdLow = sport === 'basketball' ? 5 : sport === 'hockey' ? 0.25 : 0.15;
1858] if (xgDiff > thresholdHigh) score += 1.5;
            if (xgDiff < thresholdLow) score -= 1.0;
1859] }
        if (rawData?.h2h_structured && rawData.h2h_structured.length > 0) {
            try {
                 const latestH2HDate = new Date(rawData.h2h_structured[0].date);
1860] const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                 if (!isNaN(latestH2HDate.getTime())) {
                      if (latestH2HDate < twoYearsAgo) { score -= 0.75;
1861] }
                      else { score += 0.25;
1862] }
                 }
            } catch(e: any) { console.warn("H2H dátum parse hiba:", e.message);
1863] }
        } else { score -= 0.25;
1864] }
        const homeKeyAbsentees = rawData?.detailedPlayerStats?.home_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length ||
1865] 0;
        const awayKeyAbsentees = rawData?.detailedPlayerStats?.away_absentees?.filter(p => p.status === 'confirmed_out' && p.importance === 'key').length || 0;
1866] if (sim && sim.pHome != null && sim.pAway != null) {
            if (sim.pHome > 65 && homeKeyAbsentees > 0) { score -= (1.5 * homeKeyAbsentees);
1867] }
            if (sim.pAway > 65 && awayKeyAbsentees > 0) { score -= (1.5 * awayKeyAbsentees);
1868] }
            if (sim.pHome > 60 && awayKeyAbsentees > 0) { score += (0.75 * awayKeyAbsentees);
1869] }
            if (sim.pAway > 60 && homeKeyAbsentees > 0) { score += (0.75 * homeKeyAbsentees);
1870] }
        }
         const marketIntelLower = marketIntel?.toLowerCase() ||
1871] 'n/a';
        if (marketIntelLower !== 'n/a' && marketIntelLower !== 'nincs jelentős oddsmozgás.' && sim && sim.pHome != null && sim.pAway != null) {
            const homeFavoredBySim = sim.pHome > sim.pAway && sim.pHome > 45;
1872] const awayFavoredBySim = sim.pAway > sim.pHome && sim.pAway > 45;
            const homeNameLower = home.toLowerCase();
            const awayNameLower = away.toLowerCase();
1873] if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
1874] }
             else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('+')) { score -= 1.5;
1875] }
            else if (homeFavoredBySim && marketIntelLower.includes(homeNameLower) && marketIntelLower.includes('-')) { score += 1.0;
1876] }
            else if (awayFavoredBySim && marketIntelLower.includes(awayNameLower) && marketIntelLower.includes('-')) { score += 1.0;
1877] }
        }
         const adjustedRatings = getAdjustedRatings();
1878] const homeHistory = adjustedRatings[home.toLowerCase()];
        const awayHistory = adjustedRatings[away.toLowerCase()];
        let historyBonus = 0;
1879] if (homeHistory && homeHistory.matches > 10) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 10) historyBonus += 0.25;
1880] if (homeHistory && homeHistory.matches > 25) historyBonus += 0.25;
        if (awayHistory && awayHistory.matches > 25) historyBonus += 0.25;
1881] score += Math.min(1.0, historyBonus);
     } catch(e: any) {
        console.error(`Hiba model konfidencia számításakor (${home} vs ${away}): ${e.message}`, e.stack);
1882] return Math.max(MIN_SCORE, 4.0);
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

// === calculatePsychologicalProfile (Változatlan) ===
export function calculatePsychologicalProfile(teamName: string, opponentName: string, rawData: ICanonicalRawData | null = null): { moraleIndex: number, pressureIndex: number } {
    let moraleIndex = 1.0;
1884] let pressureIndex = 1.0;
    if (rawData) {
        const teamSide = rawData.stats.home ?
1885] 'home_overall' : 'away_overall';
        const formString = rawData.form?.[teamSide as 'home_overall' | 'away_overall'];
1886] if (formString && formString !== "N/A") {
            const recentLosses = (formString.slice(-3).match(/L/g) || []).length;
1887] const recentWins = (formString.slice(-3).match(/W/g) || []).length;
            if (recentLosses >= 2) moraleIndex *= 0.95;
            if (recentWins >= 2) moraleIndex *= 1.05;
1888] }
        const tension = rawData.contextual_factors?.match_tension_index?.toLowerCase();
        if (tension === 'high') pressureIndex *= 1.05;
1889] if (tension === 'extreme') pressureIndex *= 1.10;
        if (tension === 'low' || tension === 'friendly') pressureIndex *= 0.95;
1890] }
    moraleIndex = Math.max(0.8, Math.min(1.2, moraleIndex));
    pressureIndex = Math.max(0.8, Math.min(1.2, pressureIndex));
    return { moraleIndex, pressureIndex };
}

// === calculateValue (Változatlan - Stub) ===
export function calculateValue(sim: any, oddsData: ICanonicalOdds | null, sport: string, homeTeam: string, awayTeam: string): any[] { 
    const valueBets: any[] = [];
1892] return valueBets;
}

// === analyzeLineMovement (Változatlan - Stub) ===
export function analyzeLineMovement(currentOddsData: ICanonicalOdds | null, openingOddsData: any, sport: string, homeTeam: string): string {
    return "Nincs jelentős oddsmozgás.";
}

// === analyzePlayerDuels (Változatlan - Stub) ===
export function analyzePlayerDuels(keyPlayers: any, sport: string): string |
1894] null {
    return null;
}

// === generateProTip (Változatlan - Stub) ===
export function generateProTip(probabilities: any, odds: any, market: any): string { 
    console.warn("Figyelmeztetés: generateProTip() placeholder függvény hívva!");
1895] return "Pro Tipp generálása még nincs implementálva."; 
}
