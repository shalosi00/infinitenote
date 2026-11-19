/// <reference types="bun-types" />
/**
 * General file attachments (issue #278, ids ATT-F*) — the OneNote
 * "Insert > File Attachment" parity chip that generalizes the shipped
 * PDF-chip pattern.
 *
 * Pure policy only: marker detection, payload extraction/validation, the
 * import size cap, MIME normalization, base64→Blob decoding, the human
 * size + badge formatters, and the exact toast lines. The chip element
 * factory + canvas integration are exercised by e2e/file-attachment.spec.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  FILE_ATTACHMENT_HEIGHT,
  FILE_ATTACHMENT_LINK_SCHEME,
  FILE_ATTACHMENT_WIDTH,
  MAX_FILE_ATTACHMENT_BYTES,
  fileAttachmentOf,
  fileAttachmentSkippedToast,
  fileAttachedToast,
  fileBadgeLabel,
  fileDataUrlToBlob,
  formatFileSize,
  isFileAttachmentLink,
  isFileAttachmentTooLarge,
  isFileDataUrl,
  withFileMime,
  type FileAttachmentElementLike,
} from "../file-attachment";

const BYTES = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xd4, 0x7f,
]);
const ZIP_DATA_URL = `data:application/zip;base64,${Buffer.from(BYTES).toString("base64")}`;

/** A well-formed chip element (the shape makeFileAttachmentElement creates). */
function chip(overrides: Partial<FileAttachmentElementLike> = {}): FileAttachmentElementLike {
  return {
    id: "chip1",
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
      fileData: ZIP_DATA_URL,
      fileSize: 12,
      fileMime: "application/zip",
    },
    ...overrides,
  };
}

describe("isFileAttachmentLink (ATT-F01)", () => {
  it("accepts the marker scheme", () => {
    expect(isFileAttachmentLink("infinitenote:file")).toBe(true);
  });

  it("tolerates a suffix after the scheme", () => {
    expect(isFileAttachmentLink("infinitenote:file:v2")).toBe(true);
  });

  it("rejects null, other schemes and near-misses", () => {
    expect(isFileAttachmentLink(null)).toBe(false);
    expect(isFileAttachmentLink(undefined)).toBe(false);
    expect(isFileAttachmentLink("")).toBe(false);
    expect(isFileAttachmentLink("infinitenote:pdf")).toBe(false);
    // a SHORTER prefix is not the scheme; a LONGER string after the scheme
    // is tolerated by the prefix convention (the PDF chip's documented
    // behavior — "tolerates a suffix after the scheme")
    expect(isFileAttachmentLink("infinitenote:fil")).toBe(false);
    expect(isFileAttachmentLink("https://example.com")).toBe(false);
    expect(isFileAttachmentLink("data:application/zip;base64,AAA")).toBe(false);
  });
});

describe("the size cap (ATT-F02)", () => {
  it("is 10 MiB — the PDF/audio policy", () => {
    expect(MAX_FILE_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("refuses anything over the cap and accepts the boundary", () => {
    expect(isFileAttachmentTooLarge(MAX_FILE_ATTACHMENT_BYTES + 1)).toBe(true);
    expect(isFileAttachmentTooLarge(MAX_FILE_ATTACHMENT_BYTES)).toBe(false);
    expect(isFileAttachmentTooLarge(0)).toBe(false);
  });
});

describe("isFileDataUrl (ATT-F03)", () => {
  it("accepts base64 data URLs of any MIME", () => {
    expect(isFileDataUrl(ZIP_DATA_URL)).toBe(true);
    expect(isFileDataUrl("data:application/octet-stream;base64,AAA")).toBe(true);
    expect(isFileDataUrl("data:;base64,AAA")).toBe(true);
  });

  it("rejects non-data URLs, URL-encoded payloads and bogus shapes", () => {
    expect(isFileDataUrl(null)).toBe(false);
    expect(isFileDataUrl(undefined)).toBe(false);
    expect(isFileDataUrl("")).toBe(false);
    expect(isFileDataUrl("https://example.com/file.zip")).toBe(false);
    expect(isFileDataUrl("infinitenote:file")).toBe(false);
    expect(isFileDataUrl("data:text/plain,hello%20world")).toBe(false);
    expect(isFileDataUrl("data:hello")).toBe(false);
  });

  it("accepts an empty payload (a 0-byte file is still a file)", () => {
    expect(isFileDataUrl("data:application/zip;base64,")).toBe(true);
  });
});

describe("withFileMime (ATT-F04)", () => {
  it("keeps a URL whose MIME is already the declared one", () => {
    expect(withFileMime(ZIP_DATA_URL, "application/zip")).toBe(ZIP_DATA_URL);
  });

  it("keeps a real MIME even when it differs from the recorded one", () => {
    const url = "data:image/png;base64,AAA";
    expect(withFileMime(url, "application/zip")).toBe(url);
  });

  it("rebuilds the octet-stream default to the recorded MIME", () => {
    const raw = "data:application/octet-stream;base64,AAA";
    expect(withFileMime(raw, "application/vnd.foo")).toBe(
      "data:application/vnd.foo;base64,AAA",
    );
  });

  it("rebuilds an empty-MIME URL to the recorded MIME, preserving params", () => {
    const raw = "data:;charset=utf-8;base64,AAA";
    expect(withFileMime(raw, "text/csv")).toBe("data:text/csv;charset=utf-8;base64,AAA");
    expect(withFileMime("data:;base64,AAA", "text/csv")).toBe("data:text/csv;base64,AAA");
  });

  it("falls back to octet-stream when the file declared nothing", () => {
    const raw = "data:application/octet-stream;base64,AAA";
    expect(withFileMime(raw, "")).toBe(raw);
    expect(withFileMime(raw, "   ")).toBe(raw);
  });

  it("returns null for anything that is not a data URL", () => {
    expect(withFileMime("not-a-url", "application/zip")).toBeNull();
    expect(withFileMime("data:text/plain,hello%20world", "text/plain")).toBeNull();
  });
});

describe("fileAttachmentOf (ATT-F05)", () => {
  it("extracts a valid record with all four fields", () => {
    const a = fileAttachmentOf(chip());
    expect(a).not.toBeNull();
    expect(a!.id).toBe("chip1");
    expect(a!.name).toBe("archive.zip");
    expect(a!.dataUrl).toBe(ZIP_DATA_URL);
    expect(a!.mime).toBe("application/zip");
    expect(a!.size).toBe(12);
  });

  it("rejects tombstones, wrong types, missing links", () => {
    expect(fileAttachmentOf(null)).toBeNull();
    expect(fileAttachmentOf(undefined)).toBeNull();
    expect(fileAttachmentOf(chip({ isDeleted: true }))).toBeNull();
    expect(fileAttachmentOf(chip({ type: "rectangle" }))).toBeNull();
    expect(fileAttachmentOf(chip({ link: "infinitenote:pdf" }))).toBeNull();
    expect(fileAttachmentOf(chip({ link: null }))).toBeNull();
  });

  it("rejects corrupt customData field by field", () => {
    expect(fileAttachmentOf(chip({ customData: null }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileData: ZIP_DATA_URL, fileSize: 1, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "", fileData: ZIP_DATA_URL, fileSize: 1, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileSize: 1, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: "https://x", fileSize: 1, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: ZIP_DATA_URL, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: ZIP_DATA_URL, fileSize: -5, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: ZIP_DATA_URL, fileSize: Number.NaN, fileMime: "application/zip" } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: ZIP_DATA_URL, fileSize: 1 } }))).toBeNull();
    expect(fileAttachmentOf(chip({ customData: { fileName: "a.zip", fileData: ZIP_DATA_URL, fileSize: 1, fileMime: "" } }))).toBeNull();
  });

  it("accepts size 0 and an octet-stream MIME (unknown file types)", () => {
    const a = fileAttachmentOf(
      chip({
        customData: {
          fileName: "Makefile",
          fileData: "data:application/octet-stream;base64,AAA",
          fileSize: 0,
          fileMime: "application/octet-stream",
        },
      }),
    );
    expect(a).not.toBeNull();
    expect(a!.size).toBe(0);
  });
});

