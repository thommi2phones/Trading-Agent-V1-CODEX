#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tv-direct-test-"));
const tempBus = path.join(tempRoot, "bus");
const tempEvents = path.join(tempRoot, "events");
fs.mkdirSync(tempBus, { recursive: true });
fs.mkdirSync(tempEvents, { recursive: true });

process.env.BUS_DIR = tempBus;
process.env.TV_DIRECT_PUBLISH = "1";
delete process.env.BUS_PEERS;
delete process.env.MACRO_API_URL;

// events_store.js computes paths from process.cwd(); chdir to a temp dir so
// the test does not pollute the real webhook/data/.
const originalCwd = process.cwd();
process.chdir(tempRoot);
fs.mkdirSync(path.join(tempRoot, "webhook", "data"), { recursive: true });

const fixturePath = path.join(originalCwd, "docs", "webhook_payload_example.json");
const { captureChartSnapshot, ingest } = require(path.join(originalCwd, "tv_direct"));
const { buildEnvelope } = require(path.join(originalCwd, "lib", "agent_bus"));

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

function loadOnlyOutboxEnvelope() {
  const dir = path.join(tempBus, "outbox");
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  if (files.length !== 1) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
}

async function main() {
  console.log("[tv_direct] pine mode end-to-end (with full Pine fixture)");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const incomingReq = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "ta_charts",
    request_type: "chart_check",
    symbol: fixture.symbol,
    timeframes: [fixture.timeframe]
  });

  const pineResult = await captureChartSnapshot({
    mode: "pine",
    request_envelope: incomingReq,
    ...fixture
  });

  check("pine: event written", !!pineResult.event && !!pineResult.event.event_id);
  check("pine: agent_packet source = tv_direct_pine", pineResult.agent_packet.source === "tv_direct_pine");
  check("pine: accepted=true", pineResult.agent_packet.accepted === true);
  check("pine: decision present", !!pineResult.decision && !!pineResult.decision.action);
  check("pine: events.ndjson written", fs.existsSync(path.join(tempRoot, "webhook", "data", "events.ndjson")));
  check("pine: latest.json written", fs.existsSync(path.join(tempRoot, "webhook", "data", "latest.json")));

  const env = loadOnlyOutboxEnvelope();
  check("pine: exactly one outbox envelope", env !== null);
  check("pine: envelope is outbound", env?.direction === "outbound");
  check("pine: envelope from_agent.role = ta_charts", env?.from_agent?.agent_role === "ta_charts");
  check("pine: envelope to_agent_role = reasoning", env?.to_agent_role === "reasoning");
  check("pine: reply_to_request_id matches request", env?.reply_to_request_id === incomingReq.envelope_id);
  check("pine: payload.per_timeframe length 1", env?.payload?.per_timeframe?.length === 1);
  check("pine: payload includes agent_packet + decision",
    !!env?.payload?.per_timeframe?.[0]?.agent_packet && !!env?.payload?.per_timeframe?.[0]?.decision);

  // Clean outbox between cases for clean assertions
  for (const f of fs.readdirSync(path.join(tempBus, "outbox"))) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(tempBus, "outbox", f));
  }

  console.log("[tv_direct] raw mode end-to-end (stub)");
  const rawResult = await captureChartSnapshot({
    mode: "raw",
    symbol: "BTCUSD",
    timeframe: "1d",
    bar_time: "1734567890000",
    close: 65000,
    bars: [/* 1..N stub */ {}, {}, {}]
  });
  check("raw: agent_packet source = tv_direct_raw", rawResult.agent_packet.source === "tv_direct_raw");
  check("raw: accepted=false (intentional stub)", rawResult.agent_packet.accepted === false);
  check("raw: missing_fields populated", Array.isArray(rawResult.agent_packet.missing_fields) && rawResult.agent_packet.missing_fields.length > 0);
  check("raw: decision is BLOCKED", rawResult.decision?.risk_tier === "BLOCKED");

  for (const f of fs.readdirSync(path.join(tempBus, "outbox"))) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(tempBus, "outbox", f));
  }

  console.log("[tv_direct] ingest() injection path (full payload, no adapter)");
  const ingestResult = await ingest(fixture, { source: "tv_direct_pine" });
  check("ingest: source = tv_direct_pine", ingestResult.agent_packet.source === "tv_direct_pine");
  check("ingest: accepted=true", ingestResult.agent_packet.accepted === true);
  check("ingest: decision present", !!ingestResult.decision?.action);

  console.log("[tv_direct] negative cases");
  let threw = false;
  try {
    await captureChartSnapshot({ mode: "wat", symbol: "X", timeframe: "1d", bar_time: "0" });
  } catch {
    threw = true;
  }
  check("rejects unknown mode", threw);

  threw = false;
  try {
    await ingest(null, {});
  } catch {
    threw = true;
  }
  check("ingest rejects null payload", threw);

  threw = false;
  try {
    await ingest({}, { source: "wat" });
  } catch {
    threw = true;
  }
  check("ingest rejects unsupported source", threw);

  console.log("");
  process.chdir(originalCwd);
  if (failures.length === 0) {
    console.log("[tv_direct] ALL CHECKS PASSED");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return 0;
  }
  console.error(`[tv_direct] ${failures.length} CHECK(S) FAILED`);
  console.error(`[tv_direct] tempRoot kept for inspection: ${tempRoot}`);
  return 1;
}

main().then((code) => process.exit(code));
