import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* VÉGLEGES JAVÍTÁS: Hozzáadva az `espn_sport_path` kulcs az API hívásokhoz.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // A te bevált modelled
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY;

// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL;

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás', // Magyar név a megjelenítéshez
        espn_sport_path: 'soccer', // JAVÍTÁS: Angol név az API URL-hez
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
        espn_leagues: {
            'UEFA Champions League': 'uefa.champions',
            'UEFA Europa League': 'uefa.europa',
            'English Premier League': 'eng.1',
            'Spanish La Liga': 'esp.1',
            'German Bundesliga': 'ger.1',
            'Italian Serie A': 'ita.1',
            'French Ligue 1': 'fra.1',
            'NB I': 'hun.1',
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey', // JAVÍTÁS: Angol név az API URL-hez
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
        espn_sport_path: 'basketball', // JAVÍTÁS: Angol név az API URL-hez
        total_minutes: 48,
        home_advantage: { home: 1.02, away: 0.98 },
        avg_goals: 110,
        totals_line: 220.5,
        odds_api_sport_key: 'basketball_nba',
        odds_api_keys_by_league: { 'NBA': 'basketball_nba', 'EuroLeague': 'basketball_euroleague' },
        espn_leagues: { 'NBA': 'nba' },
    },
};

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