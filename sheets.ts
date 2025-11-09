// FÁJL: sheets.ts
// VERZIÓ: v94.5 (Mentési Hurok és Cache Javítás)
// MÓDOSÍTÁS (v94.5):
// 1. JAVÍTVA (Mentés): A `saveAnalysisToSheet` funkció már nem fogad el
//    'sheetUrl' paramétert. Belsőleg, a .env-ből hívja meg a helyes lapot.
//    Ez javítja a kritikus "nincs mentés" hibát az AnalysisFlow.ts-ben.
// 2. JAVÍTVA (Olvasás): Minden adatot olvasó funkció (getHistoryFromSheet,
//    getAnalysisDetailFromSheet, deleteHistoryItemFromSheet) most már
//    tartalmazza az `await sheet.loadInfo();` parancsot.
// 3. CÉL: Ez a parancs "feltöri" a google-spreadsheet cache-t, és biztosítja,
//    hogy az Előzmények modal mindig a legfrissebb, valós adatokat olvassa be.

import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { SHEET_URL } from './config.js';

// --- Hitelesítés és Alap Dokumentum Elérés ---

let doc: GoogleSpreadsheet;

/**
 * Inicializálja a Google Spreadsheet dokumentumot (doc) hitelesítéssel.
 * Csak egyszer fut le.
 */
