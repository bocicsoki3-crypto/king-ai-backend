import express from 'express';
import cors from 'cors';
import { PORT } from './config.js';
// DataFetch importja az ESPN lekérdezéshez (bár AI_Service is exportálja)
import { _getFixturesFromEspn } from './DataFetch.js';
// AnalysisFlow importja a fő elemzéshez
import { runFullAnalysis } from './AnalysisFlow.js';
// Sheets importja az előzményekhez
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
// AI_Service importja a chathez (és a default exportot is használhatjuk)
// JAVÍTÁS: getFinalCheck import eltávolítva
import aiService, { getChatResponse } from './AI_Service.js';

const app = express();

// --- Middleware Beállítások ---

// Robusztus CORS beállítás a megadott GitHub Pages címre
app.use(cors({
    origin: 'https://bocicsoki3-crypto.github.io' // Engedélyezett frontend cím
})); // [cite: 1946]

app.use(express.json()); // JSON body parser
// Logolás minden kérésnél
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`); // [cite: 1947]
    next(); // Továbbengedjük a kérést
}); // [cite: 1947]

// --- API Útvonalak (Routes) ---

// Meccsek lekérése ESPN-ből
app.get('/getFixtures', async (req, res) => {
    try {
        const sport = req.query.sport; // Sportág a query paraméterből
        const days = req.query.days;   // Napok száma a query paraméterből
        if (!sport || !days) { // Ellenőrzés
            return res.status(400).json({ error: "Hiányzó 'sport' vagy 'days' paraméter." }); // Hiba, ha hiányzik
        }
        const fixtures = await _getFixturesFromEspn(sport, days); // Adatok lekérése
        res.status(200).json({ // Sikeres válasz
            fixtures: fixtures,
            odds: {} // Üres odds objektum (frontend küldi)
        });
    } catch (e) { // Hibakezelés
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` }); // Hiba válasz küldése
    }
}); // [cite: 1948-1949]

// Elemzés futtatása
app.post('/runAnalysis', async (req, res) => {
    try {
        // Paraméterek kinyerése a query stringből
        const params = {
            home: req.query.home,
            away: req.query.away,
            force: req.query.force, // Újraelemzés kényszerítése
            sheetUrl: req.query.sheetUrl // Opcionális Sheet URL
        };
        const sport = req.query.sport; // Sportág
        // Nyitó oddsok kinyerése a kérés body-jából
        const openingOdds = req.body.openingOdds || {}; //

        // Kötelező paraméterek ellenőrzése
        if (!params.home || !params.away || !sport) { //
            return res.status(400).json({ error: "Hiányzó 'sport', 'home' vagy 'away' paraméter." }); // Hiba, ha hiányzik
        } // [cite: 1951]

        console.log(`Elemzés indítása... (Ez eltarthat 1-2 percig az AI hívások miatt)`); // Folyamat jelzése
        // Fő elemzési folyamat hívása az AnalysisFlow modulból
        const result = await runFullAnalysis(params, sport, openingOdds); // [cite: 1951]

        // Ellenőrizzük, hogy az elemzés adott-e vissza hibát
        if (result.error) { //
           console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`); // Hiba logolása
            return res.status(500).json({ error: result.error }); // Hiba válasz küldése
        } // [cite: 1952]

        console.log("Elemzés sikeresen befejezve, válasz elküldve."); // Siker logolása
        res.status(200).json(result); // Eredmény elküldése JSON-ként
    } catch (e) { // Általános hibakezelés
        console.error(`Hiba a /runAnalysis végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` }); // Hiba válasz küldése
    }
}); // [cite: 1950-1953]

// Előzmények lekérése a Google Sheet-ből
app.get('/getHistory', async (req, res) => {
    try {
        const historyData = await getHistoryFromSheet(); // Előzmények lekérése a sheets.js-ből
        if (historyData.error) { // Ha a sheets.js hibát jelzett
            return res.status(500).json(historyData); // Továbbítjuk a hibát
        }
        res.status(200).json(historyData); // Sikeres válasz
    } catch (e) { // Általános hibakezelés
        console.error(`Hiba a /getHistory végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` }); // Hiba válasz
    }
}); // [cite: 1953-1954]

// Egy konkrét elemzés részleteinek lekérése ID alapján
app.get('/getAnalysisDetail', async (req, res) => {
    try {
        const id = req.query.id; // ID kinyerése a query paraméterből
        if (!id) { // Ellenőrzés
            return res.status(400).json({ error: "Hiányzó 'id' paraméter." }); // Hiba, ha hiányzik
        }
        const detailData = await getAnalysisDetailFromSheet(id); // Részletek lekérése
        if (detailData.error) { // Hibaellenőrzés
            return res.status(500).json(detailData); // Hiba továbbítása
        }
        res.status(200).json(detailData); // Sikeres válasz
    } catch (e) { // Általános hibakezelés
        console.error(`Hiba a /getAnalysisDetail végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (getAnalysisDetail): ${e.message}` }); // Hiba válasz
    }
}); // [cite: 1954-1955]

// Előzmény elem törlése ID alapján
app.post('/deleteHistoryItem', async (req, res) => {
    try {
        const id = req.body.id; // ID kinyerése a kérés body-jából
        if (!id) { // Ellenőrzés
            return res.status(400).json({ error: "Hiányzó 'id' a kérés body-jában." }); // Hiba, ha hiányzik
        }
        const deleteData = await deleteHistoryItemFromSheet(id); // Törlés indítása
        if (deleteData.error) { // Hibaellenőrzés
            return res.status(500).json(deleteData); // Hiba továbbítása
        }
        res.status(200).json(deleteData); // Sikeres válasz (pl. { success: true })
    } catch (e) { // Általános hibakezelés
        console.error(`Hiba a /deleteHistoryItem végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (deleteHistoryItem): ${e.message}` }); // Hiba válasz
    }
}); // [cite: 1956-1957]

// Chat funkció
app.post('/askChat', async (req, res) => {
    try {
        const { context, history, question } = req.body; // Adatok kinyerése a body-ból
        if (!context || !question) { // Ellenőrzés
            return res.status(400).json({ error: "Hiányzó 'context' vagy 'question' a kérés body-jában." }); // Hiba, ha hiányzik
        }
        // AI Service hívása a válasszal
        const chatData = await getChatResponse(context, history, question); // [cite: 1958]

        // Hibaellenőrzés (az AI_Service adhat vissza { error: ... } objektumot)
        if (chatData.error) { //
            return res.status(500).json(chatData); // Hiba továbbítása
        } // [cite: 1959]
        res.status(200).json(chatData); // Sikeres válasz ({ answer: "..." })
    } catch (e) { // Általános hibakezelés
        console.error(`Hiba a /askChat végponton: ${e.message}`, e.stack); // Hiba logolása
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` }); // Hiba válasz
    }
}); // [cite: 1958-1959]

