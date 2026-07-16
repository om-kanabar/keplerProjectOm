import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("web login page", () => {
  test("keeps the loading screen and adds an authenticated dashboard entry point", () => {
    const html = readProjectFile("index.html");
    const app = readProjectFile("app.js");

    expect(html).toContain('id="loading-screen"');
    expect(html).toContain('id="web-auth-form"');
    expect(html).toContain('id="web-login-code"');
    expect(html).toContain('class="auth-passcode-dots"');
    expect(html).toContain('class="dashboard-shell"');
    expect(html).toContain('src="app.js"');
    expect(app).toContain("/auth/web/session");
    expect(app).toContain("/auth/web/verify");
    expect(app).toContain("/status");
    expect(app).toContain("hasReachableHabitat");
    expect(app).toContain("habitat:startup-error");
    expect(app).toContain("UNABLE TO REACH HABITAT SERVER");
    expect(app).toContain("Unable to load Habitat dashboard.");
    expect(app).toContain("dashboardBundleVersion");
    expect(app).toContain("dashboardBundleVersion = '20260715.13'");
    expect(app).toContain("habitat:auth-required");
    expect(app).toContain("habitat:ready");
    expect(app).toContain("is-verifying");
    expect(app).toContain("renderPasscodeDots");
    expect(app).toContain("1500");
    expect(app).toContain("response.text()");
    expect(app).toContain("JSON.parse");
    expect(app).toContain("HTTP");
    expect(app).toContain("adminauth");
    expect(app).toContain("habitat_local_admin");
    expect(readProjectFile("loading.js")).toContain("1500");
    expect(readProjectFile("loading.js")).toContain("is-returning");
    expect(readProjectFile("loading.js")).toContain("dots-only");
  });
});
