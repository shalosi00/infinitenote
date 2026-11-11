/**
 * WebGPU capability probe + evidence-locked device selection for the
 * handwriting engine (issue #193 — "measure first, gate on capability").
 *
 * Vendored-asset audit (measured 2026-11-12, `public/hwr/assets.json`):
 * the vendored onnxruntime-web 1.31.0-dev pair under `public/hwr/ort/` is
 * the CPU asyncify build (`ort-wasm-simd-threaded.asyncify.{mjs,wasm}`) —
 * NO `.jsep` (WebGPU execution-provider) assets are vendored, and the
 * transformers.js runtime is a wasm-only closure (the un-bundled web build
 * lazily imports bare specifiers like "onnxruntime-web/webgpu" that blob
 * modules cannot resolve — measured 2026-11-10, see hwr-client.ts). A
 * WebGPU arm therefore requires vendoring the jsep pair and re-bundling
 * the runtime BEFORE any comparison measurement is even possible; until
 * then the engine stays pinned to "wasm".
 *
 * This module is the capability-gating seam the issue asks for: browsers
 * without `navigator.gpu` (or without an obtainable adapter) fall back
 * silently to wasm — results are identical either way. `resolveHwrDevice`
 * returns "webgpu" ONLY when the adapter probe succeeds AND the evidence
 * gate says the measured WASM-vs-WebGPU table showed a real, reproducible
 * win on representative hardware. The gate is false today (issue #193's
 * own gating: no WebGPU path ships without measured evidence), so shipping
 * behavior is byte-identical to the previous unconditional wasm pin.
 *
 * Pure policy module — no @excalidraw or DOM imports (mirrors the
 * shape-library/hwr-convert pattern so `bun test` can exercise it).
 */

/** The device strings the handwriting engine accepts. */
export type HwrDevice = "wasm" | "webgpu";

/**
 * Minimal structural shape of the WebGPU navigator surface this module
 * needs. Kept narrow (and optional) so unit tests can run DOM-free and so
 * browsers without WebGPU simply do not match.
 */
export interface GpuNavigatorLike {
  gpu?: {
    requestAdapter(options?: Record<string, unknown>): Promise<GpuAdapterLike | null>;
  };
}

/** Minimal structural shape of a GPUAdapter. */
export interface GpuAdapterLike {
  info?: unknown;
  requestAdapterInfo?: () => Promise<unknown>;
}

export interface WebGPUProbe {
  /** True only when navigator.gpu exists AND an adapter is obtainable. */
  available: boolean;
  /** Short machine-readable reason when unavailable; undefined when available. */
  reason?: "no-navigator" | "no-gpu-binding" | "no-adapter" | "adapter-probe-failed";
}

/**
 * Probe WebGPU availability without ever throwing (the silent-fallback
 * contract). Any adapter error degrades to unavailable — never a crash.
 */
export async function probeWebGPU(
  nav?: GpuNavigatorLike | null,
): Promise<WebGPUProbe> {
  if (!nav) return { available: false, reason: "no-navigator" };
  if (!nav.gpu || typeof nav.gpu.requestAdapter !== "function") {
    return { available: false, reason: "no-gpu-binding" };
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: "no-adapter" };
    return { available: true };
  } catch {
    return { available: false, reason: "adapter-probe-failed" };
  }
}

/**
 * Evidence gate for the WebGPU arm. Flips to true ONLY when the measured
 * WASM-vs-WebGPU latency table (docs/test-plans/handwriting.md, issue #193)
 * shows a real, reproducible per-line win on representative hardware with
 * the vendored jsep runtime. False today: no jsep assets are vendored and
 * no WebGPU measurement exists — see the vendored-asset audit above.
 */
export const HWR_WEBGPU_EVIDENCE = false;

/**
 * Resolve the engine device from a probe. Order of rules:
 * 1. probe unavailable (or missing) → "wasm" (silent fallback);
 * 2. evidence gate false → "wasm" (measure-first gating);
 * 3. available + evidence gate true → "webgpu".
 */
export function resolveHwrDevice(
  probe: WebGPUProbe | null | undefined,
  evidenceGate: boolean = HWR_WEBGPU_EVIDENCE,
): HwrDevice {
  if (!probe || !probe.available) return "wasm";
  if (!evidenceGate) return "wasm";
  return "webgpu";
}
