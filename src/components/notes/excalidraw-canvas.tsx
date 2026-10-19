"use client";

/**
 * The Excalidraw canvas — one instance per page (keyed remount).
 *
 * This module is browser-only and must always be imported via
 * `next/dynamic` with `ssr: false` (see canvas-editor.tsx).
 */
import { useCallback, useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
  LibraryItems,
  BinaryFileData,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import * as db from "@/lib/notes-db";
import type { ScenePayload } from "@/lib/types";
import type { CanvasApi } from "@/lib/excalidraw-utils";
import {
  classifyFile,
  getScenePayload,
  importExcalidrawFile,
  importDocxFile,
  importHtmlFile,
  importImageFiles,
  importPdfAsPrintout,
  importTextFiles,
  exportPng,
  exportSvg,
  exportSceneFile,
  appendScene,
} from "@/lib/excalidraw-client";

// Self-host canvas fonts/assets so the app works fully offline.
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
    "/excalidraw/";
}

const AUTOSAVE_DEBOUNCE_MS = 700;
const LIBRARY_STORAGE_KEY = "infinitenote.library";

export interface ExcalidrawCanvasProps {
  pageId: string;
  title: string;
  theme: "light" | "dark";
  onApiReady: (api: CanvasApi) => void;
  onSaveIndicator: (state: "saving" | "saved" | "error") => void;
  onToast: (message: string) => void;
}

export default function ExcalidrawCanvas({
  pageId,
  title,
  theme,
  onApiReady,
  onSaveIndicator,
  onToast,
}: ExcalidrawCanvasProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestScene = useRef<ScenePayload | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Write the latest stashed scene into IndexedDB. */
  const doSave = useCallback(async (): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    const payload = latestScene.current;
    if (!payload) return;
    latestScene.current = null; // consumed
    try {
      onSaveIndicator("saving");
      await db.savePageContent(pageId, payload);
      onSaveIndicator("saved");
    } catch {
      onSaveIndicator("error");
    }
  }, [pageId, onSaveIndicator]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [doSave]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await doSave();
  }, [doSave]);

  /* ------------------------- canvas api surface ------------------------ */

  const handleApiReady = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;

      const importFiles = async (files: File[]): Promise<void> => {
        if (!files.length) return;
        // group by kind so each route can batch
        const images = files.filter((f) => classifyFile(f) === "image");
        const texts = files.filter((f) => classifyFile(f) === "text");
        const pdfs = files.filter((f) => classifyFile(f) === "pdf");
        const scenes = files.filter((f) => classifyFile(f) === "excalidraw");
        const docxFiles = files.filter((f) => classifyFile(f) === "docx");
        const htmlFiles = files.filter((f) => classifyFile(f) === "html");
        let touched = false;
        try {
          if (images.length) {
            await importImageFiles(api, images);
            touched = true;
            onToast(`Imported ${images.length} image${images.length > 1 ? "s" : ""}`);
          }
          if (texts.length) {
            await importTextFiles(api, texts);
            touched = true;
            onToast(`Imported ${texts.length} text file${texts.length > 1 ? "s" : ""}`);
          }
          for (const pdf of pdfs) {
            const n = await importPdfAsPrintout(api, pdf);
            touched = true;
            onToast(`Inserted PDF printout (${n} page${n > 1 ? "s" : ""})`);
          }
          for (const file of docxFiles) {
            const n = await importDocxFile(api, file);
            touched = true;
            onToast(`Imported "${file.name}" — ${n} text block${n === 1 ? "" : "s"}`);
          }
          for (const file of htmlFiles) {
            const n = await importHtmlFile(api, file);
            touched = true;
            onToast(`Imported "${file.name}" — ${n} text block${n === 1 ? "" : "s"}`);
          }
          for (const sceneFile of scenes) {
            const scene = await importExcalidrawFile(sceneFile);
            appendScene(api, scene);
            touched = true;
            onToast(`Imported scene "${sceneFile.name}"`);
          }
          const known =
            images.length +
            texts.length +
            pdfs.length +
            scenes.length +
            docxFiles.length +
            htmlFiles.length;
          if (files.length > known) {
            onToast("Some files were skipped (unsupported type)");
          }
          if (touched) {
            latestScene.current = getScenePayload(api);
            scheduleSave();
          }
        } catch (err) {
          console.error(err);
          onToast("Import failed — see console for details");
        }
      };

      const apiSurface: CanvasApi = {
        importFiles,
        exportPng: () => exportPng(api, title),
        exportSvg: () => exportSvg(api, title),
        exportSceneFile: () => exportSceneFile(api, title),
        focusContent: () => api.scrollToContent(),
        flushSave,
      };
      onApiReady(apiSurface);

      // Test hook — only when explicitly requested via ?e2e=1
      if (new URLSearchParams(window.location.search).has("e2e")) {
        (window as unknown as Record<string, unknown>).__NOTE_E2E__ = {
          excalidraw: api,
          saveNow: flushSave,
          elementCount: () => api.getSceneElements().length,
          serializeCurrentPage: () => JSON.stringify(getScenePayload(api)),
        };
      }
    },
    [title, onApiReady, flushSave, scheduleSave, onToast]
  );

  /* ----------------------------- lifecycle ----------------------------- */

  // keep the canvas background in sync with the app theme
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: { viewBackgroundColor: theme === "dark" ? "#1e1e1e" : "#ffffff" },
    });
  }, [theme]);

  // flush pending save when leaving this page
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void doSave();
    };
  }, [pageId, doSave]);

  const handleChange = useCallback(
    (elements: readonly object[], _appState: object, files: Record<string, BinaryFileData>) => {
      latestScene.current = { elements: [...elements], files };
      scheduleSave();
    },
    [scheduleSave]
  );

  const handleLibraryChange = useCallback((items: LibraryItems) => {
    try {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full — non-critical */
    }
  }, []);

  const viewBackgroundColor = theme === "dark" ? "#1e1e1e" : "#ffffff";

  return (
    <Excalidraw
      key={pageId}
      excalidrawAPI={handleApiReady}
      onChange={handleChange}
      theme={theme}
      name={title}
      initialData={async () => {
        const payload = await db.getPageContent(pageId);
        return {
          elements: (payload?.elements ?? []) as unknown as ExcalidrawElement[],
          files: (payload?.files ?? {}) as Record<string, BinaryFileData>,
          appState: {
            viewBackgroundColor,
          },
        };
      }}
      onLibraryChange={handleLibraryChange}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          saveAsImage: false,
          toggleTheme: null,
        },
      }}
      libraryReturnUrl={typeof window !== "undefined" ? window.location.origin : undefined}
      validateEmbeddable={false}
    />
  );
}
