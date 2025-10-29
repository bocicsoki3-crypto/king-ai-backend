// --- VÉGLEGES config.js (v40 - Több Sportág API Host) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v40 JAVÍTÁS: Hozzáadva az API_HOSTS objektum, hogy a rendszer
* a 'hockey' és 'basketball' sportágakhoz a megfelelő
* API végpontokat (api-hockey, api-basketball) használja.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro';
export const SHEET_URL = process.env.SHEET_URL;

// --- V40: API HOST TÉRKÉP (SPORTÁGANKÉNT) ---
// Az API-Football (API-Sports) külön hostokat használ minden sportághoz.
export const API_HOSTS = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        key: process.env.APIFOOTBALL_KEY
    },
    hockey: {
        host: process.env.APIHOCKEY_HOST || 'api-hockey.p.rapidapi.com',
        key: process.env.APIHOCKEY_KEY || process.env.APIFOOTBALL_KEY // Használhatja ugyanazt a kulcsot, ha a RapidAPI előfizetés megengedi
    },
    basketball: {
        host: process.env.APIBASKETBALL_HOST || 'api-basketball.p.rapidapi.com',
        key: process.env.APIBASKETBALL_KEY || process.env.APIFOOTBALL_KEY // Használhatja ugyanazt a kulcsot
    }
};

// Régi, deprecated nevek (meghagyva a kompatibilitás miatt, de az API_HOSTS az új)
export const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY;
export const APIFOOTBALL_HOST = process.env.APIFOOTBALL_HOST;


// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Odds API (Már nincs használatban)
export const ODDS_TEAM_NAME_MAP = {
    'spurs': 'Tottenham Hotspur',
    'as roma': 'Roma',
    'hellas verona': 'Verona'
};

// API-SPORTS NÉV TÉRKÉP (Minden sportághoz)
// A 'v37'-es datafetch már ezt használja.
export const APIFOOTBALL_TEAM_NAME_MAP = {
    // Kulcs: A frontendről/ESPN-ről érkező név (kisbetűvel)
    // Érték: A pontos, hivatalos csapatnév, amire az API keresni fog

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

    // Jégkorong (A logok alapján)
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
          // Az API-Hockey ligáknak más az 'country' és 'slug' (pl. a liga ID-ja)
          // Ezt az API-Hockey dokumentációjából kellene pontosítani, de az 'USA' egy jó kezdet
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
