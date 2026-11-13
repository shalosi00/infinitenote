# Desktop app (Linux, Tauri 2)

InfiniteNote ships as a native Linux desktop app via a [Tauri 2](https://tauri.app)
shell. The window is the system webview loading the **same UI as the web PWA**:
`bun run build:desktop` statically exports the Next.js app into `out/` and Tauri
packages it (`src-tauri/tauri.conf.json` → `build.frontendDist = "../out"`).
No behavior fork — the desktop app is the PWA, with data in the webview's
IndexedDB.

## Layout

| Path | What it is |
|---|---|
| `src-tauri/src/main.rs` | Binary entry point (calls `infinitenote_lib::run`) |
| `src-tauri/src/lib.rs` | Shell builder (window config lives in `tauri.conf.json`) |
| `src-tauri/tauri.conf.json` | Product config: identifier `com.infinitenote.app`, window, bundle targets |
| `src-tauri/capabilities/default.json` | Tauri capability for the main window (`core:default`) |
| `src-tauri/icons/` | Bundle icons generated from `public/icons/icon-512.png` |
| `next.config.ts` | `NEXT_OUTPUT_MODE=export` gates the static desktop export |

## Prerequisites (Linux)

- Bun ≥ 1.2
- Rust stable (`rustup`: https://rustup.rs) — 1.77.2+
- webkit2gtk 4.1 and friends:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

(The `Desktop` GitHub Actions workflow runs exactly this list on **`ubuntu-22.04`**, pinned on purpose: linuxdeploy copies the runner's webkit2gtk/glib into the AppImage, so the runner choice sets the artifact's glibc floor — see [Supported distros](#supported-distros).)

## Develop

```sh
bun install
bun run tauri dev     # boots `bun run dev:e2e` on :3000 and opens a native window
```

## Build

```sh
bun run build:desktop   # NEXT_OUTPUT_MODE=export next build → ./out
bun run tauri build     # compiles the shell + bundles
```

Artifacts land in `src-tauri/target/release/bundle/`:

| Target | Artifact |
|---|---|
| deb | `deb/infinitenote_<version>_amd64.deb` |
| rpm | `rpm/infinitenote-<version>-1.x86_64.rpm` (name follows the package metadata) |
| AppImage | `appimage/InfiniteNote_<version>_amd64.AppImage` |

## CI

`.github/workflows/desktop.yml` runs on pushes to `main`, `v*` tags and
`workflow_dispatch` (deliberately **not** on pull requests — it is not one of
the three required checks and a full Rust build takes ~10 minutes). On a `v*`
tag build the deb/rpm/AppImage files are attached to the matching GitHub
Release.

After every build the workflow enforces a **glibc floor**: it extracts the
AppImage, scans every bundled ELF file for `GLIBC_*` symbol requirements and
fails if any requirement exceeds `GLIBC_FLOOR` (2.35). This guards against the
issue #164 class of bug — a v1.11.0 AppImage built on `ubuntu-latest`
(26.04, glibc 2.43) bundled libraries that required `GLIBC_2.42`/`2.43` and
silently failed to launch on Ubuntu 24.04 / Debian 13 / Mint 22.

## Supported distros (desktop artifacts)

Built on Ubuntu 22.04, so the supported floor is **glibc ≥ 2.35**:

| Distro | Status |
|---|---|
| Ubuntu 22.04 / 24.04+, Debian 12+, Mint 21+, Pop!_OS 22.04+ | AppImage, deb |
| Fedora 36+, openSUSE Leap 15.4+ / Tumbleweed | AppImage, rpm |
| Anything x86-64 with glibc ≥ 2.35 and a webkit2gtk-4.1 desktop | AppImage |

The deb/rpm declare their webkit2gtk dependency; the AppImage bundles it.

## Release checklist (desktop artifacts)

1. Tag `vN.N.0` on the release commit (release flow does this).
2. Wait for the `Desktop` workflow on that tag to finish; the artifacts appear
   on the GitHub Release automatically.
3. For Flathub, take the release AppImage: see
   [packaging/flatpak](../packaging/flatpak) and
   [docs/flathub.md](flathub.md) (`node scripts/flatpak-extradata.mjs` pins the
   checksum into the flatpak manifest).

## Desktop CSP (issue #207)

The 2026-11-13 security audit of `main` found the desktop webview running
with `"csp": null` — Tauri v2 then serves the app with no
Content-Security-Policy at all. The app is local-first and embeds
everything, so the shipped policy is a strict, origin-restricted allowlist
(`src-tauri/tauri.conf.json`, `app.security.csp`):

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost;
worker-src 'self' blob:;
media-src 'self' data: blob:;
object-src 'none'; base-uri 'self'; form-action 'none'
```

Derivation, one directive at a time — every entry below is backed by the
measured request inventory (`e2e/csp-inventory.spec.ts`, which runs on every
PR and fails if the app ever requests anything outside this policy):

| Directive | Sources | Justified by (measured) |
|---|---|---|
| `default-src 'self'` | — | baseline for everything not listed; also blocks embed-iframes of pasted links (audio/PDF embeddables render natively, no iframes are used) |
| `script-src 'self'` | Next chunks, `/ocr/tesseract.min.js` (injected UMD), `/sw.js`, the ORT glue `/hwr/ort/*.mjs` (dynamic import), worker `importScripts` of `/ocr/core/*.wasm.js` | the whole app is same-origin |
| `script-src 'unsafe-inline'` | Next's inline RSC flight-data bootstrap (`self.__next_f.push`) in the static-export HTML; Tauri hashes its own injected init scripts on top | measured: the served HTML always carries inline `<script>` payloads and static-export HTML cannot carry nonces (asserted by IN-08 on every run) |
| `script-src 'wasm-unsafe-eval'` | onnxruntime-web (HWR) and tesseract (OCR) compile WebAssembly at runtime | the two vendored engines; the ONLY eval-adjacent token in the policy — `'unsafe-eval'` is forbidden (the HWR bundle import was refactored off `new Function` in this same PR so no runtime JS compilation happens) |
| `script-src blob:` | the HWR bundle `transformers.web.bundle.js.gz` is fetched, decompressed and imported as a `blob:` module URL | hwr-client.ts |
| `style-src 'self' 'unsafe-inline'` | Next CSS files + React inline `style` attributes + Excalidraw's injected `<style>` | measured: inline styles are pervasive in the canvas UI |
| `img-src 'self' data: blob:` | scene images (stored as `data:` URLs), blob previews when pasting | scene/paste handling |
| `font-src 'self' data:` | self-hosted Excalidraw fonts under `/excalidraw/`, next/font woff2 | measured in the inventory |
| `connect-src 'self' ipc: http://ipc.localhost` | model weights + wasm + traineddata + manifest fetches are all same-origin; `ipc:` / `http://ipc.localhost` is the Tauri v2 local IPC endpoint the core always needs (per the Tauri v2 CSP docs) | hwr/ocr clients; Tauri docs |
| `worker-src 'self' blob:` | pdf.js module worker (`/pdf.worker.min.mjs`); tesseract.js wraps its worker in a `blob:` URL (`new Worker(URL.createObjectURL(...))`, its default `workerBlobURL` behavior) | measured: both constructions occur |
| `media-src 'self' data: blob:` | audio clips play from `data:audio` payloads (`audioPayloadOf` accepts data URLs only); recorder takes may hand the player a blob | audio-notes.ts |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'none'` | nothing uses plugins, `<base>`, or forms (the auth/form stack was removed in the #206 audit remediation) | hardening floor |

Notable non-inclusions (deliberate): no `frame-src` (embed iframes of pasted
links are intentionally blocked — the local-first app renders audio and PDF
attachments natively), no `upgrade-insecure-requests` (the app never talks
HTTP to remote hosts), no remote origins anywhere.

The policy applies ONLY to the Tauri desktop shell (Tauri injects it into
the pages it serves); the web/PWA build is unchanged and keeps its
response-header hardening from the #206 audit. Unit tests pin the policy's
shape (`src/lib/__tests__/desktop-config.test.ts`, "desktop CSP" describe
block); the AppImage evidence is collected in the artifact verification log
below.

## Artifact verification log (independent re-checks)

Each release's desktop artifacts are re-verified by downloading them fresh
from the GitHub Release and re-running the checks the Desktop workflow
enforces — the same procedure introduced after the issue #164 glibc-floor
incident (v1.11.1 AppImage re-verified 2026-11-10).

### v1.13.0 (verified 2026-11-12)

Fresh download of `InfiniteNote_1.13.0_amd64.AppImage` from the release page
— 152,889,848 bytes, sha256
`bc5102ade5aad106c0413005d4a546b2d3a1ac9e4e87107a83b9a9af1464e5f3`:

| Check | Result |
|---|---|
| AppImage type-2 runtime | magic `41 49 02` at offset 8 — valid |
| FUSE-less extraction | `--appimage-extract` exits 0, full tree present |
| GLIBC floor (objdump, every bundled ELF) | 174 ELFs scanned, overall max **GLIBC_2.35** — set by the webkit stack (`libcairo.so.2`, `libjavascriptcoregtk-4.1.so.0`, `libwebkit2gtk-4.1.so.0` copied from the pinned ubuntu-22.04 runner); the main app binary requires at most **GLIBC_2.34**; nothing over the 2.35 floor |
| Embedded .desktop entry | Name=InfiniteNote, Icon=infinitenote, Categories=Office, Exec=infinitenote, Type=Application, StartupWMClass=infinitenote; icons at 32 / 128 / 256@2 / 512 px under `usr/share/icons/hicolor/` |
| versionCode parity | 230 / 1.13.0 consistent across `package.json`, `android-twa/app/build.gradle.kts` + `twa-manifest.json`, `src-tauri/Cargo.toml` + `tauri.conf.json`, and the F-Droid recipe (latest build block: versionName 1.13.0, versionCode 230, commit `v1.13.0`) |
| Handwriting assets in the bundle | all 10 vendored `public/hwr/` asset paths present in `usr/bin/infinitenote` — both trocr ONNX shards, the asyncify ORT wasm, and the 7 model/tokenizer JSONs. Tauri v2 embeds the whole `frontendDist` static export into the binary (no loose resources), so the model ships inside the app and nothing downloads at runtime (14 `/hwr/` references in the binary) |

Full GUI boot remains untestable in the bare verification sandbox (host
libEGL.so.1 absent — consistent with the v1.11.1 verification evidence). The
deb/rpm assets are present on the release (74,253,752 / 74,259,262 bytes);
the per-release verification targets the AppImage, the artifact the glibc
floor guards protect.

## Troubleshooting

### Building

- **`webkit2gtk-4.1 not found`** — the 4.1 dev package is required for Tauri v2
  (4.0 is not enough on newer distros).
- **Version mismatch** — `src-tauri/tauri.conf.json` and `Cargo.toml` carry the
  app version and are kept in sync with `package.json` by the release bump PR;
  the unit tests in `src/lib/__tests__/desktop-config.test.ts` enforce it.
- **Static export fails** — run `bun run build:desktop` alone to see the Next
  error; the desktop export must stay a pure client bundle (no API routes).

### Running a downloaded AppImage

- **Double-click does nothing** — the download lost its executable bit.
  `chmod +x InfiniteNote_*_amd64.AppImage` first (GNOME Files: right-click →
  Properties → Permissions → *Allow executing file as program*). If it still
  fails, launch from a terminal to see the real error.
- **`error loading libfuse.so.2`** — install FUSE 2 (`libfuse2` on
  Debian/Ubuntu, `fuse-libs` on Fedora) or run without FUSE:
  `./InfiniteNote_*_amd64.AppImage --appimage-extract-and-run`.
- **Loader error mentioning `GLIBC_x.xx`** — the distro is older than the
  supported floor (glibc 2.35, i.e. Ubuntu 22.04 / Debian 12 or newer). The
  AppImage cannot run there; use the PWA in a browser instead.
- **Where is my data?** — the desktop app is the same UI as the PWA, with data
  in the webview profile under `~/.local/share/infinitenote/` (Tauri app data
  dir). Uninstalling removes nothing until you delete that directory.
