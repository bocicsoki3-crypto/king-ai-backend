import axios from 'axios';
import NodeCache from 'node-cache';
// JAVÍTÁS: Behívjuk az új getOddsApiKeyForLeague függvényt is
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY, getOddsApiKeyForLeague } from './config.js';
import pkg from 'string-similarity'; // Név-hasonlósági csomag importálása
const { findBestMatch } = pkg;

// Cache a gyakori API hívások eredményeinek tárolására
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 }); // Általános cache (4 óra)
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // SportMonks ID cache (nem jár le) - Klonozás kikapcsolva
const oddsCache = new NodeCache({ stdTTL: 60 * 15 }); // Odds cache (15 perc)

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Robusztus SportMonks ID és meccskeresés név-hasonlósággal.
* VÉGLEGES JAVÍTÁS: Pontosított Player API (API-SPORTS) adatfeldolgozás.
* VÉGLEGES JAVÍTÁS: Intelligens Odds API hívás liga alapján.
**************************************************************/

// --- BELSŐ SEGÉDFÜGGVÉNYEK AZ API-KHOZ ---

/**
 * Megkeresi egy csapat SportMonks ID-ját név alapján, intelligens név-összevetéssel és hasonlósági algoritmussal.
 * Gyorsítótárazza az eredményt.
 * @param {string} teamName Az ESPN-től kapott csapatnév.
 * @returns {Promise<string|null>} A csapat SportMonks ID-ja vagy null.
 */
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase();
    const cacheKey = `sportmonks_id_v2_${originalLowerName.replace(/\s+/g, '')}`; // Verziózott kulcs
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) { // Ellenőrizzük az undefined-ot, mert a null lehet valid cache érték ('not_found')
        // console.log(`SportMonks ID cache ${cachedResult === 'not_found' ? 'miss (not found)' : 'hit'} for "${teamName}"`);
        return cachedResult === 'not_found' ? null : cachedResult;
    }

    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        sportmonksIdCache.set(cacheKey, 'not_found');
        return null;
    }

    // Manuális térkép a leggyakoribb problémás esetekre
    const TEAM_NAME_MAP = {
        'genk': 'KRC Genk',
        'betis': 'Real Betis',
        'red star': 'Red Star Belgrade',
        'sparta': 'Sparta Prague',
        // 'inter': 'Internazionale' // Példa más gyakori esetre
    };
    const searchName = TEAM_NAME_MAP[originalLowerName] || teamName; // Első körben a térkép vagy az eredeti

    try {
        const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
        console.log(`SportMonks ID keresés: "${searchName}" (eredeti: "${teamName}")`);
        const response = await axios.get(url, { timeout: 7000 }); // Picit hosszabb timeout

        if (response.data?.data?.length > 0) {
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
                    if (similarityResult.bestMatch.rating > 0.6) { // Csak ha elég magas a hasonlóság (pl. 60%)
                        bestMatch = results[similarityResult.bestMatchIndex];
                        console.log(`SportMonks: Hasonlóság alapján választva "${bestMatch.name}" (${(similarityResult.bestMatch.rating * 100).toFixed(1)}%) ehhez: "${teamName}"`);
                    } else {
                        console.warn(`SportMonks: Több találat "${searchName}"-re, de a hasonlóság (${(similarityResult.bestMatch.rating * 100).toFixed(1)}%) alacsony. Az elsőt használjuk: "${bestMatch.name}".`);
                    }
                }
            }

            const teamId = bestMatch.id;
            console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
            sportmonksIdCache.set(cacheKey, teamId);
            return teamId;
        } else {
            // Ha az első keresés sikertelen, próbáljunk egy egyszerűsített nevet (pl. FC nélkül)
            const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as)\s+/i, '').trim();
            if (simplifiedName.toLowerCase() !== originalLowerName && !TEAM_NAME_MAP[originalLowerName]) {
                 console.log(`SportMonks: Második keresési próba egyszerűsített névvel: "${simplifiedName}"`);
                 // Rekurzív hívás helyett újra lefuttatjuk a logikát, de cache nélkül
                 const fallbackUrl = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(simplifiedName)}?api_token=${SPORTMONKS_API_KEY}`;
                 const fallbackResponse = await axios.get(fallbackUrl, { timeout: 5000 });
                 if (fallbackResponse.data?.data?.length > 0) {
                     // Itt is alkalmazzuk a legjobb találat logikát
                     let fallbackBestMatch = fallbackResponse.data.data[0];
                     if (fallbackResponse.data.data.length > 1) {
                        const names = fallbackResponse.data.data.map(team => team.name);
                        const similarityResult = findBestMatch(originalLowerName, names);
                         if (similarityResult.bestMatch.rating > 0.5) { // Itt lehetünk engedékenyebbek
                            fallbackBestMatch = fallbackResponse.data.data[similarityResult.bestMatchIndex];
                         }
                     }
                     const teamId = fallbackBestMatch.id;
                     console.log(`SportMonks ID TALÁLAT (egyszerűsített): "${teamName}" -> "${fallbackBestMatch.name}" -> ${teamId}`);
                     sportmonksIdCache.set(cacheKey, teamId);
                     return teamId;
                 }
            }

            console.warn(`SportMonks: Nem található ID a következő névvel: "${searchName}" (eredeti: "${teamName}")`);
            sportmonksIdCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor (${searchName}): ${error.response.status} - ${JSON.stringify(error.response.data)?.substring(0, 200)}`);
        } else {
            console.error(`Általános hiba a SportMonks csapat ID lekérésekor (${searchName}): ${error.message}`);
        }
        sportmonksIdCache.set(cacheKey, 'not_found'); // Hibát is cacheljük, hogy ne próbálkozzon újra azonnal
        return null;
    }
}


