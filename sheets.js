import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
// CacheService helyett
import { SHEET_URL } from './config.js';
// A .env fájlból beolvasott Sheet URL

// --- Fontos: Hitelesítő Fájl ---
// Szükséged lesz egy "szolgáltatásfiók" (service account) JSON kulcsfájlra
// Neve: 'google-credentials.json' (ezt neked kell létrehozni a Google Cloud Console-ban)
// Helye: Tedd a 'king-ai-backend' mappába, ugyanoda, ahol a package.json van.
// Ezt a fájlt SOHA NE TÖLTSD FEL GITHUBRA! (Adj hozzá a .gitignore-hoz: echo "google-credentials.json" >> .gitignore)

// === JAVÍTÁS: 'assert' cserélve 'with'-re a Node.js v22 miatt ===
// JAVÍTÁS: A 'google-credentials.json' importálása eltávolítva a biztonsági rés megszüntetése érdekében.
// import creds from './google-credentials.json' with { type: 'json' };
// TÖRÖLVE
// ==========================================================

// --- Google Hitelesítés Beállítása (Környezeti Változókból) ---

// A Render.com (és más hosztok) nehezen kezelik a JSON kulcsfájlban lévő '\n' sortöréseket.
// A 'GOOGLE_PRIVATE_KEY' változót úgy kell beállítani, hogy a sortöréseket
// cseréljük valódi sortörésekre (pl. `key.replace(/\\n/g, '\n')`).
const privateKey = process.env.GOOGLE_PRIVATE_KEY 
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') 
    : undefined;
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

if (!privateKey || !clientEmail) {
    console.warn(`KRITIKUS BIZTONSÁGI FIGYELMEZTETÉS: Hiányzó GOOGLE_PRIVATE_KEY vagy GOOGLE_CLIENT_EMAIL környezeti változó. 
    A Google Sheet integráció (mentés/olvasás) SIKERTELEN lesz.
    A 'google-credentials.json' fájlból olvasd ki a 'client_email' és 'private_key' értékeket, és állítsd be őket környezeti változóként.`);
    // Engedjük tovább futni az appot, de a Sheet funkciók nem fognak működni.
}

const serviceAccountAuth = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file', // Szükséges lehet a fájl eléréséhez
    ],
});
/**
 * Segédfüggvény a Google Táblázat dokumentum betöltéséhez és hitelesítéséhez.
 * @returns {GoogleSpreadsheet} A hitelesített GoogleSpreadsheet példány.
 * @throws {Error} Hiba, ha a SHEET_URL hiányzik vagy érvénytelen.
 */
function getDocInstance() {
    if (!SHEET_URL) {
        console.error("Hiányzó SHEET_URL a .env fájlban.");
        throw new Error("Hiányzó SHEET_URL a .env fájlban.");
    }
    // JAVÍTÁS: Ellenőrizzük, hogy a hitelesítés be van-e állítva
    if (!privateKey || !clientEmail) {
        throw new Error("A Google Sheet szolgáltatás nincs konfigurálva (hiányzó GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY).");
    }

    // A SHEET_URL-ből ki kell nyerni az ID-t
    // Példa URL: https://docs.google.com/spreadsheets/d/ABCDEFG123456/edit#gid=0
    const sheetIdMatch = SHEET_URL.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch || !sheetIdMatch[1]) {
        // Próbáljuk meg a script.google.com URL-t is kezelni, bár az nem a Sheet URL-je
        // DE a .env fájlban a TÉNYLEGES Google Sheet URL-nek kell lennie!
        console.error("Érvénytelen Google Sheet URL a .env fájlban. Nem sikerült kinyerni az ID-t. A megadott URL:", SHEET_URL);
        throw new Error("Érvénytelen Google Sheet URL. Nem sikerült kinyerni az ID-t.");
    }
    const doc = new GoogleSpreadsheet(sheetIdMatch[1], serviceAccountAuth);
    return doc;
}

/**
 * Megnyit vagy létrehoz egy munkalapot a dokumentumon belül.
 * @param {GoogleSpreadsheet} doc A hitelesített GoogleSpreadsheet példány.
 * @param {string} sheetName A munkalap neve.
 * @param {Array<string>} [headers] Opcionális: Fejlécek a lap létrehozásához.
 * @returns {Promise<GoogleSpreadsheetWorksheet>} A munkalap objektum.
 */
