#!/usr/bin/env node
"use strict";

/**
 * mock_peer
 *
 * Minimal HTTP server that mimics a perception-bus peer — useful for
 * smoke-testing BUS_PEERS delivery end-to-end without standing up a
 * real sibling repo.
 *
 * Usage:
 *   node scripts/mock_peer.js [--port 8790] [--role reasoning]
 *   node scripts/mock_peer.js --port 8790 --log /tmp/peer.log
 *
 * Responds 200 {ok:true, acked:true, envelope_id} to every POST.
 * Stores the last N envelopes in memory and optionally appends each to
 * a log file as NDJSON.
 *
 * When imported (not run directly) exports { start(opts) } returning
 * { port, url, received, close } so tests can embed it.
 */

const http = require("http");
const fs = require("fs");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function start({ port = 0, role = "reasoning", logPath = null, max = 1000 } = {}) {
  const received = [];

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    }

    let body = "";
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "read_failed", detail: err.message }));
    }

    let envelope = null;
    try {
      envelope = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "not_json" }));
    }

    received.push(envelope);
    if (received.length > max) received.shift();
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify(envelope) + "\n", "utf8");
    }

    console.log(`[mock-peer] received envelope=${envelope.envelope_id || "?"} from=${envelope?.from_agent?.agent_role || "?"} to=${envelope?.to_agent_role || "?"}`);

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      acked: true,
      envelope_id: envelope.envelope_id || null,
      mock_role: role
    }));
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = addr.port;
      const url = `http://127.0.0.1:${actualPort}`;
      console.log(`[mock-peer] listening ${url} role=${role}${logPath ? ` log=${logPath}` : ""}`);
      resolve({
        port: actualPort,
        url,
        received,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

function parseArgs(argv) {
  const args = { port: 0, role: "reasoning", logPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--role") args.role = argv[++i];
    else if (a === "--log") args.logPath = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: mock_peer.js [--port N] [--role reasoning] [--log PATH]");
      process.exit(0);
    } else {
      console.error(`mock_peer: unknown arg '${a}'`);
      process.exit(2);
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

module.exports = { start };
