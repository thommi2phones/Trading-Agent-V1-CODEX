"use client";

import { useEffect, useState } from "react";

interface HealthData {
  ok: boolean;
  alpaca: { ok: boolean; account_id?: string; status?: string };
  render: { ok: boolean; status?: string; uptime?: number };
  timestamp: string;
}

export default function SystemStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) setHealth(await res.json());
      } catch {
        /* silent */
      }
    };
    fetchHealth();
    const id = setInterval(fetchHealth, 60000);
    return () => clearInterval(id);
  }, []);

  const Dot = ({ ok }: { ok: boolean }) => (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        ok ? "bg-tv-green" : "bg-tv-red"
      }`}
    />
  );

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
      <h3 className="text-sm font-medium text-tv-text-dim mb-3">
        System Status
      </h3>

      {!health ? (
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-tv-border rounded w-32" />
          <div className="h-4 bg-tv-border rounded w-28" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dot ok={health.alpaca.ok} />
              <span className="text-sm">Alpaca API</span>
            </div>
            <span className="text-xs text-tv-text-dim">
              {health.alpaca.ok ? health.alpaca.status : "Disconnected"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dot ok={health.render.ok} />
              <span className="text-sm">Render Webhook</span>
            </div>
            <span className="text-xs text-tv-text-dim">
              {health.render.ok
                ? health.render.status || "OK"
                : "Disconnected"}
            </span>
          </div>

          <div className="pt-2 border-t border-tv-border">
            <span className="text-xs text-tv-text-dim">
              Last check:{" "}
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
