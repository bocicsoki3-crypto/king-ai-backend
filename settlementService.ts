// --- settlementService.js (v50.1 - Új Modul) ---
// Ez a modul felelős a "Post-Match Settlement" (Utólagos Eredmény-elszámolás) futtatásáért.

import { getHistorySheet } from './sheets.js';
import { getApiSportsFixtureResult } from './providers/apiSportsProvider.js';

/**
 * Összehasonlítja a tárolt tippet a valós végeredménnyel és visszaadja a W/L/P státuszt.
 * @param {string} prediction A tárolt tipp (pl. "Over 2.5", "Hazai győzelem", "BTTS Igen").
 * @param {object} result A valós eredmény (pl. { home: 2, away: 1, status: 'FT' }).
 * @returns {string} "W" (Win), "L" (Loss), vagy "P" (Push/Void).
 */
function checkPredictionCorrectness(prediction, result) {
    if (!prediction || prediction === 'N/A' || !result || result.status !== 'FT') {
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

    } catch (e) {
        console.error(`[Settlement] Hiba a tipp kiértékelésekor (${prediction}): ${e.message}`);
        return "N/A";
    }
}


/**
 * Fő elszámolási folyamat.
 * Végigmegy a "History" lapon, lekéri a hiányzó eredményeket és frissíti a W/L/P státuszt.
 */
export async function runSettlementProcess() {
    console.log("[Settlement] Eredmény-elszámolási folyamat indítása...");
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows();

        const unsettledRows = rows.filter(row => {
            const status = row.get("Helyes (W/L/P)");
            const fixtureId = row.get("FixtureID");
            // Csak azokat, amik még nincsenek kitöltve ÉS van FixtureID-juk
            return (!status || status === "N/A" || status === "") && (fixtureId && fixtureId !== "null");
        });

        if (unsettledRows.length === 0) {
            console.log("[Settlement] Befejezve. Nem található új, elszámolandó sor.");
            return { message: "Nincs elszámolandó sor.", processed: 0, updated: 0 };
        }

        console.log(`[Settlement] ${unsettledRows.length} elszámolatlan sor található. Feldolgozás indul...`);

        // A sorok egyenkénti feldolgozása (elkerülve az API rate limitet)
        for (const row of unsettledRows) {
            const fixtureId = row.get("FixtureID");
            const sport = row.get("Sport");
            const prediction = row.get("Tipp");
            const analysisId = row.get("ID");
            
            try {
                // 1. Valós eredmény lekérése (sport jelenleg 'soccer'-re van korlátozva a providerben)
                const result = await getApiSportsFixtureResult(fixtureId, sport);
                processedCount++;

                if (result && result.status === 'FT') {
                    // 2. Eredmény kiértékelése
                    const wlp_status = checkPredictionCorrectness(prediction, result);
                    const finalScore = `${result.home}-${result.away}`;

                    // 3. Sor frissítése a Google Sheet-ben
                    row.set("Valós Eredmény", finalScore);
                    row.set("Helyes (W/L/P)", wlp_status);
                    await row.save();
                    
                    console.log(`[Settlement] FRISSÍTVE (ID: ${analysisId}): Tipp="${prediction}", Eredmény=${finalScore} -> ${wlp_status}`);
                    updatedCount++;
                } else if (result && result.status) {
                    // A meccs még nem fejeződött be (pl. 'HT', 'NS')
                    console.log(`[Settlement] KIHAGYVA (ID: ${analysisId}): Meccs még folyamatban (Státusz: ${result.status}).`);
                } else {
                    // Az API hívás sikertelen volt vagy nem talált meccset
                    console.warn(`[Settlement] KIHAGYVA (ID: ${analysisId}): Nem sikerült lekérni a ${fixtureId} végeredményét.`);
                }

                // Várakozás a Rate Limiting elkerülése érdekében (RapidAPI limit)
                await new Promise(resolve => setTimeout(resolve, 500)); // Fél másodperc várakozás

            } catch (e) {
                errorCount++;
                console.error(`[Settlement] Hiba a sor feldolgozása közben (ID: ${analysisId}): ${e.message}`);
            }
        }

        console.log(`[Settlement] Elszámolás befejezve. Feldolgozva: ${processedCount}, Frissítve: ${updatedCount}, Hiba: ${errorCount}`);
        return {
            message: "Elszámolás befejezve.",
            processed: processedCount,
            updated: updatedCount,
            errors: errorCount
        };

    } catch (e) {
        console.error(`[Settlement] KRITIKUS HIBA az elszámolási folyamat során: ${e.message}`, e.stack);
        return { error: `Kritikus hiba: ${e.message}`, processed: processedCount, updated: updatedCount, errors: errorCount };
    }
}