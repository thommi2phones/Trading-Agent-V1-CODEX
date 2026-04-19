#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bus-watcher-test-"));
const tempBus = path.join(tempRoot, "coordination", "bus");
fs.mkdirSync(tempBus, { recursive: true });
fs.mkdirSync(path.join(tempRoot, "webhook", "data"), { recursive: true });

process.env.BUS_DIR = tempBus;
process.env.TV_DIRECT_PUBLISH = "1";

const originalCwd = process.cwd();
process.chdir(tempRoot);

const fixturePath = path.join(originalCwd, "docs", "webhook_payload_example.json");

const { buildEnvelope, dropToInbox } = require(path.join(originalCwd, "lib", "agent_bus"));
const { scanOnce } = require(path.join(originalCwd, "scripts", "bus_watcher"));
const mockPeer = require(path.join(originalCwd, "scripts", "mock_peer"));

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

function listJson(dir) {
  const full = path.join(tempBus, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((n) => n.endsWith(".json"));
}

async function main() {
  console.log("[bus-watcher-test] starting mock peer");
  const peer = await mockPeer.start({ port: 0, role: "reasoning" });
  process.env.BUS_PEERS = JSON.stringify({ reasoning: peer.url });

  console.log("[bus-watcher-test] case 1: auto-ingest (embedded pine_snapshot)");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const autoReq = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "ta_charts",
    request_type: "chart_check",
    symbol: fixture.symbol,
    timeframes: [fixture.timeframe],
    payload: { pine_snapshot: fixture }
  });
  dropToInbox(autoReq);

  const outcomes1 = await scanOnce({ role: "ta_charts", requirePayload: false });
  check("case 1: one outcome", outcomes1.length === 1);
  check("case 1: outcome kind auto_ingest", outcomes1[0]?.kind === "auto_ingest");
  check("case 1: request moved to completed/", listJson("completed").length === 1);
  check("case 1: request gone from inbox/", listJson("inbox").length === 0);
  check("case 1: response in outbox/", listJson("outbox").length === 1);

  // Wait briefly for mock-peer to log the POST (publish is awaited inside tv_direct)
  check("case 1: mock peer received envelope", peer.received.length === 1);
  if (peer.received.length === 1) {
    const env = peer.received[0];
    check("case 1: peer got outbound direction", env.direction === "outbound");
    check("case 1: peer got reply_to_request_id", env.reply_to_request_id === autoReq.envelope_id);
    check("case 1: peer got decision", !!env?.payload?.per_timeframe?.[0]?.decision);
  }

  // clear outbox + completed so next case is independent
  for (const f of listJson("outbox")) fs.unlinkSync(path.join(tempBus, "outbox", f));
  for (const f of listJson("completed")) fs.unlinkSync(path.join(tempBus, "completed", f));
  peer.received.length = 0;

  console.log("[bus-watcher-test] case 2: role filtering (non-matching role ignored)");
  const nonMatch = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "macro_research",
    request_type: "regime_check"
  });
  dropToInbox(nonMatch);
  const outcomes2 = await scanOnce({ role: "ta_charts", requirePayload: false });
  check("case 2: no outcomes for non-matching role", outcomes2.length === 0);
  check("case 2: non-matching envelope still in inbox/", listJson("inbox").length === 1);

  // clean the non-match for the next case
  for (const f of listJson("inbox")) fs.unlinkSync(path.join(tempBus, "inbox", f));

  console.log("[bus-watcher-test] case 3: require-payload fails live-read requests");
  const liveReadReq = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "ta_charts",
    request_type: "multi_tf_scan",
    symbol: "BTCUSD",
    timeframes: ["1d", "1w"]
    // no payload -> would normally queue for Claude; with --require-payload must fail
  });
  dropToInbox(liveReadReq);

  const outcomes3 = await scanOnce({ role: "ta_charts", requirePayload: true });
  check("case 3: one outcome", outcomes3.length === 1);
  check("case 3: outcome kind failed", outcomes3[0]?.kind === "failed");
  check("case 3: reason mentions needs_live_read", typeof outcomes3[0]?.reason === "string" && outcomes3[0].reason.includes("needs_live_read"));
  check("case 3: request moved to failed/", listJson("failed").length === 1);
  check("case 3: err sibling written", listJson("failed").some((n) => n.endsWith(".json")) && fs.readdirSync(path.join(tempBus, "failed")).some((n) => n.endsWith(".err.txt")));

  // clean
  for (const f of fs.readdirSync(path.join(tempBus, "failed"))) fs.unlinkSync(path.join(tempBus, "failed", f));

  console.log("[bus-watcher-test] case 4: queue-for-claude (no --require-payload)");
  const queueReq = buildEnvelope({
    direction: "inbound",
    from_agent: { agent_id: "reasoner_v1", agent_role: "reasoning" },
    to_agent_role: "ta_charts",
    request_type: "chart_check",
    symbol: "ETHUSD",
    timeframes: ["1d"]
  });
  dropToInbox(queueReq);

  const outcomes4 = await scanOnce({ role: "ta_charts", requirePayload: false });
  check("case 4: outcome kind queued_for_claude", outcomes4[0]?.kind === "queued_for_claude");
  check("case 4: marker written to tv_direct/pending/", fs.existsSync(path.join(tempRoot, "tv_direct", "pending", `${queueReq.envelope_id}.json`)));
  check("case 4: request stays in processing/", listJson("processing").length === 1);

  await peer.close();
  process.chdir(originalCwd);

  console.log("");
  if (failures.length === 0) {
    console.log("[bus-watcher-test] ALL CHECKS PASSED");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return 0;
  }
  console.error(`[bus-watcher-test] ${failures.length} CHECK(S) FAILED`);
  console.error(`[bus-watcher-test] tempRoot kept for inspection: ${tempRoot}`);
  return 1;
}

main().then((code) => process.exit(code));
