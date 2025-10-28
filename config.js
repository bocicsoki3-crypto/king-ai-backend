// --- JAVÍTOTT config.js (v1.2 - API Sports Hockey, ESPN NBA) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* VÁLTOZÁS (v1.2 - 2025-10-28):
* - Hockey: API Sports ligák ID-jai frissítve (NHL=57).
* - Basketball: Visszaállítva ESPN használatára az NBA meccsek lekéréséhez.
* A többi kosár liga (pl. Euroleague) az API Sports-ot használja.
* - APIFOOTBALL_TEAM_NAME_MAP hozzáadva.
* - Odds API liga kulcsok frissítve.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-1.5-pro';
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY;
export const APIFOOTBALL_API_KEY = process.env.APIFOOTBALL_API_KEY; // API Sports kulcs (minden sportághoz ezt használjuk?)
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY;


// --- GOOGLE SHEET BEÁLLÍTÁSOK ---
export const SHEET_URL = process.env.SHEET_URL;

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Odds API-hoz
export const ODDS_TEAM_NAME_MAP = {
    'schalke': 'FC Schalke 04', 'bremen': 'Werder Bremen',
    'manchester city': 'Man City', 'manchester united': 'Man United',
    'spurs': 'Tottenham Hotspur', 'tottenham': 'Tottenham Hotspur',
    'real madrid': 'Real Madrid', 'atletico madrid': 'Atletico Madrid',
    'bayern munich': 'Bayern Munich',
};

// API Sports (API-Football)-hoz
export const APIFOOTBALL_TEAM_NAME_MAP = {
    'spurs': 'Tottenham Hotspur', 'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United', 'man city': 'Manchester City',
    'inter': 'Inter Milan', 'wolves': 'Wolverhampton Wanderers',
};


// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer', // ESPN focihoz marad
        total_minutes: 90,
        home_advantage: { home: 1.08, away: 0.92 },
        avg_goals: 1.35,
        totals_line: 2.5,
        odds_api_sport_key: 'soccer_epl',
        odds_api_keys_by_league: { /* ... Foci liga kulcsok ... */ }, // Rövidítve a jobb átláthatóságért
        espn_leagues: { /* ... Foci ESPN ligák ... */ }, // Rövidítve
    },
    hockey: {
        name: 'jégkorong',
        // ESPN már nem kell
        total_minutes: 60,
        home_advantage: { home: 1.05, away: 0.95 },
        avg_goals: 3.0,
        totals_line: 6.5,
        odds_api_sport_key: 'icehockey_nhl',
        odds_api_keys_by_league: {
            'NHL': 'icehockey_nhl', 'KHL': 'icehockey_khl',
            'Sweden Hockey League': 'icehockey_sweden_hockey_league', 'Liiga': 'icehockey_finland_liiga',
            'DEL': 'icehockey_germany_del', 'Czech Extraliga': 'icehockey_czech_extraliga',
        },
        api_sport_endpoint_prefix: 'hockey', // Ellenőrizni!
        api_sports_leagues: { // API Sports ligák jégkoronghoz
            'NHL': 57,              // Most már a helyes ID
            'KHL': 96,              // <<<--- ELLENŐRIZD EZT AZ ID-t!
            'SHL': 47,              // Svéd liga
            'Liiga': 16,            // Finn liga
            'DEL': 19,              // Német liga
            'Czech Extraliga': 10,  // Cseh liga
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball', // VISSZAÁLLÍTVA ESPN-hez az NBA miatt
        total_minutes: 48,
        home_advantage: { home: 1.02, away: 0.98 },
        avg_goals: 110,
        totals_line: 220.5,
        odds_api_sport_key: 'basketball_nba',
        odds_api_keys_by_league: {
            'NBA': 'basketball_nba', 'EuroLeague': 'basketball_euroleague',
            'Liga ACB': 'basketball_spain_acb',
            'Champions League': 'basketball_europe_champions_league'
        },
        espn_leagues: { // VISSZAÁLLÍTVA: Csak az NBA marad itt az ESPN lekéréshez
            'NBA': 'nba',
        },
        api_sport_endpoint_prefix: 'basketball', // Ellenőrizni!
        api_sports_leagues: { // API Sports ligák KOSÁRLABDÁHOZ (NBA nélkül!)
            // 'NBA': 12,           // <<<--- ELTÁVOLÍTVA, mert ESPN-ről jön
            'Euroleague': 13,       // <<<--- ELLENŐRIZD EZT AZ ID-t!
            'Champions League': 146,// Bajnokok Ligája
            'Liga ACB': 107,        // <<<--- ELLENŐRIZD EZT AZ ID-t! (Spanyol liga)
            'BBL': 89,              // <<<--- ELLENŐRIZD EZT AZ ID-t! (Német liga)
            'Lega A': 100,          // <<<--- ELLENŐRIZD EZT AZ ID-t! (Olasz liga)
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
                if (key.toLowerCase() === lowerLeagueName || leagueName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(leagueName.toLowerCase())) {
                    console.log(`getOddsApiKeyForLeague: Találat "${leagueName}" -> "${key}" -> ${config.odds_api_keys_by_league[key]}`);
                    return config.odds_api_keys_by_league[key];
                }
            }
        }
    }
    console.warn(`getOddsApiKeyForLeague: Nem található direkt Odds API kulcs ehhez a ligához: "${leagueName}"`);
    return null;
}