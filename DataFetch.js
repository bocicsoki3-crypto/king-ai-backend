import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import { 
    SPORT_CONFIG, 
    GEMINI_API_KEY, 
    GEMINI_MODEL_ID, 
    ODDS_API_KEY, 
    SPORTMONKS_API_KEY, 
    PLAYER_API_KEY, 
    getOddsApiKeyForLeague, 
    ODDS_TEAM_NAME_MAP 
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg; // findBestMatch importálása

// Cache inicializálás
// stdTTL: 2 óra a fő statisztikai adatoknak
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
// stdTTL: 10 perc a szorzóknak (gyorsan változnak)
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
// stdTTL: 0 (soha nem jár le) a Team ID-knak
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false });

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS (V17.0 - Összevont Fejlesztés):
* - Robusztusabb Odds API névkeresés (több variáció + string similarity).
* - Részletesebb logolás az Odds API-hoz.
* - getRichContextualData prompt bővítve: meccs fontossága, formációk, időjárás részletei.
* - TheSportsDB V2/Path keresés (ID-k keresése).
* - Robustus _callGemini JSON retry logika.
**************************************************************/

// --- HIBATŰRŐ GEMINI HÍVÓ FÜGGVÉNY (Kritikus!) ---

/**
 * Központi funkció a Gemini AI hívására robusztus JSON feldolgozással és retry logikával.
 * @param {string} prompt A Gemini modellnek szánt prompt.
 * @param {string} analysisPart Melyik elemzési részhez tartozik (logoláshoz).
 * @param {number} maxRetries A maximális próbálkozások száma.
 * @returns {string} A Gemini modell tiszta szöveges válasza JSON-ként feldolgozva, vagy hibaüzenet.
 */
export async function _callGemini(prompt, analysisPart = 'general_analysis', maxRetries = 3) {
    if (!GEMINI_API_KEY || !GEMINI_MODEL_ID) {
        throw new Error("Hiányzó Gemini API kulcs vagy modell ID.");
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    let lastError = null;
    let finalJsonResponse = null;

    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${prompt.length})`);

    // A prompt szöveg kiemelése, ha kérdést tartalmaz
    // console.log(`--- PROMPT (Részlet a ${analysisPart}-hoz) ---\n${prompt.substring(0, 1000)}...\n--- END PROMPT ---`);

    for (let i = 1; i <= maxRetries; i++) {
        try {
            const requestBody = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    // JSON kényszerítés 
                    responseMimeType: "application/json",
                    // Hőmérséklet beállítása (0.7 a kreatív, de megbízható válaszokhoz)
                    temperature: 0.7, 
                    // Biztonsági beállítások
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    ]
                }
            };

            const response = await axios.post(endpoint, requestBody, { timeout: 45000 }); // 45 másodperc timeout
            console.log(`Gemini API válasz státusz: ${response.status}`);
            
            if (response.status !== 200) {
                 throw new Error(`Gemini API hiba: Státusz ${response.status}. Részletek: ${JSON.stringify(response.data)}`);
            }

            const rawText = response.data.candidates[0]?.content?.parts[0]?.text || '';
            console.log(`--- RAW GEMINI RESPONSE TEXT ---\nKapott karakterek száma: ${rawText.length}\n${rawText.substring(0, Math.min(rawText.length, 500))}...\n--- END RAW GEMINI RESPONSE TEXT ---`);

            // --- JSON TISZTÍTÁS ÉS ÉRVÉNYESÍTÉS ---
            let jsonString = rawText.trim();
            // Eltávolítja a "```json" és "```" körítést
            if (jsonString.startsWith('```json')) {
                jsonString = jsonString.substring(7).trim();
            }
            if (jsonString.endsWith('```')) {
                jsonString = jsonString.substring(0, jsonString.length - 3).trim();
            }

            // Nagyon ritkán előfordul, hogy egy "json" tag marad
            if (jsonString.startsWith('json')) {
                 jsonString = jsonString.substring(4).trim();
            }
            
            // Ha a tisztított szöveg üres, hiba
            if (!jsonString) {
                throw new Error("Az AI válasza üres volt a tisztítás után.");
            }
            
            // Érvényesítés: megpróbáljuk JSON-ként feldolgozni
            finalJsonResponse = JSON.parse(jsonString);
            console.log("Gemini API válasz sikeresen validálva JSON-ként.");
            return JSON.stringify(finalJsonResponse); // Sikeres válasz JSON string formájában
            
        } catch (error) {
            lastError = error;
            console.error(`AI Hiba a(z) ${analysisPart} feldolgozásakor (Próba: ${i}/${maxRetries}): ${error.message}`);

            if (i === maxRetries) {
                console.error(`Végleges AI Hiba (${analysisPart}) ${maxRetries} próbálkozás után.`);
                throw new Error(`Végleges hiba az AI hívás során (${analysisPart}): ${lastError.message}`);
            }
            // Kisebb késleltetés a retry előtt (1-2 másodperc)
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); 
        }
    }
}


