import { readData, writeData } from "./storage";
import { InventoryRecord } from "./types";

export function listInventory(): InventoryRecord {
  return readData().inventory ?? {};
}

export function addInventory(resourceId: string, amount: number): InventoryRecord {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Inventory amount must be a positive number.");
  }

  const data = readData();
  const inventory = {
    ...(data.inventory ?? {}),
    [resourceId]: (data.inventory?.[resourceId] ?? 0) + amount,
  };

  writeData({
    ...data,
    inventory,
  });

  return inventory;
}

export function addInventoryRecord(required: InventoryRecord): InventoryRecord {
  const data = readData();
  const current = data.inventory ?? {};
  const inventory = { ...current };

  for (const [resourceId, amount] of Object.entries(required)) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Inventory amount must be a positive number.");
    }

    inventory[resourceId] = (inventory[resourceId] ?? 0) + amount;
  }

  writeData({
    ...data,
    inventory,
  });

  return inventory;
}

export function hasInventory(required: InventoryRecord, inventory: InventoryRecord = listInventory()): boolean {
  return Object.entries(required).every(([resourceId, amount]) => (inventory[resourceId] ?? 0) >= amount);
}

export function getMissingInventory(
  required: InventoryRecord,
  inventory: InventoryRecord = listInventory(),
): InventoryRecord {
  return Object.fromEntries(
    Object.entries(required)
      .map(([resourceId, amount]) => [resourceId, Math.max(0, amount - (inventory[resourceId] ?? 0))] as const)
      .filter(([, amount]) => amount > 0),
  );
}

export function spendInventory(required: InventoryRecord): InventoryRecord {
  const data = readData();
  const current = data.inventory ?? {};
  const missing = getMissingInventory(required, current);

  if (Object.keys(missing).length > 0) {
    throw new Error("Inventory does not contain the required construction materials.");
  }

  const nextInventory = Object.fromEntries(
    Object.entries(current).map(([resourceId, amount]) => [
      resourceId,
      Math.max(0, amount - (required[resourceId] ?? 0)),
    ]),
  );

  writeData({
    ...data,
    inventory: nextInventory,
  });

  return nextInventory;
}
