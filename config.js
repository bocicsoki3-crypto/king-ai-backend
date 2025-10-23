import dotenv from 'dotenv';

dotenv.config();

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY;
export const SHEET_URL = process.env.SHEET_URL;
export const PORT = process.env.PORT || 3000;

export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

export const SPORT_CONFIG = {
    soccer: {
        name: "soccer",
        // JAVÍTÁS: Az összes fontos liga megadása az Odds API-nak a megbízható keresésért
        odds_api_leagues: "soccer_uefa_champions_league,soccer_uefa_europa_league,soccer_england_premier_league,soccer_spain_la_liga,soccer_germany_bundesliga,soccer_italy_serie_a,soccer_france_ligue_one,soccer_portugal_primeira_liga,soccer_netherlands_eredivisie,soccer_belgium_first_div,soccer_turkey_super_lig,soccer_uefa_europa_conference_league,soccer_brazil_campeonato",
        espn_leagues: {
            "Champions League": "uefa.champions",
            "Premier League": "eng.1",
            "Bundesliga": "ger.1",
            "LaLiga": "esp.1",
            "Serie A": "ita.1",
            "Europa League": "uefa.europa",
            "Ligue 1": "fra.1",
            "Eredivisie": "ned.1",
            "Liga Portugal": "por.1",
            "Championship": "eng.2",
            "2. Bundesliga": "ger.2",
            "Serie B": "ita.2",
            "LaLiga2": "esp.2",
            "Super Lig": "tur.1",
            "Premiership": "sco.1",
            "MLS": "usa.1",
            "Conference League": "uefa.europa.conf",
            "Brazil Serie A": "bra.1",
            "Argentinian Liga Profesional": "arg.1",
            "Greek Super League": "gre.1",
            "Nemzetek Ligája": "uefa.nations.league.a",
            "UEFA European Championship": "uefa.euro"
        },
        total_minutes: 90,
        home_advantage: { home: 1.18, away: 0.82 },
        totals_line: 2.5,
        avg_goals: 1.35
    },
    hockey: {
        name: "hockey",
        odds_api_leagues: "icehockey_nhl,icehockey_khl", 
        espn_leagues: {
            "NHL": "nhl"
        },
        total_minutes: 60,
        home_advantage: { home: 1.15, away: 0.85 },
        totals_line: 6.5,
        avg_goals: 3.1
    },
    basketball: {
        name: "basketball",
        odds_api_leagues: "basketball_nba,basketball_euroleague",
        espn_leagues: {
            "NBA": "nba"
        },
        total_minutes: 48,
        home_advantage: { home: 1.025, away: 0.975 },
        totals_line: 215.5,
        avg_points: 110
    }
};

export const SCRIPT_PROPERTIES = {
    getProperty: function(key) {
        return process.env[key];
    }
};