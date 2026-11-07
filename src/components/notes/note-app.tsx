"use client";

/**
 * InfiniteNote — top-level application shell.
 * Layout: header + (sidebar | canvas). Mobile: sidebar becomes a drawer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Download,
  FileDown,
  FileJson,
  FileUp,
  Image as ImageIcon,
  LayoutTemplate,
  Menu,
  Mic,
  Moon,
  NotebookPen,
  PackageOpen,
  PenLine,
  Printer,
  Search,
  Square,
  Sun,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "@/lib/store";
import { useTranslations } from "next-intl";
import type { CanvasApi, SaveState } from "@/lib/excalidraw-utils";
import { downloadBlob } from "@/lib/excalidraw-utils";
import type { PageBackground, PageMeta } from "@/lib/types";
import * as db from "@/lib/notes-db";
import { addTag, collectTags, removeTag, type TagCount } from "@/lib/tags";
import { Sidebar } from "./sidebar";
import CanvasEditor from "./canvas-editor";
import { SearchDialog } from "./search-dialog";
import { TrashDialog } from "./trash-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { SyncDialog, useSyncSummaryFormatter, type SyncOutcome } from "./sync-dialog";
import { usePWA } from "./use-pwa";
import { runSync } from "@/lib/sync/db";
import { exportSyncFolder, loadSyncFolderHandle } from "@/lib/sync/local";
import { readSyncFolder, writeSyncFolder } from "@/lib/sync/fsa";
import type { SyncFolderFiles } from "@/lib/sync/format";
import type { SyncSummary } from "@/lib/sync/merge";
import {
  buildRecordingFileName,
  formatDuration,
  pickRecorderMimeType,
  recorderExtensionForMime,
} from "@/lib/audio-notes";

/** Result summary for an export-only round (no merge happened). */
const NO_CHANGES_SUMMARY: SyncSummary = {
  notebooksAdded: 0,
  sectionsAdded: 0,
  pagesAdded: 0,
  pagesUpdated: 0,
  treeUpdated: 0,
  pagesConflicted: 0,
  pagesDeleted: 0,
  treeDeleted: 0,
  pagesPurged: 0,
  treePurged: 0,
};

