import cron from 'node-cron';
import { runSniperScan } from './AutoScanner.js';

/**
 * Ütemező a szkenner feladatokhoz.
 * v148.0: Foci idősávokra bontva + US Sports este.
 */
export function initScheduler() {
    console.log('[Scheduler] Automata ütemező inicializálva.');

    // --- FOCI IDŐSÁVOK ---
    const soccerSlots = [
        { time: '0 12 * * *', label: '12:00-16:00' },
        { time: '0 16 * * *', label: '16:00-19:00' },
        { time: '0 19 * * *', label: '19:00-23:00' },
        { time: '0 23 * * *', label: '23:00-06:00' },
        { time: '0 6 * * *',  label: '06:00-12:00' }
    ];

    soccerSlots.forEach(slot => {
        cron.schedule(slot.time, () => {
            console.log(`[Scheduler] Foci szkennelés indítása a(z) ${slot.label} sávhoz...`);
            runSniperScan('soccer', slot.label);
        }, { timezone: "Europe/Budapest" });
    });

    // --- US SPORTS (Kosár/Hoki) ---
    // Marad este 6-kor, de a kosárnál már csak pontokat fogunk nézni
    cron.schedule('0 18 * * *', () => {
        console.log('[Scheduler] Esti US Sports (Kosár/Hoki) szkennelés indítása...');
        runSniperScan('us_sports');
    }, { timezone: "Europe/Budapest" });

    // --- JAVÍTÁS (v147.9): IDŐZÓNA-BIZTOS AZONNALI INDÍTÁS ---
    setTimeout(() => {
        const now = new Date();
        const budapestTime = now.toLocaleString("en-US", {timeZone: "Europe/Budapest"});
        const hour = new Date(budapestTime).getHours();
        
        console.log(`[Scheduler] Indítási ellenőrzés (Magyar idő: ${hour} óra)...`);

        // Megkeressük az aktuális sávot focihoz
        let currentSlot = '12:00-16:00';
        if (hour >= 16 && hour < 19) currentSlot = '16:00-19:00';
        else if (hour >= 19 && hour < 23) currentSlot = '19:00-23:00';
        else if (hour >= 23 || hour < 6) currentSlot = '23:00-06:00';
        else if (hour >= 6 && hour < 12) currentSlot = '06:00-12:00';

        console.log(`[Scheduler] Azonnali foci szkennelés a(z) ${currentSlot} idősávra...`);
        runSniperScan('soccer', currentSlot);

        if (hour >= 18 || hour < 4) {
            console.log('[Scheduler] Esti időszak, azonnali US Sports szkennelés...');
            runSniperScan('us_sports');
        }
    }, 5000); 
}

