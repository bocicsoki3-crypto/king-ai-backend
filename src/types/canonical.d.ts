// FÁJL: src/types/canonical.d.ts
// VERZIÓ: FÁZIS 1 (Tökéletes Foci Elemzés - Adatmodell Bővítés)
// MÓDOSÍTÁS:
// 1. Az 'ICanonicalPlayer' kiterjesztve az 'on_bench' státusszal,
//    szűkített 'role' típussal, és 'metrics' objektummal (lapok, faultok).
// 2. Az 'ICanonicalPlayerStats' kiterjesztve a 'home_bench' és 'away_bench' listákkal.
// 3. Az 'ICanonicalRawData' kiterjesztve a 'manager_tactics' objektummal.

[cite_start]// Ezen interfészek definiálják a rendszeren belüli "adatszerződést". [cite: 980]
[cite_start]// A Providerek (pl. apiSportsProvider) felelőssége, hogy az API válaszaikat [cite: 981]
// ezen interfészeknek megfelelő objektumokká alakítsák.
[cite_start]// A Fogyasztók (pl. Model, AnalysisFlow) ezen interfészekre támaszkodnak. [cite: 982]

/**
 * A csapatok alapvető statisztikai adatai, amelyeket a Model.ts vár.
 [cite_start][cite: 983] */
export interface ICanonicalStats {
  gp: number;           // Games Played (Lejátszzott meccsek)
  [cite_start]gf: number; [cite: 984] // Goals For (Lőtt gólok / Pontok)
  [cite_start]ga: number; [cite: 985] // Goals Against (Kapott gólok / Pontok)
  [cite_start]form: string | null; [cite: 986] // Forma string (pl. "WWLDW")
  [key: string]: any;  // Egyéb, nem szigorúan típusos statisztikák
}

/**
 * Egyetlen játékos státusza.
 * === BŐVÍTVE (FÁZIS 1) a "Tökéletes Foci Elemzés" Terv alapján ===
 [cite_start][cite: 987] */
export interface ICanonicalPlayer {
  name: string;
  role: 'G' | 'D' | 'M' | 'F' | 'Ismeretlen'; // Típus szűkítve
  importance: 'key' | 'regular' | 'substitute' | 'bench'; // 'bench' hozzáadva
  status: 'confirmed_out' | 'doubtful' |
 [cite_start][cite: 988] 'active' | 'on_bench'; // 'on_bench' hozzáadva
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
 [cite_start][cite: 989] */
export interface ICanonicalPlayerStats {
  home_absentees: ICanonicalPlayer[]; // Akik nincsenek a keretben
  away_absentees: ICanonicalPlayer[]; // Akik nincsenek a keretben

  // === ÚJ (FÁZIS 1): Cserék a "Próféta" számára ===
  home_bench: ICanonicalPlayer[]; // Akik a padon ülnek
  away_bench: ICanonicalPlayer[]; // Akik a padon ülnek

  key_players_ratings: {
    home: { [role: string]: number };
 [cite_start][cite: 990] away: { [role: string]: number };
  };
}

/**
 * A piaci szorzók kanonikus formája.
 [cite_start][cite: 991] */
export interface ICanonicalOdds {
  current: { name: string; price: number }[];
  allMarkets: {
    key: string;
 [cite_start][cite: 992] outcomes: {
      name: string;
      price: number;
      point?: number | null;
    }[];
  }[];
  [cite_start]fullApiData: any; [cite: 993] // A nyers API válasz tárolása (pl. 'findMainTotalsLine' számára)
  fromCache: boolean;
}

/**
 * Strukturált időjárási adatokat definiál.
 [cite_start][cite: 994] * A mezők opcionálisak (?), hogy a nem-foci providerek is
 * megfeleljenek az interfésznek anélkül, hogy teljes adatot adnának.
 [cite_start][cite: 995] */
export interface IStructuredWeather {
    description: string;
    temperature_celsius: number | null;
    humidity_percent?: number | null;
    wind_speed_kmh?: number |
 [cite_start][cite: 996] null;
    precipitation_mm?: number | null;
}

/**
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.ts-hez gyűjtünk.
 [cite_start][cite: 997] * === MÓDOSÍTVA (v54.9) ===
 * A 'match_tension_index' típusa 'number'-ről 'string'-re módosítva,
 * hogy megfeleljen a Model.ts várakozásainak (.toLowerCase()).
 * === BŐVÍTVE (FÁZIS 1) a "Tökéletes Foci Elemzés" Terv alapján ===
 [cite_start][cite: 998] */
export interface ICanonicalRawData {
  stats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
 [cite_start][cite: 999] apiFootballData?: {
    fixtureId: number | string | null;
    leagueId: number | string | null;
    [key: string]: any;
 [cite_start][cite: 1000] };
  detailedPlayerStats: ICanonicalPlayerStats; // Ez már a BŐVÍTETT Fázis 1-es típust használja
  h2h_structured: any[] | null;
  form: {
    home_overall: string | null;
    away_overall: string | null;
 [cite_start][cite: 1001] [key: string]: any;
  };
  absentees: {
    home: ICanonicalPlayer[];
    away: ICanonicalPlayer[];
  };
 [cite_start][cite: 1002] referee: {
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

 [cite_start][cite: 1003] contextual_factors: {
    stadium_location: string | null;
    pitch_condition: string | null;
    weather: string | null;
 [cite_start][cite: 1004] // === JAVÍTÁS (v54.9) ===
    // Típus 'number'-ről 'string'-re cserélve
    match_tension_index: string | null;
 [cite_start][cite: 1005] structured_weather: IStructuredWeather;
  };
  [key: string]: any;
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.ts felhasznál.
 [cite_start][cite: 1006] */
export interface ICanonicalRichContext {
  rawStats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
  richContext: string;
 [cite_start][cite: 1007] advancedData: {
    home: { [key: string]: any };
    away: { [key: string]: any };
  };
 [cite_start][cite: 1008] form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  [cite_start]rawData: ICanonicalRawData; [cite: 1009] // Ez már tartalmazza a Fázis 1-es adatokat
  leagueAverages: { [key: string]: any };
  oddsData: ICanonicalOdds | null;
  fromCache: boolean;
 [cite_start][cite: 1010] }

/**
 * A 'FixtureResult' típus központosítása.
 */
export type FixtureResult = {
    home: number;
    away: number;
    status: 'FT';
 [cite_start][cite: 1011] } | {
    status: string;
    home?: undefined;
    away?: undefined;
} | null;
