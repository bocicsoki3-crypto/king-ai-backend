// FÁJL: AnalysisFlow.ts
// VERZIÓ: v93.0 ("Piac-Tudatos Pszichológus" Lánc)
// MÓDOSÍTÁS (v93.0):
// 1. IMPORT: Behozza az új `runStep_Psychologist`-t (2.5 Ügynök).
// 2. ELTÁVOLÍTVA: A primitív `calculatePsychologicalProfile` hívásai törölve.
// 3. HOZZÁADVA: A 2. Ügynök (Scout) után azonnal meghívja a 2.5-ös Ügynököt
//    (Pszichológus), hogy narratív profilt alkosson.
// 4. MÓDOSÍTVA: A `criticInput` (5. Ügynök) megkapja a `marketIntel`-t
//    (a "Piaci Vészjelző" aktiválásához).
// 5. MÓDOSÍTVA: A 3-as, 5-ös és 6-os Ügynökök (Specialista, Kritikus, Stratéga)
//    már a 2.5-ös Ügynök narratív (string) profilját kapják meg, nem a régi
//    primitív indexet.
// 6. MÓDOSÍTVA: A Cache kulcs `v93.0_market_aware_psych`-ra.

import NodeCache from 'node-cache';
import { SPORT_CONFIG } from './config.js';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds,
    IPlayerStub 
} from './src/types/canonical.d.ts';
// A 'findMainTotalsLine'-t a központi 'utils' fájlból importáljuk
import { findMainTotalsLine } from './providers/common/utils.js';
// Adatgyűjtő funkciók (2. Ügynök - Scout)
import { 
    getRichContextualData, 
    type IDataFetchOptions, 
    type IDataFetchResponse 
} from './DataFetch.js';
// Statisztikai modellek (1. és 4. Ügynök)
import {
    estimatePureXG,           // (1. Ügynök - Quant)
    estimateAdvancedMetrics,
    simulateMatchProgress,    // (4. Ügynök - Szimulátor)
    calculateModelConfidence,
    // calculatePsychologicalProfile, // ELTÁVOLÍTVA (v93.0)
    calculateValue,
    analyzeLineMovement
} from './Model.js';
// AI Szolgáltatás Importok (2.5, 3, 5, 6. Ügynökök)
import {
    runStep_Psychologist, // ÚJ (2.5 Ügynök - Pszichológus)
    runStep_Specialist,   // (3. Ügynök - AI Specialista)
    runStep_Critic,       // (5. Ügynök - Kritikus)
    runStep_Strategist    // (6. Ügynök - Stratéga)
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v93.0): A teljes AI lánc frissítve a "Piac-Tudatos Pszichológus"
* modellre, amely magában foglalja a 2.5-ös Ügynököt és a piaci vészjelzőket.
**************************************************************/

// Az új, strukturált JSON válasz
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
            psychologist: any; // ÚJ (v93.0)
            specialist: { 
                mu_h: number, 
                mu_a: number, 
                log: string,  
                report: any   
            };
            critic: any;
            strategist: any;
        };
        matchData: {
            home: string;
            away: string;
            sport: string;
            mainTotalsLine: number | string;
            mu_h: number | string; 
            mu_a: number | string;
        };
        oddsData: ICanonicalOdds | null;
        valueBets: any[];
        modelConfidence: number; 
        finalConfidenceScore: number; 
        sim: any; 
        recommendation: any;
        xgSource: string; 
        availableRosters: {
            home: IPlayerStub[];
            away: IPlayerStub[];
        };
    };
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

// === Segédfüggvény a tizedesvesszők kezelésére (Változatlan) ===
function safeConvertToNumber(value: any): number | null {
    if (value == null || value === '') { 
        return null;
    }
    let strValue = String(value);
    strValue = strValue.replace(',', '.');
    const num = Number(strValue);
    if (isNaN(num)) {
        console.warn(`[AnalysisFlow] HIBÁS BEMENET: Nem sikerült számmá alakítani: "${value}"`);
        return null;
    }
    return num;
}

