# Habitat REST Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Habitat CLI into a local Hono REST backend plus a CLI HTTP client while preserving the existing terminal experience and JSON mode.

**Architecture:** Keep `src/commands.ts` focused on command parsing, friendly errors, and output formatting. Move SQLite access and all Kepler transport behind a Hono app, then have the CLI call that app through a small API client module with one configurable base URL.

**Tech Stack:** Bun, TypeScript, Commander, Hono, Bun test, bun:sqlite

## Global Constraints

- Keep `--json` stable as the machine-readable CLI API.
- The backend is the only process that knows how to reach Kepler.
- The backend is the only process that reads or writes SQLite habitat state.
- Development workflow is a separate server process with `bun run server`.
- Default backend bind is localhost on port `8787`, overridable with `HABITAT_API_HOST` and `HABITAT_API_PORT`.
- CLI base URL defaults to `http://localhost:8787`, overridable with `HABITAT_API_BASE_URL`.
- Prefer resource-shaped routes; use action routes only where the domain is genuinely action-like.

---

### Task 1: Add backend app scaffolding and registration API

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Create: `src/server/routes/registration.ts`
- Create: `src/server/services/registration-service.ts`
- Modify: `package.json`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: `readData(): HabitatData`, `writeData(data: HabitatData): void`, `registerWithKepler(displayName: string): Promise<KeplerRegistration>`, `fetchKeplerRegistration(): Promise<KeplerRegistration | undefined>`, `unregisterFromKepler(): Promise<KeplerRegistration>`
- Produces: `createApp(): Hono`, `startServer(options?: { host?: string; port?: number }): Server`, `GET /registration`, `POST /registration`, `DELETE /registration`

- [ ] **Step 1: Write the failing backend app test**

```ts
test("GET /registration returns { registration: null } when no habitat is registered", async () => {
  const { createApp } = await import("../src/server/app");
  const app = createApp();

  const response = await app.request("/registration");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    registration: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "GET /registration returns"`
Expected: FAIL because `../src/server/app` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
const app = new Hono();

app.get("/registration", (c) => {
  return c.json({ registration: null });
});
```

```ts
const host = process.env.HABITAT_API_HOST ?? "127.0.0.1";
const port = Number(process.env.HABITAT_API_PORT ?? "8787");

