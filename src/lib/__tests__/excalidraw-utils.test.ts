/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { classifyFile, sanitizeScene, titleToFilename } from "../excalidraw-utils";

const mkFile = (name: string, type: string): File =>
  new File(["x"], name, { type });

describe("classifyFile", () => {
  it("routes image types", () => {
    expect(classifyFile(mkFile("photo.png", "image/png"))).toBe("image");
    expect(classifyFile(mkFile("pic.jpg", "image/jpeg"))).toBe("image");
    expect(classifyFile(mkFile("art.svg", "image/svg+xml"))).toBe("image");
    expect(classifyFile(mkFile("no-mime.png", ""))).toBe("image");
    expect(classifyFile(mkFile("webp thing.webp", ""))).toBe("image");
  });

  it("routes pdfs", () => {
    expect(classifyFile(mkFile("paper.pdf", "application/pdf"))).toBe("pdf");
    expect(classifyFile(mkFile("doc.PDF", ""))).toBe("pdf");
  });

  it("routes excalidraw scenes before generic files", () => {
    expect(classifyFile(mkFile("whiteboard.excalidraw", "application/json"))).toBe("excalidraw");
    expect(classifyFile(mkFile("scene.excalidraw.json", ""))).toBe("excalidraw");
  });

  it("routes text and markdown", () => {
    expect(classifyFile(mkFile("notes.txt", "text/plain"))).toBe("text");
    expect(classifyFile(mkFile("README.md", "text/markdown"))).toBe("text");
    expect(classifyFile(mkFile("data.csv", "text/csv"))).toBe("text");
    expect(classifyFile(mkFile("plain.md", ""))).toBe("text");
  });

  it("marks unknown types", () => {
    expect(classifyFile(mkFile("archive.zip", "application/zip"))).toBe("unknown");
    expect(classifyFile(mkFile("binary.bin", "application/octet-stream"))).toBe("unknown");
  });
});

describe("sanitizeScene", () => {
  it("drops orphan files not referenced by any image element", () => {
    const payload = {
      elements: [
        { type: "image", fileId: "f1" },
        { type: "text", text: "hi" },
      ],
      files: {
        f1: { id: "f1", dataURL: "data:...", mimeType: "image/png", created: 1 },
        f2: { id: "f2", dataURL: "data:...", mimeType: "image/png", created: 1 },
      },
    };
    const out = sanitizeScene(payload);
    expect(Object.keys(out.files)).toEqual(["f1"]);
  });

  it("keeps elements untouched and handles empty scenes", () => {
    const payload = { elements: [{ type: "text", text: "x" }], files: {} };
    expect(sanitizeScene(payload)).toEqual(payload);
    expect(sanitizeScene({ elements: [], files: {} })).toEqual({ elements: [], files: {} });
  });

  it("drops broken file records", () => {
    const payload = {
      elements: [{ type: "image", fileId: "f1" }],
      files: {
        f1: { id: "f1", dataURL: "", mimeType: "image/png", created: 1 },
      },
    };
    const out = sanitizeScene(payload);
    expect(Object.keys(out.files)).toEqual([]);
  });
});

describe("titleToFilename", () => {
  it("slugifies titles", () => {
    expect(titleToFilename("My Physics Notes", "png")).toBe("My-Physics-Notes.png");
    expect(titleToFilename("  spaced   out  ", "excalidraw")).toBe("spaced-out.excalidraw");
  });

  it("strips filesystem-hostile characters", () => {
    expect(titleToFilename("a/b\\c:d*e?f<g>h|i", "svg")).toBe("abcdefghi.svg");
  });

  it("falls back for empty titles", () => {
    expect(titleToFilename("///", "png")).toBe("untitled.png");
    expect(titleToFilename("", "png")).toBe("untitled.png");
  });

  it("caps length", () => {
    const out = titleToFilename("x".repeat(200), "png");
    expect(out.length).toBeLessThanOrEqual(60 + 4);
  });
});
