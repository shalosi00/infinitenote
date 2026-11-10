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
