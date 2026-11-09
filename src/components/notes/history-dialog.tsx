"use client";

/**
 * Page version history dialog (docs/test-plans/version-history.md).
 *
 * Lists a page's versions newest-first (relative time, source, element
 * count, size), offers "Save version now" and per-row Restore. Both actions
 * delegate to the app shell's orchestration (which owns the canvas api:
 * flush → snapshot → write → remount) via props; the dialog stays open
 * after a restore so the freshly created "Before restore" row is visible
 * immediately — restoring is never a dead end.
 */
import { useEffect, useState } from "react";
import { History, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/lib/store";
import * as db from "@/lib/notes-db";
import {
  MAX_VERSIONS_PER_PAGE,
  relativeVersionTime,
  type PageVersionSource,
  type PageVersionSummary,
} from "@/lib/version-history";
import { plural } from "@/lib/plural";

const SOURCE_LABELS: Record<PageVersionSource, string> = {
  auto: "Automatic",
  manual: "Manual",
  "pre-restore": "Before restore",
};

export function HistoryDialog({
  onSaveNow,
  onRestore,
}: {
  onSaveNow: () => Promise<void>;
  onRestore: (versionId: string) => Promise<void>;
}) {
  const open = useAppStore((s) => s.historyOpen);
  const setOpen = useAppStore((s) => s.setHistoryOpen);
  const [versions, setVersions] = useState<PageVersionSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  /** Re-list on open AND after every save/restore (trash-dialog pattern). */
  const refresh = () => {
    const pageId = useAppStore.getState().selection?.pageId;
    if (!pageId) return;
    void db.listPageVersions(pageId).then(setVersions);
  };

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open]);

  const handleSaveNow = async () => {
    setSaving(true);
    try {
      await onSaveNow();
    } finally {
      setSaving(false);
      refresh();
    }
  };

  const handleRestore = async (versionId: string) => {
    if (restoringId) return;
    setRestoringId(versionId);
    try {
      await onRestore(versionId);
    } finally {
      setRestoringId(null);
      refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg" data-testid="history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> {"Version history"}
          </DialogTitle>
          <DialogDescription>
            {"Snapshots of this page. Restoring never loses anything — the state you leave behind is saved as a version."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto rounded-md border p-2">
          {versions.length === 0 ? (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="history-empty"
            >
              {"No versions yet — save one now, or keep working: versions are captured automatically as you edit."}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                  data-testid="version-row"
                >
                  <span
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    data-testid="version-source"
                  >
                    {SOURCE_LABELS[v.source]}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                    data-testid="version-meta"
                  >
                    {relativeVersionTime(v.createdAt, Date.now())} ·{" "}
                    {plural(v.elementCount, "1 element", "# elements")} ·{" "}
                    {Math.max(1, Math.round(v.byteSize / 1024))} KB
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5"
                    disabled={restoringId !== null}
                    onClick={() => void handleRestore(v.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {"Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />
        <DialogFooter className="gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {"The newest " + MAX_VERSIONS_PER_PAGE + " versions are kept per page."}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            data-testid="save-version-now"
            disabled={saving}
            onClick={() => void handleSaveNow()}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save version now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
