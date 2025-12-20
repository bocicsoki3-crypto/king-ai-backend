// Manuális kosárlabda szkennelés indítása
import dotenv from 'dotenv';
dotenv.config(); // Környezeti változók betöltése

import { runSniperScan } from './AutoScanner.js';

console.log('🏀 Kosárlabda elemzés indítása...');
runSniperScan('basketball')
    .then(() => {
        console.log('✅ Kosárlabda elemzés befejezve!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Hiba a kosárlabda elemzés során:', error);
        process.exit(1);
    });

