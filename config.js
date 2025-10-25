// --- JAVÍTOTT config.txt ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* VÉGLEGES JAVÍTÁS: Hibás ESPN ligák eltávolítva, Odds csapatnév térkép hozzáadva.
* JAVÍTÁS (2025-10-25): 'Serie A' kulcs hozzáadva az odds_api_keys_by_league-hez.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001; // Port, amin a szerver fut

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Gemini API kulcs
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // *** JAVASLAT: Válts erre, ha elérhető (a check_models.txt alapján), vagy hagyd a 'gemini-2.5-pro'-t, ha az működik neked ***
export const ODDS_API_KEY = process.env.ODDS_API_KEY; // Odds API kulcs
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY; // SportMonks API kulcs (opcionális)
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // Player API kulcs (opcionális, nem látszik használatban)
export const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY; // TheSportsDB API kulcs

// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL; // Google Sheet URL

// --- CSAPATNÉV HOZZÁRENDELÉS (ODDS API-hoz) ---
// Bővítsd ezt a listát, ha további eltéréseket találsz a logokban!
// Kulcs: Az ESPN/Frontend által használt név (kisbetűvel)
// Érték: A The Odds API által használt név (ahogy a logban látod, ha eltér)
export const ODDS_TEAM_NAME_MAP = {
    'schalke': 'FC Schalke 04', // Példa, ellenőrizd a pontos nevet az Odds API dokumentációjában vagy a logokban
    'bremen': 'Werder Bremen', // Példa
    'union berlin': 'Union Berlin', // Ha ugyanaz, akkor is beteheted a teljesség kedvéért
    // --- Újabb példák (ezeket neked kell ellenőrizni és bővíteni!) ---
    'manchester city': 'Man City',
    'manchester united': 'Man United',
    'real madrid': 'Real Madrid',
    'atletico madrid': 'Atletico Madrid',
    'bayern munich': 'Bayern Munich',
    // ... további csapatok ...
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
        odds_api_sport_key: 'soccer_epl', // Alapértelmezett odds sport kulcs
        odds_api_keys_by_league: { // Specifikus odds kulcsok ligákhoz
            'UEFA Champions League': 'soccer_uefa_champs_league',
            'Champions League': 'soccer_uefa_champs_league', // Rövid név is
            'UEFA Europa League': 'soccer_uefa_europa_league',
            'Europa League': 'soccer_uefa_europa_league', // Rövid név is
            'UEFA Conference League': 'soccer_uefa_europa_conference_league', // Pontosabb kulcs? Ellenőrizd az Odds API doksit!
            'Conference League': 'soccer_uefa_europa_conference_league', // Rövid név is
            'English Premier League': 'soccer_epl',
            'Premier League': 'soccer_epl', // Rövid név is
            'Spanish La Liga': 'soccer_spain_la_liga',
            'LaLiga': 'soccer_spain_la_liga', // Rövid név is
            'German Bundesliga': 'soccer_germany_bundesliga',
            'Bundesliga': 'soccer_germany_bundesliga', // Rövid név is
            'Italian Serie A': 'soccer_italy_serie_a',
            'Serie A': 'soccer_italy_serie_a', // <<< --- JAVÍTÁS: Hiányzó kulcs hozzáadva ---
            'French Ligue 1': 'soccer_france_ligue_one',
            'Ligue 1': 'soccer_france_ligue_one', // Rövid név is
            'NB I': 'soccer_hungary_nb_i',
            // --- További ligák (ellenőrizd az Odds API dokumentációját a pontos kulcsokért!) ---
            'Eredivisie': 'soccer_netherlands_eredivisie',
            'Liga Portugal': 'soccer_portugal_primeira_liga',
            'MLS': 'soccer_usa_mls',
            'Brazil Serie A': 'soccer_brazil_campeonato',
            'Argentinian Liga Profesional': 'soccer_argentina_primera_division'
            // ... stb. ...
        },
        // JAVÍTÁS: Hibás/elavult ligák eltávolítva, pontosabb ESPN nevek
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
            "Liga Portugal": "por.1",
            "Premiership": "sco.1",
            "Allsvenskan": "swe.1",
            "Super Lig": "tur.1",
            "MLS": "usa.1",
            "Liga MX": "mex.1",
            "Jupiler Pro League": "bel.1",
            "Superliga": "den.1",
            "Chance Liga": "cze.1",
            "Premier Division": "irl.1",
            "Primera A": "col.1",
            "Champions League": "uefa.champions",
            "Europa League": "uefa.europa",
            "Conference League": "uefa.europa.conf",
            "FIFA World Cup": "fifa.world",
            "World Cup Qualifier": "fifa.worldq", // Lehet specifikusabb kell (pl. uefa)
            "UEFA European Championship": "uefa.euro",
            "UEFA Nations League": "uefa.nations",
            "CAF World Cup Qualifying": "fifa.worldq.caf",
            "AFC World Cup Qualifying": "fifa.worldq.afc",
            "CONCACAF World Cup Qualifying": "fifa.worldq.concacaf", // Ellenőrizd, hogy ez a helyes ESPN slug
            "UEFA World Cup Qualifying": "fifa.worldq.uefa",
            "Brazil Serie A": "bra.1",
            "Brazil Serie B": "bra.2",
            "Argentinian Liga Profesional": "arg.1",
            "Australian A-League": "aus.1",
            "Austrian Bundesliga": "aut.1",
            "Swiss Super League": "sui.1",
            "Greek Super League": "gre.1"
            // "NB I": "hun.1" // Ellenőrizd az ESPN slugot, ha magyar bajnokság kell
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
            'Liiga': 'icehockey_finland_liiga', // Finn
            'DEL': 'icehockey_germany_del', // Német
            // ... további ligák ...
        },
        espn_leagues: {
             'NHL': 'nhl'
             // ... esetleg más ligák, ha az ESPN támogatja ...
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        total_minutes: 48,
        home_advantage: { home: 1.02, away: 0.98 },
        avg_goals: 110, // Ez inkább pont
        totals_line: 220.5,
        odds_api_sport_key: 'basketball_nba',
        odds_api_keys_by_league: {
            'NBA': 'basketball_nba',
            'EuroLeague': 'basketball_euroleague',
            'Liga ACB': 'basketball_spain_acb', // Spanyol
            // ... további ligák ...
        },
        espn_leagues: {
            'NBA': 'nba',
            'Euroleague': 'euroleague' // Ellenőrizd az ESPN slugot
            // ... esetleg más ligák ...
        },
    },
};

/**
 * Visszaadja a megfelelő Odds API sportág kulcsot a liga neve alapján.
 */
export function getOddsApiKeyForLeague(leagueName) {
    if (!leagueName) return null;

    // Közvetlen keresés a megadott ligakulcsokkal (nagy/kisbetű érzéketlen)
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

    // Ha nincs pontos egyezés, visszaadjuk az alapértelmezett sportkulcsot (ha van)
    // Ez a fallback logika már a getOddsData-ban van, itt null-t adunk vissza, ha nincs direkt találat
    console.warn(`getOddsApiKeyForLeague: Nem található direkt Odds API kulcs ehhez a ligához: "${leagueName}"`);
    return null;
}