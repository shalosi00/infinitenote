/**
 * Browser-side handwriting engine driver (transformers.js, vendored
 * gzipped under /hwr/). Mirrors ocr-client.ts: browser-only, always
 * loaded on demand (`await import("@/lib/hwr-client")`) — the engine never
 * enters the main bundle. Everything comes from same-origin static files
 * (public/hwr/), so recognition works fully offline after first use (the
 * service worker caches the /hwr/ prefix) and no CDN is ever contacted —
 * the ink, the line crops and the recognized text never leave the device
 * (issue #175, privacy stance).
 *
 * The runtime bundle is vendored GZIPPED
 * (transformers.web.bundle.js.gz — the bun-bundled closure of the web
 * ESM build; every bare specifier inlined. Raw dist files do NOT work
 * in a browser: transformers.min.js is node-flavored ("this.processor
 * is not a function"), and the un-bundled web build lazily imports bare
 * specifiers ("onnxruntime-web/webgpu") that blob modules cannot
 * resolve — both measured 2026-11-10): the
 * app fetches it, decompresses it in the browser (DecompressionStream —
 * every engine this app targets ships it) and imports it as a blob URL.
 * Why not ship the raw bundle: GitHub push protection false-positives a
 * provider-template string inside the minified file ("Mistral AI API
 * Key") and rejects the push. Why not the npm dependency: bundling it
 * made the cold CI production build flaky (Turbopack postcss worker IPC
 * timeouts, 2026-11-10). The gzip detour keeps the build graph untouched
 * and the drift test still pins the ORIGINAL file's sha256 (it gunzips).
 *
 * The module is imported through `new Function` so neither the bundler
 * nor static analysis touches the blob URL. The pipeline is a
 * lazily-created singleton reused across lines and pages; after a hard
 * failure it is torn down so the next attempt starts clean.
 */
import { HwrError } from "./hwr";
import {
  pickHwrDevice,
  probeWebGPU,
  readDeviceOverride,
  type GpuNavigatorLike,
  type HwrDevice,
} from "./hwr-device";

/** Where the vendored gzip bundle lives (same-origin). */
const BUNDLE_URL = "/hwr/transformers.web.bundle.js.gz";
/** How long the engine may take to load before we give up. */
const LOAD_TIMEOUT_MS = 60_000;
/** The vendored model directory name under /hwr/models/. */
const MODEL_ID = "trocr-small-handwritten";
/** Where the vendored onnxruntime wasm pair lives (same-origin). */
const ORT_WASM_DIR = "/hwr/ort/";

/** The narrow slice of the transformers.js module this app needs. */
interface TransformersLib {
  pipeline(
    task: "image-to-text",
    model: string,
    options?: Record<string, unknown>,
  ): Promise<ImageToTextPipeline>;
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    backends: { onnx: { wasm: { wasmPaths: string } } };
  };
}

interface ImageToTextPipeline {
  (image: string, options?: Record<string, unknown>): Promise<Array<{ generated_text: string }>>;
}

/** The vendored, pinned engine versions (public/hwr/assets.json). */
export const HWR_ENGINE = {
  transformersJs: "4.3.2",
  onnxruntimeWeb: "1.31.0-dev.20260914-8d85527a0",
  model: "Xenova/trocr-small-handwritten",
  precision: "q8",
} as const;

