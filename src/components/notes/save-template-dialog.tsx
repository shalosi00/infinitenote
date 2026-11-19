"use client";

/**
 * "Save as template" dialog (issue #279).
 *
 * The app shell orchestrates the actual save (it owns the canvas api:
 * flush pending edits → read the persisted scene → DB write) via the
 * onSave prop, which resolves true when the template was saved (the
 * dialog closes) and false after an explicit failure toast (the dialog
 * stays open for a retry). The dialog owns only the name input; it
 * prefills the current page's title — OneNote's own default.
 */
import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import { TEMPLATE_NAME_MAX } from "@/lib/page-templates";

export function SaveTemplateDialog({
  onSave,
}: {
  onSave: (name: string) => Promise<boolean>;
}) {
  const open = useAppStore((s) => s.saveTemplateOpen);
  const setOpen = useAppStore((s) => s.setSaveTemplateOpen);
  // the draft lives in the store: openSaveTemplate() pre-fills it with the
  // page title at OPEN time (rename-draft pattern; no setState-in-effect)
  const name = useAppStore((s) => s.saveTemplateName);
  const setName = useAppStore((s) => s.setSaveTemplateName);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await onSave(name.trim());
      if (saved) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) setOpen(o);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="save-template-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4" /> {"Save as template"}
          </DialogTitle>
          <DialogDescription>
            {
              "The page's content and paper style become a reusable template — saved on this device and included in notebook backups."
            }
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          maxLength={TEMPLATE_NAME_MAX}
          placeholder="Template name"
          aria-label="Template name"
          data-testid="template-name-input"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            {"Cancel"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            data-testid="save-template-confirm"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
