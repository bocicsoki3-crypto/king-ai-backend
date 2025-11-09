// FÁJL: sheets.ts
// VERZIÓ: v94.6 (Teljes Cache és Mentés Javítás)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (Cache - TS2339): A 'loadInfo()' hívás átkerült a 'doc'
//    objektumra (a 'sheet' helyett), és bekerült az összes OLVASÁSI funkcióba
//    (getHistory, getAnalysisDetail, deleteHistoryItem).
// 2. JAVÍTVA (Mentés - TS2554): A 'saveAnalysisToSheet' és 'logLearningInsight'
//    aláírásából eltávolítva a felesleges 'sheetUrl' paraméter.
// 3. JAVÍTVA (Null Hiba - TS2345): A 'saveAnalysisToSheet' 'addRow' hívása
//    most már kezeli a null értékeket ('?? ""') a 'FixtureID' és 'JSON_Data' mezőknél.
// 4. ALAP: A v71.0-s (felhasználó által biztosított) stabil struktúrára épül.

import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { SHEET_URL } from './config.js'; 

// --- Google Hitelesítés Beállítása (Környezeti Változókból) ---

const privateKey = process.env.GOOGLE_PRIVATE_KEY 
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') 
    : undefined;
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

if (!privateKey || !clientEmail) {
    console.warn(`KRITIKUS BIZTONSÁGI FIGYELMEZTETÉS: Hiányzó GOOGLE_PRIVATE_KEY vagy GOOGLE_CLIENT_EMAIL környezeti változó. 
    A Google Sheet integráció (mentés/olvasás) SIKERTELEN lesz.`);
}

const serviceAccountAuth = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
    ],
});

/**
 * Segédfüggvény a Google Táblázat dokumentum betöltéséhez és hitelesítéséhez.
 * (v71.0 alapján)
 */
function getDocInstance(): GoogleSpreadsheet {
    if (!SHEET_URL) {
        console.error("Hiányzó SHEET_URL a .env fájlban.");
        throw new Error("Hiányzó SHEET_URL a .env fájlban.");
    }
    if (!privateKey || !clientEmail) {
        throw new Error("A Google Sheet szolgáltatás nincs konfigurálva (hiányzó GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY).");
    }

    const sheetIdMatch = SHEET_URL.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch || !sheetIdMatch[1]) {
        console.error("Érvénytelen Google Sheet URL a .env fájlban. Nem sikerült kinyerni az ID-t. A megadott URL:", SHEET_URL);
        throw new Error("Érvénytelen Google Sheet URL. Nem sikerült kinyerni az ID-t.");
    }
    const doc = new GoogleSpreadsheet(sheetIdMatch[1], serviceAccountAuth);
    return doc;
}

/**
 * Megnyit vagy létrehoz egy munkalapot a dokumentumon belül.
 * (v71.0 alapján)
 */
async function _getSheet(doc: GoogleSpreadsheet, sheetName: string, headers?: string[]): Promise<GoogleSpreadsheetWorksheet> {
    try {
        await doc.loadInfo(); // Betölti a dokumentum metaadatait (lapok listája)
        let sheet = doc.sheetsByTitle[sheetName];
        
        if (!sheet && headers && Array.isArray(headers)) {
            console.log(`'${sheetName}' munkalap nem található, létrehozás...`);
            
            sheet = await doc.addSheet({ 
                title: sheetName, 
                headerValues: headers
            });

            // (v71.0-s beállítások megtartva)
            await sheet.updateGridProperties({ 
                frozenRowCount: 1,
                rowCount: sheet.rowCount,
                columnCount: sheet.columnCount
            } as any); 
            
            await sheet.loadHeaderRow();
            const headerCells = sheet.headerValues.map((header, index) => sheet.getCell(0, index));
            for(const cell of headerCells) {
                cell.textFormat = { bold: true };
            }
            await sheet.saveUpdatedCells(); 

            console.log(`'${sheetName}' munkalap sikeresen létrehozva.`);
        } else if (!sheet) {
            console.error(`'${sheetName}' munkalap nem található, és nem lettek megadva fejlécek.`);
            throw new Error(`'${sheetName}' munkalap nem található.`);
        }
        
        // Fejléc ellenőrzése és frissítése (v71.0 alapján)
        if (sheet && headers && headers.length > 0) {
            await sheet.loadHeaderRow();
            const currentHeaders = sheet.headerValues || [];
            const missingHeaders = headers.filter(h => !currentHeaders.includes(h));
            
            if (missingHeaders.length > 0) {
                console.warn(`[sheets.ts] A '${sheetName}' munkalap frissítése... Hiányzó oszlopok: ${missingHeaders.join(', ')}`);
                await sheet.setHeaderRow(currentHeaders.concat(missingHeaders));
                console.log(`[sheets.ts] Fejléc sikeresen frissítve.`);
            }
        }

        return sheet;
    } catch (e: any) {
        console.error(`Hiba a munkalap elérésekor (${sheetName}): ${e.message}`, e.stack);
         throw e;
    }
}

