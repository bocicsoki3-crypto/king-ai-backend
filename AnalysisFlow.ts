// --- AnalysisFlow.ts (v54.3 - SSOT Refaktor) ---
// MÓDOSÍTÁS: A 'runFullAnalysis' (Source 765) most már fogadja és továbbítja
// a natív API-Football ID-kat (Source 3183-3189) a 'getRichContextualData'-nak (Source 778).
import NodeCache from 'node-cache';
import { SPORT_CONFIG } from './config.js';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds
} from './src/types/canonical.d.ts';
// A 'findMainTotalsLine'-t kivettük a DataFetch-ből
import { getRichContextualData } from './DataFetch.js';
// Helyette a központi 'utils' fájlból importáljuk
import { findMainTotalsLine } from './providers/common/utils.js';
// Adatgyűjtő funkciók
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
// === JAVÍTÁS (v53.0): AI Szolgáltatás Importok ===
// A régi 'Facts' és 'Analysis' hívások cserélve az új dialektikus lépésekre
import {
    runStep1_GetQuant,
    runStep2_GetScout,
    runStep3_GetStrategy
} from './AI_Service.js';
// === JAVÍTÁS VÉGE ===

import { saveAnalysisToSheet } from './sheets.js'; // Mentés funkció
import { buildAnalysisHtml } from './htmlBuilder.js';
// HTML építő funkció

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.ts - Fő Elemzési Munkafolyamat (TypeScript)
* VÁLTOZÁS (v54.3 - SSOT Refaktor):
* - A 'runFullAnalysis' most már a 'Quant' és 'Scout' AI-szerepköröket
* hívja meg specializált adatokkal, a régi lineáris modell helyett.
* - Továbbítja a natív ID-kat a DataFetch rétegnek.
**************************************************************/

// A visszatérési típus meghatározása (amit a kliens vár)
interface IAnalysisResponse {
    html: string;
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse |
IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    try {
        // === JAVÍTÁS (v54.3): Paraméterek kibővítése ===
        const { 
            home: rawHome, 
            away: rawAway, 
            force: forceNewStr, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            // Új SSOT ID-k fogadása az 'index.ts'-től (Source 3183-3189)
            apiFootballLeagueId,
            apiFootballHomeId,
            apiFootballAwayId,
            apiFootballFixtureId
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
        analysisCacheKey = `analysis_v53_dialectical_${sport}_${safeHome}_vs_${safeAway}`; // Verzió frissítve

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
        
        // === JAVÍTÁS (v54.3): ID-k továbbítása a DataFetch-nek ===
        const { 
            rawStats, 
            richContext, // Ezt a v53 modell már nem használja közvetlenül
            advancedData, 
            form, 
            rawData, // Ez ICanonicalRawData típusú
            leagueAverages = {}, 
            oddsData 
        }: ICanonicalRichContext = await getRichContextualData(
            sport, 
            home, 
            away, 
            leagueName, 
            utcKickoff,
            // Új SSOT ID-k továbbítása a DataFetch.ts (Source 2423) felé
            apiFootballLeagueId,
            apiFootballHomeId,
            apiFootballAwayId,
            apiFootballFixtureId
        );
        // === JAVÍTÁS VÉGE ===

        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Odds és kontextus függő elemzések ---
        
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

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players_ratings, sport);
        // Módosítva a valós adatra
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);

        // --- 4. Statisztikai Modellezés (Típusosított) ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Modellezés kész: ${home} vs ${away}.`);
        
        // === 5. LÉPÉS: DIALEKTIKUS AI ELEMZÉS (v53.0) ===
        console.log(`Dialektikus AI Elemzés indul (Quant/Scout/Strategist)...`);
        // LÉPÉS 1: KVANTITATÍV ELEMZÉS (A "QUANT")
        const quantInput = {
            simJson: sim,
            realXgJson: advancedData, // Valós xG (Sofascore/API-Football)
            keyPlayerRatingsJson: rawData.detailedPlayerStats.key_players_ratings, // Valós Sofascore értékelések
            valueBetsJson: valueBets
        };
        console.log(`CoT Lépés 1 (Quant) hívása...`);
        const step1_Quant = await runStep1_GetQuant(quantInput);
        if (step1_Quant.error) throw new Error(step1_Quant.error);
        // LÉPÉS 2: TAKTIKAI ELEMZÉS (A "SCOUT")
        const scoutInput = {
            rawDataJson: rawData, // Teljes kontextus
            detailedPlayerStatsJson: rawData.detailedPlayerStats, // Valós hiányzók (Sofascore)
            marketIntel: marketIntel // Piaci mozgás
        };
        console.log(`CoT Lépés 2 (Scout) hívása...`);
        const step2_Scout = await runStep2_GetScout(scoutInput);
        if (step2_Scout.error) throw new Error(step2_Scout.error);
        // LÉPÉS 3: STRATÉGIAI DÖNTÉS (A "SYNTHESIS")
        const strategyInput = {
            step1QuantJson: step1_Quant,
            step2ScoutJson: step2_Scout,
            modelConfidence: modelConfidence, // A *statisztikai* modell bizalma
            simJson: sim, // A teljes szimulációs objektum
            sim_mainTotalsLine: sim.mainTotalsLine
        
        };
        console.log(`CoT Lépés 3 (Strategist) hívása...`);
        const step3_Strategy = await runStep3_GetStrategy(strategyInput);
        // Eredmények egyesítése a HTML generátor számára
        const committeeResults = {
            ...step1_Quant,
            ...step2_Scout,
            ...step3_Strategy
        };
        const masterRecommendation = committeeResults.master_recommendation;
        console.log(`Dialektikus elemzés és ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);
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
            playerDataFetched: (rawData?.detailedPlayerStats?.key_players_ratings?.home) ?
'Igen (Sofascore)' : 'Nem (Fallback)',
            realXgUsed: (advancedData?.home?.xg != null) ?
'Igen (Sofascore/API-Football)' : 'Nem (Becsült)',
            fromCache_RichContext: rawData?.fromCache ??
'Ismeretlen'
        };
        
        const jsonResponse: IAnalysisResponse = { html: finalHtml, debugInfo: debugInfo };
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);

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
                .then(() => console.log(`Elemzés mentve a 
Google Sheet-be (${analysisCacheKey})`))
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
