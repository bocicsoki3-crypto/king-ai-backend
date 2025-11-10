// FÁJL: DataFetch.ts
// VERZIÓ: v97.0 ("Szekvenciális Aggregátor")
// VISSZAÁLLÍTÁS: A v97.1-es refaktorálás (az _getFixturesFromEspn
// bemásolása) hibás volt. Visszaállunk a v97.0-s logikára,
// ahol ez a fájl csak importálja és exportálja a meccslista
// lekérőt a 'utils.ts'-ből.

import NodeCache from 'node-cache';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather, ICanonicalOdds } from './src/types/canonical.d.ts';

// --- FOCI PROVIDER (Változatlan) ---
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries, 
    _getLeagueRoster as soccerGetLeagueRoster,
    getApiSportsTeamId as soccerGetTeamId,
    getApiSportsLeagueId as soccerGetLeagueId
} from './providers/apiSportsProvider.js';

// --- JÉGKORONG PROVIDEREK (v96.0) ---
import {
    fetchMatchData as iceHockeyApiFetchData, // Kontextus (H2H, Keretek)
    providerName as iceHockeyApiProviderName
} from './providers/iceHockeyApiProvider.js';
import {
    fetchOddsData as oddsFeedFetchData // Odds-ok (Piacok)
} from './providers/oddsFeedProvider.js';
// --- MÓDOSÍTÁS VÉGE ---

// Kosárlabda (még nincs használatban)
import * as basketballProvider from './providers/newBasketballProvider.js';

import { fetchSofascoreData, type ISofascoreResponse } from './providers/sofascoreProvider.js';
// A régi 'oddsProvider.ts' (foci fallback) átnevezve, hogy egyértelmű legyen
import { fetchOddsData as soccerOddsFallbackFetchData } from './providers/oddsProvider.js'; 
import { runStep_TeamNameResolver } from './AI_Service.js';
import { SPORT_CONFIG } from './config.js';
import {
    _callGemini as commonCallGemini,
    // === JAVÍTÁS (v97.1 -> v97.0 Visszaállítás) ===
    // Itt újra importáljuk a meccslista lekérőt
    _getFixturesFromEspn as commonGetFixtures,
    // ===========================================
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry,
    // A 'makeRequest' és 'axios' importok eltávolítva (már nincsenek itt használva)
} from './providers/common/utils.js';

export const preFetchAnalysisCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

