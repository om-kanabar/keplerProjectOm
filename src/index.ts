#!/usr/bin/env bun

import { Command } from "commander";
import { addDoorToAirlock, createAirlock, deleteAirlock, getAirlockByName, listAirlocks, updateAirlock } from "./airlocks";
import { createDoor, deleteDoor, getDoorByName, listDoors, updateDoor } from "./doors";
import { MAP_HEIGHT, MAP_WIDTH, renderMap, setMapPlacement } from "./map";
import packageJson from "../package.json";
import { readData } from "./storage";
import { createZone, deleteZone, getZoneByName, listZones, updateZone } from "./zones";
import { Airlock, Door, MapObjectType, Zone } from "./types";

type HabitatObjectName = "zone" | "door" | "airlock";

const DISCOVERY = {
  name: "habitat",
  description: "Aerie habitat control CLI for Kepler-422b.",
  syntax: "habitat <object> <command> [arguments] [options]",
  map: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    objectTypes: ["zone", "door", "airlock"],
    coordinateRange: {
      x: [0, MAP_WIDTH - 1],
      y: [0, MAP_HEIGHT - 1],
    },
  },
  commonValues: {
    locked: ["true", "false"],
    pressureLevel: ["pressurized", "depressurized"],
  },
  objects: {
    zone: {
      description: "Habitat area with a name, purpose, status, and optional map position.",
      fields: {
        name: { type: "string", required: true, unique: true },
        purpose: { type: "string", required: true, examples: ["research", "storage", "greenhouse"] },
        status: { type: "string", required: true, examples: ["active", "maintenance", "offline"] },
        x: { type: "integer", required: false, range: [0, MAP_WIDTH - 1] },
        y: { type: "integer", required: false, range: [0, MAP_HEIGHT - 1] },
      },
      commands: ["create", "list", "show", "update", "delete"],
    },
    door: {
      description: "Passage with a name, status, locked state, and optional airlock attachment.",
      fields: {
        name: { type: "string", required: true, unique: true },
        status: { type: "string", required: true, examples: ["open", "closed"] },
        locked: { type: "boolean", required: true, values: [true, false] },
        x: { type: "integer", required: false, range: [0, MAP_WIDTH - 1] },
        y: { type: "integer", required: false, range: [0, MAP_HEIGHT - 1] },
      },
      commands: ["create", "list", "show", "update", "delete"],
    },
    airlock: {
      description: "Exterior transition space with pressure, locked state, doors, and optional map position.",
      fields: {
        name: { type: "string", required: true, unique: true },
        pressureLevel: {
          type: "string",
          required: true,
          values: ["pressurized", "depressurized"],
        },
        locked: { type: "boolean", required: true, values: [true, false] },
        doorNames: { type: "string[]", required: false },
        x: { type: "integer", required: false, range: [0, MAP_WIDTH - 1] },
        y: { type: "integer", required: false, range: [0, MAP_HEIGHT - 1] },
      },
      commands: ["create", "list", "show", "update", "delete", "add-door"],
    },
  },
  workflows: [
    'habitat zone create "Lab" research active',
    'habitat door create "Lab Door" closed true',
    'habitat airlock create "Main Lock" pressurized true',
    'habitat airlock add-door "Main Lock" "Lab Door"',
    'habitat map adjust zone "Lab" 2 3',
    "habitat status",
  ],
} as const;

