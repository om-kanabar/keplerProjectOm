#!/usr/bin/env bun

import { Command } from "commander";
import { formatBlueprintOutput, isBasicStartBlueprint, listBlueprints } from "./blueprints";
import { fetchKeplerRegistration, registerWithKepler, unregisterFromKepler } from "./kepler";
import { createModule, deleteModule, getModule, listModules, moduleCount, setModuleStatus, updateModule } from "./modules";
import { getModulePowerDrawKw, runTickSimulation, summarizePowerState } from "./tick";
import packageJson from "../package.json";
import { BlueprintReference, HabitatModule, KeplerRegistration, RuntimeAttributes, TickSimulationResult } from "./types";

const JSON_MODE = process.argv.includes("--json");
let jsonResponse: unknown;

function fail(message: string): never {
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function formatCommanderMessage(message: string): string {
  return message.replace(/^error: /, "");
}

function commandHelpFor(args: string[]): string {
  if (args[0] === "register") {
    return [
      'Usage: habitat register --name "<habitat name>"',
      'Example: habitat register --name "Cupola"',
    ].join("\n");
  }

  if (args[0] === "status") {
    return ["Usage: habitat status", "Example: habitat status"].join("\n");
  }

  if (args[0] === "tick") {
    return [
      "Usage: habitat tick <count>",
      "Usage: habitat tick <count> hour",
      "Example: habitat tick 60",
      "Example: habitat tick -500",
      "Example: habitat tick 1 hour",
    ].join("\n");
  }

  if (args[0] === "unregister") {
    return ["Usage: habitat unregister", "Example: habitat unregister"].join("\n");
  }

  if (args[0] === "module" && args[1] === "show") {
    return ["Usage: habitat module show <moduleId>", "Example: habitat module show starter-command-module"].join(
      "\n",
    );
  }

  if (args[0] === "module" && args[1] === "set-status") {
    return [
      "Usage: habitat module set-status <moduleId> <status>",
      "Example: habitat module set-status starter-command-module active",
    ].join("\n");
  }

  if (args[0] === "module" && args[2] === "status") {
    return ["Usage: habitat module <moduleId> status", "Example: habitat module command-module status"].join(
      "\n",
    );
  }

  if (args[0] === "module" && args[2] === "info") {
    return ["Usage: habitat module <moduleId> info", "Example: habitat module command-module info"].join("\n");
  }

  if (args[0] === "module" && args[1] === "delete") {
    return ["Usage: habitat module delete <moduleId>", "Example: habitat module delete local-module-1"].join(
      "\n",
    );
  }

  if (args[0] === "module" && args[1] === "create") {
    return [
      'Usage: habitat module create --blueprint <blueprintId> --name "<display name>"',
      'Example: habitat module create --blueprint storage-module --name "Cargo Annex"',
    ].join("\n");
  }

  if (args[0] === "blueprint" && args[1] === "list") {
    return ["Usage: habitat blueprint list", "Example: habitat blueprint list"].join("\n");
  }

  if (args[0] === "module" && args[1] === "update") {
    return [
      "Usage: habitat module update <moduleId> [options]",
      'Example: habitat module update command-module --status maintenance --condition 87',
    ].join("\n");
  }

  return "Try 'habitat --help' to see available commands.";
}

function failCommanderError(error: Error, code: unknown): never {
  const args = stripJsonArgs(process.argv).slice(2);

  if (
    code === "commander.unknownCommand" ||
    code === "commander.excessArguments" ||
    code === "commander.excessArgumentsUnknownCommand"
  ) {
    fail(
      [
        `Unknown command: ${args.join(" ") || "(none)"}`,
        "Try 'habitat --help' to see available commands.",
      ].join("\n"),
    );
  }

  if (code === "commander.unknownOption") {
    fail(
      [
        formatCommanderMessage(error.message),
        "Try 'habitat --help' to see available options.",
      ].join("\n"),
    );
  }

  if (
    code === "commander.missingArgument" ||
    code === "commander.optionMissingArgument" ||
    code === "commander.missingMandatoryOptionValue" ||
    code === "commander.excessArguments"
  ) {
    fail([formatCommanderMessage(error.message), commandHelpFor(args)].join("\n"));
  }

  if (
    code === "commander.help" ||
    code === "commander.helpDisplayed" ||
    code === "commander.version"
  ) {
    process.exit(0);
  }

  throw error;
}

function respond(data: unknown, renderText: () => void): void {
  if (JSON_MODE) {
    jsonResponse = data;
    return;
  }

  renderText();
}

function printKeplerRegistration(registration: KeplerRegistration | undefined): void {
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
  printPowerSummary(listModules());
  printModuleList(listModules());
}

function parseJsonObject(value: string, label: string): RuntimeAttributes {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as RuntimeAttributes;
}

function printModuleSummary(module: HabitatModule): void {
  console.log(
    `- ${module.displayName} | ${module.blueprintId} | status=${formatRuntimeValue(module.runtimeAttributes.status)} | condition=${formatRuntimeValue(module.runtimeAttributes.condition)}`,
  );
}

function printTickResult(result: TickSimulationResult): void {
  console.log("Tick Result");
  console.log(`  Requested Ticks: ${result.requestedTicks}`);
  console.log(`  Completed Ticks: ${result.completedTicks}`);
  console.log(`  Stopped Reason: ${result.stoppedReason}`);
  console.log(`  Total Power Draw: ${formatUnitValue(result.totalPowerDrawKw, "kW")}`);
  console.log(`  Energy Consumed: ${formatUnitValue(result.energyConsumedKwh, "kWh")}`);
  console.log(`  Battery Charge Before: ${formatUnitValue(result.batteryChargeBeforeKwh, "kWh")}`);
  console.log(`  Battery Charge After: ${formatUnitValue(result.batteryChargeAfterKwh, "kWh")}`);
}

function printStatusChangeConfirmation(module: HabitatModule): void {
  console.log(`Module ID: ${module.id}`);
  console.log(`Status: ${formatRuntimeValue(module.runtimeAttributes.status)}`);
  console.log(`Power Draw: ${formatUnitValue(getModulePowerDrawKw(module), "kW")}`);
}

function printModuleStatus(module: HabitatModule): void {
  console.log("Module Status");
  console.log(`  ID: ${module.id}`);
  console.log(`  Status: ${formatRuntimeValue(module.runtimeAttributes.status)}`);
  console.log(`  Power Draw: ${formatUnitValue(getModulePowerDrawKw(module), "kW")}`);
}

function printModuleList(modules: HabitatModule[]): void {
  console.log("Modules");

  if (modules.length === 0) {
    console.log("  No modules found.");
    return;
  }

  for (const module of modules) {
    printModuleSummary(module);
  }
}

function printPowerSummary(modules: HabitatModule[]): void {
  const summary = summarizePowerState(modules);

  console.log(`  Current Battery Level: ${formatDecimal(summary.batteryChargeKwh)} / ${formatDecimal(summary.batteryCapacityKwh)} kWh`);
  console.log(`  Drain Per Tick: ${formatUnitValue(summary.drainPerTickKwh, "kWh")}`);
  console.log(`  Drain Per Tick Hour: ${formatUnitValue(summary.drainPerTickHourKwh, "kWh")}`);
  console.log("  Power Draw");
  for (const line of renderTable(
    ["Module", "Status", "Draw", "Draw per Tick Hour"],
    summary.rows.map((row) => [
      row.displayName,
      row.status,
      formatUnitValue(row.drawKw, "kW"),
      formatUnitValue(row.drawPerTickHourKwh, "kWh"),
    ]),
  )) {
    console.log(`    ${line}`);
  }
}

function printModuleDetails(module: HabitatModule): void {
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

function printBlueprintSummary(blueprint: BlueprintReference, modules: HabitatModule[]): void {
  const parts = [blueprint.displayName];

  if (isBasicStartBlueprint(blueprint.blueprintId, modules)) {
    parts.push("Basic Start");
  }

  parts.push(blueprint.blueprintId);

  const output = formatBlueprintOutput(blueprint);

  if (output) {
    parts.push(output);
  }

  console.log(`- ${parts.join(" | ")}`);
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
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const separator = `|-${widths.map((width) => "-".repeat(width)).join("-|-")}-|`;
  const header = `| ${headers.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`);

  return [separator, header, separator, ...body, separator];
}

function formatDecimal(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(6).replace(/\.?0+$/, "");
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

    for (const item of section.items) {
      console.log(`      ${item.label}`);
      console.log(`        ${formatRuntimeValue(item.value)}`);
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
      items: [{ label: "", value: module.runtimeAttributes.oxygenUseKgPerHour }],
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

function createProperty(label: string, value: unknown): { label: string; value: unknown } | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return { label, value };
}

const program = new Command();

program
  .name("habitat")
  .description("Habitat CLI for Kepler registration.")
  .version(`${packageJson.version}-alpha-om`)
  .allowExcessArguments(false)
  .exitOverride()
  .addHelpCommand(false)
  .configureOutput({
    writeErr: () => {},
  });

program.addHelpText(
  "after",
  [
    "",
    "Environment:",
    "  KEPLER_WORLD_TOKEN, PLANET_TOKEN, or KEPLER_PLANET_TOKEN",
    "  KEPLER_WORLD_BASE_URL or PLANET_SERVER_PUBLIC_BASE_URL",
    "",
    "Examples:",
    '  habitat register --name "Cupola"',
    "  habitat status",
    "  habitat module list",
    "  habitat unregister",
    "",
  ].join("\n"),
);

program
  .command("register")
  .description("Register this habitat with Kepler.")
  .requiredOption("--name <habitatName>", "habitat display name")
  .addHelpText(
    "after",
    [
      "",
      "Syntax:",
      '  habitat register --name "<habitat name>"',
      "",
      "Example:",
      '  habitat register --name "Cupola"',
      "",
    ].join("\n"),
  )
  .action(async (options: { name: string }) => {
    try {
      const registration = await registerWithKepler(options.name);
      respond({ registration }, () => {
        console.log(`Registered habitat "${registration.displayName}".`);
        console.log(`Habitat ID: ${registration.habitatId}`);
        console.log(`UUID: ${registration.habitatUuid}`);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to register habitat.");
    }
  });

program
  .command("status")
  .description("Show Kepler registration status.")
  .action(async () => {
    try {
      const registration = await fetchKeplerRegistration();
      const modules = listModules();
      const power = summarizePowerState(modules);
      respond({ registration, power, modules }, () => {
        printKeplerRegistration(registration);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read Kepler status.");
    }
  });

const moduleCommand = program.command("module").description("Manage local habitat modules.");
const blueprintCommand = program.command("blueprint").description("Inspect cached Kepler blueprints.");

moduleCommand
  .command("list")
  .description("List local habitat modules.")
  .action(() => {
    const modules = listModules();
    respond({ modules }, () => {
      printModuleList(modules);
    });
  });

blueprintCommand
  .command("list")
  .description("List cached Kepler blueprints.")
  .action(() => {
    const blueprints = listBlueprints();
    const modules = listModules();
    respond({ blueprints }, () => {
      console.log("Blueprints");

      if (blueprints.length === 0) {
        console.log("  No blueprints found.");
        return;
      }

      for (const blueprint of blueprints) {
        printBlueprintSummary(blueprint, modules);
      }
    });
  });

moduleCommand
  .command("show")
  .description("Show one local habitat module.")
  .argument("<moduleId>", "module id")
  .action((moduleId: string) => {
    try {
      const module = getModule(moduleId);
      respond({ module }, () => {
        printModuleDetails(module);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read module.");
    }
  });

moduleCommand
  .command("info")
  .description("Show detailed information for one local habitat module.")
  .argument("<moduleId>", "module id")
  .action((moduleId: string) => {
    try {
      const module = getModule(moduleId);
      respond({ module }, () => {
        printModuleDetails(module);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read module.");
    }
  });

moduleCommand
  .command("status")
  .description("Show runtime status and current power draw for one local habitat module.")
  .argument("<moduleId>", "module id")
  .action((moduleId: string) => {
    try {
      const module = getModule(moduleId);
      respond(
        {
          moduleId: module.id,
          status: module.runtimeAttributes.status ?? null,
          powerDrawKw: getModulePowerDrawKw(module),
        },
        () => {
          printModuleStatus(module);
        },
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read module status.");
    }
  });

moduleCommand
  .command("set-status")
  .description("Set one local habitat module to a runtime status.")
  .argument("<moduleId>", "module id")
  .argument("<status>", "runtime status")
  .action((moduleId: string, status: string) => {
    try {
      const module = setModuleStatus(moduleId, status);
      respond(
        {
          moduleId: module.id,
          status: module.runtimeAttributes.status ?? null,
          powerDrawKw: getModulePowerDrawKw(module),
        },
        () => {
          printStatusChangeConfirmation(module);
        },
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to set module status.");
    }
  });

moduleCommand
  .command("create")
  .description("Create a new local habitat module.")
  .requiredOption("--blueprint <blueprintId>", "blueprint id")
  .requiredOption("--name <displayName>", "module display name")
  .option("--connect <moduleId>", "connected module id", collectValues, [])
  .option("--capability <capability>", "module capability", collectValues, [])
  .option("--runtime-attributes <json>", "runtime attributes JSON object")
  .action(
    (options: {
      blueprint: string;
      name: string;
      connect: string[];
      capability: string[];
      runtimeAttributes?: string;
    }) => {
      try {
        const module = createModule({
          blueprintId: options.blueprint,
          displayName: options.name,
          connectedTo: options.connect,
          capabilities: options.capability,
          runtimeAttributes:
            options.runtimeAttributes === undefined
              ? undefined
              : parseJsonObject(options.runtimeAttributes, "Runtime attributes"),
        });
        respond({ module }, () => {
          console.log(`Created module "${module.displayName}".`);
          console.log(`ID: ${module.id}`);
          console.log(`Blueprint: ${module.blueprintId}`);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to create module.");
      }
    },
  );

moduleCommand
  .command("update")
  .description("Update a local habitat module.")
  .argument("<moduleId>", "module id")
  .option("--name <displayName>", "module display name")
  .option("--set-status <status>", "runtime status")
  .option("--status <status>", "runtime status")
  .option("--condition <condition>", "runtime condition")
  .option("--connect <moduleId>", "connected module id to add", collectValues, [])
  .option("--disconnect <moduleId>", "connected module id to remove", collectValues, [])
  .option("--add-capability <capability>", "capability to add", collectValues, [])
  .option("--remove-capability <capability>", "capability to remove", collectValues, [])
  .option("--runtime-attributes <json>", "runtime attributes JSON object")
  .action(
    (
      moduleId: string,
      options: {
        name?: string;
        setStatus?: string;
        status?: string;
        condition?: string;
        connect: string[];
        disconnect: string[];
        addCapability: string[];
        removeCapability: string[];
        runtimeAttributes?: string;
      },
    ) => {
      try {
        const module = updateModule(moduleId, {
          displayName: options.name,
          status: options.status ?? options.setStatus,
          condition: parseOptionalNumber(options.condition, "Condition"),
          connect: options.connect,
          disconnect: options.disconnect,
          addCapabilities: options.addCapability,
          removeCapabilities: options.removeCapability,
          runtimeAttributes:
            options.runtimeAttributes === undefined
              ? undefined
              : parseJsonObject(options.runtimeAttributes, "Runtime attributes"),
        });
        respond({ module }, () => {
          console.log(`Updated module "${module.displayName}".`);
          console.log(`ID: ${module.id}`);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to update module.");
      }
    },
  );

moduleCommand
  .command("delete")
  .description("Delete a local habitat module.")
  .argument("<moduleId>", "module id")
  .action((moduleId: string) => {
    try {
      const module = deleteModule(moduleId);
      respond({ module }, () => {
        console.log(`Deleted module "${module.displayName}".`);
        console.log(`ID: ${module.id}`);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to delete module.");
    }
  });

program
  .command("tick")
  .description("Advance the local habitat simulation by a number of one-second ticks.")
  .argument("<count>", "number of ticks to run")
  .addHelpText(
    "after",
    [
      "",
      "Syntax:",
      "  habitat tick <count>",
      "  habitat tick <count> hour",
      "",
      "Example:",
      "  habitat tick 60",
      "  habitat tick -500",
      "  habitat tick 1 hour",
      "  habitat tick 2 hour",
      "",
    ].join("\n"),
  )
  .action((count: string) => {
    try {
      const tick = runTickSimulation(parseNonZeroInteger(count, "Tick count"));
      respond({ tick }, () => {
        printTickResult(tick);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to tick habitat.");
    }
  });

program
  .command("unregister")
  .description("Delete this habitat's Kepler registration.")
  .addHelpText(
    "after",
    [
      "",
      "Syntax:",
      "  habitat unregister",
      "",
      "Example:",
      "  habitat unregister",
      "",
    ].join("\n"),
  )
  .action(async () => {
    try {
      const registration = await unregisterFromKepler();
      respond({ registration }, () => {
        console.log(`Unregistered habitat "${registration.displayName}".`);
        console.log(`Habitat ID: ${registration.habitatId}`);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to unregister habitat.");
    }
  });

try {
  await program.parseAsync(normalizeArgs(stripJsonArgs(process.argv)));

  if (JSON_MODE && jsonResponse !== undefined) {
    process.stdout.write(`${JSON.stringify({ ok: true, data: jsonResponse }, null, 2)}\n`);
  }
} catch (error) {
  if (error instanceof Error && "code" in error) {
    failCommanderError(error, error.code);
  }

  throw error;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }

  return parsed;
}

function parseNonZeroInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed === 0) {
    throw new Error(`${label} must be a non-zero integer.`);
  }

  return parsed;
}

function stripJsonArgs(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--json");
}

function normalizeArgs(argv: string[]): string[] {
  if (argv.length >= 5 && argv[2] === "tick") {
    return normalizeTickArgs(argv);
  }

  if (argv.length >= 5 && argv[2] === "module" && argv[4] === "status") {
    return [argv[0], argv[1], "module", "status", argv[3]];
  }

  if (argv.length >= 5 && argv[2] === "module" && argv[4] === "info") {
    return [argv[0], argv[1], "module", "info", argv[3]];
  }

  return argv;
}

function normalizeTickArgs(argv: string[]): string[] {
  const unit = argv[4];

  if (unit !== "hour" && unit !== "hours") {
    return argv;
  }

  const tickCount = Number(argv[3]);

  if (!Number.isFinite(tickCount)) {
    return argv;
  }

  return [argv[0], argv[1], "tick", String(tickCount * 1600)];
}
