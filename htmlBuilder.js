/**************************************************************
* htmlBuilder.js - HTML Generátor Modul (Node.js Verzió)
* Feladata: Az elemzési adatokból a frontend számára
* fogyasztható HTML kód generálása.
**************************************************************/

// Segédfüggvény a HTML "escape"-eléshez (opcionális, de biztonságosabb)
function escapeHTML(str) {
    if (str == null) return ''; // null vagy undefined kezelése
    return String(str).replace(/[&<>"']/g, function(match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
           "'": '&#39;'
        }[match];
    });
}

// === JAVÍTÁS (1. KÉP): A radiális diagram logikájának javítása a helyes szegmensek megjelenítéséhez ===
function getRadialChartHtml(pHome, pDraw, pAway) {
    const r = 40;
    const circumference = 2 * Math.PI * r;
    const pHomeSafe = pHome || 0;
    const pDrawSafe = pDraw || 0;
    const pAwaySafe = pAway || 0;

    const homeSegment = (pHomeSafe / 100) * circumference;
    const drawSegment = (pDrawSafe / 100) * circumference;
    const awaySegment = (pAwaySafe / 100) * circumference;

    const homeOffset = 0;
    const drawOffset = -homeSegment;
    const awayOffset = -(homeSegment + drawSegment);

    return `
    <div class="radial-chart-container" style="position: relative; width: 100%; max-width: 130px; margin: 0 auto 1rem; display: flex; align-items: center; justify-content: center; flex-grow: 1;">
        <svg class="radial-chart" width="100%" height="100%" viewBox="0 0 100 100" style="transform: rotate(-90deg);">
            <circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="10"></circle>
            <circle class="progress home" cx="50" cy="50" r="${r}" fill="none" stroke="var(--primary)" stroke-width="10"
                    stroke-dasharray="${homeSegment} ${circumference}"
                    style="stroke-dashoffset: ${homeOffset};">
            </circle>
            <circle class="progress draw" cx="50" cy="50" r="${r}" fill="none" stroke="var(--text-secondary)" stroke-width="10"
                    stroke-dasharray="${drawSegment} ${circumference}"
                    style="stroke-dashoffset: ${drawOffset};">
            </circle>
            <circle class="progress away" cx="50" cy="50" r="${r}" fill="none" stroke="var(--accent)" stroke-width="10"
                    stroke-dasharray="${awaySegment} ${circumference}"
                    style="stroke-dashoffset: ${awayOffset};">
            </circle>
        </svg>
    </div>
    <div class="diagram-legend" style="display: flex; flex-direction: column; align-items: flex-start; margin: 1rem auto 0; font-size: 0.8rem; gap: 0.4rem; padding-left: 10px;">
        <div class="legend-item" style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="legend-color-box" style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--primary);"></span>
            <span>Hazai (${pHome}%)</span>
        </div>
        <div class="legend-item" style="display: flex; align-items: center; gap: 0.5rem;">
             <span class="legend-color-box" style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--text-secondary);"></span>
            <span>Döntetlen (${pDraw}%)</span>
        </div>
        <div class="legend-item" style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="legend-color-box" style="width: 12px; height: 12px; border-radius: 3px; background-color: var(--accent);"></span>
            <span>Vendég (${pAway}%)</span>
        </div>
    </div>`;
}


