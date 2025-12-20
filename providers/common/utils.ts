// FÁJL: providers/common/utils.ts
// VERZIÓ: v110.1 (MERGED: Original Logic + AI Search)
// MÓDOSÍTÁS:
// 1. VISSZATÉRT: Az eredeti ESPN meccslekérő (_getFixturesFromEspn) teljes kódja.
// 2. VISSZATÉRT: Az eredeti Időjárás lekérő (getStructuredWeatherData) teljes kódja.
// 3. VISSZATÉRT: Az eredeti Totals kereső (findMainTotalsLine).
// 4. ÚJ: A '_callGemini' most már támogatja a 'useSearch' paramétert (Google Grounding).

import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import {
    GEMINI_API_KEY, GEMINI_MODEL_ID,
    SPORT_CONFIG, API_HOSTS
} from '../../config.js';
import type { 
    ICanonicalOdds, 
    ICanonicalStats,
    IStructuredWeather
} from '../../src/types/canonical.d.ts';

// --- ÁLTALÁNOS API HÍVÓ ---
export async function makeRequest(url: string, config: AxiosRequestConfig = {}, retries: number = 1): Promise<any> {
    let attempts = 0;
    const method = config.method?.toUpperCase() || 'GET';
    
    while (attempts <= retries) {
        try {
            const baseConfig: AxiosRequestConfig = {
                timeout: 25000,
                validateStatus: (status: number) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig: AxiosRequestConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };
            
            let response: AxiosResponse<any>;
            if (method === 'POST') {
                response = await axios.post(url, currentConfig.data || {}, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }

            if (response.status < 200 || response.status >= 300) {
                const error: any = new Error(`API hiba: Státusz kód ${response.status} (${method} ${url.substring(0, 100)}...)`);
                error.response = response;
                throw error;
            }
            return response;
        } catch (error: any) {
            attempts++;
            let errorMessage = `API (${method}) hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;
            
            if (error.response) {
                errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                if (error.response.status === 429) {
                    const quotaError: any = new Error(errorMessage);
                    quotaError.response = error.response;
                    quotaError.isQuotaError = true;
                    throw quotaError; 
                }
            } else if (error.request) {
                errorMessage += `Timeout (${config.timeout || 25000}ms) vagy nincs válasz.`;
            } else {
                errorMessage += `Beállítási hiba: ${error.message}`;
            }
            
            if (attempts > retries) {
                console.error(`API (${method}) hívás végleg sikertelen: ${errorMessage}`);
                throw new Error(`API hívás végleg sikertelen: ${error.message}`);
            }
            console.warn(errorMessage);
            await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
        }
    }
    throw new Error("API hívás váratlanul befejeződött.");
}

// --- GEMINI API HÍVÓK (GROUNDING TÁMOGATÁSSAL - v110.0) ---

export async function _callGemini(
    prompt: string, 
    forceJson: boolean = true,
    useSearch: boolean = false, // === ÚJ PARAMÉTER ===
    jsonSchema?: any // === v148.9: JSON Schema opcionális paraméter ===
): Promise<string> {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { 
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    
    // v147.2: Biztonságosabb modell névválasztás
    const targetModel = useSearch ? 'gemini-2.0-flash-exp' : (GEMINI_MODEL_ID || 'gemini-1.5-flash');

    let finalPrompt = prompt;
    if (forceJson) {
        finalPrompt = `${prompt}\n\n🚨 CRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any Markdown formatting (like \`\`\`json), text, explanation, or introductory phrases. Start with { and end with }. Every string must be in double quotes. Every number must be a valid number (no quotes around numbers).`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${GEMINI_API_KEY}`;
    
    const generationConfig: any = { 
        temperature: useSearch ? 0.1 : 0.2,
        maxOutputTokens: 16384, // v137.0: 8192 → 16384 (2x NÖVELÉS! Flash model-nek kell!)
    };
    
    // === v148.9: JSON Schema támogatás ===
    if (forceJson && !useSearch) {
        generationConfig.responseMimeType = "application/json";
        if (jsonSchema) {
            generationConfig.responseSchema = jsonSchema;
            console.log(`[Gemini] JSON Schema aktiválva a válasz struktúrához.`);
        }
    }
    
    const payload: any = { 
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }], 
        generationConfig,
    };

    // === ÚJ: GOOGLE SEARCH TOOL HOZZÁADÁSA ===
    if (useSearch) {
        payload.tools = [{ google_search: {} }];
        console.log(`[Gemini] Google Search Grounding AKTIVÁLVA.`);
    }
    // ==========================================
    
    console.log(`Gemini API hívás indul (${targetModel})... (Search: ${useSearch})`);
    
    try {
        const response: AxiosResponse<any> = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }, 
            timeout: 120000, 
            validateStatus: () => true 
        });
        
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---', JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini API hiba: Státusz ${response.status}`);
        }
        
        const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            const finishReason = candidate?.finishReason || 'Ismeretlen';
            console.warn('--- GEMINI BLOCK RESPONSE ---', JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }
        
        // === v148.9: ROBUSZT JSON TISZTÍTÁS ===
        let cleanText = responseText;
        if (forceJson) {
            // 1. Markdown blokkok eltávolítása
            cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            // 2. Eltávolítjuk a leading/trailing szöveget, ha van
            // Keresünk egy JSON objektumot a szövegben
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanText = jsonMatch[0];
            }
            
            // 3. === FIX v134.1: POZITÍV SZÁMOK ELŐTTI + JEL ELTÁVOLÍTÁSA ===
            cleanText = cleanText.replace(/:\s*\+(\d)/g, ': $1');
            
            // 4. Trailing comma-k eltávolítása (objektumok és tömbök végén)
            cleanText = cleanText.replace(/,(\s*[}\]])/g, '$1');
            
            // 5. Érvénytelen escape karakterek javítása
            cleanText = cleanText.replace(/\\'/g, "'");
            cleanText = cleanText.replace(/\\"/g, '"');
            
            // 6. Újra trim
            cleanText = cleanText.trim();
            
            console.log(`[Gemini JSON Clean] Tisztítás befejezve. Hossz: ${cleanText.length} karakter.`);
            
            // 7. Gyors ellenőrzés
            try {
                JSON.parse(cleanText);
            } catch (e: any) {
                console.error(`[Gemini JSON Clean] JSON parse hiba: ${e.message}`);
                console.error(`[Gemini JSON Clean] Előnézet (első 200 karakter): ${cleanText.substring(0, 200)}...`);
                throw new Error(`Gemini JSON parse hiba: ${e.message}`);
            }
        }
        
        return cleanText;
    } catch (e: any) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`);
        throw e;
    }
}

// Továbbítja a useSearch paramétert és JSON Schema-t
export async function _callGeminiWithJsonRetry(
    prompt: string, 
    stepName: string, 
    maxRetries: number = 2,
    useSearch: boolean = false, // === ÚJ PARAMÉTER ===
    jsonSchema?: any // === v148.9: JSON Schema opcionális paraméter ===
): Promise<any> {
    
    let attempts = 0;
    while (attempts <= maxRetries) {
        attempts++;
        try {
            const jsonString = await _callGemini(prompt, true, useSearch, jsonSchema);
            const result = JSON.parse(jsonString);
            return result;
        } catch (e: any) {
            if (e instanceof SyntaxError || e.message.includes("parse")) {
                console.warn(`[AI_Service] JSON hiba (${stepName}), ${attempts}. próba.`);
                if (attempts > maxRetries) throw e;
                await new Promise(resolve => setTimeout(resolve, 1500));
            } else {
                throw e;
            }
        }
    }
}

export function fillPromptTemplate(template: string, data: any): string {
    if (!template || typeof template !== 'string') return '';
    try {
        return template.replace(/\{([\w_.]+)\}/g, (match, key) => {
            let value: any = data;
            if (key.includes('.')) {
                for (const k of key.split('.')) value = value?.[k];
            } else {
                value = data?.[key];
            }
            if (value === null || value === undefined) return "N/A";
            if (typeof value === 'object') return JSON.stringify(value);
            return String(value);
        });
    } catch(e) { return template; }
}

// --- SPORT ADAT SEGÉDFÜGGVÉNYEK (VISSZAÁLLÍTVA AZ EREDETI) ---

/**
 * ESPN Meccslekérdező
 */
export async function _getFixturesFromEspn(sport: string, days: string): Promise<any[]> {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues) return [];
    
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) return [];
    
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    
    const allFixtures: any[] = [];
    const leagueCount = Object.keys(sportConfig.espn_leagues).length;
    console.log(`ESPN: Kötegelt lekérés indul: ${daysInt} nap, ${leagueCount} liga...`);
    
    const allUrlsToFetch: { url: string; leagueName: string; slug: string }[] = [];
    
    for (const dateString of datesToFetch) {
        for (const [leagueName, leagueData] of Object.entries(sportConfig.espn_leagues)) {
            const slug = leagueData.slug;
            if (!slug) {
                console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`);
                continue;
            }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            allUrlsToFetch.push({ url, leagueName, slug });
        }
    }

    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 500;

    console.log(`ESPN: Összesen ${allUrlsToFetch.length} kérés indítása ${BATCH_SIZE}-ös kötegekben...`);
    
    for (let i = 0; i < allUrlsToFetch.length; i += BATCH_SIZE) {
        const batchUrls = allUrlsToFetch.slice(i, i + BATCH_SIZE);
        console.log(`ESPN: Köteg futtatása (${i + 1}-${i + batchUrls.length} / ${allUrlsToFetch.length})...`);
        
        const promises = batchUrls.map(req => 
            makeRequest(req.url, { timeout: 8000 })
                .then(response => {
                    if (!response?.data?.events) return [];
                    return response.data.events
                         .filter((event: any) => event?.status?.type?.state?.toLowerCase() !== 'post')
                        .map((event: any) => {
                            const competition = event.competitions?.[0];
                            if (!competition) return null;
                            
                            const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home')?.team;
                            const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away')?.team;
                           
                             if (event.id && homeTeam?.name && awayTeam?.name && event.date) {
                                return {
                                    id: String(event.id),
                                    home: homeTeam.name.trim(),
                                    away: awayTeam.name.trim(),
                                    utcKickoff: event.date,
                                    league: req.leagueName.trim(),
                                    uniqueId: `${sport}_${homeTeam.name.toLowerCase().replace(/\s+/g, '')}_${awayTeam.name.toLowerCase().replace(/\s+/g, '')}`
                                };
                            }
                            return null;
                        }).filter(Boolean);
                })
                .catch((error: any) => {
                    if (error.response?.status === 400) {
                        console.warn(`ESPN Hiba (400): Valószínűleg rossz slug '${req.slug}' (${req.leagueName})?`);
                    } else {
                        console.error(`ESPN Hiba (${req.leagueName}): ${error.message}`);
                    }
                    return [];
                 })
        );
        
        const batchResults = await Promise.all(promises);
        allFixtures.push(...batchResults.flat());
        
        if (i + BATCH_SIZE < allUrlsToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }

    try {
        const uniqueFixtures = Array.from(new Map(allFixtures.map(f => [`${f.home}-${f.away}-${f.utcKickoff}`, f])).values());
        uniqueFixtures.sort((a, b) => new Date(a.utcKickoff).getTime() - new Date(b.utcKickoff).getTime());
        console.log(`ESPN: ${uniqueFixtures.length} egyedi meccs lekérve (kötegelve) a következő ${daysInt} napra.`);
        return uniqueFixtures;
    } catch (e: any) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return [];
    }
}

