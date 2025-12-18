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

    // --- JAVÍTÁS (v147.5): AZONNALI INDÍTÁS HA SZÜKSÉGES ---
    // Ne várjon pontosan az órára, ha indításkor látszik hogy már kellene futnia
    setTimeout(() => {
        const now = new Date();
        const hour = now.getHours();
        console.log(`[Scheduler] Indítási ellenőrzés (Idő: ${hour} óra)...`);

        if (hour >= 12 && hour < 18) {
            console.log('[Scheduler] Napközbeni időszak, azonnali foci szkennelés...');
            runSniperScan('soccer');
        } else if (hour >= 18 || hour < 4) {
            console.log('[Scheduler] Esti/Éjszakai időszak, csak US Sports (Kosár/Hoki) szkennelés...');
            // Csak kosár és hoki este, a foci már lefutott délben
            runSniperScan('us_sports');
        }
    }, 5000); 
}