describe("fileDataUrlToBlob (ATT-F06)", () => {
  it("round-trips the EXACT original bytes", () => {
    const blob = fileDataUrlToBlob(ZIP_DATA_URL);
    expect(blob.type).toBe("application/zip");
    return blob.arrayBuffer().then((buf) => {
      expect(new Uint8Array(buf)).toEqual(BYTES);
    });
  });

  it("types an empty-MIME URL as octet-stream", () => {
    expect(fileDataUrlToBlob("data:;base64,AAA").type).toBe("application/octet-stream");
  });

  it("throws on a non-base64 URL (callers catch and toast)", () => {
    expect(() => fileDataUrlToBlob("https://example.com")).toThrow();
    expect(() => fileDataUrlToBlob("data:text/plain,hello")).toThrow();
  });
});

describe("formatFileSize (ATT-F07)", () => {
  it("prints bytes under 1 KiB whole", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("prints whole KiB without decimals", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(4096)).toBe("4 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
  });

  it("prints fractional KiB with one decimal", () => {
    expect(formatFileSize(5000)).toBe("4.9 KB");
    expect(formatFileSize(1024 * 1.5)).toBe("1.5 KB");
  });

  it("scales to MB and GB", () => {
    expect(formatFileSize(2400000)).toBe("2.3 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
  });

  it("never crashes on nonsense input", () => {
    expect(formatFileSize(-1)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
  });
});

describe("fileBadgeLabel (ATT-F08)", () => {
  it("uppercases the extension and caps at 4 characters", () => {
    expect(fileBadgeLabel("archive.zip")).toBe("ZIP");
    expect(fileBadgeLabel("report.docx")).toBe("DOCX");
    expect(fileBadgeLabel("sheet.xlsx")).toBe("XLSX");
    expect(fileBadgeLabel("clip.WEBM")).toBe("WEBM");
    expect(fileBadgeLabel("disk-image.wi")) .toBe("WI");
  });

  it("uses the LAST extension", () => {
    expect(fileBadgeLabel("bundle.tar.gz")).toBe("GZ");
  });

  it("falls back to FILE for extension-less or dot-only names", () => {
    expect(fileBadgeLabel("Makefile")).toBe("FILE");
    expect(fileBadgeLabel(".hidden")).toBe("FILE");
    expect(fileBadgeLabel("readme.")).toBe("FILE");
    expect(fileBadgeLabel("")).toBe("FILE");
    expect(fileBadgeLabel("no.ext!")).toBe("FILE");
  });
});

describe("toast lines (ATT-F09)", () => {
  it("the skip toast names the file and the cap", () => {
    expect(fileAttachmentSkippedToast("huge.zip")).toBe(
      'Skipped the file attachment for "huge.zip" — larger than 10 MB, too big to store reliably.',
    );
  });

  it("the batch toast pluralizes", () => {
    expect(fileAttachedToast(1)).toBe("Attached 1 file");
    expect(fileAttachedToast(3)).toBe("Attached 3 files");
  });
});

describe("chip geometry (ATT-F10)", () => {
  it("matches the PDF chip's strip size", () => {
    expect(FILE_ATTACHMENT_WIDTH).toBe(280);
    expect(FILE_ATTACHMENT_HEIGHT).toBe(44);
  });
});
