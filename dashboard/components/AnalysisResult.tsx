"use client";

import type { ChartAnalysis } from "@/lib/types";
import SignalBadge from "./SignalBadge";

interface Props {
  analysis: ChartAnalysis;
  onExecuteTrade?: (analysis: ChartAnalysis) => void;
}

const sections = [
  { key: "dominant_pattern", label: "1. Dominant Pattern", icon: "pattern" },
  { key: "fib_confluence", label: "2. Fibonacci Confluence", icon: "fib" },
  { key: "historical_levels", label: "3. Historical Levels", icon: "levels" },
  { key: "macd_ttm", label: "4. MACD + TTM State", icon: "macd" },
  { key: "rsi_structure", label: "5. RSI Structure", icon: "rsi" },
] as const;

export default function AnalysisResult({ analysis, onExecuteTrade }: Props) {
  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-lg">{analysis.ticker}</h3>
          <span
            className={`text-sm font-bold ${
              analysis.bias === "BULLISH"
                ? "text-tv-green"
                : analysis.bias === "BEARISH"
                ? "text-tv-red"
                : "text-tv-text-dim"
            }`}
          >
            {analysis.bias}
          </span>
          <SignalBadge level={analysis.confluence} />
        </div>
        <span className="text-xs text-tv-text-dim">
          {new Date(analysis.timestamp).toLocaleString()}
        </span>
      </div>

      {/* Extracted trade levels */}
      {(analysis.entry_price || analysis.stop_price || analysis.tp_prices?.length) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-tv-bg rounded-lg border border-tv-border">
          {analysis.direction && (
            <div>
              <div className="text-xs text-tv-text-dim">Direction</div>
              <div
                className={`text-sm font-bold ${
                  analysis.direction === "long"
                    ? "text-tv-green"
                    : "text-tv-red"
                }`}
              >
                {analysis.direction.toUpperCase()}
              </div>
            </div>
          )}
          {analysis.entry_price && (
            <div>
              <div className="text-xs text-tv-text-dim">Entry</div>
              <div className="text-sm font-mono-numbers font-medium">
                ${analysis.entry_price.toLocaleString()}
              </div>
            </div>
          )}
          {analysis.stop_price && (
            <div>
              <div className="text-xs text-tv-text-dim">Stop Loss</div>
              <div className="text-sm font-mono-numbers font-medium text-tv-red">
                ${analysis.stop_price.toLocaleString()}
              </div>
            </div>
          )}
          {analysis.tp_prices && analysis.tp_prices.length > 0 && (
            <div>
              <div className="text-xs text-tv-text-dim">
                Take Profit{analysis.tp_prices.length > 1 ? "s" : ""}
              </div>
              <div className="text-sm font-mono-numbers font-medium text-tv-orange">
                {analysis.tp_prices.map((p) => `$${p.toLocaleString()}`).join(", ")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Analysis sections */}
      <div className="space-y-3">
        {sections.map(({ key, label }) => {
          const value = analysis[key as keyof ChartAnalysis] as string;
          if (!value || value === "Not identified") return null;
          return (
            <div key={key}>
              <h4 className="text-xs font-medium text-tv-blue mb-1">
                {label}
              </h4>
              <p className="text-sm text-tv-text whitespace-pre-wrap">
                {value}
              </p>
            </div>
          );
        })}

        {analysis.invalidation && analysis.invalidation !== "Not identified" && (
          <div>
            <h4 className="text-xs font-medium text-tv-red mb-1">
              8. Invalidation Level
            </h4>
            <p className="text-sm text-tv-text">{analysis.invalidation}</p>
          </div>
        )}

        {analysis.next_move && analysis.next_move !== "Not identified" && (
          <div>
            <h4 className="text-xs font-medium text-tv-orange mb-1">
              9. Most Probable Next Move
            </h4>
            <p className="text-sm text-tv-text">{analysis.next_move}</p>
          </div>
        )}
      </div>

      {/* Action button */}
      {onExecuteTrade && analysis.entry_price && (
        <button
          onClick={() => onExecuteTrade(analysis)}
          className="w-full py-2.5 rounded-lg bg-tv-blue text-white text-sm font-semibold hover:bg-tv-blue/80 transition-colors"
        >
          Execute This Trade
        </button>
      )}
    </div>
  );
}