async function getDoc(): Promise<GoogleSpreadsheet> {
    if (doc) return doc;

    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const sheetUrl = SHEET_URL;

    if (!serviceAccountEmail || !privateKey || !sheetUrl) {
        console.error("KRITIKUS HIBA: Hiányzó Google Sheets .env változók (EMAIL, KEY, vagy SHEET_URL).");
        throw new Error("Google Sheets hitelesítés sikertelen: Hiányzó konfiguráció.");
    }

    try {
        const jwt = new JWT({
            email: serviceAccountEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // A SHEET_URL-ból kinyerjük az ID-t
        const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!match || !match[1]) {
            throw new Error("Érvénytelen SHEET_URL. Nem található a dokumentum ID.");
        }
        const SHEET_ID = match[1];
        
        doc = new GoogleSpreadsheet(SHEET_ID, jwt);
        await doc.loadInfo(); // Cím és lapok betöltése
        console.log(`[Sheets] Sikeresen csatlakozva a Google Sheet-hez: ${doc.title}`);
        return doc;
    } catch (e: any) {
        console.error(`[Sheets] KRITIKUS HIBA a Google Sheet betöltésekor: ${e.message}`, e.stack);
        throw new Error(`Google Sheets csatlakozási hiba: ${e.message}`);
    }
}

/**
 * Segédfüggvény: Lekéri a 'History' munkalapot.
 */
export async function getHistorySheet(): Promise<GoogleSpreadsheetWorksheet> {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle['History'];
    if (!sheet) {
        // Kritikus hiba: Ha nincs History lap, hozzunk létre egyet
        try {
            console.warn("A 'History' munkalap nem található, létrehozás...");
            const headers = [
                "ID", "FixtureID", "Dátum", "Sport", "Home", "Away", "Tipp",
                "Bizalom", "Valós Eredmény", "Helyes (W/L/P)", "JSON_Data"
            ];
            const newSheet = await doc.addSheet({ 
                title: 'History', 
                headerValues: headers
            });
            console.log("A 'History' munkalap sikeresen létrehozva.");
            return newSheet;
        } catch (e: any) {
             console.error(`[Sheets] KRITIKUS HIBA: Nem sikerült létrehozni a 'History' munkalapot: ${e.message}`);
             throw new Error("A 'History' munkalap nem található és nem is hozható létre.");
        }
    }
    return sheet;
}

/**
 * Segédfüggvény: Lekéri a 'Learning_Insights' munkalapot.
 */
async function getLearningSheet(): Promise<GoogleSpreadsheetWorksheet> {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle['Learning_Insights'];
    if (!sheet) {
         try {
            console.warn("A 'Learning_Insights' munkalap nem található, létrehozás...");
            const headers = ["Dátum", "Sport", "Home", "Away", "Tipp", "Bizalom", "Valós Eredmény", "Tanulság (AI)"];
            const newSheet = await doc.addSheet({ 
                title: 'Learning_Insights', 
                headerValues: headers
            });
            console.log("A 'Learning_Insights' munkalap sikeresen létrehozva.");
            return newSheet;
        } catch (e: any) {
             console.error(`[Sheets] KRITIKUS HIBA: Nem sikerült létrehozni a 'Learning_Insights' munkalapot: ${e.message}`);
             throw new Error("A 'Learning_Insights' munkalap nem található és nem is hozható létre.");
        }
    }
    return sheet;
}


// --- FŐ FUNKCIÓK (index.ts és AnalysisFlow.ts számára) ---

/**
 * Elment egy elemzést a "History" lapra.
 * Ha az ID már létezik, frissíti a sort. Ha nem, új sort ad hozzá.
 * JAVÍTVA (v94.5): Már nem kér 'sheetUrl' paramétert.
 */
export async function saveAnalysisToSheet(data: {
    sport: string,
    home: string,
    away: string,
    date: Date,
    html: string, // Ez valójában a 'JSON_Data' (az AnalysisFlow <pre> taggel küldi)
    id: string,
    fixtureId: number | string | null,
    recommendation: any
}) {
    try {
        // === JAVÍTÁS (v94.5): A funkció már belsőleg hívja a getHistorySheet()-et ===
        const sheet = await getHistorySheet();
        
        if (sheet.headerValues.length === 0) {
             await sheet.loadHeaderRow();
        }

        const tip = data.recommendation?.recommended_bet || 'N/A';
        const bizalom = data.recommendation?.final_confidence?.toFixed(1) || 'N/A';

        const rowData = {
            'ID': data.id,
            'FixtureID': data.fixtureId,
            'Sport': data.sport,
            'Home': data.home,
            'Away': data.away,
            'Dátum': data.date.toISOString(),
            'Tipp': tip,
            'Bizalom': bizalom,
            'Valós Eredmény': 'N/A',
            'Helyes (W/L/P)': 'N/A',
            'JSON_Data': data.html // A v71.0+ <pre>JSON</pre> string
        };

        // Mivel a `getRows` cache-elhet, a biztonságos mentés érdekében
        // először betöltjük a friss infókat, ahogy a `getHistory` is teszi.
        await sheet.loadInfo(); // v94.4 - Biztonsági cache-törés
        const rows = await sheet.getRows();
        const existingRow = rows.find(r => r.get('ID') === data.id);

        if (existingRow) {
            console.log(`[Sheets] Meglévő sor frissítése (ID: ${data.id})`);
            // Frissítjük a meglévő sor adatait
            existingRow.set('Dátum', rowData.Dátum);
            existingRow.set('Tipp', rowData.Tipp);
            existingRow.set('Bizalom', rowData.Bizalom);
            existingRow.set('JSON_Data', rowData.JSON_Data);
            existingRow.set('FixtureID', rowData.FixtureID); 
            await existingRow.save();
        } else {
            console.log(`[Sheets] Új sor hozzáadása (ID: ${data.id})`);
            await sheet.addRow(rowData);
        }
        
    } catch (e: any) {
        console.error(`[Sheets] KRITIKUS HIBA a 'saveAnalysisToSheet' során (ID: ${data.id}): ${e.message}`, e.stack);
        // Ne dobjunk hibát, hogy az AnalysisFlow folytatódhasson
    }
}

/**
 * Lekéri a teljes elemzési előzmény-listát.
 * JAVÍTVA (v94.4): Cache-törléssel.
 */
export async function getHistoryFromSheet(): Promise<{ history: any[]; error?: string }> {
    try {
        const sheet = await getHistorySheet();
        
        // === KRITIKUS JAVÍTÁS (v94.4) ===
        // Rákényszerítjük a 'google-spreadsheet' könyvtárat, hogy
        // törölje a belső cache-ét és olvassa be a friss adatokat.
        await sheet.loadInfo();
        // === JAVÍTÁS VÉGE ===

        const rows = await sheet.getRows();
        
        const history = rows.map(row => ({
            id: row.get('ID'),
            date: row.get('Dátum'),
            sport: row.get('Sport'),
            home: row.get('Home'),
            away: row.get('Away')
        })).filter(item => item.id && item.home && item.date); // Csak valid sorok

        // Dátum szerint rendezés (legújabb elöl)
        history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { history };
    } catch (e: any) {
        console.error(`[Sheets] Hiba a 'getHistoryFromSheet' során: ${e.message}`, e.stack);
        return { history: [], error: e.message };
    }
}

/**
 * Lekér egyetlen, részletes elemzést (JSON/HTML) ID alapján.
 * JAVÍTVA (v94.4): Cache-törléssel.
 */
export async function getAnalysisDetailFromSheet(id: string): Promise<{ record?: any; error?: string }> {
     try {
        const sheet = await getHistorySheet();

        // === KRITIKUS JAVÍTÁS (v94.4) ===
        await sheet.loadInfo(); // Cache-törlés
        // === JAVÍTÁS VÉGE ===

        const rows = await sheet.getRows();
        const row = rows.find(r => r.get('ID') === id);

        if (!row) {
            return { error: "Nem található elemzés ezzel az ID-val." };
        }

        const record = {
            id: row.get('ID'),
            home: row.get('Home'),
            away: row.get('Away'),
            html: row.get('JSON_Data') // A kliens (script.js) 'html'-ként hivatkozik erre
        };

        return { record };
    } catch (e: any) {
        console.error(`[Sheets] Hiba a 'getAnalysisDetailFromSheet' során: ${e.message}`, e.stack);
        return { error: e.message };
    }
}

/**
 * Töröl egy sort az előzményekből ID alapján.
 * JAVÍTVA (v94.4): Cache-törléssel.
 */
export async function deleteHistoryItemFromSheet(id: string): Promise<{ success?: boolean; error?: string }> {
    try {
        const sheet = await getHistorySheet();

        // === KRITIKUS JAVÍTÁS (v94.4) ===
        await sheet.loadInfo(); // Cache-törlés
        // === JAVÍTÁS VÉGE ===

        const rows = await sheet.getRows();
        const row = rows.find(r => r.get('ID') === id);

        if (!row) {
            return { error: "Nem található elemzés ezzel az ID-val a törléshez." };
        }

        await row.delete();
        return { success: true };
    } catch (e: any) {
        console.error(`[Sheets] Hiba a 'deleteHistoryItemFromSheet' során: ${e.message}`, e.stack);
        return { error: e.message };
    }
}

/**
 * Naplózza a 7. Ügynök (Auditor) tanulságait a 'Learning_Insights' lapra.
 * JAVÍTVA (v94.5): Már nem kér 'sheetUrl' paramétert.
 */
export async function logLearningInsight(data: {
    date: Date;
    sport: string;
    home: string;
    away: string;
    prediction: string;
    confidence: number;
    actual: string;
    insight: string;
}) {
    try {
        // === JAVÍTÁS (v94.5): Belső hívás ===
        const sheet = await getLearningSheet();
        await sheet.addRow({
            'Dátum': data.date.toISOString(),
            'Sport': data.sport,
            'Home': data.home,
            'Away': data.away,
            'Tipp': data.prediction,
            'Bizalom': data.confidence,
            'Valós Eredmény': data.actual,
            'Tanulság (AI)': data.insight
        });
        console.log(`[Sheets] Új tanulság sikeresen naplózva a 'Learning_Insights' lapra.`);
    } catch (e: any) {
        console.error(`[Sheets] Hiba a 'logLearningInsight' során: ${e.message}`, e.stack);
    }
}
