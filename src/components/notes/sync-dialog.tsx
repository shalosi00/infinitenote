"use client";

/**
 * Sync dialog — phase 1 of file-based sync (issue #37).
 *
 * Two transports, one folder format:
 * - **Sync folder** (Chromium desktop, File System Access): connect a real
 *   directory that Syncthing/Nextcloud replicates; "Sync now" pulls remote
 *   changes, merges, and writes the merged state back.
 * - **Sync ZIP** (everywhere): download the folder as a ZIP, or merge one in
 *   from another device.
 *
 * The heavy lifting lives in src/lib/sync/*; this component only orchestrates
 * and renders the summary. Dialog open state lives in a tiny local store so
 * the sidebar button and note-app can share it without app-store churn.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { FolderSync, Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SyncSummary } from "@/lib/sync/merge";
import type { SyncFolderFiles } from "@/lib/sync/format";
import { summaryParts } from "@/lib/sync/summary";
import { parseSyncZip, zipSyncFolder } from "@/lib/sync/zip";
import { MANIFEST_PATH, SyncFormatError } from "@/lib/sync/format";
import {
  ensurePermission,
  isFsaSupported,
  pickSyncFolder,
  readSyncFolder,
  writeSyncFolder,
  type FsaDirectoryHandle,
} from "@/lib/sync/fsa";
import {
  clearSyncFolderHandle,
  loadSyncFolderHandle,
  saveSyncFolderHandle,
} from "@/lib/sync/local";
import { downloadBlob } from "@/lib/excalidraw-utils";

/* --------------------------- dialog open state -------------------------- */

interface SyncDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}
export const useSyncDialog = create<SyncDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/* ------------------------------ summary text ----------------------------- */

/**
 * Hook returning a locale-aware one-liner of what a sync changed on this
 * device. Parts come from the pure summaryParts(); each renders through the
 * active catalog's sync.w* ICU plural message.
 */
export function useSyncSummaryFormatter(): (s: SyncSummary) => string {
  const t = useTranslations("sync");
  return useCallback(
    (s: SyncSummary) => {
      const parts = summaryParts(s);
      if (parts.length === 0) return t("upToDate");
      return `${parts.map((p) => t(p.key, { count: p.count })).join(" · ")}.`;
    },
    [t]
  );
}

/* -------------------------------- component ------------------------------ */

export interface SyncOutcome {
  summary: SyncSummary;
  folder: SyncFolderFiles;
}

export interface SyncDialogProps {
  /**
   * Run one sync round inside note-app (it owns the canvas):
   * flushes pending canvas edits, merges (or exports when `files` is null),
   * refreshes the tree, reloads the canvas when the open page changed.
   */
  onRunSync: (files: SyncFolderFiles | null, opts?: { reloadCanvas?: boolean }) => Promise<SyncOutcome>;
}

