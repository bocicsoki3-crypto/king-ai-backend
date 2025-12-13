// === bankrollService.ts (v140.3 - BANKROLL MANAGEMENT) ===
// CÉL: Drawdown protection, Stop Loss, Take Profit, Bankroll tracking

import { calculateBettingStats } from './trackingService.js';

export interface BankrollStatus {
    current_bankroll: number;
    initial_bankroll: number;
    total_profit: number;
    total_loss: number;
    drawdown_percent: number;
    max_drawdown_percent: number;
    is_stop_loss_triggered: boolean;
    is_take_profit_triggered: boolean;
    recommended_action: string;
}

export interface BankrollConfig {
    initial_bankroll: number;
    stop_loss_percent: number; // Pl. -20% (20% veszteség után stop)
    take_profit_percent: number; // Pl. +50% (50% profit után take profit)
    max_drawdown_percent: number; // Pl. -15% (15% drawdown után szünet)
    max_stake_percent: number; // Pl. 5% (Kelly Criterion limit)
}

const DEFAULT_CONFIG: BankrollConfig = {
    initial_bankroll: 1000, // Default 1000 egység
    stop_loss_percent: -20, // -20% stop loss
    take_profit_percent: +50, // +50% take profit
    max_drawdown_percent: -15, // -15% max drawdown
    max_stake_percent: 5.0 // 5% max stake
};

/**
 * Számolja ki a jelenlegi bankroll státuszt
 */
export async function getBankrollStatus(config: BankrollConfig = DEFAULT_CONFIG): Promise<BankrollStatus> {
    try {
        const stats = await calculateBettingStats(365); // Utolsó 1 év
        
        // Bankroll számítás (feltételezve, hogy minden tipp 1% bankroll volt)
        // Ha van stake oszlop, azt használjuk, különben 1% default
        const totalStaked = stats.total_staked; // Bankroll százalékok összege
        const totalProfit = stats.total_profit; // Profit/loss
        
        // Feltételezve, hogy kezdetben 100% bankroll volt
        const initialBankroll = config.initial_bankroll;
        const currentBankroll = initialBankroll + (totalProfit * initialBankroll); // Profit szorozva kezdeti bankroll-lal
        
        const drawdownPercent = ((currentBankroll - initialBankroll) / initialBankroll) * 100;
        
        // Max drawdown számítás (legrosszabb pont)
        // TODO: Ezt pontosabban kellene számolni a történeti adatokból
        const maxDrawdownPercent = drawdownPercent < 0 ? drawdownPercent : 0;
        
        // Stop Loss / Take Profit ellenőrzés
        const isStopLossTriggered = drawdownPercent <= config.stop_loss_percent;
        const isTakeProfitTriggered = drawdownPercent >= config.take_profit_percent;
        
        let recommendedAction = "✅ Normál működés";
        if (isStopLossTriggered) {
            recommendedAction = `🚨 STOP LOSS AKTIVÁLVA: ${drawdownPercent.toFixed(1)}% veszteség (limit: ${config.stop_loss_percent}%). Ajánlott: AZONNALI SZÜNET!`;
        } else if (isTakeProfitTriggered) {
            recommendedAction = `💰 TAKE PROFIT AKTIVÁLVA: ${drawdownPercent.toFixed(1)}% profit (limit: ${config.take_profit_percent}%). Ajánlott: Profit realizálása.`;
        } else if (maxDrawdownPercent <= config.max_drawdown_percent) {
            recommendedAction = `⚠️ MAX DRAWDOWN ELÉRVE: ${maxDrawdownPercent.toFixed(1)}% (limit: ${config.max_drawdown_percent}%). Ajánlott: Konzervatívabb fogadás.`;
        }
        
        return {
            current_bankroll: currentBankroll,
            initial_bankroll: initialBankroll,
            total_profit: totalProfit * initialBankroll,
            total_loss: totalStaked * initialBankroll - (totalProfit * initialBankroll),
            drawdown_percent: drawdownPercent,
            max_drawdown_percent: maxDrawdownPercent,
            is_stop_loss_triggered: isStopLossTriggered,
            is_take_profit_triggered: isTakeProfitTriggered,
            recommended_action: recommendedAction
        };
        
    } catch (e: any) {
        console.error(`[Bankroll] Hiba a bankroll státusz számítása során: ${e.message}`);
        throw e;
    }
}

/**
 * Ellenőrzi, hogy lehet-e új tippet adni (bankroll protection alapján)
 */
export async function canPlaceBet(config: BankrollConfig = DEFAULT_CONFIG): Promise<{
    canBet: boolean;
    reason: string;
    bankrollStatus: BankrollStatus;
}> {
    try {
        const bankrollStatus = await getBankrollStatus(config);
        
        if (bankrollStatus.is_stop_loss_triggered) {
            return {
                canBet: false,
                reason: `STOP LOSS: ${bankrollStatus.drawdown_percent.toFixed(1)}% veszteség`,
                bankrollStatus
            };
        }
        
        if (bankrollStatus.is_take_profit_triggered) {
            return {
                canBet: false,
                reason: `TAKE PROFIT: ${bankrollStatus.drawdown_percent.toFixed(1)}% profit`,
                bankrollStatus
            };
        }
        
        if (bankrollStatus.max_drawdown_percent <= config.max_drawdown_percent) {
            return {
                canBet: false,
                reason: `MAX DRAWDOWN: ${bankrollStatus.max_drawdown_percent.toFixed(1)}%`,
                bankrollStatus
            };
        }
        
        return {
            canBet: true,
            reason: "✅ Bankroll OK",
            bankrollStatus
        };
        
    } catch (e: any) {
        console.error(`[Bankroll] Hiba a canPlaceBet ellenőrzése során: ${e.message}`);
        return {
            canBet: true, // Default: engedélyezzük, ha hiba van
            reason: `Hiba: ${e.message}`,
            bankrollStatus: {} as BankrollStatus
        };
    }
}

