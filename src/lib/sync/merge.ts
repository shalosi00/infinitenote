/**
 * Sync merge engine — phase 1 (docs/sync-research.md §4).
 *
 * Three-way merge at row granularity with the sync folder's last manifest as
 * the common ancestor (`base`): `local` is this device's current DB state,
 * `remote` is the state parsed from the folder right now.
 *
 * Rules (deliberately boring, all timestamp-driven):
 * - **Adds** union: ids are offline UUIDs, so a row only one side has is an
 *   add — it is kept and pushed.
 * - **Tree rows** (notebooks/sections) merge whole-row LWW by event time.
 * - **Pages** merge whole-row LWW too, but when *both* sides changed since
 *   `base` and the two alive versions diverge, the newer one wins and the
 *   loser is materialized as a `"<title> (conflict YYYY-MM-DD)"` copy with a
 *   fresh id — concurrent work is never silently dropped.
 * - **Deletes** are rows with `deletedAt` (soft) or tombstones in the remote
 *   `trash.jsonl`. An older delete never beats a newer edit; when a delete
 *   wins, the losing side's newest content is preserved inside the trashed
 *   row so the trash never holds stale content.
 * - **Purges** (local purge tombstones or remote `purged: true` entries) are
 *   final — no stale remote can resurrect a purged row.
 * - **Orders** are renumbered densely per parent after the merge, so two
 *   devices that both appended pages converge without collisions.
 * - **Out-of-contract folders heal**: the folder can carry BOTH a stale row
 *   (a page file the writer could not remove, a partially replicated
 *   directory) and that row's tombstone. A remote-only row whose soft
 *   tombstone is at-or-after the row's last mutation merges as deleted —
 *   deleted rows must not resurrect on devices that never saw them.
 *
 * Pure: no I/O, injectable clock, fully unit-tested.
 */

import type { Notebook, PageRow, Section } from "../types";
import { generatedNames } from "../generated-names";
import {
  buildManifest,
  reduceTrash,
  type LibrarySnapshot,
  type SyncManifest,
  type TrashEntry,
} from "./format";

/** Last mutation time of a row — a delete counts as a mutation. */
export function eventTime(row: { updatedAt: number; deletedAt?: number | null }): number {
  return Math.max(row.updatedAt, row.deletedAt ?? 0);
}

/** Title of a conflict copy, dated for the local time of the merge.
 * Suffix is localized (issue #63); English by default, so pure merge tests
 * keep their fixtures. */
export function conflictTitle(title: string, ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return generatedNames().conflict(title, date);
}

export interface SyncSummary {
  notebooksAdded: number;
  sectionsAdded: number;
  pagesAdded: number;
  /** pages whose fields (incl. content) changed on this device */
  pagesUpdated: number;
  /** notebooks + sections whose fields changed on this device */
  treeUpdated: number;
  /** conflict copies created (losers of both-changed pages) */
  pagesConflicted: number;
  /** rows soft-deleted on this device by the merge */
  pagesDeleted: number;
  treeDeleted: number;
  /** rows hard-deleted on this device (purge tombstones) */
  pagesPurged: number;
  treePurged: number;
}

/** Declarative result: the merged library + everything the applier needs. */
export interface SyncPlan {
  /** complete merged library — alive AND trashed rows, full page content */
  notebooks: Notebook[];
  sections: Section[];
  pages: PageRow[];
  /** union tombstone log to re-export (purges sticky, latest per id) */
  trashLog: TrashEntry[];
  /** merged manifest — persisted as `base` for the next sync */
  manifest: SyncManifest;
  summary: SyncSummary;
}

/** Everything the engine needs to run a sync. */
export interface SyncInputs {
  /** this device's current DB state (incl. trashed rows, full content) */
  local: LibrarySnapshot;
  /** purge tombstones persisted on this device (trash.jsonl `purged: true`) */
  localPurges: readonly TrashEntry[];
  /** the folder's state right now (manifest rows + page files) */
  remote: LibrarySnapshot;
  /** tombstones parsed from the folder's trash.jsonl */
  remoteTrash: readonly TrashEntry[];
  /** the manifest as of this device's last successful sync; null = first sync */
  base: SyncManifest | null;
}

