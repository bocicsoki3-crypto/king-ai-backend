import express from 'express';
import cors from 'cors';
import { PORT } from './config.js'; [cite: 271]
import { _getFixturesFromEspn } from './DataFetch.js'; [cite: 271]
import { runFullAnalysis } from './AnalysisFlow.js'; [cite: 272]
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js'; [cite: 272]

// === JAVÍTÁS: Helyes ES Modul import (nincs default export) ===
// A 'aiService' default import helyett  közvetlenül a nevesített függvényeket importáljuk
import { 
    getChatResponse,
    // Itt importálhatnánk a többi AI funkciót is, ha közvetlenül hívnánk őket,
    // de jelenleg csak a getChatResponse van itt használva.
} from './AI_Service.js'; [cite: 273]
// === JAVÍTÁS VÉGE ===

import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js'; [cite: 274]

const app = express();
app.use(express.json()); // JSON body parser

// === JAVÍTÁS: Biztonságos CORS beállítás ===
// Az 'app.use(cors())'  helyett egy biztonságos, whitelist alapú beállítás
// TODO: Cseréld le a '[https://a-te-frontend-domain-ed.com](https://a-te-frontend-domain-ed.com)' címet
// a saját éles frontend domain(ek)re.
const allowedOrigins = [
    'http://localhost:3000', // Helyi fejlesztéshez
    'http://localhost:5173', // Helyi fejlesztéshez (pl. Vite)
    '[https://a-te-frontend-domain-ed.com](https://a-te-frontend-domain-ed.com)'
];

app.use(cors({
    origin: function (origin, callback) {
        // Engedélyezzük a 'origin' nélküli kéréseket (pl. Postman, mobil appok)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    }
}));
// === JAVÍTÁS VÉGE ===


app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
}); [cite: 277]

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
        }); [cite: 278]
    } catch (e) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` }); [cite: 279]
    }
});

// Elemzés futtatása
// === REFAKTORÁLÁS: POST /runAnalysis ===
// A paramétereket a 'req.body'-ból olvassuk, nem a 'req.query'-ból[cite: 280, 281].
// FIGYELEM: A frontend hívást is frissíteni kell!
app.post('/runAnalysis', async (req, res) => {
    
    // === DEBUG SOR ===
    console.log('--- /runAnalysis Kérés BODY Paraméterei: ---');
    console.log(req.body); // Kiírja a kérés törzsét
    console.log('--- DEBUG VÉGE ---');

    try {
        // Adatok olvasása a req.body-ból
        const { 
            home, 
            away, 
            force, 
            sheetUrl, 
            utcKickoff, 
            leagueName, 
            sport, 
            openingOdds 
        } = req.body;

        const params = {
            home,
            away,
            force,
            sheetUrl,
            utcKickoff,
            leagueName
        };

        // Ellenőrzés a body alapján [cite: 281]
        if (!params.home || !params.away || !sport || !params.utcKickoff) { [cite: 282]
            console.error('!!! HIBA: Hiányzó paraméter(ek) a KÉRÉS BODY-JÁBAN! Ellenőrzés:', {
                home: params.home,
                away: params.away,
                sport: sport,
                utcKickoff: params.utcKickoff
            }); [cite: 283]
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away' vagy 'utcKickoff' paraméter a kérés body-jában." }); [cite: 284]
        }

        console.log(`Elemzés indítása...`); [cite: 285]
        const result = await runFullAnalysis(params, sport, openingOdds || {}); [cite: 285]
        
        if (result.error) {
            console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`); [cite: 287]
            return res.status(500).json({ error: result.error }); [cite: 287]
        }

        console.log("Elemzés sikeresen befejezve, válasz elküldve.");
        res.status(200).json(result); [cite: 288]
    } catch (e) {
        console.error(`Hiba a /runAnalysis végponton: ${e.message}`, e.stack); [cite: 289]
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` }); [cite: 289]
    }
});
// === REFAKTORÁLÁS VÉGE ===

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
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` }); [cite: 290]
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
        } [cite: 292]
        res.status(200).json(detailData); [cite: 292]
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
        } [cite: 294]
        res.status(200).json(deleteData); [cite: 294]
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
        // Itt már a helyesen importált getChatResponse hívódik meg
        const chatData = await getChatResponse(context, history, question);

        if (chatData.error) {
           return res.status(500).json(chatData); [cite: 296]
        }
        res.status(200).json(chatData);
    } catch (e) {
        console.error(`Hiba a /askChat végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` });
    }
});

// === JAVÍTÁS: Öntanuló végpont aszinkron kezelése ===
app.post('/runLearning', async (req, res) => {
    try {
        console.log("Öntanulási folyamat indítása (Power Ratings & Bizalmi Kalibráció)...");

        // FELTÉTELEZÉS: 'updatePowerRatings' és 'runConfidenceCalibration'
        // a 'LearningService.js'-ben 'async' függvények, és Promise-t adnak vissza.
        
        // A hibás 'Promise.resolve()' burkolás  eltávolítva
        const results = await Promise.allSettled([
            updatePowerRatings(),
            runConfidenceCalibration()
        ]);

        const powerRatingResult = results[0].status === 'fulfilled' ? 
            results[0].value : 
            { error: results[0].reason?.message || "Ismeretlen hiba (PowerRatings)" };
            
        const calibrationResult = results[1].status === 'fulfilled' ?
            results[1].value :
            { error: results[1].reason?.message || "Ismeretlen hiba (Kalibráció)" }; [cite: 299]

        // Robusztusabb hibajelentés
        if (results.some(r => r.status === 'rejected')) {
             console.error("Hiba az öntanuló modulok futtatása során:", {
                 powerRatingError: results[0].reason,
                 calibrationError: results[1].reason
             });
        }

        const learningResult = {
            message: "Öntanuló modulok futtatása befejeződött.",
            power_ratings: powerRatingResult || { updated: false, message: "Nem volt adat a frissítéshez." }, [cite: 299]
            confidence_calibration: calibrationResult || { error: "Ismeretlen hiba a kalibráció során." } [cite: 300]
        };

        res.status(200).json(learningResult); [cite: 303]
    } catch (e) {
        console.error(`Hiba a /runLearning végponton: ${e.message}`, e.stack); [cite: 304]
        res.status(500).json({ error: `Szerver hiba (runLearning): ${e.message}` }); [cite: 304]
    }
});
// === JAVÍTÁS VÉGE ===

// --- Szerver Indítása ---
async function startServer() {
    try {
        console.log("Szerver indítása...");
        app.listen(PORT, () => { [cite: 305]
            console.log(`🎉 King AI Backend sikeresen elindult!`);
            console.log(`A szerver itt fut: http://localhost:${PORT}`);
            console.log("A frontend most már ehhez a címhez tud csatlakozni.");
        }); [cite: 305]
    } catch (e) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack); [cite: 306]
    }
}

startServer();
