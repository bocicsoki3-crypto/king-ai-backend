// LearningService.ts (v71.2 - Karcsúsított Audit)
// MÓDOSÍTÁS (v71.2):
// 1. MÓDOSÍTVA: A 'PROMPT_AUDITOR_V1' frissítve, hogy a "karcsúsított"
//    (lean) JSON formátumot várja, amelyet az AnalysisFlow (v71.2) küld.
// 2. MÓDOSÍTVA: A 'runAuditAnalysis' funkció most már a 'leanAuditData'-t
//    (nem a 'fullAnalysis'-t) kapja meg, és ezt adja át a promptnak.

import NodeCache from 'node-cache';
import { getHistorySheet, logLearningInsight } from './sheets.js';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';
import { 
    _callGeminiWithJsonRetry, 
    fillPromptTemplate 
} from './providers/common/utils.js'; 

// --- Típusdefiníciók ---
interface IPowerRating {
    atk: number;
    def: number;
    matches: number;
}
interface IMatchLogEntry {
    date: string;
    sport: string;
    home: string;
    away: string;
    predicted: { h: number; a: number };
    actual: { h: number; a: number };
    confidence: number;
    xg_diff: number;
}
interface INarrativeRating {
    [ratingName: string]: number;
}
interface IConfidenceBucket {
    wins: number;
    losses: number;
    pushes: number;
    total: number; // W+L
}
// Globális gyorsítótárak a ratingeknek
const ratingCache = new NodeCache({ stdTTL: 0 });
const confidenceCache = new NodeCache({ stdTTL: 0 });

const POWER_RATING_KEY = 'power_ratings_v2';
const MATCH_LOG_KEY = 'match_log_v2';
const NARRATIVE_RATINGS_KEY = 'narrative_ratings_v2';
const CONFIDENCE_CALIBRATION_KEY = 'confidence_calibration_v1';

// --- ÖNTANULÓ ÉS ÉRTÉKELŐ MODULOK (Változatlan) ---

/**
 * Naplózza a meccs eredményét a ratingek frissítéséhez (Cache-be).
 */
export function logMatchResult(
    sport: string, 
    home: string, 
    away: string, 
    mu_h: number, 
    mu_a: number, 
    actual_gh: number, 
    actual_ga: number, 
    confidence: number, 
    xg_diff: number
): void {
    try {
        const log = ratingCache.get<IMatchLogEntry[]>(MATCH_LOG_KEY) || [];
        const newEntry: IMatchLogEntry = {
            date: new Date().toISOString(), sport, home, away,
            predicted: { h: mu_h, a: mu_a },
            actual: { h: actual_gh, a: actual_ga },
            confidence, xg_diff
        };
        log.push(newEntry);
        if (log.length > 300) log.shift(); // Limitáljuk a log méretét
        ratingCache.set(MATCH_LOG_KEY, log);
    } catch (e: any) {
        console.error(`Hiba a meccs naplózása közben: ${e.message}`);
    }
}

/**
 * Frissíti a Power Ratingeket a naplózott meccsek alapján (Cache-ben).
 */
