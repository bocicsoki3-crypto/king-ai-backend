import dotenv from 'dotenv';

// Környezeti változók betöltése a .env fájlból
dotenv.config();

// API Kulcsok és alap konfigurációk exportálása
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // API-SPORTS kulcs
export const SHEET_URL = process.env.SHEET_URL; // Google Sheet URL (opcionális, felülírható a .env-ben)
export const PORT = process.env.PORT || 3000; // Szerver portja

// Gemini API modell és URL (A működő, keresés nélküli modell)
export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

// Sportág specifikus konfigurációk
export const SPORT_CONFIG = {
    soccer: {
        name: "soccer", // ESPN API sporthoz
        // JAVÍTÁS: Odds API kulcsok ligánként vagy csoportonként a pontosabb lekérdezéshez
        // Ezeket a kulcsokat használja majd a DataFetch.js intelligensen
        odds_api_keys_by_league: {
            // Főbb európai ligák
            "soccer_epl": ["Premier League"],
            "soccer_spain_la_liga": ["LaLiga"],
            "soccer_germany_bundesliga": ["Bundesliga"],
            "soccer_italy_serie_a": ["Serie A"],
            "soccer_france_ligue_one": ["Ligue 1"],
            // UEFA kupák
            "soccer_uefa_champions_league": ["Champions League"],
            "soccer_uefa_europa_league": ["Europa League"],
            "soccer_uefa_europa_conference_league": ["Conference League"],
            // Egyéb fontosabb ligák (bővíthető)
            "soccer_portugal_primeira_liga": ["Liga Portugal"],
            "soccer_netherlands_eredivisie": ["Eredivisie"],
            "soccer_belgium_first_div": ["Jupiler Pro League"], // ESPN vs Odds API név eltérhet!
            "soccer_turkey_super_lig": ["Super Lig"],
            "soccer_brazil_campeonato": ["Brazil Serie A"],
            // Másodosztályok (ha szükséges)
            "soccer_england_championship": ["Championship"],
            "soccer_germany_bundesliga2": ["2. Bundesliga"],
            "soccer_italy_serie_b": ["Serie B"],
            "soccer_spain_segunda_division": ["LaLiga2"],
             // Válogatott (Odds API kulcsok változhatnak!)
            "soccer_uefa_nations_league": ["Nemzetek Ligája"],
             "soccer_uefa_european_championship": ["UEFA European Championship"],
             "soccer_fifa_world_cup": ["FIFA World Cup"]
        },
        // ESPN ligák a meccsek listázásához (ez marad a régi)
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
            "Premiership": "sco.1", // Skót bajnokság
            "Jupiler Pro League": "bel.1", // Belga bajnokság (Odds API máshogy hívhatja)
            "MLS": "usa.1",
            "Conference League": "uefa.europa.conf",
            "Brazil Serie A": "bra.1",
            "Argentinian Liga Profesional": "arg.1",
            "Greek Super League": "gre.1",
            "Nemzetek Ligája": "uefa.nations.league.a",
            "UEFA European Championship": "uefa.euro",
            "FIFA World Cup": "fifa.world" // ESPN kulcs a VB-hez
        },
        total_minutes: 90,
        home_advantage: { home: 1.18, away: 0.82 },
        totals_line: 2.5, // Alapértelmezett gólvonal
        avg_goals: 1.35 // Átlagos gólok meccsenként (csapatonként)
    },
    hockey: {
        name: "hockey",
        odds_api_keys_by_league: { // Csak NHL és KHL példaként
             "icehockey_nhl": ["NHL"],
             "icehockey_khl": ["KHL"]
        },
        espn_leagues: {
            "NHL": "nhl",
            "KHL": null // ESPN lehet nem támogatja, vagy más a slug
        },
        total_minutes: 60,
        home_advantage: { home: 1.15, away: 0.85 },
        totals_line: 6.5,
        avg_goals: 3.1
    },
    basketball: {
        name: "basketball",
         odds_api_keys_by_league: { // Csak NBA és Euroleague példaként
             "basketball_nba": ["NBA"],
             "basketball_euroleague": ["Euroleague"]
         },
        espn_leagues: {
            "NBA": "nba",
            "Euroleague": null // ESPN lehet nem támogatja, vagy más a slug
        },
        total_minutes: 48,
        home_advantage: { home: 1.025, away: 0.975 },
        totals_line: 215.5,
        avg_points: 110 // Átlag pontok meccsenként (csapatonként)
    }
};

// Segédfüggvény a környezeti változók eléréséhez (ha pl. Google Apps Script kontextusban futna)
export const SCRIPT_PROPERTIES = {
    getProperty: function(key) {
        return process.env[key];
    }
};

// Függvény az ESPN liga neve alapján az Odds API kulcs megtalálásához
export function getOddsApiKeyForLeague(espnLeagueName) {
    for (const [key, leagues] of Object.entries(SPORT_CONFIG.soccer.odds_api_keys_by_league)) {
        // Leegyszerűsített ellenőrzés: ha az ESPN név tartalmazza az Odds API listában szereplő nevet
        if (leagues.some(l => espnLeagueName.toLowerCase().includes(l.toLowerCase()))) {
            return key;
        }
    }
     // Ha nincs specifikus kulcs, az általános soccer kulcsot adjuk vissza
     // vagy egy alapértelmezettet, ha az általános sem jó (pl. európai top ligák)
     console.warn(`Nem található specifikus Odds API kulcs ehhez: ${espnLeagueName}. Általános 'soccer' kulcs használata.`);
    return 'soccer_epl,soccer_spain_la_liga,soccer_germany_bundesliga,soccer_italy_serie_a,soccer_france_ligue_one'; // Vészhelyzetre top 5 liga
}