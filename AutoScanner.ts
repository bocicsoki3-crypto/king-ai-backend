import { getRichContextualData } from './DataFetch.js';
import { calculateValue, estimatePureXG, simulateMatchProgress } from './Model.js';
import { getSportStrategy } from './strategies/StrategyFactory.js';
import { sendSniperReport } from './EmailService.js';
import { _getFixturesFromEspn, findMainTotalsLine } from './providers/common/utils.js';
import { SPORT_CONFIG } from './config.js';
import { runStep_DataHunter } from './AI_Service.js';
import { runFullAnalysis } from './AnalysisFlow.js';

const REPORT_EMAIL = 'bocicsoki3@gmail.com';

/**
 * Automata szkenner a nagy értékű (Value) meccsek megtalálásához.
 * v147.0: Mostantól önállóan kutat az adatok után és teljes elemzést küld.
 */
export async function runSniperScan(sportType: 'soccer' | 'us_sports') {
    console.log(`[AutoScanner] Szkennelés indítása: ${sportType}...`);
    const results: any[] = [];
    
    try {
        const sportsToScan = sportType === 'soccer' ? ['soccer'] : ['basketball', 'hockey'];
        
        for (const sport of sportsToScan) {
            const config = SPORT_CONFIG[sport];
            if (!config) continue;

            // 1. Lekérjük a meccseket a következő 1 napra
            const fixtures = await _getFixturesFromEspn(sport, "1");
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

                    // 6. Value számítás
                    const valueBets = calculateValue(sim, data.oddsData, sport, fixture.home, fixture.away);

                    // 7. Szűrés: Csak a 7% feletti value
                    const highValueBets = valueBets.filter(vb => {
                        const val = parseFloat(vb.value.replace('+', '').replace('%', ''));
                        return val >= 7.0;
                    });

                    if (highValueBets.length > 0) {
                        console.log(`[AutoScanner] 🔥 TALÁLAT: ${fixture.home} vs ${fixture.away} - Teljes elemzés indítása...`);
                        
                        // 8. TELJES VICTORY PROTOCOL ELEMZÉS (Specialista, Pszichológus, Mester AI, Próféta)
                        const fullAnalysis: any = await runFullAnalysis({
                            ...fixture,
                            leagueName: fixture.league,
                            ...manualStats
                        }, sport, {});

                        if (fullAnalysis && !fullAnalysis.error) {
                            results.push({
                                match: `${fixture.home} vs ${fixture.away}`,
                                league: fixture.league,
                                time: new Date(fixture.utcKickoff).toLocaleString('hu-HU'),
                                hunted_stats: manualStats,
                                analysis: fullAnalysis.analysisData
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[AutoScanner] Hiba a meccs szkennelésekor (${fixture.home} vs ${fixture.away}):`, err);
                }
            }
        }

        // 9. Jelentés küldése
        await sendEmailReport(sportType, results);

    } catch (error: any) {
        console.error(`[AutoScanner] Kritikus hiba a szkenner futtatása közben: ${error.message}`);
    }
}

async function sendEmailReport(type: string, results: any[]) {
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
        <h1 style="color: #d32f2f; text-align: center;">King AI Sniper - v147.0 Victory Protocol</h1>
        <p style="text-align: center;">Időszak: ${isSoccer ? 'Ma déltől holnap délig' : 'Ma estétől holnap reggelig'}</p>
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
                        <h4 style="margin: 0 0 10px 0; color: #f57f17;">🏆 MESTER AI ÍTÉLETE:</h4>
                        <p style="font-size: 1.2em; font-weight: bold; margin: 5px 0;">${rec.recommended_bet}</p>
                        <p style="margin: 5px 0;">${rec.brief_reasoning}</p>
                    </div>

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
        <p style="color: #888; font-size: 0.8em; text-align: center;">Ez egy automata üzenet a King AI szerverétől. v147.0 VICTORY PROTOCOL aktív. A keresés Google Grounding technológiával történt.</p>
    `;

    await sendSniperReport(REPORT_EMAIL, subject, html);
}
