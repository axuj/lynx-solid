import org.gradle.api.tasks.compile.JavaCompile
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.jvm.toolchain.JavaToolchainService
import org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.kapt) apply false
}

// Enforce a shared JDK version for all Android subprojects
val targetJavaVersion = JavaLanguageVersion.of(17)
val forcedKotlinVersion = "1.8.10"
// AGP 7.4 defaults to Build Tools 30.0.3 when a module does not pin a version
// (sparkling-navigation, for example). Only 34.0.0 is installed here, so the
// whole build is pinned to it instead of downloading a second copy.
val forcedBuildToolsVersion = "34.0.0"

subprojects {
    plugins.withId("com.android.library") {
        extensions.configure<com.android.build.api.dsl.LibraryExtension> {
            buildToolsVersion = forcedBuildToolsVersion
        }
    }
    plugins.withId("com.android.application") {
        extensions.configure<com.android.build.api.dsl.ApplicationExtension> {
            buildToolsVersion = forcedBuildToolsVersion
        }
    }

    val javaToolchains = extensions.findByType(JavaToolchainService::class.java)
    if (javaToolchains != null) {
        tasks.withType<JavaCompile>().configureEach {
            javaCompiler.set(
                javaToolchains.compilerFor {
                    languageVersion.set(targetJavaVersion)
                },
            )
        }
    }

    plugins.withId("org.jetbrains.kotlin.android") {
        extensions.configure<KotlinAndroidProjectExtension> {
            jvmToolchain(17)
        }
    }

    // Align Kotlin deps to avoid pulling newer Kotlin metadata with older AGP
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == "org.jetbrains.kotlin") {
                useVersion(forcedKotlinVersion)
                because("Keep Kotlin libs aligned with Kotlin plugin/AGP")
            }
        }
    }
}
