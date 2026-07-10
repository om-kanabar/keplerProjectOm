import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, renameSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
};

type TestServer = {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => void;
};

type TestServerOptions = {
  solarIrradianceBody?: Record<string, unknown>;
  solarIrradianceStatus?: number;
};

let workdir = "";

const HABITAT_BIN = process.env.HABITAT_BIN ?? "/Users/Om/.bun/bin/habitat";

function dataPath(): string {
  return join(workdir, "habitat.sqlite");
}

function readData(): Record<string, unknown> {
  if (!existsSync(dataPath())) {
    return {};
  }

  const db = new Database(dataPath(), { readonly: true });

  try {
    const row = db.query("SELECT data_json FROM habitat_state WHERE id = 1").get() as
      | { data_json?: string }
      | null;

    if (!row?.data_json) {
      return {};
    }

    return JSON.parse(row.data_json) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

function writeData(data: Record<string, unknown>): void {
  const db = new Database(dataPath(), { create: true });

  try {
    db.query(`
      CREATE TABLE IF NOT EXISTS habitat_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL
      )
    `).run();

    db.query(`
      INSERT INTO habitat_state (id, data_json)
      VALUES (1, $dataJson)
      ON CONFLICT(id) DO UPDATE SET
        data_json = excluded.data_json
    `).run({
      $dataJson: JSON.stringify(data, null, 2),
    });
  } finally {
    db.close();
  }
}

async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const port = await getFreePort();
  const blueprintCatalog = [
    {
      id: "blueprint-1",
      blueprintId: "command-module",
      displayName: "Command Module Blueprint",
      description: "Starter command module blueprint",
      status: "published",
      output: {
        itemType: "module",
        moduleType: "command-module",
        quantity: 1,
      },
      inputs: {},
      buildTicks: 100,
      repeatable: false,
    },
    {
      id: "blueprint-2",
      blueprintId: "basic-battery",
      displayName: "Basic Battery Blueprint",
      description: "Starter battery blueprint",
      status: "published",
      output: {
        itemType: "module",
        moduleType: "basic-battery",
        quantity: 1,
      },
      inputs: {},
      buildTicks: 100,
      repeatable: true,
    },
    {
      id: "blueprint-3",
      blueprintId: "storage-module",
      displayName: "Storage Module Blueprint",
      description: "Storage module blueprint",
      status: "published",
      output: {
        itemType: "module",
        moduleType: "storage-module",
        quantity: 1,
      },
      inputs: {
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      },
      buildTicks: 100,
      repeatable: true,
    },
    {
      id: "blueprint-4",
      blueprintId: "small-solar-array",
      displayName: "Small Solar Array Blueprint",
      description: "Deployable solar array blueprint",
      status: "published",
      requiredFacility: {
        moduleType: "workshop-fabricator",
        displayName: "Workshop Fabricator",
      },
      output: {
        itemType: "module",
        moduleType: "small-solar-array",
        quantity: 1,
      },
      inputs: {
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      },
      buildTicks: 180,
      repeatable: true,
      runtimeAttributes: {
        status: "online",
        health: 100,
        powerGenerationKw: 12,
      },
      capabilities: ["power-generation"],
    },
    {
      id: "blueprint-5",
      blueprintId: "survey-rover",
      displayName: "Survey Rover Blueprint",
      description: "Survey rover blueprint",
      status: "published",
      output: {
        itemType: "rover",
        quantity: 1,
      },
      inputs: {},
      buildTicks: 100,
      repeatable: true,
    },
  ];
  const resourceCatalog = [
    {
      id: "resource-1",
      resourceType: "ferrite",
      displayName: "Ferrite",
      description: "Iron-rich ore used for structural work.",
      rarity: "common",
    },
    {
      id: "resource-2",
      resourceType: "silicate-glass",
      displayName: "Silicate Glass",
      description: "Heat-resistant transparent construction material.",
      rarity: "uncommon",
    },
    {
      id: "resource-3",
      resourceType: "conductive-ore",
      displayName: "Conductive Ore",
      description: "Mineral feedstock used in wiring and circuitry.",
      rarity: "rare",
    },
    {
      id: "resource-4",
      resourceType: "water",
      displayName: "Water",
      description: "A plain-text fallback name to exercise catalog variants.",
      rarity: "operational",
    },
  ];
  const moduleCatalog = [
    {
      id: "module-catalog-1",
      moduleType: "life-support",
      displayName: "Life Support",
      status: "published",
    },
    {
      id: "module-catalog-2",
      moduleType: "workshop-fabricator",
      displayName: "Workshop Fabricator",
      status: "published",
    },
  ];
  const siteTypeCatalog = [
    {
      id: "site-type-1",
      siteType: "basalt-plain",
      displayName: "Basalt Plain",
      status: "available",
    },
  ];
  const unlockCatalog = [
    {
      id: "unlock-1",
      unlockId: "basic-fabrication",
      displayName: "Basic Fabrication",
      status: "available",
    },
  ];
  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      let body: unknown = undefined;

      if (request.method !== "GET" && request.method !== "DELETE") {
        body = await request.json();
      }

      requests.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get("authorization"),
        body,
      });

      if (request.method === "POST" && url.pathname === "/habitats/register") {
        return Response.json(
          {
            habitatId: "habitat-server-123",
            starterModules: [
              {
                id: "starter-command-module",
                blueprintId: "command-module",
                displayName: "Command Module",
                connectedTo: [],
                runtimeAttributes: {
                  status: "active",
                  health: 100,
                },
                capabilities: ["habitat-command"],
              },
              {
                id: "starter-life-support",
                blueprintId: "life-support",
                displayName: "Life Support",
                connectedTo: ["starter-command-module"],
                runtimeAttributes: {
                  status: "active",
                  health: 100,
                },
                capabilities: ["atmosphere-control"],
              },
              {
                id: "starter-basic-battery",
                blueprintId: "basic-battery",
                displayName: "Basic Battery",
                connectedTo: ["starter-command-module"],
                runtimeAttributes: {
                  status: "offline",
                  health: 100,
                  currentEnergyKwh: 500,
                  energyStorageKwh: 500,
                  reserveKwh: 60,
                  maxPowerOutputKw: 40,
                  powerDrawKw: {
                    offline: 0,
                    online: 0.5,
                    active: 2,
                    damaged: 0.5,
                  },
                  oxygenUseKgPerHour: 0,
                  crewAccessCapacity: 1,
                  suitOxygenRemainingKg: 0,
                  suitOxygenCapacityKg: 0,
                },
                capabilities: ["power-storage"],
              },
              {
                id: "starter-supply-cache",
                blueprintId: "supply-cache",
                displayName: "Supply Cache",
                connectedTo: ["starter-command-module"],
                runtimeAttributes: {
                  status: "active",
                  health: 100,
                },
                capabilities: ["storage"],
              },
              {
                id: "starter-workshop",
                blueprintId: "workshop-fabricator",
                displayName: "Workshop Fabricator",
                connectedTo: ["starter-command-module"],
                runtimeAttributes: {
                  status: "online",
                  health: 100,
                },
                capabilities: ["basic-fabrication"],
              },
              {
                id: "starter-suitport",
                blueprintId: "basic-suitport",
                displayName: "Basic Suitport",
                connectedTo: ["starter-life-support"],
                runtimeAttributes: {
                  status: "online",
                  health: 100,
                },
                capabilities: ["suitport-access"],
              },
            ],
            blueprints: blueprintCatalog,
          },
          { status: 201 },
        );
      }

      if (request.method === "GET" && url.pathname === "/catalog/blueprints") {
        return Response.json({ blueprints: blueprintCatalog });
      }

      if (request.method === "GET" && url.pathname === "/catalog/blueprints/storage-module") {
        return Response.json({ blueprint: blueprintCatalog[2] });
      }

      if (request.method === "GET" && url.pathname === "/catalog/resources") {
        return Response.json({ resources: resourceCatalog });
      }

      if (request.method === "GET" && url.pathname === "/catalog/modules") {
        return Response.json({ modules: moduleCatalog });
      }

      if (request.method === "GET" && url.pathname === "/catalog/site-types") {
        return Response.json({ siteTypes: siteTypeCatalog });
      }

      if (request.method === "GET" && url.pathname === "/catalog/unlocks") {
        return Response.json({ unlocks: unlockCatalog });
      }

      if (request.method === "GET" && url.pathname === "/world/solar-irradiance") {
        return Response.json(
          options.solarIrradianceBody ?? {
            solarIrradiance: {
              wPerM2: 900,
              wattsPerSquareMeter: 900,
              condition: "clear",
              asOf: "2026-07-08T12:00:00.000Z",
            },
          },
          { status: options.solarIrradianceStatus ?? 200 },
        );
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({
          status: "ok",
          service: "kepler-world",
        });
      }

      if (request.method === "GET" && url.pathname === "/version") {
        return Response.json({
          version: "2026.07.08",
          commit: "abc1234",
        });
      }

      if (request.method === "GET" && url.pathname === "/habitats/habitat-server-123/registration") {
        return Response.json({
          habitat: {
            id: "habitat-server-123",
            habitatSlug: "artemis-ridge",
            displayName: "Artemis Ridge",
            catalogVersion: "2026-06-24",
            status: "online",
            lastSeenAt: "2026-07-06T12:00:00.000Z",
          },
        });
      }

      if (request.method === "DELETE" && url.pathname === "/habitats/habitat-server-123") {
        return new Response(null, { status: 204 });
      }

      if (request.method === "POST" && url.pathname === "/habitats/habitat-server-123/heartbeat") {
        return Response.json({
          habitat: {
            id: "habitat-server-123",
            habitatSlug: "artemis-ridge",
            displayName: "Artemis Ridge",
            catalogVersion: "2026-07-08",
            status: "registered",
            lastSeenAt: "2026-07-08T12:00:01.000Z",
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/habitats/habitat-server-123/summary") {
        return Response.json({
          summary: {
            id: "summary-1",
            habitatId: "habitat-server-123",
            reportedAt: "2026-07-08T12:00:02.000Z",
            currentTick: 0,
            lastAppliedPlanetEventId: null,
            status: "unknown",
            activeAlertCount: 0,
            criticalAlertCount: 0,
            openTaskCount: 0,
            builtModuleCount: 0,
            activeConstructionCount: 0,
            catalogVersion: "",
            resourceSummary: {},
            agentSummary: {},
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/habitats/habitat-server-123/unlocks/report") {
        return Response.json({
          accepted: true,
          receivedAt: "2026-07-08T12:00:03.000Z",
        });
      }

      return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve a test port.")));
        return;
      }

      server.close(() => resolve(address.port));
    });
  });
}

