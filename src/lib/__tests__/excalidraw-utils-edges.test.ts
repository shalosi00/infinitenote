/// <reference types="bun-types" />
/**
 * Edge-case coverage for the SSR-safe Excalidraw helpers — the import
 * router's precedence corners (audio clips, structured OneNote exports,
 * generic text containers), the sanitizer's defensive handling of null file
 * records, the structural fingerprint's deep canonicalization, and the
 * slug characters the happy paths miss.
 *
 * Complements excalidraw-utils.test.ts (core routing/sanitizing) and
 * scene-signature.test.ts (autosave-gate math) — no assertion duplicates
 * either file.
 */
import { describe, expect, it } from "bun:test";
import {
  classifyFile,
  normalizeImageStatuses,
  sanitizeScene,
  structuralSceneJson,
  titleToFilename,
} from "../excalidraw-utils";
import type { ScenePayload } from "../types";

const mkFile = (name: string, type: string): File => new File(["x"], name, { type });

describe("classifyFile — audio routing precedence", () => {
  it("routes clips by extension when the MIME is empty or misleading, ahead of every generic bucket", () => {
    expect(classifyFile(mkFile("voice-memo.mp3", ""))).toBe("audio");
    // .opus inside a video container: the extension is unambiguously audio
    expect(classifyFile(mkFile("take.opus", "video/mp4"))).toBe("audio");
    // MediaRecorder's own stamp: .webm + audio/webm IS a clip
    expect(classifyFile(mkFile("clip.webm", "audio/webm"))).toBe("audio");
    // uppercase extensions survive the lowercasing
    expect(classifyFile(mkFile("VOICE.MP3", ""))).toBe("audio");
  });
});

describe("classifyFile — structured OneNote exports", () => {
  it("routes Word docs, .mht/.mhtml pages and the archive MIMEs to their structured importers", () => {
    expect(classifyFile(mkFile("report.docx", ""))).toBe("docx");
    expect(classifyFile(mkFile("page.mht", ""))).toBe("mht");
    // ".mhtml" ends with ".html" — the mht check must win
    expect(classifyFile(mkFile("page.mhtml", ""))).toBe("mht");
    // OneNote's "Save as .mht" stamps these MIMEs regardless of file name
    expect(classifyFile(mkFile("attachment.tmp", "message/rfc822"))).toBe("mht");
    expect(classifyFile(mkFile("attachment.tmp", "application/x-mimearchive"))).toBe("mht");
  });
});

describe("classifyFile — HTML pages, generic text and precedence corners", () => {
  it("routes html by extension or MIME, generic containers to text, and lets a .pdf name beat an image MIME", () => {
    expect(classifyFile(mkFile("page.html", ""))).toBe("html");
    expect(classifyFile(mkFile("page.htm", ""))).toBe("html");
    expect(classifyFile(mkFile("exported.dat", "text/html"))).toBe("html");
    // generic text containers nobody else claims
    expect(classifyFile(mkFile("data.json", ""))).toBe("text");
    expect(classifyFile(mkFile("config.yaml", ""))).toBe("text");
    expect(classifyFile(mkFile("debug.log", ""))).toBe("text");
    // double extensions nobody claims fall through
    expect(classifyFile(mkFile("backup.tar.gz", ""))).toBe("unknown");
    // pdf is checked before image: the name wins over a misleading MIME
    expect(classifyFile(mkFile("scan.pdf", "image/png"))).toBe("pdf");
  });
});

describe("normalizeImageStatuses — falsy data guard", () => {
  it("keeps a pending image pending when the registered file carries an empty dataURL", () => {
    const payload = {
      elements: [{ type: "image", id: "e1", fileId: "f1", status: "pending" }],
      files: { f1: { id: "f1", dataURL: "", mimeType: "image/png", created: 1 } },
    };
    const out = normalizeImageStatuses(payload);
    expect((out.elements[0] as { status?: string }).status).toBe("pending");
    // nothing flipped ⇒ the same payload reference, no re-wrap
    expect(out).toBe(payload);
  });
});

describe("sanitizeScene — defensive file records", () => {
  it("drops null file records without dropping the image element that referenced them", () => {
    const payload = {
      elements: [{ type: "image", id: "e1", fileId: "f1", status: "saved" }],
      files: {
        f1: null, // corrupt row straight from a damaged DB
        f2: { id: "f2", dataURL: "data:image/png;base64,xx", mimeType: "image/png", created: 1 },
      },
    } as unknown as ScenePayload;
    const out = sanitizeScene(payload);
    // f1 is unusable (optional-chained away), f2 is orphaned (no image uses it)
    expect(Object.keys(out.files)).toEqual([]);
    // the referencing element itself survives — only its file is gone
    expect(out.elements).toEqual(payload.elements);
  });
});

describe("structuralSceneJson — deep canonicalization", () => {
  it("sorts object keys at every depth while keeping nested array order significant", () => {
    const fresh = {
      elements: [
        { id: "e1", type: "freedraw", style: { stroke: "red", fill: "blue" }, points: [[0, 0], [10, 10]] },
      ],
      files: { fa: { id: "fa", dataURL: "data:1", mimeType: "image/png", created: 1 } },
    };
    // the same scene as a DB round-trip: every object's keys reordered
    const fromDb = {
      files: { fa: { created: 1, mimeType: "image/png", dataURL: "data:1", id: "fa" } },
      elements: [
        { points: [[0, 0], [10, 10]], style: { fill: "blue", stroke: "red" }, type: "freedraw", id: "e1" },
      ],
    };
    expect(structuralSceneJson(fresh)).toBe(structuralSceneJson(fromDb));
    // a reordered point list is different content — arrays never sort
    const reordered = {
      elements: [
        { id: "e1", type: "freedraw", style: { stroke: "red", fill: "blue" }, points: [[10, 10], [0, 0]] },
      ],
      files: {},
    };
    expect(structuralSceneJson(fresh)).not.toBe(structuralSceneJson(reordered));
  });
});

describe("titleToFilename — slug character edges", () => {
  it("strips control characters outright (spaces slugify, NUL/tab/newline vanish) and keeps -._ runs", () => {
    expect(titleToFilename("a\u0000b\nc\td", "png")).toBe("abcd.png");
    expect(titleToFilename("a b  c", "png")).toBe("a-b-c.png");
    expect(titleToFilename("v1.2_beta-3", "svg")).toBe("v1.2_beta-3.svg");
  });

  it("drops exactly the 61st code point at the cap boundary", () => {
    expect(titleToFilename("x".repeat(61), "png")).toBe(`${"x".repeat(60)}.png`);
  });
});
