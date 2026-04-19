#!/usr/bin/env node
"use strict";

/**
 * mock_macro
 *
 * Minimal HTTP server mimicking the macro-analyzer endpoints defined in
 * https://github.com/thommi2phones/macro-analyzer/blob/main/docs/integration_with_trading_agent.md
 *
 *   GET  /positioning/view?asset={ticker}&asset_class={class}
 *   GET  /positioning/regime
 *   POST /source-scoring/outcome
 *
 * Intended for local smoke tests of lib/macro_client and the macro gate
 * wiring — NOT a stand-in for the real macro-analyzer. Views are
 * deterministic per-asset so tests can assert gate outcomes.
 *
 * Usage (CLI):
 *   node scripts/mock_macro.js [--port 8791]
 *
 * Usage (embedded in a test):
 *   const mock = require("./scripts/mock_macro");
 *   const server = await mock.start({ port: 0, views: { AAPL: {...} } });
 */

const http = require("http");
const { URL } = require("url");

function defaultViewFor(asset, assetClass) {
  // Deterministic stub. Real macro-analyzer synthesizes from theses.
  const bullishAssets = new Set(["BTCUSDT", "BTC", "GLD", "SLV", "CL", "GC"]);
  const bearishAssets = new Set(["SPY", "QQQ", "AAPL", "TSLA"]);
  const direction = bullishAssets.has(asset) ? "bullish"
    : bearishAssets.has(asset) ? "bearish"
    : "unknown";

  return {
    contract_version: "1.0.0",
    asset,
    asset_class: assetClass || "",
    direction,
    confidence: direction === "unknown" ? 0 : 0.65,
    horizon: "2-8 weeks",
    source_theses: direction === "unknown" ? [] : [`thesis_${asset.toLowerCase()}_1`],
    regime: "mock-regime",
    last_updated: new Date().toISOString(),
    gate_suggestion: {
      allow_long: direction !== "bearish",
      allow_short: direction !== "bullish",
      size_multiplier: 1.0,
      notes: direction === "unknown" ? "" : `Mock ${direction} view for ${asset}`
    }
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function start({ port = 0, views = {}, outcomes = [], regime = { regime: "mock-regime" } } = {}) {
  const received = { views: [], outcomes: [], regime: [] };
  const regimeState = { current: regime };

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && parsed.pathname === "/positioning/view") {
      const asset = parsed.searchParams.get("asset") || "";
      const assetClass = parsed.searchParams.get("asset_class") || "";
      const override = views[asset];
      const view = override || defaultViewFor(asset, assetClass);
      received.views.push({ asset, asset_class: assetClass, ts: new Date().toISOString() });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(view));
    }

    if (req.method === "GET" && parsed.pathname === "/positioning/regime") {
      received.regime.push({ ts: new Date().toISOString() });
      const body = {
        regime: regimeState.current.regime || "mock-regime",
        last_updated: regimeState.current.last_updated || new Date().toISOString()
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    if (req.method === "POST" && parsed.pathname === "/source-scoring/outcome") {
      const body = await readBody(req);
      let report = null;
      try {
        report = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ recorded: false, error: "not_json" }));
      }
      received.outcomes.push(report);
      outcomes.push(report);

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        recorded: true,
        sources_credited: ["mock-source"],
        source_weights_updated: { "mock-source": { old: 0.5, new: 0.51 } }
      }));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      const url = `http://127.0.0.1:${actualPort}`;
      console.log(`[mock-macro] listening ${url}`);
      resolve({
        url,
        port: actualPort,
        received,
        outcomes,
        setRegime: (regime, last_updated) => {
          regimeState.current = { regime, last_updated: last_updated || new Date().toISOString() };
        },
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

function parseArgs(argv) {
  const args = { port: 8791 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: mock_macro.js [--port N]");
      process.exit(0);
    }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  start(args).then(() => {
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  });
}

module.exports = { start, defaultViewFor };
