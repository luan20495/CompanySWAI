---
name: android
appliesTo: ["mobile-engineer","reviewer","qa-engineer"]
capabilities: []
keywords: ["android","kotlin","jetpack","compose","gradle","play store","apk","aab"]
---
# Android

Kotlin with coroutines/Flow; Jetpack Compose or well-structured Views; architecture with ViewModel + repository and unidirectional state. Respect lifecycle (no Context leaks, collect flows lifecycle-aware), use WorkManager for deferrable background work, Room for local data with tested migrations, Hilt/DI for testability. Handle runtime permissions, scoped storage and Doze/background limits. Enable R8/ProGuard with keep rules tested on release builds; keep the target SDK current. Verification: unit tests (JVM), instrumented/UI tests, lint, and a release-build smoke test.
