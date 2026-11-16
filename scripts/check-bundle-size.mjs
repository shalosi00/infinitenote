#!/usr/bin/env node
/**
 * Bundle-size guard — the majors-research practice adopted from Excalidraw's
 * `size-limit.yml` (wave 3 of the "learn from the majors" directive).
 *
 * What it measures: the total client JavaScript the build emits under
 * `.next/static/chunks/` (every chunk a user's browser can download,
 * lazy or initial — for a local-first PWA this is the honest payload and
 * storage metric; tesseract/transformers/Excalidraw live here too).
 *
 * What it compares against: `scripts/size-budget.json` — a committed budget
 * whose `measured` block pins the real build it was derived from. Over
 * budget => exit 1 (the check shows red; it is NOT a required check, so it
 * cannot block a merge — it exists to make every payload regression visible
 * in the PR's check list and job summary).
 *
 * Pure helpers (evaluateBudget, validateBudgetConfig, collectJsStats,
 * formatKib, renderSummary) are exported and pinned by
 * src/lib/__tests__/size-budget.test.ts — same pattern as fdroid-check.mjs.
 */

import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, relative } from "node:path";

/** The client-chunk directory every measurement reads. */
export const CHUNKS_DIR = ".next/static/chunks";

/** The committed budget file. */
export const BUDGET_FILE = "scripts/size-budget.json";

/**
 * Compare an actual total against the budget.
 * Failing means STRICTLY over (equal to budget passes — the budget is the
 * ceiling, not a target to sit on).
 */
export function evaluateBudget(budgetKib, actualKib) {
  if (!Number.isFinite(budgetKib) || budgetKib <= 0) {
    throw new Error(`invalid budget: ${budgetKib}`);
  }
  if (!Number.isFinite(actualKib) || actualKib < 0) {
    throw new Error(`invalid actual: ${actualKib}`);
  }
  const overByKib = Math.round((actualKib - budgetKib) * 10) / 10;
  const pctOfBudget = Math.round((actualKib / budgetKib) * 1000) / 10;
  return {
    ok: actualKib <= budgetKib,
    overByKib: Math.max(0, overByKib),
    pctOfBudget,
  };
}

/**
 * Validate a parsed size-budget.json. Returns the typed config or an error
 * string (never throws) so tests and the CLI can handle both shapes.
 */
export function validateBudgetConfig(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "budget file must be a JSON object" };
  }
  const budget = raw.clientJsTotalKib;
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
    return {
      ok: false,
      error: "clientJsTotalKib must be a positive finite number",
    };
  }
  const measured = raw.measured;
  if (measured === null || typeof measured !== "object" || Array.isArray(measured)) {
    return { ok: false, error: "measured block must be a JSON object" };
  }
  if (typeof measured.on !== "string" || measured.on.length === 0) {
    return { ok: false, error: "measured.on (date) must be a non-empty string" };
  }
  if (typeof measured.commit !== "string" || measured.commit.length === 0) {
    return { ok: false, error: "measured.commit must be a non-empty string" };
  }
  if (
    typeof measured.clientJsTotalKib !== "number" ||
    !Number.isFinite(measured.clientJsTotalKib) ||
    measured.clientJsTotalKib <= 0
  ) {
    return { ok: false, error: "measured.clientJsTotalKib must be positive" };
  }
  if (
    !Number.isInteger(measured.clientJsFiles) ||
    measured.clientJsFiles <= 0
  ) {
    return {
      ok: false,
      error: "measured.clientJsFiles must be a positive integer",
    };
  }
  // The budget must keep real headroom over the measurement it was derived
  // from — otherwise a rebuild round-trip trips it on chunk-hash jitter.
  if (budget < measured.clientJsTotalKib) {
    return {
      ok: false,
      error:
        "clientJsTotalKib budget is below the measured value it claims to derive from",
    };
  }
  // …and it must not be a rubber stamp: no more than 20% above measured.
  if (budget > measured.clientJsTotalKib * 1.2) {
    return {
      ok: false,
      error:
        "clientJsTotalKib budget is more than 20% above the measured value — budgets grow through measurement + a deliberate policy change, not by cranking the ceiling",
    };
  }
  return { ok: true, error: "" };
}

