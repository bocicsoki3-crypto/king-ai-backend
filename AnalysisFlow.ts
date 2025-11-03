// --- AnalysisFlow.ts (v54.5 - Manual xG Components) ---
// MÓDOSÍTÁS: A runFullAnalysis implementálja a 4-komponensű
// xG prioritási logikát (1. Manuális Komponensek, 2. API, 3. Becsült).

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
import { getRichContextualData } from './DataFetch.js';
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
// import { buildAnalysisHtml } from './htmlBuilder.js'; // A v54.0 JSON API refaktorban eltávolítva

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });

/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v54.5 - Manual xG Components):
* - A 'runFullAnalysis' fogadja a 4 xG komponenst
* és elvégzi a számítást a szerveren.
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
        xgSource: 'Manual (Components)' | 'API (Real)' | 'Calculated (Fallback)';
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
        // === JAVÍTÁS (v54.5): 4-komponensű xG felülbírálás ===
        const { 
            home: rawHome, 
            away: rawAway, 
            force: forceNewStr, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            manual_H_xG,  // ÚJ (Opcionális)
            manual_H_xGA, // ÚJ (Opcionális)
            manual_A_xG,  // ÚJ (Opcionális)
            manual_A_xGA  // ÚJ (Opcionális)
        } = params;
        // === JAVÍTÁS VÉGE ===

        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        
        // A cache kulcs verzióját v54.5-re emeljük
        analysisCacheKey = `analysis_v54.5_json_api_${sport}_${safeHome}_vs_${safeAway}`; 

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
        // A v54.3-as (javított) DataFetch hívása
        const { 
            rawStats, 
            richContext,
            advancedData, // Ez tartalmazza az API-ból jövő (ha van) xG-t
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData 
        }: ICanonicalRichContext = await getRichContextualData(sport, home, away, leagueName, utcKickoff);
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

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players_ratings, sport);
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);

        // --- 4. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);

        // Először futtatjuk a normál becslést (ez adja a fallback-et ÉS a módosítókat)
        const { mu_h: estimated_h, mu_a: estimated_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        
        // === JAVÍTÁS (v54.5): 4-komponensű xG felülbírálási logika ===
        let mu_h: number;
        let mu_a: number;
        let xgSource: IAnalysisResponse['analysisData']['xgSource'];
        
        // 3-szintű prioritás
        if (typeof manual_H_xG === 'number' && 
            typeof manual_H_xGA === 'number' && 
            typeof manual_A_xG === 'number' && 
            typeof manual_A_xGA === 'number') 
        {
            // 1. PRIORITÁS: Manuális Komponens felülbírálás
            // (Hazai Támadás + Vendég Védekezés) / 2
            mu_h = (manual_H_xG + manual_A_xGA) / 2;
            // (Vendég Támadás + Hazai Védekezés) / 2
            mu_a = (manual_A_xG + manual_H_xGA) / 2;
            xgSource = 'Manual (Components)';
            console.log(`MANUÁLIS XG FELÜLBÍRÁLÁS (Komponensekből): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        } else if (advancedData?.home?.xg != null && advancedData?.away?.xg != null) {
            // 2. PRIORITÁS: API-ból (Sofascore/API-Football) kapott valós xG
            // (Az estimateXG már ezt használta, ha volt)
            mu_h = estimated_h; 
            mu_a = estimated_a;
            xgSource = 'API (Real)';
            console.log(`API XG HASZNÁLATBAN: H=${mu_h}, A=${mu_a}`);
        } else {
            // 3. PRIORITÁS: Becsült xG
            mu_h = estimated_h;
            mu_a = estimated_a;
            xgSource = 'Calculated (Fallback)';
            console.log(`BECSÜLT XG HASZNÁLATBAN: H=${mu_h}, A=${mu_a}`);
        }
        // === JAVÍTÁS VÉGE ===

        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        
        // A sim() már a VÉGLEGES (potenciálisan felülbírált) mu_h, mu_a értékekkel fut
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
            // JAVÍTÁS (v54.5): A 'realXgJson' most a *végleges* xG adatot kapja meg
            realXgJson: { home: mu_h, away: mu_a, source: xgSource },
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

        // --- 6. HTML Generálás ELTÁVOLÍTVA ---
        
        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataFetched: (rawData?.detailedPlayerStats?.key_players_ratings?.home) ? 'Igen (Sofascore)' : 'Nem (Fallback)',
            realXgUsed: xgSource, // A v54.5-ös xgSource-t használjuk
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        // A VÁLASZ OBJEKTUM ÖSSZEÁLLÍTÁSA (JSON API v54.5)
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
                xgSource: xgSource // Hozzáadva
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
                html: `JSON_API_MODE (xG Forrás: ${xgSource})`,
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