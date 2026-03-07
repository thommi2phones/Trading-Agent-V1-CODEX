"use client";

import { useEffect, useState } from "react";
import { loadTrades, computeStats, closeTrade } from "@/lib/trade-log";
import type { TradeRecord, TradeStats } from "@/lib/types";
import SignalBadge from "@/components/SignalBadge";

function fmtUsd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export default function TradeLogPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closeModal, setCloseModal] = useState<{
    id: string;
    symbol: string;
  } | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [tab, setTab] = useState<"log" | "performance">("log");

  useEffect(() => {
    const t = loadTrades();
    setTrades(t);
    setStats(computeStats(t));
  }, []);

  const filtered = trades.filter((t) => {
    if (filter === "open") return t.status === "open";
    if (filter === "closed") return t.status !== "open";
    return true;
  });

  const handleClose = () => {
    if (!closeModal || !exitPrice) return;
    const updated = closeTrade(
      closeModal.id,
      parseFloat(exitPrice),
      exitReason || "Manual close"
    );
    setTrades(updated);
    setStats(computeStats(updated));
    setCloseModal(null);
    setExitPrice("");
    setExitReason("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Trade Log</h1>
        <p className="text-sm text-tv-text-dim">
          Historical performance tracking and analytics
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("log")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "log"
              ? "bg-tv-blue/15 text-tv-blue"
              : "text-tv-text-dim hover:text-tv-text"
          }`}
        >
          Trade Log
        </button>
        <button
          onClick={() => setTab("performance")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "performance"
              ? "bg-tv-blue/15 text-tv-blue"
              : "text-tv-text-dim hover:text-tv-text"
          }`}
        >
          Performance
        </button>
      </div>

      {tab === "performance" && stats ? (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Trades"
              value={stats.total_trades.toString()}
            />
            <StatCard
              label="Win Rate"
              value={`${stats.win_rate.toFixed(1)}%`}
              color={stats.win_rate >= 50 ? "green" : "red"}
            />
            <StatCard
              label="Total P&L"
              value={fmtUsd(stats.total_pnl)}
              color={stats.total_pnl >= 0 ? "green" : "red"}
            />
            <StatCard
              label="Profit Factor"
              value={
                stats.profit_factor === Infinity
                  ? "∞"
                  : stats.profit_factor.toFixed(2)
              }
              color={stats.profit_factor >= 1 ? "green" : "red"}
            />
            <StatCard
              label="Avg Winner"
              value={fmtUsd(stats.avg_winner)}
              color="green"
            />
            <StatCard
              label="Avg Loser"
              value={fmtUsd(stats.avg_loser)}
              color="red"
            />
            <StatCard label="Best Setup" value={stats.best_setup} />
            <StatCard label="Best Symbol" value={stats.best_symbol} />
          </div>

          {/* By Setup */}
          <GroupTable
            title="Performance by Setup"
            data={stats.by_setup}
          />

          {/* By Symbol */}
          <GroupTable
            title="Performance by Symbol"
            data={stats.by_symbol}
          />

          {/* By Direction */}
          <GroupTable
            title="Performance by Direction"
            data={stats.by_direction}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            {(["all", "open", "closed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-tv-blue/15 text-tv-blue"
                    : "text-tv-text-dim hover:text-tv-text"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({
                  f === "all"
                    ? trades.length
                    : f === "open"
                    ? trades.filter((t) => t.status === "open").length
                    : trades.filter((t) => t.status !== "open").length
                })
              </button>
            ))}
          </div>

          {/* Trade list */}
          {filtered.length === 0 ? (
            <div className="bg-tv-surface border border-tv-border rounded-xl p-8 text-center">
              <p className="text-tv-text-dim text-sm">
                No trades recorded yet. Trades are automatically logged when
                orders fill.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const isExpanded = expandedId === t.id;
                const isUp = (t.pnl ?? 0) >= 0;
                return (
                  <div
                    key={t.id}
                    className="bg-tv-surface border border-tv-border rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : t.id)
                      }
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-tv-border/20 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{t.symbol}</span>
                        <span
                          className={`text-xs font-bold ${
                            t.direction === "long"
                              ? "text-tv-green"
                              : "text-tv-red"
                          }`}
                        >
                          {t.direction?.toUpperCase()}
                        </span>
                        {t.confluence && (
                          <SignalBadge level={t.confluence} />
                        )}
                        {t.setup_type && (
                          <span className="text-xs text-tv-text-dim">
                            {t.setup_type}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {t.status !== "open" && t.pnl != null && (
                          <span
                            className={`font-mono-numbers text-sm font-medium ${
                              isUp ? "text-tv-green" : "text-tv-red"
                            }`}
                          >
                            {fmtUsd(t.pnl)} ({isUp ? "+" : ""}
                            {t.pnl_pct?.toFixed(2)}%)
                          </span>
                        )}
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            t.status === "open"
                              ? "bg-tv-blue/15 text-tv-blue"
                              : t.status === "closed"
                              ? "bg-tv-green/15 text-tv-green"
                              : "bg-tv-red/15 text-tv-red"
                          }`}
                        >
                          {t.status}
                        </span>
                        <span className="text-xs text-tv-text-dim">
                          {new Date(t.opened_at).toLocaleDateString()}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-tv-border/50 space-y-3 pt-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <span className="text-xs text-tv-text-dim">
                              Entry
                            </span>
                            <div className="font-mono-numbers">
                              ${t.entry_price.toLocaleString()}
                            </div>
                          </div>
                          {t.exit_price && (
                            <div>
                              <span className="text-xs text-tv-text-dim">
                                Exit
                              </span>
                              <div className="font-mono-numbers">
                                ${t.exit_price.toLocaleString()}
                              </div>
                            </div>
                          )}
                          {t.stop_loss && (
                            <div>
                              <span className="text-xs text-tv-text-dim">
                                Stop Loss
                              </span>
                              <div className="font-mono-numbers text-tv-red">
                                ${t.stop_loss.toLocaleString()}
                              </div>
                            </div>
                          )}
                          {t.take_profit && t.take_profit.length > 0 && (
                            <div>
                              <span className="text-xs text-tv-text-dim">
                                Take Profit
                              </span>
                              <div className="font-mono-numbers text-tv-orange">
                                {t.take_profit
                                  .map((p) => `$${p.toLocaleString()}`)
                                  .join(", ")}
                              </div>
                            </div>
                          )}
                          <div>
                            <span className="text-xs text-tv-text-dim">
                              Qty
                            </span>
                            <div className="font-mono-numbers">{t.qty}</div>
                          </div>
                          <div>
                            <span className="text-xs text-tv-text-dim">
                              Source
                            </span>
                            <div>{t.source}</div>
                          </div>
                        </div>
                        {t.entry_reason && (
                          <div>
                            <span className="text-xs text-tv-text-dim">
                              Entry Reason
                            </span>
                            <p className="text-sm mt-0.5">
                              {t.entry_reason}
                            </p>
                          </div>
                        )}
                        {t.exit_reason && (
                          <div>
                            <span className="text-xs text-tv-text-dim">
                              Exit Reason
                            </span>
                            <p className="text-sm mt-0.5">
                              {t.exit_reason}
                            </p>
                          </div>
                        )}
                        {t.status === "open" && (
                          <button
                            onClick={() =>
                              setCloseModal({
                                id: t.id,
                                symbol: t.symbol,
                              })
                            }
                            className="px-3 py-1.5 text-sm rounded-lg bg-tv-red/20 text-tv-red hover:bg-tv-red/30 transition-colors"
                          >
                            Record Exit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Close modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-tv-surface border border-tv-border rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">
              Close Trade: {closeModal.symbol}
            </h3>
            <div>
              <label className="block text-xs text-tv-text-dim mb-1">
                Exit Price
              </label>
              <input
                type="number"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                step="any"
                className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text focus:outline-none focus:border-tv-blue font-mono-numbers"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-tv-text-dim mb-1">
                Exit Reason
              </label>
              <input
                type="text"
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value)}
                placeholder="e.g. Hit TP1, stopped out, manual close..."
                className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={!exitPrice}
                className="flex-1 py-2 rounded-lg bg-tv-blue text-white text-sm font-medium disabled:opacity-50"
              >
                Record Exit
              </button>
              <button
                onClick={() => setCloseModal(null)}
                className="px-4 py-2 rounded-lg bg-tv-border/40 text-tv-text-dim text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red";
}) {
  const textColor =
    color === "green"
      ? "text-tv-green"
      : color === "red"
      ? "text-tv-red"
      : "text-tv-text";

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-4">
      <div className="text-xs text-tv-text-dim mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono-numbers ${textColor}`}>
        {value}
      </div>
    </div>
  );
}

function GroupTable({
  title,
  data,
}: {
  title: string;
  data: Record<string, { count: number; win_rate: number; avg_pnl: number }>;
}) {
  const entries = Object.entries(data).sort(
    (a, b) => b[1].count - a[1].count
  );

  if (entries.length === 0) return null;

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
      <h3 className="text-sm font-medium text-tv-text-dim mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-tv-text-dim text-xs border-b border-tv-border">
            <th className="text-left pb-2 font-medium">Name</th>
            <th className="text-right pb-2 font-medium">Trades</th>
            <th className="text-right pb-2 font-medium">Win Rate</th>
            <th className="text-right pb-2 font-medium">Avg P&L</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, vals]) => (
            <tr
              key={name}
              className="border-b border-tv-border/50 last:border-0"
            >
              <td className="py-2 font-medium">{name}</td>
              <td className="py-2 text-right font-mono-numbers">
                {vals.count}
              </td>
              <td
                className={`py-2 text-right font-mono-numbers ${
                  vals.win_rate >= 50 ? "text-tv-green" : "text-tv-red"
                }`}
              >
                {vals.win_rate.toFixed(1)}%
              </td>
              <td
                className={`py-2 text-right font-mono-numbers ${
                  vals.avg_pnl >= 0 ? "text-tv-green" : "text-tv-red"
                }`}
              >
                ${vals.avg_pnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