// --- ODDS API SEGÉDEK ---

/**
 * Megpróbálja hozzárendelni az ESPN csapatnevet az Odds API által használt névhez.
 * @param {string} espnName Az ESPN/Frontend által használt csapatnév.
 * @returns {string} Az Odds API-kompatibilis csapatnév, vagy az eredeti.
 */
function _getOddsApiTeamName(espnName, oddsTeams) {
    if (!espnName) return null;
    const lowerEspnName = espnName.toLowerCase().trim();

    // 1. Direkt Match a lokális térképben (config.js)
    if (ODDS_TEAM_NAME_MAP[lowerEspnName]) {
        console.log(`Odds Név Match (Direkt): ${espnName} -> ${ODDS_TEAM_NAME_MAP[lowerEspnName]}`);
        return ODDS_TEAM_NAME_MAP[lowerEspnName];
    }
    
    // 2. Direkt Match az oddsTeams listában (esetérzéketlen)
    const directMatch = oddsTeams.find(t => t.toLowerCase() === lowerEspnName);
    if (directMatch) {
         console.log(`Odds Név Match (Pontos): ${espnName} -> ${directMatch}`);
         return directMatch;
    }

    // 3. String Similarity (ha van Odds API-ból származó csapatlista)
    if (oddsTeams && oddsTeams.length > 0) {
        const bestMatch = findBestMatch(lowerEspnName, oddsTeams.map(t => t.toLowerCase()));
        if (bestMatch.bestMatch.rating > 0.8) { // 80% feletti egyezés megbízható
            const matchedName = oddsTeams[bestMatch.bestMatchIndex];
            console.log(`Odds Név Match (Fuzzy, R: ${bestMatch.bestMatch.rating.toFixed(2)}): ${espnName} -> ${matchedName}`);
            return matchedName;
        }
    }

    // 4. Default: Eredeti név visszaadása, ami gyakran működik
    console.log(`Odds Név Match (Alapértelmezett): ${espnName}`);
    return espnName;
}

/**
 * Lekéri a szorzókat a The Odds API-ból egy adott mérkőzésre és marketre.
 * @param {string} home Az otthoni csapat neve (Odds API név).
 * @param {string} away A vendég csapat neve (Odds API név).
 * @param {string} sportKey A sportág kulcsa (pl. 'soccer_europe_league').
 * @param {string} market A market típusa (pl. 'h2h', 'totals').
 * @param {string} region A régió (pl. 'eu').
 * @param {boolean} isOpeningOdds Igaz, ha nyitó szorzókat keresünk.
 * @returns {Array<object>|null} A szorzók adatai.
 */
