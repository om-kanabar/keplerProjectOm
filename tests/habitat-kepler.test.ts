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
      expect(result.stdout).not.toContain("starter-command-module");
      expect(result.stdout).not.toContain("starter-suitport");
    } finally {
      server.close();
    }
  });

  test("module show prints starter module details", async () => {
    const server = await startTestServer();

    try {
      await runHabitat(["register", "--name", "Artemis Ridge"], server);
      const result = await runHabitat(["module", "show", "starter-life-support"], server);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Module");
      expect(result.stdout).toContain("ID: starter-life-support");
      expect(result.stdout).toContain("Blueprint: life-support");
      expect(result.stdout).toContain("Source: starter");
      expect(result.stdout).toContain("atmosphere-control");
      expect(result.stdout).toContain('"status": "active"');
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
      const showResult = await runHabitat(["module", "show", "command_module_1"], server);
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
});
