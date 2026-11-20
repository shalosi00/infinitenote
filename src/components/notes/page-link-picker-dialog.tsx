"use client";

/**
 * "Link to page…" picker (wave 13, OneNote "Copy Link to Page" parity).
 *
 * Lists every alive page across all notebooks with a breadcrumb meta line
 * ("notebook / section", the tag-filter-view pattern), case-insensitive
 * by title. The currently open page is excluded — a page linking to
 * itself is a dead entry. Clicking a row inserts the linked title
 * element on the open page (insertion + toast live in the caller).
 */
import { Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import type { PageMeta } from "@/lib/types";

export function PageLinkPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (page: PageMeta) => void;
}) {
  const pages = useAppStore((s) => s.pages);
  const sections = useAppStore((s) => s.sections);
  const notebooks = useAppStore((s) => s.notebooks);
  const selection = useAppStore((s) => s.selection);

  const alive = pages
    .filter((p) => p.deletedAt === null && p.id !== selection?.pageId)
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
        a.order - b.order,
    );

  const pathOf = (p: PageMeta) => {
    const sec = sections.find((s) => s.id === p.sectionId);
    const nb = sec ? notebooks.find((n) => n.id === sec.notebookId) : undefined;
    return [nb?.name, sec?.name].filter(Boolean).join(" / ") || "…";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="page-link-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> {"Link to page"}
          </DialogTitle>
          <DialogDescription>
            {
              "Puts a clickable link on this page — clicking it opens the chosen page."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto rounded-md border p-2">
          {alive.length === 0 ? (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="page-link-empty"
            >
              {"No other pages to link to yet — create another page first."}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {alive.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className="rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
                  data-testid="page-link-row"
                  title={`Link to "${page.title}"`}
                  aria-label={`Link to page ${page.title}`}
                  onClick={() => {
                    onPick(page);
                    onOpenChange(false);
                  }}
                >
                  <span
                    className="block truncate text-sm font-medium"
                    data-testid="page-link-name"
                  >
                    {page.title}
                  </span>
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    data-testid="page-link-meta"
                  >
                    {pathOf(page)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {
              "Renaming or moving the target page keeps the link working; trashing it breaks the link with an explicit notice."
            }
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
