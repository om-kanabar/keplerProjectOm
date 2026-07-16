import { Hono } from "hono";
import { listModules } from "../../modules";
import { getCurrentPowerSummary, getModulePowerDrawKw } from "../../tick";
import { HabitatPowerSummary } from "../../types";
import { createRegistration, deleteRegistration, getRegistration, syncRegisteredHabitatState } from "../services/registration-service";
import { getClockState } from "../kepler-stream";

export function registerRegistrationRoutes(app: Hono): void {
  app.get("/registration", async (c) => {
    await syncRegisteredHabitatState();
    const registration = await getRegistration();
    return Response.json({
      registration: registration ?? null,
    });
  });

  app.get("/status", async (c) => {
    await syncRegisteredHabitatState();
    const registration = await getRegistration();
    return Response.json({
      registration: registration ?? null,
      modules: listModules().map((module) => ({
        ...module,
        powerDrawKw: getModulePowerDrawKw(module),
      })),
      power: registration ? await getCurrentPowerSummary() : emptyPowerSummary(),
      ...(registration ? { clock: getClockState() } : {}),
    });
  });

  app.post("/registration", async (c) => {
    const body = await c.req.json<{ displayName?: string }>();
    const registration = await createRegistration(body.displayName ?? "");

    return Response.json({ registration }, { status: 201 });
  });

  app.delete("/registration", async (c) => {
    const registration = await deleteRegistration();
    return Response.json({ registration });
  });
}

function emptyPowerSummary(): HabitatPowerSummary {
  return {
    generationKw: 0,
    consumptionKw: 0,
    netPowerKw: 0,
    batteryChargeKwh: 0,
    batteryCapacityKwh: 0,
    batteryReserveKwh: 0,
    solar: { irradianceWPerM2: null, condition: null },
  };
}
