// FÁJL: DataFetch.ts
// VERZIÓ: v112.0 (AI-FIRST ARCHITECTURE + xG Mapping)
// MÓDOSÍTÁS (v112.0):
// 1. ARCHITEKTÚRA VÁLTÁS: Az AI ("Deep Scout") fut le legelőször (Plan A).
// 2. ADATMAPPING: Ha a Deep Scout talál xG és xGA adatokat (pl. FBref-ről),
//    azokat a rendszer "Manuális" adatként (P1) kezeli, és közvetlenül
//    betölti a 'manual_H_xG', 'manual_H_xGA' stb. mezőkbe.
// 3. EREDMÉNY: Kiváltja a manuális adatbevitelt, és a legpontosabb
//    4-komponensű xG képletet aktiválja a Model.ts-ben.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather, ICanonicalOdds } from './src/types/canonical.d.ts';

// Providerek importálása
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries as getApiSportsLineupsAndInjuries, 
    _getLeagueRoster, 
    getApiSportsTeamId, 
    getApiSportsLeagueId 
} from './providers/apiSportsProvider.js';

// Hoki provider
import {
    fetchMatchData as iceHockeyFetchData,
    providerName as iceHockeyProviderName
} from './providers/iceHockeyApiProvider.js';

// Kosár provider
import {
    fetchMatchData as apiBasketballFetchData,
    providerName as apiBasketballProviderName,
} from './providers/apiBasketballProvider.js';

import { fetchSofascoreData, type ISofascoreResponse } from './providers/sofascoreProvider.js';

// A HELYES 'oddsFeedProvider.ts' (v1.9.4) BEKÖTVE
import { fetchOddsData as oddsFeedFetchData_NameBased } from './providers/oddsFeedProvider.js'; 

// === ÚJ PROVIDER (v110.0): AI Web Search ===
import { fetchOddsViaWebSearch } from './providers/aiOddsProvider.js';
// ==========================================

// === ÚJ: Deep Scout importálása ===
import { runStep_TeamNameResolver, runStep_DeepScout } from './AI_Service.js';
// ==================================

import { SPORT_CONFIG, API_HOSTS } from './config.js'; 
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures,
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry
} from './providers/common/utils.js';

// --- FŐ CACHE INICIALIZÁLÁS ---
export const preFetchAnalysisCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

// Típusdefiníció a providerek számára
interface IDataProvider {
    fetchMatchData: (options: any) => Promise<IDataFetchResponse>;
    providerName: string;
}

type CanonicalRole = 'Kapus' | 'Védő' | 'Középpályás' | 'Támadó' | 'Ismeretlen';

// Provider-ek becsomagolása
const apiSportsProvider: IDataProvider = {
    fetchMatchData: apiSportsFetchData,
    providerName: apiSportsProviderName
};
const iceHockeyProvider: IDataProvider = {
    fetchMatchData: iceHockeyFetchData,
    providerName: iceHockeyProviderName
};
const apiBasketballProvider: IDataProvider = {
    fetchMatchData: apiBasketballFetchData,
    providerName: apiBasketballProviderName
};


export interface IDataFetchOptions {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
    forceNew: boolean;
    manual_xg_home?: number | null; 
    manual_xg_away?: number | null;
    manual_H_xG?: number | null;
    manual_H_xGA?: number | null;
    manual_A_xG?: number | null;
    manual_A_xGA?: number | null;
    manual_absentees?: { home: { name: string, pos: string }[], away: { name: string, pos: string }[] } | null; 
}

export interface IDataFetchResponse extends ICanonicalRichContext {
    xgSource: string; 
}