export function updatePowerRatings(): { updated: boolean; matches_processed: number; valid_updates: number } | null {
    const log = ratingCache.get<IMatchLogEntry[]>(MATCH_LOG_KEY) || [];
    if (log.length < 20) { // Csak akkor frissítünk, ha elég új adat gyűlt össze
        console.log(`Power Rating frissítés kihagyva, túl kevés új meccs (${log.length}/20).`);
        return null; // Visszaadjuk, hogy nem történt frissítés
    }

    const powerRatings = ratingCache.get<{ [teamName: string]: IPowerRating }>(POWER_RATING_KEY) || {};
    const learningRate = 0.008; // Óvatos tanulási ráta
    let updatedCount = 0;
    
    log.forEach(match => {
        // Ellenőrzések, hogy csak valid adatokkal tanuljunk
        if (!match.actual || typeof match.actual.h !== 'number' || typeof match.actual.a !== 'number' ||
            !match.predicted || typeof match.predicted.h !== 'number' || typeof match.predicted.a !== 'number' ||
            match.predicted.h <= 0 || match.predicted.a <= 0) {
            console.warn(`Power Rating: Hibás adat kihagyva a tanulásból: ${match.home} vs ${match.away}`);
            return;
        }

        const homeTeam = match.home.toLowerCase();
        const awayTeam = match.away.toLowerCase();

        // Inicializálás, ha a csapat új
        if (!powerRatings[homeTeam]) powerRatings[homeTeam] = { atk: 1, def: 1, matches: 0 };
        if (!powerRatings[awayTeam]) powerRatings[awayTeam] = { atk: 1, def: 1, matches: 0 };

        // A hiba számítása: Valós gólok - Becsült gólok
        const homeAtkError = match.actual.h - match.predicted.h;
        const awayAtkError = match.actual.a - match.predicted.a;
        // A védekezési hiba az ellenfél támadó hibája (fordított előjellel a korrekcióhoz)
        const homeDefError = match.actual.a - match.predicted.a;
        const awayDefError = match.actual.h - match.predicted.h;
        
        // Súlyozás a bizalom alapján (magasabb bizalom = nagyobb hatás)
        const confidenceWeight = Math.max(0.1, (match.confidence || 5) / 10);
        
        // Ratingek frissítése a hibával és a tanulási rátával
        powerRatings[homeTeam].atk += learningRate * homeAtkError * confidenceWeight;
        powerRatings[awayTeam].atk += learningRate * awayAtkError * confidenceWeight;
        // A védekezési ratinget fordítva módosítjuk: ha sokat kaptunk (pozitív hiba), rontjuk a def ratinget (csökkentjük a szorzót)
        powerRatings[homeTeam].def -= learningRate * homeDefError * confidenceWeight;
        powerRatings[awayTeam].def -= learningRate * awayDefError * confidenceWeight;

        // Ratingek korlátozása (hogy ne szálljanak el)
        const MIN_RATING = 0.7;
        const MAX_RATING = 1.3;
        powerRatings[homeTeam].atk = Math.max(MIN_RATING, Math.min(MAX_RATING, powerRatings[homeTeam].atk));
        powerRatings[homeTeam].def = Math.max(MIN_RATING, Math.min(MAX_RATING, powerRatings[homeTeam].def));
        powerRatings[awayTeam].atk = Math.max(MIN_RATING, Math.min(MAX_RATING, powerRatings[awayTeam].atk));
        powerRatings[awayTeam].def = Math.max(MIN_RATING, Math.min(MAX_RATING, powerRatings[awayTeam].def));

        // Meccsszám növelése
        powerRatings[homeTeam].matches++;
        powerRatings[awayTeam].matches++;
        updatedCount++;
    });
    
    if (updatedCount > 0) {
        ratingCache.set(POWER_RATING_KEY, powerRatings);
        ratingCache.set(MATCH_LOG_KEY, []); // Ürítjük a logot, mert feldolgoztuk
        console.log(`Power ratingek sikeresen frissítve ${log.length} meccs alapján (${updatedCount} valid feldolgozva) (Cache-ben).`);
        return { updated: true, matches_processed: log.length, valid_updates: updatedCount };
    } else {
        console.log(`Power Rating frissítés: Nem volt valid adat a feldolgozáshoz ${log.length} naplózott meccsből.`);
        ratingCache.set(MATCH_LOG_KEY, []); // Ürítjük a logot akkor is, ha nem volt valid adat
        return { updated: false, matches_processed: log.length, valid_updates: 0 };
    }
}


/**
 * Lekéri az aktuális Power Ratingeket (Cache-ből).
 */
export function getAdjustedRatings(): { [teamName: string]: IPowerRating } {
    return ratingCache.get<{ [teamName: string]: IPowerRating }>(POWER_RATING_KEY) || {};
}

/**
 * Lekéri az aktuális Narratív Ratingeket (Cache-ből).
 */
export function getNarrativeRatings(): { [teamName: string]: INarrativeRating } {
    return ratingCache.get<{ [teamName: string]: INarrativeRating }>(NARRATIVE_RATINGS_KEY) || {};
}

interface ILearning {
    team: string;
    rating: string;
    adjustment: number;
}

/**
 * Frissíti a Narratív Ratingeket a kapott tanulságok alapján (Cache-be).
 */
export function updateNarrativeRatings(learnings: ILearning[]): void {
    if (!learnings || learnings.length === 0) return;

    const narrativeRatings = getNarrativeRatings();
    const learningRate = 0.04; // Narratívára nagyobb ráta lehet

    learnings.forEach(learning => {
        if (!learning || !learning.team || !learning.rating || typeof learning.adjustment !== 'number') {
            console.warn("Narratív tanulás: Hibás tanulság objektum kihagyva:", learning);
            return;
        }

        const team = learning.team.toLowerCase();
        if (!narrativeRatings[team]) narrativeRatings[team] = {}; // Inicializálás, ha új csapat

 
        const ratingName = learning.rating;
        // Ha még nincs ilyen rating a csapatnál, 0-ról indul
        if (!narrativeRatings[team][ratingName]) narrativeRatings[team][ratingName] = 0;

        let currentRating = narrativeRatings[team][ratingName];
        // Korrekció: adjustment iránya (+/-) alapján módosítunk
        currentRating += learningRate * learning.adjustment;

        // Korlátozás (pl. -0.4 és +0.4 között)
        const MIN_NARRATIVE = -0.4;
        const MAX_NARRATIVE = 0.4;
        narrativeRatings[team][ratingName] = Math.max(MIN_NARRATIVE, Math.min(MAX_NARRATIVE, currentRating));
    });

    ratingCache.set(NARRATIVE_RATINGS_KEY, narrativeRatings); // Frissítjük a cache-t
    console.log(`Narratív ratingek frissítve ${learnings.length} tanulság alapján.`);
}


