import type { ConstructionReadiness } from "./construction";
import { formatBlueprintOutput, formatBlueprintValue, getBlueprintRequiredFacility } from "./blueprints";
import { getModulePowerDrawKw } from "./tick";
import { listModules, moduleCount } from "./modules";
import {
  BatteryRechargeResult,
  BlueprintReference,
  HabitatModule,
  InventoryRecord,
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
        formatModuleStatusValue(module.runtimeAttributes.status),
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
  console.log(`  Status: ${formatModuleStatusValue(module.runtimeAttributes.status)}`);
  console.log(`  Power Draw: ${formatUnitValue(getModulePowerDrawKw(module), "kW")}`);
}

export function printStatusChangeConfirmation(module: HabitatModule): void {
  console.log(`Module ID: ${module.id}`);
  console.log(`Status: ${formatModuleStatusValue(module.runtimeAttributes.status)}`);
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
  printConstructionJob(module);
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
  const requiredFacility = getBlueprintRequiredFacility(blueprint);
  if (requiredFacility) {
    console.log(`  Required Facility: ${requiredFacility}`);
  }
  console.log(`  Output: ${formatBlueprintOutput(blueprint) ?? "(none)"}`);
  printBlueprintInputs(blueprint.inputs);
  console.log(`  Build Ticks: ${formatBlueprintValue(blueprint.buildTicks)}`);
  console.log(`  Repeatable: ${blueprint.repeatable ? "yes" : "no"}`);
  if (Array.isArray(blueprint.capabilities)) {
    console.log(`  Capabilities: ${blueprint.capabilities.join(", ") || "(none)"}`);
  }
  if (blueprint.runtimeAttributes && typeof blueprint.runtimeAttributes === "object") {
    printBlueprintRuntimeAttributes(blueprint.runtimeAttributes as Record<string, unknown>);
  }
}

export function printResourceList(resources: Array<ResourceReference & { amount?: number }>): void {
  console.log("Resources");

  if (resources.length === 0) {
    console.log("  No resources found.");
    return;
  }

  for (const line of renderTable(
    ["Name", "Resource ID", "Status", "Amount"],
    resources.map((resource) => [
      formatResourceName(resource),
      resource.resourceId,
      formatRuntimeValue(resource.status),
      formatDecimal(resource.amount ?? 0),
    ]),
  )) {
    console.log(`  ${line}`);
  }
}

export function printServerRecord(title: string, values: Record<string, unknown>): void {
  console.log(title);

  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));

  if (rows.length === 0) {
    console.log("  No data returned.");
    return;
  }

  for (const [key, value] of rows) {
    if (isPlainRecord(value)) {
      console.log(`  ${capitalizeWord(key)}`);
      for (const line of renderTable(
        ["Field", "Value"],
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([field, nestedValue]) => [field, formatStructuredValue(nestedValue)]),
      )) {
        console.log(`    ${line}`);
      }
      continue;
    }

    console.log(`  ${key}: ${formatStructuredValue(value)}`);
  }
}

export function printServerCollection(
  title: string,
  entries: Record<string, unknown>[],
  preferredColumns: string[],
): void {
  console.log(title);

  if (entries.length === 0) {
    console.log("  No entries found.");
    return;
  }

  const columns = getPreferredColumns(entries, preferredColumns);

  for (const line of renderTable(
    columns,
    entries.map((entry) => columns.map((column) => formatStructuredValue(entry[column]))),
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

  if ((result.completedConstructionModuleIds ?? []).length > 0) {
    console.log("  Completed Construction");
    for (const moduleId of result.completedConstructionModuleIds ?? []) {
      console.log(`    ${moduleId}`);
    }
  }
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

export function printInventoryList(inventory: InventoryRecord): void {
  console.log("Inventory");

  const rows = Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, amount]) => [resourceId, formatDecimal(amount)]);

  if (rows.length === 0) {
    console.log("  No inventory found.");
    return;
  }

  for (const line of renderTable(["Resource", "Amount"], rows)) {
    console.log(`  ${line}`);
  }
}

export function printConstructionDryRun(readiness: ConstructionReadiness): void {
  console.log("Construction Dry Run");
  console.log(`  Blueprint: ${readiness.blueprintId}`);
  console.log(`  Required Facility: ${readiness.requiredFacility}`);
  console.log(`  Output Module Type: ${readiness.outputModuleType}`);
  console.log(`  Output Module ID: ${readiness.outputModuleId}`);
  console.log(`  Build Ticks: ${readiness.buildTicks}`);
  console.log(`  Facility Exists: ${formatYesNo(readiness.facilityExists)}`);
  console.log(`  Facility Available: ${formatYesNo(readiness.facilityAvailable)}`);
  console.log(`  Supply Cache Online: ${formatYesNo(readiness.supplyCacheOnline)}`);
  console.log(`  Prerequisites Met: ${formatYesNo(readiness.prerequisitesMet)}`);
  console.log(`  Inventory Ready: ${formatYesNo(readiness.inventoryReady)}`);
  console.log(`  Usable Power: ${formatYesNo(readiness.usablePower)}`);
  console.log(`  Can Start: ${formatYesNo(readiness.canStart)}`);

  console.log("  Resources To Spend");
  for (const line of renderTable(
    ["Resource", "Amount"],
    Object.entries(readiness.requiredResources).map(([resourceId, amount]) => [resourceId, formatDecimal(amount)]),
  )) {
    console.log(`    ${line}`);
  }

  if (Object.keys(readiness.missingResources).length > 0) {
    console.log("  Missing Resources");
    for (const line of renderTable(
      ["Resource", "Missing"],
      Object.entries(readiness.missingResources).map(([resourceId, amount]) => [resourceId, formatDecimal(amount)]),
    )) {
      console.log(`    ${line}`);
    }
  }
}