export function SyncDialog({ onRunSync }: SyncDialogProps) {
  const open = useSyncDialog((s) => s.open);
  const setOpen = useSyncDialog((s) => s.setOpen);
  const t = useTranslations("sync");
  const formatSummary = useSyncSummaryFormatter();
  const [fsaSupported] = useState(() => typeof window !== "undefined" && isFsaSupported());
  const [folderHandle, setFolderHandle] = useState<FsaDirectoryHandle | null>(null);
  const [needsGrant, setNeedsGrant] = useState(false);
  const [busy, setBusy] = useState<"connect" | "sync" | "import" | "export" | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // load the remembered folder handle whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSummary(null);
    (async () => {
      const handle = await loadSyncFolderHandle();
      if (cancelled) return;
      if (!handle) {
        setFolderHandle(null);
        setNeedsGrant(false);
        return;
      }
      setFolderHandle(handle);
      // query (never request) — requesting needs a user gesture
      const granted = !handle.queryPermission || (await handle.queryPermission({ mode: "readwrite" })) === "granted";
      setNeedsGrant(!granted);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleConnect = useCallback(async () => {
    setBusy("connect");
    try {
      const handle = await pickSyncFolder();
      if (!handle) return; // cancelled or unsupported
      if (!(await ensurePermission(handle, "readwrite"))) {
        toast.error(t("toastDenied"));
        return;
      }
      await saveSyncFolderHandle(handle);
      setFolderHandle(handle);
      setNeedsGrant(false);
      toast.success(t("toastConnected", { name: handle.name }));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const handleRegrant = useCallback(async () => {
    if (!folderHandle) return;
    setBusy("connect");
    try {
      if (await ensurePermission(folderHandle, "readwrite")) {
        setNeedsGrant(false);
      } else {
        toast.error(t("toastDenied"));
      }
    } finally {
      setBusy(null);
    }
  }, [folderHandle, t]);

  const handleDisconnect = useCallback(async () => {
    await clearSyncFolderHandle();
    setFolderHandle(null);
    setNeedsGrant(false);
    toast(t("toastDisconnected"));
  }, [t]);

  const handleSyncNow = useCallback(async () => {
    if (!folderHandle) return;
    setBusy("sync");
    try {
      const files = await readSyncFolder(folderHandle);
      if (!files[MANIFEST_PATH]) {
        // No manifest = nothing mergeable. This covers the truly empty
        // folder AND the partially-written one that still holds stray
        // files (e.g. only trash.jsonl): initialize instead of erroring
        // with a raw "manifest.json is missing" (issue #105).
        const outcome = await onRunSync(null);
        await writeSyncFolder(folderHandle, outcome.folder);
        setSummary(t("summaryInitialized"));
        return;
      }
      const outcome = await onRunSync(files);
      await writeSyncFolder(folderHandle, outcome.folder);
      setSummary(formatSummary(outcome.summary));
      toast.success(formatSummary(outcome.summary));
    } catch (err) {
      // issue #86: never surface raw English SyncFormatError internals —
      // map the stable code to a localized message
      if (err instanceof SyncFormatError) {
        toast.error(t(`errors.${err.code}`));
      } else {
        console.error(err);
        toast.error(err instanceof Error ? err.message : t("toastSyncFailed"));
      }
    } finally {
      setBusy(null);
    }
  }, [folderHandle, onRunSync, t, formatSummary]);

  const handleImportZip = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setBusy("import");
      try {
        const files = await parseSyncZip(await file.arrayBuffer());
        const outcome = await onRunSync(files);
        setSummary(formatSummary(outcome.summary));
        toast.success(formatSummary(outcome.summary));
      } catch (err) {
        if (err instanceof SyncFormatError) {
          toast.error(t(`errors.${err.code}`)); // issue #86
        } else {
          console.error(err);
          toast.error(err instanceof Error ? err.message : t("toastZipFailed"));
        }
      } finally {
        setBusy(null);
      }
    },
    [onRunSync, t, formatSummary]
  );

  const handleExportZip = useCallback(async () => {
    setBusy("export");
    try {
      const outcome = await onRunSync(null);
      const blob = await zipSyncFolder(outcome.folder);
      downloadBlob(blob, `infinitenote-sync-${new Date().toISOString().slice(0, 10)}.zip`);
      setSummary(t("summaryZipDownloaded"));
      toast.success(t("toastZipDownloaded"));
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : t("toastExportFailed"));
    } finally {
      setBusy(null);
    }
  }, [onRunSync, t]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="sync-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="h-4 w-4" /> {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {fsaSupported ? (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("folderSection")}
              </h3>
              {folderHandle ? (
                <div className="flex flex-col gap-2" data-testid="sync-folder-connected">
                  <p className="text-sm text-muted-foreground" data-testid="sync-folder-name">
                    {t("folderLabel", { name: folderHandle.name })}
                  </p>
                  {needsGrant ? (
                    <Button size="sm" onClick={handleRegrant} disabled={busy !== null}>
                      {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {t("grant")}
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        data-testid="sync-now"
                        onClick={handleSyncNow}
                        disabled={busy !== null}
                      >
                        {busy === "sync" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {t("syncNow")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
                        {t("disconnect")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5"
                  data-testid="sync-connect"
                  onClick={handleConnect}
                  disabled={busy !== null}
                >
                  {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
                  {t("connect")}
                </Button>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("folderHint")}
              </p>
            </section>
          ) : (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {t("noFsa")}
            </p>
          )}

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("zipSection")}
            </h3>
            <div className="flex flex-wrap gap-2">
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                data-testid="sync-zip-input"
                onChange={(e) => {
                  void handleImportZip(e.target.files?.[0] ?? null);
                  e.target.value = ""; // allow re-importing the same file
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                data-testid="sync-import-zip"
                onClick={() => zipInputRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("importZip")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                data-testid="sync-export-zip"
                onClick={handleExportZip}
                disabled={busy !== null}
              >
                {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
                {t("exportZip")}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("zipHint")}
            </p>
          </section>

          {summary && (
            <p
              className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
              data-testid="sync-summary"
              role="status"
            >
              {summary}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
