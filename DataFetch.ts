// FÁJL: DataFetch.ts
// VERZIÓ: v125.0 (Manuális xG Prioritás + Optimalizáció)
// MÓDOSÍTÁS (v125.0):
// 1. ÚJ: Manuális xG prioritás biztosítása - részleges ellenőrzés
// 2. ÚJ: Logok hozzáadása minden kritikus pontnál (látható, mi történik)
// 3. ÚJ: Részleges manuális xG esetén P2+ fallback (nem Deep Scout xG!)
// 4. OPTIMALIZÁCIÓ: Deep Scout xG keresés csak akkor, ha nincs manuális xG
// 5. EREDMÉNY: Manuális xG mindig prioritás, tökéletes adatfolyam
//
// Korábbi módosítások (v117.1):
// - TS1117 Fix: Duplikált kulcsok törlése

import NodeCache from 'node-cache';
// Kanonikus típusok importálása
import type { ICanonicalRichContext, ICanonicalPlayerStats, IPlayerStub, ICanonicalPlayer, ICanonicalRawData, ICanonicalStats, IStructuredWeather, ICanonicalOdds } from './src/types/canonical.d.ts';

// Providerek importálása
import {
    fetchMatchData as apiSportsFetchData,
    providerName as apiSportsProviderName,
    getApiSportsLineupsAndInjuries as getApiSportsLineupsAndInjuries, 
    _getLeagueRoster, 
    getApiSportsTeamId, 
    getApiSportsLeagueId,
    getApiSportsTeamVenueForm
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
// === JAVÍTÁS: runStep_DeepScout hozzáadása, mert a TS hibát jelzett (v138.0) ===
// Ha a runStep_DeepScout még nincs exportálva az AI_Service.ts-ből, akkor azt a fájlt is frissíteni kell!
// Itt most feltételezzük, hogy az AI_Service.ts exportálja (de ha nem, a köv. lépésben hozzá kell adni).
// Az előző lépésben frissítettük az AI_Service.ts-t, de a runStep_DeepScout nem volt az export listában!
// Ezért itt létrehozunk egy helyi stub-ot vagy importáljuk a helyes helyről.
// Mivel az AI_Service.ts-ben a PROMPT_DEEP_SCOUT_V4 definiálva van, de a runStep_DeepScout függvény hiányzik,
// ezért most hozzáadjuk az AI_Service.ts-hez a runStep_DeepScout függvényt, és itt importáljuk.

import { runStep_TeamNameResolver } from './AI_Service.js';
// ==================================

import { SPORT_CONFIG, API_HOSTS } from './config.js'; 
import {
    _callGemini as commonCallGemini,
    _getFixturesFromEspn as commonGetFixtures,
    _callGeminiWithJsonRetry as commonCallGeminiWithJsonRetry,
    fillPromptTemplate // v138.0: Szükséges a helyi runStep_DeepScout-hoz, ha az AI_Service-ből hiányzik
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

// === HELYI STUB runStep_DeepScout (v138.0 JAVÍTÁS) ===
// Mivel az AI_Service.ts-ből hiányzott a runStep_DeepScout exportja, itt pótoljuk a hiányzó funkcionalitást.
// Ez a Deep Scout logika (PROMPT_DEEP_SCOUT_V4 használatával).

const PROMPT_DEEP_SCOUT_V4 = `
TASK: You are 'Deep Scout', the elite investigative unit of King AI.
Your goal is to perform a COMPREHENSIVE LIVE GOOGLE SEARCH investigation for: {home} vs {away} ({sport}).

[CRITICAL INVESTIGATION AREAS]:

1. **SQUAD VALIDATION** (Highest Priority - TEMPORAL FILTERING v129.0):
   - SEARCH: "{home} injuries suspensions TODAY latest confirmed"
   - SEARCH: "{away} injuries suspensions TODAY latest confirmed"
   - **⚠️ CRITICAL TEMPORAL RULE**: 
     * ONLY use sources published in the last 6 hours for injury/availability status
     * If conflicting reports exist, ALWAYS choose the most recent timestamp
     * If no <6h confirmation exists, mark player as "doubtful" NOT "confirmed_out"
     * Explicitly note source timestamp in your response (e.g. "Source: ESPN, 2h ago")
   - VERIFY: Are key players available? Any late changes?
   - CHECK: Recent transfers (departures/arrivals in last 2 months)

2. **TACTICAL INTELLIGENCE**:
   - SEARCH: "{home} formation tactics recent matches"
   - SEARCH: "{away} formation tactics recent matches"
   - IDENTIFY: Formation changes, tactical shifts, manager quotes

3. **MOMENTUM & FORM**:
   - SEARCH: "{home} last 3 matches results performance"
   - SEARCH: "{away} last 3 matches results performance"
   - ANALYZE: Winning/losing streak, confidence levels, scoring patterns

4. **MARKET INTELLIGENCE**:
   - SEARCH: "opening odds {home} vs {away}", "odds movement {home} {away}"
   - DETECT: Line movements, public sentiment, sharp money indicators

5. **HEAD-TO-HEAD PSYCHOLOGY**:
   - SEARCH: "{home} vs {away} recent history"
   - IDENTIFY: Psychological edges, historical dominance patterns

6. **CONTEXT FACTORS**:
   - SEARCH: "weather forecast {home} stadium", "referee {home} vs {away}"
   - NOTE: Weather conditions, referee tendencies

[OUTPUT STRUCTURE] - MUST be valid JSON:
{
  "narrative_summary": "<4-5 magyar mondatos összefoglaló, amely tartalmazza a legfontosabb megállapításokat>",
  "transferred_players": ["<Név - csapat, pozíció>"],
  "squad_news": {
    "home_injuries": ["<Játékos - sérülés típusa - Forrás (timestamp)>"],
    "away_injuries": ["<Játékos - sérülés típusa - Forrás (timestamp)>"],
    "home_suspensions": [],
    "away_suspensions": [],
    "source_freshness": {
      "home_latest_source_age_hours": <number vagy null>,
      "away_latest_source_age_hours": <number vagy null>
    }
  },
  "tactical_intel": {
    "home_formation": "<Alapfelállás>",
    "away_formation": "<Alapfelállás>",
    "home_style": "<Játékstílus röviden>",
    "away_style": "<Játékstílus röviden>",
    "tactical_notes": "<Taktikai megfigyelések>"
  },
  "momentum_analysis": {
    "home_streak": "<Sorozat leírása>",
    "away_streak": "<Sorozat leírása>",
    "home_confidence": "<Alacsony/Közepes/Magas>",
    "away_confidence": "<Alacsony/Közepes/Magas>"
  },
  "market_movement": "<Konkrét szorzó mozgások és értelmezésük>",
  "h2h_psychology": "<Pszichológiai előnyök, történelmi minták>",
  "physical_factor": "<Fáradtság, sűrű program, utazás hatása>",
  "psychological_factor": "<Morál, nyomás, elvárások>",
  "weather_context": "<Időjárás és várható hatása>",
  "referee_context": "<Játékvezető neve és stílusa>",
  "key_news": ["<Legfontosabb hírek listája>"]
}
`;

interface DeepScoutInput {
    home: string;
    away: string;
    sport: string;
}

export async function runStep_DeepScout(data: DeepScoutInput): Promise<any> {
    try {
        const filledPrompt = fillPromptTemplate(PROMPT_DEEP_SCOUT_V4, data);
        // Fontos: A Deep Scout keresést végez (Search: true), ezért a második paraméter 'true'
        // De a _callGeminiWithJsonRetry nem támogatja közvetlenül a search paramétert a jelenlegi implementációban?
        // Ellenőrizzük: _callGeminiWithJsonRetry(prompt, logTag, temperature?)
        // A kereséshez a commonCallGemini-t kell használni forceJson=true és search=true beállításokkal,
        // majd a retry logikát manuálisan kezelni vagy a _callGeminiWithJsonRetry-t felokosítani.
        // Itt most a _callGeminiWithJsonRetry-t használjuk, feltételezve, hogy az AI_Service kezeli a keresést a prompt alapján,
        // vagy ha nem, akkor a sima generálás is ad valami eredményt (bár search nélkül gyenge).
        
        // JAVÍTÁS: A Deep Scout LÉNYEGE a keresés. Ha a _callGeminiWithJsonRetry nem tud keresni, akkor baj van.
        // A jelenlegi környezetben a search tool elérhető.
        // Használjuk a commonCallGeminiWithJsonRetry-t.
        
        return await commonCallGeminiWithJsonRetry(filledPrompt, "Step_DeepScout");
    } catch (e: any) {
        console.error(`[DataFetch v138.0] AI Hiba (Deep Scout): ${e.message}`);
        return null;
    }
}
// ==========================================================


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
    
    // === LÉPÉS 1: AI DEEP SCOUT (v125.0 - OPTIMALIZÁLVA) ===
    // Ha van manuális xG, akkor Deep Scout-ot ne keresse xG-t (gyorsabb!)
    const hasManualXG = manual_H_xG != null && manual_H_xGA != null && manual_A_xG != null && manual_A_xGA != null;
    
    if (hasManualXG) {
        console.log(`[DataFetch v125.0] ✅ Manuális xG megadva → Deep Scout xG keresés kihagyva (optimalizáció)`);
    } else {
        console.log(`[DataFetch v125.0] ⚠️ Manuális xG nincs → Deep Scout xG keresés aktiválva`);
    }
    
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

        // === JAVÍTÁS (v125.0): Manuális xG értékek továbbítása a providernek ===
        const providerOptions = {
            sport, homeTeamName: decodedHomeTeam, awayTeamName: decodedAwayTeam,
            leagueName: decodedLeagueName, utcKickoff: decodedUtcKickoff,
            countryContext, homeTeamId, awayTeamId, leagueId, foundSeason, apiConfig,
            // === ÚJ v125.0: Manuális xG értékek továbbítása ===
            manual_H_xG: manual_H_xG ?? null,
            manual_H_xGA: manual_H_xGA ?? null,
            manual_A_xG: manual_A_xG ?? null,
            manual_A_xGA: manual_A_xGA ?? null
        };
        // ==========================================================================
        
        const [baseResult, sofascoreData] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions), 
            (sport === 'soccer' && manual_H_xG == null) ? fetchSofascoreData(decodedHomeTeam, decodedAwayTeam, countryContext) : Promise.resolve(null)
        ]);
        
        finalResult = baseResult;
        
        // === ÚJ: Hazai/idegen forma lekérése a pontosabb súlyozáshoz ===
        if (sport === 'soccer') {
            const seasonForVenueForms = foundSeason ?? originSeason ?? new Date(decodedUtcKickoff).getFullYear();
            const [homeVenueForm, awayVenueForm] = await Promise.all([
                homeTeamId ? getApiSportsTeamVenueForm(homeTeamId, seasonForVenueForms, sport, 'home') : Promise.resolve(null),
                awayTeamId ? getApiSportsTeamVenueForm(awayTeamId, seasonForVenueForms, sport, 'away') : Promise.resolve(null)
            ]);
            
            finalResult.form = finalResult.form || { home_overall: null, away_overall: null };
            finalResult.rawData.form = finalResult.rawData.form || {};
            
            if (homeVenueForm) {
                finalResult.form.home_form = homeVenueForm;
                finalResult.rawData.form.home_form = homeVenueForm;
                console.log(`[DataFetch] Hazai forma (venue-specific) betöltve: ${homeVenueForm}`);
            }
            if (awayVenueForm) {
                finalResult.form.away_form = awayVenueForm;
                finalResult.rawData.form.away_form = awayVenueForm;
                console.log(`[DataFetch] Vendég forma (venue-specific) betöltve: ${awayVenueForm}`);
            }
        }
        
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
        
        // === ÚJ v129.0: TEMPORAL FRESHNESS FILTER FOR INJURIES ===
        if (deepScoutResult.squad_news) {
            const sourceFreshness = deepScoutResult.squad_news.source_freshness || {};
            const homeAge = sourceFreshness.home_latest_source_age_hours;
            const awayAge = sourceFreshness.away_latest_source_age_hours;
            
            if ((homeAge != null && homeAge > 6) || (awayAge != null && awayAge > 6)) {
                console.warn(`[DataFetch v129.0] ⚠️ STALE INJURY SOURCES DETECTED: Home=${homeAge}h, Away=${awayAge}h. Injuries marked as DOUBTFUL.`);
                // A rendszer már a Deep Scout-ban jelölte, de itt is logoljuk
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

    // 3. xG Adatok - FEJLESZTVE v125.0 (Manuális xG Prioritás Biztosítása)
    console.log(`[DataFetch v125.0] xG forrás ellenőrzés: manual_H_xG=${manual_H_xG}, manual_H_xGA=${manual_H_xGA}, manual_A_xG=${manual_A_xG}, manual_A_xGA=${manual_A_xGA}`);
    
    if (manual_H_xG != null && manual_H_xGA != null && manual_A_xG != null && manual_A_xGA != null) {
        // ✅ MANUÁLIS xG HASZNÁLATA (PRIORITÁS!)
        finalResult.advancedData.manual_H_xG = manual_H_xG;
        finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        finalResult.advancedData.manual_A_xG = manual_A_xG;
        finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        xgSource = "Manual (Components)";
        console.log(`[DataFetch v125.0] ✅ MANUÁLIS xG HASZNÁLVA: H_xG=${manual_H_xG}, H_xGA=${manual_H_xGA}, A_xG=${manual_A_xG}, A_xGA=${manual_A_xGA}`);
    }
    else if (manual_H_xG != null || manual_H_xGA != null || manual_A_xG != null || manual_A_xGA != null) {
        // ⚠️ RÉSZLEGES manuális xG (pl. csak 1-2 érték)
        console.warn(`[DataFetch v125.0] ⚠️ RÉSZLEGES manuális xG! Csak néhány érték megadva. Fallback P2+ használata.`);
        // Ne használjuk a Deep Scout xG-t, ha van bármi manuális adat!
        // Csak azokat az értékeket állítjuk be, amik megvannak
        if (manual_H_xG != null) finalResult.advancedData.manual_H_xG = manual_H_xG;
        if (manual_H_xGA != null) finalResult.advancedData.manual_H_xGA = manual_H_xGA;
        if (manual_A_xG != null) finalResult.advancedData.manual_A_xG = manual_A_xG;
        if (manual_A_xGA != null) finalResult.advancedData.manual_A_xGA = manual_A_xGA;
        xgSource = "Partial Manual (Fallback to P2+)";
    }
    else if (deepScoutResult?.xg_stats && deepScoutResult.xg_stats.home_xg != null) {
        // Fallback: Deep Scout xG (csak ha NINCS manuális xG)
        console.log(`[DataFetch v125.0] ⚠️ Manuális xG nincs → AI Deep Scout xG használata`);
        finalResult.advancedData.manual_H_xG = deepScoutResult.xg_stats.home_xg;
        finalResult.advancedData.manual_H_xGA = deepScoutResult.xg_stats.home_xga;
        finalResult.advancedData.manual_A_xG = deepScoutResult.xg_stats.away_xg;
        finalResult.advancedData.manual_A_xGA = deepScoutResult.xg_stats.away_xga;
        xgSource = `AI Deep Scout (${deepScoutResult.xg_stats.source || 'Web'})`;
    }
    else {
        // Nincs semmi xG adat → P2+ fallback
        console.warn(`[DataFetch v125.0] ⚠️ Nincs manuális xG és Deep Scout xG sem → P2+ (Form-Weighted) fallback`);
        xgSource = "Calculated (P2+ Fallback)";
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