/**
 * Lekéri a haladó statisztikákat (főleg xG) a SportMonks API-ból a csapat ID-k alapján.
 * @param {string} sport A sportág (jelenleg csak 'soccer').
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @returns {Promise<object>} A feldolgozott SportMonks adatok (advanced_stats, referee).
 */
async function _fetchSportMonksData(sport, homeTeamName, awayTeamName) {
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    const [homeTeamId, awayTeamId] = await Promise.all([
        findSportMonksTeamId(homeTeamName),
        findSportMonksTeamId(awayTeamName)
    ]);

    if (!homeTeamId || !awayTeamId) {
        console.log(`_fetchSportMonksData: Hiányzó SportMonks ID valamelyik csapathoz (${homeTeamName}:${homeTeamId} vs ${awayTeamName}:${awayTeamId}), lekérdezés kihagyva.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureData = null;
    let attempts = 0;
    const today = new Date();

    // Visszamenőleg keresünk 3 napot (mai + tegnapi + tegnapelőtti) a nagyobb biztonságért
    while (!fixtureData && attempts < 3) {
        const searchDate = new Date(today);
        searchDate.setDate(today.getDate() - attempts);
        const dateString = searchDate.toISOString().split('T')[0];

        try {
            // JAVÍTÁS: Direkt keresés a CSAPAT ID-k alapján az adott napon
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${attempts + 1}. nap: ${dateString}): ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId})`);
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });

            if (response.status === 200 && Array.isArray(response.data.data) && response.data.data.length > 0) {
                // Mivel direkt ID-ra kerestünk, az első találatnak jónak kell lennie, de ellenőrizzük
                const foundFixture = response.data.data.find(f =>
                    (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                );
                if (foundFixture) {
                    fixtureData = foundFixture;
                    console.log(`SportMonks meccs találat (${dateString}): ${homeTeamName} vs ${awayTeamName}`);
                    break; // Megvan a meccs, kilépünk a ciklusból
                } else {
                    // Előfordulhat, hogy a filter ellenére más meccset ad vissza, logoljuk
                    console.warn(`SportMonks: Találat ${dateString}-n, de nem a keresett ID párral (${homeTeamId} vs ${awayTeamId}).`);
                }
            } else if (response.status !== 404) { // 404 normális, ha nincs meccs aznap
                 // Részletesebb hiba logolása
                 const responseDetails = JSON.stringify(response.data)?.substring(0, 300);
                 console.error(`SportMonks API hiba (${response.status}) Dátum: ${dateString}, Válasz: ${responseDetails}`);
                 // Ha 'plan' vagy 'subscription' hiba, akkor valószínűleg nincs hozzáférésünk
                 if (responseDetails.includes('plan') || responseDetails.includes('subscription')) {
                     console.error("SportMonks: Lehetséges előfizetési hiba vagy korlátozott hozzáférés.");
                     // Itt akár le is állíthatnánk a további próbálkozást erre a sessionre.
                     // sportmonksIdCache.set(`error_flag_${SPORTMONKS_API_KEY}`, true, 3600); // Pl. 1 órára
                     return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
                 }
            }
        } catch (e) {
             if (axios.isAxiosError(e)) {
                console.error(`Általános hiba SportMonks API hívásakor (${dateString}): ${e.message}`);
             } else {
                 console.error(`Feldolgozási hiba SportMonks válaszában (${dateString}): ${e.message}`);
             }
        }
        attempts++;
    }

    // Ha 3 nap alatt sem találtunk meccset
    if (!fixtureData) {
        console.log(`SportMonks: Nem található meccs ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId}) az elmúlt 3 napban.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    // Adatok kinyerése és feldolgozása
    try {
        const extractedData = { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
        const fixtureStats = fixtureData.statistics || [];
        const homeStatsSM = fixtureStats.find(s => String(s.participant_id) === String(homeTeamId));
        const awayStatsSM = fixtureStats.find(s => String(s.participant_id) === String(awayTeamId));

        // xG adatok hozzáadása, ha elérhetőek
        if (homeStatsSM) {
            extractedData.advanced_stats.home.xg = homeStatsSM.xg ?? null;
            // Itt lehetne több statisztikát is hozzáadni a jövőben, pl. possessiontime, fouls, corners
        }
        if (awayStatsSM) {
            extractedData.advanced_stats.away.xg = awayStatsSM.xg ?? null;
        }

        console.log(`SportMonks adatok (xG) feldolgozva: ${homeTeamName} vs ${awayTeamName}`);
        return extractedData;

    } catch (e) {
        console.error(`Hiba SportMonks adatok feldolgozásakor (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } }; // Üres adatokkal térünk vissza hiba esetén
    }
}