export default function NoteApp() {
  const t = useTranslations("app");
  const tCommon = useTranslations("common");
  const tSync = useTranslations("sync");
  const tPaper = useTranslations("paper");
  const formatSummary = useSyncSummaryFormatter();
  const {
    loaded,
    loadError,
    selection,
    saveIndicator,
    load,
    addNotebook,
    renamePage,
    setPageBackground,
    setPageTags,
    restoreBackupArchive,
  } = useAppStore();
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const canvasApi = useRef<CanvasApi | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  /** Bumped after a sync replaced the open page — remounts the canvas (fresh initialData). */
  const [sceneEpoch, setSceneEpoch] = useState(0);

  /* ------------------------- audio recording (issue #67) --------------- */

  /** Wall-clock ms when the current recording started; null = not recording. */
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  /** Whole seconds elapsed in the current recording (drives the timer label). */
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stop the timer, release the mic, forget the recorder. Safe to call twice. */
  const teardownRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecordingStartedAt(null);
    setRecordingElapsed(0);
  }, []);

  // release the mic if the app unmounts mid-recording
  useEffect(() => teardownRecording, [teardownRecording]);

  /** Insert a finished take on the current page, as an audio block. */
  const insertRecording = useCallback(
    async (blob: Blob, mimeType: string, seconds: number) => {
      const name = buildRecordingFileName(recorderExtensionForMime(mimeType));
      const file = new File([blob], name, { type: mimeType });
      await canvasApi.current?.importFiles([file]);
      toast.success(t("toastRecordingInserted", { duration: formatDuration(seconds) }));
    },
    [t]
  );

  const startRecording = useCallback(async () => {
    if (recordingStartedAt !== null) return;
    if (!canvasApi.current) {
      toast.error(t("toastOpenFirstImport"));
      return;
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      toast.error(t("toastRecorderUnsupported"));
      return;
    }
    const mimeType = pickRecorderMimeType((m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
      toast.error(t("toastRecorderUnsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast.error(t("toastMicDenied"));
      } else {
        toast.error(t("toastMicFailed"));
      }
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      toast.error(t("toastRecorderUnsupported"));
      return;
    }
    const startedAt = Date.now();
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType;
      const seconds = (Date.now() - startedAt) / 1000;
      const blob = new Blob(chunks, { type });
      teardownRecording();
      if (blob.size > 0) {
        void insertRecording(blob, type, seconds);
      } else {
        toast.error(t("toastMicFailed"));
      }
    };
    recorder.start(250); // timeslice: data arrives even on abrupt stops
    streamRef.current = stream;
    recorderRef.current = recorder;
    setRecordingStartedAt(startedAt);
    setRecordingElapsed(0);
    timerRef.current = setInterval(() => {
      setRecordingElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  }, [recordingStartedAt, t, teardownRecording, insertRecording]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // onstop inserts the clip + tears down
    } else {
      teardownRecording();
    }
  }, [teardownRecording]);

  const currentPage = useAppStore((s) =>
    s.selection ? s.pages.find((p) => p.id === s.selection!.pageId) ?? null : null
  );

  const pages = useAppStore((s) => s.pages);
  const allTags = useMemo(() => collectTags(pages), [pages]);

  useEffect(() => {
    // load() resets its single-flight guard on failure (issue #77), so the
    // error screen's Retry button can simply call it again. The catch keeps
    // a rejected boot from surfacing as an unhandled rejection.
    void load().catch(() => undefined);
  }, [load]);

  usePWA();

  // Test hook — full data reset for E2E runs (?e2e=1 only)
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("e2e")) return;
    (window as unknown as Record<string, unknown>).__NOTE_RESET__ = async () => {
      const dbMod = await import("@/lib/notes-db");
      await dbMod.eraseAllData();
      window.location.reload();
    };
  }, []);

  // global shortcuts: Ctrl/Cmd+K opens search, Ctrl/Cmd+Alt+N starts a quick note.
  // Capture phase: the Excalidraw container consumes keydowns while focused,
  // so bubble-phase window listeners never see shortcuts mid-drawing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAppStore.getState().setSearchOpen(true);
      }
      // OneNote's quick capture is Win+Alt+N — the web equivalent is Ctrl/Cmd+Alt+N.
      // Must not fire while typing in an input/textarea (some IMEs use it).
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (mod && e.altKey && e.key.toLowerCase() === "n" && !typing) {
        e.preventDefault();
        void useAppStore.getState().createQuickNote();
      }
      // shortcuts cheatsheet (issue #28): ? (Shift+/) or Ctrl/Cmd+/, also
      // from the sidebar footer button. Never while typing — "?" is a
      // perfectly legal character in notes and inputs. stopPropagation keeps
      // the embedded Excalidraw from opening its own help modal on "?".
      if ((e.key === "?" || (mod && !e.altKey && e.key === "/")) && !typing) {
        e.preventDefault();
        e.stopPropagation();
        useAppStore.getState().setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // quick capture focus: when the store bumps canvasFocus (quick note / Today),
  // move keyboard focus onto the freshly mounted canvas container so typing and
  // shortcuts work immediately. The shell never remounts, so the ref reliably
  // remembers what was already applied across page switches.
  const canvasFocus = useAppStore((s) => s.canvasFocus);
  const appliedFocus = useRef(0);
  useEffect(() => {
    if (canvasFocus === appliedFocus.current) return;
    appliedFocus.current = canvasFocus;
    // give the new page's canvas a beat to mount before grabbing the element
    const timer = setTimeout(() => {
      const started = Date.now();
      const tryFocus = () => {
        const el = document.querySelector<HTMLElement>(".excalidraw");
        if (el) {
          el.focus();
          return;
        }
        if (Date.now() - started < 2_000) setTimeout(tryFocus, 50);
      };
      tryFocus();
    }, 120);
    return () => clearTimeout(timer);
  }, [canvasFocus]);

  const handleApiReady = useCallback((api: CanvasApi) => {
    canvasApi.current = api;
  }, []);

  const handleSaveIndicator = useCallback((state: SaveState | "saving" | "saved" | "error") => {
    useAppStore.getState().setSaveIndicator(state);
  }, []);

  const showToast = useCallback((message: string) => toast(message), []);

  /* ------------------------------- sync -------------------------------- */

  /**
   * One sync round (issue #37): flush canvas edits, merge the given folder
   * (or export-only when null), refresh the tree, and remount the canvas
   * when the open page's content changed so the pulled scene is visible.
   */
  const handleRunSync = useCallback(
    async (files: SyncFolderFiles | null, opts?: { reloadCanvas?: boolean }): Promise<SyncOutcome> => {
      await canvasApi.current?.flushSave();
      const openPageId = useAppStore.getState().selection?.pageId ?? null;
      const before = openPageId ? await db.getPageContent(openPageId) : null;

      const outcome: SyncOutcome = files
        ? await runSync(files)
        : { summary: NO_CHANGES_SUMMARY, folder: await exportSyncFolder() };

      await useAppStore.getState().refresh();
      const afterPageId = useAppStore.getState().selection?.pageId ?? openPageId;
      const after = afterPageId ? await db.getPageContent(afterPageId) : null;
      const contentChanged = afterPageId !== openPageId || JSON.stringify(after) !== JSON.stringify(before);
      if (contentChanged && (opts?.reloadCanvas ?? true)) {
        // remount: the canvas' initialData re-reads the merged scene; the
        // stale stash must never flush over it
        canvasApi.current?.discardPendingEdits();
        setSceneEpoch((e) => e + 1);
      }
      return outcome;
    },
    []
  );

  /** Foreground re-scan of the connected sync folder (desktop Chromium). */
  useEffect(() => {
    let lastRun = 0;
    let running = false;
    const onFocus = async () => {
      if (document.visibilityState !== "visible" || running || Date.now() - lastRun < 30_000)
        return;
      running = true;
      try {
        const handle = await loadSyncFolderHandle();
        if (!handle?.queryPermission) return;
        if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return;
        lastRun = Date.now();
        const files = await readSyncFolder(handle);
        if (!files["manifest.json"]) return; // empty/foreign — wait for manual sync
        const outcome = await handleRunSync(files, {
          // never discard in-progress edits: defer to the next round instead
          reloadCanvas: !canvasApi.current?.hasPendingEdits(),
        });
        await writeSyncFolder(handle, outcome.folder);
        const s = outcome.summary;
        const changed =
          s.pagesAdded + s.pagesUpdated + s.pagesConflicted + s.pagesDeleted +
          s.treeDeleted + s.treeUpdated + s.notebooksAdded + s.sectionsAdded;
        if (changed) toast(tSync("autoSync", { summary: formatSummary(s) }));
      } catch {
        /* background re-scan stays silent — manual sync surfaces errors */
      } finally {
        running = false;
      }
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [handleRunSync, tSync, formatSummary]);

  /* ----------------------------- import ------------------------------- */

  const importInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => importInputRef.current?.click();

  const handleImportFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!canvasApi.current) {
      toast.error(t("toastOpenFirstImport"));
      return;
    }
    await canvasApi.current.importFiles(Array.from(files));
  };

  const handleRestoreBackup = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    try {
      const json = await file.text();
      const count = await restoreBackupArchive(json);
      toast.success(t("toastRestored", { count }));
    } catch (err) {
      console.error(err);
      toast.error(t("toastRestoreFailed"));
    }
  };

  /* ------------------------------ export ------------------------------- */

  const handleExport = async (kind: "png" | "svg" | "scene" | "pdf-portrait" | "pdf-landscape" | "backup") => {
    if (kind === "backup") {
      const json = await db.buildBackup();
      // reuse the shared helper (issue #74): it appends the anchor and defers
      // revoking the object URL, so the download cannot race the revocation
      // in Safari/Firefox the way a hand-rolled synchronous click could
      downloadBlob(
        new Blob([json], { type: "application/json" }),
        `infinitenote-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
      toast.success(t("toastBackupDownloaded"));
      return;
    }
    if (!canvasApi.current || !currentPage) {
      toast.error(t("toastOpenFirstExport"));
      return;
    }
    try {
      if (kind === "png") await canvasApi.current.exportPng();
      if (kind === "svg") await canvasApi.current.exportSvg();
      if (kind === "scene") await canvasApi.current.exportSceneFile();
      if (kind === "pdf-portrait") await canvasApi.current.exportPdf("portrait");
      if (kind === "pdf-landscape") await canvasApi.current.exportPdf("landscape");
    } catch (err) {
      // empty page etc. — surface instead of failing silently
      toast.error(err instanceof Error ? err.message : t("toastExportFailed"));
    }
  };

  /* --------------------------- drag & drop ----------------------------- */

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    await handleImportFiles(e.dataTransfer.files);
  };

  /* ------------------------------- render ------------------------------ */

  if (!loaded) {
    // Boot failed (e.g. IndexedDB blocked): offer a retry instead of the
    // infinite "Opening…" spinner (issue #77). load() cleared its cached
    // promise on failure, so retrying really re-runs the boot.
    if (loadError) {
      return (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
              <NotebookPen className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("loadFailed")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("loadFailedBody")}</p>
            </div>
            <Button onClick={() => void load().catch(() => undefined)} className="gap-2">
              <NotebookPen className="h-4 w-4" /> {t("retry")}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <NotebookPen className="h-8 w-8 animate-pulse" />
          <p className="text-sm">{t("opening")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ------------------------------ header ------------------------------ */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:hidden"
          aria-label={t("openNavigation")}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 px-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <NotebookPen className="h-4 w-4" />
          </div>
          <span className="hidden text-sm font-semibold sm:inline">InfiniteNote</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="ml-2 gap-2 text-muted-foreground"
          onClick={() => useAppStore.getState().setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
          <span className="hidden lg:inline">{t("searchPages")}</span>
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium lg:inline">
            Ctrl K
          </kbd>
        </Button>

        <div className="flex-1" />

        {/* import */}
        <input
          ref={importInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.docx,.html,.htm,.mht,.mhtml,.txt,.md,.markdown,.csv,.json,.log,.yaml,.yml,.excalidraw,.excalidraw.json,audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.weba,.opus"
          aria-label={t("importFiles")}
          onChange={(e) => {
            void handleImportFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={backupInputRef}
          type="file"
          className="hidden"
          accept="application/json,.json"
          aria-label={t("restoreBackupFile")}
          onChange={(e) => {
            void handleRestoreBackup(e.target.files);
            e.target.value = "";
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">{t("import")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t("insertInto")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={openFilePicker}>
              <ImageIcon /> {t("importItems")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("library")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => backupInputRef.current?.click()}>
              <FileJson /> {t("restoreBackup")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* audio recording (issue #67) */}
        {recordingStartedAt === null ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={t("recordAudio")}
            title={t("recordAudio")}
            data-testid="record-audio"
            onClick={() => void startRecording()}
          >
            <Mic className="h-4 w-4" />
          </Button>
        ) : (
          <div
            className="flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 dark:border-red-900 dark:bg-red-950/60"
            data-testid="recording-indicator"
          >
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
            <span
              className="min-w-[2.25rem] text-xs font-semibold tabular-nums text-red-700 dark:text-red-300"
              data-testid="recording-timer"
            >
              {formatDuration(recordingElapsed)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("stopRecording")}
              title={t("stopRecording")}
              data-testid="stop-recording"
              onClick={stopRecording}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          </div>
        )}

        {/* export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t("export")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t("exportCurrent")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void handleExport("scene")}>
              <FileDown /> {t("exportScene")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("png")}>
              <ImageIcon /> {t("exportPng")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("svg")}>
              <FileUp /> {t("exportSvg")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="export-pdf-submenu" className="gap-2">
                <Printer /> {t("exportPdf")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem
                  data-testid="export-pdf-portrait"
                  onClick={() => void handleExport("pdf-portrait")}
                >
                  <Printer /> {t("pdfPortrait")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="export-pdf-landscape"
                  onClick={() => void handleExport("pdf-landscape")}
                >
                  <Printer /> {t("pdfLandscape")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("exportEverything")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void handleExport("backup")}>
              <PackageOpen /> {t("exportBackup")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label={t("toggleTheme")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>

      {/* ------------------------------- body ------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r md:block" data-testid="sidebar">
          <Sidebar />
        </aside>

        {/* mobile drawer */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">{t("navigation")}</SheetTitle>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* main */}
        <main
          className="relative flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
        >
          {currentPage ? (
            <>
              {/* page title bar */}
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                {titleDraft !== null ? (
                  <Input
                    autoFocus
                    className="h-8 max-w-sm"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => {
                      if (titleDraft.trim() && titleDraft.trim() !== currentPage.title) {
                        void renamePage(currentPage.id, titleDraft.trim());
                      }
                      setTitleDraft(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setTitleDraft(null);
                    }}
                    aria-label={t("pageTitle")}
                  />
                ) : (
                  <button
                    type="button"
                    className="truncate rounded px-1 py-1 text-left text-sm font-medium hover:bg-muted"
                    title={t("clickToRename")}
                    onClick={() => setTitleDraft(currentPage.title)}
                  >
                    {currentPage.title}
                  </button>
                )}
                <div className="flex-1" />

                {/* page tags */}
                <TagPicker
                  page={currentPage}
                  allTags={allTags}
                  onSetTags={(tags) => void setPageTags(currentPage.id, tags)}
                />

                {/* page paper style */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-muted-foreground"
                      aria-label={tPaper("background")}
                      data-testid="background-picker"
                    >
                      <LayoutTemplate className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {tPaper((currentPage.background ?? "plain") as "plain")}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" data-testid="paper-menu">
                    <DropdownMenuLabel>{tPaper("style")}</DropdownMenuLabel>
                    {(["plain", "ruled", "grid"] as const).map((kind) => (
                      <DropdownMenuItem
                        key={kind}
                        role="menuitemradio"
                        aria-checked={(currentPage.background ?? "plain") === kind}
                        data-testid={`background-${kind}`}
                        className="gap-2"
                        onClick={() => void setPageBackground(currentPage.id, kind)}
                      >
                        <PaperSwatch kind={kind} />
                        {tPaper(kind)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <span
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  data-testid="save-indicator"
                  aria-live="polite"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  {saveIndicator === "saving"
                    ? tCommon("saving")
                    : saveIndicator === "error"
                      ? tCommon("saveFailed")
                      : saveIndicator === "saved"
                        ? tCommon("saved")
                        : ""}
                </span>
              </div>

              {/* canvas */}
              <div className="relative min-h-0 flex-1">
                <CanvasEditor
                  key={`${currentPage.id}:${sceneEpoch}`}
                  pageId={currentPage.id}
                  title={currentPage.title}
                  theme={theme}
                  background={(currentPage.background ?? "plain") as PageBackground}
                  onApiReady={handleApiReady}
                  onSaveIndicator={handleSaveIndicator}
                  onToast={showToast}
                />
              </div>
            </>
          ) : (
            <EmptyState onCreateNotebook={() => void addNotebook()} />
          )}

          {dropActive && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="rounded-xl border-2 border-dashed border-primary/50 px-10 py-8 text-center">
                <Upload className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-2 text-sm font-medium">{t("dropTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("dropBody")}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      <SearchDialog />
      <TrashDialog />
      <ShortcutsDialog />
      <SyncDialog onRunSync={handleRunSync} />
      <Toaster position="bottom-center" richColors closeButton />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tag picker (page header)                                              */
/* ------------------------------------------------------------------ */

function TagPicker({
  page,
  allTags,
  onSetTags,
}: {
  page: PageMeta;
  allTags: TagCount[];
  onSetTags: (tags: string[]) => void;
}) {
  const t = useTranslations("tags");
  const [draft, setDraft] = useState("");
  const tags = page.tags ?? [];

  const commit = (raw: string) => {
    const next = addTag(tags, raw);
    if (next !== tags) onSetTags(next);
    setDraft("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          aria-label={t("title")}
          data-testid="tag-picker"
        >
          <Tags className="h-4 w-4" />
          {tags.length > 0 && <span data-testid="tag-count">{tags.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-testid="tag-menu">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("title")}
        </p>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("none")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="tag-chips">
            {tags.map((chip) => (
              <span
                key={chip}
                data-testid={`tag-chip-${chip}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {chip}
                <button
                  type="button"
                  aria-label={t("removeTag", { tag: chip })}
                  data-testid={`tag-chip-remove-${chip}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onSetTags(removeTag(tags, chip))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              commit(draft);
            }
          }}
          placeholder={t("addTag")}
          className="mt-2 h-8 text-sm"
          aria-label={t("addTagAria")}
          data-testid="tag-input"
        />
        {allTags.length > 0 && (
          <>
            <Separator className="my-2" />
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("existing")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.slice(0, 8).map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  data-testid={`tag-quick-add-${tag}`}
                  className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                  title={t("quickAddTitle", { tag, count })}
                  onClick={() => commit(tag)}
                >
                  + {tag}
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* paper style swatch                                                    */
/* ------------------------------------------------------------------ */

function PaperSwatch({ kind }: { kind: PageBackground }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-5 shrink-0 rounded-[3px] border border-current opacity-70"
      style={{
        backgroundImage:
          kind === "ruled"
            ? "repeating-linear-gradient(to bottom, transparent 0, transparent 3px, currentColor 3px, currentColor 4px)"
            : kind === "grid"
              ? "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)"
              : "none",
        backgroundSize: kind === "grid" ? "5px 5px, 5px 5px" : undefined,
        backgroundPosition: kind === "grid" ? "-1px -1px, -1px -1px" : undefined,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* empty state                                                          */
/* ------------------------------------------------------------------ */

function EmptyState({ onCreateNotebook }: { onCreateNotebook: () => void }) {
  const t = useTranslations("empty");
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <NotebookPen className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("body")}
          </p>
        </div>
        <Button onClick={onCreateNotebook} className="gap-2">
          <NotebookPen className="h-4 w-4" /> {t("create")}
        </Button>
      </div>
    </div>
  );
}