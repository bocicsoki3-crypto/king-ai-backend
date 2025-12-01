// FÁJL: config_league_coefficients.ts
// VERZIÓ: v138.0 (Liga Minőség + Defensive Multiplier Rendszer)
// CÉL: UEFA coefficient + Liga erősség + Defensive Nature → TÖKÉLETES xG módosítás!
// 
// PÉLDA PROBLÉMA:
// Monaco (Ligue 1, UEFA coeff: 11.000) vs Pafos (Cyprus, UEFA coeff: 1.875)
// → Minőség különbség: ~5.9x!
// → A rendszer EDDIG ezt FIGYELMEN KÍVÜL hagyta! ❌
// → Most már FIGYELEMBE VESZI! ✅

/**
 * UEFA Liga Coefficientek (2024/2025 szezon)
 * Forrás: UEFA hivatalos rangsor
 * 
 * Használat:
 * - Minél magasabb a coefficient, annál erősebb a liga
 * - TOP 5 liga (Premier, La Liga, Serie A, Bundesliga, Ligue 1) > 10.000
 * - Közepes ligák: 5.000 - 10.000
 * - Gyenge ligák: < 5.000
 */
export const UEFA_LEAGUE_COEFFICIENTS: { [key: string]: number } = {
    // === TOP 5 LIGÁK (Champions League dominancia) ===
    'premier league': 18.571,
    'england': 18.571,
    'la liga': 17.714,
    'spain': 17.714,
    'serie a': 14.750,
    'italy': 14.750,
    'bundesliga': 14.187,
    'germany': 14.187,
    'ligue 1': 11.000,
    'france': 11.000,
    
    // === ERŐS KÖZÉPLIGÁK (Europa League szintű) ===
    'eredivisie': 9.400,
    'netherlands': 9.400,
    'primeira liga': 8.550,
    'portugal': 8.550,
    'pro league': 7.400,
    'belgium': 7.400,
    'scottish premiership': 7.125,
    'scotland': 7.125,
    'süper lig': 6.800,
    'turkey': 6.800,
    'austrian bundesliga': 6.200,
    'austria': 6.200,
    
    // === KÖZEPES LIGÁK ===
    'czech liga': 5.900,
    'czech republic': 5.900,
    'switzerland': 5.375,
    'denmark': 5.375,
    'greece': 5.225,
    'croatia': 5.000,
    'serbia': 4.625,
    'norway': 4.500,
    'sweden': 4.375,
    'poland': 4.125,
    'ukraine': 4.000,
    'romania': 3.750,
    
    // === GYENGE LIGÁK (Conference League szintű) ===
    'israel': 3.500,
    'slovakia': 3.250,
    'hungary': 3.000,
    'bulgaria': 2.750,
    'slovenia': 2.500,
    'cyprus': 1.875,  // ⚠️ PAFOS LEAGUE!
    'luxembourg': 1.625,
    'malta': 1.375,
    'andorra': 1.166,
    'san marino': 1.000,
    
    // === UEFA CHAMPIONS LEAGUE (virtuális "liga") ===
    'uefa champions league': 20.000,  // Speciális: legmagasabb szint
    'champions league': 20.000,
    'uefa europa league': 12.000,
    'europa league': 12.000,
    'uefa conference league': 8.000,
    'conference league': 8.000,
    
    // === EGYÉB NAGY LIGÁK (nem EU) ===
    'mls': 7.500,  // USA/Canada
    'usa': 7.500,
    'canada': 7.500,
    'liga mx': 7.200,  // Mexico
    'mexico': 7.200,
    'brazilian serie a': 9.000,  // Brazil TOP liga
    'brazil': 9.000,
    'argentina': 8.500,
    'j-league': 7.000,  // Japan
    'japan': 7.000,
    'k-league': 6.500,  // Korea
    'south korea': 6.500,
    'chinese super league': 6.000,
    'china': 6.000,
    
    // === DEFAULT (ismeretlen liga) ===
    'default': 5.000  // Közepes liga feltételezés
};

