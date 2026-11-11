/// <reference types="bun-types" />
/**
 * Edge coverage for the audio clip helpers — extension parsing corners
 * (multi-dot, extensionless and trailing-dot names) and the import size cap
 * (issue #91 — untouched by the base suite).
 *
 * Complements audio-notes.test.ts — no assertion duplicates it.
 */
import { describe, expect, it } from "bun:test";
import {
  MAX_AUDIO_IMPORT_BYTES,
  isAudioFile,
  isAudioImportTooLarge,
} from "../audio-notes";

describe("isAudioFile — extension parsing corners", () => {
  it("uses the LAST dotted segment, and rejects extensionless or trailing-dot names", () => {
    expect(isAudioFile("my.song.mp3", "")).toBe(true); // "song" is not the extension
    expect(isAudioFile("song", "")).toBe(false); // no dot at all
    expect(isAudioFile("song.", "")).toBe(false); // empty final segment
  });
});

describe("audio import size cap (issue #91)", () => {
  it("accepts exactly 30 MiB and refuses one byte over", () => {
    expect(MAX_AUDIO_IMPORT_BYTES).toBe(30 * 1024 * 1024);
    expect(isAudioImportTooLarge(MAX_AUDIO_IMPORT_BYTES)).toBe(false);
    expect(isAudioImportTooLarge(MAX_AUDIO_IMPORT_BYTES + 1)).toBe(true);
  });
});
