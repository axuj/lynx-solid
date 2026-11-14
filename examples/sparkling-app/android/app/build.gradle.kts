plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.kapt)
}

android {
    namespace = "com.example.sparkling.go"
    compileSdk = 34
    buildToolsVersion = "34.0.0"

    defaultConfig {
        applicationId = "com.lynxsolid.demo"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters.addAll(listOf("armeabi-v7a", "arm64-v8a"))
        }
        // Local-only signing for release benchmarking / sideloading. The debug
        // key is NOT a publishing key — swap in a real keystore before shipping.
        buildTypes {
            release {
                // Same key as debug so `installDebug` and this build replace
                // each other on a test device.
                signingConfig = signingConfigs.getByName("debug")
                isMinifyEnabled = false
                proguardFiles(
                    getDefaultProguardFile("proguard-android-optimize.txt"),
                    "proguard-rules.pro",
                )
            }
        }

        compileOptions {
            sourceCompatibility = JavaVersion.VERSION_17
            targetCompatibility = JavaVersion.VERSION_17
        }
        kotlinOptions {
            jvmTarget = "17"
        }

        // Default integrate assets from dist; switch to native assets when env is set
        val useNativeAssets =
            System.getenv("SPARKLING_USE_NATIVE_ASSETS")?.equals("true", ignoreCase = true) ?: false
        sourceSets {
            getByName("main").apply {
                if (useNativeAssets) {
                    // Use native assets directory (used in --copy mode)
                    assets.setSrcDirs(listOf("src/main/assets"))
                } else {
                    // Default: use dist directly; no copy required
                    assets.setSrcDirs(listOf("../../dist"))
                }
            }
        }
    }

    dependencies {
        implementation(libs.androidx.core.ktx)
        implementation(libs.androidx.appcompat)
        testImplementation(libs.junit)
        androidTestImplementation(libs.androidx.junit)
        androidTestImplementation(libs.androidx.espresso.core)

        implementation("com.tiktok.sparkling:sparkling:2.0.1")
        implementation("com.tiktok.sparkling:sparkling-method:2.0.1")
        implementation("com.squareup.okhttp3:okhttp:4.9.0")

        implementation(libs.fresco)
        implementation(libs.fresco.animated.gif)
        implementation(libs.fresco.animated.webp)
        implementation(libs.fresco.webp.support)
        implementation(libs.fresco.animated.base)

//    kapt(libs.lynx.processor)

        // BEGIN SPARKLING AUTOLINK
        listOf(
            project(":sparkling-navigation")
        ).forEach { dep -> add("implementation", dep) }
        // END SPARKLING AUTOLINK
    }
}
