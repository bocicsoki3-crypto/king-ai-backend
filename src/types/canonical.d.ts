// FÁJL: src/types/canonical.d.ts
// VERZIÓ: FÁZIS 1.1 (Tökéletes Foci Elemzés - Szintaktikai Javítás)
// MÓDOSÍTÁS:
// 1. A Fázis 1-es bővítések (bench, metrics, manager_tactics) implementálva.
// 2. Az összes, előzőleg generált szintaktikai hiba (TS1005, TS1109, stb.)
//    javítva a helyes behúzásokkal és sortörésekkel.

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
  [key: string]: any;   // Egyéb, nem szigorúan típusos statisztikák
}

/**
 * Egyetlen játékos státusza.
 * === BŐVÍTVE (FÁZIS 1) a "Tökéletes Foci Elemzés" Terv alapján ===
 */
export interface ICanonicalPlayer {
  name: string;
  role: 'G' | 'D' | 'M' | 'F' | 'Ismeretlen'; // Típus szűkítve
  importance: 'key' | 'regular' | 'substitute' | 'bench'; // 'bench' hozzáadva
  status: 'confirmed_out' | 'doubtful' | 'active' | 'on_bench'; // 'on_bench' hozzáadva
  rating_last_5?: number;    // Opcionális, de javasolt

  // === ÚJ (FÁZIS 1): Játékos-specifikus viselkedési metrikák ===
  metrics?: {
    fouls_committed_p90?: number;
    yellow_cards_total?: number;
    red_cards_total?: number;
    is_primary_corner_taker?: boolean;
  };
}

/**
 * Részletes játékos- és hiányzó-adatok.
 * === BŐVÍTVE (FÁZIS 1) a "Tökéletes Foci Elemzés" Terv alapján ===
 */
export interface ICanonicalPlayerStats {
  home_absentees: ICanonicalPlayer[]; // Akik nincsenek a keretben
  away_absentees: ICanonicalPlayer[]; // Akik nincsenek a keretben

  // === ÚJ (FÁZIS 1): Cserék a "Próféta" számára ===
  home_bench: ICanonicalPlayer[]; // Akik a padon ülnek
  away_bench: ICanonicalPlayer[]; // Akik a padon ülnek

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
 * Strukturált időjárási adatokat definiál.
 * A mezők opcionálisak (?), hogy a nem-foci providerek is
 * megfeleljenek az interfésznek anélkül, hogy teljes adatot adnának.
 */
export interface IStructuredWeather {
    description: string;
    temperature_celsius: number | null;
    humidity_percent?: number | null;
    wind_speed_kmh?: number | null;
    precipitation_mm?: number | null;
}

/**
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.ts-hez gyűjtünk.
 * === MÓDOSÍTVA (v54.9) ===
 * A 'match_tension_index' típusa 'number'-ről 'string'-re módosítva,
 * hogy megfeleljen a Model.ts várakozásainak (.toLowerCase()).
 * === BŐVÍTVE (FÁZIS 1) a "Tökéletes Foci Elemzés" Terv alapján ===
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
  detailedPlayerStats: ICanonicalPlayerStats; // Ez már a BŐVÍTETT Fázis 1-es típust használja
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
    style: string | null;
  };

  // === ÚJ (FÁZIS 1): Edzői/Taktikai adatok ===
  manager_tactics?: {
    home_manager_name?: string;
    away_manager_name?: string;
    home_avg_sub_time?: number; // Pl. 65 (perc)
    away_avg_sub_time?: number;
    home_primary_sub_role?: 'M' | 'F'; // Leggyakrabban cserélt poszt
    away_primary_sub_role?: 'M' | 'F';
  };

  contextual_factors: {
    stadium_location: string | null;
    pitch_condition: string | null;
    weather: string | null;
    // === JAVÍTÁS (v54.9) ===
    // Típus 'number'-ről 'string'-re cserélve
    match_tension_index: string | null;
    structured_weather: IStructuredWeather;
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
    home: { [key: string]: any };
    away: { [key: string]: any };
  };
  form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  rawData: ICanonicalRawData; // Ez már tartalmazza a Fázis 1-es adatokat
  leagueAverages: { [key: string]: any };
  oddsData: ICanonicalOdds | null;
  fromCache: boolean;
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
