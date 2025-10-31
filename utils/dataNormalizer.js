// /src/utils/dataNormalizer.js

/**
 * === JAVÍTÁS: A leagueAliasMap most már objektumokat tárol ===
 * A kétértelmű ("Serie B") nevek feloldásához
 * most már a nevet ÉS az országot is tároljuk.
 */
const leagueAliasMap = new Map([
    // Kulcs: Frontend név (kisbetűvel)
    // Érték: { officialName: string, country: string }
    ['argentinian liga profesional', { officialName: 'Liga Profesional de Fútbol', country: 'Argentina' }],
    ['2. bundesliga', { officialName: '2. Bundesliga', country: 'Germany' }],
    ['super lig', { officialName: 'Süper Lig', country: 'Turkey' }],
    ['brazil serie b', { officialName: 'Serie B', country: 'Brazil' }], // <-- JAVÍTVA
    // TODO: Ide add hozzá a többi ligát, ahogy felmerülnek
]);

/**
 * A csapatnevek térképe (ez maradhat egyszerű string-string)
 */
const teamAliasMap = new Map([
    // 2. Bundesliga
    ['sv 07 elversberg', 'SV Elversberg'],
    ['hannover 96', 'Hannover 96'],
    // Argentin Liga
    ['san lorenzo', 'San Lorenzo'],
    ['deportivo riestra', 'Deportivo Riestra'],
    // Super Lig
    ['istanbul basaksehir', 'Istanbul Basaksehir'],
    ['kocaelispor', 'Kocaelispor'],
    // Brazil Serie B
    ['ferroviária', 'Ferroviária'],
    ['criciúma', 'Criciúma'],
    // TODO: Ide add hozzá a többi csapatot, ahogy felmerülnek
]);


/**
 * === JAVÍTÁS: A függvény neve 'normalizeLeague'-re változott ===
 * Most már egy objektumot ad vissza { officialName, country }
 * @param {string} inputName A frontendről érkező liganev
 * @returns {{officialName: string, country: string | null}}
 */
export const normalizeLeague = (inputName) => {
    if (!inputName) return { officialName: inputName, country: null };
    
    const lowerCaseName = inputName.trim().toLowerCase();
    const mapping = leagueAliasMap.get(lowerCaseName);

    if (mapping) {
        return mapping; // Visszaadja az objektumot, pl. { officialName: 'Serie B', country: 'Brazil' }
    }
    
    // Visszalépés (Fallback): Ha nincs a térképen, az eredeti nevet adja vissza
    // és null országot (az API-provider majd próbálja kitalálni)
    return { officialName: inputName, country: null };
};

/**
 * Normalizálja a csapat nevét az API hívás előtt. (VÁLTOZATLAN)
 * @param {string} inputName A frontendről érkező csapatnév
 * @returns {string} A hivatalos, API-kompatibilis csapatnév
 */
export const normalizeTeamName = (inputName) => {
    if (!inputName) return inputName;
    const lowerCaseName = inputName.trim().toLowerCase();
    return teamAliasMap.get(lowerCaseName) || inputName; // Visszaadja a mappelt nevet, vagy az eredetit
};
