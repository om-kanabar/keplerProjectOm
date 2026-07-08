import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

let workdir = "";

const HABITAT_BIN = process.env.HABITAT_BIN ?? "/Users/Om/.bun/bin/habitat";

function dataPath(): string {
  return join(workdir, ".habitat-data.json");
}

function modulesPath(): string {
  return join(workdir, "habitat-modules.json");
}

function readData(): Record<string, unknown> {
  return JSON.parse(readFileSync(dataPath(), "utf8")) as Record<string, unknown>;
}

function writeData(data: Record<string, unknown>): void {
  writeFileSync(dataPath(), JSON.stringify(data, null, 2));
}

async function startTestServer(): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const port = await getFreePort();
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
                  status: "idle",
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
                  status: "idle",
                  health: 100,
                },
                capabilities: ["suitport-access"],
              },
            ],
            blueprints: [
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
                inputs: {},
                buildTicks: 100,
                repeatable: true,
              },
              {
                id: "blueprint-4",
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
            ],
          },
          { status: 201 },
        );
      }

      if (request.method === "GET" && url.pathname === "/habitats/habitat-server-123") {
        return Response.json({
          habitat: {
            id: "habitat-server-123",
            habitatSlug: "artemis-ridge",
            displayName: "Artemis Ridge",
            catalogVersion: "2026-06-24",
            status: "operational",
            lastSeenAt: "2026-07-06T12:00:00.000Z",
          },
        });
      }

      if (request.method === "DELETE" && url.pathname === "/habitats/habitat-server-123") {
        return new Response(null, { status: 204 });
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
            status: "idle",
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
            status: "idle",
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
    writeFileSync(
      dataPath(),
      JSON.stringify(
        {
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
                status: "idle",
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
                status: "idle",
              },
              capabilities: ["suitport-access"],
              source: "starter",
            },
          ],
        },
        null,
        2,
      ),
    );

    try {
      const result = await runHabitat(["status"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "GET",
        path: "/habitats/habitat-server-123",
      });
      expect(result.stdout).toContain("Kepler Registration");
      expect(result.stdout).toContain("Habitat ID: habitat-server-123");
      expect(result.stdout).toContain("Status: operational");
      expect(result.stdout).toContain("Catalog Version: 2026-06-24");
      expect(result.stdout).toContain("Modules: 6");
      expect(result.stdout).toContain("Current Battery Level: 500 / 500 kWh");
      expect(result.stdout).toContain("Drain Per Tick: 0 kWh");
      expect(result.stdout).toContain("Drain Per Tick Hour: 0 kWh");
      expect(result.stdout).toContain("Power Draw");
      expect(result.stdout).toContain("| Module              | Status  | Draw | Draw per Tick Hour |");
      expect(result.stdout).toContain("| Command Module      | active  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Life Support        | active  | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("| Basic Battery       | offline | 0 kW | 0 kWh              |");
      expect(result.stdout).toContain("- Command Module | command-module | status=active");
      expect(result.stdout).toContain("- Basic Battery | basic-battery | status=offline");
    } finally {
      server.close();
    }
  });

  test("unregister deletes the remote habitat and clears local registration", async () => {
    const server = await startTestServer();
    writeFileSync(
      dataPath(),
      JSON.stringify(
        {
          zones: [],
          doors: [],
          airlocks: [],
          mapPlacements: [],
          keplerRegistration: {
            habitatUuid: "11111111-1111-4111-8111-111111111111",
            habitatId: "habitat-server-123",
            displayName: "Artemis Ridge",
          },
        },
        null,
        2,
      ),
    );

    try {
      const result = await runHabitat(["unregister"], server);

      expect(result.exitCode).toBe(0);
      expect(server.requests[0]).toMatchObject({
        method: "DELETE",
        path: "/habitats/habitat-server-123",
      });
      expect(result.stdout).toContain('Unregistered habitat "Artemis Ridge".');
      expect(readData().keplerRegistration).toBeUndefined();
    } finally {
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
      expect(result.stdout).toContain("Command Module");
      expect(result.stdout).toContain("command-module");
      expect(result.stdout).toContain("Basic Suitport");
      expect(result.stdout).toContain("status=active");
      expect(result.stdout).toContain("status=idle");
      expect(result.stdout).toContain("condition=(unknown)");
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

  test("blueprint list shows cached kepler blueprints with basic-start markers", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["blueprint", "list"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Blueprints");
      expect(result.stdout).toContain("Command Module Blueprint | Basic Start | command-module | command-module");
      expect(result.stdout).toContain("Basic Battery Blueprint | Basic Start | basic-battery | basic-battery");
      expect(result.stdout).toContain("Survey Rover Blueprint | survey-rover");
    } finally {
      server.close();
    }
  });

  test("module create stores a new local module", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(
        [
          "module",
          "create",
          "--blueprint",
          "storage-module",
          "--name",
          "Cargo Annex",
          "--connect",
          "starter-command-module",
          "--capability",
          "bulk-storage",
          "--runtime-attributes",
          '{"status":"active","health":88}',
        ],
        server,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Created module "Cargo Annex".');
      expect(result.stdout).toContain("Blueprint: storage-module");

      const modules = readData().modules as Array<Record<string, unknown>>;
      const created = modules.find((module) => module.displayName === "Cargo Annex");

      expect(created).toMatchObject({
        blueprintId: "storage-module",
        displayName: "Cargo Annex",
        connectedTo: ["starter-command-module"],
        capabilities: ["bulk-storage"],
        source: "local",
        runtimeAttributes: {
          status: "active",
          health: 88,
        },
      });
      expect(created?.id).toEqual(expect.any(String));
    } finally {
      server.close();
    }
  });

  test("module create rejects blueprint ids that are not in the cached kepler catalog", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(
        ["module", "create", "--blueprint", "made-up-blueprint", "--name", "Ghost Module"],
        server,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Blueprint "made-up-blueprint" is not available in this habitat.');
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
            status: "idle",
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
            status: "idle",
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
            status: "idle",
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

  test("module set-status updates only runtime status, validates values, and writes habitat-modules.json", async () => {
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
            status: "idle",
            health: 100,
            powerDrawKw: {
              offline: 0,
              idle: 0.25,
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

      const modulesFile = JSON.parse(readFileSync(modulesPath(), "utf8")) as Array<Record<string, unknown>>;
      expect(modulesFile[0]).toMatchObject({
        id: "starter-command-module",
        runtimeAttributes: {
          status: "active",
          health: 100,
        },
      });

      const invalidResult = await runHabitat(["module", "set-status", "starter-command-module", "broken"], server);
      expect(invalidResult.exitCode).toBe(1);
      expect(invalidResult.stderr).toContain(
        "Status must be one of: offline, idle, online, active, damaged.",
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
            status: "offline",
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
          power: { batteryChargeKwh: number; drainPerTickHourKwh: number };
        };
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.data.registration.habitatId).toBe("habitat-server-123");
      expect(parsed.data.registration.status).toBe("operational");
      expect(parsed.data.power.batteryChargeKwh).toBe(500);
      expect(parsed.data.power.drainPerTickHourKwh).toBeCloseTo(0.8888888889, 10);
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
            status: "idle",
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
            status: "offline",
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
            status: "offline",
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
            status: "offline",
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
            status: "offline",
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

  test("tick rejects non-positive and non-integer counts", async () => {
    const server = await startTestServer();

    try {
      const zeroResult = await runHabitat(["tick", "0"], server);
      expect(zeroResult.exitCode).toBe(1);
      expect(zeroResult.stderr).toContain("Tick count must be a non-zero integer.");

      const decimalResult = await runHabitat(["tick", "1.5"], server);
      expect(decimalResult.exitCode).toBe(1);
      expect(decimalResult.stderr).toContain("Tick count must be a non-zero integer.");
    } finally {
      server.close();
    }
  });

  test("tick with a negative count recharges batteries using the same power draw rate", async () => {
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
      const result = await runHabitat(["tick", "-500"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: -500");
      expect(result.stdout).toContain("Completed Ticks: -500");
      expect(result.stdout).toContain("Stopped Reason: completed");
      expect(result.stdout).toContain("Total Power Draw: 3 kW");
      expect(result.stdout).toContain("Energy Consumed: -0.416667 kWh");
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

  test("tick with a negative count stops charging at combined battery capacity", async () => {
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
            status: "offline",
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
            status: "offline",
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
      const result = await runHabitat(["tick", "-10"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Requested Ticks: -10");
      expect(result.stdout).toContain("Completed Ticks: -3");
      expect(result.stdout).toContain("Stopped Reason: capacity_reached");
      expect(result.stdout).toContain("Energy Consumed: -3 kWh");
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

  test("tick accepts hour shorthand and converts one hour to 1600 ticks", async () => {
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
            status: "offline",
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
      expect(result.stdout).toContain("Requested Ticks: 1600");
      expect(result.stdout).toContain("Completed Ticks: 1600");
      expect(result.stdout).toContain("Energy Consumed: 1.333333 kWh");
      expect(result.stdout).toContain("Battery Charge After: 498.666667 kWh");
    } finally {
      server.close();
    }
  });

  test("tick accepts multi-hour shorthand and converts two hour to 3200 ticks", async () => {
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
            status: "offline",
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
      expect(result.stdout).toContain("Requested Ticks: 3200");
      expect(result.stdout).toContain("Completed Ticks: 3200");
      expect(result.stdout).toContain("Energy Consumed: 2.666667 kWh");
      expect(result.stdout).toContain("Battery Charge After: 497.333333 kWh");
    } finally {
      server.close();
    }
  });

  test("tick over-request in reverse still completes the final tick to full battery", async () => {
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
            status: "offline",
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
      const result = await runHabitat(["tick", "-4238905713895"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Completed Ticks: -1");
      expect(result.stdout).toContain("Stopped Reason: capacity_reached");
      expect(result.stdout).toContain("Energy Consumed: -0.0025 kWh");
      expect(result.stdout).toContain("Battery Charge After: 500 kWh");

      const battery = (readData().modules as Array<Record<string, unknown>>).find(
        (module) => module.id === "starter-basic-battery",
      ) as { runtimeAttributes: { currentEnergyKwh: number } };

      expect(battery.runtimeAttributes.currentEnergyKwh).toBe(500);
    } finally {
      server.close();
    }
  });
});
