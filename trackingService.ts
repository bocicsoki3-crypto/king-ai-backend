// === trackingService.ts (v140.3 - ROI TRACKING & STATISTICS) ===
// CÉL: Profit/Loss tracking, Win Rate, ROI számítás, Confidence kalibráció

import { getHistorySheet } from './sheets.js';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';

export interface BettingStats {
    total_bets: number;
    wins: number;
    losses: number;
    pushes: number;
    win_rate: number;
    total_staked: number;
    total_profit: number;
    roi: number;
    avg_odds: number;
    avg_confidence: number;
    confidence_calibration: {
        [confidenceRange: string]: {
            predicted_win_rate: number;
            actual_win_rate: number;
            calibration_error: number;
            sample_size: number;
        };
    };
    recent_performance: {
        last_10: { wins: number; losses: number; win_rate: number };
        last_30: { wins: number; losses: number; win_rate: number };
    };
    by_sport: {
        [sport: string]: {
            bets: number;
            win_rate: number;
            roi: number;
        };
    };
    by_league: {
        [league: string]: {
            bets: number;
            win_rate: number;
            roi: number;
        };
    };
}

/**
 * Számolja ki a teljes betting statisztikákat a History sheet-ből
 */
export async function calculateBettingStats(days: number = 30): Promise<BettingStats> {
    console.log(`[Tracking] Betting statisztikák számítása (utolsó ${days} nap)...`);
    
    try {
        const sheet = await getHistorySheet();
        const rows: GoogleSpreadsheetRow<any>[] = await sheet.getRows();
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        // Szűrés: csak azok a sorok, amiknek van W/L/P státusza ÉS dátumuk a cutoffDate után van
        const validRows = rows.filter(row => {
            const status = row.get("Helyes (W/L/P)") as string;
            const dateStr = row.get("Dátum") as string;
            if (!status || status === "N/A" || status === "") return false;
            if (!dateStr) return false;
            
            try {
                const rowDate = new Date(dateStr);
                return rowDate >= cutoffDate;
            } catch {
                return false;
            }
        });
        
        let totalBets = 0;
        let wins = 0;
        let losses = 0;
        let pushes = 0;
        let totalStaked = 0;
        let totalProfit = 0;
        let totalOdds = 0;
        let totalConfidence = 0;
        
        const confidenceBuckets: { [key: string]: { predicted: number; actual: number; count: number } } = {};
        const sportStats: { [sport: string]: { bets: number; wins: number; staked: number; profit: number } } = {};
        const leagueStats: { [league: string]: { bets: number; wins: number; staked: number; profit: number } } = {};
        const recentBets: Array<{ status: string; date: Date }> = [];
        
        for (const row of validRows) {
            const status = row.get("Helyes (W/L/P)") as string;
            const confidenceStr = row.get("Bizalom") as string;
            const oddsStr = row.get("Odds") as string;
            const stakeStr = row.get("Stake") as string || "1%"; // Default 1% ha nincs
            const sport = row.get("Sport") as string || "unknown";
            const league = row.get("Liga") as string || "unknown";
            const dateStr = row.get("Dátum") as string;
            
            if (status === "W") wins++;
            else if (status === "L") losses++;
            else if (status === "P") pushes++;
            
            totalBets++;
            
            // Odds és stake számítás
            const odds = parseFloat(oddsStr) || 2.0;
            const stakePercent = parseFloat(stakeStr.replace('%', '')) || 1.0;
            const stake = stakePercent / 100; // Bankroll százalék → törtrész
            
            totalStaked += stake;
            totalOdds += odds;
            
            // Profit számítás
            if (status === "W") {
                const profit = stake * (odds - 1); // Net profit
                totalProfit += profit;
            } else if (status === "L") {
                totalProfit -= stake; // Teljes stake veszteség
            }
            // Push = 0 profit
            
            // Confidence tracking
            const confidence = parseFloat(confidenceStr) || 5.0;
            totalConfidence += confidence;
            
            // Confidence kalibráció (10% buckets)
            const bucket = Math.floor(confidence / 10) * 10;
            const bucketKey = `${bucket}-${bucket + 10}`;
            if (!confidenceBuckets[bucketKey]) {
                confidenceBuckets[bucketKey] = { predicted: 0, actual: 0, count: 0 };
            }
            confidenceBuckets[bucketKey].predicted += confidence / 100; // Predicted win rate
            confidenceBuckets[bucketKey].actual += status === "W" ? 1 : 0;
            confidenceBuckets[bucketKey].count++;
            
            // Sport statisztikák
            if (!sportStats[sport]) {
                sportStats[sport] = { bets: 0, wins: 0, staked: 0, profit: 0 };
            }
            sportStats[sport].bets++;
            sportStats[sport].staked += stake;
            if (status === "W") {
                sportStats[sport].wins++;
                sportStats[sport].profit += stake * (odds - 1);
            } else if (status === "L") {
                sportStats[sport].profit -= stake;
            }
            
            // Liga statisztikák
            if (!leagueStats[league]) {
                leagueStats[league] = { bets: 0, wins: 0, staked: 0, profit: 0 };
            }
            leagueStats[league].bets++;
            leagueStats[league].staked += stake;
            if (status === "W") {
                leagueStats[league].wins++;
                leagueStats[league].profit += stake * (odds - 1);
            } else if (status === "L") {
                leagueStats[league].profit -= stake;
            }
            
            // Recent bets (utolsó 30)
            if (recentBets.length < 30) {
                try {
                    recentBets.push({ status, date: new Date(dateStr) });
                } catch {}
            }
        }
        
        // Confidence kalibráció számítás
        const calibration: BettingStats['confidence_calibration'] = {};
        for (const [bucket, data] of Object.entries(confidenceBuckets)) {
            const avgPredicted = data.predicted / data.count;
            const actualWinRate = data.actual / data.count;
            calibration[bucket] = {
                predicted_win_rate: avgPredicted * 100,
                actual_win_rate: actualWinRate * 100,
                calibration_error: Math.abs(avgPredicted * 100 - actualWinRate * 100),
                sample_size: data.count
            };
        }
        
        // Recent performance
        recentBets.sort((a, b) => b.date.getTime() - a.date.getTime());
        const last10 = recentBets.slice(0, 10);
        const last30 = recentBets.slice(0, 30);
        
        const last10Wins = last10.filter(b => b.status === "W").length;
        const last30Wins = last30.filter(b => b.status === "W").length;
        
        // ROI számítás
        const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
        const winRate = totalBets > 0 ? (wins / (wins + losses)) * 100 : 0;
        
        const stats: BettingStats = {
            total_bets: totalBets,
            wins,
            losses,
            pushes,
            win_rate: winRate,
            total_staked: totalStaked,
            total_profit: totalProfit,
            roi,
            avg_odds: totalBets > 0 ? totalOdds / totalBets : 0,
            avg_confidence: totalBets > 0 ? totalConfidence / totalBets : 0,
            confidence_calibration: calibration,
            recent_performance: {
                last_10: {
                    wins: last10Wins,
                    losses: last10.length - last10Wins,
                    win_rate: last10.length > 0 ? (last10Wins / last10.length) * 100 : 0
                },
                last_30: {
                    wins: last30Wins,
                    losses: last30.length - last30Wins,
                    win_rate: last30.length > 0 ? (last30Wins / last30.length) * 100 : 0
                }
            },
            by_sport: Object.fromEntries(
                Object.entries(sportStats).map(([sport, data]) => [
                    sport,
                    {
                        bets: data.bets,
                        win_rate: data.bets > 0 ? (data.wins / data.bets) * 100 : 0,
                        roi: data.staked > 0 ? (data.profit / data.staked) * 100 : 0
                    }
                ])
            ),
            by_league: Object.fromEntries(
                Object.entries(leagueStats).map(([league, data]) => [
                    league,
                    {
                        bets: data.bets,
                        win_rate: data.bets > 0 ? (data.wins / data.bets) * 100 : 0,
                        roi: data.staked > 0 ? (data.profit / data.staked) * 100 : 0
                    }
                ])
            )
        };
        
        console.log(`[Tracking] Statisztikák számítva: ${totalBets} tipp, ${winRate.toFixed(1)}% win rate, ${roi.toFixed(2)}% ROI`);
        return stats;
        
    } catch (e: any) {
        console.error(`[Tracking] Hiba a statisztikák számítása során: ${e.message}`);
        throw e;
    }
}

