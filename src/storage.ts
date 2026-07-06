import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HabitatData } from "./types";

const DATA_FILE_NAME = ".habitat-data.json";

export function readData(): HabitatData {
  const filePath = join(process.cwd(), DATA_FILE_NAME);

  if (!existsSync(filePath)) {
    return {
      zones: [],
      doors: [],
      airlocks: [],
      mapPlacements: [],
    };
  }

  const raw = readFileSync(filePath, "utf8");

  if (!raw.trim()) {
    return {
      zones: [],
      doors: [],
      airlocks: [],
      mapPlacements: [],
    };
  }

  const parsed = JSON.parse(raw) as Partial<HabitatData>;

  return {
    zones: Array.isArray(parsed.zones) ? parsed.zones : [],
    doors: Array.isArray(parsed.doors) ? parsed.doors : [],
    airlocks: Array.isArray(parsed.airlocks) ? parsed.airlocks : [],
    mapPlacements: Array.isArray(parsed.mapPlacements) ? parsed.mapPlacements : [],
  };
}

export function writeData(data: HabitatData): void {
  const filePath = join(process.cwd(), DATA_FILE_NAME);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
