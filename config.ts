// config.ts (v54.27 - NHL Névtérkép Hozzáadva)

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
export const GEMINI_MODEL_ID: string = process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro';
export const SHEET_URL: string | undefined = process.env.SHEET_URL;

export const HOCKEY_API_KEY: string | undefined = process.env.HOCKEY_API_KEY;
export const HOCKEY_API_HOST: string = process.env.HOCKEY_API_HOST || 'ice-hockey-data.p.rapidapi.com';
export const BASKETBALL_API_KEY: string | undefined = process.env.BASKETBALL_API_KEY;
export const BASKETBALL_API_HOST: string = process.env.BASKETBALL_API_HOST || 'basketball-api.p.rapidapi.com';

// === ÚJ SOFASCORE KONFIGURÁCIÓ ===
export const SOFASCORE_API_KEY: string | undefined = process.env.SOFASCORE_API_KEY; 
export const SOFASCORE_API_HOST: string = process.env.SOFASCORE_API_HOST || 'sportapi7.p.rapidapi.com';
// === VÉGE ===

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
    
    // Jégkorong (Ez a régi, API-Sports térkép itt maradhat referenciaként, de az újat használjuk)
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

// === ÚJ (v54.27): NHL Név Leképezés ===
// Hozzárendeli az ESPN-ben használt neveket (pl. "Sabres") 
// a hivatalos NHL API nevekhez (pl. "Buffalo Sabres").
// Ezt használja a newHockeyProvider (v54.26+).
export const NHL_TEAM_NAME_MAP: { [key: string]: string } = {
    // ESPN név (kisbetűs) : Hivatalos NHL API Név
    'sabres': 'Buffalo Sabres',
    'mammoth': 'Utah Hockey Club', // Javítva a te visszajelzésed alapján
    'avalanche': 'Colorado Avalanche',
    'panthers': 'Florida Panthers',
    'rangers': 'New York Rangers',
    'islanders': 'New York Islanders',
    'devils': 'New Jersey Devils',
    'flyers': 'Philadelphia Flyers',
    'penguins': 'Pittsburgh Penguins',
    'bruins': 'Boston Bruins',
    'canadiens': 'Montréal Canadiens',
    'senators': 'Ottawa Senators',
    'maple leafs': 'Toronto Maple Leafs',
    'hurricanes': 'Carolina Hurricanes',
    'blue jackets': 'Columbus Blue Jackets',
    'capitals': 'Washington Capitals',
    'blackhawks': 'Chicago Blackhawks',
    'red wings': 'Detroit Red Wings',
    'predators': 'Nashville Predators',
    'blues': 'St. Louis Blues',
    'flames': 'Calgary Flames',
    'oilers': 'Edmonton Oilers',
    'canucks': 'Vancouver Canucks',
    'ducks': 'Anaheim Ducks',
    'stars': 'Dallas Stars',
    'kings': 'Los Angeles Kings',
    'sharks': 'San Jose Sharks',
    'kraken': 'Seattle Kraken',
    'golden knights': 'Vegas Golden Knights',
    'coyotes': 'Arizona Coyotes', // Megtartva, hátha régi adat
    'jets': 'Winnipeg Jets',
    'wild': 'Minnesota Wild',
    'lightning': 'Tampa Bay Lightning',
    'utah': 'Utah Hockey Club' // Hozzáadva az "utah" kulcs is
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
            "Serie A (Brazil)": { slug: "bra.1", country: "Brazil" }, 
            "Serie B (Brazil)": { slug: "bra.2", country: "Brazil" }, 
            "Argentinian Liga Profesional": { slug: "arg.1", country: "Argentina" },
            "A-League": { slug: "aus.1", country: "Australia" },
            "Bundesliga (Austria)": { slug: "aut.1", country: "Austria" }, 
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