export interface ComputeSyncPlanOptions {
  /** clock injection (tests) — defaults to Date.now() */
  now?: number;
  /** id factory for conflict copies (tests) — defaults to crypto.randomUUID */
  newId?: () => string;
}

interface RowLike {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/** Manifest rows (the sync base) carry no `deletedAt` — they are alive-only. */
interface BaseRowLike {
  id: string;
  updatedAt: number;
}

/**
 * Merge a remote-only (or local-only) row against the folder's tombstones.
 * Normally a one-sided row is a plain add (a local soft delete always leaves
 * the trashed row in `local`), but the folder can carry BOTH a stale row and
 * its tombstone — a page file the writer could not remove, a partially
 * replicated directory, a crashed write. A soft tombstone at-or-after the
 * row's last mutation keeps the row deleted; the trashed row keeps the
 * stale content so it stays restorable.
 */
function applyRemoteTombstone<T extends RowLike>(row: T, tomb: TrashEntry | undefined): T {
  if (tomb && !tomb.purged && tomb.at >= eventTime(row)) {
    return { ...row, deletedAt: tomb.at, updatedAt: Math.max(row.updatedAt, tomb.at) };
  }
  return row;
}

/** Whole-row LWW for tree rows (notebooks/sections). */
function mergeTreeRows<T extends RowLike>(
  local: Map<string, T>,
  remote: Map<string, T>,
  base: Map<string, BaseRowLike> | null,
  localPurges: Set<string>,
  remoteTrash: Map<string, TrashEntry>
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(id);
    const r = remote.get(id);
    if (localPurges.has(id) || remoteTrash.get(id)?.purged) continue; // purge: final
    if (l && r) {
      merged.set(id, eventTime(l) >= eventTime(r) ? l : r);
    } else if (l) {
      // Remote never had it (local add — keep), or removed it: a soft
      // tombstone at-or-after the local row's last mutation deletes it.
      merged.set(id, applyRemoteTombstone(l, remoteTrash.get(id)));
    } else if (r) {
      // Remote-only row: a plain remote add, unless a stale row + tombstone
      // pair says it is deleted (out-of-contract folder healing).
      merged.set(id, applyRemoteTombstone(r, remoteTrash.get(id)));
    }
    // neither side has it (base only) → row is gone on both: nothing to merge
  }
  return merged;
}

function pagesEqual(a: PageRow, b: PageRow): boolean {
  // `order` is deliberately NOT compared: sibling orders are renumbered
  // after the merge, so an order difference is not content divergence.
  return (
    a.title === b.title &&
    a.sectionId === b.sectionId &&
    a.deletedAt === b.deletedAt &&
    (a.background ?? null) === (b.background ?? null) &&
    (a.tags ?? []).join("\u0000") === (b.tags ?? []).join("\u0000") &&
    (a.content ?? null) === (b.content ?? null)
  );
}

/**
 * Page merge: LWW, conflict copies for both-changed divergent pages, and
 * content preservation when a delete beats an edit.
 */
