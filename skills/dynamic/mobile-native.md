---
name: mobile-native
appliesTo: ["tech-lead","mobile-engineer","ux-ui-designer","reviewer","qa-engineer"]
capabilities: ["mobile"]
keywords: ["offline","push notification","background","battery","app store","play store","native"]
---
# Mobile native concerns

Design for intermittent connectivity (offline-first sync, conflict handling, retry queues), constrained battery/memory/CPU and lifecycle interruptions (backgrounding, process death, rotation, low-memory). Persist state across process death; keep work off the main/UI thread; throttle background work and respect OS limits. Store credentials in the platform keystore/keychain, pin or validate transport security, and avoid logging personal data. Plan permissions as just-in-time with graceful denial. Handle app updates and data migrations, and version the API for old clients. Test on low-end devices and slow networks.