/** fetch + DecompressionStream + blob-URL import of the gzipped bundle. */
async function importGzippedBundle(): Promise<TransformersLib> {
  if (typeof fetch === "undefined" || typeof DecompressionStream === "undefined") {
    throw new HwrError(
      "load-failed",
      "this browser does not support DecompressionStream (required for the handwriting engine)",
    );
  }
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`${BUNDLE_URL} answered ${res.status}`);
  const stream = (res.body as ReadableStream<Uint8Array>).pipeThrough(
    new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  // module scripts demand a JS MIME type — a typeless Blob answers ""
  const text = await new Response(stream).text();
  const blob = new Blob([text], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const dynamicImport = new Function("url", "return import(url)") as (
      url: string,
    ) => Promise<unknown>;
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), LOAD_TIMEOUT_MS),
    );
    const lib = (await Promise.race([dynamicImport(url), timer])) as TransformersLib;
    if (typeof lib?.pipeline !== "function") {
      throw new Error("pipeline export missing from the bundle");
    }
    return lib;
  } finally {
    // the module is registered once imported; the blob URL can go
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Import the runtime once and pin it to same-origin assets. */
let libPromise: Promise<TransformersLib> | null = null;

function loadTransformers(): Promise<TransformersLib> {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    if (typeof document === "undefined") {
      throw new HwrError("load-failed", "handwriting requested outside the browser");
    }
    try {
      const lib = await importGzippedBundle();
      // everything local, always: model weights and the wasm runtime come
      // from /hwr/ (same-origin); remote model access is disabled outright
      // so a misconfiguration can never phone home.
      // - localModelPath stays a RELATIVE path: an absolute URL makes
      //   transformers.js classify the model as hub-type, and with remote
      //   models disabled the processor existence probe then reports
      //   "no processor" (measured: "this.processor is not a function").
      // - wasmPaths must be an ABSOLUTE URL: the runtime module itself is
      //   imported from a blob: URL, and a path base would resolve the ort
      //   glue import against blob: instead of the page origin.
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = true;
      lib.env.localModelPath = "/hwr/models/";
      lib.env.backends.onnx.wasm.wasmPaths = new URL(
        ORT_WASM_DIR,
        window.location.href,
      ).href;
      return lib;
    } catch (err) {
      libPromise = null;
      throw new HwrError(
        "load-failed",
        err instanceof Error ? err.message : `could not load ${BUNDLE_URL}`,
      );
    }
  })();
  return libPromise;
}

/** The device the ACTIVE pipeline was created with (evidence-locked: "wasm" today). */
let activeDevice: HwrDevice = "wasm";

/** Lazily-created pipeline singleton (shared across lines and pages). */
let pipelinePromise: Promise<ImageToTextPipeline> | null = null;

function getPipeline(): Promise<ImageToTextPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    let lib: TransformersLib;
    try {
      lib = await loadTransformers();
    } catch (err) {
      pipelinePromise = null;
      throw err;
    }
    try {
      // q8 weights + evidence-locked device selection: the validated Phase A
      // configuration is wasm; issue #193's gate keeps the engine there
      // until the jsep (WebGPU EP) runtime assets are vendored AND the
      // measured WASM-vs-WebGPU table shows a real win. The probe resolves
      // to "wasm" silently today — behavior is byte-identical to the old
      // unconditional pin; docs/test-plans/handwriting.md carries the gate.
      const device = pickHwrDevice(
        readDeviceOverride(globalThis),
        await probeWebGPU(navigator as unknown as GpuNavigatorLike | null),
      );
      activeDevice = device;
      return await lib.pipeline("image-to-text", MODEL_ID, {
        dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
        device,
      });
    } catch (err) {
      pipelinePromise = null;
      throw new HwrError(
        "init-failed",
        err instanceof Error ? err.message : "pipeline init failed",
      );
    }
  })();
  return pipelinePromise;
}

/**
 * Recognize one rasterized line (PNG dataURL) → raw text.
 * Throws typed HwrError; after a hard recognize failure the pipeline is
 * recycled so a retry starts from a clean engine.
 */
export async function recognizeHandwritingLine(dataUrl: string): Promise<string> {
  const pipe = await getPipeline();
  const t0 = Date.now();
  try {
    const out = await pipe(dataUrl, { max_new_tokens: 48 });
    // per-line latency log — the recorded evidence for the test plan's
    // latency table (docs/test-plans/handwriting.md)
    console.info(`[handwriting] line: ${Date.now() - t0}ms (${activeDevice})`);
    const text = out?.[0]?.generated_text;
    return typeof text === "string" ? text : "";
  } catch (err) {
    pipelinePromise = null;
    throw new HwrError(
      "recognize-failed",
      err instanceof Error ? err.message : "recognize failed",
    );
  }
}
