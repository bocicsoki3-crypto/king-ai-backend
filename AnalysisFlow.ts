// FÁJL: AnalysisFlow.ts
// VERZIÓ: v63.0 (6 Fős Bizottsági Lánc - 1. Lépés)
// MÓDOSÍTÁS:
// 1. A 'runFullAnalysis' TELJESEN ÁTÍRVA, hogy a 6 Fős Bizottsági Láncot kövesse.
// 2. A "Dupla Számítás" hiba megszüntetve.
// 3. TÖRÖLVE: A 'runStep_UnifiedAnalysis' import és hívás (ez okozta a hibát).
// 4. ÚJ IMPORT: 'estimatePureXG' és 'applyContextualModifiers' (a 'Model.ts'-ből).
// 5. ÚJ IMPORT: 'runStep_Critic' és 'runStep_Strategist' (az 'AI_Service.ts'-ből).
// 6. A P1 Manuális Hiányzók ('manual_absentees') most már helyesen kerülnek átadásra a 'DataFetch' (2. Ügynök) felé.

import NodeCache from 'node-cache';
import { SPORT_CONFIG } from './config.js';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds,
    IPlayerStub // ÚJ (v62.1)
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
    // === MÓDOSÍTÁS (6 FŐS BIZOTTSÁG) ===
    estimatePureXG,           // ÚJ (1. Ügynök - Quant)
    applyContextualModifiers, // ÚJ (3. Ügynök - Specialista)
    // =================================
    estimateAdvancedMetrics,
    simulateMatchProgress,    // (4. Ügynök - Szimulátor)
    calculateModelConfidence,
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement,
    analyzePlayerDuels
} from './Model.js';
// AI Szolgáltatás Importok (5. és 6. Ügynökök)
import {
    // === MÓDOSÍTÁS (6 FŐS BIZOTTSÁG) ===
    runStep_Critic,     // ÚJ (5. Ügynök - Kritikus)
    runStep_Strategist  // ÚJ (6. Ügynök - Stratéga)
    // 'runStep_UnifiedAnalysis' TÖRÖLVE
    // =================================
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v63.0):
* - Átállás a 6 Fős Bizottsági Lánc architektúrára.
**************************************************************/

// Az új, strukturált JSON válasz (MÓDOSÍTVA v63.0)
interface IAnalysisResponse {
    analysisData: {
        // MÓDOSÍTÁS: A 'committeeResults' mostantól strukturált
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
            specialist: { mu_h: number, mu_a: number, log: any };
            critic: any;
            strategist: any;
        };
        matchData: {
            home: string;
            away: string;
            sport: string;
            mainTotalsLine: number | string;
            mu_h: number | string; // Ez a SÚLYOZOTT (Specialista) xG
            mu_a: number | string;
        };
        oddsData: ICanonicalOdds | null;
        valueBets: any[];
        modelConfidence: number;
        sim: any; 
        recommendation: any;
        xgSource: 'Manual (Direct)' | 'Manual (Components)' | 'API (Real)' | 'Calculated (Fallback)';
        // === ÚJ (v62.1) ===
        availableRosters: {
            home: IPlayerStub[];
            away: IPlayerStub[];
        };
        // === VÉGE ===
    };
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

// === Segédfüggvény a tizedesvesszők kezelésére (Változatlan) ===
/**
 * Biztonságosan konvertál egy stringet (akár ','-vel) számmá.
 * Helyesen kezeli a 0-t, null-t, és a "0,9" formátumot.
 */
function safeConvertToNumber(value: any): number | null {
    if (value == null || value === '') { // Kezeli a null, undefined, ""
        return null;
    }
    
    let strValue = String(value);
    
    // A kritikus hiba javítása: ',' -> '.'
    strValue = strValue.replace(',', '.');
    
    const num = Number(strValue);
    
    // Ha a konverzió után 'NaN', akkor adjon null-t vissza
    if (isNaN(num)) {
        console.warn(`[AnalysisFlow] HIBÁS BEMENET: Nem sikerült számmá alakítani: "${value}"`);
        return null;
    }
    
    // Helyesen adja vissza a 0-t vagy a konvertált számot
    return num;
}
// === JAVÍTÁS VÉGE ===


