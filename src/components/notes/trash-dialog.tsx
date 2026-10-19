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
import { ScrollArea } from "@/components/ui/scroll-area";
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

  useEffect(() => {
    if (!open) return;
    void db.listTrash().then(setSnapshot);
  }, [open]);

  const empty =
    !snapshot.notebooks.length && !snapshot.sections.length && !snapshot.pages.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> Trash
          </DialogTitle>
          <DialogDescription>
            Deleted items stay here until you restore or permanently remove them.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96 rounded-md border p-2">
          {empty && (
            <p className="py-8 text-center text-sm text-muted-foreground">Trash is empty.</p>
          )}
          <div className="flex flex-col gap-1">
            {snapshot.notebooks.map((nb) => (
              <TrashRow
                key={nb.id}
                icon={<NotebookPen className="h-4 w-4" />}
                iconColor={NOTEBOOK_COLOR_HEX[nb.color]}
                label={`${nb.name} (notebook)`}
                onRestore={() => void restore("notebook", nb.id)}
                onPurge={() => void purge("notebook", nb.id)}
              />
            ))}
            {snapshot.sections.map((s) => (
              <TrashRow
                key={s.id}
                icon={<FolderClosed className="h-4 w-4" />}
                label={`${s.name} (section)`}
                onRestore={() => void restore("section", s.id)}
                onPurge={() => void purge("section", s.id)}
              />
            ))}
            {snapshot.pages.map((p) => (
              <TrashRow
                key={p.id}
                icon={<FileText className="h-4 w-4" />}
                label={`${p.title} (page)`}
                onRestore={() => void restore("page", p.id)}
                onPurge={() => void purge("page", p.id)}
              />
            ))}
          </div>
        </ScrollArea>

        <Separator />
        <DialogFooter className="text-xs text-muted-foreground">
          Restoring a parent also restores the children that were deleted with it.
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
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onRestore}>
        <RotateCcw className="h-3.5 w-3.5" /> Restore
      </Button>
      {confirmPurge ? (
        <Button variant="destructive" size="sm" className="h-8" onClick={onPurge}>
          Delete forever
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-destructive hover:text-destructive"
          onClick={() => setConfirmPurge(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
