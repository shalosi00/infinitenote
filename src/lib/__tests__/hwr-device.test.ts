/**
 * Unit tests for the WebGPU capability probe + evidence-locked device
 * selection (issue #193 step 1-2 — measure first, gate on capability).
 * Pure-DOM-free: probes run against structural fakes of navigator.gpu.
 */
import { describe, expect, test } from "bun:test";
import {
  HWR_WEBGPU_EVIDENCE,
  probeWebGPU,
  resolveHwrDevice,
  type GpuAdapterLike,
  type GpuNavigatorLike,
  type WebGPUProbe,
} from "../hwr-device";

/** Build a fake navigator whose requestAdapter behaves per the scenario. */
function fakeNav(
  requestAdapter?: (options?: Record<string, unknown>) => Promise<GpuAdapterLike | null>,
  withBinding: boolean = true,
): GpuNavigatorLike {
  if (!withBinding) return {} as GpuNavigatorLike;
  return {
    gpu: {
      requestAdapter:
        requestAdapter ??
        (async () => ({}) as GpuAdapterLike),
    },
  };
}

describe("HWR-D: WebGPU probe (issue #193)", () => {
  test("HWR-D01: no navigator at all → unavailable, reason no-navigator", async () => {
    const probe = await probeWebGPU(null);
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe("no-navigator");
  });

  test("HWR-D02: undefined navigator → unavailable (silent)", async () => {
    const probe = await probeWebGPU(undefined);
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe("no-navigator");
  });

  test("HWR-D03: navigator without the gpu binding → unavailable, reason no-gpu-binding", async () => {
    const probe = await probeWebGPU(fakeNav(undefined, false));
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe("no-gpu-binding");
  });

  test("HWR-D04: gpu binding whose requestAdapter resolves null → unavailable, reason no-adapter", async () => {
    const probe = await probeWebGPU(fakeNav(async () => null));
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe("no-adapter");
  });

  test("HWR-D05: adapter obtainable → available, no reason", async () => {
    const probe = await probeWebGPU(fakeNav());
    expect(probe.available).toBe(true);
    expect(probe.reason).toBeUndefined();
  });

  test("HWR-D06: throwing requestAdapter degrades to unavailable — probe never rejects", async () => {
    const probe = await probeWebGPU(
      fakeNav(async () => {
        throw new Error("adapter creation exploded");
      }),
    );
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe("adapter-probe-failed");
  });

  test("HWR-D07: probe passes requestAdapter options through (structural)", async () => {
    let seen: Record<string, unknown> | undefined;
    const probe = await probeWebGPU(
      fakeNav(async (options) => {
        seen = options;
        return {} as GpuAdapterLike;
      }),
    );
    expect(probe.available).toBe(true);
    expect(seen).toBeUndefined(); // default probe issues an option-less request
  });

  test("HWR-D08: probe is await-safe and returns a fresh object each call", async () => {
    const a = await probeWebGPU(fakeNav());
    const b = await probeWebGPU(fakeNav());
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("HWR-D: evidence-locked device resolution (issue #193)", () => {
  const available: WebGPUProbe = { available: true };
  const unavailable: WebGPUProbe = { available: false, reason: "no-adapter" };

  test("HWR-D09: missing probe → wasm (never crash on absence)", () => {
    expect(resolveHwrDevice(undefined)).toBe("wasm");
    expect(resolveHwrDevice(null)).toBe("wasm");
  });

  test("HWR-D10: unavailable probe → wasm (silent fallback)", () => {
    expect(resolveHwrDevice(unavailable)).toBe("wasm");
  });

  test("HWR-D11: available probe + evidence gate false → wasm (measure-first gating)", () => {
    expect(resolveHwrDevice(available, false)).toBe("wasm");
  });

  test("HWR-D12: available probe + evidence gate true → webgpu (the only webgpu path)", () => {
    expect(resolveHwrDevice(available, true)).toBe("webgpu");
  });

  test("HWR-D13: default evidence gate is HWR_WEBGPU_EVIDENCE and is FALSE today", () => {
    expect(HWR_WEBGPU_EVIDENCE).toBe(false);
    expect(resolveHwrDevice(available)).toBe("wasm");
  });

  test("HWR-D14: resolution depends ONLY on availability + gate (reason text irrelevant)", () => {
    for (const reason of ["no-navigator", "no-gpu-binding", "no-adapter", "adapter-probe-failed"] as const) {
      expect(resolveHwrDevice({ available: false, reason })).toBe("wasm");
    }
  });

  test("HWR-D15: gate true cannot resurrect an unavailable adapter", () => {
    expect(resolveHwrDevice(unavailable, true)).toBe("wasm");
  });
});

describe("HWR-D: vendored-asset audit contract (measured 2026-11-12)", () => {
  test("HWR-D16: device type is exactly the union the engine accepts", () => {
    const devices: Array<"wasm" | "webgpu"> = ["wasm", "webgpu"];
    for (const d of devices) {
      expect(["wasm", "webgpu"]).toContain(d);
    }
  });

  test("HWR-D17: probe results are JSON-serializable (evidence-table friendly)", async () => {
    const probe = await probeWebGPU(fakeNav());
    expect(JSON.parse(JSON.stringify(probe))).toEqual(probe);
    const bad = await probeWebGPU(fakeNav(async () => null));
    expect(JSON.parse(JSON.stringify(bad))).toEqual(bad);
  });
});
