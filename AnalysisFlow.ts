// FÁJL: AnalysisFlow.ts
// VERZIÓ: v71.2 (Karcsúsított JSON Mentés)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (Google API 50k Limit Hiba): A 'saveAnalysisToSheet' (300. sor környéke)
//    már nem a teljes 'jsonResponse'-t menti.
// 2. LOGIKA: Létrehoz egy 'auditData' objektumot, ami csak az Auditor
//    számára szükséges adatokat tartalmazza (az ügynökök jelentéseit),
//    kihagyva a nagy méretű 'rawData' és 'sim' objektumokat.

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
// v54.16 importok (1., 3., 4. Ügynökök)
import {
    estimatePureXG,
    estimateAdvancedMetrics,
    simulateMatchProgress,
    calculateModelConfidence,
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement,
    analyzePlayerDuels
} from './Model.js';
// AI Szolgáltatás Importok (5. és 6. Ügynökök)
import {
    runStep_Specialist, // 3. Ügynök (AI)
    runStep_Critic,     // 5. Ügynök
    runStep_Strategist  // 6. Ügynök
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 

const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v71.2):
* - A 3. Ügynök (Okos Specialista) aktív.
* - A 'JSON_Data' mentés karcsúsítva a Google 50k limitjének való megfeleléshez.
* **************************************************************/

// Az új, strukturált JSON válasz (Változatlan v71.1)
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
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
        xgSource: string; // v71.1 javítás
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

// Segédfüggvény (Változatlan)
function safeConvertToNumber(value: any): number |
null {
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


export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse |
IAnalysisError> {
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
        
        // MÓDOSÍTVA (v71.2): Cache kulcs
        const p1AbsenteesHash = manual_absentees ?
`_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        analysisCacheKey = `analysis_v71.2_lean_save_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
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

        // === 2. ÜGYNÖK (SCOUT): Kontextus, Piac és P1 Hiányzók Kezelése ===
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
        
        // (v75.0) Ez a hívás már a redundáns odds logikát is tartalmazza
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
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions, analysisCacheKey);
// === Scout Végzett ===
        
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
}

        // --- 3. Piaci adatok előkészítése (Scout adatából) ---
        let mutableOddsData: ICanonicalOdds |
null = oddsData;
        if (!mutableOddsData || !mutableOddsData.allMarkets || mutableOddsData.allMarkets.length === 0) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez. (A v75.0 fallback is sikertelen volt).`);
mutableOddsData = { 
                current: [], 
                allMarkets: [], 
                fromCache: false, 
                fullApiData: null 
            };
}

        const marketIntel = analyzeLineMovement(mutableOddsData, openingOdds, sport, home);
const mainTotalsLine = findMainTotalsLine(mutableOddsData, sport) || sportConfig.totals_line;
        
        // === MÓDOSÍTÁS (v71.2): Logolás javítása, ha a 'findMainTotalsLine' hibát dob ===
        if (mainTotalsLine === sportConfig.totals_line) {
            console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine} (Alapértelmezett)`);
        } else {
            console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);
        }
        // === MÓDOSÍTÁS VÉGE ===

        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
const { pure_mu_h, pure_mu_a, source: quantSource } = estimatePureXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData
        );
console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // === 3. ÜGYNÖK (SPECIALISTA) - AI HÍVÁS (v70.0) ===
        console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása...`);
        
        const specialistInput = {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            quant_source: quantSource,
            rawDataJson: rawData, // A 2. Ügynök teljes kontextusa
            sport: sport,
            psyProfileHome: psyProfileHome,
            psyProfileAway: psyProfileAway
        };
        const specialistReport = await runStep_Specialist(specialistInput);

        const { 
            modified_mu_h: mu_h,
            modified_mu_a: mu_a 
        } = specialistReport; 
        
        console.log(`Specialista (AI) (Súlyozott xG): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        
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

        // === 5. ÜGYNÖK (KRITIKUS): Ellentmondások keresése ===
        console.log(`[Lánc 5/6] Kritikus Ügynök: Ellentmondások keresése...`);
