import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("loading page restart", () => {
  test("does not load dashboard wiring while the loading page is retained", () => {
    const html = readProjectFile("index.html");

    expect(html).toContain('src="loading.js"');
    expect(html).not.toContain("HABITAT_API_BASE_URL");
    expect(html).not.toContain('src="scripts.js"');
    expect(html).not.toContain('class="dashboard-content"');
  });
});
