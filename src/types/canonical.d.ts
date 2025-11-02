// Ezen interfészek definiálják a rendszeren belüli "adatszerződést".
// A Providerek (pl. apiSportsProvider) felelőssége, hogy az API válaszaikat
// ezen interfészeknek megfelelő objektumokká alakítsák.
// A Fogyasztók (pl. Model, AnalysisFlow) ezen interfészekre támaszkodnak.

/**
 * A csapatok alapvető statisztikai adatai, amelyeket a Model.js vár.
 * Ez az interfész azonnal észlelte volna a 'gp' vs 'GP' hibát.
 */
export interface ICanonicalStats {
  gp: number;                // Games Played (Lejátszott meccsek)
  gf: number;                // Goals For (Lőtt gólok / Pontok)
  ga: number;                // Goals Against (Kapott gólok / Pontok)
  form: string | null;       // Forma string (pl. "WWLDW")
  [key: string]: any;        // Egyéb, nem szigorúan típusos statisztikák
}

/**
 * Egyetlen játékos státusza (a 2. Javaslat alapján).
 */
export interface ICanonicalPlayer {
  name: string;
  role: string;
  importance: 'key' | 'regular' | 'substitute';
  status: 'confirmed_out' | 'doubtful' | 'active';
  rating_last_5?: number;    // Opcionális, de javasolt
}

/**
 * A 2. Javaslatból származó részletes játékos- és hiányzó-adatok.
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
 * A "nyers" adatcsomag, amelyet a CoT (Chain-of-Thought) elemzéshez
 * és a Model.js-hez gyűjtünk.
 */
export interface ICanonicalRawData {
  stats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
  apiFootballData?: { // Szolgáltató-specifikus adatok (opcionális)
    fixtureId: number | string | null;
    leagueId: number | string | null;
    [key: string]: any;
  };
  detailedPlayerStats: ICanonicalPlayerStats; // A 2. Javaslatból
  h2h_structured: any[] | null;
  form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  absentees: { // Az 'detailedPlayerStats'-ból származtatva
    home: ICanonicalPlayer[];
    away: ICanonicalPlayer[];
  };
  [key: string]: any; // Egyéb AI által generált adatok (pl. tactics)
}

/**
 * A fő adatcsomag, amelyet a getRichContextualData visszaad
 * és az AnalysisFlow.js felhasznál.
 */
export interface ICanonicalRichContext {
  rawStats: {
    home: ICanonicalStats;
    away: ICanonicalStats;
  };
  richContext: string; // A szöveges kontextus
  advancedData: { // xG és egyéb adatok
    home: { [key: string]: any };
    away: { [key: string]: any };
  };
  form: {
    home_overall: string | null;
    away_overall: string | null;
    [key: string]: any;
  };
  rawData: ICanonicalRawData;
  leagueAverages: { [key: string]: any };
  oddsData: ICanonicalOdds | null;
  fromCache: boolean;
}
