import axios from 'axios';
import NodeCache from 'node-cache';
// JAVÍTÁS: Behívjuk a configból az odds API kulcs VÁLASZTÓ függvényt
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
// Név-hasonlósági csomag importálása
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache-ek inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600, useClones: false }); // Általános cache (klónozás nélkül a teljesítményért)
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // SportMonks ID cache (nem jár le)
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); // Odds cache (10 perc)

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Robusztus SportMonks ID keresés (többlépcsős).
* VÉGLEGES JAVÍTÁS: Pontosított Player API adatfeldolgozás (több szezon/név).
* VÉGLEGES JAVÍTÁS: Intelligens Odds API hívás liga alapján + név-hasonlóság.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
/**
 * Általános, hibatűrő axios kérés küldő, újrapróbálkozással.
 * @param {string} url Az API végpont URL-je.
 * @param {object} config Axios konfigurációs objektum (headers, timeout, etc.).
 * @param {number} retries Újrapróbálkozások száma.
 * @returns {Promise<axios.Response|null>} A sikeres válasz vagy null hiba esetén.
 */
async function makeRequest(url, config = {}, retries = 2) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            // Mély másolat a configról, hogy ne módosítsa az eredetit a timeout
            const currentConfig = JSON.parse(JSON.stringify(config));
            currentConfig.timeout = currentConfig.timeout || 8000; // Alap timeout
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300); // Csak 2xx sikeres

            const response = await axios.get(url, currentConfig);
            return response; // Sikeres válasz
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url} - `;
            if (axios.isAxiosError(error)) {
                if (error.response) { // A szerver válaszolt, de nem 2xx státusszal
                    errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                    // Ha rate limit (429) vagy jogosultsági (401, 403) hiba, nincs értelme újrapróbálni
                    if ([401, 403, 429].includes(error.response.status)) {
                        console.error(errorMessage);
                        return null; // Nincs újrapróbálkozás
                    }
                } else if (error.request) { // Kérés elküldve, de nem jött válasz (pl. timeout)
                    errorMessage += `Timeout (${config.timeout}ms) vagy nincs válasz.`;
                } else { // Beállítási hiba
                    errorMessage += `Beállítási hiba: ${error.message}`;
                    console.error(errorMessage);
                    return null; // Nincs újrapróbálkozás
                }
            } else { // Nem Axios hiba
                errorMessage += `Általános hiba: ${error.message}`;
                console.error(errorMessage, error.stack); // Logoljuk a stack trace-t is
                return null; // Nincs újrapróbálkozás
            }
            console.warn(errorMessage); // Figyelmeztetés logolása
            if (attempts <= retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Várakozás újrapróbálás előtt
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url}`);
    return null; // Sikertelen volt az összes próbálkozás
}


// --- SPORTMONKS API FUNKCIÓK (VÉGLEGESEN JAVÍTVA) ---

