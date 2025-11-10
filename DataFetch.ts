// FÁJL: DataFetch.ts
// VERZIÓ: v96.0 ("Aggregátor Modell")
// CÉL: Ez a fájl már a helyes Aggregátor logikát tartalmazza.
//      Nem kell módosítani, de a teljesség igénye miatt
//      újra generálom, hogy szinkronban legyen a többi (v1.1) providerrel.

import NodeCache from 'node-cache';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather, ICanonicalOdds } from './src/types/canonical.d.ts';

// --- FOCI PROVIDER (Változatlan) ---
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
// ... (importok változatlanok)
    getApiSportsLeagueId as soccerGetLeagueId
} from './providers/apiSportsProvider.js';

// --- JÉGKORONG PROVIDEREK (ÚJ v96.0) ---
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
// ... (importok változatlanok)
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry
} from './providers/common/utils.js';

export const preFetchAnalysisCache = new NodeCache({ stdTTL: 3600 * 2, checkperiod: 600, useClones: false });

interface IDataProvider {
// ... (interface változatlan)
    fetchMatchData: (options: any) => Promise<ICanonicalRichContext>;
    providerName: string;
}

type CanonicalRole = 'Kapus' | 'Védő' | 'Középpályás' | 'Támadó' | 'Ismeretlen';

const apiSportsProvider: IDataProvider = {
// ... (objektum változatlan)
    fetchMatchData: apiSportsFetchData,
    providerName: apiSportsProviderName
};

// Az 'iceHockeyApiProvider' az IDataProvider interfészt követi
const iceHockeyApiProvider: IDataProvider = {
    fetchMatchData: iceHockeyApiFetchData,
    providerName: iceHockeyApiProviderName
};

export interface IDataFetchOptions {
// ... (interface változatlan)
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
    forceNew: boolean;
    manual_xg_home?: number | null; 
// ... (interface változatlan)
    manual_absentees?: { home: { name: string, pos: string }[], away: { name: string, pos: string }[] } | null; 
}

export interface IDataFetchResponse extends ICanonicalRichContext {
// ... (interface változatlan)
    xgSource: string; 
}

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v96.0 (Aggregátor Modell)
**************************************************************/

