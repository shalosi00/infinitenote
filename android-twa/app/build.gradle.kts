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
        versionCode = 180
        versionName = "1.8.0"
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
    // TWA: LauncherActivity + trusted-web-activity plumbing + Digital Asset
    // Links verification.
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
