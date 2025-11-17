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
            const cachedResult = scriptCache.get<IAnalysisResponse>(
