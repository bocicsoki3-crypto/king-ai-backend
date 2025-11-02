// --- index.ts (v52 - TypeScript & JWT Hitelesítés) ---

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken'; // Hitelesítéshez
import bcrypt from 'bcrypt'; // Jelszó-hash ellenőrzéshez
import { PORT } from './config.js';

// Importáljuk a típusosított fő funkciókat
import { runFullAnalysis } from './AnalysisFlow.js';
import { _getFixturesFromEspn } from './DataFetch.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import { getChatResponse } from './AI_Service.js';

// Öntanuló modulok importálása
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
import { runSettlementProcess } from './settlementService.js'; 

const app: Express = express();

// --- Middleware Beállítások ---
app.use(cors());
app.use(express.json()); // JSON body parser

// --- ÚJ (v52): Hitelesítési Végpont (Nem védett) ---
app.post('/login', async (req: Request, res: Response) => {
    try {
        const { password } = req.body;
        // A .env fájlban kell tárolni a hash-elt jelszót és a titkos kulcsot
        if (!password || !process.env.APP_PASSWORD_HASH || !process.env.JWT_SECRET) {
            return res.status(400).json({ error: "Hiányzó adatok vagy szerver konfiguráció." });
        }

        // Jelszó összehasonlítása a .env-ben tárolt hash-sel
        const isMatch = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH);

        if (!isMatch) {
            console.warn("Sikertelen bejelentkezési kísérlet (hibás jelszó).");
            return res.status(401).json({ error: "Hitelesítés sikertelen." });
        }

        // Sikeres belépés: JWT generálása
        const token = jwt.sign(
            { user: 'autentikalt_felhasznalo' }, 
            process.env.JWT_SECRET, 
            { expiresIn: '24h' } // Token érvényessége
        );
        
        res.status(200).json({ token: token });

    } catch (e: any) {
        console.error(`Hiba a /login végponton: ${e.message}`);
        res.status(500).json({ error: "Szerver hiba (login)." });
    }
});

// --- ÚJ (v52): Védelmi Middleware ---
const protect = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formátum: "Bearer <token>"

    if (!token) {
        return res.status(401).json({ error: "Hitelesítés szükséges (Token hiányzik)." });
    }

    try {
        if (!process.env.JWT_SECRET) {
             console.error("KRITIKUS HIBA: JWT_SECRET nincs beállítva a szerveren.");
             return res.status(500).json({ error: "Szerver konfigurációs hiba." });
        }
        jwt.verify(token, process.env.JWT_SECRET);
        next(); // Token érvényes, kérés folytatódhat
    } catch (e) {
        return res.status(401).json({ error: "Hitelesítés sikertelen (Érvénytelen vagy lejárt token)." });
    }
};

// --- Logoló Middleware ---
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});

// --- API Útvonalak (Routes) - MOST MÁR VÉDETT ---

