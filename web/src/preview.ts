type PreviewLocation = {
  hostname: string;
  port: string;
  search: string;
};

export function isAuthSkipPreview(location: PreviewLocation): boolean {
  return (
    location.hostname === "127.0.0.1" &&
    new URLSearchParams(location.search).has("authskip")
  );
}

export const previewSnapshot = {
  registration: { displayName: "Artemis Ridge", status: "preview" },
  modules: [
    {
      id: "preview-command",
      displayName: "Command Module",
      blueprintId: "command-module",
      powerDrawKw: 0.4,
      runtimeAttributes: { status: "online" },
    },
    {
      id: "preview-life-support",
      displayName: "Life Support",
      blueprintId: "life-support",
      powerDrawKw: 2.8,
      runtimeAttributes: { status: "online" },
    },
    {
      id: "preview-solar",
      displayName: "Solar Array",
      blueprintId: "small-solar-array",
      powerDrawKw: 0,
      runtimeAttributes: { status: "online" },
    },
  ],
  power: {
    generationKw: 4.6,
    consumptionKw: 3.2,
    netPowerKw: 1.4,
    batteryChargeKwh: 360,
    batteryCapacityKwh: 500,
    batteryReserveKwh: 60,
    solar: { irradianceWPerM2: 720, condition: "clear" },
  },
  alerts: [],
  construction: { jobs: [] },
  activity: [
    { id: "preview-1", occurredAt: "14:32", label: "Water recycling returned to nominal efficiency.", detail: "Life support systems report stable operation.", tone: "good" },
    { id: "preview-2", occurredAt: "13:58", label: "Solar Array entered normal generation.", detail: "Surface irradiance is within expected range.", tone: "neutral" },
  ],
};
