#!/usr/bin/env node
/**
 * FND-5 / SEC-9: dependency audit gate.
 *
 * Runs `yarn audit --json --groups dependencies` (the libraries shipped inside
 * the app) and fails when a high or critical advisory is found that is not in
 * scripts/audit-allowlist.json. Yarn v1 has no allowlist of its own.
 *
 * Every allowlist entry names the advisory, the package, why it is accepted
 * for now and the backlog item that will remove it. Entries that no longer
 * match anything are reported so the list gets cleaned up.
 *
 * Usage:
 *   node scripts/audit-check.mjs                  run yarn audit and check it
 *   node scripts/audit-check.mjs --input FILE     check saved `yarn audit --json` output
 *   node scripts/audit-check.mjs --allowlist FILE use another allowlist
 */
import { spawnSync } from "node:child_process";
import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const BLOCKING_SEVERITIES = ["high", "critical"];
const ALLOWLIST_FIELDS = ["id", "package", "reason", "backlog"];
const GHSA_PATTERN = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

/**
 * Parse yarn v1 `audit --json` output (one JSON object per line).
 * Returns one entry per advisory and package, with every version and path found.
 * Throws if the output has no audit summary, so a failed audit never passes.
 */
export function parseAuditOutput(text) {
  const advisories = new Map();
  let summary = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type === "auditSummary") {
      summary = record.data;
    } else if (record.type === "auditAdvisory") {
      const advisory = record.data.advisory;
      const id = advisory.github_advisory_id || String(advisory.id);
      const key = `${id}|${advisory.module_name}`;
      const existing = advisories.get(key) ?? {
        id,
        package: advisory.module_name,
        severity: advisory.severity,
        title: advisory.title,
        url: advisory.url,
        versions: new Set(),
        paths: new Set(),
      };
      for (const finding of advisory.findings ?? []) {
        existing.versions.add(finding.version);
        for (const findingPath of finding.paths ?? []) existing.paths.add(findingPath);
      }
      advisories.set(key, existing);
    } else if (record.type === "error") {
      throw new Error(`yarn audit reported an error: ${record.data}`);
    }
  }
  if (!summary) {
    throw new Error("yarn audit produced no summary; the audit did not complete.");
  }
  return {
    summary,
    advisories: [...advisories.values()].map((advisory) => ({
      ...advisory,
      versions: [...advisory.versions].sort(),
      paths: [...advisory.paths].sort(),
    })),
  };
}

/** Check the allowlist's shape. Returns a list of problems (empty when valid). */
export function validateAllowlist(allowlist) {
  const problems = [];
  if (!allowlist || !Array.isArray(allowlist.entries)) {
    return ['The allowlist must be an object with an "entries" list.'];
  }
  allowlist.entries.forEach((entry, index) => {
    for (const field of ALLOWLIST_FIELDS) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        problems.push(`Entry ${index + 1} is missing "${field}".`);
      }
    }
    if (typeof entry?.id === "string" && !GHSA_PATTERN.test(entry.id) && !/^\d+$/.test(entry.id)) {
      problems.push(`Entry ${index + 1} has an id that is not a GHSA id or npm advisory number: ${entry.id}`);
    }
  });
  return problems;
}

/**
 * Split advisories into blocking (high/critical and not allowlisted) and
 * allowed, and list allowlist entries that matched nothing.
 */
export function evaluateAudit(advisories, allowlist) {
  const isAllowed = (advisory) =>
    allowlist.entries.find((entry) => entry.id === advisory.id && entry.package === advisory.package);
  const severe = advisories.filter((advisory) => BLOCKING_SEVERITIES.includes(advisory.severity));
  const blocking = severe.filter((advisory) => !isAllowed(advisory));
  const allowed = severe.filter((advisory) => isAllowed(advisory));
  const unused = allowlist.entries.filter(
    (entry) => !advisories.some((advisory) => advisory.id === entry.id && advisory.package === entry.package),
  );
  return { blocking, allowed, unused };
}

/** Human-readable report. */
export function formatReport({ summary, blocking, allowed, unused }) {
  const lines = [];
  const counts = summary.vulnerabilities ?? {};
  lines.push(
    `Dependency audit (shipped libraries): ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
  );
  lines.push(`Accepted for now (see scripts/audit-allowlist.json): ${allowed.length} high/critical.`);
  if (unused.length > 0) {
    lines.push("");
    lines.push("Allowlist entries that no longer match anything (remove them):");
    for (const entry of unused) lines.push(`  - ${entry.id} ${entry.package} (${entry.backlog})`);
  }
  if (blocking.length > 0) {
    lines.push("");
    lines.push(`FAILED: ${blocking.length} new high or critical advisory(ies) not in the allowlist:`);
    for (const advisory of blocking) {
      lines.push(`  - [${advisory.severity}] ${advisory.package} ${advisory.versions.join(", ")}: ${advisory.title}`);
      lines.push(`    ${advisory.id} ${advisory.url ?? ""}`.trimEnd());
      lines.push(`    via ${advisory.paths.slice(0, 3).join("; ")}`);
    }
    lines.push("");
    lines.push(
      "Fix: update the library, or, if it cannot be fixed yet, add an entry with the reason and backlog item to scripts/audit-allowlist.json.",
    );
  } else {
    lines.push("PASSED: no new high or critical advisories.");
  }
  return lines.join("\n");
}

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function runYarnAudit() {
  const result = spawnSync("yarn", ["audit", "--json", "--groups", "dependencies"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  // yarn audit's exit code is a bit mask of the severities found, so it is
  // ignored here; parseAuditOutput fails if the audit did not complete.
  return result.stdout;
}

/** Command-line entry point. Returns the process exit code. */
export function main(args = process.argv.slice(2)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const allowlistPath = readArgument(args, "--allowlist") ?? path.join(here, "audit-allowlist.json");
  const inputPath = readArgument(args, "--input");
  try {
    const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
    const problems = validateAllowlist(allowlist);
    if (problems.length > 0) {
      console.error(`The audit allowlist ${allowlistPath} is not valid:\n  ${problems.join("\n  ")}`);
      return 2;
    }
    const output = inputPath ? fs.readFileSync(inputPath, "utf8") : runYarnAudit();
    const { summary, advisories } = parseAuditOutput(output);
    const evaluation = evaluateAudit(advisories, allowlist);
    const report = formatReport({ summary, ...evaluation });
    if (evaluation.blocking.length > 0) {
      console.error(report);
      return 1;
    }
    console.log(report);
    return 0;
  } catch (error) {
    console.error(`Dependency audit could not run: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
