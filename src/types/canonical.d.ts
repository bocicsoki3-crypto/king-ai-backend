// FÁJL: src/types/canonical.d.ts
// VERZIÓ: v55.3 (Szintaktikai Javítások)
// MÓDOSÍTÁS:
[cite_start]// 1. Az 'IStructuredWeather' interfész [cite: 2664-2666] frissítve (v55.2).
// 2. A 'precipitation_mm' és 'wind_speed_kmh' mezők már nem opcionálisak (?)
[cite_start]//    (de lehetnek 'null'), hogy megfeleljenek a 'Model.ts' [cite: 1670-1678] elvárásainak.
// 3. 'source' mező hozzáadva a hibakereséshez.
// 4. JAVÍTVA: A v55.2-ben vétett szintaktikai hibák (rossz helyen lévő kommentek
//    és forráshivatkozások) javítva.

// Ezen interfészek definiálják a rendszeren belüli "adatszerződést".
// A Providerek (pl. apiSportsProvider) felelőssége, hogy az API válaszaikat
// ezen interfészeknek megfelelő objektumokká alakítsák.
// A Fogyasztók (pl. Model, AnalysisFlow) ezen interfészekre támaszkodnak.

/**
 * A csapatok alapvető statisztikai adatai, amelyeket a Model.ts vár.
[cite_start][cite: 2652] */
export interface ICanonicalStats {
  gp: number;           [cite_start]// Games Played (Lejátszzott meccsek) [cite: 2653]
  gf: number;           [cite_start]// Goals For (Lőtt gólok / Pontok) [cite: 2654]
  ga: number;           [cite_start]// Goals Against (Kapott gólok / Pontok) [cite: 2655]
  form: string | null;  [cite_start]// Forma string (pl. "WWLDW") [cite: 2655]
  [key: string]: any;  [cite_start]// Egyéb, nem szigorúan típusos statisztikák [cite: 2656]
}

/**
 * Egyetlen játékos státusza.
[cite_start][cite: 2656] */
export interface ICanonicalPlayer {
  [cite_start]name: string; [cite: 2657]
  [cite_start]role: string; [cite: 2657]
  importance: 'key' | 'regular' | [cite_start]'substitute'; [cite: 2657]
  status: 'confirmed_out' | 'doubtful' | [cite_start]'active'; [cite: 2657-2658]
  rating_last_5?: number;    [cite_start]// Opcionális, de javasolt [cite: 2658]
}

/**
 * Részletes játékos- és hiányzó-adatok.
[cite_start][cite: 2658] */
export interface ICanonicalPlayerStats {
  [cite_start]home_absentees: ICanonicalPlayer[]; [cite: 2659]
  [cite_start]away_absentees: ICanonicalPlayer[]; [cite: 2659]
  key_players_ratings: {
    [cite_start]home: { [role: string]: number }; [cite: 2659]
    [cite_start]away: { [role: string]: number }; [cite: 2660]
  };
}

/**
 * A piaci szorzók kanonikus formája.
[cite_start][cite: 2660] */
export interface ICanonicalOdds {
  [cite_start]current: { name: string; price: number }[]; [cite: 2661]
  allMarkets: {
    [cite_start]key: string; [cite: 2661]
    outcomes: {
      [cite_start]name: string; [cite: 2662]
      [cite_start]price: number; [cite: 2662]
      [cite_start]point?: number | null; [cite: 2662]
    }[];
  }[];
  fullApiData: any; [cite_start]// A nyers API válasz tárolása (pl. 'findMainTotalsLine' számára) [cite: 2662]
  [cite_start]fromCache: boolean; [cite: 2663]
}

/**
 * === JAVÍTOTT (v55.3) INTERFÉSZ ===
 * [cite_start]Strukturált időjárási adatokat definiál. [cite: 2663]
 * [cite_start]A mezők már nem opcionálisak (?), hogy a Model.ts helyesen tudja olvasni őket. [cite: 2664-2665]
 */