// JAVÍTÁS: A /runFinalCheck végpont eltávolítva, mert a getFinalCheck funkció nem létezik
/*
app.post('/runFinalCheck', async (req, res) => {
    try {
        const { sport, home, away, openingOdds } = req.body;
        if (!sport || !home || !away) {
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', vagy 'away' paraméter." });
        }
        // HIBA: getFinalCheck nem létezik
        // const result = await getFinalCheck(sport, home, away, openingOdds || {});
        const result = { error: "A 'getFinalCheck' funkció nincs implementálva." }; // Placeholder hiba

        if (result.error) {
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (e) {
        console.error(`Hiba a /runFinalCheck végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runFinalCheck): ${e.message}` });
    }
});
*/ // 

// --- Szerver Indítása ---
async function startServer() {
    try {
        console.log("Szerver indítása..."); // Indítás logolása
        app.listen(PORT, () => { // Szerver figyelésének indítása
            console.log(`🎉 King AI Backend sikeresen elindult!`); // Siker log
            console.log(`A szerver itt fut: http://localhost:${PORT}`); // Helyi cím logolása
            console.log("A frontend most már ehhez a címhez tud csatlakozni."); // Üzenet
        }); // [cite: 1963]
    } catch (e) { // Kritikus hiba indításkor
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack); // Hiba logolása
        // Specifikus hibaüzenetek a gyakori problémákra
        if (e.code === 'MODULE_NOT_FOUND' && e.message.includes('google-credentials.json')) { // [cite: 1965]
            console.error("!!! HIBA: A 'google-credentials.json' fájl nem található!"); // [cite: 1965]
            console.error("!!! Kérlek, kövesd az utasításokat a Google Cloud hitelesítő fájl létrehozásához és elhelyezéséhez!"); // [cite: 1966]
        } // [cite: 1966]
        // Környezeti változók ellenőrzése (bár a config.js már használja őket)
        if (!process.env.GEMINI_API_KEY /* || !process.env.SHEET_URL */ ) { // SHEET_URL lehet opcionális
            console.error("!!! HIBA: Hiányzó GEMINI_API_KEY a .env fájlból vagy a környezeti változók közül!"); // [cite: 1967]
            console.error("!!! Kérlek, add meg a környezeti változókat a Render felületén vagy a .env fájlban!"); // [cite: 1968]
        } // [cite: 1968]
    } // [cite: 1964]
}

startServer(); // Szerver indítása