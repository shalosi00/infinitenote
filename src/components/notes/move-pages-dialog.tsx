"use client";

/**
 * Move-pages picker (issue #27): lists every alive section grouped by
 * notebook as a move target for the current multi-selection. Rows where
 * nothing would move (every selected page already lives there) are disabled.
 */
import { FolderClosed, NotebookPen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { byOrder, type Notebook, type PageMeta, type Section } from "@/lib/types";

export function MovePagesDialog({
  open,
  onOpenChange,
  notebooks,
  sections,
  pages,
  selectedIds,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebooks: Notebook[];
  sections: Section[];
  pages: PageMeta[];
  selectedIds: ReadonlySet<string>;
  onMove: (targetSectionId: string) => void;
}) {
  const selectedSectionIds = new Set(
    pages.filter((p) => selectedIds.has(p.id)).map((p) => p.sectionId)
  );
  const count = selectedIds.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderClosed className="h-4 w-4" /> Move {count} page{count === 1 ? "" : "s"} to…
          </DialogTitle>
          <DialogDescription>
            Pages are appended to the end of the target section. Cross-notebook moves are allowed.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="flex flex-col gap-3 pr-3">
            {[...notebooks].sort(byOrder).map((nb) => (
              <div key={nb.id}>
                <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <NotebookPen className="h-3 w-3" /> {nb.name}
                </p>
                <div className="flex flex-col gap-0.5">
                  {sections
                    .filter((s) => s.notebookId === nb.id)
                    .sort(byOrder)
                    .map((sec) => {
                      // every selected page already in this section → no-op
                      const wouldMove =
                        count > 0 && [...selectedSectionIds].some((id) => id !== sec.id);
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          data-testid="move-target"
                          data-section-id={sec.id}
                          aria-label={`Move to ${nb.name} / ${sec.name}`}
                          disabled={!wouldMove}
                          className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                          onClick={() => onMove(sec.id)}
                        >
                          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{sec.name}</span>
                          {selectedSectionIds.has(sec.id) && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {selectedSectionIds.size === 1 ? "already here" : "partly here"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
