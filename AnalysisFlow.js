// --- JAVÍTOTT AnalysisFlow.js (v50.1 - FixtureID mentéssel) ---

import NodeCache from 'node-cache'; // CacheService helyett
import { SPORT_CONFIG } from './config.js';
// Konfiguráció importálása

// --- JAVÍTÁS KEZDETE (v46) ---
// A 'findMainTotalsLine'-t kivettük a DataFetch-ből, mert az már csak egy 'Factory'
import { getRichContextualData } from './DataFetch.js';
// Helyette a központi 'utils' fájlból importáljuk, ahova áthelyeztük
import { findMainTotalsLine } from './providers/common/utils.js';
// --- JAVÍTÁS VÉGE ---

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
// --- JAVÍTÁS (v50): AI Szolgáltatás Importok cseréje ---
// A régi, "chatty" bizottsági importok eltávolítva
import {
    getConsolidatedAnalysis
    // getRiskAssessment, // ELTÁVOLÍTVA
    // getTacticalBriefing, // ELTÁVOLÍTVA
    // getPropheticScenario, // ELTÁVOLÍTVA
    // ... (összes többi egyedi AI import) ... // ELTÁVOLÍTVA
    // getMasterRecommendation, // ELTÁVOLÍTVA
    // getStrategicClosingThoughts // ELTÁVOLÍTVA
} from './AI_Service.js';
// --- JAVÍTÁS VÉGE ---
import { saveAnalysisToSheet } from './sheets.js'; // Mentés funkció
import { buildAnalysisHtml } from './htmlBuilder.js';
// HTML építő funkció

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });
/**************************************************************
* AnalysisFlow.js - Fő Elemzési Munkafolyamat
* VÁLTOZÁS (v50.1): A 'saveAnalysisToSheet' hívás most már
* átadja a 'fixtureId'-t az öntanuló hurok támogatásához.
* VÁLTOZÁS (v50): A teljes "AI Bizottság" (Kritikus Lánc)
* architektúra eltávolítva és helyettesítve egyetlen
* 'getConsolidatedAnalysis' hívással a jobb teljesítmény,
* koherencia és mélyebb elemzés érdekében.
* A 'buildPropheticTimeline' eltávolítva a spekulatív
* (Math.random) természete miatt.
**************************************************************/