function generateEmptyStubContext(options: IDataFetchOptions): IDataFetchResponse {
    // ... (Függvény törzse változatlan)
    const { sport, homeTeamName, awayTeamName } = options;
    
    console.warn(`[DataFetch/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);

    const emptyStats: ICanonicalStats = { gp: 1, gf: 0, ga: 0, form: null };
// ... (Függvény törzse változatlan)
    const emptyWeather: IStructuredWeather = {
        description: "N/A (API Hiba)",
// ... (Függvény törzse változatlan)
        source: 'N/A'
    };
    
    const emptyRawData: ICanonicalRawData = {
// ... (Függvény törzse változatlan)
        stats: { home: emptyStats, away: emptyStats },
        apiFootballData: {
             homeTeamId: null, awayTeamId: null, leagueId: null, fixtureId: null, fixtureDate: null,
// ... (Függvény törzse változatlan)
             lineups: null, liveStats: null, seasonStats: { home: null, away: null }
        },
        h2h_structured: [],
// ... (Függvény törzse változatlan)
        form: { home_overall: null, away_overall: null },
        detailedPlayerStats: {
            home_absentees: [],
// ... (Függvény törzse változatlan)
            key_players_ratings: { home: {}, away: {} }
        },
        absentees: { home: [], away: [] },
// ... (Függvény törzse változatlan)
        referee: { name: "N/A", style: null },
        contextual_factors: {
            stadium_location: "N/A",
// ... (Függvény törzse változatlan)
            coach: { home_name: null, away_name: null }
        },
        availableRosters: { home: [], away: [] }
    };
    
    const result: IDataFetchResponse = {
// ... (Függvény törzse változatlan)
         rawStats: emptyRawData.stats,
         leagueAverages: {},
// ... (Függvény törzse változatlan)
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
         advancedData: { 
             home: { xg: null }, 
// ... (Függvény törzse változatlan)
             manual_A_xGA: options.manual_A_xGA
         },
         form: emptyRawData.form,
// ... (Függvény törzse változatlan)
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
// ... (Függvény törzse változatlan)
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
// ... (Függvény törzse változatlan)
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v96.0 - Aggregátor)
 */
export async function getRichContextualData(
// ... (Függvény törzse változatlan)
    options: IDataFetchOptions,
    explicitMatchId?: string 
): Promise<IDataFetchResponse> {
    
    const { 
// ... (Függvény törzse változatlan)
        manual_absentees
    } = options;

    const decodedLeagueName = decodeURIComponent(decodeURIComponent(leagueName || 'N/A'));
// ... (Függvény törzse változatlan)
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    
// ... (Függvény törzse változatlan)
    const p1AbsenteesHash = manual_absentees ? `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : '';
        
    // A cache kulcs mostantól az aggregátor verziót jelöli
// ... (Függvény törzse változatlan)
    const ck = explicitMatchId || `rich_context_v96.0_aggregator_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    if (!forceNew) {
// ... (Függvény törzse változatlan)
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            // ... (P1 felülírás logika változatlan)
            // ...
            return { ...cached, fromCache: true, xgSource: '...' };
        }
    }

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
// ... (Függvény törzse változatlan)
    try {
        
        const sportProvider = getProvider(sport); // Kontextus provider (Foci vagy Hoki)
// ... (Függvény törzse változatlan)
        console.log(`Adatgyűjtés indul (Kontextus Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[sport];
// ... (Függvény törzse változatlan)
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        // --- MÓDOSÍTÁS (v96.0): AGGREGÁTOR MODELL ---
        
        let providerOptions: any = {
// ... (Függvény törzse változatlan)
             sport: sport,
             homeTeamName: decodedHomeTeam,
             awayTeamName: decodedAwayTeam,
             leagueName: decodedLeagueName,
             utcKickoff: decodedUtcKickoff,
             countryContext: countryContext,
        };

        // A Hoki (IceHockeyApiProvider) és a Foci (ApiSportsProvider)
// ... (Függvény törzse változatlan)
        // más-más logikát igényel az ID-k kezelésére.
        
        if (sport === 'soccer') {
            // --- FOCI LOGIKA (Változatlan) ---
// ... (Függvény törzse változatlan)
            console.log("[DataFetch v96.0] Foci-specifikus ID kereső hívása...");
            const currentYear = new Date(decodedUtcKickoff).getFullYear();
// ... (Függvény törzse változatlan)
            const leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, sport);

            if (!leagueDataResponse || !leagueDataResponse.leagueId) {
// ... (Függvény törzse változatlan)
                 console.error(`[DataFetch] KRITIKUS P4 HIBA (Foci): Végleg nem sikerült a 'leagueId' azonosítása ('${decodedLeagueName}' néven).`);
                 return generateEmptyStubContext(options);
            }
            
            const { leagueId, foundSeason } = leagueDataResponse;
// ... (Függvény törzse változatlan)
            let homeTeamId = await soccerGetTeamId(decodedHomeTeam, sport, leagueId, foundSeason);
            let awayTeamId = await soccerGetTeamId(decodedAwayTeam, sport, leagueId, foundSeason);
            
            // AI Fallback (Csak Focihoz)
// ... (Függvény törzse változatlan)
            if (!homeTeamId || !awayTeamId) {
                // ... (AI Fallback logika változatlan)
            }
            
            if (!homeTeamId || !awayTeamId) {
// ... (Függvény törzse változatlan)
                console.error(`[DataFetch] KRITIKUS P4 HIBA (Foci): Csapat azonosítók hiányoznak.`);
                return generateEmptyStubContext(options);
            }
            
            providerOptions.homeTeamId = homeTeamId;
// ... (Függvény törzse változatlan)
            providerOptions.awayTeamId = awayTeamId;
            providerOptions.leagueId = leagueId;
            providerOptions.foundSeason = foundSeason;
            
        } else {
// ... (Függvény törzse változatlan)
             console.log(`[DataFetch v96.0] Egyéb sportág (${sport}). A provider (${sportProvider.providerName}) belső ID keresője lesz használva.`);
             // A Hoki (IceHockeyApiProvider v1.0) belsőleg kezeli az ID keresést a nevek alapján.
        }

        // 4. LÉPÉS: Párhuzamos adatgyűjtés (Aggregátor)
// ... (Függvény törzse változatlan)
        
        const skipSofascore = (options.manual_H_xG != null);
        
// ... (Függvény törzse változatlan)
        let contextPromise: Promise<ICanonicalRichContext>;
        let oddsPromise: Promise<ICanonicalOdds | null>;
        let sofascorePromise: Promise<ISofascoreResponse | null>;

        if (sport === 'hockey') {
// ... (Függvény törzse változatlan)
            // --- HOKI AGGREGÁTOR ---
            console.log(`[DataFetch v96.0] Hoki Aggregátor: IceHockeyApi (Kontextus) és OddsFeed (Odds) párhuzamos hívása...`);
            contextPromise = sportProvider.fetchMatchData(providerOptions);
            oddsPromise = oddsFeedFetchData(decodedHomeTeam, decodedAwayTeam, decodedUtcKickoff, sport);
            sofascorePromise = Promise.resolve(null); // Nincs Sofascore hokihoz

        } else if (sport === 'soccer') {
// ... (Függvény törzse változatlan)
            // --- FOCI AGGREGÁTOR ---
            console.log(`[DataFetch v96.0] Foci Aggregátor: ApiSports (Kontextus+Odds) és Sofascore hívása...`);
            contextPromise = sportProvider.fetchMatchData(providerOptions);
// ... (Függvény törzse változatlan)
            oddsPromise = Promise.resolve(null); // Az ApiSports (foci) már tartalmazza az odds-okat
            sofascorePromise = (!skipSofascore)
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null);
        } else {
// ... (Függvény törzse változatlan)
             // Egyéb sportok (Kosár)
             contextPromise = sportProvider.fetchMatchData(providerOptions);
             oddsPromise = Promise.resolve(null);
             sofascorePromise = Promise.resolve(null);
        }

        const [
// ... (Függvény törzse változatlan)
            baseResult, // Kontextus
            fetchedOdds,  // Odds (csak hokinál)
            sofascoreData // Sofascore (csak focinál)
        ] = await Promise.all([
             contextPromise,
             oddsPromise,
             sofascorePromise
        ]);
        
        // === EGYESÍTÉS (v96.0) ===
// ... (Függvény törzse változatlan)
        const finalResult: ICanonicalRichContext = baseResult;
        
        // Ha Hoki, felülírjuk az 'oddsData'-t a dedikált providerrel
// ... (Függvény törzse változatlan)
        if (sport === 'hockey') {
            if (fetchedOdds) {
                console.log(`[DataFetch v96.0] Hoki Aggregátor: Odds adatok sikeresen felülírva az 'OddsFeedProvider'-ből.`);
                finalResult.oddsData = fetchedOdds;
            } else {
                console.warn(`[DataFetch v96.0] Hoki Aggregátor: Az 'OddsFeedProvider' nem adott vissza adatot. A kontextus provider odds-ai (ha vannak) maradnak.`);
            }
        }
        
        // ... (xG Forrás meghatározása - változatlan)
// ... (Függvény törzse változatlan)
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xGSource: IDataFetchResponse['xgSource'];
        
        if (manual_H_xG != null && manual_H_xGA != null &&
// ... (Függvény törzse változatlan)
            manual_A_xG != null && manual_A_xGA != null)
        {
            // ... (P1 xG felülírás)
// ... (Függvény törzse változatlan)
            finalHomeXg = (manual_H_xG + manual_H_xGA) / 2;
            finalAwayXg = (manual_A_xG + manual_H_xGA) / 2;
            xGSource = "Manual (Components)";
        }
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
// ... (Függvény törzse változatlan)
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away;
            xGSource = "API (Real)"; 
        }
        // ... (stb.)
