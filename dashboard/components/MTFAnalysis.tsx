"use client";

import { useState } from "react";

interface TimeframeResult {
  timeframe: string;
  label: string;
  bias: "BULL" | "BEAR" | "NEUTRAL";
  score: number;
  signals: string[];
  close: number | null;
  change_pct: number | null;
  ema_fast: number | null;
  ema_slow: number | null;
  rsi: number | null;
  macd_hist: number | null;
}

interface MTFData {
  symbol: string;
  timestamp: string;
  timeframes: TimeframeResult[];
  composite: {
    bias: "BULL" | "BEAR" | "NEUTRAL";
    score: number;
    bull_count: number;
    bear_count: number;
    neutral_count: number;
    summary: string;
  };
}

const BIAS_COLORS = {
  BULL: { bg: "bg-tv-green/15", text: "text-tv-green", border: "border-tv-green/30" },
  BEAR: { bg: "bg-tv-red/15", text: "text-tv-red", border: "border-tv-red/30" },
  NEUTRAL: { bg: "bg-tv-text-dim/10", text: "text-tv-text-dim", border: "border-tv-border" },
};

function BiasIndicator({ bias }: { bias: "BULL" | "BEAR" | "NEUTRAL" }) {
  const c = BIAS_COLORS[bias];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${c.bg} ${c.text}`}>
      {bias === "BULL" ? "\u25B2" : bias === "BEAR" ? "\u25BC" : "\u25CF"} {bias}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  // score ranges -3 to +3, normalize to 0-100%
  const pct = Math.round(((score + 3) / 6) * 100);
  const color = score >= 2 ? "bg-tv-green" : score <= -2 ? "bg-tv-red" : "bg-tv-yellow";
  return (
    <div className="w-full h-1.5 bg-tv-bg rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function MTFAnalysis() {
  const [symbol, setSymbol] = useState("");
  const [data, setData] = useState<MTFData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTf, setExpandedTf] = useState<string | null>(null);

  const analyze = async (sym?: string) => {
    const target = sym || symbol;
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/mtf?symbol=${encodeURIComponent(target.trim().toUpperCase())}`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      const result: MTFData = await res.json();
      setData(result);
      setSymbol(result.symbol);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const quickSymbols = ["AAPL", "TSLA", "AMD", "NVDA", "SPY", "QQQ", "BTC/USD", "ETH/USD"];

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-tv-border">
        <h3 className="text-sm font-semibold mb-2">Multi-Timeframe Analysis</h3>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            placeholder="Symbol (e.g. AAPL)"
            className="flex-1 bg-tv-bg border border-tv-border rounded-lg px-3 py-1.5 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
          />
          <button
            onClick={() => analyze()}
            disabled={loading || !symbol.trim()}
            className="px-4 py-1.5 rounded-lg bg-tv-blue text-white text-sm font-medium hover:bg-tv-blue/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "..." : "Analyze"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {quickSymbols.map((s) => (
            <button
              key={s}
              onClick={() => { setSymbol(s); analyze(s); }}
              className="px-2 py-0.5 text-[11px] rounded bg-tv-border/30 text-tv-text-dim hover:text-tv-text hover:bg-tv-border/50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 bg-tv-red/10 text-tv-red text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="px-5 py-8 text-center">
          <div className="inline-block animate-spin w-5 h-5 border-2 border-tv-blue border-t-transparent rounded-full mb-2" />
          <p className="text-sm text-tv-text-dim">Analyzing {symbol.toUpperCase()} across 6 timeframes...</p>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="p-5 space-y-4">
          {/* Composite */}
          <div className={`p-4 rounded-xl border ${BIAS_COLORS[data.composite.bias].border} ${BIAS_COLORS[data.composite.bias].bg}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{data.symbol}</span>
                <BiasIndicator bias={data.composite.bias} />
              </div>
              <div className="text-right">
                <div className="text-xs text-tv-text-dim">Composite Score</div>
                <div className={`text-lg font-mono font-bold ${BIAS_COLORS[data.composite.bias].text}`}>
                  {data.composite.score > 0 ? "+" : ""}{data.composite.score}
                </div>
              </div>
            </div>
            <p className="text-xs text-tv-text-dim">{data.composite.summary}</p>
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-tv-green">{data.composite.bull_count} Bull</span>
              <span className="text-tv-red">{data.composite.bear_count} Bear</span>
              <span className="text-tv-text-dim">{data.composite.neutral_count} Neutral</span>
            </div>
          </div>

          {/* Timeframe grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {data.timeframes.map((tf) => (
              <button
                key={tf.timeframe}
                onClick={() => setExpandedTf(expandedTf === tf.timeframe ? null : tf.timeframe)}
                className={`p-3 rounded-xl border transition-all text-left ${
                  expandedTf === tf.timeframe
                    ? `${BIAS_COLORS[tf.bias].border} ${BIAS_COLORS[tf.bias].bg}`
                    : "border-tv-border hover:border-tv-blue/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-tv-text">{tf.label}</span>
                  <BiasIndicator bias={tf.bias} />
                </div>
                <ScoreBar score={tf.score} />
                {tf.change_pct !== null && (
                  <div className={`text-xs font-mono mt-1 ${tf.change_pct >= 0 ? "text-tv-green" : "text-tv-red"}`}>
                    {tf.change_pct >= 0 ? "+" : ""}{tf.change_pct}%
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Expanded detail */}
          {expandedTf && (() => {
            const tf = data.timeframes.find((t) => t.timeframe === expandedTf);
            if (!tf) return null;
            return (
              <div className="bg-tv-bg border border-tv-border rounded-xl p-4 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{tf.label} Detail</span>
                  <BiasIndicator bias={tf.bias} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-tv-text-dim block">Close</span>
                    <span className="font-mono">{tf.close?.toLocaleString() ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-tv-text-dim block">EMA 8 / 21</span>
                    <span className="font-mono">
                      {tf.ema_fast?.toLocaleString() ?? "—"} / {tf.ema_slow?.toLocaleString() ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-tv-text-dim block">RSI (14)</span>
                    <span className={`font-mono ${
                      tf.rsi !== null ? (tf.rsi > 55 ? "text-tv-green" : tf.rsi < 45 ? "text-tv-red" : "") : ""
                    }`}>
                      {tf.rsi ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-tv-text-dim block">MACD Hist</span>
                    <span className={`font-mono ${
                      tf.macd_hist !== null ? (tf.macd_hist > 0 ? "text-tv-green" : "text-tv-red") : ""
                    }`}>
                      {tf.macd_hist ?? "—"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {tf.signals.map((sig) => (
                    <span key={sig} className="px-1.5 py-0.5 text-[10px] rounded bg-tv-border/30 text-tv-text-dim">
                      {sig}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-tv-text-dim">Enter a symbol to see bull/bear analysis across all timeframes</p>
        </div>
      )}
    </div>
  );
}
