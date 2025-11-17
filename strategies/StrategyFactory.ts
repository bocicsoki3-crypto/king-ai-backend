// FÁJL: strategies/StrategyFactory.ts
// CÉL: Ez a "Gyár" felelős azért, hogy a 'sport' string alapján
// visszaadja a megfelelő, konkrét stratégia objektumot.

// A .js kiterjesztések fontosak a Node.js TypeScript importokhoz
import type { ISportStrategy } from './ISportStrategy.js';
import { SoccerStrategy } from './SoccerStrategy.js';
import { HockeyStrategy } from './HockeyStrategy.js';
import { BasketballStrategy } from './BasketballStrategy.js';

/**
 * Visszaadja a sportágnak megfelelő elemzési stratégia objektumot.
 * @param sport A sportág neve (pl. "soccer", "hockey")
 * @returns Az ISportStrategy interfészt implementáló objektum.
 */
export function getSportStrategy(sport: string): ISportStrategy {
    const lowerSport = sport.toLowerCase();
    switch (lowerSport) {
        case 'soccer':
            return new SoccerStrategy();
        case 'hockey':
            return new HockeyStrategy();
        case 'basketball':
            return new BasketballStrategy();
        default:
            console.warn(`[StrategyFactory] Ismeretlen sportág: '${sport}'. Alapértelmezett (Soccer) stratégia használata.`);
            // Alapértelmezettként a Soccer-t adjuk vissza, hogy elkerüljük a null hibákat
            return new SoccerStrategy();
    }
}
