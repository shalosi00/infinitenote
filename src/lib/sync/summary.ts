/**
 * Sync change summary (issue #54, English-only since v1.9). Pure data:
 * summaryParts() lists the ordered, non-zero changes of a sync round;
 * summaryPartLabel()/formatSyncSummary() render them as English one-liners
 * (the "sync.w*" ICU messages the catalog used to carry).
 */
import type { SyncSummary } from "./merge";
import { plural } from "../plural";

/** One human-readable change ("2 pages pulled"). `key` identifies the part. */
export interface SummaryPart {
  key:
    | "wNotebooks"
    | "wSections"
    | "wPagesPulled"
    | "wPagesUpdated"
    | "wConflicts"
    | "wTrashed"
    | "wTreeUpdated"
    | "wPurged";
  count: number;
}

/** Ordered, non-zero changes of a sync round. Empty = nothing changed. */
export function summaryParts(s: SyncSummary): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (s.notebooksAdded) parts.push({ key: "wNotebooks", count: s.notebooksAdded });
  if (s.sectionsAdded) parts.push({ key: "wSections", count: s.sectionsAdded });
  if (s.pagesAdded) parts.push({ key: "wPagesPulled", count: s.pagesAdded });
  if (s.pagesUpdated) parts.push({ key: "wPagesUpdated", count: s.pagesUpdated });
  if (s.pagesConflicted) parts.push({ key: "wConflicts", count: s.pagesConflicted });
  const deleted = s.pagesDeleted + s.treeDeleted;
  if (deleted) parts.push({ key: "wTrashed", count: deleted });
  if (s.treeUpdated) parts.push({ key: "wTreeUpdated", count: s.treeUpdated });
  const purged = s.pagesPurged + s.treePurged;
  if (purged) parts.push({ key: "wPurged", count: purged });
  return parts;
}

/** [one, other] plural branches per summary part. */
const PART_LABELS: Record<SummaryPart["key"], [string, string]> = {
  wNotebooks: ["1 notebook", "# notebooks"],
  wSections: ["1 section", "# sections"],
  wPagesPulled: ["1 page pulled", "# pages pulled"],
  wPagesUpdated: ["1 page updated", "# pages updated"],
  wConflicts: ["1 conflict copy", "# conflict copies"],
  wTrashed: ["1 item moved to trash", "# items moved to trash"],
  wTreeUpdated: ["1 notebook/section updated", "# notebooks/sections updated"],
  wPurged: ["1 item purged", "# items purged"],
};

/** English label for one summary part ("2 pages pulled"). */
export function summaryPartLabel(p: SummaryPart): string {
  const [one, other] = PART_LABELS[p.key];
  return plural(p.count, one, other);
}

/** English one-liner of what a sync changed ("1 page pulled · 2 notebooks"). */
export function formatSyncSummary(s: SyncSummary): string {
  const parts = summaryParts(s);
  if (parts.length === 0) return "Everything already in sync.";
  return `${parts.map(summaryPartLabel).join(" · ")}.`;
}