// === JAVÍTVA (v105.1): findMainTotalsLine (VISSZAÁLLÍTVA AZ EREDETI) ===
export function findMainTotalsLine(oddsData: ICanonicalOdds | null, sport: string): number {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line || (sport === 'soccer' ? 2.5 : (sport === 'hockey' ? 6.5 : 220.5));
    
    if (!oddsData?.allMarkets || oddsData.allMarkets.length === 0) {
        console.warn(`[utils.ts/findMainTotalsLine] Nincs 'allMarkets' tömb. Alapértelmezett vonal (${defaultConfigLine}) használata.`);
        return defaultConfigLine;
    }

    const totalsMarket = oddsData.allMarkets.find(m => m.key === 'totals');

    if (!totalsMarket || !totalsMarket.outcomes || totalsMarket.outcomes.length === 0) {
        console.warn(`[utils.ts/findMainTotalsLine] Nem található kanonikus 'totals' piac az 'allMarkets'-ben. Alapértelmezett vonal (${defaultConfigLine}) használata.`);
        return defaultConfigLine;
    }

    const linesAvailable: { [key: string]: { over?: number, under?: number } } = {};
    
    for (const outcome of totalsMarket.outcomes) {
        const line = outcome.point;
        
        if (line === null || line === undefined || isNaN(Number(line))) {
            const lineMatch = outcome.name.match(/(\d+\.\d+)/);
            const guessedLine = lineMatch ? lineMatch[1] : null;
            
            if (!guessedLine) continue;
            
            const lineKey = String(guessedLine);
            if (!linesAvailable[lineKey]) linesAvailable[lineKey] = {};
            if (outcome.name.toLowerCase().startsWith("over")) {
                linesAvailable[lineKey].over = outcome.price;
            } else if (outcome.name.toLowerCase().startsWith("under")) {
                linesAvailable[lineKey].under = outcome.price;
            }
        } else {
            const lineKey = String(line);
            if (!linesAvailable[lineKey]) linesAvailable[lineKey] = {};
            if (outcome.name.toLowerCase().startsWith("over")) {
                linesAvailable[lineKey].over = outcome.price;
            } else if (outcome.name.toLowerCase().startsWith("under")) {
                linesAvailable[lineKey].under = outcome.price;
            }
        }
    }

    if (Object.keys(linesAvailable).length === 0) {
        return defaultConfigLine;
    }

    let closestPair = { diff: Infinity, line: defaultConfigLine };
    
    for (const lineKey in linesAvailable) {
        const pair = linesAvailable[lineKey];
        if (pair.over && pair.under) {
            const diff = Math.abs(pair.over - pair.under);
            if (diff < closestPair.diff) {
                closestPair = { diff, line: parseFloat(lineKey) };
            }
        }
    }

    if (closestPair.diff < 0.5) {
        console.log(`[utils.ts/findMainTotalsLine] Valódi fővonal azonosítva: ${closestPair.line}`);
        return closestPair.line;
    }

    const numericDefaultLine = defaultConfigLine;
    const numericLines = Object.keys(linesAvailable).map(parseFloat);
    
    numericLines.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    
    const fallbackLine = numericLines[0];
    return fallbackLine;
}


