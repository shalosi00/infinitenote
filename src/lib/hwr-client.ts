/**
 * Browser-side handwriting engine driver (transformers.js, model + wasm
 * vendored under /hwr/). Mirrors ocr-client.ts: browser-only, always
 * loaded on demand (`await import("@/lib/hwr-client")`) — the engine never
 * enters the main bundle. The model weights AND the onnxruntime wasm pair
 * come from same-origin static files (public/hwr/), so recognition works
 * fully offline after first use (the service worker caches the /hwr/
 * prefix) and no CDN is ever contacted — the ink, the line crops and the
 * recognized text never leave the device (issue #175, privacy stance).
 *
 * The runtime itself is the npm dependency (@huggingface/transformers,
 * pinned 4.3.2, loaded via dynamic import so it lands in a lazy chunk;
 * serverExternalPackages keeps it out of the SSR bundle). Vendoring the
 * runtime FILE was rejected 2026-11-10: GitHub push protection false-
 * positives on a minified string inside the bundle ("Mistral AI API Key",
 * a provider-template artifact), and a mutated bundle would break the
 * sha256 pinning story. The heavy bytes — ≈64 MB model + ≈27 MB wasm —
 * are still vendored and pinned.
 *
 * The pipeline is a lazily-created singleton reused across lines and
 * pages; after a hard failure it is torn down so the next attempt starts
 * clean.
 */
import { HwrError } from "./hwr";

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

/** The pinned engine versions (public/hwr/assets.json). */
export const HWR_ENGINE = {
  transformersJs: "4.3.2",
  onnxruntimeWeb: "1.31.0-dev.20260914-8d85527a0",
  model: "Xenova/trocr-small-handwritten",
  precision: "q8",
} as const;

/** Import the runtime once and pin it to same-origin assets. */
let libPromise: Promise<TransformersLib> | null = null;

function loadTransformers(): Promise<TransformersLib> {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    if (typeof document === "undefined") {
      throw new HwrError("load-failed", "handwriting requested outside the browser");
    }
    try {
      const lib = (await import("@huggingface/transformers")) as unknown as TransformersLib;
      if (typeof lib?.pipeline !== "function") {
        throw new Error("pipeline export missing from the runtime");
      }
      // everything local, always: model weights and the wasm runtime come
      // from /hwr/ (same-origin); remote model access is disabled outright
      // so a misconfiguration can never phone home.
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = true;
      lib.env.localModelPath = "/hwr/models/";
      lib.env.backends.onnx.wasm.wasmPaths = ORT_WASM_DIR;
      return lib;
    } catch (err) {
      libPromise = null;
      throw new HwrError(
        "load-failed",
        err instanceof Error ? err.message : "could not import the handwriting runtime",
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
  const t0 = Date.now();
  try {
    const out = await pipe(dataUrl, { max_new_tokens: 48 });
    // per-line latency log — the recorded evidence for the test plan's
    // latency table (docs/test-plans/handwriting.md)
    console.info(`[handwriting] line: ${Date.now() - t0}ms (wasm)`);
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
