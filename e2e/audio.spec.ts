/**
 * Audio blocks (issue #67): import audio files, record clips in-app, draw
 * over them, and reload — everything on the real canvas.
 *
 * Recording is tested against a mocked media pipeline: real microphone
 * capture is neither available nor deterministic in CI. The mock replaces
 * `getUserMedia` and `MediaRecorder` with a stub that produces a valid
 * audio blob on stop, so the spec exercises the app's full wiring:
 * permission request → recorder lifecycle → timer UI → blob → audio block.
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachErrorCollector,
  clickInNotebook,
  expectCount,
  openPage,
  resetToSeed,
  saveNow,
  sceneTypes,
  serializeCurrentPage,
  setActiveTool,
} from "./helpers";

const FX = path.join(__dirname, "fixtures");

/**
 * Install the fake media pipeline BEFORE any app code runs.
 * The stub MediaRecorder emits one small audio/webm chunk on stop.
 */
async function mockMediaPipeline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => undefined, kind: "audio" }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => fakeStream,
      },
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
      constructor(_stream: unknown, opts?: { mimeType?: string }) {
        this.mimeType = opts?.mimeType ?? "audio/webm";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(["fake-webm-audio-bytes"], { type: this.mimeType }) });
          this.onstop?.();
        }, 0);
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  });
}

interface SerializedScene {
  elements: Array<{
    type: string;
    id?: string;
    link?: string | null;
    customData?: { audioName?: string; audioData?: string } | null;
  }>;
  files: Record<string, unknown>;
}

test.describe.serial("audio: import, record, play, draw over, persist", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await mockMediaPipeline(page);
    consoleErrors = attachErrorCollector(page);
    await resetToSeed(page);
  });

  test.afterAll(async () => {
    expect(consoleErrors, "browser must stay error-free").toEqual([]);
    await page.close();
  });

  test("starts from an empty new page", async () => {
    await clickInNotebook(page, "Welcome Notebook", "Add page");
    await expectCount(page, 0);
  });

  test("imports an audio file as an embeddable audio block", async () => {
    await page.setInputFiles(
      'input[aria-label="Import files"]',
      path.join(FX, "test-audio.wav"),
    );
    await expectCount(page, 1);
    await expect.poll(() => sceneTypes(page)).toContain("embeddable");
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const audio = scene.elements.find((e) => e.type === "embeddable");
    // marker scheme on the link (survives Excalidraw's link sanitization),
    // payload + name in customData (survives scene restore)
    expect(audio?.link).toBe("infinitenote:audio");
    expect(audio?.customData?.audioData?.startsWith("data:audio/wav")).toBe(true);
    expect(audio?.customData?.audioName).toBe("test-audio.wav");
  });

  test("renders a native audio player with the clip name", async () => {
    const player = page.locator('[data-testid="audio-player"]');
    await expect(player).toHaveCount(1);
    await expect(player.first()).toHaveAttribute("src", /^data:audio\/wav/);
    const name = page.locator('[data-testid="audio-clip-name"]');
    await expect(name.first()).toContainText("test-audio.wav");
  });

  test("records a clip in-app via the mocked media pipeline", async () => {
    await page.getByTestId("record-audio").click();
    await expect(page.getByTestId("recording-indicator")).toBeVisible();
    // mm:ss label from the very first frame (exact value is timing-dependent)
    await expect(page.getByTestId("recording-timer")).toHaveText(/^\d+:\d{2}$/);
    // let the timer tick at least once so elapsed-time wiring is exercised
    await page.waitForTimeout(1100);
    await page.getByTestId("stop-recording").click();
    await expect(page.getByTestId("recording-indicator")).toHaveCount(0);
    // the take lands on the canvas as a second audio block
    await expectCount(page, 2);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    const recordings = scene.elements.filter(
      (e) => e.type === "embeddable" && e.customData?.audioName?.startsWith("Recording "),
    );
    expect(recordings).toHaveLength(1);
    expect(recordings[0].customData?.audioData?.startsWith("data:audio/webm")).toBe(true);
    expect(recordings[0].link).toBe("infinitenote:audio");
  });

  test("shows two players after the recording", async () => {
    await expect(page.locator('[data-testid="audio-player"]')).toHaveCount(2);
  });

  test("draws ink on top of the audio blocks with real mouse input", async () => {
    await setActiveTool(page, "freedraw");
    const box = await page.locator(".excalidraw").boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.3, { steps: 12 });
    await page.mouse.up();
    await setActiveTool(page, "selection");
    await expectCount(page, 3); // 2 audio blocks + 1 freedraw stroke
    const types = await sceneTypes(page);
    expect(types).toContain("freedraw");
    expect(types).toContain("embeddable");
  });

  test("audio scene persists across a reload", async () => {
    await saveNow(page);
    await page.reload();
    await openPage(page, "Page 2");
    await expectCount(page, 3);
    await expect(page.locator('[data-testid="audio-player"]')).toHaveCount(2);
    const scene = JSON.parse(await serializeCurrentPage(page)) as SerializedScene;
    expect(scene.elements.filter((e) => e.type === "embeddable")).toHaveLength(2);
  });
});
