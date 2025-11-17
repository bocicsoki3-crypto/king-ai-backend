// FÁJL: strategies/SoccerStrategy.ts
// VERZIÓ: v105.1 ("Intelligens Bizalom Refaktor" - TS2339 Javítás)
// MÓDOSÍTÁS (v105.1):
// 1. JAVÍTÁS: Eltávolítva a 'is_derby' tulajdonság a 'cardsData' objektumból
//    (a régi 141. soron), mivel az nem létezik a 'canonical.d.ts'
//    típusdefiníciójában, ami a TS2339 hibát okozta.

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
    BTTS_ANALYSIS_PROMPT,
    SOCCER_GOALS_OU_PROMPT,
    CORNER_ANALYSIS_PROMPT,
    CARD_ANALYSIS_PROMPT
} from '../AI_Service.js';

/**
 * A Foci-specifikus elemzési logikát tartalmazó stratégia.
 */
export class SoccerStrategy implements ISportStrategy {

    /**
     * 1. Ügynök (Quant) feladata: Foci xG számítása.
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

        // === P4 (Automatikus) Adatok Ellenőrzése ===
        // TODO: P4 logika implementálása
        
        // === P2 (Alap Statisztika) Fallback ===
        // (Logika a v81.3-ból)
        const avg_h_gf = rawStats.home?.gf != null ? (rawStats.home.gf / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_gf || 1.35);
        const avg_a_gf = rawStats.away?.gf != null ? (rawStats.away.gf / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_gf || 1.15);
        const avg_h_ga = rawStats.home?.ga != null ? (rawStats.home.ga / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_ga || 1.15);
        const avg_a_ga = rawStats.away?.ga != null ? (rawStats.away.ga / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_ga || 1.35);

        const pure_mu_h = (avg_h_gf + avg_a_ga) / 2;
        const pure_mu_a = (avg_a_gf + avg_h_ga) / 2;
        
        return {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            source: "Baseline (P2) Stats"
        };
    }

    /**
     * Kiszámítja a másodlagos piacokat (szöglet, lapok).
     * (Változatlan v104.0)
     */
    public estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        const { rawData, leagueAverages } = options;
        // TODO: Valódi számítás implementálása
        return {
            mu_corners: leagueAverages?.avg_corners || 10.1,
            mu_cards: leagueAverages?.avg_cards || 4.2
        };
    }

    /**
     * 5-6. Ügynök (Hybrid Boss) feladata: Foci-specifikus AI mikromodellek futtatása.
     * MÓDOSÍTVA (v105.1): 'cardsData' javítva.
     */
    public async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        console.log("[SoccerStrategy] runMicroModels: Valódi foci AI modellek futtatása...");

        const { sim, rawDataJson, mainTotalsLine, confidenceScores } = options; // v105.0
        const safeSim = sim || {};
        const safeRawData = rawDataJson || {};
        
        // === v105.0: Bizalmi adatok előkészítése ===
        const confidenceData = {
            confidenceWinner: confidenceScores.winner.toFixed(1),
            confidenceTotals: confidenceScores.totals.toFixed(1)
        };
        // ==========================================

        const bttsData = {
            ...confidenceData, // v105.0
            sim_pBTTS: safeSim.pBTTS,
            sim_mu_h: safeSim.mu_h_sim,
            sim_mu_a: safeSim.mu_a_sim,
            home_style: safeRawData.tactics?.home?.style || "N/A",
            away_style: safeRawData.tactics?.away?.style || "N/A",
        };

        const goalsData = {
            ...confidenceData, // v105.0
            line: mainTotalsLine,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim || 0) + (safeSim.mu_a_sim || 0),
            home_style: safeRawData.tactics?.home?.style || "N/A",
            away_style: safeRawData.tactics?.away?.style || "N/A",
            absentees_home_count: safeRawData.absentees?.home?.length || 0,
            absentees_away_count: safeRawData.absentees?.away?.length || 0,
        };

        const cornersData = {
            ...confidenceData, // v105.0
            likelyLine: "9.5/10.5",
            mu_corners: safeSim.mu_corners_sim,
            home_style: safeRawData.tactics?.home?.style || "N/A",
            away_style: safeRawData.tactics?.away?.style || "N/A",
        };

        const cardsData = {
            ...confidenceData, // v105.0
            likelyLine: "4.5/5.5",
            mu_cards: safeSim.mu_cards_sim,
            referee_style: safeRawData.referee?.style || "N/A",
            tension: safeRawData.contextual_factors?.match_tension_index || "N/A",
            // === JAVÍTVA (v105.1): 'is_derby' sor eltávolítva a TS2339 hiba miatt ===
        };

        // Modellek párhuzamos futtatása
        const results = await Promise.allSettled([
            getAndParse(BTTS_ANALYSIS_PROMPT, bttsData, "btts_analysis", "Soccer.BTTS"),
            getAndParse(SOCCER_GOALS_OU_PROMPT, goalsData, "goals_ou_analysis", "Soccer.Goals"),
            getAndParse(CORNER_ANALYSIS_PROMPT, cornersData, "corner_analysis", "Soccer.Corners"),
            getAndParse(CARD_ANALYSIS_PROMPT, cardsData, "card_analysis", "Soccer.Cards")
        ]);

        // Eredmények összegyűjtése (hibatűréssel)
        const microAnalyses: { [key: string]: string } = {};
        
        microAnalyses['btts_analysis'] = (results[0].status === 'fulfilled') ? results[0].value : `AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
        microAnalyses['goals_ou_analysis'] = (results[1].status === 'fulfilled') ? results[1].value : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
        microAnalyses['corner_analysis'] = (results[2].status === 'fulfilled') ? results[2].value : `AI Hiba: ${results[2].reason?.message || 'Ismeretlen'}`;
        microAnalyses['card_analysis'] = (results[3].status === 'fulfilled') ? results[3].value : `AI Hiba: ${results[3].reason?.message || 'Ismeretlen'}`;
        
        return microAnalyses;
    }
}
