"use client";

import { useEffect, useState } from "react";
import SignalBadge from "./SignalBadge";
import type { TVEvent } from "@/lib/types";

interface Props {
  limit?: number;
  showFilters?: boolean;
}

export default function EventFeed({ limit = 10, showFilters = false }: Props) {
  const [events, setEvents] = useState<TVEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterConf, setFilterConf] = useState("");
  const [filterBias, setFilterBias] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = async () => {
    try {
      const res = await fetch(`/api/events?limit=${limit}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, 30000);
    return () => clearInterval(id);
  }, [limit]);

  const filtered = events.filter((e) => {
    if (filterSymbol && !e.symbol?.toLowerCase().includes(filterSymbol.toLowerCase()))
      return false;
    if (filterConf && e.confluence?.toUpperCase() !== filterConf.toUpperCase())
      return false;
    if (filterBias && e.bias?.toUpperCase() !== filterBias.toUpperCase())
      return false;
    return true;
  });

  if (loading) {
    return (
      <div className="bg-tv-surface border border-tv-border rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-tv-border rounded w-32 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-tv-border rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
      <h3 className="text-sm font-medium text-tv-text-dim mb-3">
        TV Webhook Events ({filtered.length})
      </h3>

      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            placeholder="Filter symbol..."
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            className="bg-tv-bg border border-tv-border rounded-lg px-3 py-1.5 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue w-36"
          />
          <select
            value={filterConf}
            onChange={(e) => setFilterConf(e.target.value)}
            className="bg-tv-bg border border-tv-border rounded-lg px-3 py-1.5 text-sm text-tv-text focus:outline-none focus:border-tv-blue"
          >
            <option value="">All Confluence</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <select
            value={filterBias}
            onChange={(e) => setFilterBias(e.target.value)}
            className="bg-tv-bg border border-tv-border rounded-lg px-3 py-1.5 text-sm text-tv-text focus:outline-none focus:border-tv-blue"
          >
            <option value="">All Bias</option>
            <option value="BULLISH">BULLISH</option>
            <option value="BEARISH">BEARISH</option>
            <option value="NEUTRAL">NEUTRAL</option>
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-tv-text-dim text-sm">No events yet</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((e, i) => {
            const isExpanded = expandedId === (e.event_id || String(i));
            return (
              <div
                key={e.event_id || i}
                className="border border-tv-border/50 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedId(
                      isExpanded ? null : (e.event_id || String(i))
                    )
                  }
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-tv-border/20 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {e.symbol || "—"}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        e.bias?.toUpperCase() === "BULLISH"
                          ? "text-tv-green"
                          : e.bias?.toUpperCase() === "BEARISH"
                          ? "text-tv-red"
                          : "text-tv-text-dim"
                      }`}
                    >
                      {e.bias || "—"}
                    </span>
                    {e.confluence && <SignalBadge level={e.confluence} />}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-tv-text-dim">
                      {e.received_at
                        ? new Date(e.received_at).toLocaleString()
                        : ""}
                    </span>
                    <svg
                      className={`w-4 h-4 text-tv-text-dim transition-transform ${
                        isExpanded ? "rotate-180" : ""
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
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-tv-border/50">
                    <pre className="text-xs text-tv-text-dim mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(e, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
