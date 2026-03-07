"use client";

import { useEffect, useState } from "react";
import type { AlpacaPosition } from "@/lib/types";

function fmt(n: string | number) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(n: string | number) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

interface Props {
  /** If true, show close button */
  showActions?: boolean;
  /** Callback after closing a position */
  onClose?: () => void;
  /** Compact mode for dashboard sidebar */
  compact?: boolean;
}

export default function PositionsTable({
  showActions = false,
  onClose,
  compact = false,
}: Props) {
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);

  const fetchPositions = async () => {
    try {
      const res = await fetch("/api/positions");
      if (!res.ok) throw new Error("Failed");
      setPositions(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, 30000);
    return () => clearInterval(id);
  }, []);

  const handleClose = async (symbol: string) => {
    setClosing(symbol);
    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchPositions();
        onClose?.();
      }
    } finally {
      setClosing(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-tv-surface border border-tv-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-tv-border rounded w-24 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-tv-border rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-tv-text-dim mb-3">
          Positions
        </h3>
        <p className="text-tv-text-dim text-sm">No open positions</p>
      </div>
    );
  }

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5 overflow-x-auto">
      <h3 className="text-sm font-medium text-tv-text-dim mb-3">
        Positions ({positions.length})
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-tv-text-dim text-xs border-b border-tv-border">
            <th className="text-left pb-2 font-medium">Symbol</th>
            <th className="text-right pb-2 font-medium">Qty</th>
            {!compact && (
              <th className="text-right pb-2 font-medium">Avg Entry</th>
            )}
            <th className="text-right pb-2 font-medium">Current</th>
            <th className="text-right pb-2 font-medium">P&L</th>
            <th className="text-right pb-2 font-medium">P&L %</th>
            {showActions && <th className="text-right pb-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const pl = parseFloat(p.unrealized_pl);
            const plPct = parseFloat(p.unrealized_plpc) * 100;
            const isUp = pl >= 0;
            return (
              <tr
                key={p.asset_id}
                className="border-b border-tv-border/50 last:border-0"
              >
                <td className="py-2 font-medium">{p.symbol}</td>
                <td className="py-2 text-right font-mono-numbers">
                  {p.qty}
                </td>
                {!compact && (
                  <td className="py-2 text-right font-mono-numbers text-tv-text-dim">
                    {fmt(p.avg_entry_price)}
                  </td>
                )}
                <td className="py-2 text-right font-mono-numbers">
                  {fmt(p.current_price)}
                </td>
                <td
                  className={`py-2 text-right font-mono-numbers ${
                    isUp ? "text-tv-green" : "text-tv-red"
                  }`}
                >
                  {fmtUsd(pl)}
                </td>
                <td
                  className={`py-2 text-right font-mono-numbers ${
                    isUp ? "text-tv-green" : "text-tv-red"
                  }`}
                >
                  {isUp ? "+" : ""}
                  {plPct.toFixed(2)}%
                </td>
                {showActions && (
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleClose(p.symbol)}
                      disabled={closing === p.symbol}
                      className="px-2 py-1 text-xs rounded bg-tv-red/20 text-tv-red hover:bg-tv-red/30 transition-colors disabled:opacity-50"
                    >
                      {closing === p.symbol ? "..." : "Close"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
