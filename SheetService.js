/**
 * SheetService.js
 * Felelős a Google Sheet-be történő adatmentésért.
 * google-auth-library-t használ a hitelesítéshez.
 */
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { SHEET_URL } from './config.js'; // Importáljuk a Sheet URL-t a configból

// --- GOOGLE SHEET KONFIGURÁCIÓ ---
// A Spreadsheet ID kinyerése az URL-ből
function getSheetIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/d\/(.*?)\//);
    return match ? match[1] : null;
}
const SPREADSHEET_ID = getSheetIdFromUrl(SHEET_URL);
const SHEET_NAME = 'Predictions'; // Annak a munkalapnak a neve, ahova menteni akarunk

// Hitelesítés beállítása (ugyanaz, mint a Vertex AI-nál)
const auth = new GoogleAuth({
    // A GOOGLE_APPLICATION_CREDENTIALS környezeti változónak mutatnia kell a .json kulcsfájlra
    // VAGY a kulcsfájl tartalmát a GOOGLE_CREDENTIALS környezeti változóba kell tenni.
    // Render.com-on a 'GOOGLE_CREDENTIALS' nevű env var-ba másold be a JSON fájl teljes tartalmát.
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

/**
 * Adatok mentése a megadott Google Sheet-be.
 * @param {object} data Az elemzés eredményobjektuma.
 * @returns {Promise<void>}
 */
export async function saveToSheet(data) {
    if (!SPREADSHEET_ID) {
        console.warn("Nincs SHEET_URL vagy érvénytelen SPREADSHEET_ID a configban/env-ben. Mentés kihagyva.");
        return;
    }

    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Előkészítjük a sort a Sheet számára
        // Fontos: A sorrendnek meg kell egyeznie a Sheet oszlopaival!
        const rowData = [
            new Date().toISOString(), // Időbélyeg
            data.match || "N/A",
            data.league || "N/A",
            data.date ? new Date(data.date).toLocaleDateString('hu-HU') : "N/A",
            data.prediction?.tip || "N/A",
            data.prediction?.confidence || "N/A",
            data.prediction?.final_score || "N/A",
            data.prediction?.reasoning || "N/A",
            // Valószínűségek (formázva)
            `H:${(data.probabilities?.pHome * 100 || 0).toFixed(1)}% D:${(data.probabilities?.pDraw * 100 || 0).toFixed(1)}% A:${(data.probabilities?.pAway * 100 || 0).toFixed(1)}%`,
            // Oddsok (csak a fő piacok példaként)
            data.odds?.find(o => o.name === 'Hazai győzelem')?.price || "N/A",
            data.odds?.find(o => o.name === 'Döntetlen')?.price || "N/A",
            data.odds?.find(o => o.name === 'Vendég győzelem')?.price || "N/A",
            // Kontextus (rövidítve, ha túl hosszú)
            data.context?.substring(0, 500) || "N/A",
            // Nyers adatok (JSON stringként, ha kell)
            // JSON.stringify(data.fullRawData).substring(0, 500) // Opcionális, de nagyon hosszú lehet
        ];

        // Sor hozzáfűzése a táblázathoz
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1`, // A1-től kezdve keres helyet
            valueInputOption: 'USER_ENTERED', // Úgy kezeli, mintha beírtuk volna
            requestBody: {
                values: [rowData],
            },
        });

        console.log(`Adatok sikeresen mentve a Google Sheet-be: ${data.match}`);

    } catch (error) {
        console.error("Hiba történt a Google Sheet mentése során:", error.message);
        // Logolhatjuk a részletesebb hibát is, ha van
        if (error.response && error.response.data) {
            console.error("Google API Hiba Részletei:", JSON.stringify(error.response.data));
        } else if (error.errors) {
             console.error("Google API Auth Hiba Részletei:", JSON.stringify(error.errors));
        }
        // Nem dobunk hibát tovább, hogy az elemzés többi része befejeződhessen
    }
}

// Exportáljuk a fő funkciót
export default {
    saveToSheet
};