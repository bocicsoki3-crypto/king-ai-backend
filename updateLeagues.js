// updateLeagues.js

import { fetchAndSaveLeagues } from './DataFetch.js';

async function run() {
    console.log("Indul a TheSportsDB liga adatbázis frissítése...");
    await fetchAndSaveLeagues();
    console.log("A frissítési folyamat befejeződött. A program 5 másodperc múlva kilép.");
    setTimeout(() => process.exit(0), 5000);
}

run();