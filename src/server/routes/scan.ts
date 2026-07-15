import { Hono } from "hono";
import { fetchWorldScan } from "../../kepler";
import { readData } from "../../storage";
import { getEvaStatus } from "../../eva";

function int(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}
function bounded(value: string | undefined, label: string, min: number, max: number): number {
  const parsed = int(value, label);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}
export function registerScanRoutes(app: Hono): void {
  app.get("/scan", async (c) => {
    const habitatId = readData().keplerRegistration?.habitatId;
    if (!habitatId) throw new Error("Habitat is not registered with Kepler.");
    const eva = getEvaStatus(); if (!eva.humanId) throw new Error("Deploy a human before scanning.");
    return Response.json(await fetchWorldScan({
      habitatId,
      x: eva.x, y: eva.y,
      sensorStrength: bounded(c.req.query("sensorStrength"), "sensorStrength", 0, 100),
      radiusTiles: bounded(c.req.query("radiusTiles") ?? "0", "radiusTiles", 0, 5),
    }));
  });
}
