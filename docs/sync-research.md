# Sync & Collaboration — Research Write-up

> Status: **research, no implementation** (issue #29, v1.4.0). This document
> is the decision basis for the sync work on the roadmap. Numbers that were
> not verifiable at writing time are deliberately qualitative.

## 1. Where we start from

InfiniteNote today is strictly **local-first, single-writer**:

- All data lives in the browser's IndexedDB via Dexie: `notebooks`, `sections`,
  `pages` (see `src/lib/notes-db.ts`). A page row carries its metadata *and*
  the serialized Excalidraw scene (`elements[]` + binary `files` map) as one
  JSON blob.
- The only data that leaves the device is what the user explicitly exports:
  PNG / SVG / PDF / `.excalidraw` scene / full-library backup JSON.
- There is no server component, no account, no telemetry — a design goal we
  want to keep as the *default* mode.

Users on Linux + Android repeatedly ask for two things this document studies:

1. **File-based sync** — "point InfiniteNote at a folder that Syncthing /
   Nextcloud / Dropbox replicates, and let my notes follow me between
   machines."
2. **Self-hostable, end-to-end-encrypted sync** — "I want my phone and my
   laptop to stay in sync through *my* server, without the server seeing my
   notes."

Shared notebooks (multi-user collaboration) depends on the sync model and is
scoped in §7.

## 2. Why "just sync the JSON" does not work

The tempting shortcut — replicate the IndexedDB rows, or re-import the backup
file with last-writer-wins (LWW) — fails for a structural reason:

- A page's scene is a **single JSON document** (element array + file map).
  Two devices editing the same page produce two divergent full documents.
  LWW silently discards one side's work; a naive field-merge corrupts the
  scene (element arrays are order-sensitive, ids must stay unique, `files`
  entries are referenced by id).
- The tree (notebook/section/page rows) is small and low-contention; the
  *scenes* are where concurrent edits actually happen (two strokes on the
  same canvas from two devices).
- Excalidraw itself, in its official collaboration mode, solves this by
  shipping every element mutation as an operation to a room server — i.e.
  it syncs **operations**, not snapshots.

Conclusion: any honest sync story must either sync **operations** (update log)
or use a **merge library built for concurrent documents** (CRDT). Snapshot
exchange can only be a bootstrapping/fallback mechanism.

## 3. CRDT library survey

Two candidates dominate the browser-embedded, offline-first space:

| | **Yjs** | **Automerge (v2 / `automerge-repo`)** |
|---|---|---|
| Model | YATA (list-optimized CRDT) | RGA-derived sequence CRDT |
| Maturity | Very high; used in production by many editors | High; backed by Ink & Switch research lineage |
| Payload | Compact binary updates (diff-friendly) | Binary changes; historically heavier snapshots, v2 improved |
| Bindings for our stack | `y-indexeddb`, `y-websocket`, `y-protocols` available; plain TS, no WASM required | WASM core; `automerge-repo` gives storage + network plumbing |
| Awareness (cursors/presence) | First-class (awareness protocol) | Supported via repo integration |
| License | MIT | MIT |

Both are legitimate. The differentiators *for InfiniteNote*:

- **No WASM constraint**: Yjs runs as plain JS in the browser and in Node —
  one less moving part for a PWA that must also work inside the planned
  Tauri shell and under restrictive CSP.
- **Update-log transport**: Yjs update documents compose (union-merge) and
  can be relayed over *any* dumb transport — a file, a WebSocket, even
  copy-paste. That maps 1:1 onto both Option A (file-based) and Option B
  (encrypted blob server) below, and lets us keep the sync core identical
  when the transport changes.
- **Per-scene documents**: each page's scene would be its own Yjs document
  (`Y.Doc`), keeping documents small, isolation trivial, and trash/restore
  semantics untouched.

**Recommendation: Yjs** if/when we adopt a CRDT, with the explicit caveat
that Automerge's `automerge-repo` would give us more batteries-included
plumbing at the cost of the WASM dependency.

## 4. Option A — file-based sync (Syncthing/Nextcloud folder)

**Idea.** The user designates a directory as their "InfiniteNote sync
folder". The app materializes one file per page (plus a small manifest) in a
documented, human-inspectable format; any folder-replication tool keeps it
in sync across devices.

**Design sketch.**

```
<sync-folder>/
  manifest.json            # tree snapshot: notebooks/sections/pages, ids, updated-at
  pages/<pageId>.ydoc      # scene as a Yjs update log (binary)  [phase 2]
  pages/<pageId>.json      # scene snapshot (phase 1 fallback / debugging aid)
  trash.jsonl              # append-only soft-delete log
```

- **Phase 1 (no CRDT yet):** export snapshots; on import, merge at *page
  granularity* with LWW + **conflict copies** — when both sides changed a
  page, keep the newer version and materialize the loser as
  `Title (conflict <date>)` instead of dropping it. The tree (manifest)
  merges structurally: ids are UUIDs created offline, so union-merge is safe
  for adds; renames/deletes resolve by `updatedAt`.
- **Phase 2 (Yjs core):** pages become `Y.Doc`s persisted as update logs.
  Because Yjs updates union-merge deterministically, concurrent edits to the
  same page converge on both devices without user intervention. The JSON
  snapshot remains as a recovery format.
- **Change detection:** the File System Access API (Chromium desktop) gives
  us real watchers; on Android/PWA we fall back to re-reading the manifest on
  foreground + manual "Sync now".
- **Trust model:** the folder is plaintext (it already is for every other
  file the user syncs). E2EE for the *transport* is the user's choice of
  Syncthing config / encrypted Nextcloud storage. An at-rest encryption
  layer is Option B territory.

**Risks.** Two apps writing simultaneously on the same machine; users
editing the files by hand (mitigated: documented format + repair-from-JSON
path); storage growth from update logs (mitigated: periodic compaction —
Yjs state snapshots).

## 5. Option B — self-hostable, end-to-end-encrypted sync backend

**Idea.** An *optional* companion server (single Docker image, no accounts
required beyond a sync code) that stores opaque encrypted blobs and relays
change notifications. The server never sees plaintext.

**Key handling (outline).**

- A **sync key** is derived client-side from a user passphrase
  (Argon2id → 256-bit key). The passphrase never leaves the device.
- Each notebook (or each page, phase-dependent) gets a random content key,
  encrypted with the sync key; rotating the passphrase re-wraps content keys
  only — no re-encryption of payloads.
- Payloads are AEAD-encrypted (AES-GCM) blobs; the server is a dumb,
  content-addressed store (`PUT /blobs/<id>`, `GET`, plus a WebSocket for
  "something changed" pings). Conflict handling is *client-side CRDT
  merge*, because the blobs carry Yjs update logs — the server stores and
  relays, it never merges.
- Shared-notebook invites (§7) become wrapped-key exchanges: the inviter
  wraps the notebook's content key for the invitee's public key
  (X25519-style key agreement).

**Why not reuse a hosted backend?** The project's positioning (open-source,
self-hostable, Linux+Android) makes a mandatory cloud a non-starter; the
runbook-first approach we took for OneNote migration applies here too: the
sync server ships as an artifact the user can run, and the app treats it as
optional.

