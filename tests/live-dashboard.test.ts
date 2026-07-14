import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("live dashboard wiring", () => {
  test("loads live Habitat status before revealing the page", () => {
    const html = readProjectFile("index.html");
    const script = readProjectFile("scripts.js");
    const server = readProjectFile("src/server/app.ts");

    expect(html).toContain("HABITAT_API_BASE_URL");
    expect(script).toContain("/status");
    expect(script).toContain("habitat:ready");
    expect(server).toContain("hono/cors");
  });
});