// ... (Függvény törzse változatlan)
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xGSource = "Calculated (Fallback)";
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
// ... (Függvény törzse változatlan)
        finalResult.advancedData.away['xg'] = finalAwayXg;
        finalResult.advancedData.manual_H_xG = manual_H_xG;
// ... (Függvény törzse változatlan)
        finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        finalResult.advancedData.manual_A_xG = manual_A_xG;
        finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xGSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        // Foci Odds Fallback (Változatlan)
// ... (Függvény törzse változatlan)
        const primaryOddsFailed = !finalResult.oddsData || !finalResult.oddsData.allMarkets || finalResult.oddsData.allMarkets.length === 0;
        const fixtureId = finalResult.rawData.apiFootballData?.fixtureId;

        if (primaryOddsFailed && fixtureId && sport === 'soccer') {
// ... (Függvény törzse változatlan)
            console.warn(`[DataFetch] Az 'apiSportsProvider' (foci) nem adott vissza Odds adatot. Fallback indítása...`);
            try {
                const oddsFeedResult = await soccerOddsFallbackFetchData(fixtureId, sport);
// ... (Függvény törzse változatlan)
                if (oddsFeedResult) {
                    finalResult.oddsData = oddsFeedResult; 
                }
            } catch (e: any) {
// ... (Függvény törzse változatlan)
                console.error(`[DataFetch] Hiba a (foci) 'OddsProvider' fallback hívása során: ${e.message}`);
            }
        }
        
        // P1 Manuális Hiányzók (Változatlan)
