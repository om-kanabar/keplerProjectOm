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
    expect(html).toContain('class="dashboard-shell"');
    expect(html).toContain('src="app.js"');
    expect(app).toContain("/auth/web/session");
    expect(app).toContain("/auth/web/verify");
    expect(app).toContain("habitat:auth-required");
    expect(app).toContain("habitat:ready");
    expect(app).toContain("response.text()");
    expect(app).toContain("JSON.parse");
    expect(app).toContain("HTTP");
    expect(readProjectFile("loading.js")).toContain("1500");
    expect(readProjectFile("loading.js")).toContain("is-returning");
  });
});
