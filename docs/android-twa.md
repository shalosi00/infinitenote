# Android distribution: Trusted Web Activity (TWA)

InfiniteNote reaches Android in two supported ways today: as the installable
PWA (Chrome → *Install app*), and as a **Trusted Web Activity APK** — a thin
native wrapper that runs the deployed PWA fullscreen with no browser chrome,
verified against the web app through Digital Asset Links. This document is the
complete runbook for the TWA path; the scaffold lives in
[`android-twa/`](../android-twa).

## How the pieces fit

| Piece | Path | Purpose |
|---|---|---|
| bubblewrap template | `android-twa/twa-manifest.json` | Input for `@bubblewrap/cli init` (package, host, icons, colors, versions) |
| Gradle scaffold | `android-twa/*.gradle.kts`, `app/build.gradle.kts` | Buildable reference project for Android Studio / manual Gradle builds |
| Manifest | `android-twa/app/src/main/AndroidManifest.xml` | Single `LauncherActivity` (androidbrowserhelper), deep-link intent filter |
| assetlinks generator | `scripts/generate-assetlinks.mjs` + `src/lib/assetlinks.ts` | Writes `public/.well-known/assetlinks.json` from package + SHA-256 fingerprint |

## Prerequisites

- Bun ≥ 1.2 (runs the generator and bubblewrap via `bunx`)
- JDK 17+ (bubblewrap provisions one on first run) — the repo's CI uses Java 21
- Android SDK: bubblewrap downloads it on first run (`@bubblewrap/cli init`),
  or install Android Studio / `sdkmanager` manually
- A deployed PWA host (any static or Node host; the checked-in default is
  `https://shalosi00.github.io/infinitenote/` — change `twa-manifest.json`,
  the AndroidManifest deep-link filter and the DEFAULT_URL meta-data together
  if you self-host elsewhere; unit tests pin their consistency)

## Step 1 — Deploy the PWA

The TWA shows exactly what the browser shows: deploy `bun run build` output to
your host and confirm the site loads, is installable, and serves
`manifest.webmanifest` at the root scope.

## Step 2 — Init the TWA project (bubblewrap)

```sh
bunx @bubblewrap/cli init --manifest=https://shalosi00.github.io/infinitenote/manifest.webmanifest
```

Bubblewrap asks for a package id (`com.infinitenote.app`) and signing key, then
generates a buildable Gradle project from the webmanifest. Checked into
`android-twa/twa-manifest.json` is a pre-filled template with the same values
(colors mirror `public/manifest.webmanifest`, icons come from `/icons/`) —
copy it over the generated one to keep the repo in sync with what you build.

## Step 3 — Signing

Bubblewrap stores its keystore in `~/.bubblewrap/android/keystore.jks`. For a
release you control end-to-end, generate your own upload key:

```sh
keytool -genkeypair -v -keystore android-twa/upload-keystore.jks \
  -alias infinitenote -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android-twa/keystore.properties` (**git-ignored, never commit it**):

```properties
storeFile=upload-keystore.jks
storePassword=********
keyAlias=infinitenote
keyPassword=********
```

`app/build.gradle.kts` reads this file for the `release` signing config. Print
the certificate fingerprint you will need in Step 5:

```sh
keytool -list -v -keystore android-twa/upload-keystore.jks -alias infinitenote | grep SHA-256
```

## Step 4 — Build the APK

```sh
# bubblewrap path
bunx @bubblewrap/cli build

# gradle scaffold path (Android Studio or a machine with the SDK)
cd android-twa && ./gradlew :app:assembleRelease
```

Output: `app-release-signed.apk` (bubblewrap) or
`app/build/outputs/apk/release/app-release.apk` (Gradle). Install it on a
device: `adb install app-release-signed.apk`.

## Step 5 — Make the app verifiable (assetlinks.json)

Without this step the wrapper falls back to a Custom Tab with a URL bar.

```sh
bun scripts/generate-assetlinks.mjs \
  --package com.infinitenote.app \
  --fingerprint "<SHA-256 from step 3>" \
  --out public/.well-known/assetlinks.json
```

Commit the generated file and redeploy. Verify Google can see the statement:

```
https://digitalassetlinks.googleapis.com/v1/statements:list
  ?web.site=https://shalosi00.github.io
  &statement.android.package_name=com.infinitenote.app
```

The response should contain `"resolved": true`. On-device:
`adb shell pm verify-app-links --re-verify com.infinitenote.app`.

## Step 6 — Distribution channels

- **Direct APK** (the point of this runbook): publish the signed APK on the
  GitHub Release and let users sideload it — no Play review, works on any
  Android 6+ device with Chrome.
- **Google Play**: upload the same artifact via the Play Console (PWA/TWA
  category), where the *release* certificate (Play App Signing) — not your
  upload key — must appear in assetlinks.json. Play shows the release SHA-256
  under *Setup → App signing*; regenerate assetlinks.json with that value for
  the production host.
- **F-Droid**: tracked in the roadmap backlog; needs a reproducible build
  recipe (see docs/ROADMAP.md).

## Version discipline

`package.json`, `android-twa/twa-manifest.json` (`appVersionName`/`Code`) and
`android-twa/app/build.gradle.kts` (`versionName`/`versionCode`) carry the same
version; the release bump PR updates all of them and unit tests
(`src/lib/__tests__/android-config.test.ts`) fail if they drift.

## Troubleshooting

- **App opens with a URL bar** — assetlinks.json is missing/wrong: check the
  digitalassetlinks URL above (deployment cache!), and confirm the fingerprint
  is the SHA-256 of the *installed* APK's certificate.
- **`Failed to verify host`** — the manifest host, startUrl and the
  AndroidManifest deep-link filter must all point at the same deployed host.
- **bubblewrap hangs on SDK setup** — it downloads the SDK on first run; set
  `ANDROID_HOME` if you already have one.
- **Play Console rejects the app** — Play App Signing replaces the
  certificate; use the release fingerprint from Play, not your upload key.
