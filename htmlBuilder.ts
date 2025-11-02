// --- htmlBuilder.ts (v53.0 - Dialektikus CoT) ---
// MÓDOSÍTÁS: A HTML generátor teljesen átírva, hogy az új
// "Committee of Experts" (Quant/Scout/Strategist) kimenetét
// (pl. 'strategic_conflict_resolution') jelenítse meg.

import type { ICanonicalOdds } from './src/types/canonical.d.ts';

/**************************************************************
* htmlBuilder.ts - HTML Generátor Modul (Node.js Verzió)
* VÁLTOZÁS (v53.0 - Dialektikus CoT):
* - A 'processAiText' robusztusabbá téve (String() kényszerítés).
* - Az 'accordionHtml' átírva, hogy a Quant, Scout és Strategist
* jelentéseit jelenítse meg.
**************************************************************/

/**
 * Robusztus és hatékony escapeHTML függvény
 */
function escapeHTML(str: string | null | undefined): string {
    if (str == null) return '';
    let tempStr = String(str);

    // 1. lépés: Alap HTML karakterek escape-elése
    const escapeMap: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    tempStr = tempStr.replace(/[&<>"']/g, (match) => escapeMap[match]);
    
    // 2. lépés: A **kiemelés** cseréje <strong> tag-re.
    tempStr = tempStr.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    return tempStr;
}

/**
 * Segédfüggvény AI szövegek feldgozásához (escape + newline -> <br>)
 * JAVÍTÁS: A bemenetet explicit stringgé alakítjuk a .trim() előtt.
 */
const processAiText = (text: string | null | undefined): string => {
    // === JAVÍTÁS (A KRITIKUS SOR) ===
    // Biztosítjuk, hogy a 'text' érvényes string legyen, különben üres stringet használunk.
    const safeText = String(text || ''); // <- A javítás: Mindig string!

    if (safeText.includes("Hiba") || safeText.trim() === 'N/A') {
        return `<p>${escapeHTML(safeText || "N/A.")}</p>`; 
    }
    const escapedHtml = escapeHTML(safeText);
    return escapedHtml.replace(/\n/g, '<br>');
};

/**
 * Segédfüggvény listák (tömbök) HTML-be illesztéséhez
 */
const processAiList = (list: string[] | null | undefined): string => {
    if (!list || !Array.isArray(list) || list.length === 0) {
        return '<li>Nincs adat.</li>';
    }
    return list.map(item => `<li>${processAiText(item)}</li>`).join('');
};

function getRadialChartHtml(pHome: string | number, pDraw: string | number, pAway: string | number): string {
    const r = 40;
    const circumference = 2 * Math.PI * r;
    const pHomeSafe = parseFloat(String(pHome)) || 0;
    const pDrawSafe = parseFloat(String(pDraw)) || 0;
    const pAwaySafe = parseFloat(String(pAway)) || 0;
    
    const homeSegment = (pHomeSafe / 100) * circumference;
    const drawSegment = (pDrawSafe / 100) * circumference;
    const awaySegment = (pAwaySafe / 100) * circumference;

    const homeOffset = 0;
    const drawOffset = -homeSegment;
    const awayOffset = -(homeSegment + drawSegment);
    
    return `
    <div class="radial-chart-container">
        <svg class="radial-chart" width="100%" height="100%" viewBox="0 0 100 100">
            <circle class="track" cx="50" cy="50" r="${r}" ></circle>
            <circle class="progress home" cx="50" cy="50" r="${r}"
                    stroke-dasharray="${homeSegment} ${circumference}"
                    style="stroke-dashoffset: ${homeOffset};">
            </circle>
            <circle class="progress draw" cx="50" cy="50" r="${r}"
                    stroke-dasharray="${drawSegment} ${circumference}"
                    style="stroke-dashoffset: ${drawOffset};">
            </circle>
            <circle class="progress away" cx="50" cy="50" r="${r}"
                    stroke-dasharray="${awaySegment} ${circumference}"
                    style="stroke-dashoffset: ${awayOffset};">
            </circle>
        </svg>
    </div>
    <div class="diagram-legend">
        <div class="legend-item">
            <span class="legend-color-box"></span>
            <span>Hazai (<strong class="glowing-text-white">${pHomeSafe.toFixed(1)}%</strong>)</span>
        </div>
        <div class="legend-item">
             <span class="legend-color-box"></span>
            <span>Döntetlen (<strong class="glowing-text-white">${pDrawSafe.toFixed(1)}%</strong>)</span>
        </div>
        <div class="legend-item">
             <span class="legend-color-box"></span>
             <span>Vendég (<strong class="glowing-text-white">${pAwaySafe.toFixed(1)}%</strong>)</span>
        </div>
    </div>`;
}

function getGaugeHtml(confidence: number | string, label: string = ""): string {
    const safeConf = Math.max(0, Math.min(10, parseFloat(String(confidence)) || 0));
    const percentage = safeConf * 10;
    const circumference = 235.6; 

    return `
    <div class="gauge-container">
        <svg class="gauge-svg" viewBox="0 0 100 85">
             <path class="gauge-track" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50"></path>
             <path class="gauge-value" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50"
                  style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${circumference}; --value: ${percentage}; animation: fillGauge 1s ease-out forwards 0.5s;">
             </path>
        </svg>
        <div class="gauge-text glowing-text-white">
            ${safeConf.toFixed(1)}<span class="gauge-label-inline">/10</span>
        </div>
        ${label ? `<div class="gauge-label">${escapeHTML(label)}</div>` : ''}
    </div>
    <style>
         @keyframes fillGauge { to { stroke-dashoffset: calc(${circumference} * (1 - var(--value, 0) / 100)); } }
    </style>
    `;
}


function getConfidenceInterpretationHtml(confidenceScore: number | string): string {
    let text = "";
    let className = "";
    const score = parseFloat(String(confidenceScore)) || 0;
    
    if (score >= 8.5) { text = "**Nagyon Magas Bizalom:** Az elemzés rendkívül erős egybeesést mutat a statisztikák, a kontextus és a kockázati tényezők között. A jelzett kimenetel kiemelkedően valószínű."; className = "very-high"; }
    else if (score >= 7.0) { text = "**Magas Bizalom:** Több kulcstényező (statisztika, hiányzók, forma) egyértelműen alátámasztja az ajánlást. Kisebb kérdőjelek lehetnek, de az irány egyértelműnek tűnik."; className = "high"; }
    else if (score >= 5.0) { text = "**Közepes Bizalom:** Az elemzés a jelzett kimenetel felé hajlik, de vannak ellentmondó tényezők (pl. piaci mozgás, szoros H2H, kulcs hiányzó) vagy a modell bizonytalansága magasabb."; className = "medium"; }
    else if (score >= 3.0) { text = "**Alacsony Bizalom:** Jelentős ellentmondások vannak az adatok között (pl. statisztika vs. kontextus), vagy a meccs kimenetele rendkívül bizonytalan (pl. 50-50% esélyek). Ez inkább egy spekulatív tipp."; className = "low"; }
    else { text = "**Nagyon Alacsony Bizalom:** Kritikus ellentmondások (pl. kulcsjátékosok hiánya a favorizált oldalon, erős piaci mozgás a tipp ellen) vagy teljes kiszámíthatatlanság jellemzi a meccset."; className = "very-low"; }

    return `
    <div class="confidence-interpretation-container">
        <p class="confidence-interpretation ${className}">${escapeHTML(text)}</p>
    </div>`;
}

function getMicroAnalysesHtml(microAnalyses: any): string {
    if (!microAnalyses || Object.keys(microAnalyses).length === 0) {
        return "<p>Nem futottak speciális modellek ehhez a sporthoz.</p>";
    }

    let html = '';
    const analyses: { [key: string]: string | undefined } = {
        'BTTS': microAnalyses.btts_analysis,
        'GÓL O/U': microAnalyses.goals_ou_analysis,
        // A v53 modell már nem generál szöglet/lap elemzést a 3. lépésben
        // 'SZÖGLET': microAnalyses.corner_analysis,
        // 'LAPOK': microAnalyses.card_analysis
    };
    
    Object.entries(analyses).forEach(([key, text]) => {
        if (!text) return; 
        
        const title = key.toUpperCase().replace(/_/g, ' ');
        const parts = (text || "Hiba.").split('Bizalom:');
        const analysisText = parts[0] || "Elemzés nem elérhető.";
        const confidenceText = parts[1] ? `**Bizalom: ${parts[1].trim()}**` : "**Bizalom: N/A**";

        html += `
        <div class="micromodel-card">
            <h5><strong>${escapeHTML(title)} Specialista</strong></h5>
            <p>${processAiText(analysisText)}</p>
            <p class="confidence"><em>${processAiText(confidenceText)}</em></p>
        </div>`;
    });
    
    if (html === '') {
        return "<p>Nem futottak speciális modellek ehhez a sporthoz.</p>";
    }
    return html;
}

/**
 * Fő HTML építő függvény.
 * (MÓDOSÍTVA v53.0 - Dialektikus CoT)
 */
export function buildAnalysisHtml(
    fullAnalysisReport: any, // Az egyesített CoT eredmény (Quant + Scout + Strategist)
    matchData: { home: string; away: string; sport: string; mainTotalsLine: number | string; mu_h: number | string; mu_a: number | string; propheticTimeline: null }, 
    oddsData: ICanonicalOdds | null, 
    valueBets: any[], 
    modelConfidence: number, 
    sim: any, 
    masterRecommendation: any
): string {
    
    // --- 1. ADATOK KINYERÉSE (Biztonságos hozzáférés) ---
    
    const pHome = sim?.pHome?.toFixed(1) || '0.0';
    const pDraw = sim?.pDraw?.toFixed(1) || '0.0';
    const pAway = sim?.pAway?.toFixed(1) || '0.0';
    const mu_h = sim?.mu_h_sim?.toFixed(2) || 'N/A';
    const mu_a = sim?.mu_a_sim?.toFixed(2) || 'N/A';
    const pOver = sim?.pOver?.toFixed(1) || 'N/A';
    const pUnder = sim?.pUnder?.toFixed(1) || 'N/A';
    const mainTotalsLine = sim?.mainTotalsLine || 'N/A';
    const topScore = `<strong>${sim?.topScore?.gh ?? 'N/A'} - ${sim?.topScore?.ga ?? 'N/A'}</strong>`;
    
    // A 'modelConfidence' a Quant bizalma. A 'expertConfScore' a Stratéga bizalma.
    const modelConf = modelConfidence?.toFixed(1) || '1.0';

    const expertConfHtml = fullAnalysisReport?.final_confidence_report || "**1.0/10** - Hiba.";
    let expertConfScore = 1.0;
    try {
        const match = expertConfHtml.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
        if (match && match[1]) { expertConfScore = parseFloat(match[1]); }
    } catch(e) { /* Hiba figyelmen kívül hagyása */ }

    // --- 2. FŐ AJÁNLÁS (STRATÉGA) ---
    const finalRec = masterRecommendation || { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    const finalReasoningHtml = processAiText(finalRec.brief_reasoning);
    const finalConfInterpretationHtml = getConfidenceInterpretationHtml(finalRec.final_confidence);
    
    const masterRecommendationHtml = `
    <div class="master-recommendation-card">
        <h5>👑 Vezető Stratéga Ajánlása 👑</h5>
        <div class="master-bet"><strong>${escapeHTML(finalRec.recommended_bet)}</strong></div>
        <div class="master-confidence">
            Végső Bizalom: <strong class="glowing-text-white">${(finalRec.final_confidence || 1.0).toFixed(1)}/10</strong>
        </div>
        <div class="master-reasoning">${finalReasoningHtml}</div>
        ${finalConfInterpretationHtml}
    </div>`;
    
    // --- 3. ÁTTEKINTÉS (STATISZTIKA) ---
    const atAGlanceHtml = `
    <div class="at-a-glance-grid">
        <div class="summary-card">
            <h5>Alap Valószínűségek (Sim)</h5>
            ${getRadialChartHtml(pHome, pDraw, pAway)}
        </div>
        <div class="summary-card">
            <h5>Várható Eredmény (xG)</h5>
            <div class="xg-value-container">
                <div class="xg-team">
                    <div class="value glowing-text-white">${mu_h}</div>
                    <div class="details">${escapeHTML(matchData.home)}</div>
                </div>
                <div class="xg-separator">-</div>
                <div class="xg-team">
                    <div class="value glowing-text-white">${mu_a}</div>
                    <div class="details">${escapeHTML(matchData.away)}</div>
                </div>
            </div>
            <div class="details">Legvalószínűbb eredmény: ${topScore}</div>
        </div>
        <div class="summary-card">
            <h5>Fő Összesített Vonal (${mainTotalsLine})</h5>
            <div class="totals-breakdown">
                <div class="total-line">
                    <span class="total-label">Over ${mainTotalsLine}</span>
                    <strong class="glowing-text-white">${pOver}%</strong>
                </div>
                <div class="total-line">
                    <span class="total-label">Under ${mainTotalsLine}</span>
                    <strong class="glowing-text-white">${pUnder}%</strong>
                </div>
            </div>
            ${matchData.sport === 'soccer' ? `<div class="details">BTTS Igen: <strong class="glowing-text-white">${sim?.pBTTS?.toFixed(1) ?? 'N/A'}%</strong></div>` : ''}
        </div>
        <div class="summary-card">
            <h5>Statisztikai Modell (Quant)</h5>
            ${getGaugeHtml(modelConf, "Quant Bizalom")}
        </div>
        <div class="summary-card">
            <h5>Végleges Bizalom (Stratéga)</h5>
             ${getGaugeHtml(expertConfScore, "Stratéga Bizalom")}
        </div>
    </div>`;

    // --- 4. SZAKÉRTŐI KONFLIKTUS FELOLDÁSA (STRATÉGA) ---
    const expertConfReasoning = processAiText(expertConfHtml.split(' - ')[1] || 'N/A');
    const expertConfidenceCardHtml = `
    <div class="summary-card expert-confidence-card">
        <h5><strong>A Stratéga Bizalmi Jelentése (Konfliktus-kezelés)</strong></h5>
        <div class="details">${expertConfReasoning}</div>
    </div>`;
    
    // --- 5. ÉRTÉK ELEMZÉS (VALUE BETTING) ---
    let marketCardsHtml = '';
    (valueBets || []).forEach(bet => {
        marketCardsHtml += `
        <div class="market-card">
            <div class="market-card-title"><strong>${escapeHTML(bet.market)}</strong></div>
            <div class="market-card-value"><strong>${bet.odds}</strong></div>
            <div class="details">Becsült: ${bet.probability} (<strong>${bet.value}</strong>)</div>
        </div>`;
    });
    if (!marketCardsHtml) {
        marketCardsHtml = '<p class="muted" style="text-align: center; grid-column: 1 / -1;">Jelenleg nincsenek kiemelt értékű fogadások a piacon (min. 5% value).</p>';
    }
    const marketSectionHtml = `
    <div class="market-data-section">
        <h4>Érték Elemzés (Value Betting)</h4>
         <div class="market-card-grid">${marketCardsHtml}</div>
    </div>`;
    
    // --- 6. RÉSZLETES ELEMZÉS (ACCORDION) (v53.0) ---
    
    // A "veszekedés" megjelenítése
    const accordionHtml = `
    <div class="analysis-accordion">
        
        <details class="analysis-accordion-item" open>
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                    Stratégiai Szintézis (A Fő Elemzés)
                </span>
            </summary>
            <div class="accordion-content">
                <p>${processAiText(fullAnalysisReport?.strategic_conflict_resolution)}</p>
            </div>
        </details>

        <details class="analysis-accordion-item">
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    Szakértői Jelentések (Quant vs. Scout)
                </span>
            </summary>
            <div class="accordion-content committee-reports">
                
                <div class="committee-card quant">
                    <h4>Quant 7 Jelentése (Adatvezérelt)</h4>
                    <p><strong>Összefoglaló:</strong> ${processAiText(fullAnalysisReport?.quantitative_summary)}</p>
                    <p><strong>Adatvezérelt Következtetés:</strong> ${processAiText(fullAnalysisReport?.data_driven_conclusion)}</p>
                    <strong>Kulcs Statisztikák:</strong>
                    <ul class="key-insights">
                        ${processAiList(fullAnalysisReport?.key_statistical_insights)}
                    </ul>
                </div>
                
                <div class="committee-card scout">
                    <h4>Scout 3 Jelentése (Kontextus-vezérelt)</h4>
                    <p><strong>Összefoglaló:</strong> ${processAiText(fullAnalysisReport?.tactical_summary)}</p>
                    <p><strong>Narratív Következtetés:</strong> ${processAiText(fullAnalysisReport?.narrative_conclusion)}</p>
                    <strong>Kulcs Kontextusok:</strong>
                    <ul class="key-insights">
                        ${processAiList(fullAnalysisReport?.key_contextual_insights)}
                    </ul>
                </div>
                
            </div>
        </details>

        <div class="micromodel-section">
            <h4>Piaci Mikromodellek (Stratéga)</h4>
            <div class="micromodel-grid">
                ${getMicroAnalysesHtml(fullAnalysisReport?.micromodels)}
            </div>
        </div>

    </div>`;
    
    // Visszaadjuk a teljes HTML struktúrát
    return `
        ${masterRecommendationHtml}
        ${atAGlanceHtml}
        ${expertConfidenceCardHtml}
        ${marketSectionHtml}
        ${accordionHtml}
    `;
}