async function _callOddsApi(home, away, sportKey, market, region = 'eu', isOpeningOdds = false) {
    const oddsApiKey = ODDS_API_KEY; 
    if (!oddsApiKey || !sportKey) {
        console.warn(`Odds API: Hiányzó kulcs/sportkulcs (${sportKey})`);
        return null;
    }
    
    // Alapértelmezésben a "legjobb" árat akarjuk (default = true)
    const isBestOdds = isOpeningOdds ? false : true; 
    
    const openingQuery = isOpeningOdds ? 'history=true&' : '';
    const cacheKey = `${sportKey}_${home}_${away}_${market}_${region}_${isOpeningOdds ? 'opening' : 'current'}`;
    
    const cachedOdds = oddsCache.get(cacheKey);
    if (cachedOdds) {
        // console.log(`Odds Cache találat: ${cacheKey}`);
        return cachedOdds;
    }

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${oddsApiKey}&regions=${region}&markets=${market}&oddsFormat=decimal&bookmakers=betfair_ex_eu,pinnacle&${openingQuery}`;

    try {
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;
        
        // Először megkeressük a meccset a válaszban
        const match = data.find(m => {
            // Megkeressük a csapatot, ami az Odds API-ból jött (esetérzéketlen)
            const matchedHome = _getOddsApiTeamName(home, [m.home_team, m.away_team]);
            const matchedAway = _getOddsApiTeamName(away, [m.home_team, m.away_team]);
            
            // Az Odds API válaszban szereplő nevekkel kell dolgoznunk
            const isMatch = (m.home_team === matchedHome && m.away_team === matchedAway) || 
                            (m.home_team === matchedAway && m.away_team === matchedHome);

            if (isMatch) {
                console.log(`Odds API találat a meccsre: ${m.home_team} vs ${m.away_team} (Market: ${market})`);
            }
            return isMatch;
        });

        if (!match) {
            // console.warn(`Odds API: Nem található a meccs: ${home} vs ${away} a kapott adatokban (Market: ${market})`);
            return null;
        }

        // Második lépés: Kinyerjük a szorzókat a bookmaker-ekből
        const allOdds = [];
        for (const bookmaker of match.bookmakers) {
            // Ha nyitó szorzókat keresünk, de a bookmaker nem adja meg, kihagyjuk
            const currentOdds = isOpeningOdds ? bookmaker.historical_odds?.[0]?.odds : bookmaker.markets?.[0]?.outcomes;
            
            if (!currentOdds || currentOdds.length === 0) continue;
            
            // A Home/Away/Draw eredmények kinyerése
            for (const outcome of currentOdds) {
                // A "totals" marketeknél a pontszámot kell kinyernünk a név helyett
                let name = outcome.name;
                let point = null;

                if (market === 'totals') {
                    // Totals (Over/Under) marketnél az 'Over X.5' vagy 'Under X.5' a név
                    const matchName = outcome.name.match(/(Over|Under) (\d+(\.\d+)?)/i);
                    if (matchName) {
                        name = matchName[1]; // Over vagy Under
                        point = parseFloat(matchName[2]); // X.5
                    } else {
                        // Ha nem sikerül kinyerni, kihagyjuk
                        continue; 
                    }
                }
                
                // Mivel a bookmaker.markets.outcomes sorrendje nem garantált, 
                // az Outcome name alapján kell megállapítani, hogy melyik csapatra vonatkozik
                let teamName = null;
                if (name === match.home_team) {
                    teamName = home;
                    name = 'Hazai győzelem';
                } else if (name === match.away_team) {
                    teamName = away;
                    name = 'Vendég győzelem';
                } else if (name === 'Draw' || name === 'Döntetlen') {
                    name = 'Döntetlen';
                }
                
                // Totals marketeknél nincs csapatnév, a market neve az 'Over' vagy 'Under'
                if (market === 'totals') {
                    // Az Over/Under name és point alapján
                } else if (market === 'h2h') {
                    // H2H marketeknél a csapatnév az outcome name-mel egyezik meg
                    if (teamName !== home && teamName !== away && name !== 'Döntetlen') continue;
                } else {
                    continue; // Ismeretlen market
                }

                allOdds.push({
                    team: teamName, // home / away / null (döntetlen, totals)
                    name: name, // Hazai győzelem / Vendég győzelem / Döntetlen / Over / Under
                    point: point, // totals marketeknél a vonal (pl. 2.5)
                    price: outcome.price, // A szorzó
                    bookmaker: bookmaker.key, // Pl. 'pinnacle'
                    lastUpdate: outcome.last_update,
                    isBest: isBestOdds // Csak a h2h-nál és a végleges totalsnál lesz 'isBest=true'
                });
            }
        }

        // Szűrjük a "legjobb" szorzókat (H2H)
        const bestOddsH2H = [];
        if (market === 'h2h') {
            const homeOdds = allOdds.filter(o => o.team === home);
            const awayOdds = allOdds.filter(o => o.team === away);
            const drawOdds = allOdds.filter(o => o.name === 'Döntetlen');

            if (homeOdds.length > 0) bestOddsH2H.push({ ...homeOdds.sort((a, b) => b.price - a.price)[0], isBest: true });
            if (awayOdds.length > 0) bestOddsH2H.push({ ...awayOdds.sort((a, b) => b.price - a.price)[0], isBest: true });
            if (drawOdds.length > 0) bestOddsH2H.push({ ...drawOdds.sort((a, b) => b.price - a.price)[0], isBest: true });
            
            // Csak a legjobbakat cache-eljük
            oddsCache.set(cacheKey, bestOddsH2H);
            return bestOddsH2H;
        }

        // Totals marketeknél nem szűrünk, hanem az összeset mentjük, mert kell az összes totals line
        oddsCache.set(cacheKey, allOdds);
        return allOdds;

    } catch (error) {
        if (error.response?.status === 404) {
            // 404 - Nincs találat az Odds API-ban (ez gyakran előfordul)
            console.warn(`Odds API: 404 Hiba. Nem található élő szorzó a ${home} vs ${away} meccsre (${sportKey}).`);
        } else if (error.message.includes('timeout')) {
             console.error(`Odds API Hiba: Időtúllépés a ${home} vs ${away} lekérésekor: ${error.message}`);
        } else {
            console.error(`Odds API Súlyos Hiba a ${home} vs ${away} lekérésekor: ${error.message}`);
        }
        return null;
    }
}

/**
 * Lekéri a SportMonks API-ból (vagy SportMonks-klónból) egy csapat ID-t.
 * JELENLEG KIKAPCSOLVA (TheSportsDB a preferált), de a függvény marad, ha vissza kell kapcsolni.
 * @param {string} teamName A csapat neve.
 * @param {string} sport A sportág.
 * @returns {number|null} A csapat ID-ja.
 */
async function _getTeamIdFromSportMonks(teamName, sport) {
    // Ha nem kell, visszatérünk azonnal
    return null; 
}

/**
 * Lekéri a meccs előtti statisztikákat és játékosadatokat a TheSportsDB V2 API-ból (vagy alternatív forrásból).
 * @param {string} teamName A csapat neve.
 * @returns {object|null} Az adatok vagy null.
 */
async function _callTheSportsDb(teamName, sport, leagueName, teamType) {
    if (!PLAYER_API_KEY) {
        console.warn("Hiányzó PLAYER_API_KEY a TheSportsDB V2 hívásához.");
        return null;
    }
    const safeName = encodeURIComponent(teamName.trim());
    const apiKey = PLAYER_API_KEY; // A TheSportsDB V2-höz ezt a kulcsot használjuk X-API-KEY headerben

    // 1. Path Search (ID lekérése név alapján) - Cache-ben megnézzük
    let teamId = sportmonksIdCache.get(`tsdb_id_${safeName}`);

    if (!teamId) {
        try {
            // A TheSportsDB v2 a "search" endpointot használja a név kereséséhez
            const searchUrl = `https://www.thesportsdb.com/api/v2/json/${apiKey}/search/team/${safeName}`;
            console.log(`TheSportsDB V2 Path Search: URL=${searchUrl} (Kulcs X-API-KEY headerben)`);
            const searchResponse = await axios.get(searchUrl, {
                headers: { 'X-API-KEY': apiKey },
                timeout: 5000 
            });
            
            // Az eredmény egy "teams" nevű tömbben van, ha van találat
            const teams = searchResponse.data.teams;
            if (teams && teams.length > 0) {
                // Megpróbáljuk a legpontosabb találatot kiválasztani (az ESPN/Frontend névvel leginkább egyező nevet)
                const bestTeam = teams.find(t => t.strTeam.toLowerCase() === teamName.toLowerCase()) || teams[0];
                teamId = bestTeam.idTeam;
                sportmonksIdCache.set(`tsdb_id_${safeName}`, teamId);
                console.log(`TheSportsDB (V2/Path): ID találat "${teamName}" -> ${teamId}`);
            } else {
                console.warn(`TheSportsDB (V2/Path): Nem található ID a(z) ${teamName} csapathoz.`);
                return null;
            }
        } catch (e) {
            console.error(`TheSportsDB V2 Path Search hiba: ${e.message}`);
            return null;
        }
    }

    // 2. Játékosok és Statisztikák (Stats API)
    try {
        const statsUrl = `https://www.thesportsdb.com/api/v2/json/${apiKey}/lookup/players/${teamId}`; // Ez a V2 Player endpointja (vagy egy hasonló)
        console.log(`TheSportsDB V2 Player Data: URL=${statsUrl}`);
        
        const statsResponse = await axios.get(statsUrl, {
            headers: { 'X-API-KEY': apiKey },
            timeout: 7000 
        });

        // Ez a rész erősen függ attól, hogy a TSDB milyen formátumot ad vissza. 
        // A kapott "rawStats" és "keyPlayers" struktúrát kell követnünk.
        const rawPlayers = statsResponse.data.player || [];
        
        if (rawPlayers.length === 0) {
             console.warn(`TheSportsDB (V2): Nem található játékoslista (${teamId}).`);
        }

        // Az AI számára kulcsfontosságú játékosok előkészítése (poszt, statok)
        const keyPlayers = rawPlayers.map(p => {
             // Itt elvégzünk egy egyszerű szűrést/mappinget a Model.js számára
            const isKeyPlayer = (p.strPosition === 'Goalkeeper') ? false : (p.strStatus === 'Starter' || p.strPosition === 'Forward' || p.strPosition === 'Midfielder');
            if (isKeyPlayer) {
                return {
                    name: p.strPlayer,
                    role: p.strPosition, // A poszt
                    stats: `Gól: ${p.intGoals || 'N/A'}, Assziszt: ${p.intAssists || 'N/A'}, Átlagos Értékelés: ${p.strRating || 'N/A'}`, // Statisztikák tömörítve
                    status: p.strStatus || 'Active' // Pl. "Injured", "Suspended", "Active"
                };
            }
            return null;
        }).filter(p => p !== null);


        // Egyéb csapatstatisztikák kinyerése
        // A TSDB V2 gyakran csak a fő statisztikákat adja vissza. Itt kell ezt összegyűjteni.
        const advancedStatsTeam = {
            // Ezt a részt ki kell egészíteni a valódi TSDB V2 válasz alapján! 
            // Most csak placeholder:
            Shots_Per_Game: 'N/A',
            Average_Possession_Pct: 'N/A',
            Expected_Goals_For: 'N/A',
            Pace: 'N/A',
        };

        return {
            teamName: teamName,
            id: teamId,
            key_players: keyPlayers,
            advanced_stats_team: advancedStatsTeam,
            fromCache: false // Mindig frissnek vesszük, mert a Player API frissül
        };

    } catch (e) {
        console.error(`TheSportsDB V2 Statisztika Hiba (${teamName}): ${e.message}`);
        return null;
    }
}


