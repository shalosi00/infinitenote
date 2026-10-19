/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { parseMht, resolveMhtResource } from "../mht-import";
import { extractHtmlContent } from "../html-import";

const FIXTURE = `${import.meta.dir}/fixtures/onenote-page.mht`;
const BOUNDARY = "----=_NextPart_01MA001A.C0FFEED0";

async function fixtureRaw(): Promise<string> {
  return Bun.file(FIXTURE).text();
}

describe("parseMht — OneNote .mht fixture", () => {
  it("decodes the quoted-printable html part (soft breaks, =XX, entities intact)", async () => {
    const { html } = parseMht(await fixtureRaw());
    expect(html).toContain("<h1>Q3 Planning — Café roadmap</h1>");
    expect(html).toContain("Sprint goals = 12 points");
    // soft-broken URL must be stitched back together with no newline inside
    expect(html).toContain(
      'src="file:///C:/Users/Tiana/Documents/Meeting%20Notes_files/image001.png"',
    );
    expect(html).not.toContain("=\n");
  });

  it("collects both image parts with locations, types and data urls", async () => {
    const { resources } = parseMht(await fixtureRaw());
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({
      location: "file:///C:/Users/Tiana/Documents/Meeting%20Notes_files/image001.png",
      contentType: "image/png",
    });
    expect(resources[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(resources[1].location).toContain("image002.png");
  });

  it("decodes image payloads back to the original PNG bytes", async () => {
    const { resources } = parseMht(await fixtureRaw());
    const b64 = resources[0].dataUrl.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(b64, "base64");
    const png = Buffer.from(
      await Bun.file(`${import.meta.dir}/../../../e2e/fixtures/test-image.png`).arrayBuffer(),
    );
    expect(bytes.equals(png)).toBe(true);
  });

  it("feeds the html through extractHtmlContent with images in order", async () => {
    const { html, resources } = parseMht(await fixtureRaw());
    const { blocks, images } = extractHtmlContent(html);
    expect(blocks.map((b) => b.text)).toEqual([
      "Q3 Planning — Café roadmap",
      "Sprint goals = 12 points; velocity > 10 required.",
      "Ship .mht import & embedded images",
      "Keep tests green",
      "Owner | Tiana",
      "Diagram above shows the pipeline = end-to-end.",
      "Trailing text",
    ]);
    expect(images.map((i) => i.blockIndex)).toEqual([5, 6]);
    expect(images[0]).toMatchObject({ width: 240, height: 156 });
    // every img src resolves against the parsed resources
    expect(resolveMhtResource(images[0].src, resources)?.location).toContain("image001.png");
    expect(resolveMhtResource(images[1].src, resources)?.location).toContain("image002.png");
  });
});

describe("resolveMhtResource — forgiving lookup", () => {
  const res = [
    { location: "file:///C:/a/Meeting%20Notes_files/image001.png", contentType: "image/png", dataUrl: "data:image/png;base64,AAA" },
    { location: "file:///C:/b/IMG_2024.JPEG", contentType: "image/jpeg", dataUrl: "data:image/jpeg;base64,BBB" },
  ];

  it("matches exactly and via percent-decoding", () => {
    expect(resolveMhtResource("file:///C:/a/Meeting%20Notes_files/image001.png", res)?.dataUrl).toBe(
      "data:image/png;base64,AAA",
    );
    expect(resolveMhtResource("file:///C:/a/Meeting Notes_files/image001.png", res)?.dataUrl).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("falls back to a case-insensitive basename match", () => {
    expect(resolveMhtResource("file:///D:/elsewhere/img_2024.jpeg", res)?.dataUrl).toBe(
      "data:image/jpeg;base64,BBB",
    );
  });

  it("matches the cid: form when parts were keyed by Content-ID", () => {
    const cidRes = [{ location: "<cover@one.note>", contentType: "image/png", dataUrl: "data:image/png;base64,C" }];
    expect(resolveMhtResource("cid:cover@one.note", cidRes)?.dataUrl).toBe("data:image/png;base64,C");
  });

  it("returns null for unknown sources and empty resource lists", () => {
    expect(resolveMhtResource("file:///nope.png", res)).toBeNull();
    expect(resolveMhtResource("", res)).toBeNull();
    expect(resolveMhtResource("x.png", [])).toBeNull();
  });
});

describe("parseMht — synthetic edge cases", () => {
  // headers + BLANK line + body, per RFC 2046 — the blank line is mandatory.
  const part = (headers: string, body: string) => `--${BOUNDARY}\n${headers}\n\n${body}\n--${BOUNDARY}--\n`;
  // a part without the closing delimiter — for chaining multiple parts.
  const openPart = (headers: string, body: string) => `--${BOUNDARY}\n${headers}\n\n${body}\n`;

  it("handles bare (unquoted) boundaries and folded headers", () => {
    const raw = [
      "MIME-Version: 1.0",
      `Content-Type: multipart/related;`,
      ` boundary=${BOUNDARY}`,
      "",
      part(
        "Content-Type: text/html;\n charset=utf-8",
        "<html><body><p>folded ok</p></body></html>",
      ),
    ].join("\n");
    const { html } = parseMht(raw);
    expect(html).toContain("folded ok");
  });

  it("ignores preamble before the first delimiter and epilogue after the close", () => {
    const raw = [
      `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
      "",
      "This preamble is not a part.",
      part("Content-Type: text/html", "<p>only</p>"),
      "Epilogue nobody reads.",
    ].join("\n");
    const { html, resources } = parseMht(raw);
    expect(html).toContain("only");
    expect(resources).toEqual([]);
  });

  it("sniffs image types for unlabeled octet-stream parts (png magic)", () => {
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ).toString("latin1");
    const raw = [
      `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
      "",
      openPart("Content-Type: text/html", "<p>x</p>") +
        openPart(
          "Content-Type: application/octet-stream\nContent-Location: file:///C:/blob.png",
          png1x1,
        ) +
        `--${BOUNDARY}--`,
    ].join("\n");
    const { resources } = parseMht(raw);
    expect(resources).toHaveLength(1);
    expect(resources[0].contentType).toBe("image/png");
    expect(resources[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("degrades gracefully on non-multipart input", () => {
    const htmlish = "<!DOCTYPE html><html><body><p>standalone</p></body></html>";
    const { html, resources } = parseMht(htmlish);
    expect(html).toContain("standalone");
    expect(resources).toEqual([]);
    const junk = parseMht("just some text, no mime at all");
    expect(junk.html).toBe("");
    expect(junk.resources).toEqual([]);
  });

  it("drops broken base64 parts instead of failing the whole import", () => {
    const raw = [
      `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
      "",
      part(
        "Content-Type: text/html",
        "<p>survivor</p>",
      ) + `--${BOUNDARY}\nContent-Type: image/png\nContent-Location: file:///x/bad.png\nContent-Transfer-Encoding: base64\n\n!!!!not-base64!!!!\n`,
    ].join("\n");
    const { html, resources } = parseMht(raw);
    expect(html).toContain("survivor");
    expect(resources).toHaveLength(0);
  });

  it("decodes a quoted-printable image part", () => {
    // PNG header bytes encoded as =89=50... — decodeBytes QP must yield bytes 0x89 0x50...
    const raw = [
      `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
      "",
      openPart("Content-Type: text/html", "<p>qp image</p>") +
        openPart(
          "Content-Type: image/png\nContent-Location: file:///x/qp.png\nContent-Transfer-Encoding: quoted-printable",
          "=89=50=4E=47",
        ) +
        `--${BOUNDARY}--`,
    ].join("\n");
    const { resources } = parseMht(raw);
    expect(resources).toHaveLength(1);
    const b64 = resources[0].dataUrl.slice("data:image/png;base64,".length);
    expect(Buffer.from(b64, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
