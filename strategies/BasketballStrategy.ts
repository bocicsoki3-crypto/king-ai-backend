// FÁJL: strategies/BasketballStrategy.ts
// VERZIÓ: v130.1 (DEFENSIVE MULTIPLIER + SANITY CHECK - BASKETBALL) 🏀
// MÓDOSÍTÁS (v130.1):
// 1. ÚJ: LEAGUE DEFENSIVE MULTIPLIER! (NBA Playoff -8%, Euroleague -10%)
// 2. ÚJ: P1 MANUAL SANITY CHECK! (túl optimista inputok detektálása)
// 3. EREDMÉNY: Reális Over/Under tippek playoff meccseken! ✅
//
// Korábbi módosítás (v128.0):
// - P1 Manual Validation (80-140 pts)
// - Forma Súlyozás
// - Liga-függő HOME_ADVANTAGE
// - Kulcsjátékos pozíció-alapú hatás
// - Pace Factor
// 
// KORÁBBI MÓDOSÍTÁS (v124.0):
// 1. ÚJ: Pace Factor beépítés (possessions/game alapján ±20% pontszám módosítás)
// 2. ÚJ: Style-based fallback ('Fast'/'Slow' taktikák ±5% hatással)
// 3. EREDMÉNY: Pontosabb total points becslés gyors/lassú játékstílusok esetén

import type { 
    ISportStrategy, 
    XGOptions, 
    AdvancedMetricsOptions, 
    MicroModelOptions 
} from './ISportStrategy.js';

// Kanonikus típusok importálása
import type { ICanonicalRawData } from '../src/types/canonical.d.ts';

// AI segédfüggvények és promptok importálása
import {
    getAndParse,
    BASKETBALL_WINNER_PROMPT,
    BASKETBALL_TOTAL_POINTS_PROMPT
} from '../AI_Service.js';

// ÚJ v128.0 + v130.1: Liga minőség + Defensive Multiplier importálása
import { 
    BASKETBALL_LEAGUE_COEFFICIENTS, 
    getLeagueCoefficient as getSoccerLeagueCoeff // átnevezés, hogy ne ütközzön
} from '../config_league_coefficients.js';

// ÚJ v130.1: Basketball-specific Defensive Multiplier
const BASKETBALL_DEFENSIVE_MULTIPLIER: { [key: string]: number } = {
    // === NBA ===
    'nba': 1.00,                    // Regular season (normál)
    'nba_playoff': 0.92,            // Playoff (-8%, defenzívebb!)
    'nba playoffs': 0.92,           // Alternatív név
    
    // === EURÓPAI TOP LIGÁK ===
    'euroleague': 0.90,             // -10% (nagyon defenzív!)
    'euroleague_playoff': 0.85,     // -15% (ultra defenzív!)
    'acb': 0.93,                    // Spanyol liga (-7%, defenzív kultúra)
    'spain': 0.93,
    'bbl': 0.95,                    // Német liga (-5%)
    'germany': 0.95,
    'lega basket': 0.92,            // Olasz liga (-8%)
    'italy': 0.92,
    
    // === KÖZEPES LIGÁK ===
    'turkish super league': 0.94,   // Török liga (-6%)
    'turkey': 0.94,
    'france': 0.95,                 // Francia liga (-5%)
    'greece': 0.93,                 // Görög liga (-7%, defenzív)
    'israel': 0.96,                 // -4%
    'poland': 0.96,                 // -4%
    
    // === GYENGE LIGÁK (DEFENZÍVEBBEK) ===
    'czech republic': 0.92,         // -8%
    'hungary': 0.90,                // -10%
    'romania': 0.88,                // -12%
    'bulgaria': 0.88,               // -12%
    
    // === EGYÉB NAGY LIGÁK (TÁMADÓBBAK!) ===
    'cba': 1.05,                    // Kínai liga (+5%, sok pont!)
    'china': 1.05,
    'b.league': 1.03,               // Japán (+3%)
    'japan': 1.03,
    'kbl': 1.02,                    // Koreai liga (+2%)
    'south korea': 1.02,
    'australia': 1.04,              // NBL (+4%, támadó)
    
    // === DEFAULT ===
    'default_basketball': 1.00      // Normál
};