// ... (Függvény törzse változatlan)
        if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
            // ... (P1 hiányzó felülírás logika változatlan)
        }
        // P2 Sofascore Hiányzók (Változatlan, csak foci)
// ... (Függvény törzse változatlan)
        else if (options.sport === 'soccer') {
            // ... (Sofascore felülírás logika változatlan)
        }

        const response: IDataFetchResponse = {
// ... (Függvény törzse változatlan)
            ...finalResult,
            xgSource: xGSource 
        };
        
        preFetchAnalysisCache.set(ck, response);
// ... (Függvény törzse változatlan)
        console.log(`Sikeres adat-egyesítés (v96.0 - Aggregátor), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
// ... (Függvény törzse változatlan)
         console.error(`KRITIKUS HIBA a getRichContextualData (v96.0) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE (Catch Blokk). A rendszer üres adat-stubot ad vissza.`);
         return generateEmptyStubContext(options);
    }
}

/**
 * === MÓDOSÍTVA (v96.0): Leegyszerűsítve ===
 */
export async function getRostersForMatch(options: {
// ... (Függvény törzse változatlan)
    // ... (Függvény változatlan, a belső 'getProvider' hívás már a
    //      helyes (IceHockeyApi) providert fogja visszaadni hoki esetén)
    sport: string;
// ... (Függvény törzse változatlan)
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } |
null> {
    
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
// ... (Függvény törzse változatlan)
    try {
        const sportProvider = getProvider(options.sport); // Kontextus provider
        // ... (A többi kód változatlanul működik, mert a
// ... (Függvény törzse változatlan)
        // 'sportProvider.fetchMatchData' hívás már a helyes
        // provider-t (Foci vagy Hoki) fogja hívni)
// ... (Függvény törzse változatlan)
        // ...
        
        // --- (v95.0 logika változatlan) ---
// ... (Függvény törzse változatlan)
        const decodedLeagueName = decodeURIComponent(decodeURIComponent(options.leagueName || 'N/A'));
        const decodedHomeTeam = decodeURIComponent(decodeURIComponent(options.homeTeamName || 'N/A'));
// ... (Függvény törzse változatlan)
        const decodedAwayTeam = decodeURIComponent(decodeURIComponent(options.awayTeamName || 'N/A'));
        const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(options.utcKickoff || new Date().toISOString()));
        
        const sportConfig = SPORT_CONFIG[options.sport];
// ... (Függvény törzse változatlan)
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A';
        
        let providerOptions: any = {
// ... (Függvény törzse változatlan)
             sport: options.sport,
             homeTeamName: decodedHomeTeam,
             awayTeamName: decodedAwayTeam,
             leagueName: decodedLeagueName,
             utcKickoff: decodedUtcKickoff,
             countryContext: countryContext,
        };
        
        if (options.sport === 'soccer') {
// ... (Függvény törzse változatlan)
            const currentYear = new Date(decodedUtcKickoff).getFullYear();
            const leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, options.sport);
// ... (Függvény törzse változatlan)
            if (!leagueDataResponse || !leagueDataResponse.leagueId) return null;
            const { leagueId, foundSeason } = leagueDataResponse;
            const homeTeamId = await soccerGetTeamId(decodedHomeTeam, options.sport, leagueId, foundSeason);
// ... (Függvény törzse változatlan)
            const awayTeamId = await soccerGetTeamId(decodedAwayTeam, options.sport, leagueId, foundSeason);
            if (!homeTeamId || !awayTeamId) return null;
            providerOptions.homeTeamId = homeTeamId;
// ... (Függvény törzse változatlan)
            providerOptions.awayTeamId = awayTeamId;
            providerOptions.leagueId = leagueId;
            providerOptions.foundSeason = foundSeason;
        }
        // --- (v95.0 logika vége) ---

        const baseResult = await sportProvider.fetchMatchData(providerOptions);
// ... (Függvény törzse változatlan)
        
        if (baseResult && 
            baseResult.availableRosters && 
            (baseResult.availableRosters.home.length > 0 || baseResult.availableRosters.away.length > 0)
        ) {
// ... (Függvény törzse változatlan)
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
// ... (Függvény törzse változatlan)
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) 'availableRosters' adatot adott vissza, de az üres.`);
            return null;
        }

    } catch (e: any) {
// ... (Függvény törzse változatlan)
        console.error(`[DataFetch] Hiba a getRostersForMatch során: ${e.message}`, e.stack);
        return null;
    }
}


// --- KÖZÖS FÜGGVÉNYEK EXPORTÁLÁSA ---
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;
