/// <reference types="bun-types" />
/**
 * Unit tests for the browser-side OCR engine driver (ocr-client.ts).
 *
 * The driver is exercised against a minimal DOM mock installed on
 * globalThis: UMD script injection, the typed failure when the Tesseract
 * global is missing after load, the createWorker contract (policy langs,
 * LSTM-only oem, vendored same-origin asset paths, gzip), worker singleton
 * reuse across calls, non-string text coercion, worker recycling after a
 * hard recognize failure, and the init-failed mapping.
 *
 * Deliberately NOT covered: the no-`document` rejection branch. Its
 * enginePromise is never reset (the cache check precedes the DOM check),
 * so exercising it would permanently latch the module singleton and make
 * every browser-env test in this file impossible — the two paths cannot
 * share one module instance.
 *
 * Mock fidelity note: the script "load" event MUST fire asynchronously
 * (queueMicrotask), like a real browser. Fired synchronously from
 * appendChild it would run inside the `new Promise(executor)` call, and
 * the listener's `enginePromise = null` reset would be overwritten by the
 * still-pending outer assignment — latching the failed load forever.
 * No network, no real tesseract.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OCR_LANGS, OcrError } from "../ocr";
import { recognizeImageText } from "../ocr-client";

const IMAGE_URL = "data:image/png;base64,aWRlbnRpY2Fs";

/** Capture a promise's rejection (null when it resolves) — keeps typed codes assertable. */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

/* ------------------------------- DOM mock ------------------------------- */

interface MockScript {
  src: string;
  addEventListener(type: string, fn: () => void): void;
  fire(type: string): void;
}

function makeScript(): MockScript {
  const listeners = new Map<string, Array<() => void>>();
  return {
    src: "",
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

interface MockWorker {
  recognize(image: string): Promise<{ data: { text?: unknown } }>;
  terminate(): Promise<unknown>;
}

/** Mutable engine behavior the tests steer per-case. */
let recognizeImpl: (image: string) => Promise<{ data: { text?: unknown } }> = async (image) => {
  recognizedImages.push(image);
  return { data: { text: "Hallo Welt" } };
};
let createWorkerImpl: () => Promise<MockWorker> = async () => ({
  recognize: (image) => recognizeImpl(image),
  terminate: async () => {
    terminatedCount += 1;
  },
});

const workerCalls: Array<{ langs: string; oem: number; options: Record<string, unknown> }> = [];
const appendedScripts: MockScript[] = [];
const recognizedImages: string[] = [];
let terminatedCount = 0;

const fakeTesseract = {
  createWorker: async (
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<MockWorker> => {
    workerCalls.push({ langs, oem, options });
    return createWorkerImpl();
  },
};

const documentMock = {
  querySelector: () => null,
  createElement: () => makeScript(),
  head: {
    appendChild: (script: MockScript): void => {
      appendedScripts.push(script);
      // a real browser always fires script load asynchronously
      queueMicrotask(() => script.fire("load"));
    },
  },
};

const windowMock: { Tesseract?: unknown } = {};

const g = globalThis as unknown as Record<string, unknown>;

/* ------------------------------ the tests ------------------------------- */

describe("recognizeImageText in a mocked browser", () => {
  beforeAll(() => {
    g.document = documentMock;
    g.window = windowMock;
  });

  afterAll(() => {
    delete g.document;
    delete g.window;
  });

  it("injects the vendored UMD script and fails typed when the Tesseract global is missing after load", async () => {
    windowMock.Tesseract = undefined;
    const err = await captureError(() => recognizeImageText(IMAGE_URL));
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).code).toBe("load-failed");
    expect((err as OcrError).message).toContain("Tesseract global missing");
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0].src).toBe("/ocr/tesseract.min.js");
  });

  it("recognizes text through a worker created with the policy's langs, oem and vendored paths", async () => {
    windowMock.Tesseract = fakeTesseract;
    const text = await recognizeImageText(IMAGE_URL);
    expect(text).toBe("Hallo Welt");
    expect(recognizedImages).toEqual([IMAGE_URL]);
    // the failed attempt freed the engine promise → a fresh script injection
    expect(appendedScripts).toHaveLength(2);
    expect(workerCalls).toHaveLength(1);
    expect(workerCalls[0].langs).toBe(OCR_LANGS);
    expect(workerCalls[0].oem).toBe(1);
    expect(workerCalls[0].options).toEqual({
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
    });
  });

  it("reuses the worker singleton across calls and coerces non-string text to an empty result", async () => {
    recognizeImpl = async () => ({ data: { text: 42 } }); // corrupt engine payload
    const text = await recognizeImageText(IMAGE_URL);
    expect(text).toBe("");
    expect(workerCalls).toHaveLength(1); // no second createWorker
    expect(appendedScripts).toHaveLength(2); // the engine script stayed cached
  });

  it("recycles the worker after a hard recognize failure", async () => {
    recognizeImpl = async () => {
      throw new Error("engine wedged");
    };
    const err = await captureError(() => recognizeImageText(IMAGE_URL));
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).code).toBe("recognize-failed");
    expect((err as OcrError).message).toBe("engine wedged");
    expect(terminatedCount).toBe(1); // the wedged worker was torn down

    recognizeImpl = async (image) => {
      recognizedImages.push(image);
      return { data: { text: "retry ok" } };
    };
    const retry = await recognizeImageText(IMAGE_URL);
    expect(retry).toBe("retry ok");
    expect(workerCalls).toHaveLength(2); // a FRESH worker was created
  });

  it("maps worker-creation failures to init-failed without re-injecting the engine script", async () => {
    // free the live singleton first (only a hard failure does that)
    recognizeImpl = async () => {
      throw new Error("wedge");
    };
    await captureError(() => recognizeImageText(IMAGE_URL));
    const scriptsBefore = appendedScripts.length;
    const workersBefore = workerCalls.length;

    createWorkerImpl = async () => {
      throw new Error("no core files");
    };
    const err = await captureError(() => recognizeImageText(IMAGE_URL));
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).code).toBe("init-failed");
    expect((err as OcrError).message).toBe("no core files");
    expect(appendedScripts).toHaveLength(scriptsBefore); // the engine was cached
    expect(workerCalls).toHaveLength(workersBefore + 1);

    // the next attempt retries cleanly once the factory works again
    createWorkerImpl = async () => ({
      recognize: (image) => recognizeImpl(image),
      terminate: async () => {
        terminatedCount += 1;
      },
    });
    recognizeImpl = async (image) => {
      recognizedImages.push(image);
      return { data: { text: "retry ok" } };
    };
    const again = await recognizeImageText(IMAGE_URL);
    expect(again).toBe("retry ok");
  });
});
