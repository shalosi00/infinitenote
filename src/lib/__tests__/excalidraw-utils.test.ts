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

  it("flips a pending image to saved when its file data is kept (issue #122)", () => {
    const payload = {
      elements: [
        { type: "image", fileId: "f1", status: "pending" },
        { type: "image", fileId: "f2", status: "pending" },
      ],
      files: {
        // f1: valid data → the element must persist as "saved"
        f1: { id: "f1", dataURL: "data:...", mimeType: "image/png", created: 1 },
        // f2: broken record (no dataURL) → the file is dropped, the
        // element's status must stay untouched (no data ⇒ no flip)
        f2: { id: "f2", dataURL: "", mimeType: "image/png", created: 1 },
      },
    };
    const out = sanitizeScene(payload) as unknown as {
      elements: Array<{ type: string; fileId?: string; status?: string }>;
      files: Record<string, unknown>;
    };
    expect(out.elements[0].status).toBe("saved");
    expect(out.elements[1].status).toBe("pending");
    expect(Object.keys(out.files)).toEqual(["f1"]);
  });

  it("never touches non-pending or non-image elements (issue #122)", () => {
    const payload = {
      elements: [
        { type: "image", fileId: "f1", status: "saved" },
        { type: "image", fileId: "f1", status: "error" },
        { type: "image", status: "pending", fileId: null },
        { type: "text", text: "x", status: "pending" },
        { type: "embeddable", status: "pending", link: "about:blank" },
      ],
      files: {
        f1: { id: "f1", dataURL: "data:...", mimeType: "image/png", created: 1 },
      },
    };
    const out = sanitizeScene(payload) as unknown as {
      elements: Array<{ type: string; status?: string }>;
    };
    expect(out.elements.map((e) => e.status)).toEqual(["saved", "error", "pending", "pending", "pending"]);
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

  it("keeps CJK titles instead of collapsing to untitled (issue #74)", () => {
    expect(titleToFilename("会议记录", "png")).toBe("会议记录.png");
    expect(titleToFilename("快速笔记 2026-11-07", "pdf")).toBe(
      "快速笔记-2026-11-07.pdf",
    );
    expect(titleToFilename("日语のノート", "svg")).toBe("日语のノート.svg");
  });

  it("keeps accented Latin letters", () => {
    expect(titleToFilename("Café Ünïcode", "svg")).toBe("Café-Ünïcode.svg");
  });

  it("strips emoji without splitting surrogate pairs", () => {
    // 📝 (U+1F4DD) is a surrogate pair — it must vanish whole, not leave
    // a lone (invalid) half behind
    expect(titleToFilename("📝笔记", "png")).toBe("笔记.png");
    expect(titleToFilename("a\u{1F600}b", "png")).toBe("ab.png");
  });

  it("caps CJK length by code points, not UTF-16 units", () => {
    const out = titleToFilename("字".repeat(80), "png");
    expect(Array.from(out)).toHaveLength(60 + 4); // 60 字 + ".png"
  });

  it("still strips hostile characters next to CJK text", () => {
    expect(titleToFilename("会议:记录?", "png")).toBe("会议记录.png");
  });
});