// --- ESPN FIXTURE LEKÉRÉS (Naptár) ---

/**
 * Lekéri a meccsek listáját az ESPN-ből (a frontenden lévő naptárhoz).
 * @param {string} sport A sportág.
 * @param {number} days Hány napra előre kérjük.
 * @returns {Array<object>} A meccsek listája.
 */
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig) return [];
    
    const espnLeagues = sportConfig.espn_leagues;
    const sportPath = sportConfig.espn_sport_path;
    const daysInt = parseInt(days) || 3;
    
    // A fixture lekérés cache kulcsa
    const cacheKey = `espn_fixtures_${sport}_${daysInt}_days`;
    const cachedFixtures = scriptCache.get(cacheKey);

    if (cachedFixtures) {
        console.log(`ESPN Cache találat: ${cachedFixtures.length} meccs a ${daysInt} napos időszakra.`);
        return cachedFixtures;
    }

    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(espnLeagues).length} liga lekérése...`);

    // A TheSportsDB vagy más forrás használata helyett maradjunk az ESPN-nél
    const espnBaseUrl = 'https://site.api.espn.com/apis/site/v2/sports'; 

    for (const leagueName in espnLeagues) {
        const slug = espnLeagues[leagueName];
        
        // Loop a napokra
        for (let i = 0; i < daysInt; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateString = date.toISOString().split('T')[0].replace(/-/g, ''); // Pl. 20251025
            
            const url = `${espnBaseUrl}/${sportPath}/${slug}/scoreboard?dates=${dateString}`;

            promises.push(
                axios.get(url, { timeout: 8000 })
                 .then(response => {
                     const leagueEvents = response.data.events || [];
                     
                     // Minden eseményt a szükséges formátumba alakítunk
                     return leagueEvents.map(event => {
                         const match = event.competitions?.[0];
                         if (!match) return null;
                         
                         const homeTeam = match.competitors.find(c => c.homeAway === 'home');
                         const awayTeam = match.competitors.find(c => c.homeAway === 'away');
                         if (!homeTeam || !awayTeam) return null;

                         // Az ESPN néha nem adja meg a status.type.id-t vagy a status.type.name-t
                         const isScheduled = event.status.type.id === '1' || event.status.type.name === 'STATUS_SCHEDULED';

                         return {
                             id: event.id,
                             home: homeTeam.team.displayName || homeTeam.team.shortDisplayName,
                             away: awayTeam.team.displayName || awayTeam.team.shortDisplayName,
                             leagueName: response.data.leagues?.[0]?.name || leagueName, // Használjuk a hivatalos liga nevet is, ha van
                             utcKickoff: event.date, // ISO formátumú dátum
                             status: event.status.type.name,
                             isScheduled: isScheduled,
                             score: event.score, // Pl. '1 - 0'
                             // Ezt az ID-t a rich context lekéréshez használni KOCKÁZATOS, de most maradjunk a név alapú lekérésnél
                             // homeTeamId: homeTeam.id,
                             // awayTeamId: awayTeam.id,
                         };
                     }).filter(f => f && f.isScheduled); // Csak a tervezett meccseket engedjük át

                 })
                 .catch(error => {
                     // Logoljuk a hibát, de üres tömbbel folytatjuk
                     // A 400-as hibákat (Bad Request) különösen figyeljük, mert azok valószínűleg rossz slug-ot jeleznek
                     if (error.response?.status === 400) {
                        console.warn(`ESPN Hiba (400 - Bad Request): Valószínűleg rossz a slug '${slug}' (${leagueName}) ligához az URL-ben: ${url.substring(0,150)}...`);
                     } else {
                        console.error(`Hiba egy ESPN liga lekérésekor (${leagueName}, ${slug}): ${error.message}`);
                     }
                     return []; // Hiba esetén üres tömböt adunk vissza
                 })
            );
            // Kisebb késleltetés, hogy ne terheljük túl az ESPN API-t
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        // Összegyűjtjük az egyedi meccseket (az ID alapján)
        results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) uniqueFixturesMap.set(f.id, f); });
        
        // Végleges lista és rendezés dátum szerint
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));
        
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve ${daysInt} napra.`);

        // Cache-be mentés
        if (finalFixtures.length > 0) {
            scriptCache.set(cacheKey, finalFixtures);
            console.log(`ESPN eredmények cache-elve: ${cacheKey}`);
        }
        
        return finalFixtures;

    } catch (e) {
        console.error(`Súlyos hiba az ESPN lekérés során: ${e.message}`);
        return [];
    }
}


// --- ODDS LEKÉRÉS ORCHESTRATOR ---

/**
 * Lekéri és konszolidálja az élő szorzókat, valamint a nyitó szorzókat a legfontosabb marketekre.
 * @param {string} home A hazai csapat neve (ESPN/Frontend).
 * @param {string} away A vendég csapat neve (ESPN/Frontend).
 * @param {string} sport A sportág.
 * @param {object} sportConfig A sportág konfigurációja.
 * @param {object|null} openingOdds Kézzel megadott nyitó szorzók (ha van).
 * @param {string} leagueName A liga neve az Odds API kulcs kereséséhez.
 * @returns {object} A konszolidált szorzó adatok.
 */
export async function getOptimizedOddsData(home, away, sport, sportConfig, openingOdds, leagueName) {
    if (!ODDS_API_KEY) {
        console.warn("Hiányzó ODDS_API_KEY. Szorzó lekérdezés kihagyva.");
        return { current: [], allMarkets: [], opening: [], fromCache: true, sport: sport }; // Cache-elt eredménynek számítjuk
    }
    
    // Meghatározzuk a legmegfelelőbb Odds API kulcsot a liga alapján
    const leagueKey = leagueName ? getOddsApiKeyForLeague(leagueName, sport) : sportConfig.odds_api_sport_key;
    if (!leagueKey) {
        console.warn(`Odds API: Nem található megfelelő sport kulcs a ${leagueName} ligához (${sport}).`);
        return { current: [], allMarkets: [], opening: [], fromCache: true, sport: sport }; 
    }

    console.log(`Odds API lekérés indul: ${home} vs ${away} (${leagueKey})`);
    
    // --- 1. Csapatnevek Normalizálása ---
    // Az Odds API válaszok alapján próbáljuk megkeresni a helyes neveket.
    // Először megpróbáljuk a fő H2H marketet lekérni
    const h2hOddsRaw = await _callOddsApi(home, away, leagueKey, 'h2h', 'eu', false);
    
    // Ha van H2H válasz, akkor abból meg tudjuk nézni a tényleges Odds API-s neveket, 
    // de az `_callOddsApi` már intézte a `_getOddsApiTeamName` hívást a legjobb szimulált névvel.
    // Itt a leegyszerűsített esetnél maradunk, ahol az Odds API-nak átadjuk az ESPN nevet,
    // és az Odds API hívója intézi a fuzzy match-et (ami már meg is történt).
    
    // --- 2. Jelenlegi Szorzók Lekérése ---
    const currentH2H = h2hOddsRaw || [];

    // Totals (Gól/Pont) szorzók
    const currentTotals = await _callOddsApi(home, away, leagueKey, 'totals', 'eu', false) || [];

    // --- 3. Nyitó Szorzók Lekérése ---
    let openingH2H = [];
    if (!openingOdds) {
        // Csak akkor hívjuk, ha nincs manuális nyitó szorzó
        openingH2H = await _callOddsApi(home, away, leagueKey, 'h2h', 'eu', true) || [];
    } else {
        // Ha van manuális nyitó szorzó (pl. Google Sheet-ből)
        openingH2H = [
            { team: home, name: 'Hazai győzelem', price: openingOdds.home, bookmaker: 'Manual', isBest: true, isOpening: true },
            { team: away, name: 'Vendég győzelem', price: openingOdds.away, bookmaker: 'Manual', isBest: true, isOpening: true },
            { team: null, name: 'Döntetlen', price: openingOdds.draw, bookmaker: 'Manual', isBest: true, isOpening: true }
        ].filter(o => o.price != null);
    }
    
    // --- 4. Konszolidáció ---
    const allOdds = [...currentH2H, ...currentTotals, ...openingH2H.map(o => ({ ...o, isOpening: true }))];

    const result = {
        current: currentH2H, // Csak a H2H a fő markethez
        allMarkets: allOdds, // Minden szorzó (H2H, Totals, Opening)
        opening: openingH2H, // Csak a H2H nyitó szorzók
        fromCache: (h2hOddsRaw || currentTotals.length > 0) ? true : false, // Ha bármit találtunk cache-ben, akkor feltételezzük, hogy onnan jött (az odds cache TTL rövid)
        sport: sport
    };
    
    if (result.current.length > 0) {
        console.log(`Odds adatok sikeresen lekérve. H2H szorzók: ${result.current.map(o => o.name + ':' + o.price).join(', ')}`);
    } else {
        console.warn(`Nem sikerült élő szorzókat lekérni: ${home} vs ${away}`);
    }

    return result;
}

