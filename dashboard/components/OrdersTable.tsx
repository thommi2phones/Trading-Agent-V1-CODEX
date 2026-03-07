"use client";

import { useEffect, useState } from "react";
import type { AlpacaOrder } from "@/lib/types";

function fmtUsd(n: string | number | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

interface Props {
  status?: string;
  limit?: number;
  refreshKey?: number;
}

export default function OrdersTable({
  status = "all",
  limit = 20,
  refreshKey = 0,
}: Props) {
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      const res = await fetch(
        `/api/orders?status=${status}&limit=${limit}`
      );
      if (!res.ok) throw new Error("Failed");
      setOrders(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [status, limit, refreshKey]);

  useEffect(() => {
    const id = setInterval(fetchOrders, 30000);
    return () => clearInterval(id);
  }, [status, limit]);

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try {
      await fetch(`/api/orders/${id}`, { method: "DELETE" });
      await fetchOrders();
    } finally {
      setCancelling(null);
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "filled":
        return "text-tv-green";
      case "canceled":
      case "expired":
        return "text-tv-text-dim";
      case "new":
      case "accepted":
      case "pending_new":
        return "text-tv-blue";
      case "partially_filled":
        return "text-tv-orange";
      default:
        return "text-tv-text-dim";
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

  return (
    <div className="bg-tv-surface border border-tv-border rounded-xl p-5 overflow-x-auto">
      <h3 className="text-sm font-medium text-tv-text-dim mb-3">
        Orders ({orders.length})
      </h3>
      {orders.length === 0 ? (
        <p className="text-sm text-tv-text-dim">No orders</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-tv-text-dim text-xs border-b border-tv-border">
              <th className="text-left pb-2 font-medium">Symbol</th>
              <th className="text-left pb-2 font-medium">Side</th>
              <th className="text-left pb-2 font-medium">Type</th>
              <th className="text-right pb-2 font-medium">Qty</th>
              <th className="text-right pb-2 font-medium">Price</th>
              <th className="text-left pb-2 font-medium">Status</th>
              <th className="text-right pb-2 font-medium">Time</th>
              <th className="text-right pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const isOpen = [
                "new",
                "accepted",
                "pending_new",
                "partially_filled",
              ].includes(o.status);
              return (
                <tr
                  key={o.id}
                  className="border-b border-tv-border/50 last:border-0"
                >
                  <td className="py-2 font-medium">{o.symbol}</td>
                  <td
                    className={`py-2 ${
                      o.side === "buy" ? "text-tv-green" : "text-tv-red"
                    }`}
                  >
                    {o.side.toUpperCase()}
                  </td>
                  <td className="py-2 text-tv-text-dim">{o.type}</td>
                  <td className="py-2 text-right font-mono-numbers">
                    {o.filled_qty && o.filled_qty !== "0"
                      ? `${o.filled_qty}/${o.qty}`
                      : o.qty}
                  </td>
                  <td className="py-2 text-right font-mono-numbers">
                    {o.filled_avg_price
                      ? fmtUsd(o.filled_avg_price)
                      : o.limit_price
                      ? fmtUsd(o.limit_price)
                      : "MKT"}
                  </td>
                  <td className={`py-2 ${statusColor(o.status)}`}>
                    {o.status}
                  </td>
                  <td className="py-2 text-right text-xs text-tv-text-dim">
                    {o.submitted_at
                      ? new Date(o.submitted_at).toLocaleString()
                      : ""}
                  </td>
                  <td className="py-2 text-right">
                    {isOpen && (
                      <button
                        onClick={() => handleCancel(o.id)}
                        disabled={cancelling === o.id}
                        className="px-2 py-1 text-xs rounded bg-tv-red/20 text-tv-red hover:bg-tv-red/30 transition-colors disabled:opacity-50"
                      >
                        {cancelling === o.id ? "..." : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
