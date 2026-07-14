import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/commands";

const previousToken = process.env.KEPLER_WORLD_TOKEN;

afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.KEPLER_WORLD_TOKEN;
  } else {
    process.env.KEPLER_WORLD_TOKEN = previousToken;
  }
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

    const reusedResponse = await app.request("/auth/web/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    expect(reusedResponse.status).toBe(401);
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
});