function mergePages(
  local: Map<string, PageRow>,
  remote: Map<string, PageRow>,
  base: Map<string, BaseRowLike> | null,
  localPurges: Set<string>,
  remoteTrash: Map<string, TrashEntry>
): { merged: Map<string, PageRow>; conflicts: Array<{ loser: PageRow }> } {
  const merged = new Map<string, PageRow>();
  const conflicts: Array<{ loser: PageRow }> = [];

  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(id);
    const r = remote.get(id);
    if (localPurges.has(id) || remoteTrash.get(id)?.purged) continue; // purge: final

    if (l && r) {
      const b = base?.get(id) ?? null;
      const lChanged = !b || eventTime(l) > eventTime(b);
      const rChanged = !b || eventTime(r) > eventTime(b);
      const lAlive = l.deletedAt === null;
      const rAlive = r.deletedAt === null;

      if (lAlive && rAlive && lChanged && rChanged && !pagesEqual(l, r)) {
        // Both sides edited the same page since the last sync: newer wins,
        // the loser becomes a conflict copy so no work is dropped.
        merged.set(id, eventTime(l) >= eventTime(r) ? l : r);
        conflicts.push({ loser: eventTime(l) >= eventTime(r) ? r : l });
        continue;
      }
      if (lAlive !== rAlive) {
        // Delete vs edit: newer event wins. When the delete wins, keep the
        // alive side's row (it holds the newest content) and carry the delete
        // timestamp — the trash must never hold older content than the edit
        // it destroyed.
        const alive = lAlive ? l : r;
        const trashed = lAlive ? r : l;
        if (eventTime(trashed) > eventTime(alive)) {
          merged.set(id, {
            ...alive,
            deletedAt: trashed.deletedAt,
            updatedAt: Math.max(alive.updatedAt, trashed.deletedAt!),
          });
        } else {
          merged.set(id, alive); // newer edit resurrects the page
        }
        continue;
      }
      merged.set(id, eventTime(l) >= eventTime(r) ? l : r); // plain LWW
    } else if (l) {
      // Remote never had it (local add — keep), or removed it: a soft
      // tombstone at-or-after the local row's last mutation deletes it.
      merged.set(id, applyRemoteTombstone(l, remoteTrash.get(id)));
    } else if (r) {
      // Remote-only row: a plain remote add, unless a stale row + tombstone
      // pair says it is deleted (out-of-contract folder healing).
      merged.set(id, applyRemoteTombstone(r, remoteTrash.get(id)));
    }
  }
  return { merged, conflicts };
}

/**
 * Renumber sibling `order` fields to a dense 1..n sequence, sorted by
 * (order, createdAt, id) — deterministic on every device and collision-free
 * after union merges. Trashed rows keep their old order (never displayed).
 */
function normalizeOrders<
  T extends { order: number; createdAt: number; id: string; deletedAt: number | null },
>(rows: T[], parentKey: (row: T) => string): T[] {
  const byParent = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.deletedAt === null ? parentKey(row) : `\0trash:${row.id}`;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  const out: T[] = [];
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    let order = 0;
    for (const row of list) {
      if (row.deletedAt === null) {
        order += 1;
        out.push({ ...row, order });
      } else {
        out.push(row);
      }
    }
  }
  return out;
}

/** Field-wise row equality (key order differs between DB rows and parsed JSON). */
function rowsEqual<T extends { id: string }>(a: T | undefined, b: T | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a as Record<string, unknown>)[k] ?? null;
    const bv = (b as Record<string, unknown>)[k] ?? null;
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) return false;
  }
  return true;
}

/**
 * Compute the full sync plan for "pull remote + push local". Pure: same
 * inputs (and clock/id injections) always produce the same plan.
 */
