"use client";

/**
 * "Password protection" dialog (issue #371) — OneNote's section password
 * flow: Set password / Change password / Remove password, each with an
 * optional hint shown on the unlock card. The store owns the draft state
 * (the rename-draft pattern — no setState-in-effect) and maps the db
 * result to the explicit toast; the dialog closes only on success.
 *
 * The honest no-recovery rule is stated in the set-mode description:
 * a forgotten password cannot be recovered (OneNote's own rule), so the
 * hint is the only lifeline.
 */
import { useState } from "react";
import { Lock } from "lucide-react";
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
import { displayHint } from "@/lib/section-protection";

const RESULT_TOASTS: Record<string, string> = {
  done: "",
  invalid: "That password is not correct.",
  "invalid-section": "This section cannot be protected (missing, trashed, or a section group).",
};

export function SectionProtectionDialog() {
  const dialog = useAppStore((s) => s.protectionDialog);
  const setOpen = useAppStore((s) => s.closeProtectionDialog);
  const protectSection = useAppStore((s) => s.protectSection);
  const changeSectionPassword = useAppStore((s) => s.changeSectionPassword);
  const removeSectionPassword = useAppStore((s) => s.removeSectionPassword);
  const sections = useAppStore((s) => s.sections);

  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [current, setCurrent] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!dialog) return null;

  const section = sections.find((s) => s.id === dialog.sectionId);
  if (!section) return null;

  const close = () => {
    setPassword("");
    setAgain("");
    setCurrent("");
    setHint("");
    setError(null);
    setBusy(false);
    setOpen();
  };

  const run = async (action: () => Promise<"done" | "invalid" | "invalid-section">) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result === "done") {
        setOpen();
        close();
      } else {
        setError(RESULT_TOASTS[result] ?? "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    dialog.mode === "set"
      ? "Set section password"
      : dialog.mode === "change"
        ? "Change section password"
        : "Remove section password";

  const canSubmit =
    !busy &&
    (dialog.mode === "set"
      ? password.length > 0 && password === again
      : dialog.mode === "change"
        ? current.length > 0 && password.length > 0 && password === again
        : current.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    if (dialog.mode === "set") {
      void run(() => protectSection(section.id, password, hint || null));
    } else if (dialog.mode === "change") {
      void run(() => changeSectionPassword(section.id, current, password, hint || null));
    } else {
      void run(() => removeSectionPassword(section.id, current));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!busy && !o) close();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="section-protection-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> {title} — {section.name}
          </DialogTitle>
          <DialogDescription>
            {dialog.mode === "set" &&
              "The section's pages are encrypted on this device. A forgotten password cannot be recovered — write the hint down (OneNote's own rule)."}
            {dialog.mode === "change" &&
              "Enter the current password once, then the new one. Every page is re-encrypted under the new password."}
            {dialog.mode === "remove" &&
              "Enter the password to decrypt the section's pages and remove the lock."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          {dialog.mode !== "set" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="protection-current" className="text-sm font-medium">
                {"Current password"}
              </label>
              <Input
                id="protection-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
                data-testid="protection-current-input"
              />
            </div>
          )}
          {dialog.mode !== "remove" && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="protection-password" className="text-sm font-medium">
                  {dialog.mode === "change" ? "New password" : "Password"}
                </label>
                <Input
                  id="protection-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={dialog.mode === "set"}
                  data-testid="protection-password-input"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="protection-again" className="text-sm font-medium">
                  {"Repeat password"}
                </label>
                <Input
                  id="protection-again"
                  type="password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  data-testid="protection-again-input"
                />
                {again.length > 0 && password !== again && (
                  <p className="text-xs text-destructive" data-testid="protection-mismatch">
                    {"The passwords do not match."}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="protection-hint" className="text-sm font-medium">
                  {"Hint (optional)"}
                </label>
                <Input
                  id="protection-hint"
                  type="text"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="Shown on the unlock card"
                  data-testid="protection-hint-input"
                />
              </div>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" data-testid="protection-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy} data-testid="protection-cancel">
            {"Cancel"}
          </Button>
          <Button onClick={submit} disabled={!canSubmit} data-testid="protection-submit">
            {dialog.mode === "set"
              ? "Protect section"
              : dialog.mode === "change"
                ? "Change password"
                : "Remove password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The unlock card rendered IN PLACE OF the canvas when the selected
 * page's section is protected and this session holds no key (OneNote's
 * locked state). Wrong passwords show an inline error; the hint (when
 * set) is displayed; a successful unlock swaps the card for the canvas.
 */
export function SectionUnlockCard({
  sectionId,
  sectionName,
  hint,
}: {
  sectionId: string;
  sectionName: string;
  hint: string | null;
}) {
  const unlockSection = useAppStore((s) => s.unlockSection);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unlockSection(sectionId, password);
      if (result !== "done") setError("That password is not correct.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-muted/30"
      data-testid="section-unlock-card"
    >
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium" data-testid="unlock-title">
            {`"${sectionName}" is locked`}
          </p>
          <p className="text-xs text-muted-foreground">
            {"Enter the section's password to open its pages."}
          </p>
        </div>
        {hint && (
          <p
            className="mt-3 rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground"
            data-testid="unlock-hint"
          >
            {`Hint: ${displayHint(hint)}`}
          </p>
        )}
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Section password"
            autoFocus
            aria-label={`Password for ${sectionName}`}
            data-testid="unlock-password-input"
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="unlock-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!password || busy} data-testid="unlock-submit">
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** The toast text the app shell shows after a successful Set password. */
export const PROTECTION_TOASTS = {
  protected: (name: string) => `"${name}" is now protected with a password.`,
  changed: (name: string) => `Password changed for "${name}".`,
  removed: (name: string) => `Password removed from "${name}".`,
  locked: (name: string) => `"${name}" is locked.`,
  unlocked: (name: string) => `"${name}" is unlocked.`,
} as const;
