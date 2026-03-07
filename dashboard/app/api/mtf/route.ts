import { NextRequest, NextResponse } from "next/server";

/**
 * Multi-Timeframe Analysis API
 *
 * Fetches bars for 1H, 4H, 12H, 1D, 1W, 1M and computes bull/bear signals
 * per timeframe plus a composite score.
 *
 * GET /api/mtf?symbol=AAPL
 */

const DATA_URL = "https://data.alpaca.markets";
const API_KEY = process.env.ALPACA_API_KEY || "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";

const headers = {
  "APCA-API-KEY-ID": API_KEY,
  "APCA-API-SECRET-KEY": SECRET_KEY,
};

interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface TimeframeResult {
  timeframe: string;
  label: string;
  bias: "BULL" | "BEAR" | "NEUTRAL";
  score: number; // -3 to +3
  signals: string[];
  close: number | null;
  change_pct: number | null;
  ema_fast: number | null;
  ema_slow: number | null;
  rsi: number | null;
  macd_hist: number | null;
}

// ── EMA calculation ─────────────────────────────────────────────
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[0]);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

// ── RSI calculation ─────────────────────────────────────────────
function rsi(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD histogram ──────────────────────────────────────────────
function macdHist(closes: number[]): number | null {
  if (closes.length < 26) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macdLine.slice(17), 9); // start after ema26 warm-up
  if (signal.length === 0) return null;
  return macdLine[macdLine.length - 1] - signal[signal.length - 1];
}

// ── Analyze a set of bars for one timeframe ─────────────────────
function analyzeTimeframe(
  tf: string,
  label: string,
  bars: Bar[]
): TimeframeResult {
  const empty: TimeframeResult = {
    timeframe: tf,
    label,
    bias: "NEUTRAL",
    score: 0,
    signals: [],
    close: null,
    change_pct: null,
    ema_fast: null,
    ema_slow: null,
    rsi: null,
    macd_hist: null,
  };

  if (bars.length < 2) return { ...empty, signals: ["insufficient_data"] };

  const closes = bars.map((b) => b.c);
  const latest = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const changePct = ((latest - prev) / prev) * 100;

  // EMA 8/21
  const emaFast = ema(closes, 8);
  const emaSlow = ema(closes, 21);
  const latestEmaFast = emaFast[emaFast.length - 1];
  const latestEmaSlow = emaSlow[emaSlow.length - 1];

  // RSI 14
  const rsiVal = rsi(closes);

  // MACD histogram
  const macdVal = macdHist(closes);

  // Scoring: -3 to +3
  let score = 0;
  const signals: string[] = [];

  // 1. Price vs EMA 21 (trend)
  if (latest > latestEmaSlow) {
    score += 1;
    signals.push("price_above_ema21");
  } else {
    score -= 1;
    signals.push("price_below_ema21");
  }

  // 2. EMA crossover (momentum)
  if (latestEmaFast > latestEmaSlow) {
    score += 1;
    signals.push("ema8_above_ema21");
  } else {
    score -= 1;
    signals.push("ema8_below_ema21");
  }

  // 3. RSI regime
  if (rsiVal !== null) {
    if (rsiVal > 55) {
      score += 1;
      signals.push("rsi_bull_regime");
    } else if (rsiVal < 45) {
      score -= 1;
      signals.push("rsi_bear_regime");
    } else {
      signals.push("rsi_neutral");
    }
  }

  // 4. MACD histogram direction
  if (macdVal !== null) {
    if (macdVal > 0) {
      signals.push("macd_positive");
    } else {
      signals.push("macd_negative");
    }
  }

  const bias: "BULL" | "BEAR" | "NEUTRAL" =
    score >= 2 ? "BULL" : score <= -2 ? "BEAR" : "NEUTRAL";

  return {
    timeframe: tf,
    label,
    bias,
    score,
    signals,
    close: latest,
    change_pct: Math.round(changePct * 100) / 100,
    ema_fast: Math.round(latestEmaFast * 100) / 100,
    ema_slow: Math.round(latestEmaSlow * 100) / 100,
    rsi: rsiVal !== null ? Math.round(rsiVal * 10) / 10 : null,
    macd_hist: macdVal !== null ? Math.round(macdVal * 1000) / 1000 : null,
  };
}

