/// <reference types="bun-types" />
/**
 * Unit tests for page-template pure policy (issue #279).
 * docs/test-plans/page-templates.md, ids PT-P*.
 */
import { describe, expect, it } from "bun:test";
import {
  MAX_TEMPLATE_BYTES,
  TEMPLATE_ERROR_MESSAGES,
  TEMPLATE_NAME_MAX,
  TemplateError,
  buildTemplateRow,
  parseTemplateContent,
  sortTemplatesForPicker,
  validateTemplateName,
} from "../page-templates";
import type { TemplateRow } from "../page-templates";
import type { ScenePayload } from "../types";

const payloadOf = (n: number, body = ""): ScenePayload => ({
  elements: Array.from({ length: n }, (_, i) => ({
    id: `el-${i}`,
    type: "text",
    text: body,
    isDeleted: false,
  })),
  files: {},
});

describe("template names", () => {
  it("PT-P01: trims surrounding whitespace", () => {
    expect(validateTemplateName("  Weekly plan  ")).toBe("Weekly plan");
  });

  it("PT-P02: refuses empty and whitespace-only names", () => {
    for (const bad of ["", "   ", null, undefined, 42]) {
      try {
        validateTemplateName(bad);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(TemplateError);
        expect((err as TemplateError).code).toBe("invalid-name");
      }
    }
  });

  it(`PT-P03: accepts ${TEMPLATE_NAME_MAX} characters, refuses ${TEMPLATE_NAME_MAX + 1}`, () => {
    expect(validateTemplateName("a".repeat(TEMPLATE_NAME_MAX))).toHaveLength(TEMPLATE_NAME_MAX);
    try {
      validateTemplateName("a".repeat(TEMPLATE_NAME_MAX + 1));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as TemplateError).code).toBe("invalid-name");
    }
  });

  it("PT-P04: every error code has a toast-ready message", () => {
    // Record exhaustiveness: adding a code without a message breaks the build.
    const codes: TemplateError["code"][] = ["invalid-name", "too-large"];
    for (const code of codes) {
      expect(TEMPLATE_ERROR_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });
});

describe("template rows", () => {
  it("PT-P10: builds a row with live element count and byte size", () => {
    const payload = payloadOf(3);
    const row = buildTemplateRow("Plan", payload, "grid", 1_000);
    expect(row.name).toBe("Plan");
    expect(row.createdAt).toBe(1_000);
    expect(row.elementCount).toBe(3);
    expect(row.byteSize).toBe(row.content.length);
    expect(row.background).toBe("grid");
    expect(row.id).toBeTruthy();
    // the content is exactly what savePageContent would store
    expect(JSON.parse(row.content)).toEqual(payload);
  });

  it("PT-P11: tombstoned elements do not count", () => {
    const payload: ScenePayload = {
      elements: [
        { id: "a", isDeleted: false },
        { id: "b", isDeleted: true },
        { id: "c", isDeleted: false },
      ],
      files: {},
    };
    expect(buildTemplateRow("t", payload, undefined, 1).elementCount).toBe(2);
  });

  it("PT-P12: a plain (undefined) background is stored absent, not null", () => {
    const row = buildTemplateRow("t", payloadOf(1), undefined, 1);
    expect("background" in row).toBe(false);
  });

  it(`PT-P13: the cap equals the attachment policy (${MAX_TEMPLATE_BYTES} bytes)`, () => {
    // Measure the serialization overhead empirically, then build payloads
    // exactly at and one byte past the cap — the same boundary the
    // file-attachment guard draws (strictly greater refuses).
    const probe = buildTemplateRow(
      "probe",
      { elements: [{ id: "big", type: "text", text: "a".repeat(1000) }], files: {} },
      undefined,
      1,
    );
    const textOverhead = probe.byteSize - 1000;

    const within = buildTemplateRow(
      "big",
      {
        elements: [
          { id: "big", type: "text", text: "a".repeat(MAX_TEMPLATE_BYTES - textOverhead) },
        ],
        files: {},
      },
      undefined,
      1,
    );
    expect(within.byteSize).toBeLessThanOrEqual(MAX_TEMPLATE_BYTES);

    const over = buildTemplateRow(
      "over",
      {
        elements: [
          { id: "big", type: "text", text: "a".repeat(MAX_TEMPLATE_BYTES - textOverhead + 1) },
        ],
        files: {},
      },
      undefined,
      1,
    );
    expect(over.byteSize).toBeGreaterThan(MAX_TEMPLATE_BYTES);
  });
});

describe("template content parsing", () => {
  it("PT-P20: round-trips a stored scene", () => {
    const payload = payloadOf(2, "hello");
    const row = buildTemplateRow("t", payload, "ruled", 1);
    expect(parseTemplateContent(row.content)).toEqual(payload);
  });

  it("PT-P21: corrupt JSON restores nothing", () => {
    expect(parseTemplateContent("not json at all {")).toBeNull();
  });

  it("PT-P22: wrong shapes restore nothing", () => {
    expect(parseTemplateContent(JSON.stringify({ elements: "no", files: {} }))).toBeNull();
    expect(parseTemplateContent(JSON.stringify({ files: {} }))).toBeNull();
    expect(
      parseTemplateContent(JSON.stringify({ elements: [], files: [1, 2] })),
    ).toBeNull();
    expect(parseTemplateContent(JSON.stringify([]))).toBeNull();
  });

  it("PT-P23: null/absent files are legal (text-only scenes)", () => {
    const withNull = parseTemplateContent(JSON.stringify({ elements: [], files: null }));
    expect(withNull).not.toBeNull();
    expect((withNull as { files: unknown } | null)?.files).toBeNull();
    const absent = parseTemplateContent(JSON.stringify({ elements: [] }));
    expect(absent).not.toBeNull();
    expect((absent as { files: unknown } | null)?.files).toBeUndefined();
  });
});

describe("picker order", () => {
  it("PT-P30: sorts by name case-insensitively", () => {
    const rows = [
      { id: "1", name: "Cherry", createdAt: 1 },
      { id: "2", name: "apple", createdAt: 2 },
      { id: "3", name: "banana", createdAt: 3 },
    ];
    expect(sortTemplatesForPicker(rows).map((r) => r.name)).toEqual([
      "apple",
      "banana",
      "Cherry",
    ]);
  });

  it("PT-P31: newer wins name ties; id breaks timestamp ties", () => {
    const rows = [
      { id: "b", name: "Plan", createdAt: 100 },
      { id: "a", name: "Plan", createdAt: 200 },
      { id: "d", name: "Plan", createdAt: 100 },
    ];
    const sorted = sortTemplatesForPicker(rows);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  it("PT-P32: does not mutate the input", () => {
    const rows = [
      { id: "1", name: "b", createdAt: 1 },
      { id: "2", name: "a", createdAt: 1 },
    ];
    sortTemplatesForPicker(rows);
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]);
  });
});

describe("row type shape", () => {
  it("PT-P40: a template row is a summary plus content", () => {
    const row = buildTemplateRow("t", payloadOf(1), "plain", 1);
    const { content, ...summary } = row as TemplateRow;
    expect(content).toBeTruthy();
    expect(summary).toMatchObject({ name: "t", elementCount: 1 });
  });
});
