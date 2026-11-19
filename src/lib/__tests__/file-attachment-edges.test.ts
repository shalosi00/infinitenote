/// <reference types="bun-types" />
/**
 * General file attachments — edge cases (issue #278, ids ATT-FE*):
 * the combined rotation-exact hit-test across BOTH chip kinds (generic
 * files and PDFs share the context-menu layer), z-order, corrupt
 * geometry, and the formatter boundaries the main file only touches.
 */
import { describe, expect, it } from "bun:test";
import {
  FILE_ATTACHMENT_LINK_SCHEME,
  fileAttachmentOf,
  fileBadgeLabel,
  formatFileSize,
  hitTestAttachment,
  type FileAttachmentElementLike,
} from "../file-attachment";
import { PDF_ATTACHMENT_LINK_SCHEME, type PdfAttachmentElementLike } from "../pdf-attachment";

const FILE_URL = "data:application/zip;base64,AAA=";
const PDF_URL = "data:application/pdf;base64,AAA=";

function fileChip(overrides: Partial<FileAttachmentElementLike> = {}): FileAttachmentElementLike {
  return {
    id: "file1",
    type: "embeddable",
    x: 100,
    y: 100,
    width: 280,
    height: 44,
    angle: 0,
    isDeleted: false,
    link: FILE_ATTACHMENT_LINK_SCHEME,
    customData: {
      fileName: "archive.zip",
      fileData: FILE_URL,
      fileSize: 1,
      fileMime: "application/zip",
    },
    ...overrides,
  };
}

function pdfChip(overrides: Partial<PdfAttachmentElementLike> = {}): PdfAttachmentElementLike {
  return {
    id: "pdf1",
    type: "embeddable",
    x: 400,
    y: 100,
    width: 280,
    height: 44,
    angle: 0,
    isDeleted: false,
    link: PDF_ATTACHMENT_LINK_SCHEME,
    customData: { pdfName: "report.pdf", pdfData: PDF_URL },
    ...overrides,
  };
}

describe("hitTestAttachment — generic chips (ATT-FE01)", () => {
  const els = [fileChip()];

  it("hits inside the chip and reports kind=file", () => {
    const hit = hitTestAttachment(100, 100, els);
    expect(hit?.kind).toBe("file");
    if (hit?.kind === "file") {
      expect(hit.attachment.id).toBe("file1");
      expect(hit.attachment.name).toBe("archive.zip");
    }
  });

  it("is rotation-exact (90° chip hit where it renders)", () => {
    // a 280x44 chip rotated 90° around its center occupies a 44x280 strip
    const rotated = fileChip({ angle: Math.PI / 2, x: 100, y: 100 });
    // the visual strip's top-left is near (218, 22); its center stays fixed
    expect(hitTestAttachment(240, 122, [rotated])).not.toBeNull(); // inside the rotated strip
    expect(hitTestAttachment(110, 110, [rotated])).toBeNull(); // inside the UNROTATED box only
  });

  it("misses outside, on edges +1, and on corrupt geometry", () => {
    expect(hitTestAttachment(100 + 281, 122, els)).toBeNull();
    expect(hitTestAttachment(100, 100 + 45, els)).toBeNull();
    expect(hitTestAttachment(100, 100, [fileChip({ width: 0 })])).toBeNull();
    expect(hitTestAttachment(100, 100, [fileChip({ height: -1 })])).toBeNull();
  });
});

describe("hitTestAttachment — mixed scenes (ATT-FE02)", () => {
  it("routes PDF chips with kind=pdf", () => {
    const hit = hitTestAttachment(500, 120, [pdfChip()]);
    expect(hit?.kind).toBe("pdf");
    if (hit?.kind === "pdf") expect(hit.attachment.name).toBe("report.pdf");
  });

  it("returns the TOPMOST hit in z-order across both kinds", () => {
    // overlap both chips at (400..540): later elements win
    const laterFile = fileChip({ id: "file2", x: 400 });
    const hit = hitTestAttachment(500, 120, [pdfChip(), laterFile]);
    expect(hit?.kind).toBe("file");
    const hit2 = hitTestAttachment(500, 120, [laterFile, pdfChip()]);
    expect(hit2?.kind).toBe("pdf");
  });

  it("skips tombstones, non-embeddables and unvalidated chips", () => {
    const els = [
      fileChip({ isDeleted: true }),
      { id: "rect", type: "rectangle", x: 100, y: 100, width: 280, height: 44, link: FILE_ATTACHMENT_LINK_SCHEME },
      fileChip({ customData: null }),
      fileChip({ customData: { fileName: "", fileData: FILE_URL, fileSize: 1, fileMime: "application/zip" } }),
    ];
    expect(hitTestAttachment(100, 100, els)).toBeNull();
  });

  it("still finds a valid chip under invalid ones", () => {
    const els = [
      fileChip({ id: "bad", customData: null }),
      fileChip({ id: "good", y: 100 }),
    ];
    const hit = hitTestAttachment(100, 100, els);
    expect(hit?.kind).toBe("file");
    if (hit?.kind === "file") expect(hit.attachment.id).toBe("good");
  });

  it("accepts both element shapes in one call (the canvas passes its scene)", () => {
    const hit = hitTestAttachment(500, 120, [fileChip(), pdfChip()]);
    expect(hit).not.toBeNull();
  });
});

describe("fileAttachmentOf tolerances (ATT-FE03)", () => {
  it("accepts a huge but finite size and keeps the id of anonymous elements", () => {
    const a = fileAttachmentOf(fileChip({ id: undefined, customData: {
      fileName: "a.bin", fileData: FILE_URL, fileSize: 10 * 1024 * 1024, fileMime: "application/octet-stream",
    } }));
    expect(a).not.toBeNull();
    expect(a!.id).toBe("");
    expect(a!.size).toBe(10 * 1024 * 1024);
  });

  it("rejects Infinity and fractional-minus sizes", () => {
    expect(fileAttachmentOf(fileChip({ customData: {
      fileName: "a.bin", fileData: FILE_URL, fileSize: Number.POSITIVE_INFINITY, fileMime: "application/zip",
    } }))).toBeNull();
    expect(fileAttachmentOf(fileChip({ customData: {
      fileName: "a.bin", fileData: FILE_URL, fileSize: -0.5, fileMime: "application/zip",
    } }))).toBeNull();
  });
});

describe("formatter boundaries (ATT-FE04)", () => {
  it("formatFileSize at unit boundaries", () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatFileSize(1024 * 10)).toBe("10 KB");
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });

  it("fileBadgeLabel with unusual names", () => {
    expect(fileBadgeLabel("a.b.c.d")).toBe("D");
    expect(fileBadgeLabel("x.7z")).toBe("7Z");
    expect(fileBadgeLabel("w.three1")).toBe("THRE");
    expect(fileBadgeLabel("sp ace.zip")).toBe("ZIP");
  });
});
