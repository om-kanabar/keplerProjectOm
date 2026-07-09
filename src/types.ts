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

export type HabitatModule = StarterModulePayload & {
  source: "starter" | "local";
};

export type ConstructionJob = {
  blueprintId: string;
  outputModuleId: string;
  buildTicks: number;
  remainingTicks: number;
  futureModule: HabitatModule;
};

export type TickStoppedReason = "completed" | "reserve_reached" | "capacity_reached";

export type TickSimulationResult = {
  requestedTicks: number;
  completedTicks: number;
  stoppedReason: TickStoppedReason;
  totalPowerDrawKw: number;
  energyConsumedKwh: number;
  batteryChargeBeforeKwh: number;
  batteryChargeAfterKwh: number;
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
};