// --- BIZALMI KALIBRÁCIÓ (Változatlan v71.0) ---

type CalibrationResult = {
    message: string;
    processed_relevant_rows: number;
    significant_buckets: number;
    error?: undefined;
} | {
    error: string;
    message?: undefined;
};

type ConfidenceBuckets = { [key: string]: IConfidenceBucket };

/**
 * Elindítja a bizalmi szintek újra-kalibrálását a "History" sheet alapján.
 */
export async function runConfidenceCalibration(): Promise<CalibrationResult> {
    console.log("Meta-tanulás: Bizalmi kalibráció indítása a 'History' alapján...");
    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows();
        
        if (rows.length < 10) {
            console.warn(`Bizalmi kalibráció kihagyva: Túl kevés minta (${rows.length}).`);
            return { message: "Kalibráció kihagyva (kevés minta)", processed_relevant_rows: 0, significant_buckets: 0 };
        }

        const buckets: ConfidenceBuckets = {};
        // Bucket-ek inicializálása 1.0-tól 9.9-ig (10-esével)
        for (let i = 1; i < 10; i++) {
            const lowerBound = i.toFixed(1);
            const upperBound = (i + 0.9).toFixed(1);
            const key = `${lowerBound}-${upperBound}`;
            buckets[key] = { wins: 0, losses: 0, pushes: 0, total: 0 };
        }
        // Külön bucket a 10.0-nak
        buckets["10.0-10.0"] = { wins: 0, losses: 0, pushes: 0, total: 0 };
        
        let processed = 0;
        for (const row of rows) {
            const confidenceStr = row.get("Bizalom") as string;
            const result = row.get("Helyes (W/L/P)")?.toUpperCase() as string | undefined;
            
            // Csak akkor dolgozzuk fel, ha van bizalom és érvényes eredmény (W, L, vagy P)
            if (confidenceStr && result && ['W', 'L', 'P'].includes(result)) {
                const confidence = parseFloat(confidenceStr);
                
                if (isNaN(confidence) || confidence < 1.0 || confidence > 10.0) continue;
                
                let bucketKey: string;
                if (confidence === 10.0) {
                    bucketKey = "10.0-10.0";
                } else {
                    const confFloor = Math.floor(confidence);
                    bucketKey = `${confFloor.toFixed(1)}-${(confFloor + 0.9).toFixed(1)}`; 
                }

                if (buckets[bucketKey]) {
                    if (result === 'W') buckets[bucketKey].wins++;
                    else if (result === 'L') buckets[bucketKey].losses++;
                    else if (result === 'P') buckets[bucketKey].pushes++;
                    
                    // A 'total'-ba csak a W és L számít bele
                    if (result === 'W' || result === 'L') {
                        buckets[bucketKey].total++;
                    }
                    processed++;
                } else {
                    console.warn(`Kalibráció: Ismeretlen bucket kulcs ${confidence}-hez: ${bucketKey}`);
                }
            }
        }

        // Eredmények mentése a cache-be
        confidenceCache.set(CONFIDENCE_CALIBRATION_KEY, buckets);
        console.log(`Bizalmi kalibráció sikeresen lefutott. Feldolgozott releváns sorok: ${processed}.`);
        
        const significantBuckets: any = {};
        for(const [key, value] of Object.entries(buckets)) {
            if (value.total >= 5) { // Csak ha van elég minta
                significantBuckets[key] = { 
                    ...value, 
                    accuracy: value.total > 0 ? (value.wins / value.total * 100).toFixed(1) + '%' : 'N/A' 
                };
            }
        }
        
        if (Object.keys(significantBuckets).length > 0) {
            console.log("Jelentős Kalibrációs Eredmények (min 5 minta):", JSON.stringify(significantBuckets, null, 2));
        } else {
            console.log("Jelentős Kalibrációs Eredmények: Nincs elég minta egyetlen bucket-ben sem.");
        }

        return { message: "Kalibráció sikeres.", processed_relevant_rows: processed, significant_buckets: Object.keys(significantBuckets).length };
    
    } catch (e: any) {
        console.error(`Hiba a bizalmi kalibráció során: ${e.message}`, e.stack);
        return { error: `Kalibrációs hiba: ${e.message}` };
    }
}

/**
 * Lekéri a kalibrációs térképet a cache-ből.
 */
export function getConfidenceCalibrationMap(): ConfidenceBuckets {
    return confidenceCache.get<ConfidenceBuckets>(CONFIDENCE_CALIBRATION_KEY) || {};
}


