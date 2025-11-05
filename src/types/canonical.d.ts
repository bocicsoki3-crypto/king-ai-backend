// FÁJL: src/types/canonical.d.ts
// VERZIÓ: v55.4 (Szintaktikai Végleges Javítás)
// MÓDOSÍTÁS:
// 1. Az 'IStructuredWeather' interfész frissítve (v55.2). 
// 2. A 'precipitation_mm' és 'wind_speed_kmh' mezők már nem opcionálisak (?)
//    (de lehetnek 'null'), hogy megfeleljenek a 'Model.ts' elvárásainak. [cite: 2665-2666]
// 3. JAVÍTVA: Minden kódtörzsön belüli, szintaktikai hibát okozó
//    '' és '' hivatkozás eltávolítva.

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
 * === JAVÍTOTT (v55.4) INTERFÉSZ ===
 * Strukturált időjárási adatokat definiál.
 * A mezők már nem opcionálisak (?), hogy a Model.ts helyesen tudja olvasni őket.
 */
export interface IStructuredWeather {
    description: string;
    temperature_celsius: number | null;
    humidity_percent?: number | null; // Ez maradhat opcionális
    wind_speed_kmh: number | null;   // KÖTELEZŐ (vagy null)
    precipitation_mm: number | null; // KÖTELEZŐ (vagy null)
    source?: 'Open-Meteo' | 'N/A'; // Opcionális debug mező
}


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
  contextual_factors: {
    stadium_location: string | null;
    pitch_condition: string | null;
    weather: string | null;
    // Típus 'number'-ről 'string'-re cserélve (v54.9)
    match_tension_index: string | null;
    structured_weather: IStructuredWeather; // Ez már a v55.4-es (javított) típust használja
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
  rawData: ICanonicalRawData; // Ez már tartalmazza a v55.4-es időjárás típust
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
