"use strict";

/**
 * asset_class
 *
 * Starter symbol -> asset_class mapper for the macro-analyzer integration.
 * The macro-analyzer accepts `asset_class` as a hint on GET /positioning/view
 * and keys its views/theses by the same vocabulary.
 *
 * Vocabulary (matches macro-analyzer schema v1.0.0):
 *   "crypto" | "equities" | "commodities" | "rates" | "fx" | "credit"
 *
 * Unknown symbols return null. Callers (lib/macro_decision.js) simply omit
 * the asset_class query param when null — the macro-analyzer handles that
 * case.
 *
 * Expected to grow as macro-analyzer surfaces new trusted tickers from its
 * theses (commodities curve names, more fx crosses, high-yield ETFs, etc.).
 * Prefer explicit entries over heuristics so mismatches stay debuggable.
 */

const CRYPTO_TICKERS = new Set([
  "BTC", "BTCUSD", "BTCUSDT", "BTCUSDC",
  "ETH", "ETHUSD", "ETHUSDT", "ETHUSDC",
  "SOL", "SOLUSD", "SOLUSDT",
  "BNB", "BNBUSDT",
  "XRP", "XRPUSDT",
  "ADA", "ADAUSDT",
  "DOGE", "DOGEUSDT",
  "AVAX", "AVAXUSDT",
  "LINK", "LINKUSDT",
  "MATIC", "MATICUSDT",
  "LTC", "LTCUSDT"
]);

const EQUITY_TICKERS = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO",
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "GOOG",
  "NFLX", "AMD", "INTC", "JPM", "BAC", "WMT"
]);

const COMMODITY_TICKERS = new Set([
  "GLD", "SLV", "USO", "UNG", "DBC", "DBA",
  "CL", "GC", "SI", "HG", "NG",
  "ZC", "ZS", "ZW",
  "GOLD", "SILVER", "OIL", "COPPER"
]);

const RATES_TICKERS = new Set([
  "TLT", "IEF", "SHY", "TBT", "ZB", "ZN",
  "US10Y", "US02Y", "US30Y"
]);

const FX_TICKERS = new Set([
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "NZDUSD", "USDCHF",
  "EURGBP", "EURJPY", "GBPJPY",
  "DXY", "USDX"
]);

const CREDIT_TICKERS = new Set([
  "HYG", "LQD", "JNK", "EMB"
]);

const STABLE_SUFFIXES = ["USDT", "USDC", "BUSD", "DAI", "TUSD"];

function normalize(symbol) {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol.trim().toUpperCase();
}

function getAssetClass(symbol) {
  const s = normalize(symbol);
  if (!s) return null;

  if (CRYPTO_TICKERS.has(s)) return "crypto";
  if (EQUITY_TICKERS.has(s)) return "equities";
  if (COMMODITY_TICKERS.has(s)) return "commodities";
  if (RATES_TICKERS.has(s)) return "rates";
  if (FX_TICKERS.has(s)) return "fx";
  if (CREDIT_TICKERS.has(s)) return "credit";

  for (const suffix of STABLE_SUFFIXES) {
    if (s.length > suffix.length && s.endsWith(suffix)) return "crypto";
  }

  return null;
}

module.exports = { getAssetClass };
