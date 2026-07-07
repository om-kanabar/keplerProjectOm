#!/usr/bin/env bun

import { Command } from "commander";
import { fetchKeplerRegistration, registerWithKepler, unregisterFromKepler } from "./kepler";
import { createModule, deleteModule, getModule, listModules, moduleCount, updateModule } from "./modules";
import packageJson from "../package.json";
import { HabitatModule, KeplerRegistration, RuntimeAttributes } from "./types";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
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

  if (args[0] === "unregister") {
    return ["Usage: habitat unregister", "Example: habitat unregister"].join("\n");
  }

  if (args[0] === "module" && args[1] === "show") {
    return ["Usage: habitat module show <moduleId>", "Example: habitat module show starter-command-module"].join(
      "\n",
    );
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

  if (args[0] === "module" && args[1] === "update") {
    return [
      "Usage: habitat module update <moduleId> [options]",
      'Example: habitat module update local-module-1 --set-status active --add-capability bulk-storage',
    ].join("\n");
  }

  return "Try 'habitat --help' to see available commands.";
}

function failCommanderError(error: Error, code: unknown): never {
  const args = process.argv.slice(2);

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
  console.log(`- ${module.displayName} | ${module.blueprintId}`);
}

function printModuleDetails(module: HabitatModule): void {
  console.log("Module");
  console.log(`  ID: ${module.id}`);
  console.log(`  Name: ${module.displayName}`);
  console.log(`  Blueprint: ${module.blueprintId}`);
  console.log(`  Source: ${module.source}`);
  console.log(`  Connected To: ${module.connectedTo.length === 0 ? "(none)" : module.connectedTo.join(", ")}`);
  console.log(`  Capabilities: ${module.capabilities.length === 0 ? "(none)" : module.capabilities.join(", ")}`);
  console.log("  Runtime Attributes:");
  console.log(`    ${JSON.stringify(module.runtimeAttributes, null, 2).replace(/\n/g, "\n    ")}`);
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

      console.log(`Registered habitat "${registration.displayName}".`);
      console.log(`Habitat ID: ${registration.habitatId}`);
      console.log(`UUID: ${registration.habitatUuid}`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to register habitat.");
    }
  });

program
  .command("status")
  .description("Show Kepler registration status.")
  .action(async () => {
    try {
      printKeplerRegistration(await fetchKeplerRegistration());
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read Kepler status.");
    }
  });

const moduleCommand = program.command("module").description("Manage local habitat modules.");

moduleCommand
  .command("list")
  .description("List local habitat modules.")
  .action(() => {
    const modules = listModules();

    console.log("Modules");

    if (modules.length === 0) {
      console.log("  No modules found.");
      return;
    }

    for (const module of modules) {
      printModuleSummary(module);
    }
  });

moduleCommand
  .command("show")
  .description("Show one local habitat module.")
  .argument("<moduleId>", "module id")
  .action((moduleId: string) => {
    try {
      printModuleDetails(getModule(moduleId));
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read module.");
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

        console.log(`Created module "${module.displayName}".`);
        console.log(`ID: ${module.id}`);
        console.log(`Blueprint: ${module.blueprintId}`);
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
          status: options.setStatus,
          connect: options.connect,
          disconnect: options.disconnect,
          addCapabilities: options.addCapability,
          removeCapabilities: options.removeCapability,
          runtimeAttributes:
            options.runtimeAttributes === undefined
              ? undefined
              : parseJsonObject(options.runtimeAttributes, "Runtime attributes"),
        });

        console.log(`Updated module "${module.displayName}".`);
        console.log(`ID: ${module.id}`);
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

      console.log(`Deleted module "${module.displayName}".`);
      console.log(`ID: ${module.id}`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to delete module.");
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

      console.log(`Unregistered habitat "${registration.displayName}".`);
      console.log(`Habitat ID: ${registration.habitatId}`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to unregister habitat.");
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error && "code" in error) {
    failCommanderError(error, error.code);
  }

  throw error;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}