// --- IDŐJÁRÁS (VISSZAÁLLÍTVA AZ EREDETI) ---
const geocodingCache = new Map<string, { latitude: number; longitude: number }>();

interface IGeocodingResponse {
    results?: Array<{
        latitude: number;
        longitude: number;
        country_code: string;
    }>;
}
interface IWeatherArchiveResponse {
    hourly: {
        time: string[];
        precipitation: number[];
        wind_speed_10m: number[];
        temperature_2m: number[];
    };
    hourly_units: {
        precipitation: string;
        wind_speed_10m: string;
        temperature_2m: string;
    };
}
async function getCoordinatesForCity(city: string): Promise<{ latitude: number; longitude: number } | null> {
    const normalizedCity = city.toLowerCase().trim();
    if (geocodingCache.has(normalizedCity)) {
        return geocodingCache.get(normalizedCity)!;
    }

    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalizedCity)}&count=1&language=en&format=json`;
        // @ts-ignore
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            console.error(`[utils.ts/Geocoding] API Hiba (${normalizedCity}): ${response.status} ${response.statusText}`);
            return null;
        }

        const data = (await response.json()) as IGeocodingResponse;
        if (data.results && data.results.length > 0) {
            const { latitude, longitude } = data.results[0];
            const result = { latitude, longitude };
            geocodingCache.set(normalizedCity, result);
            return result;
        } else {
            console.warn(`[utils.ts/Geocoding] Nincs találat erre: ${normalizedCity}`);
            return null;
        }
    } catch (error: any) {
        console.error(`[utils.ts/Geocoding] Kritikus hiba (${normalizedCity}): ${error.message}`);
        return null;
    }
}
export async function getStructuredWeatherData(
    stadiumLocation: string | null, 
    utcKickoff: string | null
): Promise<IStructuredWeather> {
    const fallbackWeather: IStructuredWeather = {
        description: "N/A (Hiányzó adat)",
        temperature_celsius: null,
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
    
    if (!stadiumLocation || !utcKickoff || stadiumLocation === "N/A") {
        console.warn(`[utils.ts/Weather] Hiányzó város vagy dátum az időjárás lekéréséhez.`);
        return fallbackWeather;
    }

    const coordinates = await getCoordinatesForCity(stadiumLocation);
    if (!coordinates) {
        console.warn(`[utils.ts/Weather] Nem sikerült geokódolni: ${stadiumLocation}`);
        return fallbackWeather;
    }

    let matchDate: Date;
    let matchHour: number;
    
    try {
        matchDate = new Date(utcKickoff);
        matchHour = matchDate.getUTCHours();
    } catch (e: any) {
        console.error(`[utils.ts/Weather] Érvénytelen dátum formátum: ${utcKickoff}`);
        return fallbackWeather;
    }
    
    const simpleDate = matchDate.toISOString().split('T')[0];
    
    try {
        const { latitude, longitude } = coordinates;
        const weatherUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&start_date=${simpleDate}&end_date=${simpleDate}&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=UTC`;
        
        // @ts-ignore
        const response = await fetch(weatherUrl, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            console.error(`[utils.ts/Weather] API Hiba (${stadiumLocation} @ ${simpleDate}): ${response.status} ${response.statusText}`);
            return fallbackWeather;
        }

        const data = (await response.json()) as IWeatherArchiveResponse;
        
        if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) {
            console.warn(`[utils.ts/Weather] Az API nem adott vissza óránkénti adatot.`);
            return fallbackWeather;
        }

        const hourIndex = data.hourly.time.findIndex(timeISO => {
            return new Date(timeISO).getUTCHours() === matchHour;
        });
        
        if (hourIndex === -1) {
            console.warn(`[utils.ts/Weather] Nem található a meccs órája (${matchHour}:00 UTC) az API válaszban. Fallback: N/A.`);
            return fallbackWeather;
        }
        
        const temp = data.hourly.temperature_2m[hourIndex];
        const precip = data.hourly.precipitation[hourIndex];
        const wind = data.hourly.wind_speed_10m[hourIndex];

        console.log(`[utils.ts/Weather] Időjárás adat sikeresen lekérve (${stadiumLocation}): Temp: ${temp}°C, Csapadék: ${precip}mm, Szél: ${wind}km/h`);
        
        return {
            temperature_celsius: temp,
            precipitation_mm: precip,
            wind_speed_kmh: wind,
            description: `Valós adat: ${temp}°C, ${precip}mm eső, ${wind}km/h szél.`,
            source: 'Open-Meteo'
        };
    } catch (error: any) {
        console.error(`[utils.ts/Weather] Kritikus hiba az időjárás feldolgozásakor (${stadiumLocation}): ${error.message}`);
        return fallbackWeather;
    }
}

