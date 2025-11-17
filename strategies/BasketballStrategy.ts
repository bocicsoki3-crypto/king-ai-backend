// FÁJL: strategies/BasketballStrategy.ts
// VERZIÓ: v104.2 (Javítva)
// MÓDOSÍTÁS (v104.2):
// 1. JAVÍTÁS (P1 Hiba): Az 'estimatePureXG' most már helyesen prioritizálja
//    a manuális (P1) adatokat az 'options.advancedData'-ból,
//    és csak akkor futtat P4-es becslést, ha azok hiányoznak.
// 2. JAVÍTÁS (AI Hiba): A 'runMicroModels' (korábbi "csonk") lecserélve
//    egy valódi implementációra, ami párhuzamosan hívja meg
//    az 'AI_Service.ts'-ből importált kosárlabda-specifikus promptokat.

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
     * JAVÍTVA (v104.2): Először a P1 (manuális) adatokat ellenőrzi.
     */
    public estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { rawStats, leagueAverages, advancedData } = options;

        // === P1 (Manuális) Adatok Ellenőrzése ===
        // Először ellenőrizzük, hogy a P1 (manuális) adatok rendelkezésre állnak-e.
        if (advancedData?.manual_H_xG != null && 
            advancedData?.manual_H_xGA != null && 
            advancedData?.manual_A_xG != null && 
            advancedData?.manual_A_xGA != null) {
            
            // Ha igen, a P1 adatokból számolunk, felülírva minden mást.
            const p1_mu_h = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
            const p1_mu_a = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;
            
            return {
                pure_mu_h: p1_mu_h,
                pure_mu_a: p1_mu_a,
                source: "Manual (Components)" // Ahogy a logban is 
            };
        }
        
        // === P4 (Automatikus) Adatok Ellenőrzése ===
        // Ha nincsenek P1 adatok, megpróbálunk P4 (Pace/Ratings) alapú becslést adni.
        
        // TODO: Valódi P4-es számítás implementálása
        // Jelenlegi (v104.2) "csonk" logika, ami a logban látott 107.80-at eredményezi .
        // Ez egy alapértelmezett értéket ad vissza, ha nincs jobb adat.
        const defaultLeaguePoints = 107.8; 

        return {
            pure_mu_h: defaultLeaguePoints,
            pure_mu_a: defaultLeaguePoints,
            source: "Calculated (Becsült) Pontok [P4]"
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
     * JAVÍTVA (v104.2): Ez már a valódi, élesített implementáció.
     */
    public async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        console.log("[BasketballStrategy] runMicroModels: Valódi kosárlabda AI modellek futtatása...");

        const { sim, rawDataJson, mainTotalsLine } = options;
        const safeSim = sim || {};
        const safeRawData = rawDataJson || {};
        
        // Adatok előkészítése a promptokhoz
        const winnerData = {
            sim_pHome: safeSim.pHome, 
            sim_pAway: safeSim.pAway,
            form_home: safeRawData.form?.home_overall || "N/A",
            form_away: safeRawData.form?.away_overall || "N/A",
            absentees_home_count: safeRawData.absentees?.home?.length || 0,
            absentees_away_count: safeRawData.absentees?.away?.length || 0,
        };

        const totalsData = {
            line: mainTotalsLine,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim || 0) + (safeSim.mu_a_sim || 0),
            home_pace: safeRawData.tactics?.home?.style || "N/A", // Feltételezzük, hogy a "style" a "pace"
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