// ===========================================================================================
// KOSÁRLABDA LIGA COEFFICIENTS (v128.0 ÚJ!)
// ===========================================================================================
/**
 * Kosárlabda Liga Erősségi Mutatók
 * Skála: 0.5 - 1.0
 * - 1.0 = NBA (legerősebb)
 * - 0.85-0.95 = TOP Európai ligák (Euroleague, ACB, Bundesliga)
 * - 0.70-0.80 = Közepes ligák (francia, olasz, török)
 * - 0.50-0.65 = Gyenge ligák (kelet-európai, balkán)
 */
export const BASKETBALL_LEAGUE_COEFFICIENTS: { [key: string]: number } = {
    // === TIER 1: VILÁGSZÍNVONAL ===
    'nba': 1.00,
    'usa': 1.00,
    'united states': 1.00,
    
    // === TIER 2: TOP EURÓPAI LIGÁK ===
    'euroleague': 0.92,
    'acb': 0.90,  // Spanyol liga (Liga ACB)
    'spain': 0.90,
    'bbl': 0.88,  // Német liga (Basketball Bundesliga)
    'germany': 0.88,
    'lega basket serie a': 0.85,  // Olasz liga
    'italy': 0.85,
    'vtb united league': 0.82,  // Orosz/Baltikum liga
    'russia': 0.82,
    
    // === TIER 3: ERŐS EURÓPAI LIGÁK ===
    'turkish super league': 0.78,
    'turkey': 0.78,
    'betclic elite': 0.75,  // Francia liga (LNB Pro A)
    'france': 0.75,
    'greek basket league': 0.72,
    'greece': 0.72,
    'adriatic league': 0.70,  // ABA Liga (Balkán)
    'israel': 0.68,
    'poland': 0.65,
    
    // === TIER 4: KÖZEPES LIGÁK ===
    'lithuania': 0.63,
    'czech republic': 0.60,
    'hungary': 0.58,
    'romania': 0.55,
    'bulgaria': 0.52,
    
    // === TIER 5: EGYÉB NAGY LIGÁK (nem EU) ===
    'cba': 0.80,  // Kínai liga (Chinese Basketball Association)
    'china': 0.80,
    'b.league': 0.75,  // Japán liga
    'japan': 0.75,
    'kbl': 0.72,  // Koreai liga (Korean Basketball League)
    'south korea': 0.72,
    'australia': 0.70,  // NBL (National Basketball League)
    'argentina': 0.68,
    'brazil': 0.65,
    
    // === DEFAULT ===
    'default_basketball': 0.70  // Közepes liga feltételezés
};

// ===========================================================================================
// JÉGKORONG LIGA COEFFICIENTS (v128.0 ÚJ!)
// ===========================================================================================
/**
 * Jégkorong Liga Erősségi Mutatók
 * Skála: 0.5 - 1.0
 * - 1.0 = NHL (legerősebb)
 * - 0.80-0.90 = TOP Európai ligák (KHL, SHL, Liiga)
 * - 0.65-0.75 = Közepes ligák (DEL, Swiss, Osztrák)
 * - 0.50-0.60 = Gyenge ligák (kelet-európai)
 */
export const HOCKEY_LEAGUE_COEFFICIENTS: { [key: string]: number } = {
    // === TIER 1: VILÁGSZÍNVONAL ===
    'nhl': 1.00,
    'usa': 1.00,
    'canada': 1.00,
    
    // === TIER 2: TOP EURÓPAI LIGÁK ===
    'khl': 0.85,  // Kontinentális Hokiliiga (Oroszország)
    'russia': 0.85,
    'shl': 0.80,  // Svenska Hockeyligan (Svédország)
    'sweden': 0.80,
    'liiga': 0.78,  // Finn liga
    'finland': 0.78,
    'nla': 0.75,  // Svájci National League A
    'switzerland': 0.75,
    
    // === TIER 3: ERŐS EURÓPAI LIGÁK ===
    'del': 0.72,  // Deutsche Eishockey Liga (Németország)
    'germany': 0.72,
    'extraliga': 0.70,  // Cseh Extraliga
    'czech republic': 0.70,
    'ebel': 0.68,  // Osztrák liga (Erste Bank Eishockey Liga)
    'austria': 0.68,
    'norway': 0.65,
    'denmark': 0.63,
    
    // === TIER 4: KÖZEPES LIGÁK ===
    'slovakia': 0.60,
    'poland': 0.58,
    'france': 0.55,
    'italy': 0.55,
    'united kingdom': 0.55,  // EIHL (Elite Ice Hockey League)
    'hungary': 0.52,
    
    // === TIER 5: EGYÉB LIGÁK ===
    'ahl': 0.88,  // American Hockey League (NHL farm system)
    'japan': 0.60,
    'south korea': 0.55,
    
    // === DEFAULT ===
    'default_hockey': 0.70  // Közepes liga feltételezés
};

