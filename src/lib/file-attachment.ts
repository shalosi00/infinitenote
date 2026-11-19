/**
 * General file attachments — pure policy for the OneNote "Insert > File
 * Attachment" parity chip (issue #278). No DOM, no engine, no Excalidraw
 * imports: everything here runs identically in the browser bundle, in bun
 * unit tests and during SSR.
 *
 * The chip generalizes the shipped PDF-chip pattern
 * (src/lib/pdf-attachment.ts): an Excalidraw embeddable whose `link`
 * carries a marker scheme (survives `sanitizeUrl`) and whose `customData`
 * holds the payload (survives scene restore). The payload is the ORIGINAL
 * file bytes as a data: URL — the file stays downloadable byte-exactly,
 * offline, forever. PDFs keep their dedicated chip + printout flow; this
 * module covers every OTHER file (zip, spreadsheets, source files, …).
 */
import { plural } from "./plural";
import {
  isPdfAttachmentLink,
  pdfAttachmentOf,
  type PdfAttachment,
  type PdfAttachmentElementLike,
} from "./pdf-attachment";

/**
 * Marker scheme for generic file attachment embeddables (the audio/PDF
 * pattern). `link` must never carry the payload itself: Excalidraw's scene
 * restore rewrites `data:` links to `about:blank`, while customData passes
 * through untouched and this scheme survives sanitization verbatim. It is
 * also a `validateEmbeddable` gate key.
 */
export const FILE_ATTACHMENT_LINK_SCHEME = "infinitenote:file";

/** Does this embeddable link mark the element as a generic file chip? */
export function isFileAttachmentLink(link: string | null | undefined): boolean {
  return typeof link === "string" && link.startsWith(FILE_ATTACHMENT_LINK_SCHEME);
}

/** World-space size of the chip (same strip geometry as the PDF chip). */
export const FILE_ATTACHMENT_WIDTH = 280;
export const FILE_ATTACHMENT_HEIGHT = 44;

/**
 * Import size cap for the embedded copy of a file (the PDF/audio stance).
 * The payload is a base64 data: URL inside the scene JSON — it persists on
 * every autosave, rides along in every version-history snapshot and
 * duplicates in sync folders, so anything past 10 MiB is refused.
 */
export const MAX_FILE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Should the embedded file copy be skipped at attach time? */
export function isFileAttachmentTooLarge(byteSize: number): boolean {
  return byteSize > MAX_FILE_ATTACHMENT_BYTES;
}

/**
 * Is this string a base64 `data:` URL (any MIME)? Generic chips carry
 * whatever the source file declared — octet-stream, vendor MIMEs, or the
 * empty MIME drag-dropped files often stamp. The MIME part may carry
 * `;`-separated params (`;charset=utf-8;base64`); the payload must be
 * base64 characters only (an empty payload is a legal 0-byte file).
 */
export function isFileDataUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^data:[^,]*,[A-Za-z0-9+/=]*$/i.test(url);
}

/**
 * Normalize a file data URL to the MIME the file actually declared.
 *
 * `FileReader.readAsDataURL` stamps empty-MIME files (drag-dropped files
 * on several platforms) as `data:application/octet-stream`. The caller has
 * already decided to attach the file, so when the URL carries only the
 * octet-stream default (or no MIME at all) the prefix is rebuilt to the
 * recorded `fileMime`; anything that is not a data URL at all returns
 * null. Mirrors `withPdfMime`.
 */
export function withFileMime(dataUrl: string, mime: string): string | null {
  if (!isFileDataUrl(dataUrl)) return null;
  const m = /^data:([^;,]*)([^,]*),(.*)$/.exec(dataUrl);
  if (!m) return null;
  const urlMime = (m[1] || "").toLowerCase();
  if (urlMime && urlMime !== "application/octet-stream") return dataUrl;
  const safeMime = (mime || "").trim() || "application/octet-stream";
  return `data:${safeMime}${m[2]},${m[3]}`;
}

/** The minimal scene-element shape this module needs (structural typing). */
export interface FileAttachmentElementLike {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  isDeleted?: boolean;
  link?: string | null;
  customData?: {
    fileName?: unknown;
    fileData?: unknown;
    fileSize?: unknown;
    fileMime?: unknown;
  } | null;
}

