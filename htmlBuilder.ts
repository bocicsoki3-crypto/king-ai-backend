// htmlBuilder.ts (v52.2 - 'import type' javítás)
// MÓDOSÍTÁS: A modul átalakítva TypeScript-re.
// A 'buildAnalysisHtml' függvény most már a CoT (Chain-of-Thought)
// által generált 'fullAnalysisReport' objektum típusosított
// (bár 'any' szinten) kezelésére van felkészítve.

// === JAVÍTÁS (TS2846) ===
// A 'import' helyett 'import type'-ot használunk, mivel a .d.ts fájlok
// nem tartalmaznak futásidejű kódot, csak típus-deklarációkat.
import type { ICanonicalOdds } from './src/types/canonical.d.ts';
// === JAVÍTÁS VÉGE ===

/**************************************************************
* htmlBuilder.ts - HTML Generátor Modul (Node.js Verzió)
* VÁLTOZÁS (v52.2 - TS):
* - Javítva a TS2846 hiba: Az 'import' ki lett cserélve 'import type'-ra
* a canonical.d.ts típusdefiníciós fájl importálásakor.
**************************************************************/

/**
 * JAVÍTÁS: Robusztus és hatékony escapeHTML függvény
 * @param str A bemeneti string (vagy null/undefined)
 * @returns {string} A biztonságos, HTML-escape-elt string.
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
    // Kicseréljük az összes HTML-re veszélyes karaktert a biztonságos megfelelőjére.
    tempStr = tempStr.replace(/[&<>"']/g, (match) => escapeMap[match]);
    
    // 2. lépés: A **kiemelés** cseréje <strong> tag-re.
    // Mivel a '*' karakter nem lett escape-elve, ez biztonságosan futtatható
    // az escape-elt stringen.
    tempStr = tempStr.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    return tempStr;
}

/**
 * Segédfüggvény AI szövegek feldgozásához (escape + newline -> <br>)
 * @param text A bemeneti AI szöveg
 * @returns {string} A formázott HTML string
 */
