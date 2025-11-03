// providers/apiSportsProvider.ts (v54.2 - Agresszív Liga Keresés)
// MÓDOSÍTÁS: A 'getApiSportsLeagueId' belső '_findLeagueInList'
// logikája javítva, hogy kezelje a "(Brazil)" és hasonló
// eltéréseket az ESPN és az API-Football nevek között.

import axios, { type AxiosRequestConfig } from 'axios';
import NodeCache from 'node-cache';
import pkg from 'string-similarity';
const { findBestMatch } = pkg;
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalStats,
    ICanonicalPlayerStats,
    ICanonicalRawData,
    ICanonicalOdds,
    FixtureResult 
} from '../src/types/canonical.d.ts';
import {
    SPORT_CONFIG,
    APIFOOTBALL_TEAM_NAME_MAP,
    API_HOSTS,
} from '../config.js';
// Importáljuk a megosztott segédfüggvényeket
import {
    _callGemini,
    PROMPT_V43,
    getStructuredWeatherData,
    makeRequest 
} from './common/utils.js';

// ... (Cache-ek és API kulcsrotáció változatlan) ...
const apiSportsOddsCache = new NodeCache({ stdTTL: 60 * 10, checkperiod: 60 * 2, useClones: false });
const apiSportsTeamIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsLeagueIdCache = new NodeCache({ stdTTL: 3600 * 24 * 7, checkperiod: 3600 * 12 });
const apiSportsStatsCache = new NodeCache({ stdTTL: 3600 * 24 * 3, checkperiod: 3600 * 6 });
const apiSportsFixtureCache = new NodeCache({ stdTTL: 3600 * 1, checkperiod: 600 });
const apiSportsFixtureStatsCache = new NodeCache({ stdTTL: 3600 * 6, checkperiod: 3600 });
const fixtureResultCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsNameMappingCache = new NodeCache({ stdTTL: 3600 * 24 * 30, checkperiod: 3600 * 12 });
const apiSportsRosterCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });
const apiSportsCountryLeagueCache = new NodeCache({ stdTTL: 3600 * 24, checkperiod: 3600 * 6 });

let keyIndexes: { [key: string]: number } = { soccer: 0, hockey: 0, basketball: 0 };
// ... (getApiConfig, rotateApiKey, makeRequestWithRotation változatlan) ...

// ... (_getLeagueRoster, getApiSportsTeamId változatlan) ...