/**
 * Lekéri a "History" munkalapot.
 * (v71.0 alapján)
 */
export async function getHistorySheet(): Promise<GoogleSpreadsheetWorksheet> {
    const doc = getDocInstance();
    const headers = [
        "ID", 
        "FixtureID",
        "Dátum", 
        "Sport", 
        "Home", 
        "Away", 
        "Tipp",
        "Bizalom",
        "Valós Eredmény",
        "Helyes (W/L/P)",
        "HTML Tartalom", // (Régi, v71.0-ig használatban)
        "JSON_Data"      // (Új, v71.0+)
    ];
    // A _getSheet már kezeli a doc.loadInfo()-t
    return await _getSheet(doc, "History", headers);
}

// === Típusdefiníciók a Sheet I/O számára ===
interface IHistoryRow {
    id: string;
    date: string;
    sport: string;
    home: string;
    away: string;
    tip: string;
    confidence: string;
}

interface IAnalysisDetail {
    id: string;
    home: string;
    away: string;
    html: string; // Ez most már a JSON vagy a régi HTML
}

interface IAnalysisDataToSave {
    id: string;
    fixtureId: number | string | null;
    date: Date;
    sport: string;
    home: string;
    away: string;
    html: string; // A log üzenet (JSON)
    JSON_Data?: string; // A teljes JSON (Auditor számára)
    recommendation: {
        recommended_bet: string;
        final_confidence: number;
    };
}


// === Fő Funkciók (Exportálva) ===

/**
 * Lekéri az elemzési előzményeket a táblázatból.
 * JAVÍTVA (v94.6): Cache-törléssel.
 */
export async function getHistoryFromSheet(): Promise<{ history?: IHistoryRow[]; error?: string }> {
    try {
        // === JAVÍTÁS (v94.6): Cache-törlés a DOKUMENTUM szinten ===
        const doc = getDocInstance();
        await doc.loadInfo(); // Ez kényszeríti a frissítést
        const sheet = await _getSheet(doc, "History"); // Fejlécek nélkül hívjuk, mert már létezik
        // === JAVÍTÁS VÉGE ===

        const rows = await sheet.getRows(); 

        const history: IHistoryRow[] = rows.map(row => {
            const dateVal = row.get("Dátum");
            let isoDate = new Date().toISOString();
            try {
                if (dateVal) {
                    const parsedDate = new Date(dateVal);
                    if (!isNaN(parsedDate.getTime())) {
                        isoDate = parsedDate.toISOString();
                    }
                }
            } catch (dateError: any) {
                console.warn(`Dátum feldolgozási hiba a getHistoryFromSheet-ben: ${dateError.message} (Érték: ${dateVal})`);
            }

            return {
                id: row.get("ID"),
                date: isoDate,
                sport: row.get("Sport"),
                home: row.get("Home"),
                away: row.get("Away"),
                tip: row.get("Tipp") || 'N/A',
                confidence: row.get("Bizalom") || 'N/A'
            };
        });
        
        return { history: history.filter(item => item.id).reverse() }; // Legújabb előre
    } catch (e: any) {
        console.error(`Előzmények olvasási hiba: ${e.message}`, e.stack);
        return { error: `Előzmények olvasási hiba: ${e.message}` };
    }
}

