// /src/utils/dataNormalizer.js

/**
 * === JAVÍTÁS: Visszaállás a string-alapú fordításra ===
 * Ahelyett, hogy új paramétert (country) adnánk át, 
 * magát a liga nevét tesszük egyértelműbbé az API keresője számára.
 */
const leagueAliasMap = new Map([
    // Kulcs: Frontend név (kisbetűvel)
    // Érték: Hivatalos (vagy egyértelműsített) API keresőnév
    ['argentinian liga profesional', 'Liga Profesional de Fútbol'],
    ['2. bundesliga', '2. Bundesliga'],
    ['super lig', 'Süper Lig'],
    
    // JAVÍTÁS: "Serie B" helyett egyértelmű keresőszót adunk meg, 
    // amit az API-provider országgal együtt tud keresni.
    ['brazil serie b', 'Brazil: Serie B'], 
    // TODO: Ide add hozzá a többi ligát, ahogy felmerülnek
]);

/**
 * A csapatnevek térképe (VÁLTOZATLAN)
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
 * === JAVÍTÁS: Visszaálltunk 'normalizeLeagueName'-re ===
 * A függvény újra csak egy stringet ad vissza, nem objektumot.
 * @param {string} inputName A frontendről érkező liganev
 * @returns {string} A hivatalos vagy egyértelműsített liganev
 */
export const normalizeLeagueName = (inputName) => {
    if (!inputName) return inputName;
    const lowerCaseName = inputName.trim().toLowerCase();
    return leagueAliasMap.get(lowerCaseName) || inputName; // Visszaadja a mappelt nevet, vagy az eredetit
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
