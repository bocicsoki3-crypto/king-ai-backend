import dotenv from 'dotenv';

// Beolvassa a .env fájl tartalmát a process.env objektumba
dotenv.config();

// API Kulcsok és egyéb konfigurációk exportálása
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // Még ha nincs is, definiáljuk
export const SHEET_URL = process.env.SHEET_URL;
export const PORT = process.env.PORT || 3000; // Alapértelmezett port 3000, ha nincs megadva

// === JAVÍTÁS: Azt a modellt használjuk, amihez a kulcsod hozzáfér ===
export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
// ====================================================================

// Sportág specifikus konfigurációk
export const SPORT_CONFIG = {
    soccer: {
        name: "soccer", // ESPN API-hoz
        odds_api_sport_key: "soccer_brazil_campeonato", 
        espn_leagues: { // ESPN ligák a meccsek lekéréséhez
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
        odds_api_sport_key: "icehockey_nhl", 
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
        odds_api_sport_key: "basketball_nba",
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