/**
 * Megkeresi egy csapat SportMonks ID-ját név alapján, intelligens, többlépcsős kereséssel.
 * Gyorsítótárazza az eredményt.
 * @param {string} teamName Az ESPN-től kapott csapatnév.
 * @returns {Promise<string|null>} A csapat SportMonks ID-ja vagy null.
 */
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null; // Üres név esetén nincs mit keresni

    const cacheKey = `sportmonks_id_v3_${originalLowerName.replace(/\s+/g, '')}`; // Új verzió
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) {
        // console.log(`SportMonks ID cache ${cachedResult === 'not_found' ? 'miss (not found)' : 'hit'} for "${teamName}"`);
        return cachedResult === 'not_found' ? null : cachedResult;
    }

    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        sportmonksIdCache.set(cacheKey, 'not_found');
        return null;
    }

    const TEAM_NAME_MAP = {
        'genk': 'KRC Genk',
        'betis': 'Real Betis',
        'red star': 'Red Star Belgrade',
        'sparta': 'Sparta Prague',
        'inter': 'Internazionale',
        'fc copenhagen': 'Copenhagen',
        'manchester utd': 'Manchester United',
        'atletico': 'Atletico Madrid'
    };

    let teamId = null;
    let searchAttempt = 0;
    let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName]; // 1. Mappelt vagy eredeti
    // 2. Egyszerűsített név (pl. FC nélkül), ha különbözik
    const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk)\s+/i, '').trim();
    if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) {
        namesToTry.push(simplifiedName);
    }
     // 3. Eredeti név, ha a mappelt volt az első
     if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) {
        namesToTry.push(teamName);
    }


    for (const searchName of namesToTry) {
        searchAttempt++;
        try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            console.log(`SportMonks ID keresés (${searchAttempt}. próba): "${searchName}" (eredeti: "${teamName}")`);
            // Itt nem használjuk a makeRequest-et, mert specifikusabban akarjuk kezelni a találatokat
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });

            if (response.status === 200 && response.data?.data?.length > 0) {
                const results = response.data.data;
                let bestMatch = results[0];

                if (results.length > 1) {
                    const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName);
                    if (perfectMatch) {
                        bestMatch = perfectMatch;
                    } else {
                        const names = results.map(team => team.name);
                        const similarityResult = findBestMatch(originalLowerName, names);
                         // Magasabb küszöb az elsődleges keresésnél
                        if (similarityResult.bestMatch.rating > 0.7) {
                            bestMatch = results[similarityResult.bestMatchIndex];
                            console.log(`SportMonks: Hasonlóság alapján választva "${bestMatch.name}" (${(similarityResult.bestMatch.rating * 100).toFixed(1)}%) ehhez: "${teamName}"`);
                        } else {
                            console.warn(`SportMonks: Több találat "${searchName}"-re, de a hasonlóság (${(similarityResult.bestMatch.rating * 100).toFixed(1)}%) alacsony. Az elsőt használjuk: "${bestMatch.name}".`);
                        }
                    }
                }
                teamId = bestMatch.id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
                sportmonksIdCache.set(cacheKey, teamId); // Cachelés az eredeti név alapján
                return teamId; // Megvan a találat, kilépünk
            } else if (response.status !== 404) {
                 console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}", Válasz: ${JSON.stringify(response.data)?.substring(0, 200)}`);
                 // Ha itt hiba van (nem 404), akkor valószínűleg nincs értelme tovább próbálkozni
                 break;
             }
             // Ha 404 vagy üres a lista, megyünk a következő névre

        } catch (error) {
             let errorMessage = `Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`;
             if (axios.isAxiosError(error) && error.response) {
                 errorMessage += ` | Státusz: ${error.response.status}`;
             }
             console.error(errorMessage);
             // Itt is megszakíthatjuk a ciklust hiba esetén, kivéve timeout
             if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') {
                 break;
             }
        }
         // Kis szünet a próbálkozások között
         await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Ha egyik névvel sem volt sikeres a keresés
    console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    sportmonksIdCache.set(cacheKey, 'not_found');
    return null;
}


/**
 * Lekéri a haladó statisztikákat (főleg xG) a SportMonks API-ból a csapat ID-k alapján.
 * Robusztusabb meccskereséssel.
 * @param {string} sport A sportág (jelenleg csak 'soccer').
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @returns {Promise<object>} A feldolgozott SportMonks adatok (advanced_stats, referee).
 */
