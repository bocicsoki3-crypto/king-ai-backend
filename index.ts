// --- index.ts (v52.6 - Diagnosztikai Végpont Hozzáadva) ---

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import path from 'path'; 
import { fileURLToPath } from 'url'; 
import { PORT } from './config.js';

// ... (minden más import változatlan) ...
import { runFullAnalysis } from './AnalysisFlow.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import { getChatResponse } from './AI_Service.js';
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
import { runSettlementProcess } from './settlementService.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(cors());
app.use(express.json()); 

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.includes('.js') && !req.path.includes('.css') && req.path !== '/') {
        console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    }
    next();
});

app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Hitelesítés
app.post('/login', async (req: Request, res: Response) => {
    try {
        const { password } = req.body;
        if (!password || !process.env.APP_PASSWORD_HASH || !process.env.JWT_SECRET) {
             return res.status(400).json({ error: "Hiányzó adatok vagy szerver konfiguráció." });
        }
        const isMatch = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH);
        if (!isMatch) {
            console.warn("Sikertelen bejelentkezési kísérlet (hibás jelszó).");
            return res.status(401).json({ error: "Hitelesítés sikertelen." });
        }
        const token = jwt.sign(
           { user: 'autentikalt_felhasznalo' }, 
            process.env.JWT_SECRET as string, // 'as string' a TS-nek
            { expiresIn: '24h' }
        );
        res.status(200).json({ token: token });
    } catch (e: any) {
        console.error(`Hiba a /login végpont-on: ${e.message}`);
        res.status(500).json({ error: "Szerver hiba (login)." });
    }
});

// === ÚJ DIAGNOSZTIKAI VÉGPONT ===
// Ideiglenes, nem biztonságos végpont a HASH és a jelszó-ellenőrzés tesztelésére.
app.get('/checkhash', async (req: Request, res: Response) => {
    try {
        const serverHash = process.env.APP_PASSWORD_HASH;
        
        if (!serverHash) {
            return res.status(500).json({ 
                error: "KRITIKUS HIBA: Az APP_PASSWORD_HASH nincs beállítva a szerver környezetében."
            });
        }
        
        const testPassword = req.query.password as string;

        if (!testPassword) {
            // Ha nincs jelszó paraméter, csak a hash-t küldjük vissza
            return res.status(200).json({
                message: "Diagnosztika: A szerver által látott HASH. (Adjon meg ?password=... query paramétert a teszteléshez)",
                server_hash_value: serverHash,
                hash_is_correct_format: serverHash === "$2b$10$3g0.iG/3E.ZB50wK.1MvXOvjZJULfWJ07J75WlD6cEdMUH/h3aLwe"
            });
        }

        // Ha van jelszó paraméter, lefuttatjuk az ellenőrzést
        const isMatch = await bcrypt.compare(testPassword, serverHash);
        
        res.status(200).json({
            message: "Diagnosztika: bcrypt.compare() teszt eredménye.",
            password_provided: testPassword,
            server_hash_value: serverHash,
            compare_result_isMatch: isMatch
        });

    } catch (e: any) {
        res.status(500).json({ error: `Diagnosztikai hiba: ${e.message}` });
    }
});
// === DIAGNOSZTIKA VÉGE ===

// Védelmi Middleware
const protect = (req: Request, res: Response, next: NextFunction) => {
    // ... (protect logika változatlan) ...
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) {
        return res.status(401).json({ error: "Hitelesítés szükséges (Token hiányzik)." });
    }
    try {
        if (!process.env.JWT_SECRET) {
             console.error("KRITIKUS HIBA: JWT_SECRET nincs beállítva a szerveren.");
             return res.status(500).json({ error: "Szerver konfigurációs hiba." });
        }
        jwt.verify(token, process.env.JWT_SECRET as string);
        next(); 
    } catch (e) {
        return res.status(401).json({ error: "Hitelesítés sikertelen (Érvénytelen vagy lejárt token)." });
    }
};

