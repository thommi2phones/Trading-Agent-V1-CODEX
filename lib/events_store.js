"use strict";

const fs = require("fs");
const path = require("path");

const MAX_EVENTS_FILE_BYTES = Number(process.env.MAX_EVENTS_FILE_BYTES || 5_000_000);

const workspaceRoot = process.cwd();
const eventsDir = path.join(workspaceRoot, "webhook", "data");
const eventsPath = path.join(eventsDir, "events.ndjson");
const eventsBackupPath = path.join(eventsDir, "events.prev.ndjson");
const latestPath = path.join(eventsDir, "latest.json");

function ensureDataDir() {
  fs.mkdirSync(eventsDir, { recursive: true });
}

function rotateEventsIfNeeded() {
  if (!fs.existsSync(eventsPath)) return;
  const size = fs.statSync(eventsPath).size;
  if (size < MAX_EVENTS_FILE_BYTES) return;

  if (fs.existsSync(eventsBackupPath)) {
    fs.unlinkSync(eventsBackupPath);
  }
  fs.renameSync(eventsPath, eventsBackupPath);
}

function writeEvent(event) {
  ensureDataDir();
  rotateEventsIfNeeded();
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(event, null, 2), "utf8");
}

function parseNdjsonLines(raw) {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readRecentEvents(limit = 50, setupId = "") {
  if (!fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, "utf8");
  const events = parseNdjsonLines(raw);
  const filtered = setupId ? events.filter((e) => e?.payload?.setup_id === setupId) : events;
  return filtered.slice(-limit).reverse();
}

function ensureInboxDir(inboxDir) {
  if (!inboxDir) return;
  fs.mkdirSync(inboxDir, { recursive: true });
}

function writeAgentInbox(agentPacket, inboxDir) {
  if (!inboxDir) return null;
  ensureInboxDir(inboxDir);
  const safeSetup = agentPacket.setup_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const filename = `${Date.now()}_${safeSetup}.json`;
  const fullPath = path.join(inboxDir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(agentPacket, null, 2), "utf8");
  return fullPath;
}

function readLatestEvent() {
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, "utf8"));
}

module.exports = {
  MAX_EVENTS_FILE_BYTES,
  eventsDir,
  eventsPath,
  eventsBackupPath,
  latestPath,
  ensureDataDir,
  rotateEventsIfNeeded,
  writeEvent,
  parseNdjsonLines,
  readRecentEvents,
  ensureInboxDir,
  writeAgentInbox,
  readLatestEvent
};
