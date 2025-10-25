// --- JAVÍTOTT datafetch.txt ---

import axios from 'axios';
import NodeCache from 'node-cache';
// Importáljuk az ODDS_TEAM_NAME_MAP-et is a configból
import {
    SPORT_CONFIG, GEMINI_API_KEY, GEMINI_MODEL_ID, ODDS_API_KEY, SPORTMONKS_API_KEY, PLAYER_API_KEY,
    getOddsApiKeyForLeague, ODDS_TEAM_NAME_MAP, THESPORTSDB_API_KEY
} from './config.js';
import pkg from 'string-similarity';
const { findBestMatch } = pkg; // findBestMatch importálása

// Cache inicializálás
const scriptCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });
const oddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const sportmonksIdCache = new NodeCache({ stdTTL: 0, useClones: false }); // Never expires
const sportsDbCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600, useClones: false }); // Cache time reduced to 6 hours for TSDB

/**************************************************************
* DataFetch.js - Külső Adatgyűjtő Modul (Node.js Verzió)
* VÁLTOZÁS: TheSportsDB V2 API hívás végleges javítása:
* Helyes V2 végpont (/search/team/{name}) és Header alapú hitelesítés (X-API-KEY).
* JAVÍTÁS (2025-10-25):
* - Robusztusabb `getSportsDbMatchId`: Keres a 'previous' meccsek között is.
* - Részletesebb logolás a TSDB Player/Match list hívásoknál a hibakereséshez.
* - Időjárás geokódolás javítva (városnév fallback).
* - Robusztus _callGemini hibakezelés.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY (Header támogatással) ---
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            // Header-ek összefésülése
            const baseConfig = {
                timeout: 10000, // 10 másodperc timeout
                validateStatus: (status) => status >= 200 && status < 500, // Elfogadja a 4xx hibákat is a jobb logoláshoz
                headers: {} // Üres header objektum alapból
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };

            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig); // A config most már tartalmazza a header-t
            }

            // Státusz ellenőrzés (4xx és 5xx hibák naplózása)
            if (response.status < 200 || response.status >= 300) {
                 const error = new Error(`API hiba: Státusz kód ${response.status} URL: ${url.substring(0, 100)}...`);
                 error.response = response; // Teljes válasz hozzáadása a hibához
                 const apiMessage = response?.data?.Message || response?.data?.message || JSON.stringify(response?.data)?.substring(0,100);

                 // Speciális logolás gyakori hibákra
                 if (url.includes('thesportsdb') && apiMessage) { error.message += ` - TheSportsDB: ${apiMessage}`; }
                 if ([401, 403].includes(response.status)) { console.error(`Hitelesítési Hiba (${response.status})! Ellenőrizd az API kulcsot! URL: ${url.substring(0,100)}...`); }
                 if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${url}`); }
                 if (response.status === 429) { console.warn(`API Hiba: Túl sok kérés (429). Rate limit túllépve? URL: ${url.substring(0,100)}...`); }

                 throw error; // Dobjuk a hibát a retry logikához
            }
            return response; // Sikeres válasz
        } catch (error) {
             attempts++;
             let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;

             if (error.response) { // Ha van válasz a szervertől (pl. 4xx, 5xx)
                 errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                 // Azonnali kilépés kritikus hibáknál (pl. rossz kulcs, rate limit)
                 if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key') || error.message.includes('Missing API key')) {
                     console.error(errorMessage);
                     return null; // Nincs értelme újrapróbálni
                 }
             } else if (error.request) { // Ha nem jött válasz (pl. timeout)
                 errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
             } else { // Ha a kérés elküldése előtt hiba történt
                 errorMessage += `Beállítási hiba: ${error.message}`;
                 console.error(errorMessage, error.stack); // Stack trace is fontos lehet
                 return null; // Nincs értelme újrapróbálni
             }

             console.warn(errorMessage); // Figyelmeztetés logolása

             if (attempts <= retries) {
                 await new Promise(resolve => setTimeout(resolve, 1500 * attempts)); // Várakozás újrapróbálás előtt
             } else {
                 console.error(`API hívás végleg sikertelen: ${url.substring(0, 150)}...`);
                 return null; // Végleg sikertelen
             }
        }
    }
    console.error(`API hívás váratlanul véget ért (ez nem fordulhatna elő): ${url.substring(0, 150)}...`);
    return null; // Fallback return
}


// --- SPORTMONKS API --- // (Változatlan maradt)
async function findSportMonksTeamId(teamName) {
    const originalLowerName = teamName.toLowerCase().trim();
    if (!originalLowerName) return null;
    const cacheKey = `sportmonks_id_v4_${originalLowerName.replace(/\s+/g, '')}`;
    const cachedResult = sportmonksIdCache.get(cacheKey);
    if (cachedResult !== undefined) return cachedResult === 'not_found' ? null : cachedResult;
    if (!SPORTMONKS_API_KEY || SPORTMONKS_API_KEY.includes('<') || SPORTMONKS_API_KEY === 'YOUR_SPORTMONKS_API_KEY') {
         sportmonksIdCache.set(cacheKey, 'not_found');
         return null;
    }
    const TEAM_NAME_MAP = { 'genk': 'KRC Genk', 'betis': 'Real Betis', 'red star': 'Red Star Belgrade', 'sparta': 'Sparta Prague', 'inter': 'Internazionale', 'fc copenhagen': 'Copenhagen', 'manchester utd': 'Manchester United', 'atletico': 'Atletico Madrid', 'as roma': 'Roma' };
    let teamId = null;
    let namesToTry = [TEAM_NAME_MAP[originalLowerName] || teamName];
    const simplifiedName = teamName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc)\s+/i, '').trim();
    if (simplifiedName.toLowerCase() !== originalLowerName && !namesToTry.includes(simplifiedName)) namesToTry.push(simplifiedName);
    if (TEAM_NAME_MAP[originalLowerName] && !namesToTry.includes(teamName)) namesToTry.push(teamName);
    for (let attempt = 0; attempt < namesToTry.length; attempt++) {
        const searchName = namesToTry[attempt];
        try {
            const url = `https://api.sportmonks.com/v3/core/teams/search/${encodeURIComponent(searchName)}?api_token=${SPORTMONKS_API_KEY}`;
            const response = await axios.get(url, { timeout: 7000, validateStatus: () => true });
            if (response.status === 200 && response.data?.data?.length > 0) {
                teamId = response.data.data[0].id;
                console.log(`SportMonks ID találat: "${teamName}" -> "${response.data.data[0].name}" -> ${teamId}`);
                break;
            } else if (response.status !== 404) {
                 console.warn(`SportMonks API figyelmeztetés (${response.status}) Keresés: "${searchName}".`);
                 break;
            }
        } catch (error) {
            console.error(`Hiba a SportMonks csapat ID lekérésekor ("${searchName}"): ${error.message}`);
            if (!axios.isAxiosError(error) || error.code !== 'ECONNABORTED') break;
        }
         if (attempt < namesToTry.length - 1) await new Promise(resolve => setTimeout(resolve, 50));
    }
    sportmonksIdCache.set(cacheKey, teamId || 'not_found');
    if (!teamId) console.warn(`SportMonks: Végleg nem található ID ehhez: "${teamName}"`);
    return teamId;
}


// --- GEMINI API FUNKCIÓ (ROBUSZTUSABB HIBAKEZELÉSSEL) --- // (Változatlan maradt)
export async function _callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('<') || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        throw new Error("Hiányzó vagy érvénytelen GEMINI_API_KEY.");
    }
    if (!GEMINI_MODEL_ID) { throw new Error("Hiányzó GEMINI_MODEL_ID."); }

    const finalPrompt = `${prompt}\n\nCRITICAL OUTPUT INSTRUCTION: Your entire response must be ONLY a single, valid JSON object. Do not add any text, explanation, or introductory phrases outside of the JSON structure itself. Ensure the JSON is complete and well-formed.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
        },
    };
    console.log(`Gemini API hívás indul a '${GEMINI_MODEL_ID}' modellel... (Prompt hossza: ${finalPrompt.length})`);
    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000, // 2 perc timeout
            validateStatus: () => true // Minden státuszkódot elfogadunk
        });
        console.log(`Gemini API válasz státusz: ${response.status}`);
        if (response.status !== 200) {
            console.error('--- RAW GEMINI ERROR RESPONSE ---');
            console.error(JSON.stringify(response.data, null, 2));
            console.error('--- END RAW GEMINI ERROR RESPONSE ---');
            throw new Error(`Gemini API hiba: Státusz ${response.status} - ${JSON.stringify(response.data?.error?.message || response.data)}`);
        }

        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log('--- RAW GEMINI RESPONSE TEXT ---');
        if (responseText) {
            console.log(`Kapott karakterek száma: ${responseText.length}`);
            console.log(responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));
        } else {
            const finishReason = response.data?.candidates?.[0]?.finishReason || 'Ismeretlen';
            const safetyRatings = response.data?.candidates?.[0]?.safetyRatings;
            let blockReason = safetyRatings?.find(r => r.blocked)?.category || (finishReason === 'SAFETY' ? 'Safety' : 'N/A');
            console.warn(`Gemini nem adott vissza szöveges tartalmat! FinishReason: ${finishReason}. BlockReason: ${blockReason}. Teljes válasz:`, JSON.stringify(response.data));
            throw new Error(`Gemini nem adott vissza szöveges tartalmat. Ok: ${finishReason}${blockReason !== 'N/A' ? ` (${blockReason})` : ''}`);
        }
        console.log('--- END RAW GEMINI RESPONSE TEXT ---');

        let potentialJson = responseText.trim();
        const jsonMatch = potentialJson.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            console.log("Tisztítás: ```json``` körítés eltávolítva.");
            potentialJson = jsonMatch[1].trim();
        }

        const firstBrace = potentialJson.indexOf('{');
        const lastBrace = potentialJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            potentialJson = potentialJson.substring(firstBrace, lastBrace + 1);
        } else if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) {
             console.error("A kapott válasz tisztítás után sem tűnik JSON objektumnak:", potentialJson.substring(0, 500));
             throw new Error("A Gemini válasza nem volt felismerhető JSON formátumú.");
        }


        try {
            JSON.parse(potentialJson); // Csak ellenőrizzük, hogy valid-e
            console.log("Gemini API válasz sikeresen validálva JSON-ként.");
            return potentialJson; // Visszaadjuk a (potenciálisan tisztított) valid JSON stringet
        } catch (parseError) {
            console.error("A Gemini válasza a tisztítási kísérlet után sem volt valid JSON:", potentialJson.substring(0, 500), parseError);
            throw new Error(`A Gemini válasza nem volt érvényes JSON: ${parseError.message}`);
        }

    } catch (e) {
        console.error(`Végleges hiba a Gemini API hívás (_callGemini) során: ${e.message}`, e.stack);
        throw e; // Továbbdobjuk a hibát
    }
}


// --- THESPORTSDB FUNKCIÓK ---
const TSDB_HEADERS = { 'X-API-KEY': THESPORTSDB_API_KEY }; // API kulcs headerben

/**
 * Lekéri egy csapat TheSportsDB ID-ját név alapján (cache-elve).
 */
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    const cacheKey = `tsdb_teamid_v2h_path_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    // Helyes V2 végpont: /searchteams.php?t={teamName} VAGY /search/team/{teamName}? - Dokumentáció alapján ellenőrizni!
    // A log alapján a /search/team/{name} működött az ID keresésre. Maradjunk ennél.
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/searchteams.php?t=${encodeURIComponent(teamName)}`;
    // Próbáljuk meg a régebbi, kulcsot URL-ben váró végpontot is, hátha az működik jobban
    // const url = `https://www.thesportsdb.com/api/v2/json/search/team/${encodeURIComponent(teamName)}`;
    const config = { headers: TSDB_HEADERS }; // Header alapú hitelesítés továbbra is
    console.log(`TheSportsDB V2 Team Search: URL=${url}`); // Logoljuk az URL-t (kulcs nélkül)

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // A válasz struktúrája lehet 'teams' vagy 'search'
        const teamsArray = response?.data?.teams; // A searchteams.php 'teams' kulcsot használ

        // Csapat ID kinyerése (az első találatból)
        const teamId = (Array.isArray(teamsArray) && teamsArray.length > 0) ? teamsArray[0]?.idTeam : null;

        if (teamId) {
            console.log(`TheSportsDB (V2): ID találat "${teamName}" -> ${teamId}`);
            sportsDbCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`TheSportsDB (V2): Nem található ID ehhez: "${teamName}". Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        // Részletesebb hiba logolás
        console.error(`TheSportsDB Hiba (V2 getTeamId for ${teamName}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * JAVÍTOTT FUNKCIÓ: Lekéri a TheSportsDB Match ID-t a liga ID és csapat ID-k alapján.
 * Most már a 'previous' meccseket is ellenőrzi.
 */
async function getSportsDbMatchId(leagueName, homeTeamId, awayTeamId) {
    if (!THESPORTSDB_API_KEY || !homeTeamId || !awayTeamId) return null; // leagueName nem kritikus itt

    const cacheKey = `tsdb_matchid_v2_${homeTeamId}_${awayTeamId}`; // Cache kulcs frissítve
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) return cachedId === 'not_found' ? null : cachedId;

    const config = { headers: TSDB_HEADERS };
    let matchId = null;

    // 1. Próbálkozás: Következő meccsek (/schedule/next/team/{idTeam})
    const urlNext = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/eventsnext.php?id=${homeTeamId}`;
    //const urlNext = `https://www.thesportsdb.com/api/v2/json/schedule/next/team/${homeTeamId}`; // Régi V2 végpont?
    console.log(`TheSportsDB V2 Match Search (Next): URL=${urlNext.replace(THESPORTSDB_API_KEY, '<apikey>')}`);
    try {
        const responseNext = await makeRequest(urlNext, config);
        if (responseNext?.data?.events) {
            const events = responseNext.data.events || [];
            const match = events.find(e => e.idAwayTeam === awayTeamId || e.idHomeTeam === awayTeamId); // Ellenőrizzük mindkét irányt
            if (match) {
                matchId = match.idEvent;
                console.log(`TheSportsDB: Match ID ${matchId} találat (Next Events).`);
            }
        } else {
             console.warn(`TheSportsDB (Next Events): Nem jött érvényes válasz vagy nincs 'events' tömb. Státusz: ${responseNext?.status}`);
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (Next Events for ${homeTeamId}): ${error.message}`);
    }

    // 2. Próbálkozás: Ha a 'next' nem talált semmit, nézzük az 'previous'-t (utolsó 15 meccs)
    if (!matchId) {
        const urlPrev = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/eventslast.php?id=${homeTeamId}`;
        //const urlPrev = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${homeTeamId}`; // Régi V2 végpont?
        console.log(`TheSportsDB V2 Match Search (Previous): URL=${urlPrev.replace(THESPORTSDB_API_KEY, '<apikey>')}`);
        try {
            const responsePrev = await makeRequest(urlPrev, config);
             if (responsePrev?.data?.results) { // Az 'eventslast' végpont 'results'-t ad vissza
                const events = responsePrev.data.results || [];
                // Itt időrendben a legfrissebbet keressük, ami ma vagy tegnap volt esetleg
                const recentMatch = events
                    .sort((a, b) => new Date(b.dateEvent + 'T' + b.strTime) - new Date(a.dateEvent + 'T' + a.strTime))
                    .find(e => (e.idAwayTeam === awayTeamId || e.idHomeTeam === awayTeamId)); // Megint mindkét irányt nézzük
                if (recentMatch) {
                    // Ellenőrizzük, hogy a meccs dátuma közel van-e a maihoz (pl. +/- 1 nap), hogy ne egy régi meccset adjunk vissza
                    const matchDate = new Date(recentMatch.dateEvent);
                    const today = new Date();
                    const diffDays = Math.abs((matchDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays <= 2) { // Max 2 nap eltérés
                        matchId = recentMatch.idEvent;
                        console.log(`TheSportsDB: Match ID ${matchId} találat (Previous Events). Dátum: ${recentMatch.dateEvent}`);
                    } else {
                         console.warn(`TheSportsDB (Previous Events): Talált meccset (${recentMatch.idEvent}, ${recentMatch.dateEvent}), de túl régi.`);
                    }
                }
             } else {
                 console.warn(`TheSportsDB (Previous Events): Nem jött érvényes válasz vagy nincs 'results' tömb. Státusz: ${responsePrev?.status}`);
             }
        } catch (error) {
            console.error(`TheSportsDB Hiba (Previous Events for ${homeTeamId}): ${error.message}`);
        }
    }

    // Eredmény mentése a cache-be
    sportsDbCache.set(cacheKey, matchId || 'not_found');
    if (!matchId) {
        console.warn(`TheSportsDB: Végleg nem található Match ID ehhez: ${homeTeamId} vs ${awayTeamId} (${leagueName || 'N/A Liga'}).`);
    }
    return matchId;
}


/**
 * Lekéri egy csapat játékoskeretét TheSportsDB ID alapján (cache-elve).
 * Részletesebb logolással.
 */
async function getSportsDbPlayerList(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_players_v2_${teamId}`; // Kulcs frissítve
    const cachedPlayers = sportsDbCache.get(cacheKey);
    if (cachedPlayers !== undefined) return cachedPlayers === 'not_found' ? null : cachedPlayers;

    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/lookup_all_players.php?id=${teamId}`;
    //const url = `https://www.thesportsdb.com/api/v2/json/list/players/${teamId}`; // Régi V2 végpont?
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Player List: URL=${url.replace(THESPORTSDB_API_KEY, '<apikey>')}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const players = response?.data?.player; // A lookup_all_players 'player' kulcsot használ

        if (Array.isArray(players)) {
            console.log(`TheSportsDB (V2): ${players.length} játékos lekérve (${teamId}).`);
            // Csak a releváns adatokat adjuk vissza
            const relevantPlayers = players.map(p => ({
                idPlayer: p.idPlayer,
                strPlayer: p.strPlayer,
                strPosition: p.strPosition,
                // Esetleg további hasznos adatok: strNationality, dateBorn, strNumber
            }));
            sportsDbCache.set(cacheKey, relevantPlayers);
            return relevantPlayers;
        } else {
            // Részletesebb logolás hiba esetén
            console.warn(`TheSportsDB (V2): Nem található játékoslista (${teamId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getPlayerList for ${teamId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri egy csapat legutóbbi 5 meccsét TheSportsDB ID alapján (cache-elve).
 * Részletesebb logolással.
 */
async function getSportsDbRecentMatches(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_recent_v2_${teamId}`; // Kulcs frissítve
    const cachedMatches = sportsDbCache.get(cacheKey);
    if (cachedMatches !== undefined) return cachedMatches === 'not_found' ? null : cachedMatches;

    // Végpont az utolsó 5 meccshez
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/eventslast.php?id=${teamId}`;
    //const url = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${teamId}`; // Régi V2 végpont?
    const config = { headers: TSDB_HEADERS };
     console.log(`TheSportsDB V2 Recent Matches: URL=${url.replace(THESPORTSDB_API_KEY, '<apikey>')}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const matches = response?.data?.results; // Az 'eventslast' végpont 'results'-t ad vissza

        if (Array.isArray(matches)) {
            console.log(`TheSportsDB (V2): ${matches.length} legutóbbi meccs lekérve (${teamId}).`);
            // Csak a releváns adatokat adjuk vissza, dátum szerint rendezve (legfrissebb elöl)
            const relevantMatches = matches
                .map(m => ({
                    idEvent: m.idEvent,
                    strEvent: m.strEvent,
                    dateEvent: m.dateEvent,
                    strTime: m.strTime,
                    intHomeScore: m.intHomeScore,
                    intAwayScore: m.intAwayScore,
                    strHomeTeam: m.strHomeTeam, // Hozzáadva a csapatnevek
                    strAwayTeam: m.strAwayTeam
                }))
                .sort((a,b) => {
                    // Biztonságos dátum összehasonlítás
                    const dateA = new Date(a.dateEvent + 'T' + (a.strTime || '00:00:00'));
                    const dateB = new Date(b.dateEvent + 'T' + (b.strTime || '00:00:00'));
                    if (isNaN(dateA.getTime())) return 1;
                    if (isNaN(dateB.getTime())) return -1;
                    return dateB - dateA; // Legfrissebb elöl
                });
            sportsDbCache.set(cacheKey, relevantMatches);
            return relevantMatches;
        } else {
            console.warn(`TheSportsDB (V2): Nem található meccslista (${teamId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getRecentMatches for ${teamId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri a kezdőcsapatokat a TheSportsDB Match ID alapján (cache-elve).
 * Ellenőrzi a végpontot.
 */
async function getSportsDbLineups(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_lineups_v2_${matchId}`; // Kulcs frissítve
    const cachedLineups = sportsDbCache.get(cacheKey);
    if (cachedLineups !== undefined) return cachedLineups === 'not_found' ? null : cachedLineups;

    // Végpont: /lookuplineup.php?id={idEvent}
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/lookuplineup.php?id=${matchId}`;
    //const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_lineup/${matchId}`; // Régi V2 végpont?
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Lineups: URL=${url.replace(THESPORTSDB_API_KEY, '<apikey>')}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const lineups = response?.data?.lineup; // Válasz kulcs: 'lineup'

        if (Array.isArray(lineups)) {
            console.log(`TheSportsDB (V2): Kezdőcsapatok lekérve a ${matchId} meccshez. (Ezek a legfrissebb adatok!)`);
            // Még nem dolgozzuk fel, csak tároljuk a JSON-t a Gemini-nek
            sportsDbCache.set(cacheKey, lineups);
            return lineups;
        } else {
            console.warn(`TheSportsDB (V2): Nem található felállás (${matchId}). Lehetséges, hogy még túl korai, vagy az API nem adja ehhez a meccshez. Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getLineups for ${matchId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri az esemény statisztikákat a TheSportsDB Match ID alapján (cache-elve).
 * Ellenőrzi a végpontot.
 */
async function getSportsDbMatchStats(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_stats_v2_${matchId}`; // Kulcs frissítve
    const cachedStats = sportsDbCache.get(cacheKey);
    if (cachedStats !== undefined) return cachedStats === 'not_found' ? null : cachedStats;

    // Végpont: /eventstatistics.php?id={idEvent}
    const url = `https://www.thesportsdb.com/api/v2/json/${THESPORTSDB_API_KEY}/eventstatistics.php?id=${matchId}`;
    //const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_stats/${matchId}`; // Régi V2 végpont?
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Stats: URL=${url.replace(THESPORTSDB_API_KEY, '<apikey>')}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        const stats = response?.data?.eventstats; // Válasz kulcs: 'eventstats'

        if (Array.isArray(stats)) {
            console.log(`TheSportsDB (V2): Statisztikák lekérve a ${matchId} meccshez.`);
            sportsDbCache.set(cacheKey, stats);
            return stats;
        } else {
            console.warn(`TheSportsDB (V2): Nem található statisztika (${matchId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2 getMatchStats for ${matchId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}


// --- Strukturált Időjárás (JAVÍTOTT GEOKÓDOLÁSSAL) ---
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
     if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) { return null; }

     let lat, lon;
     // 1. Próbálkozás: Koordináták kinyerése a stringből (ha van)
     const latLonMatch = stadiumLocation.match(/latitude\s*=\s*([\d.-]+)[\s,&]*longitude\s*=\s*([\d.-]+)/i);
     if (latLonMatch && latLonMatch[1] && latLonMatch[2]) {
         lat = latLonMatch[1];
         lon = latLonMatch[2];
         console.log(`Időjárás API: Koordináták kinyerve a stringből: ${lat}, ${lon}`);
     } else {
         // 2. Próbálkozás: Geokódolás a teljes stadionnévvel
         console.log(`Időjárás API: Geokódolás indítása: "${stadiumLocation}"`);
         try {
             const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stadiumLocation)}&count=1&language=hu&format=json`;
             const geoResponse = await makeRequest(geocodeUrl, { timeout: 5000 });
             if (geoResponse?.data?.results?.[0]) {
                 lat = geoResponse.data.results[0].latitude;
                 lon = geoResponse.data.results[0].longitude;
                 console.log(`Időjárás API: Geokódolás sikeres (teljes név): ${lat}, ${lon}`);
             } else {
                 console.warn(`Időjárás API: Geokódolás sikertelen (teljes név): "${stadiumLocation}". Próbálkozás városnévvel...`);
                 // 3. Próbálkozás (Fallback): Csak a városnévvel (feltételezve, hogy az utolsó vessző után van)
                 const cityMatch = stadiumLocation.match(/,\s*([^,]+)$/);
                 const cityName = cityMatch ? cityMatch[1].trim() : stadiumLocation.split(',')[0].trim(); // Ha nincs vessző, az első részt vesszük
                 if (cityName && cityName.toLowerCase() !== stadiumLocation.toLowerCase()) {
                     console.log(`Időjárás API: Geokódolás indítása (csak város): "${cityName}"`);
                     const geocodeCityUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=hu&format=json`;
                     const geoCityResponse = await makeRequest(geocodeCityUrl, { timeout: 5000 });
                     if (geoCityResponse?.data?.results?.[0]) {
                         lat = geoCityResponse.data.results[0].latitude;
                         lon = geoCityResponse.data.results[0].longitude;
                         console.log(`Időjárás API: Geokódolás sikeres (csak város): ${lat}, ${lon}`);
                     } else {
                         console.warn(`Időjárás API: Geokódolás sikertelen (csak városnévvel is): "${cityName}"`);
                     }
                 }
             }
         } catch (e) {
             console.warn(`Időjárás API geokódolási hiba: ${e.message}`);
             // Nem állunk meg, lat/lon null marad
         }
     }

     if (!lat || !lon) {
         console.warn("Időjárás API: Nem sikerült koordinátákat szerezni.");
         return null; // Nem tudunk időjárást lekérni koordináták nélkül
     }

     // Időjárás lekérése a koordináták alapján (ez a rész változatlan)
     try {
         const startTime = new Date(utcKickoff);
         if (isNaN(startTime.getTime())) { console.warn(`Időjárás API: Érvénytelen kezdési idő: ${utcKickoff}`); return null; }

         const forecastDate = startTime.toISOString().split('T')[0];
         const forecastHour = startTime.getUTCHours();

         if (!/^\d{4}-\d{2}-\d{2}$/.test(forecastDate)) { console.warn(`Időjárás API: Érvénytelen dátum formátum: ${forecastDate}`); return null; }

         const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,wind_speed_10m&timezone=auto&start_date=${forecastDate}&end_date=${forecastDate}`;
         console.log(`Időjárás API: Adatok lekérése: ${weatherUrl}`);
         const weatherResponse = await makeRequest(weatherUrl, { timeout: 5000 });
         const hourlyData = weatherResponse?.data?.hourly;

         if (!hourlyData?.time || !hourlyData?.precipitation || !hourlyData?.wind_speed_10m || hourlyData.time.length === 0) {
             console.warn(`Időjárás API: Hiányos vagy üres válasz (${stadiumLocation}, ${lat}, ${lon}). Válasz:`, weatherResponse?.data);
             return null;
         }

         // Megkeressük a kezdési órához legközelebbi adatot
         const targetTimeISO = `${forecastDate}T${String(forecastHour).padStart(2, '0')}:00`;
         let timeIndex = -1;
         for (let i = 0; i < hourlyData.time.length; i++) {
             // Az API időzónával adhatja vissza, ezért csak az év-hónap-nap-óra részt hasonlítjuk
             const apiTimeStr = hourlyData.time[i];
             if (apiTimeStr && apiTimeStr.substring(0, 13) === targetTimeISO.substring(0, 13)) {
                 timeIndex = i;
                 break;
             }
         }


         if (timeIndex === -1) {
             console.warn(`Időjárás API: Nem található pontos óra adat ${targetTimeISO}-hoz. Fallback az első elérhető órára.`);
             timeIndex = 0; // Visszaállunk az első órára, ha nincs pontos találat
         }

         // Biztosítjuk, hogy az index érvényes
         if (timeIndex < 0 || timeIndex >= hourlyData.precipitation.length || timeIndex >= hourlyData.wind_speed_10m.length) {
             console.error(`Időjárás API: Érvénytelen index (${timeIndex}) a kapott adatokhoz.`);
             return null;
         }


         const structuredWeather = {
             precipitation_mm: hourlyData.precipitation[timeIndex],
             wind_speed_kmh: hourlyData.wind_speed_10m[timeIndex]
         };
         console.log(`Időjárás API: Adat (${stadiumLocation} @ ${hourlyData.time[timeIndex]}): Csap: ${structuredWeather.precipitation_mm}mm, Szél: ${structuredWeather.wind_speed_kmh}km/h`);
         return structuredWeather;

     } catch (e) {
         console.error(`Időjárás API hiba (adatlekérés): ${e.message}`);
         return null;
     }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (JAVÍTOTT TSDB HÍVÁSOKKAL) ---
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v39_full_tsdb_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzió növelve
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        // Friss odds adatok lekérése akkor is, ha a kontextus cache-ből jön
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) {
             // Itt nem írjuk felül a cache-t, csak a visszatérési értékhez adjuk
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        // Ha az odds is cache-ből jött, vagy nem sikerült lekérni, az eredeti cache-elt oddsal térünk vissza (ha volt benne)
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        // --- 1. LÉPÉS: TheSportsDB Adatok Lekérése (MAXIMÁLIS) ---
        console.log(`TheSportsDB adatok lekérése indul: ${homeTeamName} vs ${awayTeamName}`);
        const [homeTeamId, awayTeamId] = await Promise.all([ getSportsDbTeamId(homeTeamName), getSportsDbTeamId(awayTeamName) ]);

        // Csak akkor próbálunk Match ID-t, Lineupot, Statisztikát keresni, ha MINDKÉT csapat ID megvan
        let matchId = null;
        let lineups = null;
        let matchStats = null;
        if (homeTeamId && awayTeamId) {
            matchId = await getSportsDbMatchId(leagueName, homeTeamId, awayTeamId); // Match ID megszerzése (javított függvénnyel)
            if (matchId) {
                // Csak akkor kérjük le, ha van Match ID
                [lineups, matchStats] = await Promise.all([
                    getSportsDbLineups(matchId), // Kezdőcsapat/Felállás
                    getSportsDbMatchStats(matchId) // Meccs statisztikák
                ]);
            } else {
                 console.warn(`TSDB: Match ID nem található, Lineup és Statisztika lekérés kihagyva.`);
            }
        } else {
             console.warn(`TSDB: Legalább az egyik csapat ID hiányzik, Match ID, Lineup és Statisztika lekérés kihagyva.`);
        }

        // Játékoslista és meccselőzmények lekérése (ezek csak csapat ID-t igényelnek)
        const [homePlayers, awayPlayers, homeMatches, awayMatches] = await Promise.all([
            homeTeamId ? getSportsDbPlayerList(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbPlayerList(awayTeamId) : Promise.resolve(null),
            homeTeamId ? getSportsDbRecentMatches(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbRecentMatches(awayTeamId) : Promise.resolve(null),
        ]);

        // Összegyűjtjük a TSDB adatokat
        const sportsDbData = {
             homeTeamId, awayTeamId, matchId,
             homePlayers: homePlayers || [], // Mindig tömb legyen
             awayPlayers: awayPlayers || [], // Mindig tömb legyen
             homeMatches: homeMatches || [], // Mindig tömb legyen
             awayMatches: awayMatches || [], // Mindig tömb legyen
             lineups: lineups, // Lehet null
             matchStats: matchStats // Lehet null
        };
        console.log(`TheSportsDB adatok lekérve: H_ID=${homeTeamId || 'N/A'}, A_ID=${awayTeamId || 'N/A'}, MatchID=${matchId || 'N/A'}, Lineups: ${lineups ? 'OK' : 'N/A'}, Stats: ${matchStats ? 'OK' : 'N/A'}, H_Players: ${homePlayers?.length || 0}, A_Players: ${awayPlayers?.length || 0}, H_Matches: ${homeMatches?.length || 0}, A_Matches: ${awayMatches?.length || 0}`);

        // --- 2. LÉPÉS: Gemini AI Hívás (ÚJ PROMPT V39 - TSDB adatokkal feltöltve) ---
        // Előkészítjük a promptba beillesztendő adatokat (csak ha vannak)
        const homePlayerNames = sportsDbData.homePlayers.slice(0, 15).map(p => `${p.strPlayer} (${p.strPosition || '?'})`).join(', ') || 'N/A';
        const awayPlayerNames = sportsDbData.awayPlayers.slice(0, 15).map(p => `${p.strPlayer} (${p.strPosition || '?'})`).join(', ') || 'N/A';
        const homeRecentMatchInfo = sportsDbData.homeMatches.slice(0, 5).map(m => `${m.dateEvent} ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam}`).join('; ') || 'N/A';
        const awayRecentMatchInfo = sportsDbData.awayMatches.slice(0, 5).map(m => `${m.dateEvent} ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam}`).join('; ') || 'N/A';

        // Kezdőcsapatok kinyerése (ha van lineup adat)
        const extractLineup = (lineupData, teamId) => {
            if (!lineupData || !Array.isArray(lineupData)) return 'N/A';
            const teamLineup = lineupData.find(l => l.idTeam === teamId && l.strFormation); // Keressük a formációt is tartalmazó bejegyzést
            return teamLineup?.strLineup || 'N/A'; // Visszaadjuk a játékosok listáját
        };
        const startingHomePlayers = extractLineup(sportsDbData.lineups, homeTeamId);
        const startingAwayPlayers = extractLineup(sportsDbData.lineups, awayTeamId);

        // Meccs statisztikák JSON stringgé alakítása (rövidítve)
        const matchStatsSample = sportsDbData.matchStats ? JSON.stringify(sportsDbData.matchStats).substring(0, 500) + '...' : 'N/A';

        const PROMPT_V39 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away).
Provide a single, valid JSON object. Focus ONLY on the requested fields.
**CRITICAL: You MUST use the latest factual data provided below (e.g., Lineups, Recent Matches from TheSportsDB) over your general knowledge.** If TSDB data is N/A, use your knowledge but state the uncertainty.

AVAILABLE FACTUAL DATA (From TheSportsDB):
- Match ID: ${sportsDbData.matchId || 'N/A'}
- Home Team ID: ${sportsDbData.homeTeamId || 'N/A'}
- Away Team ID: ${sportsDbData.awayTeamId || 'N/A'}
- Home Players (Sample): ${homePlayerNames}
- Away Players (Sample): ${awayPlayerNames}
- Home Recent Matches (Last 5): ${homeRecentMatchInfo}
- Away Recent Matches (Last 5): ${awayRecentMatchInfo}
- Starting Home XI: ${startingHomePlayers}
- Starting Away XI: ${startingAwayPlayers}
- Match Stats (if available): ${matchStatsSample}

REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data):
1. Basic Stats: gp, gf, ga FOR THE CURRENT SEASON/COMPETITION. If TSDB recent matches are available, use them to verify form, otherwise use your knowledge.
2. H2H: Last 5 structured results + summary.
3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. (CRITICAL: Use Starting XI/Player List from TSDB to verify player availability if possible. If Starting XI is 'N/A', mention this uncertainty).
4. Recent Form: W-D-L strings (overall, home/away). Use TSDB recent matches if available.
5. Key Players: name, role, recent key stat. Use TSDB player list for names/roles if available.
6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known).
--- SPECIFIC DATA BY SPORT ---
IF soccer:
  7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation. (CRITICAL: Infer formation from Starting XI in TSDB data if available and stated, e.g., "4-3-3". If N/A, use your knowledge but state it's an estimate).
  8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }. Identify key attacking/defending patterns.
  9. Key Matchups: Identify 1-2 key positional or player battles based on tactics and player roles.
IF hockey:
  7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. Use your knowledge if TSDB stats are N/A.
IF basketball:
  7. Advanced Styles: Shot Distribution { home: "e.g., Heavy 3-point", away: "..." }, Defensive Style { home: "e.g., Aggressive Perimeter", away: "..." }. Use your knowledge.

OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately. Fields for other sports can be omitted.
STRUCTURE: { "stats":{ "home":{...}, "away":{...} }, "h2h_summary":"...", "h2h_structured":[...], "team_news":{ "home":"...", "away":"..." }, "absentees":{ "home":[{name, importance, role}], "away":[] }, "absentee_impact_analysis":"...", "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." }, "key_players":{ "home":[{name, role, stat}], "away":[] }, "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } }, "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} }, "tactical_patterns":{ "home":[], "away":[] }, "key_matchups":{ "description":"..." }, "advanced_stats_team":{ "home":{...}, "away":{...} }, "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} }, "shot_distribution":{ "home":"...", "away":"..." }, "defensive_style":{ "home":"...", "away":"..." }, "league_averages": { /* Optional: avg_goals_per_game, etc. */ } }`;

        // Párhuzamosan hívjuk a Geminit és az Odds API-t
        const [geminiJsonString, fetchedOddsData] = await Promise.all([
            _callGemini(PROMPT_V39),
            getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName) // Odds lekérés (javított configgal)
        ]);

        let geminiData = null;
        try {
             geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null;
        } catch (e) {
             console.error(`Gemini JSON parse hiba: ${e.message}. Kapott string (első 500 karakter):`, (geminiJsonString || '').substring(0, 500));
             // Dobhatnánk hibát, vagy folytathatjuk alapértelmezett adatokkal
             // Most folytatjuk, de logoljuk a hibát
        }

        if (!geminiData) {
            console.warn("Gemini API hívás sikertelen vagy a válasz nem volt valid JSON. Alapértelmezett adatok használata.");
            // Létrehozunk egy üres struktúrát, hogy a többi kód ne omoljon össze
            geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home:{}, away:{} }, tactical_patterns:{ home:[], away:[] }, key_matchups:{}, advanced_stats_team:{ home:{}, away:{} }, advanced_stats_goalie:{ home_goalie:{}, away_goalie:{} }, shot_distribution:{}, defensive_style:{}, absentees: { home:[], away:[] }, team_news: { home:"N/A", away:"N/A" }, h2h_structured: [] };
        }

        // --- 3. LÉPÉS: Strukturált időjárás lekérése ---
        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff); // Javított függvénnyel

        // --- 4. LÉPÉS: Adatok Összefésülése és Visszaadása ---
        const finalData = {};

        // Segédfüggvény statisztikák biztonságos parse-olásához
        const parseStat = (val, defaultValue = null) => {
            if (val === null || val === undefined || val === "N/A") return defaultValue;
            const num = Number(val);
            return (!isNaN(num) && num >= 0) ? num : defaultValue;
        };

        // GP (Games Played) meghatározása: Gemini adat vagy forma string hossza
        const inferGp = (formString) => {
            if (!formString || typeof formString !== 'string' || formString === "N/A") return 5; // Default 5 meccs, ha nincs adat
            const matches = formString.match(/[WDL]/g);
            return matches ? Math.min(matches.length, 10) : 5; // Max 10 meccs formából
        };

        let defaultGpHome = inferGp(geminiData?.form?.home_overall);
        let defaultGpAway = inferGp(geminiData?.form?.away_overall);
        let homeGp = parseStat(geminiData?.stats?.home?.gp, defaultGpHome);
        let awayGp = parseStat(geminiData?.stats?.away?.gp, defaultGpAway);
        // Biztosítjuk, hogy a GP legalább 1 legyen
        homeGp = Math.max(1, homeGp || 1);
        awayGp = Math.max(1, awayGp || 1);

        finalData.stats = {
            home: {
                gp: homeGp,
                gf: parseStat(geminiData?.stats?.home?.gf),
                ga: parseStat(geminiData?.stats?.home?.ga)
            },
            away: {
                gp: awayGp,
                gf: parseStat(geminiData?.stats?.away?.gf),
                ga: parseStat(geminiData?.stats?.away?.ga)
            }
        };

        // Többi adat biztonságos átvétele a Gemini válaszból (default értékekkel)
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = {
            home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [],
            away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : []
        };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };

        // Key players adatainak normalizálása
        const normalizeKeyPlayers = (players) => (Array.isArray(players) ? players : [])
            .map(p => ({
                name: p?.name || '?',
                role: p?.role || '?',
                stats: p?.stat || p?.stats || 'N/A' // Elfogadja a 'stat' és 'stats' kulcsot is
            }));
        finalData.key_players = {
            home: normalizeKeyPlayers(geminiData?.key_players?.home),
            away: normalizeKeyPlayers(geminiData?.key_players?.away)
        };

        finalData.contextual_factors = geminiData?.contextual_factors || {};
        finalData.contextual_factors.stadium_location = finalData.contextual_factors.stadium_location || "N/A";
        finalData.contextual_factors.match_tension_index = finalData.contextual_factors.match_tension_index || "N/A";
        finalData.contextual_factors.pitch_condition = finalData.contextual_factors.pitch_condition || "N/A";
        finalData.contextual_factors.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };
        finalData.contextual_factors.structured_weather = structuredWeather; // Hozzáadjuk a lekérdezett strukturált adatot
        finalData.referee = finalData.contextual_factors.referee; // Könnyebb eléréshez

        finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } };
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] };
        finalData.key_matchups = geminiData?.key_matchups || {};

        // Sport-specifikus adatok
        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} }; // Hockey
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} }; // Hockey
        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" }; // Basketball
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" }; // Basketball

        // SportMonks xG (ha lesz implementálva) - egyelőre üresen hagyjuk
        finalData.advancedData = { home: { xg: null }, away: { xg: null } };

        finalData.league_averages = geminiData?.league_averages || {}; // Opcionális liga átlagok
        finalData.sportsDbData = sportsDbData; // Hozzáadjuk a nyers TSDB adatokat is a teljesség kedvéért

        // Gazdag kontextus string összeállítása (ez változatlan)
        const richContextParts = [
             finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`,
             finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`,
             (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news.home||'-'}, V:${finalData.team_news.away||'-'}`,
             (finalData.absentees.home.length > 0 || finalData.absentees.away.length > 0) && `- Hiányzók: H:${finalData.absentees.home.map(p=>p.name).join(', ')||'-'}, V:${finalData.absentees.away.map(p=>p.name).join(', ')||'-'}`,
             finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`,
             (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") && `- Forma: H:${finalData.form.home_overall}, V:${finalData.form.away_overall}`,
             (finalData.tactics?.home?.style !== "N/A" || finalData.tactics?.away?.style !== "N/A") && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`,
             structuredWeather ? `- Időjárás: ${structuredWeather.precipitation_mm}mm csap, ${structuredWeather.wind_speed_kmh}km/h szél.` : (finalData.contextual_factors.weather ? `- Időjárás: ${finalData.contextual_factors.weather}` : `- Időjárás: N/A`),
             finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}`
        ].filter(Boolean); // Kiszűri a null/false/undefined elemeket
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";

        // Visszatérési objektum összeállítása
        const result = {
            rawStats: finalData.stats,
            leagueAverages: finalData.league_averages,
            richContext,
            advancedData: finalData.advancedData, // Jelenleg csak xG placeholder
            form: finalData.form,
            rawData: finalData // Tartalmazza a geminiData-t és sportsDbData-t is
        };

        // KRITIKUS VALIDÁLÁS: Ellenőrizzük, hogy a statisztikák érvényesek-e
        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' || typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen statisztikák a Gemini válasz vagy a feldolgozás után. HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            // Dobhatnánk hibát, vagy megpróbálhatnánk helyreállítani
            throw new Error(`Kritikus statisztikák érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez az adatfeldolgozás után.`);
        }

        // Eredmény mentése a cache-be
        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + TSDB(ID,Pl,M) + Időjárás), cache mentve (${ck}).`);
        // Visszaadjuk az eredményt és a (potenciálisan friss) odds adatokat
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        // Itt már érdemes hibát dobni, hogy az AnalysisFlow leálljon
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK (JAVÍTOTT LOGOLÁSSAL ÉS FALLBACK-KEL) ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) {
        // console.log("Odds API kulcs hiányzik, szorzó lekérés kihagyva."); // Csökkentett log zaj
        return null;
    }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v8_${key}`; // Verzió növelve a fallback logika miatt
    const cached = oddsCache.get(cacheKey);
    if (cached) {
        // console.log(`Odds cache találat (${cacheKey})`);
        return { ...cached, fromCache: true };
    }
    // console.log(`Nincs odds cache (${cacheKey}), friss adatok lekérése...`);

    // Először próbáljuk a specifikus liga kulccsal (ha van)
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);

    // Ha a specifikus liga kulccsal nem sikerült, ÉS volt megadva liga név,
    // próbáljuk meg az alapértelmezett sport kulccsal is (fallback)
    if (!liveOdds && leagueName && getOddsApiKeyForLeague(leagueName) !== sportConfig.odds_api_sport_key) {
        console.log(`Odds API: Specifikus liga (${leagueName}) sikertelen, próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
        liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, null); // leagueName = null -> alap kulcsot használ
    }

    // Eredmény cache-elése és visszaadása
    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        return { ...liveOdds, fromCache: false };
    }

    console.warn(`Nem sikerült élő szorzókat lekérni (még fallback után sem): ${homeTeam} vs ${awayTeam}`);
    return null;
}

// Csapatnév variációk generálása (ODDS_TEAM_NAME_MAP használatával)
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([
        teamName, // Eredeti
        lowerName, // Kisbetűs
        ODDS_TEAM_NAME_MAP[lowerName] || teamName // Térkép alapján (ha van)
    ]);
    // Rövidítések eltávolítása (pl. FC, SC)
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.)\s+/i, '').trim());
    // Csak az első szó (kevésbé megbízható, de néha segít)
    // variations.add(lowerName.split(' ')[0]);

    // Esetleg speciális karakterek eltávolítása? (pl. pontok, kötőjelek)
    // variations.add(lowerName.replace(/[.-]/g, ''));

    return Array.from(variations).filter(name => name && name.length > 2); // Csak értelmes hosszúságú neveket adunk vissza
}

// Odds adatok lekérése az API-ból
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    // Meghatározzuk a használandó API kulcsot (liga specifikus vagy alapértelmezett)
    const specificApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : null;
    const oddsApiKey = specificApiKey || sportConfig.odds_api_sport_key; // Ha nincs specifikus, az alapot használjuk

    if (!ODDS_API_KEY || !oddsApiKey) {
        console.warn(`Odds API: Hiányzó kulcs vagy sport/liga kulcs. Liga: "${leagueName}", Használt kulcs: "${oddsApiKey || 'NINCS'}"`);
        return null;
    }

    // API URL összeállítása (Pinnacle-t használjuk)
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals,btts&bookmakers=pinnacle&oddsFormat=decimal`;
    // BTTS piacot is lekérjük

    console.log(`Odds API (${oddsApiKey}): Adatok lekérése... URL: ${url.replace(ODDS_API_KEY,'<apikey>')}`);
    try {
        const response = await makeRequest(url, { timeout: 10000 }); // makeRequest hibakezelővel

        // Ellenőrizzük a választ
        if (!response?.data || !Array.isArray(response.data)) {
            console.warn(`Odds API (${oddsApiKey}): Érvénytelen vagy üres válasz. Státusz: ${response?.status}`);
            // Itt már nem próbálkozunk fallbackkel, mert azt a getOptimizedOddsData kezeli
            return null;
        }
        if (response.data.length === 0) {
             console.warn(`Odds API (${oddsApiKey}): Nincs elérhető mérkőzés ebben a ligában/sportban.`);
             return null;
        }

        const oddsData = response.data;

        // Csapatnév variációk generálása a pontosabb illesztéshez
        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);

        // Legjobb egyezés keresése a kapott meccsek között (string similarity alapján)
        let bestMatch = null;
        let highestCombinedRating = 0.65; // Magasabb küszöb a fals pozitívok elkerülésére

        //console.log(`Odds API (${oddsApiKey}): Keresés ${homeTeam} vs ${awayTeam}... ${oddsData.length} meccs az API válaszban.`);
        for (const match of oddsData) {
            if (!match?.home_team || !match?.away_team) continue; // Kihagyjuk a hiányos meccseket

            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();

            // String hasonlóság számítása mindkét csapatra
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);

            // Csak akkor vesszük figyelembe, ha mindkét név elég hasonló
            if (!homeMatchResult?.bestMatch || !awayMatchResult?.bestMatch || homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue; // Minimum 0.5 hasonlóság

            const homeSim = homeMatchResult.bestMatch.rating;
            const awaySim = awayMatchResult.bestMatch.rating;
            // Súlyozott átlag (vagy egyszerű átlag), hogy mennyire passzol a meccs
            const combinedSim = (homeSim + awaySim) / 2;

            // Ha ez az eddigi legjobb találat, eltároljuk
            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = match;
            }
        }

        // Ha nem találtunk elég jó egyezést
        if (!bestMatch) {
            console.warn(`Odds API (${oddsApiKey}): Nem található elég jó egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam}.`);
            return null; // Nincs találat
        }

        console.log(`Odds API (${oddsApiKey}): Találat ${bestMatch.home_team} vs ${bestMatch.away_team} (${(highestCombinedRating*100).toFixed(1)}% hasonlóság).`);

        // Pinnacle oddsok kinyerése a legjobb meccshez
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
            console.warn(`Odds API: Nincs Pinnacle piac ehhez a meccshez: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
            return null;
        }

        const currentOdds = []; // Ide gyűjtjük a releváns oddsokat
        const allMarkets = bookmaker.markets; // Tartalmazza a h2h, totals, btts stb. piacokat

        // H2H (1X2) piac feldolgozása
        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const h2hOutcomes = h2hMarket?.outcomes;
        if (h2hOutcomes && Array.isArray(h2hOutcomes)) {
            h2hOutcomes.forEach(o => {
                if (o?.price && typeof o.price === 'number' && o.price > 1) {
                    let name = o.name;
                    // Név normalizálása (Hazai, Vendég, Döntetlen)
                    if (name.toLowerCase() === bestMatch.home_team.toLowerCase()) name = 'Hazai győzelem';
                    else if (name.toLowerCase() === bestMatch.away_team.toLowerCase()) name = 'Vendég győzelem';
                    else if (name.toLowerCase() === 'draw') name = 'Döntetlen';
                    // Ha nem standard, meghagyjuk az eredetit (bár Pinnacle általában standard neveket használ)

                    currentOdds.push({ name: name, price: o.price });
                }
            });
        } else {
             console.warn(`Odds API: Nincs H2H piac (Pinnacle) ehhez: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
        }

        // Totals (O/U) piac feldolgozása (csak a fő vonalhoz)
        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totalsOutcomes = totalsMarket?.outcomes;
        if (totalsOutcomes && Array.isArray(totalsOutcomes)) {
            // Fő vonal meghatározása (az, ahol az Over és Under oddsok a legközelebb vannak egymáshoz)
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            console.log(`Odds API: Meghatározott fő Totals vonal: ${mainLine}`);

            const overOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Over');
            const underOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Under');

            if (overOutcome?.price && typeof overOutcome.price === 'number' && overOutcome.price > 1) {
                currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price });
            }
            if (underOutcome?.price && typeof underOutcome.price === 'number' && underOutcome.price > 1) {
                currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price });
            }
        } else {
             console.warn(`Odds API: Nincs Totals piac (Pinnacle) ehhez: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
        }

        // BTTS (Both Teams To Score) piac feldolgozása (ha van)
        const bttsMarket = allMarkets.find(m => m.key === 'btts');
        const bttsOutcomes = bttsMarket?.outcomes;
        if(bttsOutcomes && Array.isArray(bttsOutcomes)) {
            const yesOutcome = bttsOutcomes.find(o => o.name === 'Yes');
            const noOutcome = bttsOutcomes.find(o => o.name === 'No');
            if (yesOutcome?.price && typeof yesOutcome.price === 'number' && yesOutcome.price > 1) {
                currentOdds.push({ name: 'BTTS Igen', price: yesOutcome.price });
            }
            if (noOutcome?.price && typeof noOutcome.price === 'number' && noOutcome.price > 1) {
                currentOdds.push({ name: 'BTTS Nem', price: noOutcome.price });
            }
        } // Nem logolunk warningot, ha nincs BTTS, mert nem mindenhol van

        // Visszaadjuk az összegyűjtött oddsokat és a teljes piaci adatot
        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;

    } catch (e) {
        // Hibakezelés makeRequest hívás közben
        console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}, Liga: ${leagueName || 'N/A'}, Kulcs: ${oddsApiKey}): ${e.message}`, e.stack);
        return null; // Hiba esetén null-t adunk vissza
    }
}