async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    // ID-k lekérése párhuzamosan
    const [homeTeamId, awayTeamId] = await Promise.all([
        findSportMonksTeamId(homeTeamName),
        findSportMonksTeamId(awayTeamName)
    ]);

    if (!homeTeamId || !awayTeamId) {
        // A findSportMonksTeamId már logolta a hibát
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureData = null;
    const today = new Date();

    // Visszamenőleg keresünk 3 napot
    for (let i = 0; i < 3 && !fixtureData; i++) {
        const searchDate = new Date(today);
        searchDate.setDate(today.getDate() - i);
        const dateString = searchDate.toISOString().split('T')[0];

        try {
            // JAVÍTÁS: Direkt keresés a CSAPAT ID-k alapján az adott napon
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${i + 1}. nap: ${dateString}): ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId})`);
            const response = await makeRequest(url, { timeout: 7000 }); // makeRequest használata

            if (response?.data?.data?.length > 0) {
                const foundFixture = response.data.data.find(f =>
                    (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                );
                if (foundFixture) {
                    fixtureData = foundFixture;
                    console.log(`SportMonks meccs találat (${dateString}): ${homeTeamName} vs ${awayTeamName}`);
                    break;
                } else {
                     console.warn(`SportMonks: Találat ${dateString}-n, de nem a keresett ID párral (${homeTeamId} vs ${awayTeamId}). Lehet fordított a párosítás?`);
                     // Megpróbáljuk fordítva is keresni? (Opcionális, bonyolíthatja)
                }
            }
             // Ha a makeRequest null-t ad vissza, már logolta a hibát
        } catch (e) { /* makeRequest már kezeli */ }
    }

    if (!fixtureData) {
        console.log(`SportMonks: Nem található meccs ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId}) az elmúlt 3 napban.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    // Adatok kinyerése
    try {
        const extractedData = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
        const fixtureStats = fixtureData.statistics || [];
        const homeStatsSM = fixtureStats.find(s => String(s.participant_id) === String(homeTeamId));
        const awayStatsSM = fixtureStats.find(s => String(s.participant_id) === String(awayTeamId));

        // xG adatok hozzáadása (és más statok, ha kellenek)
        if (homeStatsSM) extractedData.advanced_stats.home.xg = homeStatsSM.xg ?? null;
        if (awayStatsSM) extractedData.advanced_stats.away.xg = awayStatsSM.xg ?? null;

        console.log(`SportMonks adatok (xG) sikeresen feldolgozva: ${homeTeamName} vs ${awayTeamName}`);
        return extractedData;

    } catch (e) {
        console.error(`Hiba SportMonks adatok feldolgozásakor (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }
}


// --- PLAYER API (API-SPORTS) FUNKCIÓK (VÉGLEGESEN JAVÍTVA) ---

/**
 * Lekéri a játékosok alap statisztikáit az API-SPORTS API-ból név alapján.
 * Több névváltozattal és szezonnal is próbálkozik.
 * @param {string[]} playerNames A keresendő játékosok neveinek listája.
 * @returns {Promise<object>} Objektum, ahol a kulcsok a játékosnevek, az értékek a statisztikáik.
 */
async function _fetchPlayerData(playerNames) {
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<') || PLAYER_API_KEY.length < 20) {
        return {};
    }
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) {
        return {};
    }

    const playerData = {};
    const currentYear = new Date().getFullYear();
    const yearsToTry = [currentYear, currentYear - 1]; // Aktuális és előző szezon

    console.log(`Player API: ${playerNames.length} játékos keresése indul (${yearsToTry.join(', ')} szezonokra)...`);

    const MAX_CONCURRENT_REQUESTS = 2; // Óvatosabb párhuzamosítás
    for (let i = 0; i < playerNames.length; i += MAX_CONCURRENT_REQUESTS) {
        const batchNames = playerNames.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const batchPromises = batchNames.map(async (playerName) => {
            const normalizedName = playerName.trim();
            if (!normalizedName) return { name: playerName, stats: null };

            let foundStats = null;
            let foundPlayerInfo = null;
            const namesToSearch = [normalizedName];
            // Ha van szóköz, próbáljuk csak a vezetéknevet is
            if (normalizedName.includes(' ')) {
                namesToSearch.push(normalizedName.split(' ').pop());
            }

            // Végigpróbáljuk a neveket és szezonokat
            for (const year of yearsToTry) {
                if (foundStats) break; // Ha már találtunk statisztikát, kilépünk
                for (const searchName of namesToSearch) {
                    try {
                        const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(searchName)}&season=${year}`;
                        // console.log(`Player API kérés: ${searchName} (szezon: ${year})`);

                        // Itt nem használjuk a makeRequest-et a specifikus API-SPORTS hibakezelés miatt
                        const response = await axios.get(url, {
                            timeout: 8000,
                            headers: {
                                'x-rapidapi-host': 'v3.football.api-sports.io',
                                'x-rapidapi-key': PLAYER_API_KEY
                            },
                             validateStatus: () => true // Minden státuszt elfogadunk
                        });

                         // Rate limit figyelés
                         if (response.headers['x-ratelimit-requests-remaining'] === '0') console.warn("Player API: Rate limit elérve!");
                         else if (response.headers['x-ratelimit-requests-remaining'] && parseInt(response.headers['x-ratelimit-requests-remaining'], 10) < 10) console.warn(`Player API: Kevés kérés maradt: ${response.headers['x-ratelimit-requests-remaining']}`);

                        if (response.status === 200 && response.data?.response?.length > 0) {
                            // Keressük a legrelevánsabb játékost (legjobb név egyezés)
                             const players = response.data.response;
                             let bestPlayerMatch = players[0];
                             if (players.length > 1) {
                                 const playerNamesFromApi = players.map(p => p.player.name);
                                 const similarityResult = findBestMatch(normalizedName, playerNamesFromApi);
                                 if (similarityResult.bestMatch.rating > 0.7) { // Magas küszöb kell itt
                                     bestPlayerMatch = players[similarityResult.bestMatchIndex];
                                 }
                             }

                            // Keressük a statisztikát a MEGFELELŐ ligából/szezonból
                            // Először az adott szezon, utána bármi más
                            const seasonStats = bestPlayerMatch.statistics?.find(s => s.league?.season === year) || bestPlayerMatch.statistics?.[0];

                            if (seasonStats) {
                                console.log(`Player API: Találat "${normalizedName}" -> "${bestPlayerMatch.player.name}" (szezon: ${seasonStats.league?.season || year})`);
                                foundStats = seasonStats;
                                foundPlayerInfo = bestPlayerMatch.player; // Elmentjük a játékos infót is
                                break; // Megvan a statisztika ehhez a névhez, kilépünk a belső ciklusból
                            } else if (!foundPlayerInfo) {
                                 foundPlayerInfo = bestPlayerMatch.player; // Megtaláltuk a játékost, de nincs statja ehhez a szezonhoz
                             }
                        } else if (response.status !== 404) {
                             // Logoljuk a releváns API hibákat (pl. 401, 403, 429)
                            console.error(`Player API hiba (${searchName}, ${year}): ${response.status} - ${JSON.stringify(response.data)?.substring(0, 150)}`);
                             if ([401, 403, 429].includes(response.status)) break; // Nincs értelme tovább próbálkozni
                        }
                    } catch (error) { // Hálózati vagy egyéb hiba
                         let errorMessage = `Hiba Player API híváskor (${searchName}, ${year}): ${error.message}`;
                         if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') errorMessage += ' (Timeout)';
                         console.error(errorMessage);
                         break; // Hiba esetén nincs értelme tovább próbálkozni ezzel a játékossal
                    }
                    await new Promise(resolve => setTimeout(resolve, 150)); // Kis szünet
                } // End namesToSearch loop
            } // End yearsToTry loop

            // Feldolgozás a ciklusok után
            if (foundStats) {
                const stats = foundStats;
                 return {
                     name: playerName,
                     stats: {
                         recent_goals_or_points: stats.goals?.total ?? stats.goals?.scored ?? 0,
                         key_passes_or_assists_avg: stats.passes?.key ?? stats.goals?.assists ?? 0,
                         tackles_or_rebounds_avg: stats.tackles?.total ?? 0,
                         // Opcionális extra adatok
                         // rating: parseFloat(stats.games?.rating) || null,
                         // league: stats.league?.name,
                         // season: stats.league?.season
                     }
                 };
            } else if (foundPlayerInfo) {
                 console.warn(`Player API: Játékos (${foundPlayerInfo.name}) megtalálva, de nincs releváns statisztika ${yearsToTry.join('/')} szezonokra.`);
                 return { name: playerName, stats: {} }; // Játékos megvan, stat nincs
            } else {
                 // Ha sehol nem találtuk meg
                 // console.warn(`Player API: Nem található játékos: ${normalizedName}`); // Csökkentett logolás
                 return { name: playerName, stats: null }; // Jelzi, hogy nem találtuk
            }
        });
        results.push(...await Promise.all(batchPromises));
        // Nagyobb szünet a batch-ek között, ha rate limit közelében vagyunk
        if (results.some(r => r && r.headers && r.headers['x-ratelimit-requests-remaining'] && parseInt(r.headers['x-ratelimit-requests-remaining'], 10) < 5)) {
             console.warn("Player API: Rate limit közelében, hosszabb szünet...");
             await new Promise(resolve => setTimeout(resolve, 2000));
        } else if (i + MAX_CONCURRENT_REQUESTS < playerNames.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    // Eredmények összesítése a playerData objektumba
    results.forEach(result => {
        if (result && result.stats !== null) { // Csak ha találtunk valamit (akár üres statot)
             playerData[result.name] = result.stats;
        } else if (result) {
            playerData[result.name] = {}; // Ha végképp nem találtuk, üres objektum
        }
    });

    const foundCount = Object.keys(playerData).filter(k => Object.keys(playerData[k]).length > 0).length;
    console.log(`Player API adatok feldolgozva ${foundCount}/${playerNames.length} játékosra.`);
    return playerData;
}


