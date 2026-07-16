export type DashboardMode = "regular" | "display" | "info";
export type AlertSeverity = "informational" | "warning" | "critical";
export type ModuleStatus = "online" | "standby" | "degraded" | "active" | "offline" | "damaged" | "under-construction";
export type WorkKind = "construction" | "research" | "maintenance" | "mission";

export type ResourceSummary = {
  id: string;
  label: string;
  value: string;
  interpretation: string;
  percent?: number;
  tone: "good" | "watch" | "critical" | "neutral";
  detail: string;
};

export type HabitatAlertView = {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  action?: string;
};

export type ModuleSummary = {
  id: string;
  label: string;
  blueprintId: string;
  status: ModuleStatus;
  powerDrawKw: number;
  detail: string;
};

export type ActiveWorkItem = {
  id: string;
  kind: WorkKind;
  label: string;
  detail: string;
  percent?: number;
};

export type ActivityEvent = {
  id: string;
  occurredAt: string;
  label: string;
  detail: string;
  tone: "neutral" | "watch" | "good";
};

export type RegularModeSnapshot = {
  connection: "connected" | "disconnected";
  registration: { displayName: string; status?: string } | null;
  overall: { label: string; detail: string; tone: "good" | "watch" | "critical" | "neutral" };
  resources: ResourceSummary[];
  alerts: HabitatAlertView[];
  modules: ModuleSummary[];
  activeWork: ActiveWorkItem[];
  activity: ActivityEvent[];
  clock: { mode: "manual" | "kepler"; listening: boolean; connectionStatus: string; latestKeplerTick: number | null; latestAdvancedBy: number | null; lastError: string | null };
};

const operatingLines = [
  "Conditions outside remain unfavorable for humans.",
  "The atmosphere continues to be a poor place for unprotected opinions.",
  "Exterior conditions are stable, which is habitat language for tolerable.",
  "The planet is still declining our application for outdoor living.",
];

export function pickOperatingLine(index = Math.floor(Math.random() * operatingLines.length)): string {
  return operatingLines[Math.abs(index) % operatingLines.length];
}

export function parseCustomTicks(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const ticks = Number(value);
  return Number.isSafeInteger(ticks) && ticks > 0 ? ticks : null;
}

export function normalizeStatusSnapshot(input: any): RegularModeSnapshot {
  const power = input?.power;
  const registration = input?.registration ?? null;
  const modules = Array.isArray(input?.modules) ? input.modules.map(normalizeModule) : [];
  const alerts = input?.alertsError ? [] : (Array.isArray(input?.alerts) ? input.alerts.map(normalizeAlert) : []);
  const activeWork = input?.constructionError ? [] : normalizeConstruction(input?.construction);
  const resources = power ? normalizeResources(power) : [];
  const critical = alerts.some((alert) => alert.severity === "critical");
  const warning = alerts.some((alert) => alert.severity === "warning");

  return {
    connection: input?.connection === "disconnected" || input?.alertsError || input?.constructionError ? "disconnected" : "connected",
    registration,
    overall: critical ? { label: "Action required", detail: "A critical alert needs attention.", tone: "critical" } : warning ? { label: "Needs attention", detail: "Review the warning below.", tone: "watch" } : { label: "Operating normally", detail: "No immediate action is required.", tone: "good" },
    resources,
    alerts,
    modules,
    activeWork,
    activity: Array.isArray(input?.activity) ? input.activity : [],
    clock: { mode: input?.clock?.mode === "kepler" ? "kepler" : "manual", listening: input?.clock?.listening === true, connectionStatus: String(input?.clock?.connectionStatus ?? "disconnected"), latestKeplerTick: typeof input?.clock?.latestKeplerTick === "number" ? input.clock.latestKeplerTick : null, latestAdvancedBy: typeof input?.clock?.latestAdvancedBy === "number" ? input.clock.latestAdvancedBy : null, lastError: typeof input?.clock?.lastError === "string" ? input.clock.lastError : null },
  };
}

function normalizeResources(power: any): ResourceSummary[] {
  const batteryPercent = power.batteryCapacityKwh > 0 ? Math.round(power.batteryChargeKwh / power.batteryCapacityKwh * 100) : 0;
  const reservePercent = power.batteryCapacityKwh > 0 ? Math.round(power.batteryReserveKwh / power.batteryCapacityKwh * 100) : 0;
  return [
    { id: "power", label: "Power", value: `${format(power.netPowerKw)} kW`, interpretation: power.netPowerKw >= 0 ? "Stable" : "Draw exceeds generation", tone: power.netPowerKw >= 0 ? "good" : "critical", detail: `${format(power.generationKw)} kW generated · ${format(power.consumptionKw)} kW consumed` },
    { id: "battery", label: "Battery", value: `${batteryPercent}%`, percent: batteryPercent, interpretation: batteryPercent > reservePercent + 10 ? "Healthy reserve" : "Near reserve", tone: batteryPercent > reservePercent + 10 ? "good" : "watch", detail: `${format(power.batteryChargeKwh)} of ${format(power.batteryCapacityKwh)} kWh` },
    { id: "solar", label: "Solar", value: power.solar?.irradianceWPerM2 == null ? "Unavailable" : `${format(power.solar.irradianceWPerM2)} W/m²`, interpretation: power.solar?.condition ?? "Conditions unavailable", tone: "neutral", detail: "Current surface irradiance" },
    { id: "reserve", label: "Reserve", value: `${format(power.batteryReserveKwh)} kWh`, interpretation: "Protected capacity", tone: "neutral", detail: `${reservePercent}% of battery capacity` },
  ];
}

function normalizeAlert(alert: any): HabitatAlertView {
  const severity = normalizeSeverity(alert?.severity);
  return { id: String(alert?.id ?? alert?.key ?? crypto.randomUUID()), severity, title: humanize(alert?.key ?? alert?.source ?? "Habitat event"), detail: `${humanize(alert?.source ?? "Habitat")} reported this ${severity} condition.`, action: severity === "critical" || severity === "warning" ? "Review subsystem" : undefined };
}

function normalizeModule(module: any): ModuleSummary {
  const rawStatus = String(module?.runtimeAttributes?.status ?? "offline");
  const underConstruction = module?.runtimeAttributes?.constructionJob != null;
  const status: ModuleStatus = underConstruction ? "under-construction" : rawStatus === "idle" ? "online" : rawStatus === "active" ? "active" : rawStatus === "damaged" ? "damaged" : rawStatus === "online" || rawStatus === "offline" ? rawStatus : "standby";
  return { id: String(module?.id), label: String(module?.displayName ?? module?.id ?? "Unnamed module"), blueprintId: String(module?.blueprintId ?? "module"), status, powerDrawKw: Number(module?.powerDrawKw ?? 0), detail: `${format(Number(module?.powerDrawKw ?? 0))} kW draw` };
}

function normalizeConstruction(construction: any): ActiveWorkItem[] {
  const jobs = Array.isArray(construction?.jobs) ? construction.jobs : [];
  return jobs.map((job: any, index: number) => { const total = Number(job?.buildTicks ?? 0); const remaining = Number(job?.remainingTicks ?? 0); return { id: String(job?.outputModuleId ?? job?.blueprintId ?? index), kind: "construction", label: humanize(job?.blueprintId ?? "Construction"), detail: `${format(remaining)} ticks remaining`, percent: total > 0 ? Math.round((total - remaining) / total * 100) : undefined }; });
}

function normalizeSeverity(value: unknown): AlertSeverity { return value === "critical" ? "critical" : value === "warning" ? "warning" : "informational"; }
function humanize(value: unknown): string { return String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function format(value: number): string { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0); }
