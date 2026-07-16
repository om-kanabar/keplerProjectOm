# Kepler Live Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Habitat backend to Kepler's authenticated tick stream while preserving manual simulation, persistence, CLI behavior, and dashboard visibility.

**Architecture:** Registration stores Kepler's stream credentials and metadata in the existing `keplerRegistration`. A new persisted `clockState` records mode and connection/tick telemetry. A focused backend-owned WebSocket manager applies validated future notices through `runTickSimulation`, publishes local SSE events, and reconnects without catch-up. The CLI and dashboard call only local Habitat HTTP/SSE endpoints.

**Tech Stack:** Bun, TypeScript, Hono, Bun SQLite, Commander, React, Vite, Bun test.

## Global Constraints

- Preserve existing SQLite JSON state and all existing habitat/module/human/inventory/construction/power/alert data.
- Keep `--json` stable and never log the stream API token.
- Use the same UUID for legacy registration upgrades; never unregister to obtain stream credentials.
- Manual ticks are allowed only in manual mode; live ticks apply only while listening is enabled.
- Do not commit or create tags in this task; preserve the user's existing dirty dashboard edits.

### Task 1: Extend persisted registration and clock state

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage.ts`
- Modify: `src/kepler.ts`
- Test: `tests/habitat-kepler.test.ts`

- [ ] Write failing tests proving registration preserves `streamUrl`, `apiToken`, `stream`, and defaults `clockState` to manual/off.
- [ ] Run the focused test and confirm it fails for the missing fields.
- [ ] Add typed stream metadata and clock-state types; parse them defensively from SQLite.
- [ ] Preserve the token in the one authoritative registration object and add registration-response parsing.
- [ ] Run focused tests and `bun run check`.

### Task 2: Add shared clock service and WebSocket client

**Files:**
- Create: `src/server/services/clock-service.ts`
- Create: `src/server/kepler-stream.ts`
- Modify: `src/tick.ts`
- Modify: `src/server/index.ts`
- Test: `tests/clock-service.test.ts`

- [ ] Write failing tests for manual-mode gating, positive-integer `advancedBy`, duplicate/older absolute ticks, and exact simulation delegation.
- [ ] Implement a serialized clock service that persists mode before connecting, closes before re-enabling manual mode, and emits future tick events.
- [ ] Implement WebSocket hello `{ type: "hello", apiToken, subscribe: ["ticks"] }`, hello acknowledgement validation, safe JSON parsing, advertised-capability checks, delayed reconnect, and clean shutdown.
- [ ] Start the service from the long-running Bun server and stop it on process exit.
- [ ] Run clock-service tests and type-check.

### Task 3: Add local Hono clock API and SSE

**Files:**
- Create: `src/server/routes/clock.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/routes/registration.ts`
- Test: `tests/clock-routes.test.ts`

- [ ] Write failing route tests for `GET /clock/status`, listen on/off, manual tick rejection, and `/clock/events` SSE headers/event shape.
- [ ] Implement status and control routes using the clock service; return useful errors while keeping REST available when connection fails.
- [ ] Include registration stream fields and clock state in `/status` without redaction because this is the explicitly operator-facing local status contract.
- [ ] Ensure server access logs contain only method/path/status and never token values.
- [ ] Run route tests and type-check.

### Task 4: Add CLI commands and local watch

**Files:**
- Modify: `src/api-client.ts`
- Modify: `src/commands.ts`
- Modify: `src/output.ts`
- Test: `tests/habitat-kepler.test.ts`

- [ ] Write failing CLI tests for `habitat clock status`, `listen on`, `listen off`, blocked manual ticks, and `clock watch` consuming local SSE.
- [ ] Add API-client methods for clock status/control and a streaming reader for `/clock/events`.
- [ ] Add stable JSON fields and human-readable output for registration credentials, stream metadata, and clock telemetry.
- [ ] Implement `clock watch` so Ctrl+C closes only its local SSE request and it never opens a Kepler WebSocket.
- [ ] Run focused CLI tests with `HABITAT_BIN=/Users/omkanabar/labs/keplerProjectOm/src/index.ts`.

### Task 5: Update the dashboard

**Files:**
- Modify: `web/src/dashboard-model.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/src/dashboard.css`
- Test: `tests/live-dashboard.test.ts`

- [ ] Write failing UI/model tests for displaying clock mode, listening state, connection state, latest tick, and advancedBy.
- [ ] Extend the `/status` snapshot model with clock status while preserving existing visual structure and the user's current UI edits.
- [ ] Add a compact Live Clock panel with listen on/off controls, manual-tick availability, latest tick telemetry, and connection error text.
- [ ] Use local HTTP refresh after controls; do not add a browser WebSocket to Kepler.
- [ ] Run dashboard tests and production build.

### Task 6: Verify restart, reconnect, and end-to-end behavior

**Files:**
- Modify: `README.md` or `DEPLOYMENT.md` only if the final commands are missing.

- [ ] Run the full test suite and `bun run check`.
- [ ] Start the local service and verify manual mode, manual ticks, listen on/off, blocked ticks, and JSON output.
- [ ] Exercise the WebSocket contract with a local deterministic server or the live Kepler endpoint when reachable; verify no replay/catch-up and full `advancedBy` application.
- [ ] Restart the service in both modes and verify persisted mode/reconnect behavior.
- [ ] Inspect service logs and confirm no API token appears.
- [ ] Report any live Kepler or deployment checks that cannot run in this environment instead of claiming them.

No commit or tag will be created.
