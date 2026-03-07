"use client";

import { useCallback, useState } from "react";
import OrderForm from "@/components/OrderForm";
import OrdersTable from "@/components/OrdersTable";
import RuleChecklist from "@/components/RuleChecklist";
import ChartDropZone from "@/components/ChartDropZone";
import AnalysisResult from "@/components/AnalysisResult";
import type { ChecklistState } from "@/components/RuleChecklist";
import type { ChartAnalysis } from "@/lib/types";

const WATCHLIST = ["TSLA", "AMD", "AAPL", "NVDA", "SPY", "QQQ"];
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
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
}

export default function TradePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [quickSymbol, setQuickSymbol] = useState("");
  const [quickSide, setQuickSide] = useState<"buy" | "sell">("buy");
  const [checklistState, setChecklistState] = useState<ChecklistState>({
    allPassed: false,
    checked: {},
    patternType: "",
  });

  /* ── Chart analyzer state ───────────────────────────────── */
  const [file, setFile] = useState<File | null>(null);
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzerCollapsed, setAnalyzerCollapsed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ChartAnalysis[]>(() => loadHistory());

  /* ── Required checklist tracking ────────────────────────── */
  const REQUIRED_IDS = [
    "pattern_defined",
    "breakout_retest",
    "tp_defined",
    "stop_defined",
  ];
  const requiredDone = REQUIRED_IDS.filter((id) => {
    if (id === "pattern_defined") return checklistState.patternType !== "";
    return checklistState.checked[id];
  }).length;
  const requiredTotal = REQUIRED_IDS.length;

  /* ── Chart analysis ─────────────────────────────────────── */
  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setAnalyzeError(null);
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
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [file, ticker, description]);

  /* ── Execute trade from analysis → pre-fill order form ── */
  const handleExecuteTrade = (a: ChartAnalysis) => {
    setQuickSymbol(a.ticker);
    setQuickSide(a.direction === "long" ? "buy" : "sell");
    // Scroll to order form
    document.getElementById("order-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold">Trading Workspace</h1>
        <p className="text-sm text-tv-text-dim">
          Analyze charts, verify setup, and execute trades — all in one place
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 1: Chart Analyzer
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-tv-surface border border-tv-border rounded-xl overflow-hidden">
        {/* Collapsible header */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setAnalyzerCollapsed(!analyzerCollapsed)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAnalyzerCollapsed(!analyzerCollapsed); }}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-tv-border/20 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-tv-blue/20 text-tv-blue">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
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
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold">Chart Analyzer</h3>
              <p className="text-xs text-tv-text-dim">
                Claude Vision &middot; 268+ image training set
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {analysis && (
              <span className="text-xs font-medium text-tv-blue bg-tv-blue/10 px-2 py-0.5 rounded">
                {analysis.ticker} &middot; {analysis.bias}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowHistory(!showHistory);
              }}
              className="text-xs text-tv-text-dim hover:text-tv-text px-2 py-0.5 rounded bg-tv-border/30 transition-colors"
            >
              History ({history.length})
            </button>
            <svg
              className={`w-4 h-4 text-tv-text-dim transition-transform ${
                analyzerCollapsed ? "" : "rotate-180"
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m19.5 8.25-7.5 7.5-7.5-7.5"
              />
            </svg>
          </div>
        </div>

        {/* Analyzer body */}
        {!analyzerCollapsed && (
          <div className="px-5 py-4 border-t border-tv-border">
            {showHistory ? (
              /* ── History view ── */
              <div className="space-y-4">
                {history.length === 0 ? (
                  <p className="text-sm text-tv-text-dim text-center py-6">
                    No previous analyses
                  </p>
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
              /* ── Analyzer view ── */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Left: Upload + inputs */}
                <div className="space-y-3">
                  <ChartDropZone onImageSelected={setFile} />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-tv-text-dim mb-1">
                        Ticker
                      </label>
                      <input
                        type="text"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value)}
                        placeholder="e.g. BTC, TSLA"
                        className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-tv-text-dim mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Falling wedge, breakout to 72k..."
                        className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleAnalyze}
                    disabled={!file || analyzing}
                    className="w-full py-2.5 rounded-lg bg-tv-blue text-white text-sm font-semibold hover:bg-tv-blue/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

                  {analyzeError && (
                    <div className="p-3 rounded-lg bg-tv-red/10 text-tv-red text-sm">
                      {analyzeError}
                    </div>
                  )}
                </div>

                {/* Right: Analysis result */}
                <div>
                  {analysis ? (
                    <AnalysisResult
                      analysis={analysis}
                      onExecuteTrade={handleExecuteTrade}
                    />
                  ) : (
                    <div className="bg-tv-bg border border-tv-border rounded-xl p-6 text-center h-full flex items-center justify-center min-h-[200px]">
                      <div>
                        <svg
                          className="w-10 h-10 mx-auto text-tv-text-dim mb-2"
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
                          Drop a chart and click Analyze
                        </p>
                        <p className="text-tv-text-dim text-xs mt-1">
                          Uses the full chart analysis framework
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 2: Pre-Trade Checklist — gates order submission
          ═══════════════════════════════════════════════════════ */}
      <RuleChecklist onChange={setChecklistState} />

      {/* ═══════════════════════════════════════════════════════
          SECTION 3: Quick Trade + Order Form + Orders
          ═══════════════════════════════════════════════════════ */}
      <div id="order-section">
        {/* Quick trade buttons */}
        <div className="bg-tv-surface border border-tv-border rounded-xl p-4 mb-4">
          <h3 className="text-sm font-medium text-tv-text-dim mb-3">
            Quick Trade
          </h3>
          <div className="flex flex-wrap gap-2">
            {WATCHLIST.map((sym) => (
              <div key={sym} className="flex gap-1">
                <button
                  onClick={() => {
                    setQuickSymbol(sym);
                    setQuickSide("buy");
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-tv-green/15 text-tv-green hover:bg-tv-green/25 transition-colors font-medium"
                >
                  BUY {sym}
                </button>
                <button
                  onClick={() => {
                    setQuickSymbol(sym);
                    setQuickSide("sell");
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-tv-red/15 text-tv-red hover:bg-tv-red/25 transition-colors font-medium"
                >
                  SELL {sym}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Order form + orders table */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <OrderForm
              key={`${quickSymbol}-${quickSide}`}
              defaultSymbol={quickSymbol}
              defaultSide={quickSide}
              onOrderPlaced={() => setRefreshKey((k) => k + 1)}
              locked={!checklistState.allPassed}
              lockReason={
                !checklistState.allPassed
                  ? `Complete required checklist items (${requiredDone}/${requiredTotal})`
                  : undefined
              }
            />
          </div>
          <div className="lg:col-span-2">
            <OrdersTable refreshKey={refreshKey} />
          </div>
        </div>
      </div>
    </div>
  );
}
