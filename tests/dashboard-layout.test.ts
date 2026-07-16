import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readProjectFile = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Habitat operator console layout", () => {
  test("makes Regular Mode the default overview with operational sections", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('const modes: Array<{ id: DashboardMode; label: string; detail: string }> =');
    expect(dashboard).toContain('id: "regular"');
    expect(dashboard).toContain("RegularModeOverview");
    expect(dashboard).toContain("Alerts");
    expect(dashboard).toContain("Resources");
    expect(dashboard).toContain("Active work");
    expect(dashboard).toContain("Recent activity");
    expect(dashboard).not.toContain("AI chat");
  });

  test("keeps future mode slots without rendering their screens", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('"Display"');
    expect(dashboard).toContain('"Info"');
    expect(dashboard).toContain('className="mode-slider"');
    expect(dashboard).toContain('aria-label="Habitat display mode"');
    expect(dashboard).toContain('setActiveMode(mode.id)');
    expect(dashboard).toContain("ModePlaceholder");
  });

  test("exposes a logout action through the existing web session", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('fetch("/auth/web/session", { method: "DELETE"');
    expect(dashboard).toContain('>Log out</button>');
  });

  test("places habitat subsystems in sidebar navigation", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('const subsystems = ["Overview", "Modules", "Blueprints", "Resources", "Inventory", "Construction", "Alerts", "Forecast", "Humans", "Scan"]');
    expect(dashboard).toContain('aria-label="Habitat subsystems"');
    expect(dashboard).toContain("SubsystemView");
    expect(dashboard).toContain('activeSubsystem === "Overview"');
    expect(dashboard).toContain("System view ready.");
    expect(dashboard).toContain('"Forecast", "Humans", "Scan"');
    expect(dashboard).toContain('label="Forecast"');
    expect(dashboard).toContain('label="Humans"');
    expect(dashboard).toContain('label="Scan"');
  });

  test("loads blueprint details and catalog resources from the live endpoints", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('request<{ blueprint: Blueprint }>(`/catalog/blueprints/${blueprintId}`)');
    expect(dashboard).toContain('request<{ resources: CatalogResource[] }>("/resources")');
    expect(dashboard).toContain('request<{ inventory: InventoryItem[] }>("/inventory")');
    expect(dashboard).toContain("amount > 0");
    expect(dashboard).toContain("Resources required");
    expect(dashboard).toContain("Build");
  });

  test("uses server-owned blueprint and scan routes without browser tick controls", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('request<{ alerts: unknown[] }>("/alerts")');
    expect(dashboard).toContain('request<{ jobs: unknown[] }>("/construction/jobs")');
    expect(dashboard).not.toContain('request("/ticks"');
    expect(dashboard).not.toContain('Advance time');
  });

  test("shows the CLI-supported module states and a registered Habitat greeting", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).toContain('pickOperatingLine');
    expect(dashboard).toContain('inhabitants');
    expect(dashboard).toContain('module-status-select');
    expect(dashboard).toContain('className={`status-chip module-status-select ${status}`}');
    expect(dashboard).toContain('void onStatusChange?.(module.id, nextStatus)');
  });

  test("uses Inter for interface reading and Space Mono only for telemetry", () => {
    const styles = readProjectFile("web/src/dashboard.css");

    const compactStyles = styles.replace(/\s+/g, "");
    expect(compactStyles).toContain('--dashboard-font-ui:"Inter"');
    expect(compactStyles).toContain('--dashboard-font-mono:"SpaceMono"');
    expect(styles.replace(/\s+/g, "")).toContain('--dashboard-accent:#d1bd8e');
    expect(styles).not.toContain("#91bdf3");
    expect(styles).not.toContain("gradient");
  });

  test("does not keep a browser-side custom tick form", () => {
    const dashboard = readProjectFile("web/src/main.tsx");

    expect(dashboard).not.toContain("custom-tick-count");
    expect(dashboard).not.toContain("parseCustomTicks");
  });
});
