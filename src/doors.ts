import { makeId, readData, writeData } from "./storage";
import { Door } from "./types";

export function listDoors(): Door[] {
  return readData().doors;
}

export function getDoorByName(name: string): Door | undefined {
  return readData().doors.find((door) => door.name === name);
}

export function createDoor(name: string, status: string, locked: boolean): Door {
  const data = readData();

  if (data.doors.some((door) => door.name === name)) {
    throw new Error(`A door named "${name}" already exists.`);
  }

  const door: Door = {
    id: makeId("door"),
    name,
    status,
    locked,
  };

  data.doors.push(door);
  writeData(data);

  return door;
}

export function updateDoor(
  name: string,
  updates: {
    status?: string;
    locked?: boolean;
  },
): Door {
  const data = readData();
  const door = data.doors.find((entry) => entry.name === name);

  if (!door) {
    throw new Error(`Door "${name}" was not found.`);
  }

  if (updates.status !== undefined) {
    door.status = updates.status;
  }

  if (updates.locked !== undefined) {
    door.locked = updates.locked;
  }

  writeData(data);

  return door;
}

export function deleteDoor(name: string): Door {
  const data = readData();
  const doorIndex = data.doors.findIndex((door) => door.name === name);

  if (doorIndex === -1) {
    throw new Error(`Door "${name}" was not found.`);
  }

  const [removedDoor] = data.doors.splice(doorIndex, 1);

  for (const airlock of data.airlocks) {
    airlock.doorNames = airlock.doorNames.filter((doorName) => doorName !== name);
  }

  writeData(data);

  return removedDoor;
}
