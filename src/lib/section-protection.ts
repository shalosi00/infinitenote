/**
 * Section protection policy (issue #371) — OneNote "Password Protection"
 * parity, phase 1: an entire SECTION is protected with a password; its
 * pages' scene payloads (and version-history snapshots) are AES-GCM
 * encrypted at rest in IndexedDB; the unlock key lives in a memory-only
 * cache that a reload or app restart clears (OneNote locks again on
 * close); locked sections refuse content reads, are skipped by search and
 * cannot be exported (support.microsoft.com "Protect notes with a password
 * in OneNote" / "Video: Protect notes with a password").
 *
 * Layout mirrors the sibling policy modules (section-colors.ts,
 * section-groups.ts, page-tree.ts): pure validation + domain primitives,
 * NO Dexie imports (the wave-21 poisoning lesson). notes-db.ts drives the
 * persistence; the UI reads `isSectionLocked` through the store's mirror
 * of the unlock cache.
 *
 * Crypto envelope (all WebCrypto, platform API — no dependency added):
 * - A random per-section data key (DEK, AES-GCM-256, extractable raw).
 * - The DEK is wrapped with a key derived from the password via
 *   PBKDF2-HMAC-SHA256 (random 16-byte salt, pinned iteration count).
 * - The section row carries the additive `protection` block: salt +
 *   iterations + wrapped DEK + wrap IV + optional hint. Nothing plaintext
 *   about the password is ever stored; a forgotten password cannot be
 *   recovered (OneNote's own no-recovery rule — the hint is user-supplied
 *   text shown on the unlock card, never derived from the password).
 * - Encrypted content strings carry the `enc1.<iv>.<ciphertext>` marker
 *   (base64url parts). Plaintext scene JSON always starts with `{` or
 *   `[`, so the marker namespace cannot collide with legacy rows.
 *
 * Hand-edit tolerance (the safeSectionColor / normalizeSectionKind
 * contract): a malformed `protection` block normalizes to null — the
 * section reads as unprotected; its orphaned `enc1.` content rows (if a
 * hand edit stripped the block) parse as corrupt scenes and read as empty
 * content, never as garbage in the canvas.
 *
 * Phase 2 (issue #378) adds the two candidates #371 named, both OneNote
 * desktop parity:
 * - Auto-lock after inactivity: OneNote desktop re-locks protected
 *   sections after configurable inactivity — the default keeps them
 *   unlocked 10 minutes past the last work (File > Options > Password;
 *   the UWP/web builds fix it at 5, Mac at a few minutes). The minutes
 *   setting is per-device UX state in localStorage (the themes /
 *   last-page precedent — not note data, never synced); the deadline
 *   math here is pure and the note-app effect drives it.
 * - Lock all: OneNote's right-click > Password Protection > "Lock
 *   Protected Sections" locks ALL protected sections at once.
 */

import type { Section } from "./types";

/** The additive protection block carried on the section row. */
export interface SectionProtection {
  /** base64url PBKDF2 salt (fresh random per set / change) */
  salt: string;
  /** PBKDF2-HMAC-SHA256 iteration count (pinned; recorded per row) */
  iterations: number;
  /** base64url AES-GCM-encrypted raw DEK (the wrap) */
  wrappedKey: string;
  /** base64url GCM IV of the wrap */
  wrapIv: string;
  /** optional user hint shown on the unlock card (OneNote's hint) */
  hint?: string | null;
}

/** OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256 ≥ 600 000. */
export const PBKDF2_ITERATIONS = 600_000;

const DEK_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard
const SALT_BYTES = 16;

const MARKER_PREFIX = "enc1.";

/** b64url encode/decode (padding-free, the marker + envelope alphabet). */
function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* envelope validation (hand-edit tolerance)                           */
/* ------------------------------------------------------------------ */

/**
 * Canonical read of a section's protection block: null when absent or
 * malformed (the safeSectionColor contract — a hand-edited archive or a
 * type-confused sync row degrades to "unprotected", never throws).
 */
export function safeProtection(v: unknown): SectionProtection | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const p = v as Partial<SectionProtection>;
  const isB64u = (s: unknown): s is string =>
    typeof s === "string" && s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s);
  if (!isB64u(p.salt) || !isB64u(p.wrappedKey) || !isB64u(p.wrapIv)) return null;
  if (typeof p.iterations !== "number" || !Number.isFinite(p.iterations) || p.iterations < 1) {
    return null;
  }
  if (p.hint !== undefined && p.hint !== null && typeof p.hint !== "string") return null;
  return {
    salt: p.salt,
    iterations: p.iterations,
    wrappedKey: p.wrappedKey,
    wrapIv: p.wrapIv,
    hint: p.hint ?? null,
  };
}

/** True when the row carries a well-formed protection block. */
export function isSectionProtected(section: Pick<Section, "protection"> | undefined): boolean {
  return safeProtection(section?.protection) !== null;
}

/** True when the content string is an encrypted marker (not scene JSON). */
export function isEncryptedContent(content: string | null | undefined): boolean {
  return (
    typeof content === "string" &&
    content.startsWith(MARKER_PREFIX) &&
    isEncryptedContentParts(content.slice(MARKER_PREFIX.length))
  );
}

