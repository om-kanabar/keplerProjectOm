import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("dashboard production bundle", () => {
  test("does not leave Node process references in the browser bundle", () => {
    const build = Bun.spawnSync([process.execPath, "run", "build:dashboard"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(build.exitCode).toBe(0);
    const bundle = readFileSync(new URL("../dashboard/dashboard.js", import.meta.url), "utf8");
    expect(bundle).not.toContain("process.env.NODE_ENV");
    expect(bundle).not.toContain("jsxDEV");
  });
});
