import axios from 'axios';
import dotenv from 'dotenv';

// 1. .env fájl beolvasása, hogy meglegyen az API kulcs
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("HIBA: Nem található GEMINI_API_KEY a .env fájlban!");
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log("Modellek lekérdezése a Google-től az API kulcsoddal...");

async function listMyModels() {
    try {
        const response = await axios.get(url);
        
        if (response.status === 200) {
            const models = response.data.models;
            
            console.log("\n--- ELÉRHETŐ MODELLEK LISTÁJA ---");
            
            // Kilistázzuk azokat a modelleket, amik TÁMOGATJÁK a 'generateContent' (tartalomgenerálás) funkciót
            const supportedModels = models
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name); // Csak a nevük kell

            if (supportedModels.length > 0) {
                console.log("A te API kulcsod a következő modelleket használhatja:");
                supportedModels.forEach(name => console.log(`- ${name}`));
                
                // Automatikus javaslat
                if (supportedModels.includes("models/gemini-1.5-flash-latest")) {
                    console.log("\n>>> JAVASLAT: A 'gemini-1.5-flash-latest' elérhető! Ezt fogjuk használni.");
                } else if (supportedModels.includes("models/gemini-pro")) {
                    console.log("\n>>> JAVASLAT: A 'gemini-pro' (v1.0) elérhető! Ezt fogjuk használni.");
                } else {
                     console.log("\n>>> FIGYELEM: Nem található sem az 1.5-flash, sem a gemini-pro. Kérlek, másold be ezt a listát nekem!");
                }

            } else {
                console.log("Nem található olyan modell, ami támogatná a tartalomgenerálást (generateContent).");
            }

        } else {
            console.error(`Hiba a modellek lekérésekor (Státusz: ${response.status}):`, response.data);
        }
    } catch (error) {
        console.error("Hiba történt az axios hívás során:", error.response ? error.response.data : error.message);
    }
}

listMyModels();