// --- JAVÍTOTT getApiSportsLeagueId (v54.2 - Agresszív Névtisztítás) ---
async function getApiSportsLeagueId(leagueName: string, country: string, season: number, sport: string): Promise<{ leagueId: number, foundSeason: number } | null> {
    if (!leagueName || !country || !season) {
        console.warn(`API-SPORTS (${sport}): Liga név ('${leagueName}'), ország ('${country}') vagy szezon (${season}) hiányzik.`);
        return null;
    }

    const lowerCountry = country.toLowerCase();
    
    // Belső függvény, amely lekéri az ÖSSZES ligát egy országból
    const _getLeaguesByCountry = async (currentCountry: string, currentSeason: number): Promise<any[]> => {
        const cacheKey = `apisports_countryleagues_v1_${sport}_${currentCountry.toLowerCase()}_${currentSeason}`;
        const cachedLeagues = apiSportsCountryLeagueCache.get<any[]>(cacheKey);
        if (cachedLeagues) {
            console.log(`API-SPORTS (${sport}): Liga-lista CACHE TALÁLAT (Ország: ${currentCountry}, Szezon: ${currentSeason})`);
            return cachedLeagues;
        }

        console.log(`API-SPORTS (${sport}): Liga-lista lekérése (Ország: ${currentCountry}, Szezon: ${currentSeason})...`);
        const endpoint = `/v3/leagues`;
        const params = { country: currentCountry, season: currentSeason };
        const response = await makeRequestWithRotation(sport, endpoint, { params });

        if (!response?.data?.response || response.data.response.length === 0) {
            console.warn(`API-SPORTS (${sport}): Nem találhatók ligák ehhez: ${currentCountry}, ${currentSeason}`);
            apiSportsCountryLeagueCache.set(cacheKey, []); // Üres tömb cache-elése
            return [];
        }

        const leagues = response.data.response.map((l: any) => l.league);
        apiSportsCountryLeagueCache.set(cacheKey, leagues);
        console.log(`API-SPORTS (${sport}): ${leagues.length} liga cache-elve (${currentCountry}, ${currentSeason}).`);
        return leagues;
    };

    // === JAVÍTOTT _findLeagueInList (v54.2 - Agresszív Névtisztítás) ===
    // Belső függvény, amely a helyi listán keres 3 LÉPCSŐBEN
    const _findLeagueInList = (leagues: any[], targetName: string): number | null => {
        if (leagues.length === 0) return null;
        
        const targetLower = targetName.toLowerCase().trim();
        // 1. TISZTÍTÁS: Távolítsuk el a zárójeles részeket és felesleges szavakat
        // Pl. "Serie B (Brazil)" -> "serie b"
        // Pl. "Argentinian Liga Profesional" -> "liga profesional"
        const cleanTargetName = targetLower
            .replace(/\(.*?\)/g, '') // Eltávolítja a "(Brazil)" részt
            .replace(/^(argentinian|brazilian|uefa|fifa)\s/i, '') // Eltávolítja az ország/szervezet előtagot
            .replace(/\s(league|liga|cup|copa|championship|division|super)/i, '') // Eltávolítja a "league" stb. utótagot
            .trim();

        const leagueNameMap = leagues.map(l => {
            const originalName = l.name.toLowerCase();
            // Az API-ból érkező neveket is ugyanígy tisztítjuk
            const cleanedApiName = originalName
                .replace(/\(.*?\)/g, '')
                .replace(/^(argentinian|brazilian|uefa|fifa)\s/i, '')
                .replace(/\s(league|liga|cup|copa|championship|division|super)/i, '')
                .trim();
            
            return { 
                original: l.name, 
                originalLower: originalName, 
                cleaned: cleanedApiName,
                id: l.id 
            };
        });

        // 2. Próba: Tökéletes egyezés (Tisztítatlan)
        let perfectMatch = leagueNameMap.find(l => l.originalLower === targetLower);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (1/3 - Tökéletes): "${targetName}" -> "${perfectMatch.original}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        // 3. Próba: Tökéletes egyezés (Tisztított)
        perfectMatch = leagueNameMap.find(l => l.cleaned === cleanTargetName);
        if (perfectMatch) {
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (2/3 - Tisztított Tökéletes): "${targetName}" (Keresve: "${cleanTargetName}") -> "${perfectMatch.original}" (ID: ${perfectMatch.id})`);
            return perfectMatch.id;
        }

        // 4. Próba: Hasonlósági keresés (Tisztított)
        const cleanedApiNames = leagueNameMap.map(l => l.cleaned);
        let matchResult = findBestMatch(cleanTargetName, cleanedApiNames);
        
        // Alacsonyabb, megengedőbb küszöb
        const SIMILARITY_THRESHOLD = 0.6; 
        
        if (matchResult.bestMatch.rating > SIMILARITY_THRESHOLD) { 
            const foundLeague = leagueNameMap[matchResult.bestMatchIndex];
            console.log(`API-SPORTS (${sport}): HELYI LIGA TALÁLAT (3/3 - Tisztított Hasonlóság, R: ${matchResult.bestMatch.rating.toFixed(2)}) "${targetName}" (Keresve: "${cleanTargetName}") -> "${foundLeague.original}" (ID: ${foundLeague.id})`);
            return foundLeague.id;
        }
        
        return null;
    };
    // === JAVÍTÁS VÉGE ===
    
    // --- FŐ LOGIKA: SZEZON VISSZAKERESÉS ---
    let leagueData: { leagueId: number, foundSeason: number } | null = null;
    const seasonsToTry = [season, season - 1, season - 2]; 
    
    for (const s of seasonsToTry) {
        console.log(`API-SPORTS (${sport}): Ligák keresése (Ország: ${country}, Szezon: ${s})...`);
        const leaguesInSeason = await _getLeaguesByCountry(country, s);
        const foundLeagueId = _findLeagueInList(leaguesInSeason, leagueName);
        
        if (foundLeagueId) {
            console.log(`API-SPORTS (${sport}): Liga sikeresen azonosítva a(z) ${s} szezonban (ID: ${foundLeagueId}). Keresés leáll.`);
            leagueData = { leagueId: foundLeagueId, foundSeason: s }; 
            break; 
        }
        if (sport !== 'soccer') {
             break;
        }
        console.warn(`API-SPORTS (${sport}): Nem található "${leagueName}" nevű liga ${country} országban a(z) ${s} szezonra.`);
    }

    if (!leagueData) {
        console.error(`API-SPORTS (${sport}): Végleg nem található liga ID ehhez: "${leagueName}" (${country}) (3 szezont ellenőrizve).`);
        return null;
    }
    
    return leagueData; 
}


// ... (findApiSportsFixture, getApiSportsFixtureResult, getApiSportsH2H, getApiSportsTeamSeasonStats változatlan) ...
// ... (getApiSportsOdds, getApiSportsFixtureStats, findMainTotalsLine változatlan) ...


// --- FŐ EXPORTÁLT FÜGGVÉNY: fetchMatchData (JAVÍTVA v54.2) ---
export async function fetchMatchData(options: any): Promise<ICanonicalRichContext> {
    // FONTOS: A 'leagueName' és 'utcKickoff' itt már dekódolva érkezik a 'getRichContextualData'-ból (v54.2)
    const { sport, homeTeamName, awayTeamName, leagueName, utcKickoff } = options;
    
    const seasonDate = new Date(utcKickoff);
    const originSeason = (sport !== 'soccer' && seasonDate.getMonth() < 7) ? 
        seasonDate.getFullYear() - 1 : seasonDate.getFullYear();
        
    if (isNaN(originSeason)) throw new Error(`Érvénytelen utcKickoff: ${utcKickoff}`);
    
    console.log(`Adatgyűjtés indul (v50 - ${sport}): ${homeTeamName} vs ${awayTeamName}...`);
    // 1. LÉPÉS: Liga adatok lekérése
    const sportConfig = SPORT_CONFIG[sport];
    
    const leagueData = sportConfig.espn_leagues[leagueName];
    if (!leagueData?.country) throw new Error(`Hiányzó 'country' konfiguráció a(z) '${leagueName}' ligához a config.js-ben.`);
    
    const country = leagueData.country;
    // A v54.2-es javított 'getApiSportsLeagueId' hívása
    const leagueDataResponse = await getApiSportsLeagueId(leagueName, country, originSeason, sport);
    
    if (!leagueDataResponse || !leagueDataResponse.leagueId) {
        throw new Error(`Nem sikerült a 'leagueId' azonosítása ('${leagueName}' néven).`);
    }

    // A talált liga ID-t ÉS a szezont használjuk
    const { leagueId, foundSeason } = leagueDataResponse;
    console.log(`API-SPORTS (${sport}): Végleges LeagueID: ${leagueId} (A ${foundSeason} szezon alapján azonosítva)`);
    
    // 2. LÉPÉS: Csapat ID-k lekérése
    const [homeTeamId, awayTeamId] = await Promise.all([
        getApiSportsTeamId(homeTeamName, sport, leagueId, foundSeason),
        getApiSportsTeamId(awayTeamName, sport, leagueId, foundSeason),
    ]);
    if (!homeTeamId || !awayTeamId) { 
        throw new Error(`Alapvető API-Football csapat azonosítók hiányoznak.`);
    }
    
    // 3. LÉPÉS: Meccskeresés
    const { fixtureId, fixtureDate } = await findApiSportsFixture(homeTeamId, awayTeamId, foundSeason, leagueId, utcKickoff, sport);
    if (!fixtureId) {
         console.warn(`API-SPORTS (${sport}): Nem található fixture, az odds, H2H és xG lekérés kihagyva.`);
    }

    console.log(`API-SPORTS (${sport}): Adatok párhuzamos lekérése... (FixtureID: ${fixtureId})`);
    // 4. LÉPÉS: Statisztikák
    const [
        fetchedOddsData,
        apiSportsH2HData,
        apiSportsHomeSeasonStats,
        apiSportsAwaySeasonStats,
        realFixtureStats,
    ] = await Promise.all([
        getApiSportsOdds(fixtureId, sport), 
        getApiSportsH2H(homeTeamId, awayTeamId, 5, sport),
        getApiSportsTeamSeasonStats(homeTeamId, leagueId, foundSeason, sport),
        getApiSportsTeamSeasonStats(awayTeamId, leagueId, foundSeason, sport),
        (sport === 'soccer' && fixtureId) ? getApiSportsFixtureStats(fixtureId, sport) : Promise.resolve(null),
    ]);
    console.log(`API-SPORTS (${sport}): Párhuzamos lekérések befejezve.`);
    
    const realXgData = realFixtureStats || null; 
    let geminiData: any = null; // A v54.2-ben már nem hívjuk a Geminit, de a struktúra maradhat
    
    // --- VÉGLEGES ADAT EGYESÍTÉS (v52.9) ---
    const finalData: ICanonicalRawData = {
        ...(geminiData || {}), 
        stats: {
            home: {} as ICanonicalStats, 
            away: {} as ICanonicalStats
        },
        apiFootballData: {
            homeTeamId, awayTeamId, leagueId, fixtureId, fixtureDate,
            lineups: null, liveStats: null, 
            seasonStats: { home: apiSportsHomeSeasonStats, away: apiSportsAwaySeasonStats }
        },
        h2h_structured: apiSportsH2HData || (Array.isArray(geminiData?.h2h_structured) ? geminiData.h2h_structured : []),
        form: {
            home_overall: apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || null,
            away_overall: apiSportsHomeSeasonStats?.form || geminiData?.form?.away_overall || null,
        },
        // Alapértelmezett, üres playerStats (Sofascore felülírja a DataFetch.ts-ben)
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] } 
    };
    
    // ... (Kanonikus statisztikák feltöltése változatlan) ...
    const homeGP = apiSportsHomeSeasonStats?.gamesPlayed || geminiData?.stats?.home?.gp || 1;
    finalData.stats.home = {
        gp: homeGP,
        gf: apiSportsHomeSeasonStats?.goalsFor || geminiData?.stats?.home?.gf || 0,
        ga: apiSportsHomeSeasonStats?.goalsAgainst || geminiData?.stats?.home?.ga || 0,
        form: apiSportsHomeSeasonStats?.form || geminiData?.form?.home_overall || null
    };
    const awayGP = apiSportsAwaySeasonStats?.gamesPlayed || geminiData?.stats?.away?.gp || 1;
    finalData.stats.away = {
        gp: awayGP,
        gf: apiSportsAwaySeasonStats?.goalsFor || geminiData?.stats?.away?.gf || 0,
        ga: apiSportsAwaySeasonStats?.goalsAgainst || geminiData?.stats?.away?.ga || 0,
        form: apiSportsAwaySeasonStats?.form || geminiData?.form?.away_overall || null
    };
    console.log(`Végleges stats használatban: Home(GP:${homeGP}), Away(GP:${awayGP})`);
    
    // ... (Kontextus adatok és végső objektum összeállítása változatlan) ...
    const stadiumLocation = geminiData?.contextual_factors?.stadium_location || "N/A";
    const structuredWeather = await getStructuredWeatherData(stadiumLocation, utcKickoff);
    if (!finalData.contextual_factors) finalData.contextual_factors = {};
    finalData.contextual_factors.structured_weather = structuredWeather;
    
    const richContextParts = [
         realXgData && `- Valós xG (API-Football): H=${realXgData.home}, A=${realXgData.away}`,
         (finalData.form.home_overall !== null || finalData.form.away_overall !== null) && `- Forma: H:${finalData.form.home_overall || 'N/A'}, V:${finalData.form.away_overall || 'N/A'}`,
         structuredWeather.description !== "N/A" && `- Időjárás: ${structuredWeather.description}`
    ].filter(Boolean);
    const richContext = richContextParts.length > 0 ? richContextParts.join('\n') : "N/A";
    
    const advancedData = realXgData ?
        { home: { xg: realXgData.home }, away: { xg: realXgData.away } } :
        (geminiData?.advancedData || { home: { xg: null }, away: { xg: null } });
    
    const result: ICanonicalRichContext = {
         rawStats: finalData.stats,
         leagueAverages: finalData.league_averages || {},
         richContext,
         advancedData: advancedData,
         form: finalData.form,
         rawData: finalData, 
         oddsData: fetchedOddsData, 
         fromCache: false
    };

    if (typeof result.rawStats?.home?.gp !== 'number' || result.rawStats.home.gp <= 0 || typeof result.rawStats?.away?.gp !== 'number' || result.rawStats.away.gp <= 0) {
        console.error(`KRITIKUS HIBA (${homeTeamName} vs ${awayTeamName}): Érvénytelen VÉGLEGES statisztikák (GP <= 0). HomeGP: ${result.rawStats?.home?.gp}, AwayGP: ${result.rawStats?.away?.gp}`);
        throw new Error(`Kritikus statisztikák (GP <= 0) érvénytelenek.`);
    }
    
    return result;
}

// Meta-adat a logoláshoz
export const providerName = 'api-sports-soccer';