function getBasketballDefensiveMultiplier(leagueName: string | null | undefined): number {
    if (!leagueName) return BASKETBALL_DEFENSIVE_MULTIPLIER['default_basketball'];
    
    const normalized = leagueName.toLowerCase().trim();
    
    // Exact match
    if (BASKETBALL_DEFENSIVE_MULTIPLIER[normalized]) {
        return BASKETBALL_DEFENSIVE_MULTIPLIER[normalized];
    }
    
    // Partial match
    for (const [key, value] of Object.entries(BASKETBALL_DEFENSIVE_MULTIPLIER)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    return BASKETBALL_DEFENSIVE_MULTIPLIER['default_basketball'];
}

/**
 * A Kosárlabda-specifikus elemzési logikát tartalmazó stratégia.
 */
export class BasketballStrategy implements ISportStrategy {

    // ===========================================================================================
    // HELPER FÜGGVÉNYEK (v128.0 ÚJ!)
    // ===========================================================================================
    
    /**
     * Liga Coefficient Lekérés Kosárlabdához
     * @param leagueName - Liga neve
     * @returns Kosárlabda liga coefficient (0.5 - 1.0)
     */
    private getBasketballLeagueCoefficient(leagueName: string | null | undefined): number {
        if (!leagueName) return BASKETBALL_LEAGUE_COEFFICIENTS['default_basketball'];
        
        const normalized = leagueName.toLowerCase().trim();
        
        // Exact match
        if (BASKETBALL_LEAGUE_COEFFICIENTS[normalized]) {
            return BASKETBALL_LEAGUE_COEFFICIENTS[normalized];
        }
        
        // Partial match
        for (const [key, value] of Object.entries(BASKETBALL_LEAGUE_COEFFICIENTS)) {
            if (normalized.includes(key) || key.includes(normalized)) {
                return value;
            }
        }
        
        // Default fallback
        console.warn(`[BasketballStrategy v128.0] ⚠️ Ismeretlen kosárlabda liga: "${leagueName}". Default (0.70) használva.`);
        return BASKETBALL_LEAGUE_COEFFICIENTS['default_basketball'];
    }
    
    /**
     * HOME ADVANTAGE Számítás (Liga-függő) - v128.0
     * @param leagueCoefficient - Liga erősségi mutató (0.5 - 1.0)
     * @returns Home advantage (pts) - Minél gyengébb liga, annál nagyobb
     */
    private calculateHomeAdvantage(leagueCoefficient: number): number {
        // NBA (coeff 1.0) → 2.0 pont home advantage
        // Euroleague (coeff 0.92) → 2.5 pont
        // Gyenge liga (coeff 0.55) → 3.5+ pont
        
        // Lineáris interpoláció: 1.0→2.0, 0.5→4.0
        const homeAdvantage = 6.0 - (leagueCoefficient * 4.0);
        
        // Korlát: 2.0 - 4.5 pont
        return Math.max(2.0, Math.min(4.5, homeAdvantage));
    }
    
    /**
     * FORMA Súlyozás (W/L rate alapján) - v128.0
     * @param formString - Forma string (pl. "WLLWW")
     * @returns Multiplier (0.92 - 1.08) - ±8% max
     */
    private estimateFormMultiplier(formString: string | null | undefined): number {
        if (!formString || typeof formString !== 'string') return 1.0;
        
        const recentForm = formString.substring(0, 5); // Utolsó 5 meccs
        const wins = (recentForm.match(/W/g) || []).length;
        const total = recentForm.length;
        
        if (total === 0) return 1.0;
        
        const winRate = wins / total;
        
        // MAPPING (Kosárlabdában a forma NAGYON SZÁMÍT!):
        // 5W/5: 100% → +8% (+0.08)
        // 4W/5: 80%  → +5% (+0.05)
        // 3W/5: 60%  → +2% (+0.02)
        // 2W/5: 40%  → -2% (-0.02)
        // 1W/5: 20%  → -5% (-0.05)
        // 0W/5: 0%   → -8% (-0.08)
        
        if (winRate === 1.0) return 1.08;      // 100%
        if (winRate >= 0.8) return 1.05;       // 80%+
        if (winRate >= 0.6) return 1.02;       // 60%+
        if (winRate >= 0.4) return 0.98;       // 40%+
        if (winRate >= 0.2) return 0.95;       // 20%+
        return 0.92;                            // 0%
    }
    
    /**
     * KULCSJÁTÉKOS HATÁS (Pozíció-alapú) - v128.0
     * @param absentees - Hiányzó játékosok listája
     * @returns Pontszám módosítás (-15 - 0 pts)
     */
    private calculatePlayerImpact(absentees: any[] | undefined): number {
        if (!absentees || absentees.length === 0) return 0;
        
        let totalImpact = 0;
        
        // POZÍCIÓ-ALAPÚ HATÁS (Kosárlabda):
        // Center (C): Legnagyobb hatás → -10-15 pts (dominanciájuk óriási!)
        // Power Forward (PF): Közepes hatás → -6-10 pts
        // Small Forward (SF): Közepes hatás → -5-8 pts
        // Shooting Guard (SG): Kis hatás → -4-7 pts
        // Point Guard (PG): Közepes-nagy hatás → -6-10 pts (playmaker!)
        
        const POSITION_IMPACT_MAP: { [key: string]: number } = {
            'C': -12.0,   // Center
            'PF': -8.0,   // Power Forward
            'SF': -6.5,   // Small Forward
            'PG': -8.0,   // Point Guard
            'SG': -5.5,   // Shooting Guard
            'F': -7.0,    // Forward (általános)
            'G': -6.0     // Guard (általános)
        };
        
        for (const player of absentees) {
            const position = (player.position || player.pos || 'UNKNOWN').toUpperCase().trim();
            
            // Pozíció matching (pl. "PG/SG" → "PG" precedencia)
            for (const [pos, impact] of Object.entries(POSITION_IMPACT_MAP)) {
                if (position.includes(pos)) {
                    totalImpact += impact;
                    console.log(`[BasketballStrategy v128.0] Hiányzó kulcsjátékos: ${player.name || 'N/A'} (${position}) → ${impact} pts impact`);
                    break; // Csak az első match számít
                }
            }
        }
        
        // Max -25 pts impact (pl. ha 2 szupersztár hiányzik)
        return Math.max(-25, totalImpact);
    }

    // ===========================================================================================
    // MAIN XG ESTIMATION
    // ===========================================================================================
    
    /**
     * 1. Ügynök (Quant) feladata: Pontok becslése kosárlabdához.
     * FEJLESZTVE (v130.1): League Defensive Multiplier + Sanity Check!
     */
    public estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { rawStats, leagueAverages, advancedData, form, absentees } = options;

        // === ÚJ v130.1: Liga Defensive Multiplier lekérése ===
        const leagueNameBasket = (rawStats?.home as any)?.league || advancedData?.league || null;
        const leagueDefensiveMultiplier = getBasketballDefensiveMultiplier(leagueNameBasket);
        
        console.log(`[BasketballStrategy v130.1] Liga: "${leagueNameBasket}", Defensive Multiplier: ${leagueDefensiveMultiplier.toFixed(2)}`);

        // === P1 (Manuális) Adatok Ellenőrzése + VALIDATION (v130.1 ENHANCED) ===
        if (advancedData?.manual_H_xG != null && 
            advancedData?.manual_H_xGA != null && 
            advancedData?.manual_A_xG != null && 
            advancedData?.manual_A_xGA != null) {
            
            let manual_H_xG = advancedData.manual_H_xG;
            let manual_A_xG = advancedData.manual_A_xG;
            let manual_H_xGA = advancedData.manual_H_xGA;
            let manual_A_xGA = advancedData.manual_A_xGA;

            // Tartomány validáció (80-140 pts kosárlabdában)
            if (manual_H_xG < 80 || manual_H_xG > 140 || manual_A_xG < 80 || manual_A_xG > 140) {
                console.warn(`[BasketballStrategy v130.1] ⚠️ Manuális xG értékek ésszerűtlenek (H:${manual_H_xG}, A:${manual_A_xG}). Fallback P2+-ra.`);
                // Folytatjuk a P2+ logikával
            } else {
                // === ÚJ v130.1: LEAGUE DEFENSIVE MULTIPLIER ALKALMAZÁSA ===
                manual_H_xG *= leagueDefensiveMultiplier;
                manual_A_xG *= leagueDefensiveMultiplier;
                manual_H_xGA *= leagueDefensiveMultiplier;
                manual_A_xGA *= leagueDefensiveMultiplier;
                
                console.log(`[BasketballStrategy v130.1] 🛡️ DEFENSIVE MULTIPLIER APPLIED (${leagueDefensiveMultiplier.toFixed(2)}x):`);
                console.log(`  Before: H_pts=${advancedData.manual_H_xG.toFixed(1)}, A_pts=${advancedData.manual_A_xG.toFixed(1)} (Total: ${(advancedData.manual_H_xG + advancedData.manual_A_xG).toFixed(1)})`);
                console.log(`  After:  H_pts=${manual_H_xG.toFixed(1)}, A_pts=${manual_A_xG.toFixed(1)} (Total: ${(manual_H_xG + manual_A_xG).toFixed(1)})`);
                
                // === v136.0: P1 MANUAL SANITY CHECK **KIKAPCSOLVA** ===
                // PISTONS-HEAT TANULSÁG: Valós eredmény 273 pont volt, de a sanity check 240-re limitálta!
                // Ez túl konzervatív - az AI/manuális xG-re BÍZUNK!
                // KIKAPCSOLVA v136.0 - Nincs többé sanity cap!
                
                // const p1_mu_h_raw = (manual_H_xG + manual_A_xGA) / 2;
                // const p1_mu_a_raw = (manual_A_xG + manual_H_xGA) / 2;
                // const totalExpectedPoints = p1_mu_h_raw + p1_mu_a_raw;
                // 
                // if (false && totalExpectedPoints > 999) { // KIKAPCSOLVA!
                //     // Sanity check eltávolítva - Trust the data!
                // }
                
                console.log(`[BasketballStrategy v136.0] ✅ P1 SANITY CHECK KIKAPCSOLVA - Full trust in manual xG!`);
                
                const p1_mu_h = (manual_H_xG + manual_A_xGA) / 2;
                const p1_mu_a = (manual_A_xG + manual_H_xGA) / 2;
                
                console.log(`[BasketballStrategy v132.0] ✅ P1 (MANUÁLIS) VÉGLEGES: mu_h=${p1_mu_h.toFixed(1)}, mu_a=${p1_mu_a.toFixed(1)}`);
                console.log(`  ↳ Original Input: H_pts=${advancedData.manual_H_xG.toFixed(1)}, A_pts=${advancedData.manual_A_xG.toFixed(1)}`);
                console.log(`  ↳ After Adjustments: H_pts=${manual_H_xG.toFixed(1)}, A_pts=${manual_A_xG.toFixed(1)}`);
                
                return {
                    pure_mu_h: p1_mu_h,
                    pure_mu_a: p1_mu_a,
                    source: `Manual (Defensive Adjusted ${leagueDefensiveMultiplier.toFixed(2)}x) [v130.1]`
                };
            }
        }
        
        // === P2+ (Automatikus) Becslés - FEJLESZTVE v128.0 ===
        // Ha nincsenek P1 adatok, a csapatok átlagos pontszámaiból számolunk.
        // Formula: (Hazai Támadás + Vendég Védekezés) / 2  és fordítva.
        
        // Alapértelmezett liga átlag (ha minden adat hiányzik)
        const leagueAvgPoints = 112.0; // NBA átlag közelebb van a 112-115-höz manapság
        const leagueAvgPossessions = 98.0; // NBA átlag possessions/game

        // === ÚJ v128.0: LIGA MINŐSÉG COEFFICIENT ===
        const leagueNameHome = advancedData?.league_home || advancedData?.league || null;
        const leagueNameAway = advancedData?.league_away || advancedData?.league || null;
        const leagueCoefficientHome = this.getBasketballLeagueCoefficient(leagueNameHome);
        const leagueCoefficientAway = this.getBasketballLeagueCoefficient(leagueNameAway);
        
        // Ha különböző ligák, átlagoljuk (pl. nemzetközi kupák esetén)
        const avgLeagueCoeff = (leagueCoefficientHome + leagueCoefficientAway) / 2;
        console.log(`[BasketballStrategy v128.0] Liga coefficients: Home=${leagueCoefficientHome.toFixed(2)}, Away=${leagueCoefficientAway.toFixed(2)}, Avg=${avgLeagueCoeff.toFixed(2)}`);
        // ================================================

        // Biztonságos adatkinyerés (ha 0 vagy null, akkor liga átlag)
        let h_scored = (rawStats.home.gf && rawStats.home.gp) ? (rawStats.home.gf / rawStats.home.gp) : leagueAvgPoints;
        let h_conceded = (rawStats.home.ga && rawStats.home.gp) ? (rawStats.home.ga / rawStats.home.gp) : leagueAvgPoints;
        
        let a_scored = (rawStats.away.gf && rawStats.away.gp) ? (rawStats.away.gf / rawStats.away.gp) : leagueAvgPoints;
        let a_conceded = (rawStats.away.ga && rawStats.away.gp) ? (rawStats.away.ga / rawStats.away.gp) : leagueAvgPoints;
        
        // === ÚJ v128.0: FORMA SÚLYOZÁS ===
        const homeFormMult = this.estimateFormMultiplier(form?.home_overall);
        const awayFormMult = this.estimateFormMultiplier(form?.away_overall);
        
        h_scored *= homeFormMult;
        a_scored *= awayFormMult;
        
        console.log(`[BasketballStrategy v128.0] Forma multipliers: Home=${homeFormMult.toFixed(3)}, Away=${awayFormMult.toFixed(3)}`);
        // ================================================

        // === v124.0: PACE FACTOR BEÉPÍTÉS (MEGTARTVA) ===
        // Ha van advancedData-ban pace (possessions/game), azt figyelembe vesszük
        // Gyorsabb pace → több pontszám, lassabb pace → kevesebb
        let homePaceFactor = 1.0;
        let awayPaceFactor = 1.0;
        
        if (advancedData?.home_pace && advancedData?.away_pace) {
            const homePace = advancedData.home_pace;
            const awayPace = advancedData.away_pace;
            
            // Várható meccs pace = átlaga a két csapat pace-ének
            const expectedMatchPace = (homePace + awayPace) / 2;
            const paceDeviation = (expectedMatchPace / leagueAvgPossessions) - 1.0;
            
            // Ha +10% pace → ~+8-10% pontszám
            // === v137.0: PACE FACTOR 2.5x ERŐSÍTVE! PISTONS-HEAT TANULSÁG! ===
            const paceMultiplier = Math.abs(paceDeviation) > 0.05 ? 3.0 : 2.0;
            homePaceFactor = 1.0 + (paceDeviation * paceMultiplier);
            awayPaceFactor = 1.0 + (paceDeviation * paceMultiplier);
            
            console.log(`[BasketballStrategy v137.0] 🚀 PACE ERŐSÍTVE ${paceMultiplier}x! H_Pace=${homePace}, A_Pace=${awayPace}, Match_Pace=${expectedMatchPace.toFixed(1)}, Multiplier=${homePaceFactor.toFixed(3)}`);
        } else if (advancedData?.tactics?.home?.style || advancedData?.tactics?.away?.style) {
            // Fallback: ha nincs pontos pace, de van style (pl. "Fast", "Slow")
            const homeStyle = (advancedData?.tactics?.home?.style || "").toLowerCase();
            const awayStyle = (advancedData?.tactics?.away?.style || "").toLowerCase();
            
            if (homeStyle.includes('fast') || awayStyle.includes('fast')) {
                homePaceFactor = 1.05;
                awayPaceFactor = 1.05;
            } else if (homeStyle.includes('slow') || awayStyle.includes('slow')) {
                homePaceFactor = 0.95;
                awayPaceFactor = 0.95;
            }
        }
        
        h_scored *= homePaceFactor;
        a_scored *= awayPaceFactor;
        h_conceded *= homePaceFactor;
        a_conceded *= awayPaceFactor;
        // === PACE FACTOR VÉGE ===

        // === ÚJ v128.0: LIGA-FÜGGŐ HOME ADVANTAGE ===
        const HOME_ADVANTAGE = this.calculateHomeAdvantage(avgLeagueCoeff);
        console.log(`[BasketballStrategy v128.0] HOME ADVANTAGE: ${HOME_ADVANTAGE.toFixed(1)} pts (liga-alapú)`);
        // ================================================

        // Súlyozott számítás
        // Hazai várható pont = (Hazai szerzett átlag + Vendég kapott átlag) / 2
        let est_mu_h = (h_scored + a_conceded) / 2 + (HOME_ADVANTAGE / 2);
        let est_mu_a = (a_scored + h_conceded) / 2 - (HOME_ADVANTAGE / 2);
        
        // === ÚJ v128.0: KULCSJÁTÉKOS HATÁS ===
        const homePlayerImpact = this.calculatePlayerImpact(absentees?.home);
        const awayPlayerImpact = this.calculatePlayerImpact(absentees?.away);
        
        est_mu_h += homePlayerImpact;
        est_mu_a += awayPlayerImpact;
        
        console.log(`[BasketballStrategy v128.0] Kulcsjátékos hatás: Home=${homePlayerImpact.toFixed(1)} pts, Away=${awayPlayerImpact.toFixed(1)} pts`);
        // ================================================

        // Értékek "normalizálása" (hogy ne legyenek extrém kiugrók hibás adat esetén)
        est_mu_h = Math.max(80, Math.min(140, est_mu_h));
        est_mu_a = Math.max(80, Math.min(140, est_mu_a));

        console.log(`[BasketballStrategy v128.0] ✅ FINAL xG: mu_h=${est_mu_h.toFixed(1)}, mu_a=${est_mu_a.toFixed(1)}`);

        return {
            pure_mu_h: Number(est_mu_h.toFixed(1)),
            pure_mu_a: Number(est_mu_a.toFixed(1)),
            source: "Calculated (Avg Pts + Form + League + Players) [v128.0]"
        };
    }

    /**
     * Kiszámítja a másodlagos piacokat (kosárnál nincs).
     */
    public estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        // Kosárlabda esetében ezek a metrikák nem relevánsak
        return {
            mu_corners: 0,
            mu_cards: 0
        };
    }

    /**
     * 5-6. Ügynök (Hybrid Boss) feladata: Kosár-specifikus AI mikromodellek futtatása.
     * MÓDOSÍTVA (v105.0): Most már fogadja és továbbadja a 'confidenceScores'-t.
     */
    public async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        console.log("[BasketballStrategy] runMicroModels: Valódi kosárlabda AI modellek futtatása...");

        const { sim, rawDataJson, mainTotalsLine, confidenceScores } = options; // v105.0
        const safeSim = sim || {};
        const safeRawData = rawDataJson || {};
        
        // === v105.0: Bizalmi adatok előkészítése ===
        const confidenceData = {
            confidenceWinner: confidenceScores.winner.toFixed(1),
            confidenceTotals: confidenceScores.totals.toFixed(1)
        };
        // ==========================================

        // Adatok előkészítése a promptokhoz
        const winnerData = {
            ...confidenceData, // v105.0
            sim_pHome: safeSim.pHome, 
            sim_pAway: safeSim.pAway,
            form_home: safeRawData.form?.home_overall || "N/A",
            form_away: safeRawData.form?.away_overall || "N/A",
            absentees_home_count: safeRawData.absentees?.home?.length || 0,
            absentees_away_count: safeRawData.absentees?.away?.length || 0,
        };

        const totalsData = {
            ...confidenceData, // v105.0
            line: mainTotalsLine,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim || 0) + (safeSim.mu_a_sim || 0),
            home_pace: safeRawData.tactics?.home?.style || "N/A",
            away_pace: safeRawData.tactics?.away?.style || "N/A",
            absentees_home_count: safeRawData.absentees?.home?.length || 0,
            absentees_away_count: safeRawData.absentees?.away?.length || 0,
        };

        // Modellek párhuzamos futtatása
        const results = await Promise.allSettled([
            getAndParse(BASKETBALL_WINNER_PROMPT, winnerData, "basketball_winner_analysis", "Bask.Winner"),
            getAndParse(BASKETBALL_TOTAL_POINTS_PROMPT, totalsData, "basketball_total_points_analysis", "Bask.Totals")
        ]);

        // Eredmények összegyűjtése (hibatűréssel)
        const microAnalyses: { [key: string]: string } = {};

        microAnalyses['basketball_winner_analysis'] = (results[0].status === 'fulfilled') 
            ? results[0].value 
            : `AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
            
        microAnalyses['basketball_total_points_analysis'] = (results[1].status === 'fulfilled') 
            ? results[1].value 
            : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;

        return microAnalyses;
    }
}
