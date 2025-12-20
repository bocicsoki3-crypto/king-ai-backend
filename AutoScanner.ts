import { getRichContextualData } from './DataFetch.js';
import { calculateValue, estimatePureXG, simulateMatchProgress } from './Model.js';
import { getSportStrategy } from './strategies/StrategyFactory.js';
import { sendSniperReport } from './EmailService.js';
import { _getFixturesFromEspn, findMainTotalsLine } from './providers/common/utils.js';
import { SPORT_CONFIG } from './config.js';
import { runStep_DataHunter } from './AI_Service.js';
import { runFullAnalysis } from './AnalysisFlow.js';

const REPORT_EMAIL = process.env.EMAIL_USER || 'bocicsoki3@gmail.com';

/**
 * Automata szkenner a nagy értékű (Value) meccsek megtalálásához.
 * v148.2: Lazított foci szűrő (65%+) + Sequential startup fix.
 */
export async function runSniperScan(sportType: 'soccer' | 'basketball' | 'hockey', timeSlot?: string) {
    console.log(`[AutoScanner] Szkennelés indítása: ${sportType} (Sáv: ${timeSlot || 'Összes'})...`);
    const results: any[] = [];
    
    try {
        const sportsToScan = [sportType];
        
        for (const sport of sportsToScan) {
            const config = SPORT_CONFIG[sport];
            if (!config) continue;

            // 1. Lekérjük a meccseket a következő 1 napra
            let fixtures = await _getFixturesFromEspn(sport, "1");
            
            // --- IDŐSÁV SZŰRÉS (v148.0) ---
            if (sportType === 'soccer' && timeSlot) {
                const [startStr, endStr] = timeSlot.split('-');
                const [startHour] = startStr.split(':').map(Number);
                const [endHour] = endStr.split(':').map(Number);

                fixtures = fixtures.filter(f => {
                    const matchDate = new Date(f.utcKickoff);
                    // Átszámoljuk Budapest-i órára a szűréshez
                    const budapestHour = new Date(matchDate.toLocaleString("en-US", {timeZone: "Europe/Budapest"})).getHours();
                    
                    if (startHour < endHour) {
                        return budapestHour >= startHour && budapestHour < endHour;
                    } else {
                        // Éjszakai sáv (pl. 23:00 - 06:00)
                        return budapestHour >= startHour || budapestHour < endHour;
                    }
                });
                console.log(`[AutoScanner] Idősáv szűrés (${timeSlot}): ${fixtures.length} meccs maradt.`);
            }

            console.log(`[AutoScanner] ${fixtures.length} meccs találva a(z) ${sport} sportágban.`);

            let count = 0;
            for (const fixture of fixtures) {
                count++;
                try {
                    console.log(`[AutoScanner] Vizsgálat (${count}/${fixtures.length}): ${fixture.home} vs ${fixture.away}...`);
                    
                    // KIS SZÜNET (v147.1): Megelőzi a Gemini 429-es kvóta hibát
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // 2. STATISZTIKA VADÁSZAT (Deep Search) - Automata xG/PPG keresés
                    const huntedData = await runStep_DataHunter(fixture.home, fixture.away, sport);
                    
                    if (!huntedData) {
                        console.warn(`[AutoScanner] Nem sikerült adatokat vadászni a(z) ${fixture.home} vs ${fixture.away} meccshez. Átugrás.`);
                        continue;
                    }

                    // JAVÍTÁS (v147.1): Részletesebb logolás az AI által talált adatokról
                    console.log(`[AutoScanner] Adatvadász fogás (${sport}):`, JSON.stringify({
                        home: fixture.home,
                        away: fixture.away,
                        source: huntedData.source_found,
                        h_xg: huntedData.home_stats?.xg_per_game,
                        h_avg: huntedData.home_stats?.avg_pts_scored,
                        h_gsax: huntedData.hockey_extras?.home_goalie_gsax
                    }, null, 2));

                    // 3. Adatgyűjtés a vadászott adatokkal
                    const manualStats = {
                        manual_H_xG: huntedData.home_stats?.xg_per_game || huntedData.home_stats?.avg_pts_scored,
                        manual_H_xGA: huntedData.home_stats?.xga_per_game || huntedData.home_stats?.avg_pts_conceded,
                        manual_A_xG: huntedData.away_stats?.xg_per_game || huntedData.away_stats?.avg_pts_scored,
                        manual_A_xGA: huntedData.away_stats?.xga_per_game || huntedData.away_stats?.avg_pts_conceded,
                        manual_H_PPG: huntedData.home_stats?.ppg,
                        manual_A_PPG: huntedData.away_stats?.ppg,
                        home_gsax: huntedData.hockey_extras?.home_goalie_gsax,
                        away_gsax: huntedData.hockey_extras?.away_goalie_gsax
                    };

                    const data = await getRichContextualData({
                        sport,
                        homeTeamName: fixture.home,
                        awayTeamName: fixture.away,
                        leagueName: fixture.league,
                        utcKickoff: fixture.utcKickoff,
                        forceNew: false,
                        ...manualStats
                    });

                    if (!data.oddsData || !data.rawStats) continue;

                    // 4. Nyers statisztikai becslés (Quant) - Most már a vadászott adatokkal (1.5x súly!)
                    const strategy = getSportStrategy(sport);
                    const pureXG = estimatePureXG(
                        fixture.home,
                        fixture.away,
                        data.rawStats,
                        sport,
                        data.form,
                        data.leagueAverages || {},
                        data.advancedData,
                        strategy,
                        data.rawData?.absentees
                    );

                    // 5. Gyors szimuláció a szűréshez
                    const mainLine = findMainTotalsLine(data.oddsData, sport);
                    const sim = simulateMatchProgress(
                        pureXG.pure_mu_h,
                        pureXG.pure_mu_a,
                        0, 0, 15000, 
                        sport,
                        null,
                        mainLine,
                        data.rawData
                    );

                    // 6. Value számítás (csak információs célra, nem szűrünk rá)
                        const valueBets = calculateValue(sim, data.oddsData, sport, fixture.home, fixture.away);

                        // 7. v148.9: VALUE SZŰRÉS ELTÁVOLÍTVA - Minden meccset elemezünk, az AI dönt
                        // Az AI 8.5+ confidence alapján fog tippet adni, függetlenül a value-tól
                        console.log(`[AutoScanner] 📊 Meccs elemzés indítása (${count}/${fixtures.length}): ${fixture.home} vs ${fixture.away} - Teljes elemzés indítása...`);
                        
                        // 8. TELJES VICTORY PROTOCOL ELEMZÉS (Specialista, Pszichológus, Mester AI, Próféta)
                        const fullAnalysis: any = await runFullAnalysis({
                            ...fixture,
                            leagueName: fixture.league,
                            ...manualStats
                        }, sport, {});

                        if (fullAnalysis && !fullAnalysis.error) {
                            // === v149.0: Új struktúra ellenőrzése (tips array) ===
                            const rec = fullAnalysis.analysisData.recommendation;
                            const confidence = rec?.final_confidence || 0;
                            const tips = rec?.tips || [];
                            
                            // Minimum 1 tipp kell, és mindegyik >= 8.5 confidence
                            const isRejected = !rec || 
                                             !Array.isArray(tips) || 
                                             tips.length === 0 ||
                                             confidence < 8.5; // v149.0: Minimum 8.5 confidence kell

                            if (!isRejected) {
                                const tipsList = tips.map((t: any) => t.market).join(', ');
                                console.log(`[AutoScanner] ✅ TIPP ELFOGADVA (${fixture.home} vs ${fixture.away}): ${tips.length} tipp (${tipsList}) (Confidence: ${confidence.toFixed(1)}/10)`);
                                results.push({
                                    match: `${fixture.home} vs ${fixture.away}`,
                                    league: fixture.league,
                                    time: new Date(fixture.utcKickoff).toLocaleString('hu-HU'),
                                    hunted_stats: manualStats,
                                    analysis: fullAnalysis.analysisData
                                });
                            } else {
                                console.warn(`[AutoScanner] ⚠️ EXECUTIONER elvetette a meccset (${fixture.home} vs ${fixture.away}) - Indok: ${tips.length === 0 ? 'Nincs tipp' : 'Nincs adat'} vagy Confidence: ${confidence.toFixed(1)}/10 < 8.5`);
                            }
                        }
                } catch (err) {
                    console.error(`[AutoScanner] Hiba a meccs szkennelésekor (${fixture.home} vs ${fixture.away}):`, err);
                }
            }
        }

        // 9. Jelentés küldése
        await sendEmailReport(sportType, results, timeSlot);

    } catch (error: any) {
        console.error(`[AutoScanner] Kritikus hiba a szkenner futtatása közben: ${error.message}`);
    }
}

