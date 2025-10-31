import express from 'express';
import cors from 'cors';
import { PORT } from './config.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { runFullAnalysis } from './AnalysisFlow.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import aiService, { getChatResponse } from './AI_Service.js';

// === MÓDOSÍTÁS: Az öntanuló modulok VALÓDI importálása ===
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
// A 'runPostMatchLearning' egy magasabb szintű vezérlő lehet, de most direktben hívjuk a modulokat

const app = express();
// --- Middleware Beállítások ---

// JAVÍTÁS: A CORS beállítást ideiglenesen teljesen megengedőre állítjuk a hiba felderítéséhez.
// Ez minden külső kérést engedélyezni fog.
app.use(cors());

app.use(express.json()); // JSON body parser
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});
// --- API Útvonalak (Routes) ---

// Meccsek lekérése ESPN-ből
app.get('/getFixtures', async (req, res) => {
    try {
        const sport = req.query.sport;
        const days = req.query.days;
        if (!sport || !days) {
            return res.status(400).json({ error: "Hiányzó 'sport' vagy 'days' paraméter." });
        }
        const fixtures = await _getFixturesFromEspn(sport, days);

         // Az ESPN válaszát közvetlenül adjuk vissza, amely tartalmazza a utcKickoff-ot
         res.status(200).json({
            fixtures: fixtures, // Ez már tartalmazza a utcKickoff-ot
            odds: {} // Odds adatokat külön kezeljük, itt üres marad
        });
    } catch (e) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});
