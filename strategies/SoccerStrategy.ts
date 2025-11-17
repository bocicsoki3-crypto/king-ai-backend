// FÁJL: strategies/SoccerStrategy.ts
// CÉL: Ez a fájl tartalmaz MINDEN logikát, ami KIZÁRÓLAG a FOCI-hoz
// kapcsolódik (xG számítás, AI promptok).

// A .js kiterjesztések fontosak a Node.js TypeScript importokhoz
import type { ISportStrategy, XGOptions, AdvancedMetricsOptions, MicroModelOptions } from './ISportStrategy.js';
import { SPORT_CONFIG } from '../config.js';
import type { ICanonicalStats, ICanonicalRawData } from '../src/types/canonical.d.ts';

// Importáljuk az AI_Service-ből a közös futtatót és a FOCI promptokat
// Ezeket exportálni kell az AI_Service.ts fájlban!
import {
    getAndParse,
    BTTS_ANALYSIS_PROMPT,
    SOCCER_GOALS_OU_PROMPT,
    CORNER_ANALYSIS_PROMPT,
    CARD_ANALYSIS_PROMPT
} from '../AI_Service.js';

export class SoccerStrategy implements ISportStrategy {

    /**
     * 1. FOCI xG Számítás
     * (Ez a logika a Model.ts (v95.1) 'estimatePureXG' else ágából származik)
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
        
        // P4 mód (statisztika alapú) ellenőrzése
        if (!hasP1Data && (!areStatsValid(homeStats) || !areStatsValid(awayStats))) {
            console.warn(`FOCI STRATÉGIA: Hiányos STATS (P4 módban): ${homeTeam} vs ${awayTeam}. Default xG.`);
            const defaultGoals = SPORT_CONFIG['soccer'].avg_goals;
            const homeAdv = SPORT_CONFIG['soccer'].home_advantage;
            return { pure_mu_h: defaultGoals * homeAdv.home, pure_mu_a: defaultGoals * homeAdv.away, source: 'Default (Hiányos Stat)' };
        }

        let mu_h: number, mu_a: number;
        let source: string;
        
        if (hasP1Data) {
            const maxRealisticXG = 7.0;
            mu_h = (advancedData.manual_H_xG + advancedData.manual_A_xGA) / 2;
            mu_a = (advancedData.manual_A_xG + advancedData.manual_H_xGA) / 2;
            mu_h = Math.max(0, Math.min(maxRealisticXG, mu_h));
            mu_a = Math.max(0, Math.min(maxRealisticXG, mu_a));
            source = 'Manual (Components)';
        } else {
            source = 'Calculated (Becsült) xG [P4]';
            const avgGoalsInLeague = leagueAverages?.avg_goals_per_game || SPORT_CONFIG['soccer'].avg_goals;
            const safeHomeGp = Math.max(1, homeStats.gp);
            const safeAwayGp = Math.max(1, awayStats.gp);
            const safeAvgGoals = avgGoalsInLeague > 0 ? avgGoalsInLeague : SPORT_CONFIG['soccer'].avg_goals;
            
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
     * 2. FOCI Haladó Metrikák (Lapok/Szögletek)
     * (Ez a logika a Model.ts (v95.1) 'estimateAdvancedMetrics' if ágából származik)
     */
    estimateAdvancedMetrics(options: AdvancedMetricsOptions): { mu_corners: number; mu_cards: number; } {
        const { rawData, leagueAverages } = options;
        const avgCorners = leagueAverages?.avg_corners || 10.5;
        const avgCards = leagueAverages?.avg_cards || 4.5;
        let mu_corners = avgCorners;
        let mu_cards = avgCards;

        const tactics = rawData?.tactics;
        const referee = rawData?.referee;
        const context = rawData?.contextual_factors;
        const logData: any = { sport: 'soccer' }; // Logoláshoz, ha szükséges
        logData.base_corners = mu_corners;
        logData.base_cards = mu_cards;
        
        // --- Szögletek ---
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
        
        // --- Lapok ---
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
        // Az eredeti logikában volt egy lehetséges hiba (osztás önmagával), itt javítva:
        const refMod = logData.card_ref_mod || 1.0;
        const tensionMod = card_mod / refMod;
        logData.card_tension_mod = tensionMod;
        
        if (homeStyle.includes('press') || homeStyle.includes('aggressive')) card_mod += 0.05;
        if (awayStyle.includes('press') || awayStyle.includes('aggressive')) card_mod += 0.05;
        if (homeStyle.includes('counter')) card_mod += 0.03;
        if (awayStyle.includes('counter')) card_mod += 0.03;
        logData.card_tactics_mod = card_mod / (refMod * tensionMod);

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
        
        return {
            mu_corners: typeof mu_corners === 'number' && !isNaN(mu_corners) ? mu_corners : 10.5,
            mu_cards: typeof mu_cards === 'number' && !isNaN(mu_cards) ? mu_cards : 4.5
        };
    }

