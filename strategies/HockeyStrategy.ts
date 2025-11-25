// FÁJL: strategies/HockeyStrategy.ts
// VERZIÓ: v124.0 (Recent Form & Power Play Impact)
// MÓDOSÍTÁS (v124.0):
// 1. ÚJ: Recent Form súlyozás (utolsó 5 meccs alapján ±10% xG módosítás)
// 2. ÚJ: Power Play hatás (ha elérhető PP% → ±0.05 gól/meccs módosítás)
// 3. ÚJ: Biztonsági korlátok (1.5-5.0 gól/meccs tartomány)
// 4. EREDMÉNY: Pontosabb xG becslés momentum és specialista egységek alapján

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

/**
 * A Hoki-specifikus elemzési logikát tartalmazó stratégia.
 */
export class HockeyStrategy implements ISportStrategy {

    /**
     * 1. Ügynök (Quant) feladata: Hoki xG számítása.
     * (Változatlan v104.2)
     */
    public estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { rawStats, leagueAverages, advancedData } = options;

        // === P1 (Manuális) Adatok Ellenőrzése ===
        if (advancedData?.manual_H_xG != null && 
            advancedData?.manual_H_xGA != null && 
            advancedData?.manual_A_xG != null && 
            advancedData?.manual_A_xGA != null) {
            
            const p1_mu_h = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
            const p1_mu_a = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;
            
            return {
                pure_mu_h: p1_mu_h,
                pure_mu_a: p1_mu_a,
                source: "Manual (Components)"
            };
        }
        
        // === P2 (Alap Statisztika) Fallback - FEJLESZTVE v124.0 ===
        let avg_h_gf = rawStats.home?.gf != null ? (rawStats.home.gf / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_gf || 3.1);
        let avg_a_gf = rawStats.away?.gf != null ? (rawStats.away.gf / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_gf || 2.9);
        let avg_h_ga = rawStats.home?.ga != null ? (rawStats.home.ga / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_ga || 2.9);
        let avg_a_ga = rawStats.away?.ga != null ? (rawStats.away.ga / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_ga || 3.1);

        // === ÚJ v124.0: RECENT FORM SÚLYOZÁS ===
        // Ha van form adat, akkor az utolsó 5 meccs alapján finomítunk
        const getFormMultiplier = (formString: string | null | undefined): number => {
            if (!formString || typeof formString !== 'string') return 1.0;
            const recentForm = formString.substring(0, 5); // Utolsó 5 meccs
            const wins = (recentForm.match(/W/g) || []).length;
            const losses = (recentForm.match(/L/g) || []).length;
            const total = recentForm.length;
            
            if (total === 0) return 1.0;
            
            // Nyerési arány: ha 80%+, akkor +10% várható gól, ha 20%-, akkor -10%
            const winRate = wins / total;
            if (winRate >= 0.8) return 1.10;
            if (winRate >= 0.6) return 1.05;
            if (winRate <= 0.2) return 0.90;
            if (winRate <= 0.4) return 0.95;
            return 1.0;
        };
        
        const homeFormMult = getFormMultiplier(options.form?.home_overall);
        const awayFormMult = getFormMultiplier(options.form?.away_overall);
        
        avg_h_gf *= homeFormMult;
        avg_a_gf *= awayFormMult;
        
        // === ÚJ v124.0: POWER PLAY / GOALIE IMPACT (Ha elérhető advancedData-ban) ===
        // Ha van PP% vagy GSAx adat, azt is figyelembe vesszük
        if (advancedData?.home_pp_percent && advancedData?.away_pp_percent) {
            const leagueAvgPP = 0.20; // Liga átlag ~20% PP sikerség
            const homePPBonus = (advancedData.home_pp_percent - leagueAvgPP) * 0.5; // +0.1 → +0.05 gól
            const awayPPBonus = (advancedData.away_pp_percent - leagueAvgPP) * 0.5;
            
            avg_h_gf += homePPBonus;
            avg_a_gf += awayPPBonus;
        }

        let pure_mu_h = (avg_h_gf + avg_a_ga) / 2;
        let pure_mu_a = (avg_a_gf + avg_h_ga) / 2;
        
        // Biztonsági korlátok (NHL-ben nagyon ritka a 7+ gól)
        pure_mu_h = Math.max(1.5, Math.min(5.0, pure_mu_h));
        pure_mu_a = Math.max(1.5, Math.min(5.0, pure_mu_a));
        
        return {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            source: "Baseline (P2) Stats"
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
