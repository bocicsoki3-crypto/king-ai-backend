// htmlBuilder.js (v1.1 - Vizuális javításokkal)

/**************************************************************
* htmlBuilder.js - HTML Generátor Modul (Node.js Verzió)
* VÁLTOZÁS (v1.1): UI Javítások:
* - Fejléc boxokban a számok fehér fénylést kapnak (glowing-text-white).
* - Százalékok a radiális diagram legendájában is fehéren fénylenek.
**************************************************************/

// Robusztus escapeHTML függvény
function escapeHTML(str) {
    if (str == null) return '';
    let tempStr = String(str);
    const placeholders = [];
    // 1. **kiemelések** cseréje placeholderre
    tempStr = tempStr.replace(/\*\*(.*?)\*\*/g, (match, content) => {
        placeholders.push(content);
        return `__STRONG_PLACEHOLDER_${placeholders.length - 1}__`;
    });
    // 2. HTML karakterek escape-elése
    tempStr = tempStr.replace(/[&<>"']/g, (match) => {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
    // 3. Placeholderek visszahelyezése <strong> tag-ekkel
    placeholders.forEach((originalContent, index) => {
        // Itt escape-eljük a placeholder tartalmát, mielőtt a strong tagbe kerül
        const escapedContent = String(originalContent).replace(/[&<>"']/g, (match) => {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
        });
        tempStr = tempStr.replace(`__STRONG_PLACEHOLDER_${index}__`, `<strong>${escapedContent}</strong>`);
    });
    return tempStr;
}


function getRadialChartHtml(pHome, pDraw, pAway) {
    const r = 40;
    const circumference = 2 * Math.PI * r;
    const pHomeSafe = parseFloat(pHome) || 0;
    const pDrawSafe = parseFloat(pDraw) || 0;
    const pAwaySafe = parseFloat(pAway) || 0;
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
            <span>Hazai (<strong class="glowing-text-white">${pHome}%</strong>)</span>
        </div>
        <div class="legend-item">
             <span class="legend-color-box"></span>
            <span>Döntetlen (<strong class="glowing-text-white">${pDraw}%</strong>)</span>
        </div>
        <div class="legend-item">
             <span class="legend-color-box"></span>
            <span>Vendég (<strong class="glowing-text-white">${pAway}%</strong>)</span>
        </div>
    </div>`;
}

function getGaugeHtml(confidence, label = "") {
    const safeConf = Math.max(0, Math.min(10, confidence || 0));
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


function getConfidenceInterpretationHtml(confidenceScore) {
    let text = "";
    let className = "";
    const score = parseFloat(confidenceScore) || 0;
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

function getMicroAnalysesHtml(microAnalyses) {
    if (!microAnalyses || Object.keys(microAnalyses).length === 0) {
        return "<p>Nem futottak speciális modellek ehhez a sporthoz.</p>";
    }

    let html = '';
    Object.entries(microAnalyses).forEach(([key, text]) => {
        const title = key.toUpperCase().replace(/_/g, ' ');
        // Szétválasztás a "Bizalom:" alapján
        const parts = (text || "Hiba.").split('Bizalom:');
        const analysisText = parts[0] || "Elemzés nem elérhető.";
        // Ha van bizalmi rész, azt is kiemeljük
        const confidenceText = parts[1] ? `**Bizalom: ${parts[1].trim()}**` : "**Bizalom: N/A**";

        html += `
        <div class="micromodel-card">
            <h5><strong>${escapeHTML(title)} Specialista</strong></h5>
            <p>${processAiText(analysisText)}</p>
            <p class="confidence"><em>${processAiText(confidenceText)}</em></p>
        </div>`;
    });
    return html;
}

// Segédfüggvény AI szövegek feldolgozásához (escape + newline -> <br>)
const processAiText = (text) => {
    if (!text || text.includes("Hiba")) return `<p>${escapeHTML(text || "Hiba.")}</p>`;
    // **kiemelés** (strong tag) kezelése az escapeHTML-ben
    const escapedHtml = escapeHTML(text);
    // Sortörések cseréje <br>-re
    return escapedHtml.replace(/\n/g, '<br>');
};

export function buildAnalysisHtml(committeeResults, matchData, oddsData, valueBets, modelConfidence, sim, masterRecommendation) {
    const pHome = sim?.pHome?.toFixed(1) || '0.0';
    const pDraw = sim?.pDraw?.toFixed(1) || '0.0';
    const pAway = sim?.pAway?.toFixed(1) || '0.0';
    const mu_h = sim?.mu_h_sim?.toFixed(2) || 'N/A';
    const mu_a = sim?.mu_a_sim?.toFixed(2) || 'N/A';
    const pOver = sim?.pOver?.toFixed(1) || 'N/A';
    const pUnder = sim?.pUnder?.toFixed(1) || 'N/A';
    const mainTotalsLine = sim?.mainTotalsLine || 'N/A';
    // JAVÍTÁS: A topScore már alapból strong taget tartalmaz
    const topScore = `<strong>${sim?.topScore?.gh ?? 'N/A'} - ${sim?.topScore?.ga ?? 'N/A'}</strong>`;
    const modelConf = modelConfidence?.toFixed(1) || '1.0';

    // Szakértői bizalom kinyerése
    const expertConfHtml = committeeResults?.expertConfidence || "**1.0/10** - Hiba.";
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
            Végső Bizalom: <strong class="glowing-text-white">${finalRec.final_confidence.toFixed(1)}/10</strong>
        </div>
        <div class="master-reasoning">${finalReasoningHtml}</div>
        ${finalConfInterpretationHtml}
    </div>`;

    // Fejléc boxok
    // JAVÍTÁS: glowing-text-white class hozzáadva a számokhoz
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
            ${getGaugeHtml(modelConf, "STATISZTIKAI MODELL")}
        </div>
        <div class="summary-card">
            <h5>Szakértői Bizalom</h5>
             ${getGaugeHtml(expertConfScore, "SZAKÉRTŐI BIZALOM")}
        </div>
    </div>`;

    const expertConfReasoning = processAiText(expertConfHtml.split(' - ')[1] || 'N/A');
    const expertConfidenceCardHtml = `
    <div class="summary-card expert-confidence-card">
        <h5><strong>Szakértői Magabiztosság & Kontextus</strong></h5>
        <div class="details">${expertConfReasoning}</div>
    </div>`;

    // Value Bets (itt a strong már narancs lesz a CSS miatt)
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

    // Kulcskérdések (strong narancs lesz)
    let keyQuestionsHtml = '<p>- Hiba.</p>';
    if (committeeResults?.keyQuestions && !committeeResults.keyQuestions.includes("Hiba")) {
        const questions = committeeResults.keyQuestions.split('- ').filter(q => q.trim() !== '');
        keyQuestionsHtml = '<ul class="key-questions">';
        questions.forEach(q => {
            keyQuestionsHtml += `<li>${processAiText(q.trim())}</li>`; // processAiText kezeli a strong tagot
        });
        keyQuestionsHtml += '</ul>';
    }

    // Accordion (a processAiText kezeli a strong tagokat a bekezdésekben)
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
             <p>${processAiText(committeeResults?.generalAnalysis)}</p>
            </div>
        </details>

        <details class="analysis-accordion-item">
            <summary class="analysis-accordion-header">
                <span class="section-title">
                   <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v10a4 4 0 0 0 4 4h7"></path><path d="M19 17V7a4 4 0 0 0-4-4H5"></path></svg>
                    Prófétai Forgatókönyv
                </span>
             </summary>
            <div class="accordion-content">
                <p>${processAiText(committeeResults?.propheticScenario)}</p>
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
                <p>${processAiText(committeeResults?.tacticalBriefing)}</p>
            </div>
        </details>

        <div class="micromodel-section">
            <h4>Piaci Mikromodellek</h4>
             <div class="micromodel-grid">
                ${getMicroAnalysesHtml(committeeResults?.microAnalyses)}
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
                <p>${processAiText(committeeResults?.riskAssessment)}</p>
                <br>
                <h4>Játékospiaci Meglátások</h4>
                <p>${processAiText(committeeResults?.playerMarkets)}</p>
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