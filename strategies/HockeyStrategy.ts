// FÁJL: strategies/HockeyStrategy.ts
// CÉL: Ez a fájl tartalmaz MINDEN logikát, ami KIZÁRÓLAG a HOKI-hoz
// kapcsolódik (xG számítás, AI promptok).

// A .js kiterjesztések fontosak a Node.js TypeScript importokhoz
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions, MicroModelOptions } from './ISportStrategy.js';
import { SPORT_CONFIG } from '../config.js';
import type { ICanonicalStats, ICanonicalRawData } from '../src/types/canonical.d.ts';

// Importáljuk az AI_Service-ből a közös futtatót és a HOKI promptokat
// Ezeket exportálni kell az AI_Service.ts fájlban!
import {
    getAndParse,
    HOCKEY_GOALS_OU_PROMPT,
    HOCKEY_WINNER_PROMPT
} from '../AI_Service.js';

export class HockeyStrategy implements ISportStrategy {

    /**
     * 1. HOKI xG Számítás
     * (Ez a logika a Model.ts (v95.1) 'estimatePureXG' else ágából származik,
     * mivel a hoki és a foci P4 logikája megegyezett)
     */
    estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { homeTeam, awayTeam, rawStats, form, leagueAverages, advancedData } = options;
        const homeStats = rawStats.home;
        const awayStats = rawStats.away;

        const areStatsValid = (stats: ICanonicalStats) => stats &&
            stats.gp > 0 && 
            (typeof stats.gf === 'number') && 
            (typeof stats.ga === 'number');

        const hasP1Data = advancedData?.manual_H_xG != null && advancedData?.manual_H_xGA != null &&
                          advancedData?.manual_A_xG != null && advancedData?.manual_A_xGA != null;
        
        if (!hasP1Data && (!areStatsValid(homeStats) || !areStatsValid(awayStats))) {
            console.warn(`HOKI STRATÉGIA: Hiányos STATS (P4 módban): ${homeTeam} vs ${awayTeam}. Default xG.`);
            const defaultGoals = SPORT_CONFIG['hockey'].avg_goals;
            const homeAdv = SPORT_CONFIG['hockey'].home_advantage;
            return { pure_mu_h: defaultGoals * homeAdv.home, pure_mu_a: defaultGoals * homeAdv.away, source: 'Default (Hiányos Stat)' };
        }

        let mu_h: number, mu_a: number;
        let source: string;
        
        if (hasP1Data) {
            const maxRealisticXG = 10.0; // Hokinál magasabb
            mu_h = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
            mu_a = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;
            mu_h = Math.max(0, Math.min(maxRealisticXG, mu_h));
            mu_a = Math.max(0, Math.min(maxRealisticXG, mu_a));
            source = 'Manual (Components)';
        } else {
            source = 'Calculated (Becsült) xG [P4]';
            const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || SPORT_CONFIG['hockey'].avg_goals;
            const safeHomeGp = Math.max(1, homeStats.gp);
            const safeAwayGp = Math.max(1, awayStats.gp);
            const safeAvgGoals = avgGoalsInLeague > 0 ? avgGoalsInLeague : SPORT_CONFIG['hockey'].avg_goals;
            
            const MIN_STRENGTH = 0.2;
            const MAX_STRENGTH = 5.0;

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

        return { pure_mu_h: mu_h, pure_mu_a: mu_a, source: source };
    }

    /**
     * 2. HOKI Haladó Metrikák (Nincs)
     * (A Model.ts (v95.1) 'estimateAdvancedMetrics' else ágából)
     */
    estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        // Hoki esetén nincs szöglet vagy lap
        return {
            mu_corners: 0,
            mu_cards: 0
        };
    }

    /**
     * 3. HOKI AI Mikromodellek Futtatása
     * (Ez a logika az AI_Service.ts (v103.6) 'runStep_FinalAnalysis' else if ágából származik)
     */
    async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        const { sim, rawDataJson, mainTotalsLine } = options;
        const microAnalyses: { [key: string]: string } = {};
        const safeSim = sim || {};

        // Adatkészítés a HOKI promptokhoz
        const goalsData = {
            line: mainTotalsLine || 6.5,
            sim_pOver: safeSim.pOver,
            sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
            home_gsax: rawDataJson?.advanced_stats_goalie?.home_goalie?.GSAx,
            away_gsax: rawDataJson?.advanced_stats_goalie?.away_goalie?.GSAx
        };
        const winnerData = {
            sim_pHome: safeSim.pHome,
            sim_pAway: safeSim.pAway,
            home_gsax: rawDataJson?.advanced_stats_goalie?.home_goalie?.GSAx,
            away_gsax: rawDataJson?.advanced_stats_goalie?.away_goalie?.GSAx,
            form_home: rawDataJson?.form?.home_overall || "N/A",
            form_away: rawDataJson?.form?.away_overall || "N/A"
        };
        
        const results = await Promise.allSettled([
            getAndParse(HOCKEY_GOALS_OU_PROMPT, goalsData, "hockey_goals_ou_analysis", "HockeyGoalsOU"),
            getAndParse(HOCKEY_WINNER_PROMPT, winnerData, "hockey_winner_analysis", "HockeyWinner")
        ]);

        microAnalyses['hockey_goals_ou_analysis'] = (results[0].status === 'fulfilled') ? (results[0].value as string) : `AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
        microAnalyses['hockey_winner_analysis'] = (results[1].status === 'fulfilled') ? (results[1].value as string) : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
        
        return microAnalyses;
    }
}
