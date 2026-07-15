import type { ConstructionReadiness } from "./construction";
import {
  BatteryRechargeResult,
  BlueprintReference,
  HabitatModule,
  InventoryRecord,
  KeplerRegistration,
  ResourceReference,
  TickSimulationResult,
} from "./types";
import type { ServerLogEntry } from "./server/logs";
import { readData } from "./storage";

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

type RegistrationResponse = {
  registration: KeplerRegistration | null;
};

type StatusResponse = {
  registration: KeplerRegistration | null;
  modules: HabitatModule[];
};

type WebLoginCodeResponse = {
  code: string;
  expiresAt: string;
};

type ConstructionStatusJob = {
  facility: HabitatModule;
  blueprintId: string;
  remainingTicks: number;
};
export type ScanOptions = { x: number; y: number; strength: number; radius: number };

export type HabitatApiClient = {
  createWebLoginCode: (token: string) => Promise<WebLoginCodeResponse>;
  getRegistration: () => Promise<RegistrationResponse>;
  getStatus: () => Promise<StatusResponse>;
  register: (displayName: string) => Promise<{ registration: KeplerRegistration }>;
  unregister: () => Promise<{ registration: KeplerRegistration }>;
  getHealth: () => Promise<{ health: Record<string, unknown> }>;
  getVersion: () => Promise<{ version: Record<string, unknown> }>;
  listBlueprints: () => Promise<{ blueprints: BlueprintReference[] }>;
  getBlueprint: (blueprintId: string) => Promise<{ blueprint: BlueprintReference }>;
  listCatalogResources: () => Promise<{ resources: ResourceReference[] }>;
  listResources: () => Promise<{ resources: Array<ResourceReference & { amount: number }> }>;
  getSolarIrradiance: () => Promise<{ solarIrradiance: Record<string, unknown> }>;
  listModuleCatalog: () => Promise<{ modules: Record<string, unknown>[] }>;
  listSiteTypes: () => Promise<{ siteTypes: Record<string, unknown>[] }>;
  listUnlocks: () => Promise<{ unlocks: Record<string, unknown>[] }>;
  listModules: () => Promise<{ modules: HabitatModule[] }>;
  getModule: (moduleId: string) => Promise<{ module: HabitatModule }>;
  setModuleStatus: (moduleId: string, status: string) => Promise<{ module: HabitatModule }>;
  updateModule: (moduleId: string, body: Record<string, unknown>) => Promise<{ module: HabitatModule }>;
  deleteModule: (moduleId: string) => Promise<{ module: HabitatModule }>;
  listInventory: () => Promise<{ inventory: InventoryRecord }>;
  addInventory: (resourceId: string, amount: number) => Promise<{ inventory: InventoryRecord }>;
  addResource: (resourceId: string, amount?: number) => Promise<{
    inventory: InventoryRecord;
    blueprint?: BlueprintReference;
    requiredResources?: InventoryRecord;
  }>;
  inspectConstructionReadiness: (blueprintId: string) => Promise<{ readiness: ConstructionReadiness }>;
  startConstruction: (blueprintId: string) => Promise<{
    construction: {
      facility: HabitatModule;
      job: {
        blueprintId: string;
        outputModuleId: string;
        remainingTicks: number;
      };
      inventory: InventoryRecord;
    };
  }>;
  listConstructionJobs: () => Promise<{ jobs: ConstructionStatusJob[] }>;
  cancelConstruction: (moduleId: string) => Promise<{
    canceled: {
      facility: HabitatModule;
      job: {
        blueprintId: string;
      };
    };
  }>;
  tick: (ticks: number) => Promise<{ tick: TickSimulationResult }>;
  rechargeBattery: (ticks: number) => Promise<{ recharge: BatteryRechargeResult }>;
  sendHeartbeat: () => Promise<{ heartbeat: Record<string, unknown> }>;
  sendSummary: () => Promise<{ summary: Record<string, unknown> }>;
  reportUnlocks: () => Promise<{ report: Record<string, unknown> }>;
  getServerLogs: () => Promise<{ logs: ServerLogEntry[] }>;
  scan: (options: ScanOptions) => Promise<Record<string, unknown>>;
};

