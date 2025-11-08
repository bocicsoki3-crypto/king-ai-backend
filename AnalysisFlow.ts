// FÁJL: AnalysisFlow.ts
// VERZIÓ: v71.1 (Auditor Bővítés - TS2322 Típusjavítás)
// MÓDOSÍTÁS (v71.1):
// 1. JAVÍTVA (ts2322): Az 'IAnalysisResponse' interfész 'xgSource' típusa
//    'string'-re módosítva, hogy megfeleljen a 'DataFetch.ts' (v73.1)
//    bővített visszatérési értékének (pl. "API (Real) (Cache)").
// 2. A v70.0-s "Okos Specialista" (AI Ügynök 3) hívása érvényben marad.
// 3. A v71.0-s "Auditor" JSON mentési logikája érvényben marad.

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
    // === MÓDOSÍTÁS (v70.0): applyContextualModifiers ELTÁVOLÍTVA ===
    estimatePureXG,           // ÚJ (1. Ügynök - Quant)
    // 'applyContextualModifiers' TÖRÖLVE (helyette AI hívás)
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
    // === MÓDOSÍTÁS (v70.0): runStep_Specialist HOZZÁADVA ===
    runStep_Specialist, // ÚJ (3. Ügynök - AI Specialista)
    runStep_Critic,     // ÚJ (5. Ügynök - Kritikus)
    runStep_Strategist  // ÚJ (6. Ügynök - Stratéga)
    // =================================
} from './AI_Service.js';
// === MÓDOSÍTÁS (v71.0): saveAnalysisToSheet importálása ===
import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v71.1):
* - A 3. Ügynök (Okos Specialista) aktív.
* - A 'JSON_Data' mentés aktív.
* - TS(2322) xgSource típus-ütközés javítva.
* **************************************************************/

// Az új, strukturált JSON válasz (MÓDOSÍTVA v71.1)
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string };
            specialist: { // Ez most már az AI Specialista jelentése
                mu_h: number, // AI által súlyozott xG
                mu_a: number, // AI által súlyozott xG
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
        
        // === JAVÍTÁS (v71.1 - TS2322) ===
        // 'string'-re módosítva, hogy fogadja a DataFetch.ts (v73.1) által
        // adott '... | string' típust (pl. "API (Real) (Cache)").
        xgSource: string; 
        // === JAVÍTÁS VÉGE ===

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
function safeConvertToNumber(value: any): number |
null {
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


export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse |
IAnalysisError> {
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
            manual_absentees
        
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
        
        // === MÓDOSÍTVA (v71.0) ===
        // Cache kulcs (v71.0) - Az 'v70.0_ai_specialist' -> 'v71.0_auditor_ready'
        const p1AbsenteesHash = manual_absentees ?
`_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        analysisCacheKey = `analysis_v71.0_auditor_ready_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
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
        // A 'getRichContextualData' (Scout) most már a v73.0-s ("P2 Terv") aggregátor
        // === JAVÍTÁS (v72.0): Átadjuk a 2. argumentumot (a cache kulcsot) ===
        const { 
            rawStats, 
            richContext,
            advancedData,
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource, // Ez a v73.1-ben már '... | string' típusú
            availableRosters // <- (v62.1)
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions, analysisCacheKey);
// === Scout Végzett ===
        
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
}

        // --- 3. Piaci adatok előkészítése (Scout adatából) ---
        let mutableOddsData: ICanonicalOdds |
null = oddsData;
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
        // Meghívjuk az 'AI_Service.ts' (v70.0) új AI ágensét
        const specialistReport = await runStep_Specialist(specialistInput);

        const { 
            modified_mu_h: mu_h, // Az AI által súlyozott xG
            modified_mu_a: mu_a 
        } = specialistReport; 
        
        console.log(`Specialista (AI) (Súlyozott xG): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        // === AI Specialista Végzett ===
        
        // === JAVÍTÁS (v71.1 - TS2322) ===
        // 'xgSource' (kis 'x') használata, ahogy az a 185. sorban definálva van.
        const finalXgSource = xgSource; 
        // === JAVÍTÁS VÉGE ===

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
            specialistReport: specialistReport, // A 3. Ügynök (AI) teljes JSON válaszát adjuk át
            simulatorReport: sim,
            criticReport: criticReport, // Az 5. Ügynök jelentése
            modelConfidence: modelConfidence, // A Statisztikai bizalom (4. Ügynök)
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
        let finalConfidenceScore = 1.0; // Alapértelmezett hiba esetén
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
        
        // === A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA (MÓDOSÍTVA v70.0) ===
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource },
                    specialist: { // Az AI Specialista teljes jelentése
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
                    mu_h: sim.mu_h_sim, // Súlyozott xG
 
                   mu_a: sim.mu_a_sim // Súlyozott xG
                 },
                oddsData: mutableOddsData,
                valueBets: valueBets,
                modelConfidence: modelConfidence, // Statisztikai bizalom (Quant)
                finalConfidenceScore: parseFloat(finalConfidenceScore.toFixed(1)), // Végső bizalom (Stratéga)
         
       sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource, // Ez a (v71.1) javítással már helyes
                
                // === (v62.1) ===
                availableRosters: availableRosters 
     
       },
            debugInfo: debugInfo 
        };
// === MÓDOSÍTÁS VÉGE ===

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        
        // === MÓDOSÍTÁS (v71.0): A TELJES JSON mentése ===
if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            
            // A 'html' mező most már csak egy log-üzenet, a valódi adat
            // a 'JSON_Data' mezőbe kerül az Auditor számára.
            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: `JSON_API_MODE (v71.1 AI Auditor) (xG Forrás: ${finalXgSource})`,
                JSON_Data: JSON.stringify(jsonResponse), // <--- A KULCSMÓDOSÍTÁS
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
        // === JAVÍTÁS (TS2448 / TS2454) ===
        const homeParam = params?.home || 'N-A';
const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
return { error: `Elemzési hiba: ${error.message}` };
        // === JAVÍTÁS VÉGE ===
    }
}