// --- index.ts (v63.0 - Roster Kérés Végpont) ---
// MÓDOSÍTÁS (Feladat 2.1):
// 1. ÚJ VÉGPONT: '/getRosters' hozzáadva a P1-es hiányzó-választó azonnali keret-töltéséhez.
// 2. ÚJ IMPORT: 'getRostersForMatch' importálva a 'DataFetch.js'-ből.
// 3. MÓDOSÍTVA: A v60.3-as CORS konfigurációja (Origin: *) érintetlenül hagyva.
// 4. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path'; 
import { fileURLToPath } from 'url';
import { PORT } from './config.js';
// Importáljuk a típusosított fő funkciókat
import { runFullAnalysis, runChatResponse } from './AnalysisFlow.js';
import { runLearning, runSettlement } from './LearningService.js';
import { _getFixturesFromEspn, getRostersForMatch } from './DataFetch.js'; // <- MÓDOSÍTVA

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

// --- Middleware Beállítások ---

// A 'nukleáris opció' CORS hiba elkerülése érdekében:
// A biztonságot továbbra is a 'protect' middleware (JWT) garantálja.
app.use(cors({ origin: "*" })); 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// --- Hitelesítés és Védelem ---

/**
 * Ellenőrzi a JWT-t, és beállítja a felhasználó adatait a kérésen.
 */
function protect(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Hozzáférés megtagadva. Hiányzó token." });
    }
    
    // Figyelem: A JWT_SECRET-nek kell lennie a .env-ben!
    if (!process.env.JWT_SECRET) {
        console.error("KRITIKUS HIBA: A JWT_SECRET nincs beállítva!");
        return res.status(500).json({ error: "Szerver konfigurációs hiba." });
    }

    try {
        // A token érvényesítése
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string }; 
        // req.user = decoded; // Ezt a sort kihagyjuk, mivel a kód nem használja a 'user' mezőt
        next();
    } catch (e) {
        return res.status(403).json({ error: "Érvénytelen token." });
    }
}


// --- API Végpontok ---

/**
 * POST /login - Hitelesítés.
 * Csak egyetlen statikus jelszót támogat a APP_PASSWORD_HASH alapján.
 */
app.post('/login', async (req: Request, res: Response) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ error: "Hiányzó jelszó." });
    }
    
    // Figyelem: APP_PASSWORD_HASH-nek kell lennie a .env-ben!
    const hash = process.env.APP_PASSWORD_HASH;
    if (!hash) {
        console.error("KRITIKUS HIBA: APP_PASSWORD_HASH nincs beállítva!");
        return res.status(500).json({ error: "Szerver konfigurációs hiba." });
    }

    try {
        const isMatch = await bcrypt.compare(password, hash);
        
        if (!isMatch) {
            return res.status(401).json({ error: "Érvénytelen jelszó." });
        }

        // JWT létrehozása (id: 1 a statikus felhasználóhoz)
        const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET as string, { expiresIn: '8h' });

        res.status(200).json({ token });
        
    } catch (e: any) {
        console.error(`Hiba a /login végpont-on: ${e.message}`);
        res.status(500).json({ error: "Szerver hiba a hitelesítés során." });
    }
});


/**
 * GET /getFixtures - Lekéri a meccseket az ESPN-ről.
 * Védett végpont.
 */
