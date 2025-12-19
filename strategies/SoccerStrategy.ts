// FÁJL: strategies/SoccerStrategy.ts
// VERZIÓ: v139.0 (PURE AI MODE - FINAL) ⚽
//
// JAVÍTÁS (v138.0):
// 1. FORMA SÚLY HELYREÁLLÍTÁSA: 65/35 → 50/50 (Season/Form balance)
// 2. VENUE BIAS FIX: A hazai pálya előnye a formában is benne volt, így duplán számoltuk!
//    - Mostantól: getWeightedFormGoals (50% venue, 50% overall) - kiegyensúlyozottabb!
// 3. MINIMUM MATCH GUARD: Ha <5 meccs van a formában, akkor a szezonális átlag domináljon (80/20).
// 4. CÉL: Megszüntetni a "forma-zaj" miatti irreális kilengéseket.

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

// === ÚJ (v127.0 + v130.0): Liga Minőség + Defensive Multiplier Importálás ===
import {
    getLeagueCoefficient,
    getLeagueDefensiveMultiplier,
    calculateLeagueQualityModifier,
    getLeagueQuality
} from '../config_league_coefficients.js';

// === ÚJ (v134.0): Derby Detection Importálás ===
import { detectDerby, DERBY_MODIFIERS } from '../utils/derbyDetection.js';

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

    private getWeightedFormGoals(
        overallForm: string | null | undefined,
        venueForm: string | null | undefined,
        venueWeight: number
    ): { value: number | null; used: boolean } {
        const venueGoals = this.estimateGoalsFromForm(venueForm);
        const overallGoals = this.estimateGoalsFromForm(overallForm);
        
        if (venueGoals === null && overallGoals === null) {
            return { value: null, used: false };
        }
        
        if (venueGoals === null) {
            return { value: overallGoals, used: overallGoals !== null };
        }
        
        if (overallGoals === null) {
            return { value: venueGoals, used: true };
        }
        
        // v148.6: VENUE FORM PRIORITIZÁLÁSA (Focinál a hazai/vendég forma kritikus!)
        // 50/50 -> 70/30 (Venue javára)
        const SOCCER_VENUE_WEIGHT = 0.70; 
        
        const weightedValue = (venueGoals * SOCCER_VENUE_WEIGHT) + (overallGoals * (1 - SOCCER_VENUE_WEIGHT));
        
        return { value: weightedValue, used: true };
    }

    /**
     * === ÚJ (v127.0): HELPER - HOME ADVANTAGE SZÁMÍTÁS (LIGA-AWARE!) ===
     */
    private calculateHomeAdvantage(leagueCoefficient: number): number {
        // === v148.6: HOME ADVANTAGE MÉG ERŐSEBB TOLÁSA ===
        // A felhasználói visszajelzések alapján a rendszer alulértékelte a hazai pályát.
        // TOP ligák (>10): +0.65 (volt: +0.55)
        // Közepes (5-10): +0.55 (volt: +0.45)
        // Gyenge (<5): +0.45 (volt: +0.35)
        
        if (leagueCoefficient >= 10.0) {
            return 0.65; 
        } else if (leagueCoefficient >= 7.0) {
            return 0.55; 
        } else if (leagueCoefficient >= 4.0) {
            return 0.50; 
        } else {
            return 0.45; 
        }
    }

    /**
     * 1. Ügynök (Quant) feladata: Foci xG számítása.
     * FEJLESZTVE (v148.5): Derby Detection ÚJRA AKTIVÁLVA (Szoftabb)!
     */
    public estimatePureXG(options: XGOptions): { pure_mu_h: number; pure_mu_a: number; source: string; isDerby?: boolean; derbyName?: string; } {
        const { homeTeam, awayTeam, rawStats, leagueAverages, advancedData } = options;

        // === v148.5: DERBY DETECTION ÚJRA AKTIVÁLVA (Szoftabb) ===
        const derbyInfo = detectDerby(homeTeam, awayTeam); 
        if (derbyInfo.isDerby) {
            console.log(`[SoccerStrategy v148.5] 🔥 DERBY DETECTION AKTIVÁLVA: ${derbyInfo.derbyName}`);
        }

        // === ÚJ v130.0: Liga Defensive Multiplier lekérése ===
        const leagueName = (rawStats?.home as any)?.league || null;
        const leagueDefensiveMultiplier = getLeagueDefensiveMultiplier(leagueName);
        
        console.log(`[SoccerStrategy v134.0] Liga: "${leagueName}", Defensive Multiplier: ${leagueDefensiveMultiplier.toFixed(2)}`);

        // === P1 (Manuális) Adatok Ellenőrzése + VALIDATION (v130.0 ENHANCED) ===
        if (advancedData?.manual_H_xG != null && 
            advancedData?.manual_H_xGA != null && 
            advancedData?.manual_A_xG != null && 
            advancedData?.manual_A_xGA != null) {
            
            // === v127.0 VALIDATION: Manuális xG realitás ellenőrzés ===
            let h_xG = advancedData.manual_H_xG;
            let h_xGA = advancedData.manual_H_xGA;
            let a_xG = advancedData.manual_A_xG;
            let a_xGA = advancedData.manual_A_xGA;
            
            // 1. Érték tartomány ellenőrzés (0.1 - 5.0 között KELL lennie!)
            if (h_xG < 0.1 || h_xG > 5.0 || h_xGA < 0.1 || h_xGA > 5.0 ||
                a_xG < 0.1 || a_xG > 5.0 || a_xGA < 0.1 || a_xGA > 5.0) {
                console.warn(`[SoccerStrategy v130.0] ⚠️ INVALID MANUAL xG! Values out of range (0.1-5.0). Falling back to P2+.`);
                console.warn(`  Input: H_xG=${h_xG}, H_xGA=${h_xGA}, A_xG=${a_xG}, A_xGA=${a_xGA}`);
                // Fallback: skip P1, use P4/P2+
            } else {
                // === ÚJ v130.0: LEAGUE DEFENSIVE MULTIPLIER ALKALMAZÁSA ===
                h_xG *= leagueDefensiveMultiplier;
                h_xGA *= leagueDefensiveMultiplier;
                a_xG *= leagueDefensiveMultiplier;
                a_xGA *= leagueDefensiveMultiplier;
                
                console.log(`[SoccerStrategy v130.0] 🛡️ DEFENSIVE MULTIPLIER APPLIED (${leagueDefensiveMultiplier.toFixed(2)}x):`);
                console.log(`  Before: H_xG=${advancedData.manual_H_xG.toFixed(2)}, A_xG=${advancedData.manual_A_xG.toFixed(2)} (Total: ${(advancedData.manual_H_xG + advancedData.manual_A_xG).toFixed(2)})`);
                console.log(`  After:  H_xG=${h_xG.toFixed(2)}, A_xG=${a_xG.toFixed(2)} (Total: ${(h_xG + a_xG).toFixed(2)})`);
                
                // === v139.0: P1 MANUAL xG SANITY CHECK KIKAPCSOLVA (PURE AI MODE) ===
                // Hagyjuk, hogy a manuális xG értékek szabadon működjenek, ne korrigáljuk mesterségesen.
                // Ha valóban irreális az érték, az AI és a Specialist majd kezeli.
                // const p1_mu_h_raw = (h_xG + a_xGA) / 2;
                // const p1_mu_a_raw = (a_xG + h_xGA) / 2;
                // const totalExpectedGoals = p1_mu_h_raw + p1_mu_a_raw;
                // ... sanity check logika törölve ...
                
                // === v147.0: VICTORY PROTOCOL - P1 MANUAL XG WEIGHTING ===
                // A Felhasználó xG adatai az ABSZOLÚT IGAZSÁG.
                // 1.5x súlyozás a manuális adatoknak.
                const manual_weight = 1.5;
                const p1_mu_h = ((h_xG * manual_weight) + a_xGA) / (1 + manual_weight);
                const p1_mu_a = ((a_xG * manual_weight) + h_xGA) / (1 + manual_weight);
                
                console.log(`[SoccerStrategy v147.0] ✅ VICTORY PROTOCOL P1: mu_h=${p1_mu_h.toFixed(2)}, mu_a=${p1_mu_a.toFixed(2)} (Weight: ${manual_weight}x)`);
            
            return {
                pure_mu_h: p1_mu_h,
                pure_mu_a: p1_mu_a,
                    source: `Manual (Victory Protocol 1.5x xG Weight) [v147.0]`
            };
            }
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
                
                // Recent form (70% venue-specific, 30% overall)
                const VENUE_FORM_WEIGHT = 0.50; // v138.0: 0.70 → 0.50
                const recentHomeForm = this.getWeightedFormGoals(form?.home_overall, form?.home_form, VENUE_FORM_WEIGHT);
                const recentAwayForm = this.getWeightedFormGoals(form?.away_overall, form?.away_form, VENUE_FORM_WEIGHT);
                const recent_h_gf = recentHomeForm.value;
                const recent_a_gf = recentAwayForm.value;
                
                // === v138.0 FIX: FORMA SÚLY HELYREÁLLÍTVA (50/50) ===
                const RECENT_WEIGHT = 0.50;  // v138.0: 0.65 → 0.50 (VISSZAÁLLÍTVA)
                const SEASON_WEIGHT = 0.50;  // v138.0: 0.35 → 0.50 (VISSZAÁLLÍTVA)
                
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
                
                // === v139.2: KORLÁTOK LAZÍTVA - Csak extrém esetekben korrigálunk ===
                if (p4_mu_h < 0.1) p4_mu_h = 0.1;
                if (p4_mu_h > 6.0) p4_mu_h = 6.0;
                if (p4_mu_a < 0.1) p4_mu_a = 0.1;
                if (p4_mu_a > 6.0) p4_mu_a = 6.0;
                
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
        const VENUE_FORM_WEIGHT = 0.50; // v138.0: 0.70 → 0.50
        const recentHomeForm = this.getWeightedFormGoals(form?.home_overall, form?.home_form, VENUE_FORM_WEIGHT);
        const recentAwayForm = this.getWeightedFormGoals(form?.away_overall, form?.away_form, VENUE_FORM_WEIGHT);
        const recent_h_gf = recentHomeForm.value;
        const recent_a_gf = recentAwayForm.value;
        
        // 3. WEIGHTED AVERAGE - v138.0 FORMA SÚLY HELYREÁLLÍTVA!
        // ELŐTTE v137: 65/35 → Túl instabil!
        // UTÁNA v138: 50/50 → Kiegyensúlyozott!
        const RECENT_WEIGHT = 0.50;  // v138.0: 0.65 → 0.50 (VISSZAÁLLÍTVA)
        const SEASON_WEIGHT = 0.50;  // v138.0: 0.35 → 0.50 (VISSZAÁLLÍTVA)
        
        let weighted_h_gf = season_h_gf;
        let weighted_a_gf = season_a_gf;
        let formUsed = recentHomeForm.used || recentAwayForm.used;
        
        if (recent_h_gf !== null) {
            weighted_h_gf = (recent_h_gf * RECENT_WEIGHT) + (season_h_gf * SEASON_WEIGHT);
            formUsed = true;
            console.log(`[xG] Home GF (50/50 mix): Recent=${recent_h_gf.toFixed(2)}, Season=${season_h_gf.toFixed(2)}, Weighted=${weighted_h_gf.toFixed(2)}`);
        }
        
        if (recent_a_gf !== null) {
            weighted_a_gf = (recent_a_gf * RECENT_WEIGHT) + (season_a_gf * SEASON_WEIGHT);
            formUsed = true;
            console.log(`[xG] Away GF (50/50 mix): Recent=${recent_a_gf.toFixed(2)}, Season=${season_a_gf.toFixed(2)}, Weighted=${weighted_a_gf.toFixed(2)}`);
        }
        
        // === v127.0: LIGA MINŐSÉG FAKTOR SETUP ===
        const leagueNameFallback = advancedData?.league_name || leagueAverages?.league_name;
        let finalHomeCoeff = getLeagueCoefficient(leagueNameFallback);
        let finalAwayCoeff = getLeagueCoefficient(leagueNameFallback);
        
        // Ha KÜLÖNBÖZŐ ligák (pl. CL: Monaco vs Pafos)
        if (advancedData?.home_league_name) finalHomeCoeff = getLeagueCoefficient(advancedData.home_league_name);
        if (advancedData?.away_league_name) finalAwayCoeff = getLeagueCoefficient(advancedData.away_league_name);
        
        console.log(`[xG v127.0] Liga Coefficients: Home=${finalHomeCoeff.toFixed(2)}, Away=${finalAwayCoeff.toFixed(2)}`);
        
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
            // FALLBACK: Overall stats + HOME ADVANTAGE (LIGA-AWARE! v127.0)
            const HOME_ADVANTAGE = this.calculateHomeAdvantage(finalHomeCoeff);
            
            pure_mu_h = ((weighted_h_gf + season_a_ga) / 2) + HOME_ADVANTAGE;
            pure_mu_a = (weighted_a_gf + season_h_ga) / 2;
            
            sourceDetails = `P2+ (Liga-Aware Home Advantage: +${HOME_ADVANTAGE.toFixed(2)}${formUsed ? ', Form 50/50' : ''})`;
            console.log(`[xG v127.0] Home Advantage (+${HOME_ADVANTAGE.toFixed(2)}) alkalmazva: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        }
        
        // === v139.0: LIGA MINŐSÉG MÓDOSÍTÁS KIKAPCSOLVA (PURE AI MODE) ===
        // Hagyjuk, hogy az AI döntse el a liga minőség hatását, ne mesterségesen módosítsuk.
        // const homeLeagueModifier = calculateLeagueQualityModifier(finalHomeCoeff, finalAwayCoeff, true);
        // const awayLeagueModifier = calculateLeagueQualityModifier(finalHomeCoeff, finalAwayCoeff, false);
        // pure_mu_h += homeLeagueModifier;
        // pure_mu_a += awayLeagueModifier;
        
        // === v139.2: KORLÁTOK LAZÍTVA - Csak extrém esetekben korrigálunk ===
        // Csak akkor korrigálunk, ha valóban irreális (pl. <0.1 vagy >6.0 gól)
        // Hagyjuk, hogy a statisztika és az AI döntsön, ne mesterségesen korlátozzuk
        if (pure_mu_h < 0.1) pure_mu_h = 0.1; // Minimum 0.1 gól
        if (pure_mu_h > 6.0) pure_mu_h = 6.0; // Maximum 6.0 gól (extrém esetek)
        if (pure_mu_a < 0.1) pure_mu_a = 0.1;
        if (pure_mu_a > 6.0) pure_mu_a = 6.0;
        
        // === v148.5: DERBY REDUCTION (Szoftabb -10% xG) ===
        if (derbyInfo.isDerby) {
            const beforeReduction = pure_mu_h + pure_mu_a;
            // v148.5: 0.80 -> 0.90 (Csak 10% csökkenés, de detektáljuk!)
            const SOFT_DERBY_REDUCTION = 0.90;
            pure_mu_h *= SOFT_DERBY_REDUCTION;
            pure_mu_a *= SOFT_DERBY_REDUCTION;
            const afterReduction = pure_mu_h + pure_mu_a;
            
            console.log(`[SoccerStrategy v148.5] 🔥 DERBY REDUCTION APPLIED (Soft 0.90):`);
            console.log(`  Before: H=${(pure_mu_h / SOFT_DERBY_REDUCTION).toFixed(2)}, A=${(pure_mu_a / SOFT_DERBY_REDUCTION).toFixed(2)} (Total: ${beforeReduction.toFixed(2)})`);
            console.log(`  After:  H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)} (Total: ${afterReduction.toFixed(2)})`);
            
            sourceDetails += ` [DERBY: ${derbyInfo.derbyName}]`;
        }
        
        // === v139.0: HOME DOMINANCE FACTOR KIKAPCSOLVA (PURE AI MODE) ===
        // Hagyjuk, hogy az AI és a statisztika döntse el a hazai dominanciát, ne mesterségesen boostoljuk.
        // let homeDominanceFactor = 0;
        // if (hasHomeSplit && hasAwaySplit) {
        //     const homeWinRate = (rawStats.home.home_wins || 0) / (rawStats.home.home_gp || 1);
        //     const awayWinRate = (rawStats.away.away_wins || 0) / (rawStats.away.away_gp || 1);
        //     const awayLossRate = (rawStats.away.away_l || 0) / (rawStats.away.away_gp || 1);
        //     ...
        // }
        // pure_mu_h += homeDominanceFactor;
        
        return {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            source: sourceDetails,
            isDerby: derbyInfo.isDerby,
            derbyName: derbyInfo.derbyName || undefined
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
