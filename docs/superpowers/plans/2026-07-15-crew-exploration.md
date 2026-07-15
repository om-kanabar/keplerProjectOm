# Crew, Exploration, Collection, and Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locally persisted crew, EVA, material collection/return, and operational alerts to Habitat.

**Architecture:** Keep the existing SQLite JSON state record as the single persistence boundary. Focused domain modules own human, EVA, and alert transitions; Hono routes expose canonical endpoints; the typed client and Commander CLI only call local Hono. Kepler remains the authority for sector bounds, scans, and collection results.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Hono, Commander, Bun test.

## Global Constraints

- Keep `--json` machine-readable and stable.
- Do not add `/api/...` aliases or file-state fallbacks.
- Do not expose `KEPLER_PLANET_TOKEN` in outputs, browser code, or commits.
- Make rejected commands leave persisted state unchanged.

---

### Task 1: Types, safe parsing, and registration hydration

**Files:**
- Modify: `src/types.ts`, `src/storage.ts`, `src/kepler.ts`
- Test: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Produces `HabitatHuman`, `ExplorationState`, `HabitatAlert`, `AlertContract`, and validated `HabitatData` fields.
- Produces atomic `registerWithKepler(displayName)` hydration from `starterModules`, `starterHumans`, and `contracts.alerts`.

- [ ] Write a registration test fixture containing two `{ id, displayName, locationModuleId }` humans and an alerts contract, then assert `readData()` contains exactly six modules and two humans after registration.
- [ ] Run `bun test tests/habitat-kepler.test.ts --test-name-pattern "hydrates starter humans"`; expect failure because `humans` and `alertContract` do not exist.
- [ ] Add the shared types and storage parsers; extend the registration response type and write modules, humans, and alert contract together in the existing one-record SQLite write.
- [ ] Re-run the focused test; expect PASS.

### Task 2: Human domain and local API

**Files:**
- Create: `src/humans.ts`, `src/server/routes/humans.ts`
- Modify: `src/modules.ts`, `src/server/app.ts`
- Test: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes `HabitatData.humans` and module `runtimeAttributes.crewCapacity`.
- Produces `listHumans()`, `moveHuman(humanId, moduleId)`, `GET /humans`, and `POST /humans/:humanId/move`.

- [ ] Write tests that list two hydrated humans, move one into an open module, reject an unknown/full destination, and reject deletion of an occupied module.
- [ ] Run the focused test names; expect failure because the routes and domain module are absent.
- [ ] Implement human lookup/move and destination occupancy counting; call an occupancy guard from `deleteModule`; register canonical human routes.
- [ ] Re-run the focused tests; expect PASS.

### Task 3: EVA state, movement, and scan origin

**Files:**
- Create: `src/eva.ts`, `src/server/routes/eva.ts`
- Modify: `src/kepler.ts`, `src/server/routes/scan.ts`, `src/server/app.ts`
- Test: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Produces `getEvaStatus()`, `deployExplorer(humanId)`, `moveExplorer(x, y)`, `dockExplorer()`, `GET /eva`, `POST /eva/deploy`, `POST /eva/move`, and `POST /eva/dock`.
- `GET /scan?sensorStrength=&radiusTiles=` reads origin only from persisted EVA state.

- [ ] Write tests for suitport-only deployment at `(0,0)`, cardinal one-tile moves, rejected diagonal/jump/out-of-sector moves, and scan requests that contain saved coordinates but reject no explorer.
- [ ] Run focused tests; expect failure because EVA operations do not exist and scan still accepts `x/y`.
- [ ] Implement persisted EVA transitions, current-sector lookup, and scan rewrite; resolve/refresh deployment alerts through the alert interface introduced next.
- [ ] Re-run focused tests; expect PASS.

### Task 4: Collection, docking transaction, and alerts

**Files:**
- Create: `src/alerts.ts`, `src/server/routes/alerts.ts`
- Modify: `src/eva.ts`, `src/kepler.ts`, `src/server/app.ts`, `src/storage.ts`
- Test: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Produces `collectAtExplorerPosition(quantityKg)`, `POST /collect`, `listAlerts()`, `acknowledgeAlert(id)`, `GET /alerts`, and `POST /alerts/:alertId/acknowledge`.
- Kepler client exposes `fetchWorldSector(habitatId)` and `collectWorldResource({ habitatId, x, y, quantityKg })`.

- [ ] Write tests for successful collection, unchanged carried state on Kepler rejection, capacity rejection, atomic docking to inventory, alert occurrence deduplication, acknowledgement, and resolution after docking.
- [ ] Run focused tests; expect failure because collection/alerts are absent.
- [ ] Implement authenticated Kepler collection, local-before-remote validation, success-only carry updates, SQLite transaction docking, and contract-backed alert lifecycle.
- [ ] Re-run focused tests; expect PASS.

### Task 5: Typed client, CLI contract, and output

**Files:**
- Modify: `src/api-client.ts`, `src/commands.ts`, `src/output.ts`
- Test: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Produces `human list|move`, `eva status|deploy|move|dock`, `collect`, `alert list|acknowledge`, and `scan --strength --radius` commands routed through the local API.

- [ ] Write CLI tests for text and `--json` forms plus rejection of `habitat scan --x/--y`.
- [ ] Run focused tests; expect failure because Commander commands and client methods are missing.
- [ ] Add typed request methods and Commander wiring using the existing `respond`/`fail` pattern; add concise renderers and help examples.
- [ ] Re-run focused tests; expect PASS.

### Task 6: Full verification

**Files:**
- Modify only if verification exposes a requirement gap.
- Test: `tests/habitat-kepler.test.ts`

- [ ] Run `bun run check`; expect TypeScript to complete with no errors.
- [ ] Run `bun test tests/habitat-kepler.test.ts`; expect all Habitat tests to pass.
- [ ] Inspect `git diff --check` and `git status --short`; ensure only the crew/exploration files plus the pre-existing user edits are present.
