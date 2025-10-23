import express from 'express';
import cors from 'cors';
import { PORT } from './config.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { runFullAnalysis } from './AnalysisFlow.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import { getChatResponse, getFinalCheck } from './AI_Service.js';

const app = express();

// --- Middleware Beállítások ---

// === JAVÍTÁS: Robusztusabb CORS Beállítás ===
// Ahelyett, hogy egy függvénnyel ellenőrizzük, közvetlenül megadjuk
// a Rendernek az engedélyezett címet. Ez a legstabilabb megoldás.
app.use(cors({
    origin: 'https://bocicsoki3-crypto.github.io'
}));
// ===========================================

app.use(express.json());

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});

// --- API Útvonalak (Routes) ---

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
            odds: {} // A nyitó oddsokat már a frontend küldi, itt üresen hagyjuk.
        });
    } catch (e) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

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

app.post('/runFinalCheck', async (req, res) => {
    try {
        const { sport, home, away, openingOdds } = req.body;
        if (!sport || !home || !away) {
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', vagy 'away' paraméter." });
        }
        
        const result = await getFinalCheck(sport, home, away, openingOdds || {});
        
        if (result.error) {
            return res.status(500).json(result);
        }
        res.status(200).json(result);
    } catch (e) {
        console.error(`Hiba a /runFinalCheck végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runFinalCheck): ${e.message}` });
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
        if (e.code === 'MODULE_NOT_FOUND' && e.message.includes('google-credentials.json')) {
            console.error("!!! HIBA: A 'google-credentials.json' fájl nem található!");
            console.error("!!! Kérlek, kövesd az utasításokat a Google Cloud hitelesítő fájl létrehozásához és elhelyezéséhez!");
        }
        if (!process.env.GEMINI_API_KEY || !process.env.SHEET_URL) {
            console.error("!!! HIBA: Hiányzó API kulcsok vagy SHEET_URL a .env fájlból!");
            console.error("!!! Kérlek, hozd létre és töltsd ki a .env fájlt a config.js mellett!");
        }
    }
}

startServer();