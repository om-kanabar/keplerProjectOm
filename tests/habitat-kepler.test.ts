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
                id: "module-1",
                blueprintId: "hab-core",
                displayName: "Habitat Core",
                connectedTo: [],
                runtimeAttributes: {},
                capabilities: ["life-support"],
              },
            ],
            blueprints: [],
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
});
