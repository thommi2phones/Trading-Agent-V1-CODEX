"use client";

import { useState } from "react";

interface Props {
  /** Pre-fill symbol */
  defaultSymbol?: string;
  /** Pre-fill side */
  defaultSide?: "buy" | "sell";
  /** Pre-fill qty */
  defaultQty?: number;
  /** Pre-fill limit price */
  defaultLimitPrice?: number;
  /** Callback after order placed */
  onOrderPlaced?: () => void;
  /** Gate: if true, submit button is disabled (checklist incomplete) */
  locked?: boolean;
  /** Message to show when locked */
  lockReason?: string;
}

export default function OrderForm({
  defaultSymbol = "",
  defaultSide = "buy",
  defaultQty,
  defaultLimitPrice,
  onOrderPlaced,
  locked = false,
  lockReason,
}: Props) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [side, setSide] = useState<"buy" | "sell">(defaultSide);
  const [qty, setQty] = useState(defaultQty?.toString() || "");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState(
    defaultLimitPrice?.toString() || ""
  );
  const [timeInForce, setTimeInForce] = useState("day");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setSubmitting(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        symbol: symbol.toUpperCase(),
        side,
        type: orderType,
        time_in_force: timeInForce,
        qty: qty,
      };
      if (orderType === "limit" && limitPrice) {
        body.limit_price = limitPrice;
      }

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Order failed");
      }

      setResult({
        type: "success",
        message: `Order placed: ${data.side?.toUpperCase()} ${data.qty} ${data.symbol} (${data.status})`,
      });
      onOrderPlaced?.();
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : "Order failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = submitting || locked;

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5">
      <h3 className="text-sm font-medium text-tv-text-dim mb-4">
        Place Order
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Symbol */}
        <div>
          <label className="block text-xs text-tv-text-dim mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="AAPL"
            required
            className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue"
          />
        </div>

        {/* Side */}
        <div>
          <label className="block text-xs text-tv-text-dim mb-1">Side</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSide("buy")}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                side === "buy"
                  ? "bg-tv-green text-white"
                  : "bg-tv-border/40 text-tv-text-dim hover:text-tv-text"
              }`}
            >
              Buy / Long
            </button>
            <button
              type="button"
              onClick={() => setSide("sell")}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                side === "sell"
                  ? "bg-tv-red text-white"
                  : "bg-tv-border/40 text-tv-text-dim hover:text-tv-text"
              }`}
            >
              Sell / Short
            </button>
          </div>
        </div>

        {/* Qty + Order Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-tv-text-dim mb-1">
              Quantity
            </label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="1"
              required
              min="0.001"
              step="any"
              className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue font-mono-numbers"
            />
          </div>
          <div>
            <label className="block text-xs text-tv-text-dim mb-1">
              Order Type
            </label>
            <select
              value={orderType}
              onChange={(e) =>
                setOrderType(e.target.value as "market" | "limit")
              }
              className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text focus:outline-none focus:border-tv-blue"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </div>
        </div>

        {/* Limit price */}
        {orderType === "limit" && (
          <div>
            <label className="block text-xs text-tv-text-dim mb-1">
              Limit Price
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              required
              step="any"
              className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text placeholder:text-tv-text-dim focus:outline-none focus:border-tv-blue font-mono-numbers"
            />
          </div>
        )}

        {/* Time in force */}
        <div>
          <label className="block text-xs text-tv-text-dim mb-1">
            Time in Force
          </label>
          <select
            value={timeInForce}
            onChange={(e) => setTimeInForce(e.target.value)}
            className="w-full bg-tv-bg border border-tv-border rounded-lg px-3 py-2 text-sm text-tv-text focus:outline-none focus:border-tv-blue"
          >
            <option value="day">Day</option>
            <option value="gtc">GTC</option>
            <option value="ioc">IOC</option>
            <option value="fok">FOK</option>
          </select>
        </div>

        {/* Lock warning */}
        {locked && lockReason && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-tv-orange/10 border border-tv-orange/20">
            <svg
              className="w-4 h-4 text-tv-orange flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            <span className="text-xs text-tv-orange">{lockReason}</span>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isDisabled}
          className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors text-white ${
            isDisabled
              ? "bg-tv-border/60 cursor-not-allowed opacity-50"
              : side === "buy"
              ? "bg-tv-green hover:bg-tv-green/80"
              : "bg-tv-red hover:bg-tv-red/80"
          }`}
        >
          {submitting
            ? "Placing..."
            : locked
            ? "Complete checklist to trade"
            : `${side === "buy" ? "Buy" : "Sell"} ${symbol.toUpperCase() || "..."}`}
        </button>

        {/* Result */}
        {result && (
          <div
            className={`text-sm p-3 rounded-lg ${
              result.type === "success"
                ? "bg-tv-green/10 text-tv-green"
                : "bg-tv-red/10 text-tv-red"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>
    </div>
  );
}