async function _getSheet(doc, sheetName, headers) {
    try {
        await doc.loadInfo();
        // Betölti a dokumentum metaadatait (lapok listája)
        let sheet = doc.sheetsByTitle[sheetName];
        if (!sheet && headers && Array.isArray(headers)) {
            console.log(`'${sheetName}' munkalap nem található, létrehozás...`);
            sheet = await doc.addSheet({ title: sheetName, headerValues: headers });
            
            // Az 1. sor (fejléc) lefagyasztása és félkövérré tétele
            await sheet.updateGridProperties({ frozenRowCount: 1 });
            // Fagyasztás
            await sheet.loadHeaderRow();
            // Betölti a fejlécet a formázáshoz
            const headerCells = sheet.headerValues.map((header, index) => sheet.getCell(0, index));
            for(const cell of headerCells) {
                cell.textFormat = { bold: true };
            }
            await sheet.saveUpdatedCells(headerCells);
            // Mentjük a formázást

            console.log(`'${sheetName}' munkalap sikeresen létrehozva.`);
        } else if (!sheet) {
            console.error(`'${sheetName}' munkalap nem található, és nem lettek megadva fejlécek.`);
            throw new Error(`'${sheetName}' munkalap nem található.`);
        }
        return sheet;
    } catch (e) {
         console.error(`Hiba a munkalap elérésekor (${sheetName}): ${e.message}`, e.stack);
         // Ha "PERMISSION_DENIED" hibát kapsz, az azt jelenti, hogy nem osztottad meg a Sheet-et a client_email címmel!
         throw e;
    }
}

/**
 * Lekéri a "History" munkalapot.
 * @returns {Promise<GoogleSpreadsheetWorksheet>} A "History" munkalap.
 */
// === MÓDOSÍTÁS: 'FixtureID' oszlop hozzáadva ===
export async function getHistorySheet() {
    const doc = getDocInstance();
    const headers = [
        "ID", 
        "FixtureID", // <-- ÚJ OSZLOP (v50.1)
        "Dátum", 
        "Sport", 
        "Hazai", 
        "Vendég", 
        "Tipp",
        "Bizalom",
        "Valós Eredmény",
        "Helyes (W/L/P)",
        "HTML Tartalom"
    ];
    return await _getSheet(doc, "History", headers);
}
// === MÓDOSÍTÁS VÉGE ===

// === Fő Funkciók (Exportálva) ===

/**
 * Lekéri az elemzési előzményeket a táblázatból.
 (A frontend hívja)
 * @returns {Promise<object>} Objektum { history: [...] } vagy { error: ... } formában.
 */
export async function getHistoryFromSheet() {
    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows(); // Betölti az összes sort (fejléc nélkül)

        const history = rows.map(row => {
            const dateVal = row.get("Dátum");
            let isoDate = new Date().toISOString();
            try {
                if (dateVal) {
              
                    const parsedDate = new Date(dateVal);
                    if (!isNaN(parsedDate.getTime())) {
                        isoDate = parsedDate.toISOString();
                    }
        
        }
      
            } catch (dateError) {
                console.warn(`Dátum feldolgozási hiba a getHistoryFromSheet-ben: ${dateError.message} (Érték: ${dateVal})`);
            }

            return {
                id: row.get("ID"),
                date: isoDate,
         
                sport: row.get("Sport"),
                home: row.get("Hazai"),
                away: row.get("Vendég"),
                // MÓDOSÍTÁS: Elküldjük a tipp adatokat is a listanézetnek
                tip: row.get("Tipp") || 'N/A',
                confidence: row.get("Bizalom") || 'N/A'
            };
        });
        // A legújabb elemzések kerüljenek előre
        return { history: history.filter(item => item.id).reverse() };
    } catch (e) {
        console.error(`Előzmények olvasási hiba: ${e.message}`, e.stack);
        return { error: `Előzmények olvasási hiba: ${e.message}` };
    }
}

/**
 * Lekéri egy konkrét elemzés részleteit (HTML tartalmát) ID alapján.
 (A frontend hívja)
 * @param {string} id Az elemzés egyedi ID-ja.
 * @returns {Promise<object>} Objektum { record: {...} } vagy { error: ... } formában.
 */
export async function getAnalysisDetailFromSheet(id) {
    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows();
        
        const row = rows.find(r => String(r.get("ID")) === String(id));
        if (!row) {
            throw new Error("Az elemzés nem található az ID alapján.");
        }

        const record = {
            id: row.get("ID"),
            home: row.get("Hazai"),
            away: row.get("Vendég"),
            html: row.get("HTML Tartalom")
        };
        return { record };
    } catch (e) {
        console.error(`Részletek olvasási hiba (${id}): ${e.message}`);
        return { error: `Részletek olvasási hiba: ${e.message}` };
    }
}

