// ── Alpaca Types ────────────────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  long_market_value: string;
  short_market_value: string;
  pattern_day_trader: boolean;
  daytrade_count: number;
  last_equity: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  avg_entry_price: string;
  current_price: string;
  lastday_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  time_in_force: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
}

export interface OrderRequest {
  symbol: string;
  qty?: number | string;
  notional?: number | string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  time_in_force: "day" | "gtc" | "opg" | "cls" | "ioc" | "fok";
  limit_price?: number | string;
  stop_price?: number | string;
}

export interface AlpacaQuote {
  symbol: string;
  ask_price: number;
  ask_size: number;
  bid_price: number;
  bid_size: number;
  timestamp: string;
}

// ── Render / TradingView Event Types ────────────────────────────────────────

export interface TVEvent {
  event_id: string;
  received_at: string;
  source: string;
  accepted: boolean;
  missing_fields: string[];
  mismatch_flags: string[];
  payload?: TVPayload;
  agent_packet?: AgentPacket;
  // Flattened fields (may appear at top level from Render API)
  symbol?: string;
  bias?: string;
  confluence?: string;
  timeframe?: string;
  score?: number;
  [key: string]: unknown;
}

export interface TVPayload {
  symbol: string;
  timeframe: string;
  bar_time: string;
  setup_id: string;
  pattern_type: string;
  setup_stage: string;
  pattern_bias: string;
  pattern_confirmed: boolean;
  fib_significance: string;
  macd_hist: number;
  squeeze_release: boolean;
  rsi: number;
  score: number;
  confluence: "HIGH" | "MEDIUM" | "LOW";
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  [key: string]: unknown;
}

export interface AgentPacket {
  source: string;
  received_at: string;
  event_id: string;
  setup_id: string;
  symbol: string;
  timeframe: string;
  stage: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confluence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  pattern: {
    manual_type: string;
    manual_bias: string;
    manual_confirmed: boolean;
    auto_type: string;
    auto_conf: number;
    auto_bias: string;
    auto_aligned: boolean;
  };
  levels: {
    entry?: number;
    stop?: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    near_entry: boolean;
    hit_entry: boolean;
    hit_stop: boolean;
    hit_tp1: boolean;
    hit_tp2: boolean;
    hit_tp3: boolean;
  };
  momentum: {
    rsi: number;
    macd_hist: number;
    squeeze_release: boolean;
  };
  mismatch_flags: string[];
  missing_fields: string[];
  accepted: boolean;
  reasons?: string[];
}

// ── Chart Analysis Types ────────────────────────────────────────────────────

export interface ChartAnalysis {
  id: string;
  timestamp: string;
  ticker: string;
  raw_text: string;
  dominant_pattern: string;
  fib_confluence: string;
  historical_levels: string;
  macd_ttm: string;
  rsi_structure: string;
  confluence: "HIGH" | "MEDIUM" | "LOW";
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  invalidation: string;
  next_move: string;
  entry_price?: number;
  stop_price?: number;
  tp_prices?: number[];
  direction?: "long" | "short";
}

// ── Trade Log Types ─────────────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  direction: "long" | "short";
  qty: number;
  entry_price: number;
  exit_price?: number;
  stop_loss?: number;
  take_profit?: number[];
  status: "open" | "closed" | "stopped";
  setup_type?: string;
  entry_reason?: string;
  exit_reason?: string;
  confluence?: "HIGH" | "MEDIUM" | "LOW";
  bias?: "BULLISH" | "BEARISH" | "NEUTRAL";
  timeframe?: string;
  pnl?: number;
  pnl_pct?: number;
  risk_reward?: number;
  opened_at: string;
  closed_at?: string;
  /** Source: manual, webhook, analyzer */
  source: "manual" | "webhook" | "analyzer";
  /** Alpaca order ID if applicable */
  order_id?: string;
  /** Chart analysis ID if from analyzer */
  analysis_id?: string;
  tags?: string[];
}

export interface TradeStats {
  total_trades: number;
  win_rate: number;
  avg_pnl: number;
  avg_winner: number;
  avg_loser: number;
  profit_factor: number;
  best_setup: string;
  best_symbol: string;
  total_pnl: number;
  by_setup: Record<string, { count: number; win_rate: number; avg_pnl: number }>;
  by_symbol: Record<string, { count: number; win_rate: number; avg_pnl: number }>;
  by_direction: Record<string, { count: number; win_rate: number; avg_pnl: number }>;
}

// ── System Health ────────────────────────────────────────────────────────────

export interface SystemHealth {
  render: { ok: boolean; url: string; ts?: string };
  alpaca: { ok: boolean; account_id?: string; status?: string };
}
