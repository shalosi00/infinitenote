/**
 * Sync change summary, structured (issue #54 refactor of the old English-only
 * describeSummary). Pure data: the React layer renders each part through the
 * active locale's "sync.w*" message (ICU plural), joining with " · ".
 */
import type { SyncSummary } from "./merge";

/** One human-readable change ("2 pages pulled"). `key` indexes sync.w* messages. */
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
