// --- bff_transformer.ts ---
//
// Ez a fájl a "Backend-for-Frontend" (BFF) réteg fordítója.
// Feladata: Az "ÚJ, TISZTA" AI válasz (amit az AnalysisFlow.js ad)
// átalakítása a "RÉGI, MONOLITIKUS" JSON struktúrává,
// amit a frontend (script.js -> buildAnalysisHtml_CLIENTSIDE) elvár.
//

/**
 * Az új, tiszta AI válasz (AnalysisFlow.js kimenete)
 * Ezt az `architecture_plan.md` 4. pontja alapján feltételezzük.
 * Ezt a struktúrát kell majd finomítanod, hogy illeszkedjen
 * a Python `AI Modelling Service` valós kimenetéhez.
 */
interface NewAnalysisResult {
    analysisData: {
        // ÚJ, TISZTA AI ADATOK
        main_recommendation: {
            bet_name: string; // pl. "Gólok száma 2.5 Alatt"
            confidence: number; // pl. 7.5
            reasoning: string; // pl. "A szimulációk alapján..."
        };
        prophetic_scenario: string; // pl. "A meccs lassan indul..."
        strategic_analysis: string; // pl. "A statisztika és a hírek..."
        quant_baseline: any; // pl. { mu_h: 1.05, mu_a: 1.01 }
        simulation: any; // pl. { pHome: 38.0, ... }
        // A frontend által várt egyéb adatok
        matchData: any;
        oddsData: any;
        valueBets: any[];
        modelConfidence: number;
        availableRosters?: any;
        micromodels?: any; // Feltételezzük, hogy az új válasz is tartalmazza ezt
    };
    debugInfo?: any;
    // ... és bármi más, amit az AnalysisFlow.js visszaad
}

/**
 * A "Régi" (Legacy) válasz struktúra, amit a script.js elvár.
 * Ezt a script.js `buildAnalysisHtml_CLIENTSIDE` függvénye alapján
 * és a régi AI_Service.ts fájlból vezetjük le.
 */
interface LegacyFrontendResponse {
    analysisData: {
        // A frontend ezeket a kulcsokat várja:
        committee: {
            strategist: {
                // A HIBÁT OKOZÓ KULCSOK:
                prophetic_timeline: string;   // <-- Erre fordítjuk: new.prophetic_scenario
                strategic_synthesis: string;  // <-- Erre fordítjuk: new.strategic_analysis
                
                // Egyéb várt mezők (feltöltve default értékekkel, ha hiányoznak)
                final_confidence_report: string;
                micromodels: any;
            };
            critic?: any;
            quant?: any;
            scout?: any;
        };
        // A fő ajánlás
        recommendation: {
            recommended_bet: string;
            final_confidence: number;
            brief_reasoning: string;
        };
        // Egyéb adatok, amiket a script.js (buildAnalysisHtml_CLIENTSIDE) használ
        sim: any;
        finalConfidenceScore: number;
        quantConfidence: number; // Ez a 'modelConfidence'
        modelConfidence: number;
        matchData: any;
        oddsData: any;
        valueBets: any[];
        availableRosters?: any;
        xgSource?: string;
    };
    debugInfo?: any;
}


/**
 * Ez a BFF transzformációs függvény.
 * Átalakítja az ÚJ választ RÉGI formátumra.
 * FONTOS: Ez a függvény feltételezi, hogy az `AnalysisFlow.js`
 * egy `NewAnalysisResult` struktúrájú objektumot ad vissza.
 * Ha az `AnalysisFlow.js` (amit én nem látok) más struktúrát ad vissza,
 * akkor a 'result.analysisData.' hivatkozásokat itt frissíteni kell!
 */
export function transformAnalysisToLegacyFormat(result: NewAnalysisResult): LegacyFrontendResponse {
    
    // Alapértelmezett válaszstruktúra létrehozása
    const legacyResponse: LegacyFrontendResponse = {
        analysisData: {
            committee: {
                strategist: {
                    // === A FORDÍTÁS ===
                    // A frontend 'prophetic_timeline'-t vár, de az új AI 'prophetic_scenario'-t ad.
                    prophetic_timeline: result.analysisData?.prophetic_scenario || 
                        "Hiba: A 'prophetic_scenario' hiányzik az új AI válaszból. (BFF Transformer)",
                    
                    // A frontend 'strategic_synthesis'-t vár, de az új AI 'strategic_analysis'-t ad.
                    strategic_synthesis: result.analysisData?.strategic_analysis || 
                        "Hiba: A 'strategic_analysis' hiányzik az új AI válaszból. (BFF Transformer)",
                        
                    // A frontend a teljes bizalmi riportot várja szövegként
                    final_confidence_report: `**${result.analysisData?.main_recommendation?.confidence?.toFixed(1) || '1.0'}/10** - ${result.analysisData?.main_recommendation?.reasoning || 'N/A'}`,
                    
                    // Mikromodellek (ha vannak az új válaszban, ide kell mappelni)
                    micromodels: result.analysisData.micromodels || {} // Tegyük fel, hogy az új válaszban is van ilyen kulcs
                },
                // Ezeket is fel kell tölteni, ha a frontend elvárja
                quant: result.analysisData?.quant_baseline || { source: 'BFF Transformer', mu_h: 0, mu_a: 0 },
                critic: {}, // Töltsd ki, ha van megfelelője az új válaszban
                scout: {}   // Töltsd ki, ha van megfelelője az új válaszban
            },
            
            // A fő ajánlás átalakítása
            recommendation: {
                recommended_bet: result.analysisData?.main_recommendation?.bet_name || "Hiba (BFF)",
                final_confidence: result.analysisData?.main_recommendation?.confidence || 1.0,
                brief_reasoning: result.analysisData?.main_recommendation?.reasoning || "N/A"
            },
            
            // Egyéb, közvetlenül átadott adatok
            sim: result.analysisData?.simulation || { pHome: 0, pDraw: 0, pAway: 0 },
            finalConfidenceScore: result.analysisData?.main_recommendation?.confidence || 1.0,
            quantConfidence: result.analysisData?.modelConfidence || 1.0,
            modelConfidence: result.analysisData?.modelConfidence || 1.0,
            matchData: result.analysisData?.matchData || {},
            oddsData: result.analysisData?.oddsData || {},
            valueBets: result.analysisData?.valueBets || [],
            availableRosters: result.analysisData?.availableRosters || undefined,
            xgSource: result.debugInfo?.xgSource || 'N/A'
        },
        debugInfo: result.debugInfo || {}
    };

    return legacyResponse;
}
