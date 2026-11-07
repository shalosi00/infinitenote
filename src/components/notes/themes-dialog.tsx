"use client";

/**
 * Themes gallery dialog (issue #55).
 *
 * A grid of theme cards, each previewing the accent via its light/dark
 * swatch hexes. Selecting a card applies the theme immediately — the
 * `data-theme` attribute lands on <html> and the choice is persisted to
 * localStorage — so the gallery doubles as a live preview and the dialog
 * can stay open while the user browses. Re-selecting the default clears
 * the attribute and the storage key.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  parseStoredTheme,
  THEMES,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "@/lib/themes";

export function ThemesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [active, setActive] = useState<ThemeId>(DEFAULT_THEME);

  // Re-read the persisted theme each time the gallery opens so the active
  // badge always reflects reality (storage may have changed while closed).
  useEffect(() => {
    if (!open) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration sync from an external store (localStorage)
      setActive(parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      /* storage unavailable — show the default as active */
    }
  }, [open]);

  const applyTheme = (id: ThemeId) => {
    applyThemeToDocument(document, id);
    try {
      if (id === DEFAULT_THEME) {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, id);
      }
    } catch {
      /* storage unavailable (private mode) — keep it session-only */
    }
    setActive(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="themes-dialog">
        <DialogHeader>
          <DialogTitle>Themes</DialogTitle>
          <DialogDescription>
            Accent colors layered on top of light and dark mode.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="listbox" aria-label="Themes">
          {THEMES.map((theme) => {
            const isActive = theme.id === active;
            return (
              <Button
                key={theme.id}
                type="button"
                variant="outline"
                aria-pressed={isActive}
                data-testid={`theme-card-${theme.id}`}
                className="flex h-auto flex-col items-start gap-2 p-3"
                onClick={() => applyTheme(theme.id)}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-1" aria-hidden="true">
                    <span
                      className="h-5 w-5 rounded-full border border-border"
                      style={{ backgroundColor: theme.preview.light }}
                    />
                    <span
                      className="-ml-2 h-5 w-5 rounded-full border border-border"
                      style={{ backgroundColor: theme.preview.dark }}
                    />
                  </span>
                  {isActive && (
                    <Check className="h-4 w-4 text-primary" aria-label="Active" data-testid={`theme-card-${theme.id}-active`} />
                  )}
                </span>
                <span className="text-sm font-normal">{theme.label}</span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
