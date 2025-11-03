// FÁJL: AnalysisFlow.ts
// VERZIÓ: v54.16 (TS2339 Javítások)
// MÓDOSÍTÁS:
// 1. A 'getRichContextualData' hívása (v54.15) változatlan.
// 2. (TS2339 Javítás) Importálja az 'IDataFetchResponse'-t
//    és a 'getRichContextualData' desztrukturálásakor ezt használja.
// 3. (TS2339 Javítás) Az 'estimateXG' hívásának desztrukturálása
//    javítva: már nem vár 'xgSource'-t vissza, mivel az már
//    a 'getRichContextualData'-ból megérkezett.

import NodeCache from 'node-cache';
import { SPORT_CONFIG } from './config.js';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds
} from './src/types/canonical.d.ts';
// A 'findMainTotalsLine'-t a központi 'utils' fájlból importáljuk
import { findMainTotalsLine } from './providers/common/utils.js';

// Adatgyűjtő funkciók
// === JAVÍTÁS (v54.16): Importáljuk az új interfészt is ===
import { getRichContextualData, type IDataFetchOptions, type IDataFetchResponse } from './DataFetch.js';
// === JAVÍTÁS VÉGE ===

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
// AI Szolgáltatás Importok
import {
    runStep1_GetQuant,
    runStep2_GetScout,
    runStep3_GetStrategy
} from './AI_Service.js';

import { saveAnalysisToSheet } from './sheets.js'; 

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });

/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v54.16):
* - Az xG prioritási logika a DataFetch.ts-ben van.
* - A hívások és típusok javítva.
**************************************************************/

// Az új, strukturált JSON válasz (v54.0)
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
    };
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse | IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    
    try {
        // === xG Komponensek és Direkt xG beolvasása ===
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
            // P1 (Direkt)
            manual_xg_home,
            manual_xg_away
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
        
        // Cache kulcs (v54.16 - DataFetch kezeli az xG-t)
        analysisCacheKey = `analysis_v54.16_json_api_${sport}_${safeHome}_vs_${safeAway}`; 

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

        // === JAVÍTÁS (v54.15): A 'getRichContextualData' hívás javítása ===
        const dataFetchOptions: IDataFetchOptions = {
            sport: sport,
            homeTeamName: home,
            awayTeamName: away,
            leagueName: leagueName,
            utcKickoff: utcKickoff,
            forceNew: forceNew,
            
            // P1 (Direkt)
            manual_xg_home: manual_xg_home ? Number(manual_xg_home) : null,
            manual_xg_away: manual_xg_away ? Number(manual_xg_away) : null,

            // P1 (Komponens)
            manual_H_xG: manual_H_xG ? Number(manual_H_xG) : null,
            manual_H_xGA: manual_H_xGA ? Number(manual_H_xGA) : null,
            manual_A_xG: manual_A_xG ? Number(manual_A_xG) : null,
            manual_A_xGA: manual_A_xGA ? Number(manual_A_xGA) : null
        };
        
        // === JAVÍTÁS (v54.16): Helyes típus (IDataFetchResponse) használata ===
        // Ez megoldja a TS2339 (1. hiba) problémát.
        const { 
            rawStats, 
            richContext,
            advancedData, // Ez már a VÉGLEGES, priorizált xG-t tartalmazza
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource // Ezt most már a DataFetch adja vissza
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions);
        // === JAVÍTÁS VÉGE ===

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

        // --- 4. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);

        // === JAVÍTÁS (v54.16): xG Logika Átstrukturálása ===
        // Az 'estimateXG' feladata most már csak a P4 (Becslés) biztosítása,
        // HA az 'advancedData.home.xg' null.

        // === JAVÍTÁS (v54.16): Helyes desztrukturálás ===
        // Ez megoldja a TS2339 (2. hiba) problémát.
        // Az 'estimateXG' NEM adja vissza az 'xgSource'-t, az már megvan.
        const { mu_h, mu_a } = estimateXG(
            home, away, rawStats, sport, form, leagueAverages, 
            advancedData, // Ezt kapja meg (P1, P2, v P3)
            rawData, psyProfileHome, psyProfileAway, 
            xgSource // Ezt is megkapja a DataFetch-től
        );
        // === JAVÍTÁS VÉGE ===

        const finalXgSource = xgSource; // A változó átnevezése a kód többi részével való kompatibilitás miatt
        
        console.log(`${finalXgSource.toUpperCase()} XG HASZNÁLATBAN: H=${mu_h}, A=${mu_a}`);

        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Modellezés kész: ${home} vs ${away}.`);
        
        // --- 5. LÉPÉS: DIALEKTIKUS AI ELEMZÉS ---
        console.log(`Dialektikus AI Elemzés indul (Quant/Scout/Strategist)...`);
        
        const quantInput = {
            simJson: sim,
            realXgJson: { home: mu_h, away: mu_a, source: finalXgSource },
            keyPlayerRatingsJson: rawData.detailedPlayerStats.key_players_ratings,
            valueBetsJson: valueBets
        };
        const step1_Quant = await runStep1_GetQuant(quantInput);
        if (step1_Quant.error) throw new Error(step1_Quant.error);

        const scoutInput = {
            rawDataJson: rawData,
            detailedPlayerStatsJson: rawData.detailedPlayerStats,
            marketIntel: marketIntel
        };
        const step2_Scout = await runStep2_GetScout(scoutInput);
        if (step2_Scout.error) throw new Error(step2_Scout.error);
        
        const strategyInput = {
            step1QuantJson: step1_Quant,
            step2ScoutJson: step2_Scout,
            modelConfidence: modelConfidence,
            simJson: sim,
            sim_mainTotalsLine: sim.mainTotalsLine
        };
        const step3_Strategy = await runStep3_GetStrategy(strategyInput);
        
        const committeeResults = {
            ...step1_Quant,
            ...step2_Scout,
            ...step3_Strategy
        };
        const masterRecommendation = committeeResults.master_recommendation;
        console.log(`Dialektikus elemzés és ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);
        
        // --- 6. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataFetched: (rawData?.detailedPlayerStats?.key_players_ratings?.home) ? 'Igen (Sofascore)' : 'Nem (Fallback)',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA
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
                xgSource: finalXgSource
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
