"use client";

/**
 * The Excalidraw canvas — one instance per page (keyed remount).
 *
 * This module is browser-only and must always be imported via
 * `next/dynamic` with `ssr: false` (see canvas-editor.tsx).
 */
import { useCallback, useEffect, useRef } from "react";
import { plural } from "@/lib/plural";
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
import type { PageBackground } from "@/lib/types";
import type { CanvasApi } from "@/lib/excalidraw-utils";
import {
  classifyFile,
  getScenePayload,
  importExcalidrawFile,
  importDocxFile,
  importHtmlFile,
  importImageFiles,
  importMhtFile,
  importPdfAsPrintout,
  importTextFiles,
  importAudioFiles,
  exportPng,
  exportSvg,
  exportSceneFile,
  appendScene,
} from "@/lib/excalidraw-client";
import { exportPagePdf } from "@/lib/pdf-export";
import { audioPayloadOf, isAudioBlockLink } from "@/lib/audio-notes";
import { e2eHooksEnabled } from "@/lib/e2e-gate";
import type { PdfPrintoutResult } from "@/lib/excalidraw-client";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

// Self-host canvas fonts/assets so the app works fully offline.
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
    "/excalidraw/";
}

const AUTOSAVE_DEBOUNCE_MS = 700;
const LIBRARY_STORAGE_KEY = "infinitenote.library";

/**
 * Read the persisted shape library back (issue #96): onLibraryChange
 * saves it on every change; this restores it into the editor on mount.
 * Corrupt/absent data → null (no library items to restore). Runs in the
 * browser only — the canvas never mounts on the server.
 */
