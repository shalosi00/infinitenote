/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import {
  AUDIO_BLOCK_HEIGHT,
  AUDIO_BLOCK_WIDTH,
  AUDIO_LINK_SCHEME,
  audioMimeForExtension,
  audioPayloadOf,
  buildRecordingFileName,
  formatDuration,
  isAudioBlockLink,
  isAudioDataUrl,
  isAudioFile,
  pickRecorderMimeType,
  RECORDER_MIME_PREFERENCES,
  recorderExtensionForMime,
  withAudioMime,
} from "../audio-notes";

describe("audio-notes — classification", () => {
  it("accepts any audio/* MIME regardless of filename", () => {
    expect(isAudioFile("clip.bin", "audio/webm")).toBe(true);
    expect(isAudioFile("take", "audio/mpeg")).toBe(true);
    expect(isAudioFile("x.dat", "AUDIO/MP4")).toBe(true); // case-insensitive
  });

  it("falls back to known audio extensions when the MIME is empty", () => {
    for (const ext of ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "weba", "opus"]) {
      expect(isAudioFile(`interview.${ext}`, "")).toBe(true);
      expect(isAudioFile(`INTERVIEW.${ext.toUpperCase()}`, "")).toBe(true);
    }
  });

  it("keeps .webm out unless the MIME says audio (video container by default)", () => {
    expect(isAudioFile("clip.webm", "")).toBe(false);
    expect(isAudioFile("clip.webm", "video/webm")).toBe(false);
    expect(isAudioFile("clip.webm", "audio/webm")).toBe(true); // MediaRecorder output
  });

  it("rejects non-audio files", () => {
    expect(isAudioFile("notes.txt", "text/plain")).toBe(false);
    expect(isAudioFile("img.png", "image/png")).toBe(false);
    expect(isAudioFile("data.dat", "application/octet-stream")).toBe(false);
    expect(isAudioFile("", "")).toBe(false);
  });
});

describe("audio-notes — recorder MIME picking", () => {
  it("prefers opus-in-webm when available (Chromium family)", () => {
    const supported = (m: string) => m.startsWith("audio/webm") || m === "audio/mp4";
    expect(pickRecorderMimeType(supported)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to ogg/opus for Firefox-only environments", () => {
    const supported = (m: string) => m === "audio/ogg;codecs=opus";
    expect(pickRecorderMimeType(supported)).toBe("audio/ogg;codecs=opus");
  });

  it("falls back to mp4 for Safari-only environments", () => {
    const supported = (m: string) => m === "audio/mp4" || m === "audio/aac";
    expect(pickRecorderMimeType(supported)).toBe("audio/mp4");
  });

  it("returns null when nothing is supported", () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });

  it("tries every preference before giving up", () => {
    const supported = (m: string) => m === RECORDER_MIME_PREFERENCES[RECORDER_MIME_PREFERENCES.length - 1];
    expect(pickRecorderMimeType(supported)).toBe("audio/webm");
  });
});