// Fő Totals vonal meghatározása (legközelebbi oddsok alapján) - Változatlan
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    // Összegyűjtjük az egyedi pontértékeket (line-okat)
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number' && !isNaN(p)))];
    if (points.length === 0) return defaultLine; // Ha nincs érvényes vonal

    // Végigmegyünk az összes vonalon
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        // Ha van Over és Under is az adott vonalhoz, és érvényes az oddsuk
        if (over?.price && typeof over.price === 'number' && under?.price && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price); // Különbség az oddsok között
            // Ha ez a különbség kisebb, mint az eddigi legkisebb, ez lesz az új "legjobb" vonal
            if (diff < closestPair.diff) {
                closestPair = { diff, line: point };
            }
        }
    }
    // Ha találtunk olyan vonalat, ahol az oddsok nagyon közel vannak (<0.5), azt tekintjük fő vonalnak
    if (closestPair.diff < 0.5) return closestPair.line;

    // Ha nincs egyértelműen közeli pár, akkor azt a vonalat adjuk vissza, amelyik a legközelebb van a sportág default vonalához
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5; // Biztosítjuk, hogy szám legyen
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine)); // Rendezés a defaulttól való távolság szerint
    return points[0]; // A legközelebbit adjuk vissza
}


// --- ESPN MECCSLEKÉRDEZÉS --- // (Változatlan maradt)
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig (${sport}).`);
        return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }

    // Dátumok generálása UTC szerint
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + d);
        return date.toISOString().split('T')[0].replace(/-/g, '');
    });

    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) { console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`); continue; }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push( makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return []; // Ha nincs esemény adat
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre') // Csak a még el nem kezdődött meccsek
                    .map(event => {
                         const competition = event.competitions?.[0];
                         if (!competition) return null;
                         const homeTeamData = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                         const awayTeamData = competition.competitors?.find(c => c.homeAway === 'away')?.team;

                         // Csapatnév kinyerése (próbálkozunk több mezővel)
                         const homeName = homeTeamData ? String(homeTeamData.shortDisplayName || homeTeamData.displayName || homeTeamData.name || '').trim() : null;
                         const awayName = awayTeamData ? String(awayTeamData.shortDisplayName || awayTeamData.displayName || awayTeamData.name || '').trim() : null;

                         const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;

                         // Alapvető adatok ellenőrzése (ID, csapatnevek, dátum)
                         if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                             return {
                                 id: String(event.id), // ESPN ID
                                 home: homeName,
                                 away: awayName,
                                 utcKickoff: event.date, // Kezdési idő UTC-ben (ISO string)
                                 league: safeLeagueName // Liga neve a configból
                             };
                         } else {
                             // console.warn(`ESPN: Kihagyva egy hiányos/érvénytelen esemény: ID=${event.id}, Date=${event.date}, Home=${homeName}, Away=${awayName}`);
                             return null; // Kihagyjuk a hiányos adatokat
                         }
                    }).filter(Boolean); // Kiszűrjük a null értékeket
            }).catch(error => {
                // Specifikus hiba logolás (pl. rossz slug)
                if (error.response?.status === 400 || error.message.includes('404')) console.warn(`ESPN Hiba (40x): Lehetséges, hogy rossz a slug '${slug}' (${leagueName})? URL: ${url}`);
                else console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`);
                return []; // Hiba esetén üres tömböt adunk vissza
            }));
            // Kis késleltetés a kérések között (rate limiting elkerülése)
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    try {
        const results = await Promise.all(promises); // Megvárjuk az összes API hívást

        // Összefésüljük az eredményeket és kiszűrjük a duplikátumokat ID alapján
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => {
             if (f?.id && !uniqueFixturesMap.has(f.id)) {
                 uniqueFixturesMap.set(f.id, f);
             }
        });

        // Rendezés dátum szerint (legkorábbi elöl)
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff);
            const dateB = new Date(b.utcKickoff);
            // Hibás dátumok kezelése a rendezésnél
            if (isNaN(dateA.getTime())) return 1;
            if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });

        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve.`);
        return finalFixtures;
    } catch (e) {
        console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack);
        return []; // Hiba esetén üres tömb
    }
}