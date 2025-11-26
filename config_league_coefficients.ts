// FÁJL: config_league_coefficients.ts
// VERZIÓ: v127.0 (Liga Minőség Faktor Rendszer)
// CÉL: UEFA coefficient + Liga erősség → Valósághű xG módosítás!
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
    LeagueQuality,
    getLeagueCoefficient,
    getLeagueQuality,
    calculateLeagueQualityModifier
};

