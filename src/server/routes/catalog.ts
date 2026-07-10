import { Hono } from "hono";
import { listModules } from "../../modules";
import { getBlueprint, listBlueprints } from "../../blueprints";
import { listResources, listResourcesWithInventory, addResource, addResourcesForBlueprint } from "../../resources";
import { fetchSolarIrradiance } from "../../kepler";
import { syncRegisteredHabitatState } from "../services/registration-service";

export function registerCatalogRoutes(app: Hono): void {
  app.get("/catalog/blueprints", async () => {
    return Response.json({
      blueprints: await listBlueprints(),
    });
  });

  app.get("/catalog/blueprints/:blueprintId", async (c) => {
    return Response.json({
      blueprint: await getBlueprint(c.req.param("blueprintId")),
    });
  });

  app.get("/catalog/resources", async () => {
    return Response.json({
      resources: await listResources(),
    });
  });

  app.get("/resources", async () => {
    await syncRegisteredHabitatState();
    return Response.json({
      resources: await listResourcesWithInventory(),
    });
  });

  app.post("/resources/add", async (c) => {
    await syncRegisteredHabitatState();
    requireOnlineBatteryForMutation();
    requireOnlineSupplyCache();
    const body = await c.req.json<{ resourceId: string; amount?: number }>();

    if (body.amount === undefined) {
      return Response.json(await addResourcesForBlueprint(body.resourceId));
    }

    return Response.json({
      inventory: await addResource(body.resourceId, body.amount),
    });
  });

  app.get("/solar/irradiance", async () => {
    return Response.json({
      solarIrradiance: await fetchSolarIrradiance(),
    });
  });
}

function requireOnlineBatteryForMutation(): void {
  const batteryModules = listModules().filter(
    (module) => module.blueprintId === "basic-battery" || module.blueprintId === "battery-bank",
  );

  if (batteryModules.length === 0) {
    return;
  }

  const hasOnlineBattery = batteryModules.some((module) => {
    const status = module.runtimeAttributes.status;
    return status === "online" || status === "active";
  });

  if (!hasOnlineBattery) {
    throw new Error("At least one battery module must be online to perform this action.");
  }
}

function requireOnlineSupplyCache(): void {
  const supplyCache = listModules().find((module) => module.blueprintId === "supply-cache");

  if (!supplyCache) {
    throw new Error("Supply cache must be online to add resources.");
  }

  const status = supplyCache.runtimeAttributes.status;

  if (status !== "online" && status !== "active") {
    throw new Error("Supply cache must be online to add resources.");
  }
}
