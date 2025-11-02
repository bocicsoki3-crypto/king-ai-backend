// --- VÉGLEGES config.js (v50.8 - Liga nevek javítva) ---

import dotenv from 'dotenv';
dotenv.config();
/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v50.8 JAVÍTÁS: A 'soccer.espn_leagues' kulcsnevei (pl. "MLS")
* frissítve, hogy PONTOSAN megegyezzenek az API-Football
* által várt nevekkel (pl. "Major League Soccer").
* Ez megszünteti a liga-azonosítási hibákat.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- API KULCSOK ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro'; // JAVÍTÁS: 'gemini-2.5-pro'-ra cserélve
export const SHEET_URL = process.env.SHEET_URL;

// --- V42: xG API KONFIGURÁCIÓ ELTÁVOLÍTVA ---
// export const XG_API_KEY = process.env.XG_API_KEY; // ELTÁVOLÍTVA
// export const XG_API_HOST = process.env.XG_API_HOST; // ELTÁVOLÍTVA

// === JAVÍTÁS: Új sportágak kulcsainak hozzáadása ===
export const HOCKEY_API_KEY = process.env.HOCKEY_API_KEY;
export const HOCKEY_API_HOST = process.env.HOCKEY_API_HOST || 'ice-hockey-data.p.rapidapi.com';
export const BASKETBALL_API_KEY = process.env.BASKETBALL_API_KEY;
export const BASKETBALL_API_HOST = process.env.BASKETBALL_API_HOST || 'basketball-api.p.rapidapi.com';
// =================================================

// --- V41: API HOST TÉRKÉP (KULCSROTÁCIÓVAL) ---
// Az API-Sports (API-Football) kulcsai
export const API_HOSTS = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        keys: [
            process.env.APIFOOTBALL_KEY_1,
            process.env.APIFOOTBALL_KEY_2,
            process.env.APIFOOTBALL_KEY_3 // <-- ITT AZ ÚJ KULCS
        ].filter(Boolean) // Kiszűri az üres/undefined kulcsokat
    },
    hockey: {
        host: process.env.APIHOCKEY_HOST || 'api-hockey.p.rapidapi.com',
        keys: [
            // JAVÍTÁS: A veszélyes fallback (|| process.env.APIFOOTBALL_KEY_1) eltávolítva.
            process.env.APIHOCKEY_KEY_1,
            process.env.APIHOCKEY_KEY_2,
            process.env.APIHOCKEY_KEY_3
        ].filter(Boolean)
    },
    basketball: {
        host: process.env.APIBASKETBALL_HOST || 'api-basketball.p.rapidapi.com',
        keys: [
            // JAVÍTÁS: A veszélyes fallback (|| process.env.APIFOOTBALL_KEY_1) eltávolítva.
            process.env.APIBASKETBALL_KEY_1,
            process.env.APIBASKETBALL_KEY_2,
            process.env.APIBASKETBALL_KEY_3
        ].filter(Boolean)
    }
};
// Régi, deprecated nevek
export const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY_1;
export const APIFOOTBALL_HOST = 'api-football-v1.p.rapidapi.com';

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---
export const ODDS_TEAM_NAME_MAP = {
    // ... (nincs használatban)
};
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

    // 
// JAVÍTÁS: A 'Jégkorong' szöveg most már komment
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
        total_minutes: 90, // Hozzáadva a Model.js-hez
        avg_goals: 1.35, // Hozzáadva a Model.js-hez
        home_advantage: { home: 1.05, away: 0.95 }, // Hozzáadva a Model.js-hez
        
        // --- v50.8 JAVÍTÁS: A kulcsnevek frissítve az API-Football által vártakra ---
        // A (v50.3) csökkentett lista visszaállítva a teljes listára, de javított nevekkel
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
            "LaLiga2": { slug: "esp.2", country: "Spain" }, // API-Football ezt "Segunda División"-nak hívja, de LaLiga2-re is találatot adhat
            "J1 League": { slug: "jpn.1", country: "Japan" },
            "Eredivisie": { slug: "ned.1", country: "Netherlands" },
            "Eliteserien": { slug: "nor.1", country: "Norway" },
            "Liga Portugal": { slug: "por.1", country: "Portugal" },
            "Premiership": { slug: "sco.1", country: "Scotland" },
            "Allsvenskan": { slug: "swe.1", country: "Sweden" },
            "Super Lig": { slug: "tur.1", country: "Turkey" },
            "Major League Soccer": { slug: "usa.1", country: "USA" }, // JAVÍTVA: "MLS" -> "Major League Soccer"
            "Liga MX": { slug: "mex.1", country: "Mexico" },
            "Jupiler Pro League": { slug: "bel.1", country: "Belgium" },
            "Serie A Betano": { slug: "rou.1", country: "Romania" }, // API-Football: "Liga I"
            "Superliga": { slug: "den.1", country: "Denmark" },
            "Chance Liga": { slug: "cze.1", country: "Czech Republic"}, // API-Football: "Czech Liga"
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
            "Serie A": { slug: "bra.1", country: "Brazil" }, // API-Football: "Serie A" (Brazil)
            "Serie B": { slug: "bra.2", country: "Brazil" }, // API-Football: "Serie B" (Brazil)
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina" }, // API-Football: "Liga Profesional Argentina"
            "A-League": { slug: "aus.1", country: "Australia" }, // JAVÍTVA: "Australian A-League" -> "A-League"
            "Bundesliga": { slug: "aut.1", country: "Austria" }, // API-Football: "Bundesliga" (Austria)
            "Super League": { slug: "sui.1", country: "Switzerland" }, // JAVÍTVA: "Swiss Super League" -> "Super League"
            "Super League 1": { slug: "gre.1", country: "Greece" }, // JAVÍTVA: "Greek Super League" -> "Super League 1"
            "Czech Liga": { slug: 'cze.1', country: 'Czech Republic' }, // JAVÍTVA: 'Czech First League' -> 'Czech Liga'
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        totals_line: 6.5,
        total_minutes: 60, // Hozzáadva
        avg_goals: 3.0, // Hozzáadva
        home_advantage: { home: 1.0, away: 1.0 }, // Hozzáadva
       espn_leagues: {
 'NHL': { slug: 'nhl', country: 'USA' } 
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        totals_line: 220.5,
        total_minutes: 48, // Hozzáadva
        avg_goals: 110, // Hozzáadva
        home_advantage: { home: 1.0, away: 1.0 }, // Hozzáadva
        espn_leagues: {
  
           'NBA': { slug: 'nba', country: 'USA' },
    
        'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};