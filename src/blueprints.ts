import { fetchKeplerBlueprintCatalog } from "./kepler";
import { BlueprintReference } from "./types";

export async function listBlueprints(): Promise<BlueprintReference[]> {
  return fetchKeplerBlueprintCatalog();
}

export async function getBlueprint(blueprintId: string): Promise<BlueprintReference> {
  const blueprint = (await listBlueprints()).find((entry) => entry.blueprintId === blueprintId);

  if (!blueprint) {
    throw new Error(`Blueprint "${blueprintId}" was not found in Kepler's catalog.`);
  }

  return blueprint;
}

export function formatBlueprintOutput(blueprint: BlueprintReference): string | undefined {
  if (!blueprint.output || typeof blueprint.output !== "object") {
    return undefined;
  }

  const output = blueprint.output as Record<string, unknown>;
  const itemType = typeof output.itemType === "string" ? output.itemType : undefined;
  const moduleType = typeof output.moduleType === "string" ? output.moduleType : undefined;
  const quantity = typeof output.quantity === "number" && output.quantity > 1 ? ` x${output.quantity}` : "";

  if (moduleType) {
    return `module: ${moduleType}${quantity}`;
  }

  if (itemType) {
    return `${itemType}${quantity}`;
  }

  return undefined;
}

export function formatBlueprintValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(none)";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
