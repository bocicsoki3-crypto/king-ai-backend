import dotenv from 'dotenv';

dotenv.config();

// API Kulcsok és alap konfigurációk
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // API-SPORTS kulcs
export const SHEET_URL = process.env.SHEET_URL;
export const PORT = process.env.PORT || 3000;

// Gemini API modell (a működő, keresés nélküli)
export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

// Sportág specifikus konfigurációk
export const SPORT_CONFIG = {
    soccer: {
        name: "soccer", // ESPN API sporthoz
        // Odds API kulcsok ligánként vagy csoportonként
        // A kulcsok a the-odds-api.com dokumentációjából származnak
        odds_api_keys_by_league: {
            // Főbb európai ligák (ezeket egyben is le lehet kérdezni)
            "TOP_LEAGUES_EU": ["Premier League", "LaLiga", "Bundesliga", "Serie A", "Ligue 1"], // Csoportos kulcs
            // UEFA kupák
            "soccer_uefa_champions_league": ["Champions League"],
            "soccer_uefa_europa_league": ["Europa League"],
            "soccer_uefa_europa_conference_league": ["Conference League"], // Hozzáadva
            // Egyéb fontosabb ligák
            "soccer_portugal_primeira_liga": ["Liga Portugal"],
            "soccer_netherlands_eredivisie": ["Eredivisie"],
            "soccer_belgium_first_div": ["Jupiler Pro League", "Belgian First Division A"], // Több név is lehet
            "soccer_turkey_super_lig": ["Super Lig"],
            "soccer_brazil_campeonato": ["Brazil Serie A"],
            // Másodosztályok
            "soccer_england_championship": ["Championship"],
            "soccer_germany_bundesliga2": ["2. Bundesliga"],
            "soccer_italy_serie_b": ["Serie B"],
            "soccer_spain_segunda_division": ["LaLiga2"],
             // Válogatott
            "soccer_uefa_nations_league": ["Nemzetek Ligája", "Nations League"],
             "soccer_uefa_european_championship": ["UEFA European Championship", "EURO"],
             "soccer_fifa_world_cup": ["FIFA World Cup", "World Cup"]
             // Ide lehetne még felvenni az odds api doksija alapján
        },
        // Alapértelmezett Odds API sport kulcs (ha nincs specifikus liga egyezés)
        odds_api_sport_key: "soccer", // Általános kulcs, kevesebb meccset ad vissza

        // ESPN ligák (ezek alapján keressük az Odds API kulcsot)
        espn_leagues: {
            "Champions League": "uefa.champions", "Premier League": "eng.1", "Bundesliga": "ger.1",
            "LaLiga": "esp.1", "Serie A": "ita.1", "Europa League": "uefa.europa",
            "Ligue 1": "fra.1", "Eredivisie": "ned.1", "Liga Portugal": "por.1",
            "Championship": "eng.2", "2. Bundesliga": "ger.2", "Serie B": "ita.2",
            "LaLiga2": "esp.2", "Super Lig": "tur.1", "Premiership": "sco.1", // Skót
            "Jupiler Pro League": "bel.1", // Belga
            "MLS": "usa.1", "Conference League": "uefa.europa.conf", // Fontos!
            "Brazil Serie A": "bra.1", "Argentinian Liga Profesional": "arg.1",
            "Greek Super League": "gre.1", "Nemzetek Ligája": "uefa.nations.league.a",
            "UEFA European Championship": "uefa.euro", "FIFA World Cup": "fifa.world"
        },
        total_minutes: 90, home_advantage: { home: 1.18, away: 0.82 },
        totals_line: 2.5, avg_goals: 1.35
    },
    // Hockey és Basketball változatlan marad az előző verzióból
    hockey: { /* ... */ odds_api_sport_key: "icehockey_nhl", /* ... */ },
    basketball: { /* ... */ odds_api_sport_key: "basketball_nba", /* ... */ }
};

// Segédfüggvény (nem kell exportálni, csak belső használatra)
export const SCRIPT_PROPERTIES = { getProperty: (key) => process.env[key] };

/**
 * Megkeresi a megfelelő Odds API sport kulcs(oka)t az ESPN liga neve alapján.
 * @param {string} espnLeagueName Az ESPN által használt liga név.
 * @returns {string} Az Odds API által várt sport kulcs(ok), vesszővel elválasztva ha csoport.
 */
export function getOddsApiKeyForLeague(espnLeagueName) {
    if (!espnLeagueName) return SPORT_CONFIG.soccer.odds_api_sport_key; // Alapértelmezett, ha nincs liga név

    const lowerLeagueName = espnLeagueName.toLowerCase();

    // Először a specifikus kulcsokat nézzük
    for (const [key, leagues] of Object.entries(SPORT_CONFIG.soccer.odds_api_keys_by_league)) {
        // Pontosabb ellenőrzés: az ESPN névnek tartalmaznia kell a kulcshoz tartozó név valamelyikét
        if (leagues.some(l => lowerLeagueName.includes(l.toLowerCase()))) {
            console.log(`Odds API kulcs választva: ${key} ehhez: ${espnLeagueName}`);
            // Ha a kulcs a TOP_LEAGUES_EU, akkor a megfelelő ligákat adjuk vissza vesszővel elválasztva
            if (key === "TOP_LEAGUES_EU") {
                 return "soccer_epl,soccer_spain_la_liga,soccer_germany_bundesliga,soccer_italy_serie_a,soccer_france_ligue_one";
             }
            return key; // Visszaadjuk a specifikus kulcsot
        }
    }

    // Ha nincs specifikus egyezés, az általános kulcsot adjuk vissza
    console.warn(`Nem található specifikus Odds API kulcs ehhez: ${espnLeagueName}. Általános '${SPORT_CONFIG.soccer.odds_api_sport_key}' kulcs használata.`);
    return SPORT_CONFIG.soccer.odds_api_sport_key;
}