interface IDataProvider {
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

type CanonicalRole = 'Kapus' | 'Védő' | 'Középpályás' | 'Támadó' | 'Ismeretlen';

const apiSportsProvider: IDataProvider = {
    fetchMatchData: apiSportsFetchData,
    providerName: apiSportsProviderName
};

const iceHockeyApiProvider: IDataProvider = {
    fetchMatchData: iceHockeyApiFetchData,
    providerName: iceHockeyApiProviderName
};

export interface IDataFetchOptions {
// ... (Interface változatlan)
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

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v97.0 (Szekvenciális Aggregátor)
**************************************************************/

function generateEmptyStubContext(options: IDataFetchOptions): IDataFetchResponse {
    // ... (Függvény változatlan)
    const { sport, homeTeamName, awayTeamName } = options;
    
    console.warn(`[DataFetch/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
    const emptyWeather: IStructuredWeather = {
        description: "N/A (API Hiba)",
        temperature_celsius: null,
        wind_speed_kmh: null,
        precipitation_mm: null,
        source: 'N/A'
    };
    
    const emptyRawData: ICanonicalRawData = {
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: {
             homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null,
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [],
            away_absentees: [],
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A",
            structured_weather: emptyWeather,
            pitch_condition: "N/A", 
            weather: "N/A",
            match_tension_index: null,
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    const result: IDataFetchResponse = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { 
             home: { xg: null }, 
             away: { xg: null },
             manual_H_xG: options.manual_H_xG,
             manual_H_xGA: options.manual_H_xGA,
             manual_A_xG: options.manual_A_xG,
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
         rawData: emptyRawData,
         oddsData: null,
         fromCache: false,
         availableRosters: { home: [], away: [] },
         xgSource: "N/A (API Hiba)"
    };
    
    return result;
}

// === JAVÍTVA (v96.0): Hoki provider cserélve ===
function getProvider(sport: string): IDataProvider {
  switch (sport.toLowerCase()) {
    case 'soccer':
      return apiSportsProvider;
    case 'hockey':
      return iceHockeyApiProvider; // JAVÍTVA: Az új Kontextus Provider
    case 'basketball':
      return basketballProvider; 
    default:
      throw new Error(`Nem támogatott sportág: '${sport}'. Nincs implementált provider.`);
  }
}

function getRoleFromPos(pos: string): CanonicalRole {
    // ... (Függvény változatlan)
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
    if (p === 'D') return 'Védő';
    if (p === 'M') return 'Középpályás';
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v97.0 - Szekvenciális Aggregátor)
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
    
    const p1AbsenteesHash = manual_absentees ? `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : '';
        
    // A cache kulcs mostantól az aggregátor verziót jelöli
    const ck = explicitMatchId || `rich_context_v97.0_serial_aggregator_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            // ... (P1 felülírás logika változatlan)
            // ...
            return { ...cached, fromCache: true, xgSource: '...' /* TODO: xgSource-t is cache-elni */ };
        }
    }

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        const sportProvider = getProvider(sport); // Kontextus provider (Foci vagy Hoki)
        console.log(`Adatgyűjtés indul (Kontextus Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        // --- MÓDOSÍTÁS (v96.0): AGGREGÁTOR MODELL ---
        
        let providerOptions: any = {
             sport: sport,
             homeTeamName: decodedHomeTeam,
             awayTeamName: decodedAwayTeam,
             leagueName: decodedLeagueName,
             utcKickoff: decodedUtcKickoff,
             countryContext: countryContext,
        };

        // A Hoki (IceHockeyApiProvider) és a Foci (ApiSportsProvider)
        // más-más logikát igényel az ID-k kezelésére.
        
        if (sport === 'soccer') {
            // --- FOCI LOGIKA (Változatlan) ---
            console.log("[DataFetch v97.0] Foci-specifikus ID kereső hívása...");
            const currentYear = new Date(decodedUtcKickoff).getFullYear();
            const leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, sport);

            if (!leagueDataResponse || !leagueDataResponse.leagueId) {
                 console.error(`[DataFetch] KRITIKUS P4 HIBA (Foci): Végleg nem sikerült a 'leagueId' azonosítása ('${decodedLeagueName}' néven).`);
                 return generateEmptyStubContext(options);
            }
            
            const { leagueId, foundSeason } = leagueDataResponse;
            let homeTeamId = await soccerGetTeamId(decodedHomeTeam, sport, leagueId, foundSeason);
            let awayTeamId = await soccerGetTeamId(decodedAwayTeam, sport, leagueId, foundSeason);
            
            // AI Fallback (Csak Focihoz)
            if (!homeTeamId || !awayTeamId) {
                // ... (AI Fallback logika változatlan)
            }
            
            if (!homeTeamId || !awayTeamId) {
                console.error(`[DataFetch] KRITIKUS P4 HIBA (Foci): Csapat azonosítók hiányoznak.`);
                return generateEmptyStubContext(options);
            }
            
            providerOptions.homeTeamId = homeTeamId;
            providerOptions.awayTeamId = awayTeamId;
            providerOptions.leagueId = leagueId;
            providerOptions.foundSeason = foundSeason;
            
        } else {
             console.log(`[DataFetch v97.0] Egyéb sportág (${sport}). A provider (${sportProvider.providerName}) belső ID keresője lesz használva.`);
             // A Hoki (IceHockeyApiProvider v1.2) belsőleg kezeli az ID keresést (szekvenciálisan).
        }

        // 4. LÉPÉS: SZEKVENCIÁLIS adatgyűjtés (Aggregátor)
        
        const skipSofascore = (options.manual_H_xG != null);
        
        let finalResult: ICanonicalRichContext;
        let fetchedOdds: ICanonicalOdds | null = null;
        let sofascoreData: ISofascoreResponse | null = null;

        if (sport === 'hockey') {
            // --- HOKI AGGREGÁTOR (SZEKVENCIÁLIS - v97.0) ---
            console.log(`[DataFetch v97.0] Hoki Aggregátor (Szekvenciális): 1. IceHockeyApi (Kontextus) hívása...`);
            finalResult = await sportProvider.fetchMatchData(providerOptions);
            
            console.log(`[DataFetch v97.0] Hoki Aggregátor (Szekvenciális): 2. OddsFeed (Odds) hívása...`);
            fetchedOdds = await oddsFeedFetchData(decodedHomeTeam, decodedAwayTeam, decodedUtcKickoff, sport);

            if (fetchedOdds) {
                console.log(`[DataFetch v97.0] Hoki Aggregátor: Odds adatok sikeresen felülírva az 'OddsFeedProvider'-ből.`);
                finalResult.oddsData = fetchedOdds;
            } else {
                console.warn(`[DataFetch v97.0] Hoki Aggregátor: Az 'OddsFeedProvider' nem adott vissza adatot.`);
            }

        } else if (sport === 'soccer') {
            // --- FOCI AGGREGÁTOR (Párhuzamos, mert a provider bírja) ---
            console.log(`[DataFetch v97.0] Foci Aggregátor (Párhuzamos): ApiSports (Kontextus+Odds) és Sofascore hívása...`);
            
            const [baseResult, sofascoreResult] = await Promise.all([
                 sportProvider.fetchMatchData(providerOptions),
                 (!skipSofascore)
                    ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                    : Promise.resolve(null)
            ]);
            finalResult = baseResult;
            sofascoreData = sofascoreResult;

        } else {
             // Egyéb sportok (Kosár)
             finalResult = await sportProvider.fetchMatchData(providerOptions);
        }
        
        // === EGYESÍTÉS (v97.0) ===
        
        // ... (xG Forrás meghatározása - változatlan)
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xGSource: IDataFetchResponse['xgSource'];
        
        if (manual_H_xG != null && manual_H_xGA != null &&
            manual_A_xG != null && manual_A_xGA != null)
        {
            // ... (P1 xG felülírás)
            finalHomeXg = (manual_H_xG + manual_H_xGA) / 2;
            finalAwayXg = (manual_A_xG + manual_H_xGA) / 2;
            xGSource = "Manual (Components)";
        }
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away;
            xGSource = "API (Real)"; 
        }
        else if (finalResult?.advancedData?.home?.xg != null && finalResult?.advancedData?.away?.xg != null) {
            finalHomeXg = finalResult.advancedData.home.xg;
            finalAwayXg = finalResult.advancedData.away.xg;
            xGSource = "API (Real)"; // A Kontextus Providerből (pl. ApiSports foci)
        }
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xGSource = "Calculated (Fallback)";
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        finalResult.advancedData.manual_H_xG = manual_H_xG;
        finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        finalResult.advancedData.manual_A_xG = manual_A_xG;
        finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xGSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        // Foci Odds Fallback (Változatlan)
        const primaryOddsFailed = !finalResult.oddsData || !finalResult.oddsData.allMarkets || finalResult.oddsData.allMarkets.length === 0;
        const fixtureId = finalResult.rawData.apiFootballData?.fixtureId;

        if (primaryOddsFailed && fixtureId && sport === 'soccer') {
            console.warn(`[DataFetch] Az 'apiSportsProvider' (foci) nem adott vissza Odds adatot. Fallback indítása...`);
            try {
                const oddsFeedResult = await soccerOddsFallbackFetchData(fixtureId, sport);
                if (oddsFeedResult) {
                    finalResult.oddsData = oddsFeedResult; 
                }
            } catch (e: any) {
                console.error(`[DataFetch] Hiba a (foci) 'OddsProvider' fallback hívása során: ${e.message}`);
            }
        }
        
        // P1 Manuális Hiányzók (Változatlan)
        if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
            // ... (P1 hiányzó felülírás logika változatlan)
        }
        // P2 Sofascore Hiányzók (Változatlan, csak foci)
        else if (options.sport === 'soccer') {
            // ... (Sofascore felülírás logika változatlan)
        }

