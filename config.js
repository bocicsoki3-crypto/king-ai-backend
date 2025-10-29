// --- VÉGLEGES config.js (v37 - API-Football Név Térképezés) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v37 JAVÍTÁS: Hozzáadva az "LAFC" és "Austin FC" az
* APIFOOTBALL_TEAM_NAME_MAP-hez, hogy megoldja a csapat ID
* keresési hibát (log: image_4b7982.png).
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK (v30 - Szétválasztva) ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro';
export const SHEET_URL = process.env.SHEET_URL;

// API-Football specifikus kulcsok
export const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY;
export const APIFOOTBALL_HOST = process.env.APIFOOTBALL_HOST;

// Odds API specifikus kulcsok (MÁR NINCSENEK HASZNÁLATBAN v35 ÓTA)
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const ODDS_API_HOST = process.env.ODDS_API_HOST;

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---

// Bővítsd ezt a listát, ha további eltéréseket találsz az Odds API logokban!
export const ODDS_TEAM_NAME_MAP = {
    // Ez a térkép már nincs aktívan használatban a v35 óta,
    // de itt hagyjuk jövőbeli referenciaként.
    'schalke': 'FC Schalke 04',
    'bremen': 'Werder Bremen',
    'manchester city': 'Man City',
    'manchester united': 'Man United',
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'as roma': 'Roma',
    'hellas verona': 'Verona',
    'como': 'Como',
};

// Bővítsd ezt a listát, ha az API-Football tévesen azonosít egy csapatot!
export const APIFOOTBALL_TEAM_NAME_MAP = {
    // Kulcs: A frontendről/ESPN-ről érkező név (kisbetűvel)
    // Érték: A pontos, hivatalos csapatnév, amire az API-Football keresni fog
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United',
    'man city': 'Manchester City',
    'inter': 'Inter Milan', // Gyakori rövidítés
    'wolves': 'Wolverhampton Wanderers',
    'hellas verona': 'Hellas Verona', // Megakadályozza, hogy az U20-as csapatot találja meg
    
    // --- V37 JAVÍTÁS (image_4b7982.png alapján) ---
    'lafc': 'Los Angeles FC',
    'austin fc': 'Austin FC'
};

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        totals_line: 2.5,
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

            // --- JAVÍTVA: A logokban 400-as hibát okozó slugok ideiglenesen kikommentelve ---
            // "Ekstraklasa": { slug: "pol.1", country: "Poland" },
            // "K League 1": { slug: "kor.1", country: "South Korea" },
            // "HNL": { slug: "cro.1", country: "Croatia" },
            // "NB I.": { slug: "hun.1", country: "Hungary" },
            // "NB I": { slug: "hun.1", country: "Hungary" },
            // "World Cup Qualifier": { slug: "fifa.worldq", country: "World" },
            // "CONCACAF World Cup Qualifying": { slug: "fifa.worldq.concaf", country: "World" },
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
            'Euroleague': { slug: "euroleague", country: "World" }
        },
    },
};
