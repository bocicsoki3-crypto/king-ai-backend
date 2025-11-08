// sheets.ts (v71.0 - "Auditor" Bővítés)
// MÓDOSÍTÁS (v71.0):
// 1. HOZZÁADVA: A 'getHistorySheet' fejlécei közé bekerült az új 'JSON_Data' oszlop.
// 2. MÓDOSÍTVA: A 'saveAnalysisToSheet' most már kezeli és menti a 'JSON_Data' mezőt.
// 3. MÓDOSÍTVA: A 'getAnalysisDetailFromSheet' intelligensebb lett:
//    - Ha talál 'JSON_Data'-t, megpróbálja azt "szépen" (pretty-print) megjeleníteni.
//    - Ha nem, visszaáll a régi 'HTML Tartalom' mezőre.

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
        
        // === ÚJ (v71.0): Fejléc ellenőrzése és frissítése ===
        // Biztosítja, hogy a 'JSON_Data' oszlop létezzen, ha a lap már létezett
        if (sheet && headers && headers.length > 0) {
            await sheet.loadHeaderRow();
            const currentHeaders = sheet.headerValues || [];
            const missingHeaders = headers.filter(h => !currentHeaders.includes(h));
            
            if (missingHeaders.length > 0) {
                console.warn(`[sheets.ts] A '${sheetName}' munkalap frissítése... Hiányzó oszlopok: ${missingHeaders.join(', ')}`);
                // Hozzáadjuk a hiányzó fejléceket (ez új sorokat nem ad hozzá, csak a fejlécet frissíti)
                await sheet.setHeaderRow(currentHeaders.concat(missingHeaders));
                console.log(`[sheets.ts] Fejléc sikeresen frissítve.`);
            }
        }
        // === MÓDOSÍTÁS VÉGE ===

        return sheet;
    } catch (e: any) {
        console.error(`Hiba a munkalap elérésekor (${sheetName}): ${e.message}`, e.stack);
         throw e;
    }
}

/**
 * Lekéri a "History" munkalapot.
 * MÓDOSÍTVA (v71.0): Hozzáadva a 'JSON_Data' oszlop.
 */
export async function getHistorySheet(): Promise<GoogleSpreadsheetWorksheet> {
    const doc = getDocInstance();
    const headers = [
        "ID", 
        "FixtureID", // v50.1
        "Dátum", 
        "Sport", 
        "Hazai", 
        "Vendég", 
        "Tipp",
        "Bizalom",
        "Valós Eredmény",
        "Helyes (W/L/P)",
        "HTML Tartalom", // Ez a régi log, meghagyjuk
        "JSON_Data"      // ÚJ (v71.0) - Az Auditor számára
    ];
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
    html: string; // A log üzenet
    JSON_Data?: string; // A teljes JSON (Auditor számára)
    recommendation: {
        recommended_bet: string;
        final_confidence: number;
    };
}


// === Fő Funkciók (Exportálva) ===

/**
 * Lekéri az elemzési előzményeket a táblázatból.
 * (Változatlan v71.0)
 */
