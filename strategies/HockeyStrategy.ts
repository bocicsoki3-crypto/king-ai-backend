// FÁJL: strategies/HockeyStrategy.ts
// VERZIÓ: v139.0 (PURE AI MODE - FINAL) 🏒
//
// JAVÍTÁS (v138.0):
// 1. GOALIE IMPACT FIX: -1.20 gól helyett visszaállítva -0.60 gólra (reális kapus hatás).
// 2. POWER PLAY FIX: 1.5x szorzó helyett visszaállítva 0.5x-re (reális PP hatás).
// 3. SANITY CHECK RESTORED: Manuális xG limitálás visszakapcsolva.
//    - Ha total > 7.0 (NHL/normál liga), akkor 10%-ot vágunk.
// 4. CÉL: Megszüntetni az irreálisan magas (8-9 gólos) és kapus-túlreagált becsléseket.

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
    HOCKEY_GOALS_OU_PROMPT,
    HOCKEY_WINNER_PROMPT
} from '../AI_Service.js';

// ÚJ v128.0 + v130.1: Liga minőség + Defensive Multiplier importálása
import { 
    HOCKEY_LEAGUE_COEFFICIENTS
} from '../config_league_coefficients.js';

// ÚJ v130.1: Hockey-specific Defensive Multiplier
const HOCKEY_DEFENSIVE_MULTIPLIER: { [key: string]: number } = {
    // === NHL ===
    'nhl': 1.00,                    // Regular season (normál)
    'nhl_playoff': 0.82,            // Playoff (-18%, NAGYON defenzív!)
    'nhl playoffs': 0.82,           // Alternatív név
    
    // === EURÓPAI TOP LIGÁK ===
    'khl': 0.95,                    // Orosz KHL (-5%)
    'khl_playoff': 0.85,            // KHL Playoff (-15%)
    'russia': 0.95,
    'shl': 0.92,                    // Svéd liga (-8%, defenzív)
    'sweden': 0.92,
    'liiga': 0.90,                  // Finn liga (-10%, nagyon defenzív!)
    'finland': 0.90,
    'nla': 0.93,                    // Svájci liga (-7%)
    'switzerland': 0.93,
    
    // === KÖZEPES LIGÁK ===
    'del': 0.95,                    // Német liga (-5%)
    'germany': 0.95,
    'extraliga': 0.92,              // Cseh Extraliga (-8%)
    'czech republic': 0.92,
    'ebel': 0.94,                   // Osztrák liga (-6%)
    'austria': 0.94,
    'norway': 0.93,                 // -7%
    'denmark': 0.94,                // -6%
    
    // === GYENGE LIGÁK (DEFENZÍVEBBEK) ===
    'slovakia': 0.90,               // -10%
    'poland': 0.88,                 // -12%
    'france': 0.91,                 // -9%
    'italy': 0.91,                  // -9%
    'hungary': 0.88,                // -12%
    
    // === EGYÉB ===
    'ahl': 0.97,                    // American Hockey League (-3%)
    'japan': 0.92,                  // -8%
    
    // === DEFAULT ===
    'default_hockey': 1.00          // Normál
};