// === MÓDOSÍTVA (v71.2): 7. ÜGYNÖK (AZ AUDITOR) PROMPT ===
// Frissítve, hogy a "karcsúsított" (lean) JSON-t várja
const PROMPT_AUDITOR_V1 = `
TASK: You are 'The Auditor', the 7th Agent.
Your job is to analyze *why* a high-confidence prediction failed.
You are performing a post-match analysis to find the flaw in the original logic.

[INPUT 1: THE ORIGINAL ANALYSIS (Lean JSON - Agent Reports Only)]
{leanAnalysisJson}

[INPUT 2: THE ACTUAL RESULT]
- Predicted Bet: "{prediction}"
- Predicted Confidence: {confidence}/10
- Actual Result: "{actualResult}" (W/L/P Status: {wlpStatus})

[YOUR TASK - FIND THE FLAW]:
1. Review the original analysis chain (Quant, Specialist, Critic, Strategist).
2. Compare the "Prophetic Timeline" (strategist.prophetic_timeline) with the actual result.
3. Identify the *single biggest flaw* in the original reasoning.
   - Did Agent 1 (Quant) use bad data (e.g., P4 fallback)?
   - Did Agent 3 (Specialist) misinterpret the context (e.g., underestimated an injury, wrong weather impact)?
   - Did Agent 5 (Critic) miss a critical risk?
   - Did Agent 6 (Strategist) make a bad decision (e.g., wrongly chose Path B, ignored the Critic)?
   - Was it an unpredictable event (e.g., 5th-minute red card, freak goal)?

[OUTPUT STRUCTURE]:
Your response MUST be ONLY a single, valid JSON object with this EXACT structure.
{
  "flaw_analysis": "<Egy 2-3 mondatos, magyar nyelvű elemzés, amely PONTOSAN megnevezi, hogy az elemzési lánc melyik tagja (Ügynök) és miért hibázott.>",
  "corrective_insight": "<Egy 1 mondatos, magyar nyelvű javaslat, hogy a rendszer hogyan kerülhetné el ezt a hibát a jövőben. (Pl. 'A 3. Ügynöknek (Specialista) erősebben kell súlyoznia a kulcsfontosságú védők hiányát, még akkor is, ha a támadósor ép.')>"
}
`;

// === MÓDOSÍTVA (v71.2): 7. ÜGYNÖK (AUDITOR) FUNKCIÓ ===
/**
 * Elindítja a 7. Ügynök (Auditor) elemzését egy hibás, magas bizalmú tippről.
 * Ezt a 'settlementService' hívja meg.
 */
export async function runAuditAnalysis(
    leanAuditData: any, // A "karcsúsított" 'auditData' objektum (v71.2)
    prediction: string,
    confidence: number,
    actualResult: string, // Pl. "2-1"
    wlpStatus: "L" // Csak 'L' esetén hívjuk
): Promise<void> {
    
    // Az 'leanAuditData' már nem tartalmazza a 'sim' és 'rawData' mezőket.
    const analysisContext = leanAuditData; // Közvetlen felhasználás
    
    const input = {
        leanAnalysisJson: JSON.stringify(analysisContext, null, 2),
        prediction: prediction,
        confidence: confidence,
        actualResult: actualResult,
        wlpStatus: wlpStatus
    };
    
    console.log(`[LearningService] 7. ÜGYNÖK (AUDITOR) INDÍTÁSA: Magas bizalmú hiba (${confidence}/10) elemzése a(z) ${analysisContext.analysisData.matchData.home} vs ${analysisContext.analysisData.matchData.away} meccsen.`);

    try {
        const filledPrompt = fillPromptTemplate(PROMPT_AUDITOR_V1, input);
        const auditResult = await _callGeminiWithJsonRetry(filledPrompt, "Step_Auditor");

        if (auditResult && auditResult.flaw_analysis && auditResult.corrective_insight) {
            console.log(`[LearningService] 7. ÜGYNÖK (AUDITOR) SIKERES: ${auditResult.corrective_insight}`);
            
            // Tanulság mentése a "Learning_Insights" Google Sheet lapra
            await logLearningInsight(process.env.SHEET_URL || '', {
                date: new Date(),
                sport: analysisContext.analysisData.matchData.sport,
                home: analysisContext.analysisData.matchData.home,
                away: analysisContext.analysisData.matchData.away,
                prediction: prediction,
                confidence: confidence,
                actual: actualResult,
                insight: `[AUDITOR v1.2] Hiba: ${auditResult.flaw_analysis} | Javaslat: ${auditResult.corrective_insight}`
            });
        } else {
            throw new Error("Az Auditor válasza érvénytelen JSON struktúrájú.");
        }
    } catch (e: any) {
        console.error(`[LearningService] 7. ÜGYNÖK (AUDITOR) HIBA: ${e.message}`);
    }
}