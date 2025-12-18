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

    // --- JAVÍTÁS (v147.9): IDŐZÓNA-BIZTOS AZONNALI INDÍTÁS ---
    setTimeout(() => {
        const now = new Date();
        // Magyar idő szerinti óra lekérése (Renderen is!)
        const budapestTime = now.toLocaleString("en-US", {timeZone: "Europe/Budapest"});
        const hour = new Date(budapestTime).getHours();
        
        console.log(`[Scheduler] Indítási ellenőrzés (Magyar idő: ${hour} óra)...`);

        if (hour >= 12 && hour < 18) {
            console.log('[Scheduler] Napközbeni időszak (12-18), azonnali foci szkennelés...');
            runSniperScan('soccer');
        } else {
            console.log('[Scheduler] Esti/Éjszakai időszak, csak US Sports (Kosár/Hoki) szkennelés...');
            runSniperScan('us_sports');
        }
    }, 5000); 
}

