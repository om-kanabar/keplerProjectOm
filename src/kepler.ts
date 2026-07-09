import { randomUUID } from "node:crypto";
import { hydrateStarterModules } from "./modules";
import { readData, writeData } from "./storage";
import { BlueprintReference, KeplerRegistration, ResourceReference, StarterModulePayload } from "./types";

type HabitatRegistrationResponse = {
  habitatId: string;
  starterModules: StarterModulePayload[];
  blueprints: BlueprintReference[];
};

type HabitatResponse = {
  habitat: {
    id: string;
    habitatSlug: string;
    displayName: string;
    catalogVersion: string;
    status: string;
    lastSeenAt?: string | null;
  };
};

type HabitatRegistrationLookupResponse =
  | HabitatResponse
  | {
      id?: string;
      habitatId?: string;
      habitatSlug?: string;
      displayName?: string;
      catalogVersion?: string;
      status?: string;
      lastSeenAt?: string | null;
    };

type BlueprintCatalogResponse = {
  blueprints: BlueprintReference[];
} | BlueprintReference[];

type ResourceCatalogResponse = {
  resources: ResourceReference[];
} | ResourceReference[];

type GenericCatalogResponse = Record<string, unknown> | Array<Record<string, unknown>>;

const DEFAULT_BASE_URL = "https://planet.turingguild.com";

function getBaseUrl(): string {
  return (
    process.env.KEPLER_WORLD_BASE_URL ??
    process.env.PLANET_SERVER_PUBLIC_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

function getToken(): string {
  const token =
    process.env.KEPLER_WORLD_TOKEN ?? process.env.PLANET_TOKEN ?? process.env.KEPLER_PLANET_TOKEN;

  if (!token) {
    throw new Error(
      "Kepler token is missing. Set KEPLER_WORLD_TOKEN, PLANET_TOKEN, or KEPLER_PLANET_TOKEN.",
    );
  }

  return token;
}

async function requestKepler<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };

    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    // Fall through to the generic status message.
  }

  return `Kepler request failed with HTTP ${response.status}.`;
}

function updateRegistrationFromHabitat(
  registration: KeplerRegistration,
  response: HabitatRegistrationLookupResponse,
): KeplerRegistration {
  const habitat = "habitat" in response ? response.habitat : response;
  const habitatId = "habitatId" in habitat ? habitat.habitatId : undefined;

  return {
    ...registration,
    habitatId: habitat.id ?? habitatId ?? registration.habitatId,
    displayName: habitat.displayName ?? registration.displayName,
    habitatSlug: habitat.habitatSlug,
    catalogVersion: habitat.catalogVersion,
    status: habitat.status,
    lastSeenAt: habitat.lastSeenAt ?? null,
  };
}

export async function registerWithKepler(displayName: string): Promise<KeplerRegistration> {
  const data = readData();

  if (data.keplerRegistration?.habitatId) {
    throw new Error(
      `Habitat is already registered as "${data.keplerRegistration.displayName}" (${data.keplerRegistration.habitatId}).`,
    );
  }

  const habitatUuid = data.keplerRegistration?.habitatUuid ?? randomUUID();
  const response = await requestKepler<HabitatRegistrationResponse>("POST", "/habitats/register", {
    displayName,
    habitatUuid,
  });
  const registration: KeplerRegistration = {
    habitatUuid,
    habitatId: response.habitatId,
    displayName,
    blueprints: response.blueprints,
  };

  writeData({
    ...data,
    keplerRegistration: registration,
    modules: hydrateStarterModules(response.starterModules),
  });

  return registration;
}

export async function fetchKeplerRegistration(): Promise<KeplerRegistration | undefined> {
  const data = readData();
  const registration = data.keplerRegistration;

  if (!registration?.habitatId) {
    return undefined;
  }

  const response = await requestKepler<HabitatRegistrationLookupResponse>(
    "GET",
    `/habitats/${registration.habitatId}/registration`,
  );
  const updated = updateRegistrationFromHabitat(registration, response);

  writeData({
    ...data,
    keplerRegistration: updated,
  });

  return updated;
}

