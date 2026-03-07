/**
 * Trade Log — client-side storage & analytics.
 *
 * Automatically tracks trades from orders (Alpaca), webhook signals,
 * and chart analyzer executions. Computes performance stats by setup,
 * symbol, direction, and timeframe.
 */

import type { TradeRecord, TradeStats } from "./types";

const STORAGE_KEY = "trade_log";

// ── Persistence ─────────────────────────────────────────────────────────────

export function loadTrades(): TradeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveTrades(trades: TradeRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export function addTrade(trade: TradeRecord) {
  const trades = loadTrades();
  trades.unshift(trade);
  saveTrades(trades);
  return trades;
}

export function updateTrade(id: string, updates: Partial<TradeRecord>) {
  const trades = loadTrades();
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) return trades;
  trades[idx] = { ...trades[idx], ...updates };
  saveTrades(trades);
  return trades;
}

export function closeTrade(
  id: string,
  exitPrice: number,
  exitReason: string
): TradeRecord[] {
  const trades = loadTrades();
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) return trades;

  const trade = trades[idx];
  const pnl =
    trade.direction === "long"
      ? (exitPrice - trade.entry_price) * trade.qty
      : (trade.entry_price - exitPrice) * trade.qty;
  const pnlPct =
    trade.direction === "long"
      ? ((exitPrice - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - exitPrice) / trade.entry_price) * 100;

  trades[idx] = {
    ...trade,
    exit_price: exitPrice,
    exit_reason: exitReason,
    pnl,
    pnl_pct: pnlPct,
    status: pnl > 0 ? "closed" : "stopped",
    closed_at: new Date().toISOString(),
  };
  saveTrades(trades);
  return trades;
}

// ── Analytics ───────────────────────────────────────────────────────────────

export function computeStats(trades: TradeRecord[]): TradeStats {
  const closed = trades.filter((t) => t.status !== "open");
  const winners = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losers = closed.filter((t) => (t.pnl ?? 0) <= 0);

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const avgPnl = closed.length > 0 ? totalPnl / closed.length : 0;
  const avgWinner =
    winners.length > 0
      ? winners.reduce((s, t) => s + (t.pnl ?? 0), 0) / winners.length
      : 0;
  const avgLoser =
    losers.length > 0
      ? losers.reduce((s, t) => s + (t.pnl ?? 0), 0) / losers.length
      : 0;
  const grossProfit = winners.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + (t.pnl ?? 0), 0));

  // Group by setup type
  const bySetup: Record<string, { count: number; wins: number; pnl: number }> = {};
  const bySymbol: Record<string, { count: number; wins: number; pnl: number }> = {};
  const byDirection: Record<string, { count: number; wins: number; pnl: number }> = {};

  for (const t of closed) {
    const setup = t.setup_type || "unknown";
    if (!bySetup[setup]) bySetup[setup] = { count: 0, wins: 0, pnl: 0 };
    bySetup[setup].count++;
    if ((t.pnl ?? 0) > 0) bySetup[setup].wins++;
    bySetup[setup].pnl += t.pnl ?? 0;

    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { count: 0, wins: 0, pnl: 0 };
    bySymbol[t.symbol].count++;
    if ((t.pnl ?? 0) > 0) bySymbol[t.symbol].wins++;
    bySymbol[t.symbol].pnl += t.pnl ?? 0;

    const dir = t.direction || "unknown";
    if (!byDirection[dir]) byDirection[dir] = { count: 0, wins: 0, pnl: 0 };
    byDirection[dir].count++;
    if ((t.pnl ?? 0) > 0) byDirection[dir].wins++;
    byDirection[dir].pnl += t.pnl ?? 0;
  }

  const formatGroup = (g: Record<string, { count: number; wins: number; pnl: number }>) => {
    const result: Record<string, { count: number; win_rate: number; avg_pnl: number }> = {};
    for (const [key, val] of Object.entries(g)) {
      result[key] = {
        count: val.count,
        win_rate: val.count > 0 ? (val.wins / val.count) * 100 : 0,
        avg_pnl: val.count > 0 ? val.pnl / val.count : 0,
      };
    }
    return result;
  };

  // Best setup / symbol by win rate (min 2 trades)
  const setupEntries = Object.entries(bySetup).filter(([, v]) => v.count >= 2);
  const symbolEntries = Object.entries(bySymbol).filter(([, v]) => v.count >= 2);
  const bestSetup = setupEntries.sort((a, b) => (b[1].wins / b[1].count) - (a[1].wins / a[1].count))[0]?.[0] || "—";
  const bestSymbol = symbolEntries.sort((a, b) => (b[1].wins / b[1].count) - (a[1].wins / a[1].count))[0]?.[0] || "—";

  return {
    total_trades: closed.length,
    win_rate: closed.length > 0 ? (winners.length / closed.length) * 100 : 0,
    avg_pnl: avgPnl,
    avg_winner: avgWinner,
    avg_loser: avgLoser,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    best_setup: bestSetup,
    best_symbol: bestSymbol,
    total_pnl: totalPnl,
    by_setup: formatGroup(bySetup),
    by_symbol: formatGroup(bySymbol),
    by_direction: formatGroup(byDirection),
  };
}

// ── Auto-record from Alpaca order fill ──────────────────────────────────────

export function recordFromOrder(order: {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  filled_avg_price: string | null;
  filled_at: string | null;
  status: string;
}, meta?: {
  setup_type?: string;
  entry_reason?: string;
  confluence?: "HIGH" | "MEDIUM" | "LOW";
  source?: "manual" | "webhook" | "analyzer";
  analysis_id?: string;
  stop_loss?: number;
  take_profit?: number[];
}): TradeRecord | null {
  if (order.status !== "filled" || !order.filled_avg_price) return null;

  const trade: TradeRecord = {
    id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    symbol: order.symbol,
    side: order.side,
    direction: order.side === "buy" ? "long" : "short",
    qty: parseFloat(order.qty),
    entry_price: parseFloat(order.filled_avg_price),
    status: "open",
    setup_type: meta?.setup_type,
    entry_reason: meta?.entry_reason,
    confluence: meta?.confluence,
    stop_loss: meta?.stop_loss,
    take_profit: meta?.take_profit,
    source: meta?.source || "manual",
    order_id: order.id,
    analysis_id: meta?.analysis_id,
    opened_at: order.filled_at || new Date().toISOString(),
  };

  addTrade(trade);
  return trade;
}
