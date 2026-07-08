import { readData, writeData } from "./storage";
import { HabitatModule, RuntimeAttributes, TickSimulationResult } from "./types";

const BATTERY_BLUEPRINT_IDS = new Set(["basic-battery", "battery-bank"]);
const TICK_RATIO_EPSILON = 1e-9;
const TICKS_PER_HOUR = 3600;

export function runTickSimulation(requestedTicks: number): TickSimulationResult {
  if (!Number.isInteger(requestedTicks) || requestedTicks === 0) {
    throw new Error("Tick count must be a non-zero integer.");
  }

  const data = readData();
  const modules = data.modules ?? [];
  const batteries = modules.filter(isBatteryModule);

  if (batteries.length === 0) {
    throw new Error("No battery modules are available for ticking.");
  }

  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const batteryChargeBeforeKwh = sumBatteryMetric(batteries, "currentEnergyKwh");
  const batteryReserveKwh = sumBatteryMetric(batteries, "reserveKwh");
  const batteryCapacityKwh = sumBatteryMetric(batteries, "energyStorageKwh");
  const energyPerTickKwh = totalPowerDrawKw / 3600;
  const direction = Math.sign(requestedTicks);
  const requestedTickCount = Math.abs(requestedTicks);
  const completedTickCount = calculateCompletedTicks(
    requestedTickCount,
    batteryChargeBeforeKwh,
    batteryReserveKwh,
    batteryCapacityKwh,
    energyPerTickKwh,
    direction,
  );
  const completedTicks = completedTickCount * direction;
  const energyConsumedKwh = completedTicks * energyPerTickKwh;
  const batteryChargeAfterKwh = batteryChargeBeforeKwh - energyConsumedKwh;
  const updatedModules = applyBatteryEnergyChange(modules, energyConsumedKwh);

  writeData({
    ...data,
    modules: updatedModules,
  });

  return {
    requestedTicks,
    completedTicks,
    stoppedReason: getStoppedReason(requestedTicks, completedTicks),
    totalPowerDrawKw,
    energyConsumedKwh,
    batteryChargeBeforeKwh,
    batteryChargeAfterKwh,
  };
}

export function isBatteryModule(module: HabitatModule): boolean {
  return BATTERY_BLUEPRINT_IDS.has(module.blueprintId);
}

export function summarizePowerState(modules: HabitatModule[]): {
  batteryChargeKwh: number;
  batteryCapacityKwh: number;
  drainPerTickKwh: number;
  drainPerTickHourKwh: number;
  rows: Array<{ moduleId: string; displayName: string; status: string; drawKw: number; drawPerTickHourKwh: number }>;
} {
  const batteries = modules.filter(isBatteryModule);
  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const drainPerTickKwh = totalPowerDrawKw / 3600;

  return {
    batteryChargeKwh: sumBatteryMetric(batteries, "currentEnergyKwh"),
    batteryCapacityKwh: sumBatteryMetric(batteries, "energyStorageKwh"),
    drainPerTickKwh,
    drainPerTickHourKwh: drainPerTickKwh * TICKS_PER_HOUR,
    rows: modules.map((module) => ({
      moduleId: module.id,
      displayName: module.displayName,
      status: typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "(unknown)",
      drawKw: getModulePowerDrawKw(module),
      drawPerTickHourKwh: (getModulePowerDrawKw(module) / 3600) * TICKS_PER_HOUR,
    })),
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

  if (status !== undefined) {
    const directValue = getFiniteNumber(powerDrawMap[status]);

    if (directValue !== undefined) {
      return directValue;
    }
  }

  return getFiniteNumber(powerDrawMap.offline) ?? 0;
}

function calculateCompletedTicks(
  requestedTicks: number,
  batteryChargeBeforeKwh: number,
  batteryReserveKwh: number,
  batteryCapacityKwh: number,
  energyPerTickKwh: number,
  direction: number,
): number {
  if (energyPerTickKwh <= 0) {
    return requestedTicks;
  }

  const availableEnergyKwh =
    direction > 0
      ? Math.max(0, batteryChargeBeforeKwh - batteryReserveKwh)
      : Math.max(0, batteryCapacityKwh - batteryChargeBeforeKwh);
  const possibleTicks = Math.floor(availableEnergyKwh / energyPerTickKwh + TICK_RATIO_EPSILON);

  return Math.min(requestedTicks, possibleTicks);
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
