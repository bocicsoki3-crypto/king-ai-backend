import NodeCache from 'node-cache';

// Globális gyorsítótárak a ratingeknek (Apps Script PropertiesService helyett)
// stdTTL: 0 azt jelenti, hogy soha nem jár le automatikusan
const ratingCache = new NodeCache({ stdTTL: 0 });
const POWER_RATING_KEY = 'power_ratings_v2';
const MATCH_LOG_KEY = 'match_log_v2';
const NARRATIVE_RATINGS_KEY = 'narrative_ratings_v2';

// --- ÖNTANULÓ ÉS ÉRTÉKELŐ MODULOK (Cache alapú) ---

/**
 * Naplózza a meccs eredményét a ratingek frissítéséhez (Cache-be).
 */
export function logMatchResult(sport, home, away, mu_h, mu_a, actual_gh, actual_ga, confidence, xg_diff) {
    try {
        const log = ratingCache.get(MATCH_LOG_KEY) || [];
        const newEntry = {
            date: new Date().toISOString(), sport, home, away,
            predicted: { h: mu_h, a: mu_a },
            actual: { h: actual_gh, a: actual_ga },
            confidence, xg_diff
        };
        log.push(newEntry);
        if (log.length > 300) log.shift();
        ratingCache.set(MATCH_LOG_KEY, log);
    } catch (e) {
        console.error(`Hiba a meccs naplózása közben: ${e.message}`);
    }
}

/**
 * Frissíti a Power Ratingeket a naplózott meccsek alapján (Cache-ben).
 */
export function updatePowerRatings() {
    const log = ratingCache.get(MATCH_LOG_KEY) || [];
    if (log.length < 20) {
        console.log(`Power Rating frissítés kihagyva, túl kevés új meccs (${log.length}/20).`);
        return;
    }

    const powerRatings = ratingCache.get(POWER_RATING_KEY) || {};
    const learningRate = 0.008;
    log.forEach(match => {
        if (!match.actual || typeof match.actual.h !== 'number' || typeof match.actual.a !== 'number') return;
        const homeTeam = match.home.toLowerCase();
        const awayTeam = match.away.toLowerCase();
        if (!powerRatings[homeTeam]) powerRatings[homeTeam] = { atk: 1, def: 1, matches: 0 };
        if (!powerRatings[awayTeam]) powerRatings[awayTeam] = { atk: 1, def: 1, matches: 0 };
        const homeAtkError = match.actual.h - match.predicted.h;
        const awayAtkError = match.actual.a - match.predicted.a;
        const confidenceWeight = (match.confidence || 5) / 10;
        powerRatings[homeTeam].atk += learningRate * homeAtkError * confidenceWeight;
        powerRatings[awayTeam].atk += learningRate * awayAtkError * confidenceWeight;
        const homeDefError = match.actual.a - match.predicted.h;
        const awayDefError = match.actual.h - match.predicted.a;
        powerRatings[homeTeam].def -= learningRate * homeDefError * confidenceWeight;
        powerRatings[awayTeam].def -= learningRate * awayDefError * confidenceWeight;
        powerRatings[homeTeam].atk = Math.max(0.7, Math.min(1.3, powerRatings[homeTeam].atk));
        powerRatings[homeTeam].def = Math.max(0.7, Math.min(1.3, powerRatings[homeTeam].def));
        powerRatings[awayTeam].atk = Math.max(0.7, Math.min(1.3, powerRatings[awayTeam].atk));
        powerRatings[awayTeam].def = Math.max(0.7, Math.min(1.3, powerRatings[awayTeam].def));
        powerRatings[homeTeam].matches++;
        powerRatings[awayTeam].matches++;
    });

    ratingCache.set(POWER_RATING_KEY, powerRatings);
    ratingCache.set(MATCH_LOG_KEY, []); // Ürítjük a logot
    console.log(`Power ratingek sikeresen frissítve ${log.length} meccs alapján (Cache-ben).`);
}

/**
 * Lekéri az aktuális Power Ratingeket (Cache-ből).
 * @returns {object} A csapatok Power Ratingjeit tartalmazó objektum.
 */
export function getAdjustedRatings() {
    return ratingCache.get(POWER_RATING_KEY) || {};
}

/**
 * Lekéri az aktuális Narratív Ratingeket (Cache-ből).
 * @returns {object} A csapatok Narratív Ratingjeit tartalmazó objektum.
 */
export function getNarrativeRatings() {
    return ratingCache.get(NARRATIVE_RATINGS_KEY) || {};
}

/**
 * Frissíti a Narratív Ratingeket a kapott tanulságok alapján (Cache-be).
 * @param {Array<object>} learnings Tanulság objektumok tömbje ({team, rating, adjustment}).
 */
export function updateNarrativeRatings(learnings) {
    if (!learnings || learnings.length === 0) return;
    const narrativeRatings = getNarrativeRatings();
    const learningRate = 0.04;
    learnings.forEach(learning => {
        const team = learning.team.toLowerCase();
        if (!narrativeRatings[team]) narrativeRatings[team] = {};
        const ratingName = learning.rating;
        if (!narrativeRatings[team][ratingName]) narrativeRatings[team][ratingName] = 0;
        let currentRating = narrativeRatings[team][ratingName];
        currentRating += learningRate * learning.adjustment;
        narrativeRatings[team][ratingName] = Math.max(-0.4, Math.min(0.4, currentRating));
    });
    ratingCache.set(NARRATIVE_RATINGS_KEY, narrativeRatings); // Frissítjük a cache-t
}