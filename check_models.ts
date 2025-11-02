// check_models.ts (v52.4 - TS2339/TS7006 hibajavítás)
// JAVÍTÁS: TS2339 ('never') és TS7006 (implicit 'any') hibák javítva
// explicit ': any' típus-annotációk és típus-kényszerítés (as any) hozzáadásával.

import axios from 'axios';

// Bemeneti modell nevek (ahogy a Render/API várja)
const MODEL_NAMES = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-pro', // Standard
];

const API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function checkModel(modelName: string): Promise<{ name: string; status: 'OK' | 'ERROR'; details: string }> {
    const url = `${BASE_URL}${modelName}?key=${API_KEY}`;
    try {
        const response = await axios.get(url);
        
        // === JAVÍTÁS (TS2339) ===
        // Az 'response.data' 'unknown'. Típus-szűkítést (cast) végzünk 'any'-re.
        const data: any = response.data;
        // === JAVÍTÁS VÉGE ===

        if (data && data.name) {
            console.log(`✅ MODELL ELÉRHETŐ: ${data.name}`);
            return { name: modelName, status: 'OK', details: `DisplayName: ${data.displayName || 'N/A'}` };
        } else {
            throw new Error('Érvénytelen válasz struktúra.');
        }
    } catch (error: any) { // JAVÍTÁS (TS2339): 'error' típus 'any'-re állítva
        let details = 'Ismeretlen hiba';
        if (error.response) {
            details = `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data?.error?.message || error.response.data)}`;
        } else {
            details = error.message;
        }
        console.error(`❌ MODELL HIBA (${modelName}): ${details}`);
        return { name: modelName, status: 'ERROR', details };
    }
}

async function checkModels() {
    console.log("Gemini Modellek Ellenőrzése Indul...");
    if (!API_KEY) {
        console.error("KRITIKUS HIBA: GEMINI_API_KEY nincs beállítva. Az ellenőrzés leáll.");
        return;
    }

    const results = await Promise.all(MODEL_NAMES.map(checkModel));
    
    console.log("\n--- Eredmények Összegzése ---");
    
    // === JAVÍTÁS (TS7006) ===
    const okModels = results
        .filter((m: any) => m.status === 'OK')
        .map((m: any) => m.name);
    // === JAVÍTÁS VÉGE ===

    const errorModels = results.filter((m: any) => m.status === 'ERROR'); // TS7006 javítva

    if (okModels.length > 0) {
        console.log(`✅ Elérhető modellek (${okModels.length} db): ${okModels.join(', ')}`);
        
        const primaryModel = okModels.includes('gemini-1.5-pro-latest') 
            ? 'gemini-1.5-pro-latest' 
            : okModels[0];
        console.log(`\nJavasolt .env beállítás:\nGEMINI_MODEL_ID=${primaryModel}`);
        
    } else {
        console.warn("⚠️ Egyetlen modell sem érhető el a listából.");
    }

    if (errorModels.length > 0) {
        console.error(`\n❌ Hibás vagy nem elérhető modellek (${errorModels.length} db):`);
        errorModels.forEach(m => {
            console.error(`  - ${m.name}: ${m.details}`);
        });
    }

    // === JAVÍTÁS (TS2339) ===
    const supportedModelsResponse = await axios.get(`${BASE_URL}?key=${API_KEY}`).catch((error: any) => {
        console.error("\nHIBA: Nem sikerült lekérni a teljes modell listát.", error.response?.data?.error?.message || error.message);
        return null;
    });
    
    if (supportedModelsResponse && supportedModelsResponse.data) {
        // === JAVÍTÁS (TS2339 / TS7006) ===
        const data: any = supportedModelsResponse.data; 
        const allModelNames = (data.models || []).map((m: any) => m.name.replace('models/', ''))
            .reduce((acc: any, name: any) => { 
                const baseName = name.split('-')[0];
                if (!acc[baseName]) acc[baseName] = [];
                acc[baseName].push(name);
                return acc;
            }, {});
        // === JAVÍTÁS VÉGE ===
            
        console.log("\n--- Teljes Elérhető Modell Lista (API szerint) ---");
        console.log(JSON.stringify(allModelNames, null, 2));
    }
}

checkModels();