export async function unregisterFromKepler(): Promise<KeplerRegistration> {
  const data = readData();
  const registration = data.keplerRegistration;

  if (!registration?.habitatId) {
    throw new Error("Habitat is not registered with Kepler.");
  }

  await requestKepler<void>("DELETE", `/habitats/${registration.habitatId}`);

  writeData({});

  return registration;
}

export async function fetchKeplerBlueprintCatalog(): Promise<BlueprintReference[]> {
  const response = await requestKepler<BlueprintCatalogResponse>("GET", "/catalog/blueprints");

  if (Array.isArray(response)) {
    return response;
  }

  return response.blueprints ?? [];
}

export async function fetchKeplerResourceCatalog(): Promise<ResourceReference[]> {
  const response = await requestKepler<ResourceCatalogResponse>("GET", "/catalog/resources");
  const resources = Array.isArray(response) ? response : response.resources ?? [];

  return resources
    .map(normalizeResourceReference)
    .filter((resource): resource is ResourceReference => resource !== undefined);
}

function normalizeResourceReference(resource: ResourceReference): ResourceReference | undefined {
  const resourceId =
    resource.resourceId ??
    (typeof resource.resourceType === "string" ? resource.resourceType : undefined) ??
    (typeof resource.id === "string" ? resource.id : undefined);

  const displayName =
    resource.displayName ??
    (typeof resource.name === "string" ? resource.name : undefined) ??
    resourceId;

  if (!resourceId || !displayName) {
    return undefined;
  }

  return {
    ...resource,
    resourceId,
    displayName,
    status: resource.status ?? resource.rarity,
  };
}

export async function fetchKeplerHealth(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>("GET", "/health");
}

export async function fetchKeplerVersion(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>("GET", "/version");
}

export async function fetchSolarIrradiance(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>("GET", "/world/solar-irradiance");
}

export async function fetchKeplerModuleCatalog(): Promise<Record<string, unknown>[]> {
  return fetchGenericCatalog("/catalog/modules", "modules");
}

export async function fetchKeplerSiteTypeCatalog(): Promise<Record<string, unknown>[]> {
  return fetchGenericCatalog("/catalog/site-types", "siteTypes");
}

export async function fetchKeplerUnlockCatalog(): Promise<Record<string, unknown>[]> {
  return fetchGenericCatalog("/catalog/unlocks", "unlocks");
}

export async function sendHabitatHeartbeat(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>(
    "POST",
    `/habitats/${requireRegisteredHabitat().habitatId}/heartbeat`,
    buildHabitatReportPayload(),
  );
}

export async function sendHabitatSummary(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>(
    "POST",
    `/habitats/${requireRegisteredHabitat().habitatId}/summary`,
    buildHabitatReportPayload(),
  );
}

export async function reportHabitatUnlocks(): Promise<Record<string, unknown>> {
  return requestKepler<Record<string, unknown>>(
    "POST",
    `/habitats/${requireRegisteredHabitat().habitatId}/unlocks/report`,
    buildHabitatReportPayload(),
  );
}

function requireRegisteredHabitat(): KeplerRegistration {
  const registration = readData().keplerRegistration;

  if (!registration?.habitatId) {
    throw new Error("Habitat is not registered with Kepler.");
  }

  return registration;
}

function buildHabitatReportPayload(): Record<string, unknown> {
  const data = readData();
  const registration = requireRegisteredHabitat();
  const modules = data.modules ?? [];

  return {
    habitatId: registration.habitatId,
    habitatUuid: registration.habitatUuid,
    displayName: registration.displayName,
    moduleCount: modules.length,
    modules,
    inventory: data.inventory ?? {},
    capabilities: [...new Set(modules.flatMap((module) => module.capabilities))],
    generatedAt: new Date().toISOString(),
  };
}

async function fetchGenericCatalog(path: string, key: string): Promise<Record<string, unknown>[]> {
  const response = await requestKepler<GenericCatalogResponse>("GET", path);

  if (Array.isArray(response)) {
    return response;
  }

  const entries = response[key];

  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
}
