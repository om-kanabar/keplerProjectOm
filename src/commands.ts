import { Command } from "commander";
import { createHabitatApiClient, normalizeHabitatApiBaseUrl } from "./api-client";
import { getBlueprint, listBlueprints } from "./blueprints";
import { cancelConstruction, inspectConstructionReadiness, listConstructionJobs, startConstruction } from "./construction";
import { addInventory, listInventory } from "./inventory";
import {
  fetchKeplerHealth,
  fetchKeplerModuleCatalog,
  fetchKeplerRegistration,
  fetchKeplerSiteTypeCatalog,
  fetchKeplerUnlockCatalog,
  fetchKeplerVersion,
  fetchSolarIrradiance,
  registerWithKepler,
  reportHabitatUnlocks,
  sendHabitatHeartbeat,
  sendHabitatSummary,
  unregisterFromKepler,
} from "./kepler";
import { deleteModule, getModule, listModules, setModuleStatus, updateModule } from "./modules";
import { addResource, addResourcesForBlueprint, listResources, listResourcesWithInventory } from "./resources";
import { runBatteryRechargeSimulation, runTickSimulation } from "./tick";
import packageJson from "../package.json";
import {
  printBatteryRechargeResult,
  printBlueprintDetails,
  printBlueprintList,
  printConstructionCanceled,
  printConstructionDryRun,
  printConstructionStarted,
  printConstructionStatus,
  printInventoryList,
  printKeplerRegistration,
  printModuleDetails,
  printModuleList,
  printModuleStatus,
  printResourceList,
  printServerCollection,
  printServerRecord,
  printStatusChangeConfirmation,
  printTickResult,
} from "./output";
import { RuntimeAttributes } from "./types";
import { getModulePowerDrawKw } from "./tick";
import { readData, writeData } from "./storage";

