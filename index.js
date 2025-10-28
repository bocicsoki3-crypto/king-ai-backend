// --- index.js (v1.1 - Hibrid Fixture Lekérés) ---

import express from 'express';
import cors from 'cors';
import { PORT, SPORT_CONFIG } from './config.js'; // SPORT_CONFIG importálása
import { _getFixturesFromEspn, _getFixturesFromApiSports } from './DataFetch.js'; // Új import
import { runFullAnalysis } from './AnalysisFlow.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import aiService, { getChatResponse } from './AI_Service.js';

// Az öntanuló modulok importálása
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';

const app = express();

// --- Middleware Beállítások ---
app.use(cors()); // Megengedő CORS beállítás
app.use(express.json()); // JSON body parser
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});

// --- API Útvonalak (Routes) ---

// Meccsek lekérése (Hibrid ESPN + API Sports logika)
app.get('/getFixtures', async (req, res) => {
    try {
        const sport = req.query.sport;
        const days = req.query.days;
        if (!sport || !days) {
            return res.status(400).json({ error: "Hiányzó 'sport' vagy 'days' paraméter." });
        }

        let fixtures = [];
        const sportConfig = SPORT_CONFIG[sport];

        // 1. ESPN Lekérés (ha van konfigurálva ESPN liga az adott sporthoz)
        if (sportConfig && sportConfig.espn_leagues && Object.keys(sportConfig.espn_leagues).length > 0) {
            console.log(`ESPN meccsek lekérése (${sport})...`);
            const espnFixtures = await _getFixturesFromEspn(sport, days);
            fixtures = fixtures.concat(espnFixtures);
            console.log(`ESPN-ről ${espnFixtures.length} meccs betöltve.`);
        } else {
            console.log(`Nincs ESPN konfiguráció ehhez a sporthoz (${sport}), ESPN lekérés kihagyva.`);
        }

        // 2. API Sports Lekérés (ha van konfigurálva API Sports liga az adott sporthoz)
        if (sportConfig && sportConfig.api_sports_leagues && Object.keys(sportConfig.api_sports_leagues).length > 0) {
            console.log(`API Sports meccsek lekérése (${sport})...`);
            const apiSportsFixtures = await _getFixturesFromApiSports(sport, days);
            fixtures = fixtures.concat(apiSportsFixtures);
            console.log(`API Sports-ból ${apiSportsFixtures.length} meccs betöltve.`);
        } else {
            console.log(`Nincs API Sports konfiguráció ehhez a sporthoz (${sport}), API Sports lekérés kihagyva.`);
        }
        
        // 3. Duplikátumok szűrése és rendezés (biztonság kedvéért, uniqueId alapján)
        const uniqueFixturesMap = new Map();
        fixtures.forEach(f => {
            if (f?.uniqueId && !uniqueFixturesMap.has(f.uniqueId)) {
                uniqueFixturesMap.set(f.uniqueId, f);
            }
        });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });

        console.log(`Összesen ${finalFixtures.length} egyedi meccs visszaadva (${sport}).`);
        
        res.status(200).json({
            fixtures: finalFixtures, // A kombinált, szűrt és rendezett lista
            odds: {} // Odds adatokat külön kezeljük
        });
    } catch (e) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

// Elemzés futtatása
app.post('/runAnalysis', async (req, res) => {
    console.log('--- /runAnalysis Kérés Query Paraméterei: ---');
    console.log(req.query);
    console.log('--- DEBUG VÉGE ---');
    try {
        const params = {
            home: req.query.home, away: req.query.away,
            force: req.query.force, sheetUrl: req.query.sheetUrl,
            utcKickoff: req.query.utcKickoff, leagueName: req.query.leagueName
        };
        const sport = req.query.sport;
        const openingOdds = req.body.openingOdds || {};

        if (!params.home || !params.away || !sport || !params.utcKickoff) {
            console.error('!!! HIBA: Hiányzó query paraméter(ek)!', { home: params.home, away: params.away, sport: sport, utcKickoff: params.utcKickoff });
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away' vagy 'utcKickoff' paraméter." });
        }
        
        console.log(`Elemzés indítása...`);
        const result = await runFullAnalysis(params, sport, openingOdds);
        
        // Fontos: Ellenőrizzük, hogy a datafetch error-t adott-e vissza
        if (result && result.error) {
            console.error(`Elemzési hiba (AnalysisFlow/DataFetch): ${result.error}`);
            return res.status(500).json({ error: result.error });
        }

        console.log("Elemzés sikeresen befejezve, válasz elküldve.");
        res.status(200).json(result);
    } catch (e) {
        console.error(`Hiba a /runAnalysis végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});

// Előzmények lekérése
app.get('/getHistory', async (req, res) => {
    try {
        const historyData = await getHistoryFromSheet();
        if (historyData.error) { return res.status(500).json(historyData); }
        res.status(200).json(historyData);
    } catch (e) {
        console.error(`Hiba a /getHistory végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` });
    }
});

// Elemzés részleteinek lekérése
app.get('/getAnalysisDetail', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) { return res.status(400).json({ error: "Hiányzó 'id' paraméter." }); }
        const detailData = await getAnalysisDetailFromSheet(id);
        if (detailData.error) { return res.status(500).json(detailData); }
        res.status(200).json(detailData);
    } catch (e) {
        console.error(`Hiba a /getAnalysisDetail végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getAnalysisDetail): ${e.message}` });
    }
});

// Előzmény törlése
app.post('/deleteHistoryItem', async (req, res) => {
    try {
        const id = req.body.id;
        if (!id) { return res.status(400).json({ error: "Hiányzó 'id' a kérés body-jában." }); }
        const deleteData = await deleteHistoryItemFromSheet(id);
        if (deleteData.error) { return res.status(500).json(deleteData); }
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
        if (!context || !question) { return res.status(400).json({ error: "Hiányzó 'context' vagy 'question'." }); }
        const chatData = await getChatResponse(context, history, question);
        if (chatData.error) { return res.status(500).json(chatData); }
        res.status(200).json(chatData);
    } catch (e) {
        console.error(`Hiba a /askChat végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` });
    }
});

// Öntanuló végpont
app.post('/runLearning', async (req, res) => {
    try {
        console.log("Öntanulási folyamat indítása...");
        const [powerRatingResult, calibrationResult] = await Promise.all([
            Promise.resolve(updatePowerRatings()),
            runConfidenceCalibration()
        ]);
        const learningResult = {
            message: "Öntanuló modulok lefutottak.",
            power_ratings: powerRatingResult || { updated: false, message:"Nem volt adat a frissítéshez." },
            confidence_calibration: calibrationResult || { error: "Ismeretlen hiba a kalibráció során." }
        };
        if (learningResult.confidence_calibration.error) {
             console.error("Hiba a bizalmi kalibráció során:", learningResult.confidence_calibration.error);
        }
        res.status(200).json(learningResult);
    } catch (e) {
        console.error(`Hiba a /runLearning végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runLearning): ${e.message}` });
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
    }
}

startServer();