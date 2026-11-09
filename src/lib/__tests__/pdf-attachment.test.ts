/// <reference types="bun-types" />
/**
 * PDF file attachments (test plan: docs/test-plans/pdf-attachment.md,
 * ids ATT-P*) — the OneNote-style chip that rides on a PDF printout.
 *
 * Pure policy only: marker detection, payload extraction/validation, the
 * import size cap, base64→Blob decoding, rotation-exact right-click
 * hit-testing in scene coordinates, and the exact toast lines. The chip
 * element factory + canvas integration are exercised by
 * e2e/pdf-attachment.spec.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  isPdfAttachmentLink,
  isPdfAttachmentTooLarge,
  isPdfDataUrl,
  hitTestPdfAttachment,
  MAX_PDF_ATTACHMENT_BYTES,
  pdfAttachmentOf,
  pdfAttachmentSkippedToast,
  pdfDataUrlToBlob,
  pdfPrintoutToast,
  withPdfMime,
  PDF_ATTACHMENT_HEIGHT,
  PDF_ATTACHMENT_LINK_SCHEME,
  PDF_ATTACHMENT_WIDTH,
  type PdfAttachmentElementLike,
} from "../pdf-attachment";

const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff, 0x7f,
]);
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from(PDF_BYTES).toString("base64")}`;

/** A well-formed chip element (the shape makePdfAttachmentElement creates). */
function chip(overrides: Partial<PdfAttachmentElementLike> = {}): PdfAttachmentElementLike {
  return {
    id: "chip1",
    type: "embeddable",
    x: 100,
    y: 100,
    width: 280,
    height: 44,
    angle: 0,
    isDeleted: false,
    link: PDF_ATTACHMENT_LINK_SCHEME,
    customData: { pdfName: "report.pdf", pdfData: PDF_DATA_URL },
    ...overrides,
  };
}

describe("isPdfAttachmentLink (ATT-P01)", () => {
  it("accepts the marker scheme", () => {
    expect(isPdfAttachmentLink("infinitenote:pdf")).toBe(true);
  });

  it("tolerates a suffix after the scheme", () => {
    expect(isPdfAttachmentLink("infinitenote:pdf:xyz")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPdfAttachmentLink("infinitenote:audio")).toBe(false);
    expect(isPdfAttachmentLink("https://example.com/a.pdf")).toBe(false);
    expect(isPdfAttachmentLink("")).toBe(false);
    expect(isPdfAttachmentLink(null)).toBe(false);
    expect(isPdfAttachmentLink(undefined)).toBe(false);
  });
});

describe("pdfAttachmentOf (ATT-P02, ATT-P03)", () => {
  it("extracts a validated record from a well-formed chip", () => {
    const out = pdfAttachmentOf(chip());
    expect(out).toEqual({
      id: "chip1",
      name: "report.pdf",
      dataUrl: PDF_DATA_URL,
    });
  });

  it("returns null for every corrupt variant", () => {
    expect(pdfAttachmentOf(null)).toBeNull();
    expect(pdfAttachmentOf(chip({ type: "image" }))).toBeNull();
    expect(pdfAttachmentOf(chip({ link: "infinitenote:audio" }))).toBeNull();
    expect(pdfAttachmentOf(chip({ link: null }))).toBeNull();
    expect(pdfAttachmentOf(chip({ customData: null }))).toBeNull();
    expect(pdfAttachmentOf(chip({ customData: { pdfName: "", pdfData: PDF_DATA_URL } }))).toBeNull();
    expect(pdfAttachmentOf(chip({ customData: { pdfName: 42, pdfData: PDF_DATA_URL } }))).toBeNull();
    expect(
      pdfAttachmentOf(chip({ customData: { pdfName: "a.pdf", pdfData: "data:image/png;base64,AAAA" } })),
    ).toBeNull();
    expect(
      pdfAttachmentOf(chip({ customData: { pdfName: "a.pdf", pdfData: "https://example.com/a.pdf" } })),
    ).toBeNull();
    expect(pdfAttachmentOf(chip({ isDeleted: true }))).toBeNull();
  });
});

describe("pdfDataUrlToBlob (ATT-P04, ATT-P05)", () => {
  it("decodes base64 byte-exactly and stamps the pdf mime type", async () => {
    // a real binary payload: every byte value region incl. NUL, 0xFF, high bytes
    const bytes = new Uint8Array(300);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) % 256;
    const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    const blob = pdfDataUrlToBlob(dataUrl);
    expect(blob.type).toBe("application/pdf");
    const round = new Uint8Array(await blob.arrayBuffer());
    expect(round.length).toBe(bytes.length);
    expect(Buffer.compare(Buffer.from(round), Buffer.from(bytes))).toBe(0);
  });

  it("throws on invalid inputs", () => {
    expect(() => pdfDataUrlToBlob("https://example.com/a.pdf")).toThrow();
    expect(() => pdfDataUrlToBlob("data:image/png;base64,AAAA")).toThrow();
    expect(() => pdfDataUrlToBlob("data:application/pdf;base64,!!!not-base64!!!")).toThrow();
  });
});

describe("isPdfDataUrl", () => {
  it("accepts only application/pdf data URLs", () => {
    expect(isPdfDataUrl("data:application/pdf;base64,AAAA")).toBe(true);
    expect(isPdfDataUrl("DATA:APPLICATION/PDF;BASE64,AAAA")).toBe(true);
    expect(isPdfDataUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isPdfDataUrl(null)).toBe(false);
  });
});

