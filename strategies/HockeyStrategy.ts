// FÁJL: strategies/HockeyStrategy.ts
// VERZIÓ: v107.0 (GSAx Fallback Javítás)

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
        
        // === P2 (Alap Statisztika) Fallback ===
        const avg_h_gf = rawStats.home?.gf != null ? (rawStats.home.gf / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_gf || 3.1);
        const avg_a_gf = rawStats.away?.gf != null ? (rawStats.away.gf / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_gf || 2.9);
        const avg_h_ga = rawStats.home?.ga != null ? (rawStats.home.ga / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_ga || 2.9);
        const avg_a_ga = rawStats.away?.ga != null ? (rawStats.away.ga / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_ga || 3.1);

        const pure_mu_h = (avg_h_gf + avg_a_ga) / 2;
        const pure_mu_a = (avg_a_gf + avg_h_ga) / 2;
        
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

        const goalsData = {
            ...confidenceData, // v105.0
            line: mainTotalsLine,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim || 0) + (safeSim.mu_a_sim || 0),
            home_gsax: homeGoalieInfo,
            away_gsax: awayGoalieInfo,
        };

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
