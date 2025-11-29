// FÁJL: utils/derbyDetection.ts
// VERZIÓ: v134.0
// CÉLJA: Derby meccsek automatikus detektálása (pl. Manchester Derby, Sydney Derby)
// ============================================================================================

/**
 * Derby definíció: Azonos városból származó csapatok meccse.
 * 
 * DERBY HATÁSOK:
 * 1. ❌ A forma NEM számít - a gyengébb csapat extra motivált!
 * 2. 🛡️ Defenzív taktika - bezárkózás, kevés gól
 * 3. 🔥 Pszichológia felülírja a statisztikát - helyi büszkeség
 * 4. 📉 Alacsony confidence - KISZÁMÍTHATATLAN!
 */

// === DERBY PÁROK ADATBÁZIS ===
// Városok ahol ismert derby párosítások vannak

const KNOWN_DERBY_CITIES: { [city: string]: string[] } = {
    // === ANGOL DERBIK ===
    'manchester': ['manchester united', 'manchester city'],
    'liverpool': ['liverpool', 'everton'],
    'london': ['arsenal', 'chelsea', 'tottenham', 'west ham', 'crystal palace', 'fulham', 'brentford'],
    'north london': ['arsenal', 'tottenham'], // Speciális: North London Derby
    'birmingham': ['aston villa', 'birmingham', 'west brom', 'wolves'],
    'sheffield': ['sheffield united', 'sheffield wednesday'],
    'nottingham': ['nottingham forest', 'notts county'],
    
    // === SPANYOL DERBIK ===
    'madrid': ['real madrid', 'atletico madrid', 'rayo vallecano', 'getafe'],
    'barcelona': ['barcelona', 'espanyol'],
    'seville': ['sevilla', 'real betis'],
    'valencia': ['valencia', 'levante'],
    'bilbao': ['athletic bilbao', 'real sociedad'], // Basque Derby
    
    // === OLASZ DERBIK ===
    'milan': ['ac milan', 'inter milan', 'inter'],
    'rome': ['roma', 'lazio'],
    'turin': ['juventus', 'torino'],
    'genoa': ['genoa', 'sampdoria'],
    
    // === NÉMET DERBIK ===
    'munich': ['bayern munich', 'bayern', '1860 munich'],
    'berlin': ['hertha berlin', 'union berlin'],
    'hamburg': ['hamburg', 'st. pauli'],
    'dortmund': ['borussia dortmund', 'schalke'], // Ruhr Derby (Dortmund vs Gelsenkirchen)
    
    // === FRANCIA DERBIK ===
    'paris': ['paris saint germain', 'paris fc', 'psg'],
    'marseille': ['marseille', 'nice'], // Côte d'Azur Derby
    'lyon': ['lyon', 'saint-etienne'], // Rhône Derby
    
    // === SKÓT DERBIK ===
    'glasgow': ['celtic', 'rangers'], // Old Firm
    'edinburgh': ['hearts', 'hibernian'],
    
    // === AUSZTRÁL DERBIK ===
    'sydney': ['sydney fc', 'western sydney wanderers'],
    'melbourne': ['melbourne victory', 'melbourne city'],
    
    // === EGYÉB DERBIK ===
    'athens': ['olympiacos', 'panathinaikos', 'aek athens'],
    'istanbul': ['galatasaray', 'fenerbahce', 'besiktas'],
    'buenos aires': ['boca juniors', 'river plate'], // Superclásico
    'amsterdam': ['ajax', 'feyenoord'], // De Klassieker
    'rotterdam': ['feyenoord', 'sparta rotterdam'],
};

/**
 * Derby detektálás - visszaadja hogy a meccs derby-e
 * @param homeTeamName Hazai csapat neve
 * @param awayTeamName Vendég csapat neve
 * @returns { isDerby: boolean, derbyName: string | null, cityName: string | null }
 */
export function detectDerby(homeTeamName: string, awayTeamName: string): { 
    isDerby: boolean; 
    derbyName: string | null; 
    cityName: string | null;
} {
    const homeLower = homeTeamName.toLowerCase().trim();
    const awayLower = awayTeamName.toLowerCase().trim();
    
    // Végigmegyünk a városokon
    for (const [city, teams] of Object.entries(KNOWN_DERBY_CITIES)) {
        // Ellenőrizzük hogy mindkét csapat ebben a városban van-e
        const homeInCity = teams.some(team => homeLower.includes(team) || team.includes(homeLower));
        const awayInCity = teams.some(team => awayLower.includes(team) || team.includes(awayLower));
        
        if (homeInCity && awayInCity) {
            // DERBY TALÁLT!
            let derbyName = `${city.charAt(0).toUpperCase() + city.slice(1)} Derby`;
            
            // Speciális névkonvenciók
            if (city === 'glasgow' && 
                (homeLower.includes('celtic') || homeLower.includes('rangers')) &&
                (awayLower.includes('celtic') || awayLower.includes('rangers'))) {
                derbyName = 'Old Firm';
            } else if (city === 'buenos aires') {
                derbyName = 'Superclásico';
            } else if (city === 'amsterdam' || city === 'rotterdam') {
                derbyName = 'De Klassieker';
            } else if (city === 'north london') {
                derbyName = 'North London Derby';
            } else if (city === 'bilbao') {
                derbyName = 'Basque Derby';
            } else if (city === 'dortmund') {
                derbyName = 'Revierderby (Ruhr Derby)';
            }
            
            return {
                isDerby: true,
                derbyName,
                cityName: city
            };
        }
    }
    
    // Nincs derby
    return {
        isDerby: false,
        derbyName: null,
        cityName: null
    };
}

/**
 * Derby módosítók - mennyit csökkentse az xG-t és a confidence-t
 */
export const DERBY_MODIFIERS = {
    XG_REDUCTION: 0.80,        // -20% várható gólok (pl. 3.0 → 2.4)
    CONFIDENCE_PENALTY: -2.5,  // -2.5 bizalmi pont
    MIN_CONFIDENCE: 4.5,       // Derby meccsnél MAX 4.5/10 bizalom (KISZÁMÍTHATATLAN!)
};