app.get('/getFixtures', protect, async (req: Request, res: Response) => {
    try {
        const { sport, leagueName } = req.query;
        if (typeof sport !== 'string' || typeof leagueName !== 'string') {
            return res.status(400).json({ error: "Hiányzó 'sport' vagy 'leagueName' paraméter." });
        }
        
        const fixtures = await _getFixturesFromEspn(sport, leagueName);
        res.status(200).json(fixtures);

    } catch (e: any) {
        console.error(`Hiba a /getFixtures végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});


/**
 * POST /runAnalysis - Futtatja a teljes AI elemzési folyamatot.
 * Védett végpont.
 */
app.post('/runAnalysis', protect, async (req: Request, res: Response) => {
    try {
        const { sport, home, away, league, date, fixtureId, sheetUrl, manual_absentees } = req.body;
        
        if (!sport || !home || !away || !league || !date) {
             return res.status(400).json({ error: "Hiányzó kötelező paraméter: sport, home, away, league, vagy date." });
        }
        
        // A manual_absentees átadásra kerül a DataFetch-nek
        const analysisResult = await runFullAnalysis({ 
            sport, home, away, league, date, fixtureId, sheetUrl, manual_absentees 
        });
        
        res.status(200).json(analysisResult);

    } catch (e: any) {
        console.error(`Hiba a /runAnalysis végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});


/**
 * POST /chat - Beszélgetés az elemzési kontextusról.
 * Védett végpont.
 */
app.post('/chat', protect, async (req: Request, res: Response) => {
    try {
        const { context, history, question } = req.body;
        
        if (!context || !question) {
            return res.status(400).json({ error: "Hiányzó 'context' vagy 'question'." });
        }

        const chatResult = await runChatResponse(context, history, question);
        
        if (chatResult.error) {
            return res.status(500).json({ error: chatResult.error });
        }
        
        res.status(200).json({ answer: chatResult.answer });

    } catch (e: any) {
        console.error(`Hiba a /chat végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (chat): ${e.message}` });
    }
});


/**
 * POST /getRosters - Keretadatok lekérése a P1 hiányzó-választóhoz.
 * ÚJ VÉGPONT (v63.0)
 * Védett végpont.
 */
app.post('/getRosters', protect, async (req: Request, res: Response) => {
    try {
        const { sport, home, away, league, utcKickoff, fixtureId } = req.body;

        if (!sport || !home || !away || !league || !utcKickoff) {
            return res.status(400).json({ error: "Hiányzó kötelező paraméter: sport, home, away, league, vagy utcKickoff." });
        }
        
        // A getRostersForMatch csak a kanonikus 'availableRosters'-t adja vissza
        const rosters = await getRostersForMatch({ sport, home, away, league, utcKickoff, fixtureId });
        
        if (!rosters) {
            return res.status(404).json({ error: "Nem található keretadat a meccshez." });
        }
        
        res.status(200).json(rosters);
        
    } catch (e: any) {
        console.error(`Hiba a /getRosters végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getRosters): ${e.message}` });
    }
});


/**
 * POST /runLearning - Lefuttatja a teljes tanulási folyamatot (Settlement, PR, Calibration).
 * Védett végpont.
 */
app.post('/runLearning', protect, async (req: Request, res: Response) => {
     try {
        const sheetUrl = req.body.sheetUrl;
        if (typeof sheetUrl !== 'string' || sheetUrl.length < 10) {
            return res.status(400).json({ error: "Hiányzó vagy érvénytelen 'sheetUrl' paraméter." });
        }
        
        const settlementResult = await runSettlement(sheetUrl);
        const { powerRatingResult, calibrationResult } = await runLearning(sheetUrl);
        
        const learningResult = {
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

// --- Szerver Indítása (Változatlan) ---\
async function startServer() {
    try {
        if (!process.env.JWT_SECRET || !process.env.APP_PASSWORD_HASH) {
            console.error("KRITIKUS HIBA: A JWT_SECRET vagy APP_PASSWORD_HASH nincs beállítva a .env fájlban!");
            console.error("A hitelesítés nem fog működni. A szerver leáll.");
            process.exit(1); 
        }

        console.log("Szerver indítása...");
        app.listen(PORT, () => {
            console.log(`🎉 King AI Backend (TypeScript) sikeresen elindult!`);
            console.log(`🚀 Elérhető a porton: ${PORT}`);
            console.log(`🔗 Local URL: http://localhost:${PORT}`);
        });
    } catch (e) {
        console.error("FATAL HIBA a szerver indítása során:", e);
        process.exit(1);
    }
}

startServer();
