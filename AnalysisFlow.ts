// FÁJL: AnalysisFlow.ts
// VERZIÓ: v104.0 ("Stratégia Refaktor")
// MÓDOSÍTÁS (v104.0):
// 1. REFaktor: A sportág-specifikus logikát (xG számítás, mikromodellek)
//    már nem ez a fájl, és nem is a Model.ts/AI_Service.ts kezeli.
// 2. HOZZÁADVA: Importálja a 'getSportStrategy'-t a 'StrategyFactory'-ból.
// 3. HOZZÁADVA: Létrehoz egy 'sportStrategy' objektumot a 'sport' string alapján.
// 4. MÓDOSÍTVA: A 'sportStrategy' objektumot átadja a
//    Model.estimatePureXG, Model.estimateAdvancedMetrics és
//    AI_Service.runStep_FinalAnalysis függvényeknek.
// 5. JAVÍTÁS: .js kiterjesztések hozzáadva az importokhoz (Node.js/TypeScript-hez).

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
    calculateValue,
    analyzeLineMovement
} from './Model.js';
// AI Szolgáltatás Importok
import {
    runStep_Psychologist, // (2.5 Ügynök - Pszichológus)
    runStep_Specialist,   // (3. Ügynök - AI Specialista)
    runStep_FinalAnalysis // (ÚJ Hibrid Főnök)
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 
// Önjavító Hurok importálása
import { getNarrativeRatings } from './LearningService.js';

// === ÚJ IMPORT A STRATÉGIÁKHOZ ===
import { getSportStrategy } from './strategies/StrategyFactory.js';
import type { ISportStrategy } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v104.0): Sportág-független Stratégia Minta bevezetve.
**************************************************************/