async function sendEmailReport(type: string, results: any[], timeSlot?: string) {
    const isSoccer = type === 'soccer';
    const subject = `${results.length > 0 ? '🔥' : 'ℹ️'} King AI Sniper Report - ${isSoccer ? 'Foci' : 'Kosár/Hoki'} (${new Date().toLocaleDateString('hu-HU')})`;
    
    let html = `
        <style>
            .match-box { margin-bottom: 30px; padding: 20px; border: 2px solid #d32f2f; border-radius: 12px; background-color: #fff; }
            .stats-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            .stats-table th, .stats-table td { padding: 10px; border: 1px solid #eee; text-align: center; }
            .verdict { background-color: #fffde7; padding: 15px; border-left: 5px solid #fbc02d; margin: 15px 0; }
            .prophet { font-style: italic; color: #455a64; background-color: #f1f8e9; padding: 15px; border-radius: 8px; }
            .badge { display: inline-block; padding: 5px 10px; border-radius: 20px; color: #fff; font-weight: bold; font-size: 0.8em; }
            .badge-value { background-color: #4caf50; }
            .badge-odds { background-color: #2196f3; }
        </style>
        <h1 style="color: #d32f2f; text-align: center;">King AI Sniper - v148.7 EXECUTIONER PROTOCOL</h1>
        <p style="text-align: center;">Időszak: ${isSoccer ? (timeSlot || 'Ma déltől holnap délig') : 'Ma estétől holnap reggelig'}</p>
        <hr>
    `;

    if (results.length === 0) {
        html += `
            <div style="padding: 40px; background-color: #f9f9f9; border-radius: 8px; text-align: center;">
                <p style="font-size: 1.2em; color: #555;">A szkennelés lefutott, de ebben az időszakban <b>nem találtunk 7% feletti matematikai előnyt</b>.</p>
                <p style="color: #888;">A statisztikai vadászok tovább figyelik a piacokat.</p>
            </div>
        `;
    } else {
        html += `<p style="font-size: 1.1em;">A rendszer <b>${results.length} meccset</b> talált, ahol a Victory Protocol minden feltétele teljesült.</p>`;
        
        for (const res of results) {
            const rec = res.analysis.recommendation;
            
            html += `
                <div class="match-box">
                    <h2 style="margin: 0; color: #1a237e;">${res.match}</h2>
                    <p style="color: #666;">${res.league} | ${res.time}</p>
                    
                    <div style="margin: 15px 0;">
                        <span class="badge badge-odds">Odds: ${res.analysis.valueBets[0]?.odds || 'N/A'}</span>
                        <span class="badge badge-value">Value: ${res.analysis.valueBets[0]?.value || 'N/A'}</span>
                        <span class="badge" style="background-color: #ff9800;">Bizalom: ${res.analysis.finalConfidenceScore}/10</span>
                    </div>

                    <div class="verdict">
                        <h4 style="margin: 0 0 10px 0; color: #f57f17;">🏆 MESTER AI ÍTÉLETE (${rec.tips?.length || 0} tipp):</h4>
                        ${rec.tips && rec.tips.length > 0 ? rec.tips.map((tip: any, idx: number) => `
                            <div style="margin-bottom: 15px; padding: 10px; background-color: ${idx === 0 ? '#fffde7' : '#f5f5f5'}; border-left: 4px solid ${idx === 0 ? '#fbc02d' : '#9e9e9e'};">
                                <p style="font-size: ${idx === 0 ? '1.2em' : '1.1em'}; font-weight: bold; margin: 5px 0; color: ${idx === 0 ? '#f57f17' : '#555'};">
                                    ${idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} ${tip.market} <span style="color: #ff9800;">(${tip.confidence.toFixed(1)}/10)</span>
                                </p>
                                <p style="margin: 5px 0; font-size: 0.95em; color: #555;">${tip.reasoning || 'Nincs részletes indoklás'}</p>
                            </div>
                        `).join('') : '<p style="color: #d32f2f;">Nincs tipp</p>'}
                        <p style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em;">${rec.brief_reasoning || 'Nincs összefoglaló indoklás'}</p>
                    </div>

                    <h4 style="margin: 15px 0 5px 0;">📈 ÉRTÉKES PIACOK (Matematikai modell):</h4>
                    <ul style="margin: 0; padding-left: 20px; color: #2e7d32;">
                        ${res.analysis.valueBets.map((vb: any) => `
                            <li><b>${vb.market}</b> @ ${vb.odds} (Value: ${vb.value})</li>
                        `).join('')}
                    </ul>

                    <h4 style="margin: 15px 0 5px 0;">📊 TALÁLT "IGAZSÁG" ADATOK:</h4>
                    <table class="stats-table">
                        <tr style="background: #f5f5f5;">
                            <th>Csapat</th>
                            <th>xG (Várható gól)</th>
                            <th>xGA (Kapott xG)</th>
                            <th>PPG (Pont/Meccs)</th>
                        </tr>
                        <tr>
                            <td>Hazai</td>
                            <td>${res.hunted_stats.manual_H_xG || 'N/A'}</td>
                            <td>${res.hunted_stats.manual_H_xGA || 'N/A'}</td>
                            <td>${res.hunted_stats.manual_H_PPG || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td>Vendég</td>
                            <td>${res.hunted_stats.manual_A_xG || 'N/A'}</td>
                            <td>${res.hunted_stats.manual_A_xGA || 'N/A'}</td>
                            <td>${res.hunted_stats.manual_A_PPG || 'N/A'}</td>
                        </tr>
                    </table>

                        <div class="prophet">
                            <h4 style="margin: 0 0 10px 0; color: #2e7d32;">👁️ A PRÓFÉTA LÁTOMÁSA (Múlt időben):</h4>
                            <p>${res.analysis.committee?.strategist?.prophetic_timeline || 'N/A'}</p>
                        </div>
                </div>
            `;
        }
    }

    html += `
        <br>
        <p style="color: #888; font-size: 0.8em; text-align: center;">Ez egy automata üzenet a King AI szerverétől. v148.7 EXECUTIONER PROTOCOL aktív. A keresés Google Grounding technológiával történt.</p>
    `;

    await sendSniperReport(REPORT_EMAIL, subject, html);
}