/**
 * Lekéri a játékosok alap statisztikáit az API-SPORTS API-ból név alapján.
 * @param {string[]} playerNames A keresendő játékosok neveinek listája.
 * @returns {Promise<object>} Objektum, ahol a kulcsok a játékosnevek, az értékek a statisztikáik.
 */
async function _fetchPlayerData(playerNames) {
    // Ha nincs kulcs vagy érvénytelen, ne is próbálkozzunk
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<') || PLAYER_API_KEY.length < 20) { // Rövid sanity check a kulcsra
        // console.log("Player API hívás kihagyva: Nincs valós API kulcs beállítva.");
        return {};
    }
    // Ha üres a lista, nincs mit keresni
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) {
        return {};
    }

    const playerData = {};
    const currentYear = new Date().getFullYear(); // Az aktuális szezonra keresünk

    console.log(`Player API: ${playerNames.length} játékos keresése indul...`);

    // Párhuzamos kérések küldése (limitálva, hogy ne terheljük túl az API-t)
    const MAX_CONCURRENT_REQUESTS = 3;
    const results = [];
    for (let i = 0; i < playerNames.length; i += MAX_CONCURRENT_REQUESTS) {
        const batchNames = playerNames.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const batchPromises = batchNames.map(async (playerName) => {
            const normalizedName = playerName.trim();
            if (!normalizedName) return { name: playerName, data: null }; // Üres név

            try {
                const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(normalizedName)}&season=${currentYear}`;
                // console.log(`Player API kérés: ${normalizedName}`); // Csökkentett logolás

                const response = await axios.get(url, {
                    timeout: 8000, // Picit növelt timeout
                    headers: {
                        'x-rapidapi-host': 'v3.football.api-sports.io',
                        'x-rapidapi-key': PLAYER_API_KEY
                    }
                });

                 // API hívás limit ellenőrzése
                 if (response.headers['x-ratelimit-requests-remaining'] === '0') {
                    console.warn("Player API: Elértük a napi kérelmi limitet!");
                 }
                  if (response.headers['x-ratelimit-requests-remaining'] && parseInt(response.headers['x-ratelimit-requests-remaining'], 10) < 10) {
                      console.warn(`Player API: Kevés kérés maradt mára: ${response.headers['x-ratelimit-requests-remaining']}`);
                  }


                // Válasz feldolgozása
                if (response.data?.response?.length > 0) {
                    const playerInfo = response.data.response[0]; // Első találat
                    // Keressük az aktuális szezon statisztikáit, vagy az utolsót
                    const seasonStats = playerInfo.statistics?.find(s => s.league?.season === currentYear) || playerInfo.statistics?.[0];

                    if (seasonStats) {
                        return { name: playerName, data: seasonStats };
                    } else {
                        console.warn(`Player API: Találat (${normalizedName}), de nincs statisztika a(z) ${currentYear} szezonra.`);
                         return { name: playerName, data: null }; // Nincs statisztika
                    }
                } else {
                    // console.warn(`Player API: Nem található játékos: ${normalizedName}`); // Csökkentett logolás
                    return { name: playerName, data: null }; // Nincs találat
                }
            } catch (error) {
                // Részletesebb hibakezelés
                let errorMessage = error.message;
                 if (axios.isAxiosError(error)) {
                    errorMessage = `Axios hiba: ${error.message}`;
                    if (error.response) {
                        errorMessage += ` | Státusz: ${error.response.status} | Válasz: ${JSON.stringify(error.response.data)?.substring(0, 100)}`;
                    } else if (error.request) {
                         errorMessage += " | Nem érkezett válasz";
                     }
                 }
                console.error(`Hiba a Player API hívás során (${normalizedName}): ${errorMessage}`);
                return { name: playerName, data: null }; // Hiba esetén is null
            }
        });
        results.push(...await Promise.all(batchPromises));
         // Kis szünet a batch-ek között
         if (i + MAX_CONCURRENT_REQUESTS < playerNames.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
         }
    }

    // Eredmények feldolgozása
    results.forEach(result => {
        if (result.data) {
            const stats = result.data;
             // JAVÍTÁS: Robusztusabb adatkinyerés, több lehetséges mezőnévvel
             playerData[result.name] = {
                 recent_goals_or_points: stats.goals?.total ?? stats.goals?.scored ?? 0,
                 key_passes_or_assists_avg: stats.passes?.key ?? stats.goals?.assists ?? 0, // Gólpassz is jó lehet
                 tackles_or_rebounds_avg: stats.tackles?.total ?? 0,
                 // Opcionálisan további adatok:
                 // minutes_played: stats.games?.minutes ?? 0,
                 // rating: parseFloat(stats.games?.rating) || null
             };
        } else {
            playerData[result.name] = {}; // Ha nem volt adat vagy hiba történt
        }
    });


    const foundCount = Object.keys(playerData).filter(k => Object.keys(playerData[k]).length > 0).length;
    console.log(`Player API adatok feldolgozva ${foundCount}/${playerNames.length} játékosra.`);
    return playerData;
}


/**
 * Meghívja a Gemini API-t a megadott prompttal. Kezeli a hibákat.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string>} A Gemini válasza JSON stringként.
 */
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Hiányzó GEMINI_API_KEY.");

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.3, // Még alacsonyabb hőmérséklet a stabilabb JSON-ért
            maxOutputTokens: 8192,
            responseMimeType: "application/json", // Explicit JSON választ kérünk
        },
        // A keresés itt szándékosan KI van kapcsolva (gemini-2.5-pro limitáció)
        // tools: [{ "googleSearchRetrieval": {} }]
    };

    try {
        const response = await axios.post(GEMINI_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000,
            validateStatus: (status) => status < 500 // Elfogadjuk a 4xx hibákat is a jobb elemzéshez
        });

        // Hibakezelés a státuszkód alapján
         if (response.status === 429) { // Túl sok kérés
             console.error("Gemini API hiba (429): Túl sok kérés. Valószínűleg elértük a rate limitet.");
             throw new Error("Gemini API rate limit elérve.");
         } else if (response.status >= 400) {
              const errorDetails = JSON.stringify(response.data)?.substring(0, 500);
              console.error(`Gemini API HTTP hiba (${response.status}): ${errorDetails}`);
               // Speciális hibaüzenet, ha a kulcs érvénytelen
               if (response.status === 400 && errorDetails.includes('API key not valid')) {
                  throw new Error("Érvénytelen Gemini API kulcs.");
               }
              throw new Error(`Gemini API hiba (${response.status}).`);
          }


        // Robusztusabb válaszfeldolgozás
        const candidate = response.data?.candidates?.[0];
        // Mivel JSON-t kértünk, a text mezőnek közvetlenül a JSON stringet kell tartalmaznia
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
             const blockReason = candidate?.safetyRatings?.find(r => r.blocked)?.category; // Próbáljuk meg kideríteni a blokkolás okát
             console.error(`Gemini API válasz hiba: Nincs 'text' a válaszban. FinishReason: ${finishReason}. BlockReason: ${blockReason}. Teljes válasz (részlet): ${JSON.stringify(response.data)?.substring(0, 500)}`);
             if (finishReason === 'SAFETY' || blockReason) throw new Error(`Az AI válaszát biztonsági szűrők blokkolták (${blockReason || 'Ismeretlen ok'}).`);
             if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt (max_output_tokens).");
             if (finishReason === 'RECITATION') throw new Error("Az AI válasza idézési problémák miatt blokkolva.");
             throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Ismeretlen vagy hiányzó válasz'}`);
         }


        // Mivel explicit JSON-t kértünk, itt már nem kellene tisztítani, de egy alap ellenőrzés nem árt
        const cleanedJsonString = responseText.trim();
        if (!cleanedJsonString.startsWith('{') || !cleanedJsonString.endsWith('}')) {
             console.warn("Gemini válasz nem tűnik teljes JSON-nak, bár application/json-t kértünk.");
             // Itt lehetne egy óvatosabb tisztítási kísérlet, de inkább dobjunk hibát, ha nem tökéletes
             // throw new Error("Az AI válasza nem volt érvényes JSON formátumú annak ellenére, hogy azt kértük.");
        }


        // JSON validálás (bár elvileg már validnak kellene lennie)
        try {
            JSON.parse(cleanedJsonString);
            return cleanedJsonString; // Visszaadjuk a (remélhetőleg) tiszta JSON stringet
        } catch (jsonError) {
             console.error(`Gemini válasz nem valid JSON a várt formátum ellenére sem: ${jsonError.message}`);
             console.error("Hibás JSON string (első 500 karakter):", cleanedJsonString.substring(0, 500));
             throw new Error("Az AI válasza feldolgozhatatlan volt (JSON parse error).");
        }

    } catch (e) {
        // Átfogóbb hibakezelés
         if (!axios.isAxiosError(e)) { // Ha már fentebb kezeltük az Axios hibát, ne logoljuk újra
            console.error(`Általános hiba a Gemini API hívás során: ${e.message}`);
         }
        // Dobjuk tovább az eredeti vagy egy új hibát
        throw new Error(`Gemini API hívás sikertelen: ${e.message}`);
    }
}


