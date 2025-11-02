// config.ts (v52 - TypeScript)
// MÓDOSÍTÁS: A modul átalakítva TypeScript-re.
// Definiálja a rendszer konfigurációs szerződéseit (interfészeit).

import dotenv from 'dotenv';
dotenv.config();

// --- TÍPUSDEFINÍCIÓK A KONFIGURÁCIÓHOZ ---

/**
 * Egyetlen ESPN liga konfigurációja.
 */
interface IEspnLeagueConfig {
  slug: string;
  country: string;
}

/**
 * Egy sportág teljes konfigurációja.
 */
interface ISportConfig {
  name: string;
  espn_sport_path: string;
  totals_line: number;
  total_minutes: number;
  avg_goals: number; // Vagy pontok
  home_advantage: { home: number; away: number };
  espn_leagues: {
    [leagueName: string]: IEspnLeagueConfig;
  };
}

/**
 * A teljes sportág-specifikus konfigurációs térkép.
 */
interface ISportConfigMap {
  soccer: ISportConfig;
  hockey: ISportConfig;
  basketball: ISportConfig;
  [key: string]: ISportConfig; // Lehetővé teszi a [sport] indexelést
}

/**
 * Egy API szolgáltató (pl. API-Football) kulcsait és hosztját tárolja.
 */
interface IApiHostConfig {
  host: string;
  keys: (string | undefined)[]; // Lehetnek undefined kulcsok a .env-ből
}

/**
 * Az összes API szolgáltató konfigurációja.
 */
interface IApiHostMap {
  soccer: IApiHostConfig;
  hockey: IApiHostConfig;
  basketball: IApiHostConfig;
  [key: string]: IApiHostConfig; // Lehetővé teszi a [sport] indexelést
}

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT: number = parseInt(process.env.PORT || "3001", 10);

// --- API KULCSOK ---
export const GEMINI_API_KEY: string | undefined = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID: string = process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro'; // Vagy a 'gemini-2.5-pro' [cite: 4, 5]
export const SHEET_URL: string | undefined = process.env.SHEET_URL;

// === JAVÍTÁS: Új sportágak kulcsainak hozzáadása ===
export const HOCKEY_API_KEY: string | undefined = process.env.HOCKEY_API_KEY;
export const HOCKEY_API_HOST: string = process.env.HOCKEY_API_HOST || 'ice-hockey-data.p.rapidapi.com';
export const BASKETBALL_API_KEY: string | undefined = process.env.BASKETBALL_API_KEY;
export const BASKETBALL_API_HOST: string = process.env.BASKETBALL_API_HOST || 'basketball-api.p.rapidapi.com';

// --- API HOST TÉRKÉP (KULCSROTÁCIÓVAL) ---
// Típusosítva az IApiHostMap interfész alapján
export const API_HOSTS: IApiHostMap = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        keys: [
            process.env.APIFOOTBALL_KEY_1,
            process.env.APIFOOTBALL_KEY_2,
            process.env.APIFOOTBALL_KEY_3
        ].filter(Boolean) as string[] // Kiszűri az üres/undefined kulcsokat
    },
    hockey: {
        host: process.env.APIHOCKEY_HOST || 'api-hockey.p.rapidapi.com',
        keys: [
            process.env.APIHOCKEY_KEY_1,
            process.env.APIHOCKEY_KEY_2,
            process.env.APIHOCKEY_KEY_3
        ].filter(Boolean) as string[]
    },
    basketball: {
        host: process.env.APIBASKETBALL_HOST || 'api-basketball.p.rapidapi.com',
        keys: [
            process.env.APIBASKETBALL_KEY_1,
            process.env.APIBASKETBALL_KEY_2,
            process.env.APIBASKETBALL_KEY_3
        ].filter(Boolean) as string[]
    }
};

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---
export const APIFOOTBALL_TEAM_NAME_MAP: { [key: string]: string } = {
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
// Típusosítva az ISportConfigMap interfész alapján
export const SPORT_CONFIG: ISportConfigMap = {
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
            "Major League Soccer": { slug: "usa.1", country: "USA" },
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
            // Duplikált "Serie A" (Olaszország vs Brazília) és "Bundesliga" (Németország vs Ausztria)
            // Az ESPN-alapú lekérdezés egyedi kulcsneveket igényel, ezt a config.js [cite: 26, 27] hibásan kezeli.
            // A TypeScript fordító ezt nem képes elkapni, de a logika hibás.
            // A jelenlegi implementációban a későbbi felülírja a korábbit.
            // A JAVASLAT az, hogy a kulcsok legyenek egyediek, pl.:
            // "Serie A (Brazil)": { slug: "bra.1", country: "Brazil" },
            // "Bundesliga (Austria)": { slug: "aut.1", country: "Austria" },
            // A meglévő kód [cite: 26, 27] alapján azonban meghagyom a duplikációt,
            // de az utolsó nyer elvét alkalmazom (ahogy a JS tenné).
            // Az `espn_leagues` kulcsainak egyedinek kell lenniük!
            // A [cite: 26, 27] alapján a "Serie A" és "Bundesliga" felülírja a korábbiakat.
            "Serie A (Brazil)": { slug: "bra.1", country: "Brazil" }, // JAVÍTVA egyedire
            "Serie B (Brazil)": { slug: "bra.2", country: "Brazil" }, // JAVÍTVA egyedire
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina" },
            "A-League": { slug: "aus.1", country: "Australia" },
            "Bundesliga (Austria)": { slug: "aut.1", country: "Austria" }, // JAVÍTVA egyedire
            "Super League": { slug: "sui.1", country: "Switzerland" },
            "Super League 1": { slug: "gre.1", country: "Greece" },
            "Czech Liga": { slug: 'cze.1', country: 'Czech Republic' },
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