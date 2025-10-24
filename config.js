import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* VÉGLEGES JAVÍTÁS: Kibővített ESPN liga lista + helyes AI Studio beállítások.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // A te bevált, működő modelled
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY;

// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL;

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        total_minutes: 90,
        home_advantage: { home: 1.08, away: 0.92 },
        avg_goals: 1.35,
        totals_line: 2.5,
        odds_api_sport_key: 'soccer_uefa_european_championship',
        odds_api_keys_by_league: {
            'UEFA Champions League': 'soccer_uefa_champs_league',
            'UEFA Europa League': 'soccer_uefa_europa_league',
            'English Premier League': 'soccer_epl',
            'Spanish La Liga': 'soccer_spain_la_liga',
            'German Bundesliga': 'soccer_germany_bundesliga',
            'Italian Serie A': 'soccer_italy_serie_a',
            'French Ligue 1': 'soccer_france_ligue_one',
            'NB I': 'soccer_hungary_nb_i'
        },
        // JAVÍTÁS: A te általad kért, kibővített ESPN liga lista
        espn_leagues: {
            "Premier League": "eng.1",
            "Championship": "eng.2",
            "Ligue 1": "fra.1",
            "Ligue 2": "fra.2",
            "Bundesliga": "ger.1",
            "2. Bundesliga": "ger.2",
            "Serie A": "ita.1",
            "Serie B": "ita.2",
            "LaLiga": "esp.1",
            "LaLiga2": "esp.2",
            "J1 League": "jpn.1",
            "Eredivisie": "ned.1",
            "Eliteserien": "nor.1",
            "Ekstraklasa": "pol.1",
            "Liga Portugal": "por.1",
            "Premiership": "sco.1",
            "K League 1": "kor.1",
            "Allsvenskan": "swe.1",
            "Super Lig": "tur.1",
            "MLS": "usa.1",
            "Liga MX": "mex.1",
            "Jupiler Pro League": "bel.1",
            "Serie A Betano": "rou.1",
            "HNL": "cro.1",
            "Superliga": "den.1",
            "Chance Liga": "cze.1",
            "NB I": "hun.1",
            "Premier Division": "irl.1",
            "Primera A": "col.1",
            "Champions League": "uefa.champions",
            "Europa League": "uefa.europa",
            "Conference League": "uefa.europa.conf",
            "FIFA World Cup": "fifa.world",
            "World Cup Qualifier": "fifa.worldq",
            "UEFA European Championship": "uefa.euro",
            "UEFA Nations League": "uefa.nations",
            "CAF World Cup Qualifying": "fifa.worldq.caf",
            "AFC World Cup Qualifying": "fifa.worldq.afc",
            "CONCACAF World Cup Qualifying": "fifa.worldq.concaf",
            "UEFA World Cup Qualifying": "fifa.worldq.uefa",
            "Brazil Serie A": "bra.1",
            "Brazil Serie B": "bra.2",
            "Argentinian Liga Profesional": "arg.1",
            "Australian A-League": "aus.1",
            "Austrian Bundesliga": "aut.1",
            "Swiss Super League": "sui.1",
            "Greek Super League": "gre.1"
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        total_minutes: 60,
        home_advantage: { home: 1.05, away: 0.95 },
        avg_goals: 3.0,
        totals_line: 6.5,
        odds_api_sport_key: 'icehockey_nhl',
        odds_api_keys_by_league: { 'NHL': 'icehockey_nhl', 'KHL': 'icehockey_khl', 'Sweden Hockey League': 'icehockey_sweden_hockey_league' },
        espn_leagues: { 'NHL': 'nhl' },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        total_minutes: 48,
        home_advantage: { home: 1.02, away: 0.98 },
        avg_goals: 110,
        totals_line: 220.5,
        odds_api_sport_key: 'basketball_nba',
        odds_api_keys_by_league: { 'NBA': 'basketball_nba', 'EuroLeague': 'basketball_euroleague' },
        espn_leagues: { 'NBA': 'nba' },
    },
};

/**
 * Visszaadja a megfelelő Odds API sportág kulcsot a liga neve alapján.
 * @param {string} leagueName A liga neve.
 * @returns {string|null} Az Odds API kulcs vagy null.
 */
export function getOddsApiKeyForLeague(leagueName) {
    if (!leagueName) return null;
    for (const sport in SPORT_CONFIG) {
        const config = SPORT_CONFIG[sport];
        if (config.odds_api_keys_by_league && config.odds_api_keys_by_league[leagueName]) {
            return config.odds_api_keys_by_league[leagueName];
        }
    }
    return null;
}