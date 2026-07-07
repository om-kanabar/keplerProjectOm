#!/usr/bin/env bun

import { Command } from "commander";
import { fetchKeplerRegistration, registerWithKepler, unregisterFromKepler } from "./kepler";
import packageJson from "../package.json";
import { KeplerRegistration } from "./types";

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
