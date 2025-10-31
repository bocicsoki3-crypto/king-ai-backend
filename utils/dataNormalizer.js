// /src/utils/dataNormalizer.js

/**
 * Ez a térkép lefedi azokat az ismert eltéréseket,
 * amelyek a frontend és a backend (API-Sports) elnevezései között vannak.
 * A KULCSOK mindig kisbetűsek legyenek a könnyebb keresés érdekében.
 */

// === Generált leagueAliasMap ===
// (Ez térképezi át a frontend neveket a hivatalos API nevekre)
const leagueAliasMap = new Map([
    ['argentinian liga profesional', 'Liga Profesional de Fútbol'],
    ['2. bundesliga', '2. Bundesliga'],
    ['super lig', 'Süper Lig'],
    ['brazil serie b', 'Serie B'], // <-- EZ AZ ÚJ SOR
    // TODO: Ide add hozzá a többi ligát, ahogy felmerülnek
]);

// === Generált teamAliasMap ===
// (Ez térképezi át a kisbetűs csapatneveket a hivatalos API nevekre)
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
    ['ferroviária', 'Ferroviária'], // <-- ÚJ SOR
    ['criciúma', 'Criciúma'],       // <-- ÚJ SOR
    // TODO: Ide add hozzá a többi csapatot, ahogy felmerülnek
]);


/**
 * Normalizálja a liga nevét az API hívás előtt.
 * @param {string} inputName A frontendről érkező liganev
 * @returns {string} A hivatalos, API-kompatibilis liganev
 */
export const normalizeLeagueName = (inputName) => {
    if (!inputName) return inputName;
    const lowerCaseName = inputName.trim().toLowerCase();
    return leagueAliasMap.get(lowerCaseName) || inputName; // Visszaadja a mappelt nevet, vagy az eredetit
};

/**
 * Normalizálja a csapat nevét az API hívás előtt.
 * @param {string} inputName A frontendről érkező csapatnév
 * @returns {string} A hivatalos, API-kompatibilis csapatnév
 */
export const normalizeTeamName = (inputName) => {
    if (!inputName) return inputName;
    const lowerCaseName = inputName.trim().toLowerCase();
    return teamAliasMap.get(lowerCaseName) || inputName; // Visszaadja a mappelt nevet, vagy az eredetit
};