const processAiText = (text: string | null | undefined): string => {
    if (!text || text.includes("Hiba") || text.trim() === 'N/A') {
        return `<p>${escapeHTML(text || "Hiba.")}</p>`;
    }
    // A **kiemelés** (strong tag) kezelése az escapeHTML-ben
    const escapedHtml = escapeHTML(text);
    // Sortörések cseréje <br>-re
    return escapedHtml.replace(/\n/g, '<br>');
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
    
    // JAVÍTÁS: Százalékok strong tagjei megkapják a glowing-text-white classt
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
    const circumference = 235.6; // ~90% of circle for 180 degree arc

    // JAVÍTÁS: A gauge-text már alapból megkapja a glowing-text-white classt
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
    // Kulcsnevek ellenőrzése (pl. btts_analysis)
    const analyses: { [key: string]: string | undefined } = {
        'BTTS': microAnalyses.btts_analysis,
        'GÓL O/U': microAnalyses.goals_ou_analysis,
        'SZÖGLET': microAnalyses.corner_analysis,
        'LAPOK': microAnalyses.card_analysis
    };
    
    Object.entries(analyses).forEach(([key, text]) => {
        if (!text) return; // Kihagyja, ha az adott elemzés hiányzik
        
        const title = key.toUpperCase().replace(/_/g, ' ');
        // Szétválasztás a "Bizalom:" alapján
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
 * @param fullAnalysisReport A CoT (Chain-of-Thought) 3 lépésének egyesített eredménye.
 * @param matchData Alapvető meccs adatok.
 * @param oddsData Kanonikus odds adatok.
 * @param valueBets Számított érték fogadások.
 * @param modelConfidence A modell statisztikai bizalma.
 * @param sim A szimuláció eredménye.
 * @param masterRecommendation A végső ajánlás (már része a fullAnalysisReport-nak).
 */
export function buildAnalysisHtml(
    fullAnalysisReport: any, // Az egyesített CoT eredmény (Step1 + Step2 + Step3)
    matchData: { home: string; away: string; sport: string; mainTotalsLine: number | string; mu_h: number | string; mu_a: number | string; propheticTimeline: null }, 
    oddsData: ICanonicalOdds | null, 
    valueBets: any[], 
    modelConfidence: number, 
    sim: any, 
    masterRecommendation: any
): string {
    
    // --- ADATOK KINYERÉSE (Biztonságos hozzáférés) ---
    
    const pHome = sim?.pHome?.toFixed(1) || '0.0';
    const pDraw = sim?.pDraw?.toFixed(1) || '0.0';
    const pAway = sim?.pAway?.toFixed(1) || '0.0';
    const mu_h = sim?.mu_h_sim?.toFixed(2) || 'N/A';
    const mu_a = sim?.mu_a_sim?.toFixed(2) || 'N/A';
    const pOver = sim?.pOver?.toFixed(1) || 'N/A';
    const pUnder = sim?.pUnder?.toFixed(1) || 'N/A';
    const mainTotalsLine = sim?.mainTotalsLine || 'N/A';
    const topScore = `<strong>${sim?.topScore?.gh ?? 'N/A'} - ${sim?.topScore?.ga ?? 'N/A'}</strong>`;
    const modelConf = modelConfidence?.toFixed(1) || '1.0';

    // Szakértői bizalom kinyerése
    const expertConfHtml = fullAnalysisReport?.expert_confidence_report || "**1.0/10** - Hiba.";
    let expertConfScore = 1.0;
    try {
        const match = expertConfHtml.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
        if (match && match[1]) { expertConfScore = parseFloat(match[1]); }
    } catch(e) { /* Hiba figyelmen kívül hagyása */ }

    // Fő ajánlás
    const finalRec = masterRecommendation || { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    const finalReasoningHtml = processAiText(finalRec.brief_reasoning);
    const finalConfInterpretationHtml = getConfidenceInterpretationHtml(finalRec.final_confidence);
    
    const masterRecommendationHtml = `
    <div class="master-recommendation-card">
        <h5>👑 Fő Elemző Ajánlása 👑</h5>
        <div class="master-bet"><strong>${escapeHTML(finalRec.recommended_bet)}</strong></div>
        <div class="master-confidence">
            Végső Bizalom: <strong class="glowing-text-white">${(finalRec.final_confidence || 1.0).toFixed(1)}/10</strong>
        </div>
        <div class="master-reasoning">${finalReasoningHtml}</div>
        ${finalConfInterpretationHtml}
    </div>`;
    
    // Fejléc boxok
    const atAGlanceHtml = `
    <div class="at-a-glance-grid">
        <div class="summary-card">
            <h5>Alap Valószínűségek</h5>
            ${getRadialChartHtml(pHome, pDraw, pAway)}
        </div>
        <div class="summary-card">
            <h5>Várható Eredmény (xG/Pont)</h5>
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
            <h5>Statisztikai Modell</h5>
            ${getGaugeHtml(modelConf)}
        </div>
        <div class="summary-card">
            <h5>Szakértői Bizalom</h5>
             ${getGaugeHtml(expertConfScore)}
        </div>
    </div>`;

    const expertConfReasoning = processAiText(expertConfHtml.split(' - ')[1] || 'N/A');
    const expertConfidenceCardHtml = `
    <div class="summary-card expert-confidence-card">
        <h5><strong>Szakértői Magabiztosság & Kontextus</strong></h5>
        <div class="details">${expertConfReasoning}</div>
    </div>`;
    
    // Value Bets
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
    
    // Kulcskérdések
    let keyQuestionsHtml = '<p>- Hiba.</p>';
    if (fullAnalysisReport?.key_questions && !fullAnalysisReport.key_questions.includes("Hiba")) {
        const questions = fullAnalysisReport.key_questions.split('- ').filter((q: string) => q.trim() !== '');
        keyQuestionsHtml = '<ul class="key-questions">';
        questions.forEach((q: string) => {
            keyQuestionsHtml += `<li>${processAiText(q.trim())}</li>`;
        });
        keyQuestionsHtml += '</ul>';
    }

    // Accordion
    const accordionHtml = `
    <div class="analysis-accordion">
        <details class="analysis-accordion-item" open>
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                    Általános Elemzés
                </span>
            </summary>
            <div class="accordion-content">
                <p>${processAiText(fullAnalysisReport?.general_analysis)}</p>
            </div>
        </details>

        <details class="analysis-accordion-item">
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M9 3v18"></path><path d="M15 3v18"></path></svg>
                    Taktikai Elemzés
                </span>
            </summary>
            <div class="accordion-content">
                <p>${processAiText(fullAnalysisReport?.tactical_briefing)}</p>
            </div>
        </details>

        <div class="micromodel-section">
            <h4>Piaci Mikromodellek</h4>
            <div class="micromodel-grid">
                ${getMicroAnalysesHtml(fullAnalysisReport?.micromodels)}
            </div>
        </div>

        <details class="analysis-accordion-item">
             <summary class="analysis-accordion-header">
                 <span class="section-title">
                     <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" x2="12" y1="9" y2="13"></line><line x1="12" x2="12.01" y1="17" y2="17"></line></svg>
                     Kockázat & További Kontextus
               </span>
            </summary>
            <div class="accordion-content">
                <h4>Stratégiai Kulcskérdések</h4>
                ${keyQuestionsHtml}
                <br>
                <h4>Kockázatkezelői Jelentés</h4>
                <p>${processAiText(fullAnalysisReport?.risk_analysis)}</p>
                <br>
                <h4>Játékospiaci Meglátások</h4>
                <p>${processAiText(fullAnalysisReport?.player_markets)}</p>
                <br>
                <h4>Feltárt Tények (Step 1)</h4>
                <p><strong>Hazai Tények:</strong> ${processAiText(fullAnalysisReport?.key_facts_home)}</p>
                <p><strong>Vendég Tények:</strong> ${processAiText(fullAnalysisReport?.key_facts_away)}</p>
                <p><strong>Piaci Mozgás:</strong> ${processAiText(fullAnalysisReport?.market_sentiment)}</p>
                <p><strong>H2H Összegzés:</strong> ${processAiText(fullAnalysisReport?.h2h_summary)}</p>
                <p><strong>Egyéb Tényezők:</strong> ${processAiText(fullAnalysisReport?.contextual_notes)}</p>
            </div>
        </details>
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