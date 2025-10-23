import axios from 'axios';
import NodeCache from 'node-cache';
// Behívjuk a configból az odds API kulcs VÁLASZTÓ függvényt is
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
// Név-hasonlósági csomag importálása
import pkg from 'string-similarity';
const { findBestMatch } = pkg;

// Cache-ek inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600, useClones: false }); // Általános cache
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // SportMonks ID cache (nem jár le)
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false }); // Odds cache (10 perc)

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Robusztus SportMonks ID keresés (többlépcsős).
* VÉGLEGES JAVÍTÁS: Pontosított Player API adatfeldolgozás (engedélyezett szezonok).
* VÉGLEGES JAVÍTÁS: Intelligens Odds API hívás liga alapján + név-hasonlóság.
* VÉGLEGES JAVÍTÁS: Gemini API hívás egyszerűsítése (responseMimeType eltávolítva).
* VÉGLEGES JAVÍTÁS: Garantált 'rawStats' objektum visszaadása.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY ---
/**
 * Általános, hibatűrő axios kérés küldő, újrapróbálkozással.
 * @param {string} url Az API végpont URL-je.
 * @param {object} config Axios konfigurációs objektum (headers, timeout, method, data, etc.).
 * @param {number} retries Újrapróbálkozások száma.
 * @returns {Promise<axios.Response|null>} A sikeres válasz vagy null hiba esetén.
 */
