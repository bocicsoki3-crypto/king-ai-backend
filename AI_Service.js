/**
 * AI_Service.js (Node.js Verzió)
 * Felelős az AI modellel való kommunikációért (a DataFetch.js-en keresztül),
 * a promptok összeállításáért és a válaszok feldolgozásáért az elemzési folyamatban.
 * VÉGLEGES JAVÍTÁS: Explicit default export a ReferenceError elkerülésére.
 */

// Importáljuk a szükséges függvényeket és konfigurációt
import { getRichContextualData, getOptimizedOddsData, _callGeminiWithSearch, _getFixturesFromEspn } from './DataFetch.js';
import { calculateProbabilities, // Placeholder
         generateProTip,         // Placeholder
         simulateMatchProgress,  // Szükséges lehet
         estimateXG, estimateAdvancedMetrics, calculateModelConfidence,
         calculatePsychologicalProfile, calculateValue, analyzeLineMovement,
         analyzePlayerDuels, buildPropheticTimeline
       } from './Model.js';
import { saveToSheet } from './SheetService.js';
import { SPORT_CONFIG } from './config.js';

// --- PROMPT SABLONOK ---
// ... (Az összes prompt sablon változatlan marad, itt most nem ismétlem meg őket a rövidség kedvéért) ...
const MASTER_AI_PROMPT_TEMPLATE = `...`;
const COMMITTEE_MEMBER_PROMPT_TEMPLATE = `...`;
const TACTICAL_BRIEFING_PROMPT = `...`;
const PROPHETIC_SCENARIO_PROMPT = `...`;
const EXPERT_CONFIDENCE_PROMPT = `...`;
const RISK_ASSESSMENT_PROMPT = `...`;
const FINAL_GENERAL_ANALYSIS_PROMPT = `...`;
const AI_KEY_QUESTIONS_PROMPT = `...`;
const PLAYER_MARKETS_PROMPT = `...`;
const BTTS_ANALYSIS_PROMPT = `...`;
const SOCCER_GOALS_OU_PROMPT = `...`;
const CORNER_ANALYSIS_PROMPT = `...`;
const CARD_ANALYSIS_PROMPT = `...`;
const HOCKEY_GOALS_OU_PROMPT = `...`;
const HOCKEY_WINNER_PROMPT = `...`;
const BASKETBALL_POINTS_OU_PROMPT = `...`;
const STRATEGIC_CLOSING_PROMPT = `...`;

// --- HELPER a promptok kitöltéséhez ---
function fillPromptTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([\w_]+)\}/g, (match, key) => {
        let value = data;
        try {
            if (key in value) {
                value = value[key];
            } else {
                const keys = key.split('_');
                value = data;
                let found = true;
                for (const k of keys) {
                    if (value && typeof value === 'object' && k in value) {
                        value = value[k];
                    } else {
                        found = false;
                        break;
                    }
                }
                if (!found) {
                    if (key.endsWith('Json')) {
                        const baseKey = key.replace('Json', '');
                        if (data && data.hasOwnProperty(baseKey) && data[baseKey] !== undefined) {
                            try { return JSON.stringify(data[baseKey]); } catch (e) { return '{}'; }
                        } else {
                            return '{}';
                        }
                    }
                    value = null;
                }
            }
            if (typeof value === 'number' && !isNaN(value)) {
                 if (key.startsWith('sim_p') || key.startsWith('modelConfidence') || key.endsWith('_svp') || key.endsWith('_pct')) return value.toFixed(1);
                 if (key.startsWith('mu_') || key.startsWith('sim_mu_')) return value.toFixed(2);
                 if (key.startsWith('pace_') || key.startsWith('off_rtg_') || key.startsWith('def_rtg_')) return value.toFixed(1);
                 if (key.includes('_cor_') || key.includes('_cards') || key.endsWith('_advantage')) return value.toFixed(1);
                 if (key === 'line' || key === 'likelyLine' || key === 'sim_mainTotalsLine') return value.toString();
                 return value;
            }
            return String(value ?? "N/A");
        } catch (e) {
            console.error(`Hiba a placeholder kitöltésekor: {${key}}`, e);
            return "HIBA";
        }
    });
}

// === Placeholder az ellentmondás-analízishez ===
export async function _getContradictionAnalysis(context, probabilities, odds) {
    console.warn("_getContradictionAnalysis placeholder hívva - ez a funkció jelenleg nincs implementálva.");
    return "Ellentmondás-analízis kihagyva.";
}

