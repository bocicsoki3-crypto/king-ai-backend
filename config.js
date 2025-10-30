// --- VÉGLEGES config.js (v41 - Kulcsrotáció) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v41 JAVÍTÁS: Bevezetve az API_HOSTS objektum kulcs-tömbökkel
* (keys: []), hogy támogassa az automatikus kulcsrotációt
* a kvóta kimerülése esetén.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro';
export const SHEET_URL = process.env.SHEET_URL;

// --- V41: API HOST TÉRKÉP (KULCSROTÁCIÓVAL) ---
// Az API-Sports külön hostokat használ minden sportághoz.
// A .env fájlban vagy a Render 'Environment' fülén add meg a kulcsokat.
export const API_HOSTS = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        keys: [
            process.env.APIFOOTBALL_KEY_1,
            process.env.APIFOOTBALL_KEY_2,
            process.env.APIFOOTBALL_KEY_3 // Hozzáadhatsz többet is
        ].filter(Boolean) // Kiszűri az üres/undefined kulcsokat
    },
    hockey: {
        host: process.env.APIHOCKEY_HOST || 'api-hockey.p.rapidapi.com',
        keys: [
            process.env.APIHOCKEY_KEY_1 || process.env.APIFOOTBALL_KEY_1,
            process.env.APIHOCKEY_KEY_2 || process.env.APIFOOTBALL_KEY_2
        ].filter(Boolean)
    },
    basketball: {
        host: process.env.APIBASKETBALL_HOST || 'api-basketball.p.rapidapi.com',
        keys: [
            process.env.APIBASKETBALL_KEY_1 || process.env.APIFOOTBALL_KEY_1,
            process.env.APIBASKETBALL_KEY_2 || process.env.APIFOOTBALL_KEY_2
        ].filter(Boolean)
    }
};

// Régi, deprecated nevek (meghagyva a kompatibilitás miatt)
export const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY_1; // Alapértelmezett az első kulcs
export const APIFOOTBALL_HOST = 'api-football-v1.p.rapidapi.com';


// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Odds API (Már nincs használatban)
export const ODDS_TEAM_NAME_MAP = {
    // ... (meghagyható)
};

// API-SPORTS NÉV TÉRKÉP (Minden sportághoz)
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
            // ... (A teljes foci liga lista itt van)
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
            "Liga Portugal": { slug: "por.1", country: "Portugal" },
            "Premiership": { slug: "sco.1", country: "Scotland" },
            "Allsvenskan": { slug: "swe.1", country: "Sweden" },
            "Super Lig": { slug: "tur.1", country: "Turkey" },
            "MLS": { slug: "usa.1", country: "USA" },
            "Liga MX": { slug: "mex.1", country: "Mexico" },
            "Jupiler Pro League": { slug: "bel.1", country: "Belgium" },
            "Serie A Betano": { slug: "rou.1", country: "Romania" },
            "Superliga": { slug: "den.1", country: "Denmark" },
            "Chance Liga": { slug: "cze.1", country: "Czech Republic"},
            "Premier Division": { slug: "irl.1", country: "Ireland" },
            "Primera A": { slug: "col.1", country: "Colombia" },
            "Champions League": { slug: "uefa.champions", country: "World" },
            "Europa League": { slug: "uefa.europa", country: "World" },
            "Conference League": { slug: "uefa.europa.conf", country: "World" },
            "FIFA World Cup": { slug: "fifa.world", country: "World" },
            "UEFA European Championship": { slug: "uefa.euro", country: "World" },
            "UEFA Nations League": { slug: "uefa.nations", country: "World" },
            "CAF World Cup Qualifying": { slug: "fifa.worldq.caf", country: "World" },
            "AFC World Cup Qualifying": { slug: "fifa.worldq.afc", country: "World" },
            "UEFA World Cup Qualifying": { slug: "fifa.worldq.uefa", country: "World" },
            "Brazil Serie A": { slug: "bra.1", country: "Brazil" },
            "Brazil Serie B": { slug: "bra.2", country: "Brazil" },
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina" },
            "Australian A-League": { slug: "aus.1", country: "Australia" },
            "Austrian Bundesliga": { slug: "aut.1", country: "Austria" },
            "Swiss Super League": { slug: "sui.1", country: "Switzerland" },
            "Greek Super League": { slug: "gre.1", country: "Greece" },
            'Czech First League': { slug: 'cze.1', country: 'Czech Republic' },
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        totals_line: 6.5,
        espn_leagues: {
          'NHL': { slug: 'nhl', country: 'USA' } 
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        totals_line: 220.5,
        espn_leagues: {
            'NBA': { slug: 'nba', country: 'USA' },
            'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};
