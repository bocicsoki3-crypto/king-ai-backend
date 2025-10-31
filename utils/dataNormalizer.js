// /src/utils/dataNormalizer.js

/**
 * Ez a térkép "lefordítja" a frontendről érkező neveket
 * azokra az egyedi KULCSOKRA, amiket a config.js-ben definiáltunk.
 */
const leagueAliasMap = new Map([
    // Kulcs: Frontend név (kisbetűvel)
    // Érték: A config.js-ben használt hivatalos API-Sports kulcs
    
    ['argentinian liga profesional', 'Liga Profesional de Fútbol'],
    ['2. bundesliga', '2. Bundesliga'],
    ['super lig', 'Süper Lig'],
    ['brazil serie b', 'Serie B'], // <-- JAVÍTVA
    ['brazil serie a', 'Serie A'], // <-- Hozzáadva a biztonság kedvéért
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
]);


/**
 * Normalizálja a liga nevét az API hívás előtt.
 * @param {string} inputName A frontendről érkező liganev
 * @returns {string} A config.js-ben definiált egyedi kulcs
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
