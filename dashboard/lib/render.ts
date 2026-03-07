/**
 * Render Events API client (server-side only).
 *
 * Proxies requests to the Render-hosted webhook service
 * that receives TradingView alerts.
 */

import type { TVEvent } from "./types";

const RENDER_URL =
  process.env.RENDER_WEBHOOK_URL ||
  "https://trading-agent-v1-codex.onrender.com";

// ── Events ──────────────────────────────────────────────────────────────────

export async function getEvents(
  limit: number = 50,
  setup_id?: string
): Promise<TVEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (setup_id) params.set("setup_id", setup_id);

  const res = await fetch(`${RENDER_URL}/events?${params}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Render ${res.status}: ${text}`);
  }

  const data = await res.json();
  // Render returns { ok, count, events: [...] }
  const raw: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : data.events ?? [];

  // Flatten payload fields to top level so components can access e.symbol, e.bias, etc.
  return raw.map((evt) => {
    const payload =
      (evt.payload as Record<string, unknown>) ?? {};
    return {
      ...evt,
      // Hoist commonly accessed fields from payload to top level
      symbol: (evt.symbol as string) ?? (payload.symbol as string) ?? undefined,
      bias: (evt.bias as string) ?? (payload.bias as string) ?? undefined,
      confluence:
        (evt.confluence as string) ??
        (payload.confluence as string) ??
        undefined,
      // Keep the full payload for the detail view
      payload,
    } as TVEvent;
  });
}

export async function getLatestEvent(): Promise<TVEvent | null> {
  const res = await fetch(`${RENDER_URL}/events/latest`, {
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`Render ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data ?? null;
}

// ── Health ───────────────────────────────────────────────────────────────────

export async function checkRenderHealth(): Promise<{
  ok: boolean;
  status?: string;
  uptime?: number;
}> {
  try {
    const res = await fetch(`${RENDER_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, status: data.status, uptime: data.uptime };
  } catch {
    return { ok: false };
  }
}
