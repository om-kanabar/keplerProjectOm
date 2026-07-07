import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HabitatData, HabitatModule, KeplerRegistration } from "./types";

const DATA_FILE_NAME = ".habitat-data.json";

export function readData(): HabitatData {
  const filePath = join(process.cwd(), DATA_FILE_NAME);

  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8");

  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as Partial<HabitatData>;

  return {
    ...parsed,
    keplerRegistration: parseKeplerRegistration(parsed.keplerRegistration),
    modules: parseModules(parsed.modules),
  };
}

export function writeData(data: HabitatData): void {
  const filePath = join(process.cwd(), DATA_FILE_NAME);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseKeplerRegistration(value: unknown): KeplerRegistration | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as KeplerRegistration;
}

function parseModules(value: unknown): HabitatModule[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is HabitatModule => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const module = item as Partial<HabitatModule>;
    return (
      typeof module.id === "string" &&
      typeof module.blueprintId === "string" &&
      typeof module.displayName === "string" &&
      Array.isArray(module.connectedTo) &&
      module.connectedTo.every((connection) => typeof connection === "string") &&
      !!module.runtimeAttributes &&
      typeof module.runtimeAttributes === "object" &&
      Array.isArray(module.capabilities) &&
      module.capabilities.every((capability) => typeof capability === "string") &&
      (module.source === "starter" || module.source === "local")
    );
  });
}
