// DataFetch.ts (v52.13 - TS2551 Case-Sensitivity Fix + v54.1 Context Fix)
// ... (Többi import) ...
import { SPORT_CONFIG } from './config.js'; // SZÜKSÉGES IMPORT
import { fetchSofascoreData } from './providers/sofascoreProvider.js';
// ... (Többi import) ...

// ... (Cache és IDataProvider interfész változatlan) ...
// ... (getProvider függvény változatlan) ...

/**
 * FŐ ADATGYŰJTŐ FUNKCIÓ (v54.1 - Ország Kontextus Javítással)
 * Garantálja, hogy a visszatérési érték ICanonicalRichContext.
 */
export async function getRichContextualData(
    sport: string, 
    homeTeamName: string, 
    awayTeamName: string, 
    leagueName: string, 
    utcKickoff: string
): Promise<ICanonicalRichContext> {
    
    const teamNames = [homeTeamName, awayTeamName].sort();
    // A cache kulcs verzióját v54.1-re emeljük az új kontextus miatt
    const ck = `rich_context_v54.1_sofascore_${sport}_${encodeURIComponent(teamNames[0])}_${encodeURIComponent(teamNames[1])}`;
    const cached = scriptCache.get<ICanonicalRichContext>(ck);
    if (cached) {
        console.log(`Cache találat (${ck})`);
        return { ...cached, fromCache: true };
    }
    
    console.log(`Nincs cache (${ck}), friss adatok lekérése...`);
    try {
        
        // 1. Válaszd ki a megfelelő sport providert (Odds, H2H, Alap statok)
        const sportProvider = getProvider(sport);
        console.log(`Adatgyűjtés indul (Provider: ${sportProvider.providerName || sport}): ${homeTeamName} vs ${awayTeamName}...`);

        // === JAVÍTÁS KEZDETE: Ország kontextus kinyerése ===
        const sportConfig = SPORT_CONFIG[sport];
        const leagueData = sportConfig?.espn_leagues[leagueName];
        const countryContext = leagueData?.country || null; // Pl. "USA" vagy "Italy"
        if (!countryContext) {
            console.warn(`[DataFetch] Nincs 'country' kontextus a(z) '${leagueName}' ligához. A Sofascore névfeloldás pontatlan lehet.`);
        }
        // === JAVÍTÁS VÉGE ===

        const providerOptions = {
            sport,
            homeTeamName,
            awayTeamName,
            leagueName,
            utcKickoff
        };

        // === MÓDOSÍTÁS: PÁRHUZAMOS HÍVÁS (Kontextussal) ===
        const [
            // Az 'apiSportsProvider' adja az Odds-okat, H2H-t, és a fallback statisztikákat
            baseResult, 
            // A 'sofascoreProvider' adja a megbízható xG-t és játékos-értékeléseket
            sofascoreData 
        ] = await Promise.all([
             sportProvider.fetchMatchData(providerOptions),
            // Csak foci esetén hívjuk a Sofascore-t, ÉS átadjuk az ország kontextust
            sport === 'soccer' 
                ? fetchSofascoreData(homeTeamName, awayTeamName, countryContext) 
                : Promise.resolve(null)
        ]);

        // === EGYESÍTÉS (MERGE) ===
        const finalResult: ICanonicalRichContext = baseResult;

        // 2. Sofascore xG Adat felülírása (Ha létezik)
        // === JAVÍTÁS (TS2551) ===
        // A 'xg_away' (kis 'g') cserélve 'xG_away'-re (nagy 'G'), hogy megfeleljen a provider típusának.
        if (sofascoreData && sofascoreData.advancedData?.xg_home != null && sofascoreData.advancedData?.xG_away != null) {
            console.log(`[DataFetch] Felülírás: API-Football xG felülírva a Sofascore xG-vel.`);
            finalResult.advancedData.home['xg'] = sofascoreData.advancedData.xg_home;
            finalResult.advancedData.away['xg'] = sofascoreData.advancedData.xG_away; // <-- JAVÍTVA
        } else {
        // === JAVÍTÁS VÉGE ===
            console.warn(`[DataFetch] Sofascore xG adat nem elérhető. Az 'apiSportsProvider' becslése (vagy hibája) marad érvényben.`);
        }

        // 3. Sofascore Játékos Adat felülírása (Ha létezik)
        if (sofascoreData && sofascoreData.playerStats && (sofascoreData.playerStats.home_absentees.length > 0 || sofascoreData.playerStats.away_absentees.length > 0)) {
            console.log(`[DataFetch] Felülírás: Az 'apiSportsProvider' szimulált játékos-adatai felülírva a Sofascore adataival.`);
            finalResult.rawData.detailedPlayerStats = sofascoreData.playerStats;
            finalResult.rawData.absentees = {
                home: sofascoreData.playerStats.home_absentees,
                away: sofascoreData.playerStats.away_absentees
            };
        }
        // === EGYESÍTÉS VÉGE ===

        // 4. Mentsd az egyesített eredményt a fő cache-be
        scriptCache.set(ck, finalResult);
        console.log(`Sikeres adat-egyesítés (v54.1), cache mentve (${ck}).`);
        
        return { ...finalResult, fromCache: false };
    } catch (e: any) {
         console.error(`KRITIKUS HIBA a getRichContextualData (v54.1 - Factory) során (${homeTeamName} vs ${awayTeamName}): ${e.message}`, e.stack);
        throw new Error(`Adatgyűjtési hiba (v54.1): ${e.message}`);
    }
}


// --- KÖZÖS FUNKCIÓK EXPORTÁLÁSA ---
// (Változatlan)
export const _getFixturesFromEspn = commonGetFixtures;
export const _callGemini = commonCallGemini;
