// --- ÚJRA JAVÍTOTT datafetch.txt ---

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
* JAVÍTÁS (2025-10-25 v2):
* - Odds API URL visszaállítva, 'btts' piac eltávolítva a 422 hiba miatt.
* - TheSportsDB URL-ek visszaállítva az eredeti, header-alapú V2 formátumra a 404 hiba miatt.
**************************************************************/

// --- HIBATŰRŐ API HÍVÓ SEGÉDFÜGGVÉNY (Header támogatással) --- (Változatlan maradt)
async function makeRequest(url, config = {}, retries = 1) {
    let attempts = 0;
    while (attempts <= retries) {
        try {
            const baseConfig = {
                timeout: 10000,
                validateStatus: (status) => status >= 200 && status < 500,
                headers: {}
            };
            const currentConfig = { ...baseConfig, ...config, headers: { ...baseConfig.headers, ...config?.headers } };

            let response;
            if (currentConfig.method?.toUpperCase() === 'POST') {
                response = await axios.post(url, currentConfig.data, currentConfig);
            } else {
                response = await axios.get(url, currentConfig);
            }

            if (response.status < 200 || response.status >= 300) {
                 const error = new Error(`API hiba: Státusz kód ${response.status} URL: ${url.substring(0, 100)}...`);
                 error.response = response;
                 const apiMessage = response?.data?.Message || response?.data?.message || JSON.stringify(response?.data)?.substring(0,100);

                 if (url.includes('thesportsdb') && apiMessage) { error.message += ` - TheSportsDB: ${apiMessage}`; }
                 if ([401, 403].includes(response.status)) { console.error(`Hitelesítési Hiba (${response.status})! Ellenőrizd az API kulcsot! URL: ${url.substring(0,100)}...`); }
                 if (response.status === 404) { console.warn(`API Hiba: Végpont nem található (404). URL: ${url}`); }
                 if (response.status === 422) { console.warn(`API Hiba: Feldolgozhatatlan kérés (422 - pl. rossz paraméter). URL: ${url.substring(0,100)}... Válasz: ${apiMessage}`); } // 422 logolása
                 if (response.status === 429) { console.warn(`API Hiba: Túl sok kérés (429). Rate limit túllépve? URL: ${url.substring(0,100)}...`); }

                 throw error;
            }
            return response;
        } catch (error) {
             attempts++;
             let errorMessage = `API hívás hiba (${attempts}/${retries + 1}): ${url.substring(0, 150)}... - `;

             if (error.response) {
                 errorMessage += `Státusz: ${error.response.status}, Válasz: ${JSON.stringify(error.response.data)?.substring(0, 150)}`;
                 // Azonnali kilépés 401, 403, 429 esetén
                 if ([401, 403, 429].includes(error.response.status) || error.message.includes('Invalid API Key') || error.message.includes('Missing API key')) {
                     console.error(errorMessage);
                     return null;
                 }
                 // 422 esetén is kilépünk, mert valószínűleg a kérés formátuma rossz
                 if (error.response.status === 422) {
                    console.error(errorMessage); // Logoljuk error-ként
                    return null;
                 }
             } else if (error.request) {
                 errorMessage += `Timeout (${config.timeout || 10000}ms) vagy nincs válasz.`;
             } else {
                 errorMessage += `Beállítási hiba: ${error.message}`;
                 console.error(errorMessage, error.stack);
                 return null;
             }

             console.warn(errorMessage);

             if (attempts <= retries) {
                 await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
             } else {
                 console.error(`API hívás végleg sikertelen: ${url.substring(0, 150)}...`);
                 return null;
             }
        }
    }
    console.error(`API hívás váratlanul véget ért (ez nem fordulhatna elő): ${url.substring(0, 150)}...`);
    return null;
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
 * Visszaállítva az eredeti V2 útvonalra és header alapú hitelesítésre.
 */
async function getSportsDbTeamId(teamName) {
    if (!THESPORTSDB_API_KEY) { console.warn("TheSportsDB API kulcs hiányzik."); return null; }
    const lowerName = teamName.toLowerCase().trim();
    if (!lowerName) return null;
    // Cache kulcs lehetne specifikusabb, de ez is jó
    const cacheKey = `tsdb_teamid_v2_header_${lowerName.replace(/\s+/g, '')}`;
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) { return cachedId === 'not_found' ? null : cachedId; }

    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const url = `https://www.thesportsdb.com/api/v2/json/search/team/${encodeURIComponent(teamName)}`;
    const config = { headers: TSDB_HEADERS }; // Header alapú hitelesítés
    console.log(`TheSportsDB V2 Team Search (Header Auth): URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // A válasz struktúrája ennél a végpontnál 'teams' VAGY 'search' lehetett korábban, most 'teams'-re számítunk
        const teamsArray = response?.data?.teams || response?.data?.search; // Próbáljuk mindkettőt

        const teamId = (Array.isArray(teamsArray) && teamsArray.length > 0) ? teamsArray[0]?.idTeam : null;

        if (teamId) {
            console.log(`TheSportsDB (V2/Header): ID találat "${teamName}" -> ${teamId}`);
            sportsDbCache.set(cacheKey, teamId);
            return teamId;
        } else {
            console.warn(`TheSportsDB (V2/Header): Nem található ID ehhez: "${teamName}". Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Header getTeamId for ${teamName}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * JAVÍTOTT FUNKCIÓ: Lekéri a TheSportsDB Match ID-t.
 * Visszaállítva az eredeti V2 útvonalakra és header alapú hitelesítésre.
 */
async function getSportsDbMatchId(leagueName, homeTeamId, awayTeamId) {
    if (!THESPORTSDB_API_KEY || !homeTeamId || !awayTeamId) return null;

    const cacheKey = `tsdb_matchid_v2_header_${homeTeamId}_${awayTeamId}`; // Cache kulcs frissítve
    const cachedId = sportsDbCache.get(cacheKey);
    if (cachedId !== undefined) return cachedId === 'not_found' ? null : cachedId;

    const config = { headers: TSDB_HEADERS };
    let matchId = null;

    // 1. Próbálkozás: Következő meccsek
    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const urlNext = `https://www.thesportsdb.com/api/v2/json/schedule/next/team/${homeTeamId}`;
    console.log(`TheSportsDB V2 Match Search (Next/Header): URL=${urlNext}`);
    try {
        const responseNext = await makeRequest(urlNext, config);
        // Ennél a végpontnál 'events' a kulcs
        if (responseNext?.data?.events) {
            const events = responseNext.data.events || [];
            // Keressük a meccset, ahol a hazai vagy vendég csapat ID-je egyezik az ellenfélével
            const match = events.find(e => e.idAwayTeam === awayTeamId || e.idHomeTeam === awayTeamId);
            if (match) {
                matchId = match.idEvent;
                console.log(`TheSportsDB: Match ID ${matchId} találat (Next Events/Header).`);
            }
        } else {
             console.warn(`TheSportsDB (Next Events/Header): Nem jött érvényes válasz vagy nincs 'events' tömb. Státusz: ${responseNext?.status}`);
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (Next Events/Header for ${homeTeamId}): ${error.message}`);
    }

    // 2. Próbálkozás: Ha a 'next' nem talált semmit, nézzük az 'previous'-t
    if (!matchId) {
        // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
        const urlPrev = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${homeTeamId}`;
        console.log(`TheSportsDB V2 Match Search (Previous/Header): URL=${urlPrev}`);
        try {
            const responsePrev = await makeRequest(urlPrev, config);
            // Ennél a végpontnál 'results' a kulcs
             if (responsePrev?.data?.results) {
                const events = responsePrev.data.results || [];
                const recentMatch = events
                    .sort((a, b) => { // Dátum szerinti rendezés (legfrissebb elöl)
                        const dateA = new Date(a.dateEvent + 'T' + (a.strTime || '00:00:00'));
                        const dateB = new Date(b.dateEvent + 'T' + (b.strTime || '00:00:00'));
                        if(isNaN(dateA.getTime())) return 1;
                        if(isNaN(dateB.getTime())) return -1;
                        return dateB - dateA;
                     })
                    .find(e => (e.idAwayTeam === awayTeamId || e.idHomeTeam === awayTeamId)); // Keressük az ellenfelet

                if (recentMatch) {
                    const matchDate = new Date(recentMatch.dateEvent);
                    const today = new Date();
                    const diffDays = Math.abs((matchDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays <= 2) { // Max 2 nap eltérés engedélyezve
                        matchId = recentMatch.idEvent;
                        console.log(`TheSportsDB: Match ID ${matchId} találat (Previous Events/Header). Dátum: ${recentMatch.dateEvent}`);
                    } else {
                         console.warn(`TheSportsDB (Previous Events/Header): Talált meccset (${recentMatch.idEvent}, ${recentMatch.dateEvent}), de túl régi.`);
                    }
                }
             } else {
                 console.warn(`TheSportsDB (Previous Events/Header): Nem jött érvényes válasz vagy nincs 'results' tömb. Státusz: ${responsePrev?.status}`);
             }
        } catch (error) {
            console.error(`TheSportsDB Hiba (Previous Events/Header for ${homeTeamId}): ${error.message}`);
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
 * Visszaállítva az eredeti V2 útvonalra és header alapú hitelesítésre.
 */
async function getSportsDbPlayerList(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_players_v2_header_${teamId}`; // Kulcs frissítve
    const cachedPlayers = sportsDbCache.get(cacheKey);
    if (cachedPlayers !== undefined) return cachedPlayers === 'not_found' ? null : cachedPlayers;

    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const url = `https://www.thesportsdb.com/api/v2/json/list/players/${teamId}`;
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Player List (Header Auth): URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // Ennél a végpontnál 'player' a kulcs
        const players = response?.data?.player;

        if (Array.isArray(players)) {
            console.log(`TheSportsDB (V2/Header): ${players.length} játékos lekérve (${teamId}).`);
            const relevantPlayers = players.map(p => ({
                idPlayer: p.idPlayer,
                strPlayer: p.strPlayer,
                strPosition: p.strPosition,
            }));
            sportsDbCache.set(cacheKey, relevantPlayers);
            return relevantPlayers;
        } else {
            console.warn(`TheSportsDB (V2/Header): Nem található játékoslista (${teamId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Header getPlayerList for ${teamId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri egy csapat legutóbbi 5 meccsét TheSportsDB ID alapján (cache-elve).
 * Visszaállítva az eredeti V2 útvonalra és header alapú hitelesítésre.
 */
async function getSportsDbRecentMatches(teamId) {
    if (!THESPORTSDB_API_KEY || !teamId) return null;
    const cacheKey = `tsdb_recent_v2_header_${teamId}`; // Kulcs frissítve
    const cachedMatches = sportsDbCache.get(cacheKey);
    if (cachedMatches !== undefined) return cachedMatches === 'not_found' ? null : cachedMatches;

    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const url = `https://www.thesportsdb.com/api/v2/json/schedule/previous/team/${teamId}`;
    const config = { headers: TSDB_HEADERS };
     console.log(`TheSportsDB V2 Recent Matches (Header Auth): URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // Ennél a végpontnál 'results' a kulcs
        const matches = response?.data?.results;

        if (Array.isArray(matches)) {
            console.log(`TheSportsDB (V2/Header): ${matches.length} legutóbbi meccs lekérve (${teamId}).`);
            const relevantMatches = matches
                .map(m => ({
                    idEvent: m.idEvent,
                    strEvent: m.strEvent,
                    dateEvent: m.dateEvent,
                    strTime: m.strTime,
                    intHomeScore: m.intHomeScore,
                    intAwayScore: m.intAwayScore,
                    strHomeTeam: m.strHomeTeam,
                    strAwayTeam: m.strAwayTeam
                }))
                .sort((a,b) => {
                    const dateA = new Date(a.dateEvent + 'T' + (a.strTime || '00:00:00'));
                    const dateB = new Date(b.dateEvent + 'T' + (b.strTime || '00:00:00'));
                    if (isNaN(dateA.getTime())) return 1;
                    if (isNaN(dateB.getTime())) return -1;
                    return dateB - dateA;
                });
            sportsDbCache.set(cacheKey, relevantMatches);
            return relevantMatches;
        } else {
            console.warn(`TheSportsDB (V2/Header): Nem található meccslista (${teamId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Header getRecentMatches for ${teamId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri a kezdőcsapatokat a TheSportsDB Match ID alapján (cache-elve).
 * Visszaállítva az eredeti V2 útvonalra és header alapú hitelesítésre.
 */
async function getSportsDbLineups(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_lineups_v2_header_${matchId}`; // Kulcs frissítve
    const cachedLineups = sportsDbCache.get(cacheKey);
    if (cachedLineups !== undefined) return cachedLineups === 'not_found' ? null : cachedLineups;

    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_lineup/${matchId}`;
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Lineups (Header Auth): URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // Ennél a végpontnál 'lineup' a kulcs
        const lineups = response?.data?.lineup;

        if (Array.isArray(lineups)) {
            console.log(`TheSportsDB (V2/Header): Kezdőcsapatok lekérve a ${matchId} meccshez.`);
            sportsDbCache.set(cacheKey, lineups);
            return lineups;
        } else {
            console.warn(`TheSportsDB (V2/Header): Nem található felállás (${matchId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Header getLineups for ${matchId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}

/**
 * Lekéri az esemény statisztikákat a TheSportsDB Match ID alapján (cache-elve).
 * Visszaállítva az eredeti V2 útvonalra és header alapú hitelesítésre.
 */
async function getSportsDbMatchStats(matchId) {
    if (!THESPORTSDB_API_KEY || !matchId) return null;
    const cacheKey = `tsdb_stats_v2_header_${matchId}`; // Kulcs frissítve
    const cachedStats = sportsDbCache.get(cacheKey);
    if (cachedStats !== undefined) return cachedStats === 'not_found' ? null : cachedStats;

    // === JAVÍTÁS: Vissza az eredeti V2 útvonalra ===
    const url = `https://www.thesportsdb.com/api/v2/json/lookup/event_stats/${matchId}`;
    const config = { headers: TSDB_HEADERS };
    console.log(`TheSportsDB V2 Stats (Header Auth): URL=${url}`);

    try {
        const response = await makeRequest(url, config);
        if (response === null) { sportsDbCache.set(cacheKey, 'not_found'); return null; }

        // Ennél a végpontnál 'eventstats' a kulcs
        const stats = response?.data?.eventstats;

        if (Array.isArray(stats)) {
            console.log(`TheSportsDB (V2/Header): Statisztikák lekérve a ${matchId} meccshez.`);
            sportsDbCache.set(cacheKey, stats);
            return stats;
        } else {
            console.warn(`TheSportsDB (V2/Header): Nem található statisztika (${matchId}). Státusz: ${response?.status}, Válasz:`, JSON.stringify(response?.data).substring(0, 200));
            sportsDbCache.set(cacheKey, 'not_found');
            return null;
        }
    } catch (error) {
        console.error(`TheSportsDB Hiba (V2/Header getMatchStats for ${matchId}): ${error.message}`, error.response?.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
        sportsDbCache.set(cacheKey, 'not_found');
        return null;
    }
}


// --- Strukturált Időjárás (JAVÍTOTT GEOKÓDOLÁSSAL) --- (Változatlan maradt)
async function getStructuredWeatherData(stadiumLocation, utcKickoff) {
     if (!stadiumLocation || stadiumLocation === "N/A" || !utcKickoff) { return null; }
     let lat, lon;
     const latLonMatch = stadiumLocation.match(/latitude\s*=\s*([\d.-]+)[\s,&]*longitude\s*=\s*([\d.-]+)/i);
     if (latLonMatch && latLonMatch[1] && latLonMatch[2]) {
         lat = latLonMatch[1];
         lon = latLonMatch[2];
         console.log(`Időjárás API: Koordináták kinyerve a stringből: ${lat}, ${lon}`);
     } else {
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
                 const cityMatch = stadiumLocation.match(/,\s*([^,]+)$/);
                 const cityName = cityMatch ? cityMatch[1].trim() : stadiumLocation.split(',')[0].trim();
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
         } catch (e) { console.warn(`Időjárás API geokódolási hiba: ${e.message}`); }
     }
     if (!lat || !lon) { console.warn("Időjárás API: Nem sikerült koordinátákat szerezni."); return null; }
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
             console.warn(`Időjárás API: Hiányos vagy üres válasz (${stadiumLocation}, ${lat}, ${lon}). Válasz:`, weatherResponse?.data); return null;
         }
         const targetTimeISO = `${forecastDate}T${String(forecastHour).padStart(2, '0')}:00`;
         let timeIndex = -1;
         for (let i = 0; i < hourlyData.time.length; i++) {
             const apiTimeStr = hourlyData.time[i];
             if (apiTimeStr && apiTimeStr.substring(0, 13) === targetTimeISO.substring(0, 13)) {
                 timeIndex = i; break;
             }
         }
         if (timeIndex === -1) { console.warn(`Időjárás API: Nem található pontos óra adat ${targetTimeISO}-hoz. Fallback az első elérhető órára.`); timeIndex = 0; }
         if (timeIndex < 0 || timeIndex >= hourlyData.precipitation.length || timeIndex >= hourlyData.wind_speed_10m.length) {
             console.error(`Időjárás API: Érvénytelen index (${timeIndex}) a kapott adatokhoz.`); return null;
         }
         const structuredWeather = { precipitation_mm: hourlyData.precipitation[timeIndex], wind_speed_kmh: hourlyData.wind_speed_10m[timeIndex] };
         console.log(`Időjárás API: Adat (${stadiumLocation} @ ${hourlyData.time[timeIndex]}): Csap: ${structuredWeather.precipitation_mm}mm, Szél: ${structuredWeather.wind_speed_kmh}km/h`);
         return structuredWeather;
     } catch (e) { console.error(`Időjárás API hiba (adatlekérés): ${e.message}`); return null; }
}


// --- FŐ ADATGYŰJTŐ FUNKCIÓ (JAVÍTOTT TSDB HÍVÁSOKKAL) --- (Változatlan maradt)
export async function getRichContextualData(sport, homeTeamName, awayTeamName, leagueName, utcKickoff) {
    const teamNames = [homeTeamName, awayTeamName].sort();
    const ck = `rich_context_v39_full_tsdb_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`; // Verzió maradt
    const cached = scriptCache.get(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        const oddsResult = await getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName);
        if (oddsResult && !oddsResult.fromCache) {
             return { ...cached, fromCache: true, oddsData: oddsResult };
        }
        return { ...cached, fromCache: true };
    }
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);

    try {
        console.log(`TheSportsDB adatok lekérése indul: ${homeTeamName} vs ${awayTeamName}`);
        const [homeTeamId, awayTeamId] = await Promise.all([ getSportsDbTeamId(homeTeamName), getSportsDbTeamId(awayTeamName) ]);
        let matchId = null; let lineups = null; let matchStats = null;
        if (homeTeamId && awayTeamId) {
            matchId = await getSportsDbMatchId(leagueName, homeTeamId, awayTeamId);
            if (matchId) {
                [lineups, matchStats] = await Promise.all([ getSportsDbLineups(matchId), getSportsDbMatchStats(matchId) ]);
            } else { console.warn(`TSDB: Match ID nem található, Lineup és Statisztika lekérés kihagyva.`); }
        } else { console.warn(`TSDB: Legalább az egyik csapat ID hiányzik, Match ID, Lineup és Statisztika lekérés kihagyva.`); }

        const [homePlayers, awayPlayers, homeMatches, awayMatches] = await Promise.all([
            homeTeamId ? getSportsDbPlayerList(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbPlayerList(awayTeamId) : Promise.resolve(null),
            homeTeamId ? getSportsDbRecentMatches(homeTeamId) : Promise.resolve(null),
            awayTeamId ? getSportsDbRecentMatches(awayTeamId) : Promise.resolve(null),
        ]);

        const sportsDbData = { homeTeamId, awayTeamId, matchId, homePlayers: homePlayers || [], awayPlayers: awayPlayers || [], homeMatches: homeMatches || [], awayMatches: awayMatches || [], lineups: lineups, matchStats: matchStats };
        console.log(`TheSportsDB adatok lekérve: H_ID=${homeTeamId || 'N/A'}, A_ID=${awayTeamId || 'N/A'}, MatchID=${matchId || 'N/A'}, Lineups: ${lineups ? 'OK' : 'N/A'}, Stats: ${matchStats ? 'OK' : 'N/A'}, H_Players: ${homePlayers?.length || 0}, A_Players: ${awayPlayers?.length || 0}, H_Matches: ${homeMatches?.length || 0}, A_Matches: ${awayMatches?.length || 0}`);

        const homePlayerNames = sportsDbData.homePlayers.slice(0, 15).map(p => `${p.strPlayer} (${p.strPosition || '?'})`).join(', ') || 'N/A';
        const awayPlayerNames = sportsDbData.awayPlayers.slice(0, 15).map(p => `${p.strPlayer} (${p.strPosition || '?'})`).join(', ') || 'N/A';
        const homeRecentMatchInfo = sportsDbData.homeMatches.slice(0, 5).map(m => `${m.dateEvent} ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam}`).join('; ') || 'N/A';
        const awayRecentMatchInfo = sportsDbData.awayMatches.slice(0, 5).map(m => `${m.dateEvent} ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam}`).join('; ') || 'N/A';
        const extractLineup = (lineupData, teamId) => { if (!lineupData || !Array.isArray(lineupData)) return 'N/A'; const teamLineup = lineupData.find(l => l.idTeam === teamId && l.strFormation); return teamLineup?.strLineup || 'N/A'; };
        const startingHomePlayers = extractLineup(sportsDbData.lineups, homeTeamId);
        const startingAwayPlayers = extractLineup(sportsDbData.lineups, awayTeamId);
        const matchStatsSample = sportsDbData.matchStats ? JSON.stringify(sportsDbData.matchStats).substring(0, 500) + '...' : 'N/A';

        const PROMPT_V39 = `CRITICAL TASK: Analyze the ${sport} match: "${homeTeamName}" (Home) vs "${awayTeamName}" (Away). Provide a single, valid JSON object. Focus ONLY on the requested fields. **CRITICAL: You MUST use the latest factual data provided below (e.g., Lineups, Recent Matches from TheSportsDB) over your general knowledge.** If TSDB data is N/A, use your knowledge but state the uncertainty. AVAILABLE FACTUAL DATA (From TheSportsDB): - Match ID: ${sportsDbData.matchId || 'N/A'} - Home Team ID: ${sportsDbData.homeTeamId || 'N/A'} - Away Team ID: ${sportsDbData.awayTeamId || 'N/A'} - Home Players (Sample): ${homePlayerNames} - Away Players (Sample): ${awayPlayerNames} - Home Recent Matches (Last 5): ${homeRecentMatchInfo} - Away Recent Matches (Last 5): ${awayRecentMatchInfo} - Starting Home XI: ${startingHomePlayers} - Starting Away XI: ${startingAwayPlayers} - Match Stats (if available): ${matchStatsSample} REQUESTED ANALYSIS (Fill in based on your knowledge AND the provided factual data): 1. Basic Stats: gp, gf, ga FOR THE CURRENT SEASON/COMPETITION. If TSDB recent matches are available, use them to verify form, otherwise use your knowledge. 2. H2H: Last 5 structured results + summary. 3. Team News & Absentees: Key absentees (name, importance, role) + news summary + impact analysis. (CRITICAL: Use Starting XI/Player List from TSDB to verify player availability if possible. If Starting XI is 'N/A', mention this uncertainty). 4. Recent Form: W-D-L strings (overall, home/away). Use TSDB recent matches if available. 5. Key Players: name, role, recent key stat. Use TSDB player list for names/roles if available. 6. Contextual Factors: Stadium Location (with lat/lon if possible), Match Tension Index (Low/Medium/High/Extreme/Friendly), Pitch Condition, Referee (name, style/avg cards if known). --- SPECIFIC DATA BY SPORT --- IF soccer:   7. Tactics: Style (e.g., Possession, Counter, Pressing) + formation. (CRITICAL: Infer formation from Starting XI in TSDB data if available and stated, e.g., "4-3-3". If N/A, use your knowledge but state it's an estimate).   8. Tactical Patterns: { home: ["pattern1", "pattern2"], away: [...] }. Identify key attacking/defending patterns.   9. Key Matchups: Identify 1-2 key positional or player battles based on tactics and player roles. IF hockey:   7. Advanced Stats: Team { Corsi_For_Pct, High_Danger_Chances_For_Pct }, Goalie { GSAx }. Use your knowledge if TSDB stats are N/A. IF basketball:   7. Advanced Styles: Shot Distribution { home: "e.g., Heavy 3-point", away: "..." }, Defensive Style { home: "e.g., Aggressive Perimeter", away: "..." }. Use your knowledge. OUTPUT FORMAT: Strict JSON as defined below. Use "N/A" or null appropriately. Fields for other sports can be omitted. STRUCTURE: { "stats":{ "home":{...}, "away":{...} }, "h2h_summary":"...", "h2h_structured":[...], "team_news":{ "home":"...", "away":"..." }, "absentees":{ "home":[{name, importance, role}], "away":[] }, "absentee_impact_analysis":"...", "form":{ "home_overall":"...", "away_overall":"...", "home_home":"...", "away_away":"..." }, "key_players":{ "home":[{name, role, stat}], "away":[] }, "contextual_factors":{ "stadium_location":"...", "match_tension_index":"...", "pitch_condition":"...", "referee":{ "name":"...", "style":"..." } }, "tactics":{ "home":{ "style":"...", "formation":"..." }, "away":{...} }, "tactical_patterns":{ "home":[], "away":[] }, "key_matchups":{ "description":"..." }, "advanced_stats_team":{ "home":{...}, "away":{...} }, "advanced_stats_goalie":{ "home_goalie":{...}, "away_goalie":{...} }, "shot_distribution":{ "home":"...", "away":"..." }, "defensive_style":{ "home":"...", "away":"..." }, "league_averages": { /* Optional: avg_goals_per_game, etc. */ } }`;

        const [geminiJsonString, fetchedOddsData] = await Promise.all([ _callGemini(PROMPT_V39), getOptimizedOddsData(homeTeamName, awayTeamName, sport, SPORT_CONFIG[sport], null, leagueName) ]);
        let geminiData = null;
        try { geminiData = geminiJsonString ? JSON.parse(geminiJsonString) : null; }
        catch (e) { console.error(`Gemini JSON parse hiba: ${e.message}. Kapott string (első 500 karakter):`, (geminiJsonString || '').substring(0, 500)); }
        if (!geminiData) {
            console.warn("Gemini API hívás sikertelen vagy a válasz nem volt valid JSON. Alapértelmezett adatok használata.");
            geminiData = { stats: { home: {}, away: {} }, form: {}, key_players: { home: [], away: [] }, contextual_factors: {}, tactics: { home:{}, away:{} }, tactical_patterns:{ home:[], away:[] }, key_matchups:{}, advanced_stats_team:{ home:{}, away:{} }, advanced_stats_goalie:{ home_goalie:{}, away_goalie:{} }, shot_distribution:{}, defensive_style:{}, absentees: { home:[], away:[] }, team_news: { home:"N/A", away:"N/A" }, h2h_structured: [] };
        }

        const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
        const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
        const finalData = {};
        const parseStat = (val, defaultValue = null) => { if (val === null || val === undefined || val === "N/A") return defaultValue; const num = Number(val); return (!isNaN(num) && num >= 0) ? num : defaultValue; };
        const inferGp = (formString) => { if (!formString || typeof formString !== 'string' || formString === "N/A") return 5; const matches = formString.match(/[WDL]/g); return matches ? Math.min(matches.length, 10) : 5; };
        let defaultGpHome = inferGp(geminiData?.form?.home_overall); let defaultGpAway = inferGp(geminiData?.form?.away_overall);
        let homeGp = parseStat(geminiData?.stats?.home?.gp, defaultGpHome); let awayGp = parseStat(geminiData?.stats?.away?.gp, defaultGpAway);
        homeGp = Math.max(1, homeGp || 1); awayGp = Math.max(1, awayGp || 1);
        finalData.stats = { home: { gp: homeGp, gf: parseStat(geminiData?.stats?.home?.gf), ga: parseStat(geminiData?.stats?.home?.ga) }, away: { gp: awayGp, gf: parseStat(geminiData?.stats?.away?.gf), ga: parseStat(geminiData?.stats?.away?.ga) } };
        finalData.h2h_summary = geminiData?.h2h_summary || "N/A";
        finalData.h2h_structured = Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : [];
        finalData.team_news = geminiData?.team_news || { home: "N/A", away: "N/A" };
        finalData.absentees = { home: Array.isArray(geminiData?.absentees?.home) ? geminiData.absentees.home : [], away: Array.isArray(geminiData?.absentees?.away) ? geminiData.absentees.away : [] };
        finalData.absentee_impact_analysis = geminiData?.absentee_impact_analysis || "N/A";
        finalData.form = geminiData?.form || { home_overall: "N/A", away_overall: "N/A", home_home: "N/A", away_away: "N/A" };
        const normalizeKeyPlayers = (players) => (Array.isArray(players) ? players : []).map(p => ({ name: p?.name || '?', role: p?.role || '?', stats: p?.stat || p?.stats || 'N/A' }));
        finalData.key_players = { home: normalizeKeyPlayers(geminiData?.key_players?.home), away: normalizeKeyPlayers(geminiData?.key_players?.away) };
        finalData.contextual_factors = geminiData?.contextual_factors || {};
        finalData.contextual_factors.stadium_location = finalData.contextual_factors.stadium_location || "N/A";
        finalData.contextual_factors.match_tension_index = finalData.contextual_factors.match_tension_index || "N/A";
        finalData.contextual_factors.pitch_condition = finalData.contextual_factors.pitch_condition || "N/A";
        finalData.contextual_factors.referee = finalData.contextual_factors.referee || { name: "N/A", style: "N/A" };
        finalData.contextual_factors.structured_weather = structuredWeather;
        finalData.referee = finalData.contextual_factors.referee;
        finalData.tactics = geminiData?.tactics || { home: { style: "N/A", formation: "N/A" }, away: { style: "N/A", formation: "N/A" } };
        finalData.tactical_patterns = geminiData?.tactical_patterns || { home: [], away: [] };
        finalData.key_matchups = geminiData?.key_matchups || {};
        finalData.advanced_stats_team = geminiData?.advanced_stats_team || { home: {}, away: {} };
        finalData.advanced_stats_goalie = geminiData?.advanced_stats_goalie || { home_goalie: {}, away_goalie: {} };
        finalData.shot_distribution = geminiData?.shot_distribution || { home: "N/A", away: "N/A" };
        finalData.defensive_style = geminiData?.defensive_style || { home: "N/A", away: "N/A" };
        finalData.advancedData = { home: { xg: null }, away: { xg: null } };
        finalData.league_averages = geminiData?.league_averages || {};
        finalData.sportsDbData = sportsDbData;

        const richContextParts = [ finalData.h2h_summary !== "N/A" && `- H2H: ${finalData.h2h_summary}`, finalData.contextual_factors.match_tension_index !== "N/A" && `- Tét: ${finalData.contextual_factors.match_tension_index}`, (finalData.team_news.home !== "N/A" || finalData.team_news.away !== "N/A") && `- Hírek: H:${finalData.team_news.home||'-'}, V:${finalData.team_news.away||'-'}`, (finalData.absentees.home.length > 0 || finalData.absentees.away.length > 0) && `- Hiányzók: H:${finalData.absentees.home.map(p=>p.name).join(', ')||'-'}, V:${finalData.absentees.away.map(p=>p.name).join(', ')||'-'}`, finalData.absentee_impact_analysis !== "N/A" && `- Hiányzók Hatása: ${finalData.absentee_impact_analysis}`, (finalData.form.home_overall !== "N/A" || finalData.form.away_overall !== "N/A") && `- Forma: H:${finalData.form.home_overall}, V:${finalData.form.away_overall}`, (finalData.tactics?.home?.style !== "N/A" || finalData.tactics?.away?.style !== "N/A") && `- Taktika: H:${finalData.tactics?.home?.style||'?'}(${finalData.tactics?.home?.formation||'?'}), V:${finalData.tactics?.away?.style||'?'}(${finalData.tactics?.away?.formation||'?'})`, structuredWeather ? `- Időjárás: ${structuredWeather.precipitation_mm}mm csap, ${structuredWeather.wind_speed_kmh}km/h szél.` : (finalData.contextual_factors.weather ? `- Időjárás: ${finalData.contextual_factors.weather}` : `- Időjárás: N/A`), finalData.contextual_factors.pitch_condition !== "N/A" && `- Pálya: ${finalData.contextual_factors.pitch_condition}` ].filter(Boolean);
        const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
        const result = { rawStats: finalData.stats, leagueAverages: finalData.league_averages, richContext, advancedData: finalData.advancedData, form: finalData.form, rawData: finalData };

        if (typeof result.rawStats?.home !== 'object' || typeof result.rawStats?.away !== 'object' || typeof result.rawStats.home.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats.away.gp !== 'number' || result.rawStats.away.gp <= 0) {
            console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen statisztikák a Gemini válasz vagy a feldolgozás után. HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
            throw new Error(`Kritikus statisztikák érvénytelenek a ${homeTeamName} vs ${awayTeamName} meccshez az adatfeldolgozás után.`);
        }

        scriptCache.set(ck, result);
        console.log(`Sikeres adatgyűjtés (AI + TSDB(ID,Pl,M) + Időjárás), cache mentve (${ck}).`);
        return { ...result, fromCache: false, oddsData: fetchedOddsData };

    } catch (e) {
        console.error(`KRITIKUS HIBA a getRichContextualData során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba: ${e.message}`);
    }
}


// --- ODDS API FUNKCIÓK ---
// === JAVÍTÁS: 'btts' piac eltávolítása az URL-ből ===
async function getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName) {
    const specificApiKey = leagueName ? getOddsApiKeyForLeague(leagueName) : null;
    const oddsApiKey = specificApiKey || sportConfig.odds_api_sport_key;

    if (!ODDS_API_KEY || !oddsApiKey) {
        console.warn(`Odds API: Hiányzó kulcs vagy sport/liga kulcs. Liga: "${leagueName}", Használt kulcs: "${oddsApiKey || 'NINCS'}"`);
        return null;
    }

    // === JAVÍTÁS: 'btts' eltávolítva a markets paraméterből ===
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals&bookmakers=pinnacle&oddsFormat=decimal`;
    // === JAVÍTÁS VÉGE ===

    console.log(`Odds API (${oddsApiKey}): Adatok lekérése... URL: ${url.replace(ODDS_API_KEY,'<apikey>')}`);
    try {
        const response = await makeRequest(url, { timeout: 10000 });

        if (!response?.data || !Array.isArray(response.data)) {
            console.warn(`Odds API (${oddsApiKey}): Érvénytelen vagy üres válasz. Státusz: ${response?.status}`);
            return null;
        }
        if (response.data.length === 0) {
             console.warn(`Odds API (${oddsApiKey}): Nincs elérhető mérkőzés ebben a ligában/sportban.`);
             return null;
        }

        const oddsData = response.data;
        const homeVariations = generateTeamNameVariations(homeTeam);
        const awayVariations = generateTeamNameVariations(awayTeam);
        let bestMatch = null;
        let highestCombinedRating = 0.65;

        for (const match of oddsData) {
            if (!match?.home_team || !match?.away_team) continue;
            const apiHomeLower = match.home_team.toLowerCase().trim();
            const apiAwayLower = match.away_team.toLowerCase().trim();
            const homeMatchResult = findBestMatch(apiHomeLower, homeVariations);
            const awayMatchResult = findBestMatch(apiAwayLower, awayVariations);
            if (!homeMatchResult?.bestMatch || !awayMatchResult?.bestMatch || homeMatchResult.bestMatch.rating < 0.5 || awayMatchResult.bestMatch.rating < 0.5) continue;
            const homeSim = homeMatchResult.bestMatch.rating;
            const awaySim = awayMatchResult.bestMatch.rating;
            const combinedSim = (homeSim + awaySim) / 2;
            if (combinedSim > highestCombinedRating) {
                highestCombinedRating = combinedSim;
                bestMatch = match;
            }
        }

        if (!bestMatch) {
            console.warn(`Odds API (${oddsApiKey}): Nem található elég jó egyezés (${(highestCombinedRating*100).toFixed(1)}%) ehhez: ${homeTeam} vs ${awayTeam}.`);
            return null;
        }

        console.log(`Odds API (${oddsApiKey}): Találat ${bestMatch.home_team} vs ${bestMatch.away_team} (${(highestCombinedRating*100).toFixed(1)}% hasonlóság).`);
        const bookmaker = bestMatch.bookmakers?.find(b => b.key === 'pinnacle');
        if (!bookmaker?.markets) {
            console.warn(`Odds API: Nincs Pinnacle piac ehhez a meccshez: ${bestMatch.home_team} vs ${bestMatch.away_team}`);
            return null;
        }

        const currentOdds = [];
        const allMarkets = bookmaker.markets;

        const h2hMarket = allMarkets.find(m => m.key === 'h2h');
        const h2hOutcomes = h2hMarket?.outcomes;
        if (h2hOutcomes && Array.isArray(h2hOutcomes)) {
            h2hOutcomes.forEach(o => {
                if (o?.price && typeof o.price === 'number' && o.price > 1) {
                    let name = o.name;
                    if (name.toLowerCase() === bestMatch.home_team.toLowerCase()) name = 'Hazai győzelem';
                    else if (name.toLowerCase() === bestMatch.away_team.toLowerCase()) name = 'Vendég győzelem';
                    else if (name.toLowerCase() === 'draw') name = 'Döntetlen';
                    currentOdds.push({ name: name, price: o.price });
                }
            });
        } else { console.warn(`Odds API: Nincs H2H piac (Pinnacle) ehhez: ${bestMatch.home_team} vs ${bestMatch.away_team}`); }

        const totalsMarket = allMarkets.find(m => m.key === 'totals');
        const totalsOutcomes = totalsMarket?.outcomes;
        if (totalsOutcomes && Array.isArray(totalsOutcomes)) {
            const mainLine = findMainTotalsLine({ allMarkets, sport }) ?? sportConfig.totals_line;
            console.log(`Odds API: Meghatározott fő Totals vonal: ${mainLine}`);
            const overOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Over');
            const underOutcome = totalsOutcomes.find(o => typeof o.point === 'number' && o.point === mainLine && o.name === 'Under');
            if (overOutcome?.price && typeof overOutcome.price === 'number' && overOutcome.price > 1) { currentOdds.push({ name: `Over ${mainLine}`, price: overOutcome.price }); }
            if (underOutcome?.price && typeof underOutcome.price === 'number' && underOutcome.price > 1) { currentOdds.push({ name: `Under ${mainLine}`, price: underOutcome.price }); }
        } else { console.warn(`Odds API: Nincs Totals piac (Pinnacle) ehhez: ${bestMatch.home_team} vs ${bestMatch.away_team}`); }

        // BTTS piacot már nem kérjük le direktben, így ezt a részt kivesszük
        /*
        const bttsMarket = allMarkets.find(m => m.key === 'btts');
        // ... (BTTS feldolgozás) ...
        */

        return currentOdds.length > 0 ? { current: currentOdds, allMarkets, sport } : null;

    } catch (e) {
        console.error(`Hiba getOddsData (${homeTeam} vs ${awayTeam}, Liga: ${leagueName || 'N/A'}, Kulcs: ${oddsApiKey}): ${e.message}`, e.stack);
        return null;
    }
}

// --- OPTIMIZED ODDS DATA (Változatlan maradt) ---
export async function getOptimizedOddsData(homeTeam, awayTeam, sport, sportConfig, openingOdds, leagueName = null) {
    if (!ODDS_API_KEY) { return null; }
    const key = `${homeTeam}${awayTeam}${sport}${leagueName || ''}`.toLowerCase().replace(/\s+/g, '');
    const cacheKey = `live_odds_v8_${key}`;
    const cached = oddsCache.get(cacheKey);
    if (cached) { return { ...cached, fromCache: true }; }
    let liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, leagueName);
    if (!liveOdds && leagueName && getOddsApiKeyForLeague(leagueName) !== sportConfig.odds_api_sport_key) {
        console.log(`Odds API: Specifikus liga (${leagueName}) sikertelen, próbálkozás alap sport kulccsal (${sportConfig.odds_api_sport_key})...`);
        liveOdds = await getOddsData(homeTeam, awayTeam, sport, sportConfig, null);
    }
    if (liveOdds?.current?.length > 0) {
        oddsCache.set(cacheKey, liveOdds);
        return { ...liveOdds, fromCache: false };
    }
    console.warn(`Nem sikerült élő szorzókat lekérni (még fallback után sem): ${homeTeam} vs ${awayTeam}`);
    return null;
}

// --- GENERATE TEAM NAME VARIATIONS (Változatlan maradt) ---
function generateTeamNameVariations(teamName) {
    const lowerName = teamName.toLowerCase().trim();
    const variations = new Set([ teamName, lowerName, ODDS_TEAM_NAME_MAP[lowerName] || teamName ]);
    variations.add(lowerName.replace(/^(fc|sc|cf|ac|as|krc|real|fk|nk|rc|cd|afc|1\.)\s+/i, '').trim());
    return Array.from(variations).filter(name => name && name.length > 2);
}

// --- FIND MAIN TOTALS LINE (Változatlan maradt) ---
export function findMainTotalsLine(oddsData) {
    const defaultLine = SPORT_CONFIG[oddsData?.sport]?.totals_line ?? 2.5;
    const totalsMarket = oddsData?.allMarkets?.find(m => m.key === 'totals');
    if (!totalsMarket?.outcomes || !Array.isArray(totalsMarket.outcomes) || totalsMarket.outcomes.length < 2) return defaultLine;
    let closestPair = { diff: Infinity, line: defaultLine };
    const points = [...new Set(totalsMarket.outcomes.map(o => o.point).filter(p => typeof p === 'number' && !isNaN(p)))];
    if (points.length === 0) return defaultLine;
    for (const point of points) {
        const over = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Over');
        const under = totalsMarket.outcomes.find(o => o.point === point && o.name === 'Under');
        if (over?.price && typeof over.price === 'number' && under?.price && typeof under.price === 'number') {
            const diff = Math.abs(over.price - under.price);
            if (diff < closestPair.diff) { closestPair = { diff, line: point }; }
        }
    }
    if (closestPair.diff < 0.5) return closestPair.line;
    const numericDefaultLine = typeof defaultLine === 'number' ? defaultLine : 2.5;
    points.sort((a, b) => Math.abs(a - numericDefaultLine) - Math.abs(b - numericDefaultLine));
    return points[0];
}


// --- ESPN MECCSLEKÉRDEZÉS --- // (Változatlan maradt)
export async function _getFixturesFromEspn(sport, days) {
    const sportConfig = SPORT_CONFIG[sport];
    if (!sportConfig?.espn_sport_path || !sportConfig.espn_leagues || Object.keys(sportConfig.espn_leagues).length === 0) {
        console.error(`_getFixturesFromEspn: Hiányzó ESPN konfig (${sport}).`); return [];
    }
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt <= 0 || daysInt > 7) { console.error(`_getFixturesFromEspn: Érvénytelen napok: ${days}`); return []; }
    const datesToFetch = Array.from({ length: daysInt }, (_, d) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + d); return date.toISOString().split('T')[0].replace(/-/g, ''); });
    const promises = [];
    console.log(`ESPN: ${daysInt} nap, ${Object.keys(sportConfig.espn_leagues).length} liga lekérése...`);
    for (const dateString of datesToFetch) {
        for (const [leagueName, slug] of Object.entries(sportConfig.espn_leagues)) {
            if (!slug) { console.warn(`_getFixturesFromEspn: Üres slug (${leagueName}).`); continue; }
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.espn_sport_path}/${slug}/scoreboard?dates=${dateString}&limit=200`;
            promises.push( makeRequest(url, { timeout: 8000 }).then(response => {
                if (!response?.data?.events) return [];
                return response.data.events
                    .filter(event => event?.status?.type?.state?.toLowerCase() === 'pre')
                    .map(event => {
                         const competition = event.competitions?.[0]; if (!competition) return null;
                         const homeTeamData = competition.competitors?.find(c => c.homeAway === 'home')?.team;
                         const awayTeamData = competition.competitors?.find(c => c.homeAway === 'away')?.team;
                         const homeName = homeTeamData ? String(homeTeamData.shortDisplayName || homeTeamData.displayName || homeTeamData.name || '').trim() : null;
                         const awayName = awayTeamData ? String(awayTeamData.shortDisplayName || awayTeamData.displayName || awayTeamData.name || '').trim() : null;
                         const safeLeagueName = typeof leagueName === 'string' ? leagueName.trim() : leagueName;
                         if (event.id && homeName && awayName && event.date && !isNaN(new Date(event.date).getTime())) {
                             return { id: String(event.id), home: homeName, away: awayName, utcKickoff: event.date, league: safeLeagueName };
                         } else { return null; }
                    }).filter(Boolean);
            }).catch(error => {
                if (error.response?.status === 400 || error.message.includes('404')) console.warn(`ESPN Hiba (40x): Lehetséges, hogy rossz a slug '${slug}' (${leagueName})? URL: ${url}`);
                else console.error(`ESPN Hiba (${leagueName}, ${slug}): ${error.message}`);
                return [];
            }));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    try {
        const results = await Promise.all(promises);
        const uniqueFixturesMap = new Map();
        results.flat().forEach(f => { if (f?.id && !uniqueFixturesMap.has(f.id)) { uniqueFixturesMap.set(f.id, f); } });
        const finalFixtures = Array.from(uniqueFixturesMap.values()).sort((a, b) => {
            const dateA = new Date(a.utcKickoff); const dateB = new Date(b.utcKickoff);
            if (isNaN(dateA.getTime())) return 1; if (isNaN(dateB.getTime())) return -1;
            return dateA - dateB;
        });
        console.log(`ESPN: ${finalFixtures.length} egyedi meccs lekérve.`);
        return finalFixtures;
    } catch (e) { console.error(`ESPN feldolgozási hiba: ${e.message}`, e.stack); return []; }
}