export async function runCli(argv: string[]): Promise<void> {
  const jsonMode = argv.includes("--json");
  let jsonResponse: unknown;
  const apiClient = createHabitatApiClient();

  function shouldUseHabitatApi(): boolean {
    return process.env.HABITAT_DISABLE_LOCAL_API !== "1";
  }

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
        'Example: habitat register --name "Habitat"',
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

    if (args[0] === "resource" && args[1] === "add") {
      return [
        "Usage: habitat resource add <resourceId> <amount>",
        "Usage: habitat resource add <blueprintId>",
        "Example: habitat resource add ferrite 90",
        "Example: habitat resource add small-solar-array",
      ].join("\n");
    }

    if (args[0] === "inventory" && args[1] === "list") {
      return ["Usage: habitat inventory list", "Example: habitat inventory list"].join("\n");
    }

    if (args[0] === "inventory" && args[1] === "add") {
      return ["Usage: habitat inventory add <resourceId> <amount>", "Example: habitat inventory add ferrite 90"].join(
        "\n",
      );
    }

    if (args[0] === "construct") {
      return [
        "Usage: habitat construct <blueprintId>",
        "Usage: habitat construct <blueprintId> --dry-run",
        "Example: habitat construct small-solar-array --dry-run",
      ].join("\n");
    }

    if (args[0] === "construction" && args[1] === "status") {
      return ["Usage: habitat construction status", "Example: habitat construction status"].join("\n");
    }

    if (args[0] === "construction" && args[1] === "cancel") {
      return [
        "Usage: habitat construction cancel <moduleId>",
        "Example: habitat construction cancel workshop-fabricator-1",
      ].join("\n");
    }

    if (args[0] === "module" && args[1] === "update") {
      return [
        "Usage: habitat module update <moduleId> [options]",
        'Example: habitat module update command-module --status maintenance --condition 87',
      ].join("\n");
    }

    return "Try 'habitat --help' to see available commands.";
  }

  function runModuleDetailsCommand(moduleId: string): void {
    try {
      const module = getModule(moduleId);
      respond({ module }, () => {
        printModuleDetails(module);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to read module.");
    }
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
      '  habitat register --name "Habitat"',
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
        '  habitat register --name "Habitat"',
        "",
      ].join("\n"),
    )
    .action(async (options: { name: string }) => {
      try {
        const registration = shouldUseHabitatApi()
          ? (await apiClient.register(options.name)).registration
          : await registerWithKepler(options.name);
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
    .description("Show live Kepler registration status and local simulation modules.")
    .action(async () => {
      try {
        const { registration, modules } = shouldUseHabitatApi()
          ? await apiClient.getStatus()
          : { registration: await fetchKeplerRegistration(), modules: listModules() };
        respond({ registration, modules }, () => {
          printKeplerRegistration(registration ?? undefined, modules);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Kepler status.");
      }
    });

  const moduleCommand = program.command("module").description("Manage local habitat simulation modules.");
  const blueprintCommand = program.command("blueprint").description("Inspect the Kepler blueprint catalog.");
  const catalogCommand = program.command("catalog").description("Inspect Kepler-owned catalogs.");
  const constructionCommand = program.command("construction").description("Inspect and manage local construction jobs.");
  const inventoryCommand = program.command("inventory").description("Inspect and manage local inventory.");
  const resourceCommand = program.command("resource").description("Inspect the Kepler resource catalog.");
  const serverCommand = program.command("server").description("Inspect the local Habitat API server.");
  program
    .command("connect")
    .description("Save the local Habitat API base URL for future commands.")
    .argument("<baseUrl>", "local Habitat API base URL")
    .action((baseUrl: string) => {
      const normalizedBaseUrl = normalizeHabitatApiBaseUrl(baseUrl);
      writeData({
        ...readData(),
        habitatApiBaseUrl: normalizedBaseUrl,
      });

      console.log(`Connected to ${normalizedBaseUrl}.`);
    });
  const unlocksCommand = program.command("unlocks").description("Report local unlock-relevant state to Kepler.");
  const worldCommand = program.command("world").description("Inspect Kepler world state.");
  const batteryCommand = moduleCommand.command("battery").description("Recharge module batteries.");

  program
    .command("health")
    .description("Check the Kepler server health endpoint.")
    .action(async () => {
      try {
        const health = shouldUseHabitatApi() ? (await apiClient.getHealth()).health : await fetchKeplerHealth();
        respond({ health }, () => {
          printServerRecord("Kepler Health", health);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Kepler health.");
      }
    });

  program
    .command("version")
    .description("Show the Kepler server version.")
    .action(async () => {
      try {
        const version = shouldUseHabitatApi() ? (await apiClient.getVersion()).version : await fetchKeplerVersion();
        respond({ version }, () => {
          printServerRecord("Kepler Version", version);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Kepler version.");
      }
    });

  worldCommand
    .command("solar-irradiance")
    .description("Show the current Kepler world solar irradiance.")
    .action(async () => {
      try {
        const solarIrradiance = shouldUseHabitatApi()
          ? (await apiClient.getSolarIrradiance()).solarIrradiance
          : await fetchSolarIrradiance();
        respond({ solarIrradiance }, () => {
          printServerRecord("Solar Irradiance", solarIrradiance);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Kepler solar irradiance.");
      }
    });

  catalogCommand
    .command("modules")
    .description("List the live Kepler module catalog.")
    .action(async () => {
      try {
        const modules = shouldUseHabitatApi() ? (await apiClient.listModuleCatalog()).modules : await fetchKeplerModuleCatalog();
        respond({ modules }, () => {
          printServerCollection("Catalog Modules", modules, ["displayName", "moduleType", "status", "id"]);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the module catalog.");
      }
    });

  catalogCommand
    .command("resources")
    .description("List the live Kepler resource catalog.")
    .action(async () => {
      try {
        const resources = shouldUseHabitatApi() ? (await apiClient.listCatalogResources()).resources : await listResources();
        respond({ resources }, () => {
          printResourceList(resources);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the resource catalog.");
      }
    });

  catalogCommand
    .command("blueprints")
    .description("List the live Kepler blueprint catalog.")
    .action(async () => {
      try {
        const blueprints = shouldUseHabitatApi() ? (await apiClient.listBlueprints()).blueprints : await listBlueprints();
        respond({ blueprints }, () => {
          printBlueprintList(blueprints);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the blueprint catalog.");
      }
    });

  catalogCommand
    .command("site-types")
    .description("List the live Kepler site type catalog.")
    .action(async () => {
      try {
        const siteTypes = shouldUseHabitatApi() ? (await apiClient.listSiteTypes()).siteTypes : await fetchKeplerSiteTypeCatalog();
        respond({ siteTypes }, () => {
          printServerCollection("Catalog Site Types", siteTypes, ["displayName", "siteType", "status", "id"]);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the site type catalog.");
      }
    });

  catalogCommand
    .command("unlocks")
    .description("List the live Kepler unlock catalog.")
    .action(async () => {
      try {
        const unlocks = shouldUseHabitatApi() ? (await apiClient.listUnlocks()).unlocks : await fetchKeplerUnlockCatalog();
        respond({ unlocks }, () => {
          printServerCollection("Catalog Unlocks", unlocks, ["displayName", "unlockId", "status", "id"]);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the unlock catalog.");
      }
    });

  moduleCommand
    .command("list")
    .description("List local habitat modules.")
    .action(async () => {
      const modules = shouldUseHabitatApi() ? (await apiClient.listModules()).modules : listModules();
      respond({ modules }, () => {
        printModuleList(modules);
      });
    });

  blueprintCommand
    .command("list")
    .description("List the live Kepler blueprint catalog.")
    .action(async () => {
      try {
        const blueprints = shouldUseHabitatApi() ? (await apiClient.listBlueprints()).blueprints : await listBlueprints();
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
        const blueprint = shouldUseHabitatApi()
          ? (await apiClient.getBlueprint(blueprintId)).blueprint
          : await getBlueprint(blueprintId);
        respond({ blueprint }, () => {
          printBlueprintDetails(blueprint);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the blueprint catalog.");
      }
    });

  resourceCommand
    .command("list")
    .description("List the live Kepler resource catalog with local amounts.")
    .action(async () => {
      try {
        const resources = shouldUseHabitatApi() ? (await apiClient.listResources()).resources : await listResourcesWithInventory();
        respond({ resources }, () => {
          printResourceList(resources);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read the resource catalog.");
      }
    });

  program
    .command("heartbeat")
    .description("Report the current local habitat heartbeat to Kepler.")
    .action(async () => {
      try {
        const heartbeat = shouldUseHabitatApi() ? (await apiClient.sendHeartbeat()).heartbeat : await sendHabitatHeartbeat();
        respond({ heartbeat }, () => {
          printServerRecord("Heartbeat Response", heartbeat);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to send habitat heartbeat.");
      }
    });

  program
    .command("summary")
    .description("Report the current local habitat summary to Kepler.")
    .action(async () => {
      try {
        const summary = shouldUseHabitatApi() ? (await apiClient.sendSummary()).summary : await sendHabitatSummary();
        respond({ summary }, () => {
          printServerRecord("Summary Response", summary);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to send habitat summary.");
      }
    });

  unlocksCommand
    .command("report")
    .description("Report local unlock-relevant state to Kepler.")
    .action(async () => {
      try {
        const report = shouldUseHabitatApi() ? (await apiClient.reportUnlocks()).report : await reportHabitatUnlocks();
        respond({ report }, () => {
          printServerRecord("Unlock Report Response", report);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to report habitat unlocks.");
      }
    });

  serverCommand
    .command("log")
    .description("Show recent Habitat API server logs.")
    .action(async () => {
      try {
        const logs = (await apiClient.getServerLogs()).logs;
        respond({ logs }, () => {
          printServerCollection("Server Logs", logs, ["timestamp", "level", "message", "method", "path", "statusCode"]);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to read Habitat API server logs.");
      }
    });

  resourceCommand
    .command("add")
    .description("Add a local amount for a resource that exists in the live Kepler catalog.")
    .argument("<resourceId>", "resource id")
    .argument("[amount]", "amount to add")
    .action(async (resourceId: string, amount?: string) => {
      try {
        if (!shouldUseHabitatApi()) {
          requireOnlineBatteryForMutation();
          requireOnlineSupplyCache();
        }

        if (amount === undefined) {
          const result = shouldUseHabitatApi() ? await apiClient.addResource(resourceId) : await addResourcesForBlueprint(resourceId);
          respond({ inventory: result.inventory, blueprint: result.blueprint, requiredResources: result.requiredResources }, () => {
            console.log(`Added required resources for "${result.blueprint!.blueprintId}".`);
            for (const [requiredResourceId, requiredAmount] of Object.entries(result.requiredResources!)) {
              console.log(`${requiredResourceId}: ${requiredAmount}`);
            }
          });
          return;
        }

        const inventory = shouldUseHabitatApi()
          ? (await apiClient.addResource(resourceId, parsePositiveInteger(amount, "Resource amount"))).inventory
          : await addResource(resourceId, parsePositiveInteger(amount, "Resource amount"));
        respond({ inventory }, () => {
          console.log(`Added ${amount} ${resourceId}.`);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to add resource.");
      }
    });

  inventoryCommand
    .command("list")
    .description("List local inventory.")
    .action(async () => {
      const inventory = shouldUseHabitatApi() ? (await apiClient.listInventory()).inventory : listInventory();
      respond({ inventory }, () => {
        printInventoryList(inventory);
      });
    });

  inventoryCommand
    .command("add")
    .description("Add local inventory.")
    .argument("<resourceId>", "resource id")
    .argument("<amount>", "amount to add")
    .action(async (resourceId: string, amount: string) => {
      try {
        if (!shouldUseHabitatApi()) {
          requireOnlineBatteryForMutation();
        }
        const inventory = shouldUseHabitatApi()
          ? (await apiClient.addInventory(resourceId, parsePositiveInteger(amount, "Inventory amount"))).inventory
          : addInventory(resourceId, parsePositiveInteger(amount, "Inventory amount"));
        respond({ inventory }, () => {
          console.log(`Added ${amount} ${resourceId}.`);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to add inventory.");
      }
    });

  program
    .command("construct")
    .description("Start or preview local construction from a live Kepler blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .option("--dry-run", "check whether construction can start without changing local files")
    .action(async (blueprintId: string, options: { dryRun?: boolean }) => {
      try {
        if (options.dryRun) {
          const readiness = shouldUseHabitatApi()
            ? (await apiClient.inspectConstructionReadiness(blueprintId)).readiness
            : await inspectConstructionReadiness(blueprintId);
          respond({ readiness }, () => {
            printConstructionDryRun(readiness);
          });
          return;
        }

        const result = shouldUseHabitatApi()
          ? (await apiClient.startConstruction(blueprintId)).construction
          : await startConstruction(blueprintId);
        respond({ construction: result }, () => {
          printConstructionStarted({
            blueprintId,
            outputModuleId: result.job.outputModuleId,
            remainingTicks: result.job.remainingTicks,
            facilityName: result.facility.displayName,
          });
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to start construction.");
      }
    });

  constructionCommand
    .command("status")
    .description("List active local construction jobs.")
    .action(async () => {
      const jobs = shouldUseHabitatApi()
        ? (await apiClient.listConstructionJobs()).jobs
        : listConstructionJobs().map(({ facility, job }) => ({
            facility,
            blueprintId: job.blueprintId,
            remainingTicks: job.remainingTicks,
          }));

      respond({ jobs }, () => {
        printConstructionStatus(jobs);
      });
    });

  constructionCommand
    .command("cancel")
    .description("Cancel the active construction job on a fabrication module.")
    .argument("<moduleId>", "module id")
    .action(async (moduleId: string) => {
      try {
        const result = shouldUseHabitatApi()
          ? (await apiClient.cancelConstruction(moduleId)).canceled
          : cancelConstruction(moduleId);
        respond({ canceled: result }, () => {
          printConstructionCanceled(result.facility.displayName, result.job.blueprintId);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unable to cancel construction.");
      }
    });

  moduleCommand
    .command("show")
    .alias("info")
    .description("Show one local habitat module.")
    .argument("<moduleId>", "module id")
    .action(async (moduleId: string) => {
      if (!shouldUseHabitatApi()) {
        runModuleDetailsCommand(moduleId);
        return;
      }

      try {
        const module = (await apiClient.getModule(moduleId)).module;
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
    .action(async (moduleId: string) => {
      try {
        const module = shouldUseHabitatApi() ? (await apiClient.getModule(moduleId)).module : getModule(moduleId);
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
    .action(async (moduleId: string, status: string) => {
      try {
        const module = shouldUseHabitatApi()
          ? (await apiClient.setModuleStatus(moduleId, status)).module
          : setModuleStatus(moduleId, status);
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
      async (
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
          const input = {
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
          };
          const module = shouldUseHabitatApi()
            ? await apiClient.updateModule(moduleId, input as Record<string, unknown>).then((result) => result.module)
            : updateModule(moduleId, input);
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
    .action(async (moduleId: string) => {
      try {
        const module = shouldUseHabitatApi()
          ? (await apiClient.deleteModule(moduleId)).module
          : deleteModule(moduleId);
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
    .action(async (ticks: string, unit?: string) => {
      try {
        if (!shouldUseHabitatApi()) {
          requireOnlineBatteryForMutation();
        }
        const rechargeTicks =
          unit === "hour" || unit === "hours"
            ? parsePositiveInteger(ticks, "Recharge tick count") * 3600
            : parsePositiveInteger(ticks, "Recharge tick count");
        const recharge = shouldUseHabitatApi()
          ? (await apiClient.rechargeBattery(rechargeTicks)).recharge
          : runBatteryRechargeSimulation(rechargeTicks);
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
    .argument("[unit]", "optional time unit")
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
    .action(async (count: string, unit?: string) => {
      try {
        if (!shouldUseHabitatApi()) {
          requireOnlineBatteryForMutation();
        }
        const requestedTicks =
          unit === "hour" || unit === "hours"
            ? parsePositiveInteger(count, "Tick count") * 3600
            : parsePositiveInteger(count, "Tick count");
        const tick = shouldUseHabitatApi() ? (await apiClient.tick(requestedTicks)).tick : await runTickSimulation(requestedTicks);
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
        const registration = shouldUseHabitatApi()
          ? (await apiClient.unregister()).registration
          : await unregisterFromKepler();
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

function requireOnlineBatteryForMutation(): void {
  const batteryModules = listModules().filter(
    (module) => module.blueprintId === "basic-battery" || module.blueprintId === "battery-bank",
  );

  if (batteryModules.length === 0) {
    return;
  }

  const hasOnlineBattery = batteryModules.some((module) => {
    const status = module.runtimeAttributes.status;
    return status === "online" || status === "active";
  });

  if (!hasOnlineBattery) {
    throw new Error("At least one battery module must be online to perform this action.");
  }
}

function requireOnlineSupplyCache(): void {
  const supplyCache = listModules().find((module) => module.blueprintId === "supply-cache");

  if (!supplyCache) {
    throw new Error("Supply cache must be online to add resources.");
  }

  const status = supplyCache.runtimeAttributes.status;

  if (status !== "online" && status !== "active") {
    throw new Error("Supply cache must be online to add resources.");
  }
}