export function printConstructionStarted(result: {
  blueprintId: string;
  outputModuleId: string;
  remainingTicks: number;
  facilityName: string;
}): void {
  console.log(`Started construction for "${result.blueprintId}".`);
  console.log(`Facility: ${result.facilityName}`);
  console.log(`Output Module ID: ${result.outputModuleId}`);
  console.log(`Remaining Ticks: ${result.remainingTicks}`);
}

export function printConstructionStatus(jobs: Array<{ facility: HabitatModule; remainingTicks: number; blueprintId: string }>): void {
  console.log("Construction Jobs");

  if (jobs.length === 0) {
    console.log("  No active construction jobs.");
    return;
  }

  for (const line of renderTable(
    ["Facility", "Blueprint", "Remaining Ticks"],
    jobs.map((job) => [job.facility.displayName, job.blueprintId, formatDecimal(job.remainingTicks)]),
  )) {
    console.log(`  ${line}`);
  }
}

export function printConstructionCanceled(facilityName: string, blueprintId: string): void {
  console.log(`Canceled construction job on "${facilityName}".`);
  console.log(`Blueprint: ${blueprintId}`);
  console.log("Materials already spent were not refunded.");
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
    createProperty("Status", formatModuleStatusValue(module.runtimeAttributes.status)),
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

    if (section.title === "Power draw by state") {
      for (const line of renderTable(
        ["Resource", "Amount"],
        section.items.map((item) => [item.label, formatTableAmount(item.value)]),
      )) {
        console.log(`      ${line}`);
      }
      continue;
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

function printConstructionJob(module: HabitatModule): void {
  const job = module.runtimeAttributes.constructionJob;

  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return;
  }

  const constructionJob = job as Record<string, unknown>;
  console.log("  Active Construction Job:");
  console.log(`    Blueprint: ${formatRuntimeValue(constructionJob.blueprintId)}`);
  console.log(`    Output Module ID: ${formatRuntimeValue(constructionJob.outputModuleId)}`);
  console.log(`    Build Ticks: ${formatRuntimeValue(constructionJob.buildTicks)}`);
  console.log(`    Remaining Ticks: ${formatRuntimeValue(constructionJob.remainingTicks)}`);
}

function printBlueprintRuntimeAttributes(runtimeAttributes: Record<string, unknown>): void {
  const rows = formatKeyValueRows(runtimeAttributes);

  if (rows.length === 0) {
    return;
  }

  console.log("  Runtime Attributes");
  for (const [key, value] of rows) {
    console.log(`    ${key}: ${value}`);
  }
}

function getInputSections(
  module: HabitatModule,
): Array<{ title: string; unit?: string; items: Array<{ label: string; value: unknown }> }> {
  const sections: Array<{ title: string; unit?: string; items: Array<{ label: string; value: unknown }> }> = [];

  const powerDraw = module.runtimeAttributes.powerDrawKw;
  if (powerDraw && typeof powerDraw === "object") {
    const powerDrawEntries = Object.entries(powerDraw as Record<string, unknown>).map(([key, value]) => ({
      label: formatModuleStatusValue(key),
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
    createProperty("Initial status", formatModuleStatusValue(module.runtimeAttributes.status)),
    createProperty("Crew access capacity", module.runtimeAttributes.crewAccessCapacity),
    createProperty("Suit oxygen remaining, kg", module.runtimeAttributes.suitOxygenRemainingKg),
    createProperty("Suit oxygen capacity, kg", module.runtimeAttributes.suitOxygenCapacityKg),
  ].filter((row): row is { label: string; value: unknown } => row !== undefined);
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

function formatModuleStatusValue(value: unknown): string {
  const status = formatRuntimeValue(value);

  if (status === "idle") {
    return "online";
  }

  return status;
}

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatUnitValue(value: number, unit: string): string {
  return `${formatDecimal(value)} ${unit}`;
}

function formatTableAmount(value: unknown): string {
  if (typeof value === "number") {
    return formatDecimal(value);
  }

  return formatRuntimeValue(value);
}

function formatStructuredValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(none)";
  }

  if (typeof value === "number") {
    return formatDecimal(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function capitalizeWord(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`;
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

function getPreferredColumns(entries: Record<string, unknown>[], preferredColumns: string[]): string[] {
  const entryKeys = new Set(entries.flatMap((entry) => Object.keys(entry)));
  const selected = preferredColumns.filter((column) => entryKeys.has(column));

  if (selected.length > 0) {
    return selected;
  }

  return Object.keys(entries[0] ?? {}).slice(0, 4);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
