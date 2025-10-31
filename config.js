// --- VÉGLEGES config.js (v47 - Országkód Integráció) ---

import dotenv from 'dotenv'; [cite: 621]
dotenv.config();
/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v47 VÁLTOZÁS: Hozzáadva a 'countryCode' a ligákhoz
* a megbízhatóbb API keresés érdekében.
[cite: 622]
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; [cite: 623]
export const SHEET_URL = process.env.SHEET_URL;

// --- xG API KONFIGURÁCIÓ (MARADT RAPIDAPI) ---
export const XG_API_KEY = process.env.XG_API_KEY;
export const XG_API_HOST = process.env.XG_API_HOST || 'football-xg-statistics.p.rapidapi.com'; [cite: 624]

// --- API HOST TÉRKÉP (KÖZVETLEN HOZZÁFÉRÉSSEL) ---
export const API_HOSTS = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'v3.football.api-sports.io', [cite: 626]
        keys: [
            process.env.APIFOOTBALL_KEY_1,
            process.env.APIFOOTBALL_KEY_2,
            process.env.APIFOOTBALL_KEY_3
        ].filter(Boolean)
    },
    hockey: {
        host: process.env.APIHOCKEY_HOST || 'v1.hockey.api-sports.io', [cite: 627]
        keys: [
            process.env.APIHOCKEY_KEY_1,
            process.env.APIHOCKEY_KEY_2,
            process.env.APIHOCKEY_KEY_3
        ].filter(Boolean)
    },
    basketball: {
        host: process.env.APIBASKETBALL_HOST || 'v1.basketball.api-sports.io', [cite: 628]
        keys: [
            process.env.APIBASKETBALL_KEY_1,
            process.env.APIBASKETBALL_KEY_2,
            process.env.APIBASKETBALL_KEY_3
        ].filter(Boolean)
    }
}; [cite: 629]

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---
export const ODDS_TEAM_NAME_MAP = {};

export const APIFOOTBALL_TEAM_NAME_MAP = {
    // Foci
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United',
    'man city': 'Manchester City',
    'inter': 'Inter Milan',
    'wolves': 'Wolverhampton Wanderers',
    'hellas verona': 'Hellas Verona',
    'lafc': 'Los Angeles FC',
    'austin fc': 'Austin FC',
    'ceará': 'Ceara SC',
    'atletico junior': 'Junior',
    'independiente santa fe': 'Santa Fe',
    'independiente medellin': 'Independiente Medellin', [cite: 630]

    // Jégkorong
    'senators': 'Ottawa Senators',
    'flames': 'Calgary Flames',
    'lightning': 'Tampa Bay Lightning',
    'stars': 'Dallas Stars',
    'flyers': 'Philadelphia Flyers',
    'predators': 'Nashville Predators',
    'hurricanes': 'Carolina Hurricanes',
    'islanders': 'New York Islanders',
    'wild': 'Minnesota Wild',
    'penguins': 'Pittsburgh Penguins'
};

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        totals_line: 2.5,
        espn_leagues: {
            // <-- VÁLTOZTATÁS: Hozzáadtuk az országkódokat (countryCode).
            "A-League": { slug: "aus.1", country: "Australia", countryCode: "AU" }, [cite: 632]
            "Premier League": { slug: "eng.1", country: "England", countryCode: "GB" },
            "Championship": { slug: "eng.2", country: "England", countryCode: "GB" },
            "Ligue 1": { slug: "fra.1", country: "France", countryCode: "FR" },
            "Ligue 2": { slug: "fra.2", country: "France", countryCode: "FR" },
            "Bundesliga": { slug: "ger.1", country: "Germany", countryCode: "DE" }, [cite: 633]
            "2. Bundesliga": { slug: "ger.2", country: "Germany", countryCode: "DE" },
            "Serie A": { slug: "ita.1", country: "Italy", countryCode: "IT" },
            "Serie B": { slug: "ita.2", country: "Italy", countryCode: "IT" },
            "LaLiga": { slug: "esp.1", country: "Spain", countryCode: "ES" },
            "LaLiga2": { slug: "esp.2", country: "Spain", countryCode: "ES" }, [cite: 634]
            "J1 League": { slug: "jpn.1", country: "Japan", countryCode: "JP" },
            "Eredivisie": { slug: "ned.1", country: "Netherlands", countryCode: "NL" },
            "Eliteserien": { slug: "nor.1", country: "Norway", countryCode: "NO" },
            "Liga Portugal": { slug: "por.1", country: "Portugal", countryCode: "PT" },
            "Premiership": { slug: "sco.1", country: "Scotland", countryCode: "GB" }, [cite: 635]
            "Allsvenskan": { slug: "swe.1", country: "Sweden", countryCode: "SE" },
            "Super Lig": { slug: "tur.1", country: "Turkey", countryCode: "TR" },
            "MLS": { slug: "usa.1", country: "USA", countryCode: "US" },
            "Liga MX": { slug: "mex.1", country: "Mexico", countryCode: "MX" },
            "Jupiler Pro League": { slug: "bel.1", country: "Belgium", countryCode: "BE" }, [cite: 636]
            "Serie A Betano": { slug: "rou.1", country: "Romania", countryCode: "RO" },
            "Superliga": { slug: "den.1", country: "Denmark", countryCode: "DK" },
            "Chance Liga": { slug: "cze.1", country: "Czech Republic", countryCode: "CZ"},
            "Premier Division": { slug: "irl.1", country: "Ireland", countryCode: "IE" }, [cite: 637]
            "Primera A": { slug: "col.1", country: "Colombia", countryCode: "CO" },
            "Champions League": { slug: "uefa.champions", country: "World" },
            "Europa League": { slug: "uefa.europa", country: "World" },
            "Conference League": { slug: "uefa.europa.conf", country: "World" },
            "FIFA World Cup": { slug: "fifa.world", country: "World" }, [cite: 638]
            "UEFA European Championship": { slug: "uefa.euro", country: "World" },
            "UEFA Nations League": { slug: "uefa.nations", country: "World" },
            "CAF World Cup Qualifying": { slug: "fifa.worldq.caf", country: "World" },
            "AFC World Cup Qualifying": { slug: "fifa.worldq.afc", country: "World" },
            "UEFA World Cup Qualifying": { slug: "fifa.worldq.uefa", country: "World" }, [cite: 639]
            "Brazil Serie A": { slug: "bra.1", country: "Brazil", countryCode: "BR" },
            "Brazil Serie B": { slug: "bra.2", country: "Brazil", countryCode: "BR" },
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina", countryCode: "AR" },
            "Austrian Bundesliga": { slug: "aut.1", country: "Austria", countryCode: "AT" },
            "Swiss Super League": { slug: "sui.1", country: "Switzerland", countryCode: "CH" }, [cite: 640]
            "Greek Super League": { slug: "gre.1", country: "Greece", countryCode: "GR" },
            'Czech First League': { slug: 'cze.1', country: 'Czech Republic', countryCode: 'CZ' },
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        totals_line: 6.5, [cite: 641]
        espn_leagues: {
          'NHL': { slug: 'nhl', country: 'USA', countryCode: 'US' }
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        totals_line: 220.5,
        espn_leagues: {
            'NBA': { slug: 'nba', country: 'USA', countryCode: 'US' }, [cite: 642]
            'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};
