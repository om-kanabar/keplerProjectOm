import { makeId, readData, writeData } from "./storage";
import { Zone } from "./types";

export function listZones(): Zone[] {
  return readData().zones;
}

export function getZoneByName(name: string): Zone | undefined {
  return readData().zones.find((zone) => zone.name === name);
}

export function createZone(name: string, purpose: string, status: string): Zone {
  const data = readData();

  if (data.zones.some((zone) => zone.name === name)) {
    throw new Error(`A zone named "${name}" already exists.`);
  }

  const zone: Zone = {
    id: makeId("zone"),
    name,
    purpose,
    status,
  };

  data.zones.push(zone);
  writeData(data);

  return zone;
}

export function updateZone(
  name: string,
  updates: {
    purpose?: string;
    status?: string;
  },
): Zone {
  const data = readData();
  const zone = data.zones.find((entry) => entry.name === name);

  if (!zone) {
    throw new Error(`Zone "${name}" was not found.`);
  }

  if (updates.purpose !== undefined) {
    zone.purpose = updates.purpose;
  }

  if (updates.status !== undefined) {
    zone.status = updates.status;
  }

  writeData(data);

  return zone;
}

export function deleteZone(name: string): Zone {
  const data = readData();
  const zoneIndex = data.zones.findIndex((zone) => zone.name === name);

  if (zoneIndex === -1) {
    throw new Error(`Zone "${name}" was not found.`);
  }

  const [removedZone] = data.zones.splice(zoneIndex, 1);
  writeData(data);

  return removedZone;
}
