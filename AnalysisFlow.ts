// FÁJL: AnalysisFlow.ts
// VERZIÓ: v112.1 (Import Fix)
// MÓDOSÍTÁS:
// 1. JAVÍTÁS: A 'runStep_FinalAnalysis', 'runStep_Psychologist', 'runStep_Specialist' importálása
//    az AI_Service.ts-ből most már named importként történik.

import NodeCache from 'node-cache';
import { SPORT_CONFIG } from './config.js';
// Kanonikus típusok importálása
import type {
    ICanonicalRichContext,
    ICanonicalRawData,
    ICanonicalStats,
    ICanonicalOdds,
    IPlayerStub,
    ICanonicalPlayer,
    IAbsenceConfidenceMeta
} from './src/types/canonical.d.ts';
// A 'findMainTotalsLine'-t a központi 'utils' fájlból importáljuk
import { findMainTotalsLine } from './providers/common/utils.js';
// Adatgyűjtő funkciók (2. Ügynök - Scout)
import { 
    getRichContextualData, 
    type IDataFetchOptions, 
    type IDataFetchResponse 
} from './DataFetch.js';
// Statisztikai modellek (1. és 4. Ügynök)
import {
    estimatePureXG,           // (1. Ügynök - Quant)
    estimateAdvancedMetrics,
    simulateMatchProgress,    // (4. Ügynök - Szimulátor)
    calculateConfidenceScores, // v105.0
    calculateValue,
    analyzeLineMovement
} from './Model.js';
// AI Szolgáltatás Importok - JAVÍTOTT IMPORT
import {
    runStep_Psychologist, 
    runStep_Specialist,   
    runStep_FinalAnalysis 
} from './AI_Service.js';
import { saveAnalysisToSheet } from './sheets.js'; 
// Önjavító Hurok importálása
import { getNarrativeRatings } from './LearningService.js';

// === ÚJ IMPORT A STRATÉGIÁHOZ ===
import { getSportStrategy } from './strategies/StrategyFactory.js';
import type { ISportStrategy } from './strategies/ISportStrategy.js';
// === IMPORT VÉGE ===

// Gyorsítótár inicializálása
const scriptCache = new NodeCache({ stdTTL: 3600 * 4, checkperiod: 3600 });

// Az új, strukturált JSON válasz
interface IAnalysisResponse {
    analysisData: {
        committee: {
            quant: { mu_h: number, mu_a: number, source: string, isDerby?: boolean, derbyName?: string }; // v134.0: Derby info
            psychologist: any; 
            specialist: { 
                mu_h: number, 
                mu_a: number, 
                log: string,  
                report: any   
            };
            strategist: any;
            scout?: any;
            critic?: any;
        };
        matchData: {
            home: string;
            away: string;
            sport: string;
            mainTotalsLine: number | string;
            mu_h: number | string; 
            mu_a: number | string;
        };
        oddsData: ICanonicalOdds | null;
        valueBets: any[];
        confidenceScores: {
            winner: number;
            totals: number;
            overall: number;
        };
        finalConfidenceScore: number; 
        sim: any; 
        recommendation: any;
        xgSource: string; 
        availableRosters: {
            home: IPlayerStub[];
            away: IPlayerStub[];
        };
        absenceConfidence?: {
            home: IAbsenceConfidenceMeta;
            away: IAbsenceConfidenceMeta;
        };
    };
    debugInfo: any;
}

interface IAnalysisError {
    error: string;
}

// === Segédfüggvény a tizedesvesszők kezelésére (Változatlan) ===
function safeConvertToNumber(value: any): number | null {
    if (value == null || value === '') { 
        return null;
    }
    let strValue = String(value);
    strValue = strValue.replace(',', '.');
    const num = Number(strValue);
    if (isNaN(num)) {
        console.warn(`[AnalysisFlow] HIBÁS BEMENET: Nem sikerült számmá alakítani: "${value}"`);
        return null;
    }
    return num;
}

type ManualAbsenteesInput = IDataFetchOptions['manual_absentees'];

interface AbsenceValidationResult {
    mergedAbsentees: ICanonicalRawData['absentees'];
    meta: {
        home: IAbsenceConfidenceMeta;
        away: IAbsenceConfidenceMeta;
    };
    summary: string;
}

