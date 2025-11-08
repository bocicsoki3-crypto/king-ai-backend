// --- settlementService.ts (v71.0 - "Auditor" Bővítés) ---
// MÓDOSÍTÁS (v71.0):
// 1. HOZZÁADVA: Importálja a 'runAuditAnalysis'-t a 'LearningService'-ből.
// 2. HOZZÁADVA: 'AUDIT_THRESHOLD' (7.0) konstans.
// 3. MÓDOSÍTVA: A 'runSettlementProcess' logikája kibővítve.
// 4. LOGIKA: Ha egy tipp 'L' (Loss) ÉS a bizalma >= AUDIT_THRESHOLD:
//    a) Beolvassa a 'JSON_Data' oszlopot.
//    b) Lefuttatja a 'runAuditAnalysis'-t (7. Ügynök)
//    c) A tanulság naplózásra kerül (a 'LearningService'-en keresztül).

import { getHistorySheet } from './sheets.js';
import { getApiSportsFixtureResult } from './providers/apiSportsProvider.js';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';

// === ÚJ (v71.0): Auditor importálása ===
import { runAuditAnalysis } from './LearningService.js';
// =====================================

import type { FixtureResult } from './src/types/canonical.d.ts';

// Az elszámolási folyamat eredményének típusa
type SettlementResult = {
    message: string;
    processed: number;
    updated: number;
    errors: number;
    audits_triggered: number; // ÚJ (v71.0)
    error?: undefined;
} | {
    error: string;
    processed: number;
    updated: number;
    errors: number;
    audits_triggered: number; // ÚJ (v71.0)
    message?: undefined;
};

// === ÚJ (v71.0): Minimális bizalmi szint az audit indításához ===
const AUDIT_THRESHOLD = 7.0; 

/**
 * Összehasonlítja a tárolt tippet a valós végeredménnyel és visszaadja a W/L/P státuszt.
 * (Változatlan v71.0)
 */
function checkPredictionCorrectness(prediction: string, result: Extract<FixtureResult, { status: 'FT' }>): "W" | "L" | "P" | "N/A" {
    if (!prediction || prediction === 'N/A' || !result) {
        return "N/A"; // Nem lehet kiértékelni
    }

    const { home, away } = result;
    const totalGoals = home + away;
    const lowerPred = prediction.toLowerCase();
    
    try {
        // 1X2 piacok
        if (lowerPred.includes('hazai győzelem') || lowerPred.includes('home')) {
            return home > away ? 'W' : 'L';
        }
        if (lowerPred.includes('vendég győzelem') || lowerPred.includes('away')) {
            return away > home ? 'W' : 'L';
        }
        if (lowerPred.includes('döntetlen') || lowerPred.includes('draw')) {
            return home === away ? 'W' : 'L';
        }
        // Dupla esély
        if (lowerPred.includes('hazai győzelem vagy döntetlen') || lowerPred.includes('1x')) {
            return home >= away ? 'W' : 'L';
        }
        if (lowerPred.includes('vendég győzelem vagy döntetlen') || lowerPred.includes('x2')) {
            return away >= home ? 'W' : 'L';
        }
        if (lowerPred.includes('hazai vagy vendég') || lowerPred.includes('12')) {
            return home !== away ? 'W' : 'L';
        }

        // BTTS (Both Teams To Score)
        if (lowerPred.includes('btts igen') || (lowerPred.includes('mindkét csapat szerez gólt') && !lowerPred.includes('nem'))) {
            return (home > 0 && away > 0) ? 'W' : 'L';
        }
        if (lowerPred.includes('btts nem') || (lowerPred.includes('mindkét csapat szerez gólt') && lowerPred.includes('nem'))) {
            return (home === 0 || away === 0) ? 'W' : 'L';
        }

        // Over/Under piacok
        const overUnderMatch = lowerPred.match(/(over|under|felett|alatt)\s*(\d+(\.\d+)?)/);
        if (overUnderMatch) {
            const type = overUnderMatch[1];
            const line = parseFloat(overUnderMatch[2]);

            if (isNaN(line)) return "N/A";

            if (type === 'over' || type === 'felett') {
                if (totalGoals > line) return 'W';
                if (totalGoals < line) return 'L';
                return 'P'; // Push
            }
            if (type === 'under' || type === 'alatt') {
                if (totalGoals < line) return 'W';
                if (totalGoals > line) return 'L';
                return 'P'; // Push
            }
        }

        console.warn(`[Settlement] Ismeretlen tipp formátum, nem lehet kiértékelni: "${prediction}"`);
        return "N/A";
    } catch (e: any) {
        console.error(`[Settlement] Hiba a tipp kiértékelésekor (${prediction}): ${e.message}`);
        return "N/A";
    }
}


/**
 * Fő elszámolási folyamat.
 * Végigmegy a "History" lapon, lekéri a hiányzó eredményeket és frissíti a W/L/P státuszt.
 * MÓDOSÍTVA (v71.0): Most már indítja a 7. Ügynök (Auditor) elemzését, ha szükséges.
 */