// Elemzés futtatása
app.post('/runAnalysis', async (req, res) => {
    // === DEBUG SOR KEZDETE ===
    console.log('--- /runAnalysis Kérés Query Paraméterei: ---');
    console.log(req.query); // Kiírja az összes query paramétert (pl. { sport: 'soccer', home: 'Bremen', ... })
    console.log('--- DEBUG VÉGE ---');
    // === DEBUG SOR VÉGE ===

    try {
        // --- MÓDOSÍTÁS: utcKickoff és leagueName kinyerése a query-ből ---
        const params = {
            home: req.query.home,
            away: req.query.away,
            force: req.query.force,
            sheetUrl: req.query.sheetUrl,
            utcKickoff: req.query.utcKickoff, // Új paraméter
            leagueName: req.query.leagueName // Új paraméter
        };
        const sport = req.query.sport;

        const openingOdds = req.body.openingOdds || {};

        // === EZ AZ ELLENŐRZÉS OKOZHATJA A 400-AS HIBÁT, HA HIÁNYZIK VALAMI ===
        if (!params.home || !params.away || !sport || !params.utcKickoff) { // utcKickoff ellenőrzése is
            console.error('!!! HIBA: Hiányzó query paraméter(ek)! Ellenőrzés:', {
                home: params.home,
                away: params.away,
                sport: sport,
                utcKickoff: params.utcKickoff
            }); // Részletesebb logolás hiba esetén
            // Ha valamelyik hiányzik, 400-as hibát adunk vissza
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away' vagy 'utcKickoff' paraméter." });
        }
        // === EDDIG ===

        console.log(`Elemzés indítása...`); // Ezt már nem látjuk a logban, ha a 400-as hiba miatt megáll
        const result = await runFullAnalysis(params, sport, openingOdds);

        if (result.error) {
            console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`);
            return res.status(500).json({ error: result.error });
        }

        console.log("Elemzés sikeresen befejezve, válasz elküldve.");
        res.status(200).json(result);
    } catch (e) {
        console.error(`Hiba a /runAnalysis végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});

// Előzmények lekérése a Google Sheet-ből
app.get('/getHistory', async (req, res) => {
    try {
        const historyData = await getHistoryFromSheet();
        if (historyData.error) {
            return res.status(500).json(historyData);
        }
        res.status(200).json(historyData);
    } catch (e) {
        console.error(`Hiba a /getHistory végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` });
    }
});
// Egy konkrét elemzés részleteinek lekérése ID alapján
app.get('/getAnalysisDetail', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) {
            return res.status(400).json({ error: "Hiányzó 'id' paraméter." });
        }
        const detailData = await getAnalysisDetailFromSheet(id);
        if (detailData.error) {
            return res.status(500).json(detailData);
        }
        res.status(200).json(detailData);
    } catch (e) {
        console.error(`Hiba a /getAnalysisDetail végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getAnalysisDetail): ${e.message}` });
    }
});
// Előzmény elem törlése ID alapján
app.post('/deleteHistoryItem', async (req, res) => {
    try {
        const id = req.body.id;
        if (!id) {
            return res.status(400).json({ error: "Hiányzó 'id' a kérés body-jában." });
        }
        const deleteData = await deleteHistoryItemFromSheet(id);
        if (deleteData.error) {
            return res.status(500).json(deleteData);
        }
        res.status(200).json(deleteData);
    } catch (e) {
        console.error(`Hiba a /deleteHistoryItem végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (deleteHistoryItem): ${e.message}` });
    }
});
// Chat funkció
app.post('/askChat', async (req, res) => {
    try {
        const { context, history, question } = req.body;
        if (!context || !question) {
            return res.status(400).json({ error: "Hiányzó 'context' vagy 'question' a kérés body-jában." });
        }
        const chatData = await getChatResponse(context, history, question);

        if (chatData.error) {
             return res.status(500).json(chatData);
        }
        res.status(200).json(chatData);
    } catch (e) {
        console.error(`Hiba a /askChat végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` });
    }
});
// === MÓDOSÍTÁS: Az öntanuló végpont élesítése ===
app.post('/runLearning', async (req, res) => {
    try {
        console.log("Öntanulási folyamat indítása (Power Ratings & Bizalmi Kalibráció)...");

        // Elindítjuk a két öntanuló folyamatot párhuzamosan (vagy szekvenciálisan, ha a kalibráció függ a friss ratingektől - itt most párhuzamos)
        // Fontos: a runConfidenceCalibration Promise-t ad vissza, az updatePowerRatings jelenleg nem, de a biztonság kedvéért Promise.all-ba tesszük
        const [powerRatingResult, calibrationResult] = await Promise.all([
            Promise.resolve(updatePowerRatings()), // Becsomagoljuk Promise-ba
            runConfidenceCalibration() // Ez már Promise-t ad vissza
        ]);

        const learningResult = {
            message: "Öntanuló modulok sikeresen lefutottak.",
            power_ratings: powerRatingResult || { updated: false, message:"Nem volt elég adat a frissítéshez." }, // Jobb visszajelzés
            confidence_calibration: calibrationResult || { error: "Ismeretlen hiba a kalibráció során." } // Jobb hibakezelés
        };

        // Ellenőrizzük a kalibráció hibáját expliciten
        if (learningResult.confidence_calibration.error) {
             console.error("Hiba a bizalmi kalibráció során:", learningResult.confidence_calibration.error);
             // Dönthetünk úgy, hogy itt 500-as hibát adunk, vagy csak logoljuk és megyünk tovább
             // Most csak logoljuk, és 200 OK választ adunk a többi eredménnyel
        }

        res.status(200).json(learningResult);

    } catch (e) {
        console.error(`Hiba a /runLearning végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runLearning): ${e.message}` });
    }
});
// === MÓDOSÍTÁS VÉGE ===

// --- Szerver Indítása ---
async function startServer() {
    try {
        console.log("Szerver indítása...");
        app.listen(PORT, () => {
            console.log(`🎉 King AI Backend sikeresen elindult!`);
            console.log(`A szerver itt fut: http://localhost:${PORT}`);
            console.log("A frontend most már ehhez a címhez tud csatlakozni.");
        });
    } catch (e) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack);
        // Korábbi hibakereső logok itt voltak, szükség esetén visszaállíthatók
        // if (!process.env.GOOGLE_CREDENTIALS) { ... }
    }
}

startServer();
