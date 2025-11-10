// FÁJL: DataFetch.ts
// VERZIÓ: v94.2 ("Argumentum Javítás")
// MÓDOSÍTÁS (v94.2):
// 1. OK: A v94.1-es verzió hibásan 5 argumentumot (TS2554) adott át
//    a 'soccerGetTeamId' és 'hockeyGetTeamId' függvényeknek.
// 2. JAVÍTVA: A `getRichContextualData` (kb. 290. sor) és a `getRostersForMatch`
//    (kb. 530. sor) függvényekben a 'getApiSportsTeamId' hívások javítva
//    a helyes, 4-argumentumos aláírásra.
// 3. JAVÍTVA: A felesleges `leagueRosterData` lekérések (amelyek az 5.
//    argumentumhoz kellettek) eltávolítva a hívások elől.
// 4. A (v94.1) import- és elágazási logikája (ami a 'BTTS' hibát hivatott
//    javítani) érintetlen marad.

import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import path from 'path';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather } from './src/types/canonical.d.ts';
// --- MÓDOSÍTÁS (v94.1): Helyes importok ---
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries, 
    _getLeagueRoster as soccerGetLeagueRoster,
    getApiSportsTeamId as soccerGetTeamId,
    getApiSportsLeagueId as soccerGetLeagueId
} from './providers/apiSportsProvider.js';

// JAVÍTVA: 'import * as ...' a 'default' helyett
import * as hockeyProvider from './providers/newHockeyProvider.js';
// JAVÍTVA: Helyesen importáljuk az exportált függvényeket
import {
    _getLeagueRoster as hockeyGetLeagueRoster,
    getApiSportsTeamId as hockeyGetTeamId,
    getApiSportsLeagueId as hockeyGetLeagueId // Ez most már létezik (v74.1)
} from './providers/newHockeyProvider.js';

// JAVÍTVA: 'import * as ...' a 'default' helyett
import * as basketballProvider from './providers/newBasketballProvider.js';
// --- MÓDOSÍTÁS VÉGE ---

import { fetchSofascoreData, type ISofascoreResponse } from './providers/sofascoreProvider.js';
import { fetchOddsData as oddsFeedFetchData } from './providers/oddsProvider.js';
import { runStep_TeamNameResolver } from './AI_Service.js';
import { SPORT_CONFIG } from './config.js';
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures,
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry
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
* VERZIÓ: v94.2 (Argumentum Javítás)
**************************************************************/

