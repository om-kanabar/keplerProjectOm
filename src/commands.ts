import { Command } from "commander";
import { getBlueprint, listBlueprints } from "./blueprints";
import { fetchKeplerRegistration, registerWithKepler, unregisterFromKepler } from "./kepler";
import { createModule, deleteModule, getModule, listModules, setModuleStatus, updateModule } from "./modules";
import { listResources } from "./resources";
import { runBatteryRechargeSimulation, runTickSimulation } from "./tick";
import packageJson from "../package.json";
import {
  printBatteryRechargeResult,
  printBlueprintDetails,
  printBlueprintList,
  printKeplerRegistration,
  printModuleDetails,
  printModuleList,
  printModuleStatus,
  printResourceList,
  printStatusChangeConfirmation,
  printTickResult,
} from "./output";
import { RuntimeAttributes } from "./types";
import { getModulePowerDrawKw } from "./tick";

export async function runCli(argv: string[]): Promise<void> {
  const jsonMode = argv.includes("--json");
  let jsonResponse: unknown;

  function fail(message: string): never {
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }

    process.exit(1);
  }

  function respond(data: unknown, renderText: () => void): void {
    if (jsonMode) {
      jsonResponse = data;
      return;
    }

    renderText();
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
        "Example: habitat tick 1 hour",
      ].join("\n");
    }

    if (args[0] === "module" && args[1] === "battery" && args[2] === "recharge") {
      return [
        "Usage: habitat module battery recharge <ticks>",
        "Usage: habitat module battery recharge <ticks> hour",
        "Example: habitat module battery recharge 500",
        "Example: habitat module battery recharge 1 hour",
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

    if (args[0] === "blueprint" && args[1] === "show") {
      return [
        "Usage: habitat blueprint show <blueprint-id>",
        "Example: habitat blueprint show storage-module",
      ].join("\n");
    }

    if (args[0] === "resource" && args[1] === "list") {
      return ["Usage: habitat resource list", "Example: habitat resource list"].join("\n");
    }

    if (args[0] === "module" && args[1] === "update") {
      return [
        "Usage: habitat module update <moduleId> [options]",
        'Example: habitat module update command-module --status maintenance --condition 87',
      ].join("\n");
    }

    return "Try 'habitat --help' to see available commands.";
  }

  function formatCommanderMessage(message: string): string {
    return message.replace(/^error: /, "");
  }

  function failCommanderError(error: Error, code: unknown): never {
    const args = stripJsonArgs(argv).slice(2);

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

    if (code === "commander.help" || code === "commander.helpDisplayed" || code === "commander.version") {
      process.exit(0);
    }

    throw error;
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

  function parsePositiveInteger(value: string, label: string): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer.`);
    }

    return parsed;
  }

  function collectValues(value: string, previous: string[]): string[] {
    return [...previous, value];
  }

  function normalizeArgs(args: string[]): string[] {
    if (args.length >= 5 && args[2] === "tick") {
      return normalizeTickArgs(args);
    }

    if (args.length >= 5 && args[2] === "module" && args[4] === "status") {
      return [args[0], args[1], "module", "status", args[3]];
    }

    if (args.length >= 5 && args[2] === "module" && args[4] === "info") {
      return [args[0], args[1], "module", "info", args[3]];
    }

    return args;
  }

  function stripJsonArgs(args: string[]): string[] {
    return args.filter((arg) => arg !== "--json");
  }

  function normalizeTickArgs(args: string[]): string[] {
    const unit = args[4];

    if (unit !== "hour" && unit !== "hours") {
      return args;
    }

    const tickCount = Number(args[3]);

    if (!Number.isFinite(tickCount)) {
      return args;
    }

    return [args[0], args[1], "tick", String(tickCount * 3600)];
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
      "  habitat module battery recharge 500",
      "  habitat resource list",
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
    .description("Show Kepler registration status and local modules.")
    .action(async () => {
      try {
        const registration = await fetchKeplerRegistration();
        const modules = listModules();
        respond({ registration, modules }, () => {
          printKeplerRegistration(registration);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Kepler status.");
      }
    });

  const moduleCommand = program.command("module").description("Manage local habitat modules.");
  const blueprintCommand = program.command("blueprint").description("Inspect the Kepler blueprint catalog.");
  const resourceCommand = program.command("resource").description("Inspect the Kepler resource catalog.");
  const batteryCommand = moduleCommand.command("battery").description("Recharge module batteries.");

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
    .description("List the live Kepler blueprint catalog.")
    .action(async () => {
      try {
        const blueprints = await listBlueprints();
        respond({ blueprints }, () => {
          printBlueprintList(blueprints);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the blueprint catalog.");
      }
    });

  blueprintCommand
    .command("show")
    .description("Show one live Kepler blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .action(async (blueprintId: string) => {
      try {
        const blueprint = await getBlueprint(blueprintId);
        respond({ blueprint }, () => {
          printBlueprintDetails(blueprint);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the blueprint catalog.");
      }
    });

  resourceCommand
    .command("list")
    .description("List the live Kepler resource catalog.")
    .action(async () => {
      try {
        const resources = await listResources();
        respond({ resources }, () => {
          printResourceList(resources);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the resource catalog.");
      }
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
    .action(async (options: {
      blueprint: string;
      name: string;
      connect: string[];
      capability: string[];
      runtimeAttributes?: string;
    }) => {
      try {
        const module = await createModule({
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
    });

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

  batteryCommand
    .command("recharge")
    .description("Recharge the habitat batteries by simulating forward power flow.")
    .argument("<ticks>", "number of ticks to recharge")
    .argument("[unit]", "optional time unit")
    .addHelpText(
      "after",
      [
        "",
        "Syntax:",
        "  habitat module battery recharge <ticks>",
        "",
        "Example:",
        "  habitat module battery recharge 500",
        "",
      ].join("\n"),
    )
    .action((ticks: string, unit?: string) => {
      try {
        const rechargeTicks =
          unit === "hour" || unit === "hours"
            ? parsePositiveInteger(ticks, "Recharge tick count") * 3600
            : parsePositiveInteger(ticks, "Recharge tick count");
        const recharge = runBatteryRechargeSimulation(rechargeTicks);
        respond({ recharge }, () => {
          printBatteryRechargeResult(recharge);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to recharge batteries.");
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
        "  habitat tick 1 hour",
        "  habitat tick 2 hour",
        "",
      ].join("\n"),
    )
    .action((count: string) => {
      try {
        const tick = runTickSimulation(parsePositiveInteger(count, "Tick count"));
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
    await program.parseAsync(normalizeArgs(stripJsonArgs(argv)));

    if (jsonMode && jsonResponse !== undefined) {
      process.stdout.write(`${JSON.stringify({ ok: true, data: jsonResponse }, null, 2)}\n`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      failCommanderError(error, error.code);
    }

    throw error;
  }
}
