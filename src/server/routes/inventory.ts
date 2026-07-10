import { Hono } from "hono";
import { addInventory, listInventory } from "../../inventory";
import { listModules } from "../../modules";
import { syncRegisteredHabitatState } from "../services/registration-service";

export function registerInventoryRoutes(app: Hono): void {
  app.get("/inventory", async () => {
    await syncRegisteredHabitatState();
    return Response.json({
      inventory: listInventory(),
    });
  });

  app.post("/inventory/add", async (c) => {
    await syncRegisteredHabitatState();
    requireOnlineBatteryForMutation();
    const body = await c.req.json<{ resourceId: string; amount: number }>();

    return Response.json({
      inventory: addInventory(body.resourceId, body.amount),
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