const ROLE_MAP: Record<string, ICanonicalPlayer['role']> = {
    g: 'Kapus',
    gk: 'Kapus',
    goalkeeper: 'Kapus',
    d: 'Védő',
    def: 'Védő',
    defender: 'Védő',
    m: 'Középpályás',
    mid: 'Középpályás',
    midfielder: 'Középpályás',
    f: 'Támadó',
    fw: 'Támadó',
    st: 'Támadó',
    forward: 'Támadó'
};

function normalizePlayerName(name?: string): string {
    return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapPosToRole(pos?: string): ICanonicalPlayer['role'] {
    if (!pos) return 'Ismeretlen';
    const key = normalizePlayerName(pos).replace(/[^a-z]/g, '');
    return ROLE_MAP[key] || 'Ismeretlen';
}

function ensurePlayerConfidence(player: ICanonicalPlayer, fallbackSource: 'manual' | 'provider'): ICanonicalPlayer {
    return {
        ...player,
        confidence: player.confidence || 'confirmed',
        source: player.source || fallbackSource
    };
}

function buildAbsenceValidation(rawData: ICanonicalRawData, manualAbsentees?: ManualAbsenteesInput | null): AbsenceValidationResult | null {
    if (!rawData) return null;
    
    const mergedAbsentees: ICanonicalRawData['absentees'] = {
        home: (rawData.absentees?.home || []).map(player => ensurePlayerConfidence(player, 'provider')),
        away: (rawData.absentees?.away || []).map(player => ensurePlayerConfidence(player, 'provider'))
    };
    
    const meta = {
        home: { confirmed: [] as string[], unverified: [] as string[] },
        away: { confirmed: [] as string[], unverified: [] as string[] }
    };
    
    if (!manualAbsentees?.home?.length && !manualAbsentees?.away?.length) {
        return {
            mergedAbsentees,
            meta,
            summary: 'Nincs manuális hiányzó hozzáadva.'
        };
    }
    
    const providerHomeNames = new Set<string>([
        ...mergedAbsentees.home.map(player => normalizePlayerName(player.name)),
        ...((rawData.detailedPlayerStats?.home_absentees || []).map(player => normalizePlayerName(player.name)))
    ]);
    const providerAwayNames = new Set<string>([
        ...mergedAbsentees.away.map(player => normalizePlayerName(player.name)),
        ...((rawData.detailedPlayerStats?.away_absentees || []).map(player => normalizePlayerName(player.name)))
    ]);
    
    const mergeManualList = (team: 'home' | 'away', entries: { name: string; pos?: string }[] = []) => {
        const target = mergedAbsentees[team];
        const providerNames = team === 'home' ? providerHomeNames : providerAwayNames;
        const indexMap = new Map<string, number>();
        target.forEach((player, idx) => indexMap.set(normalizePlayerName(player.name), idx));
        
        entries.forEach(entry => {
            if (!entry.name) return;
            const normalized = normalizePlayerName(entry.name);
            const existingIndex = indexMap.get(normalized);
            const isConfirmed = providerNames.has(normalized);
            const confidenceLabel: 'confirmed' | 'unverified' = isConfirmed ? 'confirmed' : 'unverified';
            
            if (existingIndex != null) {
                const existing = target[existingIndex];
                target[existingIndex] = ensurePlayerConfidence({
                    ...existing,
                    confidence: confidenceLabel,
                    source: isConfirmed ? 'manual+provider' : existing.source || 'manual'
                }, 'provider');
            } else {
                const newPlayer = ensurePlayerConfidence({
                    name: entry.name,
                    role: mapPosToRole(entry.pos),
                    importance: 'key',
                    status: 'confirmed_out',
                    confidence: confidenceLabel,
                    source: isConfirmed ? 'manual+provider' : 'manual'
                }, 'manual');
                target.push(newPlayer);
            }
            
            meta[team][confidenceLabel].push(entry.name);
        });
    };
    
    mergeManualList('home', manualAbsentees?.home);
    mergeManualList('away', manualAbsentees?.away);
    
    const formatTeamSummary = (label: string, data: IAbsenceConfidenceMeta) => {
        const parts: string[] = [];
        if (data.confirmed.length) parts.push(`✅ ${data.confirmed.join(', ')}`);
        if (data.unverified.length) parts.push(`⚠️ ${data.unverified.join(', ')}`);
        return `${label}: ${parts.length ? parts.join(' | ') : 'Nincs manuális eltérés'}`;
    };
    
    const summary = [
        formatTeamSummary('Hazai', meta.home),
        formatTeamSummary('Vendég', meta.away)
    ].join('\n');
    
    return { mergedAbsentees, meta, summary };
}

export async function runFullAnalysis(params: any, sport: string, openingOdds: any): Promise<IAnalysisResponse | IAnalysisError> {
    let analysisCacheKey = 'unknown_analysis';
    let fixtureIdForSaving: number | string | null = null;
    try {
        const { 
            home: rawHome, 
            away: rawAway, 
            force: forceNewStr, 
            sheetUrl, 
            utcKickoff, 
            leagueName,
            manual_H_xG, 
            manual_H_xGA,
            manual_A_xG, 
            manual_A_xGA,
            // === ÚJ v144.0: PPG paraméterek ===
            manual_H_PPG,
            manual_A_PPG,
            manual_absentees
        } = params;

        if (!rawHome || !rawAway || !sport || !utcKickoff) {
            throw new Error("Hiányzó kötelező paraméterek: 'home', 'away', 'sport', 'utcKickoff'.");
        }
        
        const home: string = String(rawHome).trim();
        const away: string = String(rawAway).trim();
        const forceNew: boolean = String(forceNewStr).toLowerCase() === 'true';
        const safeHome = encodeURIComponent(home.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        const safeAway = encodeURIComponent(away.toLowerCase().replace(/\s+/g, '')).substring(0, 50);
        
        const p1AbsenteesHash = manual_absentees ?
            `_P1A_${manual_absentees.home.length}_${manual_absentees.away.length}` : 
            '';
        
        // v112.0 Cache kulcs
        analysisCacheKey = `analysis_v112.0_apex_${sport}_${safeHome}_vs_${safeAway}${p1AbsenteesHash}`;
        
        if (!forceNew) {
            const cachedResult = scriptCache.get<IAnalysisResponse>(analysisCacheKey);
            if (cachedResult) {
                console.log(`Cache találat (${analysisCacheKey})`);
                return cachedResult;
            } else {
                console.log(`Nincs cache (${analysisCacheKey}), friss elemzés indul...`);
            }
        } else {
            console.log(`Újraelemzés kényszerítve (${analysisCacheKey})`);
        }

        // --- 1. Alapkonfiguráció ---
        
        console.log(`[Lánc 0/6] Stratégia Gyár: Elemzési stratégia kiválasztása a '${sport}' sportághoz...`);
        const sportStrategy: ISportStrategy = getSportStrategy(sport);
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) {
            throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);
        }

        // === 2. ÜGYNÖK (SCOUT): Kontextus, Piac és P1 Kezelése ===
        // ITT HÍVÓDIK MEG A DataFetch.ts v112.0, ami már vadássza az xG-t!
        console.log(`[Lánc 2/6] Scout Ügynök: Kontextus és Piac lekérése (AI-First)...`);
        const dataFetchOptions: IDataFetchOptions = {
            sport: sport,
            homeTeamName: home,
            awayTeamName: away,
            leagueName: leagueName,
            utcKickoff: utcKickoff,
            forceNew: forceNew,
            manual_H_xG: safeConvertToNumber(manual_H_xG),
            manual_H_xGA: safeConvertToNumber(manual_H_xGA),
            manual_A_xG: safeConvertToNumber(manual_A_xG),
            manual_A_xGA: safeConvertToNumber(manual_A_xGA),
            // === ÚJ v144.0: PPG paraméterek ===
            manual_H_PPG: safeConvertToNumber(manual_H_PPG),
            manual_A_PPG: safeConvertToNumber(manual_A_PPG),
            manual_absentees: manual_absentees 
        };
        
        const { 
            rawStats, 
            richContext,
            advancedData,
            form, 
            rawData, 
            leagueAverages = {}, 
            oddsData,
            xgSource,
            availableRosters
        }: IDataFetchResponse = await getRichContextualData(dataFetchOptions);
        // === Scout Végzett ===

        const absenceValidation = buildAbsenceValidation(rawData, manual_absentees);
        const absenceConfidenceMeta = absenceValidation?.meta;
        let absenceSummaryText = '';
        if (absenceValidation) {
            rawData.absentees = absenceValidation.mergedAbsentees;
            rawData.contextual_factors = rawData.contextual_factors || {
                stadium_location: null,
                pitch_condition: null,
                weather: null,
                match_tension_index: null,
                structured_weather: {
                    description: 'N/A',
                    temperature_celsius: null,
                    wind_speed_kmh: null,
                    precipitation_mm: null,
                    source: 'N/A'
                },
                coach: { home_name: null, away_name: null }
            };
            rawData.contextual_factors.absence_confidence = absenceValidation.meta;
            absenceSummaryText = `\n\n[HIÁNYZÓK MEGERŐSÍTÉSE]:\n${absenceValidation.summary}`;
        }
        
        // === ÚJ v128.0: Absentees kinyerése a rawData-ból ===
        const absentees = rawData?.absentees || undefined;
        // ================================================
        
        console.log(`Adatgyűjtés kész: ${home} vs ${away}.`);
        if (rawData && rawData.apiFootballData && rawData.apiFootballData.fixtureId) {
            fixtureIdForSaving = rawData.apiFootballData.fixtureId;
        }

        // --- 3. Piaci adatok előkészítése ---
        let mutableOddsData: ICanonicalOdds | null = oddsData;
        if (!mutableOddsData) {
            console.warn(`Figyelmeztetés: Nem sikerült szorzó adatokat lekérni ${home} vs ${away} meccshez.`);
            mutableOddsData = { 
                current: [], 
                allMarkets: [], 
                fromCache: false, 
                fullApiData: null 
            };
        }

        // === PIACI HÍRSZERZÉS (MARKET INTEL) GENERÁLÁSA ===
        const marketIntel = analyzeLineMovement(mutableOddsData, openingOdds, sport, home);
        const mainTotalsLine = findMainTotalsLine(mutableOddsData, sport) || sportConfig.totals_line;
        console.log(`Meghatározott fő gól/pont vonal: ${mainTotalsLine}`);
        console.log(`Piaci Hírszerzés: ${marketIntel}`);

        // === KRITIKUS LÉPÉS (v109.0): A Piaci Infó Injektálása a Kontextusba ===
        // Így minden AI ügynök (Pszichológus, Specialista, Főnök) látni fogja az oddsok mozgását.
        const enhancedRichContext = `${richContext}\n\n[PIACI HÍRSZERZÉS (MARKET WISDOM)]:\n${marketIntel}${absenceSummaryText}`;
        
        // === 2.5 ÜGYNÖK (PSZICHOLÓGUS) ===
        console.log(`[Lánc 2.5/6] Pszichológus Ügynök: Narratív profilalkotás...`);
        const psychologistReport = await runStep_Psychologist({
            rawDataJson: rawData,
            homeTeamName: home,
            awayTeamName: away,
            home_injuries: rawData.absentees?.home?.map(p => p.name).join(', ') || "N/A",
            away_injuries: rawData.absentees?.away?.map(p => p.name).join(', ') || "N/A"
        });
        const { psy_profile_home, psy_profile_away } = psychologistReport;
        console.log(`[Lánc 2.5/6] Pszichológus végzett.`);
        
        // === 2.6 LÉPÉS (ÖNJAVÍTÓ HUROK BEOLVASÁSA) ===
        console.log(`[Lánc 2.6/6] Önjavító Hurok: 7. Ügynök (Revizor) múltbeli tanulságainak beolvasása...`);
        const narrativeRatings = getNarrativeRatings();
        const homeNarrativeRating = narrativeRatings[home.toLowerCase()] || {};
        const awayNarrativeRating = narrativeRatings[away.toLowerCase()] || {};
        if (Object.keys(homeNarrativeRating).length > 0 || Object.keys(awayNarrativeRating).length > 0) {
            console.log(`[Lánc 2.6/6] Tanulságok betöltve. H: ${JSON.stringify(homeNarrativeRating)}, A: ${JSON.stringify(awayNarrativeRating)}`);
        } else {
            console.log(`[Lánc 2.6/6] Nincsenek múltbeli tanulságok a Narratív Cache-ben ehhez a párosításhoz.`);
        }

        // === 1. ÜGYNÖK (QUANT): "Tiszta xG" számítása - v134.0 JAVÍTVA (DERBY DETECTION) ===
        console.log(`[Lánc 1/6] Quant Ügynök: Tiszta xG számítása...`);
        const { pure_mu_h, pure_mu_a, source: quantSource, isDerby, derbyName } = estimatePureXG(
            home, 
            away, 
            rawStats, 
            sport, 
            form, 
            leagueAverages, 
            advancedData,
            sportStrategy,
            absentees // ÚJ v128.0: átadjuk az absentees-t is
        );
        console.log(`Quant (Tiszta xG) [${quantSource}]: H=${pure_mu_h.toFixed(2)}, A=${pure_mu_a.toFixed(2)}`);
        
        // v134.0: Derby figyelmeztetés
        if (isDerby) {
            console.log(`[AnalysisFlow v134.0] 🔥 DERBY FIGYELMEZTETÉS: ${derbyName} - KISZÁMÍTHATATLAN MECCS!`);
        }
        
        // === 3. ÜGYNÖK (SPECIALISTA) ===
        console.log(`[Lánc 3/6] Specialista Ügynök (AI): Kontextuális módosítók alkalmazása...`);
        
        const specialistInput = {
            pure_mu_h: pure_mu_h,
            pure_mu_a: pure_mu_a,
            quant_source: quantSource,
            rawDataJson: rawData, 
            sport: sport,
            psy_profile_home: psy_profile_home, 
            psy_profile_away: psy_profile_away,
            homeNarrativeRating: homeNarrativeRating,
            awayNarrativeRating: awayNarrativeRating,
            injuryConfidence: absenceConfidenceMeta
        };
        const specialistReport = await runStep_Specialist(specialistInput);

        // === BIZTONSÁGI SANITIZÁLÁS (v108.3) - v147.0: KORLÁTOK ELTÁVOLÍTVA ===
        const { modified_mu_h: raw_mu_h, modified_mu_a: raw_mu_a } = specialistReport;
        
        // v147.0 VICTORY PROTOCOL: Nincs több korlátozás, az AI módosítása az abszulút igazság!
        let mu_h = (typeof raw_mu_h === 'number' && !isNaN(raw_mu_h)) ? raw_mu_h : pure_mu_h;
        let mu_a = (typeof raw_mu_a === 'number' && !isNaN(raw_mu_a)) ? raw_mu_a : pure_mu_a;
        
        console.log(`Specialista (AI) (Súlyozott xG - Végleges): H=${mu_h.toFixed(2)}, A=${mu_a.toFixed(2)}`);
        
        const finalXgSource = xgSource;

        // === 4. ÜGYNÖK (SZIMULÁTOR): Meccs szimulálása ===
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(
            rawData, 
            sport, 
            leagueAverages,
            sportStrategy 
        );
        
        // === BIZALOM SZÁMÍTÁS (v105.0) ===
        const confidenceScores = calculateConfidenceScores(
            sport, 
            home, 
            away, 
            rawData, 
            form, 
            mu_h, 
            mu_a, 
            mainTotalsLine,
            marketIntel
        );
        console.log(`Szimulátor (Bizalom): Győztes=${confidenceScores.winner.toFixed(1)}, Pontok=${confidenceScores.totals.toFixed(1)}, Átlag=${confidenceScores.overall.toFixed(1)}`);

        // === v139.2: DINAMIKUS SZIMULÁCIÓ SZÁM (CONFIDENCE ALAPJÁN) ===
        // Magas confidence → több szimuláció (pontosabb)
        // Alacsony confidence → kevesebb szimuláció (gyorsabb)
        const baseSims = 25000;
        const confidenceMultiplier = Math.max(0.8, Math.min(1.5, confidenceScores.overall / 5.0));
        const finalSims = Math.round(baseSims * confidenceMultiplier);
        console.log(`[AnalysisFlow v139.2] Dinamikus szimuláció: ${finalSims} (confidence: ${confidenceScores.overall.toFixed(1)}/10, multiplier: ${confidenceMultiplier.toFixed(2)}x)`);

        const sim = simulateMatchProgress(
            mu_h, mu_a, 
            mu_corners, mu_cards, finalSims, sport, null, mainTotalsLine, rawData
        );
        
        sim.stat_confidence_winner = confidenceScores.winner; 
        sim.stat_confidence_totals = confidenceScores.totals;
        sim.stat_confidence_overall = confidenceScores.overall;
        
        sim.mu_h_sim = mu_h; sim.mu_a_sim = mu_a;
        sim.mu_corners_sim = mu_corners; sim.mu_cards_sim = mu_cards; sim.mainTotalsLine = mainTotalsLine;
        
        const valueBets = calculateValue(sim, mutableOddsData, sport, home, away);
        console.log(`Szimulátor végzett.`);


        // === 5/6. ÜGYNÖK (HIBRID FŐNÖK - v109.0) ===
        console.log(`[Lánc 5/6] "Hibrid Főnök" hívása (Apex Logic)...`);
        
        // Interfész definiálása
        interface FinalAnalysisInput {
            matchData: { home: string; away: string; sport: string; leagueName: string; };
            rawDataJson: ICanonicalRawData; 
            specialistReport: any; // Agent 3
            simulatorReport: any;  // Agent 4 (Sim)
            psyReport: any;        // Agent 2.5
            valueBetsJson: any[];
            richContext: string;
            sportStrategy: ISportStrategy;
            confidenceScores: { winner: number; totals: number; overall: number }; 
        }

        const finalAnalysisInput: FinalAnalysisInput = {
            matchData: { home, away, sport, leagueName },
            rawDataJson: rawData,
            specialistReport: specialistReport, 
            simulatorReport: sim,              
            psyReport: psychologistReport,     
            valueBetsJson: valueBets,
            // Itt adjuk át a KIBŐVÍTETT kontextust (v109.0)
            richContext: enhancedRichContext,
            sportStrategy: sportStrategy,
            confidenceScores: confidenceScores 
        };

        const finalReport: any = await runStep_FinalAnalysis(finalAnalysisInput);
        if (absenceConfidenceMeta) {
            finalReport.agent_reports = {
                ...(finalReport.agent_reports || {}),
                absence_confidence: absenceConfidenceMeta
            };
        }

        if (finalReport.error) {
            console.error("A Hibrid Főnök hibát adott vissza:", finalReport.error);
            throw new Error(finalReport.error);
        }
        
        const masterRecommendation = finalReport?.master_recommendation;
        let finalConfidenceScore = 1.0; 
        
        if (masterRecommendation && typeof masterRecommendation.final_confidence === 'number') {
            finalConfidenceScore = masterRecommendation.final_confidence;
        } else {
            console.error("KRITIKUS HIBA: A Hibrid Főnök nem adott vissza érvényes 'final_confidence' számot! 1.0-ra állítva.");
        }
        
        // === v139.0: NINCS TÖBB DERBY CONFIDENCE PENALTY! ===
        /*
        if (isDerby) {
            const originalConfidence = finalConfidenceScore;
            finalConfidenceScore = Math.max(1.0, Math.min(4.5, finalConfidenceScore - 2.5)); 
            
            console.log(`[AnalysisFlow v134.0] 🔥 DERBY PENALTY APPLIED:`);
            console.log(`  Original Confidence: ${originalConfidence.toFixed(1)}/10`);
            console.log(`  After Derby Penalty: ${finalConfidenceScore.toFixed(1)}/10 (MAX 4.5 - KISZÁMÍTHATATLAN!)`);
            console.log(`  Derby: ${derbyName}`);
            
            if (masterRecommendation && masterRecommendation.key_risks) {
                masterRecommendation.key_risks.unshift({
                    risk: `⚠️ DERBY MECCS (${derbyName})! A forma és statisztikák kevésbé relevánsak! Pszichológia > Matematika!`,
                    probability: 40
                });
            }
        }
        */
        // === Hibrid Főnök Végzett ===

        console.log(`Bizottsági Lánc Befejezve. Ajánlás: ${JSON.stringify(masterRecommendation)} (Végső bizalom: ${finalConfidenceScore})`);

        // --- 7. Válasz Elküldése és Naplózás ---
        const debugInfo = {
            playerDataSource: rawData?.detailedPlayerStats?.home_absentees?.length > 0 ?
                (manual_absentees ? 'P1 (Manuális)' : 'P2/P4 (Automatikus)') : 
                'Nincs adat',
            realXgUsed: finalXgSource,
            fromCache_RichContext: rawData?.fromCache ?? 'Ismeretlen'
        };
        
        const auditData = {
            analysisData: {
                committee: {
                    quant: { mu_h: pure_mu_h, mu_a: pure_mu_a, source: quantSource, isDerby, derbyName }, // v134.0: Derby info
                    specialist_mu: { mu_h: mu_h, mu_a: mu_a },
                    scout: { 
                        summary: richContext || "Nincs részletes kontextus.",
                        key_insights: [] 
                    },
                    critic: {
                        tactical_summary: finalReport?.risk_assessment || "Nincs kockázati elemzés.",
                        key_risks: [],
                        contradiction_score: 0.0
                    },
                    strategist: {
                        final_confidence_report: finalReport?.final_confidence_report,
                        prophetic_timeline: finalReport?.prophetic_timeline,
                        strategic_synthesis: finalReport?.strategic_synthesis,
                        micromodels: finalReport?.micromodels
                    }
                },
                matchData: {
                    home, 
                    away, 
                    sport, 
                    mainTotalsLine: sim.mainTotalsLine,
                    mu_h: sim.mu_h_sim,
                    mu_a: sim.mu_a_sim
                },
                valueBets: valueBets, 
                confidenceScores: {
                    winner: parseFloat(confidenceScores.winner.toFixed(1)),
                    totals: parseFloat(confidenceScores.totals.toFixed(1)),
                    overall: parseFloat(confidenceScores.overall.toFixed(1))
                },
                finalConfidenceScore: parseFloat(finalConfidenceScore.toFixed(1)),
                sim: {
                    pHome: sim.pHome, pDraw: sim.pDraw, pAway: sim.pAway,
                    pOver: sim.pOver, pUnder: sim.pUnder, pBTTS: sim.pBTTS,
                    topScore: sim.topScore
                },
                recommendation: masterRecommendation,
                narrativeRatingsUsed: {
                    home: homeNarrativeRating,
                    away: awayNarrativeRating
                }
            }
        };
        
        const jsonResponse: IAnalysisResponse = { 
            analysisData: {
                committee: {
                    quant: auditData.analysisData.committee.quant,
                    psychologist: psychologistReport, 
                    specialist: { 
                        mu_h: mu_h, 
                        mu_a: mu_a, 
                        log: specialistReport.reasoning,  
                        report: specialistReport   
                    },
                    strategist: finalReport 
                },
                matchData: auditData.analysisData.matchData,
                oddsData: mutableOddsData,
                valueBets: valueBets,
                confidenceScores: auditData.analysisData.confidenceScores, 
                finalConfidenceScore: auditData.analysisData.finalConfidenceScore,
                sim: sim,
                recommendation: masterRecommendation,
                xgSource: finalXgSource, 
                availableRosters: availableRosters,
                absenceConfidence: absenceConfidenceMeta
            },
            debugInfo: debugInfo 
        };

        scriptCache.set(analysisCacheKey, jsonResponse);
        console.log(`Elemzés befejezve és cache mentve (${analysisCacheKey})`);
        
        saveAnalysisToSheet({
            sport, 
            home, 
            away, 
            date: new Date(), 
            html: `<pre style="white-space: pre-wrap;">${JSON.stringify(auditData, null, 2)}</pre>`, 
            JSON_Data: JSON.stringify(auditData),
            id: analysisCacheKey,
            fixtureId: fixtureIdForSaving,
            recommendation: masterRecommendation
        })
            .then(() => console.log(`Elemzés (JSON) mentve a Google Sheet-be (${analysisCacheKey})`))
            .catch(sheetError => console.error(`Hiba az elemzés Google Sheet-be mentésekor (${analysisCacheKey}): ${sheetError.message}`));

        return jsonResponse;
    } catch (error: any) {
        const homeParam = params?.home || 'N-A';
        const awayParam = params?.away || 'N-A';
        const sportParam = sport || params?.sport || 'N-A';
        console.error(`Súlyos hiba az elemzési folyamatban (${sportParam} - ${homeParam} vs ${awayParam}): ${error.message}`, error.stack);
        return { error: `Elemzési hiba: ${error.message}` };
    }
}