function getHockeyDefensiveMultiplier(leagueName: string | null | undefined): number {
    if (!leagueName) return HOCKEY_DEFENSIVE_MULTIPLIER['default_hockey'];
    
    const normalized = leagueName.toLowerCase().trim();
    
    // Exact match
    if (HOCKEY_DEFENSIVE_MULTIPLIER[normalized]) {
        return HOCKEY_DEFENSIVE_MULTIPLIER[normalized];
    }
    
    // Partial match
    for (const [key, value] of Object.entries(HOCKEY_DEFENSIVE_MULTIPLIER)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    return HOCKEY_DEFENSIVE_MULTIPLIER['default_hockey'];
}

/**
 * A Hoki-specifikus elemzési logikát tartalmazó stratégia.
 */
export class HockeyStrategy implements ISportStrategy {

    // ===========================================================================================
    // HELPER FÜGGVÉNYEK (v128.0 ÚJ!)
    // ===========================================================================================
    
    /**
     * Liga Coefficient Lekérés Jégkoronghoz
     * @param leagueName - Liga neve
     * @returns Jégkorong liga coefficient (0.5 - 1.0)
     */
    private getHockeyLeagueCoefficient(leagueName: string | null | undefined): number {
        if (!leagueName) return HOCKEY_LEAGUE_COEFFICIENTS['default_hockey'];
        
        const normalized = leagueName.toLowerCase().trim();
        
        // Exact match
        if (HOCKEY_LEAGUE_COEFFICIENTS[normalized]) {
            return HOCKEY_LEAGUE_COEFFICIENTS[normalized];
        }
        
        // Partial match
        for (const [key, value] of Object.entries(HOCKEY_LEAGUE_COEFFICIENTS)) {
            if (normalized.includes(key) || key.includes(normalized)) {
                return value;
            }
        }
        
        // Default fallback
        console.warn(`[HockeyStrategy v128.0] ⚠️ Ismeretlen jégkorong liga: "${leagueName}". Default (0.70) használva.`);
        return HOCKEY_LEAGUE_COEFFICIENTS['default_hockey'];
    }
    
    /**
     * HOME ADVANTAGE Számítás (Liga-függő) - v128.0
     * @param leagueCoefficient - Liga erősségi mutató (0.5 - 1.0)
     * @returns Home advantage (goals) - Minél gyengébb liga, annál nagyobb
     */
    private calculateHomeAdvantage(leagueCoefficient: number): number {
        // NHL (coeff 1.0) → 0.20 gól home advantage
        // KHL (coeff 0.85) → 0.25 gól
        // Gyenge liga (coeff 0.55) → 0.35 gól
        
        // Lineáris interpoláció: 1.0→0.20, 0.5→0.40
        const homeAdvantage = 0.60 - (leagueCoefficient * 0.40);
        
        // Korlát: 0.15 - 0.40 gól
        return Math.max(0.15, Math.min(0.40, homeAdvantage));
    }
    
    /**
     * FORMA Súlyozás (W/L rate alapján) - v128.0 JAVÍTOTT!
     * @param formString - Forma string (pl. "WLLWW")
     * @returns Multiplier (0.90 - 1.10) - ±10% max
     */
    private getFormMultiplier(formString: string | null | undefined): number {
        if (!formString || typeof formString !== 'string') return 1.0;
        
        const recentForm = formString.substring(0, 5); // Utolsó 5 meccs
        const wins = (recentForm.match(/W/g) || []).length;
        const total = recentForm.length;
        
        if (total === 0) return 1.0;
        
        const winRate = wins / total;
        
        // MAPPING (Jégkorongban a forma NAGYON SZÁMÍT, de nem annyira mint kosárlabdában):
        // 5W/5: 100% → +10% (+0.10)
        // 4W/5: 80%  → +5% (+0.05)
        // 3W/5: 60%  → 0% (semleges)
        // 2W/5: 40%  → -5% (-0.05)
        // 1W/5: 20%  → -7% (-0.07)
        // 0W/5: 0%   → -10% (-0.10)
        
        if (winRate >= 0.8) return 1.10;       // 80%+
        if (winRate >= 0.6) return 1.05;       // 60%+
        if (winRate >= 0.4) return 1.00;       // 40%+ (semleges)
        if (winRate >= 0.2) return 0.95;       // 20%+
        return 0.90;                            // <20%
    }
    
    /**
     * KULCSJÁTÉKOS HATÁS (Pozíció-alapú) - v128.0
     * @param absentees - Hiányzó játékosok listája
     * @returns xG módosítás (-0.80 - 0 goals)
     */
    private calculatePlayerImpact(absentees: any[] | undefined): number {
        if (!absentees || absentees.length === 0) return 0;
        
        let totalImpact = 0;
        
        // POZÍCIÓ-ALAPÚ HATÁS (Jégkorong):
        // Goalie (G): HATALMAS hatás → -0.40-0.60 goals (kapus = minden!)
        // Defense (D): Nagy hatás → -0.20-0.30 goals (védők kritikusak)
        // Center (C): Közepes-nagy hatás → -0.15-0.25 goals (playmaker)
        // Wing (LW/RW): Kis-közepes hatás → -0.10-0.15 goals
        
        // v138.0: GOALIE IMPACT NORMALIZÁLVA (0.60)!
        // ELŐTTE v137: 1.20 → Túl erős büntetés egy kapusért!
        // UTÁNA v138: 0.60 → Jelentős, de nem meccseldöntő önmagában.
        
        const POSITION_IMPACT_MAP: { [key: string]: number } = {
            'G': -0.60,   // Goalie (v138: 0.60 - volt: 1.20)
            'D': -0.25,   // Defense
            'C': -0.20,   // Center
            'LW': -0.12,  // Left Wing
            'RW': -0.12,  // Right Wing
            'W': -0.12    // Wing (általános)
        };
        
        for (const player of absentees) {
            const position = (player.position || player.pos || 'UNKNOWN').toUpperCase().trim();
            
            // Pozíció matching (pl. "C/RW" → "C" precedencia)
            for (const [pos, impact] of Object.entries(POSITION_IMPACT_MAP)) {
                if (position.includes(pos)) {
                    totalImpact += impact;
                    console.log(`[HockeyStrategy v128.0] Hiányzó kulcsjátékos: ${player.name || 'N/A'} (${position}) → ${impact} goals impact`);
                    break; // Csak az első match számít
                }
            }
        }
        
        // Max -0.80 goals impact (pl. ha kezdő kapus + 2 védő hiányzik)
        return Math.max(-0.80, totalImpact);
    }

    // ===========================================================================================
    // MAIN XG ESTIMATION
    // ===========================================================================================

    /**
     * 1. Ügynök (Quant) feladata: Hoki xG számítása.
     * JAVÍTVA (v124.0): Recent Form & Power Play Impact
     * JAVÍTVA (v128.0): Liga minőség, home advantage, kulcsjátékos hatás!
     */
    public estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { rawStats, leagueAverages, advancedData, form, absentees } = options;

        // === ÚJ v130.1: Liga Defensive Multiplier lekérése ===
        const leagueNameHockey = (rawStats?.home as any)?.league || advancedData?.league || null;
        const leagueDefensiveMultiplier = getHockeyDefensiveMultiplier(leagueNameHockey);
        
        console.log(`[HockeyStrategy v130.1] Liga: "${leagueNameHockey}", Defensive Multiplier: ${leagueDefensiveMultiplier.toFixed(2)}`);

        // === P1 (Manuális) Adatok Ellenőrzése + VALIDATION (v130.1 ENHANCED) ===
        if (advancedData?.manual_H_xG != null && 
            advancedData?.manual_H_xGA != null && 
            advancedData?.manual_A_xG != null && 
            advancedData?.manual_A_xGA != null) {
            
            let manual_H_xG = advancedData.manual_H_xG;
            let manual_A_xG = advancedData.manual_A_xG;
            let manual_H_xGA = advancedData.manual_H_xGA;
            let manual_A_xGA = advancedData.manual_A_xGA;

            // Tartomány validáció (1.5-5.0 goals jégkorongban)
            if (manual_H_xG < 1.5 || manual_H_xG > 5.0 || manual_A_xG < 1.5 || manual_A_xG > 5.0) {
                console.warn(`[HockeyStrategy v130.1] ⚠️ Manuális xG értékek ésszerűtlenek (H:${manual_H_xG}, A:${manual_A_xG}). Fallback P2+-ra.`);
                // Folytatjuk a P2+ logikával
            } else {
                // === ÚJ v130.1: LEAGUE DEFENSIVE MULTIPLIER ALKALMAZÁSA ===
                manual_H_xG *= leagueDefensiveMultiplier;
                manual_A_xG *= leagueDefensiveMultiplier;
                manual_H_xGA *= leagueDefensiveMultiplier;
                manual_A_xGA *= leagueDefensiveMultiplier;
                
                console.log(`[HockeyStrategy v130.1] 🛡️ DEFENSIVE MULTIPLIER APPLIED (${leagueDefensiveMultiplier.toFixed(2)}x):`);
                console.log(`  Before: H_goals=${advancedData.manual_H_xG.toFixed(2)}, A_goals=${advancedData.manual_A_xG.toFixed(2)} (Total: ${(advancedData.manual_H_xG + advancedData.manual_A_xG).toFixed(2)})`);
                console.log(`  After:  H_goals=${manual_H_xG.toFixed(2)}, A_goals=${manual_A_xG.toFixed(2)} (Total: ${(manual_H_xG + manual_A_xG).toFixed(2)})`);
                
                // === v139.0: P1 MANUAL SANITY CHECK KIKAPCSOLVA (PURE AI MODE) ===
                // Hagyjuk, hogy a manuális xG értékek szabadon működjenek, ne korrigáljuk mesterségesen.
                // Ha valóban irreális az érték, az AI és a Specialist majd kezeli.
                // const p1_mu_h_raw = (manual_H_xG + manual_A_xGA) / 2;
                // const p1_mu_a_raw = (manual_A_xG + manual_H_xGA) / 2;
                // const totalExpectedGoals = p1_mu_h_raw + p1_mu_a_raw;
                // ... sanity check logika törölve ...
                
                const p1_mu_h = (manual_H_xG + manual_A_xGA) / 2;
                const p1_mu_a = (manual_A_xG + manual_H_xGA) / 2;
                
                console.log(`[HockeyStrategy v132.0] ✅ P1 (MANUÁLIS) VÉGLEGES: mu_h=${p1_mu_h.toFixed(2)}, mu_a=${p1_mu_a.toFixed(2)}`);
                console.log(`  ↳ Original Input: H_goals=${advancedData.manual_H_xG.toFixed(2)}, A_goals=${advancedData.manual_A_xG.toFixed(2)}`);
                console.log(`  ↳ After Adjustments: H_goals=${manual_H_xG.toFixed(2)}, A_goals=${manual_A_xG.toFixed(2)}`);
                
                return {
                    pure_mu_h: p1_mu_h,
                    pure_mu_a: p1_mu_a,
                    source: `Manual (Defensive Adjusted ${leagueDefensiveMultiplier.toFixed(2)}x) [v130.1]`
                };
            }
        }
        
        // === P2+ (Alap Statisztika) Fallback - FEJLESZTVE v128.0 ===
        
        // === ÚJ v128.0: LIGA MINŐSÉG COEFFICIENT ===
        const leagueNameHome = advancedData?.league_home || advancedData?.league || null;
        const leagueNameAway = advancedData?.league_away || advancedData?.league || null;
        const leagueCoefficientHome = this.getHockeyLeagueCoefficient(leagueNameHome);
        const leagueCoefficientAway = this.getHockeyLeagueCoefficient(leagueNameAway);
        
        // Ha különböző ligák, átlagoljuk (pl. nemzetközi kupák esetén)
        const avgLeagueCoeff = (leagueCoefficientHome + leagueCoefficientAway) / 2;
        console.log(`[HockeyStrategy v128.0] Liga coefficients: Home=${leagueCoefficientHome.toFixed(2)}, Away=${leagueCoefficientAway.toFixed(2)}, Avg=${avgLeagueCoeff.toFixed(2)}`);
        // ================================================
        
        let avg_h_gf = rawStats.home?.gf != null ? (rawStats.home.gf / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_gf || 3.1);
        let avg_a_gf = rawStats.away?.gf != null ? (rawStats.away.gf / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_gf || 2.9);
        let avg_h_ga = rawStats.home?.ga != null ? (rawStats.home.ga / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_ga || 2.9);
        let avg_a_ga = rawStats.away?.ga != null ? (rawStats.away.ga / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_ga || 3.1);

        // === JAVÍTOTT v128.0: FORMA SÚLYOZÁS (most már helper függvényt használunk) ===
        const homeFormMult = this.getFormMultiplier(form?.home_overall);
        const awayFormMult = this.getFormMultiplier(form?.away_overall);
        
        avg_h_gf *= homeFormMult;
        avg_a_gf *= awayFormMult;
        
        console.log(`[HockeyStrategy v128.0] Forma multipliers: Home=${homeFormMult.toFixed(3)}, Away=${awayFormMult.toFixed(3)}`);
        // ================================================
        
        // === v124.0: POWER PLAY / GOALIE IMPACT (MEGTARTVA) ===
        // Ha van PP% vagy GSAx adat, azt is figyelembe vesszük
        if (advancedData?.home_pp_percent && advancedData?.away_pp_percent) {
            const leagueAvgPP = 0.20; // Liga átlag ~20% PP sikerség
            // v138.0: POWER PLAY NORMALIZÁLVA (0.5x)!
            // ELŐTTE v137: 1.5x → Túl erős!
            // UTÁNA v138: 0.5x → Reális.
            
            const homePPBonus = (advancedData.home_pp_percent - leagueAvgPP) * 0.5; // v138.0: 1.5 → 0.5
            const awayPPBonus = (advancedData.away_pp_percent - leagueAvgPP) * 0.5;
            
            avg_h_gf += homePPBonus;
            avg_a_gf += awayPPBonus;
            
            console.log(`[HockeyStrategy v138.0] ⚡ POWER PLAY NORMALIZÁLVA 0.5x! Home=${homePPBonus.toFixed(3)}, Away=${awayPPBonus.toFixed(3)}`);
        }

        // === ÚJ v128.0: LIGA-FÜGGŐ HOME ADVANTAGE ===
        const HOME_ADVANTAGE = this.calculateHomeAdvantage(avgLeagueCoeff);
        console.log(`[HockeyStrategy v128.0] HOME ADVANTAGE: ${HOME_ADVANTAGE.toFixed(2)} goals (liga-alapú)`);
        // ================================================

        let pure_mu_h = (avg_h_gf + avg_a_ga) / 2 + (HOME_ADVANTAGE / 2);
        let pure_mu_a = (avg_a_gf + avg_h_ga) / 2 - (HOME_ADVANTAGE / 2);
        
        // === ÚJ v128.0: KULCSJÁTÉKOS HATÁS ===
        const homePlayerImpact = this.calculatePlayerImpact(absentees?.home);
        const awayPlayerImpact = this.calculatePlayerImpact(absentees?.away);
        
        pure_mu_h += homePlayerImpact;
        pure_mu_a += awayPlayerImpact;
        
        console.log(`[HockeyStrategy v128.0] Kulcsjátékos hatás: Home=${homePlayerImpact.toFixed(2)} goals, Away=${awayPlayerImpact.toFixed(2)} goals`);
        // ================================================
        
        // Biztonsági korlátok (NHL-ben nagyon ritka a 7+ gól)
        pure_mu_h = Math.max(1.5, Math.min(5.0, pure_mu_h));
        pure_mu_a = Math.max(1.5, Math.min(5.0, pure_mu_a));
        
        console.log(`[HockeyStrategy v128.0] ✅ FINAL xG: mu_h=${pure_mu_h.toFixed(2)}, mu_a=${pure_mu_a.toFixed(2)}`);
        
        return {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            source: "Calculated (Stats + Form + League + Players) [v128.0]"
        };
    }

    /**
     * Kiszámítja a másodlagos piacokat (hokinál nincs).
     */
    public estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        // Hoki esetében ezek a metrikák nem relevánsak
        return {
            mu_corners: 0,
            mu_cards: 0
        };
    }

    /**
     * 5-6. Ügynök (Hybrid Boss) feladata: Hoki-specifikus AI mikromodellek futtatása.
     * MÓDOSÍTVA (v105.0): Most már fogadja és továbbadja a 'confidenceScores'-t.
     * MÓDOSÍTVA (v107.0): GSAx Fallback.
     * MÓDOSÍTVA (v107.1): Kontextuális Vonal Elemzés (Alternate Lines) az AI számára.
     */
    public async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        console.log("[HockeyStrategy] runMicroModels: Valódi hoki AI modellek futtatása...");
        
        const { sim, rawDataJson, mainTotalsLine, confidenceScores } = options; // v105.0
        const safeSim = sim || {};
        const safeRawData = rawDataJson || {};

        // === v105.0: Bizalmi adatok előkészítése ===
        const confidenceData = {
            confidenceWinner: confidenceScores.winner.toFixed(1),
            confidenceTotals: confidenceScores.totals.toFixed(1)
        };
        // ==========================================

        // === JAVÍTÁS (v107.0): GSAx Fallback Logika ===
        const getGoalieStat = (players: any[] | undefined) => {
            if (!players) return "Adat nem elérhető";
            const goalie = players.find((p: any) => p.position === 'G' || p.pos === 'G');
            if (!goalie) return "Kezdő kapus ismeretlen";
            
            // Ha van rating, azt használjuk, ha nincs, de van 'rating_last_5', akkor azt.
            if (goalie.rating && goalie.rating !== "N/A") return `Rating: ${goalie.rating}`;
            if (goalie.rating_last_5) return `Form: ${goalie.rating_last_5}/10`;
            
            return "Átlagos (Nincs részletes adat)";
        };

        const homeGoalieInfo = getGoalieStat(safeRawData.key_players?.home);
        const awayGoalieInfo = getGoalieStat(safeRawData.key_players?.away);
        // === JAVÍTÁS VÉGE ===

        // === ÚJ (v107.1): Alternatív Vonal Kontextus ===
        // Ha a fővonal 6.5, kiszámoljuk, mit mondana a szimulátor 5.5-re és 6.0-ra is.
        // Ezt beleírjuk a promptba, hogy az AI lássa a különbséget.
        const getAltLineProb = (line: number): string => {
            // Mivel a 'sim' objektum nem tartalmazza az összes lehetséges vonalat előre kiszámolva
            // (csak a fix mainTotalsLine-t), itt csak becslést tudunk adni, vagy
            // a 'sim.scores' eloszlásból kellene újra számolni (ami itt nem elérhető).
            // Ezért egyszerű szöveges figyelmeztetést adunk át.
            return `(Check alt line: ${line})`; 
        };

        const mainLineStr = `${mainTotalsLine}`;
        const lowerLineStr = `${mainTotalsLine - 0.5}`;
        
        // Kibővítjük a 'goalsData'-t, hogy az AI tudjon a bizonytalanságról
        const goalsData = {
            ...confidenceData, // v105.0
            line: `${mainLineStr} (Figyelem: A piac ingadozhat ${lowerLineStr} és ${mainLineStr} között)`,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim || 0) + (safeSim.mu_a_sim || 0),
            home_gsax: homeGoalieInfo,
            away_gsax: awayGoalieInfo,
        };
        // ================================================

        const winnerData = {
            ...confidenceData, // v105.0
            sim_pHome: safeSim.pHome,
            sim_pAway: safeSim.pAway,
            home_gsax: homeGoalieInfo,
            away_gsax: awayGoalieInfo,
            form_home: safeRawData.form?.home_overall || "N/A",
            form_away: safeRawData.form?.away_overall || "N/A",
        };

        // Modellek párhuzamos futtatása
        const results = await Promise.allSettled([
            getAndParse(HOCKEY_GOALS_OU_PROMPT, goalsData, "hockey_goals_ou_analysis", "Hockey.Goals"),
            getAndParse(HOCKEY_WINNER_PROMPT, winnerData, "hockey_winner_analysis", "Hockey.Winner")
        ]);

        // Eredmények összegyűjtése (hibatűréssel)
        const microAnalyses: { [key: string]: string } = {};

        microAnalyses['hockey_goals_ou_analysis'] = (results[0].status === 'fulfilled') 
            ? results[0].value 
            : `AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
            
        microAnalyses['hockey_winner_analysis'] = (results[1].status === 'fulfilled') 
            ? results[1].value 
            : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;

        return microAnalyses;
    }
}