export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse | IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    try {
        const { 
            home: rawHome, 
            away: rawAway, 
            force: forceNewStr, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            manual_H_xG, 
            manual_H_xGA,
            manual_A_xG, 
            manual_A_xGA,
            manual_absentees
        } = params;

        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        
        // === MÓDOSÍTVA (v93.0) ===
        const p1AbsenteesHash = manual_absentees ?
            `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        // Új cache kulcs
        analysisCacheKey = `analysis_v93.0_market_aware_psych_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
        // === MÓDOSÍTÁS VÉGE ===
        
        if (!forceNew) {
            const cachedResult = scriptCache.get<IAnalysisResponse>(analysisCacheKey);
            if (cachedResult) {
                console.log(`Cache találat (${analysisCacheKey})`);
                return cachedResult;
            } else {
                console.log(`Nincs cache (${analysisCacheKey}), friss elemzés indul...`);
            }
        } else {
            console.log(`Újraelemzés kényszerítve (${analysisCacheKey})`);
        }

        // --- 1. Alapkonfiguráció ---
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) {
            throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);
        }

        // === 2. ÜGYNÖK (SCOUT): Kontextus, Piac és P1 Kezelése ===
        console.log(`[Lánc 2/6] Scout Ügynök: Kontextus és Piac lekérése...`);
        const dataFetchOptions: IDataFetchOptions = {
            sport: sport,
            homeTeamName: home,
            awayTeamName: away,
            leagueName: leagueName,
            utcKickoff: utcKickoff,
            forceNew: forceNew,
            manual_H_xG: safeConvertToNumber(manual_H_xG),
            manual_H_xGA: safeConvertToNumber(manual_H_xGA),
            manual_A_xG: safeConvertToNumber(manual_A_xG),
            manual_A_xGA: safeConvertToNumber(manual_A_xGA),
            manual_absentees: manual_absentees 
        };
        // A 'getRichContextualData' (Scout) most már kezeli a P1 hibatűrést (v93.0)
        const { 
            rawStats, 
            richContext,
            advancedData,
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource,
            availableRosters
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions);
        // === Scout Végzett ===
        
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Piaci adatok előkészítése (Scout adatából) ---
        let mutableOddsData: ICanonicalOdds | null = oddsData;
        if (!mutableOddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez.`);
            mutableOddsData = { 
                current: [], 
                allMarkets: [], 
                fromCache: false, 
                fullApiData: null 
            };
        }

        const marketIntel = analyzeLineMovement(mutableOddsData, openingOdds, sport, home);
        const mainTotalsLine = findMainTotalsLine(mutableOddsData, sport) || sportConfig.totals_line;
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);

        // === ELTÁVOLÍTVA (v93.0): Primitív pszichológiai profilok ===
        // const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        // const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // === ÚJ (v93.0): 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
        console.log(`[Lánc 2.5/6] Pszichológus Ügynök: Narratív profilalkotás...`);
        const psychologistReport = await runStep_Psychologist({
            rawDataJson: rawData,
            homeTeamName: home,
            awayTeamName: away
        });
        // Kinyerjük az AI által generált narratív profilokat
        const { psy_profile_home, psy_profile_away } = psychologistReport;
        console.log(`[Lánc 2.5/6] Pszichológus végzett.`);
        // === PSZICHOLÓGUS VÉGZETT ===
        
        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
        const { pure_mu_h, pure_mu_a, source: quantSource } = estimatePureXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData
        );
        console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // === MÓDOSÍTVA (v93.0): 3. ÜGYNÖK (SPECIALISTA) - AI HÍVÁS ===
        console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása (v93.0)...`);
        
        const specialistInput = {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            quant_source: quantSource,
            rawDataJson: rawData, // A 2. Ügynök teljes kontextusa
            sport: sport,
            psy_profile_home: psy_profile_home, // (v93.0) Átadva a v93-as promptnak
            psy_profile_away: psy_profile_away  // (v93.0) Átadva a v93-as promptnak
        };
        const specialistReport = await runStep_Specialist(specialistInput);

        const { 
            modified_mu_h: mu_h, 
            modified_mu_a: mu_a 
        } = specialistReport; 
        
        console.log(`Specialista (AI) (Súlyozott xG): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        // === MÓDOSÍTÁS VÉGE ===

        const finalXgSource = xgSource;

        // === 4. ÜGYNÖK (SZIMULÁTOR): Meccs szimulálása ===
        console.log(`[Lánc 4/6] Szimulátor Ügynök: 25000 szimuláció futtatása...`);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        const sim = simulateMatchProgress(
            mu_h, mu_a, // Az AI Specialista SÚLYOZOTT kimenete alapján
            mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData
        );
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Szimulátor végzett. (Modell bizalom: ${modelConfidence.toFixed(1)})`);

        // === MÓDOSÍTVA (v93.0): 5. ÜGYNÖK (PIAC-TUDATOS KRITIKUS) ===
        console.log(`[Lánc 5/6] Kritikus Ügynök: Ellentmondások keresése (v93.0 - Piac-Tudatos)...`);
        
        const criticInput = {
            simJson: sim,
            marketIntel: marketIntel, // HOZZÁADVA (v93.0): A "Piaci Vészjelző"
            rawDataJson: rawData,
            modelConfidence: parseFloat(modelConfidence.toFixed(1)), 
            valueBetsJson: valueBets,
            psy_profile_home: psy_profile_home, // MÓDOSÍTVA (v93.0)
            psy_profile_away: psy_profile_away  // MÓDOSÍTVA (v93.0)
        };
        const criticReport = await runStep_Critic(criticInput);
        
        // A kimenet mélyebb objektumban van (v93)
        const finalConfidenceFromCritic = criticReport?.final_confidence_report?.final_confidence_score || 1.0;
        console.log(`[Lánc 5/6] Kritikus végzett. Végső (Piac-Tudatos) Bizalmi Pontszám: ${finalConfidenceFromCritic.toFixed(2)}`);
        // === MÓDOSÍTÁS VÉGE ===

        // === MÓDOSÍTVA (v93.0): 6. ÜGYNÖK (STRATÉGA) ===
        console.log(`[Lánc 6/6] Stratéga Ügynök: Végső döntés meghozatala (v93.0)...`);
        
        const strategistInput = {
            matchData: { home, away, sport, leagueName },
            quantReport: { pure_mu_h: pure_mu_h, pure_mu_a: pure_mu_a, source: quantSource },
            specialistReport: specialistReport, 
            simulatorReport: sim,
            criticReport: criticReport, // Ez már a v93-as Piac-Tudatos riport
            modelConfidence: parseFloat(modelConfidence.toFixed(1)),
            rawDataJson: rawData,
            realXgJson: { 
                manual_H_xG: advancedData?.manual_H_xG ?? null,
                manual_H_xGA: advancedData?.manual_H_xGA ?? null,
                manual_A_xG: advancedData?.manual_A_xG ?? null,
                manual_A_xGA: advancedData?.manual_A_xGA ?? null
            },
            psy_profile_home: psy_profile_home, // MÓDOSÍTVA (v93.0)
            psy_profile_away: psy_profile_away  // MÓDOSÍTVA (v93.0)
        };

        const strategistReport = await runStep_Strategist(strategistInput);
        
        if (strategistReport.error) {
            console.error("A Stratéga (6. Ügynök) hibát adott vissza:", strategistReport.error);
        }
        
        const masterRecommendation = strategistReport?.master_recommendation;
        let finalConfidenceScore = 1.0; // Alapértelmezett hiba esetén
        
        if (masterRecommendation && typeof masterRecommendation.final_confidence === 'number') {
            finalConfidenceScore = masterRecommendation.final_confidence;
        } else {
            console.error("KRITIKUS HIBA: A Stratéga (6. Ügynök) nem adott vissza érvényes 'final_confidence' számot! 1.0-ra állítva.");
        }
        // === MÓDOSÍTÁS VÉGE ===

        console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)} (Végső bizalom: ${finalConfidenceScore})`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ?
                (manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // A karcsúsított (lean) adatok mentése a Sheets 50k limit miatt
        const auditData = {
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
                    psychologist: psychologistReport, // HOZZÁADVA (v93.0)
                    specialist: { mu_h: mu_h, mu_a: mu_a, log: specialistReport.reasoning, report: specialistReport },
                    critic: criticReport,
                    strategist: strategistReport
                },
                matchData: {
                    home, 
                    away, 
                    sport, 
                    mainTotalsLine: sim.mainTotalsLine,
                    mu_h: sim.mu_h_sim,
                    mu_a: sim.mu_a_sim
                },
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: parseFloat(modelConfidence.toFixed(1)),
                finalConfidenceScore: parseFloat(finalConfidenceScore.toFixed(1)),
                sim: {
                    pHome: sim.pHome, pDraw: sim.pDraw, pAway: sim.pAway,
                    pOver: sim.pOver, pUnder: sim.pUnder, pBTTS: sim.pBTTS,
                    topScore: sim.topScore
                },
                recommendation: masterRecommendation
            }
        };
        
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: auditData.analysisData.committee,
                matchData: auditData.analysisData.matchData,
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: auditData.analysisData.modelConfidence,
                finalConfidenceScore: auditData.analysisData.finalConfidenceScore,
                sim: sim, // A teljes sim objektum a UI számára
                recommendation: masterRecommendation,
                xgSource: finalXgSource, 
                availableRosters: availableRosters
            },
            debugInfo: debugInfo 
        };

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: `<pre style="white-space: pre-wrap;">${JSON.stringify(auditData, null, 2)}</pre>`, // Karcsúsított JSON mentése
                id: analysisCacheKey,
                fixtureId: fixtureIdForSaving,
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés (JSON) mentve a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
        }

        return jsonResponse;
    } catch (error: any) {
        const homeParam = params?.home || 'N-A';
        const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}
