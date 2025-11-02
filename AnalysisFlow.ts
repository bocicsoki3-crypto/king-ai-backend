// --- JAVÍTOTT AnalysisFlow.ts (v52.2 - 'import type' javítás) ---

import NodeCache from 'node-cache'; // CacheService helyett
import { SPORT_CONFIG } from './config.js';
// Konfiguráció importálása

// Kanonikus típusok importálása
// === JAVÍTÁS (TS2846) ===
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds
} from './src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

// A 'findMainTotalsLine'-t kivettük a DataFetch-ből, mert az már csak egy 'Factory'
import { getRichContextualData } from './DataFetch.js';
// Helyette a központi 'utils' fájlból importáljuk, ahova áthelyeztük
import { findMainTotalsLine } from './providers/common/utils.js';

// Adatgyűjtő funkciók
import {
    estimateXG,
    estimateAdvancedMetrics,
    simulateMatchProgress,
    calculateModelConfidence,
    // buildPropheticTimeline, // ELTÁVOLÍTVA (v50) - Logikailag hibás (sztochasztikus)
    calculatePsychologicalProfile,
    calculateValue,
    analyzeLineMovement,
    analyzePlayerDuels
} from './Model.js';
// AI Szolgáltatás Importok
import {
    runStep1_GetFacts,
    runStep2_GetAnalysis,
    runStep3_GetStrategy
} from './AI_Service.js';
// --- JAVÍTÁS VÉGE ---
import { saveAnalysisToSheet } from './sheets.js'; // Mentés funkció
import { buildAnalysisHtml } from './htmlBuilder.js';
// HTML építő funkció

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v52.2 - TS):
* - Javítva a TS2846 hiba: Az 'import' ki lett cserélve 'import type'-ra
* a canonical.d.ts típusdefiníciós fájl importálásakor.
**************************************************************/

// A visszatérési típus meghatározása (amit a kliens vár)
interface IAnalysisResponse {
    html: string;
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse | IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    
    try {
        // Parameter validation and extraction
        const { home: rawHome, away: rawAway, force: forceNewStr, sheetUrl, utcKickoff, leagueName } = params;
        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        analysisCacheKey = `analysis_v21_advanced_${sport}_${safeHome}_vs_${safeAway}`;

        // Cache check
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

        // --- 2. Fő Adatgyűjtés (Típusosított: ICanonicalRichContext) ---
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        // A getRichContextualData-nak (DataFetch.ts) Promise<ICanonicalRichContext>-et kell visszaadnia
        const { 
            rawStats, 
            richContext, 
            advancedData, 
            form, 
            rawData, // Ez ICanonicalRawData típusú
            leagueAverages = {}, 
            oddsData // Ez ICanonicalOdds | null típusú
        }: ICanonicalRichContext = await getRichContextualData(sport, home, away, leagueName, utcKickoff);
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        
        // FixtureID kinyerése mentéshez
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Odds és kontextus függő elemzések ---
        
        let mutableOddsData: ICanonicalOdds | null = oddsData;
        if (!mutableOddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez (API-Football).`);
            // Alapértelmezett ICanonicalOdds struktúra létrehozása
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

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players, sport);
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);

        // --- 4. Statisztikai Modellezés (Típusosított) ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        
        // A típusosított rawStats és rawData átadása
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Modellezés kész: ${home} vs ${away}.`);
        
        // --- 5. LÁNCOLT AI ELEMZÉS (v51 - CoT) ---
        console.log(`Chain-of-Thought AI Elemzés indul (3 Lépés)...`);

        // LÉPÉS 1: TÉNYFELTÁRÁS (Típusosított bemenet)
        const factsInput = {
            richContext: richContext,
            detailedPlayerStatsJson: rawData.detailedPlayerStats,
            marketIntel: marketIntel
        };
        console.log(`CoT Lépés 1 (Tényfeltárás) hívása...`);
        const step1_Facts = await runStep1_GetFacts(factsInput);
        if (step1_Facts.error) throw new Error(step1_Facts.error);
        
        // LÉPÉS 2: TAKTIKAI ELEMZÉS (Típusosított bemenet)
        const analysisInput = {
            simJson: sim,
            step1FactsJson: step1_Facts,
            rawDataJson: rawData,
            sim_mainTotalsLine: sim.mainTotalsLine,
            mu_corners_sim: sim.mu_corners_sim,
            mu_cards_sim: sim.mu_cards_sim
        };
        console.log(`CoT Lépés 2 (Elemzés) hívása...`);
        const step2_Analysis = await runStep2_GetAnalysis(analysisInput);
        if (step2_Analysis.error) throw new Error(step2_Analysis.error);

        // LÉPÉS 3: STRATÉGIAI DÖNTÉS (Típusosított bemenet)
        const strategyInput = {
            step2AnalysisJson: step2_Analysis,
            modelConfidence: modelConfidence,
            valueBetsJson: valueBets
        };
        console.log(`CoT Lépés 3 (Stratégia) hívása...`);
        const step3_Strategy = await runStep3_GetStrategy(strategyInput);

        // Eredmények egyesítése a HTML generátor számára
        const committeeResults = {
            ...step1_Facts,
            ...step2_Analysis,
            ...step3_Strategy
        };
        
        const masterRecommendation = committeeResults.master_recommendation;
        console.log(`CoT elemzés és ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);

        // --- 6. Végső HTML Generálás ---
        console.log(`HTML generálás indul: ${home} vs ${away}...`);
        const finalHtml = buildAnalysisHtml(
            committeeResults, // A teljes, egyesített CoT eredmény
            { home, away, sport, mainTotalsLine, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, propheticTimeline: null },
            mutableOddsData,
            valueBets,
            modelConfidence,
            sim,
            masterRecommendation
         );
        console.log(`HTML generálás kész: ${home} vs ${away}.`);
        
        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataFetched: rawData?.detailedPlayerStats ? 'Igen (Új Player Stats API)' : 'Nem',
             sportMonksUsedInXG: (sport === 'soccer' && advancedData?.home?.xg != null) ?
            "Igen (valós xG - API-Football)" : (sport === 'hockey' && rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct != null) ?
            "Igen (HDCF%)" : (sport === 'basketball' && rawData?.advanced_data?.home?.pace != null) ?
            "Igen (Pace/Rating)" : "Nem (becsült adatok)",
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        const jsonResponse: IAnalysisResponse = { html: finalHtml, debugInfo: debugInfo };
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejeve és cache mentve (${analysisCacheKey})`);

        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: finalHtml, 
                id: analysisCacheKey,
                fixtureId: fixtureIdForSaving,
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés mentve a Google Sheet-be (${analysisCacheKey})`))
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