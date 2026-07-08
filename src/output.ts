import { formatBlueprintOutput, formatBlueprintValue } from "./blueprints";
import { getModulePowerDrawKw } from "./tick";
import { listModules, moduleCount } from "./modules";
import {
  BatteryRechargeResult,
  BlueprintReference,
  HabitatModule,
  KeplerRegistration,
  ResourceReference,
  TickSimulationResult,
} from "./types";

export function printKeplerRegistration(registration: KeplerRegistration | undefined): void {
  console.log("Kepler Registration");

  if (!registration) {
    console.log("  Not registered");
    return;
  }

  console.log(`  Habitat ID: ${registration.habitatId}`);
  console.log(`  UUID: ${registration.habitatUuid}`);
  console.log(`  Name: ${registration.displayName}`);

  if (registration.habitatSlug) {
    console.log(`  Slug: ${registration.habitatSlug}`);
  }

  if (registration.status) {
    console.log(`  Status: ${registration.status}`);
  }

  if (registration.catalogVersion) {
    console.log(`  Catalog Version: ${registration.catalogVersion}`);
  }

  if (registration.lastSeenAt) {
    console.log(`  Last Seen: ${registration.lastSeenAt}`);
  }

  console.log(`  Modules: ${moduleCount()}`);
  printModuleList(listModules());
}

export function printModuleList(modules: HabitatModule[]): void {
  console.log("Modules");

  if (modules.length === 0) {
    console.log("  No modules found.");
    return;
  }

  for (const line of renderTable(
    ["Module", "Nickname", "Status", "Draw", "Draw per Tick Hour"],
    modules.map((module) => {
      const drawKw = getModulePowerDrawKw(module);

      return [
        module.displayName,
        module.blueprintId,
        formatRuntimeValue(module.runtimeAttributes.status),
        formatUnitValue(drawKw, "kW"),
        formatUnitValue(drawKw, "kWh"),
      ];
    }),
  )) {
    console.log(`  ${line}`);
  }
}

export function printModuleStatus(module: HabitatModule): void {
  console.log("Module Status");
  console.log(`  ID: ${module.id}`);
  console.log(`  Status: ${formatRuntimeValue(module.runtimeAttributes.status)}`);
  console.log(`  Power Draw: ${formatUnitValue(getModulePowerDrawKw(module), "kW")}`);
}

export function printStatusChangeConfirmation(module: HabitatModule): void {
  console.log(`Module ID: ${module.id}`);
  console.log(`Status: ${formatRuntimeValue(module.runtimeAttributes.status)}`);
  console.log(`Power Draw: ${formatUnitValue(getModulePowerDrawKw(module), "kW")}`);
}

export function printModuleDetails(module: HabitatModule): void {
  console.log("Module");
  console.log(`  ID: ${module.id}`);
  console.log(`  Name: ${module.displayName}`);
  console.log(`  Blueprint: ${module.blueprintId}`);
  console.log(`  Source: ${module.source}`);
  console.log(`  Connected To: ${module.connectedTo.length === 0 ? "(none)" : module.connectedTo.join(", ")}`);
  console.log(`  Capabilities: ${module.capabilities.length === 0 ? "(none)" : module.capabilities.join(", ")}`);
  printKeyProperties(module);
  printInputs(module);
  printState(module);
}

export function printBlueprintList(blueprints: BlueprintReference[]): void {
  console.log("Blueprints");

  if (blueprints.length === 0) {
    console.log("  No blueprints found.");
    return;
  }

  for (const line of renderTable(
    ["Name", "Blueprint ID", "Status", "Output"],
    blueprints.map((blueprint) => [
      blueprint.displayName,
      blueprint.blueprintId,
      formatRuntimeValue(blueprint.status),
      formatBlueprintOutput(blueprint) ?? "(none)",
    ]),
  )) {
    console.log(`  ${line}`);
  }
}

