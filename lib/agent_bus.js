"use strict";

const fs = require("fs");
const path = require("path");

const ENVELOPE_VERSION = "1";

const workspaceRoot = process.cwd();
const defaultBusDir = path.join(workspaceRoot, "coordination", "bus");

function busDir() {
  return process.env.BUS_DIR || defaultBusDir;
}

function ensureBusDirs() {
  const root = busDir();
  for (const sub of ["inbox", "outbox", "processing", "completed", "failed", "archive"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

function isoNow() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEnvelope({
  direction,
  from_agent,
  to_agent_role,
  request_type,
  reply_to_request_id,
  reply_to_envelope_id,
  symbol,
  timeframes,
  context,
  payload
}) {
  if (!direction || !["inbound", "outbound"].includes(direction)) {
    throw new Error("buildEnvelope: direction must be 'inbound' or 'outbound'");
  }
  if (!from_agent || !from_agent.agent_id || !from_agent.agent_role) {
    throw new Error("buildEnvelope: from_agent.{agent_id,agent_role} required");
  }
  if (!to_agent_role) {
    throw new Error("buildEnvelope: to_agent_role required");
  }

  const idPrefix = direction === "inbound" ? "REQ" : "ENV";
  return {
    envelope_version: ENVELOPE_VERSION,
    direction,
    envelope_id: newId(idPrefix),
    from_agent,
    to_agent_role,
    created_at: isoNow(),
    ...(request_type ? { request_type } : {}),
    ...(reply_to_request_id ? { reply_to_request_id } : {}),
    ...(reply_to_envelope_id ? { reply_to_envelope_id } : {}),
    ...(symbol ? { symbol } : {}),
    ...(Array.isArray(timeframes) ? { timeframes } : {}),
    ...(context ? { context } : {}),
    ...(payload ? { payload } : {})
  };
}

function envelopeFilename(envelope) {
  const safe = envelope.envelope_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${envelope.created_at.replace(/[:.]/g, "-")}_${safe}.json`;
}

function dropToOutbox(envelope) {
  const root = ensureBusDirs();
  const filePath = path.join(root, "outbox", envelopeFilename(envelope));
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  return filePath;
}

function dropToInbox(envelope) {
  const root = ensureBusDirs();
  const filePath = path.join(root, "inbox", envelopeFilename(envelope));
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  return filePath;
}

function moveEnvelope(srcPath, destSub) {
  const root = ensureBusDirs();
  const dest = path.join(root, destSub, path.basename(srcPath));
  fs.renameSync(srcPath, dest);
  return dest;
}

function readInboxFor(agentRole) {
  const root = ensureBusDirs();
  const inboxDir = path.join(root, "inbox");
  const entries = fs.readdirSync(inboxDir).filter((n) => n.endsWith(".json"));
  const matches = [];
  for (const name of entries) {
    const filePath = path.join(inboxDir, name);
    try {
      const env = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (env.to_agent_role === agentRole) {
        matches.push({ filePath, envelope: env });
      }
    } catch {
      // skip malformed; leave file in place for inspection
    }
  }
  return matches;
}

function parsePeerMap() {
  const raw = process.env.BUS_PEERS || "";
  if (!raw.trim()) {
    if (process.env.MACRO_API_URL) {
      return { reasoning: process.env.MACRO_API_URL };
    }
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function postToPeer(envelope) {
  const peers = parsePeerMap();
  const url = peers[envelope.to_agent_role];
  if (!url) return { posted: false, reason: "no_peer_for_role" };

  const headers = { "Content-Type": "application/json" };
  if (process.env.BUS_BEARER) {
    headers.Authorization = `Bearer ${process.env.BUS_BEARER}`;
  } else if (process.env.MACRO_API_BEARER && envelope.to_agent_role === "reasoning") {
    headers.Authorization = `Bearer ${process.env.MACRO_API_BEARER}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope)
    });
    const text = await res.text();
    return {
      posted: true,
      status: res.status,
      ok: res.ok,
      response: text.slice(0, 3000)
    };
  } catch (err) {
    return { posted: true, ok: false, error: err.message };
  }
}

async function publish(envelope) {
  const file = dropToOutbox(envelope);
  const http = await postToPeer(envelope);
  return { file, http };
}

module.exports = {
  ENVELOPE_VERSION,
  busDir,
  ensureBusDirs,
  buildEnvelope,
  envelopeFilename,
  dropToOutbox,
  dropToInbox,
  moveEnvelope,
  readInboxFor,
  postToPeer,
  publish
};