export interface IStructuredWeather {
    [cite_start]description: string; [cite: 2665]
    [cite_start]temperature_celsius: number | null; [cite: 2665]
    [cite_start]humidity_percent?: number | null; [cite: 2665]
    wind_speed_kmh: number | null;   [cite_start]// KÖTELEZŐ (vagy null) [cite: 2665-2666]
    precipitation_mm: number | null; [cite_start]// KÖTELEZŐ (vagy null) [cite: 2666]
    source?: 'Open-Meteo' | 'N/A'; // Opcionális debug mező
}


/**
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.ts-hez gyűjtünk.
 * === MÓDOSÍTVA (v54.9) ===
 * A 'match_tension_index' típusa 'number'-ről 'string'-re módosítva,
 * hogy megfeleljen a Model.ts várakozásainak (.toLowerCase()).
[cite_start][cite: 2666-2667] */
export interface ICanonicalRawData {
  stats: {
    [cite_start]home: ICanonicalStats; [cite: 2668]
    [cite_start]away: ICanonicalStats; [cite: 2668]
  };
  apiFootballData?: {
    [cite_start]fixtureId: number | string | null; [cite: 2669]
    [cite_start]leagueId: number | string | null; [cite: 2669]
    [cite_start][key: string]: any; [cite: 2669]
  };
  [cite_start]detailedPlayerStats: ICanonicalPlayerStats; [cite: 2670]
  [cite_start]h2h_structured: any[] | null; [cite: 2670]
  form: {
    [cite_start]home_overall: string | null; [cite: 2670]
    [cite_start]away_overall: string | null; [cite: 2670]
    [cite_start][key: string]: any; [cite: 2671]
  };
  absentees: {
    [cite_start]home: ICanonicalPlayer[]; [cite: 2671]
    [cite_start]away: ICanonicalPlayer[]; [cite: 2671]
  };
  referee: {
    [cite_start]name: string | null; [cite: 2672]
    [cite_start]style: string | null; [cite: 2672]
  };
  contextual_factors: {
    [cite_start]stadium_location: string | null; [cite: 2673]
    [cite_start]pitch_condition: string | null; [cite: 2673]
    [cite_start]weather: string | null; [cite: 2673]
    // === JAVÍTÁS (v54.9) ===
    [cite_start]// Típus 'number'-ről 'string'-re cserélve [cite: 2674]
    [cite_start]match_tension_index: string | null; [cite: 2674]
    structured_weather: IStructuredWeather; [cite_start]// Ez már a v55.3-as (javított) típust használja [cite: 2675]
  };
  [key: string]: any;
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.ts felhasznál.
[cite_start][cite: 2675] */
export interface ICanonicalRichContext {
  rawStats: {
    [cite_start]home: ICanonicalStats; [cite: 2676]
    [cite_start]away: ICanonicalStats; [cite: 2676]
  };
  [cite_start]richContext: string; [cite: 2676]
  advancedData: {
    [cite_start]home: { [key: string]: any }; [cite: 2677]
    [cite_start]away: { [key: string]: any }; [cite: 2677]
  };
  form: {
    [cite_start]home_overall: string | null; [cite: 2678]
    [cite_start]away_overall: string | null; [cite: 2678]
    [cite_start][key: string]: any; [cite: 2678]
  };
  rawData: ICanonicalRawData; [cite_start]// Ez már tartalmazza a v55.3-es időjárás típust [cite: 2678]
  [cite_start]leagueAverages: { [key: string]: any }; [cite: 2679]
  [cite_start]oddsData: ICanonicalOdds | null; [cite: 2679]
  [cite_start]fromCache: boolean; [cite: 2679]
}

/**
 * A 'FixtureResult' típus központosítása.
[cite_start][cite: 2680] */
export type FixtureResult = {
    [cite_start]home: number; [cite: 2680]
    [cite_start]away: number; [cite: 2680]
    [cite_start]status: 'FT'; [cite: 2680]
} | {
    [cite_start]status: string; [cite: 2681]
    [cite_start]home?: undefined; [cite: 2681]
    [cite_start]away?: undefined; [cite: 2681]
} | null;