/**
 * Összegyűjti az összes szükséges adatot egy meccshez: Gemini kontextus, SportMonks statok, Játékos statok.
 * Kezeli a cache-elést.
 * @param {string} sport A sportág.
 * @param {string} homeTeamName Hazai csapat neve.
 * @param {string} awayTeamName Vendég csapat neve.
 * @returns {Promise<object>} Az összesített adatok objektuma.
 */
export async function getRichContextualData(sport, homeTeamName, awayTeamName) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v23_final_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Új cache verzió

    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    } else {
        console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    }

    try {
        // Párhuzamos adatgyűjtés: Gemini és SportMonks egyszerre indul
        const [geminiJsonString, sportMonksDataResult] = await Promise.all([
            (async () => {
                try {
                    // JAVÍTOTT PROMPT: Kicsit egyszerűsített, de a lényeget tartalmazza, JSON formátumot kér
                     const geminiPrompt = `CRITICAL TASK: Provide a single, valid JSON object for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Use your internal knowledge. Focus ONLY on H2H (structured last 5 + summary), team news (absentees: name, importance + impact analysis), recent form (overall & home/away), expected tactics (style), and key players (name, role). NO extra text/markdown. JSON STRUCTURE: {"stats": { "home": {}, "away": {} }, "h2h_summary": "<summary>", "h2h_structured": [ { "date": "YYYY-MM-DD", "score": "H-A" } ], "team_news": { "home": "<news>", "away": "<news>" }, "absentees": { "home": [ { "name": "<Player>", "importance": "<'key'|'important'|'squad'>" } ], "away": [] }, "absentee_impact_analysis": "<analysis>", "form": { "home_overall": "<W-D-L>", "away_overall": "<W-D-L>", "home_home": "<W-D-L>", "away_away": "<W-D-L>" }, "tactics": { "home": { "style": "<Style>" }, "away": { "style": "<Style>" } }, "key_players": { "home": [ { "name": "<Name>", "role": "<Role>" } ], "away": [] }}`;
                    return await _callGeminiWithSearch(geminiPrompt);
                } catch (e) {
                    console.error(`Gemini adatgyűjtés sikertelen: ${e.message}`);
                    return null; // Hibát jelzünk null-lal
                }
            })(),
            _fetchSportMonksData(sport, homeTeamName, awayTeamName) // Ez már kezeli a saját hibáit
        ]);

        // Ha a Gemini hívás kritikus hibával elszállt
        if (!geminiJsonString) {
             throw new Error("A Gemini API hívás sikertelen volt, az adatgyűjtés nem folytatható.");
        }

        let geminiData;
         try {
             geminiData = JSON.parse(geminiJsonString); // Itt már valid JSON-nak kell lennie
         } catch (e) {
             console.error(`A kapott Gemini válasz nem volt érvényes JSON: ${e.message}`);
             console.error("Hibás JSON string (első 500 karakter):", geminiJsonString.substring(0, 500));
             throw new Error("A Gemini válasza feldolgozhatatlan volt (JSON parse error).");
         }


        // Játékosadatok lekérése (csak ha vannak kulcsjátékosok a Gemini válaszban)
        const playerNames = [...(geminiData?.key_players?.home?.map(p => p?.name) || []), ...(geminiData?.key_players?.away?.map(p => p?.name) || [])].filter(Boolean);
        const detailedPlayerData = playerNames.length > 0 ? await _fetchPlayerData(playerNames) : {};

        // --- Adatok EGYESÍTÉSE és NORMALIZÁLÁSA ---
        const finalData = {};

        // Alap statisztikák (Gemini-ból, ha adta)
        finalData.stats = {
            home: {
                 gp: geminiData.stats?.home?.gp ?? 0,
                 gf: geminiData.stats?.home?.gf ?? 0,
                 ga: geminiData.stats?.home?.ga ?? 0,
             },
             away: {
                 gp: geminiData.stats?.away?.gp ?? 0,
                 gf: geminiData.stats?.away?.gf ?? 0,
                 ga: geminiData.stats?.away?.ga ?? 0,
             }
         };

        // H2H adatok
        finalData.h2h_summary = geminiData.h2h_summary || "Nincs adat";
        finalData.h2h_structured = Array.isArray(geminiData.h2h_structured) ? geminiData.h2h_structured : [];

        // Hírek és hiányzók
        finalData.team_news = {
            home: geminiData.team_news?.home || "N/A",
            away: geminiData.team_news?.away || "N/A"
        };
        finalData.absentees = {
             home: Array.isArray(geminiData.absentees?.home) ? geminiData.absentees.home : [],
             away: Array.isArray(geminiData.absentees?.away) ? geminiData.absentees.away : []
         };
        finalData.absentee_impact_analysis = geminiData.absentee_impact_analysis || "Nincs jelentős hatás.";

        // Forma
        finalData.form = {
            home_overall: geminiData.form?.home_overall || "N/A",
            away_overall: geminiData.form?.away_overall || "N/A",
            home_home: geminiData.form?.home_home || "N/A",
            away_away: geminiData.form?.away_away || "N/A"
        };

        // Taktika
        finalData.tactics = {
             home: { style: geminiData.tactics?.home?.style || "Ismeretlen" },
             away: { style: geminiData.tactics?.away?.style || "Ismeretlen" }
         };

        // Kulcsjátékosok és statisztikáik
        finalData.key_players = { home: [], away: [] };
         (geminiData.key_players?.home || []).forEach(p => {
             if (p && p.name) {
                 finalData.key_players.home.push({ ...p, stats: detailedPlayerData[p.name] || {} });
             }
         });
         (geminiData.key_players?.away || []).forEach(p => {
             if (p && p.name) {
                 finalData.key_players.away.push({ ...p, stats: detailedPlayerData[p.name] || {} });
             }
         });


        // Haladó statisztikák (SportMonks xG)
        finalData.advanced_stats = {
            home: { xg: sportMonksDataResult.advanced_stats?.home?.xg ?? null },
            away: { xg: sportMonksDataResult.advanced_stats?.away?.xg ?? null }
        };

        // Játékvezető (ha SportMonks adta)
        finalData.referee = sportMonksDataResult.referee || { name: 'N/A', stats: 'N/A' };

        // Liga átlagok (ha Gemini adta)
        finalData.league_averages = geminiData.league_averages || {};


        // Gazdag kontextus string összeállítása
        const richContextParts = [
            `- H2H: ${finalData.h2h_summary}`,
            `- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`,
            `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}`,
            `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
            `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`,
            `- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`
        ];
        const richContext = richContextParts.join('\n');

        // Visszatérési objektum
        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats,
            form: finalData.form,
            rawData: finalData // Teljes nyers adat hibakereséshez
        };

        // Cachelés
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) {
        // Átfogó hibakezelés a teljes adatgyűjtési folyamatra
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        console.error("Hiba részletei:", e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


/**
 * Lekéri az élő fogadási szorzókat az Odds API-ból, vagy használja a frontendtől kapott nyitó szorzókat.
 * Gyorsítótárazza az élő szorzókat. Liga alapján választ API kulcsot.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa ('soccer', 'hockey', 'basketball').
 * @param {object} sportConfig A sportág konfigurációja (SPORT_CONFIG[sport]).
 * @param {object} openingOdds A frontendtől kapott nyitó szorzók.
 * @param {string} [leagueName] Az ESPN-től kapott liga neve (opcionális, az Odds API híváshoz).
 * @returns {Promise<object|null>} Az odds adatok vagy null.
 */
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) {
        console.log("Nincs ODDS_API_KEY beállítva.");
        return null;
    }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`;

    // 1. Nyitó szorzók feldolgozása (ha vannak)
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key];
            const currentOdds = [];
            const allMarkets = []; // Rekonstruáljuk az allMarkets-et is

            if (matchData.h2h && Array.isArray(matchData.h2h)) {
                allMarkets.push({ key: 'h2h', outcomes: matchData.h2h });
                matchData.h2h.forEach(o => {
                    const price = parseFloat(o.price);
                    if (!isNaN(price) && price > 1) {
                         let name = o.name;
                         if (typeof name === 'string') {
                            const lowerName = name.toLowerCase();
                            if (lowerName === homeTeam.toLowerCase()) name = 'Hazai győzelem';
                            else if (lowerName === awayTeam.toLowerCase()) name = 'Vendég győzelem';
                            else if (lowerName === 'draw') name = 'Döntetlen';
                         }
                        currentOdds.push({ name: name, price: price });
                     }
                });
            }
            if (matchData.totals && Array.isArray(matchData.totals)) {
                 allMarkets.push({ key: 'totals', outcomes: matchData.totals });
                const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
                const over = matchData.totals.find(o => o.point === mainLine && o.name === 'Over');
                const under = matchData.totals.find(o => o.point === mainLine && o.name === 'Under');
                if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
                if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
            }

            if (currentOdds.length > 0) {
                console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`);
                return { current: currentOdds, allMarkets: allMarkets, fromCache: true, sport: sport };
            }
        } catch (e) { console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}.`); }
    } else {
         console.log(`Nincs nyitó szorzó (frontendről) a ${key} meccshez, friss lekérés indul...`);
    }

    // 2. Cache ellenőrzése
    const cacheKey = `live_odds_${sport}_${key}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
        console.log(`Élő szorzók használva (cache) a ${key} meccshez.`);
        return { ...cachedOdds, fromCache: true };
    }

    // 3. API hívás (liga név alapján választott kulccsal)
    console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam}`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);

    // Cachelés és visszatérés
    if (liveOddsData && liveOddsData.current.length > 0) {
        oddsCache.set(cacheKey, liveOddsData);
        return { ...liveOddsData, fromCache: false };
    } else {
         console.warn(`Nem sikerült élő szorzókat lekérni az API-ból: ${homeTeam} vs ${awayTeam}`);
         return null;
    }
}


