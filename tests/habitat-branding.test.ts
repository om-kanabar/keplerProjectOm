import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Habitat branding", () => {
  test("uses Habitat for dashboard, CLI examples, and Pages hostname", () => {
    const publicFiles = [
      readProjectFile("index.html"),
      readProjectFile("scripts.js"),
      readProjectFile("src/commands.ts"),
    ];

    expect(publicFiles.join("\n")).not.toMatch(/Cupola/i);
    expect(readProjectFile("CNAME").trim()).toBe("habitat.omkanabar.com");
  });
});