/**
 * Megkeresi a fő 'Totals' vonalat a szorzó adatokban (leggyakoribb x.5 vonal).
 * @param {object} oddsData A getOptimizedOddsData által visszaadott objektum.
 * @returns {number|null} A leggyakoribb totals vonal (pl. 2.5, 6.5, 220.5).
 */
export function findMainTotalsLine(oddsData) {
    const totalsOdds = oddsData.allMarkets.filter(o => o.name === 'Over' && o.point != null);
    if (totalsOdds.length === 0) return null;

    const pointCounts = {};
    totalsOdds.forEach(o => {
        // Csak az .5-ös végű vonalakat nézzük
        if (o.point % 1 !== 0.5) return;
        const key = o.point;
        pointCounts[key] = (pointCounts[key] || 0) + 1;
    });

    if (Object.keys(pointCounts).length === 0) return null;

    // Megkeressük a leggyakoribb vonalat
    let mainLine = null;
    let maxCount = 0;
    for (const point in pointCounts) {
        if (pointCounts[point] > maxCount) {
            maxCount = pointCounts[point];
            mainLine = parseFloat(point);
        }
    }
    
    return mainLine;
}


// --- RICH CONTEXT ORCHESTRATOR (FŐ STATISZTIKAI ADATGYŰJTÉS) ---

