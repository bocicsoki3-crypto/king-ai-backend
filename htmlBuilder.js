/**************************************************************
* htmlBuilder.js - HTML Generátor Modul (JAVÍTOTT - TELJES)
* VÁLTOZÁSOK:
* - Új szekció a szöglet és lapok adatainak.
* - Prófétai forgatókönyvből a vizuális sáv eltávolítva.
* - AI szövegeknél a **kiemelés** `<strong>` tag-gé alakítása.
**************************************************************/

// Segédfüggvény a HTML "escape"-eléshez (biztonsági okokból)
function escapeHTML(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, function(match) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
}

// Segédfüggvény a radiális diagramhoz
function getRadialChartHtml(pHome, pDraw, pAway) {
    const r = 40;
    const circumference = 2 * Math.PI * r;
    const homeOffset = 0;
    const drawOffset = (pHome / 100) * circumference;
    const awayOffset = ((pHome + pDraw) / 100) * circumference;
    return `
    <div class="radial-chart-container" style="position: relative; width: 100%; max-width: 130px; margin: 0 auto 1rem; display: flex; align-items: center; justify-content: center; flex-grow: 1;">
        <svg class="radial-chart" width="100%" height="100%" viewBox="0 0 100 100" style="transform: rotate(-90deg);">
            <circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="10"></circle>
            <circle class="progress home" cx="50" cy="50" r="${r}" fill="none" stroke="var(--primary)" stroke-width="10" stroke-dasharray="${circumference}" style="--value: ${pHome}; --circumference: ${circumference}; stroke-dashoffset: calc(var(--circumference) * (1 - var(--value, 0) / 100) - ${homeOffset});"></circle>
    
        <circle class="progress draw" cx="50" cy="50" r="${r}" fill="none" stroke="var(--text-secondary)" stroke-width="10" stroke-dasharray="${circumference}" style="--value: ${pDraw}; --circumference: ${circumference};
stroke-dashoffset: calc(var(--circumference) * (1 - var(--value, 0) / 100) - ${drawOffset});"></circle>
            <circle class="progress away" cx="50" cy="50" r="${r}" fill="none" stroke="var(--accent)" stroke-width="10" stroke-dasharray="${circumference}" style="--value: ${pAway};
--circumference: ${circumference}; stroke-dashoffset: calc(var(--circumference) * (1 - var(--value, 0) / 100) - ${awayOffset});"></circle>
        </svg>
    </div>
    <div class="diagram-legend" style="display: flex;
flex-direction: column; align-items: flex-start; margin: 1rem auto 0; font-size: 0.8rem; gap: 0.4rem;
padding-left: 10px;">
        <div class="legend-item" style="display: flex; align-items: center; gap: 0.5rem;"><span class="legend-color-box" style="width: 12px;
height: 12px; border-radius: 3px; background-color: var(--primary);"></span><span>Hazai (${pHome}%)</span></div>
        <div class="legend-item" style="display: flex; align-items: center;
gap: 0.5rem;"><span class="legend-color-box" style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--text-secondary);"></span><span>Döntetlen (${pDraw}%)</span></div>
        <div class="legend-item" style="display: flex;
align-items: center; gap: 0.5rem;"><span class="legend-color-box" style="width: 12px; height: 12px; border-radius: 3px;
background-color: var(--accent);"></span><span>Vendég (${pAway}%)</span></div>
    </div>`;
}

// Segédfüggvény a bizalmi szint mérőhöz
function getGaugeHtml(confidence, label = "Modell Bizalom") {
    const safeConf = Math.max(0, Math.min(10, confidence || 0));
    const percentage = safeConf * 10;
    const circumference = 235.6;
    return `
    <div class="gauge-container" style="width: 100%;
max-width: 120px; margin: 0 auto; position: relative; height: 110px; display: flex; flex-direction: column; align-items: center;
justify-content: center;">
        <svg class="gauge-svg" viewBox="0 0 100 85" style="width: 100%; height: auto;
transform: rotate(-90deg); overflow: visible; position: absolute; top: 0; left: 0;">
            <path class="gauge-track" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="12"></path>
            <path class="gauge-value" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round" style="stroke-dasharray: ${circumference};
stroke-dashoffset: ${circumference}; --value: ${percentage}; animation: fillGauge 1s ease-out forwards 0.5s;"></path>
        </svg>
        <div class="gauge-text" style="position: relative;
font-size: 1.6rem; font-weight: 700; color: var(--text-primary); text-shadow: 0 0 8px var(--text-primary); z-index: 1; margin-top: 15px;
line-height: 1;">
            ${safeConf.toFixed(1)}<span class="gauge-label-inline" style="font-size: 0.6em; font-weight: 700;
color: inherit; text-shadow: inherit; margin-left: 1px; opacity: 0.9; vertical-align: middle;">/10</span>
        </div>
        <div class="gauge-label" style="position: relative;
font-size: 0.75rem; color: var(--text-secondary); z-index: 1; margin-top: 2px;">${escapeHTML(label)}</div>
    </div>
    <style> @keyframes fillGauge { to { stroke-dashoffset: calc(${circumference} * (1 - var(--value, 0) / 100)); } } </style>`;
}

