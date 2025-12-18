import cron from 'node-cron';
import { runSniperScan } from './AutoScanner.js';

/**
 * Ütemező a szkenner feladatokhoz.
 */
export function initScheduler() {
    console.log('[Scheduler] Automata ütemező inicializálva.');

    // 1. Foci szkennelés: Minden nap 12:00-kor
    cron.schedule('0 12 * * *', () => {
        console.log('[Scheduler] Déli foci szkennelés indítása...');
        runSniperScan('soccer');
    }, {
        timezone: "Europe/Budapest"
    });

    // 2. Kosár/Hoki szkennelés: Minden nap 18:00-kor
    cron.schedule('0 18 * * *', () => {
        console.log('[Scheduler] Esti US Sports szkennelés indítása...');
        runSniperScan('us_sports');
    }, {
        timezone: "Europe/Budapest"
    });

    // --- AZONNALI FUTTATÁS TESZTELÉSHEZ (Opcionális) ---
    // Ha a felhasználó azt kérte hogy "ma már küldje is", 
    // megnézzük az órát, és ha már elmúlt dél/este 6, de még nem küldtük, lefuttatjuk.
    
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 12 && hour < 18) {
        console.log('[Scheduler] Már elmúlt dél, indítok egy soron kívüli foci szkennelést...');
        runSniperScan('soccer');
    } else if (hour >= 18) {
        console.log('[Scheduler] Már elmúlt este 6, indítok egy soron kívüli US Sports szkennelést...');
        runSniperScan('us_sports');
        // Ekkor már a focit is érdemes lehet lefuttatni ha aznap még nem ment
        runSniperScan('soccer');
    }
}

