// --- index.ts (v72.2 - TS Import Fix) ---
// MÓDOSÍTÁS:
// 1. JAVÍTÁS: A 'getChatResponse' importálása az AI_Service.js-ből most már named importként történik.

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './config.js';
// Importáljuk a típusosított fő funkciókat
import { runFullAnalysis } from './AnalysisFlow.js';
import { _getFixturesFromEspn, getRostersForMatch } from './DataFetch.js';
import { getHistoryFromSheet, getAnalysisDetailFromSheet, deleteHistoryItemFromSheet } from './sheets.js';
// JAVÍTOTT IMPORT: named import
import { getChatResponse } from './AI_Service.js';
import { updatePowerRatings, runConfidenceCalibration } from './LearningService.js';
import { runSettlementProcess } from './settlementService.js';
import { calculateBettingStats, checkTiltProtection } from './trackingService.js';
import { getBankrollStatus, canPlaceBet } from './bankrollService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();
// --- Middleware Beállítások ---

// === JAVÍTÁS (v60.3): Robusztus "Origin: *" Konfiguráció ===

const corsOptions = {
  // Engedélyezünk BÁRMILYEN forrást (origin-t).
  // A biztonságot a JWT token (protect middleware) kezeli.
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'], // Engedélyezzük a JWT Token fejlécet
  credentials: true
};
// 1. "Preflight" kérések kezelése (OPTIONS)
app.options('*', cors(corsOptions)); 

// 2. A részletes CORS beállítások alkalmazása minden más kérésre (GET, POST)
app.use(cors(corsOptions));
// === JAVÍTÁS VÉGE ===

app.use(express.json()); // JSON body parser

