import { preFetchAnalysisCache, getRichContextualData } from './DataFetch.js';
import { calculateValue, estimatePureXG, simulateMatchProgress } from './Model.js';
import { getSportStrategy } from './strategies/StrategyFactory.js';
import { sendSniperReport } from './EmailService.js';
import { _getFixturesFromEspn, findMainTotalsLine } from './providers/common/utils.js';
import { SPORT_CONFIG } from './config.js';

const REPORT_EMAIL = 'bocicsoki3@gmail.com';

/**
 * Automata szkenner a nagy értékű (Value) meccsek megtalálásához.
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

            for (const fixture of fixtures) {
                try {
                    // 2. Gyors adatgyűjtés (csak statisztika és odds, AI nélkül)
                    // Megpróbáljuk a cache-t használni ha van
                    const data = await getRichContextualData({
                        sport,
                        homeTeamName: fixture.home,
                        awayTeamName: fixture.away,
                        leagueName: fixture.league,
                        utcKickoff: fixture.utcKickoff,
                        forceNew: false
                    });

                    if (!data.oddsData || !data.rawStats) continue;

                    // 3. Nyers statisztikai becslés (Quant)
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

                    // 4. Gyors szimuláció
                    const mainLine = findMainTotalsLine(data.oddsData, sport);
                    const sim = simulateMatchProgress(
                        pureXG.pure_mu_h,
                        pureXG.pure_mu_a,
                        0, 0, 10000, // 10k szimuláció elég az előszűréshez
                        sport,
                        null,
                        mainLine,
                        data.rawData
                    );

                    // 5. Value számítás
                    const valueBets = calculateValue(sim, data.oddsData, sport, fixture.home, fixture.away);

                    // 6. Szűrés: Csak a 7% feletti value
                    const highValueBets = valueBets.filter(vb => {
                        const val = parseFloat(vb.value.replace('+', '').replace('%', ''));
                        return val >= 7.0;
                    });

                    if (highValueBets.length > 0) {
                        results.push({
                            match: `${fixture.home} vs ${fixture.away}`,
                            league: fixture.league,
                            time: new Date(fixture.utcKickoff).toLocaleString('hu-HU'),
                            bets: highValueBets
                        });
                    }
                } catch (err) {
                    // Egyedi meccs hiba ne állítsa meg a többit
                    console.error(`[AutoScanner] Hiba a meccs szkennelésekor (${fixture.home} vs ${fixture.away}):`, err);
                }
            }
        }

        // 7. Jelentés küldése (Mindenképpen küldünk, akkor is ha üres)
        await sendEmailReport(sportType, results);

    } catch (error: any) {
        console.error(`[AutoScanner] Kritikus hiba a szkenner futtatása közben: ${error.message}`);
    }
}

async function sendEmailReport(type: string, results: any[]) {
    const isSoccer = type === 'soccer';
    const subject = `${results.length > 0 ? '🔥' : 'ℹ️'} King AI Sniper Report - ${isSoccer ? 'Foci' : 'Kosár/Hoki'} (${new Date().toLocaleDateString('hu-HU')})`;
    
    let html = `
        <h2 style="color: #d32f2f;">King AI Sniper - v147.0 Victory Protocol</h2>
        <p>Időszak: ${isSoccer ? 'Ma déltől holnap délig' : 'Ma estétől holnap reggelig'}</p>
        <hr>
    `;

    if (results.length === 0) {
        html += `
            <div style="padding: 20px; background-color: #f9f9f9; border-radius: 8px; text-align: center;">
                <p style="font-size: 1.1em; color: #555;">A szkennelés lefutott, de ebben az időszakban <b>nem találtunk 7% feletti matematikai előnyt</b>.</p>
                <p style="color: #888;">A rendszer továbbra is figyeli a piacokat.</p>
            </div>
        `;
    } else {
        html += `<p>A rendszer az alábbi meccseket találta, ahol a <b>matematikai előny meghaladja a 7%-ot</b>.</p>`;
        
        for (const res of results) {
            html += `
                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
                    <h3 style="margin: 0;">${res.match}</h3>
                    <p style="color: #666; font-size: 0.9em;">${res.league} | ${res.time}</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="background: #f4f4f4;">
                            <th style="text-align: left; padding: 8px;">Piac</th>
                            <th style="text-align: center; padding: 8px;">Odds</th>
                            <th style="text-align: center; padding: 8px;">Esély</th>
                            <th style="text-align: center; padding: 8px;">Value</th>
                        </tr>
            `;

            for (const bet of res.bets) {
                html += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${bet.market}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${bet.odds}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${bet.probability}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center; color: green; font-weight: bold;">${bet.value}</td>
                    </tr>
                `;
            }

            html += `
                    </table>
                    <p style="margin-top: 10px; font-style: italic;">Indíts mélyelemzést a manuális xG/PPG adataiddal a 1.5x súlyozáshoz!</p>
                </div>
            `;
        }
    }

    html += `
        <br>
        <p style="color: #888; font-size: 0.8em;">Ez egy automata üzenet a King AI szerverétől. v147.0 VICTORY PROTOCOL aktív.</p>
    `;

    await sendSniperReport(REPORT_EMAIL, subject, html);
}

