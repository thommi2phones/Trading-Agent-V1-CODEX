#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  normalizePayload,
  validatePayload,
  inferMismatchFlags,
  buildAgentPacket
} = require("../lib/packet");

const fixturePath = path.join(__dirname, "..", "docs", "webhook_payload_example.json");
const goldenPath = path.join(__dirname, "..", "tests", "fixtures", "agent_packet_golden.json");

function run() {
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const payload = normalizePayload(raw);
  const missing = validatePayload(payload);
  const mismatch_flags = inferMismatchFlags(payload);

  const event = {
    event_id: "parity-fixture",
    received_at: "2026-01-01T00:00:00.000Z",
    source: "tradingview",
    accepted: missing.length === 0,
    missing_fields: missing,
    mismatch_flags,
    payload
  };

  const agent_packet = buildAgentPacket(event);
  const snapshot = { event, agent_packet };

  if (!fs.existsSync(goldenPath)) {
    fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
    fs.writeFileSync(goldenPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`[parity] wrote initial golden: ${goldenPath}`);
    console.log("[parity] review and commit this file; subsequent runs will diff against it");
    return 0;
  }

  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const actualStr = JSON.stringify(snapshot, null, 2);
  const goldenStr = JSON.stringify(golden, null, 2);

  if (actualStr === goldenStr) {
    console.log("[parity] PASS — agent_packet matches golden snapshot");
    return 0;
  }

  console.error("[parity] FAIL — agent_packet differs from golden snapshot");
  console.error("--- golden ---");
  console.error(goldenStr);
  console.error("--- actual ---");
  console.error(actualStr);
  return 1;
}

process.exit(run());