// === Segédfüggvény: AI Statisztikák Parse-olása (Fallback) ===
function parseAiStats(statsStr: string | undefined): ICanonicalStats {
    // Alapértelmezett értékek
    const defaultStats: ICanonicalStats = { gp: 5, gf: 0, ga: 0, form: null };
    
    if (!statsStr || statsStr === 'N/A') return defaultStats;
    
    // Pl. "W,W,L,D,W" -> Form
    // Becsülünk belőle gólt? Igen, durván.
    const wins = (statsStr.match(/W/gi) || []).length;
    const draws = (statsStr.match(/D/gi) || []).length;
    const losses = (statsStr.match(/L/gi) || []).length;
    const gp = wins + draws + losses;
    
    if (gp === 0) return defaultStats;
    
    // Heurisztika: Győzelem = 2 gól, Döntetlen = 1 gól, Vereség = 0 gól (lőtt)
    //              Győzelem = 0 kapott, Döntetlen = 1 kapott, Vereség = 2 kapott
    const estGF = (wins * 1.8) + (draws * 1.0) + (losses * 0.5);
    const estGA = (wins * 0.5) + (draws * 1.0) + (losses * 1.8);
    
    return {
        gp: gp,
        gf: parseFloat(estGF.toFixed(1)),
        ga: parseFloat(estGA.toFixed(1)),
        form: statsStr.toUpperCase().replace(/[^WDL]/g, '').substring(0, 5)
    };
}

/**
 * === "Stub" Válasz Generátor (FELOKOSÍTVA v110.0) ===
 * Ha minden kötél szakad, ez nem csak üres adatot ad vissza, hanem
 * megpróbálja az AI segítségével összeszedni az infókat a netről.
 */
async function generateEmptyStubContext(options: IDataFetchOptions): Promise<IDataFetchResponse> {
    const { sport, homeTeamName, awayTeamName, utcKickoff } = options;
    
    // Dátum dekódolása
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));
    
    console.warn(`[DataFetch/generateEmptyStubContext] API Hiba. Váltás AI WEB KERESÉSRE (${homeTeamName} vs ${awayTeamName})...`);
    
    // 1. AI Odds Keresés (Ultimate Fallback)
    let fallbackOdds = await fetchOddsViaWebSearch(homeTeamName, awayTeamName, sport);
    
    // Ha az AI sem talál oddsot, utolsó próba a régi odds feeddel
    if (!fallbackOdds) {
        try {
            console.log(`[DataFetch] AI Odds nem talált, próba a régi oddsFeedProviderrel...`);
            fallbackOdds = await oddsFeedFetchData_NameBased(homeTeamName, awayTeamName, decodedUtcKickoff, sport);
        } catch (e) { /* ignore */ }
    }
    
    // 2. AI Kontextus Keresés (Hírek, Sérültek) - MÁR MEGTÖRTÉNT A DEEP SCOUT-BAN
    // De ha ez a függvény fut, akkor lehet, hogy az API hívás közben volt hiba.
    // A fő függvényben már egyesítettük az adatokat.
    
    // Itt visszaadunk egy "üres" szerkezetet, amit majd a hívó feltölt a Deep Scout adatokkal.
    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const emptyWeather: IStructuredWeather = { description: "N/A (API Hiba)", temperature_celsius: null, wind_speed_kmh: null, precipitation_mm: null, source: 'N/A' };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: { homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null, lineups: null, liveStats: null, seasonStats: { home: null, away: null } },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: { stadium_location: "N/A", structured_weather: emptyWeather, pitch_condition: "N/A", weather: "N/A", match_tension_index: null, coach: { home_name: null, away_name: null } },
        availableRosters: { home: [], away: [] }
    };
    
    const defaultXG = (sport === 'basketball') ? 110 : (sport === 'hockey' ? 3.0 : 1.35);
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: `[AI WEB SEARCH ONLY] API adatok nem elérhetők.`,
         advancedData: { 
             home: { xg: defaultXG }, 
             away: { xg: defaultXG },
             manual_H_xG: options.manual_H_xG,
             manual_H_xGA: options.manual_H_xGA,
             manual_A_xG: options.manual_A_xG,
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: fallbackOdds,
         fromCache: false,
         availableRosters: { home: [], away: [] }
    };
    
    return { ...result, xgSource: "STUB_DATA (AI Search)" };
}


