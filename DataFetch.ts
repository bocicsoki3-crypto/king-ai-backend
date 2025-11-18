// FÁJL: DataFetch.ts
// VERZIÓ: v106.1 (Dátum Dekódolás Javítás)
// MÓDOSÍTÁS (v106.1):
// 1. JAVÍTVA: A 'generateEmptyStubContext' és a redundáns odds fallback hívásoknál
//    a nyers 'options.utcKickoff' helyett a 'decodedUtcKickoff'-ot használjuk.
// 2. OK: A logok alapján a dátum URL-kódolva érkezett ("...T19%3A45Z"),
//    ami miatt az odds provider nem találta a meccset. A dekódolás ezt megoldja.

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

import { runStep_TeamNameResolver } from './AI_Service.js';
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

/**************************************************************
* DataFetch.ts - Külső Adatgyűjtő Modul (Node.js Verzió)
* VERZIÓ: v106.1 (Dátum Dekódolás Javítás)
**************************************************************/

/**
 * === "Stub" Válasz Generátor ===
 * MÓDOSÍTVA (v106.1): Most már dekódolja a dátumot hívás előtt.
 */
async function generateEmptyStubContext(options: IDataFetchOptions): Promise<IDataFetchResponse> {
    const { sport, homeTeamName, awayTeamName, utcKickoff } = options;
    
    // === JAVÍTÁS (v106.1): Dátum dekódolása ===
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));
    // =========================================
    
    console.warn(`[DataFetch/generateEmptyStubContext] Visszaadok egy üres adatszerkezetet (${homeTeamName} vs ${awayTeamName}). Az elemzés P1 adatokra fog támaszkodni.`);
    
    let fallbackOdds: ICanonicalOdds | null = null;
    try {
        console.log(`[DataFetch/generateEmptyStubContext] P4 hiba. Név-alapú tartalék odds provider (v104.6) indítása (oddsFeedProvider.ts)...`);
        // Itt már a dekódolt dátumot adjuk át!
        fallbackOdds = await oddsFeedFetchData_NameBased(homeTeamName, awayTeamName, decodedUtcKickoff, sport);
        if (fallbackOdds) {
            console.log(`[DataFetch/generateEmptyStubContext] SIKER: A név-alapú provider (oddsFeedProvider.ts) talált oddsokat.`);
        } else {
            console.warn(`[DataFetch/generateEmptyStubContext] A név-alapú provider (oddsFeedProvider.ts) sem talált oddsokat.`);
        }
    } catch (e: any) {
        console.error(`[DataFetch/generateEmptyStubContext] Név-alapú provider (oddsFeedProvider.ts) hiba: ${e.message}`);
    }

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
    
    const defaultXG = (sport === 'basketball') ? 110 : (sport === 'hockey' ? 3.0 : 1.35);
    
    const result: ICanonicalRichContext = {
         rawStats: emptyRawData.stats,
         leagueAverages: {},
         richContext: "Figyelem: Az automatikus P4 API adatgyűjtés sikertelen. Az elemzés kizárólag a manuálisan megadott P1 adatokra támaszkodik.",
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
    
    let xgSource = "N/A (API Hiba)";
    if (options.manual_H_xG != null) {
        xgSource = "Manual (Components)";
    }
    
    return {
        ...result,
        xgSource: xgSource
    };
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
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v106.1)
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
    // === DÁTUM DEKÓDOLÁS ===
    const decodedUtcKickoff = decodeURIComponent(decodeURIComponent(utcKickoff || new Date().toISOString()));

    const teamNames = [decodedHomeTeam, decodedAwayTeam].sort();
    
    const p1AbsenteesHash = manual_absentees ?
        `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
        '';
        
    const ck = explicitMatchId || `rich_context_v104.3_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
    // === CACHE OLVASÁS ===
    if (!forceNew) {
        const cached = preFetchAnalysisCache.get<IDataFetchResponse>(ck);
        if (cached) {
            console.log(`Cache találat (${ck})`);
            
            const finalData = { ...cached };
            let xgSource: IDataFetchResponse['xgSource'] = cached.xgSource || 'Calculated (Fallback)';

            if (manual_H_xG != null && manual_H_xGA != null && manual_A_xG != null && manual_A_xGA != null) {
                finalData.advancedData.manual_H_xG = manual_H_xG;
                finalData.advancedData.manual_H_xGA = manual_H_xGA;
                finalData.advancedData.manual_A_xG = manual_A_xG;
                finalData.advancedData.manual_A_xGA = manual_A_xGA;
                xgSource = "Manual (Components)"; 
            }
            
            if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
                const mapManualToCanonical = (playerStub: { name: string, pos: string }): ICanonicalPlayer => ({
                    name: playerStub.name,
                    role: getRoleFromPos(playerStub.pos), 
                    importance: 'key', 
                    status: 'confirmed_out',
                    rating_last_5: 7.5
                });
                if (!finalData.rawData.detailedPlayerStats) {
                     finalData.rawData.detailedPlayerStats = { home_absentees: [], away_absentees: [], key_players_ratings: { home: {}, away: {} } };
                }
                if (!finalData.rawData.absentees) {
                    finalData.rawData.absentees = { home: [], away: [] };
                }
                
                finalData.rawData.detailedPlayerStats.home_absentees = manual_absentees.home.map(mapManualToCanonical);
                finalData.rawData.detailedPlayerStats.away_absentees = manual_absentees.away.map(mapManualToCanonical);
                finalData.rawData.absentees.home = finalData.rawData.detailedPlayerStats.home_absentees;
                finalData.rawData.absentees.away = finalData.rawData.detailedPlayerStats.away_absentees;
            }

            return { ...finalData, fromCache: true, xgSource: xgSource };
        }
    }
    // === CACHE OLVASÁS VÉGE ===

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const apiConfig = API_HOSTS[sport];
        if ((sport === 'soccer' || sport === 'basketball') && (!apiConfig || !apiConfig.keys || apiConfig.keys.length === 0)) {
            console.warn(`[DataFetch] FIGYELMEZTETÉS: Nincsenek API kulcsok definiálva a(z) '${sport}' sporthoz a config.ts API_HOSTS térképében.`);
        }

        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        if (sport === 'soccer' && countryContext === 'N/A') {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        
        let leagueId: number | null = null;
        let foundSeason: number | null = null;
        let homeTeamId: number | null = null;
        let awayTeamId: number | null = null;
        const originSeason = (new Date(decodedUtcKickoff).getMonth() < 7) ? new Date(decodedUtcKickoff).getFullYear() - 1 : new Date(decodedUtcKickoff).getFullYear();

        // --- CSAK A FOCI HASZNÁL ID-KERESÉST ---
        if (sport === 'soccer') {
            console.log(`[DataFetch v104.3] 'api-sports' (Foci) ID keresés indul...`);
            
            const leagueDataResponse = await getApiSportsLeagueId(decodedLeagueName, countryContext, new Date(decodedUtcKickoff).getFullYear(), sport);
            
            if (!leagueDataResponse || !leagueDataResponse.leagueId) {
                 console.error(`[DataFetch] KRITIKUS P4 HIBA: Végleg nem sikerült a 'leagueId' azonosítása ('${decodedLeagueName}' néven).`);
                 console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
                 return await generateEmptyStubContext(options);
            }
            
            leagueId = leagueDataResponse.leagueId;
            foundSeason = leagueDataResponse.foundSeason;

            homeTeamId = await getApiSportsTeamId(decodedHomeTeam, sport, leagueId, originSeason);
            awayTeamId = await getApiSportsTeamId(decodedAwayTeam, sport, leagueId, originSeason);
            
            if (!homeTeamId || !awayTeamId) {
                console.warn(`[DataFetch] Statikus névfeloldás sikertelen (H:${homeTeamId}, A:${awayTeamId}). AI Fallback indítása (8. Ügynök)...`);
                
                const leagueRoster = await _getLeagueRoster(leagueId, foundSeason, sport);
                const rosterStubs = leagueRoster.map(item => ({ id: item.team.id, name: item.team.name }));
                
                if (!homeTeamId) {
                    const result = await runStep_TeamNameResolver({ inputName: decodedHomeTeam, searchTerm: decodedHomeTeam.toLowerCase().trim(), rosterJson: rosterStubs });
                    if (result) homeTeamId = result;
                }
                if (!awayTeamId) {
                    const result = await runStep_TeamNameResolver({ inputName: decodedAwayTeam, searchTerm: decodedAwayTeam.toLowerCase().trim(), rosterJson: rosterStubs });
                    if (result) awayTeamId = result;
                }
            }
            
            if (!homeTeamId || !awayTeamId) {
                console.error(`[DataFetch] KRITIKUS P4 HIBA (Foci): A csapat azonosítókat nem sikerült feloldani. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}.`);
                console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
                return await generateEmptyStubContext(options);
            }

        } else if (sport === 'hockey' || sport === 'basketball') {
            console.log(`[DataFetch v104.3] Név/Dátum alapú keresés indul (Sport: ${sport}). Az ID-keresés kihagyva.`);
        }


        // 6. LÉPÉS: Adatgyűjtés
        const providerOptions = {
            sport: sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff, // DEKÓDOLT DÁTUM HASZNÁLATA
            countryContext: countryContext,
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId, 
            leagueId: leagueId,     
            foundSeason: foundSeason,
            apiConfig: apiConfig
        };
        
        const skipSofascore = (options.manual_H_xG != null);
        const [
            baseResult, 
            sofascoreData 
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            (sport === 'soccer' && !skipSofascore)
                ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) 
                : Promise.resolve(null)
        ]);
        
        const finalResult: IDataFetchResponse = baseResult;
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: IDataFetchResponse['xgSource'] = finalResult.xgSource;
        
        if (manual_H_xG != null && manual_H_xGA != null &&
            manual_A_xG != null && manual_A_xGA != null)
        {
            finalResult.advancedData.manual_H_xG = manual_H_xG;
            finalResult.advancedData.manual_H_xGA = manual_H_xGA;
            finalResult.advancedData.manual_A_xG = manual_A_xG;
            finalResult.advancedData.manual_A_xGA = manual_A_xGA;
            finalHomeXg = (manual_H_xG + manual_A_xGA) / 2;
            finalAwayXg = (manual_A_xG + manual_H_xGA) / 2;
            xgSource = "Manual (Components)";
        }
        else if (sofascoreData?.advancedData?.xg_home != null && sofascoreData?.advancedData?.xG_away != null) {
            finalHomeXg = sofascoreData.advancedData.xg_home;
            finalAwayXg = sofascoreData.advancedData.xG_away;
            xgSource = "API (Real - Sofascore)";
        }
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = `API (Real - ${sportProvider.providerName})`;
        }
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xgSource = "Calculated (Fallback)";
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        finalResult.xgSource = xgSource;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        // === MÓDOSÍTÁS (v106.1): REDUNDÁNS ODDS FALLBACK JAVÍTÁS ===
        const primaryOddsFailed = !finalResult.oddsData || 
                                  !finalResult.oddsData.allMarkets || 
                                  finalResult.oddsData.allMarkets.length === 0;
        
        if (primaryOddsFailed && (sport === 'soccer' || sport === 'hockey' || sport === 'basketball')) {
            console.warn(`[DataFetch v104.6] Az alap provider (${sportProvider.providerName}) nem adott vissza Odds adatot. Fallback indítása az 'oddsFeedProvider.ts' [38] funkcióra...`);
            
            try {
                // Itt is a dekódolt dátumot használjuk!
                const oddsFeedResult = await oddsFeedFetchData_NameBased(
                    decodedHomeTeam, 
                    decodedAwayTeam, 
                    decodedUtcKickoff, 
                    sport
                );
                
                if (oddsFeedResult) {
                    console.log(`[DataFetch v104.6] SIKER. Az 'oddsFeedProvider.ts' megbízható odds adatokat adott vissza.`);
                    finalResult.oddsData = oddsFeedResult; 
                } else {
                    console.warn(`[DataFetch v104.6] A 'fetchOddsData' (fallback) sem adott vissza adatot ehhez: ${decodedHomeTeam} vs ${decodedAwayTeam}.`);
                }
            } catch (e: any) {
                console.error(`[DataFetch v104.6] Kritikus hiba az 'oddsFeedProvider.ts' fallback hívása során: ${e.message}`);
            }
        } else if (!primaryOddsFailed) {
            console.log(`[DataFetch v104.6] Az alap provider (${sportProvider.providerName}) sikeresen adott vissza Odds adatot. Fallback kihagyva.`);
        }
        // === MÓDOSÍTÁS VÉGE ===

        
        // 2. HIÁNYZÓK PRIORITÁSI LÁNC
        if (manual_absentees && (manual_absentees.home.length > 0 || manual_absentees.away.length > 0)) {
            console.log(`[DataFetch] Felülírás (P1): Manuális hiányzók alkalmazva. (H: ${manual_absentees.home.length}, A: ${manual_absentees.away.length}). Automatikus lekérés (Sofascore/apiSports) kihagyva.`);
            
            const mapManualToCanonical = (playerStub: { name: string, pos: string }): ICanonicalPlayer => ({
                name: playerStub.name,
                role: getRoleFromPos(playerStub.pos),
                importance: 'key', 
                status: 'confirmed_out',
                rating_last_5: 7.5
            });

            finalResult.rawData.detailedPlayerStats = {
                home_absentees: manual_absentees.home.map(mapManualToCanonical),
                away_absentees: manual_absentees.away.map(mapManualToCanonical),
                key_players_ratings: { home: {}, away: {} } 
            };
            finalResult.rawData.absentees = {
                home: finalResult.rawData.detailedPlayerStats.home_absentees,
                away: finalResult.rawData.detailedPlayerStats.away_absentees
            };
        }
        else if (options.sport === 'soccer') {
            const hasValidSofascoreData = (data: ISofascoreResponse | null): data is (ISofascoreResponse & { playerStats: ICanonicalPlayerStats }) => {
                return !!data && 
                       !!data.playerStats && 
                       (data.playerStats.home_absentees.length > 0 || 
                        data.playerStats.away_absentees.length > 0 ||
                        Object.keys(data.playerStats.key_players_ratings.home).length > 0);
            };

            if (hasValidSofascoreData(sofascoreData)) {
                console.log(`[DataFetch] Felülírás (P2): Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival (Hiányzók: ${sofascoreData.playerStats.home_absentees.length}H / ${sofascoreData.playerStats.away_absentees.length}A).`);
                finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
                finalResult.rawData.absentees = {
                    home: sofascoreData.playerStats.home_absentees,
                    away: sofascoreData.playerStats.away_absentees
                };
            } else {
                console.warn(`[DataFetch] Figyelmeztetés: A Sofascore (P2) nem adott vissza hiányzó-adatot. Az 'apiSportsProvider' (P4) adatai maradnak érvényben.`);
            }
        }

        preFetchAnalysisCache.set(ck, finalResult);
        console.log(`Sikeres adat-egyesítés (v104.3), cache mentve (${ck}).`);
        return { ...finalResult, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v104.3) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE (Catch Blokk). A rendszer üres adat-stubot ad vissza.`);
         return await generateEmptyStubContext(options);
    }
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
