#!/usr/bin/env node
"use strict";

/**
 * verify_docs
 *
 * Catches doc drift by asserting:
 *   - Every `verify_<name>.js` mention in any doc resolves to a real
 *     script in scripts/.
 *   - Every verify_*.js in scripts/ is listed in
 *     docs/verification_and_taxonomy_runbook.md (so new suites don't
 *     get forgotten in the operator-facing index).
 *   - Every repo-relative FILE reference in backticks
 *     (lib/*.js, webhook/*.js, scripts/*.js, docs/*.md) resolves.
 *
 * Exclusions (deliberate):
 *   - Placeholders like `<role>`, `<envelope_id>` — paths with < or >.
 *   - Wildcard globs like `scripts/verify_*.js`.
 *   - Markdown link text where the target is an http URL (sibling-repo
 *     docs, external GitHub refs).
 *   - Directory references (no extension) and files under
 *     `webhook/data/` or `data/macro_snapshots/` (runtime-created).
 */

const fs = require("fs");
const path = require("path");

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, "docs");
const scriptsDir = path.join(repoRoot, "scripts");

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

function listVerifyScripts() {
  return fs.readdirSync(scriptsDir)
    .filter((f) => /^verify_.*\.js$/.test(f))
    .sort();
}

function readAllDocs() {
  return fs.readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const p = path.join(docsDir, f);
      return { path: p, name: f, body: fs.readFileSync(p, "utf8") };
    });
}

// Strip markdown link syntax where target is an http URL:  [text with `code`](http...) -> drop entirely.
function stripExternalLinks(body) {
  return body.replace(/\[[^\]]*\]\(https?:[^)]*\)/g, "");
}

const TRACKED_EXTENSIONS = new Set([".js", ".md", ".json", ".pine", ".ndjson", ".yml", ".yaml"]);
const RUNTIME_PREFIXES = ["webhook/data/", "data/macro_snapshots/"];
const PATH_PREFIXES = ["lib/", "scripts/", "docs/", "tv_direct/", "webhook/", "data/", "tests/"];

function isTrackedFileRef(candidate) {
  if (!candidate) return false;
  if (/[<>*]/.test(candidate)) return false;
  if (!PATH_PREFIXES.some((pre) => candidate.startsWith(pre))) return false;
  if (RUNTIME_PREFIXES.some((pre) => candidate.startsWith(pre))) return false;
  const ext = path.extname(candidate);
  return TRACKED_EXTENSIONS.has(ext);
}

const verifyScripts = listVerifyScripts();
const docs = readAllDocs();
const CODE_FENCE_RE = /`([^`\n]+)`/g;

// 1) Every verify_*.js in scripts/ is listed in the runbook.
const runbook = docs.find((d) => d.name === "verification_and_taxonomy_runbook.md");
for (const script of verifyScripts) {
  check(`runbook lists ${script}`, runbook && runbook.body.includes(script));
}

// 2) Every verify_<name>.js reference in any doc resolves.
const verifyRefs = new Set();
for (const { body } of docs) {
  for (const m of stripExternalLinks(body).matchAll(/\bverify_[a-z_]+\.js\b/g)) {
    verifyRefs.add(m[0]);
  }
}
for (const ref of verifyRefs) {
  const ok = fs.existsSync(path.join(scriptsDir, ref));
  check(`referenced script ${ref} exists`, ok);
}

// 3) Repo-relative file references in backticks resolve.
let fileChecks = 0;
for (const { name, body } of docs) {
  const cleaned = stripExternalLinks(body);
  for (const m of cleaned.matchAll(CODE_FENCE_RE)) {
    const raw = m[1].trim();
    if (!isTrackedFileRef(raw)) continue;
    const clean = raw.replace(/[.,;:]$/, "").split("#")[0];
    fileChecks++;
    const ok = fs.existsSync(path.join(repoRoot, clean));
    check(`${name} -> ${clean}`, ok);
  }
}

console.log("");
if (failures.length === 0) {
  console.log(`[verify-docs] ALL CHECKS PASSED (${verifyScripts.length} verify scripts, ${verifyRefs.size} verify refs, ${fileChecks} file refs)`);
  process.exit(0);
}
console.error(`[verify-docs] ${failures.length} CHECK(S) FAILED`);
process.exit(1);
