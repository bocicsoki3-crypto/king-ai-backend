import express from 'express';
import cors from 'cors';
import { PORT } from './config.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { runFullAnalysis } from './AnalysisFlow.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import aiService, { getChatResponse } from './AI_Service.js';

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
        res.status(200).json({
            fixtures: fixtures,
            odds: {}
        });
    } catch (e) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

// Elemzés futtatása
app.post('/runAnalysis', async (req, res) => {
    try {
        const params = {
            home: req.query.home,
            away: req.query.away,
            force: req.query.force,
            sheetUrl: req.query.sheetUrl
        };
        const sport = req.query.sport;
        const openingOdds = req.body.openingOdds || {};

        if (!params.home || !params.away || !sport) {
            return res.status(400).json({ error: "Hiányzó 'sport', 'home' vagy 'away' paraméter." });
        }

        console.log(`Elemzés indítása... (Ez eltarthat 1-2 percig az AI hívások miatt)`);
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
        if (!process.env.GOOGLE_CREDENTIALS) {
            console.error("!!! HIBA: A GOOGLE_CREDENTIALS környezeti változó nincs beállítva a Renderen!");
        }
    }
}

startServer();