function printDescribeText(objectName?: HabitatObjectName): void {
  if (objectName) {
    const object = DISCOVERY.objects[objectName];

    console.log(`${objectName}: ${object.description}`);
    console.log("");
    console.log("Fields:");
    for (const [fieldName, field] of Object.entries(object.fields)) {
      const details: string[] = [`type: ${field.type}`];

      if ("values" in field) {
        details.push(`values: ${field.values.join(" | ")}`);
      }

      if ("examples" in field) {
        details.push(`examples: ${field.examples.join(", ")}`);
      }

      if ("range" in field) {
        details.push(`range: ${field.range[0]}-${field.range[1]}`);
      }

      console.log(`  ${fieldName} (${details.join("; ")})`);
    }

    console.log("");
    console.log(`Commands: ${object.commands.join(", ")}`);
    return;
  }

  console.log(DISCOVERY.description);
  console.log("");
  console.log(`Syntax: ${DISCOVERY.syntax}`);
  console.log("");
  console.log("Objects:");
  for (const [name, object] of Object.entries(DISCOVERY.objects)) {
    console.log(`  ${name.padEnd(8, " ")} ${object.description}`);
  }

  console.log("");
  console.log("Map:");
  console.log(`  size: ${MAP_WIDTH} columns by ${MAP_HEIGHT} rows`);
  console.log(`  object types: ${DISCOVERY.map.objectTypes.join(", ")}`);
  console.log("  coordinates: x 0-7, y 0-7");
  console.log("");
  console.log("Example workflow:");
  for (const command of DISCOVERY.workflows) {
    console.log(`  ${command}`);
  }
  console.log("");
  console.log('Use "habitat describe --json" for machine-readable discovery.');
}

function printDescribeJson(objectName?: HabitatObjectName): void {
  const output = objectName
    ? { [objectName]: DISCOVERY.objects[objectName] }
    : DISCOVERY;

  console.log(JSON.stringify(output, null, 2));
}

function printZone(zone: Zone): void {
  console.log(`Name: ${zone.name}`);
  console.log(`Purpose: ${zone.purpose}`);
  console.log(`Status: ${zone.status}`);
}

function printDoor(door: Door): void {
  console.log(`Name: ${door.name}`);
  console.log(`Status: ${door.status}`);
  console.log(`Locked: ${door.locked}`);
}

function printAirlock(airlock: Airlock): void {
  console.log(`Name: ${airlock.name}`);
  console.log(`Pressure Level: ${airlock.pressureLevel}`);
  console.log(`Locked: ${airlock.locked}`);
  console.log(
    `Doors: ${airlock.doorNames.length === 0 ? "None" : airlock.doorNames.join(", ")}`,
  );
}