/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból, a liga neve alapján választva API kulcsot.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa ('soccer', 'hockey', 'basketball').
 * @param {object} sportConfig A sportág konfigurációja (SPORT_CONFIG[sport]).
 * @param {string|null} leagueName Az ESPN-től kapott liga neve.
 * @returns {Promise<object|null>} Az odds adatok vagy null hiba esetén.
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
     // JAVÍTÁS: Intelligens API kulcs választás a liga neve alapján
     const oddsApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : (sportConfig.odds_api_keys_by_league ? Object.keys(sportConfig.odds_api_keys_by_league)[0] : null);

     if (!ODDS_API_KEY || !oddsApiKey) {
         console.error(`getOddsData: Hiányzó ODDS_API_KEY vagy nem található Odds API kulcs ehhez a ligához: ${leagueName} (sport: ${sport})`);
         return null;
     }

    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

    try {
        console.log(`Odds API kérés (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`);
        const response = await axios.get(url, { timeout: 8000, validateStatus: () => true });

        if (response.status !== 200) {
            console.error(`Odds API hiba (${oddsApiKey}): ${response.status} ${JSON.stringify(response.data)?.substring(0, 300)}`);
            // Ha 404 vagy 400 (pl. Unknown sport), logoljuk és null-t adunk vissza
            return null;
        }
        if (!Array.isArray(response.data)) {
            console.error(`Odds API válasz (${oddsApiKey}) nem tömb: ${JSON.stringify(response.data)?.substring(0, 300)}`);
            return null;
        }

        // Pontosabb meccs keresés
        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();
        const match = response.data.find(m =>
            m.home_team?.toLowerCase().trim() === lowerHome &&
            m.away_team?.toLowerCase().trim() === lowerAway
        );

        if (!match) {
            console.warn(`Odds API (${oddsApiKey}): Nem található PONTOS meccs: ${homeTeam} vs ${awayTeam}.`);
            return null; // Nincs értelme részleges egyezést keresni, mert rossz ligában lehet
        }

        const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
            console.warn(`Odds API (${oddsApiKey}): Nincs 'pinnacle' odds vagy piac adat: ${homeTeam} vs ${awayTeam}`);
            return null;
        }

        // Szorzók kinyerése
        const currentOdds = [];
        const allMarkets = bookmaker.markets; // Elmentjük az összes piacot
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const totalsMarket = allMarkets.find(m => m.key === 'totals');

        if (h2hMarket?.outcomes) {
            h2hMarket.outcomes.forEach(o => {
                const price = parseFloat(o.price);
                if (!isNaN(price) && price > 1) {
                    let name = o.name;
                    if (name === match.home_team) name = 'Hazai győzelem';
                    else if (name === match.away_team) name = 'Vendég győzelem';
                    else if (name === 'Draw') name = 'Döntetlen';
                    currentOdds.push({ name: name, price: price });
                }
            });
        }

        if (totalsMarket?.outcomes) {
             const mainLine = findMainTotalsLine({ allMarkets: allMarkets, sport: sport }) ?? sportConfig.totals_line;
             const over = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Over');
             const under = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Under');
             if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
             if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
        }

        if (currentOdds.length > 0) {
            console.log(`Friss szorzók (${oddsApiKey}) sikeresen lekérve: ${homeTeam} vs ${awayTeam}`);
            return { current: currentOdds, allMarkets: allMarkets, sport: sport }; // fromCache: false implicit
        } else {
            console.warn(`Nem sikerült érvényes szorzókat kinyerni a 'pinnacle' adatokból (${oddsApiKey}): ${homeTeam} vs ${awayTeam}`);
            return null;
        }

    } catch (e) {
         if (axios.isAxiosError(e)) {
             console.error(`getOddsData hiba (${oddsApiKey}, ${homeTeam} vs ${awayTeam}): ${e.message}`);
         } else {
             console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`);
         }
        return null;
    }
}


/**
 * Megkeresi a "fő" totals vonalat (ahol az Over és Under szorzók a legközelebb vannak egymáshoz).
 * @param {object} oddsData Az Odds API válaszából származó odds adatok ({ allMarkets: [], sport: '...' }).
 * @returns {number} A fő totals vonal értéke.
 */
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;

    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) {
        return defaultLine;
    }

    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];

    for (const point of points) {
        const overOutcome = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const underOutcome = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');

        if (overOutcome?.price && underOutcome?.price) {
            const overPrice = parseFloat(overOutcome.price);
            const underPrice = parseFloat(underOutcome.price);
            if (!isNaN(overPrice) && !isNaN(underPrice)) {
                const diff = Math.abs(overPrice - underPrice);
                if (diff < closestPair.diff) {
                    closestPair = { diff, line: point };
                }
            }
        }
    }
    // Ha nem találtunk érvényes párt, marad az alapértelmezett
    if (closestPair.diff === Infinity && points.includes(defaultLine)) {
         return defaultLine;
     }
     // Ha az alapértelmezett sincs a pontok között, de találtunk legközelebbit
     if (closestPair.diff !== Infinity) {
         return closestPair.line;
     }
     // Végső esetben, ha semmi nem jó, az alapértelmezett
     return defaultLine;

}


/**
 * Lekéri az összes sportág nyitó szorzóit (ritkán használt, inkább csak backend indításkor lehetne futtatni).
 * @returns {Promise<object>} Objektum a meccsek nyitó szorzóival.
 */
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul (összes liga)...");
    let allOdds = {};
    const processedLeagues = new Set(); // Hogy ne kérjük le ugyanazt a ligát többször

    for (const sport of Object.keys(SPORT_CONFIG)) {
        const sportConfig = SPORT_CONFIG[sport];
        if (!ODDS_API_KEY || !sportConfig.odds_api_keys_by_league) continue;

        // Végigmegyünk az adott sporthoz tartozó liga API kulcsokon
        for (const oddsApiKey of Object.keys(sportConfig.odds_api_keys_by_league)) {
             if (processedLeagues.has(oddsApiKey)) continue; // Ezt a ligát/csoportot már lekérdeztük

             const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;
            try {
                console.log(`Odds API kérés (GetAll - ${oddsApiKey})...`);
                const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
                if (response.status === 200 && Array.isArray(response.data)) {
                    response.data.forEach(match => {
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
                     processedLeagues.add(oddsApiKey); // Megjelöljük, hogy ez a kulcs feldolgozva
                } else {
                     console.error(`Odds API hiba (GetAll - ${oddsApiKey}): ${response.status}`);
                 }
            } catch (e) { console.error(`fetchOpeningOddsForAllSports hiba (${oddsApiKey}): ${e.message}`); }
            await new Promise(resolve => setTimeout(resolve, 300)); // Kis szünet
        }
    }
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`);
    return allOdds;
}

