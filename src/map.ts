import { readData, writeData } from "./storage";
import { MapObjectType } from "./types";

export const MAP_WIDTH = 8;
export const MAP_HEIGHT = 8;

function objectExists(objectType: MapObjectType, name: string): boolean {
  const data = readData();

  if (objectType === "zone") {
    return data.zones.some((zone) => zone.name === name);
  }

  if (objectType === "door") {
    return data.doors.some((door) => door.name === name);
  }

  return data.airlocks.some((airlock) => airlock.name === name);
}

export function setMapPlacement(
  objectType: MapObjectType,
  name: string,
  x: number,
  y: number,
): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("Map coordinates must be whole numbers.");
  }

  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
    throw new Error(`Map coordinates must be between 0 and ${MAP_WIDTH - 1}.`);
  }

  if (!objectExists(objectType, name)) {
    throw new Error(`No ${objectType} named "${name}" was found.`);
  }

  const data = readData();
  const existingPlacement = data.mapPlacements.find(
    (placement) => placement.objectType === objectType && placement.name === name,
  );

  if (existingPlacement) {
    existingPlacement.x = x;
    existingPlacement.y = y;
  } else {
    data.mapPlacements.push({ objectType, name, x, y });
  }

  writeData(data);
}

export function renderMap(): string {
  const data = readData();
  const items = [
    ...data.zones.map((zone, index) => ({
      marker: `Z${index + 1}`,
      objectType: "zone" as const,
      name: zone.name,
    })),
    ...data.airlocks.map((airlock, index) => ({
      marker: `A${index + 1}`,
      objectType: "airlock" as const,
      name: airlock.name,
    })),
    ...data.doors.map((door, index) => ({
      marker: `D${index + 1}`,
      objectType: "door" as const,
      name: door.name,
    })),
  ];

  const grid = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => ".."),
  );
  const unplaced: string[] = [];

  for (const item of items) {
    const placement = data.mapPlacements.find(
      (entry) => entry.objectType === item.objectType && entry.name === item.name,
    );

    if (!placement) {
      unplaced.push(`${item.marker} ${item.name} (${item.objectType})`);
      continue;
    }

    const current = grid[placement.y][placement.x];
    grid[placement.y][placement.x] = current === ".." ? item.marker : "**";
  }

  const lines: string[] = [];
  lines.push("Base Map");
  lines.push("");
  lines.push(`     ${Array.from({ length: MAP_WIDTH }, (_, x) => `${x}`.padEnd(4, " ")).join("")}`);

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const row = grid[y].map((cell) => cell.padEnd(4, " ")).join("");
    lines.push(`${y}`.padStart(2, " ") + ` |  ${row}`);
  }

  lines.push("");
  lines.push("Legend:");
  if (items.length === 0) {
    lines.push("  None");
  } else {
    for (const item of items) {
      const placement = data.mapPlacements.find(
        (entry) => entry.objectType === item.objectType && entry.name === item.name,
      );
      const location = placement ? `(${placement.x}, ${placement.y})` : "(unplaced)";
      lines.push(`  ${item.marker} = ${item.name} [${item.objectType}] ${location}`);
    }
  }

  lines.push("");
  lines.push("Unplaced:");
  if (unplaced.length === 0) {
    lines.push("  None");
  } else {
    for (const item of unplaced) {
      lines.push(`  ${item}`);
    }
  }

  lines.push("");
  lines.push('Use "habitat map adjust <objectType> <name> <x> <y>" to move items.');

  return lines.join("\n");
}