/**
 * Ellenőrzi, hogy van-e tilt protection szükség (veszteséges sorozat)
 */
export async function checkTiltProtection(maxLosses: number = 5): Promise<{
    isTilted: boolean;
    consecutiveLosses: number;
    message: string;
}> {
    try {
        const sheet = await getHistorySheet();
        const rows: GoogleSpreadsheetRow<any>[] = await sheet.getRows();
        
        // Utolsó N sor, dátum szerint rendezve
        const sortedRows = rows
            .filter(row => {
                const status = row.get("Helyes (W/L/P)") as string;
                return status === "W" || status === "L" || status === "P";
            })
            .sort((a, b) => {
                const dateA = new Date(a.get("Dátum") as string || 0);
                const dateB = new Date(b.get("Dátum") as string || 0);
                return dateB.getTime() - dateA.getTime();
            });
        
        let consecutiveLosses = 0;
        for (const row of sortedRows) {
            const status = row.get("Helyes (W/L/P)") as string;
            if (status === "L") {
                consecutiveLosses++;
            } else if (status === "W" || status === "P") {
                break; // Megszakítjuk a sorozatot
            }
        }
        
        const isTilted = consecutiveLosses >= maxLosses;
        
        return {
            isTilted,
            consecutiveLosses,
            message: isTilted
                ? `⚠️ TILT PROTECTION AKTIVÁLVA: ${consecutiveLosses} egymás utáni veszteség. Ajánlott: szünet a fogadástól.`
                : consecutiveLosses > 0
                ? `📊 ${consecutiveLosses} egymás utáni veszteség (limit: ${maxLosses})`
                : "✅ Nincs tilt protection szükség"
        };
        
    } catch (e: any) {
        console.error(`[Tracking] Hiba a tilt protection ellenőrzése során: ${e.message}`);
        return { isTilted: false, consecutiveLosses: 0, message: "Hiba az ellenőrzés során" };
    }
}

