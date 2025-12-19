import cron from 'node-cron';
import { runSniperScan } from './AutoScanner.js';

/**
 * Ütemező a szkenner feladatokhoz.
 * v148.2: Sequential startup fix (await-tel sorba fűzve).
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

    // --- US SPORTS (Hoki 20:30, Kosár 21:30) ---
    // Jégkorong: 20:30
    cron.schedule('30 20 * * *', () => {
        console.log('[Scheduler] Esti Jégkorong szkennelés indítása...');
        runSniperScan('hockey');
    }, { timezone: "Europe/Budapest" });

    // Kosárlabda: 21:30
    cron.schedule('30 21 * * *', () => {
        console.log('[Scheduler] Esti Kosárlabda szkennelés indítása...');
        runSniperScan('basketball');
    }, { timezone: "Europe/Budapest" });

    // --- JAVÍTÁS (v148.2): IDŐZÓNA-BIZTOS AZONNALI INDÍTÁS SORBAN ---
    setTimeout(async () => {
        const now = new Date();
        const budapestTime = now.toLocaleString("en-US", {timeZone: "Europe/Budapest"});
        const hour = new Date(budapestTime).getHours();
        const minute = new Date(budapestTime).getMinutes();
        const currentTimeInMinutes = (hour * 60) + minute;
        
        console.log(`[Scheduler] Indítási ellenőrzés (Magyar idő: ${hour}:${minute})...`);

        // Megkeressük az aktuális sávot focihoz
        let currentSlot = '12:00-16:00';
        if (hour >= 16 && hour < 19) currentSlot = '16:00-19:00';
        else if (hour >= 19 && hour < 23) currentSlot = '19:00-23:00';
        else if (hour >= 23 || hour < 6) currentSlot = '23:00-06:00';
        else if (hour >= 6 && hour < 12) currentSlot = '06:00-12:00';

        console.log(`[Scheduler] Azonnali foci szkennelés a(z) ${currentSlot} idősávra...`);
        await runSniperScan('soccer', currentSlot);

        // US Sports azonnali indítás ellenőrzése (Sorbafűzve await-tel)
        if (currentTimeInMinutes >= (20 * 60 + 30)) {
            console.log('[Scheduler] 20:30 elmúlt, azonnali hoki szkennelés...');
            await runSniperScan('hockey');
        }
        if (currentTimeInMinutes >= (21 * 60 + 30)) {
            console.log('[Scheduler] 21:30 elmúlt, azonnali kosárlabda szkennelés...');
            await runSniperScan('basketball');
        }
    }, 5000); 
}

