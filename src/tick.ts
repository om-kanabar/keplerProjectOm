import { advanceConstructionTicks } from "./construction";
import { readData, writeData } from "./storage";
import { BatteryRechargeResult, HabitatModule, RuntimeAttributes, TickSimulationResult } from "./types";

const BATTERY_BLUEPRINT_IDS = new Set(["basic-battery", "battery-bank"]);
const TICK_RATIO_EPSILON = 1e-9;

export function runTickSimulation(requestedTicks: number): TickSimulationResult {
  if (!Number.isInteger(requestedTicks) || requestedTicks <= 0) {
    throw new Error("Tick count must be a positive integer.");
  }

  return runPowerFlowSimulation(requestedTicks, 1);
}

export function runBatteryRechargeSimulation(requestedTicks: number): BatteryRechargeResult {
  if (!Number.isInteger(requestedTicks) || requestedTicks <= 0) {
    throw new Error("Recharge tick count must be a positive integer.");
  }

  const result = runPowerFlowSimulation(requestedTicks, -1);

  return {
    requestedTicks: result.requestedTicks,
    completedTicks: Math.abs(result.completedTicks),
    stoppedReason: result.stoppedReason,
    totalPowerDrawKw: result.totalPowerDrawKw,
    energyAddedKwh: -result.energyConsumedKwh,
    batteryChargeBeforeKwh: result.batteryChargeBeforeKwh,
    batteryChargeAfterKwh: result.batteryChargeAfterKwh,
  };
}

export function isBatteryModule(module: HabitatModule): boolean {
  return BATTERY_BLUEPRINT_IDS.has(module.blueprintId);
}

function runPowerFlowSimulation(requestedTicks: number, direction: 1 | -1): TickSimulationResult {
  const data = readData();
  const modules = data.modules ?? [];
  const batteries = modules.filter(isBatteryModule);

  if (batteries.length === 0) {
    throw new Error(direction > 0 ? "No battery modules are available for ticking." : "No battery modules are available for recharging.");
  }

  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const batteryChargeBeforeKwh = sumBatteryMetric(batteries, "currentEnergyKwh");
  const simulation = simulatePowerTicks(modules, requestedTicks, direction);
  const completedTicks = simulation.completedTickCount * direction;
  const batteryChargeAfterKwh = sumBatteryMetric(
    simulation.modules.filter((module) => isBatteryModule(module)),
    "currentEnergyKwh",
  );
  const actualEnergyConsumedKwh = batteryChargeBeforeKwh - batteryChargeAfterKwh;

  writeData({
    ...data,
    modules: simulation.modules,
  });

  return {
    requestedTicks,
    completedTicks,
    stoppedReason: getStoppedReason(requestedTicks * direction, completedTicks),
    totalPowerDrawKw: simulation.averagePowerDrawKw ?? totalPowerDrawKw,
    energyConsumedKwh: actualEnergyConsumedKwh,
    batteryChargeBeforeKwh,
    batteryChargeAfterKwh,
    completedConstructionModuleIds: simulation.completedConstructionModuleIds,
  };
}

function calculateTotalPowerDrawKw(modules: HabitatModule[]): number {
  return modules.filter((module) => !isBatteryModule(module)).reduce((sum, module) => {
    return sum + getModulePowerDrawKw(module);
  }, 0);
}

export function getModulePowerDrawKw(module: HabitatModule): number {
  const status = typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : undefined;
  const powerDraw = module.runtimeAttributes.powerDrawKw;

  if (!powerDraw || typeof powerDraw !== "object" || Array.isArray(powerDraw)) {
    return 0;
  }

  const powerDrawMap = powerDraw as Record<string, unknown>;
  const normalizedStatus = normalizeModuleStatus(status);

  if (normalizedStatus !== undefined) {
    const directValue = getFiniteNumber(powerDrawMap[normalizedStatus]);

    if (directValue !== undefined) {
      return directValue;
    }

    if (normalizedStatus === "online") {
      const legacyIdleValue = getFiniteNumber(powerDrawMap.idle);

      if (legacyIdleValue !== undefined) {
        return legacyIdleValue;
      }
    }
  }

  return getFiniteNumber(powerDrawMap.offline) ?? 0;
}

