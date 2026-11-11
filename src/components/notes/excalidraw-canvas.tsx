"use client";

/**
 * The Excalidraw canvas — one instance per page (keyed remount).
 *
 * This module is browser-only and must always be imported via
 * `next/dynamic` with `ssr: false` (see canvas-editor.tsx).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { plural } from "@/lib/plural";
import { Excalidraw, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
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
import { sanitizeScene, sceneSignature, structuralSceneJson, downloadBlob } from "@/lib/excalidraw-utils";
import {
  classifyFile,
  convertHandwritingToText,
  getScenePayload,
  insertShapeById,
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
import {
  hitTestPdfAttachment,
  isPdfAttachmentLink,
  pdfAttachmentOf,
  pdfAttachmentSkippedToast,
  pdfDataUrlToBlob,
  pdfPrintoutToast,
  type PdfAttachment,
  type PdfAttachmentElementLike,
} from "@/lib/pdf-attachment";
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
/**
 * Show "Saving…" only when the write actually takes longer than this.
 * Fast IndexedDB commits completing within the window leave the indicator
 * untouched, so a burst of quick saves (stroke … pause … stroke) no longer
 * blinks the label — slow saves and failures still show honest states.
 */
const SAVE_LABEL_DELAY_MS = 200;
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

/**
 * OneNote-style PDF file chip rendered for attachment embeddables
 * (docs/test-plans/pdf-attachment.md): a small red PDF badge + the file
 * name. Display only — the context menu (Download / View / Copy name)
 * lives on the wrapper, which intercepts right-clicks in the capture
 * phase so it works whether or not Excalidraw considers the embed
 * "active".
 */
function PdfAttachmentChip({
  element,
  theme,
}: {
  element: ExcalidrawEmbeddableElement;
  theme: "light" | "dark";
}) {
  const attachment = pdfAttachmentOf(element);
  if (!attachment) return null; // corrupted block — let Excalidraw render its default
  const dark = theme === "dark";
  return (
    <div
      data-testid="pdf-attachment-chip"
      className="flex h-full w-full items-center gap-2 px-2"
      style={{
        background: dark ? "#2a2a33" : "#f3f3f7",
        color: dark ? "#d8d8e2" : "#3f3f4a",
        fontFamily: "system-ui, sans-serif",
      }}
      title={attachment.name}
    >
      <span
        data-testid="pdf-attachment-badge"
        className="flex h-6 w-9 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
        style={{ background: "#dc2626" }}
        aria-hidden="true"
      >
        PDF
      </span>
      <span
        data-testid="pdf-attachment-name"
        className="truncate text-[11px] leading-tight"
      >
        {attachment.name}
      </span>
    </div>
  );
}

/** The attachment context menu open state: cursor position + target file. */
interface PdfMenuState {
  x: number;
  y: number;
  attachment: PdfAttachment;
}

/**
 * Right-click menu for PDF attachment chips (docs/test-plans/
 * pdf-attachment.md): View file (blob URL in a new tab), Download file
 * (byte-exact original), Copy file name. Fixed to the cursor, clamped
 * into the viewport; closes on Escape, any outside pointerdown, wheel/pan
 * or a contextmenu that misses the chip.
 */
function PdfAttachmentMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: PdfMenuState;
  onClose: () => void;
  onAction: (action: "view" | "download" | "copy") => void;
}) {
  const MENU_WIDTH = 208;
  const ITEM_HEIGHT = 36;
  const MENU_HEIGHT = ITEM_HEIGHT * 3 + 8;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8));

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      // clicking inside the menu is an action click — anything else closes
      const target = e.target as Element | null;
      if (target?.closest("[data-pdf-attachment-menu]")) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onWheel = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [onClose]);

  const items: Array<{ id: "view" | "download" | "copy"; label: string; testid: string }> = [
    { id: "view", label: "View file", testid: "pdf-attachment-view" },
    { id: "download", label: "Download file", testid: "pdf-attachment-download" },
    { id: "copy", label: "Copy file name", testid: "pdf-attachment-copy-name" },
  ];
  return (
    <div
      data-pdf-attachment-menu=""
      data-testid="pdf-attachment-menu"
      role="menu"
      aria-label={menu.attachment.name}
      className="fixed z-50 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
      style={{ left, top, width: MENU_WIDTH }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          data-testid={item.testid}
          className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
          onClick={() => onAction(item.id)}
        >
          {item.label}
        </button>
      ))}
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
  /**
   * The canvas wrapper element. Hosts the capture-phase contextmenu
   * listener for PDF attachment chips — capture on an ancestor of the
   * Excalidraw canvas is the only layer that provably beats both the
   * browser's native menu and Excalidraw's own (React bubbles contextmenu
   * at the app root, so the wrapper's capture handler runs first and a
   * stopPropagation keeps their menu from ever seeing the event).
   */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /**
   * Signature of the scene content as last successfully saved (or as loaded
   * on mount, before the first onChange). Autosave gate: when the current
   * onChange signature matches, the change was appState-only (pan / zoom /
   * selection) and re-saving would only blink the indicator (issue: the
   * "Saved" label flickered on every viewport interaction).
   */
  const lastSavedSig = useRef<string | null>(null);
  /**
   * Structural fingerprint (volatile metadata stripped) of what the DB
   * holds. Second opinion of the gate: a signature that moved while the
   * structure did not is Excalidraw re-stamping its own metadata (scene
   * restore, font re-measure) — absorbed into the baseline, never written.
   */
  const lastSavedStructure = useRef<string | null>(null);

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

  /**
   * PDF attachment context menu state (docs/test-plans/pdf-attachment.md).
   * Opened by the wrapper's capture-phase contextmenu listener when the
   * right-click lands on a chip; null while closed.
   */
  const [pdfMenu, setPdfMenu] = useState<PdfMenuState | null>(null);

  /** Write the latest stashed scene into IndexedDB. */
  const doSave = useCallback(async (): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    const payload = latestScene.current;
    if (!payload) return;
    latestScene.current = null; // consumed
    // Defer the "Saving…" label: commits that finish quickly never show it.
    const labelTimer = setTimeout(() => onSaveIndicator("saving"), SAVE_LABEL_DELAY_MS);
    try {
      await db.savePageContent(pageId, payload);
      clearTimeout(labelTimer);
      lastSavedSig.current = sceneSignature(payload);
      lastSavedStructure.current = structuralSceneJson(payload);
      onSaveIndicator("saved");
      // Version history (docs/test-plans/version-history.md): after a
      // successful save, offer the scene to the auto-snapshot policy
      // (≥ 5 min since the page's newest version AND structure changed).
      // Fire-and-forget: a failed snapshot must never fail the save, and
      // the IndexedDB write completes on its own once issued.
      db.maybeRecordAutoVersion(pageId, payload).catch((err: unknown) => {
        console.error("auto version snapshot failed", err);
      });
    } catch {
      clearTimeout(labelTimer);
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
              const result: PdfPrintoutResult = await importPdfAsPrintout(api, pdf);
              touched = true;
              // exact toast lines live in lib/pdf-attachment.ts (unit-tested)
              onToast(pdfPrintoutToast(result, pdf.name));
              if (result.attachment === "skipped-large") {
                onToast(pdfAttachmentSkippedToast(pdf.name));
              }
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
        // issue #65: curated shape library — unknown ids fall back to a toast
        insertShape: (shapeId) => {
          if (!insertShapeById(api, shapeId)) {
            onToast("Unknown shape");
          }
        },
        // issue #176 Phase B: recognized handwriting → editable text
        convertHandwriting: () => convertHandwritingToText(api),
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

  // Keep the page paper in sync with the app theme + paper style.
  //
  // Excalidraw 0.18 renders dark mode by INVERTING the canvas pixels
  // (`.theme--dark canvas { filter: invert(93%) hue-rotate(180deg) }`) — the
  // scene itself must stay authored in light colors. Painting a dark
  // viewBackgroundColor here would be inverted AGAIN into a washed-out light
  // gray (observed in the v1.13 screenshot pass), so both themes paint white
  // paper and the filter produces the dark look. All export paths already
  // force a white background (excalidraw-client.ts, pdf-export.ts), which
  // this now matches; the grid pattern is drawn into the canvas and inverts
  // to light-on-dark automatically.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: {
        viewBackgroundColor: "#ffffff",
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
      // sanitize at the persistence boundary: orphan files are dropped and
      // image elements whose file data is registered flip "pending" →
      // "saved" (issue #122) — Excalidraw 0.18's own insert paths (paste,
      // image tool) never do that flip themselves.
      const payload = sanitizeScene({ elements: [...elements], files });
      if (ruledLayerRef.current) syncRuledLayer(appState);
      // Autosave gate: Excalidraw fires onChange for appState-only updates
      // too (pan, zoom, selection, tool switches) — none of that changes
      // what savePageContent persists, so re-saving would only blink the
      // "Saved" indicator on every viewport interaction. Skip when the
      // persisted content is unchanged since the last save.
      const sig = sceneSignature(payload);
      const unchanged =
        sig === lastSavedSig.current ||
        // signature moved but the structure did not: Excalidraw re-stamped
        // its own metadata (restore / re-measure / normalization) — absorb
        // the fresh signature into the baseline instead of writing
        (lastSavedStructure.current !== null &&
          structuralSceneJson(payload) === lastSavedStructure.current);
      if (unchanged) {
        // The scene is exactly what is persisted (modulo Excalidraw's own
        // metadata stamps) — pure viewport noise, an edit undone inside the
        // debounce window, or a metadata re-stamp. Any pending stash is now
        // superseded and MUST be dropped (and its timer cancelled): letting
        // it fire would persist the superseded scene.
        lastSavedSig.current = sig;
        latestScene.current = null;
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        return;
      }
      latestScene.current = payload;
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

  /* ----------------- PDF attachment chip context menu ----------------- */

  /**
   * Capture-phase contextmenu interception (docs/test-plans/
   * pdf-attachment.md): client coords → scene coords via Excalidraw's
   * own transform, then a rotation-exact hit-test against the live chip
   * elements. A hit opens OUR menu (and suppresses the native + Excalidraw
   * menus); a miss closes ours and lets the event flow untouched.
   */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onContextMenu = (e: MouseEvent) => {
      const api = apiRef.current;
      if (!api) return;
      const scene = viewportCoordsToSceneCoords(
        { clientX: e.clientX, clientY: e.clientY },
        api.getAppState(),
      );
      const hit = hitTestPdfAttachment(
        scene.x,
        scene.y,
        api.getSceneElements() as unknown as readonly PdfAttachmentElementLike[],
      );
      if (!hit) {
        setPdfMenu(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setPdfMenu({ x: e.clientX, y: e.clientY, attachment: hit });
    };
    wrapper.addEventListener("contextmenu", onContextMenu, true);
    return () => wrapper.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  /** The three menu actions: View / Download / Copy file name. */
  const handlePdfMenuAction = useCallback(
    (menu: PdfMenuState, action: "view" | "download" | "copy") => {
      setPdfMenu(null);
      if (action === "copy") {
        navigator.clipboard
          .writeText(menu.attachment.name)
          .then(() =>
            onToast(`Copied "${menu.attachment.name}" to the clipboard.`),
          )
          .catch(() => onToast("Could not copy the file name."));
        return;
      }
      try {
        const blob = pdfDataUrlToBlob(menu.attachment.dataUrl);
        if (action === "download") {
          downloadBlob(blob, menu.attachment.name);
          return;
        }
        // View file: blob URL in a new tab (browser/PWA; best-effort in the
        // Tauri shell — Download is the reliable path there). No "noopener":
        // headless Chromium refuses to commit a blob: navigation in a
        // noopener window, and the URL is a self-created local blob anyway.
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        onToast("Could not read the attached PDF.");
      }
    },
    [onToast],
  );

  /**
   * Custom renderer for embeddable elements (issue #67): audio clips get a
   * native `<audio controls>` player and PDF printouts get the OneNote-style
   * file chip (docs/test-plans/pdf-attachment.md); everything else falls
   * back to Excalidraw's default iframe (returning null/undefined does that).
   */
  const renderEmbeddable = useCallback(
    (element: ExcalidrawEmbeddableElement, _appState: AppState) => {
      if (isPdfAttachmentLink(element.link)) {
        return <PdfAttachmentChip element={element} theme={theme} />;
      }
      if (!isAudioBlockLink(element.link)) return null;
      return <AudioEmbeddablePlayer element={element} theme={theme} />;
    },
    [theme]
  );

  // white paper in BOTH themes — Excalidraw's dark-mode CSS filter inverts
  // the canvas, so painting white is what renders as dark (see the sync
  // effect above)
  const viewBackgroundColor = "#ffffff";
  const ruledColor = theme === "dark" ? "rgba(120, 120, 128, 0.35)" : "rgba(82, 82, 91, 0.25)";

  return (
    <div className="relative h-full w-full" ref={wrapperRef}>
      <Excalidraw
        key={pageId}
        excalidrawAPI={handleApiReady}
        onChange={handleChange}
        theme={theme}
        name={title}
        renderEmbeddable={renderEmbeddable}
        initialData={async () => {
          const payload = await db.getPageContent(pageId);
          // Prime the autosave gate with the loaded content: Excalidraw
          // replays the restored scene through onChange once on mount, and
          // that replay must not count as an edit (it would flash the save
          // indicator on every page open). Scenes that the sanitizer would
          // change (legacy "pending" images) intentionally miss the gate
          // and get normalized by the first save.
          if (payload) {
            lastSavedSig.current = sceneSignature(payload);
            lastSavedStructure.current = structuralSceneJson(
              sanitizeScene({ elements: payload.elements, files: payload.files })
            );
          }
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
        // only our audio blocks (AUDIO_LINK_SCHEME marker) and PDF
        // attachment chips (infinitenote:pdf) may mount interactive embeds;
        // every other embeddable stays rejected, exactly as before
        validateEmbeddable={(url) => isAudioBlockLink(url) || isPdfAttachmentLink(url)}
      />
      {pdfMenu && (
        <PdfAttachmentMenu
          menu={pdfMenu}
          onClose={() => setPdfMenu(null)}
          onAction={(action) => handlePdfMenuAction(pdfMenu, action)}
        />
      )}
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
