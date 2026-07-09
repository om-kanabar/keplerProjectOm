import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HabitatData, HabitatModule, InventoryRecord, KeplerRegistration } from "./types";

const DATA_FILE_NAME = "habitat.sqlite";
const STATE_TABLE_NAME = "habitat_state";

type StoredHabitatData = HabitatData & {
  keplerRegistration?: Omit<KeplerRegistration, "blueprints">;
};

export function readData(): HabitatData {
  const dbPath = getDatabasePath();

  if (!existsSync(dbPath)) {
    return {};
  }

  const db = openDatabase(dbPath, { readonly: true });

  try {
    const row = db.query(`SELECT data_json FROM ${STATE_TABLE_NAME} WHERE id = 1`).get() as
      | { data_json?: string }
      | null;

    if (!row?.data_json) {
      return {};
    }

    return parseStoredData(row.data_json);
  } catch {
    return {};
  } finally {
    db.close();
  }
}

export function writeData(data: HabitatData): void {
  const dbPath = getDatabasePath();
  const db = openDatabase(dbPath, { create: true });

  try {
    ensureSchema(db);

    db.query(
      `
        INSERT INTO ${STATE_TABLE_NAME} (id, data_json)
        VALUES (1, $dataJson)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json
      `,
    ).run({
      $dataJson: JSON.stringify(sanitizeHabitatData(data)),
    });
  } finally {
    db.close();
  }
}

function getDatabasePath(): string {
  return join(process.cwd(), DATA_FILE_NAME);
}

function openDatabase(path: string, options?: { readonly?: boolean; create?: boolean }): Database {
  return new Database(path, options);
}

function ensureSchema(db: Database): void {
  db.query(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE_NAME} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL
    )
  `).run();
}

function sanitizeHabitatData(data: HabitatData): StoredHabitatData {
  const { keplerRegistration, ...rest } = data;

  return {
    ...rest,
    keplerRegistration: sanitizeKeplerRegistration(keplerRegistration),
  };
}

function sanitizeKeplerRegistration(
  registration: KeplerRegistration | undefined,
): Omit<KeplerRegistration, "blueprints"> | undefined {
  if (!registration) {
    return undefined;
  }

  const { blueprints: _blueprints, ...rest } = registration;

  return rest;
}

function parseStoredData(value: string): HabitatData {
  const parsed = JSON.parse(value) as Partial<StoredHabitatData>;

  return {
    ...parsed,
    keplerRegistration: parseKeplerRegistration(parsed.keplerRegistration),
    inventory: parseInventory(parsed.inventory),
    modules: parseModules(parsed.modules),
  };
}

function parseKeplerRegistration(
  value: unknown,
): Omit<KeplerRegistration, "blueprints"> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const registration = value as Partial<KeplerRegistration>;

  if (
    typeof registration.habitatUuid !== "string" ||
    typeof registration.habitatId !== "string" ||
    typeof registration.displayName !== "string"
  ) {
    return undefined;
  }

  return {
    habitatUuid: registration.habitatUuid,
    habitatId: registration.habitatId,
    displayName: registration.displayName,
    habitatSlug: typeof registration.habitatSlug === "string" ? registration.habitatSlug : undefined,
    catalogVersion: typeof registration.catalogVersion === "string" ? registration.catalogVersion : undefined,
    status: typeof registration.status === "string" ? registration.status : undefined,
    lastSeenAt: typeof registration.lastSeenAt === "string" || registration.lastSeenAt === null ? registration.lastSeenAt : undefined,
  };
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

function parseInventory(value: unknown): InventoryRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    ([resourceId, amount]) =>
      resourceId.length > 0 && typeof amount === "number" && Number.isFinite(amount) && amount >= 0,
  );

  if (entries.length === 0) {
    return {};
  }

  return Object.fromEntries(entries);
}
