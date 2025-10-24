import dotenv from 'dotenv';

dotenv.config();

// API Kulcsok és alap konfigurációk
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Ez marad az ÚJ Google Cloud kulcs
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // API-SPORTS kulcs
export const SHEET_URL = process.env.SHEET_URL;
export const PORT = process.env.PORT || 3000;

// === JAVÍTÁS: Váltás a Vertex AI végpontra ===
// Ezeket az értékeket a .env fájlban kell megadnod!
export const PROJECT_ID = process.env.PROJECT_ID || 'sportelemzoai'; // A Google Cloud Projekt Azonosítód
export const LOCATION = process.env.LOCATION || 'us-central1'; // Alapértelmezett régió
export const GEMINI_MODEL_ID = 'gemini-1.5-pro-preview-0514'; // Keresős modell

// A régi GEMINI_API_URL sort töröltük, mivel a DataFetch.js mostantól a google-auth-library-t használja

// Sportág specifikus konfigurációk
export const SPORT_CONFIG = {
    soccer: {
        name: "soccer", // ESPN API sporthoz
        // Odds API kulcsok ligánként
        odds_api_keys_by_league: {
            "TOP_LEAGUES_EU": ["Premier League", "LaLiga", "Bundesliga", "Serie A", "Ligue 1"],
            "soccer_uefa_champions_league": ["Champions League"],
            "soccer_uefa_europa_league": ["Europa League"],
            "soccer_uefa_europa_conference_league": ["Conference League"],
            "soccer_portugal_primeira_liga": ["Liga Portugal"],
            "soccer_netherlands_eredivisie": ["Eredivisie"],
            "soccer_belgium_first_div": ["Jupiler Pro League", "Belgian First Division A"],
            "soccer_turkey_super_lig": ["Super Lig"],
            "soccer_brazil_campeonato": ["Brazil Serie A"],
            "soccer_england_championship": ["Championship"],
            "soccer_germany_bundesliga2": ["2. Bundesliga"],
            "soccer_italy_serie_b": ["Serie B"],
            "soccer_spain_segunda_division": ["LaLiga2"],
            "soccer_uefa_nations_league": ["Nemzetek Ligája", "Nations League"],
            "soccer_uefa_european_championship": ["UEFA European Championship", "EURO"],
            "soccer_fifa_world_cup": ["FIFA World Cup", "World Cup"]
        },
        odds_api_sport_key: "soccer", // Alap sportkulcs
        // ESPN ligák
        espn_leagues: {
            "Champions League": "uefa.champions", "Premier League": "eng.1", "Bundesliga": "ger.1",
            "LaLiga": "esp.1", "Serie A": "ita.1", "Europa League": "uefa.europa",
            "Ligue 1": "fra.1", "Eredivisie": "ned.1", "Liga Portugal": "por.1",
            "Championship": "eng.2", "2. Bundesliga": "ger.2", "Serie B": "ita.2",
            "LaLiga2": "esp.2", "Super Lig": "tur.1", "Premiership": "sco.1",
            "Jupiler Pro League": "bel.1", "MLS": "usa.1", "Conference League": "uefa.europa.conf",
            "Brazil Serie A": "bra.1", "Argentinian Liga Profesional": "arg.1",
            "Greek Super League": "gre.1", "Nemzetek Ligája": "uefa.nations.league.a",
            "UEFA European Championship": "uefa.euro", "FIFA World Cup": "fifa.world"
        },
        total_minutes: 90, home_advantage: { home: 1.18, away: 0.82 },
        totals_line: 2.5, avg_goals: 1.35
    },
    hockey: {
        name: "hockey",
        odds_api_sport_key: "icehockey_nhl", 
        odds_api_keys_by_league: { "icehockey_nhl": ["NHL"] },
        espn_leagues: { "NHL": "nhl" },
        total_minutes: 60, home_advantage: { home: 1.15, away: 0.85 },
        totals_line: 6.5, avg_goals: 3.1
    },
    basketball: {
        name: "basketball",
        odds_api_sport_key: "basketball_nba",
        odds_api_keys_by_league: { "basketball_nba": ["NBA"] },
        espn_leagues: { "NBA": "nba" },
        total_minutes: 48, home_advantage: { home: 1.025, away: 0.975 },
        totals_line: 215.5, avg_points: 110
    }
};

export const SCRIPT_PROPERTIES = { getProperty: (key) => process.env[key] };

/**
 * Megkeresi a megfelelő Odds API sport kulcs(oka)t az ESPN liga neve alapján.
 * @param {string} espnLeagueName Az ESPN által használt liga név.
 * @returns {string} Az Odds API által várt sport kulcs(ok).
 */
export function getOddsApiKeyForLeague(espnLeagueName) {
    const sport = 'soccer'; // Jelenleg csak focira van kidolgozva
    const sportConfig = SPORT_CONFIG[sport];
    let defaultKey = sportConfig.odds_api_sport_key;
    if (!espnLeagueName || !sportConfig.odds_api_keys_by_league) return defaultKey;
    const lowerLeagueName = espnLeagueName.toLowerCase();
    for (const [key, leagues] of Object.entries(sportConfig.odds_api_keys_by_league)) {
        if (leagues.some(l => lowerLeagueName.includes(l.toLowerCase()))) {
            if (key === "TOP_LEAGUES_EU") {
                 return "soccer_epl,soccer_spain_la_liga,soccer_germany_bundesliga,soccer_italy_serie_a,soccer_france_ligue_one";
             }
            return key;
        }
    }
    return defaultKey;
}