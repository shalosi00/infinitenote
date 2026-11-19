"use client";

/**
 * Template picker + manager (issue #279).
 *
 * Opens with a target section (set by the sidebar's section menu or the
 * page-actions menu): clicking a row creates a page from that template in
 * the target section and selects it. Rows also offer delete with a confirm
 * step — OneNote's gallery manages templates in the same place it picks
 * them. The list re-reads on open AND after every delete (trash-dialog
 * pattern); pages already created from a template are never touched.
 */
import { useEffect, useState } from "react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppStore } from "@/lib/store";
import * as db from "@/lib/notes-db";
import { plural } from "@/lib/plural";
import { relativeVersionTime } from "@/lib/version-history";
import type { TemplateSummary } from "@/lib/page-templates";

export function TemplatesDialog() {
  const open = useAppStore((s) => s.templatesOpen);
  const setOpen = useAppStore((s) => s.setTemplatesOpen);
  const sectionId = useAppStore((s) => s.templatesTargetSectionId);
  const sections = useAppStore((s) => s.sections);
  const createFrom = useAppStore((s) => s.createPageFromTemplate);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);

  const target = sections.find((s) => s.id === sectionId);

  /** Re-list on open AND after every delete (trash-dialog pattern). */
  const refresh = () => {
    void db.listTemplates().then(setTemplates);
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleUse = async (tpl: TemplateSummary) => {
    if (!sectionId || creating) return;
    setCreating(true);
    try {
      const ok = await createFrom(sectionId, tpl.id);
      if (!ok) {
        toast.error("That template could not be read anymore.");
        return;
      }
      setOpen(false);
      toast.success(`New page created from "${tpl.name}".`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await db.deleteTemplate(deleting.id);
    setDeleting(null);
    refresh();
    toast.success("Template deleted.");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="templates-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" /> {"New page from template"}
            </DialogTitle>
            <DialogDescription>
              {target
                ? `Creates a page in "${target.name}" with the template's content and paper style.`
                : "Creates a page with the template's content and paper style."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-96 overflow-y-auto rounded-md border p-2">
            {templates.length === 0 ? (
              <p
                className="py-8 text-center text-sm text-muted-foreground"
                data-testid="templates-empty"
              >
                {
                  "No templates yet — open a page and choose \"Save as template\" from its page actions (⋯) menu."
                }
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    data-testid="template-row"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded text-left"
                      disabled={creating}
                      onClick={() => void handleUse(tpl)}
                      title={`Create a page from "${tpl.name}"`}
                      aria-label={`Use template ${tpl.name}`}
                    >
                      <span
                        className="block truncate text-sm font-medium"
                        data-testid="template-name"
                      >
                        {tpl.name}
                      </span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        data-testid="template-meta"
                      >
                        {plural(tpl.elementCount, "1 element", "# elements")} ·{" "}
                        {Math.max(1, Math.round(tpl.byteSize / 1024))} KB ·{" "}
                        {relativeVersionTime(tpl.createdAt, Date.now())}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete template ${tpl.name}`}
                      title="Delete template"
                      data-testid="template-delete"
                      disabled={creating}
                      onClick={() => setDeleting(tpl)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              {"Templates are saved on this device and included in notebook backups."}
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent data-testid="template-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{"Delete template?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${deleting?.name ?? ""}" will be removed from this device. Pages created from it stay untouched.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="template-delete-cancel">
              {"Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="template-delete-confirm"
              onClick={() => void handleDelete()}
            >
              {"Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