/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve ('soccer', 'hockey', 'basketball').
 * @param {number|string} days Hány napra előre kérjük le a meccseket (ajánlott: 1-3).
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
        console.error(`_getFixturesFromEspn: Érvénytelen vagy túl nagy napok száma: ${days}`);
        return [];
    }

    // Dátumok generálása UTC szerint
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });

    const promises = [];
    console.log(`ESPN meccsek lekérése ${daysInt} napra, ${Object.keys(sportConfig.espn_leagues).length} ligából...`);

    // Párhuzamos lekérések indítása ligánként és naponként
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) {
                 // console.warn(`Hiányzó ESPN slug ehhez a ligához: ${leagueName}`);
                 continue; // Kihagyjuk, ha nincs slug megadva
             }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                axios.get(url, { timeout: 5000, validateStatus: () => true })
                    .then(response => {
                        if (response.status !== 200) {
                             // 404 normális, ha nincs meccs aznap/ligában
                             if (response.status !== 404) console.error(`ESPN hiba ${leagueName} (${slug}, ${dateString}): ${response.status}`);
                             return [];
                         }
                        // Feldolgozzuk a kapott eseményeket
                        return response.data?.events
                            ?.filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') // Csak a még el nem kezdődött meccsek
                            ?.map(event => {
                                const competition = event.competitions?.[0];
                                const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team;
                                const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team;
                                // Biztosítjuk, hogy minden szükséges adat meglegyen
                                if (event.id && home?.name && away?.name && event.date) { // Használjuk a teljes nevet is, ha a rövid nincs
                                    return {
                                        id: String(event.id),
                                        home: String(home.shortDisplayName || home.displayName || home.name).trim(),
                                        away: String(away.shortDisplayName || away.displayName || away.name).trim(),
                                        utcKickoff: event.date, // Ez UTC időzónában van
                                        league: String(leagueName).trim() // ESPN liga neve a configból
                                    };
                                }
                                return null;
                            })
                            .filter(Boolean) // Kiszűrjük a null értékeket (hiányos adatok)
                         || []; // Ha nincs 'events', üres tömb
                    })
                    .catch(e => {
                        if (axios.isCancel(e)) {
                             console.warn(`ESPN lekérés (${leagueName}, ${dateString}) időtúllépés.`);
                         } else {
                            console.error(`Hiba ${leagueName} (${slug}, ${dateString}) ESPN lekérésekor: ${e.message}`);
                         }
                        return []; // Hiba esetén üres tömb
                    })
            );
             // Kis szünet az API rate limit elkerülése végett (opcionális, de ajánlott)
             await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    // Várjuk be az összes lekérést és összegyűjtjük az eredményeket
    const results = await Promise.all(promises);

    // Összefésüljük és kiszűrjük a duplikátumokat ID alapján
    const uniqueFixturesMap = new Map();
     results.flat().forEach(fixture => {
         if (fixture && fixture.id && !uniqueFixturesMap.has(fixture.id)) { // Csak valós fixture objektumokat és újakat veszünk figyelembe
             uniqueFixturesMap.set(fixture.id, fixture);
         }
     });
     const finalFixtures = Array.from(uniqueFixturesMap.values());


    console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    // Opcionális: Rendezés kezdési időpont szerint
    finalFixtures.sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
    return finalFixtures;
}