const criticInput = {
            simJson: sim,
            marketIntel: marketIntel,
            rawDataJson: rawData,
            modelConfidence: modelConfidence,
            valueBetsJson: valueBets
        };
const criticReport = await runStep_Critic(criticInput);
        const contradictionScore = criticReport?.contradiction_score || 0.0;
console.log(`[Lánc 5/6] Kritikus végzett. Kockázati Pontszám: ${contradictionScore.toFixed(2)}`);

        // === 6. ÜGYNÖK (STRATÉGA): Végső döntés ===
        console.log(`[Lánc 6/6] Stratéga Ügynök: Végső döntés meghozatala...`);
const strategistInput = {
            matchData: { home, away, sport, leagueName },
            quantReport: { pure_mu_h: pure_mu_h, pure_mu_a: pure_mu_a, source: quantSource },
            specialistReport: specialistReport, 
            simulatorReport: sim,
            criticReport: criticReport, 
            modelConfidence: modelConfidence, 
            rawDataJson: rawData,
            realXgJson: { 
                manual_H_xG: advancedData?.manual_H_xG ?? null,
                manual_H_xGA: advancedData?.manual_H_xGA ?? null,
                manual_A_xG: advancedData?.manual_A_xG ?? null,
                manual_A_xGA: advancedData?.manual_A_xGA ?? null
            }
        };

const strategistReport = await runStep_Strategist(strategistInput);
        
        if (strategistReport.error) {
            console.error("A Stratéga (6. Ügynök) hibát adott vissza:", strategistReport.error);
}
        
        const masterRecommendation = strategistReport.master_recommendation;
        let finalConfidenceScore = 1.0; 
        if (masterRecommendation && typeof masterRecommendation.final_confidence === 'number') {
            finalConfidenceScore = masterRecommendation.final_confidence;
        } else {
            console.error("KRITIKUS HIBA: A Stratéga (6. Ügynök) nem adott vissza érvényes 'final_confidence' számot! 1.0-ra állítva.");
        }

console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)} (Végső bizalom: ${finalConfidenceScore})`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ?
(manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ??
'Ismeretlen'
        };
        
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
                    specialist: { 
                        mu_h: mu_h, 
                        mu_a: mu_a, 
                        log: specialistReport.reasoning, 
                        report: specialistReport 
                    },
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
                modelConfidence: modelConfidence, 
                finalConfidenceScore: parseFloat(finalConfidenceScore.toFixed(1)), 
                sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource,
                availableRosters: availableRosters 
       },
            debugInfo: debugInfo 
        };

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        
        // === MÓDOSÍTÁS (v71.2): KARCSÚSÍTOTT JSON MENTÉS ===
if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            
            // Létrehozzuk a "karcsúsított" objektumot az Auditor számára.
            // Kihagyjuk a 'sim', 'rawData', 'oddsData' és 'availableRosters' mezőket.
            const auditData = {
                analysisData: {
                    committee: jsonResponse.analysisData.committee,
                    matchData: jsonResponse.analysisData.matchData,
                    modelConfidence: jsonResponse.analysisData.modelConfidence,
                    finalConfidenceScore: jsonResponse.analysisData.finalConfidenceScore,
                    recommendation: jsonResponse.analysisData.recommendation,
                    xgSource: jsonResponse.analysisData.xgSource
                },
                debugInfo: jsonResponse.debugInfo
            };

            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: `JSON_API_MODE (v71.2 Lean Save) (xG Forrás: ${finalXgSource})`,
                JSON_Data: JSON.stringify(auditData), // <--- A KULCSMÓDOSÍTÁS
                id: analysisCacheKey,
                fixtureId: fixtureIdForSaving,
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés (JSON) mentve a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
}
        // === MÓDOSÍTÁS VÉGE ===

        return jsonResponse;
} catch (error: any) {
        const homeParam = params?.home || 'N-A';
const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
return { error: `Elemzési hiba: ${error.message}` };
    }
}