// config.ts (v80.1 - Végleges Szinkron Javítás)
// JAVÍTÁS (TS2739): A 'soccer' és 'basketball' definíciók kiegészítve a
// hiányzó 'totals_line', 'total_minutes', 'avg_goals', 'home_advantage'
// kulcsokkal, hogy megfeleljenek az 'ISportConfig' interfésznek.
// JAVÍTÁS (TS2305): Az 'ICEHOCKEYAPI_...' kulcsok VISSZAÁLLÍTVA, hogy
// az 'iceHockeyApiProvider.ts' importálni tudja őket.
// A hibás 'SPORTRADAR_...' kulcsok eltávolítva.

import dotenv from 'dotenv';
dotenv.config();

// --- TÍPUSDEFINÍCIÓK ---
interface IEspnLeagueConfig {
  slug: string;
  country: string;
}
interface ISportConfig {
  name: string;
  espn_sport_path: string;
  totals_line: number;
  total_minutes: number;
  avg_goals: number;
  home_advantage: { home: number; away: number };
  espn_leagues: {
    [leagueName: string]: IEspnLeagueConfig;
  };
}
interface ISportConfigMap {
  soccer: ISportConfig;
  hockey: ISportConfig;
  basketball: ISportConfig;
  [key: string]: ISportConfig;
}
interface IApiHostConfig {
  host: string;
  keys: (string | undefined)[];
}
interface IApiHostMap {
  soccer: IApiHostConfig;
  hockey: IApiHostConfig; 
  basketball: IApiHostConfig;
  [key: string]: IApiHostConfig;
}

// --- SZERVER BEÁLLÍTÁSOK ---
export const PORT: number = parseInt(process.env.PORT || "3001", 10);

// --- API KULCSOK ---
export const GEMINI_API_KEY: string | undefined = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL_ID: string = process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro';
export const SHEET_URL: string | undefined = process.env.SHEET_URL;

// === FOCI (RapidAPI) ===
export const APIFOOTBALL_KEY_1: string | undefined = process.env.APIFOOTBALL_KEY_1;

// === JÉGKORONG (JAVÍTVA: IceHockeyApi - Kontextus) ===
export const ICEHOCKEYAPI_HOST: string = process.env.ICEHOCKEYAPI_HOST || 'icehockeyapi.p.rapidapi.com';
export const ICEHOCKEYAPI_KEY: string | undefined = process.env.ICEHOCKEYAPI_KEY;

// === KOSÁRLABDA (Hagyományos RapidAPI) ===
export const BASKETBALL_API_KEY: string | undefined = process.env.BASKETBALL_API_KEY;
export const BASKETBALL_API_HOST: string = process.env.BASKETBALL_API_HOST || 'basketball-api.p.rapidapi.com';

// === SOFASCORE (RapidAPI) ===
export const SOFASCORE_API_KEY: string | undefined = process.env.SOFASCORE_API_KEY; 
export const SOFASCORE_API_HOST: string = process.env.SOFASCORE_API_HOST || 'sportapi7.p.rapidapi.com';

// === ODDS FEED (MEGOLDVA - Odds-ok) ===
export const ODDS_API_KEY: string | undefined = process.env.ODDS_API_KEY;
export const ODDS_API_HOST: string = process.env.ODDS_API_HOST || 'odds-feed.p.rapidapi.com';


// --- API HOST TÉRKÉP (KULCSROTÁCIÓVAL) ---
export const API_HOSTS: IApiHostMap = {
    soccer: {
        host: process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        keys: [
            process.env.APIFOOTBALL_KEY_1,
            process.env.APIFOOTBALL_KEY_2,
            process.env.APIFOOTBALL_KEY_3
        ].filter(Boolean) as string[]
    },
    hockey: {
        host: ICEHOCKEYAPI_HOST, // JAVÍTVA: A helyes host
        keys: ICEHOCKEYAPI_KEY ? [ICEHOCKEYAPI_KEY] : ['icehockey-placeholder-key'], 
    },
    basketball: {
        host: BASKETBALL_API_HOST,
        keys: [process.env.BASKETBALL_API_KEY].filter(Boolean) as string[]
    }
};

// --- CSAPATNÉV HOZZÁRENDELÉSEK ---
// FOCI TÉRKÉP (Változatlan)
export const APIFOOTBALL_TEAM_NAME_MAP: { [key: string]: string } = {
    'spurs': 'Tottenham Hotspur',
    'tottenham': 'Tottenham Hotspur',
    'man utd': 'Manchester United',
// ... (többi foci csapat)
};

// JÉGKORONG TÉRKÉP (v54.27)
export const NHL_TEAM_NAME_MAP: { [key: string]: string } = {
    'sabres': 'Buffalo Sabres',
    'mammoth': 'Utah Hockey Club',
    'avalanche': 'Colorado Avalanche',
// ... (többi hoki csapat)
    'utah': 'Utah Hockey Club'
};

// --- SPORTÁG-SPECIFIKUS KONFIGURÁCIÓ ---
export const SPORT_CONFIG: ISportConfigMap = {
    soccer: {
        name: 'labdarúgás',
        espn_sport_path: 'soccer',
        // JAVÍTÁS (TS2739): Hiányzó kulcsok hozzáadva
        totals_line: 2.5,
        total_minutes: 90,
        avg_goals: 1.35,
        home_advantage: { home: 1.05, away: 0.95 },
        espn_leagues: {
            "Premier League": { slug: "eng.1", country: "England" },
            "Championship": { slug: "eng.2", country: "England" },
            "Ligue 1": { slug: "fra.1", country: "France" },
// ... (többi foci liga)
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
        // JAVÍTÁS (TS2739): Hiányzó kulcsok hozzáadva
        totals_line: 220.5,
        total_minutes: 48,
        avg_goals: 110.0,
        home_advantage: { home: 1.0, away: 1.0 },
        espn_leagues: {
           'NBA': { slug: 'nba', country: 'USA' },
           'Euroleague': { slug: 'euroleague', country: 'World' }
        },
    },
};
