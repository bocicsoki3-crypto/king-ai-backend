// FÁJL: src/types/canonical.d.ts
// VERZIÓ: v55.2 (Időjárás Interfész Javítás)
// MÓDOSÍTÁS:
// 1. Az 'IStructuredWeather' interfész  frissítve.
// 2. A 'precipitation_mm' és 'wind_speed_kmh' mezők már nem opcionálisak (?)
//    (de lehetnek 'null'), hogy megfeleljenek a 'Model.ts'  elvárásainak.
// 3. 'source' mező hozzáadva a hibakereséshez.

// Ezen interfészek definiálják a rendszeren belüli "adatszerződést".
[cite: 765] // A Providerek (pl. apiSportsProvider) felelőssége, hogy az API válaszaikat
// ezen interfészeknek megfelelő objektumokká alakítsák.
[cite: 766] // A Fogyasztók (pl. Model, AnalysisFlow) ezen interfészekre támaszkodnak.

/**
 * A csapatok alapvető statisztikai adatai, amelyeket a Model.ts vár.
[cite: 767] */
export interface ICanonicalStats {
  gp: number;           // Games Played (Lejátszzott meccsek) [cite: 767]
  gf: number;           // Goals For (Lőtt gólok / Pontok) [cite: 768]
  ga: number;           // Goals Against (Kapott gólok / Pontok) [cite: 769]
  form: string | null;  // Forma string (pl. "WWLDW") [cite: 770]
  [key: string]: any;  // Egyéb, nem szigorúan típusos statisztikák [cite: 770]
}

/**
 * Egyetlen játékos státusza (a 2. Javaslat alapján).
[cite: 771] */
export interface ICanonicalPlayer {
  name: string; [cite: 771]
  role: string; [cite: 771]
  importance: 'key' | 'regular' | 'substitute'; [cite: 771]
  status: 'confirmed_out' | 'doubtful' | 'active'; [cite: 771-772]
  rating_last_5?: number;    // Opcionális, de javasolt [cite: 772]
}

/**
 * A 2. Javaslatból származó részletes játékos- és hiányzó-adatok.
[cite: 773] */
export interface ICanonicalPlayerStats {
  home_absentees: ICanonicalPlayer[]; [cite: 773]
  away_absentees: ICanonicalPlayer[]; [cite: 773]
  key_players_ratings: {
    home: { [role: string]: number }; [cite: 773]
    away: { [role: string]: number }; [cite: 774]
  };
}

/**
 * A piaci szorzók kanonikus formája.
[cite: 775] */
export interface ICanonicalOdds {
  current: { name: string; price: number }[]; [cite: 775]
  allMarkets: {
    key: string; [cite: 775]
    outcomes: {
      name: string; [cite: 776]
      price: number; [cite: 776]
      point?: number | null; [cite: 777]
    }[];
  }[];
  fullApiData: any; // A nyers API válasz tárolása (pl. 'findMainTotalsLine' számára) [cite: 777]
  fromCache: boolean; [cite: 777]
}

/**
 * === JAVÍTOTT (v55.2) INTERFÉSZ ===
 * Strukturált időjárási adatokat definiál.
 * A mezők már nem opcionálisak (?), hogy a Model.ts  helyesen tudja olvasni őket.
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
[cite: 781] * === MÓDOSÍTVA (v54.9) ===
 * A 'match_tension_index' típusa 'number'-ről 'string'-re módosítva,
 * hogy megfeleljen a Model.ts várakozásainak (.toLowerCase()).
[cite: 781-782] */
export interface ICanonicalRawData {
  stats: {
    home: ICanonicalStats; [cite: 782]
    away: ICanonicalStats; [cite: 782]
  };
  apiFootballData?: {
    fixtureId: number | string | null; [cite: 783]
    leagueId: number | string | null; [cite: 783]
    [key: string]: any; [cite: 783]
  };
  detailedPlayerStats: ICanonicalPlayerStats; [cite: 784]
  h2h_structured: any[] | null; [cite: 784]
  form: {
    home_overall: string | null; [cite: 784]
    away_overall: string | null; [cite: 784]
    [key: string]: any; [cite: 785]
  };
  absentees: {
    home: ICanonicalPlayer[]; [cite: 785]
    away: ICanonicalPlayer[]; [cite: 785]
  };
  referee: {
    name: string | null; [cite: 786]
    style: string | null; [cite: 786]
  };
  contextual_factors: {
    stadium_location: string | null; [cite: 787]
    pitch_condition: string | null; [cite: 787]
    weather: string | null; [cite: 787]
    // === JAVÍTÁS (v54.9) ===
    // Típus 'number'-ről 'string'-re cserélve [cite: 788]
    match_tension_index: string | null; [cite: 789]
    structured_weather: IStructuredWeather; // Ez már a v55.2-es (javított) típust használja
  };
  [key: string]: any;
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.ts felhasznál.
[cite: 790] */
export interface ICanonicalRichContext {
  rawStats: {
    home: ICanonicalStats; [cite: 790]
    away: ICanonicalStats; [cite: 790]
  };
  richContext: string; [cite: 791]
  advancedData: {
    home: { [key: string]: any }; [cite: 791]
    away: { [key: string]: any }; [cite: 791]
  };
  form: {
    home_overall: string | null; [cite: 792]
    away_overall: string | null; [cite: 792]
    [key: string]: any; [cite: 792]
  };
  rawData: ICanonicalRawData; // Ez már tartalmazza a v55.2-es időjárás típust [cite: 793]
  leagueAverages: { [key: string]: any }; [cite: 793]
  oddsData: ICanonicalOdds | null; [cite: 793]
  fromCache: boolean; [cite: 794]
}

/**
 * A 'FixtureResult' típus központosítása.
[cite: 794] */
export type FixtureResult = {
    home: number; [cite: 794]
    away: number; [cite: 794]
    status: 'FT'; [cite: 794]
} | {
    status: string; [cite: 795]
    home?: undefined; [cite: 795]
    away?: undefined; [cite: 795]
} | null;
