/**
 * Browser-side handwriting engine driver (transformers.js, vendored under
 * /hwr/). Mirrors ocr-client.ts: browser-only, always loaded on demand
 * (`await import("@/lib/hwr-client")`) — the engine never enters the main
 * bundle. Everything comes from same-origin static files (public/hwr/),
 * so recognition works fully offline after first use (the service worker
 * caches the /hwr/ prefix) and no CDN is ever contacted — the ink, the
 * line crops and the recognized text never leave the device (issue #175,
 * privacy stance).
 *
 * The vendored bundle is an ES module; it is imported through `new
 * Function` so neither webpack nor turbopack tries to resolve the URL at
 * build time (the classic runtime-ESM trick — the specifier is invisible
 * to static analysis). The pipeline is a lazily-created singleton reused
 * across lines and pages; after a hard failure it is torn down so the
 * next attempt starts clean.
 */
import { HwrError } from "./hwr";

/** Where the vendored transformers.js ESM bundle lives (same-origin). */
const BUNDLE_URL = "/hwr/transformers.min.js";
/** How long the engine script may take to load before we give up. */
const SCRIPT_TIMEOUT_MS = 60_000;
/** The vendored model directory name under /hwr/models/. */
const MODEL_ID = "trocr-small-handwritten";

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

/** Inject the vendored ESM bundle once; resolve its module namespace. */
let libPromise: Promise<TransformersLib> | null = null;

function loadTransformers(): Promise<TransformersLib> {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    if (typeof document === "undefined") {
      throw new HwrError("load-failed", "handwriting requested outside the browser");
    }
    try {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), SCRIPT_TIMEOUT_MS),
      );
      const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;
      const lib = (await Promise.race([dynamicImport(BUNDLE_URL), timer])) as TransformersLib;
      if (typeof lib?.pipeline !== "function") {
        throw new Error("pipeline export missing from the bundle");
      }
      // everything local, always: model weights, tokenizer and the wasm
      // runtime come from /hwr/ (same-origin); remote model access is
      // disabled outright so a misconfiguration can never phone home.
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = true;
      lib.env.localModelPath = "/hwr/models/";
      lib.env.backends.onnx.wasm.wasmPaths = "/hwr/ort/";
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
      // device 'wasm' + q8 weights: the validated Phase A configuration
      // (docs/test-plans/handwriting.md). WebGPU is measured there too
      // but not enabled in Phase A — see the test plan's latency table.
      return await lib.pipeline("image-to-text", MODEL_ID, {
        dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
        device: "wasm",
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
  try {
    const out = await pipe(dataUrl, { max_new_tokens: 48 });
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
