// FÁJL: providers/common/utils.ts
// VERZIÓ: v72.1 (Kritikus Meccslista Javítás)
// MÓDOSÍTÁS:
// 1. JAVÍTVA (KRITIKUS): Az '_getFixturesFromEspn' (kb. 345. sor)
//    státusz szűrője ('pre') túl szigorú volt, ami 0 meccset eredményezett.
// 2. LOGIKA: A szűrő megfordítva. Most már minden meccset átenged,
//    ami NEM 'post' (befejezett), így a 'scheduled' és 'upcoming'
//    státuszú meccsek is bekerülnek a listába.

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
// (Változatlan v72.0)
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
                if ([401, 403].includes(error.response.status)) { 
                    console.error(`HITELESÍTÉSI HIBA: ${errorMessage}`);
                    throw error; 
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

// --- GEMINI API HÍVÓK ---
// (Változatlan v72.0)
export async function _callGemini(prompt: string, forceJson: boolean = true): Promise<string> {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') { throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY."); }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }
    
    let finalPrompt = prompt;
    if (forceJson) {
        finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object.\nDo not add any text, explanation, or introductory phrases outside of the JSON structure itself.\nEnsure the JSON is complete and well-formed.`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { 
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }], 
        generationConfig: { 
            temperature: 0.2, 
            maxOutputTokens: 8192,
            ...(forceJson && { responseMimeType: "application/json" }),
        }, 
    };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length}, JSON kényszerítve: ${forceJson})`);
    try {
        const response: AxiosResponse<any> = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }, 
            timeout: 120000, 
            validateStatus: () => true 
        });
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }
        
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            console.warn('--- GEMINI BLOCK RESPONSE ---', JSON.stringify(response.data, null, 2));
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}`);
        }
        
        if (forceJson) {
            try {
                JSON.parse(responseText);
            } catch (e: any) {
                console.error(`Gemini JSON parse hiba a kikényszerített válaszon: ${e.message}`);
                throw new Error(`Gemini JSON parse hiba: ${e.message}`);
            }
        }
        
        return responseText;
    } catch (e: any) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        throw e;
    }
}
// (Változatlan v72.0)
export async function _callGeminiWithJsonRetry(
    prompt: string, 
    stepName: string, 
    maxRetries: number = 2
): Promise<any> {
    
    let attempts = 0;
    while (attempts <= maxRetries) {
        attempts++;
        try {
            const jsonString = await _callGemini(prompt, true); 
            const result = JSON.parse(jsonString);
            
            if (attempts > 1) {
                console.log(`[AI_Service] Sikeres JSON feldolgozás (${stepName}) a(z) ${attempts}. próbálkozásra.`);
            }
            return result;
        } catch (e: any) {
            if (e instanceof SyntaxError) {
                console.warn(`[AI_Service] FIGYELMEZTETÉS: Gemini JSON parse hiba (${stepName}), ${attempts}/${maxRetries+1}. próbálkozás. Hiba: ${e.message}`);
                if (attempts > maxRetries) {
                    console.error(`[AI_Service] KRITIKUS HIBA: A Gemini JSON feldolgozása végleg sikertelen (${stepName}) ${attempts-1} próbálkozás után.`);
                    throw new Error(`AI Hiba (${stepName}): A modell hibás JSON struktúrát adott vissza, ami nem feldolgozható. Hiba: ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            } else {
                console.error(`[AI_Service] Kritikus nem-parse hiba (${stepName}): ${e.message}`);
                throw e;
            }
        }
    }
    throw new Error(`AI Hiba (${stepName}): Ismeretlen hiba az újrapróbálkozási ciklusban.`);
}

