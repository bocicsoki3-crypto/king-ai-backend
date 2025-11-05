// FÁJL: AnalysisFlow.ts
// VERZIÓ: v62.1 (P1 Manuális Roster Választó - 4. Lépés)
// MÓDOSÍTÁS:
// 1. A 'getRichContextualData'  hívás válaszából
//    kinyerésre kerül az új 'availableRosters' mező.
// 2. Az 'availableRosters' mező hozzáadva a kliensnek
//    küldött 'jsonResponse'  objektumhoz.
// 3. Ez biztosítja, hogy a 'script.js' megkapja a
//    keretadatokat a legördülő listák felépítéséhez.
// 4. A v61.0-ás (4-komponensű P1) bevitel kezelése érintetlen marad.
// 5. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

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
// Adatgyűjtő funkciók
import { 
    getRichContextualData, 
    type IDataFetchOptions, 
    type IDataFetchResponse 
} from './DataFetch.js';
// v54.16 importok
import {
    estimateXG,
    estimateAdvancedMetrics,
    simulateMatchProgress,
    calculateModelConfidence,
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement,
    analyzePlayerDuels
} from './Model.js';
// AI Szolgáltatás Importok (v55.1 - CSAK AZ EGYESÍTETT LÉPÉS)
import {
    runStep_UnifiedAnalysis
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });

/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v62.1):
* - A 4-komponensű P1 adatokat kezeli.
* - Továbbítja az 'availableRosters' adatot a kliensnek.
**************************************************************/

// Az új, strukturált JSON válasz (MÓDOSÍTVA v62.1)
interface IAnalysisResponse {
    analysisData: {
        committeeResults: any;
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
        // === v61.0: Csak a 4-komponensű P1 adatokat olvassuk ===
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
            manual_A_xGA
            // A 'manual_xg_home/away' (2-mezős) [image: 4223a5.png] már nem olvasott
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
        
        // Cache kulcs (v62.1)
        analysisCacheKey = `analysis_v62.1_roster_${sport}_${safeHome}_vs_${safeAway}`;
        
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

        // --- 2. Fő Adatgyűjtés ---
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        
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
            manual_A_xGA: safeConvertToNumber(manual_A_xGA)
        };
        
        // === MÓDOSÍTVA (v62.1): 'availableRosters' kinyerése ===
        const { 
            rawStats, 
            richContext,
            advancedData,
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource,
            availableRosters // <- ÚJ (v62.1)
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions);
        // === MÓDOSÍTÁS VÉGE ===
        
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Odds és kontextus függő elemzések ---
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

        const duelAnalysis = analyzePlayerDuels(rawData?.detailedPlayerStats?.key_players_ratings, sport);
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        
        // --- 4. Statisztikai Modellezés (v61.0 Logikával) ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        
        // Az 'estimateXG' (v61.0) most már az 'advancedData'-t (a 4 P1 komponenst)
        // használja a bázis kiszámításához [cite: 1565-1566] és a "dupla számítás" [cite: 2622-2624] elkerüléséhez.
        const { mu_h, mu_a } = estimateXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData, // Ez tartalmazza az Ön P1-es 4-komponensű [cite: 2711-2713] adatait
            rawData, 
            psyProfileHome, 
            psyProfileAway, 
            null // currentSimProbs
        );

        const finalXgSource = xgSource;
        console.log(`${finalXgSource.toUpperCase()} XG ALAPON SÚLYOZOTT VÉGLEGES XG: H=${mu_h}, A=${mu_a}`);
        
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        
        console.log(`Modellezés kész: ${home} vs ${away}.`);

        // --- 5. LÉPÉS: EGYESÍTETT (v55.1) AI ELEMZÉS ---
        console.log(`Egyesített Holisztikus AI Elemzés indul...`);
        
        const unifiedInput = {
            // Quant adatok
            simJson: sim,
            // A "Tiszta xG" (P1 Komponens) átadása
            realXgJson: { 
                manual_H_xG: advancedData?.manual_H_xG ?? null,
                manual_H_xGA: advancedData?.manual_H_xGA ?? null,
                manual_A_xG: advancedData?.manual_A_xG ?? null,
                manual_A_xGA: advancedData?.manual_A_xGA ?? null
            },
            xgSource: finalXgSource,
            keyPlayerRatingsJson: rawData.detailedPlayerStats.key_players_ratings,
            valueBetsJson: valueBets,
            // Scout adatok
            rawDataJson: rawData,
            detailedPlayerStatsJson: rawData.detailedPlayerStats,
            marketIntel: marketIntel,
            // Stratéga adatok
            modelConfidence: modelConfidence,
            sim_mainTotalsLine: sim.mainTotalsLine
        };
        
        const committeeResults = await runStep_UnifiedAnalysis(unifiedInput);
        
        if (committeeResults.error) {
            console.error("Az egyesített AI elemzés hibát adott vissza:", committeeResults.error);
        }
        
        const masterRecommendation = committeeResults.master_recommendation;
        console.log(`Egyesített elemzés és ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);

        // --- 6. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataFetched: (rawData?.detailedPlayerStats?.key_players_ratings?.home) ? 'Igen (Sofascore)' : 'Nem (Fallback)',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // === A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA (MÓDOSÍTVA v62.1) ===
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committeeResults: committeeResults,
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
                sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource,
                
                // === ÚJ (v62.1) ===
                // A keretadatok hozzáadása a kliens oldali válaszhoz
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
                html: `JSON_API_MODE (xG Forrás: ${finalXgSource})`,
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