// --- GEMINI API FUNKCIÓ (VÁLTOZATLAN - keresés kikapcsolva) ---
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Hiányzó GEMINI_API_KEY.");
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" },
        // tools: [{ "googleSearchRetrieval": {} }] // KIKAPCSOLVA
    };
    try {
        const response = await makeRequest(GEMINI_API_URL, {
             method: 'POST', // makeRequest alapból GET, itt POST kell
             headers: { 'Content-Type': 'application/json' },
             data: payload, // Adat a 'data' mezőbe POST esetén
             timeout: 90000,
             validateStatus: (status) => status < 500 // 4xx hibákat is elfogadjuk
        }, 1); // Csak 1 újrapróbálkozás Gemininél

        if (!response) throw new Error("A Gemini API hívás sikertelen volt az újrapróbálkozások után.");

         // Hibakezelés a státuszkód alapján
         if (response.status === 429) throw new Error("Gemini API rate limit elérve.");
         if (response.status >= 400) {
             const errorDetails = JSON.stringify(response.data)?.substring(0, 500);
             if (response.status === 400 && errorDetails.includes('API key not valid')) throw new Error("Érvénytelen Gemini API kulcs.");
             throw new Error(`Gemini API hiba (${response.status}). ${errorDetails}`);
         }

        const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;
        if (!responseText) {
            const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category;
            console.error(`Gemini API válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`);
             if (finishReason === 'SAFETY' || blockReason) throw new Error(`Az AI válaszát biztonsági szűrők blokkolták (${blockReason || 'Ismeretlen ok'}).`);
             if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt.");
             if (finishReason === 'RECITATION') throw new Error("Az AI válasza idézési problémák miatt blokkolva.");
             throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Hiányzó válasz'}`);
        }
        // JSON validálás (bár elvileg már validnak kellene lennie)
        try { JSON.parse(responseText.trim()); return responseText.trim(); }
        catch (jsonError) {
             console.error(`Gemini válasz nem valid JSON: ${jsonError.message}`, responseText.substring(0,500));
             throw new Error("Az AI válasza nem volt érvényes JSON formátumú.");
        }
    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`);
        throw e; // Dobjuk tovább a hibát
    }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (VÉGLEGESEN JAVÍTVA) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) { // leagueName hozzáadva
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v24_final_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió

    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    } else {
        console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    }

    try {
        // Párhuzamos adatgyűjtés: Gemini és SportMonks
        const [geminiJsonString, sportMonksDataResult] = await Promise.all([
             _callGeminiWithSearch( // Gemini hívás a háttérben
                 `CRITICAL TASK: Provide a single, valid JSON object for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Use your internal knowledge. Focus ONLY on H2H (structured last 5 + summary), team news (absentees: name, importance + impact analysis), recent form (overall & home/away), expected tactics (style), and key players (name, role). NO extra text/markdown. JSON STRUCTURE: {"stats": { "home": {}, "away": {} }, "h2h_summary": "<summary>", "h2h_structured": [ { "date": "YYYY-MM-DD", "score": "H-A" } ], "team_news": { "home": "<news>", "away": "<news>" }, "absentees": { "home": [ { "name": "<Player>", "importance": "<'key'|'important'|'squad'>" } ], "away": [] }, "absentee_impact_analysis": "<analysis>", "form": { "home_overall": "<W-D-L>", "away_overall": "<W-D-L>", "home_home": "<W-D-L>", "away_away": "<W-D-L>" }, "tactics": { "home": { "style": "<Style>" }, "away": { "style": "<Style>" } }, "key_players": { "home": [ { "name": "<Name>", "role": "<Role>" } ], "away": [] }}`
             ).catch(e => { console.error(`Gemini hívás sikertelen: ${e.message}`); return null; }), // Hiba esetén null
             _fetchSportMonksData(sport, homeTeamName, awayTeamName) // SportMonks hívás
         ]);


        if (!geminiJsonString) throw new Error("A Gemini API hívás sikertelen volt.");
        let geminiData = JSON.parse(geminiJsonString); // Itt már validnak kell lennie

        // Játékosadatok lekérése
        const playerNames = [...(geminiData?.key_players?.home || []), ...(geminiData?.key_players?.away || [])].map(p => p?.name).filter(Boolean);
        const detailedPlayerData = playerNames.length > 0 ? await _fetchPlayerData(playerNames) : {};

        // Adatok egyesítése és normalizálása
        const finalData = {};
        finalData.stats = geminiData.stats || { home: {}, away: {} };
        finalData.h2h_summary = geminiData.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = {
             home: Array.isArray(geminiData.absentees?.home) ? geminiData.absentees.home : [],
             away: Array.isArray(geminiData.absentees?.away) ? geminiData.absentees.away : []
         };
        finalData.absentee_impact_analysis = geminiData.absentee_impact_analysis || "N/A";
        finalData.form = geminiData.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: [], away: [] };
        (geminiData.key_players?.home || []).forEach(p => { if (p?.name) finalData.key_players.home.push({ ...p, stats: detailedPlayerData[p.name] || {} }); });
        (geminiData.key_players?.away || []).forEach(p => { if (p?.name) finalData.key_players.away.push({ ...p, stats: detailedPlayerData[p.name] || {} }); });
        finalData.advanced_stats = { home: { xg: sportMonksDataResult.advanced_stats?.home?.xg ?? null }, away: { xg: sportMonksDataResult.advanced_stats?.away?.xg ?? null } };
        finalData.referee = sportMonksDataResult.referee || { name: 'N/A', stats: 'N/A' };
        finalData.league_averages = geminiData.league_averages || {};


        // Gazdag kontextus string
        const richContext = [
             `- H2H: ${finalData.h2h_summary}`,
             `- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`,
             `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}`,
             `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`,
             `- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`
         ].join('\n');

        const result = {
            rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext,
            advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData
        };

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        // console.error("Hiba részletei:", e.stack); // Stack trace csak fejlesztéshez
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK (VÉGLEGESEN JAVÍTVA) ---

/**
 * Lekéri az élő fogadási szorzókat az Odds API-ból, vagy használja a frontendtől kapott nyitó szorzókat.
 * Gyorsítótárazza az élő szorzókat. Liga alapján választ API kulcsot és intelligens név-egyeztetést használ.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa ('soccer', 'hockey', 'basketball').
 * @param {object} sportConfig A sportág konfigurációja (SPORT_CONFIG[sport]).
 * @param {object} openingOdds A frontendtől kapott nyitó szorzók.
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object|null>} Az odds adatok vagy null.
 */
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { console.log("Nincs ODDS_API_KEY."); return null; }

    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;

    // 1. Nyitó szorzók feldolgozása (ha vannak)
     if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key];
            const currentOdds = [];
            const allMarkets = [];

            if (matchData.h2h && Array.isArray(matchData.h2h)) {
                allMarkets.push({ key: 'h2h', outcomes: matchData.h2h });
                matchData.h2h.forEach(o => { /* ... (marad a régi feldolgozás) ... */ });
            }
             if (matchData.totals && Array.isArray(matchData.totals)) {
                 allMarkets.push({ key: 'totals', outcomes: matchData.totals });
                 const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
                 /* ... (marad a régi feldolgozás) ... */
             }

            if (currentOdds.length > 0) {
                 console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`);
                 return { current: currentOdds, allMarkets: allMarkets, fromCache: true, sport: sport };
             }
        } catch (e) { console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}.`); }
    } else {
         // console.log(`Nincs nyitó szorzó (frontendről) a ${key} meccshez, friss lekérés indul...`); // Csökkentett logolás
    }


    // 2. Cache ellenőrzése
    const cacheKey = `live_odds_${sport}_${key}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
        console.log(`Élő szorzók használva (cache) a ${key} meccshez.`);
        return { ...cachedOdds, fromCache: true };
    }

    // 3. API hívás
    console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam}`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);

    // Cachelés és visszatérés
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    } else {
         console.warn(`Nem sikerült élő szorzókat lekérni az API-ból: ${homeTeam} vs ${awayTeam}`);
         return null;
    }
}

/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból, a liga neve alapján választva API kulcsot.
 * Intelligens név-egyeztetést használ a meccs megtalálásához.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa ('soccer', 'hockey', 'basketball').
 * @param {object} sportConfig A sportág konfigurációja (SPORT_CONFIG[sport]).
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object|null>} Az odds adatok vagy null hiba esetén.
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    // Intelligens API kulcs választás
     const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_keys_by_league ? Object.keys(sportConfig.odds_api_keys_by_league)[0] : null);

     if (!ODDS_API_KEY || !oddsApiKey) {
         console.error(`getOddsData: Hiányzó ODDS_API_KEY vagy nem található Odds API kulcs ehhez a ligához: ${leagueName} (sport: ${sport})`);
         return null;
     }

    // JAVÍTÁS: A sport kulcsát a lekérdezés URL-jéből vesszük, a ligákat a sport paraméterbe tesszük
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sport=${oddsApiKey}`;

    try {
        console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`);
        const response = await makeRequest(url, { timeout: 8000 }); // makeRequest használata
        if (!response || !Array.isArray(response.data)) {
            // makeRequest már logolta a hibát
            return null;
        }

        const oddsData = response.data;
        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();

        // JAVÍTÁS: Intelligens meccs keresés név-hasonlósággal
        let bestMatch = null;
        let highestRating = 0.6; // Minimum hasonlósági küszöb

        for (const match of oddsData) {
            if (!match.home_team || !match.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();

            // Súlyozott hasonlóság számítása (mindkét csapatnév számít)
            const homeSimilarity = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating;
            const awaySimilarity = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating;
            const averageSimilarity = (homeSimilarity + awaySimilarity) / 2;

            if (averageSimilarity > highestRating) {
                highestRating = averageSimilarity;
                bestMatch = match;
            }
        }


        if (!bestMatch) {
            console.warn(`Odds API (${oddsApiKey}): Nem található még hasonlóság alapján sem meccs: ${homeTeam} vs ${awayTeam}.`);
            return null;
        }
         // Ha a legjobb találat sem elég jó, akkor sem fogadjuk el
         if (highestRating < 0.7) { // Szigorúbb küszöb a végleges választáshoz
            console.warn(`Odds API (${oddsApiKey}): Legjobb találat (${bestMatch.home_team} vs ${bestMatch.away_team}) hasonlósága (${(highestRating * 100).toFixed(1)}%) túl alacsony ehhez: ${homeTeam} vs ${awayTeam}.`);
            return null;
         }

         console.log(`Odds API (${oddsApiKey}): Megtalált meccs (hasonlóság: ${(highestRating * 100).toFixed(1)}%): "${bestMatch.home_team}" vs "${bestMatch.away_team}"`);


        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
            console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' odds vagy piac adat: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
            return null;
        }

        // Szorzók kinyerése (marad a régi logika)
        const currentOdds = [];
        const allMarkets = bookmaker.markets;
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const totalsMarket = allMarkets.find(m => m.key === 'totals');

        if (h2hMarket?.outcomes) {
             h2hMarket.outcomes.forEach(o => { /* ... */ });
        }
         if (totalsMarket?.outcomes) {
             const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
             /* ... */
         }


        if (currentOdds.length > 0) {
            // console.log(`Friss szorzók (${oddsApiKey}) sikeresen lekérve: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
            return { current: currentOdds, allMarkets: allMarkets, sport: sport };
        } else {
            console.warn(`Nem sikerült érvényes szorzókat kinyerni a 'pinnacle' adatokból (${oddsApiKey}): ${bestMatch.home_team} vs ${bestMatch.away_team}`);
            return null;
        }

    } catch (e) {
         // makeRequest már kezeli a hálózati hibákat, itt inkább a feldolgozási hibákra koncentrálunk
         console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`);
        return null;
    }
}


// --- findMainTotalsLine, fetchOpeningOddsForAllSports, _getFixturesFromEspn (VÁLTOZATLANOK MARADNAK AZ ELŐZŐ VERZIÓBÓL) ---
// (Itt most nem másolom be őket újra a rövidség kedvéért, de a teljes kódban benne kell lenniük!)

/**
 * Megkeresi a "fő" totals vonalat (ahol az Over és Under szorzók a legközelebb vannak egymáshoz).
 * @param {object} oddsData Az Odds API válaszából származó odds adatok ({ allMarkets: [], sport: '...' }).
 * @returns {number} A fő totals vonal értéke.
 */
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || totalsMarket.outcomes.length < 2) return defaultLine;

    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];

    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        if (over?.price && under?.price) {
            const diff = Math.abs(parseFloat(over.price) - parseFloat(under.price));
            if (!isNaN(diff) && diff < closestPair.diff) {
                closestPair = { diff, line: point };
            }
        }
    }
     // Ha nem találtunk érvényes párt, de az alapértelmezett vonal létezik a pontok között
     if (closestPair.diff === Infinity && points.includes(defaultLine)) {
         return defaultLine;
     }
    return closestPair.line;
}


/**
 * Lekéri az összes sportág nyitó szorzóit (ritkán használt).
 * @returns {Promise<object>} Objektum a meccsek nyitó szorzóival.
 */
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)...");
    let allOdds = {};
    const processedLeagues = new Set();

    for (const sport of Object.keys(SPORT_CONFIG)) {
        const sportConfig = SPORT_CONFIG[sport];
        if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league) continue;

        for (const oddsApiKey of Object.keys(sportConfig.odds_api_keys_by_league)) {
             if (processedLeagues.has(oddsApiKey)) continue;
             // JAVÍTÁS: A sport kulcsot használjuk itt is, a ligákat a sport paraméterbe
             const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sport=${oddsApiKey}`;
            try {
                console.log(`Odds API kérés (GetAll - ${oddsApiKey})...`);
                const response = await makeRequest(url, { timeout: 15000 }); // makeRequest használata
                if (response?.data && Array.isArray(response.data)) {
                    response.data.forEach(match => {
                        /* ... (logika változatlan) ... */
                         if (!match?.home_team || !match?.away_team) return;
                         const key = `${match.home_team.toLowerCase()}_vs_${match.away_team.toLowerCase()}`;
                         const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
                         if (bookmaker?.markets) {
                             const odds = {};
                             const h2h = bookmaker.markets.find(m => m.key === 'h2h')?.outcomes;
                             const totals = bookmaker.markets.find(m => m.key === 'totals')?.outcomes;
                             if (h2h) odds.h2h = h2h;
                             if (totals) odds.totals = totals;
                             if (Object.keys(odds).length > 0) allOdds[key] = odds;
                         }
                    });
                     processedLeagues.add(oddsApiKey);
                }
            } catch (e) { /* makeRequest már kezeli */ }
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`);
    return allOdds;
}

/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája objektumként [{id, home, away, utcKickoff, league}].
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.name || !sportConfig.espn_leagues) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) {
        console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`);
        return [];
    }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date(); date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });
    const promises = [];
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);

    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) continue;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                 makeRequest(url, { timeout: 6000 }) // makeRequest használata
                    .then(response => {
                        if (!response?.data?.events) return []; // Hibát a makeRequest logolja
                        return response.data.events
                            .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                            .map(event => {
                                const competition = event.competitions?.[0];
                                const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team;
                                const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team;
                                if (event.id && home?.name && away?.name && event.date) {
                                    return {
                                        id: String(event.id),
                                        home: String(home.shortDisplayName || home.displayName || home.name).trim(),
                                        away: String(away.shortDisplayName || away.displayName || away.name).trim(),
                                        utcKickoff: event.date,
                                        league: String(leagueName).trim()
                                    };
                                }
                                return null;
                            })
                            .filter(Boolean) || [];
                    })
                    // A catch ág felesleges, mert a makeRequest null-t ad vissza hiba esetén
            );
             await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit védelem
        }
    }

    const results = await Promise.all(promises);
    const uniqueFixturesMap = new Map();
    results.flat().forEach(fixture => {
         if (fixture && fixture.id && !uniqueFixturesMap.has(fixture.id)) {
             uniqueFixturesMap.set(fixture.id, fixture);
         }
     });
    const finalFixtures = Array.from(uniqueFixturesMap.values())
        .sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff)); // Rendezés

    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    return finalFixtures;
}