export function printBlueprintDetails(blueprint: BlueprintReference): void {
  console.log("Blueprint");
  console.log(`  ID: ${formatBlueprintValue(blueprint.id)}`);
  console.log(`  Blueprint ID: ${blueprint.blueprintId}`);
  console.log(`  Name: ${blueprint.displayName}`);
  console.log(`  Description: ${formatBlueprintValue(blueprint.description)}`);
  console.log(`  Status: ${formatRuntimeValue(blueprint.status)}`);
  console.log(`  Output: ${formatBlueprintOutput(blueprint) ?? "(none)"}`);
  printBlueprintInputs(blueprint.inputs);
  console.log(`  Build Ticks: ${formatBlueprintValue(blueprint.buildTicks)}`);
  console.log(`  Repeatable: ${blueprint.repeatable ? "yes" : "no"}`);
}

export function printResourceList(resources: ResourceReference[]): void {
  console.log("Resources");

  if (resources.length === 0) {
    console.log("  No resources found.");
    return;
  }

  for (const line of renderTable(
    ["Name", "Resource ID", "Status"],
    resources.map((resource) => [
      formatResourceName(resource),
      resource.resourceId,
      formatRuntimeValue(resource.status),
    ]),
  )) {
    console.log(`  ${line}`);
  }
}

export function printTickResult(result: TickSimulationResult): void {
  console.log("Tick Result");
  console.log(`  Requested Ticks: ${result.requestedTicks}`);
  console.log(`  Completed Ticks: ${result.completedTicks}`);
  console.log(`  Stopped Reason: ${result.stoppedReason}`);
  console.log(`  Total Power Draw: ${formatUnitValue(result.totalPowerDrawKw, "kW")}`);
  console.log(`  Energy Consumed: ${formatUnitValue(result.energyConsumedKwh, "kWh")}`);
  console.log(`  Battery Charge Before: ${formatUnitValue(result.batteryChargeBeforeKwh, "kWh")}`);
  console.log(`  Battery Charge After: ${formatUnitValue(result.batteryChargeAfterKwh, "kWh")}`);
}

export function printBatteryRechargeResult(result: BatteryRechargeResult): void {
  console.log("Battery Recharge");
  console.log(`  Requested Ticks: ${result.requestedTicks}`);
  console.log(`  Completed Ticks: ${result.completedTicks}`);
  console.log(`  Stopped Reason: ${result.stoppedReason}`);
  console.log(`  Total Power Draw: ${formatUnitValue(result.totalPowerDrawKw, "kW")}`);
  console.log(`  Energy Added: ${formatUnitValue(result.energyAddedKwh, "kWh")}`);
  console.log(`  Battery Charge Before: ${formatUnitValue(result.batteryChargeBeforeKwh, "kWh")}`);
  console.log(`  Battery Charge After: ${formatUnitValue(result.batteryChargeAfterKwh, "kWh")}`);
}

function printBlueprintInputs(inputs: Record<string, unknown> | undefined): void {
  const rows = formatKeyValueRows(inputs);

  if (rows.length === 0) {
    console.log("  Inputs: (none)");
    return;
  }

  console.log("  Inputs");
  console.log("    Required materials for this blueprint.");

  for (const line of renderTable(["Resource", "Amount"], rows)) {
    console.log(`    ${line}`);
  }
}

function printKeyProperties(module: HabitatModule): void {
  const properties = getKeyProperties(module);

  if (properties.length === 0) {
    return;
  }

  console.log("  Key Properties:");

  for (const property of properties) {
    console.log(`    ${property.label}: ${formatRuntimeValue(property.value)}`);
  }
}

function getKeyProperties(module: HabitatModule): Array<{ label: string; value: unknown }> {
  const genericProperties = [
    createProperty("Status", module.runtimeAttributes.status),
    createProperty("Condition", module.runtimeAttributes.condition),
    createProperty("Health", module.runtimeAttributes.health),
  ];

  const blueprintProperties = getBlueprintSpecificProperties(module);

  return [...genericProperties, ...blueprintProperties].filter(
    (property): property is { label: string; value: unknown } => property !== undefined,
  );
}