export async function runSettlementProcess(): Promise<SettlementResult> {
    console.log("[Settlement] Eredmény-elszámolási folyamat indítása (v71.0 - Auditorral)...");
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    let auditCount = 0; // ÚJ (v71.0)

    try {
        const sheet = await getHistorySheet(); // Ez a v71.0-s 'sheets.ts' miatt már a 'JSON_Data' oszlopot is tartalmazza
        const rows: GoogleSpreadsheetRow<any>[] = await sheet.getRows();

        const unsettledRows = rows.filter(row => {
            const status = row.get("Helyes (W/L/P)") as string | undefined;
            const fixtureId = row.get("FixtureID") as string | undefined;
            // Csak azokat, amik még nincsenek kitöltve ÉS van FixtureID-juk
            return (!status || status === "N/A" || status === "") && (fixtureId && fixtureId !== "null");
        });
        
        if (unsettledRows.length === 0) {
            console.log("[Settlement] Befejezve. Nem található új, elszámolandó sor.");
            return { message: "Nincs elszámolandó sor.", processed: 0, updated: 0, errors: 0, audits_triggered: 0 };
        }

        console.log(`[Settlement] ${unsettledRows.length} elszámolatlan sor található. Feldolgozás indul...`);
        
        for (const row of unsettledRows) {
            const fixtureId = row.get("FixtureID") as string;
            const sport = row.get("Sport") as string;
            const prediction = row.get("Tipp") as string;
            const analysisId = row.get("ID") as string;
            const confidenceStr = row.get("Bizalom") as string; // ÚJ (v71.0)
            
            try {
                // 1. Valós eredmény lekérése
                const result: FixtureResult = await getApiSportsFixtureResult(fixtureId, sport);
                processedCount++;

                if (result && result.status === 'FT' && result.home !== undefined) {
                    // 2. Eredmény kiértékelése
                    const wlp_status = checkPredictionCorrectness(prediction, result as Extract<FixtureResult, { status: 'FT' }>);
                    const finalScore = `${result.home}-${result.away}`;

                    // 3. Sor frissítése a Google Sheet-ben
                    row.set("Valós Eredmény", finalScore);
                    row.set("Helyes (W/L/P)", wlp_status);
                    await row.save();
                    
                    console.log(`[Settlement] FRISSÍTVE (ID: ${analysisId}): Tipp="${prediction}", Eredmény=${finalScore} -> ${wlp_status}`);
                    updatedCount++;

                    // === ÚJ (v71.0): AUDITOR INDÍTÁSA ===
                    const confidence = parseFloat(confidenceStr);
                    if (wlp_status === 'L' && !isNaN(confidence) && confidence >= AUDIT_THRESHOLD) {
                        console.warn(`[Settlement] MAGAS BIZALMÚ HIBA ÉSZLELVE (Bizalom: ${confidence}). 7. Ügynök (Auditor) indítása... (ID: ${analysisId})`);
                        
                        // Olvassuk ki a teljes JSON-t a sorból
                        const originalAnalysisJson = row.get("JSON_Data") as string;
                        if (originalAnalysisJson) {
                            try {
                                const originalAnalysis = JSON.parse(originalAnalysisJson);
                                
                                // Indítjuk az auditot (ez egy aszinkron hívás,
                                // de nem várjuk be, hogy ne blokkolja az elszámolást)
                                runAuditAnalysis(
                                    originalAnalysis,
                                    prediction,
                                    confidence,
                                    finalScore,
                                    'L'
                                ).catch(auditError => {
                                    console.error(`[Settlement] 7. Ügynök (Auditor) futási hiba (ID: ${analysisId}): ${auditError.message}`);
                                });
                                auditCount++;

                            } catch (parseError: any) {
                                console.error(`[Settlement] Auditor hiba: Nem sikerült feldolgozni a 'JSON_Data' oszlopot (ID: ${analysisId}). Az audit kihagyva. Hiba: ${parseError.message}`);
                            }
                        } else {
                            console.warn(`[Settlement] Auditor hiba: A 'JSON_Data' oszlop üres (ID: ${analysisId}). Az audit kihagyva.`);
                        }
                    }
                    // === AUDITOR VÉGE ===

                } else if (result && result.status) {
                    console.log(`[Settlement] KIHAGYVA (ID: ${analysisId}): Meccs még folyamatban (Státusz: ${result.status}).`);
                } else {
                    console.warn(`[Settlement] KIHAGYVA (ID: ${analysisId}): Nem sikerült lekérni a ${fixtureId} végeredményét.`);
                }

                await new Promise(resolve => setTimeout(resolve, 500)); 

            } catch (e: any) {
                errorCount++;
                console.error(`[Settlement] Hiba a sor feldolgozása közben (ID: ${analysisId}): ${e.message}`);
            }
        }

        console.log(`[Settlement] Elszámolás befejezve. Feldolgozva: ${processedCount}, Frissítve: ${updatedCount}, Hiba: ${errorCount}, Audit Indítva: ${auditCount}`);
        return {
            message: "Elszámolás befejezve.",
            processed: processedCount,
            updated: updatedCount,
            errors: errorCount,
            audits_triggered: auditCount
        };
        
    } catch (e: any) {
        console.error(`[Settlement] KRITIKUS HIBA az elszámolási folyamat során: ${e.message}`, e.stack);
        return { error: `Kritikus hiba: ${e.message}`, processed: processedCount, updated: updatedCount, errors: errorCount, audits_triggered: auditCount };
    }
}