function printBaseStatus(): void {
  const data = readData();
  const attachedDoorNames = new Set(data.airlocks.flatMap((airlock) => airlock.doorNames));
  const unassignedDoors = data.doors.filter((door) => !attachedDoorNames.has(door.name));

  console.log("Base Layout");

  console.log("");
  console.log("Zones:");
  if (data.zones.length === 0) {
    console.log("  None");
  } else {
    for (const zone of data.zones) {
      console.log(`  - ${zone.name} (${zone.purpose}, ${zone.status})`);
    }
  }

  console.log("");
  console.log("Airlocks:");
  if (data.airlocks.length === 0) {
    console.log("  None");
  } else {
    for (const airlock of data.airlocks) {
      console.log(
        `  - ${airlock.name} (${airlock.pressureLevel}, locked: ${airlock.locked})`,
      );

      if (airlock.doorNames.length === 0) {
        console.log("    doors: none");
      } else {
        for (const doorName of airlock.doorNames) {
          const door = data.doors.find((entry) => entry.name === doorName);
          const details = door
            ? `${door.status}, locked: ${door.locked}`
            : "missing from door list";
          console.log(`    door: ${doorName} (${details})`);
        }
      }
    }
  }

  console.log("");
  console.log("Unassigned Doors:");
  if (unassignedDoors.length === 0) {
    console.log("  None");
  } else {
    for (const door of unassignedDoors) {
      console.log(`  - ${door.name} (${door.status}, locked: ${door.locked})`);
    }
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function failWithCommandHelp(message: string): never {
  fail([message, commandHelpFor(process.argv.slice(2))].join("\n"));
}

function commandHelpFor(args: string[]): string {
  const commandPath = args.slice(0, 2).join(" ");

  if (commandPath === "zone create") {
    return [
      'Usage: habitat zone create <name> <purpose> <status>',
      'Example: habitat zone create "Alpha" research active',
    ].join("\n");
  }

  if (commandPath === "zone show" || commandPath === "zone delete") {
    return [
      `Usage: habitat ${commandPath} <name>`,
      `Example: habitat ${commandPath} "Alpha"`,
    ].join("\n");
  }

  if (commandPath === "zone update") {
    return [
      "Usage: habitat zone update <name> [--purpose <purpose>] [--status <status>]",
      'Example: habitat zone update "Alpha" --status maintenance',
    ].join("\n");
  }

  if (commandPath === "door create") {
    return [
      'Usage: habitat door create <name> <status> <locked>',
      'Allowed locked values: "true", "false"',
      'Example: habitat door create "Inner Door" closed true',
    ].join("\n");
  }

  if (commandPath === "door show" || commandPath === "door delete") {
    return [
      `Usage: habitat ${commandPath} <name>`,
      `Example: habitat ${commandPath} "Inner Door"`,
    ].join("\n");
  }

  if (commandPath === "door update") {
    return [
      "Usage: habitat door update <name> [--status <status>] [--locked <locked>]",
      'Allowed locked values: "true", "false"',
      'Example: habitat door update "Inner Door" --locked true',
    ].join("\n");
  }

  if (commandPath === "airlock create") {
    return [
      'Usage: habitat airlock create <name> <pressureLevel> <locked>',
      'Allowed pressureLevel values: "pressurized", "depressurized"',
      'Allowed locked values: "true", "false"',
      'Example: habitat airlock create "Main Lock" pressurized true',
    ].join("\n");
  }

  if (commandPath === "airlock show" || commandPath === "airlock delete") {
    return [
      `Usage: habitat ${commandPath} <name>`,
      `Example: habitat ${commandPath} "Main Lock"`,
    ].join("\n");
  }

  if (commandPath === "airlock update") {
    return [
      "Usage: habitat airlock update <name> [--pressureLevel <pressureLevel>] [--locked <locked>]",
      'Allowed pressureLevel values: "pressurized", "depressurized"',
      'Allowed locked values: "true", "false"',
      'Example: habitat airlock update "Main Lock" --pressureLevel depressurized',
    ].join("\n");
  }

  if (commandPath === "airlock add-door") {
    return [
      "Usage: habitat airlock add-door <airlockName> <doorName>",
      'Example: habitat airlock add-door "Main Lock" "Inner Door"',
    ].join("\n");
  }

  if (commandPath === "map adjust") {
    return [
      "Usage: habitat map adjust <objectType> <name> <x> <y>",
      'Allowed objectType values: "zone", "door", "airlock"',
      `Allowed coordinates: 0-${MAP_WIDTH - 1}`,
      'Example: habitat map adjust zone "Alpha" 1 2',
    ].join("\n");
  }

  if (args[0] === "describe") {
    return [
      'Usage: habitat describe [object] [--json]',
      'Allowed object values: "zone", "door", "airlock"',
      "Example: habitat describe zone --json",
    ].join("\n");
  }

  return "Try 'habitat --help' to see available commands.";
}

function formatCommanderMessage(message: string): string {
  return message.replace(/^error: /, "");
}

function failCommanderError(error: Error, code: unknown): never {
  const args = process.argv.slice(2);

  if (
    code === "commander.unknownCommand" ||
    code === "commander.excessArguments" ||
    code === "commander.excessArgumentsUnknownCommand"
  ) {
    const attempted = args.join(" ");

    fail(
      [
        `Unknown command: ${attempted || "(none)"}`,
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

function parseLocked(value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  failWithCommandHelp('Locked must be "true" or "false".');
}

function parsePressureLevel(value: string): string {
  if (value === "pressurized" || value === "depressurized") {
    return value;
  }

  failWithCommandHelp('Pressure level must be "pressurized" or "depressurized".');
}

function parseMapObjectType(value: string): MapObjectType {
  if (value === "zone" || value === "door" || value === "airlock") {
    return value;
  }

  failWithCommandHelp('Map object type must be "zone", "door", or "airlock".');
}

function parseHabitatObjectName(value: string): HabitatObjectName {
  if (value === "zone" || value === "door" || value === "airlock") {
    return value;
  }

  failWithCommandHelp('Object must be "zone", "door", or "airlock".');
}

function parseCoordinate(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    failWithCommandHelp("Map coordinates must be whole numbers.");
  }

  return parsed;
}

const program = new Command();

program
  .name("habitat")
  .description("Aerie habitat control CLI for Kepler-422b.")
  .version(`${packageJson.version}-alpha-om`)
  .allowExcessArguments(false)
  .exitOverride()
  .configureOutput({
    writeErr: () => {},
  });
program.addHelpText(
  "after",
  [
    "",
    "Syntax:",
    "  habitat <object> <command> [arguments] [options]",
    "",
    "Objects:",
    "  zone      Habitat area with name, purpose, status, and map position.",
    "  door      Passage with name, status, locked state, and optional airlock.",
    "  airlock   Exterior transition space with pressure, locked state, doors, and map position.",
    "",
    "Common values:",
    '  locked: "true", "false"',
    '  pressureLevel: "pressurized", "depressurized"',
    "  map coordinates: x 0-7, y 0-7",
    "",
    "Notes:",
    "  <angle brackets> mean required values you type in.",
    '  Use quotes around names with spaces, like "Main Lock".',
    '  Use "habitat describe --json" for machine-readable discovery.',
    "",
    "Examples:",
    '  habitat zone create "Alpha" research active',
    '  habitat door create "Inner Door" open false',
    '  habitat airlock create "Main Lock" pressurized true',
    "  habitat status",
    "  habitat map",
    "",
  ].join("\n"),
);

program
  .command("status")
  .description("Show a simple layout of the base.")
  .action(() => {
    printBaseStatus();
  });

program
  .command("describe")
  .description("Describe available objects, fields, commands, and values.")
  .argument("[object]", 'optional object: "zone", "door", or "airlock"')
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    [
      "",
      "Syntax:",
      "  habitat describe",
      "  habitat describe <object>",
      "  habitat describe --json",
      "",
      'Objects: "zone", "door", "airlock"',
      "",
      "Examples:",
      "  habitat describe",
      "  habitat describe zone",
      "  habitat describe --json",
      "",
    ].join("\n"),
  )
  .action((object: string | undefined, options: { json?: boolean }) => {
    const objectName = object === undefined ? undefined : parseHabitatObjectName(object);

    if (options.json) {
      printDescribeJson(objectName);
      return;
    }

    printDescribeText(objectName);
  });

const mapCommand = program.command("map").description("Show or adjust the base map.");
mapCommand.addHelpText(
  "after",
  [
    "",
    "Syntax:",
    "  habitat map",
    "  habitat map adjust <objectType> <name> <x> <y>",
    "",
    `Map size: ${MAP_WIDTH} columns by ${MAP_HEIGHT} rows`,
    'Object types: "zone", "door", "airlock"',
    "Coordinates: x 0-7, y 0-7",
    "",
    "Examples:",
    '  habitat map',
    '  habitat map adjust zone "Alpha" 1 2',
    '  habitat map adjust airlock "Main Lock" 4 3',
    "",
  ].join("\n"),
);
mapCommand.action(() => {
  console.log(renderMap());
});
mapCommand
  .command("adjust")
  .description("Move an object on the map.")
  .argument("<objectType>", 'object type: "zone", "door", or "airlock"')
  .argument("<name>", "object name")
  .argument("<x>", "horizontal coordinate")
  .argument("<y>", "vertical coordinate")
  .action((objectType: string, name: string, x: string, y: string) => {
    try {
      setMapPlacement(
        parseMapObjectType(objectType),
        name,
        parseCoordinate(x),
        parseCoordinate(y),
      );
      console.log(`Moved ${objectType} "${name}" to (${x}, ${y}).`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to adjust the map.");
    }
  });

const zoneCommand = program.command("zone").description("Manage habitat zones.");
zoneCommand.addHelpText(
  "after",
  [
    "",
    "Syntax:",
    "  habitat zone <command> [arguments] [options]",
    "",
    "Fields:",
    "  name      unique text label",
    "  purpose   free text, examples: research, storage, greenhouse",
    "  status    free text, examples: active, maintenance, offline",
    "  x,y       optional map position from 0 to 7",
    "",
    "Examples:",
    '  habitat zone create "Alpha" research active',
    '  habitat zone show "Alpha"',
    '  habitat zone update "Alpha" --status maintenance',
    "",
  ].join("\n"),
);
const doorCommand = program.command("door").description("Manage habitat doors.");
doorCommand.addHelpText(
  "after",
  [
    "",
    "Syntax:",
    "  habitat door <command> [arguments] [options]",
    "",
    "Fields:",
    "  name      unique text label",
    "  status    free text, examples: open, closed",
    '  locked    "true" or "false"',
    "  x,y       optional map position from 0 to 7",
    "",
    "Examples:",
    '  habitat door create "Inner Door" open false',
    '  habitat door show "Inner Door"',
    '  habitat door update "Inner Door" --locked true',
    "",
  ].join("\n"),
);
const airlockCommand = program.command("airlock").description("Manage habitat airlocks.");
airlockCommand.addHelpText(
  "after",
  [
    "",
    "Syntax:",
    "  habitat airlock <command> [arguments] [options]",
    "",
    "Fields:",
    "  name           unique text label",
    '  pressureLevel  "pressurized" or "depressurized"',
    '  locked         "true" or "false"',
    "  doorNames      attached door names",
    "  x,y            optional map position from 0 to 7",
    "",
    "Examples:",
    '  habitat airlock create "Main Lock" pressurized true',
    '  habitat airlock add-door "Main Lock" "Inner Door"',
    '  habitat airlock update "Main Lock" --pressureLevel depressurized',
    "",
  ].join("\n"),
);

zoneCommand
  .command("create")
  .description("Create a zone.")
  .argument("<name>", "zone name")
  .argument("<purpose>", "zone purpose")
  .argument("<status>", "zone status")
  .action((name: string, purpose: string, status: string) => {
    try {
      const zone = createZone(name, purpose, status);
      console.log(`Created zone "${zone.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to create zone.");
    }
  });

zoneCommand
  .command("list")
  .description("List all zones.")
  .action(() => {
    const zones = listZones();

    if (zones.length === 0) {
      console.log("No zones found.");
      return;
    }

    for (const zone of zones) {
      console.log(`${zone.name} | purpose: ${zone.purpose} | status: ${zone.status}`);
    }
  });

zoneCommand
  .command("show")
  .description("Show one zone.")
  .argument("<name>", "zone name")
  .action((name: string) => {
    const zone = getZoneByName(name);

    if (!zone) {
      fail(`Zone "${name}" was not found.`);
    }

    printZone(zone);
  });

zoneCommand
  .command("update")
  .description("Update a zone.")
  .argument("<name>", "zone name")
  .option("--purpose <purpose>", "new purpose")
  .option("--status <status>", "new status")
  .action((name: string, options: { purpose?: string; status?: string }) => {
    if (options.purpose === undefined && options.status === undefined) {
      fail("Provide --purpose, --status, or both when updating a zone.");
    }

    try {
      const zone = updateZone(name, options);
      console.log(`Updated zone "${zone.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to update zone.");
    }
  });

zoneCommand
  .command("delete")
  .description("Delete a zone.")
  .argument("<name>", "zone name")
  .action((name: string) => {
    try {
      const zone = deleteZone(name);
      console.log(`Deleted zone "${zone.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to delete zone.");
    }
  });

doorCommand
  .command("create")
  .description("Create a door.")
  .argument("<name>", "door name")
  .argument("<status>", "door status")
  .argument("<locked>", 'locked state: "true" or "false"')
  .action((name: string, status: string, locked: string) => {
    try {
      const door = createDoor(name, status, parseLocked(locked));
      console.log(`Created door "${door.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to create door.");
    }
  });

doorCommand
  .command("list")
  .description("List all doors.")
  .action(() => {
    const doors = listDoors();

    if (doors.length === 0) {
      console.log("No doors found.");
      return;
    }

    for (const door of doors) {
      console.log(`${door.name} | status: ${door.status} | locked: ${door.locked}`);
    }
  });

doorCommand
  .command("show")
  .description("Show one door.")
  .argument("<name>", "door name")
  .action((name: string) => {
    const door = getDoorByName(name);

    if (!door) {
      fail(`Door "${name}" was not found.`);
    }

    printDoor(door);
  });

doorCommand
  .command("update")
  .description("Update a door.")
  .argument("<name>", "door name")
  .option("--status <status>", "new status")
  .option("--locked <locked>", 'new locked state: "true" or "false"')
  .action((name: string, options: { status?: string; locked?: string }) => {
    if (options.status === undefined && options.locked === undefined) {
      fail("Provide --status, --locked, or both when updating a door.");
    }

    try {
      const door = updateDoor(name, {
        status: options.status,
        locked: options.locked === undefined ? undefined : parseLocked(options.locked),
      });
      console.log(`Updated door "${door.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to update door.");
    }
  });

doorCommand
  .command("delete")
  .description("Delete a door.")
  .argument("<name>", "door name")
  .action((name: string) => {
    try {
      const door = deleteDoor(name);
      console.log(`Deleted door "${door.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to delete door.");
    }
  });

airlockCommand
  .command("create")
  .description("Create an airlock.")
  .argument("<name>", "airlock name")
  .argument("<pressureLevel>", 'pressure level: "pressurized" or "depressurized"')
  .argument("<locked>", 'locked state: "true" or "false"')
  .action((name: string, pressureLevel: string, locked: string) => {
    try {
      const airlock = createAirlock(name, parsePressureLevel(pressureLevel), parseLocked(locked));
      console.log(`Created airlock "${airlock.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to create airlock.");
    }
  });

airlockCommand
  .command("list")
  .description("List all airlocks.")
  .action(() => {
    const airlocks = listAirlocks();

    if (airlocks.length === 0) {
      console.log("No airlocks found.");
      return;
    }

    for (const airlock of airlocks) {
      console.log(
        `${airlock.name} | pressureLevel: ${airlock.pressureLevel} | locked: ${airlock.locked} | doors: ${airlock.doorNames.length}`,
      );
    }
  });

airlockCommand
  .command("show")
  .description("Show one airlock.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    const airlock = getAirlockByName(name);

    if (!airlock) {
      fail(`Airlock "${name}" was not found.`);
    }

    printAirlock(airlock);
  });

airlockCommand
  .command("update")
  .description("Update an airlock.")
  .argument("<name>", "airlock name")
  .option(
    "--pressureLevel <pressureLevel>",
    'new pressure level: "pressurized" or "depressurized"',
  )
  .option("--locked <locked>", 'new locked state: "true" or "false"')
  .action((name: string, options: { pressureLevel?: string; locked?: string }) => {
    if (options.pressureLevel === undefined && options.locked === undefined) {
      fail("Provide --pressureLevel, --locked, or both when updating an airlock.");
    }

    try {
      const airlock = updateAirlock(name, {
        pressureLevel:
          options.pressureLevel === undefined
            ? undefined
            : parsePressureLevel(options.pressureLevel),
        locked: options.locked === undefined ? undefined : parseLocked(options.locked),
      });
      console.log(`Updated airlock "${airlock.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to update airlock.");
    }
  });

airlockCommand
  .command("delete")
  .description("Delete an airlock.")
  .argument("<name>", "airlock name")
  .action((name: string) => {
    try {
      const airlock = deleteAirlock(name);
      console.log(`Deleted airlock "${airlock.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to delete airlock.");
    }
  });

airlockCommand
  .command("add-door")
  .description("Attach a door to an airlock.")
  .argument("<airlockName>", "airlock name")
  .argument("<doorName>", "door name")
  .action((airlockName: string, doorName: string) => {
    try {
      const airlock = addDoorToAirlock(airlockName, doorName);
      console.log(`Attached door "${doorName}" to airlock "${airlock.name}".`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to attach door to airlock.");
    }
  });

try {
  program.parse(process.argv);
} catch (error) {
  if (error instanceof Error && "code" in error) {
    failCommanderError(error, error.code);
  }

  throw error;
}