export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse | IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    try {
        // === v63.0: P1 Komponens és P1 Hiányzók olvasása ===
        const { 
            home: rawHome, 
            away: rawAway, 
            force: forceNewStr, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            // P1 (Komponens)
            manual_H_xG, 
            manual_H_xGA,
            manual_A_xG, 
            manual_A_xGA,
            // P1 (Hiányzók)
            manual_absentees // <- MÓDOSÍTÁS (6 FŐS BIZOTTSÁG)
        
        } = params;
        // === Olvasás Vége ===

        if (!rawHome || !away || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        
        // Cache kulcs (v63.0) - Figyelembe veszi a P1 hiányzókat
        const p1AbsenteesHash = manual_absentees ? 
            `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        analysisCacheKey = `analysis_v63.0_chain_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
        
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
  
            // P1 (Komponens) (v61.0)
            manual_H_xG: safeConvertToNumber(manual_H_xG),
            manual_H_xGA: safeConvertToNumber(manual_H_xGA),
            manual_A_xG: safeConvertToNumber(manual_A_xG),
            manual_A_xGA: safeConvertToNumber(manual_A_xGA),
            
            // P1 (Hiányzók) (v63.0)
            manual_absentees: manual_absentees 
        };
        // A 'getRichContextualData' (Scout) most már kezeli a 'manual_absentees' (Plan A/B) logikát
        const { 
            rawStats, 
            richContext,
            advancedData,
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource,
            availableRosters // <- (v62.1)
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

        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
        const { pure_mu_h, pure_mu_a, source: quantSource } = estimatePureXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData // Ez tartalmazza a P1-es 4-komponensű adatokat
        );
        console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // === 3. ÜGYNÖK (SPECIALISTA): Kontextuális módosítók alkalmazása ===
        console.log(`[Lánc 3/6] Specialista Ügynök: Kontextuális módosítók alkalmazása...`);
        const { mu_h, mu_a, modifierLog } = applyContextualModifiers(
            pure_mu_h, pure_mu_a, // A Quant kimenete
            quantSource, // Az 1. Ügynök forrása (a "Dupla Számítás" elkerüléséhez)
            rawData, // A Scout kimenete
            sport, 
            psyProfileHome, 
            psyProfileAway,
            null
        );
        console.log(`Specialista (Súlyozott xG): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        // === Specialista Végzett ===

        const finalXgSource = xgSource;
        
        // === 4. ÜGYNÖK (SZIMULÁTOR): Meccs szimulálása ===
        console.log(`[Lánc 4/6] Szimulátor Ügynök: 25000 szimuláció futtatása...`);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        const sim = simulateMatchProgress(
            mu_h, mu_a, // A Specialista SÚLYOZOTT kimenete alapján
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

        // === 6. ÜGYNÖK (STRATÉGA): Végső döntés ===
        console.log(`[Lánc 6/6] Stratéga Ügynök: Végső döntés meghozatala...`);
        const strategistInput = {
            matchData: { home, away, sport, leagueName },
            quantReport: { pure_mu_h: pure_mu_h, pure_mu_a: pure_mu_a, source: quantSource },
            specialistReport: { mu_h: mu_h, mu_a: mu_a, log: modifierLog },
            simulatorReport: sim,
            criticReport: criticReport, // Az 5. Ügynök jelentése
            modelConfidence: modelConfidence,
            rawDataJson: rawData,
            realXgJson: { // A P1 "Tiszta" xG átadása
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
        console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)}`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ? 
                (manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // === A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA (MÓDOSÍTVA v63.0) ===
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
                    specialist: { mu_h: mu_h, mu_a: mu_a, log: modifierLog },
                    critic: criticReport,
                    strategist: strategistReport
                },
                matchData: {
                    home, 
                    away, 
                    sport, 
                    mainTotalsLine: sim.mainTotalsLine,
                    mu_h: sim.mu_h_sim, // Súlyozott xG
                    mu_a: sim.mu_a_sim // Súlyozott xG
                 },
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: modelConfidence,
                sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource,
                
                // === (v62.1) ===
                availableRosters: availableRosters 
            },
            debugInfo: debugInfo 
        };
        // === MÓDOSÍTÁS VÉGE ===

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: `JSON_API_MODE (v63.0 Lánc) (xG Forrás: ${finalXgSource})`,
                id: analysisCacheKey,
                fixtureId: fixtureIdForSaving,
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés (JSON) mentve a Google Sheet-be (${analysisCacheKey})`))
                 .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
        }

        return jsonResponse;
    } catch (error: any) {
        const homeParam = params?.home || 'N/A';
        const awayParam = params?.away || 'N/A';
        const sportParam = sport || params?.sport || 'N/A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}
