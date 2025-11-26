// FÁJL: strategies/ISportStrategy.ts
// VERZIÓ: v128.0 (REALITY CHECK MODE - Multi-Sport)
// MÓDOSÍTÁS (v128.0):
// 1. HOZZÁADVA: Az 'XGOptions' interfész bővítve az 'absentees' property-vel.
//    Ez javítja a TS2339 hibát, amit a BasketballStrategy.ts és HockeyStrategy.ts
//    (v128.0) hívása okozott.
// 
// KORÁBBI MÓDOSÍTÁS (v105.0):
// 1. HOZZÁADVA: A 'MicroModelOptions' interfész bővítve a
//    'confidenceScores' objektummal. Ez javítja a TS2353 hibát,
//    amit az AI_Service.ts (v105.0) hívása okozott.

import type {
    ICanonicalStats,
    ICanonicalRawData
} from '../src/types/canonical.d.ts';

// Opciók az estimatePureXG számára
export interface XGOptions {
    homeTeam: string;
    awayTeam: string;
    rawStats: { home: ICanonicalStats, away: ICanonicalStats };
    form: ICanonicalRawData['form'];
    leagueAverages: any;
    advancedData: any; // Tartalmazza a P1 adatokat
    absentees?: ICanonicalRawData['absentees']; // ÚJ v128.0: Kulcsjátékos hiányok
}

// Opciók az estimateAdvancedMetrics számára
export interface AdvancedMetricsOptions {
    rawData: ICanonicalRawData;
    leagueAverages: any;
}

// Opciók a runMicroModels számára
export interface MicroModelOptions {
    sim: any;
    rawDataJson: ICanonicalRawData;
    mainTotalsLine: number;
    // === HOZZÁADVA (v105.0) ===
    confidenceScores: { 
        winner: number; 
        totals: number; 
        overall: number 
    };
    // ==========================
}

/**
 * A "Szerződés", amit minden sportág-stratégiának (foci, hoki, kosár)
 * implementálnia kell.
 */
export interface ISportStrategy {
    
    /**
     * 1. Ügynök (Quant) feladata:
     * Kiszámítja a "tiszta" statisztikai xG-t (vagy pontokat) a sportág szabályai szerint.
     */
    estimatePureXG(options: XGOptions): {
        pure_mu_h: number;
        pure_mu_a: number;
        source: string;
    };

    /**
     * Kiszámítja a másodlagos piacok (pl. szögletek, lapok) várható értékét.
     */
    estimateAdvancedMetrics(options: AdvancedMetricsOptions): {
        mu_corners: number;
        mu_cards: number;
    };
    
    /**
     * 5-6. Ügynök (Hybrid Boss) feladata:
     * Lefuttatja az összes, az adott sportághoz tartozó AI "mikromodellt"
     * (pl. Focinál BTTS/Corners, Hokinál Goals/Winner).
     */
    runMicroModels(options: MicroModelOptions): Promise<{ [key: string]: string }>;
}