async function makeRequest(url, config = {}, retries = 1) { // Kevesebb retry alapból
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const currentConfig = JSON.parse(JSON.stringify(config)); // Mély másolat
            currentConfig.timeout = currentConfig.timeout || 8000; // Alap 8 mp timeout
            // Alapértelmezett validateStatus csak 2xx-et fogad el
            currentConfig.validateStatus = currentConfig.validateStatus || ((status) => status >= 200 && status < 300);

            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }
            return response; // Sikeres válasz
        } catch (error) {
            attempts++;
            let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 100)}... - `; // URL rövidítve a logban
            if (axios.isAxiosError(error)) {
                if (error.response) { // A szerver válaszolt, de nem a validateStatus szerint
                    errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                    // Ha rate limit (429) vagy jogosultsági (401, 403) hiba, nincs értelme újrapróbálni
                    if ([401, 403, 429].includes(error.response.status)) {
                        console.error(errorMessage);
                        return null; // Nincs újrapróbálkozás
                    }
                } else if (error.request) { // Kérés elküldve, de nem jött válasz (pl. timeout)
                    errorMessage += `Timeout (${config.timeout || 8000}ms) vagy nincs válasz.`;
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
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); // Növekvő várakozás
            }
        }
    }
    console.error(`API hívás végleg sikertelen ${retries + 1} próbálkozás után: ${url.substring(0, 100)}...`);
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

    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`; // Új verzió a cache kulcsban
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) { // Ellenőrizzük az undefined-ot, mert a null lehet valid cache érték ('not_found')
        // console.log(`SportMonks ID cache ${cachedResult === 'not_found' ? 'miss (not found)' : 'hit'} for "${teamName}"`);
        return cachedResult === 'not_found' ? null : cachedResult;
    }

    // Ha nincs kulcs, felesleges próbálkozni
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        sportmonksIdCache.set(cacheKey, 'not_found');
        return null;
    }

    // Manuális térkép a leggyakoribb problémás esetekre
    const TEAM_NAME_MAP = {
        'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade',
        'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen',
        'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma'
        // További nevek szükség szerint
    };

    let teamId = null;
    // Keresési nevek priorizált sorrendben
    let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName]; // 1. Mappelt vagy eredeti név
    const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim(); // 'RC' is eltávolítva
    if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName); // 2. Egyszerűsített név
    if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName); // 3. Eredeti név (ha mappelt volt az első)

    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt];
        try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            console.log(`SportMonks ID keresés (${attempt + 1}. próba): "${searchName}" (eredeti: "${teamName}")`);
            // Itt direkt axios, mert a 404 nem feltétlen hiba, csak ha egyik név sem ad találatot
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });

            if (response.status === 200 && response.data?.data?.length > 0) {
                const results = response.data.data;
                let bestMatch = results[0]; // Alapból az első

                if (results.length > 1) {
                    // 1. Tökéletes egyezés keresése (kis/nagybetű érzéketlen)
                    const perfectMatch = results.find(team => team.name.toLowerCase() === originalLowerName);
                    if (perfectMatch) {
                        bestMatch = perfectMatch;
                    } else {
                        // 2. Ha nincs tökéletes, név-hasonlósági algoritmus használata
                        const names = results.map(team => team.name);
                        const similarityResult = findBestMatch(originalLowerName, names);
                        // Magasabb küszöb az elsődleges keresésnél, engedékenyebb az egyszerűsítettnél
                        const similarityThreshold = (attempt === 0) ? 0.7 : 0.6;
                        if (similarityResult.bestMatch.rating > similarityThreshold) {
                            bestMatch = results[similarityResult.bestMatchIndex];
                            console.log(`SportMonks: Hasonlóság (${(similarityResult.bestMatch.rating * 100).toFixed(1)}%) alapján választva "${bestMatch.name}" ehhez: "${teamName}"`);
                        } else {
                            // 3. Ha a hasonlóság alacsony, de van olyan találat, ami TARTALMAZZA az eredeti nevet, azt válasszuk
                             const containingMatch = results.find(team => team.name.toLowerCase().includes(originalLowerName));
                             if(containingMatch) {
                                 bestMatch = containingMatch;
                                 console.log(`SportMonks: Tartalmazás alapján választva "${bestMatch.name}" ehhez: "${teamName}"`);
                             } else {
                                console.warn(`SportMonks: Több találat "${searchName}"-re, de a hasonlóság alacsony. Az elsőt használjuk: "${bestMatch.name}".`);
                             }
                        }
                    }
                }
                teamId = bestMatch.id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
                break; // Megvan a találat, kilépünk a ciklusból
            } else if (response.status !== 404) {
                 // Részletesebb logolás csak ha nem 404
                 const responseDetails = JSON.stringify(response.data)?.substring(0, 300);
                 // Figyelmeztetés, ha előfizetési hibára utal
                 if (responseDetails.includes('plan') || responseDetails.includes('subscription') || responseDetails.includes('does not have access')) {
                    console.warn(`SportMonks figyelmeztetés (${response.status}) Keresés: "${searchName}". Lehetséges előfizetési korlát: ${responseDetails}`);
                    // Ha a kereséshez sincs jog, akkor nincs értelme tovább próbálkozni ezzel a kulccsal
                    teamId = null; // Jelzi, hogy itt a vége
                    break;
                 } else {
                    console.error(`SportMonks API hiba (${response.status}) Keresés: "${searchName}", Válasz: ${responseDetails}`);
                 }
                 // break; // Egyéb hiba esetén is megszakíthatjuk, kivéve ha csak timeout volt
            }
             // Ha 404 vagy üres a lista, megyünk a következő névre
        } catch (error) {
             console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
             // Csak timeout esetén próbálkozzunk tovább a következő névvel
             if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
         // Kis szünet a próbálkozások között, kivéve az utolsót
         if (attempt < namesToTry.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 50));
         }
    }

    sportmonksIdCache.set(cacheKey, teamId || 'not_found'); // Cachelés az eredeti név alapján
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
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
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };

    // ID-k lekérése párhuzamosan
    const [homeTeamId, awayTeamId] = await Promise.all([
        findSportMonksTeamId(homeTeamName),
        findSportMonksTeamId(awayTeamName)
    ]);

    // Ha valamelyik ID hiányzik, nincs értelme meccset keresni
    if (!homeTeamId || !awayTeamId) {
        // A findSportMonksTeamId már logolta a hibát/figyelmeztetést
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureData = null;
    const today = new Date();
    // Visszamenőleg keresünk 3 napot (mai + tegnapi + tegnapelőtti)
    for (let i = 0; i < 3 && !fixtureData; i++) {
        const searchDate = new Date(today);
        searchDate.setDate(today.getDate() - i);
        const dateString = searchDate.toISOString().split('T')[0];

        try {
            // JAVÍTÁS: Direkt keresés a CSAPAT ID-k alapján az adott napon, csak statisztikákat kérünk
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${i + 1}. nap: ${dateString}): ID ${homeTeamId} vs ${awayTeamId}`);
            // makeRequest használata az újrapróbálkozásért és alap hibakezelésért
            const response = await makeRequest(url, { timeout: 7000 });

            if (response?.data?.data?.length > 0) {
                // Keressük a pontos párosítást (H vs A)
                const foundFixture = response.data.data.find(f =>
                    (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                );
                if (foundFixture) {
                    fixtureData = foundFixture;
                    console.log(`SportMonks meccs találat (${dateString})`);
                    break; // Megvan, kilépünk
                } else {
                     console.warn(`SportMonks: Találat ${dateString}-n, de nem a keresett ID párral (${homeTeamId} vs ${awayTeamId}). Lehet fordított a párosítás?`);
                     // Megpróbálhatnánk fordítva is keresni, de bonyolultabbá teszi
                }
            }
             // Ha makeRequest null-t adott vissza, már logolta a hibát
             // Ha a válasz üres volt, megyünk a következő napra
        } catch (e) { /* makeRequest már kezeli */ }
    }

    // Ha 3 nap alatt sem találtunk meccset
    if (!fixtureData) {
        console.log(`SportMonks: Nem található meccs ID ${homeTeamId} vs ${awayTeamId} az elmúlt 3 napban.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    // Adatok kinyerése
    try {
        const extracted = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
        const stats = fixtureData.statistics || [];
        const homeS = stats.find(s => String(s.participant_id) === String(homeTeamId));
        const awayS = stats.find(s => String(s.participant_id) === String(awayTeamId));

        if (homeS) extracted.advanced_stats.home.xg = homeS.xg ?? null;
        if (awayS) extracted.advanced_stats.away.xg = awayS.xg ?? null;

        if(extracted.advanced_stats.home.xg !== null || extracted.advanced_stats.away.xg !== null) console.log(`SportMonks xG adatok sikeresen feldolgozva.`);
        else console.log(`SportMonks meccs megtalálva, de xG adat nem volt elérhető.`);
        return extracted;
    } catch (e) {
        console.error(`Hiba SportMonks adatok feldolgozásakor: ${e.message}`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }
}


// --- PLAYER API (API-SPORTS) FUNKCIÓK (VÉGLEGESEN JAVÍTVA) ---
/**
 * Lekéri a játékosok alap statisztikáit az API-SPORTS API-ból név alapján.
 * Csak az ingyenes terv által engedélyezett szezonokkal próbálkozik.
 * @param {string[]} playerNames A keresendő játékosok neveinek listája.
 * @returns {Promise<object>} Objektum, ahol a kulcsok a játékosnevek, az értékek a statisztikáik.
 */
async function _fetchPlayerData(playerNames) {
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<') || PLAYER_API_KEY.length < 20) return {};
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) return {};

    const playerData = {};
    // JAVÍTÁS: Meghatározzuk az API által engedélyezett legfrissebb évet (pl. 2023)
    const LATEST_ALLOWED_YEAR = 2023; // Ezt kellene ellenőrizni az API-SPORTS doksiban/fiókban
    const yearsToTry = [LATEST_ALLOWED_YEAR, LATEST_ALLOWED_YEAR - 1]; // Csak az engedélyezett éveket próbáljuk

    console.log(`Player API: ${playerNames.length} játékos keresése indul (${yearsToTry.join(', ')} szezonokra)...`);
    let requestCount = 0; const RATE_LIMIT = 8; // API-SPORTS free limit ~10/perc, maradjunk alatta

    for (const playerName of playerNames) {
         const normalizedName = playerName.trim();
         if (!normalizedName) { playerData[playerName] = null; continue; } // Null jelzi a sikertelen keresést

         let foundStats = null;
         let foundPlayerInfo = null; // Csak hogy tudjuk, maga a játékos meglett-e
         const namesToSearch = [normalizedName];
         if (normalizedName.includes(' ')) namesToSearch.push(normalizedName.split(' ').pop()); // Vezetéknév is

         searchLoop: // Címke a külső ciklus megszakításához
         for (const year of yearsToTry) {
             for (const searchName of namesToSearch) {
                 // Rate limit ellenőrzés a ciklus elején
                 if (requestCount >= RATE_LIMIT) {
                     console.warn(`Player API: Rate limit (${RATE_LIMIT}/perc) elérve, várakozás...`);
                     await new Promise(resolve => setTimeout(resolve, 60000)); // 1 perc szünet
                     requestCount = 0;
                 }
                 try {
                     const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(searchName)}&season=${year}`;
                     requestCount++;
                     // console.log(`Player API kérés (${requestCount}): ${searchName} (${year})`); // Csökkentett log

                     // Direkt axios hívás a specifikus hibakezeléshez
                     const response = await axios.get(url, {
                         timeout: 8000,
                         headers: { 'x-rapidapi-host': 'v3.football.api-sports.io', 'x-rapidapi-key': PLAYER_API_KEY },
                          validateStatus: () => true // Minden státuszt elfogadunk
                     });

                      // Rate limit figyelés a válasz fejlécéből (ha van)
                      const remaining = response.headers['x-ratelimit-requests-remaining'];
                      if (remaining === '0') { console.warn("Player API: Rate limit elérve a válasz szerint!"); requestCount = RATE_LIMIT; /* break searchLoop; // Megszakíthatjuk */ }
                      else if (remaining && parseInt(remaining, 10) < 5) console.warn(`Player API: Kevés kérés maradt: ${remaining}`);

                     // Hibakezelés a válasz státusza alapján
                      if (response.status !== 200) {
                          const errorDetails = JSON.stringify(response.data)?.substring(0, 150);
                          // Ha "Free plans do not have access..." hiba, tudjuk, hogy ez a szezon nem jó
                          if (errorDetails.includes('do not have access to this season')) {
                              // Ez várható, nem kell logolni, csak megyünk tovább
                              continue; // Próbáljuk a következőt (név/szezon)
                          } else {
                             // Csak a váratlan hibákat logoljuk
                             console.error(`Player API hiba (${searchName}, ${year}): ${response.status} - ${errorDetails}`);
                          }
                          // Ha jogosultsági vagy limit hiba, nincs értelme tovább próbálkozni
                          if ([401, 403, 429].includes(response.status)) break searchLoop;
                          continue; // Egyéb 4xx hiba esetén is próbáljuk a következőt
                      }


                     // Sikeres (200 OK) válasz feldolgozása
                     if (response.data?.response?.length > 0) {
                         const players = response.data.response;
                          let bestPlayerMatch = players[0];
                          if (players.length > 1) { // Ha több találat, válasszuk a leginkább hasonlót
                              const playerNamesFromApi = players.map(p => p.player.name);
                              const similarityResult = findBestMatch(normalizedName, playerNamesFromApi);
                              // Csak akkor fogadjuk el a hasonlóságit, ha nagyon jó
                              if (similarityResult.bestMatch.rating > 0.85) bestPlayerMatch = players[similarityResult.bestMatchIndex];
                          }
                         // Keressük a statisztikát az ADOTT szezonra
                         const seasonStats = bestPlayerMatch.statistics?.find(s => s.league?.season === year);
                         if (seasonStats) {
                             // console.log(`Player API: Találat "${normalizedName}" -> "${bestPlayerMatch.player.name}" (szezon: ${year})`); // Csökkentett log
                             foundStats = seasonStats;
                             foundPlayerInfo = bestPlayerMatch.player; // Elmentjük a játékos infót is
                             break searchLoop; // Megvan a statisztika ehhez a névhez, kilépünk minden ciklusból
                         } else if (!foundPlayerInfo) {
                              // Megtaláltuk a játékost, de nincs statja ehhez a szezonhoz
                              foundPlayerInfo = bestPlayerMatch.player;
                          }
                     }
                     // Ha nincs találat (response.data.response üres), megyünk tovább a ciklusban
                 } catch (error) { // Hálózati vagy egyéb hiba
                      let errorMessage = `Hiba Player API híváskor (${searchName}, ${year}): ${error.message}`;
                      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') errorMessage += ' (Timeout)';
                      console.error(errorMessage);
                      break searchLoop; // Hiba esetén ne próbálkozzunk tovább ezzel a játékossal
                 }
                 // Kis szünet a nevek/évek között (rate limit miatt fontos lehet)
                 await new Promise(resolve => setTimeout(resolve, 150));
             } // End namesToSearch loop
         } // End yearsToTry loop

         // Eredmény rögzítése a ciklusok után
         if (foundStats) {
              playerData[playerName] = {
                  recent_goals_or_points: foundStats.goals?.total ?? foundStats.goals?.scored ?? 0,
                  key_passes_or_assists_avg: foundStats.passes?.key ?? foundStats.goals?.assists ?? 0,
                  tackles_or_rebounds_avg: foundStats.tackles?.total ?? 0,
                  // Opcionális: Melyik szezonból van az adat?
                  // season: foundStats.league?.season
              };
          } else if (foundPlayerInfo) {
               console.warn(`Player API: Játékos (${foundPlayerInfo.name}) megtalálva, de nincs statisztika ${yearsToTry.join('/')} szezonokra.`);
               playerData[playerName] = {}; // Üres objektum, ha megtaláltuk, de nincs stat
          } else {
              playerData[playerName] = null; // Null jelzi, hogy a játékost sem találtuk meg
          }

         // Szünet a játékosok között
         await new Promise(resolve => setTimeout(resolve, 200));

    } // End player loop

    // Összegzés a végén
    const totalPlayers = playerNames.length;
    const foundWithStats = Object.values(playerData).filter(data => data && Object.keys(data).length > 0).length;
    const foundWithoutStats = Object.values(playerData).filter(data => data && Object.keys(data).length === 0).length;
    const notFound = totalPlayers - foundWithStats - foundWithoutStats;
    console.log(`Player API: ${foundWithStats} játékos statisztikával, ${foundWithoutStats} statisztika nélkül, ${notFound} nem található.`);

    // A null értékeket lecseréljük üres objektumra a konzisztencia végett
    Object.keys(playerData).forEach(key => { if (playerData[key] === null) playerData[key] = {}; });

    return playerData;
}


// --- GEMINI API FUNKCIÓ (JAVÍTVA - responseMimeType nélkül) ---
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Hiányzó Gemini API kulcs.");
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        // tools: [{ "googleSearchRetrieval": {} }] // KIKAPCSOLVA
    };
    try {
        const response = await axios.post(GEMINI_API_URL, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 90000, validateStatus: () => true });
        if (response.status !== 200) {
             let errorMsg = `Gemini API HTTP hiba (${response.status}).`; let responseDetails = ""; try { responseDetails = JSON.stringify(response.data)?.substring(0, 500); } catch { responseDetails = String(response.data)?.substring(0, 500); }
             if (response.status === 400 && responseDetails.toLowerCase().includes('<html')) { errorMsg = "Gemini API hiba (400 Bad Request)"; console.error(errorMsg); throw new Error(errorMsg); }
             console.error(`${errorMsg} Részletek: ${responseDetails}`); if (response.status === 429) throw new Error("Gemini API rate limit elérve."); if (response.status === 400 && errorDetails.includes('API key not valid')) throw new Error("Érvénytelen Gemini API kulcs."); throw new Error(`Gemini API hiba (${response.status}).`);
        }
        const candidate = response.data?.candidates?.[0]; const responseText = candidate?.content?.parts?.[0]?.text; const finishReason = candidate?.finishReason;
        if (!responseText) { const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category; console.error(`Gemini API válasz hiba: Nincs 'text'. FinishReason: ${finishReason}. BlockReason: ${blockReason}.`); if (finishReason === 'SAFETY' || blockReason) throw new Error(`Az AI válaszát biztonsági szűrők blokkolták (${blockReason || 'SAFETY'}).`); if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt."); throw new Error(`AI válasz hiba (${finishReason || 'Hiányzó válasz'}).`); }
        let cleanedJsonString = responseText.trim(); const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/); if (jsonMatch?.[1]) cleanedJsonString = jsonMatch[1]; if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{')); if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);
        try { JSON.parse(cleanedJsonString); return cleanedJsonString; }
        catch (jsonError) { console.error(`Gemini válasz nem valid JSON: ${jsonError.message}`, cleanedJsonString.substring(0,500)); throw new Error("Az AI válasza nem volt érvényes JSON."); }
    } catch (e) { if (axios.isAxiosError(e) && !e.response) { console.error(`Hiba a Gemini API hívás során (hálózat/timeout): ${e.message}`); throw new Error(`Gemini API hálózati hiba.`); } console.error(`Végleges hiba a Gemini API hívás során: ${e.message}`); throw e; }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (VÉGLEGESEN JAVÍTVA - Garantált rawStats) ---
/**
 * Összegyűjti az összes szükséges adatot egy meccshez: Gemini kontextus, SportMonks statok, Játékos statok.
 * Kezeli a cache-elést. Garantálja a 'rawStats' objektum meglétét.
 * @param {string} sport A sportág.
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object>} Az összesített adatok objektuma.
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName) { // leagueName hozzáadva
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v27_final_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió
    const cached = scriptCache.get(ck);
    if (cached) { console.log(`Cache találat (${ck})`); return { ...cached, fromCache: true }; }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        // Párhuzamos adatgyűjtés: Gemini és SportMonks
        const [geminiJsonString, sportMonksDataResult] = await Promise.all([
             _callGeminiWithSearch( // Gemini hívás
                 `CRITICAL TASK: Provide valid JSON for ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Use internal knowledge. Focus: H2H (last 5 structured + summary), team news (absentees: name, importance + impact analysis), recent form (overall & home/away), expected tactics (style), key players (name, role). NO extra text/markdown. STRUCTURE: {"stats":{"home":{},"away":{}},"h2h_summary":"<summary>","h2h_structured":[{"date":"YYYY-MM-DD","score":"H-A"}],"team_news":{"home":"<news>","away":"<news>"},"absentees":{"home":[{"name":"<Player>","importance":"<key|important|squad>"}],"away":[]},"absentee_impact_analysis":"<analysis>","form":{"home_overall":"<W-D-L>","away_overall":"<W-D-L>","home_home":"<W-D-L>","away_away":"<W-D-L>"},"tactics":{"home":{"style":"<Style>"},"away":{"style":"<Style>"}},"key_players":{"home":[{"name":"<Name>","role":"<Role>"}],"away":[]}}`
             ), // Hibát a hívó függvény már kezeli és dobja, ha kritikus
             _fetchSportMonksData(sport, homeTeamName, awayTeamName) // Ez null-t ad vissza hiba esetén
         ]);

        // Ha a Gemini hívás kritikus hibával elszállt, itt már nem folytatjuk
        if (!geminiJsonString) throw new Error("A Gemini API hívás sikertelen volt.");
        let geminiData;
         try {
             geminiData = JSON.parse(geminiJsonString); // Itt már valid JSON-t várunk
         } catch (e) {
             console.error(`A kapott Gemini válasz nem volt érvényes JSON: ${e.message}`);
             throw new Error("A Gemini válasza feldolgozhatatlan volt (JSON parse error).");
         }

        // Játékosadatok lekérése
        const playerNames = [...(geminiData?.key_players?.home || []), ...(geminiData?.key_players?.away || [])].map(p => p?.name).filter(Boolean);
        const detailedPlayerData = playerNames.length > 0 ? await _fetchPlayerData(playerNames) : {};

        // --- Adatok EGYESÍTÉSE és NORMALIZÁLÁSA ---
        const finalData = {};

        // Alap statisztikák (Gemini-ból, VAGY ha az hiányos, 0 értékekkel)
        // JAVÍTÁS: Garantáljuk a 'rawStats' objektum meglétét és a numerikus értékeket
        const parseStat = (val) => (typeof val === 'number' && !isNaN(val) ? val : 0);
        finalData.stats = {
            home: {
                 gp: parseStat(geminiData.stats?.home?.gp),
                 gf: parseStat(geminiData.stats?.home?.gf),
                 ga: parseStat(geminiData.stats?.home?.ga),
             },
             away: {
                 gp: parseStat(geminiData.stats?.away?.gp),
                 gf: parseStat(geminiData.stats?.away?.gf),
                 ga: parseStat(geminiData.stats?.away?.ga),
             }
         };
         // Ha a Gemini egyáltalán nem adott statisztikát, vagy üres volt
         if (finalData.stats.home.gp === 0 && finalData.stats.away.gp === 0 && (Object.keys(geminiData.stats?.home || {}).length > 0 || Object.keys(geminiData.stats?.away || {}).length > 0) ) {
             console.warn("Figyelmeztetés: Gemini nem adott érvényes alap statisztikákat (gp, gf, ga). 0 értékek használva.");
         } else if (!geminiData.stats) {
             console.warn("Figyelmeztetés: Gemini egyáltalán nem adott 'stats' objektumot. 0 értékek használva.");
         }


        // Többi adat normalizálása
        finalData.h2h_summary = geminiData.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData.absentee_impact_analysis || "N/A";
        finalData.form = geminiData.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = geminiData.tactics || { home: { style: "N/A" }, away: { style: "N/A" } };
        finalData.key_players = { home: [], away: [] };
            (geminiData.key_players?.home || []).forEach(p => { if (p?.name) finalData.key_players.home.push({ ...p, stats: detailedPlayerData[p.name] ?? {} }); }); // ?? {} a null helyett
            (geminiData.key_players?.away || []).forEach(p => { if (p?.name) finalData.key_players.away.push({ ...p, stats: detailedPlayerData[p.name] ?? {} }); }); // ?? {} a null helyett
        finalData.advanced_stats = { home: { xg: sportMonksDataResult?.advanced_stats?.home?.xg ?? null }, away: { xg: sportMonksDataResult?.advanced_stats?.away?.xg ?? null } };
        finalData.referee = sportMonksDataResult?.referee || { name: 'N/A', stats: 'N/A' };
        finalData.league_averages = geminiData.league_averages || {};

        // Gazdag kontextus string
        const richContext = [ `- H2H: ${finalData.h2h_summary}`, `- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`, `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name}(${p.importance})`).join(', ') || 'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name}(${p.importance})`).join(', ') || 'Nincs'}`, `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`, `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`, `- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}` ].join('\n');

        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advanced_stats, form: finalData.form, rawData: finalData };

        // KRITIKUS ELLENŐRZÉS: Van-e értelmes alap statisztika a továbblépéshez?
        // Ha mindkét csapatnál 0 a lejátszott meccs (gp), akkor az elemzésnek nincs értelme.
        if (result.rawStats.home.gp === 0 && result.rawStats.away.gp === 0) {
             console.error(`KRITIKUS HIBA: Az alap statisztikák (rawStats) lekérése sikertelen vagy hiányos (gp=0 mindkét csapatnál). Elemzés nem lehetséges.`);
             throw new Error("Kritikus csapat statisztikák (rawStats) lekérése sikertelen vagy hiányos.");
         }

        scriptCache.set(ck, result); // Cachelés csak akkor, ha van értelmes adat
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) { console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`); throw new Error(`Adatgyűjtési hiba: ${e.message}`); }
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

    // 1. Nyitó szorzók feldolgozása
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key]; const currentOdds = []; const allMarkets = [];
            if (matchData.h2h) { allMarkets.push({ key: 'h2h', outcomes: matchData.h2h }); (matchData.h2h || []).forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (typeof name === 'string') { const ln = name.toLowerCase(); if (ln === homeTeam.toLowerCase()) name = 'Hazai győzelem'; else if (ln === awayTeam.toLowerCase()) name = 'Vendég győzelem'; else if (ln === 'draw') name = 'Döntetlen'; } currentOdds.push({ name: name, price: price }); } }); }
            if (matchData.totals) { allMarkets.push({ key: 'totals', outcomes: matchData.totals }); const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = matchData.totals.find(o => o.point === mainLine && o.name === 'Over'); const under = matchData.totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); }
            if (currentOdds.length > 0) { console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`); return { current: currentOdds, allMarkets: allMarkets, fromCache: true, sport: sport }; }
             else { /* console.log(`Nem sikerült érvényes szorzókat feldolgozni az openingOdds-ból (${key})`); */ }
        } catch (e) { console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}.`); }
    } else { /* console.log(`Nincs nyitó szorzó (frontendről) a ${key} meccshez`); */ }

    // 2. Cache
    const cacheKey = `live_odds_v4_${sport}_${key}_${leagueName || 'noliga'}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) { console.log(`Élő szorzók használva (cache) a ${key} meccshez.`); return { ...cachedOdds, fromCache: true }; }

    // 3. API hívás
    console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam} (${leagueName || 'általános'})`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (liveOddsData?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    } else { console.warn(`Nem sikerült élő szorzókat lekérni: ${homeTeam} vs ${awayTeam}`); return null; }
}