function getBlueprintSpecificProperties(module: HabitatModule): Array<{ label: string; value: unknown } | undefined> {
  if (module.blueprintId === "basic-battery" || module.blueprintId === "battery-bank") {
    return [
      createProperty("Current Charge", module.runtimeAttributes.currentEnergyKwh),
      createProperty("Capacity", module.runtimeAttributes.energyStorageKwh),
      createProperty("Reserve", module.runtimeAttributes.reserveKwh),
      createProperty("Max Power Output", module.runtimeAttributes.maxPowerOutputKw),
    ];
  }

  return [];
}

function printInputs(module: HabitatModule): void {
  const sections = getInputSections(module);

  if (sections.length === 0) {
    return;
  }

  console.log("  Inputs");
  console.log("    What this module consumes while running.");

  for (const section of sections) {
    console.log(`    ${section.title}`);
    if (section.unit) {
      console.log(`      ${section.unit}`);
    }

    for (const line of renderTable(
      ["Field", "Value"],
      section.items.map((item) => [item.label, formatRuntimeValue(item.value)]),
    )) {
      console.log(`      ${line}`);
    }
  }
}

function printState(module: HabitatModule): void {
  const rows = getStateRows(module);

  if (rows.length === 0) {
    return;
  }

  console.log("  State");
  console.log("    Current or initial device state after construction.");

  for (const row of rows) {
    console.log(`    ${row.label}`);
    console.log(`      ${formatRuntimeValue(row.value)}`);
  }
}

function getInputSections(
  module: HabitatModule,
): Array<{ title: string; unit?: string; items: Array<{ label: string; value: unknown }> }> {
  const sections: Array<{ title: string; unit?: string; items: Array<{ label: string; value: unknown }> }> = [];

  const powerDraw = module.runtimeAttributes.powerDrawKw;
  if (powerDraw && typeof powerDraw === "object") {
    const powerDrawEntries = Object.entries(powerDraw as Record<string, unknown>).map(([key, value]) => ({
      label: capitalizeWord(key),
      value,
    }));

    if (powerDrawEntries.length > 0) {
      sections.push({
        title: "Power draw by state",
        unit: "kW",
        items: powerDrawEntries,
      });
    }
  }

  if (module.runtimeAttributes.oxygenUseKgPerHour !== undefined) {
    sections.push({
      title: "Oxygen use while occupied",
      unit: "kg/hr",
      items: [{ label: "Rate", value: module.runtimeAttributes.oxygenUseKgPerHour }],
    });
  }

  return sections;
}

function getStateRows(module: HabitatModule): Array<{ label: string; value: unknown }> {
  return [
    createProperty("Health", module.runtimeAttributes.health),
    createProperty("Initial status", module.runtimeAttributes.status),
    createProperty("Crew access capacity", module.runtimeAttributes.crewAccessCapacity),
    createProperty("Suit oxygen remaining, kg", module.runtimeAttributes.suitOxygenRemainingKg),
    createProperty("Suit oxygen capacity, kg", module.runtimeAttributes.suitOxygenCapacityKg),
  ].filter((row): row is { label: string; value: unknown } => row !== undefined);
}

function capitalizeWord(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatKeyValueRows(values: Record<string, unknown> | undefined): string[][] {
  if (!values || typeof values !== "object") {
    return [];
  }

  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, formatBlueprintValue(value)]);
}

function createProperty(label: string, value: unknown): { label: string; value: unknown } | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return { label, value };
}

function formatRuntimeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(unknown)";
  }

  return String(value);
}

function formatUnitValue(value: number, unit: string): string {
  return `${formatDecimal(value)} ${unit}`;
}

function renderTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => formatTableCell(row[index]).length)),
  );
  const separator = `|-${widths.map((width) => "-".repeat(width)).join("-|-")}-|`;
  const header = `| ${headers.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell, index) => formatTableCell(cell).padEnd(widths[index])).join(" | ")} |`);

  return [separator, header, separator, ...body, separator];
}

function formatDecimal(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatTableCell(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(none)";
  }

  return String(value);
}

function formatResourceName(resource: ResourceReference): string {
  return (
    resource.displayName ??
    resource.name ??
    resource.resourceId ??
    (typeof resource.id === "string" ? resource.id : undefined) ??
    "(unknown)"
  );
}