    /**
     * 3. FOCI AI Mikromodellek Futtatása
     * (Ez a logika az AI_Service.ts (v103.6) 'runStep_FinalAnalysis' if ágából származik)
     */
    async runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string; }> {
        const { sim, rawDataJson, mainTotalsLine } = options;
        const microAnalyses: { [key: string]: string } = {};

        // Segédfüggvény (az AI_Service.ts-ből másolva, hogy meglegyen)
        const countKeyAbsentees = (absentees: any[] | undefined) => Array.isArray(absentees) ? absentees.filter(p => p.importance === 'key').length : 0;
        const safeSim = sim || {};
        
        // Adatkészítés a FOCI promptokhoz
        const bttsData = {
            sim_pBTTS: safeSim.pBTTS, sim_mu_h: safeSim.mu_h_sim, sim_mu_a: safeSim.mu_a_sim,
            home_style: rawDataJson?.tactics?.home?.style || "N/A", away_style: rawDataJson?.tactics?.away?.style || "N/A"
        };
        const goalsData = {
            line: mainTotalsLine || 2.5, sim_pOver: safeSim.pOver, sim_mu_sum: (safeSim.mu_h_sim ?? 0) + (safeSim.mu_a_sim ?? 0),
            home_style: rawDataJson?.tactics?.home?.style || "N/A", away_style: rawDataJson?.tactics?.away?.style || "N/A",
            absentees_home_count: countKeyAbsentees(rawDataJson?.absentees?.home), absentees_away_count: countKeyAbsentees(rawDataJson?.absentees?.away)
        };
        const cornersData = {
            mu_corners: safeSim.mu_corners_sim, likelyLine: safeSim.mu_corners_sim ? (Math.round(safeSim.mu_corners_sim - 0.1)) + 0.5 : 9.5,
            home_style: rawDataJson?.tactics?.home?.style || "N/A", away_style: rawDataJson?.tactics?.away?.style || "N/A"
        };
        const cardsData = {
            mu_cards: safeSim.mu_cards_sim, likelyLine: safeSim.mu_cards_sim ? (Math.round(safeSim.mu_cards_sim - 0.1)) + 0.5 : 4.5,
            referee_style: rawDataJson?.referee?.style || "N/A", tension: rawDataJson?.contextual_factors?.match_tension_index || "N/A",
            is_derby: rawDataJson?.contextual_factors?.match_tension_index?.toLowerCase().includes('derby')
        };

        // Párhuzamos futtatás
        const results = await Promise.allSettled([
            getAndParse(BTTS_ANALYSIS_PROMPT, bttsData, "btts_analysis", "SoccerBTTS"),
            getAndParse(SOCCER_GOALS_OU_PROMPT, goalsData, "goals_ou_analysis", "SoccerGoalsOU"),
            getAndParse(CORNER_ANALYSIS_PROMPT, cornersData, "corner_analysis", "SoccerCorners"),
            getAndParse(CARD_ANALYSIS_PROMPT, cardsData, "card_analysis", "SoccerCards")
        ]);

        // Eredmények összegyűjtése (hibatűréssel)
        microAnalyses['btts_analysis'] = (results[0].status === 'fulfilled') ? (results[0].value as string) : `AI Hiba: ${results[0].reason?.message || 'Ismeretlen'}`;
        microAnalyses['goals_ou_analysis'] = (results[1].status === 'fulfilled') ? (results[1].value as string) : `AI Hiba: ${results[1].reason?.message || 'Ismeretlen'}`;
        microAnalyses['corner_analysis'] = (results[2].status === 'fulfilled') ? (results[2].value as string) : `AI Hiba: ${results[2].reason?.message || 'Ismeretlen'}`;
        microAnalyses['card_analysis'] = (results[3].status === 'fulfilled') ? (results[3].value as string) : `AI Hiba: ${results[3].reason?.message || 'Ismeretlen'}`;

        return microAnalyses;
    }
}