function getProvider(sport: string): IDataProvider {
  switch (sport.toLowerCase()) {
    case 'soccer':
      return apiSportsProvider;
    case 'hockey':
      return iceHockeyProvider; 
    case 'basketball':
      return apiBasketballProvider;
    default:
      throw new Error(`Nem támogatott sportág: '${sport}'. Nincs implementált provider.`);
  }
}

function getRoleFromPos(pos: string): CanonicalRole {
    if (!pos) return 'Ismeretlen';
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
    if (p === 'D') return 'Védő';
    if (p === 'M') return 'Középpályás';
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v112.0 - AI FIRST xG)
 */
export async function getRichContextualData(
    options: IDataFetchOptions,
    explicitMatchId?: string 
): Promise<IDataFetchResponse> {
    
    const { 
        sport, 
        homeTeamName, 
        awayTeamName, 
        leagueName, 
        utcKickoff, 
        forceNew,
        manual_H_xG,
        manual_H_xGA,
        manual_A_xG,
        manual_A_xGA,
        manual_absentees
    } = options;

    const decodedLeagueName = decodeURIComponent(decodeURIComponent(leagueName || 'N/A'));
    const decodedHomeTeam = decodeURIComponent(decodeURIComponent(homeTeamName || 'N/A'));
    const decodedAwayTeam = decodeURIComponent(decodeURIComponent(awayTeamName || 'N/A'));
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    
    const p1AbsenteesHash = manual_absentees ?
        `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
        '';
        
    const ck = explicitMatchId || `rich_context_v112.0_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    // === CACHE OLVASÁS ===
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            // (Manuális xG visszaírása... változatlan)
            return { ...cached, fromCache: true };
        }
    }
    // === CACHE OLVASÁS VÉGE ===

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    
    // === LÉPÉS 1: AI DEEP SCOUT (A "PLAN A") ===
    // Először az AI fut le, hogy meglegyen a "Lélek", a Kontextus, és az xG/xGA.
    const deepScoutResult = await runStep_DeepScout({
        home: decodedHomeTeam,
        away: decodedAwayTeam,
        sport: sport
    });
    
    // Készítünk egy alap "Deep Context" stringet
    const deepContextString = deepScoutResult ? 
        `[DEEP SCOUT JELENTÉS]:\n- Összefoglaló: ${deepScoutResult.narrative_summary}\n- Fizikai: ${deepScoutResult.physical_factor}\n- Pszichológiai: ${deepScoutResult.psychological_factor}\n- Időjárás: ${deepScoutResult.weather_context}\n- Hírek: ${deepScoutResult.key_news?.join('; ')}` 
        : "A Deep Scout nem talált adatot.";

    // === LÉPÉS 2: API LEKÉRÉS (A "PLAN B" / STATISZTIKA) ===
    // Párhuzamosan futtatjuk az API-kat a kemény számokért (xG, tabellák).
    
    let finalResult: IDataFetchResponse;
    let xgSource = "Calculated (Fallback)";

    try {
        const sportProvider = getProvider(sport);
        console.log(`API Adatgyűjtés indul (Provider: ${sportProvider.providerName})...`);

        const apiConfig = API_HOSTS[sport];
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        // ID Keresés és Provider hívás
        let leagueId: number | null = null;
        let foundSeason: number | null = null;
        let homeTeamId: number | null = null;
        let awayTeamId: number | null = null;
        const originSeason = (new Date(decodedUtcKickoff).getMonth() < 7) ? new Date(decodedUtcKickoff).getFullYear() - 1 : new Date(decodedUtcKickoff).getFullYear();

        if (sport === 'soccer') {
            const leagueDataResponse = await getApiSportsLeagueId(decodedLeagueName, countryContext, new Date(decodedUtcKickoff).getFullYear(), sport);
            if (leagueDataResponse && leagueDataResponse.leagueId) {
                leagueId = leagueDataResponse.leagueId;
                foundSeason = leagueDataResponse.foundSeason;
                homeTeamId = await getApiSportsTeamId(decodedHomeTeam, sport, leagueId, originSeason);
                awayTeamId = await getApiSportsTeamId(decodedAwayTeam, sport, leagueId, originSeason);
                
                // Fallback ID keresés 8. ügynökkel (ha statikus nem ment)
                if (!homeTeamId || !awayTeamId) {
                    const leagueRoster = await _getLeagueRoster(leagueId, foundSeason, sport);
                    const rosterStubs = leagueRoster.map(item => ({ id: item.team.id, name: item.team.name }));
                    if (!homeTeamId) homeTeamId = await runStep_TeamNameResolver({ inputName: decodedHomeTeam, searchTerm: decodedHomeTeam.toLowerCase().trim(), rosterJson: rosterStubs });
                    if (!awayTeamId) awayTeamId = await runStep_TeamNameResolver({ inputName: decodedAwayTeam, searchTerm: decodedAwayTeam.toLowerCase().trim(), rosterJson: rosterStubs });
                }
            }
        }

        const providerOptions = {
            sport, homeTeamName: decodedHomeTeam, awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName, utcKickoff: decodedUtcKickoff,
            countryContext, homeTeamId, awayTeamId, leagueId, foundSeason, apiConfig
        };
        
        const [baseResult, sofascoreData] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            (sport === 'soccer' && manual_H_xG == null) ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) : Promise.resolve(null)
        ]);
        
        finalResult = baseResult;
        
        // Sofascore integráció (ha van)
        if (sofascoreData?.advancedData) {
            finalResult.advancedData.home.xg = sofascoreData.advancedData.xg_home;
            finalResult.advancedData.away.xg = sofascoreData.advancedData.xG_away;
            xgSource = "API (Real - Sofascore)";
        } else if (baseResult?.advancedData?.home?.xg) {
            xgSource = `API (Real - ${sportProvider.providerName})`;
        }

    } catch (e: any) {
         console.error(`API Hiba, visszalépés csak AI adatokra: ${e.message}`);
         finalResult = await generateEmptyStubContext(options);
         xgSource = "STUB (AI Fallback)";
    }

    // === LÉPÉS 3: EGYESÍTÉS ÉS xG MAPPING (MERGE) ===
    // Itt adjuk hozzá a Deep Scout tudását az API adatokhoz.
    
    // 1. Rich Context felülírása/bővítése
    const apiContext = finalResult.richContext !== "N/A" ? finalResult.richContext : "";
    finalResult.richContext = `${deepContextString}\n\n[API ADATOK]:\n${apiContext}`;
    
    // 2. Statisztikai Fallback (Ha az API nem hozott számokat)
    if (finalResult.rawStats.home.gp <= 1 && deepScoutResult?.stats_fallback) {
        console.log(`[DataFetch] API statisztika hiányos. Deep Scout fallback alkalmazása...`);
        finalResult.rawStats.home = parseAiStats(deepScoutResult.stats_fallback.home_last_5);
        finalResult.rawStats.away = parseAiStats(deepScoutResult.stats_fallback.away_last_5);
    }

    // 3. PRIORITÁSI LÁNC AZ xG ADATOKRA
    // A) FELHASZNÁLÓI MANUÁLIS (Override)
    if (manual_H_xG != null) {
        finalResult.advancedData.manual_H_xG = manual_H_xG;
        finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        finalResult.advancedData.manual_A_xG = manual_A_xG;
        finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        xgSource = "Manual (Components)";
    }
    // B) AI DEEP SCOUT xG/xGA (Ha van) - Ez a Plan A, ha nincs manuális
    else if (deepScoutResult?.xg_stats && deepScoutResult.xg_stats.home_xg != null) {
        console.log(`[DataFetch] AI Deep Scout talált xG adatokat! Betöltés "Manuális" helyére...`);
        finalResult.advancedData.manual_H_xG = deepScoutResult.xg_stats.home_xg;
        finalResult.advancedData.manual_H_xGA = deepScoutResult.xg_stats.home_xga;
        finalResult.advancedData.manual_A_xG = deepScoutResult.xg_stats.away_xg;
        finalResult.advancedData.manual_A_xGA = deepScoutResult.xg_stats.away_xga;
        xgSource = `AI Deep Scout (${deepScoutResult.xg_stats.source || 'Web'})`;
    }
    // C) API (Sofascore/ApiSports) - Ez a Plan B, ha az AI nem talált
    // (Ez már beállítódott a 138. sor környékén a 'finalResult' változóban, csak a 'xgSource' kell)
    else if (xgSource.includes("API")) {
        // Marad a jelenlegi beállítás
    }
    
    finalResult.xgSource = xgSource;

    // === ODDS & WEB CONTEXT FALLBACK (v110.0 - Megtartva biztonságnak) ===
    const primaryOddsFailed = !finalResult.oddsData || !finalResult.oddsData.allMarkets || finalResult.oddsData.allMarkets.length === 0;
    if (primaryOddsFailed) {
        console.warn(`[DataFetch] API Odds hiányzik. AI Web Search indítása...`);
        const aiOdds = await fetchOddsViaWebSearch(decodedHomeTeam, decodedAwayTeam, sport);
        if (aiOdds) finalResult.oddsData = aiOdds;
    }

    preFetchAnalysisCache.set(ck, finalResult);
    console.log(`Sikeres adat-egyesítés (v112.0 AI-First), cache mentve (${ck}).`);
    return { ...finalResult, fromCache: false };
}


