/**
 * MHT (MHTML, "Single File Web Page") — OneNote's "Save as .mht" export.
 *
 * A `.mht` file is a MIME multipart/related document: one text/html part plus
 * the images it references, either base64- or quoted-printable-encoded, keyed
 * by Content-Location (OneNote uses absolute file:/// URLs as <img src>).
 *
 * This parser is pure string work — no DOMParser, no dependencies — so it
 * runs identically in the browser bundle, in bun unit tests and during SSR.
 */

export interface MhtResource {
  /** Content-Location (or bare Content-ID) — what <img src> matches against. */
  location: string;
  /** MIME type of the resource part, e.g. "image/png". */
  contentType: string;
  /** Decoded binary payload as a data: URL. */
  dataUrl: string;
}

export interface ParsedMht {
  /** Decoded text of the first text/html part ("" when absent). */
  html: string;
  /** All non-html parts, in file order. */
  resources: MhtResource[];
}

/** Parse a .mht document into its html part + embedded resources. */
export function parseMht(raw: string): ParsedMht {
  const { headers, body } = splitHeaders(normalizeNewlines(raw));
  const boundary = boundaryFromContentType(headers["content-type"] ?? "");
  if (!boundary) {
    // Degenerate: not multipart — treat the whole payload as html if it
    // plausibly is (OneNote always exports multipart, this is for safety).
    const text = decodeText(body, headers["content-transfer-encoding"], charsetOf(headers["content-type"]));
    return { html: looksLikeHtml(text) ? text : "", resources: [] };
  }

  let html = "";
  const resources: MhtResource[] = [];
  for (const part of splitMultipart(body, boundary)) {
    const { headers: ph, body: pb } = splitHeaders(part);
    const type = (ph["content-type"] ?? "").toLowerCase();
    if (type.startsWith("text/html") && !html) {
      html = decodeText(pb, ph["content-transfer-encoding"], charsetOf(type));
      continue;
    }
    if (type.startsWith("image/") || type.startsWith("application/octet-stream")) {
      const bytes = decodeBytes(pb, ph["content-transfer-encoding"]);
      if (!bytes.length) continue;
      const location = ph["content-location"] ?? stripAngleBrackets(ph["content-id"] ?? "");
      if (!location) continue;
      resources.push({
        location,
        contentType: type.startsWith("image/") ? type : sniffImageType(bytes) ?? "application/octet-stream",
        dataUrl: `data:${type.startsWith("image/") ? type : sniffImageType(bytes) ?? "application/octet-stream"};base64,${bytesToBase64(bytes)}`,
      });
    }
  }
  return { html, resources };
}

/**
 * Resolve an <img src> from the HTML part against the parsed resources.
 * OneNote exports usually match Content-Location exactly, but be forgiving:
 * exact → percent-decoded → basename (case-insensitive) → cid: form.
 * Returns null when nothing matches (the importer will skip that image).
 */
