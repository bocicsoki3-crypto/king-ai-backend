// FÁJL: AnalysisFlow.ts
// VERZIÓ: v81.0 ("Taktikai Kritikus" Logika)
// MÓDOSÍTÁS (v81.0):
// 1. JAVÍTVA: A 5. Ügynök (Kritikus) hívása (kb. 300. sor).
// 2. HOZZÁADVA: A `psyProfileHome` és `psyProfileAway` változók átadása
//    a `criticInput`-nak, hogy az AI "taktikai" elemzést végezhessen.
// 3. MÓDOSÍTVA: A Cache kulcs `v81.0_tactical_fix`-re.

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
    estimatePureXG,           // ÚJ (1. Ügynök - Quant)
    estimateAdvancedMetrics,
    simulateMatchProgress,    // (4. Ügynök - Szimulátor)
    calculateModelConfidence,
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement
} from './Model.js';
// AI Szolgáltatás Importok (5. és 6. Ügynökök)
import {
    runStep_Specialist, // ÚJ (3. Ügynök - AI Specialista)
    runStep_Critic,     // ÚJ (5. Ügynök - Kritikus)
    runStep_Strategist  // ÚJ (6. Ügynök - Stratéga)
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v81.0): Az 5. Ügynök (Kritikus) "bekötése" a pszichológiai adatokkal
* **************************************************************/