export async function runFullAnalysis(params, sport, openingOdds) {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving = null; // v50.1: Változó a FixtureID tárolására
    try {
        // Parameter validation and extraction
        const { home: rawHome, away: rawAway, force: forceNewStr, sheetUrl, utcKickoff, leagueName } = params;
        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        const home = String(rawHome).trim();
        const away = String(rawAway).trim();
        const forceNew = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        analysisCacheKey = `analysis_v21_advanced_${sport}_${safeHome}_vs_${safeAway}`;

        // Cache check
        if (!forceNew) {
            const cachedResult = scriptCache.get(analysisCacheKey);
            if (cachedResult) {
                console.log(`Cache találat (${analysisCacheKey})`);
                return cachedResult;
            } else {
                console.log(`Nincs cache (${analysisCacheKey}), friss elemzés indul...`);
            }
        } else {
            console.log(`Újraelemzés kényszerítve (${analysisCacheKey})`);
        }

        // --- JAVÍTOTT BLOKK KEZDETE (v45 logika) ---
        
        // --- 1. Alapkonfiguráció ---
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) {
            throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);
        }

        // --- 2. Fő Adatgyűjtés (Ez adja vissza az oddsData-t IS) ---
        console.log(`Adatgyűjtés indul: ${home} vs ${away}...`);
        const { 
            rawStats, 
            richContext, 
            advancedData, 
            form, 
            rawData, // Ez tartalmazza az apiFootballData-t
            leagueAverages = {}, 
            oddsData
        } = await getRichContextualData(sport, home, away, leagueName, utcKickoff);
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);

        // v50.1: FixtureID kinyerése mentéshez
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Odds és kontextus függő elemzések (Most már biztonságos) ---
        
        let mutableOddsData = oddsData;
        if (!mutableOddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez (API-Football).`);
            mutableOddsData = { current: [], allMarkets: [], fromCache: false, sport: sport, fullApiData: null };
        }

        const marketIntel = analyzeLineMovement(mutableOddsData, openingOdds, sport, home);
        // --- v45 JAVÍTÁS ITT ---
        // Átadjuk a 'sport' paramétert, hogy a helyes (2.5) alapértelmezett vonalat használja
        // Ez a hívás most már a 'utils.js'-ből importált függvényt használja.
        const mainTotalsLine = findMainTotalsLine(mutableOddsData, sport) ||
            sportConfig.totals_line;
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);
        // --- v45 JAVÍTÁS VÉGE ---

        const duelAnalysis = analyzePlayerDuels(rawData?.key_players, sport);
        const psyProfileHome = calculatePsychologicalProfile(home, away, rawData);
        const psyProfileAway = calculatePsychologicalProfile(away, home, rawData);
        // --- JAVÍTOTT BLOKK VÉGE ---


        // --- 2. Statisztikai Modellezés ---
        console.log(`Modellezés indul: ${home} vs ${away}...`);
        const { mu_h, mu_a } = estimateXG(home, away, rawStats, sport, form, leagueAverages, advancedData, rawData, psyProfileHome, psyProfileAway);
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(rawData, sport, leagueAverages);
        
        // Ez az a hívás, ami a 'Poisson' hibát dobta.
        const sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, rawData);
        
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners;
        sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        const modelConfidence = calculateModelConfidence(sport, home, away, rawData, form, sim, marketIntel);
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away); // 'mutableOddsData' használata
        console.log(`Modellezés kész: ${home} vs ${away}.`);

        // --- 3. KONSZOLIDÁLT AI ELEMZÉS (v50) ---
        console.log(`Konszolidált Fő Elemző hívása indul: ${home} vs ${away}...`);
        
        const safeRichContext = typeof richContext === 'string' ? richContext : "Kontextus adatok hiányosak.";
        const richContextWithDuels = `${safeRichContext}\n- **Kulcs Párharc Elemzés:** ${duelAnalysis || 'N/A'}`;
        
        // A 'buildPropheticTimeline' hívás eltávolítva (v50)
        // const propheticTimeline = buildPropheticTimeline(mu_h, mu_a, rawData, sport, home, away); // TÖRÖLVE

        // A "Kritikus Lánc" és "Párhuzamos Ág" (10+ hívás) eltávolítva (v50)
        
        // Ehelyett egyetlen adatobjektumot építünk
        const allDataForAI = {
            simJson: sim,
            valueBetsJson: valueBets,
            modelConfidence: modelConfidence,
            richContext: richContextWithDuels,
            rawDataJson: rawData, // A teljes nyers adat a mélyebb taktikai elemzéshez
            marketIntel: marketIntel,
            // Átadjuk a sim adatokat a prompt-ba, hogy a micromodellek promptjai megkapják
            sim_mainTotalsLine: sim.mainTotalsLine,
            mu_corners_sim: sim.mu_corners_sim,
            mu_cards_sim: sim.mu_cards_sim
        };

        // Egyetlen AI hívás, amely visszaadja a teljes elemzési struktúrát
        const fullAnalysisReport = await getConsolidatedAnalysis(allDataForAI);

        // A 'committeeResults' most már a teljes riport
        const committeeResults = fullAnalysisReport;
        
        // A mester ajánlás már a riport része
        const masterRecommendation = fullAnalysisReport.master_recommendation || { "recommended_bet": "Hiba", "final_confidence": 1.0, "brief_reasoning": "AI Hiba: A konszolidált riport nem tartalmazott ajánlást." };
        
        console.log(`Konszolidált elemzés és ajánlás megkapva: ${JSON.stringify(masterRecommendation)}`);
        
        // --- 6. Mester Ajánlás Lekérése (Már megtörtént a 3. lépésben) ---
        // --- 7. Végső HTML Generálás ---
        console.log(`HTML generálás indul: ${home} vs ${away}...`);
        const finalHtml = buildAnalysisHtml(
            committeeResults, // Ez már a teljes, konszolidált objektum
            { home, away, sport, mainTotalsLine, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, propheticTimeline: null }, // propheticTimeline: null (v50)
            mutableOddsData, // 'mutableOddsData' használata
            valueBets,
            modelConfidence,
            sim,
            masterRecommendation
         );
        console.log(`HTML generálás kész: ${home} vs ${away}.`);
        // --- 8. Válasz Elküldése és Naplózás ---
        const debugInfo = {
             // ... (Debug infók)
            playerDataFetched: rawData?.key_players && (rawData.key_players.home?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A') || rawData.key_players.away?.some(p => p.stats && typeof p.stats === 'string' && p.stats !== 'N/A')) ? `Igen, ${(rawData.key_players.home?.length || 0) + (rawData.key_players.away?.length || 0)} játékosra` : "Nem (vagy nem talált adatot)",
             sportMonksUsedInXG: (sport === 'soccer' && advancedData?.home?.xg != null) ?
 "Igen (valós xG - API-Football)" : (sport === 'hockey' && rawData?.advanced_stats_team?.home?.High_Danger_Chances_For_Pct != null) ?
 "Igen (HDCF%)" : (sport === 'basketball' && rawData?.advanced_data?.home?.pace != null) ?
 "Igen (Pace/Rating)" : "Nem (becsült adatok)",
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        const jsonResponse = { html: finalHtml, debugInfo: debugInfo };
        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejeve és cache mentve (${analysisCacheKey})`);

        if (params.sheetUrl && typeof params.sheetUrl === 'string') {
            // --- JAVÍTÁS v50.1: Átadjuk a fixtureIdForSaving-t a mentéshez ---
            saveAnalysisToSheet(params.sheetUrl, {
                sport, 
                home, 
                away, 
                date: new Date(), 
                html: finalHtml, 
                id: analysisCacheKey,
                fixtureId: fixtureIdForSaving, // <-- ÚJ ADAT (v50.1)
                recommendation: masterRecommendation
            })
                .then(() => console.log(`Elemzés mentve a Google Sheet-be (${analysisCacheKey})`))
                .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));
        }

        return jsonResponse;
    } catch (error) {
        const homeParam = params?.home || 'N/A';
        const awayParam = params?.away || 'N/A';
        const sportParam = sport || params?.sport || 'N/A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}