import { randomUUID } from "node:crypto";
import { getBlueprint } from "./blueprints";
import { readData, writeData } from "./storage";
import { HabitatData, HabitatModule, RuntimeAttributes, StarterModulePayload } from "./types";

export const VALID_MODULE_STATUSES = ["offline", "idle", "active", "damaged"] as const;

type CreateModuleInput = {
  blueprintId: string;
  displayName: string;
  connectedTo?: string[];
  capabilities?: string[];
  runtimeAttributes?: RuntimeAttributes;
};

type UpdateModuleInput = {
  displayName?: string;
  connect?: string[];
  disconnect?: string[];
  addCapabilities?: string[];
  removeCapabilities?: string[];
  runtimeAttributes?: RuntimeAttributes;
  status?: string;
  condition?: number;
};

export function hydrateStarterModules(starterModules: StarterModulePayload[]): HabitatModule[] {
  return starterModules.map((module) => ({
    ...module,
    connectedTo: [...module.connectedTo],
    capabilities: [...module.capabilities],
    runtimeAttributes: { ...module.runtimeAttributes },
    source: "starter",
  }));
}

export function listModules(): HabitatModule[] {
  return readData().modules ?? [];
}

export function getModule(moduleId: string): HabitatModule {
  const module = findModule(listModules(), moduleId);

  if (!module) {
    throw new Error(`Module "${moduleId}" was not found.`);
  }

  return module;
}

export async function createModule(input: CreateModuleInput): Promise<HabitatModule> {
  const data = readData();
  await getBlueprint(input.blueprintId);
  const module: HabitatModule = {
    id: randomUUID(),
    blueprintId: input.blueprintId,
    displayName: input.displayName,
    connectedTo: resolveModuleIds(data.modules ?? [], uniqueStrings(input.connectedTo ?? [])),
    capabilities: uniqueStrings(input.capabilities ?? []),
    runtimeAttributes: { ...(input.runtimeAttributes ?? {}) },
    source: "local",
  };

  writeData({
    ...data,
    modules: [...(data.modules ?? []), module],
  });

  return module;
}

export function updateModule(moduleId: string, input: UpdateModuleInput): HabitatModule {
  const data = readData();
  const modules = data.modules ?? [];
  const resolvedModule = requireModule(modules, moduleId);
  const index = modules.findIndex((entry) => entry.id === resolvedModule.id);

  const current = modules[index];
  const runtimeAttributes =
    input.runtimeAttributes === undefined
      ? { ...current.runtimeAttributes }
      : { ...input.runtimeAttributes };

  if (input.status !== undefined) {
    runtimeAttributes.status = input.status;
  }

  if (input.condition !== undefined) {
    runtimeAttributes.condition = input.condition;
  }

  const updated: HabitatModule = {
    ...current,
    displayName: input.displayName ?? current.displayName,
    connectedTo: applyConnections(
      modules,
      current.connectedTo,
      input.connect,
      input.disconnect,
    ),
    capabilities: applyCapabilities(current.capabilities, input.addCapabilities, input.removeCapabilities),
    runtimeAttributes,
  };

  const nextModules = [...modules];
  nextModules[index] = updated;

  writeData({
    ...data,
    modules: nextModules,
  });

  return updated;
}

export function setModuleStatus(moduleId: string, status: string): HabitatModule {
  validateModuleStatus(status);
  return updateModule(moduleId, { status });
}

export function deleteModule(moduleId: string): HabitatModule {
  const data = readData();
  const modules = data.modules ?? [];
  const module = requireModule(modules, moduleId);

  if (module.source === "starter") {
    throw new Error("Starter modules cannot be deleted.");
  }

  writeData({
    ...data,
    modules: modules.filter((entry) => entry.id !== module.id),
  });

  return module;
}

export function moduleCount(data?: HabitatData): number {
  return (data?.modules ?? readData().modules ?? []).length;
}

function applyConnections(
  modules: HabitatModule[],
  current: string[],
  additions?: string[],
  removals?: string[],
): string[] {
  const connected = new Set(current);

  for (const moduleId of resolveModuleIds(modules, additions ?? [])) {
    connected.add(moduleId);
  }

  for (const moduleId of resolveModuleIds(modules, removals ?? [])) {
    connected.delete(moduleId);
  }

  return [...connected];
}

function applyCapabilities(current: string[], additions?: string[], removals?: string[]): string[] {
  const capabilities = new Set(current);

  for (const capability of additions ?? []) {
    capabilities.add(capability);
  }

  for (const capability of removals ?? []) {
    capabilities.delete(capability);
  }

  return [...capabilities];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveModuleIds(modules: HabitatModule[], moduleIds: string[]): string[] {
  return moduleIds.map((moduleId) => requireModule(modules, moduleId).id);
}

function requireModule(modules: HabitatModule[], moduleId: string): HabitatModule {
  const module = findModule(modules, moduleId);

  if (!module) {
    throw new Error(`Module "${moduleId}" was not found.`);
  }

  return module;
}

function findModule(modules: HabitatModule[], moduleId: string): HabitatModule | undefined {
  return (
    modules.find((entry) => entry.id === moduleId) ??
    findModuleByShortcut(modules, moduleId) ??
    findModuleByBlueprintAlias(modules, moduleId) ??
    findModuleByBlueprintOrdinalAlias(modules, moduleId)
  );
}

function findModuleByShortcut(modules: HabitatModule[], moduleId: string): HabitatModule | undefined {
  const matches = modules.filter((entry) => entry.id.endsWith(`_${moduleId}`));

  if (matches.length > 1) {
    throw new Error(`Module shortcut "${moduleId}" is ambiguous. Use the full module id.`);
  }

  return matches[0];
}

function findModuleByBlueprintAlias(modules: HabitatModule[], moduleId: string): HabitatModule | undefined {
  const matches = modules.filter((entry) => entry.blueprintId === moduleId);

  if (matches.length > 1) {
    throw new Error(`Module alias "${moduleId}" is ambiguous. Use a more specific module id.`);
  }

  return matches[0];
}

function findModuleByBlueprintOrdinalAlias(modules: HabitatModule[], moduleId: string): HabitatModule | undefined {
  const match = /^(.*)-(\d+)$/.exec(moduleId);

  if (!match) {
    return undefined;
  }

  const [, blueprintId, ordinalText] = match;
  const ordinal = Number(ordinalText);

  if (!Number.isInteger(ordinal) || ordinal < 1) {
    return undefined;
  }

  const matches = modules.filter((entry) => entry.blueprintId === blueprintId);
  return matches[ordinal - 1];
}

function validateModuleStatus(status: string): void {
  if (!VALID_MODULE_STATUSES.includes(status as (typeof VALID_MODULE_STATUSES)[number])) {
    throw new Error(`Status must be one of: ${VALID_MODULE_STATUSES.join(", ")}.`);
  }
}