async function runHabitat(args: string[], server: TestServer): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([HABITAT_BIN, ...args], {
    cwd: workdir,
    env: {
      ...process.env,
      HABITAT_DISABLE_LOCAL_API: "1",
      KEPLER_WORLD_BASE_URL: server.baseUrl,
      KEPLER_PLANET_TOKEN: "test-token",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "habitat-cli-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("Local Habitat API", () => {
  test("GET /registration returns { registration: null } when no habitat is registered", async () => {
    process.chdir(workdir);
    const { createApp } = await import("../src/server/app");
    const app = createApp();

    const response = await app.request("/registration");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registration: null,
    });
  });

  test("GET /status hydrates starter modules from Kepler when the local server has registration but no modules", async () => {
    process.chdir(workdir);
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
    });

    const previousBaseUrl = process.env.KEPLER_WORLD_BASE_URL;
    const previousToken = process.env.KEPLER_PLANET_TOKEN;
    process.env.KEPLER_WORLD_BASE_URL = "http://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        habitat: {
          id: "habitat-server-123",
          displayName: "Artemis Ridge",
          habitatSlug: "artemis-ridge",
          catalogVersion: "2026-07-10",
          status: "online",
          starterModules: [
            {
              id: "starter-command-module",
              blueprintId: "command-module",
              displayName: "Command Module",
              connectedTo: [],
              runtimeAttributes: {
                status: "active",
                health: 100,
              },
              capabilities: ["habitat-command"],
            },
          ],
        },
      })) as typeof fetch;

    try {
      const { createApp } = await import("../src/server/app");
      const app = createApp();
      const response = await app.request("/status");
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.modules).toEqual([
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ]);
      expect((readData().modules as unknown[] | undefined)?.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.KEPLER_WORLD_BASE_URL = previousBaseUrl;
      process.env.KEPLER_PLANET_TOKEN = previousToken;
    }
  });

  test("API client uses HABITAT_API_BASE_URL for status requests", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    process.env.HABITAT_API_BASE_URL = "http://127.0.0.1:8787";

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method,
      });

      return Response.json({
        registration: {
          habitatId: "habitat-server-123",
          habitatUuid: "11111111-1111-4111-8111-111111111111",
          displayName: "Artemis Ridge",
        },
        modules: [],
      });
    }) as typeof fetch;

    try {
      const { createHabitatApiClient } = await import("../src/api-client");
      const client = createHabitatApiClient();
      const result = await client.getStatus();

      expect(result.registration?.habitatId).toBe("habitat-server-123");
      expect(calls).toEqual([
        {
          url: "http://127.0.0.1:8787/status",
          method: "GET",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
    }
  });

  test("API client defaults to localhost:8787 when HABITAT_API_BASE_URL is unset", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    delete process.env.HABITAT_API_BASE_URL;

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method,
      });

      return Response.json({
        registration: null,
        modules: [],
      });
    }) as typeof fetch;

    try {
      const { createHabitatApiClient } = await import("../src/api-client");
      const client = createHabitatApiClient();
      await client.getStatus();

      expect(calls).toEqual([
        {
          url: "http://localhost:8787/status",
          method: "GET",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
    }
  });

  test("API client routes health, catalog, and heartbeat calls through HABITAT_API_BASE_URL", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    process.env.HABITAT_API_BASE_URL = "http://127.0.0.1:8787";

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method,
      });

      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/health")) {
        return Response.json({ health: { ok: true } });
      }

      if (url.endsWith("/catalog/modules")) {
        return Response.json({ modules: [] });
      }

      if (url.endsWith("/heartbeat")) {
        return Response.json({ heartbeat: { ok: true } });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    try {
      const { createHabitatApiClient } = await import("../src/api-client");
      const client = createHabitatApiClient();

      expect((await client.getHealth()).health).toEqual({ ok: true });
      expect((await client.listModuleCatalog()).modules).toEqual([]);
      expect((await client.sendHeartbeat()).heartbeat).toEqual({ ok: true });
      expect(calls).toEqual([
        { url: "http://127.0.0.1:8787/health", method: "GET" },
        { url: "http://127.0.0.1:8787/catalog/modules", method: "GET" },
        { url: "http://127.0.0.1:8787/heartbeat", method: "POST" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
    }
  });

  test("GET /server/logs returns recent Habitat API request logs", async () => {
    process.chdir(workdir);
    const { createApp } = await import("../src/server/app");
    const app = createApp();

    await app.request("/registration");
    const response = await app.request("/server/logs");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.logs)).toBe(true);
    expect(payload.logs.some((entry: { message?: string; path?: string }) => entry.message === "GET /registration" && entry.path === "/registration")).toBe(true);
  });

  test("status rendering uses the modules returned by the local Habitat API", async () => {
    process.chdir(workdir);
    const previousDisable = process.env.HABITAT_DISABLE_LOCAL_API;
    delete process.env.HABITAT_DISABLE_LOCAL_API;
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    process.env.HABITAT_API_BASE_URL = "http://127.0.0.1:8787";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (!url.endsWith("/status")) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      return Response.json({
        registration: {
          habitatId: "habitat-server-123",
          habitatUuid: "11111111-1111-4111-8111-111111111111",
          displayName: "Artemis Ridge",
          status: "online",
        },
        modules: [
          {
            id: "starter-command-module",
            blueprintId: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: {
              status: "active",
            },
            capabilities: ["habitat-command"],
            source: "starter",
          },
        ],
      });
    }) as typeof fetch;

    const originalLog = console.log;
    const renderedLines: string[] = [];
    console.log = (...args: unknown[]) => {
      renderedLines.push(args.map((value) => String(value)).join(" "));
    };

    const { runCli } = await import("../src/commands");

    try {
      await runCli(["bun", "habitat", "status"]);

      const output = renderedLines.join("\n");
      expect(output).toContain("Modules: 1");
      expect(output).toContain("Command Module");
      expect(output).not.toContain("No modules found.");
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
      process.env.HABITAT_DISABLE_LOCAL_API = previousDisable;
    }
  });

  test("connect saves the local Habitat API base URL for later commands", async () => {
    process.chdir(workdir);
    const { runCli } = await import("../src/commands");

    const originalLog = console.log;
    const renderedLines: string[] = [];
    console.log = (...args: unknown[]) => {
      renderedLines.push(args.map((value) => String(value)).join(" "));
    };

    try {
      await runCli(["bun", "habitat", "connect", "http://127.0.0.1:18787"]);

      expect(renderedLines.join("\n")).toContain("Connected to http://127.0.0.1:18787.");
      expect(readData()).toMatchObject({
        habitatApiBaseUrl: "http://127.0.0.1:18787",
      });
    } finally {
      console.log = originalLog;
    }
  });

  test("API client reads the saved Habitat API base URL when the env var is unset", async () => {
    process.chdir(workdir);
    writeData({
      habitatApiBaseUrl: "http://127.0.0.1:18787",
    });

    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    delete process.env.HABITAT_API_BASE_URL;

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method,
      });

      return Response.json({
        registration: null,
        modules: [],
      });
    }) as typeof fetch;

    try {
      const { createHabitatApiClient } = await import("../src/api-client");
      const client = createHabitatApiClient();
      await client.getStatus();

      expect(calls).toEqual([
        {
          url: "http://127.0.0.1:18787/status",
          method: "GET",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HABITAT_API_BASE_URL = previousBaseUrl;
    }
  });
});

