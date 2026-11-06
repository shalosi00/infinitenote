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

(The `Desktop` GitHub Actions workflow runs exactly this list on `ubuntu-latest`.)

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

## Release checklist (desktop artifacts)

1. Tag `vN.N.0` on the release commit (release flow does this).
2. Wait for the `Desktop` workflow on that tag to finish; the artifacts appear
   on the GitHub Release automatically.
3. For Flathub, take the release AppImage: see
   [packaging/flatpak](../packaging/flatpak) and
   [docs/flathub.md](flathub.md) (`node scripts/flatpak-extradata.mjs` pins the
   checksum into the flatpak manifest).

## Troubleshooting

- **`webkit2gtk-4.1 not found`** — the 4.1 dev package is required for Tauri v2
  (4.0 is not enough on newer distros).
- **Version mismatch** — `src-tauri/tauri.conf.json` and `Cargo.toml` carry the
  app version and are kept in sync with `package.json` by the release bump PR;
  the unit tests in `src/lib/__tests__/desktop-config.test.ts` enforce it.
- **Static export fails** — run `bun run build:desktop` alone to see the Next
  error; the desktop export must stay a pure client bundle (no API routes).