// Segédfüggvény a bizalmi szint mérőhöz (változatlan)
function getGaugeHtml(confidence, label = "Modell Bizalom") {
    const safeConf = Math.max(0, Math.min(10, confidence || 0)); // Biztosítjuk, hogy 0-10 között legyen
    const percentage = safeConf * 10; // 0-100%
    const circumference = 235.6; // (360 * 0.65) * (PI / 180) * 100 ??? -> Ez egy fix érték a CSS-ből (r=37.5 * 2 * PI * 0.65)
    const strokeDashOffset = circumference * (1 - (percentage / 100));
    // A CSS animációhoz a --value-t használjuk (0-100)
    return `
    <div class="gauge-container" style="width: 100%; max-width: 120px; margin: 0 auto; position: relative; height: 110px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <svg class="gauge-svg" viewBox="0 0 100 85" style="width: 100%; height: auto; transform: rotate(-90deg); overflow: visible; position: absolute; top: 0; left: 0;">
             <path class="gauge-track" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="12"></path>
            <path class="gauge-value" d="M 12.5 50 A 37.5 37.5 0 1 1 87.5 50" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round"
                  style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${circumference}; --value: ${percentage}; animation: fillGauge 1s ease-out forwards 0.5s;">
            </path>
        </svg>
        <div class="gauge-text" style="position: relative; font-size: 1.6rem; font-weight: 700; color: var(--text-primary); text-shadow: 0 0 8px var(--text-primary); z-index: 1; margin-top: 15px; line-height: 1;">
            ${safeConf.toFixed(1)}<span class="gauge-label-inline" style="font-size: 0.6em; font-weight: 700; color: inherit; text-shadow: inherit; margin-left: 1px; opacity: 0.9; vertical-align: middle;">/10</span>
     </div>
        <div class="gauge-label" style="position: relative; font-size: 0.75rem; color: var(--text-secondary); z-index: 1; margin-top: 2px;">${escapeHTML(label)}</div>
    </div>
    <style>
        @keyframes fillGauge { to { stroke-dashoffset: calc(${circumference} * (1 - var(--value, 0) / 100)); } }
    </style>
    `;
}

// Segédfüggvény az idővonalhoz (változatlan)
function getTimelineHtml(timeline) {
    if (!timeline || timeline.length === 0) {
      return '<p class="muted" style="text-align: center;">A prófétai idővonal nem generált eseményeket.</p>';
    }
    let eventsHtml = '';
    timeline.forEach(event => {
        const position = (event.time / 90) * 100; // Feltételezzük a 90 percet
        let teamClass = 'event';
        if (event.team === 'home') teamClass = 'home';
        if (event.team === 'away') teamClass = 'away';
        const detail = escapeHTML(event.detail || event.type);
        eventsHtml += `<div class="timeline-event ${teamClass}" style="left: ${position}%;" data-tooltip="${event.time}' - ${detail}"></div>`;
    });

    return `
    <div class="timeline-visualization-container" style="padding: 1rem 0; margin-bottom: 1rem;">
        <div class="prophetic-timeline-bar" style="width: 100%; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; position: relative; border: 1px solid var(--border-color); margin: 0;">
           ${eventsHtml}
        </div>
    </div>`;
}

// Segédfüggvény a bizalmi szint szöveges értelmezéséhez (változatlan)
function getConfidenceInterpretationHtml(confidenceScore) {
    let text = "";
    let className = "";
    const score = parseFloat(confidenceScore) || 0;

    if (score >= 8.5) {
        text = "<strong>Nagyon Magas Bizalom:</strong> Az elemzés rendkívül erős egybeesést mutat a statisztikák, a kontextus és a kockázati tényezők között. A jelzett kimenetel kiemelkedően valószínű.";
        className = "very-high";
    } else if (score >= 7.0) {
        text = "<strong>Magas Bizalom:</strong> Több kulcstényező (statisztika, hiányzók, forma) egyértelműen alátámasztja az ajánlást. Kisebb kérdőjelek lehetnek, de az irány egyértelműnek tűnik.";
        className = "high";
    } else if (score >= 5.0) {
    text = "<strong>Közepes Bizalom:</strong> Az elemzés a jelzett kimenetel felé hajlik, de vannak ellentmondó tényezők (pl. piaci mozgás, szoros H2H, kulcs hiányzó) vagy a modell bizonytalansága magasabb.";
        className = "medium";
    } else if (score >= 3.0) {
        text = "<strong>Alacsony Bizalom:</strong> Jelentős ellentmondások vannak az adatok között (pl. statisztika vs. kontextus), vagy a meccs kimenetele rendkívül bizonytalan (pl. 50-50% esélyek). Ez inkább egy spekulatív tipp.";
        className = "low";
    } else {
        text = "<strong>Nagyon Alacsony Bizalom:</strong> Kritikus ellentmondások (pl. kulcsjátékosok hiánya a favorizált oldalon, erős piaci mozgás a tipp ellen) vagy teljes kiszámíthatatlanság jellemzi a meccset.";
        className = "very-low";
    }

    return `
    <div class="confidence-interpretation-container" style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.1); max-width: 700px; margin-left: auto; margin-right: auto;">
        <p class="confidence-interpretation ${className}" style="font-size: 0.9rem; line-height: 1.6; margin: 0; color: var(--text-secondary);">
            ${text}
        </p>
    </div>`;
}