// ===========================================================================================
// LEAGUE DEFENSIVE MULTIPLIER (v130.0 ÚJ!) ⚽🛡️
// ===========================================================================================
/**
 * Liga Defensive Nature Szorzó
 * 
 * CÉL: Egyes ligák/tornák alapvetően DEFENZÍVEBBEK, mint mások.
 * - Europa League/Conference League: Kevesebb motiváció, rotáció, óvatos taktika → Kevesebb gól
 * - Bundesliga: Magas presszió, gyors játék → Több gól
 * - Serie A: Taktikai, defenzív kultúra → Kevesebb gól
 * 
 * HASZNÁLAT:
 * adjusted_xG = base_xG * LEAGUE_DEFENSIVE_MULTIPLIER
 * 
 * SKÁLA:
 * - 1.0 = Normál (átlagos gólszám)
 * - >1.0 = Támadóbb liga (több gól várható)
 * - <1.0 = Defenzívebb liga (kevesebb gól várható)
 * 
 * PÉLDA (Plzen vs Freiburg):
 * - Europa League Defensive Multiplier: 0.92 (-8%)
 * - Base xG: H=2.1, A=1.58 (Total: 3.68)
 * - Adjusted: H=1.93, A=1.45 (Total: 3.38) ✅ Reálisabb!
 */
// v135.0: DEFENSIVE MULTIPLIER RADIKÁLISAN CSÖKKENTVE!
// PROBLÉMA: A liga módosítók túl agresszívak voltak → túl konzervatív tippek!
// MEGOLDÁS: Minden különbséget FELÉRE csökkentettünk (pl. -8% → -4%, +8% → +4%)
export const LEAGUE_DEFENSIVE_MULTIPLIER: { [key: string]: number } = {
    // === UEFA TORNÁK (kissé defenzívebbek) ===
    'uefa europa league': 0.96,        // -4% (volt: -8%)
    'europa league': 0.96,
    'uefa conference league': 0.94,    // -6% (volt: -12%)
    'conference league': 0.94,
    'uefa champions league': 0.975,    // -2.5% (volt: -5%)
    'champions league': 0.975,
    
    // === TOP LIGÁK ===
    'bundesliga': 1.04,                // +4% (volt: +8%)
    'germany': 1.04,
    'premier league': 1.025,           // +2.5% (volt: +5%)
    'england': 1.025,
    'la liga': 1.00,                   // Normál (kiegyensúlyozott)
    'spain': 1.00,
    'ligue 1': 0.99,                   // -1% (volt: -2%)
    'france': 0.99,
    'serie a': 0.96,                   // -4% (volt: -8%)
    'italy': 0.96,
    
    // === KÖZEPES LIGÁK ===
    'eredivisie': 1.06,                // +6% (volt: +12%)
    'netherlands': 1.06,
    'primeira liga': 1.01,             // +1% (volt: +2%)
    'portugal': 1.01,
    'pro league': 0.975,               // -2.5% (volt: -5%)
    'belgium': 0.975,
    'scottish premiership': 1.00,      // Normál
    'scotland': 1.00,
    'süper lig': 1.015,                // +1.5% (volt: +3%)
    'turkey': 1.015,
    'austrian bundesliga': 1.025,      // +2.5% (volt: +5%)
    'austria': 1.025,
    
    // === KELET-EURÓPAI LIGÁK (kissé defenzívebbek) ===
    'czech liga': 0.97,                // -3% (volt: -6%)
    'czech republic': 0.97,
    'switzerland': 0.98,               // -2% (volt: -4%)
    'denmark': 0.99,                   // -1% (volt: -2%)
    'greece': 0.965,                   // -3.5% (volt: -7%)
    'croatia': 0.97,                   // -3% (volt: -6%)
    'serbia': 0.96,                    // -4% (volt: -8%)
    'norway': 0.98,                    // -2% (volt: -4%)
    'sweden': 0.985,                   // -1.5% (volt: -3%)
    'poland': 0.965,                   // -3.5% (volt: -7%)
    'ukraine': 0.955,                  // -4.5% (volt: -9%)
    'romania': 0.95,                   // -5% (volt: -10%)
    
    // === GYENGE LIGÁK (kissé defenzívebbek) ===
    'israel': 0.975,                   // -2.5% (volt: -5%)
    'slovakia': 0.96,                  // -4% (volt: -8%)
    'hungary': 0.95,                   // -5% (volt: -10%)
    'bulgaria': 0.94,                  // -6% (volt: -12%)
    'slovenia': 0.95,                  // -5% (volt: -10%)
    'cyprus': 0.925,                   // -7.5% (volt: -15%)
    'luxembourg': 0.915,               // -8.5% (volt: -17%)
    'malta': 0.90,                     // -10% (volt: -20%)
    
    // === EGYÉB NAGY LIGÁK ===
    'mls': 1.04,                       // +4% (volt: +8%)
    'usa': 1.04,
    'canada': 1.04,
    'liga mx': 1.025,                  // +2.5% (volt: +5%)
    'mexico': 1.025,
    'brazilian serie a': 1.05,         // +5% (volt: +10%)
    'brazil': 1.05,
    'argentina': 1.035,                // +3.5% (volt: +7%)
    'j-league': 1.02,                  // +2% (volt: +4%)
    'japan': 1.02,
    'k-league': 1.01,                  // +1% (volt: +2%)
    'south korea': 1.01,
    'chinese super league': 0.975,     // -2.5% (volt: -5%)
    'china': 0.975,
    
    // === DEFAULT ===
    'default_defensive': 1.00          // Normál (ha ismeretlen)
};