// Segédfüggvény a bizalmi szint szöveges értelmezéséhez
function getConfidenceInterpretationHtml(confidenceScore) {
    let text = "";
    const score = parseFloat(confidenceScore) || 0;
    if (score >= 8.5) {
        text = "<strong>Nagyon Magas Bizalom:</strong> Az elemzés rendkívül erős egybeesést mutat a statisztikák, a kontextus és a kockázati tényezők között.";
    } else if (score >= 7.0) {
        text = "<strong>Magas Bizalom:</strong> Több kulcstényező egyértelműen alátámasztja az ajánlást. Kisebb kérdőjelek lehetnek, de az irány egyértelműnek tűnik.";
    } else if (score >= 5.0) {
        text = "<strong>Közepes Bizalom:</strong> Az elemzés a jelzett kimenetel felé hajlik, de vannak ellentmondó tényezők (pl. piaci mozgás, szoros H2H, kulcs hiányzó).";
    } else if (score >= 3.0) {
        text = "<strong>Alacsony Bizalom:</strong> Jelentős ellentmondások vannak az adatok között, vagy a meccs kimenetele rendkívül bizonytalan. Ez inkább egy spekulatív tipp.";
    } else {
        text = "<strong>Nagyon Alacsony Bizalom:</strong> Kritikus ellentmondások vagy teljes kiszámíthatatlanság jellemzi a meccset.";
    }
    
    return `<div class="confidence-interpretation-container" style="margin-top: 1.5rem;
padding-top: 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.1); max-width: 700px; margin-left: auto; margin-right: auto;"><p style="font-size: 0.9rem; line-height: 1.6;
margin: 0; color: var(--text-secondary);">${text}</p></div>`;
}

