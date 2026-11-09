/**
 * PDF file attachments — pure policy for the OneNote-style printout chip
 * (docs/test-plans/pdf-attachment.md). No DOM, no engine, no Excalidraw
 * imports: everything here runs identically in the browser bundle, in bun
 * unit tests and during SSR.
 *
 * The chip mirrors the audio blocks of issue #67: an Excalidraw embeddable
 * whose `link` carries a marker scheme (survives `sanitizeUrl`) and whose
 * `customData` holds the payload (survives scene restore). The payload is
 * the ORIGINAL PDF bytes as a data: URL — the file stays downloadable
 * byte-exactly, offline, forever.
 */
import { plural } from "./plural";

/**
 * Marker scheme for PDF attachment embeddables (the audio pattern).
 *
 * `link` must never carry the payload itself: Excalidraw's scene restore
 * rewrites `data:` links to `about:blank`. customData passes through
 * untouched, and this scheme survives sanitization verbatim. It is also
 * the `validateEmbeddable` gate key.
 */
export const PDF_ATTACHMENT_LINK_SCHEME = "infinitenote:pdf";

/** Does this embeddable link mark the element as a PDF attachment chip? */
export function isPdfAttachmentLink(link: string | null | undefined): boolean {
  return typeof link === "string" && link.startsWith(PDF_ATTACHMENT_LINK_SCHEME);
}

/** World-space size of the chip (a file-icon strip above the printout). */
export const PDF_ATTACHMENT_WIDTH = 280;
export const PDF_ATTACHMENT_HEIGHT = 44;

/**
 * Import size cap for the embedded copy of a PDF (the audio issue-#91
 * stance, sized for documents). The payload is a base64 data: URL inside
 * the scene JSON — it persists on every autosave, rides along in every
 * version-history snapshot and duplicates in sync folders, so anything
 * past 10 MiB is refused. The printout itself still imports.
 */
export const MAX_PDF_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Should the embedded file copy be skipped at import time? */
export function isPdfAttachmentTooLarge(byteSize: number): boolean {
  return byteSize > MAX_PDF_ATTACHMENT_BYTES;
}

/** Is this string a `data:application/pdf` URL (case-insensitive)? */
export function isPdfDataUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^data:application\/pdf;/i.test(url);
}

/**
 * Normalize a file data URL to the `application/pdf` MIME.
 *
 * `FileReader.readAsDataURL` stamps empty-MIME files (drag-dropped `.pdf`s
 * on several platforms) as `data:application/octet-stream`. The caller has
 * already classified the file as a PDF (classifyFile), so the prefix is
 * rebuilt unconditionally; anything that is not a data URL at all returns
 * null. Mirrors `withAudioMime` (issue #67).
 */
export function withPdfMime(dataUrl: string): string | null {
  if (isPdfDataUrl(dataUrl)) return dataUrl;
  const m = /^data:([^;,]*)([^,]*),(.*)$/.exec(dataUrl);
  if (!m) return null;
  return `data:application/pdf${m[2]},${m[3]}`;
}

/** The minimal scene-element shape this module needs (structural typing). */
export interface PdfAttachmentElementLike {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  isDeleted?: boolean;
  link?: string | null;
  customData?: { pdfName?: unknown; pdfData?: unknown } | null;
}

/** A validated PDF attachment record, extracted from a chip element. */
export interface PdfAttachment {
  id: string;
  /** the original file name, shown on the chip and used on download */
  name: string;
  /** the original file bytes as a data:application/pdf URL */
  dataUrl: string;
}

/**
 * Extract a validated attachment from a scene element — null for anything
 * that is not a live, well-formed chip. Corrupt customData (missing name,
 * non-pdf payload) must never reach the context menu.
 */
export function pdfAttachmentOf(el: PdfAttachmentElementLike | null | undefined): PdfAttachment | null {
  if (!el || el.isDeleted) return null;
  if (el.type !== "embeddable") return null;
  if (!isPdfAttachmentLink(el.link)) return null;
  const name = el.customData?.pdfName;
  const dataUrl = el.customData?.pdfData;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof dataUrl !== "string" || !isPdfDataUrl(dataUrl)) return null;
  return { id: typeof el.id === "string" ? el.id : "", name, dataUrl };
}

/**
 * Decode an `data:application/pdf;base64,…` URL back to a Blob with the
 * exact original bytes. Throws on anything else — callers catch and toast.
 */
export function pdfDataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl);
  if (!m) {
    throw new Error("Not a base64 application/pdf data URL");
  }
  const binary = atob(m[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * Hit-test a scene point (already converted from client coordinates)
 * against every live PDF attachment chip. Returns the TOPMOST hit —
 * elements later in the array are higher in z-order — or null.
 *
 * Rotation-exact: the point is rotated into the element's local frame,
 * so a chip rotated 90° is hittable exactly where it renders, not merely
 * inside its axis-aligned bounding box.
 */
export function hitTestPdfAttachment(
  sceneX: number,
  sceneY: number,
  elements: readonly PdfAttachmentElementLike[],
): PdfAttachment | null {
  // topmost first: iterate in reverse z-order and stop at the first chip
  // that both IS an attachment and contains the point
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.isDeleted || el.type !== "embeddable") continue;
    if (!isPdfAttachmentLink(el.link)) continue;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    if (!(w > 0) || !(h > 0)) continue; // corrupt geometry never hits
    const cx = (el.x ?? 0) + w / 2;
    const cy = (el.y ?? 0) + h / 2;
    const angle = el.angle ?? 0;
    const dx = sceneX - cx;
    const dy = sceneY - cy;
    // rotate the offset INTO the element's local frame (by -angle)
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) > w / 2 || Math.abs(ly) > h / 2) continue;
    const attachment = pdfAttachmentOf(el);
    if (attachment) return attachment;
  }
  return null;
}

/** What the import did with the embedded file copy. */
export type PdfAttachmentOutcome = "stored" | "skipped-large";

/** How much of a PDF import landed on the canvas (+ attachment decision). */
export interface PdfPrintoutOutcome {
  /** pages rendered as canvas images (capped by the 20-page render limit) */
  rendered: number;
  /** pages the document actually contains */
  total: number;
  /** was the original file embedded in a chip? */
  attachment: PdfAttachmentOutcome;
}

/** The printout toast line — names the file, pluralizes, notes truncation. */
export function pdfPrintoutToast(outcome: PdfPrintoutOutcome, fileName: string): string {
  const pages =
    outcome.total > outcome.rendered
      ? `first ${outcome.rendered} of ${outcome.total} pages) — the render cap is 20 pages`
      : `${plural(outcome.rendered, "1 page", "# pages")})`;
  return `Inserted PDF printout "${fileName}" (${pages}`;
}

/** The skip toast line when the embedded copy exceeded the size cap. */
export function pdfAttachmentSkippedToast(fileName: string): string {
  return `Skipped the file attachment for "${fileName}" — larger than 10 MB, too big to store reliably.`;
}
