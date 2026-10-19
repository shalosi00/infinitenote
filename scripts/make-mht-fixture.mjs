#!/usr/bin/env node
/**
 * Generate the OneNote .mht test fixtures (unit + E2E) deterministically.
 *
 * Builds a realistic OneNote "Save as Single File Web Page" export:
 *   - a quoted-printable HTML part with OneNote-style nested positioned divs,
 *     a heading, paragraphs (incl. non-ASCII + '=' to exercise QP decoding),
 *     a nested list, a table and two <img> references;
 *   - two base64-encoded PNG parts keyed by Content-Location file:/// URLs.
 *
 * Run: node scripts/make-mht-fixture.mjs   (bun also works)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const png = readFileSync(join(root, "e2e/fixtures/test-image.png"));
const pngB64 = png.toString("base64");

const BOUNDARY = "----=_NextPart_01MA001A.C0FFEED0";
const HTML_LOCATION = "file:///C:/Users/Tiana/Documents/Meeting%20Notes.html";
const IMG1_LOCATION = "file:///C:/Users/Tiana/Documents/Meeting%20Notes_files/image001.png";
const IMG2_LOCATION = "file:///C:/Users/Tiana/Documents/Meeting%20Notes_files/image002.png";

const html = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"utf-8\"><title>Meeting Notes</title></head>",
  "<body>",
  "<div style=\"position:absolute;left:0px;top:0px\">",
  "<h1>Q3 Planning — Café roadmap</h1>",
  "<p>Sprint goals = 12 points; velocity &gt; 10 required.</p>",
  "<div style=\"position:absolute;left:20px;top:120px\">",
  "<ul><li>Ship .mht import &amp; embedded images</li><li>Keep tests green</li></ul>",
  "</div>",
  "<table><tr><td>Owner</td><td>Tiana</td></tr></table>",
  "<p><img src=\"" + IMG1_LOCATION + "\" width=\"240\" height=\"156\"></p>",
  "<p>Diagram above shows the pipeline = end-to-end.</p>",
  "<p><img src=\"" + IMG2_LOCATION + "\"></p>",
  "<p>Trailing text</p>",
  "</div>",
  "</body></html>",
  "",
].join("\r\n");

/** Minimal RFC 2045 §6.7 quoted-printable encoder (hard 76-char wraps). */
function quotedPrintable(text) {
  const SAFE = /[A-Za-z0-9 !"#\$@[\]^`{|}~()*+,.\/:;<=>?-]/; // printable ASCII minus = and _
  let encoded = "";
  let line = "";
  for (const ch of text) {
    let out = "";
    if (ch === "\r") out = "=0D";
    else if (ch === "\n") out = "=0A";
    else if (ch === "=" ) out = "=3D";
    else if (ch === "_") out = "=5F";
    else if (ch === " ") out = "=20";
    else if (ch === "\t") out = "=09";
    else if (SAFE.test(ch)) out = ch;
    else {
      for (const byte of Buffer.from(ch, "utf8")) out += "=" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    if (line.length + out.length > 75) {
      encoded += line + "=\r\n"; // soft break
      line = "";
    }
    line += out;
  }
  return encoded + line;
}

const wrap76 = (s) => s.replace(/(.{76})/g, "$1\r\n");

const mht = [
  "MIME-Version: 1.0",
  `Content-Type: multipart/related; type="text/html"; boundary="${BOUNDARY}"`,
  "",
  "This is a multi-part message in MIME format.",
  "",
  `--${BOUNDARY}`,
  "Content-Type: text/html; charset=\"utf-8\"",
  "Content-Transfer-Encoding: quoted-printable",
  `Content-Location: ${HTML_LOCATION}`,
  "",
  quotedPrintable(html),
  `--${BOUNDARY}`,
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  `Content-Location: ${IMG1_LOCATION}`,
  "",
  wrap76(pngB64),
  `--${BOUNDARY}`,
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  `Content-Location: ${IMG2_LOCATION}`,
  "",
  wrap76(pngB64),
  `--${BOUNDARY}--`,
  "",
].join("\r\n");

// A self-contained HTML page with an inline data: image (Graph export style).
const inlineHtml = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"utf-8\"></head><body>",
  "<h2>Scratch note</h2>",
  "<p>Inline data-URL image below.</p>",
  `<img src="data:image/png;base64,${pngB64}" width="200">`,
  "<p>Done.</p>",
  "</body></html>",
  "",
].join("\n");

const targets = [
  [join(root, "src/lib/__tests__/fixtures/onenote-page.mht"), mht],
  [join(root, "e2e/fixtures/onenote-page.mht"), mht],
  [join(root, "e2e/fixtures/onenote-inline-image.html"), inlineHtml],
];
for (const [path, content] of targets) {
  writeFileSync(path, content);
  console.log(`wrote ${path} (${content.length} bytes)`);
}