export function createHabitatApiClient(baseUrl = process.env.HABITAT_API_BASE_URL ?? "http://localhost:8787"): HabitatApiClient {
  const normalizedBaseUrl = resolveHabitatApiBaseUrl(baseUrl);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${normalizedBaseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("Unable to reach the local Habitat API. Start it with `bun run server` or set HABITAT_API_BASE_URL.");
    }

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    return (await response.json()) as T;
  }

  return {
    createWebLoginCode: async (token) => {
      let response: Response;

      try {
        response = await fetch(normalizedBaseUrl + "/auth/web", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
      } catch {
        throw new Error("Unable to reach the Habitat API. Set HABITAT_API_BASE_URL to the remote server URL.");
      }

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      return (await response.json()) as WebLoginCodeResponse;
    },
    getRegistration: () => request<RegistrationResponse>("GET", "/registration"),
    getStatus: () => request<StatusResponse>("GET", "/status"),
    register: (displayName: string) => request<{ registration: KeplerRegistration }>("POST", "/registration", { displayName }),
    unregister: () => request<{ registration: KeplerRegistration }>("DELETE", "/registration"),
    getHealth: () => request<{ health: Record<string, unknown> }>("GET", "/health"),
    getVersion: () => request<{ version: Record<string, unknown> }>("GET", "/version"),
    listBlueprints: () => request<{ blueprints: BlueprintReference[] }>("GET", "/catalog/blueprints"),
    getBlueprint: (blueprintId: string) =>
      request<{ blueprint: BlueprintReference }>("GET", `/catalog/blueprints/${blueprintId}`),
    listCatalogResources: () => request<{ resources: ResourceReference[] }>("GET", "/catalog/resources"),
    listResources: () => request<{ resources: Array<ResourceReference & { amount: number }> }>("GET", "/resources"),
    getSolarIrradiance: () => request<{ solarIrradiance: Record<string, unknown> }>("GET", "/solar/irradiance"),
    listModuleCatalog: () => request<{ modules: Record<string, unknown>[] }>("GET", "/catalog/modules"),
    listSiteTypes: () => request<{ siteTypes: Record<string, unknown>[] }>("GET", "/catalog/site-types"),
    listUnlocks: () => request<{ unlocks: Record<string, unknown>[] }>("GET", "/catalog/unlocks"),
    listModules: () => request<{ modules: HabitatModule[] }>("GET", "/modules"),
    getModule: (moduleId: string) => request<{ module: HabitatModule }>("GET", `/modules/${moduleId}`),
    setModuleStatus: (moduleId: string, status: string) =>
      request<{ module: HabitatModule }>("POST", `/modules/${moduleId}/status`, { status }),
    updateModule: (moduleId: string, body: Record<string, unknown>) =>
      request<{ module: HabitatModule }>("PATCH", `/modules/${moduleId}`, body),
    deleteModule: (moduleId: string) => request<{ module: HabitatModule }>("DELETE", `/modules/${moduleId}`),
    listInventory: () => request<{ inventory: InventoryRecord }>("GET", "/inventory"),
    addInventory: (resourceId: string, amount: number) =>
      request<{ inventory: InventoryRecord }>("POST", "/inventory/add", { resourceId, amount }),
    addResource: (resourceId: string, amount?: number) =>
      request("POST", "/resources/add", amount === undefined ? { resourceId } : { resourceId, amount }),
    inspectConstructionReadiness: (blueprintId: string) =>
      request<{ readiness: ConstructionReadiness }>("POST", "/construction/readiness", { blueprintId }),
    startConstruction: (blueprintId: string) => request("POST", "/construction/jobs", { blueprintId }),
    listConstructionJobs: () => request<{ jobs: ConstructionStatusJob[] }>("GET", "/construction/jobs"),
    cancelConstruction: (moduleId: string) => request("DELETE", `/construction/jobs/${moduleId}`),
    tick: (ticks: number) => request<{ tick: TickSimulationResult }>("POST", "/ticks", { ticks }),
    rechargeBattery: (ticks: number) =>
      request<{ recharge: BatteryRechargeResult }>("POST", "/battery/recharge", { ticks }),
    sendHeartbeat: () => request<{ heartbeat: Record<string, unknown> }>("POST", "/heartbeat"),
    sendSummary: () => request<{ summary: Record<string, unknown> }>("POST", "/summary"),
    reportUnlocks: () => request<{ report: Record<string, unknown> }>("POST", "/unlocks/report"),
    scan: async (options) => {
      const query = new URLSearchParams({
        x: String(options.x),
        y: String(options.y),
        sensorStrength: String(options.strength),
        radiusTiles: String(options.radius),
      });
      const response = await request<Record<string, unknown>>("GET", `/scan?${query.toString()}`);
      const wrapped = response.scan;
      return wrapped && typeof wrapped === "object"
        ? wrapped as Record<string, unknown>
        : response;
    },
    getServerLogs: async () => {
      try {
        return await request<{ logs: ServerLogEntry[] }>("GET", "/server/logs");
      } catch (error) {
        if (error instanceof Error && error.message === "Habitat API request failed with HTTP 404.") {
          throw new Error("Habitat API server logs are unavailable on the running server. Restart `bun run server` and try again.");
        }

        throw error;
      }
    },
  };
}

export function resolveHabitatApiBaseUrl(fallbackBaseUrl = "http://localhost:8787"): string {
  const baseUrl = process.env.HABITAT_API_BASE_URL ?? readData().habitatApiBaseUrl ?? fallbackBaseUrl;
  return normalizeHabitatApiBaseUrl(baseUrl);
}

export function normalizeHabitatApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    throw new Error("Habitat API base URL is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Habitat API base URL: ${baseUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid Habitat API base URL: ${baseUrl}`);
  }

  return trimmed.replace(/\/+$/, "");
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;

    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    // Fall back to generic status-based messaging.
  }

  return `Habitat API request failed with HTTP ${response.status}.`;
}