/**
 * A fő HTML építő funkció. Összeállítja a teljes HTML stringet.
 * @param {object} committeeResults Az AI bizottság eredményei.
 * @param {object} matchData Alap meccs adatok.
 * @param {object} oddsData Odds adatok.
 * @param {Array<object>} valueBets Talált érték fogadások.
 * @param {number} modelConfidence A statisztikai modell bizalma.
 * @param {object} sim A szimuláció eredményei.
 * @param {object} masterRecommendation A végső AI ajánlás.
 * @returns {string} A generált HTML string.
 */
export function buildAnalysisHtml(committeeResults, matchData, oddsData, valueBets, modelConfidence, sim, masterRecommendation) {

    // Biztonságos adatkezelés (null/undefined ellenőrzések)
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

    const expertConfHtml = committeeResults?.expertConfidence || "**1.0/10** - Hiba.";
    let expertConfScore = 1.0;
    try {
        const match = expertConfHtml.match(/\*\*(\d+(\.\d+)?)\/10\*\*/);
        if (match && match[1]) {
      expertConfScore = parseFloat(match[1]);
        }
    } catch(e) { console.warn("Nem sikerült kinyerni az expert confidence pontszámot."); }

    const finalRec = masterRecommendation || { recommended_bet: "Hiba", final_confidence: 1.0, brief_reasoning: "Hiba" };
    const finalConfInterpretationHtml = getConfidenceInterpretationHtml(finalRec.final_confidence);

    // --- Mester Ajánlás Kártya ---
    const masterRecommendationHtml = `
    <div class="master-recommendation-card" style="margin-top: 2rem; padding: 2rem; border-radius: 16px; text-align: center; background: linear-gradient(145deg, rgba(30, 30, 30, 0.8), rgba(10, 10, 10, 0.9)), radial-gradient(circle at top left, rgba(212, 175, 55, 0.15), transparent 50%), radial-gradient(circle at bottom right, rgba(0, 191, 255, 0.1), transparent 50%); border: 1px solid rgba(255, 255, 255, 0.3); box-shadow: 0 0 15px rgba(255, 255, 255, 0.2), inset 0 0 10px rgba(255, 255, 255, 0.1); animation: pulse-border-white 4s infinite alternate; position: relative; overflow: hidden;">
        <h5>👑 Fő Elemző Ajánlása 👑</h5>
        <div class="master-bet" style="font-size: 1.8rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--primary); text-shadow: 0 0 10px var(--primary), 0 0 20px rgba(212, 175, 55, 0.6); animation: pulse-glow-orange 3s infinite alternate;">
            ${escapeHTML(finalRec.recommended_bet)}
        </div>
        <div class="master-confidence" style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
            Végső Bizalom: <strong class="glowing-text-white" style="color: var(--text-primary) !important; text-shadow: 0 0 8px currentColor, 0 0 16px rgba(255, 255, 255, 0.5); animation: pulse-glow-white 3s infinite alternate;">${finalRec.final_confidence.toFixed(1)}/10</strong>
  </div>
        <div class="master-reasoning" style="font-size: 0.95rem; color: var(--text-secondary); font-style: italic; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            ${escapeHTML(finalRec.brief_reasoning).replace(/\n/g, '<br>')}
        </div>
        ${finalConfInterpretationHtml}
    </div>`;


    // --- Áttekintő Rács (At a Glance) ---
    // === JAVÍTÁS (1. KÉP): .glowing-text-white osztály hozzáadva a számokhoz ===
    const atAGlanceHtml = `
    <div class="at-a-glance-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div class="summary-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px;">
            <h5>Alap Valószínűségek</h5>
            ${getRadialChartHtml(pHome, pDraw, pAway)}
        </div>
        <div class="summary-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px;">
            <h5>Várható Eredmény (xG/Pont)</h5>
            <div class="xg-value-container" style="display: flex; align-items: center; justify-content: space-around; width: 100%; flex-grow: 1; gap: 1rem; padding: 1rem 0;">
                <div class="xg-team" style="display: flex; flex-direction: column; align-items: center;">
                    <div class="value glowing-text-white" style="font-size: 1.6rem; font-weight: 700; margin-bottom: 0.5rem; line-height: 1.3;">${mu_h}</div>
                    <div class="details" style="font-size: 0.8rem; margin-top: auto; color: var(--text-secondary);">${escapeHTML(matchData.home)}</div>
                </div>
                 <div class="xg-separator" style="font-size: 1.5rem; color: var(--text-secondary); font-weight: 700;">-</div>
                <div class="xg-team" style="display: flex; flex-direction: column; align-items: center;">
                    <div class="value glowing-text-white" style="font-size: 1.6rem; font-weight: 700; margin-bottom: 0.5rem; line-height: 1.3;">${mu_a}</div>
                <div class="details" style="font-size: 0.8rem; margin-top: auto; color: var(--text-secondary);">${escapeHTML(matchData.away)}</div>
                </div>
            </div>
            <div class="details" style="font-size: 0.8rem; margin-top: auto; color: var(--text-secondary);">Legvalószínűbb eredmény: <strong>${topScore}</strong></div>
        </div>
        <div class="summary-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px;">
            <h5>Fő Összesített Vonal (${mainTotalsLine})</h5>
            <div class="totals-breakdown" style="display: flex; flex-direction: column; justify-content: center; align-items: stretch; height: 100%; gap: 0.75rem; font-size: 1.2rem; flex-grow: 1; padding: 1rem 0;">
                <div class="total-line" style="display: flex; justify-content: space-between; align-items: center; width: 95%; margin: 0 auto; font-size: 1.1rem;">
                    <span class="total-label" style="color: var(--text-secondary); margin-right: 10px;">Over ${mainTotalsLine}</span>
                    <strong class="glowing-text-white">${pOver}%</strong>
                </div>
           <div class="total-line" style="display: flex; justify-content: space-between; align-items: center; width: 95%; margin: 0 auto; font-size: 1.1rem;">
                    <span class="total-label" style="color: var(--text-secondary); margin-right: 10px;">Under ${mainTotalsLine}</span>
                    <strong class="glowing-text-white">${pUnder}%</strong>
                </div>
            </div>
            ${matchData.sport === 'soccer' ? `<div class="details" style="font-size: 0.8rem; margin-top: auto; color: var(--text-secondary);">BTTS Igen: <strong class="glowing-text-white">${sim?.pBTTS?.toFixed(1) ?? 'N/A'}%</strong></div>` : ''}
        </div>
        <div class="summary-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px;">
             <h5>Statisztikai Modell</h5>
            ${getGaugeHtml(modelConf, "Modell Bizalom")}
        </div>
        <div class="summary-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px;">
            <h5>Szakértői Bizalom</h5>
             ${getGaugeHtml(expertConfScore, "Szakértői Bizalom")}
        </div>
    </div>`;

    // --- Kontextus Kártya ---
    const expertConfidenceCardHtml = `
    <div class="summary-card expert-confidence-card" style="grid-column: 1 / -1; margin-bottom: 1rem; border: 1px solid var(--primary); background: linear-gradient(145deg, rgba(212, 175, 55, 0.05), rgba(212, 175, 55, 0.15)); min-height: auto; padding: 1.5rem; display: flex; flex-direction: column;">
        <h5>Szakértői Magabiztosság & Kontextus</h5>
        <div class="details" style="font-size: 0.9rem; max-width: 800px; margin: 0 auto; flex-grow: 1; text-align: center;">
             ${expertConfHtml.split(' - ')[1] || 'N/A'}
        </div>
    </div>`;

    // --- Piac Elemzés Szekció ---
    let marketCardsHtml = '';
    (valueBets || []).forEach(bet => {
        marketCardsHtml += `
        <div class="market-card" style="background: rgba(var(--card-bg-rgb), 0.7); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem 0.5rem; text-align: center;">
            <div class="market-card-title" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500; margin-bottom: 0.5rem; min-height: 30px; display: flex; align-items: center; justify-content: center;">${escapeHTML(bet.market)}</div>
            <div class="market-card-value" style="font-size: 1.2rem;">${bet.odds}</div>
            <div class="details" style="font-size: 0.8rem; margin-top: auto; color: var(--text-secondary);">Becsült: ${bet.probability} (<strong>${bet.value}</strong>)</div>
       </div>`;
    });
    if (!marketCardsHtml) {
        marketCardsHtml = '<p class="muted" style="text-align: center; grid-column: 1 / -1;">Jelenleg nincsenek kiemelt értékű fogadások a piacon (min. 5% value).</p>';
    }

    const marketSectionHtml = `
    <div class="market-data-section" style="margin-bottom: 2rem;">
        <h4 style="font-size: 1.1rem; color: var(--secondary); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;">Érték Elemzés (Value Betting)</h4>
         <div class="market-card-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem;">
            ${marketCardsHtml}
        </div>
    </div>`;


    // --- AI Bizottság Harmonika Szekció ---
    let microAnalysesHtml = '';
    if (committeeResults?.microAnalyses) {
        Object.entries(committeeResults.microAnalyses).forEach(([key, text]) => {
         const title = key.toUpperCase().replace(/_/g, ' '); // Pl. "BTTS", "GOALSOU"
            // Szétválasztjuk a bizalmi szintet a szövegtől
            const parts = (text || "Hiba.").split('Bizalom:');
            const analysisText = parts[0] || "Elemzés nem elérhető.";
            const confidenceText = parts[1] ? `Bizalom: ${parts[1]}` : "Bizalom: N/A";
            
            microAnalysesHtml += `
            <div class="micromodel-card" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
                <h5 style="color: var(--primary); margin-bottom: 0.8rem; font-size: 1rem;">${escapeHTML(title)} Specialista</h5>
      <p style="margin: 0; color: var(--text-secondary); line-height: 1.6;">${analysisText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
                <p style="margin: 0.5rem 0 0 0; color: var(--text-secondary); line-height: 1.6; font-size: 0.9rem; opacity: 0.8;"><em>${confidenceText}</em></p>
            </div>`;
        });
    }
    
    // === JAVÍTÁS (5. KÉP): A kulcskérdések szebb listába rendezése ===
    let keyQuestionsHtml = '<p>- Hiba.</p>';
    if (committeeResults?.keyQuestions && !committeeResults.keyQuestions.includes("Hiba")) {
        const questions = committeeResults.keyQuestions.split('- ').filter(q => q.trim() !== '');
        keyQuestionsHtml = '<ul class="key-questions">';
        questions.forEach(q => {
            keyQuestionsHtml += `<li>${escapeHTML(q.trim())}</li>`;
        });
        keyQuestionsHtml += '</ul>';
    }


    const accordionHtml = `
    <div class="analysis-accordion" style="margin-top: 2rem;">
        <details class="analysis-accordion-item" open>
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                    Általános Elemzés
                </span>
            </summary>
            <div class="accordion-content">
     
             <p>${(committeeResults?.generalAnalysis || "Hiba.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '</p><p>')}</p>
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
                ${'' /* === JAVÍTÁS (3. KÉP): Vizuális sáv eltávolítva === */}
                <p>${(committeeResults?.propheticScenario || "Hiba.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
            </div>
        </details>

        <details class="analysis-accordion-item">
   <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="M9 3v18"></path><path d="M15 3v18"></path></svg>
          
           Taktikai Elemzés
                </span>
            </summary>
            <div class="accordion-content">
                <p>${(committeeResults?.tacticalBriefing || "Hiba.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
            </div>
        </details>
        
        <details class="analysis-accordion-item">
            <summary class="analysis-accordion-header">
                <span class="section-title">
                    <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>
                    Mikromodell Specialisták
                </span>
            </summary>
            <div class="accordion-content">
   
              ${microAnalysesHtml || "<p>Nem futottak speciális modellek ehhez a sporthoz.</p>"}
            </div>
        </details>

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
                <p>${(committeeResults?.riskAssessment || "Hiba.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
                 <br>
                <h4>Játékospiaci Meglátások</h4>
                <p>${(committeeResults?.playerMarkets || "Hiba.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
            </div>
      </details>
    </div>`;

    // --- Végső HTML összeállítása ---
    return `
        ${masterRecommendationHtml}
        ${atAGlanceHtml}
        ${expertConfidenceCardHtml}
        ${marketSectionHtml}
        ${accordionHtml}
    `;
}