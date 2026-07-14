import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("dashboard loading gate", () => {
  test("keeps the loader independent from dashboard startup", () => {
    const html = readProjectFile("index.html");
    const loader = readProjectFile("loading.js");
    const dashboard = readProjectFile("scripts.js");

    expect(html.indexOf('src="loading.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="loading.js"')).toBeLessThan(html.indexOf('src="scripts.js"'));
    expect(loader).toContain("habitat:ready");
    expect(loader).toContain("is-ready");
    expect(loader).toContain("1500");
    expect(dashboard).toContain("habitat:ready");
    expect(dashboard).not.toContain("classList.add('is-ready')");
  });
});
