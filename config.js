// --- JAVÍTOTT config.js ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* KRITIKUS JAVÍTÁS: Hozzáadva az `APIFOOTBALL_TEAM_NAME_MAP` a csapatnevek
* pontosabb azonosításához, különösen a "Spurs" -> "Tottenham Hotspur"
* és hasonló becenevek helyes kezelésére.
* JAVÍTÁS (2025-10-25): 'Serie A' kulcs hozzáadva az odds_api_keys_by_league-hez.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001; // Port, amin a szerver fut

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Gemini API kulcs
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // Ajánlott modell a sebesség és költséghatékonyság miatt
export const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
export const APIFOOTBALL_RAPIDAPI_HOST = process.env.APIFOOTBALL_RAPIDAPI_HOST;
export const ODDS_API_BASE_URL = process.env.ODDS_API_BASE_URL;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY; // SportMonks API kulcs (opcionális)
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // Player API kulcs (opcionális, nem látszik használatban)


// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL; // Google Sheet URL

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Bővítsd ezt a listát, ha további eltéréseket találsz a The Odds API logokban!
export const ODDS_TEAM_NAME_MAP = {
    // Kulcs: Az ESPN/Frontend által használt név (kisbetűvel)
    // Érték: A The Odds API által használt név
    'schalke': 'FC Schalke 04',
    'bremen': 'Werder Bremen',
    'manchester city': 'Man City',
    'manchester united': 'Man United',
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'real madrid': 'Real Madrid',
    'atletico madrid': 'Atletico Madrid',
    'bayern munich': 'Bayern Munich',
};

// --- JAVÍTÁS KEZDETE: ÚJ NÉVTÉRKÉP AZ API-FOOTBALLHOZ ---
// Bővítsd ezt a listát, ha az API-Football tévesen azonosít egy csapatot!
export const APIFOOTBALL_TEAM_NAME_MAP = {
    // Kulcs: A frontendről érkező név (kisbetűvel)
    // Érték: A pontos, hivatalos csapatnév, amire az API-Football keresni fog
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United',
    'man city': 'Manchester City',
    'inter': 'Inter Milan', // Gyakori rövidítés
    'wolves': 'Wolverhampton Wanderers',
    // ... további csapatok, ha szükséges ...
};
// --- JAVÍTÁS VÉGE ---


// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        total_minutes: 90,
        home_advantage: { home: 1.08, away: 0.92 },
        avg_goals: 1.35,
        totals_line: 2.5,
        odds_api_sport_key: 'soccer_epl', // Alapértelmezett odds sport kulcs
        odds_api_keys_by_league: { // Specifikus odds kulcsok ligákhoz
            'UEFA Champions League': 'soccer_uefa_champs_league',
            'Champions League': 'soccer_uefa_champs_league',
            'UEFA Europa League': 'soccer_uefa_europa_league',
            'Europa League': 'soccer_uefa_europa_league',
            'UEFA Conference League': 'soccer_uefa_europa_conference_league',
            'Conference League': 'soccer_uefa_europa_conference_league',
            'English Premier League': 'soccer_epl',
            'Premier League': 'soccer_epl',
            'Spanish La Liga': 'soccer_spain_la_liga',
            'LaLiga': 'soccer_spain_la_liga',
            'German Bundesliga': 'soccer_germany_bundesliga',
            'Bundesliga': 'soccer_germany_bundesliga',
            'Italian Serie A': 'soccer_italy_serie_a',
            'Serie A': 'soccer_italy_serie_a',
            'French Ligue 1': 'soccer_france_ligue_one',
            'Ligue 1': 'soccer_france_ligue_one',
            'NB I': 'soccer_hungary_nb_i',
            'Eredivisie': 'soccer_netherlands_eredivisie',
            'Liga Portugal': 'soccer_portugal_primeira_liga',
            'MLS': 'soccer_usa_mls',
            'Brazil Serie A': 'soccer_brazil_campeonato',
            'Argentinian Liga Profesional': 'soccer_argentina_primera_division'
        },
        espn_leagues: {
            "Premier League":"eng.1", "Championship":"eng.2", "Ligue 1":"fra.1", "Ligue 2":"fra.2", "Bundesliga":"ger.1", "2. Bundesliga":"ger.2", "Serie A":"ita.1", "Serie B":"ita.2", "LaLiga":"esp.1", "LaLiga2":"esp.2", "J1 League":"jpn.1", "Eredivisie":"ned.1", "Eliteserien":"nor.1", "Ekstraklasa":"pol.1", "Liga Portugal":"por.1", "Premiership":"sco.1", "K League 1":"kor.1", "Allsvenskan":"swe.1", "Super Lig":"tur.1", "MLS":"usa.1", "Liga MX":"mex.1", "Jupiler Pro League":"bel.1", "Serie A Betano":"rou.1", "HNL":"cro.1", "Superliga":"den.1", "Chance Liga":"cze.1", "NB I.":"hun.1", "NB I":"hun.1", "Premier Division":"irl.1", "Primera A":"col.1", "Champions League":"uefa.champions", "Europa League":"uefa.europa", "Conference League":"uefa.europa.conf", "FIFA World Cup": "fifa.world", "World Cup Qualifier": "fifa.worldq", "UEFA European Championship": "uefa.euro", "UEFA Nations League": "uefa.nations", "CAF World Cup Qualifying": "fifa.worldq.caf", "AFC World Cup Qualifying": "fifa.worldq.afc", "CONCACAF World Cup Qualifying": "fifa.worldq.concaf", "UEFA World Cup Qualifying": "fifa.worldq.uefa", "Brazil Serie A": "bra.1", "Brazil Serie B": "bra.2", "Argentinian Liga Profesional": "arg.1", "Australian A-League": "aus.1", "Austrian Bundesliga": "aut.1", "Swiss Super League": "sui.1", "Greek Super League": "gre.1", 'Czech First League': 'cze.1',
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
        odds_api_keys_by_league: {
            'NHL': 'icehockey_nhl',
            'KHL': 'icehockey_khl',
            'Sweden Hockey League': 'icehockey_sweden_hockey_league',
            'Liiga': 'icehockey_finland_liiga',
            'DEL': 'icehockey_germany_del',
        },
        espn_leagues: {
             'NHL': 'nhl'
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        total_minutes: 48,
        home_advantage: { home: 1.02, away: 0.98 },
        avg_goals: 110,
        totals_line: 220.5,
        odds_api_sport_key: 'basketball_nba',
        odds_api_keys_by_league: {
            'NBA': 'basketball_nba',
            'EuroLeague': 'basketball_euroleague',
            'Liga ACB': 'basketball_spain_acb',
        },
        espn_leagues: {
            'NBA': 'nba',
            'Euroleague': 'euroleague'
        },
    },
};

/**
 * Visszaadja a megfelelő Odds API sportág kulcsot a liga neve alapján.
 */
export function getOddsApiKeyForLeague(leagueName) {
    if (!leagueName) return null;
    const lowerLeagueName = leagueName.toLowerCase().trim();
    for (const sport in SPORT_CONFIG) {
        const config = SPORT_CONFIG[sport];
        if (config.odds_api_keys_by_league) {
            for (const key in config.odds_api_keys_by_league) {
                if (key.toLowerCase() === lowerLeagueName) {
                    return config.odds_api_keys_by_league[key];
                }
            }
        }
    }
    console.warn(`getOddsApiKeyForLeague: Nem található direkt Odds API kulcs ehhez a ligához: "${leagueName}"`);
    return null;
}