/**
 * Aggregate a list of file entries into the stats the check reports.
 * `entries` is [{ path, bytes }] — passed in rather than collected here so
 * the aggregation is testable without a real build tree.
 */
export function collectJsStats(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("entries must be an array of { path, bytes }");
  }
  let totalBytes = 0;
  let largest = null;
  for (const e of entries) {
    if (
      !e ||
      typeof e.path !== "string" ||
      !Number.isFinite(e.bytes) ||
      e.bytes < 0
    ) {
      throw new Error(`bad entry: ${JSON.stringify(e)}`);
    }
    totalBytes += e.bytes;
    if (largest === null || e.bytes > largest.bytes) largest = e;
  }
  return {
    totalKib: Math.round((totalBytes / 1024) * 10) / 10,
    fileCount: entries.length,
    largestKib: largest ? Math.round((largest.bytes / 1024) * 10) / 10 : 0,
    largestPath: largest ? largest.path : "",
  };
}

/** Human formatting: KiB below 1024, MiB with two decimals above. */
export function formatKib(kib) {
  if (kib >= 1024) return `${(kib / 1024).toFixed(2)} MiB`;
  return `${Math.round(kib * 10) / 10} KiB`;
}

/** Markdown summary block for the GitHub job summary. */
export function renderSummary(stats, verdict, budget) {
  const verdictLine = verdict.ok
    ? `PASS — ${formatKib(stats.totalKib)} of ${formatKib(budget)} (${verdict.pctOfBudget}% of budget)`
    : `FAIL — ${formatKib(stats.totalKib)} is ${formatKib(verdict.overByKib)} over the ${formatKib(budget)} budget (${verdict.pctOfBudget}% of budget)`;
  return [
    "## Bundle size",
    "",
    verdictLine,
    "",
    `| metric | value |`,
    `|---|---|`,
    `| client JS total | ${formatKib(stats.totalKib)} |`,
    `| budget | ${formatKib(budget)} |`,
    `| files | ${stats.fileCount} |`,
    `| largest chunk | ${formatKib(stats.largestKib)} (\`${stats.largestPath}\`) |`,
    "",
    "Metric: every `.js` file under `.next/static/chunks/` (initial + lazy — the full client payload of the PWA). Practice adopted from Excalidraw's size-limit workflow.",
  ].join("\n");
}

/** Recursively collect .js files under `root` as [{ path, bytes }]. */
export function walkJsFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const visit = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        visit(p);
      } else if (d.name.endsWith(".js")) {
        out.push({ path: relative(process.cwd(), p), bytes: statSync(p).size });
      }
    }
  };
  visit(root);
  return out;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("check-bundle-size.mjs") ||
    process.argv[1].endsWith("check-bundle-size"));

if (isMain) {
  if (!existsSync(CHUNKS_DIR)) {
    console.error(
      `::error::${CHUNKS_DIR} not found — run the production build first`,
    );
    process.exit(2);
  }
  let budgetRaw;
  try {
    budgetRaw = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${BUDGET_FILE}: ${err.message}`);
    process.exit(2);
  }
  const cfg = validateBudgetConfig(budgetRaw);
  if (!cfg.ok) {
    console.error(`::error::invalid ${BUDGET_FILE}: ${cfg.error}`);
    process.exit(2);
  }
  const stats = collectJsStats(walkJsFiles(CHUNKS_DIR));
  const verdict = evaluateBudget(budgetRaw.clientJsTotalKib, stats.totalKib);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        renderSummary(stats, verdict, budgetRaw.clientJsTotalKib) + "\n",
      );
    } catch {
      // summary is best-effort; the verdict below is the real signal
    }
  }
  console.log(
    `client JS: ${formatKib(stats.totalKib)} across ${stats.fileCount} files ` +
      `(largest ${formatKib(stats.largestKib)}) — budget ${formatKib(budgetRaw.clientJsTotalKib)}`,
  );
  if (!verdict.ok) {
    console.error(
      `::error::bundle over budget by ${formatKib(verdict.overByKib)} — ` +
        "shrink the payload or raise the budget through a measured policy change",
    );
    process.exit(1);
  }
  console.log(`PASS — ${verdict.pctOfBudget}% of budget`);
}
