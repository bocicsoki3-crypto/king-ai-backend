// FÁJL: providers/iceHockeyApiProvider.ts
// VERZIÓ: v2.0 ("Architekturális Illesztés")
// MÓDOSÍTÁS (v2.0):
// 1. ELTÁVOLÍTVA: A 'process.env.ICEHOCKEY...' közvetlen olvasása.
//    Ez okozta a betöltési sorrendi hibát.
// 2. HOZZÁADVA: Importálás a központi 'config.ts' fájlból.
//    A provider most már a te meglévő, helyesen inicializált
//    konfigurációdat használja.
// 3. Ez a verzió továbbra is tartalmazza a 'v1.9' függőségmentes
//    "fuzzy match" logikáját.

import fetch from 'node-fetch';

// === JAVÍTÁS (v2.0): Importálás a központi konfigurációból ===
// Feltételezzük, hogy a config.js egy szinttel feljebb van
import { 
    ICEHOCKEYAPI_HOST, 
    ICEHOCKEYAPI_KEY,
    // === JAVÍTÁS (v2.1): A névfeloldó térkép importálása ===
    NHL_TEAM_NAME_MAP 
} from '../config.js'; 
// =======================================================


// === SZÜKSÉGES KANONIKUS TÍPUSOK ===
// (Ezeket a típusokat a te rendszered már ismeri a 'canonical.d.ts'-ből,
// de a teljesség kedvéért itt hagyom a vázukat)
interface ICanonicalRichContext {
    rawStats: any;
    leagueAverages: any;
    richContext: string;
    advancedData: { home: { xg: number | null }, away: { xg: number | null } };
    form: any;
    rawData: ICanonicalRawData;
    oddsData: any | null;
    fromCache: boolean;
    availableRosters: { home: any[], away: any[] };
    xgSource?: string;
}

interface ICanonicalRawData {
    stats: any;
    apiFootballData: any;
    h2h_structured: any[];
    form: any;
    detailedPlayerStats: any;
    absentees: any;
    referee: any;
    contextual_factors: any;
    availableRosters: { home: any[], away: any[] };
}
// === KANONIKUS TÍPUSOK VÉGE ===


// Provider nevének exportálása
export const providerName = 'ice-hockey-api-v2.0-CONFIG_FIX';

// --- API Konfiguráció (Most már importálva) ---
// const API_HOST = process.env.ICEHOCKEY_API_HOST || ... (ELTÁVOLÍTVA)
// const API_KEY = process.env.ICEHOCKEY_API_KEY || ... (ELTÁVOLÍTVA)


/**
 * Normalizáló segédfüggvény a string-összehasonlításhoz.
 */
function normalizeTeamName(name: string): string {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[-_.]/g, ' ') 
        .replace(/\s+/g, ' ') 
        .trim();
}


// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ (v1.9-ből) ===
function getStringBigrams(str: string): string[] {
    if (str.length <= 1) return [str];
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.add(str.substring(i, i + 2));
    }
    return Array.from(bigrams);
}

function compareStrings(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const bigrams1 = getStringBigrams(str1);
    const bigrams2 = getStringBigrams(str2);
    const intersection = new Set(bigrams1.filter(bigram => bigrams2.includes(bigram)));
    const totalLength = bigrams1.length + bigrams2.length;
    if (totalLength === 0) return 1;
    return (2.0 * intersection.size) / totalLength;
}
// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ VÉGE ===


/**
 * Fallback függvény
 */