/**
 * Elment egy új elemzést a Google Sheet "History" lapjára.
 (Az AnalysisFlow hívja)
 * @param {string} sheetUrl (Nem használt, a globális SHEET_URL-t használjuk)
 * @param {object} analysisData Az elemzés adatai.
 * @returns {Promise<void>}
 */
// === MÓDOSÍTÁS: A függvény most már menti a fixtureId-t is ===
export async function saveAnalysisToSheet(sheetUrl, analysisData) {
    const analysisId = analysisData.id || 'N/A';
    try {
        if (!analysisData || !analysisData.home || !analysisData.away) {
            console.warn(`Mentés kihagyva (ID: ${analysisId}): hiányzó csapatnevek.`);
            return;
        }

        const sheet = await getHistorySheet();
        const newId = analysisData.id || crypto.randomUUID();
        // Node.js 19+
        const dateToSave = (analysisData.date instanceof Date ? analysisData.date : new Date()).toISOString();
        // Ajánlás adatainak kinyerése
        const tip = analysisData.recommendation?.recommended_bet || 'N/A';
        const confidence = analysisData.recommendation?.final_confidence ? 
            analysisData.recommendation.final_confidence.toFixed(1) : 'N/A';
        
        // v50.1: FixtureID hozzáadása
        const fixtureId = analysisData.fixtureId || null;

        // addRow() metódus használata az új sor hozzáadásához
        // A sorrend itt már nem számít, a fejléc neveket használja
        await sheet.addRow({
            "ID": newId,
            "FixtureID": fixtureId, // <-- ÚJ ADAT (v50.1)
            "Dátum": dateToSave,
            "Sport": analysisData.sport || 'N/A',
            "Hazai": analysisData.home,
            "Vendég": analysisData.away,
            "HTML Tartalom": analysisData.html || '',
            "Tipp": tip,
            "Bizalom": confidence
            // A 'Valós Eredmény' és 'Helyes (W/L/P)' mezőket üresen hagyjuk,
            // az elszámoló (settlement) folyamat fogja kitölteni.
        });
        // console.log(`Mentés sikeres (ID: ${newId}) a '${sheet.title}' lapra.`); // Reduce noise
    } catch (e) {
        console.error(`Hiba az elemzés mentésekor a táblázatba (ID: ${analysisId}): ${e.message}`, e.stack);
    }
}
// === MÓDOSÍTÁS VÉGE ===

/**
 * Töröl egy elemet a "History" lapról ID alapján.
 (A frontend hívja)
 * @param {string} id A törlendő elem ID-ja.
 * @returns {Promise<object>} Objektum { success: true } vagy { error: ... } formában.
 */
export async function deleteHistoryItemFromSheet(id) {
    try {
        const sheet = await getHistorySheet();
        const rows = await sheet.getRows();
        const rowToDelete = rows.find(r => String(r.get("ID")) == String(id));
        if (rowToDelete) {
            await rowToDelete.delete();
            // Sor törlése
            return { success: true };
        }
        throw new Error("A törlendő elem nem található.");
    } catch (e) {
        console.error(`Törlési hiba (${id}): ${e.message}`);
        return { error: `Törlési hiba: ${e.message}` };
    }
}


/**
 * Elment egy mélyebb öntanulási tanulságot a "Learning_Insights" lapra.
 (Async)
 * @param {string} sheetUrl (Nem használt)
 * @param {object} insightData A tanulság adatai.
 * @returns {Promise<void>}
 */
export async function logLearningInsight(sheetUrl, insightData) {
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
            "Bizalom": typeof insightData.confidence === 'number' ? insightData.confidence.toFixed(1) : 'N/Data.confidence',
  
            "Valós Eredmény": insightData.actual || 'N/A',
            "Tanulság (AI)": insightData.insight || 'N/A'
        });
        console.log(`Öntanulási tanulság sikeresen naplózva (Google Sheet): ${insightData.home} vs ${insightData.away}`);
    } catch (e) {
        console.error(`Hiba az öntanulási tanulság mentésekor (Google Sheet): ${e.message}`, e.stack);
    }
}

// A PostMatchAnalysis.gs funkciói (fetchActualResult, checkPredictionCorrectness stb.)
// egy külön 'postMatch.js' fájlba kerülhetnének, vagy az AnalysisFlow-ba,
// de az öntanuló ratingek frissítése (updateNarrativeRatings) már itt van.
// Egyelőre a Sheets.gs-ben hagyjuk az öntanuló ratingek logikáját.