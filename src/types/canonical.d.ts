// FÁJL: src/types/canonical.d.ts
// VERZIÓ: v113.0 (Deep Scout Types Integrated)
// MÓDOSÍTÁS:
// 1. ÚJ INTERFÉSZEK: IDeepScoutResult, IDeepScoutStructuredData, IDeepScoutXgStats, stb.
//    Ezek definálják a 0. Ügynök (Deep Scout) válaszát.
// 2. CÉL: Típusbiztonság a DataFetch.ts és AI_Service.ts számára.

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
  // Role: Kapus, Védő, Középpályás, Támadó, vagy Ismeretlen (A DataFetch.ts-ben van mapelve)
  role: 'Kapus' | 'Védő' | 'Középpályás' | 'Támadó' | 'Ismeretlen'; 
  importance: 'key' | 'regular' | 'substitute';
  status: 'confirmed_out' | 'doubtful' | 'active';
  rating_last_5?: number;    // Opcionális, de javasolt
  confidence?: 'confirmed' | 'unverified';
  source?: 'manual' | 'provider' | 'manual+provider' | string;
}

/**
 * Egyszerűsített játékos-objektum a P1-es keret-kiválasztóhoz.
 * (Ez a Kanban kártya adatmodellje)
 */
export interface IPlayerStub {
    id: number;
    name: string;
    pos: string; // Pozíció (G, D, M, F)
    rating_last_5: number; // Placeholder rating a P1-es hiányzó-logikához
}

/**
 * Részletes játékos- és hiányzó-adatok.
 */
export interface ICanonicalPlayerStats {
  home_absentees: ICanonicalPlayer[];
  away_absentees: ICanonicalPlayer[];
  key_players_ratings: {
    home: { [key: string]: number };
    away: { [key: string]: number };
  };
}

export interface IAbsenceConfidenceMeta {
  confirmed: string[];
  unverified: string[];
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
  source?: string; // Opcionális forrásmegjelölés
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
 * === ÚJ (v113.0): DEEP SCOUT TÍPUSDEFINÍCIÓK ===
 */

export interface IDeepScoutXgStats {
    home_xg: number | null;
    home_xga: number | null;
    away_xg: number | null;
    away_xga: number | null;
    source: string;
}

export interface IDeepScoutH2H {
    date: string;
    score: string;
    home_team: string;
    away_team: string;
}

export interface IDeepScoutStandings {
    home_pos: number | null;
    home_points: number | null;
    away_pos: number | null;
    away_points: number | null;
}

export interface IDeepScoutLineups {
    home: string[];
    away: string[];
}

export interface IDeepScoutForm {
    home: string;
    away: string;
}

export interface IDeepScoutStructuredData {
    h2h: IDeepScoutH2H[];
    standings: IDeepScoutStandings;
    probable_lineups: IDeepScoutLineups;
    form_last_5: IDeepScoutForm;
}

/**
 * A 0. Ügynök (Deep Scout) teljes válaszának struktúrája.
 */
export interface IDeepScoutResult {
    narrative_summary: string;
    physical_factor: string;
    psychological_factor: string;
    weather_context: string;
    
    // xG Adatok (V2/V3)
    xg_stats?: IDeepScoutXgStats;
    
    // Strukturált Adatok (V3 - Data Harvest)
    structured_data?: IDeepScoutStructuredData;
    
    // Fallback a V2 prompt kompatibilitáshoz (opcionális)
    stats_fallback?: {
        home_last_5: string;
        away_last_5: string;
    };
    
    key_news: string[];
}
// === DEEP SCOUT TÍPUSOK VÉGE ===


/**
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.ts-hez gyűjtünk.
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
  h2h_structured: any[] | null; // Lehet API válasz vagy IDeepScoutH2H[]
  form: {
    home_overall: string | null;
    away_overall: string | null;
    home_form?: string | null;
    away_form?: string | null;
    [key: string]: any;
  };
  absentees: {
    home: ICanonicalPlayer[];
    away: ICanonicalPlayer[];
  };
  referee: {
    name: string | null;
    style: string | null;
  };
  contextual_factors: {
    stadium_location: string | null;
    pitch_condition: string | null;
    weather: string | null;
    match_tension_index: string | null;
    structured_weather: IStructuredWeather; 
    coach: {
        home_name: string | null;
        away_name: string | null;
    };
    absence_confidence?: {
        home: IAbsenceConfidenceMeta;
        away: IAbsenceConfidenceMeta;
    };
  };
  
  // A teljes elérhető keret a P1-es kiválasztáshoz
  availableRosters: {
    home: IPlayerStub[];
    away: IPlayerStub[];
  };

  [key: string]: any;
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.ts felhasznál.
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
    // P1 Manuális mezők
    manual_H_xG?: number | null;
    manual_H_xGA?: number | null;
    manual_A_xG?: number | null;
    manual_A_xGA?: number | null;
    // === ÚJ v144.0: PPG (Points Per Game) mezők ===
    manual_H_PPG?: number | null;
    manual_A_PPG?: number | null;
  };
  form: {
    home_overall: string | null;
    away_overall: string | null;
    home_form?: string | null;
    away_form?: string | null;
    [key: string]: any;
  };
  rawData: ICanonicalRawData;
  leagueAverages: { [key: string]: any };
  oddsData: ICanonicalOdds | null;
  fromCache: boolean;
  // Ezt küldjük a kliensnek a lista feltöltéséhez
  availableRosters: {
    home: IPlayerStub[];
    away: IPlayerStub[];
  };
}

/**
 * A 'FixtureResult' típus központosítása.
 */
export type FixtureResult = {
    home: number;
    away: number;
    status: 'FT';
} |
{
    status: string;
    home?: undefined;
    away?: undefined;
} | null;