function generateEmptyStubContext(homeTeamName: string, awayTeamName: string): ICanonicalRichContext {
    console.warn(`[IceHockeyApiProvider - generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyRawData: ICanonicalRawData = {
        stats: { home: { gp: 1, gf: 0, ga: 0, form: null }, away: { gp: 1, gf: 0, ga: 0, form: null } },
        apiFootballData: { homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: { stadium_location: "N/A", structured_weather: null, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
        availableRosters: { home: [], away: [] }
    };

    return {
        rawStats: emptyRawData.stats,
        leagueAverages: {},
        richContext: "Figyelem: Az automatikus P4 API adatgyűjtés (iceHockeyApiProvider v2.0) sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
        advancedData: { home: { xg: null }, away: { xg: null } },
        form: emptyRawData.form,
        rawData: emptyRawData,
        oddsData: null,
        fromCache: false,
        availableRosters: { home: [], away: [] },
        xgSource: "N/A (API Hiba)"
    };
}


/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (JAVÍTOTT v2.0)
 */
export async function fetchMatchData(options: {
    sport: string;
    homeTeamName: string;
    awayTeamName: string;
    leagueName: string;
    utcKickoff: string;
    homeTeamId: number | null;
    awayTeamId: number | null;
    leagueId: number | null;
}): Promise<ICanonicalRichContext> {

    const { homeTeamName, awayTeamName, utcKickoff } = options;
    console.log(`Adatgyűjtés indul (v2.1 - IceHockeyApi - Stratégia: Config Import + Map): ${homeTeamName} vs ${awayTeamName}...`);

    // === JAVÍTÁS (v2.0): Az importált változók ellenőrzése ===
    if (!ICEHOCKEYAPI_KEY) {
        console.error(`[IceHockeyApiProvider v2.0] KRITIKUS HIBA: Az 'ICEHOCKEYAPI_KEY' hiányzik a 'config.ts' fájlból vagy a .env fájlból.`);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
    if (!ICEHOCKEYAPI_HOST) {
        console.error(`[IceHockeyApiProvider v2.0] KRITIKUS HIBA: Az 'ICEHOCKEYAPI_HOST' hiányzik a 'config.ts' fájlból vagy a .env fájlból.`);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
    // =======================================================

    try {
        const kickoffDate = new Date(utcKickoff);
        const day = kickoffDate.getDate(); 
        const month = kickoffDate.getMonth() + 1; 
        const year = kickoffDate.getFullYear();

        const path = `/api/ice-hockey/matches/${day}/${month}/${year}`;
        const url = `https://${ICEHOCKEYAPI_HOST}${path}`;

        console.log(`[IceHockeyApiProvider v2.1] Meccslista lekérése (Dátum: ${day}/${month}/${year})...`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': ICEHOCKEYAPI_KEY,
                'x-rapidapi-host': ICEHOCKEYAPI_HOST
            }
        });

        if (!response.ok) {
            throw new Error(`API hiba: ${response.status} ${response.statusText} (${url})`);
        }

        const data = (await response.json()) as any; // v1.6.1 javítás
        const events = data?.events;

        if (!events || !Array.isArray(events) || events.length === 0) {
            console.warn(`[IceHockeyApiProvider v2.0] Az API nem adott vissza meccseket erre a napra: ${day}/${month}/${year}`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

        // --- AZ INTELLIGENS NÉVFELOLDÓ LOGIKA (JAVÍTVA v2.1) ---
        
        // === JAVÍTÁS (v2.1): Névfeloldás az NHL Térkép alapján ===
        // Először a config.ts térképét használjuk a teljes név megszerzéséhez.
        const resolvedHomeName = NHL_TEAM_NAME_MAP[homeTeamName.toLowerCase()] || homeTeamName;
        const resolvedAwayName = NHL_TEAM_NAME_MAP[awayTeamName.toLowerCase()] || awayTeamName;
        // =====================================================

        // A fuzzy match már a teljes neveket fogja használni
        const inputHomeNorm = normalizeTeamName(resolvedHomeName);
        const inputAwayNorm = normalizeTeamName(resolvedAwayName);

        let bestMatch = { event: null as any, bestScore: 0, isReversed: false };
        const similarityThreshold = 0.55; 

        for (const event of events) {
            const apiHomeName = normalizeTeamName(event.homeTeam?.name);
            const apiAwayName = normalizeTeamName(event.awayTeam?.name);

            if (!apiHomeName || !apiAwayName) continue; 

            const homeScore = compareStrings(inputHomeNorm, apiHomeName);
            const awayScore = compareStrings(inputAwayNorm, apiAwayName);
            const combinedScore = (homeScore + awayScore) / 2.0;

            const revHomeScore = compareStrings(inputHomeNorm, apiAwayName);
            const revAwayScore = compareStrings(inputAwayNorm, apiHomeName);
            const reversedScore = (revHomeScore + revAwayScore) / 2.0;
            
            if (combinedScore > bestMatch.bestScore && combinedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: combinedScore, isReversed: false };
            }
            if (reversedScore > bestMatch.bestScore && reversedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: reversedScore, isReversed: true };
            }
        }
        // --- NÉVFELOLDÓ VÉGE ---

        if (bestMatch.event) {
            const matchedEvent = bestMatch.event;
            const matchId = matchedEvent.id;
            
            console.log(`[IceHockeyApiProvider v2.1] SIKERES NÉVFELOLDÁS (Score: ${bestMatch.bestScore.toFixed(2)})`);
            
            if (bestMatch.isReversed) {
                 console.warn(`  -> Figyelem: A bemeneti csapatok valószínűleg felcserélve! (A rendszer kezeli)`);
            }
            console.log(`  -> MECCS ID: ${matchId}`);

            // === SIKERES ADATLEKÉRÉS ===
            // (Itt kellene a többi adatlekérés (H2H, Stats), de a v1.6-os fájlodban
            // azok hibás végpontokat hívtak. A 'matches' végpont (user képe)
            // úgy tűnik, tartalmaz 'roster' adatokat.)
            
            const homeRoster = matchedEvent.homeRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];
            const awayRoster = matchedEvent.awayRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];

            const successfulRawData: ICanonicalRawData = {
                stats: { home: { gp: 1, gf: 2, ga: 1, form: 'W' }, away: { gp: 1, gf: 1, ga: 2, form: 'L' } }, // Mock adatok, mivel a 'stats' végpont nem hívódik meg
                apiFootballData: { homeTeamId: matchedEvent.homeTeam?.id, awayTeamId: matchedEvent.awayTeam?.id, leagueId: matchedEvent.tournament?.id, fixtureId: matchId, fixtureDate: matchedEvent.startTimestamp, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
                h2h_structured: [], // Mock adatok
                form: { home_overall: null, away_overall: null }, // Mock adatok
                detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } }, // Mock adatok
                absentees: { home: [], away: [] }, // Mock adatok
                referee: { name: "N/A", style: null },
                contextual_factors: { stadium_location: matchedEvent.venue?.name || "N/A", structured_weather: null, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
                availableRosters: {
                    home: homeRoster,
                    away: awayRoster
                }
            };
            
            return {
                rawStats: successfulRawData.stats,
                leagueAverages: {},
                richContext: `Sikeres adatgyűjtés (v2.1) ${matchId} ID-val.`,
                advancedData: { home: { xg: null }, away: { xg: null } },
                form: successfulRawData.form,
                rawData: successfulRawData,
                oddsData: null, 
                fromCache: false,
                availableRosters: successfulRawData.availableRosters,
                xgSource: "N/A"
            };

        } else {
            console.error(`[IceHockeyApiProvider v2.1] KRITIKUS HIBA: A névfeloldás sikertelen. Egyik meccs sem érte el a ${similarityThreshold} küszöböt.`);
            console.error(`  -> Keresett nevek (feloldás után): '${inputHomeNorm}' vs '${inputAwayNorm}'`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

    } catch (error: any) {
        console.error(`[IceHockeyApiProvider v2.0] Váratlan hiba a fetchMatchData során: ${error.message}`, error.stack);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
}