// === P1 KERET-LEKÉRŐ FÜGGVÉNY (Változatlan) ===
export async function getRostersForMatch(options: {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } |
null> {
    
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
    try {
        const sportProvider = getProvider(options.sport);
        const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName || 'N/A'));
        const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName || 'N/A'));
        const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName || 'N/A'));
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff || new Date().toISOString()));
        
        const sportConfig = SPORT_CONFIG[options.sport];
        const apiConfig = API_HOSTS[options.sport];
        
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A';
        
        let leagueId: number | null = null;
        let foundSeason: number | null = null;
        let homeTeamId: number | null = null;
        let awayTeamId: number | null = null;
        const originSeason = (new Date(decodedUtcKickoff).getMonth() < 7) ? new Date(decodedUtcKickoff).getFullYear() - 1 : new Date(decodedUtcKickoff).getFullYear();

        if (options.sport === 'soccer') {
            const leagueDataResponse = await getApiSportsLeagueId(decodedLeagueName, countryContext, new Date(decodedUtcKickoff).getFullYear(), options.sport);

            if (!leagueDataResponse || !leagueDataResponse.leagueId) {
                 console.warn(`[DataFetch] Nem sikerült a liga ID azonosítása a keret lekéréséhez.`);
                 return null;
            }
            leagueId = leagueDataResponse.leagueId;
            foundSeason = leagueDataResponse.foundSeason;
            
            [homeTeamId, awayTeamId] = await Promise.all([
                getApiSportsTeamId(decodedHomeTeam, options.sport, leagueId, originSeason),
                getApiSportsTeamId(decodedAwayTeam, options.sport, leagueId, originSeason),
            ]);
            
            if (!homeTeamId || !awayTeamId) {
                 console.warn(`[DataFetch] Csapat ID hiányzik a keret lekéréséhez. (HomeID: ${homeTeamId}, AwayID: ${awayTeamId}).`);
            }
        }

        const providerOptions = {
            sport: options.sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff,
            countryContext: countryContext,
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId,
            leagueId: leagueId,
            foundSeason: foundSeason,
            apiConfig: apiConfig
        };

        const baseResult = await sportProvider.fetchMatchData(providerOptions);
        
        if (baseResult && 
            baseResult.availableRosters && 
            (baseResult.availableRosters.home.length > 0 || baseResult.availableRosters.away.length > 0)
        ) {
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) 'availableRosters' adatot adott vissza, de az üres (H: ${baseResult?.availableRosters?.home?.length ?? 'N/A'}, A: ${baseResult?.availableRosters?.away?.length ?? 'N/A'}).`);
            return { home: [], away: [] };
        }

    } catch (e: any) {
        console.error(`[DataFetch] Hiba a getRostersForMatch során: ${e.message}`, e.stack);
        return null;
    }
}


// --- KÖZÖS FÜGGVÉNYEK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;
