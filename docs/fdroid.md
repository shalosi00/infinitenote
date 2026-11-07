# F-Droid distribution (Android)

InfiniteNote can ship on F-Droid, the free-software Android store. This
runbook covers the packaging recipe (`packaging/fdroid/com.infinitenote.app.yml`),
how to verify it locally, and how to submit it. It complements
[android-twa.md](android-twa.md) (the TWA build itself) and
[flathub.md](flathub.md) (the Linux equivalent).

## What the recipe declares

`com.infinitenote.app.yml` is an
[F-Droid build metadata](https://f-droid.org/docs/Build_Metadata_Reference/)
file that tells fdroidserver everything it needs:

| Field | Value | Why |
|---|---|---|
| `License` | `MIT` | must match `LICENSE` and the AppStream metainfo |
| `RepoType` / `Repo` | `git` / this repository | fdroidserver clones and builds from source |
| `Builds[].subdir` | `android-twa` | the checked-in Gradle project (issue #45) |
| `Builds[].gradle` | `yes` | fdroidserver runs the release assemble itself |
| `Builds[].commit` | `v1.6.0` … | the release tag — no floating branches |

Version codes follow the repo-wide scheme **major×100 + minor×10 + patch**
(`1.6.0 → 160`), shared with `android-twa/twa-manifest.json`,
`android-twa/app/build.gradle.kts` and the assetlinks generator. All three
are kept in lockstep and pinned by `src/lib/__tests__/fdroid-config.test.ts`.

## Step 1 — Validate the recipe

The checker parses the YAML and enforces every invariant (required fields,
version scheme, ascending builds, tag refs, no placeholders):

```sh
bun scripts/fdroid-check.mjs                     # human-readable report
bun scripts/fdroid-check.mjs --json              # machine-readable
```

The same checks run as unit tests on every PR, so a broken recipe cannot
merge.

## Step 2 — Test-build locally with fdroidserver

```sh
# once: install fdroidserver (Debian/Ubuntu) + JDK 17 + the Android SDK
sudo apt install fdroidserver openjdk-17-jdk

git clone https://gitlab.com/fdroid/fdroiddata.git
cp packaging/fdroid/com.infinitenote.app.yml fdroiddata/metadata/
cd fdroiddata && fdroid build --verbose --server com.infinitenote.app
```

`fdroid build` clones the repo at the tag declared in `Builds[].commit`,
enters `android-twa/`, and runs the Gradle release assemble in an isolated
environment. Expect the first run to take a while (SDK + Gradle downloads).

A faster smoke build without fdroidserver (same Gradle invocation):

```sh
cd android-twa && gradle assembleRelease
# output: app/build/outputs/apk/release/app-release-unsigned.apk
```

## Step 3 — Keep versions in lockstep on every release

When the release flow bumps the version (say 1.6.0 → 1.7.0):

1. `package.json`, `twa-manifest.json` and `app/build.gradle.kts` are bumped
   (existing release-flow steps).
2. Append a **new** `Builds` entry to `com.infinitenote.app.yml` — never
   edit old entries; older releases must stay buildable:

   ```yaml
     - versionName: 1.7.0
       versionCode: 170
       commit: v1.7.0
       subdir: android-twa
       gradle:
         - yes
   ```

3. Run `bun scripts/fdroid-check.mjs` — it fails loudly if the new entry
   violates the scheme or ordering.

## Step 4 — Submit to F-Droid

1. Fork <https://gitlab.com/fdroid/fdroiddata>, add the metadata file under
   `metadata/com.infinitenote.app.yml`, and open a merge request.
2. The `fdroidbot` CI on the MR runs the same metadata linting and a build
   attempt — keep our checker green first to save round-trips.
3. A reviewer checks the anti-features declaration, source purity and build
   reproducibility. Respond in the MR thread.

## Policy notes (read before submitting)

- **Source purity**: the Gradle build must not download prebuilt binaries
  outside the declared dependency repositories. The TWA scaffold builds
  clean; if a dependency ever ships blobs, add a `sudo:`/clean-recipe
  workaround and document it here.
- **Offline behavior (issue #64, shipped)**: the APK bundles the static
  web export (`bun run build:desktop` output) and serves it through
  `WebViewAssetLoader` — airplane-mode first run renders the app, no network
  needed. The deployed PWA origin is only a runtime fallback when the assets
  were not synced into the build. Release builds intended for F-Droid MUST
  run `bun run build:desktop` before `gradle assembleRelease` so the assets
  are present.
- **Tracking**: none. The bundled app makes no network calls at all; the
  fallback path only loads the app's own PWA origin. Declare no
  anti-features and keep it that way.

## Troubleshooting

- `fdroid build` fails cloning: the tag must exist on the `Repo` URL —
  verify `git ls-remote --tags origin v1.6.0` before submitting.
- `versionCode must be greater` in the checker: you inserted the new build
  above an older one; keep `Builds` ascending.
- Metadata lint rejects the description: keep Markdown minimal (lists are
  fine, raw HTML is not) and avoid URLs with tracking parameters.