export function computeSyncPlan(
  inputs: SyncInputs,
  options: ComputeSyncPlanOptions = {}
): SyncPlan {
  const now = options.now ?? Date.now();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const { local, remote, base } = inputs;
  const localPurges = new Set(inputs.localPurges.map((t) => t.id));
  const remoteTrash = reduceTrash(inputs.remoteTrash);

  const baseIndex = base
    ? new Map<string, BaseRowLike>([
        ...base.notebooks.map((n) => [n.id, n] as const),
        ...base.sections.map((s) => [s.id, s] as const),
        ...base.pages.map((p) => [p.id, p] as const),
      ])
    : null;

  const nbMerged = mergeTreeRows(
    new Map(local.notebooks.map((n) => [n.id, n])),
    new Map(remote.notebooks.map((n) => [n.id, n])),
    baseIndex,
    localPurges,
    remoteTrash
  );
  const secMerged = mergeTreeRows(
    new Map(local.sections.map((s) => [s.id, s])),
    new Map(remote.sections.map((s) => [s.id, s])),
    baseIndex,
    localPurges,
    remoteTrash
  );
  const pg = mergePages(
    new Map(local.pages.map((p) => [p.id, p])),
    new Map(remote.pages.map((p) => [p.id, p])),
    baseIndex,
    localPurges,
    remoteTrash
  );

  // Conflict copies: fresh ids, dated title, appended last in their section.
  const conflictCopies: PageRow[] = pg.conflicts.map(({ loser }) => ({
    ...loser,
    id: newId(),
    title: conflictTitle(loser.title, now),
    order: Number.MAX_SAFE_INTEGER,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  const notebooks = normalizeOrders([...nbMerged.values()], () => "root");
  const sections = normalizeOrders([...secMerged.values()], (s) => s.notebookId);
  const pages = normalizeOrders([...pg.merged.values(), ...conflictCopies], (p) => p.sectionId);

  // ---- summary: what applying this plan changes on this device ----------
  const localNbs = new Map(local.notebooks.map((n) => [n.id, n]));
  const localSecs = new Map(local.sections.map((s) => [s.id, s]));
  const localPages = new Map(local.pages.map((p) => [p.id, p]));
  const summary: SyncSummary = {
    notebooksAdded: 0,
    sectionsAdded: 0,
    pagesAdded: 0,
    pagesUpdated: 0,
    treeUpdated: 0,
    pagesConflicted: conflictCopies.length,
    pagesDeleted: 0,
    treeDeleted: 0,
    pagesPurged: 0,
    treePurged: 0,
  };
  for (const n of notebooks) {
    const prev = localNbs.get(n.id);
    if (!prev) {
      if (n.deletedAt === null) summary.notebooksAdded += 1;
      continue;
    }
    if (prev.deletedAt === null && n.deletedAt !== null) summary.treeDeleted += 1;
    else if (!rowsEqual(prev, n)) summary.treeUpdated += 1;
  }
  for (const id of localNbs.keys()) if (!nbMerged.has(id)) summary.treePurged += 1;
  for (const s of sections) {
    const prev = localSecs.get(s.id);
    if (!prev) {
      if (s.deletedAt === null) summary.sectionsAdded += 1;
      continue;
    }
    if (prev.deletedAt === null && s.deletedAt !== null) summary.treeDeleted += 1;
    else if (!rowsEqual(prev, s)) summary.treeUpdated += 1;
  }
  for (const id of localSecs.keys()) if (!secMerged.has(id)) summary.treePurged += 1;
  for (const p of pages) {
    const prev = localPages.get(p.id);
    if (!prev) {
      if (p.deletedAt === null) summary.pagesAdded += 1;
      continue;
    }
    if (prev.deletedAt === null && p.deletedAt !== null) summary.pagesDeleted += 1;
    else if (!rowsEqual(prev, p)) summary.pagesUpdated += 1;
  }
  for (const id of localPages.keys()) if (!pg.merged.has(id)) summary.pagesPurged += 1;

  // ---- tombstone union for re-export ------------------------------------
  // Drop soft tombstones that lost to a newer alive row (stale delete), keep
  // everything else: purges are sticky, surviving deletes must propagate.
  const aliveEvent = (id: string): number | null => {
    const p = pg.merged.get(id);
    if (p && p.deletedAt === null) return eventTime(p);
    const s = secMerged.get(id);
    if (s && s.deletedAt === null) return eventTime(s);
    const n = nbMerged.get(id);
    if (n && n.deletedAt === null) return eventTime(n);
    return null;
  };
  const softFromMerged: TrashEntry[] = [
    ...pages
      .filter((p) => p.deletedAt !== null)
      .map((p) => ({ id: p.id, kind: "page" as const, at: p.deletedAt!, purged: false, title: p.title })),
    ...sections
      .filter((s) => s.deletedAt !== null)
      .map((s) => ({ id: s.id, kind: "section" as const, at: s.deletedAt!, purged: false, title: s.name })),
    ...notebooks
      .filter((n) => n.deletedAt !== null)
      .map((n) => ({ id: n.id, kind: "notebook" as const, at: n.deletedAt!, purged: false, title: n.name })),
  ];
  const candidates = [...softFromMerged, ...remoteTrash.values(), ...inputs.localPurges];
  const trashLog = [...reduceTrash(candidates).values()]
    .filter((e) => e.purged || aliveEvent(e.id) === null || aliveEvent(e.id)! < e.at)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

  const manifest = buildManifest({ notebooks, sections, pages }, now);
  return { notebooks, sections, pages, trashLog, manifest, summary };
}
