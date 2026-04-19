"use strict";

/**
 * macro_client
 *
 * Thin HTTP client for the macro-analyzer sibling repo. Implements the
 * contract documented at
 * https://github.com/thommi2phones/macro-analyzer/blob/main/docs/integration_with_trading_agent.md
 *
 * Contract schema: macro-analyzer integration_schema/macro_schema_v1.0.0.json
 * contract_version: "1.0.0".
 *
 * Graceful-degradation rules (mandated by the macro integration doc):
 *   - If MACRO_ANALYZER_URL is unset, this module is a silent no-op. Every
 *     exported function returns null.
 *   - Network errors, timeouts, 4xx, 5xx, and malformed JSON all return
 *     null. No exceptions propagate to callers.
 *   - Callers treat null as "macro view unavailable" and proceed
 *     unchanged.
 */

const MACRO_ANALYZER_URL = () => process.env.MACRO_ANALYZER_URL || "";
const MACRO_ANALYZER_BEARER = () => process.env.MACRO_ANALYZER_BEARER || "";
const MACRO_ANALYZER_TIMEOUT_MS = () => Number(process.env.MACRO_ANALYZER_TIMEOUT_MS || 3000);
const CONTRACT_VERSION = "1.0.0";

function isEnabled() {
  return !!MACRO_ANALYZER_URL();
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const bearer = MACRO_ANALYZER_BEARER();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

async function fetchMacroView({ asset, asset_class } = {}) {
  if (!isEnabled()) return null;
  if (!asset) return null;

  const base = MACRO_ANALYZER_URL().replace(/\/+$/, "");
  const url = new URL(`${base}/positioning/view`);
  url.searchParams.set("asset", String(asset));
  if (asset_class) url.searchParams.set("asset_class", String(asset_class));

  try {
    const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: authHeaders() }, MACRO_ANALYZER_TIMEOUT_MS());
    if (!res.ok) {
      console.warn(`[macro-client] fetchMacroView status=${res.status} asset=${asset}`);
      return null;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.warn(`[macro-client] fetchMacroView non_json asset=${asset} preview="${text.slice(0, 120)}"`);
      return null;
    }
  } catch (err) {
    console.warn(`[macro-client] fetchMacroView error asset=${asset} message="${err?.message || err}"`);
    return null;
  }
}

async function fetchRegime() {
  if (!isEnabled()) return null;

  const base = MACRO_ANALYZER_URL().replace(/\/+$/, "");
  const url = `${base}/positioning/regime`;

  try {
    const res = await fetchWithTimeout(url, { method: "GET", headers: authHeaders() }, MACRO_ANALYZER_TIMEOUT_MS());
    if (!res.ok) {
      console.warn(`[macro-client] fetchRegime status=${res.status}`);
      return null;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.warn(`[macro-client] fetchRegime non_json preview="${text.slice(0, 120)}"`);
      return null;
    }
  } catch (err) {
    console.warn(`[macro-client] fetchRegime error message="${err?.message || err}"`);
    return null;
  }
}

async function postTradeOutcome(report) {
  if (!isEnabled()) return null;
  if (!report || typeof report !== "object") return null;

  const base = MACRO_ANALYZER_URL().replace(/\/+$/, "");
  const url = `${base}/source-scoring/outcome`;

  const body = {
    contract_version: CONTRACT_VERSION,
    ...report
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body)
    }, MACRO_ANALYZER_TIMEOUT_MS());
    if (!res.ok) {
      console.warn(`[macro-client] postTradeOutcome status=${res.status} trade_id=${report.trade_id}`);
      return null;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (err) {
    console.warn(`[macro-client] postTradeOutcome error trade_id=${report.trade_id} message="${err?.message || err}"`);
    return null;
  }
}

module.exports = {
  CONTRACT_VERSION,
  isEnabled,
  fetchMacroView,
  fetchRegime,
  postTradeOutcome
};
