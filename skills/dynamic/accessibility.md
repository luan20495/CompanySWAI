---
name: accessibility
version: 1.0.0
description: Accessibility (WCAG 2.2 AA) rules for building and reviewing user interfaces.
appliesTo: ["ux-ui-designer","frontend-engineer","mobile-engineer","reviewer","qa-engineer"]
capabilities: []
keywords: ["accessibility","a11y","wcag","screen reader","aria","assistive","public","customer","consumer","storefront","citizen"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
riskLevel: low
outputContract: ["Evidence"]
---
# Accessibility

Target WCAG 2.2 AA. Use semantic elements/native controls before ARIA; every interactive element is keyboard reachable with a visible focus order and indicator; provide text alternatives, programmatic labels and error associations for forms; contrast at least 4.5:1 for text and 3:1 for UI components; never convey information by colour alone; support zoom/reflow and reduced motion; announce dynamic changes (live regions) and manage focus on route/modal changes. Mobile: accessibility labels/traits, dynamic type, minimum touch targets (44-48dp). Evidence: automated checks (axe/lint) plus a manual keyboard and screen-reader pass listed in QA.