/**
 * Lekéri az összes szükséges statisztikai és kontextuális adatot egy meccshez.
 * Ez a függvény hívja meg az AI-t a meccs összefoglaló, kulcshiányzók és egyéb kontextus kinyerésére.
 * @param {string} sport A sportág.
 * @param {string} home A hazai csapat neve (ESPN/Frontend).
 * @param {string} away A vendég csapat neve (ESPN/Frontend).
 * @param {string} leagueName A liga neve.
 * @param {string} utcKickoff A meccs UTC időpontja.
 * @returns {object} Minden lekérdezett adat konszolidáltan.
 */
export async function getRichContextualData(sport, home, away, leagueName, utcKickoff) {
    const cacheKey = `rich_context_v36_tsdb_players_${sport}_${home}_${away}`;
    let rawData = scriptCache.get(cacheKey);
    let fromCache = !!rawData;
    
    if (fromCache) {
        console.log(`Cache találat (${cacheKey}), frissítés kihagyva.`);
        // Mivel a cache TTL 2 óra, logoljuk, hogy a cache-ből jött
        rawData.fromCache = true;
        return rawData;
    } else {
        console.log(`Nincs cache (${cacheKey}), friss adatok lekérése...`);
    }

    // --- 1. TheSportsDB Statisztikai Adatok Lekérése ---
    console.log(`TheSportsDB adatok lekérése indul: ${home} vs ${away}`);
    const homeData = await _callTheSportsDb(home, sport, leagueName, 'home');
    const awayData = await _callTheSportsDb(away, sport, leagueName, 'away');

    const leagueAverages = SPORT_CONFIG[sport]?.league_averages || {};
    
    // --- 2. AI Konzisztencia Ellenőrzés és Kontextus Kinyerés ---
    const allRawData = {
        home: homeData,
        away: awayData,
        leagueName: leagueName,
        utcKickoff: utcKickoff,
        sport: sport,
        leagueAverages: leagueAverages
    };

    // A prompt összeállítása a nyers statisztikai adatokkal
    const aiPrompt = `
        CRITICAL TASK: Analyze the raw data provided for the match between ${home} and ${away}.
        Your output MUST be a structured JSON object with two main keys: 'rich_context' and 'advanced_stats'.
        
        **RULES for rich_context:**
        1. Summarize the key statistical findings and current form of both teams.
        2. Identify 3-5 key players (injuries, form, high rating) from the key_players list and their status.
        3. Determine the match importance (e.g., derby, title race, relegation battle) based on league table context (if available).
        4. Briefly comment on the likely formation based on historical data or player roles (if available).
        5. Mention any key weather/pitch condition factors for the UTC time ${utcKickoff} (Assume typical conditions if not specified, but mention the potential impact if it's an important match).
        6. Provide a concise, neutral context (max 500 characters, Hungarian).

        **RULES for advanced_stats:**
        1. **MUST** contain a numerical 'xg' (Expected Goals) value for both home and away team, or the most relevant advanced metric based on the sport:
            - **Soccer:** Use a credible XG value or a combined offensive rating. If unknown, estimate based on raw stats.
            - **Hockey:** Use 'High_Danger_Chances_For_Pct' (HDCF%) if available. If unknown, estimate a 'rating' based on raw stats.
            - **Basketball:** Use 'pace' (tempo) and 'offensive_rating' if available. If unknown, estimate based on raw stats.
        2. MUST contain a numerical 'form_index' (0-10) for both home and away team, reflecting recent performance.

        --- RAW DATA ---
        Home Team (${home}): ${JSON.stringify(homeData || {})}
        Away Team (${away}): ${JSON.stringify(awayData || {})}
        League Averages: ${JSON.stringify(leagueAverages)}
        Match Date (UTC): ${utcKickoff}
    `;

    // AI hívása
    let aiContextResult;
    try {
        const aiResponse = await _callGemini(aiPrompt, 'rich_context', 2); // Két retry
        aiContextResult = JSON.parse(aiResponse);
    } catch (e) {
        console.error(`Hiba a Rich Context AI lekérésekor: ${e.message}`);
        // Hiba esetén alapértelmezett, üres adatokat adunk vissza
        aiContextResult = { 
            rich_context: `Súlyos hiba az AI kontextus lekérésekor. Alapértelmezett adatokkal folytatjuk. Hiba: ${e.message.substring(0, 100)}...`, 
            advanced_stats: { 
                home: { xg: 1.5, form_index: 5.0 }, 
                away: { xg: 1.5, form_index: 5.0 } 
            } 
        };
    }

    const richContext = aiContextResult.rich_context || "AI kontextus hiányzik/hibás.";
    const advancedStats = aiContextResult.advanced_stats || { home: {}, away: {} };
    
    // --- 3. Végső Adatok Konszolidálása ---
    // Az XG/form adatokat a Model.js-nek szánt `advancedData` objektumba rendezzük
    const advancedData = {
        home: {
            xg: advancedStats.home.xg || advancedStats.home.rating || 1.5,
            form_index: advancedStats.home.form_index || 5.0,
            pace: advancedStats.home.pace // Kosárlabdához
        },
        away: {
            xg: advancedStats.away.xg || advancedStats.away.rating || 1.5,
            form_index: advancedStats.away.form_index || 5.0,
            pace: advancedStats.away.pace // Kosárlabdához
        }
    };

    // A "rawStats" egy egyszerűsített objektum a Model.js számára
    const rawStats = {
        home: { ...homeData?.advanced_stats_team, form: advancedData.home.form_index },
        away: { ...awayData?.advanced_stats_team, form: advancedData.away.form_index }
    };

    // A "form" egy egyszerűsített objektum
    const form = {
        home: advancedData.home.form_index,
        away: advancedData.away.form_index
    };

    // Az összeállított adatok
    rawData = {
        rawStats, // Tömörített statisztikák
        richContext, // AI által generált kontextus
        advancedData, // AI által becsült XG/Form/Pace
        form, // Csak a form index
        rawData: allRawData, // Teljes nyers adatok (TSDB + AI)
        leagueAverages, // Liga átlagok
        fromCache: false // Most generáltuk
    };

    // Cache-be mentés
    if (richContext.length > 50) { // Csak akkor mentjük, ha sikeres volt az AI hívás (nem üres a kontextus)
        scriptCache.set(cacheKey, rawData);
        console.log(`Rich Context cache mentve: ${cacheKey}`);
    } else {
         console.warn(`Rich Context AI hívás hibás volt, nem cache-eltük az eredményt.`);
    }

    return rawData;
}

// Exportáljuk a segédfüggvényeket is
export { 
    _getOddsApiTeamName, 
    _callOddsApi, 
    _callTheSportsDb,
    _getTeamIdFromSportMonks
};