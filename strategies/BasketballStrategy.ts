// FÁJL: strategies/BasketballStrategy.ts
// CÉL: A kosárlabda-specifikus logika helye.
// Jelenleg a Model.ts-ből áthozott logikát tartalmazza.

// A .js kiterjesztések fontosak a Node.js TypeScript importokhoz
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions, MicroModelOptions } from './ISportStrategy.js';
import { SPORT_CONFIG } from '../config.js';
import type { ICanonicalStats } from '../src/types/canonical.d.ts';

export class BasketballStrategy implements ISportStrategy {

    /**
     * 1. KOSÁR Pont Számítás
     * (Ez a logika a Model.ts (v95.1) 'estimatePureXG' 'if (sport === 'basketball')' ágából származik)
     */
    estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; } {
        const { homeTeam, awayTeam, rawStats, leagueAverages, advancedData } = options;
        const homeStats = rawStats.home;
        const awayStats = rawStats.away;
        
        const areStatsValid = (stats: ICanonicalStats) => stats &&
            stats.gp > 0 && 
            (typeof stats.gf === 'number') && 
            (typeof stats.ga === 'number');

        // A P1 adatok (manuális xG) kosárlabdára nem értelmezettek, ezért a P4-et használjuk.
        // A 'hasP1Data' ellenőrzést itt kihagyjuk.
        if (!areStatsValid(homeStats) || !areStatsValid(awayStats)) {
             console.warn(`KOSÁR STRATÉGIA: Hiányos STATS (P4 módban): ${homeTeam} vs ${awayTeam}. Default pontszám.`);
            const defaultGoals = SPORT_CONFIG['basketball'].avg_goals;
            const homeAdv = SPORT_CONFIG['basketball'].home_advantage;
            return { pure_mu_h: defaultGoals * homeAdv.home, pure_mu_a: defaultGoals * homeAdv.away, source: 'Default (Hiányos Stat)' };
        }

        let mu_h: number, mu_a: number;
        let source: string;
        
        source = 'Calculated (Becsült) Pontok [P4]';
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
        
        if (advancedData?.home?.four_factors && advancedData?.away?.four_factors) {
            const homeFF = advancedData.home.four_factors;
            const awayFF = advancedData.away.four_factors;
            const ore_advantage = ((homeFF.OREB_pct ?? 0) - (awayFF.OREB_pct ?? 0)) * 0.05;
            const tov_advantage = ((awayFF.TOV_pct ?? 0) - (homeFF.TOV_pct ?? 0)) * 0.05;
            mu_h *= (1 + ore_advantage - tov_advantage);
            mu_a *= (1 - ore_advantage + tov_advantage);
        }

        return { pure_mu_h: mu_h, pure_mu_a: mu_a, source: source };
    }

    /**
     * 2. KOSÁR Haladó Metrikák (Nincs)
     */
    estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        // Kosár esetén nincs szöglet vagy lap
        return {
            mu_corners: 0,
            mu_cards: 0
        };
    }

    /**
     * 3. KOSÁR AI Mikromodellek (Jelenleg nincsenek)
     */
    async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        // TODO: Ide jöhetnének a kosár-specifikus AI promptok
        // (pl. Játékos pontok, Asszisztok)
        console.log("[BasketballStrategy] runMicroModels: Nincsenek implementált mikromodellek.");
        return {
            "basketball_analysis": "Nincs implementált AI mikromodell ehhez a sportághoz."
        };
    }
}