// === v140.0: TIPP FORMÁZÓ FÜGGVÉNYEK (EGYSÉGES FORMÁTUM) ===

/**
 * Standardizálja a tippformátumokat minden sportágnál
 * @param market - A tipp piac neve (pl. "1X2 - Hazai győzelem", "Over 2.5")
 * @param sport - Sport típus ('soccer', 'basketball', 'hockey')
 * @returns Egységes formátumú tipp név
 */
export function formatBettingMarket(market: string, sport: string = 'soccer'): string {
    if (!market) return market;
    
    const marketLower = market.toLowerCase().trim();
    
    // 1X2 tippek standardizálása
    if (marketLower.includes('hazai') || marketLower.includes('home') || marketLower === '1') {
        return '1X2 - Hazai győzelem';
    }
    if (marketLower.includes('vendég') || marketLower.includes('away') || marketLower === '2') {
        return '1X2 - Vendég győzelem';
    }
    if (marketLower.includes('döntetlen') || marketLower.includes('draw') || marketLower === 'x') {
        return '1X2 - Döntetlen';
    }
    
    // Over/Under tippek - megtartjuk az eredeti formátumot, de normalizáljuk
    if (marketLower.startsWith('over')) {
        const lineMatch = market.match(/(\d+\.?\d*)/);
        const line = lineMatch ? lineMatch[1] : (sport === 'soccer' ? '2.5' : sport === 'hockey' ? '6.5' : '220.5');
        return `Over ${line}`;
    }
    if (marketLower.startsWith('under')) {
        const lineMatch = market.match(/(\d+\.?\d*)/);
        const line = lineMatch ? lineMatch[1] : (sport === 'soccer' ? '2.5' : sport === 'hockey' ? '6.5' : '220.5');
        return `Under ${line}`;
    }
    
    // BTTS tippek
    if (marketLower.includes('btts')) {
        if (marketLower.includes('igen') || marketLower.includes('yes')) {
            return 'BTTS - Igen';
        }
        if (marketLower.includes('nem') || marketLower.includes('no')) {
            return 'BTTS - Nem';
        }
    }
    
    // Team Totals - megtartjuk az eredeti formátumot
    if (marketLower.includes('over') || marketLower.includes('under')) {
        return market; // Pl. "Arsenal Over 1.5" marad
    }
    
    // Egyéb esetekben megtartjuk az eredeti formátumot
    return market;
}