describe("Kepler habitat registration commands", () => {
  test("help only exposes Kepler registration commands", async () => {
    const server = await startTestServer();

    try {
      const result = await runHabitat(["--help"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("register");
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("unregister");
      expect(result.stdout).not.toContain("describe");
      expect(result.stdout).not.toContain("map");
      expect(result.stdout).not.toContain("zone");
      expect(result.stdout).not.toContain("door");
      expect(result.stdout).not.toContain("airlock");
      expect(result.stdout).not.toContain("help [command]");
    } finally {
      server.close();
    }
  });

  test("register sends OpenAPI registration keys and stores the returned habitat id", async () => {
    const server = await startTestServer();

    try {
      const result = await runHabitat(["register", "--name", "Artemis Ridge"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(server.requests[0]).toMatchObject({
        method: "POST",
        path: "/habitats/register",
        authorization: "Bearer test-token",
        body: {
          displayName: "Artemis Ridge",
        },
      });
      expect((server.requests[0].body as { habitatUuid?: string }).habitatUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(Object.keys(server.requests[0].body as Record<string, unknown>).sort()).toEqual([
        "displayName",
        "habitatUuid",
      ]);
      expect(result.stdout).toContain('Registered habitat "Artemis Ridge".');
      expect(readData().keplerRegistration).toMatchObject({
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      });
      expect(readData().modules).toEqual([
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-life-support",
          blueprintId: "life-support",
          displayName: "Life Support",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["atmosphere-control"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "offline",
            health: 100,
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
              online: 0.5,
              active: 2,
              damaged: 0.5,
            },
            oxygenUseKgPerHour: 0,
            crewAccessCapacity: 1,
            suitOxygenRemainingKg: 0,
            suitOxygenCapacityKg: 0,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            health: 100,
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
        {
          id: "starter-suitport",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: ["starter-life-support"],
          runtimeAttributes: {
            status: "online",
            health: 100,
          },
          capabilities: ["suitport-access"],
          source: "starter",
        },
      ]);
    } finally {
      server.close();
    }
  });

  test("status fetches the registered habitat status from Kepler", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-life-support",
          blueprintId: "life-support",
          displayName: "Life Support",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["atmosphere-control"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "offline",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
              online: 0.5,
              active: 2,
              damaged: 0.5,
            },
            oxygenUseKgPerHour: 0,
            crewAccessCapacity: 1,
            suitOxygenRemainingKg: 0,
            suitOxygenCapacityKg: 0,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
        {
          id: "starter-suitport",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: ["starter-life-support"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["suitport-access"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["status"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/habitats/habitat-server-123/registration",
      });
      expect(result.stdout).toContain("Kepler Registration");
      expect(result.stdout).toContain("Habitat ID: habitat-server-123");
      expect(result.stdout).toContain("Status: online");
      expect(result.stdout).toContain("Catalog Version: 2026-06-24");
      expect(result.stdout).toContain("Modules: 6");
      expect(result.stdout).toContain("Modules");
      expect(result.stdout).toContain("| Module              | Nickname            | Status  | Draw | Draw per Tick Hour |");
      expect(result.stdout).toContain("| Command Module      | command-module      | active  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Life Support        | life-support        | active  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Basic Battery       | basic-battery       | offline | 0 kW | 0 kWh              |");
    } finally {
      server.close();
    }
  });

  test("unregister deletes the remote habitat and clears local registration", async () => {
    const server = await startTestServer();
    writeData({
      zones: [],
      doors: [],
      airlocks: [],
      mapPlacements: [],
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
    });

    try {
      const result = await runHabitat(["unregister"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "DELETE",
        path: "/habitats/habitat-server-123",
      });
      expect(result.stdout).toContain('Unregistered habitat "Artemis Ridge".');
      expect(readData()).toEqual({});
    } finally {
      server.close();
    }
  });

  test("status does not fall back to old JSON state when the sqlite database is missing", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const databasePath = dataPath();
      const missingPath = `${databasePath}-old`;

      renameSync(databasePath, missingPath);

      const missingResult = await runHabitat(["status"], server);
      expect(missingResult.exitCode).toBe(0);
      expect(missingResult.stdout).toContain("Not registered");
      expect(missingResult.stdout).not.toContain("Habitat ID: habitat-server-123");

      renameSync(missingPath, databasePath);

      const restoredResult = await runHabitat(["status"], server);
      expect(restoredResult.exitCode).toBe(0);
      expect(restoredResult.stdout).toContain("Habitat ID: habitat-server-123");
    } finally {
      const databasePath = dataPath();
      const missingPath = `${databasePath}-old`;

      if (existsSync(missingPath)) {
        renameSync(missingPath, databasePath);
      }

      server.close();
    }
  });

  test("module list shows hydrated starter modules", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "list"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Modules");
      expect(result.stdout).toContain("| Module              | Nickname            | Status  | Draw | Draw per Tick Hour |");
      expect(result.stdout).toContain("| Command Module      | command-module      | active  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Basic Suitport      | basic-suitport      | online  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Basic Battery       | basic-battery       | offline | 0 kW | 0 kWh              |");
      expect(result.stdout).not.toContain("starter-command-module");
      expect(result.stdout).not.toContain("starter-suitport");
    } finally {
      server.close();
    }
  });

  test("module status prints only runtime status and power draw", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "starter-life-support", "status"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Module Status");
      expect(result.stdout).toContain("ID: starter-life-support");
      expect(result.stdout).toContain("Status: active");
      expect(result.stdout).toContain("Power Draw: 0 kW");
      expect(result.stdout).not.toContain("Blueprint:");
      expect(result.stdout).not.toContain("Source:");
      expect(result.stdout).not.toContain("Capabilities:");
      expect(result.stdout).not.toContain("Key Properties");
    } finally {
      server.close();
    }
  });

  test("module status for battery modules shows only status and current power draw", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "basic-battery", "status"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Module Status");
      expect(result.stdout).toContain("ID: starter-basic-battery");
      expect(result.stdout).toContain("Status: offline");
      expect(result.stdout).toContain("Power Draw: 0 kW");
      expect(result.stdout).not.toContain("Current Charge:");
      expect(result.stdout).not.toContain("Capacity:");
      expect(result.stdout).not.toContain("Power draw by state");
    } finally {
      server.close();
    }
  });

  test("module info prints the detailed module view", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "starter-life-support", "info"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Module");
      expect(result.stdout).toContain("ID: starter-life-support");
      expect(result.stdout).toContain("Blueprint: life-support");
      expect(result.stdout).toContain("Source: starter");
      expect(result.stdout).toContain("Capabilities: atmosphere-control");
      expect(result.stdout).toContain("Key Properties");
      expect(result.stdout).toContain("Status: active");
    } finally {
      server.close();
    }
  });

  test("module info shows power draw by state in a table", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "basic-battery", "info"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Power draw by state");
      expect(result.stdout).toContain("| Resource | Amount |");
      expect(result.stdout).toContain("| offline  | 0      |");
      expect(result.stdout).toContain("| online   | 0.5    |");
      expect(result.stdout).toContain("| active   | 2      |");
      expect(result.stdout).toContain("| damaged  | 0.5    |");
    } finally {
      server.close();
    }
  });

  test("module show surfaces power generation details for solar modules", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            health: 100,
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "show", "solar-array-1"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Power Generation: 12");
    } finally {
      server.close();
    }
  });

  test("module info replaces idle with online in status and power draw output", async () => {
    const server = await startTestServer();
    writeData({
      modules: [
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: [],
          runtimeAttributes: {
            status: "idle",
            health: 100,
            powerDrawKw: {
              offline: 0,
              idle: 1,
              active: 8,
              damaged: 1,
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "show", "starter-workshop"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Status: online");
      expect(result.stdout).toContain("| offline  | 0      |");
      expect(result.stdout).toContain("| online   | 1      |");
      expect(result.stdout).toContain("| active   | 8      |");
      expect(result.stdout).toContain("| damaged  | 1      |");
      expect(result.stdout).not.toContain("idle");
    } finally {
      server.close();
    }
  });

  test("module set-status uses legacy idle power draw when online is requested", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: [],
          runtimeAttributes: {
            status: "idle",
            health: 100,
            powerDrawKw: {
              offline: 0,
              idle: 1,
              active: 8,
              damaged: 1,
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "set-status", "starter-workshop", "online"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Status: online");
      expect(result.stdout).toContain("Power Draw: 1 kW");
    } finally {
      server.close();
    }
  });

  test("blueprint list shows the live Kepler blueprint catalog in a table", async () => {
    const server = await startTestServer();

    try {
      const result = await runHabitat(["blueprint", "list"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/catalog/blueprints",
      });
      expect(result.stdout).toContain("Blueprints");
      expect(result.stdout).toContain("Name");
      expect(result.stdout).toContain("Blueprint ID");
      expect(result.stdout).toContain("Status");
      expect(result.stdout).toContain("Output");
      expect(result.stdout).toContain("Command Module Blueprint");
      expect(result.stdout).toContain("storage-module");
      expect(result.stdout).toContain("survey-rover");
      expect(result.stdout).not.toContain("Basic Start");
    } finally {
      server.close();
    }
  });

  test("blueprint show prints readable details for one live blueprint", async () => {
    const server = await startTestServer();

    try {
      const result = await runHabitat(["blueprint", "show", "storage-module"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/catalog/blueprints",
      });
      expect(result.stdout).toContain("Blueprint");
      expect(result.stdout).toContain("ID: blueprint-3");
      expect(result.stdout).toContain("Blueprint ID: storage-module");
      expect(result.stdout).toContain("Name: Storage Module Blueprint");
      expect(result.stdout).toContain("Description: Storage module blueprint");
      expect(result.stdout).toContain("Status: published");
      expect(result.stdout).toContain("Output: module: storage-module");
      expect(result.stdout).toContain("Inputs");
      expect(result.stdout).toContain("ferrite");
      expect(result.stdout).toContain("90");
      expect(result.stdout).toContain("silicate-glass");
      expect(result.stdout).toContain("45");
      expect(result.stdout).toContain("conductive-ore");
      expect(result.stdout).toContain("18");
      expect(result.stdout).toContain("Build Ticks: 100");
      expect(result.stdout).toContain("Repeatable: yes");
    } finally {
      server.close();
    }
  });

  test("health, version, world, and catalog commands query kepler-owned endpoints", async () => {
    const server = await startTestServer();

    try {
      const healthResult = await runHabitat(["health"], server);
      const versionResult = await runHabitat(["version"], server);
      const irradianceResult = await runHabitat(["world", "solar-irradiance"], server);
      const modulesResult = await runHabitat(["catalog", "modules"], server);
      const siteTypesResult = await runHabitat(["catalog", "site-types"], server);
      const unlocksResult = await runHabitat(["catalog", "unlocks"], server);

      expect(healthResult.exitCode).toBe(0);
      expect(versionResult.exitCode).toBe(0);
      expect(irradianceResult.exitCode).toBe(0);
      expect(modulesResult.exitCode).toBe(0);
      expect(siteTypesResult.exitCode).toBe(0);
      expect(unlocksResult.exitCode).toBe(0);
      expect(server.requests.map((request) => request.path)).toEqual([
        "/health",
        "/version",
        "/world/solar-irradiance",
        "/catalog/modules",
        "/catalog/site-types",
        "/catalog/unlocks",
      ]);
      expect(healthResult.stdout).toContain("kepler-world");
      expect(versionResult.stdout).toContain("2026.07.08");
      expect(irradianceResult.stdout).toContain("900");
      expect(irradianceResult.stdout).toContain("clear");
      expect(modulesResult.stdout).toContain("Workshop Fabricator");
      expect(siteTypesResult.stdout).toContain("Basalt Plain");
      expect(unlocksResult.stdout).toContain("Basic Fabrication");
    } finally {
      server.close();
    }
  });

  test("resource list shows the live Kepler resource catalog with local amounts in a table", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 90,
      },
    });

    try {
      const result = await runHabitat(["resource", "list"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/catalog/resources",
      });
      expect(result.stdout).toContain("Resources");
      expect(result.stdout).toContain("Name");
      expect(result.stdout).toContain("Resource ID");
      expect(result.stdout).toContain("Status");
      expect(result.stdout).toContain("Amount");
      expect(result.stdout).toContain("Ferrite");
      expect(result.stdout).toContain("ferrite");
      expect(result.stdout).toContain("90");
      expect(result.stdout).toContain("conductive-ore");
      expect(result.stdout).toContain("0");
      expect(result.stdout).toContain("Water");
    } finally {
      server.close();
    }
  });

  test("heartbeat, summary, and unlock report send local habitat state to kepler", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 90,
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const heartbeatResult = await runHabitat(["heartbeat"], server);
      const summaryResult = await runHabitat(["summary"], server);
      const unlockReportResult = await runHabitat(["unlocks", "report"], server);

      expect(heartbeatResult.exitCode).toBe(0);
      expect(summaryResult.exitCode).toBe(0);
      expect(unlockReportResult.exitCode).toBe(0);
      expect(server.requests.map((request) => request.path)).toEqual([
        "/habitats/habitat-server-123/heartbeat",
        "/habitats/habitat-server-123/summary",
        "/habitats/habitat-server-123/unlocks/report",
      ]);
      expect(server.requests[0].body).toMatchObject({
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
        moduleCount: 1,
      });
      expect(server.requests[1].body).toMatchObject({
        habitatId: "habitat-server-123",
        inventory: {
          ferrite: 90,
        },
      });
      expect(server.requests[2].body).toMatchObject({
        habitatId: "habitat-server-123",
        modules: [
          {
            id: "starter-command-module",
          },
        ],
      });
      expect(heartbeatResult.stdout).toContain("Heartbeat Response");
      expect(heartbeatResult.stdout).toContain("Habitat");
      expect(heartbeatResult.stdout).toContain("| Field");
      expect(heartbeatResult.stdout).toContain("displayName");
      expect(heartbeatResult.stdout).toContain("Artemis Ridge");
      expect(summaryResult.stdout).toContain("Summary Response");
      expect(summaryResult.stdout).toContain("Summary");
      expect(summaryResult.stdout).toContain("| Field");
      expect(summaryResult.stdout).toContain("currentTick");
      expect(summaryResult.stdout).toContain("0");
      expect(unlockReportResult.stdout).toContain("accepted");
    } finally {
      server.close();
    }
  });

  test("blueprint show prints a friendly error when the blueprint is missing", async () => {
    const server = await startTestServer();

    try {
      const result = await runHabitat(["blueprint", "show", "missing-blueprint"], server);

      expect(result.exitCode).toBe(1);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/catalog/blueprints",
      });
      expect(result.stderr).toContain('Blueprint "missing-blueprint" was not found in Kepler\'s catalog.');
    } finally {
      server.close();
    }
  });

  test("module create is no longer available so construction stays the only creation path", async () => {
    const server = await startTestServer();

    try {
      const helpResult = await runHabitat(["--help"], server);
      const result = await runHabitat(["module", "create", "--blueprint", "small-solar-array", "--name", "Cargo Annex"], server);

      expect(helpResult.exitCode).toBe(0);
      expect(helpResult.stdout).not.toContain("module create");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command: module create");
    } finally {
      server.close();
    }
  });

  test("module update patches local module fields", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "local-storage-1",
          blueprintId: "storage-module",
          displayName: "Storage Alpha",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            health: 100,
          },
          capabilities: ["storage"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(
        [
          "module",
          "update",
          "local-storage-1",
          "--name",
          "Storage Beta",
          "--set-status",
          "active",
          "--connect",
          "starter-command-module",
          "--add-capability",
          "bulk-storage",
          "--remove-capability",
          "storage",
          "--runtime-attributes",
          '{"health":72,"status":"damaged"}',
        ],
        server,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Updated module "Storage Beta".');

      const updated = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "local-storage-1",
      );

      expect(updated).toMatchObject({
        id: "local-storage-1",
        blueprintId: "storage-module",
        displayName: "Storage Beta",
        connectedTo: ["starter-command-module"],
        capabilities: ["bulk-storage"],
        runtimeAttributes: {
          health: 72,
          status: "active",
        },
        source: "local",
      });
    } finally {
      server.close();
    }
  });

  test("module delete removes non-starter modules", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "local-storage-1",
          blueprintId: "storage-module",
          displayName: "Storage Alpha",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "delete", "local-storage-1"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Deleted module "Storage Alpha".');
      expect((readData().modules as Array<Record<string, unknown>>).map((module) => module.id)).toEqual([
        "starter-command-module",
      ]);
    } finally {
      server.close();
    }
  });

  test("module delete removes a non-starter module when using a CRUD alias", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "7ce492bf-9e1e-430f-8309-ac4a9ad7275f",
          blueprintId: "storage-module",
          displayName: "Cargo Annex",
          connectedTo: [],
          runtimeAttributes: {},
          capabilities: ["storage"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "delete", "storage-module"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Deleted module "Cargo Annex".');
      expect((readData().modules as Array<Record<string, unknown>>).map((module) => module.id)).toEqual([
        "starter-command-module",
      ]);
    } finally {
      server.close();
    }
  });

  test("module delete rejects starter modules", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "delete", "starter-command-module"], server);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Starter modules cannot be deleted.");
    } finally {
      server.close();
    }
  });

  test("module commands fail clearly when the module does not exist", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [],
    });

    try {
      const showResult = await runHabitat(["module", "show", "missing-module"], server);
      expect(showResult.exitCode).toBe(1);
      expect(showResult.stderr).toContain('Module "missing-module" was not found.');

      const updateResult = await runHabitat(["module", "update", "missing-module", "--name", "Ghost"], server);
      expect(updateResult.exitCode).toBe(1);
      expect(updateResult.stderr).toContain('Module "missing-module" was not found.');

      const deleteResult = await runHabitat(["module", "delete", "missing-module"], server);
      expect(deleteResult.exitCode).toBe(1);
      expect(deleteResult.stderr).toContain('Module "missing-module" was not found.');
    } finally {
      server.close();
    }
  });

  test("module commands accept the short suffix of habitat-scoped module ids", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "1f229c04-b7e7-46ee-b571-9e6d70248833",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "habitat_1f229c04_b7e7_46ee_b571_9e6d70248833_command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "local-storage-1",
          blueprintId: "storage-module",
          displayName: "Storage Alpha",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "local",
        },
      ],
    });

    try {
      const showResult = await runHabitat(["module", "command_module_1", "status"], server);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain("ID: habitat_1f229c04_b7e7_46ee_b571_9e6d70248833_command_module_1");

      const updateResult = await runHabitat(
        ["module", "update", "local-storage-1", "--connect", "command_module_1"],
        server,
      );
      expect(updateResult.exitCode).toBe(0);
      expect(
        (
          (readData().modules as Array<Record<string, unknown>>).find((module) => module.id === "local-storage-1") as {
            connectedTo: string[];
          }
        ).connectedTo,
      ).toEqual(["habitat_1f229c04_b7e7_46ee_b571_9e6d70248833_command_module_1"]);

      const deleteResult = await runHabitat(["module", "delete", "command_module_1"], server);
      expect(deleteResult.exitCode).toBe(1);
      expect(deleteResult.stderr).toContain("Starter modules cannot be deleted.");
    } finally {
      server.close();
    }
  });

  test("module commands identify modules by their unique display name", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "local-storage-1",
          blueprintId: "storage-module",
          displayName: "Storage Alpha",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "local",
        },
      ],
    });

    try {
      const showResult = await runHabitat(["module", "Storage Alpha", "status"], server);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain("ID: local-storage-1");

      const updateResult = await runHabitat(
        ["module", "update", "Storage Alpha", "--status", "damaged"],
        server,
      );
      expect(updateResult.exitCode).toBe(0);

      const deleteResult = await runHabitat(["module", "delete", "Storage Alpha"], server);
      expect(deleteResult.exitCode).toBe(0);
      expect(deleteResult.stdout).toContain('Deleted module "Storage Alpha".');
    } finally {
      server.close();
    }
  });

  test("module update accepts blueprint-style aliases and the --status flag", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "habitat_11111111_1111_4111_8111_111111111111_command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            condition: 100,
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const updateResult = await runHabitat(
        ["module", "update", "command-module", "--status", "maintenance"],
        server,
      );

      expect(updateResult.exitCode).toBe(0);
      expect(updateResult.stdout).toContain('Updated module "Command Module".');

      const showResult = await runHabitat(["module", "command-module", "status"], server);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain("Status: maintenance");
      expect(showResult.stdout).not.toContain("Condition: 100");

      const infoResult = await runHabitat(["module", "command-module", "info"], server);
      expect(infoResult.exitCode).toBe(0);
      expect(infoResult.stdout).toContain("Condition: 100");

      const secondUpdateResult = await runHabitat(
        ["module", "update", "command-module-1", "--condition", "87"],
        server,
      );
      expect(secondUpdateResult.exitCode).toBe(0);

      const secondShowResult = await runHabitat(["module", "command-module-1", "status"], server);
      expect(secondShowResult.exitCode).toBe(0);
      expect(secondShowResult.stdout).toContain("Status: maintenance");
      expect(secondShowResult.stdout).not.toContain("Condition: 87");

      const secondInfoResult = await runHabitat(["module", "command-module-1", "info"], server);
      expect(secondInfoResult.exitCode).toBe(0);
      expect(secondInfoResult.stdout).toContain("Condition: 87");
    } finally {
      server.close();
    }
  });

  test("module set-status updates only runtime status, validates values, and writes the sqlite database", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            health: 100,
            powerDrawKw: {
              offline: 0,
              online: 0.25,
              active: 2,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "set-status", "starter-command-module", "active"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Module ID: starter-command-module");
      expect(result.stdout).toContain("Status: active");
      expect(result.stdout).toContain("Power Draw: 2 kW");

      const updated = (readData().modules as Array<Record<string, unknown>>)[0] as {
        runtimeAttributes: Record<string, unknown>;
      };
      expect(updated.runtimeAttributes).toMatchObject({
        status: "active",
        health: 100,
      });

      expect((readData().modules as Array<Record<string, unknown>>)[0]).toMatchObject({
        id: "starter-command-module",
        runtimeAttributes: {
          status: "active",
          health: 100,
        },
      });

      const invalidResult = await runHabitat(["module", "set-status", "starter-command-module", "standby"], server);
      expect(invalidResult.exitCode).toBe(1);
      expect(invalidResult.stderr).toContain(
        "Status must be one of: offline, online, active, damaged.",
      );
    } finally {
      server.close();
    }
  });

  test("status supports --json output", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 2,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["status", "--json"], server);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        ok: boolean;
        data: {
          registration: { habitatId: string; status: string };
          modules: Array<Record<string, unknown>>;
        };
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.data.registration.habitatId).toBe("habitat-server-123");
      expect(parsed.data.registration.status).toBe("online");
      expect(parsed.data.modules).toHaveLength(2);
      expect("power" in parsed.data).toBe(false);
    } finally {
      server.close();
    }
  });

  test("module set-status supports --json output at the end", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerDrawKw: {
              offline: 0,
              active: 2,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "set-status", "starter-command-module", "active", "--json"], server);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        ok: boolean;
        data: { moduleId: string; status: string; powerDrawKw: number };
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.data.moduleId).toBe("starter-command-module");
      expect(parsed.data.status).toBe("active");
      expect(parsed.data.powerDrawKw).toBe(2);
    } finally {
      server.close();
    }
  });

  test("tick drains one battery from combined non-battery module power draw", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3,
              offline: 0,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-life-support",
          blueprintId: "life-support",
          displayName: "Life Support",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "damaged",
            powerDrawKw: {
              active: 5,
              offline: 0.5,
            },
          },
          capabilities: ["atmosphere-control"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "60"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 60");
      expect(result.stdout).toContain("Completed Ticks: 60");
      expect(result.stdout).toContain("Stopped Reason: completed");
      expect(result.stdout).toContain("Total Power Draw: 3.5 kW");
      expect(result.stdout).toContain("Energy Consumed: 0.058333 kWh");
      expect(result.stdout).toContain("Battery Charge Before: 500 kWh");
      expect(result.stdout).toContain("Battery Charge After: 499.941667 kWh");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBeCloseTo(499.9416666667, 10);
    } finally {
      server.close();
    }
  });

  test("tick stops at combined battery reserve and persists partial progress", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3600,
              offline: 0,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 65,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "10"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 10");
      expect(result.stdout).toContain("Completed Ticks: 5");
      expect(result.stdout).toContain("Stopped Reason: reserve_reached");
      expect(result.stdout).toContain("Energy Consumed: 5 kWh");
      expect(result.stdout).toContain("Battery Charge Before: 65 kWh");
      expect(result.stdout).toContain("Battery Charge After: 60 kWh");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBe(60);
    } finally {
      server.close();
    }
  });

  test("tick combines multiple batteries and drains them in module order", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 1800,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "battery-a",
          blueprintId: "basic-battery",
          displayName: "Battery A",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 20,
            energyStorageKwh: 20,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "battery-b",
          blueprintId: "battery-bank",
          displayName: "Battery B",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 30,
            energyStorageKwh: 30,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "60"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Completed Ticks: 60");

      const modules = readData().modules as Array<Record<string, unknown>>;
      const firstBattery = modules.find((module) => module.id === "battery-a") as {
        runtimeAttributes: { currentEnergyKwh: number };
      };
      const secondBattery = modules.find((module) => module.id === "battery-b") as {
        runtimeAttributes: { currentEnergyKwh: number };
      };

      expect(firstBattery.runtimeAttributes.currentEnergyKwh).toBe(0);
      expect(secondBattery.runtimeAttributes.currentEnergyKwh).toBe(20);
    } finally {
      server.close();
    }
  });

  test("tick falls back to offline draw for unknown statuses and ignores battery self-draw", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "unknown-status-module",
          blueprintId: "life-support",
          displayName: "Life Support",
          connectedTo: [],
          runtimeAttributes: {
            status: "maintenance",
            powerDrawKw: {
              active: 4,
              offline: 0.25,
            },
          },
          capabilities: ["atmosphere-control"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            currentEnergyKwh: 10,
            energyStorageKwh: 10,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              active: 9,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "3600"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Total Power Draw: 0.25 kW");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBeCloseTo(9.75, 10);
    } finally {
      server.close();
    }
  });

  test("tick fails clearly when no battery modules are available", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 2,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "60"], server);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No battery modules are available for ticking.");
    } finally {
      server.close();
    }
  });

  test("tick fails clearly when all battery modules are offline", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 2,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "offline",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "60"], server);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("At least one battery module must be online to perform this action.");
    } finally {
      server.close();
    }
  });

  test("tick charges an online battery from an online solar module using Kepler irradiance", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "--json"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests.map((request) => request.path)).toEqual(["/world/solar-irradiance"]);

      const parsed = JSON.parse(result.stdout) as {
        ok: true;
        data: {
          tick: {
            solarCharging: {
              reason: string;
              irradianceWPerM2: number | null;
              condition: string | null;
              energyAddedKwh: number;
            };
          };
        };
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.data.tick.solarCharging.reason).toBe("charged");
      expect(parsed.data.tick.solarCharging.irradianceWPerM2).toBe(900);
      expect(parsed.data.tick.solarCharging.condition).toBe("clear");
      expect(parsed.data.tick.solarCharging.energyAddedKwh).toBeCloseTo(12 * 0.5 / 3600, 10);

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBeCloseTo(100 + (12 * 0.5 / 3600), 10);
    } finally {
      server.close();
    }
  });

  test("tick reports when no local solar modules exist", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "--json"], server);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        ok: true;
        data: { tick: { solarCharging: { reason: string; energyAddedKwh: number } } };
      };

      expect(parsed.data.tick.solarCharging.reason).toBe("no_solar_modules");
      expect(parsed.data.tick.solarCharging.energyAddedKwh).toBe(0);
    } finally {
      server.close();
    }
  });

  test("tick reports when solar modules are present but offline", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "offline",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "--json"], server);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        ok: true;
        data: { tick: { solarCharging: { reason: string; energyAddedKwh: number } } };
      };

      expect(parsed.data.tick.solarCharging.reason).toBe("solar_modules_offline");
      expect(parsed.data.tick.solarCharging.energyAddedKwh).toBe(0);
    } finally {
      server.close();
    }
  });

  test("tick fails clearly when batteries are present but all offline", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "offline",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1"], server);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("At least one battery module must be online to perform this action.");
    } finally {
      server.close();
    }
  });

  test("tick reports when irradiance is missing or unusable", async () => {
    const server = await startTestServer({
      solarIrradianceBody: {
        solarIrradiance: {
          condition: "night",
        },
      },
    });
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "--json"], server);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        ok: true;
        data: { tick: { solarCharging: { reason: string; irradianceWPerM2: number | null; energyAddedKwh: number } } };
      };

      expect(parsed.data.tick.solarCharging.reason).toBe("no_usable_irradiance");
      expect(parsed.data.tick.solarCharging.irradianceWPerM2).toBeNull();
      expect(parsed.data.tick.solarCharging.energyAddedKwh).toBe(0);
    } finally {
      server.close();
    }
  });

  test("tick reports when online batteries are already full", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "--json"], server);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        ok: true;
        data: { tick: { solarCharging: { reason: string; energyAddedKwh: number } } };
      };

      expect(parsed.data.tick.solarCharging.reason).toBe("battery_full");
      expect(parsed.data.tick.solarCharging.energyAddedKwh).toBe(0);
    } finally {
      server.close();
    }
  });

  test("tick fails clearly when the Kepler solar endpoint fails", async () => {
    const server = await startTestServer({
      solarIrradianceBody: {
        error: {
          message: "Solar weather feed is offline.",
        },
      },
      solarIrradianceStatus: 503,
    });
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "solar-array-1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
          capabilities: ["power-generation"],
          source: "local",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              online: 0,
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1"], server);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Solar weather feed is offline.");
    } finally {
      server.close();
    }
  });

  test("tick rejects non-positive and non-integer counts", async () => {
    const server = await startTestServer();

    try {
      const zeroResult = await runHabitat(["tick", "0"], server);
      expect(zeroResult.exitCode).toBe(1);
      expect(zeroResult.stderr).toContain("Tick count must be a positive integer.");

      const decimalResult = await runHabitat(["tick", "1.5"], server);
      expect(decimalResult.exitCode).toBe(1);
      expect(decimalResult.stderr).toContain("Tick count must be a positive integer.");

      const negativeResult = await runHabitat(["tick", "-500"], server);
      expect(negativeResult.exitCode).toBe(1);
      expect(negativeResult.stderr).toContain("Tick count must be a positive integer.");
    } finally {
      server.close();
    }
  });

  test("module battery recharge accepts hour shorthand and converts one hour to 3600 ticks", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3,
              offline: 0,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "battery", "recharge", "1", "hour"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 3600");
      expect(result.stdout).toContain("Completed Ticks: 3600");
      expect(result.stdout).toContain("Energy Added: 3 kWh");
      expect(result.stdout).toContain("Battery Charge After: 103 kWh");
    } finally {
      server.close();
    }
  });

  test("module battery recharge recharges batteries using the same power draw rate", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3,
              offline: 0,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "battery", "recharge", "500"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Battery Recharge");
      expect(result.stdout).toContain("Requested Ticks: 500");
      expect(result.stdout).toContain("Completed Ticks: 500");
      expect(result.stdout).toContain("Stopped Reason: completed");
      expect(result.stdout).toContain("Total Power Draw: 3 kW");
      expect(result.stdout).toContain("Energy Added: 0.416667 kWh");
      expect(result.stdout).toContain("Battery Charge Before: 100 kWh");
      expect(result.stdout).toContain("Battery Charge After: 100.416667 kWh");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBeCloseTo(100.4166666667, 10);
    } finally {
      server.close();
    }
  });

  test("module battery recharge stops charging at combined battery capacity", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3600,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "battery-a",
          blueprintId: "basic-battery",
          displayName: "Battery A",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 499,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "battery-b",
          blueprintId: "battery-bank",
          displayName: "Battery B",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 498,
            energyStorageKwh: 500,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "local",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "battery", "recharge", "10"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 10");
      expect(result.stdout).toContain("Completed Ticks: 3");
      expect(result.stdout).toContain("Stopped Reason: capacity_reached");
      expect(result.stdout).toContain("Energy Added: 3 kWh");
      expect(result.stdout).toContain("Battery Charge Before: 997 kWh");
      expect(result.stdout).toContain("Battery Charge After: 1000 kWh");

      const modules = readData().modules as Array<Record<string, unknown>>;
      const batteryA = modules.find((module) => module.id === "battery-a") as {
        runtimeAttributes: { currentEnergyKwh: number };
      };
      const batteryB = modules.find((module) => module.id === "battery-b") as {
        runtimeAttributes: { currentEnergyKwh: number };
      };

      expect(batteryA.runtimeAttributes.currentEnergyKwh).toBe(500);
      expect(batteryB.runtimeAttributes.currentEnergyKwh).toBe(500);
    } finally {
      server.close();
    }
  });

  test("tick accepts hour shorthand and converts one hour to 3600 ticks", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1", "hour"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 3600");
      expect(result.stdout).toContain("Completed Ticks: 3600");
      expect(result.stdout).toContain("Energy Consumed: 3 kWh");
      expect(result.stdout).toContain("Battery Charge After: 497 kWh");
    } finally {
      server.close();
    }
  });

  test("tick accepts multi-hour shorthand and converts two hour to 7200 ticks", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 3,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 500,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "2", "hour"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 7200");
      expect(result.stdout).toContain("Completed Ticks: 7200");
      expect(result.stdout).toContain("Energy Consumed: 6 kWh");
      expect(result.stdout).toContain("Battery Charge After: 494 kWh");
    } finally {
      server.close();
    }
  });

  test("module battery recharge over-request still completes the final tick to full battery", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 9,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 499.9975,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "battery", "recharge", "4238905713895"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 4238905713895");
      expect(result.stdout).toContain("Completed Ticks: 1");
      expect(result.stdout).toContain("Stopped Reason: capacity_reached");
      expect(result.stdout).toContain("Energy Added: 0.0025 kWh");
      expect(result.stdout).toContain("Battery Charge After: 500 kWh");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBe(500);
    } finally {
      server.close();
    }
  });

  test("module battery recharge tops off to full capacity when a huge request leaves a tiny remainder", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 9,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 482.006389,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["module", "battery", "recharge", "64723189659136459"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Battery Charge After: 500 kWh");
      expect(result.stdout).toContain("Completed Ticks: 7197");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBe(500);
    } finally {
      server.close();
    }
  });

  test("inventory add and list persists local resources", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
    });

    try {
      const addResult = await runHabitat(["inventory", "add", "ferrite", "90"], server);
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain("Added 90 ferrite.");

      const listResult = await runHabitat(["inventory", "list"], server);
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain("Inventory");
      expect(listResult.stdout).toContain("ferrite");
      expect(listResult.stdout).toContain("90");
      expect(readData().inventory).toMatchObject({
        ferrite: 90,
      });
    } finally {
      server.close();
    }
  });

  test("inventory add fails clearly when all battery modules are offline", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "offline",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
      ],
    });

    try {
      const addResult = await runHabitat(["inventory", "add", "ferrite", "90"], server);
      expect(addResult.exitCode).toBe(1);
      expect(addResult.stderr).toContain("At least one battery module must be online to perform this action.");
      expect(readData().inventory).toBeUndefined();
    } finally {
      server.close();
    }
  });

  test("resource add validates the live catalog and updates resource list amounts", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "starter",
        },
      ],
    });

    try {
      const addResult = await runHabitat(["resource", "add", "silicate-glass", "45"], server);
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain("Added 45 silicate-glass.");

      const listResult = await runHabitat(["resource", "list"], server);
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain("silicate-glass");
      expect(listResult.stdout).toContain("45");
      expect(listResult.stdout).toContain("ferrite");
      expect(listResult.stdout).toContain("0");

      const invalidResult = await runHabitat(["resource", "add", "made-up-resource", "5"], server);
      expect(invalidResult.exitCode).toBe(1);
      expect(invalidResult.stderr).toContain('Resource "made-up-resource" was not found in Kepler\'s catalog.');
    } finally {
      server.close();
    }
  });

  test("resource add fails clearly when the supply cache is offline", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: [],
          runtimeAttributes: {
            status: "offline",
          },
          capabilities: ["storage"],
          source: "starter",
        },
      ],
    });

    try {
      const addResult = await runHabitat(["resource", "add", "silicate-glass", "45"], server);
      expect(addResult.exitCode).toBe(1);
      expect(addResult.stderr).toContain("Supply cache must be online to add resources.");

      const blueprintResult = await runHabitat(["resource", "add", "small-solar-array"], server);
      expect(blueprintResult.exitCode).toBe(1);
      expect(blueprintResult.stderr).toContain("Supply cache must be online to add resources.");
      expect(readData().inventory).toBeUndefined();
    } finally {
      server.close();
    }
  });

  test("resource add accepts a blueprint id and adds all required materials", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 100,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "starter",
        },
      ],
    });

    try {
      const addResult = await runHabitat(["resource", "add", "small-solar-array"], server);
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain('Added required resources for "small-solar-array".');
      expect(addResult.stdout).toContain("ferrite: 90");
      expect(addResult.stdout).toContain("silicate-glass: 45");
      expect(addResult.stdout).toContain("conductive-ore: 18");
      expect(readData().inventory).toMatchObject({
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      });
    } finally {
      server.close();
    }
  });

  test("construct dry-run reports whether a blueprint can start construction", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 90,
        "silicate-glass": 45,
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 6,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 400,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["construct", "small-solar-array", "--dry-run"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Construction Dry Run");
      expect(result.stdout).toContain("Required Facility: workshop-fabricator");
      expect(result.stdout).toContain("Facility Exists: yes");
      expect(result.stdout).toContain("Facility Available: yes");
      expect(result.stdout).toContain("Supply Cache Online: yes");
      expect(result.stdout).toContain("Inventory Ready: no");
      expect(result.stdout).toContain("Missing Resources");
      expect(result.stdout).toContain("conductive-ore");
      expect(result.stdout).toContain("Can Start: no");
    } finally {
      server.close();
    }
  });

  test("construct spends inventory and attaches a local construction job to the workshop", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 6,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 400,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["construct", "small-solar-array"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Started construction for "small-solar-array".');
      expect(result.stdout).toContain("Output Module ID: small-solar-array-1");
      expect(result.stdout).toContain("Remaining Ticks: 180");

      expect(readData().inventory).toMatchObject({
        ferrite: 0,
        "silicate-glass": 0,
        "conductive-ore": 0,
      });

      const workshop = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-workshop",
      ) as { runtimeAttributes: Record<string, unknown> };

      expect(workshop.runtimeAttributes.status).toBe("active");
      expect(workshop.runtimeAttributes.constructionJob).toMatchObject({
        blueprintId: "small-solar-array",
        outputModuleId: "small-solar-array-1",
        buildTicks: 180,
        remainingTicks: 180,
      });
      const supplyCache = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-supply-cache",
      ) as { runtimeAttributes: Record<string, unknown> };
      expect(supplyCache.runtimeAttributes.status).toBe("active");
    } finally {
      server.close();
    }
  });

  test("construction status and cancel show and clear the active job without refunding resources", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 0,
        "silicate-glass": 0,
        "conductive-ore": 0,
      },
      modules: [
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
            constructionJob: {
              blueprintId: "small-solar-array",
              outputModuleId: "small-solar-array-1",
              buildTicks: 180,
              remainingTicks: 90,
              futureModule: {
                id: "small-solar-array-1",
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array",
                connectedTo: [],
                runtimeAttributes: {
                  status: "online",
                  health: 100,
                },
                capabilities: ["power-generation"],
                source: "local",
              },
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const statusResult = await runHabitat(["construction", "status"], server);
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stdout).toContain("Construction Jobs");
      expect(statusResult.stdout).toContain("small-solar-array");
      expect(statusResult.stdout).toContain("90");

      const cancelResult = await runHabitat(["construction", "cancel", "workshop-fabricator-1"], server);
      expect(cancelResult.exitCode).toBe(0);
      expect(cancelResult.stdout).toContain('Canceled construction job on "Workshop Fabricator".');

      const workshop = (readData().modules as Array<Record<string, unknown>>)[0] as {
        runtimeAttributes: Record<string, unknown>;
      };
      expect(workshop.runtimeAttributes.status).toBe("online");
      expect(workshop.runtimeAttributes.constructionJob).toBeUndefined();
      const supplyCache = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-supply-cache",
      ) as { runtimeAttributes: Record<string, unknown> };
      expect(supplyCache.runtimeAttributes.status).toBe("online");
      expect(readData().inventory).toMatchObject({
        ferrite: 0,
      });
    } finally {
      server.close();
    }
  });

  test("tick completes active construction jobs when enough powered ticks finish", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      inventory: {
        ferrite: 0,
        "silicate-glass": 0,
        "conductive-ore": 0,
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 6,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 400,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
            constructionJob: {
              blueprintId: "small-solar-array",
              outputModuleId: "small-solar-array-1",
              buildTicks: 180,
              remainingTicks: 180,
              futureModule: {
                id: "small-solar-array-1",
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array",
                connectedTo: [],
                runtimeAttributes: {
                  status: "online",
                  health: 100,
                },
                capabilities: ["power-generation"],
                source: "local",
              },
            },
            powerDrawKw: {
              active: 2,
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
          },
          capabilities: ["storage"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "180"], server);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Completed Construction");
      expect(result.stdout).toContain("small-solar-array-1");

      const listResult = await runHabitat(["module", "list"], server);
      expect(listResult.stdout).toContain("Small Solar Array");

      const showResult = await runHabitat(["module", "show", "small-solar-array-1"], server);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain("Blueprint: small-solar-array");
      expect(showResult.stdout).toContain("Capabilities: power-generation");

      const workshop = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-workshop",
      ) as { runtimeAttributes: Record<string, unknown> };
      expect(workshop.runtimeAttributes.status).toBe("online");
      expect(workshop.runtimeAttributes.constructionJob).toBeUndefined();
      const supplyCache = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-supply-cache",
      ) as { runtimeAttributes: Record<string, unknown> };
      expect(supplyCache.runtimeAttributes.status).toBe("online");
    } finally {
      server.close();
    }
  });

  test("tick recalculates power draw after construction finishes during the same run", async () => {
    const server = await startTestServer();
    writeData({
      modules: [
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 10,
            energyStorageKwh: 10,
            reserveKwh: 0,
            maxPowerOutputKw: 40,
            powerDrawKw: {
              offline: 0,
            },
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-supply-cache",
          blueprintId: "supply-cache",
          displayName: "Supply Cache",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: ["storage"],
          source: "starter",
        },
        {
          id: "workshop-fabricator-1",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            powerDrawKw: {
              online: 0,
              active: 1800,
            },
            constructionJob: {
              blueprintId: "small-solar-array",
              outputModuleId: "small-solar-array-1",
              buildTicks: 2,
              remainingTicks: 2,
              futureModule: {
                id: "small-solar-array-1",
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array 1",
                connectedTo: ["starter-command-module"],
                runtimeAttributes: {
                  status: "active",
                  powerDrawKw: {
                    offline: 0,
                    active: 3600,
                  },
                },
                capabilities: ["power-generation"],
                source: "local",
              },
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const result = await runHabitat(["tick", "1"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: 1");
      expect(result.stdout).toContain("Completed Ticks: 1");
      expect(result.stdout).toContain("Total Power Draw: 1800 kW");
      expect(result.stdout).toContain("Energy Consumed: 0.5 kWh");
      expect(result.stdout).toContain("Battery Charge After: 9.5 kWh");

      const workshop = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "workshop-fabricator-1",
      ) as { runtimeAttributes: { status: string; constructionJob: { remainingTicks: number } } };
      const supplyCache = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-supply-cache",
      ) as { runtimeAttributes: { status: string } };

      expect(workshop.runtimeAttributes.status).toBe("active");
      expect(workshop.runtimeAttributes.constructionJob.remainingTicks).toBe(1);
      expect(supplyCache.runtimeAttributes.status).toBe("active");
    } finally {
      server.close();
    }
  });

  test("construction does not advance when ticks cannot complete because usable battery energy is gone", async () => {
    const server = await startTestServer();
    writeData({
      keplerRegistration: {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat-server-123",
        displayName: "Artemis Ridge",
      },
      modules: [
        {
          id: "starter-command-module",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: 6,
            },
          },
          capabilities: ["habitat-command"],
          source: "starter",
        },
        {
          id: "starter-basic-battery",
          blueprintId: "basic-battery",
          displayName: "Basic Battery",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 60,
            energyStorageKwh: 500,
            reserveKwh: 60,
            maxPowerOutputKw: 40,
          },
          capabilities: ["power-storage"],
          source: "starter",
        },
        {
          id: "starter-workshop",
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator",
          connectedTo: ["starter-command-module"],
          runtimeAttributes: {
            status: "active",
            constructionJob: {
              blueprintId: "small-solar-array",
              outputModuleId: "small-solar-array-1",
              buildTicks: 180,
              remainingTicks: 180,
              futureModule: {
                id: "small-solar-array-1",
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array",
                connectedTo: [],
                runtimeAttributes: {
                  status: "online",
                  health: 100,
                },
                capabilities: ["power-generation"],
                source: "local",
              },
            },
          },
          capabilities: ["basic-fabrication"],
          source: "starter",
        },
      ],
    });

    try {
      const tickResult = await runHabitat(["tick", "180"], server);
      expect(tickResult.exitCode).toBe(0);
      expect(tickResult.stdout).toContain("Completed Ticks: 0");

      const statusResult = await runHabitat(["construction", "status"], server);
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stdout).toContain("Remaining Ticks");
      expect(statusResult.stdout).toContain("180");
    } finally {
      server.close();
    }
  });
});
