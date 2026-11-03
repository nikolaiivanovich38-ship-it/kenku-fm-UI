#!/usr/bin/env node
/**
 * FND-5 / SEC-9: dependency audit gate.
 *
 * Audits what ships inside the installer:
 *   - `yarn audit --json --groups dependencies`: the libraries in the app;
 *   - `yarn audit --json --groups devDependencies`, keeping only Electron.
 *     package.json lists Electron as a devDependency (Electron Forge expects
 *     that), but it is the runtime every user runs, so it is gated too. Build
 *     tools in devDependencies are not shipped and are not gated.
 * Fails when a high or critical advisory is found that is not in
 * scripts/audit-allowlist.json. Yarn v1 has no allowlist of its own.
 *
 * Every allowlist entry names the advisory, the package, why it is accepted
 * for now and the backlog item that will remove it. An entry may carry a
 * `reviewBy` date (YYYY-MM-DD); after that date the gate fails until someone
 * reviews the entry again. Entries that no longer match anything are
 * reported so the list gets cleaned up.
 *
 * Usage:
 *   node scripts/audit-check.mjs                   run both yarn audits and check them
 *   node scripts/audit-check.mjs --input FILE      check saved `yarn audit --json --groups dependencies` output
 *   node scripts/audit-check.mjs --dev-input FILE  with --input: also check saved devDependencies output (Electron only)
 *   node scripts/audit-check.mjs --allowlist FILE  use another allowlist
 */
import { spawnSync } from "node:child_process";
import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const BLOCKING_SEVERITIES = ["high", "critical"];
/** devDependencies that are shipped to users and so are audited like dependencies. */
export const SHIPPED_DEV_PACKAGES = ["electron"];
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const ALLOWLIST_FIELDS = ["id", "package", "reason", "backlog"];
const GHSA_PATTERN = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function countBySeverity(advisories) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const advisory of advisories) counts[advisory.severity] = (counts[advisory.severity] ?? 0) + 1;
  return counts;
}

/**
 * Keep only the advisories for `packages` from a parsed audit, with the
 * summary counted again from what is kept (one per advisory).
 */
export function selectPackages(audit, packages) {
  const advisories = audit.advisories.filter((advisory) => packages.includes(advisory.package));
  return { summary: { vulnerabilities: countBySeverity(advisories) }, advisories };
}

/** Merge two parsed audits; the summaries are added together. */
export function combineAudits(first, second) {
  const vulnerabilities = {};
  for (const severity of SEVERITIES) {
    vulnerabilities[severity] =
      (first.summary.vulnerabilities?.[severity] ?? 0) + (second.summary.vulnerabilities?.[severity] ?? 0);
  }
  const seen = new Set();
  const advisories = [...first.advisories, ...second.advisories].filter((advisory) => {
    const key = `${advisory.id}|${advisory.package}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { summary: { vulnerabilities }, advisories };
}

/** Allowlist entries whose `reviewBy` date (YYYY-MM-DD) is before `today` (YYYY-MM-DD). */
export function expiredEntries(allowlist, today) {
  return allowlist.entries.filter((entry) => typeof entry.reviewBy === "string" && entry.reviewBy < today);
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
    if (
      entry?.reviewBy !== undefined &&
      (typeof entry.reviewBy !== "string" ||
        !DATE_PATTERN.test(entry.reviewBy) ||
        Number.isNaN(Date.parse(entry.reviewBy)))
    ) {
      problems.push(`Entry ${index + 1} has a reviewBy that is not a YYYY-MM-DD date: ${entry.reviewBy}`);
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
export function formatReport({ summary, blocking, allowed, unused, expired = [] }) {
  const lines = [];
  const counts = summary.vulnerabilities ?? {};
  lines.push(
    `Dependency audit (shipped libraries and Electron): ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
  );
  lines.push(`Accepted for now (see scripts/audit-allowlist.json): ${allowed.length} high/critical.`);
  if (unused.length > 0) {
    lines.push("");
    lines.push("Allowlist entries that no longer match anything (remove them):");
    for (const entry of unused) lines.push(`  - ${entry.id} ${entry.package} (${entry.backlog})`);
  }
  if (expired.length > 0) {
    lines.push("");
    lines.push(`FAILED: ${expired.length} allowlist entry(ies) are past their review date:`);
    for (const entry of expired) {
      lines.push(`  - ${entry.id} ${entry.package} (${entry.backlog}): review date ${entry.reviewBy} has passed.`);
    }
    lines.push(
      "Fix: do the backlog item (usually an upgrade) and remove the entry, or, if it is still needed, re-check it and move reviewBy to a new date.",
    );
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
  } else if (expired.length === 0) {
    lines.push("PASSED: no new high or critical advisories.");
  }
  return lines.join("\n");
}

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function runYarnAudit(group) {
  const result = spawnSync("yarn", ["audit", "--json", "--groups", group], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  // yarn audit's exit code is a bit mask of the severities found, so it is
  // ignored here; parseAuditOutput fails if the audit did not complete.
  return result.stdout;
}

/** Command-line entry point. Returns the process exit code. `today` is YYYY-MM-DD (UTC). */
export function main(args = process.argv.slice(2), today = new Date().toISOString().slice(0, 10)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const allowlistPath = readArgument(args, "--allowlist") ?? path.join(here, "audit-allowlist.json");
  const inputPath = readArgument(args, "--input");
  const devInputPath = readArgument(args, "--dev-input");
  try {
    const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
    const problems = validateAllowlist(allowlist);
    if (problems.length > 0) {
      console.error(`The audit allowlist ${allowlistPath} is not valid:\n  ${problems.join("\n  ")}`);
      return 2;
    }
    const shipped = parseAuditOutput(inputPath ? fs.readFileSync(inputPath, "utf8") : runYarnAudit("dependencies"));
    // With saved input, Electron is checked only when its audit is given too.
    const devOutput = inputPath
      ? devInputPath && fs.readFileSync(devInputPath, "utf8")
      : runYarnAudit("devDependencies");
    const { summary, advisories } = devOutput
      ? combineAudits(shipped, selectPackages(parseAuditOutput(devOutput), SHIPPED_DEV_PACKAGES))
      : shipped;
    const evaluation = { ...evaluateAudit(advisories, allowlist), expired: expiredEntries(allowlist, today) };
    const report = formatReport({ summary, ...evaluation });
    if (evaluation.blocking.length > 0 || evaluation.expired.length > 0) {
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
