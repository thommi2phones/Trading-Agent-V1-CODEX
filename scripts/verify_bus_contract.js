#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-test-"));
process.env.BUS_DIR = tempDir;
delete process.env.BUS_PEERS;
delete process.env.MACRO_API_URL;

const {
  ENVELOPE_VERSION,
  buildEnvelope,
  dropToInbox,
  dropToOutbox,
  readInboxFor,
  moveEnvelope,
  ensureBusDirs
} = require("../lib/agent_bus");

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  ensureBusDirs();

  console.log("[bus-contract] envelope construction");
  const reqEnv = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "ta_charts",
    request_type: "multi_tf_scan",
    symbol: "BTCUSD",
    timeframes: ["1d", "1w"],
    context: { macro_regime: "risk_off", why: "DXY breakout" }
  });

  check("envelope_version is '1'", reqEnv.envelope_version === ENVELOPE_VERSION);
  check("direction inbound", reqEnv.direction === "inbound");
  check("envelope_id starts with REQ-", reqEnv.envelope_id.startsWith("REQ-"));
  check("from_agent intact", deepEqual(reqEnv.from_agent, { agent_id: "reasoner_v1", agent_role: "reasoning" }));
  check("to_agent_role set", reqEnv.to_agent_role === "ta_charts");
  check("timeframes preserved", deepEqual(reqEnv.timeframes, ["1d", "1w"]));
  check("undefined fields stripped", !("payload" in reqEnv));

  console.log("[bus-contract] inbox round-trip with role filtering");
  const myFile = dropToInbox(reqEnv);
  check("inbox file created", fs.existsSync(myFile));

  // drop a noise envelope targeted at a different role
  const noise = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "macro_research",
    request_type: "regime_check"
  });
  dropToInbox(noise);

  const matches = readInboxFor("ta_charts");
  check("readInboxFor returns ta_charts envelope", matches.length === 1 && matches[0].envelope.envelope_id === reqEnv.envelope_id);

  const otherMatches = readInboxFor("macro_research");
  check("readInboxFor filters per role", otherMatches.length === 1 && otherMatches[0].envelope.to_agent_role === "macro_research");

  console.log("[bus-contract] processing → completed move");
  const processingPath = moveEnvelope(matches[0].filePath, "processing");
  check("moved to processing", fs.existsSync(processingPath) && !fs.existsSync(matches[0].filePath));

  const completedPath = moveEnvelope(processingPath, "completed");
  check("moved to completed", fs.existsSync(completedPath) && !fs.existsSync(processingPath));

  console.log("[bus-contract] outbox publish");
  const result = buildEnvelope({
    direction: "outbound",
    from_agent: { agent_id: "ta_charts_v1", agent_role: "ta_charts" },
    to_agent_role: "reasoning",
    reply_to_request_id: reqEnv.envelope_id,
    symbol: "BTCUSD",
    payload: {
      per_timeframe: [
        { timeframe: "1d", event_id: "evt-1", agent_packet: { source: "tv_direct_pine" }, decision: { action: "WAIT" } }
      ]
    }
  });
  const outPath = dropToOutbox(result);
  check("outbox file created", fs.existsSync(outPath));
  const reread = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check("outbox envelope round-trips", deepEqual(reread, result));
  check("envelope_id starts with ENV-", result.envelope_id.startsWith("ENV-"));
  check("reply_to_request_id preserved", result.reply_to_request_id === reqEnv.envelope_id);

  console.log("[bus-contract] negative cases");
  let threw = false;
  try {
    buildEnvelope({ direction: "sideways", from_agent: { agent_id: "x", agent_role: "y" }, to_agent_role: "z" });
  } catch {
    threw = true;
  }
  check("rejects invalid direction", threw);

  threw = false;
  try {
    buildEnvelope({ direction: "inbound", from_agent: {}, to_agent_role: "z" });
  } catch {
    threw = true;
  }
  check("rejects malformed from_agent", threw);

  threw = false;
  try {
    buildEnvelope({ direction: "outbound", from_agent: { agent_id: "x", agent_role: "y" } });
  } catch {
    threw = true;
  }
  check("rejects missing to_agent_role", threw);

  console.log("");
  if (failures.length === 0) {
    console.log("[bus-contract] ALL CHECKS PASSED");
    fs.rmSync(tempDir, { recursive: true, force: true });
    return 0;
  }
  console.error(`[bus-contract] ${failures.length} CHECK(S) FAILED`);
  console.error(`[bus-contract] tempDir kept for inspection: ${tempDir}`);
  return 1;
}

process.exit(main());