function isEncryptedContentParts(rest: string): boolean {
  const parts = rest.split(".");
  if (parts.length !== 2) return false;
  return /^[A-Za-z0-9_-]+$/.test(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1]);
}

/** Truncate the hint for the unlock card (defensive display cap). */
export function displayHint(hint: string | null | undefined): string {
  const text = typeof hint === "string" ? hint.trim() : "";
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/* ------------------------------------------------------------------ */
/* unlock cache — memory only, NEVER persisted                         */
/* ------------------------------------------------------------------ */

const unlockedKeys = new Map<string, CryptoKey>();

/** True when this session holds the section's data key in memory. */
export function isSectionUnlocked(sectionId: string): boolean {
  return unlockedKeys.has(sectionId);
}

/**
 * True when the section cannot be read right now: it is protected AND
 * this session holds no key for it (OneNote's locked state — a reload
 * or app restart lands here because the cache never survives one).
 */
export function isSectionLocked(section: Section | undefined, unlockedIds?: readonly string[]): boolean {
  if (!isSectionProtected(section)) return false;
  const id = (section as Section).id;
  if (unlockedIds) return !unlockedIds.includes(id);
  return !unlockedKeys.has(id);
}

/** Drop one section's cached key (the "Lock now" primitive). */
export function dropUnlockedKey(sectionId: string): void {
  unlockedKeys.delete(sectionId);
}

/** Cache the section's data key after a successful verify (unlock). */
export function cacheUnlockedKey(sectionId: string, key: CryptoKey): void {
  unlockedKeys.set(sectionId, key);
}

/** The cached data key, when this session holds one (re-seal paths). */
export function unlockedKey(sectionId: string): CryptoKey | undefined {
  return unlockedKeys.get(sectionId);
}

/** Drop every cached key (app restart / "lock all" semantics). */
export function dropAllUnlockedKeys(): void {
  unlockedKeys.clear();
}

/** Test + store-mirror helper: the ids currently holding cached keys. */
export function unlockedSectionIdList(): string[] {
  return [...unlockedKeys.keys()];
}

/* ------------------------------------------------------------------ */
/* auto-lock after inactivity (issue #378, OneNote desktop parity)     */
/* ------------------------------------------------------------------ */

/** localStorage key for the auto-lock minutes setting (per-device UX state). */
export const AUTO_LOCK_STORAGE_KEY = "infinitenote.protection.autolock";

/**
 * OneNote desktop's default: a protected section stays unlocked 10
 * minutes past the last work in it (customguide OneNote password guide:
 * "the default is to have a section stay unlocked for ten minutes after
 * you're done working in it").
 */
export const DEFAULT_AUTO_LOCK_MINUTES = 10;

/** The configurable range mirrors OneNote's minutes spinner: 1–720 (12 h). */
export const MIN_AUTO_LOCK_MINUTES = 1;
export const MAX_AUTO_LOCK_MINUTES = 720;

/**
 * Parse + sanitize the stored auto-lock minutes. Valid values are `0`
 * (auto-lock off) and the integer range 1–720; everything else — absent,
 * malformed, fractional, out of range — degrades to the default 10 (the
 * last-page.ts contract: a hand-edited storage value never throws).
 */
export function parseAutoLockMinutes(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_AUTO_LOCK_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_AUTO_LOCK_MINUTES;
  if (n === 0) return 0;
  if (n < MIN_AUTO_LOCK_MINUTES || n > MAX_AUTO_LOCK_MINUTES) return DEFAULT_AUTO_LOCK_MINUTES;
  return n;
}

/** SSR-safe read of the auto-lock setting (no localStorage → the default). */
export function readAutoLockMinutes(): number {
  if (typeof localStorage === "undefined") return DEFAULT_AUTO_LOCK_MINUTES;
  try {
    return parseAutoLockMinutes(localStorage.getItem(AUTO_LOCK_STORAGE_KEY));
  } catch {
    return DEFAULT_AUTO_LOCK_MINUTES;
  }
}

/** Persist the auto-lock setting (SSR-safe; the value is re-sanitized). */
export function writeAutoLockMinutes(minutes: number): void {
  if (typeof localStorage === "undefined") return;
  const valid = parseAutoLockMinutes(String(minutes));
  try {
    localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(valid));
  } catch {
    /* storage full / blocked — the in-memory store value still applies */
  }
}

/**
 * Strict validation for the auto-lock dialog draft: an integer 0–720
 * returns the value (0 = off); anything else — empty, fractional,
 * negative, over the cap — returns null so the dialog can show an inline
 * error instead of silently rewriting the user's input (unlike
 * parseAutoLockMinutes, which repairs stored values to the default).
 */
export function validateAutoLockMinutesDraft(draft: string): number | null {
  const t = draft.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (n > MAX_AUTO_LOCK_MINUTES) return null;
  return n;
}

/** How often the note-app effect polls the idle deadline. */
export const AUTO_LOCK_CHECK_INTERVAL_MS = 15_000;

