"use client";

/**
 * Keyboard shortcut cheatsheet dialog (issue #28). Data comes from
 * src/lib/shortcuts.ts — the single source of truth; this component only
 * renders it per platform.
 */
import { useState } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import { SHORTCUT_GROUPS, displayKeys, isApplePlatform } from "@/lib/shortcuts";

export function ShortcutsDialog() {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  // resolved once lazily on first render — userAgent never changes, and the
  // dialog content only mounts on client interaction, so no SSR mismatch
  const [apple] = useState(() =>
    typeof navigator !== "undefined" ? isApplePlatform(navigator.userAgent) : false
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Everything you can do without touching the mouse.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 pr-3" data-testid="shortcuts-dialog">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h3>
                <dl className="flex flex-col gap-0.5">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.keys + entry.description}
                      className="flex min-h-8 items-center gap-3 rounded-md px-1 py-0.5"
                    >
                      <dt className="flex w-36 shrink-0 flex-wrap items-center gap-1">
                        {displayKeys(entry.keys, apple)
                          .split("+")
                          .map((part, i, all) => (
                            <span key={i} className="flex items-center gap-1">
                              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none">
                                {part.trim()}
                              </kbd>
                              {i < all.length - 1 && <span className="text-[10px] text-muted-foreground">+</span>}
                            </span>
                          ))}
                      </dt>
                      <dd className="min-w-0 flex-1 text-sm text-muted-foreground">
                        {entry.description}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