// ... (minden más védett végpont (/getFixtures, /runAnalysis, stb.) változatlan) ...
app.get('/getFixtures', protect, async (req: Request, res: Response) => {
    try {
        const sport = req.query.sport as string;
        const days = req.query.days as string;
        if (!sport || !days) {
            return res.status(400).json({ error: "Hiányzó 'sport' vagy 'days' paraméter." });
        }
        const fixtures = await _getFixturesFromEspn(sport, days);
        res.status(200).json({
            fixtures: fixtures,
            odds: {} 
        });
    } catch (e: any) {
        console.error(`Hiba a /getFixtures végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

app.post('/runAnalysis', protect, async (req: Request, res: Response) => {
    try {
        const { home, away, force, sheetUrl, utcKickoff, leagueName, sport, openingOdds = {} } = req.body;
        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter." });
        }
        const params = { home, away, force, sheetUrl, utcKickoff, leagueName };
        const result = await runFullAnalysis(params, sport, openingOdds);
        if ('error' in result) {
            console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`);
            return res.status(500).json({ error: result.error });
        }
        res.status(200).json(result);
    } catch (e: any) {
        console.error(`Hiba a /runAnalysis végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});

app.get('/getHistory', protect, async (req: Request, res: Response) => {
    try {
        const historyData = await getHistoryFromSheet();
        if (historyData.error) {
            return res.status(500).json(historyData);
        }
        res.status(200).json(historyData);
    } catch (e: any) {
        console.error(`Hiba a /getHistory végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` });
    }
});

app.get('/getAnalysisDetail', protect, async (req: Request, res: Response) => {
    try {
        const id = req.query.id as string;
        if (!id) {
            return res.status(400).json({ error: "Hiányzó 'id' paraméter." });
        }
        const detailData = await getAnalysisDetailFromSheet(id);
        if (detailData.error) {
            return res.status(500).json(detailData);
        }
        res.status(200).json(detailData);
    } catch (e: any) {
        console.error(`Hiba a /getAnalysisDetail végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getAnalysisDetail): ${e.message}` });
    }
});

app.post('/deleteHistoryItem', protect, async (req: Request, res: Response) => {
    try {
        const id = req.body.id as string;
        if (!id) {
            return res.status(400).json({ error: "Hiányzó 'id' a kérés body-jában." });
        }
        const deleteData = await deleteHistoryItemFromSheet(id);
        if (deleteData.error) {
            return res.status(500).json(deleteData);
        }
        res.status(200).json(deleteData);
    } catch (e: any) {
        console.error(`Hiba a /deleteHistoryItem végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (deleteHistoryItem): ${e.message}` });
    }
});

app.post('/askChat', protect, async (req: Request, res: Response) => {
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
    } catch (e: any) {
        console.error(`Hiba a /askChat végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` });
    }
});

app.post('/runLearning', protect, async (req: Request, res: Response) => {
    try {
        const providedKey = req.body.key || req.headers['x-admin-key'];
        if (!process.env.ADMIN_API_KEY || providedKey !== process.env.ADMIN_API_KEY) {
            console.warn("Sikertelen ÖNTANULÁSI kísérlet (hibás admin kulcs).");
            return res.status(401).json({ error: "Hitelesítés sikertelen. Admin kulcs szükséges." });
        }
        
        console.log("Öntanulási folyamat indítása (1. Lépés: Eredmény-elszámolás)...");
        const settlementResult = await runSettlementProcess();
        if (settlementResult.error) {
             console.error("Hiba az eredmény-elszámolás során, a tanulás leáll:", settlementResult.error);
             return res.status(500).json({ error: "Hiba az eredmény-elszámolás során.", details: settlementResult.error });
        }
        console.log(`Eredmény-elszámolás kész. Frissítve: ${settlementResult.updated} sor.`);

        console.log("Öntanulási folyamat (2. Lépés: Kalibráció és Rating frissítés) indul...");
        const [powerRatingResult, calibrationResult] = await Promise.all([
            Promise.resolve(updatePowerRatings()),
            runConfidenceCalibration()
        ]);

        const learningResult = {
            message: "Öntanuló modulok sikeresen lefutottak.",
            settlement: settlementResult,
            power_ratings: powerRatingResult || { updated: false, message:"Nem volt elég adat a frissítéshez." },
            confidence_calibration: calibrationResult || { error: "Ismeretlen hiba a kalibráció során." }
        };
        
        if (learningResult.confidence_calibration.error) {
             console.error("Hiba a bizalmi kalibráció során:", learningResult.confidence_calibration.error);
        }
        res.status(200).json(learningResult);
    } catch (e: any) {
        console.error(`Hiba a /runLearning végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runLearning): ${e.message}` });
    }
});


// --- Szerver Indítása ---
async function startServer() {
    try {
        if (!process.env.JWT_SECRET || !process.env.APP_PASSWORD_HASH) {
            console.error("KRITIKUS HIBA: A JWT_SECRET vagy APP_PASSWORD_HASH nincs beállítva a .env fájlban!");
            console.error("A hitelesítés nem fog működni. A szerver leáll.");
            process.exit(1); 
        }
        // ... (többi .env ellenőrzés) ...

        console.log("Szerver indítása...");
        app.listen(PORT, () => {
            console.log(`🎉 King AI Backend (TypeScript) sikeresen elindult!`);
            console.log(`A szerver itt fut: http://localhost:${PORT}`);
            console.log("A frontend most már a gyökér '/' címhez tud csatlakozni.");
        });
    } catch (e: any) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack);
        process.exit(1);
    }
}

startServer();