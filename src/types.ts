export type RuntimeAttributes = Record<string, unknown>;
export type InventoryRecord = Record<string, number>;

export type BlueprintReference = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  buildTicks?: number;
  repeatable?: boolean;
} & Record<string, unknown>;

export type ResourceReference = {
  id?: string;
  resourceId: string;
  resourceType?: string;
  displayName: string;
  name?: string;
  description?: string;
  status?: string;
  rarity?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
} & Record<string, unknown>;

export type StarterModulePayload = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: RuntimeAttributes;
  capabilities: string[];
};

export type HabitatHuman = { id: string; displayName: string; locationModuleId: string };
export type AlertContract = { schemaVersion: string; schema: Record<string, unknown> };
export type CarriedResources = Record<string, number>;
export type ExplorationState = { humanId: string | null; x: number; y: number; carried: CarriedResources; capacityKg: number; battery: number; batteryCapacity: number; batteryPerTick: number; oxygen: number; oxygenCapacity: number; oxygenPerTick: number };
export type HabitatAlert = { id: string; key: string; severity: string; status: "open" | "acknowledged" | "resolved"; source: string; createdAt: string; lastObservedAt: string; occurrenceCount: number; subjectHumanId?: string; subjectModuleId?: string };

export type HabitatModule = StarterModulePayload & {
  source: "starter" | "local";
};

export type HabitatModuleTelemetry = HabitatModule & {
  powerDrawKw: number;
};

export type ConstructionJob = {
  blueprintId: string;
  outputModuleId: string;
  buildTicks: number;
  remainingTicks: number;
  futureModule: HabitatModule;
};

export type TickStoppedReason = "completed" | "reserve_reached" | "capacity_reached";

export type SolarChargingReason =
  | "charged"
  | "no_usable_irradiance"
  | "no_solar_modules"
  | "solar_modules_offline"
  | "battery_modules_offline"
  | "battery_full";

export type SolarChargingResult = {
  reason: SolarChargingReason;
  irradianceWPerM2: number | null;
  condition: string | null;
  energyAddedKwh: number;
};

export type HabitatPowerSummary = {
  generationKw: number;
  consumptionKw: number;
  netPowerKw: number;
  batteryChargeKwh: number;
  batteryCapacityKwh: number;
  batteryReserveKwh: number;
  solar: {
    irradianceWPerM2: number | null;
    condition: string | null;
  };
};

export type TickSimulationResult = {
  requestedTicks: number;
  completedTicks: number;
  stoppedReason: TickStoppedReason;
  totalPowerDrawKw: number;
  energyConsumedKwh: number;
  batteryChargeBeforeKwh: number;
  batteryChargeAfterKwh: number;
  solarCharging?: SolarChargingResult;
  completedConstructionModuleIds?: string[];
};

export type BatteryRechargeResult = {
  requestedTicks: number;
  completedTicks: number;
  stoppedReason: TickStoppedReason;
  totalPowerDrawKw: number;
  energyAddedKwh: number;
  batteryChargeBeforeKwh: number;
  batteryChargeAfterKwh: number;
};

export type KeplerRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  habitatSlug?: string;
  catalogVersion?: string;
  status?: string;
  lastSeenAt?: string | null;
  blueprints?: BlueprintReference[];
};

export type HabitatData = Record<string, unknown> & {
  keplerRegistration?: KeplerRegistration;
  modules?: HabitatModule[];
  inventory?: InventoryRecord;
  habitatApiBaseUrl?: string;
  humans?: HabitatHuman[];
  exploration?: ExplorationState;
  alerts?: HabitatAlert[];
  alertContract?: AlertContract;
};
