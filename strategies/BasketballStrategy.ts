// FÁJL: strategies/BasketballStrategy.ts
// VERZIÓ: v107.0 (Valós P4 Becslés Javítás)

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

/**
 * A Kosárlabda-specifikus elemzési logikát tartalmazó stratégia.
 */
export class BasketballStrategy implements ISportStrategy {

    /**
     * 1. Ügynök (Quant) feladata: Pontok becslése kosárlabdához.
     * JAVÍTVA (v107.0): Valós statisztikai becslés a "hardcoded" 107.8 helyett.
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
        
        // === P4 (Automatikus) Becslés (v107.0 JAVÍTÁS) ===
        // Ha nincsenek P1 adatok, a csapatok átlagos pontszámaiból számolunk.
        // Formula: (Hazai Támadás + Vendég Védekezés) / 2  és fordítva.
        
        // Alapértelmezett liga átlag (ha minden adat hiányzik)
        const leagueAvgPoints = 112.0; // NBA átlag közelebb van a 112-115-höz manapság

        // Biztonságos adatkinyerés (ha 0 vagy null, akkor liga átlag)
        const h_scored = (rawStats.home.gf && rawStats.home.gp) ? (rawStats.home.gf / rawStats.home.gp) : leagueAvgPoints;
        const h_conceded = (rawStats.home.ga && rawStats.home.gp) ? (rawStats.home.ga / rawStats.home.gp) : leagueAvgPoints;
        
        const a_scored = (rawStats.away.gf && rawStats.away.gp) ? (rawStats.away.gf / rawStats.away.gp) : leagueAvgPoints;
        const a_conceded = (rawStats.away.ga && rawStats.away.gp) ? (rawStats.away.ga / rawStats.away.gp) : leagueAvgPoints;

        // Súlyozott számítás
        // Hazai várható pont = (Hazai szerzett átlag + Vendég kapott átlag) / 2
        // Hazai pálya előny: kb. +2.5 pont
        const HOME_ADVANTAGE = 2.5;

        let est_mu_h = (h_scored + a_conceded) / 2 + (HOME_ADVANTAGE / 2);
        let est_mu_a = (a_scored + h_conceded) / 2 - (HOME_ADVANTAGE / 2);

        // Értékek "normalizálása" (hogy ne legyenek extrém kiugrók hibás adat esetén)
        est_mu_h = Math.max(80, Math.min(140, est_mu_h));
        est_mu_a = Math.max(80, Math.min(140, est_mu_a));

        return {
            pure_mu_h: Number(est_mu_h.toFixed(1)),
            pure_mu_a: Number(est_mu_a.toFixed(1)),
            source: "Calculated (Avg Pts Based)"
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
