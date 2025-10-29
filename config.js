// --- JAVÍTOTT config.js (v28-kompatibilis) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* KRITIKUS JAVÍTÁS (v28): Az `espn_leagues` struktúrája objektumokra
* lett cserélve (`{ slug, country }`), hogy támogassa a datafetch.js
* új, célzott liga keresési logikáját.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001; // Port, amin a szerver fut

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Gemini API kulcs
export const GEMINI_MODEL_ID = 'gemini-2.5-pro';
export const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
export const APIFOOTBALL_RAPIDAPI_HOST = process.env.APIFOOTBALL_RAPIDAPI_HOST;
export const RAPIDAPI_ODDS_HOST = process.env.RAPIDAPI_ODDS_HOST;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY; // SportMonks API kulcs (opcionális)
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // Player API kulcs (opcionális, nem látszik használatban)


// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL; // Google Sheet URL

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Bővítsd ezt a listát, ha további eltéréseket találsz a The Odds API logokban!
export const ODDS_TEAM_NAME_MAP = {
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

// Bővítsd ezt a listát, ha az API-Football tévesen azonosít egy csapatot!
export const APIFOOTBALL_TEAM_NAME_MAP = {
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United',
    'man city': 'Manchester City',
    'inter': 'Inter Milan', // Gyakori rövidítés
    'wolves': 'Wolverhampton Wanderers',
};


// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        total_minutes: 90,
        home_advantage: { home: 1.08, away: 0.92 },
        avg_goals: 1.35,
        totals_line: 2.5,
        odds_api_sport_key: 'soccer_epl',
        odds_api_keys_by_league: { 
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
        // --- v28 JAVÍTÁS: STRUKTÚRA ÁTALAKÍTVA OBJEKTUMOKRA ---
        espn_leagues: {
            "Premier League": { slug: "eng.1", country: "England" },
            "Championship": { slug: "eng.2", country: "England" },
            "Ligue 1": { slug: "fra.1", country: "France" },
            "Ligue 2": { slug: "fra.2", country: "France" },
            "Bundesliga": { slug: "ger.1", country: "Germany" },
            "2. Bundesliga": { slug: "ger.2", country: "Germany" },
            "Serie A": { slug: "ita.1", country: "Italy" },
            "Serie B": { slug: "ita.2", country: "Italy" },
            "LaLiga": { slug: "esp.1", country: "Spain" },
            "LaLiga2": { slug: "esp.2", country: "Spain" },
            "J1 League": { slug: "jpn.1", country: "Japan" },
            "Eredivisie": { slug: "ned.1", country: "Netherlands" },
            "Eliteserien": { slug: "nor.1", country: "Norway" },
            "Ekstraklasa": { slug: "pol.1", country: "Poland" },
            "Liga Portugal": { slug: "por.1", country: "Portugal" },
            "Premiership": { slug: "sco.1", country: "Scotland" },
            "K League 1": { slug: "kor.1", country: "South Korea" },
            "Allsvenskan": { slug: "swe.1", country: "Sweden" },
            "Super Lig": { slug: "tur.1", country: "Turkey" },
            "MLS": { slug: "usa.1", country: "USA" },
            "Liga MX": { slug: "mex.1", country: "Mexico" },
            "Jupiler Pro League": { slug: "bel.1", country: "Belgium" },
            "Serie A Betano": { slug: "rou.1", country: "Romania" },
            "HNL": { slug: "cro.1", country: "Croatia" },
            "Superliga": { slug: "den.1", country: "Denmark" },
            "NB I": { slug: "hun.1", country: "Hungary" },
            "Premier Division": { slug: "irl.1", country: "Ireland" },
            "Primera A": { slug: "col.1", country: "Colombia" },
            "Champions League": { slug: "uefa.champions", country: "World" },
            "Europa League": { slug: "uefa.europa", country: "World" },
            "Conference League": { slug: "uefa.europa.conf", country: "World" },
            "FIFA World Cup": { slug: "fifa.world", country: "World" },
            "World Cup Qualifier": { slug: "fifa.worldq", country: "World" },
            "UEFA European Championship": { slug: "uefa.euro", country: "World" },
            "UEFA Nations League": { slug: "uefa.nations", country: "World" },
            "Brazil Serie A": { slug: "bra.1", country: "Brazil" },
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina" },
            "Australian A-League": { slug: "aus.1", country: "Australia" },
            "Austrian Bundesliga": { slug: "aut.1", country: "Austria" },
            "Swiss Super League": { slug: "sui.1", country: "Switzerland" },
            "Greek Super League": { slug: "gre.1", country: "Greece" },
            "Czech First League": { slug: "cze.1", country: "Czech Republic" }
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
          'NHL': { slug: 'nhl', country: 'USA' }
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
            'NBA': { slug: 'nba', country: 'USA' },
            'Euroleague': { slug: 'euroleague', country: 'World' }
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
