import { fetchKeplerRegistration, registerWithKepler, unregisterFromKepler } from "../../kepler";
import { readData } from "../../storage";
import { KeplerRegistration } from "../../types";

export async function getRegistration(): Promise<KeplerRegistration | undefined> {
  const registration = readData().keplerRegistration;

  if (!registration?.habitatId) {
    return undefined;
  }

  return fetchKeplerRegistration();
}

export async function createRegistration(displayName: string): Promise<KeplerRegistration> {
  if (!displayName.trim()) {
    throw new Error("Registration display name is required.");
  }

  return registerWithKepler(displayName);
}

export async function deleteRegistration(): Promise<KeplerRegistration> {
  return unregisterFromKepler();
}

export async function syncRegisteredHabitatState(): Promise<void> {
  await getRegistration();
}
