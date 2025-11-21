// FÁJL: DataFetch.ts
// VERZIÓ: v117.0 (Market Spy Integration)
// MÓDOSÍTÁS (v117.0):
// 1. ADATÁTADÁS: A Deep Scout 'market_movement' mezőjét beépíti
//    a 'richContext'-be, így a Főnök látni fogja a piaci mozgást
//    akkor is, ha az API nem adott nyitó oddsokat.

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
    const defaultStats: ICanonicalStats = { gp: 5, gf: 0, ga: 0, form: null };
    
    if (!statsStr || statsStr === 'N/A') return defaultStats;
    
    const wins = (statsStr.match(/W/gi) || []).length;
    const draws = (statsStr.match(/D/gi) || []).length;
    const losses = (statsStr.match(/L/gi) || []).length;
    const gp = wins + draws + losses;
    
    if (gp === 0) return defaultStats;
    
    // Heurisztika a gólokhoz
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
 */
async function generateEmptyStubContext(options: IDataFetchOptions): Promise<IDataFetchResponse> {
    const { sport, homeTeamName, awayTeamName, utcKickoff } = options;
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));
    
    console.warn(`[DataFetch/generateEmptyStubContext] API Hiba. Váltás AI WEB KERESÉSRE (${homeTeamName} vs ${awayTeamName})...`);
    
    let fallbackOdds = await fetchOddsViaWebSearch(homeTeamName, awayTeamName, sport);
    if (!fallbackOdds) {
        try {
            fallbackOdds = await oddsFeedFetchData_NameBased(homeTeamName, awayTeamName, decodedUtcKickoff, sport);
        } catch (e) { /* ignore */ }
    }
    
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
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v113.0 - AI FIRST + STRUCTURAL HARVEST)
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
        
    const ck = explicitMatchId || `rich_context_v117.0_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    // === CACHE OLVASÁS ===
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            return { ...cached, fromCache: true };
        }
    }
    // === CACHE OLVASÁS VÉGE ===

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    
    // === LÉPÉS 1: AI DEEP SCOUT (v117.0 - MARKET SPY) ===
    const deepScoutResult = await runStep_DeepScout({
        home: decodedHomeTeam,
        away: decodedAwayTeam,
        sport: sport
    });
    
    // === MÓDOSÍTÁS v117.0: Piaci Hírszerzés Beépítése ===
    const transferredPlayers = deepScoutResult?.transferred_players?.join(', ') || 'Nincs jelentett eligazolás';
    const marketIntel = deepScoutResult?.market_movement || 'Nincs AI piaci adat';
    
    const deepContextString = deepScoutResult 
        ? `[DEEP SCOUT JELENTÉS (v117.0)]:
        - Összefoglaló: ${deepScoutResult.narrative_summary}
        - PIACI HÍRSZERZÉS: ${marketIntel}
        - ELIGAZOLT JÁTÉKOSOK: ${transferredPlayers}
        - Fizikai Állapot: ${deepScoutResult.physical_factor}
        - Pszichológia: ${deepScoutResult.psychological_factor}
        - Időjárás/Pálya: ${deepScoutResult.weather_context}
        - Bírói Info: ${deepScoutResult.referee_context || 'Nincs specifikus adat'} 
        - Taktikai Hírek: ${deepScoutResult.tactical_leaks || 'Nincsenek pletykák'}
        - Hírek: ${deepScoutResult.key_news?.join('; ')}` 
        : "A Deep Scout nem talált adatot.";
    // ==========================================================

    // === LÉPÉS 2: API LEKÉRÉS (A "PLAN B") ===
    let finalResult: IDataFetchResponse;
    let xgSource = "Calculated (Fallback)";

    try {
        const sportProvider = getProvider(sport);
        console.log(`API Adatgyűjtés indul (Provider: ${sportProvider.providerName})...`);

        const apiConfig = API_HOSTS[sport];
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        // ID Keresés és Provider hívás (ugyanaz, mint v110.4)
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
                
                // Fallback ID keresés 8. ügynökkel
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
            countryContext, countryContext, homeTeamId, homeTeamId, awayTeamId, awayTeamId, leagueId, foundSeason, apiConfig
        };
        
        const [baseResult, sofascoreData] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            (sport === 'soccer' && manual_H_xG == null) ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) : Promise.resolve(null)
        ]);
        
        finalResult = baseResult;
        
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

    // === LÉPÉS 3: EGYESÍTÉS ÉS KITÖLTÉS (DEEP SCOUT v3) ===
    
    // 1. Context egyesítése
    const apiContext = finalResult.richContext !== "N/A" ? finalResult.richContext : "";
    finalResult.richContext = `${deepContextString}\n\n[API ADATOK]:\n${apiContext}`;
    
    // === MÓDOSÍTÁS v115.0: A Deep Scout adatait behúzzuk a 'rawData' objektumba is ===
    if (deepScoutResult) {
        if (deepScoutResult.referee_context && (!finalResult.rawData.referee.name || finalResult.rawData.referee.name === "N/A")) {
            finalResult.rawData.referee.name = deepScoutResult.referee_context;
            finalResult.rawData.referee.style = deepScoutResult.referee_context;
        }
        
        if (deepScoutResult.tactical_leaks) {
            finalResult.rawData.contextual_factors.match_tension_index = 
                (finalResult.rawData.contextual_factors.match_tension_index || "") + 
                ` | Taktikai Hír: ${deepScoutResult.tactical_leaks}`;
        }

        // === GHOST PLAYER FILTER (v116.0) ===
        if (deepScoutResult.transferred_players && Array.isArray(deepScoutResult.transferred_players) && deepScoutResult.transferred_players.length > 0) {
            const transferredSet = new Set(deepScoutResult.transferred_players.map((n: string) => n.toLowerCase().trim()));
            
            const filterRoster = (roster: IPlayerStub[]) => {
                return roster.filter(player => {
                    const isTransferred = transferredSet.has(player.name.toLowerCase().trim());
                    if (isTransferred) {
                        console.log(`[DataFetch v116.0] GHOST PLAYER ELTÁVOLÍTVA: ${player.name}`);
                    }
                    return !isTransferred;
                });
            };
            
            finalResult.availableRosters.home = filterRoster(finalResult.availableRosters.home);
            finalResult.availableRosters.away = filterRoster(finalResult.availableRosters.away);
            
            if (finalResult.rawData.key_players) {
                // @ts-ignore
                if (finalResult.rawData.key_players.home) finalResult.rawData.key_players.home = filterRoster(finalResult.rawData.key_players.home);
                // @ts-ignore
                if (finalResult.rawData.key_players.away) finalResult.rawData.key_players.away = filterRoster(finalResult.rawData.key_players.away);
            }
        }
    }
    
    // 2. Statisztikai Fallback
    if (finalResult.rawStats.home.gp <= 1 && deepScoutResult?.stats_fallback) {
        console.log(`[DataFetch] API statisztika hiányos. Deep Scout fallback alkalmazása...`);
        finalResult.rawStats.home = parseAiStats(deepScoutResult.stats_fallback.home_last_5);
        finalResult.rawStats.away = parseAiStats(deepScoutResult.stats_fallback.away_last_5);
    }
    
    // === ÚJ: Strukturált Adatok Betöltése (v113.0) ===
    if (deepScoutResult?.structured_data) {
        const aiData = deepScoutResult.structured_data;

        if (!finalResult.rawData.h2h_structured || finalResult.rawData.h2h_structured.length === 0) {
            if (aiData.h2h && Array.isArray(aiData.h2h)) {
                console.log(`[DataFetch v113.0] API H2H hiányzik -> AI H2H betöltve (${aiData.h2h.length} db).`);
                finalResult.rawData.h2h_structured = aiData.h2h;
            }
        }
        
        if (!finalResult.form.home_overall && aiData.form_last_5?.home) {
            finalResult.form.home_overall = aiData.form_last_5.home;
            console.log(`[DataFetch v113.0] API Forma hiányzik -> AI Forma betöltve.`);
        }
        if (!finalResult.form.away_overall && aiData.form_last_5?.away) {
            finalResult.form.away_overall = aiData.form_last_5.away;
        }

        const hasApiRoster = finalResult.availableRosters.home.length > 0;
        if (!hasApiRoster && aiData.probable_lineups) {
             console.log(`[DataFetch v113.0] API Keret hiányzik -> AI Lineups betöltve.`);
             const mapToStub = (name: string): IPlayerStub => ({ id: 0, name: name, pos: 'N/A', rating_last_5: 7.5 });
             
             if (aiData.probable_lineups.home) {
                 finalResult.availableRosters.home = aiData.probable_lineups.home.map(mapToStub);
             }
             if (aiData.probable_lineups.away) {
                 finalResult.availableRosters.away = aiData.probable_lineups.away.map(mapToStub);
             }
        }
    }

    // 3. xG Adatok
    if (manual_H_xG != null) {
        finalResult.advancedData.manual_H_xG = manual_H_xG;
        finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        finalResult.advancedData.manual_A_xG = manual_A_xG;
        finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        xgSource = "Manual (Components)";
    }
    else if (deepScoutResult?.xg_stats && deepScoutResult.xg_stats.home_xg != null) {
        console.log(`[DataFetch] AI Deep Scout talált xG adatokat!`);
        finalResult.advancedData.manual_H_xG = deepScoutResult.xg_stats.home_xg;
        finalResult.advancedData.manual_H_xGA = deepScoutResult.xg_stats.home_xga;
        finalResult.advancedData.manual_A_xG = deepScoutResult.xg_stats.away_xg;
        finalResult.advancedData.manual_A_xGA = deepScoutResult.xg_stats.away_xga;
        xgSource = `AI Deep Scout (${deepScoutResult.xg_stats.source || 'Web'})`;
    }
    
    finalResult.xgSource = xgSource;

    // Odds Fallback
    const primaryOddsFailed = !finalResult.oddsData || !finalResult.oddsData.allMarkets || finalResult.oddsData.allMarkets.length === 0;
    if (primaryOddsFailed) {
        console.warn(`[DataFetch] API Odds hiányzik. AI Web Search indítása...`);
        const aiOdds = await fetchOddsViaWebSearch(decodedHomeTeam, decodedAwayTeam, sport);
        if (aiOdds) finalResult.oddsData = aiOdds;
    }

    preFetchAnalysisCache.set(ck, finalResult);
    console.log(`Sikeres adat-egyesítés (v117.0 Market Spy), cache mentve (${ck}).`);
    return { ...finalResult, fromCache: false };
}

export async function getRostersForMatch(options: {
    sport: string;
    homeTeamName: string; 
    awayTeamName: string; 
    leagueName: string;
    utcKickoff: string;   
}): Promise<{ home: IPlayerStub[], away: IPlayerStub[] } |
null> {
    console.log(`[DataFetch] Könnyített keret-lekérés indul: ${options.homeTeamName} vs ${options.awayTeamName}`);
    // ... (A roster lekérő kód változatlan, de most már a fő ág is képes AI fallbacket használni)
    // A v110.4-es verzió kódja itt megmarad...
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

export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
export const _callGeminiWithJsonRetry = commonCallGeminiWithJsonRetry;
