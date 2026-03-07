"use client";

import { useEffect, useState } from "react";
import type { AlpacaAccount } from "@/lib/types";

function fmt(n: number | string) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function pct(n: number | string) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function AccountCard() {
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAccount = async () => {
    try {
      const res = await fetch("/api/account");
      if (!res.ok) throw new Error("Failed to fetch account");
      setAccount(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  useEffect(() => {
    fetchAccount();
    const id = setInterval(fetchAccount, 30000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-tv-text-dim mb-2">Account</h3>
        <p className="text-tv-red text-sm">{error}</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="bg-tv-surface border border-tv-border rounded-xl p-5 animate-pulse">
        <h3 className="text-sm font-medium text-tv-text-dim mb-4">Account</h3>
        <div className="space-y-3">
          <div className="h-8 bg-tv-border rounded w-40" />
          <div className="h-4 bg-tv-border rounded w-24" />
        </div>
      </div>
    );
  }

  const equity = parseFloat(account.equity);
  const lastEquity = parseFloat(account.last_equity);
  const dayPl = equity - lastEquity;
  const dayPct = lastEquity > 0 ? (dayPl / lastEquity) * 100 : 0;
  const isUp = dayPl >= 0;

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-tv-text-dim">Account</h3>
        <span className="text-xs text-tv-text-dim uppercase">
          {account.status}
        </span>
      </div>

      <div className="font-mono-numbers text-2xl font-bold mb-1">
        {fmt(equity)}
      </div>
      <div
        className={`font-mono-numbers text-sm ${
          isUp ? "text-tv-green" : "text-tv-red"
        }`}
      >
        {isUp ? "+" : ""}
        {fmt(dayPl)} ({pct(dayPct)}) today
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-tv-border">
        <div>
          <div className="text-xs text-tv-text-dim">Buying Power</div>
          <div className="font-mono-numbers text-sm font-medium mt-0.5">
            {fmt(account.buying_power)}
          </div>
        </div>
        <div>
          <div className="text-xs text-tv-text-dim">Cash</div>
          <div className="font-mono-numbers text-sm font-medium mt-0.5">
            {fmt(account.cash)}
          </div>
        </div>
        <div>
          <div className="text-xs text-tv-text-dim">Long Value</div>
          <div className="font-mono-numbers text-sm font-medium mt-0.5">
            {fmt(account.long_market_value)}
          </div>
        </div>
        <div>
          <div className="text-xs text-tv-text-dim">Short Value</div>
          <div className="font-mono-numbers text-sm font-medium mt-0.5">
            {fmt(account.short_market_value)}
          </div>
        </div>
      </div>
    </div>
  );
}
