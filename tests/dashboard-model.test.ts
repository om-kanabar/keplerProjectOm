import { describe, expect, test } from "bun:test";
import { normalizeStatusSnapshot, parseCustomTicks, pickOperatingLine } from "../web/src/dashboard-model";
import { isAuthSkipPreview } from "../web/src/preview";

describe("dashboard tick input", () => {
  test("accepts positive whole tick values", () => {
    expect(parseCustomTicks("3600")).toBe(3600);
  });

  test("rejects zero, fractions, and non-numeric values", () => {
    expect(parseCustomTicks("0")).toBeNull();
    expect(parseCustomTicks("1.5")).toBeNull();
    expect(parseCustomTicks("one hour")).toBeNull();
  });
});

describe("local auth-skip preview", () => {
  test("allows the preview on any 127.0.0.1 port", () => {
    expect(isAuthSkipPreview({ hostname: "127.0.0.1", port: "5000", search: "?authskip" })).toBe(true);
    expect(isAuthSkipPreview({ hostname: "127.0.0.1", port: "8787", search: "?authskip" })).toBe(true);
    expect(isAuthSkipPreview({ hostname: "localhost", port: "5000", search: "?authskip" })).toBe(false);
    expect(isAuthSkipPreview({ hostname: "127.0.0.1", port: "5000", search: "" })).toBe(false);
  });
});

describe("regular mode dashboard model", () => {
  test("normalizes resources, module states, alerts, and active work", () => {
    const snapshot = normalizeStatusSnapshot({
      registration: { displayName: "Artemis Ridge", status: "registered" },
      modules: [
        { id: "life-support", displayName: "Life Support", blueprintId: "life-support", powerDrawKw: 2.8, runtimeAttributes: { status: "idle" } },
        { id: "fabricator", displayName: "Fabricator", blueprintId: "fabricator", powerDrawKw: 1.2, runtimeAttributes: { status: "active", constructionJob: { remainingTicks: 280, buildTicks: 1000 } } },
      ],
      power: { generationKw: 4, consumptionKw: 3, netPowerKw: 1, batteryChargeKwh: 80, batteryCapacityKwh: 100, batteryReserveKwh: 20, solar: { irradianceWPerM2: 600, condition: "clear" } },
      alerts: [{ id: "a1", key: "low-reserve", severity: "warning", status: "open", source: "power", createdAt: "2026-07-15T10:00:00Z", lastObservedAt: "2026-07-15T10:00:00Z", occurrenceCount: 1 }],
      construction: { jobs: [{ blueprintId: "greenhouse", remainingTicks: 280, buildTicks: 1000, facility: { displayName: "Fabricator" } }] },
    });

    expect(snapshot.resources.find((resource) => resource.id === "battery")?.percent).toBe(80);
    expect(snapshot.modules.map((module) => module.status)).toEqual(["online", "under-construction"]);
    expect(snapshot.alerts[0].severity).toBe("warning");
    expect(snapshot.activeWork[0].kind).toBe("construction");
  });

  test("keeps optional endpoint failures disconnected and hides empty work", () => {
    const snapshot = normalizeStatusSnapshot({ registration: null, modules: [], power: null, alertsError: true, constructionError: true });

    expect(snapshot.connection).toBe("disconnected");
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.activeWork).toEqual([]);
    expect(snapshot.clock).toMatchObject({ mode: "manual", listening: false });
  });

  test("returns bounded operating-system lines without chat copy", () => {
    const line = pickOperatingLine(0);

    expect(line).toContain("humans");
    expect(line.length).toBeLessThan(140);
  });
});