function simulatePowerTicks(
  modules: HabitatModule[],
  requestedTicks: number,
  direction: 1 | -1,
): {
  modules: HabitatModule[];
  completedTickCount: number;
  averagePowerDrawKw?: number;
  completedConstructionModuleIds: string[];
} {
  let currentModules = modules;
  let completedTickCount = 0;
  let accumulatedPowerDrawKw = 0;
  const completedConstructionModuleIds: string[] = [];

  for (let index = 0; index < requestedTicks; index += 1) {
    currentModules = normalizeConstructionFacilities(currentModules);
    const totalPowerDrawKw = calculateTotalPowerDrawKw(currentModules);
    const energyPerTickKwh = totalPowerDrawKw / 3600;

    if (!canCompletePowerTick(currentModules, energyPerTickKwh, direction)) {
      break;
    }

    accumulatedPowerDrawKw += totalPowerDrawKw;
    currentModules = applyBatteryEnergyChange(currentModules, energyPerTickKwh * direction);
    completedTickCount += 1;

    if (direction > 0) {
      const constructionUpdate = advanceConstructionTicks(currentModules, 1);
      currentModules = constructionUpdate.modules;
      completedConstructionModuleIds.push(...constructionUpdate.completedModuleIds);
      continue;
    }
  }

  if (direction < 0 && completedTickCount < requestedTicks) {
    currentModules = topOffBatteryEnergy(currentModules);
  }

  return {
    modules: currentModules,
    completedTickCount,
    averagePowerDrawKw:
      completedTickCount > 0 ? accumulatedPowerDrawKw / completedTickCount : undefined,
    completedConstructionModuleIds,
  };
}

function canCompletePowerTick(modules: HabitatModule[], energyPerTickKwh: number, direction: 1 | -1): boolean {
  if (energyPerTickKwh <= 0) {
    return true;
  }

  const batteries = modules.filter(isBatteryModule);
  const batteryChargeKwh = sumBatteryMetric(batteries, "currentEnergyKwh");
  const limitKwh =
    direction > 0
      ? sumBatteryMetric(batteries, "reserveKwh")
      : sumBatteryMetric(batteries, "energyStorageKwh");
  const availableEnergyKwh =
    direction > 0
      ? Math.max(0, batteryChargeKwh - limitKwh)
      : Math.max(0, limitKwh - batteryChargeKwh);

  return availableEnergyKwh + TICK_RATIO_EPSILON >= energyPerTickKwh;
}

function normalizeConstructionFacilities(modules: HabitatModule[]): HabitatModule[] {
  return modules.map((module) => {
    if (!module.runtimeAttributes.constructionJob) {
      return module;
    }

    if (module.runtimeAttributes.status === "active") {
      return module;
    }

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        status: "active",
      },
    };
  });
}

function applyBatteryEnergyChange(modules: HabitatModule[], energyConsumedKwh: number): HabitatModule[] {
  let remainingEnergyKwh = Math.abs(energyConsumedKwh);
  const isDischarge = energyConsumedKwh >= 0;

  return modules.map((module) => {
    if (!isBatteryModule(module) || remainingEnergyKwh <= 0) {
      return module;
    }

    const currentEnergyKwh = getRuntimeNumber(module.runtimeAttributes, "currentEnergyKwh");
    const energyStorageKwh = getRuntimeNumber(module.runtimeAttributes, "energyStorageKwh");
    const appliedEnergyKwh = isDischarge
      ? Math.min(currentEnergyKwh, remainingEnergyKwh)
      : Math.min(Math.max(0, energyStorageKwh - currentEnergyKwh), remainingEnergyKwh);
    remainingEnergyKwh -= appliedEnergyKwh;

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        currentEnergyKwh: isDischarge
          ? currentEnergyKwh - appliedEnergyKwh
          : currentEnergyKwh + appliedEnergyKwh,
      },
    };
  });
}

function topOffBatteryEnergy(modules: HabitatModule[]): HabitatModule[] {
  const batteryModules = modules.filter(isBatteryModule);
  const batteryCharge = sumBatteryMetric(batteryModules, "currentEnergyKwh");
  const batteryCapacity = sumBatteryMetric(batteryModules, "energyStorageKwh");
  let remainingEnergyKwh = Math.max(0, batteryCapacity - batteryCharge);

  if (remainingEnergyKwh <= 0) {
    return modules;
  }

  return modules.map((module) => {
    if (!isBatteryModule(module) || remainingEnergyKwh <= 0) {
      return module;
    }

    const currentEnergyKwh = getRuntimeNumber(module.runtimeAttributes, "currentEnergyKwh");
    const energyStorageKwh = getRuntimeNumber(module.runtimeAttributes, "energyStorageKwh");
    const appliedEnergyKwh = Math.min(Math.max(0, energyStorageKwh - currentEnergyKwh), remainingEnergyKwh);
    remainingEnergyKwh -= appliedEnergyKwh;

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        currentEnergyKwh: currentEnergyKwh + appliedEnergyKwh,
      },
    };
  });
}

function getStoppedReason(requestedTicks: number, completedTicks: number): TickSimulationResult["stoppedReason"] {
  if (requestedTicks === completedTicks) {
    return "completed";
  }

  return requestedTicks > 0 ? "reserve_reached" : "capacity_reached";
}

function sumBatteryMetric(modules: HabitatModule[], key: string): number {
  return modules.reduce((sum, module) => sum + getRuntimeNumber(module.runtimeAttributes, key), 0);
}

function getRuntimeNumber(runtimeAttributes: RuntimeAttributes, key: string): number {
  return getFiniteNumber(runtimeAttributes[key]) ?? 0;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeModuleStatus(status: string | undefined): string | undefined {
  if (status === "idle") {
    return "online";
  }

  return status;
}
