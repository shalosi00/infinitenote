/**
 * Browser-side OCR engine driver (tesseract.js, vendored under /ocr/).
 *
 * Browser-only, always loaded on demand (`await import("@/lib/ocr-client")`)
 * — the engine never enters the main bundle. Everything comes from
 * same-origin static files (public/ocr/), so OCR works fully offline after
 * first use (the service worker caches the /ocr/ prefix) and no CDN is
 * ever contacted — same rule as the self-hosted Excalidraw fonts.
 *
 * The worker is a lazily-created singleton, reused across images and pages;
 * after a hard failure it is torn down so the next attempt starts clean.
 */
import { OcrError } from "./ocr";

/** Where the vendored UMD bundle lives (same-origin). */
const SCRIPT_URL = "/ocr/tesseract.min.js";
/** How long the engine script may take to load before we give up. */
const SCRIPT_TIMEOUT_MS = 30_000;

/** The narrow slice of window.Tesseract this app needs. */
interface TesseractLike {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorkerLike>;
}

interface TesseractWorkerLike {
  recognize(image: string): Promise<{ data: { text?: string } }>;
  terminate(): Promise<unknown>;
}

declare global {
  interface Window {
    Tesseract?: TesseractLike;
  }
}

/** Inject the UMD script once; resolve with window.Tesseract. */
let enginePromise: Promise<TesseractLike> | null = null;

function loadTesseract(): Promise<TesseractLike> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<TesseractLike>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new OcrError("load-failed", "OCR requested outside the browser"));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    const timer = setTimeout(() => {
      enginePromise = null;
      reject(new OcrError("load-failed", `timed out loading ${SCRIPT_URL}`));
    }, SCRIPT_TIMEOUT_MS);
    script.addEventListener("load", () => {
      clearTimeout(timer);
      if (window.Tesseract) resolve(window.Tesseract);
      else {
        enginePromise = null;
        reject(new OcrError("load-failed", "Tesseract global missing after load"));
      }
    });
    script.addEventListener("error", () => {
      clearTimeout(timer);
      enginePromise = null;
      reject(new OcrError("load-failed", `could not load ${SCRIPT_URL}`));
    });
    if (!existing) {
      script.src = SCRIPT_URL;
      document.head.appendChild(script);
    }
  });
  return enginePromise;
}

/** Lazily-created worker singleton (shared across images and pages). */
let workerPromise: Promise<TesseractWorkerLike> | null = null;

function getWorker(): Promise<TesseractWorkerLike> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    let tesseract: TesseractLike;
    try {
      tesseract = await loadTesseract();
    } catch (err) {
      workerPromise = null;
      throw err;
    }
    try {
      // oem 1 = LSTM_ONLY: matches the vendored *-lstm core builds exactly
      // (the default mixed OEM would request core files we deliberately
      // do not ship). gzip: the traineddata is vendored .gz.
      return await tesseract.createWorker("eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/core",
        langPath: "/ocr/lang",
        gzip: true,
      });
    } catch (err) {
      workerPromise = null;
      throw new OcrError(
        "init-failed",
        err instanceof Error ? err.message : "worker init failed",
      );
    }
  })();
  return workerPromise;
}

/**
 * Recognize one image (any image dataURL) → raw text.
 * Throws typed OcrError; after a hard recognize failure the worker is
 * recycled so a retry starts from a clean engine.
 */
export async function recognizeImageText(dataUrl: string): Promise<string> {
  const worker = await getWorker();
  try {
    const { data } = await worker.recognize(dataUrl);
    return typeof data.text === "string" ? data.text : "";
  } catch (err) {
    // the worker may now be wedged — drop it; the next call rebuilds
    workerPromise = null;
    void worker.terminate().catch(() => undefined);
    throw new OcrError(
      "recognize-failed",
      err instanceof Error ? err.message : "recognize failed",
    );
  }
}
