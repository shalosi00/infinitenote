/**
 * Page version history — pure policy (no Dexie, no DOM).
 *
 * The data layer lives in notes-db.ts (`pageVersions` table, schema v3);
 * this module owns every decision: what a version row contains, when the
 * autosave path records one (interval + structural-change gate), how the
 * per-page FIFO budget prunes, and how versions are presented.
 *
 * Design notes (docs/test-plans/version-history.md):
 * - The structural dedupe gate reuses `structuralSceneJson` (the autosave
 *   gate's own fingerprint): a scene whose structure already matches the
 *   newest version never produces a second version, while Excalidraw's
 *   self-re-stamped metadata (version/versionNonce/updated) is absorbed.
 * - All clocks are injected; pruning is a pure function. Deterministic
 *   by construction.
 */
import { structuralSceneJson } from "./excalidraw-utils";
import { plural } from "./plural";
import type { ScenePayload } from "./types";

/** How a version came to be — drives the label in the history dialog. */
export type PageVersionSource = "auto" | "manual" | "pre-restore";

/** A version as listed in the history dialog — content stays in the DB. */
export interface PageVersionSummary {
  id: string;
  pageId: string;
  createdAt: number;
  source: PageVersionSource;
  elementCount: number;
  byteSize: number;
}

/** A stored version row (the summary plus the serialized scene). */
export interface PageVersionRow extends PageVersionSummary {
  /** serialized ScenePayload — the exact bytes `savePageContent` would store */
  content: string;
}

/** Per-page FIFO budget shared by all snapshot sources. */
export const MAX_VERSIONS_PER_PAGE = 25;

/**
 * Minimum wall-clock distance between two AUTO snapshots of the same page.
 * Manual saves and pre-restore safety copies are not throttled.
 */
export const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000;

/** Live (non-tombstone) element count of a scene payload. */
function liveElementCount(payload: ScenePayload): number {
  return payload.elements.filter(
    (el) => !(el as { isDeleted?: boolean } | null)?.isDeleted,
  ).length;
}

/** Build a full version row for a scene — deterministic, no clock reads. */
export function buildPageVersion(
  pageId: string,
  payload: ScenePayload,
  source: PageVersionSource,
  at: number,
): PageVersionRow {
  const content = JSON.stringify(payload);
  return {
    id: crypto.randomUUID(),
    pageId,
    createdAt: at,
    source,
    content,
    elementCount: liveElementCount(payload),
    byteSize: content.length,
  };
}

/**
 * Should a successful autosave also record a version?
 *
 * true when there is no previous version yet, or when the scene's STRUCTURE
 * differs from the newest version's and the throttle interval has elapsed.
 * Structural equality is judged by `structuralSceneJson` — the same
 * fingerprint the autosave gate uses — so re-stamped volatile metadata
 * never counts as change, and a corrupt previous version (defensively)
 * always does.
 */
export function shouldAutoSnapshot(
  last: PageVersionRow | null,
  payload: ScenePayload,
  now: number,
): boolean {
  if (!last) return true;
  let previousStructure: string | null = null;
  try {
    previousStructure = structuralSceneJson(JSON.parse(last.content) as ScenePayload);
  } catch {
    return true; // unreadable previous version — snapshot defensively, now:
    // history integrity is broken, the throttle must not stall the repair
  }
  if (now - last.createdAt < AUTO_SNAPSHOT_MIN_INTERVAL_MS) return false;
  return structuralSceneJson(payload) !== previousStructure;
}

/**
 * Ids of rows that fall outside the per-page budget. Survivors are the
 * newest `keep` by (createdAt desc, id desc) — the id tie-break keeps the
 * function deterministic when timestamps collide.
 */
export function pruneToCapacity(
  rows: readonly PageVersionSummary[],
  keep: number = MAX_VERSIONS_PER_PAGE,
): string[] {
  const ordered = [...rows].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  // ascending id order — deterministic output regardless of row order
  return ordered.slice(keep).map((row) => row.id).sort();
}

/** Version rows, newest first (dialog order). */
export function sortVersionsNewestFirst<T extends { createdAt: number; id: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Locale-free relative age for the history dialog ("just now",
 * "5 minutes ago", "over a month ago" …). Buckets are exact so tests —
 * and every locale — see the same strings.
 */
export function relativeVersionTime(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < 10_000) return "just now";
  if (age < MINUTE) return plural(Math.floor(age / 1000), "1 second ago", "# seconds ago");
  if (age < HOUR) return plural(Math.floor(age / MINUTE), "1 minute ago", "# minutes ago");
  if (age < DAY) return plural(Math.floor(age / HOUR), "1 hour ago", "# hours ago");
  if (age < 30 * DAY) return plural(Math.floor(age / DAY), "1 day ago", "# days ago");
  if (age < 365 * DAY) return "over a month ago";
  return "over a year ago";
}
