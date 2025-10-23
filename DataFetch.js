import axios from 'axios';
import NodeCache from 'node-cache';
import { SPORT_CONFIG, GEMINI_API_URL, GEMINI_API_KEY, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY } from './config.js';

// Cache a gyakori API hívások eredményeinek tárolására
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 }); // Általános cache (4 óra)
const sportmonksIdCache = new NodeCache({ stdTTL: 0 }); // SportMonks ID cache (nem jár le)
const oddsCache = new NodeCache({ stdTTL: 60 * 15 }); // Odds cache (15 perc)

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÉGLEGES JAVÍTÁS: Robusztus SportMonks ID és meccskeresés.
* VÉGLEGES JAVÍTÁS: Pontosított Player API (API-SPORTS) adatfeldolgozás.
* VÉGLEGES JAVÍTÁS: Optimalizált Odds API hívás.
**************************************************************/

// --- BELSŐ SEGÉDFÜGGVÉNYEK AZ API-KHOZ ---

/**
 * Megkeresi egy csapat SportMonks ID-ját név alapján, intelligens név-összevetéssel.
 * Gyorsítótárazza az eredményt.
 * @param {string} teamName Az ESPN-től kapott csapatnév.
 * @returns {Promise<string|null>} A csapat SportMonks ID-ja vagy null.
 */
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase();
    const cacheKey = `sportmonks_id_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedId = sportmonksIdCache.get(cacheKey);
    if (cachedId) {
        return cachedId === 'not_found' ? null : cachedId;
    }

    // Ha nincs kulcs, felesleges próbálkozni
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return null;
    }

    // Manuális térkép a nagyon problémás esetekre
    const TEAM_NAME_MAP = {
        'genk': 'KRC Genk',
        'betis': 'Real Betis',
        'red star': 'Red Star Belgrade',
        'sparta': 'Sparta Prague',
    };
    const searchName = TEAM_NAME_MAP[originalLowerName] || teamName;

    try {
        const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
        const response = await axios.get(url, { timeout: 5000 }); // Rövid timeout a gyors kereséshez

        if (response.data?.data?.length > 0) {
            let bestMatch = response.data.data[0];
            // Ha több találat van, próbáljuk megtalálni a legpontosabbat
            if (response.data.data.length > 1) {
                const perfectMatch = response.data.data.find(team => team.name.toLowerCase() === originalLowerName);
                if (perfectMatch) {
                    bestMatch = perfectMatch;
                } else {
                    // Ha nincs tökéletes egyezés, válasszuk azt, amelyik tartalmazza az eredeti nevet
                    const partialMatch = response.data.data.find(team => team.name.toLowerCase().includes(originalLowerName));
                    if (partialMatch) bestMatch = partialMatch;
                }
            }
            const teamId = bestMatch.id;
            console.log(`SportMonks ID találat: "${teamName}" -> "${bestMatch.name}" -> ${teamId}`);
            sportmonksIdCache.set(cacheKey, teamId); // Cachelés az eredeti név alapján
            return teamId;
        } else {
            console.warn(`SportMonks: Nem található ID a következő névvel: "${searchName}" (eredeti: "${teamName}")`);
            sportmonksIdCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`Hiba a SportMonks csapat ID lekérésekor (${searchName}): ${error.message}`);
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
    // Ha nincs kulcs, nincs értelme továbbmenni
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<')) {
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    // ID-k lekérése párhuzamosan
    const [homeTeamId, awayTeamId] = await Promise.all([
        findSportMonksTeamId(homeTeamName),
        findSportMonksTeamId(awayTeamName)
    ]);

    // Ha valamelyik ID hiányzik, nem tudjuk lekérni a meccset
    if (!homeTeamId || !awayTeamId) {
        console.log(`_fetchSportMonksData: Hiányzó SportMonks ID valamelyik csapathoz (${homeTeamName}:${homeTeamId} vs ${awayTeamName}:${awayTeamId}), lekérdezés kihagyva.`);
        return { advanced_stats: { home: {}, away: {} }, referee: { name: 'N/A', stats: 'N/A' } };
    }

    let fixtureData = null;
    let attempts = 0;
    const today = new Date();

    // Visszamenőleg keresünk 2 napot (mai + tegnapi)
    while (!fixtureData && attempts < 2) {
        const searchDate = new Date(today);
        searchDate.setDate(today.getDate() - attempts);
        const dateString = searchDate.toISOString().split('T')[0];

        try {
            // JAVÍTÁS: Direkt keresés a csapat ID-k alapján az adott napon
            const url = `https://api.sportmonks.com/v3/football/fixtures/date/${dateString}?api_token=${SPORTMONKS_API_KEY}&filters=participantIds:${homeTeamId},${awayTeamId}&include=statistics`;
            console.log(`SportMonks meccs keresés (${attempts + 1}. nap: ${dateString}): ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId})`);
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });

            if (response.status === 200 && Array.isArray(response.data.data) && response.data.data.length > 0) {
                // Mivel direkt ID-ra kerestünk, az első találatnak jónak kell lennie
                const foundFixture = response.data.data.find(f =>
                    (String(f.participant_home_id) === String(homeTeamId) && String(f.participant_away_id) === String(awayTeamId))
                );
                if (foundFixture) {
                    fixtureData = foundFixture;
                    console.log(`SportMonks meccs találat (${dateString}): ${homeTeamName} vs ${awayTeamName}`);
                    break; // Megvan a meccs, kilépünk a ciklusból
                }
            } else if (response.status !== 404) { // 404 normális, ha nincs meccs aznap
                console.error(`SportMonks API hiba (${response.status}) Dátum: ${dateString}, Válasz: ${JSON.stringify(response.data)?.substring(0, 300)}`);
            }
        } catch (e) {
            console.error(`Általános hiba SportMonks API hívásakor (${dateString}): ${e.message}`);
        }
        attempts++;
    }

    // Ha 2 nap alatt sem találtunk meccset
    if (!fixtureData) {
        console.log(`SportMonks: Nem található meccs ${homeTeamName} vs ${awayTeamName} (ID: ${homeTeamId} vs ${awayTeamId}) az elmúlt 2 napban.`);
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
    if (!PLAYER_API_KEY || PLAYER_API_KEY.includes('<')) {
        console.log("Player API hívás kihagyva: Nincs valós API kulcs beállítva.");
        return {};
    }
    // Ha üres a lista, nincs mit keresni
    if (!playerNames || !Array.isArray(playerNames) || playerNames.length === 0) {
        return {};
    }

    const playerData = {};
    const currentYear = new Date().getFullYear(); // Az aktuális szezonra keresünk

    // Az API-SPORTS egyszerre csak egy játékosra tud keresni név alapján, ezért ciklust használunk
    for (const playerName of playerNames) {
        const normalizedName = playerName.trim(); // Felesleges szóközök eltávolítása
        if (!normalizedName) continue; // Üres név kihagyása

        try {
            const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(normalizedName)}&season=${currentYear}`;
            console.log(`Player API kérés: ${normalizedName}`);

            const response = await axios.get(url, {
                timeout: 6000, // Rövid timeout játékosonként
                headers: {
                    'x-rapidapi-host': 'v3.football.api-sports.io',
                    'x-rapidapi-key': PLAYER_API_KEY
                }
            });

            // API hívás limit ellenőrzése (ha a válasz tartalmazza)
            if (response.headers['x-ratelimit-requests-remaining'] === '0') {
                console.warn("Player API: Elértük a napi kérelmi limitet!");
            }

            // Válasz feldolgozása
            if (response.data?.response?.length > 0) {
                const playerInfo = response.data.response[0]; // Az első találatot vesszük
                // Keressük az aktuális szezon statisztikáit
                const seasonStats = playerInfo.statistics?.find(s => s.league?.season === currentYear);
                const stats = seasonStats || playerInfo.statistics?.[0]; // Ha nincs aktuális, az elsőt vesszük

                if (stats) {
                    playerData[normalizedName] = {
                        // JAVÍTÁS: Pontosabb adatkinyerés az API-SPORTS struktúrája alapján
                        recent_goals_or_points: stats.goals?.total ?? stats.goals?.scored ?? 0, // Próbáljuk mindkét lehetséges nevet
                        key_passes_or_assists_avg: stats.passes?.key ?? stats.goals?.assists ?? 0,
                        tackles_or_rebounds_avg: stats.tackles?.total ?? 0
                    };
                } else {
                    playerData[normalizedName] = {}; // Ha nincs statisztika
                }
            } else {
                console.warn(`Player API: Nem található játékos: ${normalizedName}`);
                playerData[normalizedName] = {}; // Ha nincs találat
            }
        } catch (error) {
            // Hibakezelés: logoljuk a hibát, de ne álljon le a folyamat
            if (axios.isAxiosError(error) && error.response) {
                console.error(`Hiba a Player API hívás során (${normalizedName}): ${error.response.status} - ${JSON.stringify(error.response.data)?.substring(0, 200)}`);
            } else {
                console.error(`Általános hiba a Player API hívás során (${normalizedName}): ${error.message}`);
            }
            playerData[normalizedName] = {}; // Hiba esetén is üres objektum
        }
        // Kis szünet a kérések között, hogy ne terheljük túl az API-t
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const foundCount = Object.keys(playerData).filter(k => Object.keys(playerData[k]).length > 0).length;
    console.log(`Player API adatok feldolgozva ${foundCount}/${playerNames.length} játékosra.`);
    return playerData;
}

/**
 * Meghívja a Gemini API-t a megadott prompttal. Kezeli a hibákat.
 * @param {string} prompt A Gemini-nak szánt prompt.
 * @returns {Promise<string>} A Gemini válasza szövegként.
 */
async function _callGeminiWithSearch(prompt) {
    if (!GEMINI_API_KEY) throw new Error("Hiányzó GEMINI_API_KEY.");

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4, // Alacsonyabb hőmérséklet a konzisztensebb JSON-ért
            maxOutputTokens: 8192,
            // responseMimeType: "application/json", // Megpróbálhatjuk ezt kérni, hátha segít
        },
        // A keresés itt szándékosan KI van kapcsolva (gemini-2.5-pro limitáció)
        // tools: [{ "googleSearchRetrieval": {} }]
    };

    try {
        const response = await axios.post(GEMINI_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000, // Növelt timeout Gemini hívásokhoz
            validateStatus: () => true // Minden státuszkódot elfogadunk, hogy magunk kezelhessük
        });

        if (response.status !== 200) {
            console.error(`Gemini API HTTP hiba (${response.status}): ${JSON.stringify(response.data)?.substring(0, 500)}`);
            throw new Error(`Gemini API hiba (${response.status}).`);
        }

        // Robusztusabb válaszfeldolgozás
        const candidate = response.data?.candidates?.[0];
        const responseText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;

        if (!responseText) {
            console.error(`Gemini API válasz hiba: Nincs 'text' a válaszban. FinishReason: ${finishReason}. Teljes válasz: ${JSON.stringify(response.data)?.substring(0, 500)}`);
            if (finishReason === 'SAFETY') throw new Error("Az AI válaszát biztonsági szűrők blokkolták.");
            if (finishReason === 'MAX_TOKENS') throw new Error("Az AI válasza túl hosszú volt (max_output_tokens).");
            if (finishReason === 'RECITATION') throw new Error("Az AI válasza idézési problémák miatt blokkolva.");
            throw new Error(`AI válasz hiba. Oka: ${finishReason || 'Ismeretlen vagy hiányzó válasz'}`);
        }

        // Próbáljuk meg tisztítani a JSON stringet
        let cleanedJsonString = responseText.trim();
        // Eltávolítjuk a ```json ... ``` blokkot, ha van
        const jsonMatch = cleanedJsonString.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            cleanedJsonString = jsonMatch[1];
        }
        // Esetleges kezdő/záró idézőjelek vagy más felesleg eltávolítása (agresszívebb tisztítás)
        if (!cleanedJsonString.startsWith('{') && cleanedJsonString.includes('{')) {
             cleanedJsonString = cleanedJsonString.substring(cleanedJsonString.indexOf('{'));
        }
         if (!cleanedJsonString.endsWith('}') && cleanedJsonString.includes('}')) {
             cleanedJsonString = cleanedJsonString.substring(0, cleanedJsonString.lastIndexOf('}') + 1);
        }


        // JSON validálás
        try {
            JSON.parse(cleanedJsonString); // Csak validáljuk, nem használjuk fel itt
            return cleanedJsonString; // Visszaadjuk a (remélhetőleg) tiszta JSON stringet
        } catch (jsonError) {
             console.error(`Gemini válasz nem valid JSON a tisztítás után sem: ${jsonError.message}`);
             console.error("Tisztított JSON string (hiba esetén):", cleanedJsonString.substring(0, 500)); // Logoljuk a hibás stringet
             throw new Error("Az AI válasza nem volt érvényes JSON formátumú.");
        }

    } catch (e) {
        // Átfogóbb hibakezelés
        if (axios.isAxiosError(e)) {
             console.error(`Hiba a Gemini API hívás során (Axios): ${e.message}`);
             if (e.response) {
                 console.error("Axios hiba részletei:", JSON.stringify(e.response.data).substring(0, 500));
             }
        } else {
             console.error(`Általános hiba a Gemini API hívás során: ${e.message}`);
        }
        // Dobjuk tovább az eredeti vagy egy új hibát, hogy a hívó tudjon róla
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
    const teamNames = [homeTeamName, awayTeamName].sort(); // Konzisztens cache kulcs
    const ck = `rich_context_v22_final_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verziózott cache kulcs

    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    } else {
        console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    }

    try {
        // Párhuzamos adatgyűjtés
        const [geminiJsonString, sportMonksDataResult] = await Promise.all([
            (async () => {
                try {
                    const geminiPrompt = `CRITICAL TASK: Based on your internal knowledge, provide a single, valid JSON object for the ${sport} match: "${homeTeamName}" vs "${awayTeamName}". Focus ONLY on H2H (structured last 5 + summary), team news (absentees with IMPORTANCE + impact), recent form (overall AND home/away separately), expected tactics, and key players. NO other text or markdown. JSON STRUCTURE: {"stats": { "home": { "gp": <num>, "gf": <num>, "ga": <num> }, "away": { "gp": <num>, "gf": <num>, "ga": <num> } }, "h2h_summary": "<summary>", "h2h_structured": [ { "date": "YYYY-MM-DD", "venue": "<venue>", "score": "H-A" } ], "team_news": { "home": "<news>", "away": "<news>" }, "absentees": { "home": [ { "name": "<Player>", "importance": "<'key'|'important'|'squad'>" } ], "away": [] }, "absentee_impact_analysis": "<analysis>", "form": { "home_overall": "<W-D-L>", "away_overall": "<W-D-L>", "home_home": "<W-D-L>", "away_away": "<W-D-L>" }, "tactics": { "home": { "style": "<Style>" }, "away": { "style": "<Style>" } }, "key_players": { "home": [ { "name": "<Name>", "role": "<Role>" } ], "away": [] }}`;
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
             geminiData = JSON.parse(geminiJsonString);
         } catch (e) {
             console.error(`A kapott Gemini válasz nem volt érvényes JSON: ${e.message}`);
             console.error("Hibás JSON string (első 500 karakter):", geminiJsonString.substring(0, 500));
             throw new Error("A Gemini válasza feldolgozhatatlan volt (JSON parse error).");
         }


        // Játékosadatok lekérése a Gemini által azonosított kulcsjátékosokra
        const playerNames = [...(geminiData?.key_players?.home?.map(p => p?.name) || []), ...(geminiData?.key_players?.away?.map(p => p?.name) || [])].filter(Boolean);
        const detailedPlayerData = playerNames.length > 0 ? await _fetchPlayerData(playerNames) : {};

        // Adatok egyesítése és alapértelmezett értékek beállítása
        const finalData = { ...geminiData }; // Kezdjük a Gemini adatokkal

        // Alapértelmezett értékek biztosítása a főbb struktúrákhoz
        finalData.stats = finalData.stats || { home: {}, away: {} };
        finalData.stats.home = finalData.stats.home || {};
        finalData.stats.away = finalData.stats.away || {};
        finalData.h2h_summary = finalData.h2h_summary || "Nincs adat";
        finalData.h2h_structured = Array.isArray(finalData.h2h_structured) ? finalData.h2h_structured : [];
        finalData.team_news = finalData.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = finalData.absentees || { home: [], away: [] };
        finalData.absentees.home = Array.isArray(finalData.absentees.home) ? finalData.absentees.home : [];
        finalData.absentees.away = Array.isArray(finalData.absentees.away) ? finalData.absentees.away : [];
        finalData.absentee_impact_analysis = finalData.absentee_impact_analysis || "Nincs jelentős hatás.";
        finalData.form = finalData.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        finalData.tactics = finalData.tactics || { home: { style: "Ismeretlen" }, away: { style: "Ismeretlen" } };
        finalData.key_players = finalData.key_players || { home: [], away: [] };
        finalData.key_players.home = Array.isArray(finalData.key_players.home) ? finalData.key_players.home : [];
        finalData.key_players.away = Array.isArray(finalData.key_players.away) ? finalData.key_players.away : [];
        finalData.league_averages = finalData.league_averages || {}; // Ha Gemini adná

        // SportMonks adatok (főleg xG) hozzáadása/felülírása, ha vannak
        finalData.advanced_stats = { ...(sportMonksData.advanced_stats || {}) };
        finalData.referee = sportMonksData.referee || { name: 'N/A', stats: 'N/A' };


        // Játékos statisztikák hozzáadása a kulcsjátékosokhoz
        (finalData.key_players.home || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; });
        (finalData.key_players.away || []).forEach(p => { if (p && detailedPlayerData[p.name]) p.stats = detailedPlayerData[p.name]; });

        // Gazdag kontextus string összeállítása a modellezéshez
        const richContextParts = [
            `- H2H: ${finalData.h2h_summary}`,
            `- Hírek: H: ${finalData.team_news.home}, V: ${finalData.team_news.away}`,
            `- Hiányzók: H: ${finalData.absentees.home.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}, V: ${finalData.absentees.away.map(p => `${p.name} (${p.importance})`).join(', ') || 'Nincs'}`,
            `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
            `- Forma: H: ${finalData.form.home_overall}, V: ${finalData.form.away_overall}`,
            `- Taktika: H: ${finalData.tactics.home.style}, V: ${finalData.tactics.away.style}`
        ];
        const richContext = richContextParts.join('\n');

        // Visszatérési objektum összeállítása
        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advanced_stats, // Tartalmazza az xG-t, ha volt
            form: finalData.form,
            rawData: finalData // A teljes, nyers adatstruktúra is elérhető legyen
        };

        // Cachelés csak sikeres adatgyűjtés esetén
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (${ck}), cache mentve.`);
        return { ...result, fromCache: false };

    } catch (e) {
        // Átfogó hibakezelés a teljes adatgyűjtési folyamatra
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`);
        console.error("Hiba részletei:", e.stack); // Stack trace logolása a részletesebb hibakereséshez
        // Itt dönthetünk úgy, hogy dobunk egy hibát, ami leállítja az elemzést,
        // vagy visszaadunk egy hiba objektumot, amit a hívó kezelhet.
        // Most hibát dobunk, hogy egyértelmű legyen a probléma.
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}

/**
 * Lekéri az élő fogadási szorzókat az Odds API-ból, vagy használja a frontendtől kapott nyitó szorzókat.
 * Gyorsítótárazza az élő szorzókat.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa.
 * @param {object} sportConfig A sportág konfigurációja.
 * @param {object} openingOdds A frontendtől kapott nyitó szorzók.
 * @returns {Promise<object|null>} Az odds adatok vagy null.
 */
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds) {
    if (!ODDS_API_KEY) {
        console.log("Nincs ODDS_API_KEY beállítva.");
        return null;
    }
    const key = `${homeTeam.toLowerCase().replace(/\s+/g, '')}_vs_${awayTeam.toLowerCase().replace(/\s+/g, '')}`; // Konzisztens kulcs

    // 1. Próbáljuk meg a frontendtől kapott nyitó szorzókat használni
    if (openingOdds && openingOdds[key] && Object.keys(openingOdds[key]).length > 0) {
        try {
            const matchData = openingOdds[key];
            const currentOdds = [];
            // H2H szorzók feldolgozása
            if (matchData.h2h && Array.isArray(matchData.h2h)) {
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
            // Totals szorzók feldolgozása
            if (matchData.totals && Array.isArray(matchData.totals)) {
                const mainLine = findMainTotalsLine({ allMarkets: [{ key: 'totals', outcomes: matchData.totals }], sport: sport }) ?? sportConfig.totals_line;
                const over = matchData.totals.find(o => o.point === mainLine && o.name === 'Over');
                const under = matchData.totals.find(o => o.point === mainLine && o.name === 'Under');
                if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
                if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
            }

            if (currentOdds.length > 0) {
                console.log(`Nyitó szorzók használva (frontendről) a ${key} meccshez.`);
                // Fontos: Az allMarkets struktúrát is visszaadjuk, hogy a findMainTotalsLine később is működjön
                return {
                    current: currentOdds,
                    allMarkets: [
                        { key: 'h2h', outcomes: matchData.h2h || [] },
                        { key: 'totals', outcomes: matchData.totals || [] }
                    ],
                    fromCache: true, // Jelzi, hogy ez nem friss API hívás volt
                    sport: sport
                };
            } else {
                console.log(`Nem sikerült érvényes szorzókat feldolgozni az openingOdds-ból (${key}), friss lekérés indul...`);
            }
        } catch (e) {
            console.error(`Hiba az openingOdds feldolgozásakor (${key}): ${e.message}. Friss lekérés indul...`);
        }
    } else {
         console.log(`Nincs nyitó szorzó (frontendről) a ${key} meccshez, friss lekérés indul...`);
    }

    // 2. Ha nincs nyitó szorzó, vagy feldolgozási hiba volt, próbáljuk a cache-t
    const cacheKey = `live_odds_${sport}_${key}`;
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
        console.log(`Élő szorzók használva (cache) a ${key} meccshez.`);
        return { ...cachedOdds, fromCache: true };
    }

    // 3. Ha a cache is üres, akkor hívjuk az API-t
    console.log(`Élő szorzók lekérése API-ból: ${homeTeam} vs ${awayTeam}`);
    const liveOddsData = await getOddsData(homeTeam, awayTeam, sport, sportConfig);

    // Sikeres API hívás esetén cache-eljük az eredményt
    if (liveOddsData && liveOddsData.current.length > 0) {
        oddsCache.set(cacheKey, liveOddsData); // Cachelés 15 percre
        return liveOddsData; // Visszaadjuk a friss adatot
    } else {
         // Ha az API hívás sem adott eredményt
         console.warn(`Nem sikerült élő szorzókat lekérni az API-ból: ${homeTeam} vs ${awayTeam}`);
         return null;
    }
}


/**
 * Lekéri az élő fogadási szorzókat egy adott meccshez az Odds API-ból.
 * @param {string} homeTeam Hazai csapat neve.
 * @param {string} awayTeam Vendég csapat neve.
 * @param {string} sport A sportág kulcsa.
 * @param {object} sportConfig A sportág konfigurációja.
 * @returns {Promise<object|null>} Az odds adatok vagy null hiba esetén.
 */
async function getOddsData(homeTeam, awayTeam, sport, sportConfig) {
    if (!ODDS_API_KEY || !sportConfig.odds_api_sport_key) {
         console.error(`getOddsData: Hiányzó ODDS_API_KEY vagy odds_api_sport_key konfig ${sport}-hoz.`);
         return null;
     }
    // JAVÍTÁS: A sportkulcsot használjuk, nem a ligalistát
    const sportKey = sportConfig.odds_api_sport_key;
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;

    try {
        const response = await axios.get(url, { timeout: 8000, validateStatus: () => true });

        if (response.status !== 200) {
            console.error(`Odds API hiba (GetOdds - ${sportKey}): ${response.status} ${JSON.stringify(response.data)?.substring(0, 300)}`);
            return null;
        }
        if (!Array.isArray(response.data)) {
            console.error(`Odds API válasz nem tömb: ${JSON.stringify(response.data)?.substring(0, 300)}`);
            return null;
        }

        // Pontosabb meccs keresés (figyelmen kívül hagyva kis/nagybetűt és szóközöket)
        const lowerHome = homeTeam.toLowerCase().trim();
        const lowerAway = awayTeam.toLowerCase().trim();
        const match = response.data.find(m =>
            m.home_team?.toLowerCase().trim() === lowerHome &&
            m.away_team?.toLowerCase().trim() === lowerAway
        );

        if (!match) {
            console.warn(`Odds API: Nem található PONTOS meccs: ${homeTeam} vs ${awayTeam} (Sport: ${sportKey}). Próbálkozás részleges egyezéssel...`);
            // Itt lehetne egy második körös, lazább keresést implementálni, ha szükséges
            return null;
        }

        const bookmaker = match.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
            console.warn(`Odds API: Nincs 'pinnacle' odds vagy piac adat: ${homeTeam} vs ${awayTeam}`);
            return null;
        }

        const currentOdds = [];
        const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
        const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');

        // H2H szorzók feldolgozása
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

        // Totals szorzók feldolgozása
        if (totalsMarket?.outcomes) {
             const mainLine = findMainTotalsLine({ allMarkets: [totalsMarket], sport: sport }) ?? sportConfig.totals_line;
             const over = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Over');
             const under = totalsMarket.outcomes.find(o => o.point === mainLine && o.name === 'Under');
             if (over?.price > 1) currentOdds.push({ name: `Over ${mainLine}`, price: over.price });
             if (under?.price > 1) currentOdds.push({ name: `Under ${mainLine}`, price: under.price });
        }


        if (currentOdds.length > 0) {
            console.log(`Friss szorzók sikeresen lekérve: ${homeTeam} vs ${awayTeam}`);
            return {
                current: currentOdds,
                allMarkets: bookmaker.markets, // Tartalmazza az összes piacot (h2h, totals)
                sport: sport,
                fromCache: false // Jelzi, hogy ez friss API hívás volt
             };
        } else {
            console.warn(`Nem sikerült érvényes szorzókat kinyerni a 'pinnacle' adatokból: ${homeTeam} vs ${awayTeam}`);
            return null;
        }

    } catch (e) {
        if (axios.isAxiosError(e)) {
             console.error(`getOddsData hiba (${homeTeam} vs ${awayTeam}): ${e.message}`);
        } else {
             console.error(`Általános hiba getOddsData feldolgozásakor (${homeTeam} vs ${awayTeam}): ${e.message}`);
        }
        return null;
    }
}


/**
 * Megkeresi a "fő" totals vonalat (ahol az Over és Under szorzók a legközelebb vannak egymáshoz).
 * @param {object} oddsData Az Odds API válaszából származó odds adatok.
 * @returns {number} A fő totals vonal értéke.
 */
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5; // Alapértelmezett vonal sportág szerint

    // Ellenőrizzük, hogy van-e totals piac az adatokban
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) {
        return defaultLine; // Ha nincs totals adat, az alapértelmezettel térünk vissza
    }

    let closestPair = { diff: Infinity, line: defaultLine };
    // Összegyűjtjük az egyedi pontszámokat (vonalakat)
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number'))];

    // Végigmegyünk az összes vonalon
    for (const point of points) {
        const overOutcome = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const underOutcome = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');

        // Ha mindkét (Over és Under) szorzó megvan az adott vonalhoz
        if (overOutcome?.price && underOutcome?.price) {
            const overPrice = parseFloat(overOutcome.price);
            const underPrice = parseFloat(underOutcome.price);

            if (!isNaN(overPrice) && !isNaN(underPrice)) {
                const diff = Math.abs(overPrice - underPrice); // Számoljuk a különbséget
                // Ha ez a különbség kisebb, mint az eddigi legkisebb, ez lesz az új "fő" vonal
                if (diff < closestPair.diff) {
                    closestPair = { diff, line: point };
                }
            }
        }
    }
    return closestPair.line; // Visszaadjuk a legkisebb különbségű vonalat
}


/**
 * Lekéri az összes sportág nyitó szorzóit (nem használjuk aktívan, de hasznos lehet).
 * @returns {Promise<object>} Objektum a meccsek nyitó szorzóival.
 */
export async function fetchOpeningOddsForAllSports() {
    console.log("Nyitó szorzók lekérése indul...");
    let allOdds = {};
    for (const sport of Object.keys(SPORT_CONFIG)) {
        const sportConfig = SPORT_CONFIG[sport];
        // JAVÍTÁS: A helyes sportkulcs használata
        if (!ODDS_API_KEY || !sportConfig.odds_api_sport_key) continue;
        const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.odds_api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle`;
        try {
            const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
            if (response.status === 200 && Array.isArray(response.data)) {
                response.data.forEach(match => {
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
            }
        } catch (e) { console.error(`_fetchOpeningOddsForAllSports hiba (${sport}): ${e.message}`); }
    }
    console.log(`Összes nyitó szorzó lekérése befejeződött. ${Object.keys(allOdds).length} meccs szorzója tárolva.`);
    return allOdds;
}


/**
 * Lekéri a meccseket az ESPN API-ból a következő 'days' napra.
 * @param {string} sport A sportág neve.
 * @param {number} days Hány napra előre kérjük le a meccseket.
 * @returns {Promise<Array>} A meccsek listája.
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.name || !sportConfig.espn_leagues) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig ${sport}-hoz.`);
        return [];
    }

    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { // Limitáljuk max 7 napra
        console.error(`_getFixturesFromEspn: Érvénytelen napok száma: ${days}`);
        return [];
    }

    // Dátumok generálása UTC szerint
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d); // UTC dátumot használunk
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });

    const promises = [];
    // Párhuzamos lekérések indítása ligánként és naponként
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) continue;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.name}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push(
                axios.get(url, { timeout: 5000, validateStatus: () => true })
                    .then(response => {
                        if (response.status !== 200) {
                             if (response.status !== 404) console.error(`ESPN hiba ${leagueName} (${slug}, ${dateString}): ${response.status}`);
                             return []; // Hiba vagy nincs adat, üres tömbbel térünk vissza
                         }
                        // Feldolgozzuk a kapott eseményeket
                        return response.data?.events
                            ?.filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') // Csak a még el nem kezdődött meccsek
                            ?.map(event => {
                                const competition = event.competitions?.[0];
                                const home = competition?.competitors?.find(c => c.homeAway === 'home')?.team;
                                const away = competition?.competitors?.find(c => c.homeAway === 'away')?.team;
                                // Biztosítjuk, hogy minden szükséges adat meglegyen
                                if (event.id && home && away && event.date) {
                                    return {
                                        id: String(event.id),
                                        home: String(home.shortDisplayName || home.displayName || home.name).trim(),
                                        away: String(away.shortDisplayName || away.displayName || away.name).trim(),
                                        utcKickoff: event.date, // Ez UTC időzónában van
                                        league: String(leagueName).trim()
                                    };
                                }
                                return null; // Hiányos adat esetén null
                            })
                            .filter(Boolean) // Kiszűrjük a null értékeket
                         || []; // Ha nincs 'events', üres tömb
                    })
                    .catch(e => {
                        console.error(`Hiba ${leagueName} (${slug}, ${dateString}) ESPN lekérésekor: ${e.message}`);
                        return []; // Hiba esetén üres tömb
                    })
            );
             // Kis szünet az API túlterhelés elkerülése végett
             await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    // Várjuk be az összes lekérést és összegyűjtjük az eredményeket
    const results = await Promise.all(promises);

    // Összefésüljük és kiszűrjük a duplikátumokat ID alapján
    const uniqueFixtures = Object.values(
         results.flat().reduce((acc, fixture) => {
             if (fixture && fixture.id) { // Csak valós fixture objektumokat veszünk figyelembe
                 acc[fixture.id] = fixture;
             }
             return acc;
         }, {})
     );

    console.log(`ESPN: ${uniqueFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);
    return uniqueFixtures;
}