/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból, a liga neve alapján választva API kulcsot.
 * Intelligens név-egyeztetést használ a meccs megtalálásához.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa.
 * @param {object} sportConfig A sportág konfigurációja.
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object|null>} Az odds adatok vagy null hiba esetén.
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    // Liga alapján választunk kulcsot, vagy az alap sportkulcsot használjuk
    const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_sport_key || null);
    if (!ODDS_API_KEY || !oddsApiKey || !sportConfig.odds_api_sport_key) { console.error(`getOddsData: Hiányzó kulcsok/konfig ${sport}/${leagueName}-hoz.`); return null; }
    // Az URL-ben a sportConfig.odds_api_sport_key megy, a sports paraméterbe a liga(ák) kulcsa(i)
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${oddsApiKey}`;

    try {
        console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`);
        const response = await makeRequest(url, { timeout: 10000 }); // Növelt timeout
        if (!response?.data || !Array.isArray(response.data)) {
             // Ha a specifikus kulcs nem adott vissza adatot, és ez NEM az általános sportkulcs volt, próbáljuk az általánossal
             if (oddsApiKey !== sportConfig.odds_api_sport_key) {
                 console.warn(`Odds API (${oddsApiKey}): Nem adott vissza adatot, próbálkozás az általános (${sportConfig.odds_api_sport_key}) kulccsal...`);
                 return getOddsData(homeTeam, awayTeam, sport, sportConfig, null); // Rekurzív hívás liga nélkül
             }
             console.warn(`Odds API (${oddsApiKey}): Nem érkezett adat.`); // Ha már az általánossal sem ment
             return null;
        }

        const oddsData = response.data; const lowerHome = homeTeam.toLowerCase().trim(); const lowerAway = awayTeam.toLowerCase().trim();
        let bestMatch = null; let highestRating = 0.65; // Közepes-magas küszöb

        for (const match of oddsData) {
            if (!match.home_team || !match.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim(); const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeSim = findBestMatch(lowerHome, [apiHomeLower]).bestMatch.rating; const awaySim = findBestMatch(lowerAway, [apiAwayLower]).bestMatch.rating;
            const avgSim = (homeSim * 0.6 + awaySim * 0.4); // Súlyozott átlag
            if (avgSim > highestRating) { highestRating = avgSim; bestMatch = match; }
        }

        if (!bestMatch) { console.warn(`Odds API (${oddsApiKey}): Nem található még hasonlóság alapján sem meccs: ${homeTeam} vs ${awayTeam}.`); return null; }
        // Ha a hasonlóság még mindig alacsony, ÉS a nevek nem tartalmazzák egymást, visszautasítjuk
        if (highestRating < 0.7 && !(bestMatch.home_team.toLowerCase().includes(lowerHome) || bestMatch.away_team.toLowerCase().includes(lowerAway))) {
             console.warn(`Odds API (${oddsApiKey}): Legjobb találat (${bestMatch.home_team} vs ${bestMatch.away_team}) hasonlósága (${(highestRating * 100).toFixed(1)}%) túl alacsony.`);
             return null;
         }

        console.log(`Odds API (${oddsApiKey}): Megtalált meccs (hasonlóság: ${(highestRating * 100).toFixed(1)}%): "${bestMatch.home_team}" vs "${bestMatch.away_team}"`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) { console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' adat: ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }

        const currentOdds = []; const allMarkets = bookmaker.markets;
        const h2h = allMarkets.find(m => m.key === 'h2h')?.outcomes;
        const totals = allMarkets.find(m => m.key === 'totals')?.outcomes;

        if (h2h) { h2h.forEach(o => { const price = parseFloat(o.price); if (!isNaN(price) && price > 1) { let name = o.name; if (name === bestMatch.home_team) name = 'Hazai győzelem'; else if (name === bestMatch.away_team) name = 'Vendég győzelem'; else if (name === 'Draw') name = 'Döntetlen'; currentOdds.push({ name: name, price: price }); } }); }
        if (totals) { const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line; const over = totals.find(o => o.point === mainLine && o.name === 'Over'); const under = totals.find(o => o.point === mainLine && o.name === 'Under'); if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price }); if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price }); }

        if (currentOdds.length > 0) { return { current: currentOdds, allMarkets: allMarkets, sport: sport }; }
        else { console.warn(`Nem sikerült érvényes szorzókat kinyerni (${oddsApiKey}): ${bestMatch.home_team} vs ${bestMatch.away_team}`); return null; }

    } catch (e) { console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`); return null; }
}


// --- findMainTotalsLine (VÁLTOZATLAN) ---
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
            if (!isNaN(diff) && diff < closestPair.diff) closestPair = { diff, line: point };
        }
    }
    if (closestPair.diff === Infinity && points.includes(defaultLine)) return defaultLine;
    if (closestPair.line === defaultLine && closestPair.diff === Infinity && points.length > 0) return points.sort((a,b) => Math.abs(a - defaultLine) - Math.abs(b-defaultLine))[0];
    return closestPair.line;
}

// --- fetchOpeningOddsForAllSports (MARADHAT AZ ELŐZŐ) ---
// Ez a függvény jelenleg nem kritikus a fő működéshez
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)..."); let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) {
        const sportConfig = SPORT_CONFIG[sport];
        if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league || !sportConfig.odds_api_sport_key) continue;
        const allLeagueKeys = Object.keys(sportConfig.odds_api_keys_by_league).join(',');
        if (!allLeagueKeys) continue;
         const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&sports=${allLeagueKeys}`;
        try {
            // console.log(`Odds API kérés (GetAll - ${sport})...`); // Csökkentett log
            const response = await makeRequest(url, { timeout: 20000 }); // Hosszabb timeout
            if (response?.data && Array.isArray(response.data)) {
                response.data.forEach(match => {
                     if (!match?.home_team || !match?.away_team) return;
                     const key = `${match.home_team.toLowerCase().trim().replace(/\s+/g, '')}_vs_${match.away_team.toLowerCase().trim().replace(/\s+/g, '')}`;
                     const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
                     if (bookmaker?.markets) { const odds = {}; const h2h = bookmaker.markets.find(m => m.key === 'h2h')?.outcomes; const totals = bookmaker.markets.find(m => m.key === 'totals')?.outcomes; if (h2h) odds.h2h = h2h; if (totals) odds.totals = totals; if (Object.keys(odds).length > 0) allOdds[key] = odds; }
                });
                // console.log(`Odds API (GetAll - ${sport}): ${Object.keys(allOdds).length} meccs szorzója feldolgozva.`);
            }
        } catch (e) { /* makeRequest kezeli */ }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`);
    return allOdds;
}


// --- _getFixturesFromEspn (VÁLTOZATLAN) ---
/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája objektumként [{id, home, away, utcKickoff, league}].
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.name || !sportConfig.espn_leagues) { console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`); return []; }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); });
    const promises = [];
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) continue; const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push( makeRequest(url, { timeout: 6000 }).then(response => { if (!response?.data?.events) return []; return response.data.events .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') .map(event => { const competition = event.competitions?.[0]; const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team; const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team; if (event.id && home?.name && away?.name && event.date) { return { id: String(event.id), home: String(home.shortDisplayName || home.displayName || home.name).trim(), away: String(away.shortDisplayName || away.displayName || away.name).trim(), utcKickoff: event.date, league: String(leagueName).trim() }; } return null; }).filter(Boolean) || []; }) );
             await new Promise(resolve => setTimeout(resolve, 30)); // Rate limit
        }
    }
    const results = await Promise.all(promises); const uniqueFixturesMap = new Map();
    results.flat().forEach(fixture => { if (fixture?.id && !uniqueFixturesMap.has(fixture.id)) uniqueFixturesMap.set(fixture.id, fixture); });
    const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`); return finalFixtures;
}