export async function getHistoryFromSheet(): Promise<{ history?: IHistoryRow[]; error?: string }> {
    try {
        const sheet = await getHistorySheet();
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
                home: row.get("Hazai"),
                away: row.get("Vendég"),
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
 * MÓDOSÍTVA (v71.0): Először a 'JSON_Data'-t keresi.
 */
export async function getAnalysisDetailFromSheet(id: string): Promise<{ record?: IAnalysisDetail; error?: string }> {
    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows();
        
        const row = rows.find(r => String(r.get("ID")) === String(id));
        if (!row) {
            throw new Error("Az elemzés nem található az ID alapján.");
        }

        let content = "";
        const jsonData = row.get("JSON_Data") as string | undefined;
        
        if (jsonData) {
            // 1. Eset: Új (v71.0+) formátum, van JSON adat
            try {
                const parsedJson = JSON.parse(jsonData);
                // "Szép" (pretty-print) formázás a könnyebb olvashatóságért
                content = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; color: var(--text-primary); background: var(--bg-dark); padding: 1rem; border-radius: 8px;">${JSON.stringify(parsedJson, null, 2)}</pre>`;
            } catch (e: any) {
                console.warn(`[sheets.ts] JSON parse hiba a getAnalysisDetail-ben (ID: ${id}). Nyers adat visszaadása.`);
                content = `[JSON PARSE HIBA: ${e.message}]\n\n${jsonData}`;
            }
        } else {
            // 2. Eset: Régi (v71.0 előtti) formátum, csak HTML van
            content = row.get("HTML Tartalom") || "Nincs adat ehhez az elemzéshez.";
        }

        const record: IAnalysisDetail = {
            id: row.get("ID"),
            home: row.get("Hazai"),
            away: row.get("Vendég"),
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
 * MÓDOSÍTVA (v71.0): Hozzáadva a 'JSON_Data' mező mentése.
 */
export async function saveAnalysisToSheet(sheetUrl: string, analysisData: IAnalysisDataToSave): Promise<void> {
    const analysisId = analysisData.id || 'N/A';
    try {
        if (!analysisData || !analysisData.home || !analysisData.away) {
            console.warn(`Mentés kihagyva (ID: ${analysisId}): hiányzó csapatnevek.`);
            return;
        }

        const sheet = await getHistorySheet();
        const newId = analysisData.id || crypto.randomUUID(); 
        const dateToSave = (analysisData.date instanceof Date ? analysisData.date : new Date()).toISOString();
        
        const tip = analysisData.recommendation?.recommended_bet || 'N/A';
        const confidence = analysisData.recommendation?.final_confidence ? 
            analysisData.recommendation.final_confidence.toFixed(1) : 'N/A';
        
        const fixtureId: string | number | boolean = analysisData.fixtureId ?? '';
        const jsonData: string | number | boolean = analysisData.JSON_Data ?? ''; // ÚJ (v71.0)

        await sheet.addRow({
            "ID": newId,
            "FixtureID": fixtureId,
            "Dátum": dateToSave,
            "Sport": analysisData.sport || 'N/A',
            "Hazai": analysisData.home,
            "Vendég": analysisData.away,
            "HTML Tartalom": analysisData.html || '', // A log üzenet
            "JSON_Data": jsonData, // A teljes elemzési JSON
            "Tipp": tip,
            "Bizalom": confidence
        });
        
    } catch (e: any) {
        console.error(`Hiba az elemzés mentésekor a táblázatba (ID: ${analysisId}): ${e.message}`, e.stack);
    }
}

/**
 * Töröl egy elemet a "History" lapról ID alapján.
 * (Változatlan v71.0)
 */
export async function deleteHistoryItemFromSheet(id: string): Promise<{ success?: boolean; error?: string }> {
    try {
        const sheet = await getHistorySheet();
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
 * (Változatlan v71.0)
 */
export async function logLearningInsight(sheetUrl: string, insightData: any): Promise<void> {
    const headers = ["Dátum", "Sport", "Hazai", "Vendég", "Tipp", "Bizalom", "Valós Eredmény", "Tanulság (AI)"];
    try {
        const doc = getDocInstance();
        const sheet = await _getSheet(doc, "Learning_Insights", headers);
        
        if (!sheet) {
            console.error("logLearningInsight hiba: Nem sikerült elérni/létrehozni a 'Learning_Insights' munkalapot.");
            return;
        }
        
        const dateToSave = insightData.date instanceof Date ?
            insightData.date.toISOString() : new Date().toISOString();
            
        await sheet.addRow({
            "Dátum": dateToSave,
            "Sport": insightData.sport || 'N/A',
            "Hazai": insightData.home || 'N/A',
            "Vendég": insightData.away || 'N/A',
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