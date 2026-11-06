# InfiniteNote Android TWA scaffold

Reference Gradle project for the InfiniteNote **Trusted Web Activity** (TWA):
a thin Android wrapper that runs the deployed PWA fullscreen in a Chrome
Custom Tab with no browser UI, verified against the web app via Digital Asset
Links.

**Read [docs/android-twa.md](../docs/android-twa.md) before building** — it
covers the two supported paths:

1. **bubblewrap (recommended)** — `bunx @bubblewrap/cli init` consumes
   `twa-manifest.json` and generates a full buildable project on your machine
   (it also provisions the JDK/Android SDK on first run).
2. **This scaffold** — `settings.gradle.kts` / `build.gradle.kts` /
   `app/build.gradle.kts` / `AndroidManifest.xml` give you the complete
   checked-in structure; open it in Android Studio, add your keystore (see
   `keystore.properties` handling in `app/build.gradle.kts`) and build the
   release APK.

The wrapper must be verifiable by the web app: after signing, generate
`public/.well-known/assetlinks.json` with

```sh
bun scripts/generate-assetlinks.mjs --package com.infinitenote.app --fingerprint <sha256>
```

Version fields (`appVersionName` / `appVersionCode` here, `versionName` /
`versionCode` in `app/build.gradle.kts`) track the web app version — they are
bumped by the release flow and pinned by unit tests
(`src/lib/__tests__/assetlinks.test.ts` + `version-parity` tests).
