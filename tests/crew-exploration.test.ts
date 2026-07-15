import { describe, expect, test } from "bun:test";
import { hydrateStarterHumans } from "../src/humans";

describe("starter humans", () => {
  test("preserves Kepler-provided ids, names, and module locations", () => {
    expect(hydrateStarterHumans([{ id: "human-1", displayName: "Ari", locationModuleId: "suitport-1" }])).toEqual([
      { id: "human-1", displayName: "Ari", locationModuleId: "suitport-1" },
    ]);
  });
});
