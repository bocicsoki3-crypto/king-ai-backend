import dotenv from 'dotenv';

// Környezeti változók betöltése a .env fájlból
dotenv.config();

// API Kulcsok és alap konfigurációk exportálása
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Ennek már az ÚJ Google Cloud kulcsnak kell lennie
export const ODDS_API_KEY = process.env.ODDS_API_KEY;
export const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
export const PLAYER_API_KEY = process.env.PLAYER_API_KEY; // API-SPORTS kulcs
export const SHEET_URL = process.env.SHEET_URL; // Google Sheet URL (opcionális, felülírható a .env-ben)
export const PORT = process.env.PORT || 3000; // Szerver portja

// JAVÍTÁS: Átállás a keresést támogató gemini-1.5-flash-latest modellre
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=' + GEMINI_API_KEY;

// Sportág specifikus konfigurációk
export const SPORT_CONFIG = {
    soccer: {
        name: "soccer", // ESPN API sporthoz
        // Odds API kulcsok ligánként vagy csoportonként
        // A kulcsok a the-odds-api.com dokumentációjából származnak
        odds_api_keys_by_league: {
            // Főbb európai ligák (ezeket egyben is le lehet kérdezni)
            "TOP_LEAGUES_EU": ["Premier League", "LaLiga", "Bundesliga", "Serie A", "Ligue 1"], // Csoportos kulcs - Ezt a kódban lekezeljük
            // UEFA kupák
            "soccer_uefa_champions_league": ["Champions League"],
            "soccer_uefa_europa_league": ["Europa League"],
            "soccer_uefa_europa_conference_league": ["Conference League"], // Hozzáadva és fontos
            // Egyéb fontosabb ligák
            "soccer_portugal_primeira_liga": ["Liga Portugal"],
            "soccer_netherlands_eredivisie": ["Eredivisie"],
            "soccer_belgium_first_div": ["Jupiler Pro League", "Belgian First Division A"],
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
        odds_api_sport_key: "soccer", // Általános kulcs

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
    // Hockey és Basketball változatlan marad
    hockey: {
        name: "hockey",
        odds_api_sport_key: "icehockey_nhl", // Csak egy általános kulcs itt
        odds_api_keys_by_league: { "icehockey_nhl": ["NHL"] }, // Csak NHL
        espn_leagues: { "NHL": "nhl" },
        total_minutes: 60, home_advantage: { home: 1.15, away: 0.85 },
        totals_line: 6.5, avg_goals: 3.1
    },
    basketball: {
        name: "basketball",
        odds_api_sport_key: "basketball_nba", // Csak egy általános kulcs itt
        odds_api_keys_by_league: { "basketball_nba": ["NBA"] }, // Csak NBA
        espn_leagues: { "NBA": "nba" },
        total_minutes: 48, home_advantage: { home: 1.025, away: 0.975 },
        totals_line: 215.5, avg_points: 110
    }
};

// Segédfüggvény (nem kell exportálni, csak belső használatra)
export const SCRIPT_PROPERTIES = { getProperty: (key) => process.env[key] };

/**
 * Megkeresi a megfelelő Odds API sport kulcs(oka)t az ESPN liga neve alapján.
 * @param {string} espnLeagueName Az ESPN által használt liga név.
 * @returns {string} Az Odds API által várt sport kulcs(ok), vesszővel elválasztva ha csoport.
 */
export function getOddsApiKeyForLeague(espnLeagueName) {
    // Alapértelmezett a sportág általános kulcsa
    const sport = 'soccer'; // Jelenleg csak focira van kidolgozva a részletesebb logika
    const sportConfig = SPORT_CONFIG[sport];
    let defaultKey = sportConfig.odds_api_sport_key;

    if (!espnLeagueName || !sportConfig.odds_api_keys_by_league) {
        return defaultKey; // Ha nincs liga név vagy nincs részletes lista, az alap kulcsot adjuk
    }

    const lowerLeagueName = espnLeagueName.toLowerCase();

    // Végigmegyünk a definiált kulcsokon
    for (const [key, leagues] of Object.entries(sportConfig.odds_api_keys_by_league)) {
        // Ellenőrizzük, hogy az ESPN liga neve tartalmazza-e a kulcshoz rendelt nevek valamelyikét
        if (leagues.some(l => lowerLeagueName.includes(l.toLowerCase()))) {
            console.log(`Odds API kulcs választva: ${key} ehhez: ${espnLeagueName}`);
            // Speciális kezelés a csoportos kulcshoz
            if (key === "TOP_LEAGUES_EU") {
                 return "soccer_epl,soccer_spain_la_liga,soccer_germany_bundesliga,soccer_italy_serie_a,soccer_france_ligue_one";
             }
            return key; // Visszaadjuk a specifikus kulcsot
        }
    }

    // Ha nincs specifikus egyezés, megpróbáljuk az általános kulcsot
    console.warn(`Nem található specifikus Odds API kulcs ehhez: ${espnLeagueName}. Általános '${defaultKey}' kulcs használata.`);
    return defaultKey;
}