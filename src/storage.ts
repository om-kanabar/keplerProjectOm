import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { AlertContract, ExplorationState, HabitatAlert, HabitatData, HabitatHuman, HabitatModule, InventoryRecord, KeplerRegistration } from "./types";

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
    habitatApiBaseUrl: typeof parsed.habitatApiBaseUrl === "string" ? parsed.habitatApiBaseUrl : undefined,
    humans: parseHumans(parsed.humans), exploration: parseExploration(parsed.exploration), alerts: parseAlerts(parsed.alerts), alertContract: parseAlertContract(parsed.alertContract),
  };
}

function parseHumans(value: unknown): HabitatHuman[] | undefined { return Array.isArray(value) ? value.filter((v): v is HabitatHuman => !!v && typeof v === "object" && typeof (v as HabitatHuman).id === "string" && typeof (v as HabitatHuman).displayName === "string" && typeof (v as HabitatHuman).locationModuleId === "string") : undefined; }
function parseExploration(value: unknown): ExplorationState | undefined { if (!value || typeof value !== "object") return undefined; const v = value as Partial<ExplorationState>; return (v.humanId === null || typeof v.humanId === "string") && typeof v.x === "number" && Number.isInteger(v.x) && typeof v.y === "number" && Number.isInteger(v.y) && !!v.carried && typeof v.carried === "object" && typeof v.capacityKg === "number" ? { humanId: v.humanId, x: v.x, y: v.y, carried: parseInventory(v.carried) ?? {}, capacityKg: v.capacityKg, battery: typeof v.battery === "number" ? Math.max(0, v.battery) : 100, batteryCapacity: typeof v.batteryCapacity === "number" ? v.batteryCapacity : 100, batteryPerTick: typeof v.batteryPerTick === "number" ? v.batteryPerTick : 2, oxygen: typeof v.oxygen === "number" ? Math.max(0, v.oxygen) : 100, oxygenCapacity: typeof v.oxygenCapacity === "number" ? v.oxygenCapacity : 100, oxygenPerTick: typeof v.oxygenPerTick === "number" ? v.oxygenPerTick : 3 } : undefined; }
function parseAlerts(value: unknown): HabitatAlert[] | undefined { return Array.isArray(value) ? value.filter((v): v is HabitatAlert => !!v && typeof v === "object" && typeof (v as HabitatAlert).id === "string" && typeof (v as HabitatAlert).key === "string" && typeof (v as HabitatAlert).status === "string") : undefined; }
function parseAlertContract(value: unknown): AlertContract | undefined { return !!value && typeof value === "object" && typeof (value as AlertContract).schemaVersion === "string" && !!(value as AlertContract).schema && typeof (value as AlertContract).schema === "object" ? value as AlertContract : undefined; }

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