/**
 * Normalizálja az AI által generált tippeket az egységes formátumra
 * @param recommendation - Az AI által generált tipp
 * @param sport - Sport típus
 * @returns Normalizált tipp név
 */
export function normalizeBettingRecommendation(recommendation: string, sport: string = 'soccer'): string {
    if (!recommendation) return recommendation;
    
    // Először próbáljuk meg a formatBettingMarket-tel
    let normalized = formatBettingMarket(recommendation, sport);
    
    // Ha nem változott, akkor további normalizálás
    if (normalized === recommendation) {
        const recLower = recommendation.toLowerCase().trim();
        
        // További pattern matching
        if (recLower.match(/^(home|hazai|1)(\s+win|\s+győzelem)?$/i)) {
            return '1X2 - Hazai győzelem';
        }
        if (recLower.match(/^(away|vendég|2)(\s+win|\s+győzelem)?$/i)) {
            return '1X2 - Vendég győzelem';
        }
        if (recLower.match(/^(draw|döntetlen|x)$/i)) {
            return '1X2 - Döntetlen';
        }
        
        // Moneyline formátumok
        if (recLower.includes('moneyline') && recLower.includes('home')) {
            return '1X2 - Hazai győzelem';
        }
        if (recLower.includes('moneyline') && recLower.includes('away')) {
            return '1X2 - Vendég győzelem';
        }
    }
    
    return normalized;
}