Bun.serve({
  hostname: host,
  port,
  fetch: createApp().fetch,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "GET /registration returns"`
Expected: PASS

- [ ] **Step 5: Expand the route to live registration behavior**

```ts
app.get("/registration", async (c) => {
  const registration = await getRegistration();
  return c.json({ registration: registration ?? null });
});

app.post("/registration", async (c) => {
  const body = await c.req.json<{ displayName?: string }>();
  const registration = await createRegistration(body.displayName ?? "");
  return c.json({ registration }, 201);
});

app.delete("/registration", async (c) => {
  const registration = await deleteRegistration();
  return c.json({ registration });
});
```

- [ ] **Step 6: Add server script and direct app verification coverage**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "registration"`
Expected: PASS with direct `app.request(...)` coverage for GET, POST, and DELETE


### Task 2: Add a CLI API client and route status/register/unregister through HTTP

**Files:**
- Create: `src/api-client.ts`
- Modify: `src/commands.ts`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: backend routes from Task 1, `printKeplerRegistration`, `printModuleList`
- Produces: `createHabitatApiClient(options?: { baseUrl?: string }): HabitatApiClient`, `getRegistration(): Promise<{ registration: KeplerRegistration | null }>`, `register(displayName: string): Promise<{ registration: KeplerRegistration }>`, `unregister(): Promise<{ registration: KeplerRegistration }>`, `getStatus(): Promise<{ registration: KeplerRegistration | null; modules: HabitatModule[] }>`

- [ ] **Step 1: Write the failing CLI client test**

```ts
test("CLI status reads registration from HABITAT_API_BASE_URL instead of touching Kepler directly", async () => {
  const api = await startBackendFixture({ registration: { habitatId: "hab-1", habitatUuid: "uuid-1", displayName: "Cupola" } });

  const result = Bun.spawnSync([HABITAT_BIN, "status", "--json"], {
    cwd: workdir,
    env: {
      ...process.env,
      HABITAT_API_BASE_URL: api.baseUrl,
    },
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).data.registration.habitatId).toBe("hab-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "HABITAT_API_BASE_URL"`
Expected: FAIL because the CLI still calls old modules directly

- [ ] **Step 3: Write minimal API client and wire status/register/unregister through it**

```ts
export function createHabitatApiClient(): HabitatApiClient {
  const baseUrl = (process.env.HABITAT_API_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    return (await response.json()) as T;
  }

  return {
    getRegistration: () => request("GET", "/registration"),
    register: (displayName) => request("POST", "/registration", { displayName }),
    unregister: () => request("DELETE", "/registration"),
    getStatus: () => request("GET", "/status"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "HABITAT_API_BASE_URL|registration"`
Expected: PASS

- [ ] **Step 5: Add friendly CLI transport error coverage**

```ts
test("CLI prints a friendly error when the backend is unreachable", () => {
  const result = Bun.spawnSync([HABITAT_BIN, "status"], {
    cwd: workdir,
    env: {
      ...process.env,
      HABITAT_API_BASE_URL: "http://127.0.0.1:1",
    },
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Unable to reach the local Habitat API");
});
```


### Task 3: Move catalog and solar reads behind backend routes

**Files:**
- Create: `src/server/routes/catalog.ts`
- Create: `src/server/routes/world.ts`
- Create: `src/server/services/catalog-service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/api-client.ts`
- Modify: `src/commands.ts`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: `fetchKeplerBlueprintCatalog`, `fetchKeplerResourceCatalog`, `fetchSolarIrradiance`, `getBlueprint(blueprintId: string): Promise<BlueprintReference>`
- Produces: `GET /catalog/blueprints`, `GET /catalog/blueprints/:blueprintId`, `GET /catalog/resources`, `GET /solar/irradiance`

- [ ] **Step 1: Write failing route and CLI tests for blueprint/resource/solar commands**

```ts
test("CLI blueprint list uses the backend blueprint route", async () => {
  const api = await startBackendFixture({ blueprints: [{ blueprintId: "storage-module", displayName: "Storage Module", status: "published" }] });

  const result = Bun.spawnSync([HABITAT_BIN, "blueprint", "list", "--json"], {
    cwd: workdir,
    env: { ...process.env, HABITAT_API_BASE_URL: api.baseUrl },
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).data.blueprints[0].blueprintId).toBe("storage-module");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "backend blueprint route|solar"`
Expected: FAIL

- [ ] **Step 3: Implement backend routes and client calls**

```ts
app.get("/catalog/blueprints", async (c) => c.json({ blueprints: await listBlueprints() }));
app.get("/catalog/blueprints/:blueprintId", async (c) => c.json({ blueprint: await getBlueprint(c.req.param("blueprintId")) }));
app.get("/catalog/resources", async (c) => c.json({ resources: await listResources() }));
app.get("/solar/irradiance", async (c) => c.json({ solarIrradiance: await getSolarIrradiance() }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "backend blueprint route|solar"`
Expected: PASS


### Task 4: Move module and inventory state behind backend routes

**Files:**
- Create: `src/server/routes/modules.ts`
- Create: `src/server/routes/inventory.ts`
- Create: `src/server/services/module-service.ts`
- Create: `src/server/services/inventory-service.ts`
- Modify: `src/modules.ts`
- Modify: `src/inventory.ts`
- Modify: `src/resources.ts`
- Modify: `src/api-client.ts`
- Modify: `src/commands.ts`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: existing module and inventory domain logic, `printModuleList`, `printModuleDetails`, `printInventoryList`
- Produces: `GET /modules`, `GET /modules/:moduleId`, `PATCH /modules/:moduleId`, `DELETE /modules/:moduleId`, `GET /inventory`, `POST /inventory/items`, `POST /resources/items`

- [ ] **Step 1: Write failing tests for module list/show/update/delete and inventory list/add**

```ts
test("CLI module list reads modules through the backend", async () => {
  const api = await startBackendFixture({
    modules: [{ id: "starter-command-module", blueprintId: "command-module", displayName: "Command Module", connectedTo: [], runtimeAttributes: { status: "active" }, capabilities: ["habitat-command"], source: "starter" }],
  });

  const result = Bun.spawnSync([HABITAT_BIN, "module", "list", "--json"], {
    cwd: workdir,
    env: { ...process.env, HABITAT_API_BASE_URL: api.baseUrl },
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).data.modules).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "module list reads modules through the backend|inventory"`
Expected: FAIL

- [ ] **Step 3: Implement backend state routes and CLI wiring**

```ts
app.get("/modules", (c) => c.json({ modules: listModules() }));
app.get("/modules/:moduleId", (c) => c.json({ module: getModule(c.req.param("moduleId")) }));
app.patch("/modules/:moduleId", async (c) => c.json({ module: updateModule(c.req.param("moduleId"), await c.req.json()) }));
app.delete("/modules/:moduleId", (c) => c.json({ module: deleteModule(c.req.param("moduleId")) }));

app.get("/inventory", (c) => c.json({ inventory: listInventory() }));
app.post("/inventory/items", async (c) => {
  const body = await c.req.json<{ resourceId: string; amount: number }>();
  return c.json({ inventory: addInventory(body.resourceId, body.amount) });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "module list reads modules through the backend|inventory"`
Expected: PASS


### Task 5: Preserve tick, construction, and power behavior through backend-backed state

**Files:**
- Create: `src/server/routes/construction.ts`
- Create: `src/server/routes/ticks.ts`
- Modify: `src/server/app.ts`
- Modify: `src/api-client.ts`
- Modify: `src/commands.ts`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: `inspectConstructionReadiness`, `startConstruction`, `listConstructionJobs`, `cancelConstruction`, `runTickSimulation`, `runBatteryRechargeSimulation`
- Produces: `POST /construction/readiness`, `POST /construction/jobs`, `GET /construction/jobs`, `DELETE /construction/jobs/:moduleId`, `POST /ticks`, `POST /battery/recharge`

- [ ] **Step 1: Write failing regression tests for dry-run, start, status, cancel, tick, and battery recharge**

```ts
test("CLI construct dry-run reads readiness from the backend", async () => {
  const api = await startBackendFixture({
    constructionReadiness: {
      blueprintId: "small-solar-array",
      canStart: true,
      requiredFacility: "workshop-fabricator",
      outputModuleType: "small-solar-array",
      outputModuleId: "small-solar-array-1",
      buildTicks: 180,
      requiredResources: { ferrite: 90 },
      missingResources: {},
      facilityExists: true,
      facilityAvailable: true,
      supplyCacheOnline: true,
      prerequisitesMet: true,
      inventoryReady: true,
      usablePower: true,
      runtimeAttributes: { status: "online" },
      capabilities: ["power-generation"],
    },
  });

  const result = Bun.spawnSync([HABITAT_BIN, "construct", "small-solar-array", "--dry-run", "--json"], {
    cwd: workdir,
    env: { ...process.env, HABITAT_API_BASE_URL: api.baseUrl },
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).data.readiness.canStart).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "construct dry-run reads readiness from the backend|tick"`
Expected: FAIL

- [ ] **Step 3: Implement backend action routes and CLI wiring**

```ts
app.post("/construction/readiness", async (c) => {
  const body = await c.req.json<{ blueprintId: string }>();
  return c.json({ readiness: await inspectConstructionReadiness(body.blueprintId) });
});

app.post("/construction/jobs", async (c) => {
  const body = await c.req.json<{ blueprintId: string }>();
  return c.json({ construction: await startConstruction(body.blueprintId) }, 201);
});

app.get("/construction/jobs", (c) => c.json({ jobs: listConstructionJobs() }));
app.delete("/construction/jobs/:moduleId", (c) => c.json({ canceled: cancelConstruction(c.req.param("moduleId")) }));
app.post("/ticks", async (c) => c.json({ tick: await runTickSimulation((await c.req.json()).ticks) }));
app.post("/battery/recharge", async (c) => c.json({ recharge: runBatteryRechargeSimulation((await c.req.json()).ticks) }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/habitat-kepler.test.ts --test-name-pattern "construct dry-run reads readiness from the backend|tick"`
Expected: PASS


### Task 6: End-to-end verification and cleanup

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/habitat-kepler.test.ts`

**Interfaces:**
- Consumes: all backend routes, CLI client, `bun run server`
- Produces: documented local workflow, regression coverage for REST split, manual verification notes

- [ ] **Step 1: Add README usage notes for the split**

```md
## Local API workflow

Start the backend:

`bun run server`

Run the CLI against it:

`HABITAT_API_BASE_URL=http://localhost:8787 bun run src/index.ts status`
```

- [ ] **Step 2: Run the focused automated regression suite**

Run: `bun test tests/habitat-kepler.test.ts`
Expected: PASS

- [ ] **Step 3: Run type-checking**

Run: `bun run check`
Expected: PASS

- [ ] **Step 4: Run direct manual backend verification**

Run: `bun run server`
Expected: server listens on `127.0.0.1:8787`

Run: `curl http://localhost:8787/registration`
Expected: JSON shaped like `{ "registration": null }` or a registration object

- [ ] **Step 5: Run real CLI verification against the backend**

Run: `HABITAT_API_BASE_URL=http://localhost:8787 bun run src/index.ts status --json`
Expected: PASS with JSON output from the backend-backed CLI
