#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const DEFAULT_MEMORY_PATH = path.join(ROOT, "data", "trade_memory", "master_trade_memory.jsonl");
const DEFAULT_SCHEMA_PATH = path.join(ROOT, "data", "trade_memory", "trade_memory.schema.json");

function parseArgs(argv) {
  const args = { memoryPath: DEFAULT_MEMORY_PATH, schemaPath: DEFAULT_SCHEMA_PATH };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--memory") args.memoryPath = path.resolve(argv[++i]);
    else if (token === "--schema") args.schemaPath = path.resolve(argv[++i]);
    else if (token === "--json") args.inlineJson = argv[++i];
    else if (token === "--input") args.inputPath = path.resolve(argv[++i]);
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  console.log("Usage:");
  console.log("  node scripts/append_trade_memory.js --json '<record_json>'");
  console.log("  node scripts/append_trade_memory.js --input /abs/path/record.json");
  console.log("");
  console.log("Optional:");
  console.log("  --memory /abs/path/master_trade_memory.jsonl");
  console.log("  --schema /abs/path/trade_memory.schema.json");
}

function readInput(args) {
  if (args.inlineJson) return JSON.parse(args.inlineJson);
  if (args.inputPath) return JSON.parse(fs.readFileSync(args.inputPath, "utf8"));
  throw new Error("Provide one input source: --json or --input");
}

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && value.includes("T") && value.endsWith("Z");
}

function assertEnum(field, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
}

function assertNumber(field, value, allowNull = false) {
  if (allowNull && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number${allowNull ? " or null" : ""}`);
  }
}

function assertString(field, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertStringArray(field, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${field} must contain non-empty strings`);
    }
  }
}

function validateRecord(record, schema) {
  const required = schema.required || [];
  for (const key of required) {
    if (!(key in record)) throw new Error(`Missing required field: ${key}`);
  }

  assertString("record_id", record.record_id);
  if (!isIsoDate(record.created_at)) throw new Error("created_at must be ISO-8601 UTC (e.g. 2026-03-07T12:34:56Z)");
  assertString("setup_id", record.setup_id);
  assertString("symbol", record.symbol);
  assertString("timeframe", record.timeframe);
  assertString("pattern", record.pattern);
  assertString("regime", record.regime);
  assertString("image_ref", record.image_ref);
  assertEnum("agent_bias", record.agent_bias, ["BULLISH", "BEARISH", "NEUTRAL"]);
  assertEnum("trade_grade", record.trade_grade, ["A", "B", "C", "D", "F"]);
  assertStringArray("recommendations", record.recommendations);
  assertNumber("entry", record.entry);
  assertNumber("stop", record.stop);
  assertNumber("tp1", record.tp1, true);
  assertNumber("tp2", record.tp2, true);
  assertNumber("tp3", record.tp3, true);
  assertEnum("actual_outcome", record.actual_outcome, ["pending", "win", "loss", "invalidated", "breakeven", "no_trade"]);
  assertNumber("rr_realized", record.rr_realized, true);
  if (record.post_trade_notes !== null && record.post_trade_notes !== undefined) {
    assertString("post_trade_notes", record.post_trade_notes);
  }
  assertStringArray("lessons", record.lessons);
}

function recordDigest(record) {
  return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 12);
}

function appendRecord(memoryPath, record) {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.appendFileSync(memoryPath, `${JSON.stringify(record)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const schema = loadSchema(args.schemaPath);
  const record = readInput(args);
  validateRecord(record, schema);
  appendRecord(args.memoryPath, record);
  console.log(`appended_record=${record.record_id} digest=${recordDigest(record)} memory=${args.memoryPath}`);
}

try {
  main();
} catch (err) {
  console.error(`append_trade_memory_failed: ${err.message}`);
  process.exit(1);
}
