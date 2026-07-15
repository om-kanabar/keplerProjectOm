# Regular Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first complete Regular Mode overview in the existing Habitat console.

**Architecture:** Keep the existing React/Vite shell and loader. Add typed view models and normalization helpers in `web/src/dashboard-model.ts`, keep preview fixtures in `web/src/preview.ts`, and make `web/src/main.tsx` compose a Regular Mode overview from those models. Future modes remain represented by a small mode registry but are not implemented.

**Tech Stack:** React 19, TypeScript, Vite, Bun tests, existing CSS.

## Global Constraints

- Preserve the existing loading wave, one-second minimum duration, typography, GitHub commit link, and relative commit time.
- Only the Regular Mode overview may contain OS personality; no AI chat or personality in operational content.
- Keep the existing dark Habitat visual identity and avoid gradients, glassmorphism, neon, and telemetry-heavy graphs.
- Keep mock data separate from UI components and expose explicit loading, empty, error, and disconnected states.
- Do not change unrelated backend behavior or discard existing uncommitted work.

### Task 1: Regular Mode models and fixtures

**Files:**
- Modify: `web/src/dashboard-model.ts`
- Modify: `web/src/preview.ts`
- Test: `tests/dashboard-model.test.ts`

**Interfaces:**
- `DashboardMode = "regular" | "display" | "info"`
- `RegularModeSnapshot`, `ResourceSummary`, `HabitatAlertView`, `ModuleSummary`, `ActiveWorkItem`, and `ActivityEvent` exported from `dashboard-model.ts`.
- `normalizeStatusSnapshot(input: unknown): RegularModeSnapshot` returns a safe snapshot with empty arrays and `disconnected` flags where optional data is absent.
- `pickOperatingLine(index?: number): string` returns one line from a fixed OS copy list.

- [ ] **Step 1: Write failing model tests** for the mode union, OS line selection, alert severity normalization, module status mapping, resource percentages, and hidden empty work categories.
- [ ] **Step 2: Run focused tests** with `bun test tests/dashboard-model.test.ts`; confirm failures for missing exports.
- [ ] **Step 3: Implement typed models and normalization** without importing React or fetching inside the model file.
- [ ] **Step 4: Add preview fixtures** covering healthy resources, one warning alert, one under-construction module, active construction, and recent events.
- [ ] **Step 5: Run focused tests again** and confirm they pass.

### Task 2: Regular Mode UI composition

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `tests/dashboard-layout.test.ts`

**Interfaces:**
- `Dashboard` remains the mounted root component.
- `RegularModeOverview` receives a typed `RegularModeSnapshot` and renders the overview sections without owning API normalization.

- [ ] **Step 1: Add layout tests** asserting Regular Mode is the default, all required section labels exist, no chat UI exists, and Display/Info are not rendered as implemented panels.
- [ ] **Step 2: Run the layout tests** and confirm failures against the current Display/Active/Info implementation.
- [ ] **Step 3: Replace the active panel with Regular Mode** using a single refresh pipeline that requests `/status`, `/alerts`, and `/construction/status`, preserving registration and auth states.
- [ ] **Step 4: Add semantic sections** for alerts, resources, modules, conditional active work, and recent activity. Use `<details>` for supporting numbers and keep controls out of the overview.
- [ ] **Step 5: Add loading, error, disconnected, and intentional empty states** with retry behavior.
- [ ] **Step 6: Run the focused layout and model tests** and confirm they pass.

### Task 3: Regular Mode visual system and accessibility

**Files:**
- Modify: `web/src/dashboard.css`
- Modify: `tests/dashboard-layout.test.ts`

- [ ] **Step 1: Add CSS assertions** for focus-visible styles, reduced-motion handling, status labels that do not rely on color, and the existing font/accent identity.
- [ ] **Step 2: Implement the overview grid** with calm spacing, meaning-first resource cards, compact module rows, alert priority, and responsive stacking.
- [ ] **Step 3: Add visible status treatments** for informational, warning, critical, online, standby, degraded, offline, and under-construction states.
- [ ] **Step 4: Add `@media (prefers-reduced-motion: reduce)`** to disable nonessential transitions while preserving the loader behavior.
- [ ] **Step 5: Run layout tests and inspect the local page** at desktop and narrow widths.

### Task 4: Verification and handoff

**Files:**
- Modify only files required by failing checks.

- [ ] **Step 1: Run `bun run check`** and resolve TypeScript errors introduced by the Regular Mode work.
- [ ] **Step 2: Run `bun test`** and resolve only regressions caused by this implementation.
- [ ] **Step 3: Run `bun run build:dashboard`** and verify the production bundle succeeds.
- [ ] **Step 4: Reload the local prototype** and verify the loader, Regular Mode overview, GitHub metadata, keyboard focus, no-alert state, and preview data.
- [ ] **Step 5: Record screenshots or concise visual descriptions** and document remaining Display Mode, Info Mode, backend, and AI integration work.
