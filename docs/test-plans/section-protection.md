# Test plan — password-protected sections (issue #371, wave 25)

OneNote "Password Protection" parity, phase 1: an entire SECTION is
protected with a password; its pages' scene payloads (and version-history
snapshots) are AES-GCM encrypted at rest in IndexedDB under a random
per-section data key wrapped with PBKDF2-HMAC-SHA256 (600 000 iterations,
OWASP budget) — the additive `Section.protection` envelope. The unlock
cache is memory-only: a reload or app restart locks every protected
section again (OneNote locks on close). "Lock now" drops the key.
Forgotten passwords cannot be recovered (OneNote's own rule; the hint is
user-supplied display text).

OneNote-only parity: Joplin has no per-container lock — only whole-vault
E2EE (a master password over every note). Locked sections cannot be
opened, exported, or searched (support.microsoft.com, "Protect notes with
a password in OneNote"); unlocked sections return to all three.

## Decision table

| Surface | Unprotected section | Protected + unlocked | Protected + locked |
|---|---|---|---|
| Open page | normal | normal (decrypts through the cache) | unlock card in place of the canvas |
| Autosave | plaintext scene JSON | re-sealed on every write | unreachable (canvas replaced) |
| Search | normal | content term matches (decrypt-aware index) | content term skipped; titles still match |
| Page/section/notebook PDF | normal | normal | typed `sectionLocked` ExportError → toast |
| Duplicate page | normal | ciphertext copies (same key) | menu refuses (typed guard) |
| Save as template | normal | normal (conscious unlock) | guard toast, dialog stays closed path |
| Version history | normal | snapshots sealed, restore decrypts | guard toast; reads defensive-null |
| Bulk move in/out | normal | content re-seals across the boundary | SectionLockedError, zero writes |
| Sync | legacy page file shape | `enc` field carries the marker verbatim | same — ciphertext needs no key to sync |
| Backup / restore | legacy | envelope + ciphertext ride; restore keeps both | same — unlock with the password afterwards |
| Trash/restore/purge | untouched (metadata ops — rows cascade whole) | same | same |

## Unit pins (src/lib/__tests__/section-protection.test.ts)

- **PP-P*** (pure envelope policy, 9): safeProtection hand-edit tolerance
  (garbage → null, hint normalization), canonical isSectionProtected,
  the marker namespace vs scene JSON, encrypt/decrypt round-trip with
  tamper + wrong-key failure (fail closed), the pinned PBKDF2 budget +
  verify both ways, sealContent's three states (plain / locked-throw /
  sealed + already-sealed idempotence), the memory-only cache with
  explicit drops, the mirror-driven isSectionLocked read, displayHint cap.
- **PP-D*** (data layer, 13): setSectionPassword seals pages AND version
  snapshots + the unlocked-after rule; invalid targets (missing /
  trashed / group / already protected); locked reads null vs unlocked
  decrypt; unlock both ways + the drift re-seal pass; autosave re-seal +
  the throttle decrypting the previous snapshot; change password kills
  the old one; remove restores byte-equal plaintext + strips; createPage
  sealed/locked-refused; duplicate rides the marker; bulk move
  locked-refused with zero writes + re-seal across boundaries; backup
  round-trip (unlock with the same password; hand-edited envelope
  restores unprotected); the export guard matrix.
- **PP-S*** (sync carry, 3): sealed pages ride verbatim in the new
  `SyncPageFile.enc` field (scene stays null — the destructive legacy
  parse cannot happen), the manifest carries the envelope, unprotected
  pages keep the EXACT legacy file shape, hand-edited garbage `enc`
  degrades to empty content.

## E2E (e2e/section-protection.spec.ts, 5 checks)

- **PWP-N01**: set password through the OneNote menu path (dialog +
  mismatch guard + hint) → open badge → reload → locked badge; the
  seeded page shows the unlock card instead of the canvas.
- **PWP-N02**: unlock card — wrong password inline error, hint displayed,
  correct password swaps in the canvas (content decrypted).
- **PWP-N03**: search finds the content term while unlocked, drops it
  after Lock now, still matches the title; unlocking restores it.
- **PWP-N04**: section PDF export refuses with the typed toast while
  locked; the same export downloads after unlock.
- **PWP-N05**: remove password (verify step) strips the badge, restores
  plaintext (search finds the term after a reload, no unlock card).

## Phase-2 candidates (named for a later wave)

- Auto-lock after inactivity (OneNote's "Lock section automatically when
  I'm not working for…") and "Lock All Protected Sections".
- Password hint editing without re-encryption.

## Non-goals

- No server / sync-server E2EE (docs/sync-research.md Option B, post-2.0).
- No per-page or per-notebook protection (OneNote's unit is the section).
