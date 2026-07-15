# Regular Mode Design

## Goal

Make the existing Habitat console's primary screen a calm, complete Regular Mode overview for operating the habitat.

## Approved direction

Regular Mode will be the first implemented mode and the default operator view. It will preserve the existing dark Habitat visual identity, loading gate, and GitHub build metadata. Display and Info remain future mode identifiers only; they will not gain new screens in this pass.

The overview answers, in order: whether the habitat is healthy, whether action is needed, which resources matter, which modules are operating, what work is active, and what happened recently.

## OS voice

Only the overview greeting may use personality. It will combine the current time-appropriate greeting with one randomly selected dry habitat/environment pun, for example “Good afternoon, inhabitants. Conditions outside remain unfavorable for humans.” Alerts, module status, active work, and activity history remain operational and literal.

The pun source is a small deterministic list in the presentation model so it can be tested without making the rest of the UI random. A refresh may select another line; no persistent personality or chatbot is introduced.

## Architecture

`web/src/dashboard-model.ts` owns typed Regular Mode models, API-to-view-model normalization, status interpretation, and the bounded OS copy list. `web/src/preview.ts` owns mock Regular Mode data. `web/src/main.tsx` owns data loading, mode selection, and focused UI composition. `web/src/dashboard.css` keeps the existing palette and adds overview hierarchy, cards, disclosure, and responsive behavior.

The live adapter will consume existing `/status`, `/alerts`, and `/construction` endpoints when available, while treating optional endpoint failures as disconnected/empty data rather than making the overview unusable. The UI explicitly represents loading, empty, error, and disconnected states.

## Regular Mode sections

- Header: greeting, overall status, refresh/unregister actions.
- Alerts: critical/warning/informational summaries, with an intentional no-alert state.
- Resources: meaning-first cards for power, battery, solar, and reserve.
- Modules: compact status cards using online, standby, degraded, offline, and under-construction labels.
- Active work: construction, research, maintenance, and missions; empty categories are hidden.
- Recent activity: operational event feed with an adapter-ready event model.

Details use native disclosure panels and short supporting values. Graphs, diagnostics, forecasts, and controls stay out of Regular Mode.

## Accessibility and verification

Use semantic headings, labeled sections, keyboard-accessible disclosure, visible focus states, non-color status labels, and reduced-motion-safe CSS. Add model tests for normalization and OS copy, layout tests for Regular Mode sections and absence of chat, then run type checking, the full test suite, and the production dashboard build.