// --- Logoló Middleware ---
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] Kérés érkezett: ${req.method} ${req.originalUrl}`);
    next();
});
// --- API Útvonalak (Routes) ---

// Hitelesítés (Változatlan)
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

// === Diagnosztikai Végpontok (Változatlan) ===
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
app.get('/generatehash', async (req: Request, res: Response) => {
    try {
        const passwordToHash = req.query.password as string;
        if (!passwordToHash) {
            return res.status(400).json({ error: "Hiányzó ?password=... query paraméter." });
        }
        console.log(`Hash generálása a "${passwordToHash}" jelszóhoz...`);
        const salt = await bcrypt.genSalt(10);
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
// --- Védelmi Middleware (Változatlan) ---
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

// --- Védett API Végpontok ---

// === getFixtures (Változatlan) ===
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
// === ÚJ VÉGPONT (6 FŐS BIZOTTSÁG) ===
// A P1-es hiányzó-választó azonnali feltöltéséhez
app.post('/getRosters', protect, async (req: Request, res: Response) => {
    try {
        const { home, away, sport, utcKickoff, leagueName } = req.body;
        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
            return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter a keretek lekéréséhez." });
        }
     
        
        // Meghívjuk az új, könnyített függvényt (amit a DataFetch.ts-ben hoztunk létre)
        const rosters = await getRostersForMatch({
            sport,
            homeTeamName: home,
            awayTeamName: away,
            leagueName: leagueName,
            utcKickoff: utcKickoff
        });
        
        if (!rosters) {
            return res.status(404).json({ error: "A keretek lekérése sikertelen (API hiba)." });
        }
        
        res.status(200).json(rosters);
    } catch (e: any) {
        console.error(`Hiba a /getRosters végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getRosters): ${e.message}` });
    }
});


// === MÓDOSÍTOTT VÉGPONT (v72.1 - BFF ELTÁVOLÍTVA) ===
app.post('/runAnalysis', protect, async (req: Request, res: Response) => {
    try {
        // Típusosítjuk a bejövő manuális hiányzó mezőt, 
        // hogy megfeleljen a DataFetchOptions-ben definiált IPlayerStub[] szerkezetnek
        interface ManualAbsentees { 
            home: { name: string, pos: string }[]; 
            away: { name: string, pos: string }[]; 
        }
        
        const { 
            home, 
            away, 
            force, 
            sheetUrl, 
            utcKickoff, 
            leagueName, 
            sport, 
            openingOdds = {},
            // P1 Komponens (v61.0)
            manual_H_xG,
            manual_H_xGA,
            manual_A_xG, 
            manual_A_xGA,
            // === ÚJ v144.0: PPG (Points Per Game) paraméterek ===
            manual_H_PPG,
            manual_A_PPG,
    
            // === MÓDOSÍTÁS (v72.0): Helyes típus fogadása ===
            manual_absentees // Típus: ManualAbsentees | null
        } = req.body;

        if (!home || !away || !sport || !utcKickoff || !leagueName) { 
             return res.status(400).json({ error: "Hiányzó 'sport', 'home', 'away', 'utcKickoff' vagy 'leagueName' paraméter." });
        }
        
      
        const params = { 
            home, 
            away, 
            force, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            manual_H_xG,
            manual_H_xGA,
            manual_A_xG,
            manual_A_xGA,
            // === ÚJ v144.0: PPG paraméterek ===
            manual_H_PPG,
            manual_A_PPG,
            manual_absentees: manual_absentees as ManualAbsentees | null // Típus kényszerítése
        };
        
        // 1. LÉPÉS: Az elemzés lefuttatása (ez a JÓ, RÉGI struktúrát adja vissza)
        const result: any = await runFullAnalysis(params, sport, openingOdds);
        
        if ('error' in result) {
            console.error(`Elemzési hiba (AnalysisFlow): ${result.error}`);
            return res.status(500).json({ error: result.error });
        }
        
        // 2. LÉPÉS (JAVÍTVA): A felesleges BFF transzformáció eltávolítva.
        
        // 3. LÉPÉS (JAVÍTVA): Közvetlenül visszaküldjük a 'runFullAnalysis'
        // helyes eredményét, amit a frontend (script.js) elvár.
        res.status(200).json(result);
        
    } catch (e: any) {
        console.error(`Hiba a /runAnalysis végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (runAnalysis): ${e.message}` });
    }
});

// === getHistory (Változatlan) ===
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
// === getAnalysisDetail (MÓDOSÍTVA v63.3) ===
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
// === deleteHistoryItem (Változatlan) ===
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
// === askChat (Változatlan) ===
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
// --- Admin végpontok (Változatlan) ---
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

// === v140.3: TRACKING & BANKROLL ENDPOINTS ===
app.get('/getBettingStats', protect, async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const stats = await calculateBettingStats(days);
        res.status(200).json(stats);
    } catch (e: any) {
        console.error(`Hiba a /getBettingStats végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getBettingStats): ${e.message}` });
    }
});

app.get('/getTiltStatus', protect, async (req: Request, res: Response) => {
    try {
        const maxLosses = parseInt(req.query.maxLosses as string) || 5;
        const tiltStatus = await checkTiltProtection(maxLosses);
        res.status(200).json(tiltStatus);
    } catch (e: any) {
        console.error(`Hiba a /getTiltStatus végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getTiltStatus): ${e.message}` });
    }
});

app.get('/getBankrollStatus', protect, async (req: Request, res: Response) => {
    try {
        const config = req.body.config || undefined; // Opcionális config
        const bankrollStatus = await getBankrollStatus(config);
        res.status(200).json(bankrollStatus);
    } catch (e: any) {
        console.error(`Hiba a /getBankrollStatus végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (getBankrollStatus): ${e.message}` });
    }
});

app.get('/canPlaceBet', protect, async (req: Request, res: Response) => {
    try {
        const config = req.body.config || undefined; // Opcionális config
        const canBet = await canPlaceBet(config);
        res.status(200).json(canBet);
    } catch (e: any) {
        console.error(`Hiba a /canPlaceBet végpont-on: ${e.message}`, e.stack);
        res.status(500).json({ error: `Szerver hiba (canPlaceBet): ${e.message}` });
    }
});
// === VÉGE v140.3 ===

// --- Szerver Indítása (Változatlan) ---
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
            console.log(`A szerver itt fut: http://localhost:${PORT}`);
        });
    } catch (e: any) {
        console.error("KRITIKUS HIBA a szerver indítása során:", e.message, e.stack);
        process.exit(1);
    }
}

startServer();