// ── Timeframe configs ───────────────────────────────────────────
const TIMEFRAMES = [
  { tf: "1Hour", label: "1H", bars: 60, start_days: 5 },
  { tf: "4Hour", label: "4H", bars: 60, start_days: 15 },
  // 12H not natively supported by Alpaca — we'll use 4H and aggregate
  { tf: "1Day", label: "1D", bars: 60, start_days: 90 },
  { tf: "1Week", label: "1W", bars: 60, start_days: 500 },
  { tf: "1Month", label: "1M", bars: 36, start_days: 1100 },
];

async function fetchBars(
  symbol: string,
  timeframe: string,
  limit: number,
  startDays: number
): Promise<Bar[]> {
  const start = new Date();
  start.setDate(start.getDate() - startDays);
  const startStr = start.toISOString().split("T")[0];

  const url = `${DATA_URL}/v2/stocks/${encodeURIComponent(
    symbol
  )}/bars?timeframe=${timeframe}&start=${startStr}&limit=${limit}&feed=iex&sort=asc`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.bars || [];
}

// ── Aggregate 4H bars into 12H ─────────────────────────────────
function aggregate4HTo12H(bars4h: Bar[]): Bar[] {
  const result: Bar[] = [];
  for (let i = 0; i < bars4h.length; i += 3) {
    const chunk = bars4h.slice(i, i + 3);
    if (chunk.length === 0) continue;
    result.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, b) => s + b.v, 0),
    });
  }
  return result;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    // Fetch all timeframes in parallel
    const [bars1h, bars4h, bars1d, bars1w, bars1m] = await Promise.all([
      fetchBars(symbol, "1Hour", 60, 5),
      fetchBars(symbol, "4Hour", 90, 30),
      fetchBars(symbol, "1Day", 60, 90),
      fetchBars(symbol, "1Week", 60, 500),
      fetchBars(symbol, "1Month", 36, 1100),
    ]);

    // Aggregate 4H → 12H
    const bars12h = aggregate4HTo12H(bars4h);

    const results: TimeframeResult[] = [
      analyzeTimeframe("1H", "1 Hour", bars1h),
      analyzeTimeframe("4H", "4 Hour", bars4h),
      analyzeTimeframe("12H", "12 Hour", bars12h),
      analyzeTimeframe("1D", "Daily", bars1d),
      analyzeTimeframe("1W", "Weekly", bars1w),
      analyzeTimeframe("1M", "Monthly", bars1m),
    ];

    // Composite score: weighted average
    // Higher TFs carry more weight: 1H=1, 4H=1.5, 12H=2, 1D=3, 1W=3, 1M=2
    const weights = [1, 1.5, 2, 3, 3, 2];
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].signals[0] !== "insufficient_data") {
        weightedSum += results[i].score * weights[i];
        totalWeight += weights[i];
      }
    }
    const compositeScore =
      totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
    const compositeBias: "BULL" | "BEAR" | "NEUTRAL" =
      compositeScore >= 1.0 ? "BULL" : compositeScore <= -1.0 ? "BEAR" : "NEUTRAL";

    const bullCount = results.filter((r) => r.bias === "BULL").length;
    const bearCount = results.filter((r) => r.bias === "BEAR").length;

    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      timestamp: new Date().toISOString(),
      timeframes: results,
      composite: {
        bias: compositeBias,
        score: compositeScore,
        bull_count: bullCount,
        bear_count: bearCount,
        neutral_count: results.length - bullCount - bearCount,
        summary:
          compositeBias === "BULL"
            ? `${bullCount}/6 timeframes bullish — composite BULL`
            : compositeBias === "BEAR"
            ? `${bearCount}/6 timeframes bearish — composite BEAR`
            : `Mixed signals — composite NEUTRAL`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "MTF analysis failed" },
      { status: 500 }
    );
  }
}
