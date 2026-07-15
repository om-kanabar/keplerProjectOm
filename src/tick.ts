import { advanceConstructionTicks } from "./construction";
import { fetchSolarIrradiance } from "./kepler";
import { readData, writeData } from "./storage";
import { drainEvaForTicks } from "./eva";
import {
  BatteryRechargeResult,
  HabitatPowerSummary,
  HabitatModule,
  RuntimeAttributes,
  SolarChargingReason,
  SolarChargingResult,
  TickSimulationResult,
} from "./types";

const BATTERY_BLUEPRINT_IDS = new Set(["basic-battery", "battery-bank"]);
const SOLAR_EFFICIENCY = 0.5;
const CLEAR_DAY_IRRADIANCE_W_PER_M2 = 900;
const TICK_RATIO_EPSILON = 1e-9;

type SolarEnvironment = {
  irradianceWPerM2: number | null;
  condition: string | null;
};

export async function runTickSimulation(requestedTicks: number): Promise<TickSimulationResult> {
  if (!Number.isInteger(requestedTicks) || requestedTicks <= 0) {
    throw new Error("Tick count must be a positive integer.");
  }

  const solarEnvironment = await readSolarEnvironment();
  return runPowerFlowSimulation(requestedTicks, 1, solarEnvironment);
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

export async function getCurrentPowerSummary(): Promise<HabitatPowerSummary> {
  const modules = readData().modules ?? [];
  const solarEnvironment = await readSolarEnvironment();
  const batteries = modules.filter(isBatteryModule);
  const generationKw = calculateAvailableSolarGenerationKw(modules, solarEnvironment);
  const consumptionKw = calculateTotalPowerDrawKw(modules);

  return {
    generationKw,
    consumptionKw,
    netPowerKw: generationKw - consumptionKw,
    batteryChargeKwh: sumBatteryMetric(batteries, "currentEnergyKwh"),
    batteryCapacityKwh: sumBatteryMetric(batteries, "energyStorageKwh"),
    batteryReserveKwh: sumBatteryMetric(batteries, "reserveKwh"),
    solar: {
      irradianceWPerM2: solarEnvironment.irradianceWPerM2,
      condition: solarEnvironment.condition,
    },
  };
}

function runPowerFlowSimulation(
  requestedTicks: number,
  direction: 1 | -1,
  solarEnvironment?: SolarEnvironment,
): TickSimulationResult {
  const data = readData();
  const modules = data.modules ?? [];
  const batteries = modules.filter(isBatteryModule);

  if (batteries.length === 0) {
    throw new Error(direction > 0 ? "No battery modules are available for ticking." : "No battery modules are available for recharging.");
  }

  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const batteryChargeBeforeKwh = sumBatteryMetric(batteries, "currentEnergyKwh");
  const simulation = simulatePowerTicks(modules, requestedTicks, direction, solarEnvironment);
  const completedTicks = simulation.completedTickCount * direction;
  const batteryChargeAfterKwh = sumBatteryMetric(
    simulation.modules.filter((module) => isBatteryModule(module)),
    "currentEnergyKwh",
  );
  const actualEnergyConsumedKwh =
    direction > 0 ? simulation.totalLoadEnergyConsumedKwh : batteryChargeBeforeKwh - batteryChargeAfterKwh;

  const exploration = drainEvaForTicks(data.exploration ?? { humanId: null, x: 0, y: 0, carried: {}, capacityKg: 20, battery: 100, batteryCapacity: 100, batteryPerTick: 2, oxygen: 100, oxygenCapacity: 100, oxygenPerTick: 3 }, simulation.completedTickCount);
  writeData({
    ...data,
    modules: simulation.modules,
    exploration,
  });

  return {
    requestedTicks,
    completedTicks,
    stoppedReason: getStoppedReason(requestedTicks * direction, completedTicks),
    totalPowerDrawKw: simulation.averagePowerDrawKw ?? totalPowerDrawKw,
    energyConsumedKwh: actualEnergyConsumedKwh,
    batteryChargeBeforeKwh,
    batteryChargeAfterKwh,
    solarCharging:
      direction > 0
        ? summarizeSolarCharging(simulation.solarEnergyAddedKwh, simulation.lastSolarReason, solarEnvironment)
        : undefined,
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
  solarEnvironment?: SolarEnvironment,
): {
  modules: HabitatModule[];
  completedTickCount: number;
  totalLoadEnergyConsumedKwh: number;
  averagePowerDrawKw?: number;
  solarEnergyAddedKwh: number;
  lastSolarReason: SolarChargingReason;
  completedConstructionModuleIds: string[];
} {
  let currentModules = modules;
  let completedTickCount = 0;
  let accumulatedPowerDrawKw = 0;
  let totalLoadEnergyConsumedKwh = 0;
  let solarEnergyAddedKwh = 0;
  let lastSolarReason: SolarChargingReason = "no_solar_modules";
  const completedConstructionModuleIds: string[] = [];

  for (let index = 0; index < requestedTicks; index += 1) {
    currentModules = normalizeConstructionFacilities(currentModules);
    const totalPowerDrawKw = calculateTotalPowerDrawKw(currentModules);
    const energyPerTickKwh = totalPowerDrawKw / 3600;

    if (!canCompletePowerTick(currentModules, energyPerTickKwh, direction)) {
      break;
    }

    accumulatedPowerDrawKw += totalPowerDrawKw;
    totalLoadEnergyConsumedKwh += energyPerTickKwh;
    currentModules = applyBatteryEnergyChange(currentModules, energyPerTickKwh * direction);

    if (direction > 0) {
      const solarCharging = applySolarChargingForCompletedTick(currentModules, solarEnvironment);
      currentModules = solarCharging.modules;
      solarEnergyAddedKwh += solarCharging.energyAddedKwh;
      lastSolarReason = solarCharging.reason;
    }

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
    totalLoadEnergyConsumedKwh,
    averagePowerDrawKw:
      completedTickCount > 0 ? accumulatedPowerDrawKw / completedTickCount : undefined,
    solarEnergyAddedKwh,
    lastSolarReason,
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

function applySolarChargingForCompletedTick(
  modules: HabitatModule[],
  solarEnvironment?: SolarEnvironment,
): { modules: HabitatModule[]; energyAddedKwh: number; reason: SolarChargingReason } {
  const solarModules = modules.filter(isSolarModule);

  if (solarModules.length === 0) {
    return { modules, energyAddedKwh: 0, reason: "no_solar_modules" };
  }

  const onlineSolarModules = solarModules.filter(
    (module) => isOperationalForSolar(module) && getModulePowerGenerationKw(module) > 0,
  );

  if (onlineSolarModules.length === 0) {
    return { modules, energyAddedKwh: 0, reason: "solar_modules_offline" };
  }

  const batteries = modules.filter(isBatteryModule);
  const onlineBatteries = batteries.filter(isOperationalForSolar);

  if (onlineBatteries.length === 0) {
    return { modules, energyAddedKwh: 0, reason: "battery_modules_offline" };
  }

  const availableCapacityKwh = onlineBatteries.reduce((sum, module) => {
    const currentEnergyKwh = getRuntimeNumber(module.runtimeAttributes, "currentEnergyKwh");
    const energyStorageKwh = getRuntimeNumber(module.runtimeAttributes, "energyStorageKwh");
    return sum + Math.max(0, energyStorageKwh - currentEnergyKwh);
  }, 0);

  if (availableCapacityKwh <= TICK_RATIO_EPSILON) {
    return { modules, energyAddedKwh: 0, reason: "battery_full" };
  }

  if (!solarEnvironment || solarEnvironment.irradianceWPerM2 === null || solarEnvironment.irradianceWPerM2 <= 0) {
    return { modules, energyAddedKwh: 0, reason: "no_usable_irradiance" };
  }

  const generatedKwhPerTick = calculateAvailableSolarGenerationKw(modules, solarEnvironment) / 3600;

  if (generatedKwhPerTick <= TICK_RATIO_EPSILON) {
    return { modules, energyAddedKwh: 0, reason: "no_usable_irradiance" };
  }

  const appliedCharge = applySolarBatteryCharge(modules, generatedKwhPerTick);

  return {
    modules: appliedCharge.modules,
    energyAddedKwh: appliedCharge.energyAddedKwh,
    reason: appliedCharge.energyAddedKwh > TICK_RATIO_EPSILON ? "charged" : "battery_full",
  };
}

function applySolarBatteryCharge(modules: HabitatModule[], generatedKwh: number): {
  modules: HabitatModule[];
  energyAddedKwh: number;
} {
  let remainingEnergyKwh = generatedKwh;
  let appliedEnergyKwh = 0;

  const nextModules = modules.map((module) => {
    if (!isBatteryModule(module) || !isOperationalForSolar(module) || remainingEnergyKwh <= 0) {
      return module;
    }

    const currentEnergyKwh = getRuntimeNumber(module.runtimeAttributes, "currentEnergyKwh");
    const energyStorageKwh = getRuntimeNumber(module.runtimeAttributes, "energyStorageKwh");
    const chargeRoomKwh = Math.max(0, energyStorageKwh - currentEnergyKwh);
    const appliedToModuleKwh = Math.min(chargeRoomKwh, remainingEnergyKwh);
    remainingEnergyKwh -= appliedToModuleKwh;
    appliedEnergyKwh += appliedToModuleKwh;

    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        currentEnergyKwh: currentEnergyKwh + appliedToModuleKwh,
      },
    };
  });

  return {
    modules: nextModules,
    energyAddedKwh: appliedEnergyKwh,
  };
}

function summarizeSolarCharging(
  energyAddedKwh: number,
  reason: SolarChargingReason,
  solarEnvironment?: SolarEnvironment,
): SolarChargingResult {
  return {
    reason: energyAddedKwh > TICK_RATIO_EPSILON ? "charged" : reason,
    irradianceWPerM2: solarEnvironment?.irradianceWPerM2 ?? null,
    condition: solarEnvironment?.condition ?? null,
    energyAddedKwh,
  };
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

function isSolarModule(module: HabitatModule): boolean {
  return module.capabilities.includes("power-generation") || getFiniteNumber(module.runtimeAttributes.powerGenerationKw) !== undefined;
}

function getModulePowerGenerationKw(module: HabitatModule): number {
  return getFiniteNumber(module.runtimeAttributes.powerGenerationKw) ?? 0;
}

function calculateAvailableSolarGenerationKw(
  modules: HabitatModule[],
  solarEnvironment: SolarEnvironment,
): number {
  if (solarEnvironment.irradianceWPerM2 === null || solarEnvironment.irradianceWPerM2 <= 0) {
    return 0;
  }

  const totalPowerGenerationKw = modules
    .filter((module) => isSolarModule(module) && isOperationalForSolar(module))
    .reduce((sum, module) => sum + getModulePowerGenerationKw(module), 0);
  const solarMultiplier = solarEnvironment.irradianceWPerM2 / CLEAR_DAY_IRRADIANCE_W_PER_M2;

  return totalPowerGenerationKw * solarMultiplier * SOLAR_EFFICIENCY;
}

function isOperationalForSolar(module: HabitatModule): boolean {
  const normalizedStatus = normalizeModuleStatus(
    typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : undefined,
  );

  return normalizedStatus === "online" || normalizedStatus === "active";
}

async function readSolarEnvironment(): Promise<SolarEnvironment> {
  const response = await fetchSolarIrradiance();
  const solarIrradiance =
    response.solarIrradiance && typeof response.solarIrradiance === "object" && !Array.isArray(response.solarIrradiance)
      ? (response.solarIrradiance as Record<string, unknown>)
      : {};
  return {
    irradianceWPerM2: getFiniteNumber(solarIrradiance.wPerM2) ?? getFiniteNumber(solarIrradiance.wattsPerSquareMeter) ?? null,
    condition: typeof solarIrradiance.condition === "string" ? solarIrradiance.condition : null,
  };
}

function normalizeModuleStatus(status: string | undefined): string | undefined {
  if (status === "idle") {
    return "online";
  }

  return status;
}