/**
 * Lekéri egy konkrét elemzés részleteit (HTML tartalmát) ID alapján.
 * JAVÍTVA (v94.6): Cache-törléssel és v71.0 logika megtartva.
 */
export async function getAnalysisDetailFromSheet(id: string): Promise<{ record?: IAnalysisDetail; error?: string }> {
    try {
        // === JAVÍTÁS (v94.6): Cache-törlés a DOKUMENTUM szinten ===
        const doc = getDocInstance();
        await doc.loadInfo(); // Ez kényszeríti a frissítést
        const sheet = await _getSheet(doc, "History");
        // === JAVÍTÁS VÉGE ===
        
        const rows = await sheet.getRows();
        
        const row = rows.find(r => String(r.get("ID")) === String(id));
        if (!row) {
            throw new Error("Az elemzés nem található az ID alapján.");
        }

        let content = "";
        const jsonData = row.get("JSON_Data") as string | undefined;
        
        if (jsonData) {
            // v71.0 logika megtartva: JSON formázása
            try {
                const parsedJson = JSON.parse(jsonData);
                content = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; color: var(--text-primary); background: var(--bg-dark); padding: 1rem; border-radius: 8px;">${JSON.stringify(parsedJson, null, 2)}</pre>`;
            } catch (e: any) {
                console.warn(`[sheets.ts] JSON parse hiba a getAnalysisDetail-ben (ID: ${id}). Nyers adat visszaadása.`);
                content = `[JSON PARSE HIBA: ${e.message}]\n\n${jsonData}`;
            }
        } else {
            // v71.0 fallback logika
            content = row.get("HTML Tartalom") || "Nincs adat ehhez az elemzéshez.";
        }

        const record: IAnalysisDetail = {
            id: row.get("ID"),
            home: row.get("Home"),
            away: row.get("Away"),
            html: content // Ez most már a formázott JSON vagy a régi HTML
        };
        return { record };
    } catch (e: any) {
        console.error(`Részletek olvasási hiba (${id}): ${e.message}`);
        return { error: `Részletek olvasási hiba: ${e.message}` };
    }
}

/**
 * Elment egy új elemzést a Google Sheet "History" lapjára.
 * JAVÍTVA (v94.6): Nincs 'sheetUrl' paraméter, 'null' érték kezelve (TS2345).
 */
export async function saveAnalysisToSheet(analysisData: IAnalysisDataToSave): Promise<void> {
    const analysisId = analysisData.id || 'N/A';
    try {
        if (!analysisData || !analysisData.home || !analysisData.away) {
            console.warn(`Mentés kihagyva (ID: ${analysisId}): hiányzó csapatnevek.`);
            return;
        }

        // === JAVÍTÁS (v94.6): Nincs 'sheetUrl' paraméter ===
        const sheet = await getHistorySheet();
        // === JAVÍTÁS VÉGE ===

        const newId = analysisData.id || crypto.randomUUID(); 
        const dateToSave = (analysisData.date instanceof Date ? analysisData.date : new Date()).toISOString();
        
        const tip = analysisData.recommendation?.recommended_bet || 'N/A';
        const confidence = analysisData.recommendation?.final_confidence ? 
            analysisData.recommendation.final_confidence.toFixed(1) : 'N/A';
        
        // === JAVÍTÁS (v94.6 - TS2345): 'null' értékek cseréje ''-re ===
        const fixtureId: string | number = analysisData.fixtureId ?? '';
        const jsonData: string = (analysisData.JSON_Data || analysisData.html) ?? '';
        // === JAVÍTÁS VÉGE ===
        
        // Cache-törlés (olvasás előtt)
        const doc = getDocInstance();
        await doc.loadInfo();
        
        const rows = await sheet.getRows();
        const existingRow = rows.find(r => r.get("ID") === newId);

        if (existingRow) {
            // Frissítés (Update)
            console.log(`[Sheets] Meglévő sor frissítése (ID: ${newId})`);
            existingRow.set("Dátum", dateToSave);
            existingRow.set("Tipp", tip);
            existingRow.set("Bizalom", confidence);
            existingRow.set("JSON_Data", jsonData);
            existingRow.set("FixtureID", fixtureId);
            existingRow.set("Sport", analysisData.sport || 'N/A');
            await existingRow.save();
        } else {
            // Hozzáadás (Add)
            await sheet.addRow({
                "ID": newId,
                "FixtureID": fixtureId,
                "Dátum": dateToSave,
                "Sport": analysisData.sport || 'N/A',
                "Home": analysisData.home,
                "Away": analysisData.away,
                "HTML Tartalom": '', // Régi mező, üresen hagyjuk
                "JSON_Data": jsonData, // A teljes elemzési JSON
                "Tipp": tip,
                "Bizalom": confidence
            });
        }
        
    } catch (e: any) {
        console.error(`Hiba az elemzés mentésekor a táblázatba (ID: ${analysisId}): ${e.message}`, e.stack);
    }
}

