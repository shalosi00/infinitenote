/**
 * Audio clip helpers — pure, dependency-free logic for audio import (issue #67).
 *
 * Everything in this module must run identically in the browser bundle, in
 * bun unit tests and during SSR: no DOM, no MediaRecorder, no Node APIs.
 * The browser-only recording pipeline lives in the components layer; it only
 * calls the pickers/formatters defined here so the choices stay testable.
 */

import { generatedNames } from "./generated-names";

/**
 * File extensions that unambiguously denote audio.
 *
 * `.webm` is intentionally absent: it is a video container by default. A
 * `.webm` is treated as audio only when the browser stamped it with an
 * `audio/webm` MIME type — which is exactly what MediaRecorder produces for
 * our own recordings. Everything else (.mp4 with audio mime, …) follows the
 * same rule: the MIME type wins over the extension.
 */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "flac",
  "weba",
  "opus",
] as const;

/** Does this (name, mimeType) pair describe an importable audio clip? */
export function isAudioFile(name: string, mimeType: string): boolean {
  if (mimeType.toLowerCase().startsWith("audio/")) return true;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * MediaRecorder output preferences, best first.
 *
 * audio/webm;codecs=opus — Chrome/Edge/Chromium (Tauri shell, Android TWA).
 * audio/ogg;codecs=opus   — Firefox.
 * audio/mp4               — Safari.
 * audio/aac, audio/webm   — fallbacks without an explicit codec.
 */
export const RECORDER_MIME_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
  "audio/webm",
] as const;

/**
 * Pick the best recording MIME type the environment supports.
 * `isSupported` is injected so tests can simulate any browser; in the app it
 * is `MediaRecorder.isTypeSupported`. Returns null when nothing works.
 */
export function pickRecorderMimeType(
  isSupported: (mime: string) => boolean
): string | null {
  for (const mime of RECORDER_MIME_PREFERENCES) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

/** Map a recorder MIME type to the file extension the clip should carry. */
export function recorderExtensionForMime(mime: string): string {
  const base = mime.split(";", 1)[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm":
    case "audio/ogg":
      return base === "audio/webm" ? "webm" : "ogg";
    case "audio/mp4":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    default:
      return "audio";
  }
}

/** Zero-padded mm:ss duration label ("0:07", "1:05", "62:00"). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Build the filename for a just-finished recording, e.g.
 * "Recording 2026-11-07 14-05-32.webm". Dashes in the time keep the name a
 * single shell-safe token; the date is local (a recording is a "today"
 * note). Seconds resolution (issue #95): two takes inside one minute must
 * not collide into identical names.
 */
export function buildRecordingFileName(
  extension: string,
  now: Date = new Date()
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const ext = extension.replace(/^\.+/, "") || "audio";
  const prefix = generatedNames().recordingPrefix;
  return `${prefix}${date} ${time}.${ext}`;
}

/**
 * Link marker for audio embeddables.
 *
 * Excalidraw's scene-restore path runs every element `link` through
 * `sanitizeUrl()`, which rewrites ALL `data:` URLs to `about:blank` — so the
 * audio payload can never ride on `link`. Instead the payload lives in
 * `customData.audioData` (restore and both export clearers pass customData
 * through untouched) and `link` carries only this marker scheme, which
 * `sanitizeUrl` accepts verbatim. The marker doubles as the validation key
 * for the `validateEmbeddable` prop — nothing else may mount an iframe.
 */
export const AUDIO_LINK_SCHEME = "infinitenote:audio";

/** Does this embeddable link mark the element as one of our audio blocks? */
export function isAudioBlockLink(link: string | null | undefined): boolean {
  return typeof link === "string" && link.startsWith(AUDIO_LINK_SCHEME);
}

/** Extract a validated audio payload (data: URL) from embeddable customData. */
export function audioPayloadOf(
  customData: { audioData?: unknown } | null | undefined
): string | null {
  const payload = customData?.audioData;
  return typeof payload === "string" && isAudioDataUrl(payload) ? payload : null;
}

/**
 * Is this string an audio payload we can hand to `<audio>`? Accepts any
 * `data:audio/…` URL (base64 or percent-encoded), case-insensitively.
 * Non-data links (https embeds) are not playable payloads.
 */
export function isAudioDataUrl(link: string | null | undefined): boolean {
  if (!link) return false;
  return /^data:audio\//i.test(link);
}

/** Canonical audio MIME for an extension-derived clip name; null if unknown. */
export function audioMimeForExtension(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "webm":
    case "weba":
      return "audio/webm";
    default:
      return null;
  }
}

/**
 * Normalize a clip's data URL to an `audio/*` MIME.
 *
 * `FileReader.readAsDataURL` stamps empty-MIME files (drag-dropped `.mp3`s
 * on several platforms) as `data:application/octet-stream`. Browsers refuse
 * to play those in `<audio>`, so we rebuild the prefix from the filename
 * extension. Already-audio URLs pass through untouched; anything we cannot
 * map returns null (caller skips the file).
 */
export function withAudioMime(dataUrl: string, fileName: string): string | null {
  if (isAudioDataUrl(dataUrl)) return dataUrl;
  const m = /^data:([^;,]*)([^,]*),(.*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = audioMimeForExtension(fileName);
  if (!mime) return null;
  return `data:${mime}${m[2]},${m[3]}`;
}

/** World-space size of an audio block on the canvas (a player strip). */
export const AUDIO_BLOCK_WIDTH = 360;
export const AUDIO_BLOCK_HEIGHT = 80;

/**
 * Import size cap for audio clips (issue #91). A clip becomes a base64
 * data: payload (~1.37× its size) stored inside the scene, so anything
 * past this risks blowing the IndexedDB quota on the NEXT autosave — after
 * the block is already on the canvas. 30 MB keeps hour-long opus takes.
 */
export const MAX_AUDIO_IMPORT_BYTES = 30 * 1024 * 1024;

/** Should this audio file be refused at import time (issue #91)? */
export function isAudioImportTooLarge(byteSize: number): boolean {
  return byteSize > MAX_AUDIO_IMPORT_BYTES;
}
