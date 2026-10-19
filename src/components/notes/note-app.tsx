"use client";

/**
 * InfiniteNote — top-level application shell.
 * Layout: header + (sidebar | canvas). Mobile: sidebar becomes a drawer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Download,
  FileDown,
  FileJson,
  FileUp,
  Image as ImageIcon,
  Menu,
  Moon,
  NotebookPen,
  PackageOpen,
  PenLine,
  Search,
  Sun,
  Upload,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/lib/store";
import type { CanvasApi, SaveState } from "@/lib/excalidraw-utils";
import * as db from "@/lib/notes-db";
import { Sidebar } from "./sidebar";
import CanvasEditor from "./canvas-editor";
import { SearchDialog } from "./search-dialog";
import { TrashDialog } from "./trash-dialog";
import { usePWA } from "./use-pwa";

export default function NoteApp() {
  const {
    loaded,
    selection,
    saveIndicator,
    load,
    addNotebook,
    renamePage,
    restoreBackupArchive,
  } = useAppStore();
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const canvasApi = useRef<CanvasApi | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const currentPage = useAppStore((s) =>
    s.selection ? s.pages.find((p) => p.id === s.selection!.pageId) ?? null : null
  );

  useEffect(() => {
    void load();
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

  // global shortcut: Ctrl/Cmd+K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAppStore.getState().setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleApiReady = useCallback((api: CanvasApi) => {
    canvasApi.current = api;
  }, []);

  const handleSaveIndicator = useCallback((state: SaveState | "saving" | "saved" | "error") => {
    useAppStore.getState().setSaveIndicator(state);
  }, []);

  const showToast = useCallback((message: string) => toast(message), []);

  /* ----------------------------- import ------------------------------- */

  const importInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => importInputRef.current?.click();

  const handleImportFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!canvasApi.current) {
      toast.error("Open a page first, then import files.");
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
      toast.success(`Restored backup — ${count} page${count === 1 ? "" : "s"} imported.`);
    } catch (err) {
      console.error(err);
      toast.error("Could not restore that backup file.");
    }
  };

  /* ------------------------------ export ------------------------------- */

  const handleExport = async (kind: "png" | "svg" | "scene" | "backup") => {
    if (kind === "backup") {
      const json = await db.buildBackup();
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `infinitenote-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Backup downloaded.");
      return;
    }
    if (!canvasApi.current || !currentPage) {
      toast.error("Open a page first, then export.");
      return;
    }
    if (kind === "png") await canvasApi.current.exportPng();
    if (kind === "svg") await canvasApi.current.exportSvg();
    if (kind === "scene") await canvasApi.current.exportSceneFile();
  };

  /* --------------------------- drag & drop ----------------------------- */

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    await handleImportFiles(e.dataTransfer.files);
  };

  /* ------------------------------- render ------------------------------ */

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <NotebookPen className="h-8 w-8 animate-pulse" />
          <p className="text-sm">Opening your notebooks…</p>
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
          aria-label="Open navigation"
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
          <span className="hidden lg:inline">Search pages</span>
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
          accept="image/*,.pdf,.txt,.md,.markdown,.csv,.json,.log,.yaml,.yml,.excalidraw,.excalidraw.json"
          aria-label="Import files"
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
          aria-label="Restore backup file"
          onChange={(e) => {
            void handleRestoreBackup(e.target.files);
            e.target.value = "";
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Import</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Insert into current page</DropdownMenuLabel>
            <DropdownMenuItem onClick={openFilePicker}>
              <ImageIcon /> Images, PDF, text, Markdown…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Library</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => backupInputRef.current?.click()}>
              <FileJson /> Restore backup (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Current page</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void handleExport("scene")}>
              <FileDown /> Excalidraw scene (.excalidraw)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("png")}>
              <ImageIcon /> PNG image
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("svg")}>
              <FileUp /> SVG vector
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Everything</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void handleExport("backup")}>
              <PackageOpen /> Full backup (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Toggle theme"
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
            <SheetTitle className="sr-only">Navigation</SheetTitle>
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
                    aria-label="Page title"
                  />
                ) : (
                  <button
                    type="button"
                    className="truncate rounded px-1 py-1 text-left text-sm font-medium hover:bg-muted"
                    title="Click to rename this page"
                    onClick={() => setTitleDraft(currentPage.title)}
                  >
                    {currentPage.title}
                  </button>
                )}
                <div className="flex-1" />
                <span
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  data-testid="save-indicator"
                  aria-live="polite"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  {saveIndicator === "saving"
                    ? "Saving…"
                    : saveIndicator === "error"
                      ? "Save failed"
                      : saveIndicator === "saved"
                        ? "Saved"
                        : ""}
                </span>
              </div>

              {/* canvas */}
              <div className="relative min-h-0 flex-1">
                <CanvasEditor
                  key={currentPage.id}
                  pageId={currentPage.id}
                  title={currentPage.title}
                  theme={theme}
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
                <p className="mt-2 text-sm font-medium">Drop files to insert them</p>
                <p className="text-xs text-muted-foreground">
                  Images, PDF printouts, text &amp; Markdown, .excalidraw scenes
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      <SearchDialog />
      <TrashDialog />
      <Toaster position="bottom-center" richColors closeButton />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* empty state                                                          */
/* ------------------------------------------------------------------ */

function EmptyState({ onCreateNotebook }: { onCreateNotebook: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <NotebookPen className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">No page open</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a notebook, add a section, then a page — and start drawing on
            the infinite canvas.
          </p>
        </div>
        <Button onClick={onCreateNotebook} className="gap-2">
          <NotebookPen className="h-4 w-4" /> Create a notebook
        </Button>
      </div>
    </div>
  );
}
