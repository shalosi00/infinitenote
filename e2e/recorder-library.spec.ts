import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachErrorCollector, resetToSeed } from "./helpers";

/**
 * Bug-hunt wave 2, PR 4 — recording resilience + library persistence:
 * - #93 a MediaRecorder error mid-take must tear down the recording UI
 *      (the app previously stayed "recording" forever)
 * - #96 the shape library saved to localStorage must survive a reload
 *      (it was written on every change but never read back)
 */
test.describe.serial("wave2: recorder errors + library persistence", () => {
  let page: Page;
  let consoleErrors: string[];

  /**
   * Fake media pipeline whose recorder FAILS on demand: when the page sets
   * `window.__FAIL_RECORDER__`, the next data tick fires `onerror` with the
   * recorder already inactive (worst case: no salvageable onstop path).
   */
  async function mockFailingMediaPipeline(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const fakeStream = {
        getTracks: () => [{ stop: () => undefined, kind: "audio" }],
      };
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: async () => fakeStream },
        configurable: true,
      });
      class FakeMediaRecorder {
        static isTypeSupported(mime: string) {
          return typeof mime === "string" && mime.startsWith("audio/");
        }
        mimeType: string;
        state: "inactive" | "recording" = "recording";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        constructor(_stream: unknown, opts?: { mimeType?: string }) {
          this.mimeType = opts?.mimeType ?? "audio/webm";
        }
        start() {
          this.state = "recording";
          setTimeout(() => {
            if ((window as unknown as Record<string, unknown>).__FAIL_RECORDER__) {
              this.state = "inactive"; // device died: no stop possible
              this.onerror?.(new Event("error"));
            } else {
              this.ondataavailable?.({
                data: new Blob(["fake-webm-audio-bytes"], { type: this.mimeType }),
              });
            }
          }, 150);
        }
        stop() {
          this.state = "inactive";
          setTimeout(() => {
            this.ondataavailable?.({
              data: new Blob(["fake-webm-audio-bytes"], { type: this.mimeType }),
            });
            this.onstop?.();
          }, 0);
        }
      }
      (window as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
    });
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await mockFailingMediaPipeline(page);
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("#93 a recorder error tears down the recording state instead of hanging", async () => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__FAIL_RECORDER__ = true;
    });
    await page.getByTestId("record-audio").click();
    await expect(page.getByTestId("recording-indicator")).toBeVisible();

    // the error handler must exit recording mode (previously stuck forever)
    await expect(page.getByTestId("recording-indicator")).toHaveCount(0, {
      timeout: 10_000,
    });
    // and the failure surfaces as a toast
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      /microphone|recording/i,
      { timeout: 10_000 },
    );
    // recording again must work (the guard state was reset)
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__FAIL_RECORDER__ = false;
    });
    await page.getByTestId("record-audio").click();
    await expect(page.getByTestId("recording-indicator")).toBeVisible();
    await page.getByTestId("stop-recording").click();
    await expect(page.getByTestId("recording-indicator")).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("#96 the saved shape library survives a reload", async () => {
    // add one library item through the real Excalidraw API
    await page.evaluate(async () => {
      const api = window.__NOTE_E2E__?.excalidraw as unknown as {
        updateLibrary: (opts: {
          libraryItems: Array<Record<string, unknown>>;
        }) => Promise<unknown>;
      };
      if (!api) throw new Error("e2e hook missing");
      await api.updateLibrary({
        libraryItems: [
          {
            id: "e2e-lib-item",
            status: "saved",
            created: 1731000000000,
            name: null,
            elements: [
              {
                type: "rectangle",
                id: "e2e-lib-shape",
                x: 0,
                y: 0,
                width: 100,
                height: 60,
                angle: 0,
                strokeColor: "#000000",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                roundness: null,
                seed: 1,
                version: 1,
                versionNonce: 1,
                isDeleted: false,
                boundElements: null,
                updated: 1,
                link: null,
                locked: false,
              },
            ],
          },
        ],
      });
    });
    // onLibraryChange persists asynchronously
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("infinitenote.library");
          return raw ? (JSON.parse(raw) as Array<{ id?: string }>).some((i) => i.id === "e2e-lib-item") : false;
        }),
      )
      .toBe(true);

    // reload — the library must come back (previously wiped every time)
    await page.goto("/?e2e=1");
    await page.waitForFunction(() => document.querySelector(".excalidraw") !== null, {
      timeout: 30_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("infinitenote.library");
          return raw ? (JSON.parse(raw) as Array<{ id?: string }>).some((i) => i.id === "e2e-lib-item") : false;
        }),
      )
      .toBe(true);
  });
});