// Az új, strukturált JSON válasz
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
            psychologist: any; 
            specialist: { 
                mu_h: number, 
                mu_a: number, 
                log: string,  
                report: any   
            };
            // v103.5 Javítás (megtartva): 'finalReport' átnevezve 'strategist'-re
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
        // A 'recommendation' a 'strategist.master_recommendation' másolata
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
        
        const p1AbsenteesHash = manual_absentees ?
            `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        
        // v104.0 Cache kulcs (a refaktorálás miatt)
        analysisCacheKey = `analysis_v104.0_strategy_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
        
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
        
        // === ÚJ (v104.0): Stratégia objektum létrehozása ===
        console.log(`[Lánc 0/6] Stratégia Gyár: Elemzési stratégia kiválasztása a '${sport}' sportághoz...`);
        const sportStrategy: ISportStrategy = getSportStrategy(sport);
        // === VÉGE ===

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

        
        // === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
        console.log(`[Lánc 2.5/6] Pszichológus Ügynök: Narratív profilalkotás...`);
        const psychologistReport = await runStep_Psychologist({
            rawDataJson: rawData,
            homeTeamName: home,
            awayTeamName: away
        });
        const { psy_profile_home, psy_profile_away } = psychologistReport;
        console.log(`[Lánc 2.5/6] Pszichológus végzett.`);
        
        // === 2.6 LÉPÉS (ÖNJAVÍTÓ HUROK BEOLVASÁSA) ===
        console.log(`[Lánc 2.6/6] Önjavító Hurok: 7. Ügynök (Revizor) múltbeli tanulságainak beolvasása...`);
        const narrativeRatings = getNarrativeRatings();
        const homeNarrativeRating = narrativeRatings[home.toLowerCase()] || {};
        const awayNarrativeRating = narrativeRatings[away.toLowerCase()] || {};
        if (Object.keys(homeNarrativeRating).length > 0 || Object.keys(awayNarrativeRating).length > 0) {
            console.log(`[Lánc 2.6/6] Tanulságok betöltve. H: ${JSON.stringify(homeNarrativeRating)}, A: ${JSON.stringify(awayNarrativeRating)}`);
        } else {
            console.log(`[Lánc 2.6/6] Nincsenek múltbeli tanulságok a Narratív Cache-ben ehhez a párosításhoz.`);
        }
        // === HUROK BEOLVASVA ===

        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
        // === MÓDOSÍTÁS (v104.0): A 'sportStrategy' objektum átadása ===
        const { pure_mu_h, pure_mu_a, source: quantSource } = estimatePureXG(
            home, 
            away, 
            rawStats, 
            sport, 
            form, 
            leagueAverages, 
            advancedData,
            sportStrategy // Az új stratégia objektum
        );
        // === MÓDOSÍTÁS VÉGE ===
        console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // === 3. ÜGYNÖK (SPECIALISTA) ===
        console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása...`);
        
        const specialistInput = {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            quant_source: quantSource,
            rawDataJson: rawData, 
            sport: sport,
            psy_profile_home: psy_profile_home, 
            psy_profile_away: psy_profile_away,
            homeNarrativeRating: homeNarrativeRating,
            awayNarrativeRating: awayNarrativeRating
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
        // === MÓDOSÍTÁS (v104.0): A 'sportStrategy' objektum átadása ===
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(
            rawData, 
            sport, 
            leagueAverages,
            sportStrategy // Az új stratégia objektum
        );
        // === MÓDOSÍTÁS VÉGE ===
        const sim = simulateMatchProgress(
            mu_h, mu_a, 
            mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData
        );
        
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        sim.stat_confidence = modelConfidence; 
        
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners; sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Szimulátor végzett. (Modell bizalom: ${modelConfidence.toFixed(1)})`);


        // === 5/6. ÜGYNÖK (HIBRID FŐNÖK) ===
        console.log(`[Lánc 5/6] "Hibrid Főnök" hívása...`);
        
        // Interfész definiálása a bemenethez
        interface FinalAnalysisInput {
            matchData: { home: string; away: string; sport: string; leagueName: string; };
            rawDataJson: ICanonicalRawData; 
            specialistReport: any; // Agent 3
            simulatorReport: any;  // Agent 4 (Sim)
            psyReport: any;        // Agent 2.5
            valueBetsJson: any[];
            richContext: string;
            sportStrategy: ISportStrategy; // === ÚJ MEZŐ (v104.0) ===
        }

        const finalAnalysisInput: FinalAnalysisInput = {
            matchData: { home, away, sport, leagueName },
            rawDataJson: rawData,
            specialistReport: specialistReport, // Agent 3
            simulatorReport: sim,              // Agent 4
            psyReport: psychologistReport,     // Agent 2.5
            valueBetsJson: valueBets,
            richContext: richContext,
            sportStrategy: sportStrategy // === ÚJ STRATÉGIA OBJEKTUM ÁTADVA ===
        };

        const finalReport: any = await runStep_FinalAnalysis(finalAnalysisInput);

        if (finalReport.error) {
            console.error("A Hibrid Főnök hibát adott vissza:", finalReport.error);
            throw new Error(finalReport.error);
        }
        
        const masterRecommendation = finalReport?.master_recommendation;
        let finalConfidenceScore = 1.0; 
        
        if (masterRecommendation && typeof masterRecommendation.final_confidence === 'number') {
            finalConfidenceScore = masterRecommendation.final_confidence;
        } else {
            console.error("KRITIKUS HIBA: A Hibrid Főnök nem adott vissza érvényes 'final_confidence' számot! 1.0-ra állítva.");
        }
        // === Hibrid Főnök Végzett ===

        console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)} (Végső bizalom: ${finalConfidenceScore})`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ?
                (manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // "EXTRA Karcsúsított" 'auditData' a Google Sheets limit miatt
        const auditData = {
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
                    specialist_mu: { mu_h: mu_h, mu_a: mu_a } // Csak a módosított xG
                },
                matchData: {
                    home, 
                    away, 
                    sport, 
                    mainTotalsLine: sim.mainTotalsLine,
                    mu_h: sim.mu_h_sim,
                    mu_a: sim.mu_a_sim
                },
                valueBets: valueBets, 
                modelConfidence: parseFloat(modelConfidence.toFixed(1)),
                finalConfidenceScore: parseFloat(finalConfidenceScore.toFixed(1)),
                sim: {
                    pHome: sim.pHome, pDraw: sim.pDraw, pAway: sim.pAway,
                    pOver: sim.pOver, pUnder: sim.pUnder, pBTTS: sim.pBTTS,
                    topScore: sim.topScore
                },
                recommendation: masterRecommendation,
                narrativeRatingsUsed: {
                    home: homeNarrativeRating,
                    away: awayNarrativeRating
                }
            }
        };
        
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: {
                    quant: auditData.analysisData.committee.quant,
                    psychologist: psychologistReport, 
                    specialist: { 
                        mu_h: mu_h, 
                        mu_a: mu_a, 
                        log: specialistReport.reasoning,  
                        report: specialistReport   
                    },
                    // v103.5 Javítás (megtartva)
                    strategist: finalReport 
                },
                matchData: auditData.analysisData.matchData,
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: auditData.analysisData.modelConfidence,
                finalConfidenceScore: auditData.analysisData.finalConfidenceScore,
                sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource, 
                availableRosters: availableRosters
            },
            debugInfo: debugInfo 
        };

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        
        // Mentés a Google Sheet-be (aszinkron módon)
        saveAnalysisToSheet({
            sport, 
            home, 
            away, 
            date: new Date(), 
            html: `<pre style="white-space: pre-wrap;">${JSON.stringify(auditData, null, 2)}</pre>`, 
            JSON_Data: JSON.stringify(auditData),
            id: analysisCacheKey,
            fixtureId: fixtureIdForSaving,
            recommendation: masterRecommendation
        })
            .then(() => console.log(`Elemzés (JSON) mentve a Google Sheet-be (${analysisCacheKey})`))
            .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));

        return jsonResponse;
    } catch (error: any) {
        const homeParam = params?.home || 'N-A';
        const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}