/** A validated file attachment record, extracted from a chip element. */
export interface FileAttachment {
  id: string;
  /** the original file name, shown on the chip and used on download */
  name: string;
  /** the original file bytes as a data: URL (recorded MIME) */
  dataUrl: string;
  /** the MIME the file declared at attach time (may be octet-stream) */
  mime: string;
  /** the original byte size, shown on the chip */
  size: number;
}

/**
 * Extract a validated attachment from a scene element — null for anything
 * that is not a live, well-formed chip. Corrupt customData (missing name,
 * non-data payload) must never reach the context menu.
 */
export function fileAttachmentOf(el: FileAttachmentElementLike | null | undefined): FileAttachment | null {
  if (!el || el.isDeleted) return null;
  if (el.type !== "embeddable") return null;
  if (!isFileAttachmentLink(el.link)) return null;
  const name = el.customData?.fileName;
  const dataUrl = el.customData?.fileData;
  const mime = el.customData?.fileMime;
  const size = el.customData?.fileSize;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof dataUrl !== "string" || !isFileDataUrl(dataUrl)) return null;
  if (typeof mime !== "string" || !mime.trim()) return null;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  return {
    id: typeof el.id === "string" ? el.id : "",
    name,
    dataUrl,
    mime,
    size,
  };
}

/**
 * Decode a base64 data: URL back to a Blob with the URL's own MIME.
 * Throws on anything else — callers catch and toast.
 */
export function fileDataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl);
  if (!m) {
    throw new Error("Not a base64 data URL");
  }
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || "application/octet-stream" });
}

/**
 * Human file size for the chip: 1024-based, B / KB / MB / GB. Values
 * round-trip through tests: whole units print without decimals, smaller
 * ones with exactly one decimal.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 10 || Number.isInteger(value)
    ? String(Math.round(value))
    : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

/**
 * The badge label on a generic chip: the file extension, uppercased,
 * capped at 4 characters (the PDF badge's geometry). A file with no
 * extension (or a dot-only name) falls back to "FILE".
 */
export function fileBadgeLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  const ext = name.slice(dot + 1).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(ext)) return "FILE";
  return ext.slice(0, 4);
}

/**
 * Hit-test a scene point (already converted from client coordinates)
 * against every live attachment chip — BOTH kinds, generic files and PDFs.
 * Returns the TOPMOST hit — elements later in the array are higher in
 * z-order — or null.
 *
 * Rotation-exact: the point is rotated into the element's local frame,
 * so a chip rotated 90° is hittable exactly where it renders, not merely
 * inside its axis-aligned bounding box.
 */
export type AttachmentHit =
  | { kind: "pdf"; attachment: PdfAttachment }
  | { kind: "file"; attachment: FileAttachment };

/** One rotation-exact containment probe (shared frame math). */
function containsPoint(
  el: { x?: number; y?: number; width?: number; height?: number; angle?: number },
  sceneX: number,
  sceneY: number,
): boolean {
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  if (!(w > 0) || !(h > 0)) return false; // corrupt geometry never hits
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
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

export function hitTestAttachment(
  sceneX: number,
  sceneY: number,
  elements: readonly (PdfAttachmentElementLike | FileAttachmentElementLike)[],
): AttachmentHit | null {
  // topmost first: iterate in reverse z-order and stop at the first chip
  // that both IS an attachment and contains the point
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.isDeleted || el.type !== "embeddable") continue;
    if (isFileAttachmentLink(el.link)) {
      if (containsPoint(el, sceneX, sceneY)) {
        const attachment = fileAttachmentOf(el as FileAttachmentElementLike);
        if (attachment) return { kind: "file", attachment };
      }
      continue;
    }
    if (isPdfAttachmentLink(el.link)) {
      if (containsPoint(el, sceneX, sceneY)) {
        const attachment = pdfAttachmentOf(el as PdfAttachmentElementLike);
        if (attachment) return { kind: "pdf", attachment };
      }
    }
  }
  return null;
}

/** The skip toast line when the embedded copy exceeded the size cap. */
export function fileAttachmentSkippedToast(fileName: string): string {
  return `Skipped the file attachment for "${fileName}" — larger than 10 MB, too big to store reliably.`;
}

/** The batch-attach toast line. */
export function fileAttachedToast(count: number): string {
  return `Attached ${plural(count, "1 file", "# files")}`;
}
