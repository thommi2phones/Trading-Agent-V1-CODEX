#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const DEFAULT_MEMORY_PATH = path.join(ROOT, "data", "trade_memory", "master_trade_memory.jsonl");
const DEFAULT_STATE_PATH = path.join(ROOT, "data", "trade_memory", "vector_sync_state.json");
const API_BASE = "https://api.openai.com/v1";

function parseArgs(argv) {
  const args = { memoryPath: DEFAULT_MEMORY_PATH, statePath: DEFAULT_STATE_PATH, cleanupStale: true };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--memory") args.memoryPath = path.resolve(argv[++i]);
    else if (token === "--state") args.statePath = path.resolve(argv[++i]);
    else if (token === "--no-cleanup") args.cleanupStale = false;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  console.log("Usage: node scripts/sync_vector_store.js [--memory <path>] [--state <path>] [--no-cleanup]");
  console.log("Required env:");
  console.log("  OPENAI_API_KEY");
  console.log("  OPENAI_VECTOR_STORE_ID");
}

function sha256File(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) return {};
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function apiJson(method, endpoint, apiKey, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`OpenAI ${method} ${endpoint} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function uploadFile(apiKey, filePath) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: "application/json" });
  const base = path.basename(filePath);
  const uploadName = base.endsWith(".jsonl") ? `${base.slice(0, -6)}.json` : base;
  form.append("file", blob, uploadName);
  form.append("purpose", "assistants");

  const res = await fetch(`${API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`OpenAI POST /files failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function waitForBatch(apiKey, vectorStoreId, batchId, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const batch = await apiJson("GET", `/vector_stores/${vectorStoreId}/file_batches/${batchId}`, apiKey);
    if (batch.status === "completed") return batch;
    if (batch.status === "failed" || batch.status === "cancelled") {
      throw new Error(`Batch ${batchId} ended with status=${batch.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Batch ${batchId} timed out`);
}

async function listVectorStoreFiles(apiKey, vectorStoreId) {
  const page = await apiJson("GET", `/vector_stores/${vectorStoreId}/files?limit=100`, apiKey);
  return Array.isArray(page.data) ? page.data : [];
}

async function cleanupStaleVectorFiles(apiKey, vectorStoreId, keepFileId) {
  const files = await listVectorStoreFiles(apiKey, vectorStoreId);
  const stale = files.filter((f) => f.file_id !== keepFileId);
  for (const item of stale) {
    await apiJson("DELETE", `/vector_stores/${vectorStoreId}/files/${item.id}`, apiKey);
  }
  return stale.length;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY || "";
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID || "";
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  if (!vectorStoreId) throw new Error("Missing OPENAI_VECTOR_STORE_ID");
  if (!fs.existsSync(args.memoryPath)) throw new Error(`Memory file not found: ${args.memoryPath}`);

  const currentHash = sha256File(args.memoryPath);
  const state = loadState(args.statePath);
  if (state.last_sha256 && state.last_sha256 === currentHash) {
    console.log(`no_changes_detected sha256=${currentHash}`);
    return;
  }

  const uploaded = await uploadFile(apiKey, args.memoryPath);
  const fileId = uploaded.id;
  console.log(`uploaded_file_id=${fileId}`);

  const batch = await apiJson("POST", `/vector_stores/${vectorStoreId}/file_batches`, apiKey, { file_ids: [fileId] });
  console.log(`batch_id=${batch.id} status=${batch.status}`);

  await waitForBatch(apiKey, vectorStoreId, batch.id);
  console.log("batch_status=completed");

  let removed = 0;
  if (args.cleanupStale) {
    removed = await cleanupStaleVectorFiles(apiKey, vectorStoreId, fileId);
    console.log(`stale_vector_files_removed=${removed}`);
  }

  saveState(args.statePath, {
    synced_at: new Date().toISOString(),
    vector_store_id: vectorStoreId,
    current_file_id: fileId,
    last_sha256: currentHash,
    stale_removed: removed
  });

  console.log(`sync_complete file_id=${fileId} sha256=${currentHash}`);
}

main().catch((err) => {
  console.error(`sync_vector_store_failed: ${err.message}`);
  process.exit(1);
});
