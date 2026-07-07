import { randomUUID } from "node:crypto";
import { readData, writeData } from "./storage";
import { KeplerRegistration } from "./types";

type HabitatRegistrationResponse = {
  habitatId: string;
  starterModules: unknown[];
  blueprints: unknown[];
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
  response: HabitatResponse,
): KeplerRegistration {
  return {
    ...registration,
    habitatId: response.habitat.id,
    displayName: response.habitat.displayName,
    habitatSlug: response.habitat.habitatSlug,
    catalogVersion: response.habitat.catalogVersion,
    status: response.habitat.status,
    lastSeenAt: response.habitat.lastSeenAt ?? null,
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
    starterModules: response.starterModules,
    blueprints: response.blueprints,
  };

  writeData({
    ...data,
    keplerRegistration: registration,
  });

  return registration;
}

export async function fetchKeplerRegistration(): Promise<KeplerRegistration | undefined> {
  const data = readData();
  const registration = data.keplerRegistration;

  if (!registration?.habitatId) {
    return undefined;
  }

  const response = await requestKepler<HabitatResponse>("GET", `/habitats/${registration.habitatId}`);
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

  const { keplerRegistration: _removed, ...remainingData } = data;
  writeData(remainingData);

  return registration;
}
