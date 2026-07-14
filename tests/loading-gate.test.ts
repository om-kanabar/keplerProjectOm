import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("dashboard loading gate", () => {
  test("keeps only the loading page and build footer during the restart", () => {
    const html = readProjectFile("index.html");
    const loader = readProjectFile("loading.js");

    expect(html.indexOf('src="loading.js"')).toBeGreaterThan(-1);
    expect(html).toContain('id="loading-screen"');
    expect(html).toContain('<footer class="site-footer mt-2">');
    expect(html).toContain('id="build-commit"');
    expect(html).not.toContain('class="main"');
    expect(html).not.toContain('class="dashboard-sidebar"');
    expect(html).not.toContain('class="dashboard-content"');
    expect(html).not.toContain('src="scripts.js"');
    expect(loader).toContain("habitat:ready");
    expect(loader).toContain("is-ready");
    expect(loader).toContain("1500");
  });
});
