/**
 * Alpaca REST API client (server-side only).
 *
 * Uses paper trading credentials from environment variables.
 */

import type {
  AlpacaAccount,
  AlpacaPosition,
  AlpacaOrder,
  OrderRequest,
} from "./types";

const BASE_URL =
  process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const API_KEY = process.env.ALPACA_API_KEY || "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";

const headers = {
  "APCA-API-KEY-ID": API_KEY,
  "APCA-API-SECRET-KEY": SECRET_KEY,
  "Content-Type": "application/json",
};

async function alpacaFetch<T>(
  path: string,
  options: RequestInit = {},
  base: string = BASE_URL
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Account ─────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaFetch<AlpacaAccount>("/v2/account");
}

// ── Positions ───────────────────────────────────────────────────────────────

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaFetch<AlpacaPosition[]>("/v2/positions");
}

export async function getPosition(symbol: string): Promise<AlpacaPosition> {
  return alpacaFetch<AlpacaPosition>(
    `/v2/positions/${encodeURIComponent(symbol)}`
  );
}

export async function closePosition(
  symbol: string,
  qty?: string,
  percentage?: string
): Promise<AlpacaOrder> {
  const params = new URLSearchParams();
  if (qty) params.set("qty", qty);
  if (percentage) params.set("percentage", percentage);
  const qs = params.toString() ? `?${params.toString()}` : "";

  return alpacaFetch<AlpacaOrder>(
    `/v2/positions/${encodeURIComponent(symbol)}${qs}`,
    { method: "DELETE" }
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────

export async function getOrders(
  status: string = "all",
  limit: number = 20
): Promise<AlpacaOrder[]> {
  return alpacaFetch<AlpacaOrder[]>(
    `/v2/orders?status=${status}&limit=${limit}&direction=desc`
  );
}

export async function placeOrder(order: OrderRequest): Promise<AlpacaOrder> {
  return alpacaFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpacaFetch<void>(`/v2/orders/${orderId}`, { method: "DELETE" });
}

// ── Market Data ─────────────────────────────────────────────────────────────

export async function getLatestQuotes(
  symbols: string[]
): Promise<Record<string, { ap: number; as: number; bp: number; bs: number; t: string }>> {
  const params = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
  const data = await alpacaFetch<{
    quotes: Record<string, { ap: number; as: number; bp: number; bs: number; t: string }>;
  }>(`/v2/stocks/quotes/latest?${params}&feed=iex`, {}, DATA_URL);
  return data.quotes;
}

// ── Health Check ────────────────────────────────────────────────────────────

export async function checkAlpacaHealth(): Promise<{
  ok: boolean;
  account_id?: string;
  status?: string;
}> {
  try {
    const acc = await getAccount();
    return { ok: true, account_id: acc.id, status: acc.status };
  } catch {
    return { ok: false };
  }
}
