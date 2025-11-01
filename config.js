// --- VÉGLEGES config.js (v47 - Környezeti Változó Javítással) ---

import dotenv from 'dotenv';
dotenv.config();

/**************************************************************
* config.js - Központi Konfigurációs Fájl
* v47 JAVÍTÁS: Az API_HOSTS objektum most már azokat a
* környezeti változó neveket (pl. HOCKEY_API_KEY) használja,
* amelyeket a felhasználó a hoszting platformon beállított,
* megszüntetve a "Nincsenek API kulcsok" hibát.
**************************************************************/

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT = process.env.PORT || 3001;

// --- GOOGLE AI & SHEETS ---
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID = 'gemini-2.5-pro';
export const SHEET_URL = process.env.SHEET_URL;

// --- XG API (Ha használatban van) ---
export const XG_API_KEY = process.env.XG_API_KEY;
export const XG_API_HOST = process.env.XG_API_HOST || 'football-xg-statistics.p.rapidapi.com';

// --- API HOST TÉRKÉP (KULCSROTÁCIÓVAL) ---
// Ez az objektum az egyetlen "igazság forrása" (Single Source of Truth)
// az összes RapidAPI alapú sportszolgáltatáshoz.
export const API_HOSTS = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        keys: [
            // Használja az env.txt-ben definiált nevet
            process.env.APIFOOTBALL_API_KEY, 
            // Vagy ha a régi, számozott neveket használja, azokat is megadhatja:
            // process.env.APIFOOTBALL_KEY_1,
            // process.env.APIFOOTBALL_KEY_2,
        ].filter(Boolean) // Kiszűri az üres/undefined kulcsokat
    },
    hockey: {
        // JAVÍTÁS: A képernyőfotón látható neveket használjuk
        host: process.env.HOCKEY_API_HOST, 
        keys: [
            process.env.HOCKEY_API_KEY 
            // Ha több kulcsa van, HOCKEY_API_KEY_2 néven adja hozzá
        ].filter(Boolean)
    },
    basketball: {
        // JAVÍTÁS: Feltételezzük, hogy a kosárlabdánál is
        // a HOCKEY_ mintát követi a változók elnevezése.
        host: process.env.BASKETBALL_API_HOST,
        keys: [
            process.env.BASKETBALL_API_KEY
        ].filter(Boolean)
    }
};

// --- ELAVULT, REDUNDÁNS EXPORTÁLÁSOK (TÖRÖLVE) ---
// Az alábbi kulcsok már az API_HOSTS objektumban vannak definiálva.
// Innen töröljük őket, hogy elkerüljük a zavart.
// export const HOCKEY_API_KEY = ... (TÖRÖLVE)
// export const HOCKEY_API_HOST = ... (TÖRÖLVE)
// export const BASKETBALL_API_KEY = ... (TÖRÖLVE)
// export const BASKETBALL_API_HOST = ... (TÖRÖLVE)
// export const APIFOOTBALL_KEY = ... (TÖRÖLVE)
// export const APIFOOTBALL_HOST = ... (TÖRÖLVE)

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---
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

    // Jégkorong (Az apiSportsProvider használja)
    'senators': 'Ottawa Senators',
    'flames': 'Calgary Flames',
    'lightning': 'Tampa Bay Lightning',
    'stars': 'Dallas Stars',
    'flyers': 'Philadelphia Flyers',
    'predators': 'Nashville Predators',
    'hurricanes': 'Carolina Hurricanes',
    'islanders': 'New York Islanders',
    'wild': 'Minnesota Wild',
    'penguins': 'Pittsburgh Penguins',
    'jets': 'Winnipeg Jets' // Hozzáadva a teszteléshez
};

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        totals_line: 2.5,
        total_minutes: 90, 
        avg_goals: 1.35, 
        home_advantage: { home: 1.05, away: 0.95 },
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
        },
    },
    hockey: {
        name: 'jégkorong',
        espn_sport_path: 'hockey',
        totals_line: 6.5,
        total_minutes: 60,
        avg_goals: 3.0,
        home_advantage: { home: 1.0, away: 1.0 }, 
        espn_leagues: {
            'NHL': { slug: 'nhl', country: 'USA' } 
        },
    },
    basketball: {
        name: 'kosárlabda',
        espn_sport_path: 'basketball',
        totals_line: 220.5,
        total_minutes: 48,
        avg_goals: 110,
        home_advantage: { home: 1.0, away: 1.0 },
        espn_leagues: {
            'NBA': { slug: 'nba', country: 'USA' },
            'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};
