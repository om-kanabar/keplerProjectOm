import { getBlueprint, getBlueprintRequiredFacility } from "./blueprints";
import { getMissingInventory, hasInventory, spendInventory } from "./inventory";
import { getModule, listModules } from "./modules";
import { readData, writeData } from "./storage";
import { ConstructionJob, HabitatModule, InventoryRecord, RuntimeAttributes } from "./types";

type ConstructionBlueprint = {
  blueprintId: string;
  displayName: string;
  status?: string;
  requiredFacility?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  buildTicks?: number;
  runtimeAttributes?: RuntimeAttributes;
  capabilities?: string[];
};

export type ConstructionReadiness = {
  blueprintId: string;
  outputModuleType: string;
  outputModuleId: string;
  requiredFacility: string;
  buildTicks: number;
  runtimeAttributes: RuntimeAttributes;
  capabilities: string[];
  requiredResources: InventoryRecord;
  missingResources: InventoryRecord;
  facilityExists: boolean;
  facilityAvailable: boolean;
  supplyCacheOnline: boolean;
  prerequisitesMet: boolean;
  inventoryReady: boolean;
  usablePower: boolean;
  canStart: boolean;
};

export function listConstructionJobs(): Array<{ facility: HabitatModule; job: ConstructionJob }> {
  return listModules()
    .map((module) => ({ facility: module, job: getConstructionJob(module) }))
    .filter((entry): entry is { facility: HabitatModule; job: ConstructionJob } => entry.job !== undefined);
}

export async function inspectConstructionReadiness(blueprintId: string): Promise<ConstructionReadiness> {
  const blueprint = (await getBlueprint(blueprintId)) as ConstructionBlueprint;
  validateBlueprint(blueprint);

  const data = readData();
  const modules = data.modules ?? [];
  const inventory = data.inventory ?? {};
  const requiredFacility = getBlueprintRequiredFacility(blueprint) ?? "workshop-fabricator";
  const facility = modules.find((module) => module.blueprintId === requiredFacility);
  const supplyCache = modules.find((module) => module.blueprintId === "supply-cache");
  const requiredResources = toInventoryRecord(blueprint.inputs);
  const missingResources = getMissingInventory(requiredResources, inventory);
  const outputModuleType = getOutputModuleType(blueprint);
  const buildTicks = getBuildTicks(blueprint);
  const runtimeAttributes = getBlueprintRuntimeAttributes(blueprint);
  const capabilities = getBlueprintCapabilities(blueprint);
  const usablePower = hasUsablePower(modules);

  const facilityExists = facility !== undefined;
  const facilityAvailable = facilityExists && isConstructionFacilityAvailable(facility);
  const supplyCacheOnline = supplyCache !== undefined && isOperational(supplyCache);
  const prerequisitesMet = true;
  const inventoryReady = hasInventory(requiredResources, inventory);
  const canStart =
    facilityExists &&
    facilityAvailable &&
    supplyCacheOnline &&
    prerequisitesMet &&
    inventoryReady &&
    usablePower;

  return {
    blueprintId,
    outputModuleType,
    outputModuleId: getNextConstructedModuleId(outputModuleType, modules),
    requiredFacility,
    buildTicks,
    runtimeAttributes,
    capabilities,
    requiredResources,
    missingResources,
    facilityExists,
    facilityAvailable,
    supplyCacheOnline,
    prerequisitesMet,
    inventoryReady,
    usablePower,
    canStart,
  };
}

