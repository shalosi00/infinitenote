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
import { formatSyncSummary } from "@/lib/sync/summary";
import { parseSyncZip, zipSyncFolder } from "@/lib/sync/zip";
import { MANIFEST_PATH, SYNC_ERROR_MESSAGES, SyncFormatError } from "@/lib/sync/format";
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
  const formatSummary = formatSyncSummary;
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
        toast.error("Folder permission denied.");
        return;
      }
      await saveSyncFolderHandle(handle);
      setFolderHandle(handle);
      setNeedsGrant(false);
      toast.success(`Syncing with \"${handle.name}\".`);
    } finally {
      setBusy(null);
    }
  }, []);

  const handleRegrant = useCallback(async () => {
    if (!folderHandle) return;
    setBusy("connect");
    try {
      if (await ensurePermission(folderHandle, "readwrite")) {
        setNeedsGrant(false);
      } else {
        toast.error("Folder permission denied.");
      }
    } finally {
      setBusy(null);
    }
  }, [folderHandle]);

  const handleDisconnect = useCallback(async () => {
    await clearSyncFolderHandle();
    setFolderHandle(null);
    setNeedsGrant(false);
    toast("Sync folder disconnected.");
  }, []);

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
        setSummary("Folder initialized with this device's notes.");
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
        toast.error(SYNC_ERROR_MESSAGES[err.code]);
      } else {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Sync failed.");
      }
    } finally {
      setBusy(null);
    }
  }, [folderHandle, onRunSync, formatSummary]);

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
          toast.error(SYNC_ERROR_MESSAGES[err.code]); // issue #86
        } else {
          console.error(err);
          toast.error(err instanceof Error ? err.message : "Could not merge that sync ZIP.");
        }
      } finally {
        setBusy(null);
      }
    },
    [onRunSync, formatSummary]
  );

  const handleExportZip = useCallback(async () => {
    setBusy("export");
    try {
      const outcome = await onRunSync(null);
      const blob = await zipSyncFolder(outcome.folder);
      downloadBlob(blob, `infinitenote-sync-${new Date().toISOString().slice(0, 10)}.zip`);
      setSummary("Sync ZIP downloaded — open it on your other device and import it there.");
      toast.success("Sync ZIP downloaded.");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }, [onRunSync]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="sync-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSync className="h-4 w-4" /> {"Sync your notes"}
          </DialogTitle>
          <DialogDescription>
            {"Keep devices in sync through a folder your file-sync tool replicates, or a ZIP you carry over. Everything merges locally — nothing leaves your devices."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {fsaSupported ? (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {"Sync folder (Chromium desktop)"}
              </h3>
              {folderHandle ? (
                <div className="flex flex-col gap-2" data-testid="sync-folder-connected">
                  <p className="text-sm text-muted-foreground" data-testid="sync-folder-name">
                    {`Folder: ${folderHandle.name}`}
                  </p>
                  {needsGrant ? (
                    <Button size="sm" onClick={handleRegrant} disabled={busy !== null}>
                      {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {"Grant access again"}
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
                        {"Sync now"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
                        {"Disconnect"}
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
                  {"Connect folder…"}
                </Button>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {"Point it at a folder Syncthing, Nextcloud or Dropbox replicates. The app re-scans it in the background when the window regains focus."}
              </p>
            </section>
          ) : (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {"This browser can't connect a live folder (File System Access API). Use the ZIP flow below — on Chromium desktop you get folder mode."}
            </p>
          )}

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {"Via ZIP (any device)"}
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
                {"Merge sync ZIP…"}
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
                {"Download sync ZIP"}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {"Merging pulls in new pages and updates; when both devices edited a page, the newer one wins and the other survives as a “(conflict …)” copy."}
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