// Fő HTML építő funkció
export function buildAnalysisHtml(committeeResults, matchData, oddsData, valueBets, modelConfidence, sim, masterRecommendation) {

    // Biztonságos adatkezelés
    const pHome = sim?.pHome?.toFixed(1) || '0.0';
    const pDraw = sim?.pDraw?.toFixed(1) || '0.0';
    const pAway = sim?.pAway?.toFixed(1) || '0.0';
    const mu_h = sim?.mu_h_sim?.toFixed(2) || 'N/A';
    const mu_a = sim?.mu_a_sim?.toFixed(2) || 'N/A';
    const pOver = sim?.pOver?.toFixed(1) || 'N/A';
    const pUnder = sim?.pUnder?.toFixed(1) || 'N/A';
    const mainTotalsLine = sim?.mainTotalsLine || 'N/A';
    const topScore = `${sim?.topScore?.gh ?? 'N/A'} - ${sim?.topScore?.ga ?? 'N/A'}`;
    const modelConf = modelConfidence?.toFixed(1) || '1.0';

    // Segédfüggvény a kiemelések alkalmazásához
    const applyHighlight = (text) => {
        if (typeof text !== 'string') return text || '';
        // A **...** jeleket `<strong>...</strong>` HTML tagekké alakítjuk
        return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    };

    const expertConfHtml = committeeResults?.expertConfidence || "**1.0/10** - Hiba.";
    const expertConfScoreMatch = expertConfHtml.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
    const expertConfScore = expertConfScoreMatch ? parseFloat(expertConfScoreMatch[1]) : 1.0;

    const finalRec = masterRecommendation || { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    // --- Mester Ajánlás Kártya ---
    const masterRecommendationHtml = `
    <div class="master-recommendation-card" style="margin-bottom: 2rem; padding: 2rem; border-radius: 16px; text-align: center; background: linear-gradient(145deg, rgba(30, 30, 30, 0.8), rgba(10, 10, 10, 0.9)); border: 1px solid rgba(255, 255, 255, 0.3); box-shadow: 0 0 15px rgba(255, 255, 255, 0.2); animation: pulse-border-white 4s infinite alternate; position: relative; overflow: hidden;">
        <h5>👑 Fő Elemző Ajánlása 👑</h5>
        <div class="master-bet" style="font-size: 1.8rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--primary); text-shadow: 0 0 10px var(--primary), 0 0 20px rgba(212, 175, 55, 0.6); animation: pulse-glow-orange 3s infinite alternate;">
            ${escapeHTML(finalRec.recommended_bet)}
        </div>
        <div class="master-confidence" style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
            Végső Bizalom: <strong class="glowing-text" style="color: var(--text-primary) !important;
text-shadow: 0 0 8px currentColor, 0 0 16px rgba(255, 255, 255, 0.5);
animation: pulse-glow-white 3s infinite alternate;">${finalRec.final_confidence.toFixed(1)}/10</strong>
        </div>
        <div class="master-reasoning" style="font-size: 0.95rem;
color: var(--text-secondary); font-style: italic; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            ${applyHighlight(finalRec.brief_reasoning)}
        </div>
        ${getConfidenceInterpretationHtml(finalRec.final_confidence)}
    </div>`;

    // --- Speciális Piacok (Szöglet, Lapok) Szekció ---
    let advancedMarketsHtml = '';
    if (matchData.sport === 'soccer' && sim.corners && sim.cards) {
        const cornerLine = Object.keys(sim.corners).length > 2 ? parseFloat(Object.keys(sim.corners)[2].replace('o', '')) : 9.5;
        const pOverCorners = sim.corners[`o${cornerLine}`]?.toFixed(1);
        const cardLine = Object.keys(sim.cards).length > 1 ? parseFloat(Object.keys(sim.cards)[1].replace('o', '')) : 4.5;
        const pOverCards = sim.cards[`o${cardLine}`]?.toFixed(1);
        const pUnderCorners = pOverCorners ? (100 - parseFloat(pOverCorners)).toFixed(1) : 'N/A';
        const pUnderCards = pOverCards ? (100 - parseFloat(pOverCards)).toFixed(1) : 'N/A';

        advancedMarketsHtml = `
        <div class="summary-card"><h5>Szöglet Vonal (${cornerLine})</h5><div class="totals-breakdown" style="justify-content: center;
flex-grow: 1; padding: 1rem 0;"><div class="total-line"><span>Over ${cornerLine}</span><strong>${pOverCorners || 'N/A'}%</strong></div><div class="total-line"><span>Under ${cornerLine}</span><strong>${pUnderCorners || 'N/A'}%</strong></div></div><div class="details" style="font-size: 0.8rem; margin-top: auto;
color: var(--text-secondary);">Becsült szögletszám: <strong>${sim.mu_corners_sim?.toFixed(2) ?? 'N/A'}</strong></div></div>
        <div class="summary-card"><h5>Lapok Vonal (${cardLine})</h5><div class="totals-breakdown" style="justify-content: center;
flex-grow: 1; padding: 1rem 0;"><div class="total-line"><span>Over ${cardLine}</span><strong>${pOverCards || 'N/A'}%</strong></div><div class="total-line"><span>Under ${cardLine}</span><strong>${pUnderCards || 'N/A'}%</strong></div></div><div class="details" style="font-size: 0.8rem; margin-top: auto;
color: var(--text-secondary);">Becsült lapszám: <strong>${sim.mu_cards_sim?.toFixed(2) ?? 'N/A'}</strong></div></div>
        `;
    }
    
    // --- Áttekintő Rács (At a Glance) ---
    const atAGlanceHtml = `
    <div class="at-a-glance-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
gap: 1rem; margin-bottom: 2rem;">
        <div class="summary-card" style="min-height: 220px;"><h5>Alap Valószínűségek</h5>${getRadialChartHtml(pHome, pDraw, pAway)}</div>
        <div class="summary-card" style="min-height: 220px;"><h5>Várható Eredmény (xG/Pont)</h5><div class="xg-value-container" style="flex-grow: 1;
display:flex; align-items:center; justify-content:space-around; width:100%;"><div class="xg-team"><div class="value" style="font-size: 1.6rem; font-weight: 700;">${mu_h}</div><div class="details" style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHTML(matchData.home)}</div></div><div class="xg-separator" style="font-size: 1.5rem;
color: var(--text-secondary);">-</div><div class="xg-team"><div class="value" style="font-size: 1.6rem; font-weight: 700;">${mu_a}</div><div class="details" style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHTML(matchData.away)}</div></div></div><div class="details" style="font-size: 0.8rem; margin-top: auto;
color: var(--text-secondary);">Legvalószínűbb eredmény: <strong>${topScore}</strong></div></div>
        <div class="summary-card" style="min-height: 220px;"><h5>Fő Összesített Vonal (${mainTotalsLine})</h5><div class="totals-breakdown" style="flex-grow:1;
justify-content:center;"><div class="total-line" style="width: 90%; margin: 0 auto;"><span>Over ${mainTotalsLine}</span><strong>${pOver}%</strong></div><div class="total-line" style="width: 90%;
margin: 0 auto;"><span>Under ${mainTotalsLine}</span><strong>${pUnder}%</strong></div></div>${matchData.sport === 'soccer' ? `<div class="details" style="font-size: 0.8rem; margin-top: auto;
color: var(--text-secondary);">BTTS Igen: <strong>${sim?.pBTTS?.toFixed(1) ?? 'N/A'}%</strong></div>` : ''}</div>
        ${advancedMarketsHtml}
        <div class="summary-card" style="min-height: 220px;"><h5>Statisztikai Modell</h5>${getGaugeHtml(modelConf, "Modell Bizalom")}</div>
        <div class="summary-card" style="min-height: 220px;"><h5>Szakértői Bizalom</h5>${getGaugeHtml(expertConfScore, "Szakértői Bizalom")}</div>
    </div>`;

    // --- Piac Elemzés Szekció ---
    const marketSectionHtml = valueBets && valueBets.length > 0 ? `
    <div class="market-data-section" style="margin-bottom: 2rem;">
        <h4 style="font-size: 1.1rem;
color: var(--secondary); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;">Érték Elemzés (Value Betting)</h4>
        <div class="market-card-grid" style="display: grid;
grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem;">${valueBets.map(bet => `
        <div class="market-card"><div class="market-card-title">${escapeHTML(bet.market)}</div><div class="market-card-value">${bet.odds}</div><div class="details">Becsült: ${bet.probability} (<strong>${bet.value}</strong>)</div></div>`).join('')}
    </div></div>` : '<div class="market-data-section" style="margin-bottom: 2rem;"><p class="muted" style="text-align: center;">Jelenleg nincsenek kiemelt értékű fogadások a piacon (min. 5% value).</p></div>';

    // --- AI Bizottság Harmonika Szekció ---
    const microAnalysesHtml = committeeResults?.microAnalyses ? Object.entries(committeeResults.microAnalyses).map(([key, text]) => {
        const title = key.toUpperCase().replace('SOCCER', '').replace('GOALSOU', 'GÓL O/U').replace(/_/g, ' ');
        const parts = (text || "Hiba.").split('Bizalom:');
       
 const analysisText = parts[0] || "Elemzés nem elérhető.";
        const confidenceText = parts[1] ? `Bizalom: ${parts[1]}` : "Bizalom: N/A";
return `<div class="micromodel-card"><h5>${escapeHTML(title)} Specialista</h5><p>${applyHighlight(analysisText)}</p><p style="font-size: 0.9rem; opacity: 0.8;"><em>${confidenceText}</em></p></div>`;
    }).join('') : "<p>Nem futottak speciális modellek ehhez a sporthoz.</p>";
const accordionHtml = `
    <div class="analysis-accordion" style="margin-top: 2rem;">
        <details class="analysis-accordion-item" open><summary class="analysis-accordion-header"><span class="section-title">Általános Elemzés</span></summary><div class="accordion-content"><p>${applyHighlight(committeeResults.generalAnalysis).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div></details>
        <details class="analysis-accordion-item"><summary class="analysis-accordion-header"><span class="section-title">Prófétai Forgatókönyv</span></summary><div class="accordion-content"><p>${applyHighlight(committeeResults.propheticScenario)}</p></div></details>
        <details class="analysis-accordion-item"><summary class="analysis-accordion-header"><span class="section-title">Taktikai Elemzés</span></summary><div class="accordion-content"><p>${applyHighlight(committeeResults.tacticalBriefing)}</p></div></details>
        <details class="analysis-accordion-item"><summary class="analysis-accordion-header"><span class="section-title">Mikromodell Specialisták</span></summary><div class="accordion-content">${microAnalysesHtml}</div></details>
        <details class="analysis-accordion-item"><summary class="analysis-accordion-header"><span class="section-title">Kockázat & További Kontextus</span></summary><div class="accordion-content"><h4>Kockázatkezelői Jelentés</h4><p>${applyHighlight(committeeResults.riskAssessment)}</p><br><h4>Ellentmondás Elemzés</h4><p>${applyHighlight(committeeResults.contradictionAnalysis)}</p><br><h4>Stratégiai Kulcskérdések</h4><p>${applyHighlight(committeeResults.keyQuestions).replace(/- /g, '<br>- ').substring(5)}</p><br><h4>Játékospiaci Meglátások</h4><p>${applyHighlight(committeeResults.playerMarkets)}</p></div></details>
    </div>`;
// --- Végső HTML összeállítása ---
    return `
        ${masterRecommendationHtml}
        ${atAGlanceHtml}
        ${marketSectionHtml}
        ${accordionHtml}
    `;
}

// EZ A VÉGE A TELJES KÓDNAK