// Meccsek lekérése ESPN-ből (VÉDETT)
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
            odds: {} // Odds adatokat külön kezeljük, itt üres marad
        });
    } catch (e: any) {
        console.error(`Hiba a /getFixtures végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

// Elemzés futtatása (VÉDETT)
app.post('/runAnalysis', protect, async (req: Request, res: Response) => {
    console.log('--- /runAnalysis Kérés Törzse (Body): ---');
    console.log(req.body);
    console.log('--- DEBUG VÉGE ---');

    try {
        const {
            home,
            away,
            force,
            sheetUrl,
            utcKickoff,
            leagueName,
            sport,
            openingOdds = {}
        } = req.body;

        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
            console.error('!!! HIBA: Hiányzó body paraméter(ek)! Ellenőrzés:', {
                home, away, sport, utcKickoff, leagueName
            });
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter a kérés törzsében (body)." });
        }

        const params = { home, away, force, sheetUrl, utcKickoff, leagueName };
        
        console.log(`Elemzés indítása...`);
        // A runFullAnalysis már típusosított IAnalysisResponse | IAnalysisError választ ad
        const result = await runFullAnalysis(params, sport, openingOdds);

        if ('error' in result) {
            console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`);
            return res.status(500).json({ error: result.error });
        }

        console.log("Elemzés sikeresen befejezve, válasz elküldve.");
        res.status(200).json(result);
    } catch (e: any) {
        console.error(`Hiba a /runAnalysis végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});

// Előzmények lekérése a Google Sheet-ből (VÉDETT)
app.get('/getHistory', protect, async (req: Request, res: Response) => {
    try {
        const historyData = await getHistoryFromSheet();
        if (historyData.error) {
            return res.status(500).json(historyData);
        }
        res.status(200).json(historyData);
    } catch (e: any) {
        console.error(`Hiba a /getHistory végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getHistory): ${e.message}` });
    }
});

// Egy konkrét elemzés részleteinek lekérése ID alapján (VÉDETT)
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
        console.error(`Hiba a /getAnalysisDetail végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getAnalysisDetail): ${e.message}` });
    }
});

// Előzmény elem törlése ID alapján (VÉDETT)
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
        console.error(`Hiba a /deleteHistoryItem végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (deleteHistoryItem): ${e.message}` });
    }
});

// Chat funkció (VÉDETT)
app.post('/askChat', protect, async (req: Request, res: Response) => {
    try {
        const { context, history, question } = req.body;
        if (!context || !question) {
            return res.status(400).json({ error: "Hiányzó 'context' vagy 'question' a kérés body-jában." });
        }
        // A getChatResponse már típusosított
        const chatData = await getChatResponse(context, history, question);

        if (chatData.error) {
            return res.status(500).json(chatData);
        }
        res.status(200).json(chatData);
    } catch (e: any) {
        console.error(`Hiba a /askChat végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (askChat): ${e.message}` });
    }
});

// Öntanuló végpont (VÉDETT)
// MEGJEGYZÉS: Ez a végpont most már KÉTSZERESEN VÉDETT.
// 1. A 'protect' ellenőrzi az érvényes felhasználói JWT tokent.
// 2. A belső logika ellenőrzi a .env-ben tárolt ADMIN_API_KEY-t.
// Ez a helyes működés (pl. csak admin futtathatja, de be kell legyen lépve).
app.post('/runLearning', protect, async (req: Request, res: Response) => {
    try {
        // --- ADMIN KULCS ELLENŐRZÉS (MEGERŐSÍTÉS) ---
        const providedKey = req.body.key || req.headers['x-admin-key'];
        
        if (!process.env.ADMIN_API_KEY || providedKey !== process.env.ADMIN_API_KEY) {
            console.warn("Sikertelen ÖNTANULÁSI kísérlet (hibás admin kulcs).");
            return res.status(401).json({ error: "Hitelesítés sikertelen. Admin kulcs szükséges." });
        }
        // --- BIZTONSÁGI ELLENŐRZÉS VÉGE ---

        console.log("Öntanulási folyamat indítása (1. Lépés: Eredmény-elszámolás)...");
        
        // 1. LÉPÉS: Eredmények elszámolása
        const settlementResult = await runSettlementProcess();
        if (settlementResult.error) {
             console.error("Hiba az eredmény-elszámolás során, a tanulás leáll:", settlementResult.error);
             return res.status(500).json({ error: "Hiba az eredmény-elszámolás során.", details: settlementResult.error });
        }
        console.log(`Eredmény-elszámolás kész. Frissítve: ${settlementResult.updated} sor.`);

        console.log("Öntanulási folyamat (2. Lépés: Kalibráció és Rating frissítés) indul...");

        // 2. LÉPÉS: Párhuzamos futtatás
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
        console.error(`Hiba a /runLearning végponton: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runLearning): ${e.message}` });
    }
});


// --- Szerver Indítása ---
async function startServer() {
    try {
        // Ellenőrizzük a kritikus környezeti változókat indításkor
        if (!process.env.JWT_SECRET || !process.env.APP_PASSWORD_HASH) {
            console.error("KRITIKUS HIBA: A JWT_SECRET vagy APP_PASSWORD_HASH nincs beállítva a .env fájlban!");
            console.error("A hitelesítés nem fog működni. A szerver leáll.");
            process.exit(1); // Kilépés hibakóddal
        }
        if (!process.env.GEMINI_API_KEY) {
            console.warn("Figyelmeztetés: GEMINI_API_KEY hiányzik. Az AI funkciók nem fognak működni.");
        }
        if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
             console.warn("Figyelmeztetés: GOOGLE_CLIENT_EMAIL vagy GOOGLE_PRIVATE_KEY hiányzik. A Google Sheet integráció nem fog működni.");
        }

        console.log("Szerver indítása...");
        app.listen(PORT, () => {
            console.log(`🎉 King AI Backend (TypeScript) sikeresen elindult!`);
            console.log(`A szerver itt fut: http://localhost:${PORT}`);
            console.log("A frontend most már ehhez a címhez tud csatlakozni.");
        });
    } catch (e: any) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack);
        process.exit(1);
    }
}

startServer();