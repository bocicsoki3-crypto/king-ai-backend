// --- VÉGLEGES config.js (v49 - Hibrid Hozzáférés) ---
import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v49 VÁLTOZÁS: Hibrid API hozzáférés bevezetése.
* A foci 'rapidapi', a többi sport 'direct' típust használ.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-1.5-flash-latest'; // Ajánlott modell, a 'gemini-2.5-pro' nem létezik
export const SHEET_URL = process.env.SHEET_URL;

// --- xG API KONFIGURÁCIÓ (MARADT RAPIDAPI) ---
export const XG_API_KEY = process.env.XG_API_KEY;
export const XG_API_HOST = process.env.XG_API_HOST || 'live-xg-and-odds.p.rapidapi.com'; // Ajánlott, működő host

// --- API HOST TÉRKÉP (HIBRID HOZZÁFÉRÉSSEL) ---
export const API_HOSTS = {
    soccer: {
        host: 'v3.football.api-sports.io',
        type: 'rapidapi', // Focihoz a RapidAPI kulcsot használjuk
        keys: [process.env.RAPIDAPI_FOOTBALL_KEY].filter(Boolean)
    },
    hockey: {
        host: 'v3.hockey.api-sports.io', // FIGYELEM: A v1 elavult, a v3 a helyes!
        type: 'direct', // Jégkoronghoz a közvetlen kulcsot
        keys: [process.env.DIRECT_HOCKEY_KEY].filter(Boolean)
    },
    basketball: {
        host: 'v3.basketball.api-sports.io', // FIGYELEM: A v1 elavult, a v3 a helyes!
        type: 'direct', // Kosárlabdához a közvetlen kulcsot
        keys: [process.env.DIRECT_BASKETBALL_KEY].filter(Boolean)
    }
};

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
    'independiente medellin': 'Independiente Medellin',

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
            "A-League": { slug: "aus.1", country: "Australia", countryCode: "AU" },
            "Premier League": { slug: "eng.1", country: "England", countryCode: "GB" },
            "Championship": { slug: "eng.2", country: "England", countryCode: "GB" },
            "Ligue 1": { slug: "fra.1", country: "France", countryCode: "FR" },
            "Ligue 2": { slug: "fra.2", country: "France", countryCode: "FR" },
            "Bundesliga": { slug: "ger.1", country: "Germany", countryCode: "DE" },
            "2. Bundesliga": { slug: "ger.2", country: "Germany", countryCode: "DE" },
            "Serie A": { slug: "ita.1", country: "Italy", countryCode: "IT" },
            "Serie B": { slug: "ita.2", country: "Italy", countryCode: "IT" },
            "LaLiga": { slug: "esp.1", country: "Spain", countryCode: "ES" },
            "LaLiga2": { slug: "esp.2", country: "Spain", countryCode: "ES" },
            "J1 League": { slug: "jpn.1", country: "Japan", countryCode: "JP" },
            "Eredivisie": { slug: "ned.1", country: "Netherlands", countryCode: "NL" },
            "Eliteserien": { slug: "nor.1", country: "Norway", countryCode: "NO" },
            "Liga Portugal": { slug: "por.1", country: "Portugal", countryCode: "PT" },
            "Premiership": { slug: "sco.1", country: "Scotland", countryCode: "GB" },
            "Allsvenskan": { slug: "swe.1", country: "Sweden", countryCode: "SE" },
            "Super Lig": { slug: "tur.1", country: "Turkey", countryCode: "TR" },
            "MLS": { slug: "usa.1", country: "USA", countryCode: "US" },
            "Liga MX": { slug: "mex.1", country: "Mexico", countryCode: "MX" },
            "Jupiler Pro League": { slug: "bel.1", country: "Belgium", countryCode: "BE" },
            "Serie A Betano": { slug: "rou.1", country: "Romania", countryCode: "RO" },
            "Superliga": { slug: "den.1", country: "Denmark", countryCode: "DK" },
            "Chance Liga": { slug: "cze.1", country: "Czech Republic", countryCode: "CZ" },
            "Premier Division": { slug: "irl.1", country: "Ireland", countryCode: "IE" },
            "Primera A": { slug: "col.1", country: "Colombia", countryCode: "CO" },
            "Champions League": { slug: "uefa.champions", country: "World" },
            "Europa League": { slug: "uefa.europa", country: "World" },
            "Conference League": { slug: "uefa.europa.conf", country: "World" },
            "FIFA World Cup": { slug: "fifa.world", country: "World" },
            "UEFA European Championship": { slug: "uefa.euro", country: "World" },
            "UEFA Nations League": { slug: "uefa.nations", country: "World" },
            "CAF World Cup Qualifying": { slug: "fifa.worldq.caf", country: "World" },
            "AFC World Cup Qualifying": { slug: "fifa.worldq.afc", country: "World" },
            "UEFA World Cup Qualifying": { slug: "fifa.worldq.uefa", country: "World" },
            "Brazil Serie A": { slug: "bra.1", country: "Brazil", countryCode: "BR" },
            "Brazil Serie B": { slug: "bra.2", country: "Brazil", countryCode: "BR" },
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina", countryCode: "AR" },
            "Austrian Bundesliga": { slug: "aut.1", country: "Austria", countryCode: "AT" },
            "Swiss Super League": { slug: "sui.1", country: "Switzerland", countryCode: "CH" },
            "Greek Super League": { slug: "gre.1", country: "Greece", countryCode: "GR" },
            'Czech First League': { slug: 'cze.1', country: 'Czech Republic', countryCode: 'CZ' },
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        totals_line: 6.5,
        espn_leagues: {
            'NHL': { slug: 'nhl', country: 'USA', countryCode: 'US' }
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        totals_line: 220.5,
        espn_leagues: {
            'NBA': { slug: 'nba', country: 'USA', countryCode: 'US' },
            'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};