**Risks.** Key loss = data loss (mitigate with a printable recovery phrase);
device revocation is genuinely hard with wrapped keys (document honestly);
WebSockets behind restrictive proxies (fallback: long-poll or manual sync).

## 6. What stays the same regardless of option

- IndexedDB remains the source of truth for the running app; sync layers are
  *adapters* that observe and feed it. This keeps the offline-first PWA
  guarantee untouched.
- The trash model (soft delete + cascade timestamps) must survive merges:
  deletes are just another kind of concurrent edit and must not resurrect
  purged rows (purges write tombstones into the sync log).
- Backups (the existing JSON archive) remain the disaster-recovery path,
  independent of sync.

## 7. Shared notebooks (research only)

Requires Option B's key-wrapping primitive plus a permissions model:
viewer / editor per notebook, enforced client-side (editors hold the content
key; the server cannot enforce anything since it is blind). Real-time
multi-cursor editing is already implied by the Yjs awareness protocol once
the transport exists, but UI work (presence, follow-mode) is significant and
explicitly **out of scope** until sync itself ships.

## 8. Recommendation — phased plan

| Phase | Target | Content |
|---|---|---|
| **1 (v1.5)** | File-based sync, no CRDT | Sync-folder export/import, page-granular merge with conflict copies, manifest union-merge, "Sync now" + foreground re-scan |
| **2 (v2.0)** | Yjs core | Pages become Y.Docs (update logs in the sync folder), deterministic concurrent merge, log compaction; backup format v2 |
| **3 (post-2.0)** | Optional E2EE server | Docker image, sync-code pairing, wrapped content keys, WebSocket change relay; shared-notebook invites as key wrapping |

Phase 1 delivers the most-requested workflow (Syncthing users) with the
least risk and no new dependencies; Phase 2 is the structural fix that makes
"just works" concurrency possible; Phase 3 is the self-hosted cloudless
cloud. Each phase is independently shippable and useful.

## 9. Open questions

- Should the sync folder support *multiple* libraries (profiles), or one
  library per folder? (Leaning: one per folder, explicit.)
- Android: do we target the File System Access API via
  `launchDirectoryPicker` in the TWA, or a SAF-backed export target?
- Does Yjs `files`-map handling need a custom type (binary blobs as
  `Y.Map` entries with dataURL strings) or is snapshot-per-file acceptable?
- Migration UX: when Phase 2 converts snapshots to Y.Docs, how do we handle
  a device that was offline for months (stale snapshot + long update log)?
