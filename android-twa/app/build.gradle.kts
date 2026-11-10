plugins {
    id("com.android.application")
}

// Release signing reads android-twa/keystore.properties (git-ignored) so the
// keystore password never lands in version control. Without the file the
// project still configures; the release build simply isn't signed.
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = java.util.Properties().apply {
    if (keystorePropsFile.exists()) {
        keystorePropsFile.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.infinitenote.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.infinitenote.app"
        minSdk = 23
        targetSdk = 35
        // Kept in lockstep with the web app version (package.json) — the
        // release bump PR updates both, unit tests pin the parity.
        versionCode = 211
        versionName = "1.11.1"
    }

    signingConfigs {
        create("release") {
            if (keystorePropsFile.exists()) {
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePropsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // WebViewAssetLoader: serves the bundled static export on the reserved
    // https://appassets.androidplatform.net origin (issue #64).
    implementation("androidx.webkit:webkit:1.12.1")
}

// Sync the static web export (repo-root out/, produced by
// `bun run build:desktop`) into the APK assets. Skips gracefully when the
// export is absent — e.g. a source-only F-Droid build without the bun
// toolchain — in which case BundledSiteActivity falls back to the live PWA
// origin at runtime.
val syncWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../out"))
    into(file("src/main/assets/www"))
    onlyIf { rootProject.file("../out/index.html").exists() }
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }
