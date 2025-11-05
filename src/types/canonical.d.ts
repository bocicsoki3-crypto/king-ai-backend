// FÁJL: src/types/canonical.d.ts
// VERZIÓ: v62.1 (P1 Manuális Roster Választó - 1. Lépés)
// MÓDOSÍTÁS:
// 1. ÚJ INTERFÉSZ: 'IPlayerStub' hozzáadva, hogy definiálja
//    a választható játékosok listájának elemeit.
// 2. Az 'ICanonicalRawData'  és az 'ICanonicalRichContext' 
//    interfészek kiegészítve egy új, 'availableRosters' mezővel.
// 3. Ez az új mező fogja tárolni a teljes csapatkeretet,
//    amelyet a 'script.js' megjelenít a P1-es
//    hiányzó-kiválasztáshoz.
// 4. JAVÍTVA: Minden szintaktikai hiba eltávolítva.

// Ezen interfészek definiálják a rendszeren belüli "adatszerződést".
// A Providerek (pl. apiSportsProvider) felelőssége, hogy az API válaszaikat
// ezen interfészeknek megfelelő objektumokká alakítsák.
// A Fogyasztók (pl. Model, AnalysisFlow) ezen interfészekre támaszkodnak.

/**
 * A csapatok alapvető statisztikai adatai, amelyeket a Model.ts vár.
 */
export interface ICanonicalStats {
  gp: number;           // Games Played (Lejátszzott meccsek)
  gf: number;           // Goals For (Lőtt gólok / Pontok)
  ga: number;           // Goals Against (Kapott gólok / Pontok)
  form: string | null;  // Forma string (pl. "WWLDW")
  [key: string]: any;  // Egyéb, nem szigorúan típusos statisztikák
}

/**
 * Egyetlen játékos státusza.
 */
export interface ICanonicalPlayer {
  name: string;
  role: string;
  importance: 'key' | 'regular' | 'substitute';
  status: 'confirmed_out' | 'doubtful' | 'active';
  rating_last_5?: number;    // Opcionális, de javasolt
}

/**
 * === ÚJ (v62.1) ===
 * Egyszerűsített játékos-objektum a P1-es keret-kiválasztóhoz.
 */
export interface IPlayerStub {
    id: number;
    name: string;
    pos: string; // Pozíció (G, D, M, F)
}

/**
 * Részletes játékos- és hiányzó-adatok.
 */
export interface ICanonicalPlayerStats {
  home_absentees: ICanonicalPlayer[];
  away_absentees: ICanonicalPlayer[];
  key_players_ratings: {
    home: { [role: string]: number };
    away: { [role: string]: number };
  };
}

/**
 * A piaci szorzók kanonikus formája.
 */
export interface ICanonicalOdds {
  current: { name: string; price: number }[];
  allMarkets: {
    key: string;
    outcomes: {
      name: string;
      price: number;
      point?: number | null;
    }[];
  }[];
  fullApiData: any; // A nyers API válasz tárolása (pl. 'findMainTotalsLine' számára)
  fromCache: boolean;
}

/**
 * Strukturált időjárási adatokat definiál (v55.4).
 */
export interface IStructuredWeather {
    description: string;
    temperature_celsius: number | null;
    humidity_percent?: number | null;
    wind_speed_kmh: number | null;
    precipitation_mm: number | null;
    source?: 'Open-Meteo' | 'N/A';
}


/**
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.ts-hez gyűjtünk.
 * === MÓDOSÍTVA (v62.1) ===
 */
export interface ICanonicalRawData {
  stats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
  apiFootballData?: {
    fixtureId: number | string | null;
    leagueId: number | string | null;
    [key: string]: any;
  };
  detailedPlayerStats: ICanonicalPlayerStats;
  h2h_structured: any[] | null;
  form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  absentees: {
    home: ICanonicalPlayer[];
    away: ICanonicalPlayer[];
  };
  referee: {
    name: string | null;
    style: string | null; // v58.1
  };
  contextual_factors: {
    stadium_location: string | null;
    pitch_condition: string | null;
    weather: string | null;
    match_tension_index: string | null;
    structured_weather: IStructuredWeather; 
    coach: { // v58.1
        home_name: string | null;
        away_name: string | null;
    };
  };
  
  // === ÚJ (v62.1) ===
  // A teljes elérhető keret a P1-es kiválasztáshoz
  availableRosters: {
    home: IPlayerStub[];
    away: IPlayerStub[];
  };
  // === VÉGE ===

  [key: string]: any;
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.ts felhasznál.
 * === MÓDOSÍTVA (v62.1) ===
 */
export interface ICanonicalRichContext {
  rawStats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
  richContext: string;
  advancedData: {
    home: { [key:string]: any };
    away: { [key:string]: any };
  };
  form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  rawData: ICanonicalRawData; // Ez már tartalmazza a v62.1-es mezőket
  leagueAverages: { [key: string]: any };
  oddsData: ICanonicalOdds | null;
  fromCache: boolean;

  // === ÚJ (v62.1) ===
  // Ezt küldjük a kliensnek a lista feltöltéséhez
  availableRosters: {
    home: IPlayerStub[];
    away: IPlayerStub[];
  };
  // === VÉGE ===
}

/**
 * A 'FixtureResult' típus központosítása.
 */
export type FixtureResult = {
    home: number;
    away: number;
    status: 'FT';
} | {
    status: string;
    home?: undefined;
    away?: undefined;
} | null;