export async function startConstruction(blueprintId: string): Promise<{
  facility: HabitatModule;
  job: ConstructionJob;
  inventory: InventoryRecord;
}> {
  const readiness = await inspectConstructionReadiness(blueprintId);

  if (!readiness.canStart) {
    throw new Error(buildReadinessError(readiness));
  }

  spendInventory(readiness.requiredResources);
  const data = readData();
  const modules = data.modules ?? [];
  const facility = modules.find((module) => module.blueprintId === readiness.requiredFacility);

  if (!facility) {
    throw new Error(`Required facility "${readiness.requiredFacility}" was not found.`);
  }

  const job: ConstructionJob = {
    blueprintId: readiness.blueprintId,
    outputModuleId: readiness.outputModuleId,
    buildTicks: readiness.buildTicks,
    remainingTicks: readiness.buildTicks,
    futureModule: {
      id: readiness.outputModuleId,
      blueprintId: readiness.outputModuleType,
      displayName: humanizeBlueprintId(readiness.outputModuleType),
      connectedTo: [],
      runtimeAttributes: { ...readiness.runtimeAttributes },
      capabilities: [...readiness.capabilities],
      source: "local",
    },
  };

  const updatedModules = modules.map((module) =>
    module.id === facility.id
      ? {
          ...module,
          runtimeAttributes: {
            ...module.runtimeAttributes,
            status: "active",
            constructionJob: job,
          },
        }
      : module,
  );
  const normalizedModules = normalizeConstructionSupportModules(updatedModules);

  const nextData = {
    ...data,
    modules: normalizedModules,
  };
  writeData(nextData);

  return {
    facility: normalizedModules.find((module) => module.id === facility.id) as HabitatModule,
    job,
    inventory: nextData.inventory ?? {},
  };
}

export function cancelConstruction(moduleId: string): { facility: HabitatModule; job: ConstructionJob } {
  const data = readData();
  const modules = data.modules ?? [];
  const facility = getModule(moduleId);
  const job = getConstructionJob(facility);

  if (!job) {
    throw new Error(`Module "${facility.displayName}" does not have an active construction job.`);
  }

  const updatedModules = modules.map((module) =>
    module.id === facility.id
      ? {
          ...module,
          runtimeAttributes: clearConstructionJob(module.runtimeAttributes),
        }
      : module,
  );
  const normalizedModules = normalizeConstructionSupportModules(updatedModules);

  writeData({
    ...data,
    modules: normalizedModules,
  });

  return {
    facility: normalizedModules.find((module) => module.id === facility.id) as HabitatModule,
    job,
  };
}

export function advanceConstructionTicks(
  modules: HabitatModule[],
  completedTicks: number,
): { modules: HabitatModule[]; completedModuleIds: string[] } {
  if (completedTicks <= 0) {
    return { modules, completedModuleIds: [] };
  }

  const completedModules: HabitatModule[] = [];
  const completedModuleIds: string[] = [];
  const updatedModules = modules.map((module) => {
    const job = getConstructionJob(module);

    if (!job) {
      return module;
    }

    const remainingTicks = Math.max(0, job.remainingTicks - completedTicks);

    if (remainingTicks > 0) {
      return {
        ...module,
        runtimeAttributes: {
          ...module.runtimeAttributes,
          status: "active",
          constructionJob: {
            ...job,
            remainingTicks,
          },
        },
      };
    }

    completedModules.push(job.futureModule);
    completedModuleIds.push(job.futureModule.id);
    return {
      ...module,
      runtimeAttributes: clearConstructionJob(module.runtimeAttributes),
    };
  });
  const normalizedModules = normalizeConstructionSupportModules([...updatedModules, ...completedModules]);

  return {
    modules: normalizedModules,
    completedModuleIds,
  };
}

export function getConstructionJob(module: HabitatModule): ConstructionJob | undefined {
  const value = module.runtimeAttributes.constructionJob;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const job = value as Partial<ConstructionJob>;

  if (
    typeof job.blueprintId !== "string" ||
    typeof job.outputModuleId !== "string" ||
    typeof job.buildTicks !== "number" ||
    typeof job.remainingTicks !== "number" ||
    !job.futureModule
  ) {
    return undefined;
  }

  return job as ConstructionJob;
}

function clearConstructionJob(runtimeAttributes: RuntimeAttributes): RuntimeAttributes {
  const { constructionJob: _removed, ...remaining } = runtimeAttributes;
  return {
    ...remaining,
    status: "online",
  };
}

function normalizeConstructionSupportModules(modules: HabitatModule[]): HabitatModule[] {
  const hasActiveConstruction = modules.some((module) => getConstructionJob(module) !== undefined);

  return modules.map((module) => {
    if (module.blueprintId !== "supply-cache") {
      return module;
    }

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        status: hasActiveConstruction ? "active" : "online",
      },
    };
  });
}