/**
 * The pure deadline check: true when `nowMs` is at or past the idle
 * deadline (`lastActivityMs + minutes` minutes). `minutes <= 0` means
 * auto-lock is off — never due. The exact boundary counts (OneNote locks
 * AT the configured timeout, not strictly after).
 */
export function autoLockDue(lastActivityMs: number, minutes: number, nowMs: number): boolean {
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  return nowMs - lastActivityMs >= minutes * 60_000;
}

/* ------------------------------------------------------------------ */
/* crypto primitives                                                   */
/* ------------------------------------------------------------------ */

async function deriveKek(password: string, saltB64u: string, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromB64u(saltB64u) as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function generateDek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
  return crypto.subtle.importKey("raw", raw as unknown as BufferSource, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

/** AES-GCM encrypt with a fresh IV; returns base64url iv and ciphertext. */
async function gcmEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource,
  );
  return { iv: toB64u(iv), ct: toB64u(new Uint8Array(ct)) };
}

/** AES-GCM decrypt; null when authentication fails (wrong key / tamper). */
async function gcmDecrypt(key: CryptoKey, ivB64u: string, ctB64u: string): Promise<Uint8Array | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64u(ivB64u) as unknown as BufferSource },
      key,
      fromB64u(ctB64u) as unknown as BufferSource,
    );
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* password → protection block                                         */
/* ------------------------------------------------------------------ */

/**
 * Build a fresh protection block: random salt + DEK, wrap the DEK with
 * the password-derived key. No password material is retained.
 *
 * `iterations` overrides the PBKDF2 budget — the shipped default is the
 * pinned PBKDF2_ITERATIONS; the unit tests pass a small budget so the
 * shared test event loop (bun runs files concurrently) never stalls other
 * files behind a 600k-iteration native derive. Verification always reads
 * the iteration count from the block itself, so envelopes built with any
 * budget verify consistently.
 */
export async function buildProtection(
  password: string,
  hint?: string | null,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<{ protection: SectionProtection; dek: CryptoKey }> {
  const salt = toB64u(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  const dek = await generateDek();
  const kek = await deriveKek(password, salt, iterations);
  const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
  const { iv, ct } = await gcmEncrypt(kek, rawDek);
  const trimmed = typeof hint === "string" ? hint.trim() : "";
  return {
    protection: {
      salt,
      iterations,
      wrappedKey: ct,
      wrapIv: iv,
      hint: trimmed ? trimmed : null,
    },
    dek,
  };
}

/**
 * Verify a password against a protection block and return the unwrapped
 * DEK — null when the password is wrong (the GCM wrap fails to
 * authenticate, so there is no oracle and no plaintext comparison).
 */
export async function verifyPassword(
  protection: SectionProtection,
  password: string,
): Promise<CryptoKey | null> {
  const kek = await deriveKek(password, protection.salt, protection.iterations);
  const raw = await gcmDecrypt(kek, protection.wrapIv, protection.wrappedKey);
  if (!raw) return null;
  return crypto.subtle.importKey("raw", raw as unknown as BufferSource, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

/* ------------------------------------------------------------------ */
/* content marker helpers                                              */
/* ------------------------------------------------------------------ */

/** Encrypt a content string (serialized scene JSON) under the DEK. */
export async function encryptContent(dek: CryptoKey, content: string): Promise<string> {
  const { iv, ct } = await gcmEncrypt(dek, new TextEncoder().encode(content));
  return `${MARKER_PREFIX}${iv}.${ct}`;
}

/**
 * Decrypt a marker content string under the DEK; null when the marker is
 * malformed or authentication fails (wrong section key / tampered row).
 */
export async function decryptContent(dek: CryptoKey, content: string): Promise<string | null> {
  const rest = content.slice(MARKER_PREFIX.length);
  const [iv, ct] = rest.split(".");
  if (!iv || !ct) return null;
  const pt = await gcmDecrypt(dek, iv, ct);
  if (!pt) return null;
  return new TextDecoder().decode(pt);
}

/**
 * Resolve the content string to WRITE for a page in this section:
 * plaintext in, marker ciphertext out when the section is protected AND
 * this session holds its key. Unprotected sections keep the exact legacy
 * byte shape. Called by notes-db on every content write path.
 */
export async function sealContent(
  section: Section | undefined,
  content: string | null,
): Promise<string | null> {
  const protection = safeProtection(section?.protection);
  if (content === null || protection === null) return content;
  const dek = unlockedKeys.get(section!.id);
  if (!dek) throw new SectionLockedError(section!.id);
  if (isEncryptedContent(content)) return content; // already sealed — re-seal never re-randomizes
  return encryptContent(dek, content);
}

/**
 * Thrown when a content write/read needs a protected section's key that
 * this session does not hold. The store maps it to the explicit toast;
 * guards check `isSectionLocked` first so users see the state before
 * acting.
 */
export class SectionLockedError extends Error {
  readonly sectionId: string;
  constructor(sectionId: string) {
    super(`section "${sectionId}" is locked`);
    this.name = "SectionLockedError";
    this.sectionId = sectionId;
  }
}
