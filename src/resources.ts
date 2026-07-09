import { getBlueprint } from "./blueprints";
import { addInventory, addInventoryRecord, listInventory } from "./inventory";
import { fetchKeplerResourceCatalog } from "./kepler";
import { BlueprintReference, InventoryRecord, ResourceReference } from "./types";

export async function listResources(): Promise<ResourceReference[]> {
  return fetchKeplerResourceCatalog();
}

export async function listResourcesWithInventory(): Promise<Array<ResourceReference & { amount: number }>> {
  const [resources, inventory] = await Promise.all([listResources(), Promise.resolve(listInventory())]);

  return resources.map((resource) => ({
    ...resource,
    amount: inventory[resource.resourceId] ?? 0,
  }));
}

export async function addResource(resourceId: string, amount: number): Promise<InventoryRecord> {
  const resources = await listResources();
  const resource = resources.find((entry) => entry.resourceId === resourceId);

  if (!resource) {
    throw new Error(`Resource "${resourceId}" was not found in Kepler's catalog.`);
  }

  return addInventory(resourceId, amount);
}

export async function addResourcesForBlueprint(blueprintId: string): Promise<{
  blueprint: BlueprintReference;
  requiredResources: InventoryRecord;
  inventory: InventoryRecord;
}> {
  const blueprint = await getBlueprint(blueprintId);
  const requiredResources = toInventoryRecord(blueprint.inputs);

  if (Object.keys(requiredResources).length === 0) {
    throw new Error(`Blueprint "${blueprintId}" does not require any resources.`);
  }

  return {
    blueprint,
    requiredResources,
    inventory: addInventoryRecord(requiredResources),
  };
}

function toInventoryRecord(inputs: Record<string, unknown> | undefined): InventoryRecord {
  if (!inputs || typeof inputs !== "object") {
    return {};
  }

  return Object.entries(inputs).reduce<InventoryRecord>((inventory, [resourceId, amount]) => {
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      inventory[resourceId] = amount;
    }

    return inventory;
  }, {});
}
