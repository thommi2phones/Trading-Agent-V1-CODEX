"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import ChartDropZone from "@/components/ChartDropZone";
import AnalysisResult from "@/components/AnalysisResult";
import MTFAnalysis from "@/components/MTFAnalysis";
import type { ChartAnalysis } from "@/lib/types";

const HISTORY_KEY = "chart_analyses";

function loadHistory(): ChartAnalysis[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToHistory(analysis: ChartAnalysis) {
  const history = loadHistory();
  history.unshift(analysis);
  // Keep last 50
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
}

export default function AnalyzePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChartAnalysis[]>(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      if (ticker) formData.append("ticker", ticker);
      if (description) formData.append("description", description);

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const result: ChartAnalysis = await res.json();
      setAnalysis(result);
      saveToHistory(result);
      setHistory(loadHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [file, ticker, description]);

  const handleExecuteTrade = (a: ChartAnalysis) => {
    // Navigate to trade page with pre-filled params
    const params = new URLSearchParams();
    params.set("symbol", a.ticker);
    if (a.direction) params.set("side", a.direction === "long" ? "buy" : "sell");
    if (a.entry_price) params.set("price", a.entry_price.toString());
    router.push(`/trade?${params}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Chart Analyzer</h1>
          <p className="text-sm text-tv-text-dim">
            Drop a chart screenshot for Claude vision analysis
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-3 py-1.5 text-sm rounded-lg bg-tv-border/40 text-tv-text-dim hover:text-tv-text transition-colors"
        >
          {showHistory ? "Hide History" : `History (${history.length})`}
        </button>
      </div>

      {showHistory ? (
        /* History view */
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="bg-tv-surface border border-tv-border rounded-xl p-8 text-center">
              <p className="text-tv-text-dim">No previous analyses</p>
            </div>
          ) : (
            history.map((h) => (
              <AnalysisResult
                key={h.id}
                analysis={h}
                onExecuteTrade={handleExecuteTrade}
              />
            ))
          )}
        </div>
      ) : (
        /* Analysis view */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input */}
          <div className="space-y-4">
            <ChartDropZone onImageSelected={setFile} />

            <div>
              <label className="block text-xs text-tv-text-dim mb-1">
                Ticker (optional)
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="e.g. BTC, TSLA, XAUUSD"
                className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
              />
            </div>

            <div>
              <label className="block text-xs text-tv-text-dim mb-1">
                Trade Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. BTC falling wedge on 4h, looking for breakout to 72k..."
                rows={3}
                className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue resize-none"
              />
            </div>

            <button
              onClick={handleAnalyze}
              disabled={!file || analyzing}
              className="w-full py-3 rounded-lg bg-tv-blue text-white text-sm font-semibold hover:bg-tv-blue/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyzing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Analyzing with Claude Vision...
                </span>
              ) : (
                "Analyze Chart"
              )}
            </button>

            {error && (
              <div className="p-3 rounded-lg bg-tv-red/10 text-tv-red text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div>
            {analysis ? (
              <AnalysisResult
                analysis={analysis}
                onExecuteTrade={handleExecuteTrade}
              />
            ) : (
              <div className="bg-tv-surface border border-tv-border rounded-xl p-8 text-center h-full flex items-center justify-center min-h-[300px]">
                <div>
                  <svg
                    className="w-12 h-12 mx-auto text-tv-text-dim mb-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                  <p className="text-tv-text-dim text-sm">
                    Drop a chart and click Analyze to get Claude&apos;s
                    assessment
                  </p>
                  <p className="text-tv-text-dim text-xs mt-1">
                    Uses the full chart analysis framework (268+ image training
                    set)
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Multi-Timeframe Analysis */}
      <MTFAnalysis />
    </div>
  );
}
