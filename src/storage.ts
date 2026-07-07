import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HabitatData } from "./types";

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
    keplerRegistration:
      parsed.keplerRegistration && typeof parsed.keplerRegistration === "object"
        ? parsed.keplerRegistration
        : undefined,
  };
}

export function writeData(data: HabitatData): void {
  const filePath = join(process.cwd(), DATA_FILE_NAME);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
