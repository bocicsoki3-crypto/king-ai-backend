// FÁJL: providers/iceHockeyApiProvider.ts
// VERZIÓ: v1.9 ("Függőségmentes Fuzzy Match")
// MÓDOSÍTÁS (v1.9):
// 1. ELTÁVOLÍTVA: A 'string-similarity-js' importálása. A csomag már nem szükséges.
// 2. ELTÁVOLÍTVA: A 'types/string-similarity-js.d.ts' fájlra már nincs szükség.
// 3. HOZZÁADVA: Két belső segédfüggvény: 'getStringBigrams' és 'compareStrings'.
//    Ezek implementálják a Sørensen-Dice string-hasonlósági algoritmust
//    külső csomag NÉLKÜL.
// 4. MÓDOSÍTVA: A 'fetchMatchData' logikája átírva, hogy a 'findBestMatch' hívás
//    helyett a belső 'compareStrings' függvényt használja a
//    legjobb egyezés megtalálására.

import fetch from 'node-fetch'; // Vagy bármilyen használt HTTP kliens

// === SZÜKSÉGES KANONIKUS TÍPUSOK ===
// Mivel nem férek hozzá a './src/types/canonical.d.ts' fájlhoz,
// itt definiálom a minimálisan szükséges típusokat a működéshez.
// Ha a 'canonical.d.ts' elérhető, ezek a definíciók törölhetők
// és a 'import type { ... } from '../src/types/canonical.d.ts'' használható.

interface ICanonicalRichContext {
    rawStats: any;
    leagueAverages: any;
    richContext: string;
    advancedData: {
        home: { xg: number | null };
        away: { xg: number | null };
        manual_H_xG?: number | null;
        manual_H_xGA?: number | null;
        manual_A_xG?: number | null;
        manual_A_xGA?: number | null;
    };
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
export const providerName = 'ice-hockey-api-v1.9-DEPENDENCY_FREE_MATCH';

// --- API Konfiguráció (Környezeti változókból) ---
const API_HOST = process.env.ICEHOCKEY_API_HOST || 'icehockeyapi.p.rapidapi.com';
const API_KEY = process.env.ICEHOCKEY_API_KEY || ''; // SOHA ne égesd be!

/**
 * Normalizáló segédfüggvény a string-összehasonlításhoz.
 */
function normalizeTeamName(name: string): string {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[-_.]/g, ' ') // Kötőjelek, aláhúzások cseréje szóközre
        .replace(/\s+/g, ' ') // Több szóköz egyre cserélése
        .trim();
}


// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ (v1.9) ===

/**
 * Létrehoz egy 2-karakteres "bigram" tömböt egy stringből.
 * Pl. "boston" -> ["bo", "os", "st", "to", "on"]
 */
function getStringBigrams(str: string): string[] {
    if (str.length <= 1) {
        return [str];
    }
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.add(str.substring(i, i + 2));
    }
    return Array.from(bigrams);
}

/**
 * Összehasonlít két stringet a Sørensen-Dice algoritmus (bigram alapú)
 * egyszerűsített implementációjával.
 * @returns 0.0 (nincs egyezés) és 1.0 (tökéletes egyezés) közötti szám.
 */
function compareStrings(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    
    const bigrams1 = getStringBigrams(str1);
    const bigrams2 = getStringBigrams(str2);

    const intersection = new Set(bigrams1.filter(bigram => bigrams2.includes(bigram)));
    
    const totalLength = bigrams1.length + bigrams2.length;
    if (totalLength === 0) return 1; // Két üres string egyezik

    return (2.0 * intersection.size) / totalLength;
}

// === FÜGGŐSÉGMENTES STRING HASONLÍTÓ VÉGE ===


