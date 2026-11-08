"use client";

/**
 * Trash — soft-deleted notebooks / sections / pages with restore & purge.
 */
import { useEffect, useState } from "react";
import { FileText, FolderClosed, NotebookPen, RotateCcw, Trash2 } from "lucide-react";
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
import type { TrashSnapshot } from "@/lib/notes-db";
import { NOTEBOOK_COLOR_HEX } from "@/lib/types";

export function TrashDialog() {
  const open = useAppStore((s) => s.trashOpen);
  const setOpen = useAppStore((s) => s.setTrashOpen);
  const restore = useAppStore((s) => s.restoreFromTrash);
  const purge = useAppStore((s) => s.purgeFromTrash);
  const [snapshot, setSnapshot] = useState<TrashSnapshot>({ notebooks: [], sections: [], pages: [] });

  /** Re-list the trash — run on open AND after every restore/purge so the
   *  dialog never shows rows that were just handled (issue #80). */
  const refreshSnapshot = () => {
    void db.listTrash().then(setSnapshot);
  };

  useEffect(() => {
    if (!open) return;
    refreshSnapshot();
  }, [open]);

  const empty =
    !snapshot.notebooks.length && !snapshot.sections.length && !snapshot.pages.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg" data-testid="trash-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> {"Trash"}
          </DialogTitle>
          <DialogDescription>
            {"Deleted items stay here until you restore or permanently remove them."}
          </DialogDescription>
        </DialogHeader>

        {/* A plain overflow container, not a Radix ScrollArea: its viewport
            uses table-layout sizing, which measures rows at their PREFERRED
            width — a long nowrap-truncated title then stretched the dialog
            past a 320px viewport and pushed the purge button off-screen
            (found by the ui-surface-sweep audit). Block layout truncates
            correctly. */}
        <div className="max-h-96 overflow-y-auto rounded-md border p-2">
          {empty && (
            <p className="py-8 text-center text-sm text-muted-foreground">{"Trash is empty."}</p>
          )}
          <div className="flex flex-col gap-1">
            {snapshot.notebooks.map((nb) => (
              <TrashRow
                key={nb.id}
                icon={<NotebookPen className="h-4 w-4" />}
                iconColor={NOTEBOOK_COLOR_HEX[nb.color]}
                label={`${nb.name} (${"notebook"})`}
                onRestore={() => void restore("notebook", nb.id).then(refreshSnapshot)}
                onPurge={() => void purge("notebook", nb.id).then(refreshSnapshot)}
              />
            ))}
            {snapshot.sections.map((s) => (
              <TrashRow
                key={s.id}
                icon={<FolderClosed className="h-4 w-4" />}
                label={`${s.name} (${"section"})`}
                onRestore={() => void restore("section", s.id).then(refreshSnapshot)}
                onPurge={() => void purge("section", s.id).then(refreshSnapshot)}
              />
            ))}
            {snapshot.pages.map((p) => (
              <TrashRow
                key={p.id}
                icon={<FileText className="h-4 w-4" />}
                label={`${p.title} (${"page"})`}
                onRestore={() => void restore("page", p.id).then(refreshSnapshot)}
                onPurge={() => void purge("page", p.id).then(refreshSnapshot)}
              />
            ))}
          </div>
        </div>

        <Separator />
        <DialogFooter className="text-xs text-muted-foreground">
          {"Restoring a parent also restores the children that were deleted with it."}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrashRow({
  icon,
  iconColor,
  label,
  onRestore,
  onPurge,
}: {
  icon: React.ReactNode;
  iconColor?: string;
  label: string;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const [confirmPurge, setConfirmPurge] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
      <span className="shrink-0" style={{ color: iconColor }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5 shrink-0" onClick={onRestore}>
        <RotateCcw className="h-3.5 w-3.5" /> {"Restore"}
      </Button>
      {confirmPurge ? (
        <Button variant="destructive" size="sm" className="h-8" onClick={onPurge}>
          {"Delete forever"}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 text-destructive hover:text-destructive"
          aria-label={"Delete forever"}
          title={"Delete forever"}
          onClick={() => setConfirmPurge(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
