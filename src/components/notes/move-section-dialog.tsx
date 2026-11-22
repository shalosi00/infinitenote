"use client";

/**
 * Move-section picker (issue #325, sub-sections phase 2): lists every
 * alive notebook with a "Top level" target plus its alive sections as
 * nest targets for one section — the OneNote "Move or Copy" dialog path
 * ("Right-click on the section … select 'Move or Copy' … choose the
 * notebook"). This is the keyboard/touch alternative to the sidebar's
 * drag gesture, which Joplin lacks entirely (its community keeps asking
 * for exactly this, discourse.joplinapp.org 2024).
 *
 * Targets inside the moved subtree are disabled (a section can never
 * nest inside itself — canReparent), and so is the section's current
 * home (already there — nothing to move). Section groups (issue #337)
 * appear as nest targets with their folder glyph; a GROUP mover has its
 * plain-section targets disabled (a group never nests under a plain
 * section — the Graph OneNote model), while any section may nest under
 * a group.
 */
import { FolderClosed, FolderInput, NotebookPen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { canReparent } from "@/lib/section-tree";
import { isSectionGroup } from "@/lib/section-groups";
import { byOrder, type Notebook, type Section } from "@/lib/types";

export function MoveSectionDialog({
  open,
  onOpenChange,
  notebooks,
  sections,
  sectionId,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebooks: Notebook[];
  sections: Section[];
  /** the section being moved (null = nothing selected) */
  sectionId: string | null;
  onMove: (targetNotebookId: string, targetParentId: string | null) => void;
}) {
  const moving = sections.find((s) => s.id === sectionId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-4 w-4" />
            {moving ? `Move "${moving.name}" to…` : "Move section to…"}
          </DialogTitle>
          <DialogDescription>
            {
              "Pick a notebook for a top-level move, or a section to nest it under. Cross-notebook moves are allowed — the section keeps its name, pages and sub-sections."
            }
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="flex flex-col gap-3 pr-3">
            {[...notebooks].sort(byOrder).map((nb) => {
              // already a top-level section of this notebook → no-op
              const topNoop =
                !!moving &&
                moving.notebookId === nb.id &&
                (moving.parentId ?? null) === null;
              return (
                <div key={nb.id}>
                  <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <NotebookPen className="h-3 w-3" /> {nb.name}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      data-testid="move-target-top"
                      data-notebook-id={nb.id}
                      aria-label={`Move to top level of ${nb.name}`}
                      disabled={!moving || topNoop}
                      className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      onClick={() => onMove(nb.id, null)}
                    >
                      <NotebookPen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {"Top level of "}
                        {nb.name}
                      </span>
                    </button>
                    {sections
                      .filter((s) => s.notebookId === nb.id)
                      .sort(byOrder)
                      .map((sec) => {
                        // self / own subtree / current parent → no-op
                        const noop =
                          !!moving &&
                          moving.parentId != null &&
                          (moving.parentId ?? null) === sec.id;
                        const allowed =
                          !!moving && canReparent(sections, moving.id, sec.id);
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            data-testid="move-target-section"
                            data-section-id={sec.id}
                            aria-label={`Move under ${nb.name} / ${sec.name}`}
                            disabled={!allowed || noop}
                            className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            onClick={() => onMove(sec.notebookId, sec.id)}
                          >
                            {isSectionGroup(sec) ? (
                              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <FolderInput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1 truncate">{sec.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
