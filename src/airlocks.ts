import { makeId, readData, writeData } from "./storage";
import { Airlock } from "./types";

export function listAirlocks(): Airlock[] {
  return readData().airlocks;
}

export function getAirlockByName(name: string): Airlock | undefined {
  return readData().airlocks.find((airlock) => airlock.name === name);
}

export function createAirlock(name: string, pressureLevel: string, locked: boolean): Airlock {
  const data = readData();

  if (data.airlocks.some((airlock) => airlock.name === name)) {
    throw new Error(`An airlock named "${name}" already exists.`);
  }

  const airlock: Airlock = {
    id: makeId("airlock"),
    name,
    pressureLevel,
    locked,
    doorNames: [],
  };

  data.airlocks.push(airlock);
  writeData(data);

  return airlock;
}

export function updateAirlock(
  name: string,
  updates: {
    pressureLevel?: string;
    locked?: boolean;
  },
): Airlock {
  const data = readData();
  const airlock = data.airlocks.find((entry) => entry.name === name);

  if (!airlock) {
    throw new Error(`Airlock "${name}" was not found.`);
  }

  if (updates.pressureLevel !== undefined) {
    airlock.pressureLevel = updates.pressureLevel;
  }

  if (updates.locked !== undefined) {
    airlock.locked = updates.locked;
  }

  writeData(data);

  return airlock;
}

export function deleteAirlock(name: string): Airlock {
  const data = readData();
  const airlockIndex = data.airlocks.findIndex((airlock) => airlock.name === name);

  if (airlockIndex === -1) {
    throw new Error(`Airlock "${name}" was not found.`);
  }

  const [removedAirlock] = data.airlocks.splice(airlockIndex, 1);
  writeData(data);

  return removedAirlock;
}

export function addDoorToAirlock(airlockName: string, doorName: string): Airlock {
  const data = readData();
  const airlock = data.airlocks.find((entry) => entry.name === airlockName);

  if (!airlock) {
    throw new Error(`Airlock "${airlockName}" was not found.`);
  }

  const door = data.doors.find((entry) => entry.name === doorName);

  if (!door) {
    throw new Error(`Door "${doorName}" was not found.`);
  }

  if (airlock.doorNames.includes(doorName)) {
    throw new Error(`Door "${doorName}" is already attached to airlock "${airlockName}".`);
  }

  airlock.doorNames.push(doorName);
  writeData(data);

  return airlock;
}