describe("audio-notes — extension mapping", () => {
  it("maps recorder MIME types to file extensions", () => {
    expect(recorderExtensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(recorderExtensionForMime("audio/webm")).toBe("webm");
    expect(recorderExtensionForMime("audio/ogg;codecs=opus")).toBe("ogg");
    expect(recorderExtensionForMime("audio/mp4")).toBe("m4a");
    expect(recorderExtensionForMime("audio/aac")).toBe("aac");
    expect(recorderExtensionForMime("audio/mpeg")).toBe("mp3");
    expect(recorderExtensionForMime("audio/wav")).toBe("wav");
  });

  it("uses a generic extension for unknown MIME types", () => {
    expect(recorderExtensionForMime("audio/x-unknown")).toBe("audio");
    expect(recorderExtensionForMime("")).toBe("audio");
  });
});

describe("audio-notes — duration formatting", () => {
  it("formats mm:ss with zero padding", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(3599)).toBe("59:59");
    expect(formatDuration(3600)).toBe("60:00"); // no hours bucket — a take is a note
  });

  it("floors fractional seconds and tolerates junk", () => {
    expect(formatDuration(7.6)).toBe("0:07"); // timers count completed seconds
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("audio-notes — recording filename", () => {
  it("builds a dated, shell-safe filename", () => {
    const stamp = new Date(2026, 10, 7, 14, 5); // 2026-11-07 14:05 local
    expect(buildRecordingFileName("webm", stamp)).toBe("Recording 2026-11-07 14-05.webm");
  });

  it("zero-pads single-digit parts and strips leading dots from the extension", () => {
    const stamp = new Date(2026, 0, 3, 9, 2);
    expect(buildRecordingFileName("m4a", stamp)).toBe("Recording 2026-01-03 09-02.m4a");
    expect(buildRecordingFileName(".ogg", stamp)).toBe("Recording 2026-01-03 09-02.ogg");
  });

  it("never emits an empty extension", () => {
    const stamp = new Date(2026, 10, 7, 14, 5);
    expect(buildRecordingFileName("", stamp)).toMatch(/\.audio$/);
  });
});

describe("audio-notes — data URL handling", () => {
  it("recognizes audio data URLs case-insensitively", () => {
    expect(isAudioDataUrl("data:audio/webm;base64,AAA")).toBe(true);
    expect(isAudioDataUrl("DATA:AUDIO/MP4;base64,AAA")).toBe(true);
    expect(isAudioDataUrl("data:audio/ogg,AAAA")).toBe(true);
  });

  it("rejects non-audio links", () => {
    expect(isAudioDataUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isAudioDataUrl("https://example.com/a.mp3")).toBe(false);
    expect(isAudioDataUrl("")).toBe(false);
    expect(isAudioDataUrl(null)).toBe(false);
    expect(isAudioDataUrl(undefined)).toBe(false);
  });

  it("marks audio blocks by the custom link scheme", () => {
    expect(isAudioBlockLink(AUDIO_LINK_SCHEME)).toBe(true);
    expect(isAudioBlockLink(`${AUDIO_LINK_SCHEME}?v=2`)).toBe(true);
    expect(isAudioBlockLink("data:audio/webm;base64,AAA")).toBe(false);
    expect(isAudioBlockLink("https://youtube.com/watch?v=x")).toBe(false);
    expect(isAudioBlockLink("about:blank")).toBe(false); // sanitizeUrl's rewrite
    expect(isAudioBlockLink(null)).toBe(false);
    expect(isAudioBlockLink(undefined)).toBe(false);
  });

  it("extracts playable payloads from embeddable customData", () => {
    expect(audioPayloadOf({ audioData: "data:audio/wav;base64,AAA" })).toBe(
      "data:audio/wav;base64,AAA"
    );
    // junk payloads are rejected, not passed through
    expect(audioPayloadOf({ audioData: "data:image/png;base64,AAA" })).toBeNull();
    expect(audioPayloadOf({ audioData: 42 })).toBeNull();
    expect(audioPayloadOf({})).toBeNull();
    expect(audioPayloadOf(null)).toBeNull();
    expect(audioPayloadOf(undefined)).toBeNull();
  });

  it("maps extensions to canonical audio MIME types", () => {
    expect(audioMimeForExtension("a.mp3")).toBe("audio/mpeg");
    expect(audioMimeForExtension("a.WAV")).toBe("audio/wav");
    expect(audioMimeForExtension("a.oga")).toBe("audio/ogg");
    expect(audioMimeForExtension("a.opus")).toBe("audio/ogg");
    expect(audioMimeForExtension("a.m4a")).toBe("audio/mp4");
    expect(audioMimeForExtension("a.flac")).toBe("audio/flac");
    expect(audioMimeForExtension("a.weba")).toBe("audio/webm");
    expect(audioMimeForExtension("a.txt")).toBeNull();
    expect(audioMimeForExtension("noext")).toBeNull();
  });

  it("passes already-audio data URLs through untouched", () => {
    const url = "data:audio/webm;base64,dGVzdA==";
    expect(withAudioMime(url, "clip.webm")).toBe(url);
  });

  it("repairs empty-MIME data URLs from the file extension", () => {
    // FileReader.readAsDataURL stamps empty-MIME files as octet-stream
    expect(withAudioMime("data:application/octet-stream;base64,AAA", "clip.mp3")).toBe(
      "data:audio/mpeg;base64,AAA"
    );
    expect(withAudioMime("data:application/octet-stream,AAA", "clip.wav")).toBe(
      "data:audio/wav,AAA"
    );
  });

  it("returns null for unmappable or malformed URLs", () => {
    expect(withAudioMime("data:application/octet-stream;base64,AAA", "clip.xyz")).toBeNull();
    expect(withAudioMime("not-a-data-url", "clip.mp3")).toBeNull();
    expect(withAudioMime("https://example.com/a.mp3", "a.mp3")).toBeNull();
  });

  it("defines a sane on-canvas block size", () => {
    expect(AUDIO_BLOCK_WIDTH).toBeGreaterThan(200);
    expect(AUDIO_BLOCK_HEIGHT).toBeGreaterThan(40);
    expect(AUDIO_BLOCK_WIDTH).toBeLessThan(1000);
    expect(AUDIO_BLOCK_HEIGHT).toBeLessThan(200);
  });
});
