// --- index.ts (v54.3 - SSOT Refaktor) ---
// MÓDOSÍTÁS: A /runAnalysis végpont (Source 701) most már fogadja és
// továbbítja a natív API-Football ID-kat (Source 2540-2544) az AnalysisFlow-nak.

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
// JAVÍTÁS: A 'bcrypt.js'-t importáljuk, ahogy a 38. lépésben javítottuk
import bcrypt from 'bcryptjs';
import path from 'path'; 
import { fileURLToPath } from 'url'; 
import { PORT } from './config.js';
// Importáljuk a típusosított fő funkciókat
import { runFullAnalysis } from './AnalysisFlow.js';
import { _getFixturesFromEspn } from './DataFetch.js'; // Ez már az apiSportsProvider.getFixturesFromApiSports-ra mutat (Source 2439)
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
import { getChatResponse } from './AI_Service.js';
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
import { runSettlementProcess } from './settlementService.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

// --- Middleware Beállítások ---
app.use(cors());
app.use(express.json());
// JSON body parser

// === Statikus Fájl Kiszolgálás Eltávolítva (v52.6) ===
// const publicPath = path.join(__dirname, 'public'); // ELTÁVOLÍTVA
// app.use(express.static(publicPath));
// ELTÁVOLÍTVA

// --- Logoló Middleware ---
app.use((req: Request, res: Response, next: NextFunction) => {
    // Most már minden kérést logolunk, mivel nincs statikus fájl
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});
// --- API Útvonalak (Routes) ---

// app.get('/', (req: Request, res: Response) => { ... });
// ELTÁVOLÍTVA (ENOENT hiba okozója)

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
            process.env.JWT_SECRET as string, 
            { expiresIn: '24h' }
       
         );
        res.status(200).json({ token: token });
    } catch (e: any) {
        console.error(`Hiba a /login végpont-on: ${e.message}`);
        res.status(500).json({ error: "Szerver hiba (login)." });
    }
});

// === DIAGNOSZTIKAI VÉGPONT (A 35. LÉPÉSBŐL) ===
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
            return res.status(200).json({
                message: "Diagnosztika: A szerver által látott HASH.",
                server_hash_value: serverHash,
                hash_is_correct_format: serverHash === "$2b$10$3g0.iG/3E.ZB50wK.1MvXOvjZJULfWJ07J75WlD6cEdMUH/h3aLwe"
      
           });
        }
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
// === ÚJ HASH GENERÁTOR VÉGPONT (A 39. LÉPÉSBŐL) ===
app.get('/generatehash', async (req: Request, res: Response) => {
    try {
        const passwordToHash = req.query.password as string;
        if (!passwordToHash) {
            return res.status(400).json({ error: "Hiányzó ?password=... query paraméter." });
        }
        
        console.log(`Hash generálása a "${passwordToHash}" jelszóhoz...`);
        const 
salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(passwordToHash, salt);
        
        console.log(`Új hash generálva: ${newHash}`);
        
        res.status(200).json({
            message: "Új hash sikeresen generálva.",
            password_provided: passwordToHash,
            NEW_HASH_VALUE: newHash
       
         });

    } catch (e: any) {
        res.status(500).json({ error: `Hash generálási hiba: ${e.message}` });
    }
});
// === HASH GENERÁTOR VÉGE ===

// Védelmi Middleware
const protect = (req: Request, res: Response, next: NextFunction) => {
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
        // Az _getFixturesFromEspn most már az apiSportsProvider.getFixturesFromApiSports-ra mutat (Source 2439)
        const fixtures 
 = await _getFixturesFromEspn(sport, days);
        res.status(200).json({
            fixtures: fixtures,
            odds: {} // Az Odds-ok lekérése a /getFixtures-ből elavult
        });
    } catch (e: any) {
        console.error(`Hiba a /getFixtures végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getFixtures): ${e.message}` });
    }
});

// === JAVÍTÁS (v54.3) ===
app.post('/runAnalysis', protect, async (req: Request, res: Response) => {
    try {
        // Kinyerjük az alapvető adatokat ÉS az új SSOT ID-kat
        const { 
            home, away, force, sheetUrl, utcKickoff, leagueName, sport, openingOdds = {},
            // Új SSOT ID-k (opcionálisak, a 'manuális elemzés' miatt)
            apiFootballLeagueId,
            apiFootballHomeId,
            apiFootballAwayId,
            apiFootballFixtureId 
        } = req.body;
        
        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter." });
        }
        
        // Összeállítjuk a 'params' objektumot, amit az AnalysisFlow vár
        const params = { 
            home, 
            away, 
            force, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            // Hozzáadjuk az új ID-kat
            apiFootballLeagueId,
            apiFootballHomeId,
            apiFootballAwayId,
            apiFootballFixtureId
        };
        
        // A 'sport' és 'openingOdds' külön paraméterként marad
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
// === JAVÍTÁS VÉGE ===

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

        console.log("Öntanulási folyamat 
(2. Lépés: Kalibráció és Rating frissítés) indul...");
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
        });
    } catch (e: any) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack);
        process.exit(1);
    }
}

startServer();