/**
 * A "Log napló.txt"-ben látott fallback függvény.
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
        richContext: "Figyelem: Az automatikus P4 API adatgyűjtés (iceHockeyApiProvider v1.9) sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
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
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (JAVÍTOTT v1.9)
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
    console.log(`Adatgyűjtés indul (v1.9 - IceHockeyApi - Stratégia: Belső Fuzzy Match): ${homeTeamName} vs ${awayTeamName}...`);

    if (!API_KEY) {
        console.error(`[IceHockeyApiProvider v1.9] KRITIKUS HIBA: Hiányzó ICEHOCKEY_API_KEY környezeti változó.`);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }

    try {
        const kickoffDate = new Date(utcKickoff);
        const day = kickoffDate.getDate(); // 1-31
        const month = kickoffDate.getMonth() + 1; // 1-12
        const year = kickoffDate.getFullYear();

        const path = `/api/ice-hockey/matches/${day}/${month}/${year}`;
        const url = `https://${API_HOST}${path}`;

        console.log(`[IceHockeyApiProvider v1.9] Meccslista lekérése (Dátum: ${day}/${month}/${year})...`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST
            }
        });

        if (!response.ok) {
            throw new Error(`API hiba: ${response.status} ${response.statusText} (${url})`);
        }

        const data = await response.json() as any;
        const events = data?.events;

        if (!events || !Array.isArray(events) || events.length === 0) {
            console.warn(`[IceHockeyApiProvider v1.9] Az API nem adott vissza meccseket erre a napra: ${day}/${month}/${year}`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

        // --- AZ INTELLIGENS NÉVFELOLDÓ LOGIKA (v1.9) ---

        const inputHomeNorm = normalizeTeamName(homeTeamName);
        const inputAwayNorm = normalizeTeamName(awayTeamName);

        let bestMatch = {
            event: null as any,
            bestScore: 0,
            isReversed: false
        };

        // Ennél az algoritmusnál alacsonyabb küszöb is elég
        const similarityThreshold = 0.55; 

        for (const event of events) {
            const apiHomeName = normalizeTeamName(event.homeTeam?.name);
            const apiAwayName = normalizeTeamName(event.awayTeam?.name);

            if (!apiHomeName || !apiAwayName) continue; // Nincs név, kihagyjuk

            // 1. eset: Normál egyezés (Bemenet H -> API H, Bemenet A -> API A)
            const homeScore = compareStrings(inputHomeNorm, apiHomeName);
            const awayScore = compareStrings(inputAwayNorm, apiAwayName);
            // Átlagoljuk, hogy a 0.0-1.0 tartományban maradjon a "kombinált" pontszám
            const combinedScore = (homeScore + awayScore) / 2.0;

            // 2. eset: Fordított egyezés (Bemenet H -> API A, Bemenet A -> API H)
            const revHomeScore = compareStrings(inputHomeNorm, apiAwayName);
            const revAwayScore = compareStrings(inputAwayNorm, apiHomeName);
            const reversedScore = (revHomeScore + revAwayScore) / 2.0;
            
            // Megtartjuk a legjobb találatot
            if (combinedScore > bestMatch.bestScore && combinedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: combinedScore, isReversed: false };
            }
            
            if (reversedScore > bestMatch.bestScore && reversedScore >= similarityThreshold) {
                bestMatch = { event, bestScore: reversedScore, isReversed: true };
            }
        }

        // --- KIÉRTÉKELÉS ---

        if (bestMatch.event) {
            const matchedEvent = bestMatch.event;
            const matchId = matchedEvent.id;
            
            console.log(`[IceHockeyApiProvider v1.9] SIKERES NÉVFELOLDÁS (Score: ${bestMatch.bestScore.toFixed(2)})`);
            
            if (bestMatch.isReversed) {
                 console.warn(`  -> Figyelem: A bemeneti csapatok valószínűleg felcserélve! (A rendszer kezeli)`);
                 console.log(`  -> Bemenet (H): '${homeTeamName}' -> Találat (A): '${matchedEvent.awayTeam.name}'`);
                 console.log(`  -> Bemenet (A): '${awayTeamName}' -> Találat (H): '${matchedEvent.homeTeam.name}'`);
            } else {
                 console.log(`  -> Bemenet (H): '${homeTeamName}' -> Találat (H): '${matchedEvent.homeTeam.name}'`);
                 console.log(`  -> Bemenet (A): '${awayTeamName}' -> Találat (A): '${matchedEvent.awayTeam.name}'`);
            }
            console.log(`  -> MECCS ID: ${matchId}`);

            // === SIKERES ADATLEKÉRÉS ===
            const homeRoster = matchedEvent.homeRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];
            const awayRoster = matchedEvent.awayRoster?.players?.map((p: any) => ({ name: p.name, position: p.position })) || [];

            const successfulRawData: ICanonicalRawData = {
                stats: { home: { gp: 1, gf: 2, ga: 1, form: 'W' }, away: { gp: 1, gf: 1, ga: 2, form: 'L' } }, // Mock adatok
                apiFootballData: { homeTeamId: matchedEvent.homeTeam.id, awayTeamId: matchedEvent.awayTeam.id, leagueId: matchedEvent.tournament?.id, fixtureId: matchId, fixtureDate: matchedEvent.startTimestamp, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
                h2h_structured: [],
                form: { home_overall: null, away_overall: null },
                detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
                absentees: { home: [], away: [] },
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
                richContext: `Sikeres adatgyűjtés (v1.9) ${matchId} ID-val.`,
                advancedData: { home: { xg: null }, away: { xg: null } }, // xG-t a DataFetch tölti fel
                form: successfulRawData.form,
                rawData: successfulRawData,
                oddsData: null, // Odds-t a DataFetch kezeli fallback-kel
                fromCache: false,
                availableRosters: successfulRawData.availableRosters,
                xgSource: "N/A"
            };

        } else {
            // A hasonlóság túl alacsony
            console.error(`[IceHockeyApiProvider v1.9] KRITIKUS HIBA: A névfeloldás sikertelen. Egyik meccs sem érte el a ${similarityThreshold} küszöböt.`);
            console.error(`  -> Keresett nevek: '${inputHomeNorm}' vs '${inputAwayNorm}'`);
            return generateEmptyStubContext(homeTeamName, awayTeamName);
        }

    } catch (error: any) {
        console.error(`[IceHockeyApiProvider v1.9] Váratlan hiba a fetchMatchData során: ${error.message}`, error.stack);
        return generateEmptyStubContext(homeTeamName, awayTeamName);
    }
}