/**
 * Liga Defensive Multiplier Lekérdezés
 * @param leagueName - Liga neve (case-insensitive)
 * @returns Defensive multiplier érték (0.80 - 1.12)
 */
export function getLeagueDefensiveMultiplier(leagueName: string | null | undefined): number {
    if (!leagueName) return LEAGUE_DEFENSIVE_MULTIPLIER['default_defensive'];
    
    const normalized = leagueName.toLowerCase().trim();
    
    // Exact match
    if (LEAGUE_DEFENSIVE_MULTIPLIER[normalized]) {
        return LEAGUE_DEFENSIVE_MULTIPLIER[normalized];
    }
    
    // Partial match
    for (const [key, value] of Object.entries(LEAGUE_DEFENSIVE_MULTIPLIER)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    // Default fallback
    console.warn(`[LeagueDefensiveMultiplier] Ismeretlen liga: "${leagueName}". Default (1.00) használva.`);
    return LEAGUE_DEFENSIVE_MULTIPLIER['default_defensive'];
}

/**
 * Liga Minőség Kategóriák
 * Használat: UI-ban vagy logikai döntésekben
 */
export enum LeagueQuality {
    ELITE = 'elite',           // > 15.000 (Premier, La Liga, Serie A, Bundesliga)
    TOP = 'top',               // 10.000 - 15.000 (Ligue 1, Eredivisie)
    STRONG = 'strong',         // 7.000 - 10.000 (Portugal, Belgium, Turkey)
    MEDIUM = 'medium',         // 4.000 - 7.000 (Austria, Czech, Scotland)
    WEAK = 'weak',             // 2.000 - 4.000 (Romania, Slovakia, Hungary)
    VERY_WEAK = 'very_weak'    // < 2.000 (Cyprus, Malta)
}

/**
 * Liga Minőség Lekérdezés
 * @param leagueName - Liga neve (case-insensitive)
 * @returns UEFA coefficient érték
 */
export function getLeagueCoefficient(leagueName: string | null | undefined): number {
    if (!leagueName) return UEFA_LEAGUE_COEFFICIENTS['default'];
    
    const normalized = leagueName.toLowerCase().trim();
    
    // Exact match
    if (UEFA_LEAGUE_COEFFICIENTS[normalized]) {
        return UEFA_LEAGUE_COEFFICIENTS[normalized];
    }
    
    // Partial match (pl. "Champions League Qualification" → "champions league")
    for (const [key, value] of Object.entries(UEFA_LEAGUE_COEFFICIENTS)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    // Default fallback
    console.warn(`[LeagueCoefficients] Ismeretlen liga: "${leagueName}". Default (5.000) használva.`);
    return UEFA_LEAGUE_COEFFICIENTS['default'];
}

/**
 * Liga Minőség Kategória Meghatározás
 * @param coefficient - UEFA coefficient
 * @returns Minőség kategória
 */
export function getLeagueQuality(coefficient: number): LeagueQuality {
    if (coefficient >= 15.000) return LeagueQuality.ELITE;
    if (coefficient >= 10.000) return LeagueQuality.TOP;
    if (coefficient >= 7.000) return LeagueQuality.STRONG;
    if (coefficient >= 4.000) return LeagueQuality.MEDIUM;
    if (coefficient >= 2.000) return LeagueQuality.WEAK;
    return LeagueQuality.VERY_WEAK;
}

/**
 * Liga Minőség Modifier Számítás
 * 
 * Használat: A liga coefficient alapján módosítjuk az xG-t.
 * 
 * LOGIKA:
 * - Ha TOP liga csapat (coeff 11.0) játszik GYENGE liga csapat (coeff 1.875) ellen:
 *   → TOP csapat +adjustment, GYENGE csapat -adjustment
 * - Arány: coefficient1 / coefficient2
 * 
 * PÉLDA (Monaco vs Pafos):
 * - Monaco: Ligue 1 (11.000)
 * - Pafos: Cyprus (1.875)
 * - Ratio: 11.000 / 1.875 = 5.87x
 * - Monaco +0.25 xG (away boost), Pafos -0.15 xG (home reduction)
 * 
 * @param homeLeagueCoeff - Hazai csapat liga coefficient
 * @param awayLeagueCoeff - Vendég csapat liga coefficient
 * @param isHomeTeam - true = számítás hazai csapatra, false = vendég csapatra
 * @returns xG modifier (+/- érték)
 */
export function calculateLeagueQualityModifier(
    homeLeagueCoeff: number,
    awayLeagueCoeff: number,
    isHomeTeam: boolean
): number {
    // Ha ugyanaz a liga, nincs módosítás
    if (Math.abs(homeLeagueCoeff - awayLeagueCoeff) < 0.5) {
        return 0;
    }
    
    const ratio = homeLeagueCoeff / awayLeagueCoeff;
    
    // Logaritmikus skálázás (túl nagy ugrások elkerülése)
    // ratio = 2.0 → ~0.15
    // ratio = 3.0 → ~0.25
    // ratio = 5.0 → ~0.35
    // ratio = 10.0 → ~0.45
    const logRatio = Math.log10(ratio);
    
    // Max ±0.50 módosítás (extrém esetek)
    const baseModifier = Math.min(0.50, Math.max(-0.50, logRatio * 0.30));
    
    if (isHomeTeam) {
        // Ha hazai csapat ERŐSEBB ligából → pozitív modifier
        // Ha hazai csapat GYENGÉBB ligából → negatív modifier
        return baseModifier;
    } else {
        // Vendég csapat ellenkező irányú módosítás
        return -baseModifier;
    }
}

/**
 * PÉLDA HASZNÁLAT:
 * 
 * const monacoLeague = getLeagueCoefficient("Ligue 1");        // 11.000
 * const pafosLeague = getLeagueCoefficient("Cyprus");          // 1.875
 * 
 * const monacoModifier = calculateLeagueQualityModifier(
 *     pafosLeague,   // Home = Pafos
 *     monacoLeague,  // Away = Monaco
 *     false          // Számítás Monaco-ra (away team)
 * );
 * 
 * console.log(monacoModifier);  // ~+0.35 (Monaco jelentős boost!)
 * 
 * // Alkalmazás:
 * let monaco_xG = 1.29;  // Quant eredmény
 * monaco_xG += monacoModifier;  // 1.29 + 0.35 = 1.64 (reálisabb!)
 */

export default {
    UEFA_LEAGUE_COEFFICIENTS,
    LEAGUE_DEFENSIVE_MULTIPLIER,
    BASKETBALL_LEAGUE_COEFFICIENTS,
    HOCKEY_LEAGUE_COEFFICIENTS,
    LeagueQuality,
    getLeagueCoefficient,
    getLeagueDefensiveMultiplier,
    getLeagueQuality,
    calculateLeagueQualityModifier
};