// --- PROMPT SEGÉDFÜGGVÉNY ---
// (Változatlan v72.0)
export function fillPromptTemplate(template: string, data: any): string {
    if (!template || typeof template !== 'string') return '';
    try {
        return template.replace(/\{([\w_.]+)\}/g, (match, key) => {
            let value: any;
            if (key.includes('.')) {
                const keys = key.split('.');
                let currentData = data;
                let found = true;
                for (const k of keys) {
                    if (currentData && typeof currentData === 'object' && currentData.hasOwnProperty(k)) {
                        currentData = currentData[k];
                    } else if (k.endsWith('Json')) {
                        const baseKey = k.replace('Json', '');
                        if (currentData && currentData.hasOwnProperty(baseKey) && currentData[baseKey] !== undefined) {
                            try { 
                                currentData = currentData[baseKey];
                            } catch (e: any) { 
                                console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál (bejövő objektum)`);
                                currentData = {}; 
                            }
                         }
                    } else {
                        found = false;
                        break;
                    }
                }
                if (found) {
                    value = currentData;
                } else {
                    console.warn(`Hiányzó pontozott kulcs a prompt kitöltéséhez: ${key}`);
                    return "N/A";
                }
            
            } else if (data && typeof data === 'object' && data.hasOwnProperty(key)) {
                 value = data[key];
            } 
 
            else if (key.endsWith('Json')) {
                const baseKey = key.replace('Json', '');
                if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                    try { return JSON.stringify(data[baseKey]);
                    } 
                     catch (e: any) { console.warn(`JSON stringify hiba a(z) ${baseKey} kulcsnál`);
                        return '{}'; }
                } else { return '{}';
                } 
            }
            else { 
                 console.warn(`Hiányzó kulcs a prompt kitöltéséhez: ${key}`);
                return "N/A";
            }

            if (value === null || value === undefined) { return "N/A";
            }
            if (typeof value === 'object') {
                 try { return JSON.stringify(value);
                } catch (e) { return "[object]"; }
            }
            return String(value);
        });
    } catch(e: any) {
         console.error(`Váratlan hiba a fillPromptTemplate során: ${e.message}`);
        return template; 
    }
}

// --- SPORT ADAT SEGÉDFÜGGVÉNYEK ---

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
                        
                        // === JAVÍTÁS (v72.1) ===
                        // A régi, túl szigorú szűrő:
                        // .filter((event: any) => event?.status?.type?.state?.toLowerCase() === 'pre')
                        //
                        // Az új, robusztusabb szűrő: Minden, ami nem 'post' (befejezett):
                         .filter((event: any) => event?.status?.type?.state?.toLowerCase() !== 'post')
                        // === JAVÍTÁS VÉGE ===

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
                        }).filter(Boolean); // Kiszűri a null értékeket
                })
                .catch((error: any) => {
                    if (error.response?.status === 400) {
                        console.warn(`ESPN Hiba (400): Valószínűleg rossz slug '${req.slug}' (${req.leagueName})?`);
                     } else {
                        console.error(`ESPN Hiba (${req.leagueName}): ${error.message}`);
                    }
                    return []; // Hiba esetén üres tömböt adunk vissza
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

// --- findMainTotalsLine ---
// (Változatlan v72.0)
export function findMainTotalsLine(oddsData: ICanonicalOdds | null, sport: string): number {
    const defaultConfigLine = SPORT_CONFIG[sport]?.totals_line || (sport === 'soccer' ? 2.5 : 6.5);
    if (!oddsData?.fullApiData?.bookmakers || oddsData.fullApiData.bookmakers.length === 0) {
        return defaultConfigLine;
    }

    const bookmaker = oddsData.fullApiData.bookmakers.find((b: any) => b.name === "Bet365") || oddsData.fullApiData.bookmakers[0];
    if (!bookmaker?.bets) return defaultConfigLine;
    let marketName: string;
    let alternativeMarketName: string | null = null;
    if (sport === 'soccer') {
        marketName = "over/under";
        alternativeMarketName = "totals";
    } else if (sport === 'hockey') {
        marketName = "total";
    } else if (sport === 'basketball') {
        marketName = "total points";
    } else {
        marketName = "over/under";
    }

    let totalsMarket = bookmaker.bets.find((b: any) => b.name.toLowerCase() === marketName);
    if (!totalsMarket && alternativeMarketName) {
        totalsMarket = bookmaker.bets.find((b: any) => b.name.toLowerCase() === alternativeMarketName);
    }

    if (!totalsMarket?.values) {
        console.warn(`Nem található '${marketName}' piac a szorzókban (${sport}).`);
        return defaultConfigLine;
    }

    const linesAvailable: { [key: string]: { over?: number, under?: number } } = {};
    for (const val of totalsMarket.values) {
        const lineMatch = val.value.match(/(\d+\.\d)/);
        const line = lineMatch ? lineMatch[1] : val.value; 

        if (isNaN(parseFloat(line))) continue; 

        if (!linesAvailable[line]) linesAvailable[line] = {};
        if (val.value.toLowerCase().startsWith("over")) {
            linesAvailable[line].over = parseFloat(val.odd);
        } else if (val.value.toLowerCase().startsWith("under")) {
            linesAvailable[line].under = parseFloat(val.odd);
        }
    }

    if (Object.keys(linesAvailable).length === 0) {
        return defaultConfigLine;
    }

    let closestPair = { diff: Infinity, line: defaultConfigLine };
    for (const line in linesAvailable) {
        const pair = linesAvailable[line];
        if (pair.over && pair.under) {
            const diff = Math.abs(pair.over - pair.under);
            if (diff < closestPair.diff) {
                closestPair = { diff, line: parseFloat(line) };
            }
        }
    }

    if (closestPair.diff < 0.5) {
        return closestPair.line;
    }

    const numericDefaultLine = defaultConfigLine;
    const numericLines = Object.keys(linesAvailable).map(parseFloat);
    numericLines.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return numericLines[0];
}


// --- IDŐJÁRÁS (v55.9) ---
// (Változatlan v72.0)
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
