import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/commands";

const previousToken = process.env.KEPLER_WORLD_TOKEN;
const previousSessionDatabasePath = process.env.HABITAT_WEB_SESSION_DB_PATH;
let sessionDatabaseDirectory = "";

beforeEach(() => {
  sessionDatabaseDirectory = mkdtempSync(join(tmpdir(), "habitat-web-sessions-"));
  process.env.HABITAT_WEB_SESSION_DB_PATH = join(sessionDatabaseDirectory, "sessions.sqlite");
});

afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.KEPLER_WORLD_TOKEN;
  } else {
    process.env.KEPLER_WORLD_TOKEN = previousToken;
  }

  if (previousSessionDatabasePath === undefined) {
    delete process.env.HABITAT_WEB_SESSION_DB_PATH;
  } else {
    process.env.HABITAT_WEB_SESSION_DB_PATH = previousSessionDatabasePath;
  }

  rmSync(sessionDatabaseDirectory, { recursive: true, force: true });
});

describe("web authentication", () => {
  test("issues a short-lived one-time browser code for the configured Kepler token", async () => {
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    const { createApp } = await import("../src/server/app");
    const app = createApp();

    const response = await app.request("/auth/web", {
      method: "POST",
      headers: { Authorization: "Bearer test-kepler-token" },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      code: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  test("allows only one unused code within five minutes", async () => {
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    const { createApp } = await import("../src/server/app");
    const app = createApp();
    const headers = { Authorization: "Bearer test-kepler-token" };

    const firstResponse = await app.request("/auth/web", { method: "POST", headers });
    const secondResponse = await app.request("/auth/web", { method: "POST", headers });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(429);
  });

  test("exchanges a code once and sets a browser session cookie", async () => {
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    const { createApp } = await import("../src/server/app");
    const app = createApp();
    const issueResponse = await app.request("/auth/web", {
      method: "POST",
      headers: { Authorization: "Bearer test-kepler-token" },
    });
    const { code } = await issueResponse.json() as { code: string };

    const verifyResponse = await app.request("/auth/web/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("Set-Cookie")).toContain("HttpOnly");
    const sessionCookie = verifyResponse.headers.get("Set-Cookie")?.split(";")[0];

    const sessionResponse = await app.request("/auth/web/session", {
      headers: { Cookie: sessionCookie ?? "" },
    });

    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual({ authenticated: true });

    const nextCodeResponse = await app.request("/auth/web", {
      method: "POST",
      headers: { Authorization: "Bearer test-kepler-token" },
    });
    expect(nextCodeResponse.status).toBe(201);

    const reusedResponse = await app.request("/auth/web/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    expect(reusedResponse.status).toBe(401);
  });

  test("persists sessions across app restarts and lists metadata without secrets", async () => {
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    const { createApp } = await import("../src/server/app");
    const app = createApp();
    const headers = { Authorization: "Bearer test-kepler-token" };
    const issueResponse = await app.request("/auth/web", { method: "POST", headers });
    const { code } = await issueResponse.json() as { code: string };
    const verifyResponse = await app.request("/auth/web/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const sessionCookie = verifyResponse.headers.get("Set-Cookie")?.split(";")[0] ?? "";

    const restartedApp = createApp();
    const sessionResponse = await restartedApp.request("/auth/web/session", {
      headers: { Cookie: sessionCookie },
    });
    expect(sessionResponse.status).toBe(200);

    const sessionsResponse = await restartedApp.request("/auth/web/sessions", { headers });
    expect(sessionsResponse.status).toBe(200);
    const sessions = await sessionsResponse.json() as { sessions: Array<Record<string, string>> };
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      expiresAt: expect.any(String),
      lastSeenAt: expect.any(String),
    });
    expect(JSON.stringify(sessions)).not.toContain(code);
    expect(JSON.stringify(sessions)).not.toContain(sessionCookie.split("=")[1] ?? "");
  });

  test("rejects a missing or incorrect Kepler token", async () => {
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    const { createApp } = await import("../src/server/app");
    const app = createApp();

    const response = await app.request("/auth/web", { method: "POST" });

    expect(response.status).toBe(401);
  });

  test("reads KEPLER_API_KEY from the environment", async () => {
    const previousWorldToken = process.env.KEPLER_WORLD_TOKEN;
    const previousApiKey = process.env.KEPLER_API_KEY;
    delete process.env.KEPLER_WORLD_TOKEN;
    process.env.KEPLER_API_KEY = "test-api-key";

    try {
      const { createApp } = await import("../src/server/app");
      const app = createApp();
      const response = await app.request("/auth/web", {
        method: "POST",
        headers: { Authorization: "Bearer test-api-key" },
      });

      expect(response.status).toBe(201);
    } finally {
      if (previousWorldToken === undefined) {
        delete process.env.KEPLER_WORLD_TOKEN;
      } else {
        process.env.KEPLER_WORLD_TOKEN = previousWorldToken;
      }

      if (previousApiKey === undefined) {
        delete process.env.KEPLER_API_KEY;
      } else {
        process.env.KEPLER_API_KEY = previousApiKey;
      }
    }
  });

  test("habitat auth web reads the configured token and requests a browser code", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    const originalFetch = globalThis.fetch;
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    process.env.HABITAT_API_BASE_URL = "https://habitat.tailnet.ts.net";
    let request: Request | undefined;

    globalThis.fetch = async (input, init) => {
      request = new Request(input, init);
      return Response.json({ code: "one-time-code", expiresAt: "2026-07-14T12:00:00.000Z" }, { status: 201 });
    };

    try {
      await runCli(["bun", "habitat", "auth", "web"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousBaseUrl === undefined) {
        delete process.env.HABITAT_API_BASE_URL;
      } else {
        process.env.HABITAT_API_BASE_URL = previousBaseUrl;
      }
    }

    expect(request?.url).toBe("https://habitat.tailnet.ts.net/auth/web");
    expect(request?.headers.get("Authorization")).toBe("Bearer test-kepler-token");
  });

  test("habitat web list requests active sessions with the configured token", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    const originalFetch = globalThis.fetch;
    process.env.KEPLER_WORLD_TOKEN = "test-kepler-token";
    process.env.HABITAT_API_BASE_URL = "https://habitat.tailnet.ts.net";
    let request: Request | undefined;

    globalThis.fetch = async (input, init) => {
      request = new Request(input, init);
      return Response.json({ sessions: [] });
    };

    try {
      await runCli(["bun", "habitat", "web", "list"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousBaseUrl === undefined) {
        delete process.env.HABITAT_API_BASE_URL;
      } else {
        process.env.HABITAT_API_BASE_URL = previousBaseUrl;
      }
    }

    expect(request?.url).toBe("https://habitat.tailnet.ts.net/auth/web/sessions");
    expect(request?.headers.get("Authorization")).toBe("Bearer test-kepler-token");
  });
});
