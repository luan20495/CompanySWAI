---
name: flutter
appliesTo: ["mobile-engineer","reviewer","qa-engineer"]
capabilities: []
keywords: ["flutter","dart"]
tags: ["flutter","dart"]
---
# Flutter

Keep widgets small and const where possible; separate presentation from state (Riverpod/Bloc/Provider) and domain logic from widgets so it is unit-testable. Avoid rebuild storms (scope listeners, use keys and selectors), keep heavy work off the UI isolate (compute/isolates), and dispose controllers/streams. Platform channels need typed contracts and error mapping; plugins are pinned and audited. Test pyramid: unit, widget (golden where stable) and integration tests; run `flutter analyze` with strict lints and `dart format` in CI. Check release-mode performance (profile mode, jank), app size and per-platform permission setup.