describe("withPdfMime (ATT-P06/P07)", () => {
  it("normalizes empty-MIME / octet-stream data URLs to application/pdf", () => {
    expect(withPdfMime("data:application/octet-stream;base64,QUJD")).toBe(
      "data:application/pdf;base64,QUJD",
    );
    expect(withPdfMime("data:;base64,QUJD")).toBe("data:application/pdf;base64,QUJD");
  });

  it("passes pdf URLs through untouched and rejects non-data URLs", () => {
    expect(withPdfMime("data:application/pdf;base64,QUJD")).toBe(
      "data:application/pdf;base64,QUJD",
    );
    expect(withPdfMime("https://example.com/a.pdf")).toBeNull();
    expect(withPdfMime("")).toBeNull();
  });
});

describe("import size cap (ATT-P10..P12)", () => {
  it("is inclusive at exactly 10 MiB", () => {
    expect(isPdfAttachmentTooLarge(MAX_PDF_ATTACHMENT_BYTES)).toBe(false);
    expect(MAX_PDF_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("rejects one byte over", () => {
    expect(isPdfAttachmentTooLarge(MAX_PDF_ATTACHMENT_BYTES + 1)).toBe(true);
  });

  it("accepts typical document sizes", () => {
    expect(isPdfAttachmentTooLarge(0)).toBe(false);
    expect(isPdfAttachmentTooLarge(1)).toBe(false);
    expect(isPdfAttachmentTooLarge(2095)).toBe(false); // the e2e fixture
  });
});

describe("hitTestPdfAttachment (ATT-P20..P25)", () => {
  it("returns the chip for points inside, null just outside each edge", () => {
    const el = chip();
    const elements = [el];
    expect(hitTestPdfAttachment(100, 100, elements)?.id).toBe("chip1"); // top-left corner
    expect(hitTestPdfAttachment(100 + 279, 100 + 43, elements)?.id).toBe("chip1"); // inside
    expect(hitTestPdfAttachment(100 + 281, 100 + 22, elements)).toBeNull(); // right edge +1
    expect(hitTestPdfAttachment(100 - 1, 100 + 22, elements)).toBeNull(); // left edge -1
    expect(hitTestPdfAttachment(100 + 140, 100 - 1, elements)).toBeNull(); // above
    expect(hitTestPdfAttachment(100 + 140, 100 + 45, elements)).toBeNull(); // below
  });

  it("prefers the topmost (last in array) of overlapping chips", () => {
    const lower = chip({ id: "lower" });
    const upper = chip({ id: "upper", x: 120, y: 110 });
    const hit = hitTestPdfAttachment(200, 120, [lower, upper]);
    expect(hit?.id).toBe("upper");
  });

  it("never hits non-attachment elements", () => {
    const elements: PdfAttachmentElementLike[] = [
      { ...chip({ id: "img", type: "image" }) },
      { ...chip({ id: "txt", type: "text" }) },
      { ...chip({ id: "audio", link: "infinitenote:audio" }) },
    ];
    expect(hitTestPdfAttachment(200, 120, elements)).toBeNull();
  });

  it("never hits soft-deleted tombstones", () => {
    const elements = [chip({ isDeleted: true })];
    expect(hitTestPdfAttachment(200, 120, elements)).toBeNull();
  });

  it("is rotation-exact (ATT-P24)", () => {
    // chip 200x40 centered at (200,120), rotated 90°: covers x∈[180,220],
    // y∈[20,220] after rotation — NOT its axis-aligned bbox
    const el = chip({ x: 100, y: 100, width: 200, height: 40, angle: Math.PI / 2 });
    // inside the rotated rect, outside the unrotated bbox (y=200 > 140)
    expect(hitTestPdfAttachment(200, 200, [el])?.id).toBe("chip1");
    // inside the unrotated bbox, outside the rotated rect
    expect(hitTestPdfAttachment(280, 120, [el])).toBeNull();
  });

  it("never hits corrupt zero-size chips", () => {
    expect(hitTestPdfAttachment(100, 100, [chip({ width: 0 })])).toBeNull();
    expect(hitTestPdfAttachment(100, 100, [chip({ height: -5 })])).toBeNull();
  });
});

describe("toast lines (ATT-P30..P34)", () => {
  it("full printout with attachment", () => {
    expect(
      pdfPrintoutToast({ rendered: 2, total: 2, attachment: "stored" }, "test.pdf"),
    ).toBe('Inserted PDF printout "test.pdf" (2 pages)');
  });

  it("truncated printout with attachment", () => {
    expect(
      pdfPrintoutToast({ rendered: 20, total: 25, attachment: "stored" }, "test.pdf"),
    ).toBe('Inserted PDF printout "test.pdf" (first 20 of 25 pages) — the render cap is 20 pages');
  });

  it("singular page", () => {
    expect(
      pdfPrintoutToast({ rendered: 1, total: 1, attachment: "stored" }, "a.pdf"),
    ).toBe('Inserted PDF printout "a.pdf" (1 page)');
  });

  it("skipped attachment keeps the named printout line", () => {
    expect(
      pdfPrintoutToast({ rendered: 2, total: 2, attachment: "skipped-large" }, "test.pdf"),
    ).toBe('Inserted PDF printout "test.pdf" (2 pages)');
  });

  it("skip toast names the file and the cap", () => {
    expect(pdfAttachmentSkippedToast("big.pdf")).toBe(
      'Skipped the file attachment for "big.pdf" — larger than 10 MB, too big to store reliably.',
    );
  });
});

describe("chip geometry (ATT-P40)", () => {
  it("has positive, canvas-sane dimensions", () => {
    expect(PDF_ATTACHMENT_WIDTH).toBeGreaterThan(0);
    expect(PDF_ATTACHMENT_HEIGHT).toBeGreaterThan(0);
    expect(PDF_ATTACHMENT_WIDTH).toBeLessThanOrEqual(400);
  });
});
