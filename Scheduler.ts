import cron from 'node-cron';
import { runSniperScan } from './AutoScanner.js';

/**
 * Ütemező a szkenner feladatokhoz.
 * v148.4: Fixed timeSlot scope issue in AutoScanner.
 * Sequential startup fix (await-tel sorba fűzve).
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

    // === v149.6: KOSÁRLABDA AZONNALI INDÍTÁS ===
    // Kosárlabda szkennelés azonnal elindítva (hajnali meccsekhez)
    console.log('[Scheduler] 🏀 Kosárlabda szkennelés azonnali indítása...');
    runSniperScan('basketball').catch((error) => {
        console.error('[Scheduler] Hiba a kosárlabda szkennelés során:', error);
    });
    
    console.log('[Scheduler] Ütemezett szkennelések beállítva. Foci: 12:00, 16:00, 19:00, 23:00, 06:00 | Jégkorong: 20:30 | Kosárlabda: 21:30'); 
}