export function resolveMhtResource(src: string, resources: MhtResource[]): MhtResource | null {
  if (!src || !resources.length) return null;
  const candidates = new Set<string>([src]);
  try {
    candidates.add(decodeURIComponent(src));
  } catch {
    /* keep the raw form */
  }
  const cid = src.startsWith("cid:") ? src.slice(4) : "";
  const base = basenameOf(src);
  for (const c of candidates) {
    for (const r of resources) {
      if (r.location === c) return r;
      if (cid && stripAngleBrackets(r.location) === cid) return r;
    }
  }
  if (base) {
    for (const r of resources) {
      if (basenameOf(r.location).toLowerCase() === base.toLowerCase()) return r;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* MIME plumbing                                                       */
/* ------------------------------------------------------------------ */

/** Split header block from body at the first empty line. */
function splitHeaders(text: string): { headers: Record<string, string>; body: string } {
  const empty = text.search(/\n\s*\n/);
  if (empty === -1) return { headers: {}, body: text };
  const headerBlock = text.slice(0, empty);
  const body = text.slice(empty).replace(/^\n\s*\n/, "");
  const headers: Record<string, string> = {};
  let lastName = "";
  for (const line of headerBlock.split("\n")) {
    if (/^[ \t]/.test(line) && lastName) {
      headers[lastName] += " " + line.trim(); // RFC 5322 folded continuation
      continue;
    }
    const at = line.indexOf(":");
    if (at <= 0) continue;
    lastName = line.slice(0, at).trim().toLowerCase();
    headers[lastName] = line.slice(at + 1).trim();
  }
  return { headers, body };
}

/** Extract `boundary=...` (quoted or bare) from a Content-Type header. */
function boundaryFromContentType(contentType: string): string {
  const m = /boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function charsetOf(contentType: string): string {
  const m = /charset\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  return (m?.[1] ?? m?.[2] ?? "utf-8").toLowerCase();
}

/** Split a multipart body into its parts' full text (headers + content). */
function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const parts: string[] = [];
  let pos = lineStartOf(body, body.indexOf(marker));
  while (pos !== -1) {
    let cursor = pos + marker.length;
    if (body.startsWith("--", cursor)) break; // closing delimiter — done
    const eol = body.indexOf("\n", cursor);
    if (eol === -1) break; // truncated part
    const contentStart = eol + 1;
    const next = lineStartOf(body, body.indexOf(marker, contentStart));
    // trim the newline that introduces the next marker out of this part
    const rawPart = next === -1 ? body.slice(contentStart) : body.slice(contentStart, next);
    parts.push(rawPart.replace(/\n[ \t]*$/, ""));
    pos = next;
  }
  return parts;
}

/** Index of `at` adjusted to the start of its line (== at when at line start). */
function lineStartOf(body: string, at: number): number {
  if (at === -1) return -1;
  if (at === 0) return 0;
  return body[at - 1] === "\n" ? at : -1;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function stripAngleBrackets(id: string): string {
  return id.replace(/^<|>$/g, "");
}

function basenameOf(url: string): string {
  try {
    const clean = url.split(/[?#]/)[0];
    const parts = clean.split("/");
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return url;
  }
}

function looksLikeHtml(text: string): boolean {
  return /<html[\s>]|<!DOCTYPE html/i.test(text);
}

/* ------------------------------------------------------------------ */
/* content decoding                                                    */
/* ------------------------------------------------------------------ */

/** Decode a part body to text, honoring Content-Transfer-Encoding + charset. */
function decodeText(body: string, encoding: string | undefined, charset: string): string {
  const bytes = decodeBytes(body, encoding);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

/** Decode a part body to bytes (base64 / quoted-printable / passthrough). */
function decodeBytes(body: string, encoding: string | undefined): Uint8Array {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "base64") {
    const b64 = body.replace(/[^A-Za-z0-9+/=]/g, "");
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch {
      return new Uint8Array(0);
    }
  }
  if (enc === "quoted-printable") {
    const out: number[] = [];
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "=") {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          out.push(parseInt(hex, 16));
          i += 2;
        } else if (body[i + 1] === "\n") {
          i += 1; // soft line break — consume the newline, emit nothing
        }
        // stray "=" (truncated encoding) contributes nothing
      } else {
        out.push(ch.charCodeAt(0) & 0xff); // latin-1 per QP spec; charset applied later
      }
    }
    return new Uint8Array(out);
  }
  // 7bit / 8bit / binary / unspecified
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

/** Sniff the image type from magic bytes (for unlabeled octet-stream parts). */
function sniffImageType(bytes: Uint8Array): string | null {
  const eq = (sig: number[], off = 0) => sig.every((b, i) => bytes[off + i] === b);
  if (bytes.length >= 8 && eq([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (bytes.length >= 3 && eq([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6 && eq([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (bytes.length >= 12 && eq([0x52, 0x49, 0x46, 0x46]) && eq([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