// === getAiKeyQuestions ===
export async function getAiKeyQuestions(richContext) {
  if (!richContext || typeof richContext !== 'string') {
      console.error("getAiKeyQuestions: Hiányzó vagy érvénytelen kontextus.");
      return "- Hiba: A kulcskérdések generálásához szükséges kontextus hiányzik.";
  }
  const prompt = fillPromptTemplate(AI_KEY_QUESTIONS_PROMPT, { richContext });
  try {
      const responseText = await _callGeminiWithSearch(prompt);
      return responseText ? responseText.trim() : "- Hiba: Az AI nem tudott kulcskérdéseket generálni.";
  } catch (e) {
      console.error(`getAiKeyQuestions hiba: ${e.message}`);
      return `- Hiba a kulcskérdések generálásakor: ${e.message}`;
  }
}

// === getTacticalBriefing ===
export async function getTacticalBriefing(rawData, sport, home, away, duelAnalysis) {
    // console.warn("getTacticalBriefing hívva");
    if (!rawData?.tactics?.home || !rawData?.tactics?.away) {
        return "A taktikai elemzéshez szükséges adatok hiányosak.";
    }
    const data = {
        sport: sport, home: home, away: away,
        home_style: rawData.tactics.home.style || "N/A",
        away_style: rawData.tactics.away.style || "N/A",
        duelAnalysis: duelAnalysis || 'Nincs kiemelt párharc elemzés.',
        key_players_home: rawData.key_players?.home?.map(p => p.name).join(', ') || 'N/A',
        key_players_away: rawData.key_players?.away?.map(p => p.name).join(', ') || 'N/A'
    };
    const prompt = fillPromptTemplate(TACTICAL_BRIEFING_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a taktikai elemzés generálása során.";
}

// === getPropheticScenario ===
export async function getPropheticScenario(propheticTimeline, rawData, home, away, sport) {
    // console.warn("getPropheticScenario hívva");
     if (!propheticTimeline || !Array.isArray(propheticTimeline)) {
        console.warn("getPropheticScenario: Nincs érvényes idővonal (nem tömb), alapértelmezett forgatókönyv.");
        return `A mérkőzés várhatóan kiegyenlített küzdelmet hoz. Óvatos kezdés után a második félidő hozhatja meg a döntést, de a **kevés gólos döntetlen** reális kimenetel.`;
    }
     const data = {
        sport: sport, home: home, away: away,
        timelineJson: JSON.stringify(propheticTimeline),
        home_style: rawData?.tactics?.home?.style || 'N/A',
        away_style: rawData?.tactics?.away?.style || 'N/A',
        tension: rawData?.contextual_factors?.match_tension_index || 'N/A'
    };
    const prompt = fillPromptTemplate(PROPHETIC_SCENARIO_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a forgatókönyv generálása során.";
}

// === getExpertConfidence ===
export async function getExpertConfidence(modelConfidence, richContext) {
    // console.warn("getExpertConfidence hívva");
    if (typeof modelConfidence !== 'number' || !richContext || typeof richContext !== 'string') {
        console.error("getExpertConfidence: Érvénytelen bemeneti adatok.");
        return "**1.0/10** - Hiba: Érvénytelen adatok a kontextuális bizalomhoz.";
    }
    const data = { modelConfidence: modelConfidence, richContext: richContext };
    const prompt = fillPromptTemplate(EXPERT_CONFIDENCE_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    if (response && response.match(/\*\*\d+(\.\d+)?\/10\*\* - .+./)) {
        return response;
    } else {
        console.error("getExpertConfidence: Az AI válasza érvénytelen formátumú:", response);
        const fallbackConfidence = Math.max(1.0, Math.min(10.0, modelConfidence * 0.8)).toFixed(1);
        return `**${fallbackConfidence}/10** - Figyelmeztetés: Az AI kontextus értékelése sikertelen, a modell bizalma csökkentve.`;
    }
}

// === getRiskAssessment ===
export async function getRiskAssessment(sim, rawData, sport, marketIntel) {
    // console.warn("getRiskAssessment hívva");
    if (!sim || typeof sim.pHome !== 'number' || !rawData || marketIntel === undefined) {
        console.warn("getRiskAssessment: Hiányos bemeneti adatok.");
        return "A kockázatelemzéshez szükséges adatok hiányosak.";
    }
     const data = {
        sport: sport, sim: sim, marketIntel: marketIntel || "N/A",
        news_home: rawData?.team_news?.home || 'N/A', news_away: rawData?.team_news?.away || 'N/A',
        form_home: rawData?.form?.home_overall || 'N/A', form_away: rawData?.form?.away_overall || 'N/A',
        motiv_home: rawData?.contextual_factors?.motivation_home || 'N/A',
        motiv_away: rawData?.contextual_factors?.motivation_away || 'N/A'
    };
    const prompt = fillPromptTemplate(RISK_ASSESSMENT_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a kockázatelemzés generálása során.";
}

// === getFinalGeneralAnalysis ===
export async function getFinalGeneralAnalysis(sim, tacticalBriefing, propheticScenario) {
     // console.warn("getFinalGeneralAnalysis hívva");
     if (!sim || typeof sim.pHome !== 'number' || typeof sim.mu_h_sim !== 'number' || !tacticalBriefing || !propheticScenario) {
         console.warn("getFinalGeneralAnalysis: Hiányos bemeneti adatok.");
         return "Az általános elemzéshez szükséges adatok hiányosak.";
     }
     const data = { sim: sim, mu_h: sim.mu_h_sim, mu_a: sim.mu_a_sim, tacticalBriefing: tacticalBriefing, propheticScenario: propheticScenario };
     const prompt = fillPromptTemplate(FINAL_GENERAL_ANALYSIS_PROMPT, data);
     const response = await _callGeminiWithSearch(prompt);
     return response || "Hiba történt az általános elemzés generálása során.";
 }

// === getPlayerMarkets ===
export async function getPlayerMarkets(keyPlayers, richContext) {
   // console.warn("getPlayerMarkets hívva");
   if (!keyPlayers || (!keyPlayers.home?.length && !keyPlayers.away?.length)) {
       return "Nincsenek kiemelt kulcsjátékosok.";
   }
   if (!richContext || typeof richContext !== 'string') {
       return "A játékospiacok elemzéséhez kontextus hiányzik.";
   }
   const data = { keyPlayers: keyPlayers, richContext: richContext };
   const prompt = fillPromptTemplate(PLAYER_MARKETS_PROMPT, data);
   const response = await _callGeminiWithSearch(prompt);
   return response || "Hiba történt a játékospiacok elemzése során.";
}

// === PIAC-SPECIFIKUS AI HÍVÁSOK ===

export async function getBTTSAnalysis(sim, rawData) {
    // console.warn("getBTTSAnalysis hívva");
    if (typeof sim?.pBTTS !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData) {
        return "A BTTS elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { sim: sim, form_home_gf: rawData.form?.home_gf ?? 'N/A', form_home_ga: rawData.form?.home_ga ?? 'N/A', form_away_gf: rawData.form?.away_gf ?? 'N/A', form_away_ga: rawData.form?.away_ga ?? 'N/A', news_home_att: rawData.team_news?.home_attackers_missing || 'Nincs hír', news_away_att: rawData.team_news?.away_attackers_missing || 'Nincs hír', news_home_def: rawData.team_news?.home_defenders_missing || 'Nincs hír', news_away_def: rawData.team_news?.away_defenders_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(BTTS_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a BTTS elemzés generálása során. Bizalom: Alacsony";
}

export async function getSoccerGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getSoccerGoalsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || typeof sim?.mu_h_sim !== 'number' || !rawData || typeof mainTotalsLine !== 'number') {
       return `A Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim, form_avg_goals: (((rawData.form?.home_gf ?? 0) + (rawData.form?.home_ga ?? 0) + (rawData.form?.away_gf ?? 0) + (rawData.form?.away_ga ?? 0)) / 10).toFixed(2) || 'N/A', style_home: rawData.tactics?.home?.style || 'N/A', style_away: rawData.tactics?.away?.style || 'N/A', news_home_att: rawData.team_news?.home_attackers_missing || 'Nincs hír', news_away_att: rawData.team_news?.away_attackers_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(SOCCER_GOALS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getCornerAnalysis(sim, rawData) {
    // console.warn("getCornerAnalysis hívva");
    if (!sim?.corners || !rawData?.advanced_stats) {
       return "A Szöglet elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cornerProbs = sim.corners; const cornerKeys = Object.keys(cornerProbs).filter(k => k.startsWith('o')); const likelyLine = cornerKeys.length > 0 ? parseFloat(cornerKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cornerKeys.length / 2)].substring(1)) : 9.5; const overProbKey = `o${likelyLine}`; const overProb = sim.corners[overProbKey];
    const data = { likelyLine: likelyLine, sim: sim, sim_oProb: overProb,
                   adv_home_cor_for: rawData.advanced_stats?.home?.avg_corners_for_per_game, adv_home_cor_ag: rawData.advanced_stats?.home?.avg_corners_against_per_game,
                   adv_away_cor_for: rawData.advanced_stats?.away?.avg_corners_for_per_game, adv_away_cor_ag: rawData.advanced_stats?.away?.avg_corners_against_per_game,
                   style_home: rawData.tactics?.home?.style, style_away: rawData.tactics?.away?.style,
                   adv_shots_sum: ((rawData.advanced_stats?.home?.shots_per_game || 0) + (rawData.advanced_stats?.away?.shots_per_game || 0)) };
    const prompt = fillPromptTemplate(CORNER_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Szöglet elemzés generálása során. Bizalom: Alacsony";
}

export async function getCardAnalysis(sim, rawData) {
    // console.warn("getCardAnalysis hívva");
    if (!sim?.cards || !rawData?.advanced_stats || !rawData.referee) {
       return "A Lapok elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const cardProbs = sim.cards; const cardKeys = Object.keys(cardProbs).filter(k => k.startsWith('o')); const likelyLine = cardKeys.length > 0 ? parseFloat(cardKeys.sort((a,b)=>parseFloat(a.substring(1))-parseFloat(b.substring(1)))[Math.floor(cardKeys.length / 2)].substring(1)) : 4.5; const overProbKey = `o${likelyLine}`; const overProb = sim.cards[overProbKey];
    const data = { likelyLine: likelyLine, sim: sim, sim_oProb: overProb,
                   adv_home_cards: rawData.advanced_stats?.home?.avg_cards_per_game, adv_away_cards: rawData.advanced_stats?.away?.avg_cards_per_game,
                   ref_name: rawData.referee?.name, ref_stats: rawData.referee?.stats,
                   tension: rawData.contextual_factors?.match_tension_index,
                   style_home: rawData.tactics?.home?.style, style_away: rawData.tactics?.away?.style };
    const prompt = fillPromptTemplate(CARD_ANALYSIS_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Lapok elemzés generálása során. Bizalom: Alacsony";
}

export async function getHockeyGoalsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getHockeyGoalsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Jégkorong Gólok O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim,
                   goalie_home_name: rawData.advanced_stats?.home?.starting_goalie_name, goalie_home_svp: rawData.advanced_stats?.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.home?.goalie_save_pct_season,
                   goalie_away_name: rawData.advanced_stats?.away?.starting_goalie_name, goalie_away_svp: rawData.advanced_stats?.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.away?.goalie_save_pct_season,
                   pp_home: rawData.advanced_stats?.home?.pp_pct, pk_away: rawData.advanced_stats?.away?.pk_pct,
                   pp_away: rawData.advanced_stats?.away?.pp_pct, pk_home: rawData.advanced_stats?.home?.pk_pct };
    const prompt = fillPromptTemplate(HOCKEY_GOALS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Jégkorong Gólok O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getHockeyWinnerAnalysis(sim, rawData) {
    // console.warn("getHockeyWinnerAnalysis hívva");
    if (typeof sim?.pHome !== 'number' || !rawData?.advanced_stats || !rawData.form) {
       return "A Jégkorong Győztes elemzéshez adatok hiányosak. Bizalom: Alacsony";
    }
    const data = { sim: sim,
                   goalie_home_name: rawData.advanced_stats?.home?.starting_goalie_name, goalie_home_svp: rawData.advanced_stats?.home?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.home?.goalie_save_pct_season,
                   goalie_away_name: rawData.advanced_stats?.away?.starting_goalie_name, goalie_away_svp: rawData.advanced_stats?.away?.starting_goalie_save_pct_last5 || rawData.advanced_stats?.away?.goalie_save_pct_season,
                   pp_home: rawData.advanced_stats?.home?.pp_pct, pk_away: rawData.advanced_stats?.away?.pk_pct,
                   pp_away: rawData.advanced_stats?.away?.pp_pct, pk_home: rawData.advanced_stats?.home?.pk_pct,
                   form_home: rawData.form?.home_overall, form_away: rawData.form?.away_overall };
    const prompt = fillPromptTemplate(HOCKEY_WINNER_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "Hiba történt a Jégkorong Győztes elemzés generálása során. Bizalom: Alacsony";
}

export async function getBasketballPointsOUAnalysis(sim, rawData, mainTotalsLine) {
    // console.warn("getBasketballPointsOUAnalysis hívva");
    if (typeof sim?.pOver !== 'number' || !rawData || typeof mainTotalsLine !== 'number' || !rawData.advanced_stats) {
       return `A Kosár Pont O/U ${mainTotalsLine ?? '?'} elemzéshez adatok hiányosak. Bizalom: Alacsony`;
    }
    const line = mainTotalsLine;
    const data = { line: line, sim: sim,
                   pace_home: rawData.advanced_stats?.home?.pace, pace_away: rawData.advanced_stats?.away?.pace,
                   off_rtg_home: rawData.advanced_stats?.home?.offensive_rating, def_rtg_home: rawData.advanced_stats?.home?.defensive_rating,
                   off_rtg_away: rawData.advanced_stats?.away?.offensive_rating, def_rtg_away: rawData.advanced_stats?.away?.defensive_rating,
                   ff_home: rawData.advanced_stats?.home?.four_factors || {}, ff_away: rawData.advanced_stats?.away?.four_factors || {}, // A fillPromptTemplate kezeli a JSON-ná alakítást
                   news_home_score: rawData.team_news?.home_scorers_missing || 'Nincs hír', news_away_score: rawData.team_news?.away_scorers_missing || 'Nincs hír' };
    const prompt = fillPromptTemplate(BASKETBALL_POINTS_OU_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || `Hiba történt a Kosár Pont O/U ${line} elemzés generálása során. Bizalom: Alacsony`;
}

export async function getStrategicClosingThoughts(sim, rawData, richContext, marketIntel, microAnalyses, riskAssessment) {
    // console.warn("getStrategicClosingThoughts hívva");
    if (!sim || !rawData || !richContext || marketIntel === undefined || !microAnalyses || !riskAssessment) {
        return "### Stratégiai Zárógondolatok\nA stratégiai összefoglalóhoz adatok hiányosak.";
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {
        if (!analysis || typeof analysis !== 'string') return null;
        const conclusionMatch = analysis.match(/\*\*(.*?)\*\*/); const confidenceMatch = analysis.match(/Bizalom:\s*(.*)/i);
        return `${key.toUpperCase()}: ${conclusionMatch ? conclusionMatch[1] : 'N/A'} (Bizalom: ${confidenceMatch ? confidenceMatch[1] : 'N/A'})`;
    }).filter(Boolean).join('; ');
    const data = {
        propheticScenario: rawData?.propheticScenario || 'N/A', // Ez a rawData-ban van? Vagy a committeeResults-ban kellene lennie?
        sim: sim, marketIntel: marketIntel || "N/A", microSummary: microSummary || 'Nincsenek', // JSON helyett string
        richContext: richContext, riskAssessment: riskAssessment
     };
    const prompt = fillPromptTemplate(STRATEGIC_CLOSING_PROMPT, data);
    const response = await _callGeminiWithSearch(prompt);
    return response || "### Stratégiai Zárógondolatok\nHiba történt a stratégiai elemzés generálása során.";
}

export async function getMasterRecommendation(valueBets, sim, modelConfidence, expertConfidence, riskAssessment, microAnalyses, generalAnalysis, strategicClosingThoughts) {
    // console.warn("getMasterRecommendation hívva");
    if (!sim || typeof modelConfidence !== 'number' || !expertConfidence || !riskAssessment || !generalAnalysis || !strategicClosingThoughts) {
         console.error("getMasterRecommendation: Hiányos kritikus bemeneti adatok.");
         return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": "Hiba: Hiányos adatok." };
    }
    let microSummary = Object.entries(microAnalyses || {}).map(([key, analysis]) => {
        if (!analysis || typeof analysis !== 'string') return null;
        const conclusionMatch = analysis.match(/\*\*(.*?)\*\*/); const confidenceMatch = analysis.match(/Bizalom:\s*(.*)/i);
        return `${key.toUpperCase()}: ${conclusionMatch ? conclusionMatch[1] : 'N/A'} (Bizalom: ${confidenceMatch ? confidenceMatch[1] : 'N/A'})`;
    }).filter(Boolean).join('; ');
    const data = {
        valueBets: valueBets || [], // A fillPromptTemplate kezeli a Json-t
        sim: sim, modelConfidence: modelConfidence, expertConfidence: expertConfidence,
        riskAssessment: riskAssessment, microSummary: microSummary || 'Nincsenek',
        generalAnalysis: generalAnalysis, strategicClosingThoughts: strategicClosingThoughts
    };
    const prompt = fillPromptTemplate(MASTER_AI_PROMPT_TEMPLATE, data);
    try {
        const responseText = await _callGeminiWithSearch(prompt);
        if (!responseText) { throw new Error("Nem érkezett válasz."); }
        let jsonString = responseText;
        let recommendation;
        try { recommendation = JSON.parse(jsonString); } catch (e1) {
             const codeBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/); if (codeBlockMatch && codeBlockMatch[1]) { jsonString = codeBlockMatch[1]; } else { const firstBrace = jsonString.indexOf('{'); const lastBrace = jsonString.lastIndexOf('}'); if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) { jsonString = jsonString.substring(firstBrace, lastBrace + 1); } else { throw new Error("Nem sikerült JSON-t kinyerni: " + responseText.substring(0, 300)); } }
             try { recommendation = JSON.parse(jsonString); } catch(e2) { console.error("Érvénytelen JSON tisztítás után is:", jsonString.substring(0, 500)); throw new Error(`Érvénytelen JSON formátum: ${e2.message}`); }
        }
        if (recommendation?.recommended_bet && typeof recommendation.final_confidence === 'number' && recommendation.brief_reasoning) {
            recommendation.final_confidence = Math.max(1.0, Math.min(10.0, recommendation.final_confidence));
            console.log(`Mester Ajánlás: ${recommendation.recommended_bet} (${recommendation.final_confidence}/10)`);
            return recommendation;
        } else { throw new Error("Érvénytelen JSON struktúra."); }
    } catch (e) {
        console.error(`Végleges hiba a Mester Ajánlás generálása során: ${e.message}`);
        return { "recommended_bet": "Nincs fogadás", "final_confidence": 1.0, "brief_reasoning": `Hiba: ${e.message.substring(0,100)}` };
    }
}


// --- FŐ ELEMZÉSI FOLYAMAT (runAnalysisFlow) ---
export async function runAnalysisFlow(sport, homeTeam, awayTeam, leagueName, matchDate, openingOdds = null) {
    console.log(`Elemzés indítása: ${homeTeam} vs ${awayTeam} (${leagueName})`);

    let contextualData;
    let oddsData;
    let probabilities; // Ezt a Model.js-ből kellene feltölteni
    let sim; // A szimuláció eredménye
    let committeeAnalysis = "N/A"; // Kihagyva

    try {
        // 1. Adatgyűjtés (Vertex AI + Search + Odds)
        console.log("Adatgyűjtés (Vertex AI + Search)...");
        contextualData = await getRichContextualData(sport, homeTeam, awayTeam, leagueName);
        oddsData = contextualData.oddsData;

        const oddsString = oddsData?.current?.map(o => `${o.name}: ${o.price}`).join(', ') || "N/A";

        if (!contextualData || !contextualData.rawStats) {
             throw new Error("Kritikus hiba: Az adatgyűjtés nem adott vissza érvényes struktúrát.");
        }
        console.log("Adatgyűjtés kész.");

        // === JAVÍTÁS: Szimuláció futtatása itt ===
        console.log("Statisztikai modellezés és szimuláció futtatása...");
        const sportConfig = SPORT_CONFIG[sport];
        if (!sportConfig) throw new Error(`Nincs konfiguráció a(z) '${sport}' sporthoz.`);

        const psyProfileHome = calculatePsychologicalProfile(homeTeam, awayTeam); // Model.js
        const psyProfileAway = calculatePsychologicalProfile(awayTeam, homeTeam); // Model.js
        const { mu_h, mu_a } = estimateXG(homeTeam, awayTeam, contextualData.rawStats, sport, contextualData.form, contextualData.leagueAverages, contextualData.advancedData, contextualData.rawData, psyProfileHome, psyProfileAway); // Model.js
        const { mu_corners, mu_cards } = estimateAdvancedMetrics(contextualData.rawData, sport, contextualData.leagueAverages); // Model.js
        const mainTotalsLine = oddsData?.allMarkets ? findMainTotalsLine(oddsData) : sportConfig.totals_line; // DataFetch.js (ha van odds) vagy config
        // Futtatjuk a szimulációt
        sim = simulateMatchProgress(mu_h, mu_a, mu_corners, mu_cards, 25000, sport, null, mainTotalsLine, contextualData.rawData); // Model.js
        sim.mainTotalsLine = mainTotalsLine; // Hozzáadjuk a vonalat az eredményhez
        const modelConfidence = calculateModelConfidence(sport, homeTeam, awayTeam, contextualData.rawData, contextualData.form, sim); // Model.js
        const valueBets = calculateValue(sim, oddsData, sport, homeTeam, awayTeam); // Model.js
        const marketIntel = analyzeLineMovement(oddsData, openingOdds, sport, homeTeam); // Model.js
        const duelAnalysis = analyzePlayerDuels(contextualData.rawData?.key_players, sport); // Model.js
        console.log("Statisztikai modellezés kész.");
        // ===========================================

        // 3. AI Bizottság (Kihagyva - de az eredményeit használó AI hívásokhoz kellhetnek az adatok)
        console.log("AI Bizottság futtatása kihagyva.");
        // DE: Szükségünk van azokra az adatokra, amiket a Bizottság AI-jai generálnának
        // Most párhuzamosan hívjuk őket, hogy meglegyenek az inputok a Mester AI-hoz
        console.log("AI elemzők párhuzamos futtatása...");
        const analysisPromises = {
             riskAssessment: getRiskAssessment(sim, contextualData.rawData, sport, marketIntel),
             tacticalBriefing: getTacticalBriefing(contextualData.rawData, sport, homeTeam, awayTeam, duelAnalysis),
             propheticScenario: getPropheticScenario(buildPropheticTimeline(mu_h, mu_a, contextualData.rawData, sport, homeTeam, awayTeam), contextualData.rawData, homeTeam, awayTeam, sport),
             expertConfidence: getExpertConfidence(modelConfidence, contextualData.richContext),
             keyQuestions: getAiKeyQuestions(contextualData.richContext),
             playerMarkets: getPlayerMarkets(contextualData.rawData?.key_players, contextualData.richContext),
             // Piac-specifikus modellek
             btts: sport === 'soccer' ? getBTTSAnalysis(sim, contextualData.rawData) : Promise.resolve("N/A"),
             goalsOU: sport === 'soccer' ? getSoccerGoalsOUAnalysis(sim, contextualData.rawData, mainTotalsLine) :
                      sport === 'hockey' ? getHockeyGoalsOUAnalysis(sim, contextualData.rawData, mainTotalsLine) :
                      sport === 'basketball' ? getBasketballPointsOUAnalysis(sim, contextualData.rawData, mainTotalsLine) : Promise.resolve("N/A"),
             corners: sport === 'soccer' ? getCornerAnalysis(sim, contextualData.rawData) : Promise.resolve("N/A"),
             cards: sport === 'soccer' ? getCardAnalysis(sim, contextualData.rawData) : Promise.resolve("N/A"),
             winner: sport === 'hockey' ? getHockeyWinnerAnalysis(sim, contextualData.rawData) : Promise.resolve("N/A")
             // Contradiction Analysis kihagyva
        };

        const analysisResults = {};
        const microAnalyses = {};
        // Várjuk be az összes AI hívást
        const promiseEntries = Object.entries(analysisPromises);
        const resolvedResults = await Promise.all(promiseEntries.map(entry => entry[1].catch(e => {
            console.error(`Hiba a(z) ${entry[0]} AI hívásakor: ${e.message}`);
            return `Hiba: ${e.message}`; // Hibát adunk vissza stringként
        })));

        // Feldolgozzuk az eredményeket
        promiseEntries.forEach(([key, _], index) => {
            analysisResults[key] = resolvedResults[index];
            // Gyűjtjük a microAnalyses-be a piac-specifikusakat
            if (['btts', 'goalsOU', 'corners', 'cards', 'winner', 'pointsOU'].includes(key)) {
                microAnalyses[key] = resolvedResults[index];
            }
        });
        console.log("AI elemzők lefutottak.");

        // General Analysis futtatása a szükséges inputokkal
        analysisResults.generalAnalysis = await getFinalGeneralAnalysis(sim, analysisResults.tacticalBriefing, analysisResults.propheticScenario);
        // Strategic Closing Thoughts futtatása
        analysisResults.strategicClosingThoughts = await getStrategicClosingThoughts(sim, contextualData.rawData, contextualData.richContext, marketIntel, microAnalyses, analysisResults.riskAssessment);


        // 4. Mester AI Hívása
        console.log("Mester Ajánlás kérése...");
        const masterRecommendation = await getMasterRecommendation(
            valueBets, sim, modelConfidence, analysisResults.expertConfidence,
            analysisResults.riskAssessment, microAnalyses, analysisResults.generalAnalysis,
            analysisResults.strategicClosingThoughts
        );

        // 5. Eredmény Összeállítása és Mentése
        const finalResult = {
            match: `${homeTeam} vs ${awayTeam}`,
            league: leagueName,
            date: matchDate,
            probabilities: { // Valós valószínűségek a szimulációból
                pHome: sim.pHome, pDraw: sim.pDraw, pAway: sim.pAway, pBTTS: sim.pBTTS,
                pOver: sim.pOver, pUnder: sim.pUnder
            },
            context: contextualData.richContext,
            odds: oddsData?.current || [],
            prediction: masterRecommendation, // A Mester AI JSON válasza
            fullRawData: contextualData.rawData, // Nyers adatok
            // AI elemzések hozzáadása az eredményhez (opcionális)
            aiAnalyses: {
                modelConfidence: modelConfidence,
                expertConfidence: analysisResults.expertConfidence,
                riskAssessment: analysisResults.riskAssessment,
                tacticalBriefing: analysisResults.tacticalBriefing,
                propheticScenario: analysisResults.propheticScenario,
                generalAnalysis: analysisResults.generalAnalysis,
                strategicClosingThoughts: analysisResults.strategicClosingThoughts,
                keyQuestions: analysisResults.keyQuestions,
                playerMarkets: analysisResults.playerMarkets,
                marketIntel: marketIntel,
                valueBets: valueBets,
                microAnalyses: microAnalyses
            }
        };

        console.log("Végleges Tipp:", finalResult.prediction);

        saveToSheet(finalResult).catch(err => console.error("Hiba a Google Sheet mentés során:", err.message));

        return finalResult;

    } catch (error) {
        console.error(`Súlyos hiba az elemzési folyamban (${homeTeam} vs ${awayTeam}): ${error.message}`);
        console.error("Hiba részletei:", error.stack);
        throw new Error(`Elemzési hiba (${homeTeam} vs ${awayTeam}): ${error.message}`);
    }
}

// --- CHAT FUNKCIÓ ---
// JAVÍTÁS: Export kulcsszó hozzáadva a definícióhoz
export async function getChatResponse(context, history, question) {
    if (!context || !question) { // Input validation
        console.error("Chat hiba: Hiányzó kontextus vagy kérdés.");
        return { error: "Hiányzó kontextus vagy kérdés." };
    }
    const validHistory = Array.isArray(history) ? history : []; // History validation

    try {
        // Build history string
        let historyString = validHistory.map(msg => { //
            const role = msg.role === 'user' ? 'Felh' : 'AI'; // Map role
            const text = msg.parts?.[0]?.text || msg.text || ''; // Get text safely
            return `${role}: ${text}`; // Format message
        }).join('\n'); // Join messages

        // Construct prompt
        const prompt = `You are an elite sports analyst AI assistant. Continue the conversation based on the context and history.
Analysis Context (DO NOT repeat, just use): --- ANALYSIS START --- ${context} --- ANALYSIS END ---
Chat History:
${historyString}
Current User Question: ${question}
Your Task: Answer concisely and accurately in Hungarian based ONLY on the Analysis Context/History. If the answer isn't there, say so politely. Stay professional. Keep answers brief.`; // Chat prompt

        // Call AI (using search-enabled function - potentially wasteful)
        // TODO: Consider adding a parameter to _callGeminiWithSearch to disable 'tools' for chat
        const answer = await _callGeminiWithSearch(prompt); //

        if (answer) { // If answer received
            let cleanedAnswer = answer.trim(); // Trim whitespace
            // Remove potential markdown code blocks
            const jsonMatch = cleanedAnswer.match(/```json\n([\s\S]*?)\n```/); //
            if (jsonMatch?.[1]) cleanedAnswer = jsonMatch[1]; //

            return { answer: cleanedAnswer }; // Return successful answer
        } else { // If AI call returned null
            console.error("Chat AI hiba: Nem érkezett válasz a Geminitől."); // Log error
            return { error: "Az AI nem tudott válaszolni." }; // Return error object
        }
    } catch (e) { // Catch errors during AI call or processing
        console.error(`Chat hiba: ${e.message}`); // Log error
        return { error: `Chat AI hiba: ${e.message}` }; // Return error object
    }
}


// --- FŐ EXPORT ---
// JAVÍTÁS: Explicit kulcs-érték párok a ReferenceError elkerülésére
export default {
    runAnalysisFlow: runAnalysisFlow,
    getChatResponse: getChatResponse,
    _getContradictionAnalysis: _getContradictionAnalysis, // Placeholder
    getAiKeyQuestions: getAiKeyQuestions,
    getTacticalBriefing: getTacticalBriefing,
    getPropheticScenario: getPropheticScenario,
    getExpertConfidence: getExpertConfidence,
    getRiskAssessment: getRiskAssessment,
    getFinalGeneralAnalysis: getFinalGeneralAnalysis,
    getPlayerMarkets: getPlayerMarkets,
    getMasterRecommendation: getMasterRecommendation,
    getStrategicClosingThoughts: getStrategicClosingThoughts,
    getBTTSAnalysis: getBTTSAnalysis,
    getSoccerGoalsOUAnalysis: getSoccerGoalsOUAnalysis,
    getCornerAnalysis: getCornerAnalysis,
    getCardAnalysis: getCardAnalysis,
    getHockeyGoalsOUAnalysis: getHockeyGoalsOUAnalysis,
    getHockeyWinnerAnalysis: getHockeyWinnerAnalysis,
    getBasketballPointsOUAnalysis: getBasketballPointsOUAnalysis,
    getFixtures: _getFixturesFromEspn // Alias az ESPN lekérdezőhöz
};