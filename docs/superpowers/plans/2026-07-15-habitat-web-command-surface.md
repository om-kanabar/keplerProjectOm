# Habitat Web Command Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the approved user-facing Habitat CLI commands in the existing web dashboard, excluding auth, developer tick controls, and `resource add`.

**Architecture:** Extend the local Habitat API with typed routes that delegate to existing domain modules, then add grouped sidebar views in the React dashboard. Keep the existing request/loading/error patterns, fullscreen detail overlays, and overview-only personality copy.

**Tech Stack:** Bun, TypeScript, Hono/local Habitat API, React, Vitest, CSS.

## Global Constraints

- Preserve the existing fullscreen dashboard and overview-only personality behavior.
- Do not expose auth commands, tick/developer controls, or `resource add`.
- Use local Habitat API routes; do not shell out from browser code.
- Gate delete, construction cancel, and unregister behind confirmation.
- Damaged modules remain read-only.
- Use loading dots and inline retryable errors.

---

### Task 1: Inventory the existing API and add route contracts

**Files:**
- Inspect: `src/server/*`, `src/api-client.ts`, `src/commands.ts`, domain modules under `src/`
- Modify: existing local API router and API client files
- Test: `tests/*api*.test.ts` or a new focused API route test

- [ ] Write failing tests asserting route shapes for status, catalogs, construction, inventory, crew, EVA, alerts, world, health, heartbeat, summary, unlocks, connect, and unregister.
- [ ] Run the focused API test and confirm missing-route failures.
- [ ] Add typed route handlers that call existing domain functions; keep auth and tick routes absent.
- [ ] Add matching client methods with explicit request/response types.
- [ ] Run the focused API tests and existing server tests.
- [ ] Commit: `feat: expose habitat web command routes`.

### Task 2: Add grouped navigation and shared view state

**Files:**
- Modify: `web/src/main.tsx`, `web/src/dashboard.css`
- Test: `tests/dashboard-layout.test.ts`

- [ ] Add failing assertions for all approved groups and assert excluded labels (`auth`, `tick`, `resource add`) are absent.
- [ ] Implement grouped sidebar entries and a shared `activeView` state while preserving existing mode slider behavior.
- [ ] Add a shared loading/error/retry view helper and full-width responsive view shell.
- [ ] Run dashboard layout tests.
- [ ] Commit: `feat: add grouped habitat web navigation`.

### Task 3: Implement overview and inspection surfaces

**Files:**
- Modify: `web/src/main.tsx`, `web/src/dashboard-model.ts`
- Test: `tests/dashboard-layout.test.ts`, `tests/dashboard-model.test.ts`

- [ ] Add tests for status, health, version, heartbeat, summary, solar irradiance, and unlock report cards.
- [ ] Implement read-only cards/tables backed by the API, with independent loading and retryable error states.
- [ ] Refresh overview data after relevant mutations.
- [ ] Run model and layout tests.
- [ ] Commit: `feat: add habitat overview command views`.

### Task 4: Implement modules, blueprints, construction, resources, and inventory

**Files:**
- Modify: `web/src/main.tsx`, `web/src/dashboard.css`
- Test: `tests/dashboard-layout.test.ts`, new focused interaction tests if available

- [ ] Add failing assertions for module details/update/delete/recharge, construction status/cancel, blueprint details/build, inventory list/add, and resource catalog display.
- [ ] Implement module actions with damaged-state restrictions and confirmations for delete/cancel.
- [ ] Preserve the fullscreen blueprint details overlay and back button; add build readiness and graceful failure states.
- [ ] Show all catalog resources with zero amounts and only nonzero inventory rows.
- [ ] Run focused dashboard tests.
- [ ] Commit: `feat: add habitat operations views`.

### Task 5: Implement crew, EVA, scanning, collection, alerts, and catalogs

**Files:**
- Modify: `web/src/main.tsx`, `web/src/dashboard.css`
- Test: `tests/dashboard-layout.test.ts`, relevant domain/API tests

- [ ] Add tests for humans list/move, EVA status/deploy/move/dock, scan radius/strength, collect quantity, alert acknowledge, and all catalog tabs.
- [ ] Implement forms with numeric validation, inline success/error messages, and refresh after mutation.
- [ ] Keep alert acknowledgement reversible in the UI until the server confirms success.
- [ ] Run focused dashboard and API tests.
- [ ] Commit: `feat: add crew exploration and catalog views`.

### Task 6: Implement server/settings actions and destructive confirmations

**Files:**
- Modify: `web/src/main.tsx`, `web/src/dashboard.css`, local API router/client
- Test: `tests/dashboard-layout.test.ts`, API tests

- [ ] Add tests for server logs, web sessions, connect URL, and unregister confirmation.
- [ ] Implement log/session tables, connect form with normalized URL feedback, and unregister confirmation requiring an explicit second action.
- [ ] Ensure logout remains separate from unregister and no credentials are rendered.
- [ ] Run focused tests.
- [ ] Commit: `feat: add habitat server and settings controls`.

### Task 7: Build and verify the complete dashboard

**Files:**
- Modify: `app.js`, `index.html`, generated dashboard bundle only through the existing build command
- Test: `tests/dashboard-build.test.ts`, full focused dashboard suite

- [ ] Run `bun run build:dashboard`.
- [ ] Run `bun test tests/dashboard-layout.test.ts tests/dashboard-model.test.ts tests/web-login-page.test.ts tests/dashboard-build.test.ts`.
- [ ] Inspect the generated bundle for excluded commands and verify cache-busting versions match.
- [ ] Commit: `chore: rebuild habitat dashboard assets`.

## Self-review

The plan covers navigation, API delegation, all approved read/write command groups, explicit exclusions, loading/error handling, confirmations, and build verification. No task adds auth, tick controls, or `resource add`.
