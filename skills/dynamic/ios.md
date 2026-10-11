---
name: ios
version: 1.0.0
description: Native iOS engineering rules: Swift concurrency, lifecycle, permissions and App Store delivery.
appliesTo: ["mobile-engineer","reviewer","qa-engineer"]
capabilities: []
keywords: ["ios","swift","swiftui","uikit","xcode","app store","iphone","ipad"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
riskLevel: low
outputContract: ["Evidence"]
---
# iOS

Swift with structured concurrency (async/await, actors for shared state); SwiftUI where suitable, UIKit interop where needed; clear separation of view, state and services. Respect the app lifecycle and background execution limits, keep the main thread free, avoid retain cycles (weak/unowned captures), store secrets in the Keychain, use App Transport Security and justified entitlements/privacy manifests. Handle permission prompts and denial, Dynamic Type, VoiceOver and dark mode. Verification: XCTest unit tests, UI tests, static analysis, and a release-configuration build with the App Store rules in mind.