function loadSavedLibrary(): LibraryItems | null {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LibraryItems;
    if (!Array.isArray(parsed)) return null;
    // light shape guard: every entry must be an object with an id
    if (!parsed.every((item) => item && typeof item === "object" && "id" in item)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Compose the .docx / HTML / .mht import toast: text blocks plus an optional
 * "+ N images" tail. Shared by all three structured importers so they read
 * alike (issue #73).
 */
function structuredImportToast(
  name: string,
  blocks: number,
  images: number,
): string {
  const base = `Imported "${name}" — ${blocks} ${plural(blocks, "1 text block", "# text blocks")}`;
  return images > 0 ? `${base} + ${images} ${plural(images, "1 image", "# images")}` : base;
}

/** World-space distance between ruled-paper lines (≈ a text line at 100%). */
const RULED_GAP = 40;

export interface ExcalidrawCanvasProps {
  pageId: string;
  title: string;
  theme: "light" | "dark";
  /** Paper style: plain, ruled (horizontal lines), grid (native gridMode). */
  background: PageBackground;
  onApiReady: (api: CanvasApi) => void;
  onSaveIndicator: (state: "saving" | "saved" | "error") => void;
  onToast: (message: string) => void;
}

/**
 * Native `<audio controls>` player for one audio embeddable (issue #67).
 *
 * Rendered via Excalidraw's `renderEmbeddable` prop instead of the default
 * iframe: browsers show no UI for a bare audio document, and data: iframes
 * are blocked in several contexts. The clip stays a first-class scene
 * element — select it, move it, draw over it — while this component only
 * owns playback. Pointer events are enabled only while the element is
 * "active" (selected/double-clicked), which is Excalidraw's own rule for
 * interactive embeds; the wrapper honors it for us.
 */
function AudioEmbeddablePlayer({
  element,
  theme,
}: {
  element: ExcalidrawEmbeddableElement;
  theme: "light" | "dark";
}) {
  const payload = audioPayloadOf(element.customData);
  if (!payload) return null; // corrupted block — let Excalidraw render its default
  const name =
    typeof element.customData?.audioName === "string" ? element.customData.audioName : "";
  const dark = theme === "dark";
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1 px-2"
      style={{
        background: dark ? "#2a2a33" : "#f3f3f7",
        color: dark ? "#d8d8e2" : "#3f3f4a",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {name && (
        <span
          data-testid="audio-clip-name"
          className="truncate text-[10px] leading-tight opacity-80"
          title={name}
        >
          ♪ {name}
        </span>
      )}
      <audio
        controls
        preload="metadata"
        src={payload}
        className="h-7 w-full"
        aria-label={name || "audio clip"} // localized fallback (issue #98)
        data-testid="audio-player"
      />
    </div>
  );
}

export default function ExcalidrawCanvas({
  pageId,
  title,
  theme,
  background,
  onApiReady,
  onSaveIndicator,
  onToast,
}: ExcalidrawCanvasProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestScene = useRef<ScenePayload | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ruledLayerRef = useRef<HTMLDivElement | null>(null);

  /*
   * Latest-value refs (issue #72): Excalidraw invokes the `excalidrawAPI`
   * callback exactly once per mounted editor instance, and the canvas only
   * remounts when `pageId` changes — so anything the imperative surface
   * closes over would freeze at mount time. The export surface therefore
   * reads title / paper style through refs that are re-assigned
   * on every render, keeping exports and toasts correct after an in-place
   * rename or paper switch.
   */
  const titleRef = useRef(title);
  const backgroundRef = useRef(background);
  // Refs may only be written outside render (react-hooks/refs) — refresh them
  // in an effect after every commit. The export surface reads them at
  // interaction time (menu click), long after the effect has settled.
  useEffect(() => {
    titleRef.current = title;
    backgroundRef.current = background;
  }, [title, background]);

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

  /** Pending edits = un-flushed stash or a running autosave debounce. */
  const hasPendingEdits = useCallback(
    (): boolean => saveTimer.current !== null || latestScene.current !== null,
    []
  );

  /** Drop pending edits without saving (post-sync reload — DB is newer). */
  const discardPendingEdits = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    latestScene.current = null;
  }, []);

  /**
   * Keep the ruled-paper overlay locked to the canvas viewport: Excalidraw's
   * transform is screen = (world + scroll - viewport/2) × zoom, so a world-0
   * line sits at ((scrollY - h/2) × zoom) and the tile phase follows from it.
   * Written straight to the DOM node — this fires on every pan/zoom frame.
   */
  const syncRuledLayer = useCallback(
    (appState: { scrollY: number; zoom: { value: number }; height: number }) => {
      const layer = ruledLayerRef.current;
      if (!layer) return;
      const tile = RULED_GAP * appState.zoom.value;
      if (tile <= 0) return;
      const phaseY = ((appState.scrollY - appState.height / 2) * appState.zoom.value) % tile;
      layer.style.backgroundSize = `100% ${tile}px`;
      layer.style.backgroundPosition = `0 ${phaseY}px`;
    },
    [],
  );

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
        const mhtFiles = files.filter((f) => classifyFile(f) === "mht");
        const audioFiles = files.filter((f) => classifyFile(f) === "audio");
        let touched = false;
        try {
          if (images.length) {
            await importImageFiles(api, images);
            touched = true;
            onToast(`Imported ${plural(images.length, "1 image", "# images")}`);
          }
          if (texts.length) {
            const n = await importTextFiles(api, texts);
            if (n) {
              touched = true;
              onToast(`Imported ${plural(n, "1 text file", "# text files")}`);
            }
            if (n < texts.length) {
              // blank / whitespace-only text files produced no content
              onToast("Some files had no importable content");
            }
          }
          if (pdfs.length) {
            for (const pdf of pdfs) {
              const { rendered, total }: PdfPrintoutResult =
                await importPdfAsPrintout(api, pdf);
              touched = true;
              onToast(
                total > rendered
                  ? `Inserted PDF printout (first ${rendered} of ${total} pages) — the render cap is 20 pages`
                  : `Inserted PDF printout (${plural(rendered, "1 page", "# pages")})`,
              );
            }
          }
          if (docxFiles.length) {
            for (const file of docxFiles) {
              const n = await importDocxFile(api, file);
              touched = true;
              onToast(`Imported \"${file.name}\" — ${plural(n, "1 text block", "# text blocks")}`);
            }
          }
          if (htmlFiles.length) {
            for (const file of htmlFiles) {
              const { blocks, images: n } = await importHtmlFile(api, file);
              touched = true;
              onToast(structuredImportToast(file.name, blocks, n));
            }
          }
          if (mhtFiles.length) {
            for (const file of mhtFiles) {
              const { blocks, images: n } = await importMhtFile(api, file);
              touched = true;
              onToast(structuredImportToast(file.name, blocks, n));
            }
          }
          if (audioFiles.length) {
            const { added, skippedLarge } = await importAudioFiles(api, audioFiles);
            if (added) {
              touched = true;
              onToast(`Imported ${plural(added, "1 audio clip", "# audio clips")}`);
            }
            if (skippedLarge) {
              onToast(`Skipped ${plural(skippedLarge, "1 audio file", "# audio files")} — larger than 30 MB, too big to store reliably`);
            }
          }
          if (scenes.length) {
            for (const sceneFile of scenes) {
              const scene = await importExcalidrawFile(sceneFile);
              appendScene(api, scene);
              touched = true;
              onToast(`Imported scene \"${sceneFile.name}\"`);
            }
          }
          const known =
            images.length +
            texts.length +
            pdfs.length +
            scenes.length +
            docxFiles.length +
            htmlFiles.length +
            mhtFiles.length +
            audioFiles.length;
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
        // latest-value refs (issue #72): a rename or paper-style switch must
        // be reflected in the very next export, without remounting the canvas
        exportPng: () => exportPng(api, titleRef.current),
        exportSvg: () => exportSvg(api, titleRef.current),
        exportSceneFile: () => exportSceneFile(api, titleRef.current),
        exportPdf: (orientation) =>
          exportPagePdf(api, titleRef.current, orientation, backgroundRef.current),
        focusContent: () => api.scrollToContent(),
        flushSave,
        hasPendingEdits,
        discardPendingEdits,
      };
      onApiReady(apiSurface);

      // ruled paper must be positioned from the very first frame — waiting for
      // the first pan/zoom would show an un-tiled gradient until interaction
      if (background === "ruled") syncRuledLayer(api.getAppState());

      // Test hook — ?e2e=1 AND development only (issue #102): Next inlines
      // NODE_ENV, so the whole block compiles away in production builds
      if (e2eHooksEnabled(window.location.search, process.env.NEXT_PUBLIC_E2E)) {
        (window as unknown as Record<string, unknown>).__NOTE_E2E__ = {
          excalidraw: api,
          saveNow: flushSave,
          elementCount: () => api.getSceneElements().length,
          serializeCurrentPage: () => JSON.stringify(getScenePayload(api)),
        };
      }
    },
    [onApiReady, flushSave, scheduleSave, onToast, background, syncRuledLayer, hasPendingEdits, discardPendingEdits]
  );

  /* ----------------------------- lifecycle ----------------------------- */

  // keep the canvas background in sync with the app theme + page paper
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: {
        viewBackgroundColor: theme === "dark" ? "#1e1e1e" : "#ffffff",
        gridModeEnabled: background === "grid",
      },
    });
    if (background === "ruled") syncRuledLayer(api.getAppState());
  }, [theme, background, syncRuledLayer]);

  // flush pending save when leaving this page
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void doSave();
    };
  }, [pageId, doSave]);

  const handleChange = useCallback(
    (
      elements: readonly object[],
      appState: {
        scrollY: number;
        zoom: { value: number };
        width: number;
        height: number;
      },
      files: Record<string, BinaryFileData>,
    ) => {
      latestScene.current = { elements: [...elements], files };
      if (ruledLayerRef.current) syncRuledLayer(appState);
      scheduleSave();
    },
    [scheduleSave, syncRuledLayer]
  );

  const handleLibraryChange = useCallback((items: LibraryItems) => {
    try {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full — non-critical */
    }
  }, []);

  /**
   * Custom renderer for embeddable elements (issue #67): audio clips get a
   * native `<audio controls>` player; everything else falls back to
   * Excalidraw's default iframe (returning null/undefined does that).
   */
  const renderEmbeddable = useCallback(
    (element: ExcalidrawEmbeddableElement, _appState: AppState) => {
      if (!isAudioBlockLink(element.link)) return null;
      return <AudioEmbeddablePlayer element={element} theme={theme} />;
    },
    [theme]
  );

  const viewBackgroundColor = theme === "dark" ? "#1e1e1e" : "#ffffff";
  const ruledColor = theme === "dark" ? "rgba(120, 120, 128, 0.35)" : "rgba(82, 82, 91, 0.25)";

  return (
    <div className="relative h-full w-full">
      <Excalidraw
        key={pageId}
        excalidrawAPI={handleApiReady}
        onChange={handleChange}
        theme={theme}
        name={title}
        renderEmbeddable={renderEmbeddable}
        initialData={async () => {
          const payload = await db.getPageContent(pageId);
          return {
            elements: (payload?.elements ?? []) as unknown as ExcalidrawElement[],
            files: (payload?.files ?? {}) as Record<string, BinaryFileData>,
            appState: {
              viewBackgroundColor,
              gridModeEnabled: background === "grid",
            },
            // restore the saved shape library (issue #96): it is persisted
            // on every onLibraryChange and was previously never read back,
            // so saved items vanished on every reload
            libraryItems: loadSavedLibrary() ?? undefined,
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
        // only our audio blocks (AUDIO_LINK_SCHEME marker) may mount interactive
        // embeds; every other embeddable stays rejected, exactly as before
        validateEmbeddable={(url) => isAudioBlockLink(url)}
      />
      {background === "ruled" && (
        <div
          ref={ruledLayerRef}
          aria-hidden="true"
          data-testid="ruled-paper"
          className="pointer-events-none absolute inset-0 z-[3]"
          style={{
            backgroundImage: `linear-gradient(to bottom, transparent 0, transparent calc(100% - 1px), ${ruledColor} calc(100% - 1px), ${ruledColor} 100%)`,
            backgroundRepeat: "repeat",
          }}
        />
      )}
    </div>
  );
}
