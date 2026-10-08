---
name: frontend-performance
appliesTo: ["frontend-engineer","ux-ui-designer","reviewer"]
capabilities: []
keywords: ["core web vitals","lcp","cls","inp","bundle size","lighthouse","page speed","web performance","ssr","rendering","time to interactive"]
---
# Frontend performance

Budget Core Web Vitals (LCP, INP, CLS) and bundle size up front. Ship less JavaScript: code-split by route, lazy-load below the fold, tree-shake, avoid heavy dependencies. Optimise the critical rendering path (preload key resources, inline critical CSS, defer the rest), serve responsive modern image formats with dimensions set, cache static assets immutably with content hashes and use a CDN. Avoid layout thrash and long main-thread tasks; virtualise long lists; memoise deliberately. Evidence: Lighthouse/WebPageTest numbers before and after, bundle analyser output, and a CI budget that fails on regression.