/**
 * Töröl egy elemet a "History" lapról ID alapján.
 * JAVÍTVA (v94.6): Cache-törléssel.
 */
export async function deleteHistoryItemFromSheet(id: string): Promise<{ success?: boolean; error?: string }> {
    try {
        // === JAVÍTÁS (v94.6): Cache-törlés a DOKUMENTUM szinten ===
        const doc = getDocInstance();
        await doc.loadInfo(); // Ez kényszeríti a frissítést
        const sheet = await _getSheet(doc, "History");
        // === JAVÍTÁS VÉGE ===

        const rows = await sheet.getRows();
        const rowToDelete = rows.find(r => String(r.get("ID")) == String(id));
        
        if (rowToDelete) {
            await rowToDelete.delete(); // Sor törlése
            return { success: true };
        }
        throw new Error("A törlendő elem nem található.");
    } catch (e: any) {
        console.error(`Törlési hiba (${id}): ${e.message}`);
        return { error: `Törlési hiba: ${e.message}` };
    }
}


/**
 * Elment egy mélyebb öntanulási tanulságot a "Learning_Insights" lapra.
 * JAVÍTVA (v94.6): Nincs 'sheetUrl' paraméter.
 */
export async function logLearningInsight(insightData: any): Promise<void> {
    const headers = ["Dátum", "Sport", "Home", "Away", "Tipp", "Bizalom", "Valós Eredmény", "Tanulság (AI)"];
    try {
        // === JAVÍTÁS (v94.6): Nincs 'sheetUrl' paraméter ===
        const doc = getDocInstance();
        const sheet = await _getSheet(doc, "Learning_Insights", headers);
        // === JAVÍTÁS VÉGE ===
        
        if (!sheet) {
            console.error("logLearningInsight hiba: Nem sikerült elérni/létrehozni a 'Learning_Insights' munkalapot.");
            return;
        }
        
        const dateToSave = insightData.date instanceof Date ?
            insightData.date.toISOString() : new Date().toISOString();
            
        await sheet.addRow({
            "Dátum": dateToSave,
            "Sport": insightData.sport || 'N/A',
            "Home": insightData.home || 'N/A',
            "Away": insightData.away || 'N/A',
            "Tipp": insightData.prediction || 'N/A',
            "Bizalom": typeof insightData.confidence === 'number' ? insightData.confidence.toFixed(1) : 'N/A',
            "Valós Eredmény": insightData.actual || 'N/A',
            "Tanulság (AI)": insightData.insight || 'N/A'
        });
        
        console.log(`Öntanulási tanulság sikeresen naplózva (Google Sheet): ${insightData.home} vs ${insightData.away}`);
    } catch (e: any) {
        console.error(`Hiba az öntanulási tanulság mentésekor (Google Sheet): ${e.message}`, e.stack);
    }
}