function generateEmptyStubContext(options: IDataFetchOptions): IDataFetchResponse {
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

// === JAVÍTVA (v94.1): A '.default' hivatkozások eltávolítva ===
function getProvider(sport: string): IDataProvider {
  switch (sport.toLowerCase()) {
    case 'soccer':
      return apiSportsProvider;
    case 'hockey':
      return hockeyProvider; // JAVÍTVA
    case 'basketball':
      return basketballProvider; // JAVÍTVA
    default:
      throw new Error(`Nem támogatott sportág: '${sport}'. Nincs implementált provider.`);
  }
}

function getRoleFromPos(pos: string): CanonicalRole {
    const p = pos.toUpperCase();
    if (p === 'G') return 'Kapus';
    if (p === 'D') return 'Védő';
    if (p === 'M') return 'Középpályás';
    if (p === 'F') return 'Támadó';
    return 'Ismeretlen';
}

/**
 * FŐ ADATGYŰJTŐ FÜGGVÉNY (v94.2)
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
        
    const ck = explicitMatchId || `rich_context_v62.1_roster_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}${p1AbsenteesHash}`;
    
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
                finalData.rawData.detailedPlayerStats.home_absentees = manual_absentees.home.map(mapManualToCanonical);
                finalData.rawData.detailedPlayerStats.away_absentees = manual_absentees.away.map(mapManualToCanonical);
                finalData.rawData.absentees.home = finalData.rawData.detailedPlayerStats.home_absentees;
                finalData.rawData.absentees.away = finalData.rawData.detailedPlayerStats.away_absentees;
            }

            return { ...finalData, fromCache: true, xgSource: xgSource };
        }
    }

    console.log(`Nincs cache (vagy kényszerítve) (${ck}), friss adatok lekérése...`);
    try {
        
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${decodedHomeTeam} vs ${decodedAwayTeam}...`);

        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A'; 
        
        if (sport === 'soccer' && countryContext === 'N/A') {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${decodedLeagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        
        // --- MÓDOSÍTÁS (v94.1): Sportág-specifikus ID keresők ---
        let leagueDataResponse: { leagueId: number | null, foundSeason: number } | null = null;
        let homeTeamId: number | null = null;
        let awayTeamId: number | null = null;
        
        const currentYear = new Date(decodedUtcKickoff).getFullYear();

        if (sport === 'hockey') {
            console.log("[DataFetch v94.2] Hoki-specifikus ID kereső hívása...");
            leagueDataResponse = await hockeyGetLeagueId(decodedLeagueName, countryContext, currentYear, sport);
        } else {
            console.log("[DataFetch v94.2] Foci-specifikus (soccerGetLeagueId) ID kereső hívása...");
            leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, sport);
        }

        if (!leagueDataResponse || !leagueDataResponse.leagueId) {
             console.error(`[DataFetch] KRITIKUS P4 HIBA: Végleg nem sikerült a 'leagueId' azonosítása ('${decodedLeagueName}' néven).`);
             console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
             return generateEmptyStubContext(options);
        }
        
        const { leagueId, foundSeason } = leagueDataResponse;

        // 2. LÉPÉS: Csapat ID-k lekérése (Sportág-specifikus)
        // === JAVÍTÁS (v94.2): Az 5. argumentum ('leagueRosterData') eltávolítva a hívásokból ===
        // A 'getApiSportsTeamId' függvények (mindkét providerben) maguk hívják a '_getLeagueRoster'-t.
        if (sport === 'hockey') {
             console.log("[DataFetch v94.2] Hoki-specifikus (hockeyGetTeamId) ID kereső hívása (4 argumentummal)...");
             homeTeamId = await hockeyGetTeamId(decodedHomeTeam, sport, leagueId, foundSeason);
             awayTeamId = await hockeyGetTeamId(decodedAwayTeam, sport, leagueId, foundSeason);
        } else {
             console.log("[DataFetch v94.2] Foci-specifikus (soccerGetTeamId) ID kereső hívása (4 argumentummal)...");
             homeTeamId = await soccerGetTeamId(decodedHomeTeam, sport, leagueId, foundSeason);
             awayTeamId = await soccerGetTeamId(decodedAwayTeam, sport, leagueId, foundSeason);
            
            // AI Fallback (Csak Focihoz)
            if (sport === 'soccer' && (!homeTeamId || !awayTeamId)) {
                console.warn(`[DataFetch] Statikus névfeloldás sikertelen (H:${homeTeamId}, A:${awayTeamId}). AI Fallback indítása (8. Ügynök)...`);
                const leagueRoster = await soccerGetLeagueRoster(leagueId, foundSeason, sport);
                const rosterStubs = leagueRoster.map(item => ({ id: item.team.id, name: item.team.name }));
                
                if (!homeTeamId) {
                    const result = await runStep_TeamNameResolver({
                        inputName: decodedHomeTeam,
                        searchTerm: decodedHomeTeam.toLowerCase().trim(),
                        rosterJson: rosterStubs 
                    });
                    if (result) {
                        homeTeamId = result;
                        console.log(`[DataFetch] AI SIKER: Hazai csapat azonosítva (ID: ${homeTeamId}).`);
                    }
                }
                if (!awayTeamId) {
                    const result = await runStep_TeamNameResolver({
                        inputName: decodedAwayTeam,
                        searchTerm: decodedAwayTeam.toLowerCase().trim(),
                        rosterJson: rosterStubs 
                    });
                    if (result) {
                        awayTeamId = result;
                        console.log(`[DataFetch] AI SIKER: Vendég csapat azonosítva (ID: ${awayTeamId}).`);
                    }
                }
            }
        }
        // --- MÓDOSÍTÁS VÉGE (v94.2) ---

        // 3. LÉPÉS: Ellenőrzés
        if (!homeTeamId || !awayTeamId) {
            console.error(`[DataFetch] KRITIKUS P4 HIBA: A csapat azonosítókat nem sikerült feloldani. HomeID: ${homeTeamId}, AwayID: ${awayTeamId}.`);
            console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE. A rendszer üres adat-stubot ad vissza.`);
            return generateEmptyStubContext(options);
        }

        // 4. LÉPÉS: Adatgyűjtés a már azonosított ID-kkal
        const providerOptions = {
            sport: sport,
            homeTeamName: decodedHomeTeam,
            awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName,
            utcKickoff: decodedUtcKickoff,
            countryContext: countryContext,
            homeTeamId: homeTeamId, 
            awayTeamId: awayTeamId,
            leagueId: leagueId,
            foundSeason: foundSeason
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
        
        // === EGYESÍTÉS ===
        const finalResult: ICanonicalRichContext = baseResult;
        let finalHomeXg: number | null = null;
        let finalAwayXg: number | null = null;
        let xgSource: IDataFetchResponse['xgSource'];
        
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
            xgSource = "API (Real)"; 
        }
        else if (baseResult?.advancedData?.home?.xg != null && baseResult?.advancedData?.away?.xg != null) {
            finalHomeXg = baseResult.advancedData.home.xg;
            finalAwayXg = baseResult.advancedData.away.xg;
            xgSource = "API (Real)";
        }
        else {
            finalHomeXg = null;
            finalAwayXg = null;
            xgSource = "Calculated (Fallback)";
        }
        
        finalResult.advancedData.home['xg'] = finalHomeXg;
        finalResult.advancedData.away['xg'] = finalAwayXg;
        
        console.log(`[DataFetch] xG Forrás meghatározva: ${xgSource}. (H:${finalHomeXg ?? 'N/A'}, A:${finalAwayXg ?? 'N/A'})`);

        const primaryOddsFailed = !finalResult.oddsData || 
                                  !finalResult.oddsData.allMarkets || 
                                  finalResult.oddsData.allMarkets.length === 0;
        
        const fixtureId = finalResult.rawData.apiFootballData?.fixtureId;

        if (primaryOddsFailed && fixtureId && sport === 'soccer') {
            console.warn(`[DataFetch] Az 'apiSportsProvider' nem adott vissza Odds adatot. Fallback indítása az 'OddsProvider'-re (FixtureID: ${fixtureId})...`);
            
            try {
                const oddsFeedResult = await oddsFeedFetchData(fixtureId, sport);
                
                if (oddsFeedResult) {
                    console.log(`[DataFetch] SIKER. Az 'OddsProvider' megbízható odds adatokat adott vissza.`);
                    finalResult.oddsData = oddsFeedResult; 
                } else {
                    console.warn(`[DataFetch] A 'fallback' ('OddsProvider') sem adott vissza adatot a ${fixtureId} ID-hoz.`);
                }
            } catch (e: any) {
                console.error(`[DataFetch] Kritikus hiba az 'OddsProvider' fallback hívása során: ${e.message}`);
            }
        } else if (!primaryOddsFailed) {
            console.log(`[DataFetch] Az 'apiSportsProvider' sikeresen adott vissza Odds adatot. Fallback kihagyva.`);
        }
        
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

        const response: IDataFetchResponse = {
            ...finalResult,
            xgSource: xgSource 
        };
        
        preFetchAnalysisCache.set(ck, response);
        console.log(`Sikeres adat-egyesítés (v94.2), cache mentve (${ck}).`);
        return { ...response, fromCache: false };
        
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v94.2) során (${decodedHomeTeam} vs ${decodedAwayTeam}): ${e.message}`, e.stack);
         console.warn(`[DataFetch] TISZTA P1 MÓD KÉNYSZERÍTVE (Catch Blokk). A rendszer üres adat-stubot ad vissza.`);
         return generateEmptyStubContext(options);
    }
}

/**
 * === MÓDOSÍTVA (v94.2): Sportág-specifikus ID keresők ===
 */
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
        const leagueData = sportConfig?.espn_leagues[decodedLeagueName];
        const countryContext = leagueData?.country || 'N/A';
        
        // --- MÓDOSÍTÁS (v94.1): Sportág-specifikus ID keresők ---
        let leagueDataResponse: { leagueId: number | null, foundSeason: number } | null = null;
        let homeTeamId: number | null = null;
        let awayTeamId: number | null = null;
        
        const currentYear = new Date(decodedUtcKickoff).getFullYear();

        if (options.sport === 'hockey') {
            leagueDataResponse = await hockeyGetLeagueId(decodedLeagueName, countryContext, currentYear, options.sport);
        } else {
            leagueDataResponse = await soccerGetLeagueId(decodedLeagueName, countryContext, currentYear, options.sport);
        }

        if (!leagueDataResponse || !leagueDataResponse.leagueId) {
             console.warn(`[DataFetch] Nem sikerült a liga ID azonosítása a keret lekéréséhez.`);
             return null;
        }
        const { leagueId, foundSeason } = leagueDataResponse;
        
        // === JAVÍTÁS (v94.2): Az 5. argumentum eltávolítva ===
        if (options.sport === 'hockey') {
             homeTeamId = await hockeyGetTeamId(decodedHomeTeam, options.sport, leagueId, foundSeason);
             awayTeamId = await hockeyGetTeamId(decodedAwayTeam, options.sport, leagueId, foundSeason);
        } else {
             homeTeamId = await soccerGetTeamId(decodedHomeTeam, options.sport, leagueId, foundSeason);
             awayTeamId = await soccerGetTeamId(decodedAwayTeam, options.sport, leagueId, foundSeason);
        }
        // --- MÓDOSÍTÁS VÉGE (v94.2) ---
        
        if (!homeTeamId || !awayTeamId) {
             console.warn(`[DataFetch] Csapat ID hiányzik a keret lekéréséhez. (HomeID: ${homeTeamId}, AwayID: ${awayTeamId}).`);
             return null;
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
            foundSeason: foundSeason
        };

        const baseResult = await sportProvider.fetchMatchData(providerOptions);
        
        if (baseResult && 
            baseResult.availableRosters && 
            (baseResult.availableRosters.home.length > 0 || baseResult.availableRosters.away.length > 0)
        ) {
            console.log(`[DataFetch] Keret-lekérés sikeres. (H: ${baseResult.availableRosters.home.length}, A: ${baseResult.availableRosters.away.length})`);
            return baseResult.availableRosters;
        } else {
            console.warn(`[DataFetch] A sport provider (${sportProvider.providerName}) 'availableRosters' adatot adott vissza, de az üres (H: ${baseResult?.availableRosters?.home?.length ?? 'N/A'}, A: ${baseResult?.availableRosters?.away?.length ?? 'N/A'}). Ez hibának minősül.`);
            return null;
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