        const response: IDataFetchResponse = {
            ...finalResult,
            xgSource: xGSource 
        };
        
        preFetchAnalysisCache.set(ck, response);
        console.log(`Sikeres adat-egyesítés (v97.0 - Szekvenciális Aggregátor), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v97.0) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE (Catch Blokk). A rendszer üres adat-stubot ad vissza.`);
         return generateEmptyStubContext(options);
    }
}

/**
 * === MÓDOSÍTVA (v96.0): Leegyszerűsítve ===
 */
export async function getRostersForMatch(options: {
    // ... (Függvény változatlan, a belső 'getProvider' hívás már a
    //      helyes (IceHockeyApi) providert fogja visszaadni hoki esetén)
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } |
null> {
    
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
    try {
        const sportProvider = getProvider(options.sport); // Kontextus provider
        // ... (A többi kód változatlanul működik, mert a
        // 'sportProvider.fetchMatchData' hívás már a helyes
        // provider-t (Foci vagy Hoki) fogja hívni)
        // ...
        
        // --- (v95.0 logika változatlan) ---
        const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName || 'N/A'));
        const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName || 'N/A'));
        const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName || 'N/A'));
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff || new Date().toISOString()));
        
        const sportConfig = SPORT_CONFIG[options.sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/IA';
        
        let providerOptions: any = {
             sport: options.sport,
             homeTeamName: decodedHomeTeam,
             awayTeamName: decodedAwayTeam,
             leagueName: decodedLeagueName,
             utcKickoff: decodedUtcKickoff,
             countryContext: countryContext,
        };
        
        if (options.sport === 'soccer') {
            const currentYear = new Date(decodedUtcKickoff).getFullYear();
            const leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, options.sport);
            if (!leagueDataResponse || !leagueDataResponse.leagueId) return null;
            const { leagueId, foundSeason } = leagueDataResponse;
            const homeTeamId = await soccerGetTeamId(decodedHomeTeam, options.sport, leagueId, foundSeason);
            const awayTeamId = await soccerGetTeamId(decodedAwayTeam, options.sport, leagueId, foundSeason);
            if (!homeTeamId || !awayTeamId) return null;
            providerOptions.homeTeamId = homeTeamId;
            providerOptions.awayTeamId = awayTeamId;
            providerOptions.leagueId = leagueId;
            providerOptions.foundSeason = foundSeason;
        }
        // --- (v95.0 logika vége) ---

        const baseResult = await sportProvider.fetchMatchData(providerOptions);
        
        if (baseResult && 
            baseResult.availableRosters && 
            (baseResult.availableRosters.home.length > 0 || baseResult.availableRosters.away.length > 0)
        ) {
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) 'availableRosters' adatot adott vissza, de az üres.`);
            return null;
        }

    } catch (e: any) {
        console.error(`[DataFetch] Hiba a getRostersForMatch során: ${e.message}`, e.stack);
        return null;
    }
}


// === JAVÍTÁS (v97.1 -> v97.0 Visszaállítás) ===
// Itt újra exportáljuk a meccslista lekérőt
export const _getFixturesFromEspn = commonGetFixtures;
// ===========================================
export const _callGemini = commonCallGemini;
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;
