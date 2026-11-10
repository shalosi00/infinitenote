/// <reference types="bun-types" />
/**
 * Edge-case coverage for the MHT parser, complementing the fixture-based
 * mht-import.test.ts: CRLF transport normalization, base64-encoded html
 * parts, non-utf-8 charsets over quoted-printable, the non-multipart
 * fallback with headers present, duplicate html parts, resources keyed by
 * Content-ID only, empty/unlocatable/mislabelled parts, CRLF-wrapped base64
 * payloads and magic-byte sniffing beyond PNG. All inputs are synthetic
 * in-memory strings — deterministic, no fixtures, no network.
 */
import { describe, expect, it } from "bun:test";
import { parseMht, resolveMhtResource } from "../mht-import";

const BOUNDARY = "----=_Edges_4C0F";

/** A full multipart document: root headers + parts + closing delimiter. */
function mht(parts: string[]): string {
  return `Content-Type: multipart/related; boundary="${BOUNDARY}"\n\n${parts.join("")}--${BOUNDARY}--\n`;
}

/** One part: delimiter line, headers, blank line, body, newline. */
function part(headers: string, body: string): string {
  return `--${BOUNDARY}\n${headers}\n\n${body}\n`;
}

const HOST_PART = part("Content-Type: text/html", "<html><body><p>host</p></body></html>");

describe("parseMht — transport and charset edges", () => {
  it("normalizes CRLF documents and leaves no carriage returns in the html", () => {
    const raw = mht([HOST_PART]).replace(/\n/g, "\r\n");
    const { html, resources } = parseMht(raw);
    expect(html).toContain("<p>host</p>");
    expect(html.includes("\r")).toBe(false);
    expect(resources).toEqual([]);
  });

  it("decodes a base64-encoded text/html part", () => {
    const b64 = Buffer.from("<html><body><p>b64 html</p></body></html>", "utf-8").toString("base64");
    const { html } = parseMht(
      mht([part("Content-Type: text/html\nContent-Transfer-Encoding: base64", b64)]),
    );
    expect(html).toBe("<html><body><p>b64 html</p></body></html>");
  });

  it("decodes quoted-printable latin-1 content (accented bytes, =3D equals)", () => {
    const body = "<html><body><p>=E9tude 5 =3D 5</p></body></html>";
    const { html } = parseMht(
      mht([
        part(
          "Content-Type: text/html; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable",
          body,
        ),
      ]),
    );
    expect(html).toBe("<html><body><p>étude 5 = 5</p></body></html>");
  });

  it("accepts a non-multipart document that carries a plain text/html Content-Type", () => {
    const raw = "Content-Type: text/html; charset=utf-8\n\n<html><body><p>plain</p></body></html>";
    const { html, resources } = parseMht(raw);
    expect(html).toBe("<html><body><p>plain</p></body></html>");
    expect(resources).toEqual([]);
  });
});

describe("parseMht — part selection and resource guards", () => {
  it("keeps only the first text/html part when a document carries two", () => {
    const { html } = parseMht(
      mht([
        part("Content-Type: text/html", "<html><body><p>FIRST</p></body></html>"),
        part("Content-Type: text/html", "<html><body><p>SECOND</p></body></html>"),
      ]),
    );
    expect(html).toContain("FIRST");
    expect(html).not.toContain("SECOND");
  });

  it("keys resources by Content-ID alone when Content-Location is absent", () => {
    const { resources } = parseMht(
      mht([
        HOST_PART,
        part(
          "Content-Type: image/png\nContent-ID: <img001@one.note>\nContent-Transfer-Encoding: base64",
          "AAAA",
        ),
      ]),
    );
    expect(resources).toEqual([
      {
        location: "img001@one.note",
        contentType: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
      },
    ]);
    expect(resolveMhtResource("cid:img001@one.note", resources)?.location).toBe("img001@one.note");
  });

  it("drops image parts carrying neither Content-Location nor Content-ID", () => {
    const { resources } = parseMht(
      mht([
        HOST_PART,
        part("Content-Type: image/png\nContent-Transfer-Encoding: base64", "AAAA"),
      ]),
    );
    expect(resources).toEqual([]);
  });

  it("skips empty image payloads and non-image attachments (text/css)", () => {
    const { html, resources } = parseMht(
      mht([
        HOST_PART,
        part(
          "Content-Type: image/png\nContent-Location: file:///x/empty.png\nContent-Transfer-Encoding: base64",
          "",
        ),
        part("Content-Type: text/css\nContent-Location: file:///x/s.css", "body { color: red }"),
      ]),
    );
    expect(html).toContain("host");
    expect(resources).toEqual([]);
  });
});

describe("parseMht — binary payload edges", () => {
  it("round-trips base64 images whose payload is wrapped across CRLF lines", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const wrapped = (Buffer.from(bytes).toString("base64").match(/.{1,8}/g) ?? []).join("\r\n");
    const { resources } = parseMht(
      mht([
        part(
          "Content-Type: image/png\nContent-Location: file:///x/wrapped.png\nContent-Transfer-Encoding: base64",
          wrapped,
        ),
      ]),
    );
    expect(resources).toHaveLength(1);
    const out = Buffer.from(
      resources[0].dataUrl.slice("data:image/png;base64,".length),
      "base64",
    );
    expect(out.equals(Buffer.from(bytes))).toBe(true);
  });

  it("sniffs GIF magic bytes for unlabeled octet-stream parts", () => {
    const gif = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0,
    ]).toString("base64");
    const { resources } = parseMht(
      mht([
        part(
          "Content-Type: application/octet-stream\nContent-Location: file:///x/pic.bin\nContent-Transfer-Encoding: base64",
          gif,
        ),
      ]),
    );
    expect(resources[0]?.contentType).toBe("image/gif");
    expect(resources[0]?.dataUrl.startsWith("data:image/gif;base64,")).toBe(true);
  });
});