// Az új, strukturált JSON válasz (MÓDOSÍTVA v70.0)
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
            specialist: { // Ez most már az AI Specialista jelentése
                mu_h: number, // AI által súgyozott xG
                mu_a: number, // AI által súgyozott xG
                log: string,  // AI indoklása
                report: any   // A teljes AI JSON válasz
            };
            critic: any;
            strategist: any;
        };
        matchData: {
            home: string;
            away: string;
            sport: string;
            mainTotalsLine: number | string;
            mu_h: number | string; // Ez a SÚLYOZOTT (AI Specialista) xG
            mu_a: number | string;
        };
        oddsData: ICanonicalOdds | null;
        valueBets: any[];
        modelConfidence: number; // Ez a Quant/Statisztikai bizalom (4. Ügynök)
        finalConfidenceScore: number; // Ez a Stratéga (6. Ügynök) által MEGHATÁROZOTT bizalom
        sim: any; 
        recommendation: any;
        xgSource: string; // JAVÍTVA: String típus a Cache-kompatibilitás miatt
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

        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        
        // === MÓDOSÍTVA (v81.0) ===
        // Cache kulcs (v81.0) - az 'v80.0_realism_fix' -> 'v81.0_tactical_fix'
        const p1AbsenteesHash = manual_absentees ?
            `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        analysisCacheKey = `analysis_v81.0_tactical_fix_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
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

        // === JAVÍTÁS (v80.0): Pszichológiai profilok kiszámítása (MÁR MEGVOLT) ===
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
        const { pure_mu_h, pure_mu_a, source: quantSource } = estimatePureXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData // Ez tartalmazza a P1-es 4-komponensű adatokat
        );
        console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // === MÓDOSÍTÁS (v70.0): 3. ÜGYNÖK (SPECIALISTA) - AI HÍVÁS ===
        console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása (v80.0)...`);
        
        const specialistInput = {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            quant_source: quantSource,
            rawDataJson: rawData, // A 2. Ügynök teljes kontextusa
            sport: sport,
            psyProfileHome: psyProfileHome, // (v80.0) Átadva a v80-as promptnak
            psyProfileAway: psyProfileAway  // (v80.0) Átadva a v80-as promptnak
        };
        // Aszinkron hívás az AI Specialista felé
        const specialistReport = await runStep_Specialist(specialistInput);

        // Kinyerjük az AI által módosított értékeket
        const { 
            modified_mu_h: mu_h, 
            modified_mu_a: mu_a 
        } = specialistReport; // Az AI JSON válaszából
        
        console.log(`Specialista (AI) (Súlyozott xG): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        // === MÓDOSÍTÁS VÉGE ===

        const finalXgSource = xGSource;

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
        console.log(`[Lánc 5/6] Kritikus Ügynök: Ellentmondások keresése (v81.0)...`);
        
        // JAVÍTVA (v81.0): A HIÁNYZÓ "VEZETÉK" BEKÖTVE a Kritikushoz
        const criticInput = {
            simJson: sim,
            marketIntel: marketIntel,
            rawDataJson: rawData,
            modelConfidence: parseFloat(modelConfidence.toFixed(1)), 
            valueBetsJson: valueBets,
            // === JAVÍTÁS (v81.0) ===
            psyProfileHome: psyProfileHome,
            psyProfileAway: psyProfileAway
            // === JAVÍTÁS VÉGE ===
        };
        const criticReport = await runStep_Critic(criticInput);
        // JAVÍTVA (v81.0): A kimenet mélyebb objektumban van
        const contradictionScore = criticReport?.risk_analysis?.contradiction_score || 0.0;
        console.log(`[Lánc 5/6] Kritikus végzett. Kockázati Pontszám: ${contradictionScore.toFixed(2)}`);

        // === 6. ÜGYNÖK (STRATÉGA): Végső döntés ===
        console.log(`[Lánc 6/6] Stratéga Ügynök: Végső döntés meghozatala (v80.0)...`);
        
        // JAVÍTVA (v80.0): A HIÁNYZÓ "VEZETÉK" BEKÖTVE
        // Hozzáadtuk a `psyProfileHome` és `psyProfileAway` változókat
        const strategistInput = {
            matchData: { home, away, sport, leagueName },
            quantReport: { pure_mu_h: pure_mu_h, pure_mu_a: pure_mu_a, source: quantSource },
            specialistReport: specialistReport, 
            simulatorReport: sim,
            criticReport: criticReport, 
            modelConfidence: parseFloat(modelConfidence.toFixed(1)),
            rawDataJson: rawData,
            realXgJson: { 
                manual_H_xG: advancedData?.manual_H_xG ?? null,
                manual_H_xGA: advancedData?.manual_H_xGA ?? null,
                manual_A_xG: advancedData?.manual_A_xG ?? null,
                manual_A_xGA: advancedData?.manual_A_xGA ?? null
            },
            // === JAVÍTÁS (v80.0) ===
            psyProfileHome: psyProfileHome,
            psyProfileAway: psyProfileAway
            // === JAVÍTÁS VÉGE ===
        };

        const strategistReport = await runStep_Strategist(strategistInput);
        
        if (strategistReport.error) {
            console.error("A Stratéga (6. Ügynök) hibát adott vissza:", strategistReport.error);
        }
        
        // JAVÍTÁS (v77.9): Biztonságos hozzáférés a master_recommendation-höz
        const masterRecommendation = strategistReport?.master_recommendation;
        let finalConfidenceScore = 1.0; // Alapértelmezett hiba esetén
        
        if (masterRecommendation && typeof masterRecommendation.final_confidence === 'number') {
            finalConfidenceScore = masterRecommendation.final_confidence;
        } else {
            console.error("KRITIKUS HIBA: A Stratéga (6. Ügynök) nem adott vissza érvényes 'final_confidence' számot! 1.0-ra állítva.");
        }
        // === JAVÍTÁS VÉGE ===

        console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)} (Végső bizalom: ${finalConfidenceScore})`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ?
                (manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // === A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA (MÓDOSÍTVA v71.2) ===
        // Csak a karcsúsított (lean) adatok mentése a Sheets 50k limit miatt
        const auditData = {
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
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
            // JAVÍTVA (v77.6): A szétszórt objektumok helyett
            // KÖZVETLENÜL mentjük az analysisData és xGSource mezőket
            analysisData: {
                committee: auditData.analysisData.committee,
                matchData: auditData.analysisData.matchData,
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: auditData.analysisData.modelConfidence,
                finalConfidenceScore: auditData.analysisData.finalConfidenceScore,
                sim: sim, // A teljes sim objektum a UI számára
                recommendation: masterRecommendation,
                xgSource: finalXgSource, // A hiányzó mező
                availableRosters: availableRosters // A teljes roster
            },
            debugInfo: debugInfo 
        };
        // === MÓDOSÍTÁS VÉGE ===

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            // A Google Sheet-be már csak a karcsúsított JSON-t mentjük (v71.2)
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
        // === JAVÍTÁS (TS2448 / TS2454) ===
        const homeParam = params?.home || 'N-A';
        const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        // 'sport' (függvény argumentum) itt elérhető
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
        // === JAVÍTÁS VÉGE ===
    }
}
