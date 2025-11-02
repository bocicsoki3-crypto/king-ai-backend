import express from 'express';
import cors from 'cors';
import { PORT } from './config.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { runFullAnalysis } from './AnalysisFlow.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import aiService, { getChatResponse } from './AI_Service.js';

// === MÓDOSÍTÁS (v50.1): Az öntanuló modulok importálása ===
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
// ÚJ (v50.1): Az eredmény-elszámoló importálása
import { runSettlementProcess } from './settlementService.js'; 

const app = express();
// --- Middleware Beállítások ---

// --- JAVÍTÁS v50.6: Végleges, Explicit CORS Konfiguráció (Szóköz nélkül) ---
// A 'bocsicsoki-crypto.github.io' domain explicit engedélyezése.
const corsOptions = {
  origin: 'https://bocsicsoki-crypto.github.io', // FIGYELEM: Nincs szóköz a végén
  optionsSuccessStatus: 200 // Néhány régebbi böngészőhöz
};
app.use(cors(corsOptions));
// --- JAVÍTÁS VÉGE ---

app.use(express.json()); // JSON body parser
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});
// --- API Útvonalak (Routes) ---

// Meccsek lekérése ESPN-ből
app.get('/getFixtures', async (req, res) => {
    try {
        // GET kérésnél a req.query használata helyes
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
        console.error(`Hiba a 
/getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver 
hiba (getFixtures): ${e.message}` });
    }
});
// Elemzés futtatása
app.post('/runAnalysis', async (req, res) => {
    // === JAVÍTÁS: Minden paraméter olvasása a req.body-ból ===
    // A req.query használata POST végponton helytelen.
    console.log('--- /runAnalysis Kérés Törzse (Body): ---');
    console.log(req.body); // Kiírja az összes body paramétert
    console.log('--- DEBUG VÉGE ---');

    try {
        // --- MÓDOSÍTÁS: Paraméterek kinyerése a req.body-ból ---
        const {
            home,
    
            away,
            force,
            sheetUrl,
            utcKickoff,
            leagueName,
            sport,
            openingOdds = {} // Alapértelmezett érték, ha hiányzik
        } = req.body;

   
         // === JAVÍTOTT ELLENŐRZÉS: A req.body alapján ===
        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
            console.error('!!! HIBA: Hiányzó body paraméter(ek)! Ellenőrzés:', {
                home,
                away,
                sport,
   
                 utcKickoff,
                leagueName
            });
            // Részletesebb logolás hiba esetén
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter a kérés törzsében (body)." });
        }
        // === EDDIG ===

        // A 'params' objektum összeállítása a runFullAnalysis számára
        const params = {
            home,
            away,
            force,
            sheetUrl,
            utcKickoff,
   
             leagueName
        };

        console.log(`Elemzés indítása...`);
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
        const id = req.query.id; // GET esetén req.query helyes
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
        const id = req.body.id; // POST esetén req.body helyes
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
        const { context, history, question } = req.body; // POST esetén req.body helyes
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

// === MÓDOSÍTÁS (v50.1): Az öntanuló végpont átalakítása és levédése ===
app.post('/runLearning', async (req, res) => {
    try {
        // --- BIZTONSÁGI ELLENŐRZÉS (KÖTELEZŐ) ---
        // Ez a végpont módosítja az adatbázist és tanulást végez.
        // Védeni KELL egy titkos kulccsal, amit a .env fájlban kell tárolni.
        // Futtatáshoz küldj egy 'key' attribútumot a JSON body-ban, vagy 'x-admin-key' fejlécet.
        const providedKey = req.body.key || req.headers['x-admin-key'];
        
        // ÁLLÍTS BE EGY 'ADMIN_API_KEY' VÁLTOZÓT A .ENV FÁJLBAN (pl. egy erős, véletlenszerű string)
        if (!process.env.ADMIN_API_KEY || providedKey !== process.env.ADMIN_API_KEY) {
            console.warn("Sikertelen ÖNTANULÁSI kísérlet (hibás admin kulcs).");
            return res.status(401).json({ error: "Hitelesítés sikertelen. Admin kulcs szükséges." });
        }
        // --- BIZTONSÁGI ELLENŐRZÉS VÉGE ---

        console.log("Öntanulási folyamat indítása (1. Lépés: Eredmény-elszámolás)...");
        
        // 1. LÉPÉS: Eredmények elszámolása (W/L/P státuszok frissítése a Sheet-ben)
        const settlementResult = await runSettlementProcess();
        if (settlementResult.error) {
             console.error("Hiba az eredmény-elszámolás során, a tanulás leáll:", settlementResult.error);
             return res.status(500).json({ error: "Hiba az eredmény-elszámolás során.", details: settlementResult.error });
        }
        console.log(`Eredmény-elszámolás kész. Frissítve: ${settlementResult.updated} sor.`);

        console.log("Öntanulási folyamat (2. Lépés: Kalibráció és Rating frissítés) indul...");

        // 2. LÉPÉS: Párhuzamosan futtatjuk a kalibrációt (ami a friss W/L/P-t olvassa) és a rating frissítést
        const [powerRatingResult, calibrationResult] = await Promise.all([
            Promise.resolve(updatePowerRatings()), // Becsomagoljuk Promise-ba
            runConfidenceCalibration() // Ez már Promise-t ad vissza (a frissített Sheet alapján)
        ]);

        const learningResult = {
            message: "Öntanuló modulok sikeresen lefutottak.",
            settlement: settlementResult, // Eredmény-elszámolás riportja
            power_ratings: powerRatingResult || { updated: false, message:"Nem volt elég adat a frissítéshez." },
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