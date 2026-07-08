import { readData } from "./storage";
import { BlueprintReference, HabitatModule } from "./types";

export function listBlueprints(): BlueprintReference[] {
  return readData().keplerRegistration?.blueprints ?? [];
}

export function getBlueprint(blueprintId: string): BlueprintReference {
  const blueprint = listBlueprints().find((entry) => entry.blueprintId === blueprintId);

  if (!blueprint) {
    throw new Error(`Blueprint "${blueprintId}" is not available in this habitat.`);
  }

  return blueprint;
}

export function isBasicStartBlueprint(blueprintId: string, modules: HabitatModule[]): boolean {
  return modules.some((module) => module.source === "starter" && module.blueprintId === blueprintId);
}

export function formatBlueprintOutput(blueprint: BlueprintReference): string | undefined {
  if (!blueprint.output || typeof blueprint.output !== "object") {
    return undefined;
  }

  const output = blueprint.output as Record<string, unknown>;

  if (typeof output.moduleType === "string") {
    return output.moduleType;
  }

  if (typeof output.itemType === "string") {
    return output.itemType === "module" ? blueprint.blueprintId : blueprint.blueprintId;
  }

  return undefined;
}