function isConstructionFacilityAvailable(module: HabitatModule): boolean {
  return isOperational(module) && getConstructionJob(module) === undefined;
}

function isOperational(module: HabitatModule): boolean {
  const status = module.runtimeAttributes.status;
  return status === "online" || status === "active";
}

function hasUsablePower(modules: HabitatModule[]): boolean {
  return modules.some((module) => {
    if (module.blueprintId !== "basic-battery" && module.blueprintId !== "battery-bank") {
      return false;
    }

    const current = getFiniteNumber(module.runtimeAttributes.currentEnergyKwh) ?? 0;
    const reserve = getFiniteNumber(module.runtimeAttributes.reserveKwh) ?? 0;
    return current > reserve;
  });
}

function toInventoryRecord(inputs: Record<string, unknown> | undefined): InventoryRecord {
  if (!inputs || typeof inputs !== "object") {
    return {};
  }

  const inventory: InventoryRecord = {};

  for (const [resourceId, amount] of Object.entries(inputs)) {
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      inventory[resourceId] = amount;
    }
  }

  return inventory;
}

function validateBlueprint(blueprint: ConstructionBlueprint): void {
  if (blueprint.status !== "published") {
    throw new Error(`Blueprint "${blueprint.blueprintId}" is not published.`);
  }

  getOutputModuleType(blueprint);
  getBuildTicks(blueprint);
}

function getOutputModuleType(blueprint: ConstructionBlueprint): string {
  const output = blueprint.output;
  const moduleType = output && typeof output === "object" ? output.moduleType : undefined;

  if (typeof moduleType !== "string" || moduleType.length === 0) {
    throw new Error(`Blueprint "${blueprint.blueprintId}" does not describe a buildable module.`);
  }

  return moduleType;
}

function getBuildTicks(blueprint: ConstructionBlueprint): number {
  if (!Number.isInteger(blueprint.buildTicks) || (blueprint.buildTicks ?? 0) <= 0) {
    throw new Error(`Blueprint "${blueprint.blueprintId}" is missing a valid build tick count.`);
  }

  return blueprint.buildTicks as number;
}

function getBlueprintRuntimeAttributes(blueprint: ConstructionBlueprint): RuntimeAttributes {
  return blueprint.runtimeAttributes && typeof blueprint.runtimeAttributes === "object"
    ? { ...blueprint.runtimeAttributes }
    : {};
}

function getBlueprintCapabilities(blueprint: ConstructionBlueprint): string[] {
  return Array.isArray(blueprint.capabilities)
    ? blueprint.capabilities.filter((capability): capability is string => typeof capability === "string")
    : [];
}

function getNextConstructedModuleId(outputModuleType: string, modules: HabitatModule[]): string {
  const existingCount = modules.filter((module) => module.blueprintId === outputModuleType).length;
  const pendingCount = listConstructionJobs().filter((entry) => entry.job.futureModule.blueprintId === outputModuleType).length;
  return `${outputModuleType}-${existingCount + pendingCount + 1}`;
}

function humanizeBlueprintId(value: string): string {
  return value
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildReadinessError(readiness: ConstructionReadiness): string {
  const problems: string[] = [];

  if (!readiness.facilityExists) {
    problems.push(`Required facility "${readiness.requiredFacility}" is missing.`);
  } else if (!readiness.facilityAvailable) {
    problems.push(`Required facility "${readiness.requiredFacility}" is busy or offline.`);
  }

  if (!readiness.supplyCacheOnline) {
    problems.push("Supply cache is not online.");
  }

  if (!readiness.prerequisitesMet) {
    problems.push("Blueprint prerequisites are not met.");
  }

  if (!readiness.inventoryReady) {
    problems.push("Inventory is missing required construction materials.");
  }

  if (!readiness.usablePower) {
    problems.push("Habitat does not have usable battery energy.");
  }

  return problems.join("\n");
}
