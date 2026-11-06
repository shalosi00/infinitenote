# Flathub distribution (Linux)

The Linux desktop app ships as a Tauri-built AppImage attached to GitHub
releases (see [docs/desktop.md](desktop.md)). This runbook publishes that same
artifact on Flathub through flatpak-builder's `extra-data` mechanism. The
packaging recipe lives in [`packaging/flatpak/`](../packaging/flatpak):

| File | Purpose |
|---|---|
| `com.infinitenote.app.metainfo.xml` | AppStream metainfo (id, description, releases, screenshots, categories) |
| `com.infinitenote.app.json` | flatpak-builder manifest (freedesktop 24.08 runtime, extra-data AppImage, launcher/icons install) |
| `com.infinitenote.app.desktop` | Desktop launcher installed into the flatpak |
| `infinitenote-wrapper.sh` | `infinitenote` command — extract-and-run the AppImage (no FUSE inside the sandbox) |
| `icons/com.infinitenote.app.{png,svg}` | hicolor icons installed into the flatpak |

## Why extra-data

Building the full Rust/Tauri toolchain inside the flatpak sandbox requires
vendoring hundreds of crates (`flatpak-cargo-generator`) and would double the
CI surface. The Flathub build instead pulls the already-built, already-tested
release AppImage via `extra-data`, which needs its exact **URL, SHA-256 and
byte size** — values only knowable after the release artifacts exist. The
`scripts/flatpak-extradata.mjs` tool fetches them and pins the manifest.

## Step 1 — Release artifacts exist

The `Desktop` workflow builds the AppImage on every `v*` tag and attaches it
to the GitHub Release. Confirm on
`https://github.com/shalosi00/infinitenote/releases/tag/vX.Y.Z` (exactly one
`*.AppImage` asset).

## Step 2 — Pin the checksum

```sh
bun scripts/flatpak-extradata.mjs --tag vX.Y.Z            # downloads + pins
bun scripts/flatpak-extradata.mjs --tag vX.Y.Z --check    # verify only
```

The tool rewrites `url`, `sha256` and `size` in
`packaging/flatpak/com.infinitenote.app.json`, prints the checksum, and fails
loudly if the tag has no (or several) AppImage assets. Commit the pinned
manifest.

## Step 3 — Validate locally

```sh
# on a machine with flatpak + flatpak-builder
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/com.infinitenote.app.json
flatpak run com.infinitenote.app
```

Validate the metainfo too (appstream):

```sh
appstreamcli validate packaging/flatpak/com.infinitenote.app.metainfo.xml
```

The unit tests in `src/lib/__tests__/packaging-config.test.ts` already pin the
metainfo/manifest contract (well-formed XML, extra-data pinning state, source
files present) so the recipe cannot drift silently.

## Step 4 — Submit to Flathub

1. Fork `flathub/flathub` on GitHub.
2. Copy the packaging directory to a new branch as
   `com.infinitenote.app/com.infinitenote.app.json` (+ metainfo, desktop,
   wrapper, icons).
3. Open a pull request against `flathub/flathub`. Reviewers check: metainfo
   completeness (screenshots, license, releases), app id reversibility, and
   that extra-data checksums match.
4. Respond to review feedback; once approved, the app builds on Flathub's
   infrastructure and goes live after a human sign-off.

## Step 5 — Update flow

Every minor release: bump the version in the metainfo `<releases>` block,
re-run `scripts/flatpak-extradata.mjs --tag vX.Y.Z`, and open an update PR on
the Flathub repo.

## Troubleshooting

- **`error: expected exactly one .AppImage asset`** — the Desktop workflow
  hasn't finished for that tag yet, or an old artifact lingers on the release;
  check the Actions run for the tag.
- **AppImage fails to start inside flatpak** — the wrapper uses
  `--appimage-extract-and-run`; confirm the extra-data filename is exactly
  `InfiniteNote.AppImage` (the wrapper path is fixed).
- **Flathub review asks for a screenshot** — screenshots must be 16:9 with at
  least one `type="default"`; the metainfo references the repo's
  `assets/screenshots/light.png` (real repo asset, updated with the UI).
