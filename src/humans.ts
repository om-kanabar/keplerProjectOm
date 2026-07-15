import { HabitatHuman } from "./types";
import { readData, writeData } from "./storage";
import { getModule, listModules } from "./modules";

export function hydrateStarterHumans(humans: HabitatHuman[]): HabitatHuman[] { return humans.map((human) => ({ ...human })); }
export function listHumans(): HabitatHuman[] { return readData().humans ?? []; }
export function getHuman(id: string): HabitatHuman { const human = listHumans().find((item) => item.id === id); if (!human) throw new Error(`Human "${id}" was not found.`); return human; }
export function moveHuman(id: string, locationModuleId: string): HabitatHuman { const data = readData(); const human = getHuman(id); const module = getModule(locationModuleId); const capacity = Number(module.runtimeAttributes.crewCapacity ?? 0); if (listHumans().filter((entry) => entry.locationModuleId === module.id && entry.id !== id).length >= capacity) throw new Error(`Module "${module.id}" has reached crew capacity.`); const humans = (data.humans ?? []).map((entry) => entry.id === id ? { ...entry, locationModuleId: module.id } : entry); const moved = humans.find((entry) => entry.id === id)!; writeData({ ...data, humans }); return moved; }
export function ensureModuleUnoccupied(moduleId: string): void { if (listHumans().some((human) => human.locationModuleId === moduleId)) throw new Error(`Module "${moduleId}" cannot be deleted while occupied by a human.`); }
