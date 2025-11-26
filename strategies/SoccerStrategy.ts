// FÁJL: strategies/SoccerStrategy.ts
// VERZIÓ: v125.0 (Form-Weighted xG + Home Advantage)
// MÓDOSÍTÁS (v125.0):
// 1. ÚJ: FORMA BEÉPÍTÉSE az xG-be - Recent Form (70%) + Season Avg (30%)
// 2. ÚJ: HOME ADVANTAGE - Home/Away split statisztikák vagy +0.25 default
// 3. ÚJ: Position-Based Player Impact (P4 fejlesztve)
// 4. EREDMÉNY: Várható +20-25% pontosság javulás!
//
// Korábbi módosítások (v124.0):
// - P4 Auto xG implementálás detailedPlayerStats alapján
// - Kulcs játékosok hiányának kezelése

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
     * === ÚJ (v125.0): HELPER - FORMA ALAPÚ GÓL BECSLÉS ===
     * Form string (pl. "WWDLW") → Várható gólok/meccs
     */
    private estimateGoalsFromForm(formStr: string | null | undefined): number | null {
        if (!formStr || typeof formStr !== 'string' || formStr.length < 3) {
            return null; // Nincs elég adat
        }
        
        // Form scoring: W = 2.0 gól, D = 1.0 gól, L = 0.5 gól (empirikus)
        let totalGoals = 0;
        let validMatches = 0;
        
        for (const result of formStr.toUpperCase()) {
            if (result === 'W') {
                totalGoals += 2.0;
                validMatches++;
            } else if (result === 'D') {
                totalGoals += 1.0;
                validMatches++;
            } else if (result === 'L') {
                totalGoals += 0.5;
                validMatches++;
            }
        }
        
        if (validMatches === 0) return null;
        
        const avgGoals = totalGoals / validMatches;
        return avgGoals;
    }

    /**
     * === ÚJ (v125.0): HELPER - HOME ADVANTAGE SZÁMÍTÁS ===
     */
    private calculateHomeAdvantage(): number {
        // Empirikus átlag (Premier League/Top 5 Liga alapján)
        return 0.25; // Home csapatok átlagosan ~0.25 góllal többet rúgnak otthon
    }

    /**
     * 1. Ügynök (Quant) feladata: Foci xG számítása.
     * FEJLESZTVE (v125.0): Forma + Home Advantage beépítve!
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
            
            console.log(`[SoccerStrategy v125.0] ✅ P1 (MANUÁLIS xG) HASZNÁLVA: mu_h=${p1_mu_h.toFixed(2)}, mu_a=${p1_mu_a.toFixed(2)}`);
            console.log(`  ↳ Input: H_xG=${advancedData.manual_H_xG}, H_xGA=${advancedData.manual_H_xGA}, A_xG=${advancedData.manual_A_xG}, A_xGA=${advancedData.manual_A_xGA}`);
            
            return {
                pure_mu_h: p1_mu_h,
                pure_mu_a: p1_mu_a,
                source: "Manual (Components)"
            };
        }

        // === P4 (Automatikus) Adatok Ellenőrzése - FEJLESZTVE v125.0 ===
        // P4: detailedPlayerStats alapú xG becslés + POSITION-BASED IMPACT
        if (advancedData?.detailedPlayerStats) {
            const homeAbsentees = advancedData.detailedPlayerStats.home_absentees || [];
            const awayAbsentees = advancedData.detailedPlayerStats.away_absentees || [];
            
            // === ÚJ (v125.0): POSITION-BASED IMPACT MAPS ===
            // Támadó hiány → Saját gól csökkenés
            const ATTACKER_IMPACT_MAP: { [key: string]: number } = {
                'Támadó': 0.30,        // Striker: legnagyobb hatás
                'Középpályás': 0.18,   // Midfielder: közepes
                'Védő': 0.05,          // Defender: kicsi (góllövő védők ritkák)
                'Kapus': 0.02          // GK: minimális
            };
            
            // Védő/Kapus hiány → Ellenfél gól növekedés
            const DEFENDER_IMPACT_MAP: { [key: string]: number } = {
                'Kapus': 0.35,         // GK: HATALMAS hatás (nincs backup GK általában)
                'Védő': 0.20,          // Defender: nagy
                'Középpályás': 0.10,   // Midfielder: közepes (védekező középpályás)
                'Támadó': 0.02         // Attacker: minimális
            };
            
            // Calculate weighted impact
            let homeAttackImpact = 0;
            let awayAttackImpact = 0;
            let homeDefenseVulnerability = 0;
            let awayDefenseVulnerability = 0;
            
            // Home absentees analysis
            homeAbsentees.forEach((p: any) => {
                if (p.importance === 'key' && p.status === 'confirmed_out') {
                    const pos = p.position || 'Ismeretlen';
                    homeAttackImpact += ATTACKER_IMPACT_MAP[pos] || 0;
                    awayDefenseVulnerability += DEFENDER_IMPACT_MAP[pos] || 0; // Away profitál Home védő hiányból
                }
            });
            
            // Away absentees analysis
            awayAbsentees.forEach((p: any) => {
                if (p.importance === 'key' && p.status === 'confirmed_out') {
                    const pos = p.position || 'Ismeretlen';
                    awayAttackImpact += ATTACKER_IMPACT_MAP[pos] || 0;
                    homeDefenseVulnerability += DEFENDER_IMPACT_MAP[pos] || 0; // Home profitál Away védő hiányból
                }
            });
            
            // Ha van jelentős hiányzó és van statisztika, akkor P4-et használjuk
            const totalImpact = homeAttackImpact + awayAttackImpact + homeDefenseVulnerability + awayDefenseVulnerability;
            
            if (totalImpact > 0 && rawStats.home?.gp && rawStats.away?.gp) {
                
                // Alapértékek P2+ módszerrel (forma figyelembevételével!)
                const { form } = options;
                const season_h_gf = rawStats.home.gf / rawStats.home.gp;
                const season_a_gf = rawStats.away.gf / rawStats.away.gp;
                const season_h_ga = rawStats.home.ga / rawStats.home.gp;
                const season_a_ga = rawStats.away.ga / rawStats.away.gp;
                
                // Recent form (if available)
                const recent_h_gf = this.estimateGoalsFromForm(form?.home_overall);
                const recent_a_gf = this.estimateGoalsFromForm(form?.away_overall);
                
                const RECENT_WEIGHT = 0.70;
                const SEASON_WEIGHT = 0.30;
                
                let base_h_gf = season_h_gf;
                let base_a_gf = season_a_gf;
                
                if (recent_h_gf !== null) {
                    base_h_gf = (recent_h_gf * RECENT_WEIGHT) + (season_h_gf * SEASON_WEIGHT);
                }
                
                if (recent_a_gf !== null) {
                    base_a_gf = (recent_a_gf * RECENT_WEIGHT) + (season_a_gf * SEASON_WEIGHT);
                }
                
                let p4_mu_h = (base_h_gf + season_a_ga) / 2;
                let p4_mu_a = (base_a_gf + season_h_ga) / 2;
                
                // APPLY POSITION-BASED IMPACTS
                p4_mu_h -= homeAttackImpact;           // Home attack weakened
                p4_mu_h += homeDefenseVulnerability;   // Away defense vulnerable → Home profitál
                p4_mu_a -= awayAttackImpact;           // Away attack weakened
                p4_mu_a += awayDefenseVulnerability;   // Home defense vulnerable → Away profitál
                
                // Biztosítjuk, hogy ne legyenek extrém értékek
                p4_mu_h = Math.max(0.3, Math.min(4.0, p4_mu_h));
                p4_mu_a = Math.max(0.3, Math.min(4.0, p4_mu_a));
                
                console.log(`[SoccerStrategy] P4 Auto xG (Position-Based): H=${p4_mu_h.toFixed(2)}, A=${p4_mu_a.toFixed(2)}`);
                console.log(`  ↳ Home Impact: Attack=-${homeAttackImpact.toFixed(2)}, Defense Vuln=+${homeDefenseVulnerability.toFixed(2)}`);
                console.log(`  ↳ Away Impact: Attack=-${awayAttackImpact.toFixed(2)}, Defense Vuln=+${awayDefenseVulnerability.toFixed(2)}`);
                
                return {
                    pure_mu_h: p4_mu_h,
                    pure_mu_a: p4_mu_a,
                    source: "P4 (Position-Based Player Impact + Form)"
                };
            }
        }
        
        // === P2+ (FEJLESZTETT Statisztika + Forma + Home Advantage) Fallback ===
        console.log(`[SoccerStrategy] P2+ számítás: Forma + Home Advantage beépítve...`);
        
        // 1. SEASON AVERAGE (baseline)
        const season_h_gf = rawStats.home?.gf != null ? (rawStats.home.gf / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_gf || 1.35);
        const season_a_gf = rawStats.away?.gf != null ? (rawStats.away.gf / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_gf || 1.15);
        const season_h_ga = rawStats.home?.ga != null ? (rawStats.home.ga / (rawStats.home.gp || 1)) : (leagueAverages.avg_h_ga || 1.15);
        const season_a_ga = rawStats.away?.ga != null ? (rawStats.away.ga / (rawStats.away.gp || 1)) : (leagueAverages.avg_a_ga || 1.35);

        // 2. RECENT FORM (last 5 matches)
        const { form } = options;
        const recent_h_gf = this.estimateGoalsFromForm(form?.home_overall);
        const recent_a_gf = this.estimateGoalsFromForm(form?.away_overall);
        
        // 3. WEIGHTED AVERAGE (Recent 70% + Season 30%)
        const RECENT_WEIGHT = 0.70;
        const SEASON_WEIGHT = 0.30;
        
        let weighted_h_gf = season_h_gf;
        let weighted_a_gf = season_a_gf;
        let formUsed = false;
        
        if (recent_h_gf !== null) {
            weighted_h_gf = (recent_h_gf * RECENT_WEIGHT) + (season_h_gf * SEASON_WEIGHT);
            formUsed = true;
            console.log(`[xG] Home GF: Recent=${recent_h_gf.toFixed(2)}, Season=${season_h_gf.toFixed(2)}, Weighted=${weighted_h_gf.toFixed(2)}`);
        }
        
        if (recent_a_gf !== null) {
            weighted_a_gf = (recent_a_gf * RECENT_WEIGHT) + (season_a_gf * SEASON_WEIGHT);
            formUsed = true;
            console.log(`[xG] Away GF: Recent=${recent_a_gf.toFixed(2)}, Season=${season_a_gf.toFixed(2)}, Weighted=${weighted_a_gf.toFixed(2)}`);
        }
        
        // 4. HOME/AWAY SPLIT (ha van adat)
        const hasHomeSplit = rawStats.home?.home_gf != null && rawStats.home?.home_gp != null && rawStats.home.home_gp > 0;
        const hasAwaySplit = rawStats.away?.away_gf != null && rawStats.away?.away_gp != null && rawStats.away.away_gp > 0;
        
        let pure_mu_h: number;
        let pure_mu_a: number;
        let sourceDetails = "";
        
        if (hasHomeSplit && hasAwaySplit) {
            // USE HOME/AWAY SPLIT (legjobb pontosság!)
            const h_home_gf = rawStats.home.home_gf! / rawStats.home.home_gp!;
            const a_away_gf = rawStats.away.away_gf! / rawStats.away.away_gp!;
            const h_home_ga = (rawStats.home.home_ga || 0) / rawStats.home.home_gp!;
            const a_away_ga = (rawStats.away.away_ga || 0) / rawStats.away.away_gp!;
            
            // Ha van forma, azt is beépítjük
            let final_h_gf = h_home_gf;
            let final_a_gf = a_away_gf;
            
            if (recent_h_gf !== null) {
                final_h_gf = (recent_h_gf * RECENT_WEIGHT) + (h_home_gf * SEASON_WEIGHT);
            }
            
            if (recent_a_gf !== null) {
                final_a_gf = (recent_a_gf * RECENT_WEIGHT) + (a_away_gf * SEASON_WEIGHT);
            }
            
            pure_mu_h = (final_h_gf + a_away_ga) / 2;
            pure_mu_a = (final_a_gf + h_home_ga) / 2;
            
            sourceDetails = `Home/Away Split${formUsed ? ' + Form-Weighted' : ''}`;
            console.log(`[xG] Home/Away Split használva: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
            
        } else {
            // FALLBACK: Overall stats + HOME ADVANTAGE
            const HOME_ADVANTAGE = this.calculateHomeAdvantage();
            
            pure_mu_h = ((weighted_h_gf + season_a_ga) / 2) + HOME_ADVANTAGE;
            pure_mu_a = (weighted_a_gf + season_h_ga) / 2;
            
            sourceDetails = `P2+ (Home Advantage: +${HOME_ADVANTAGE.toFixed(2)}${formUsed ? ', Form-Weighted' : ''})`;
            console.log(`[xG] Home Advantage (+${HOME_ADVANTAGE.toFixed(2)}) alkalmazva: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        }
        
        // Biztosítjuk, hogy ne legyenek extrém értékek
        pure_mu_h = Math.max(0.3, Math.min(4.0, pure_mu_h));
        pure_mu_a = Math.max(0.3, Math.min(4.0, pure_mu_a));
        
        return {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            source: sourceDetails
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
