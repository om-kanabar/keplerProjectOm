import { Hono } from "hono";
import { cancelConstruction, inspectConstructionReadiness, listConstructionJobs, startConstruction } from "../../construction";
import { runBatteryRechargeSimulation, runTickSimulation } from "../../tick";
import { syncRegisteredHabitatState } from "../services/registration-service";

export function registerConstructionRoutes(app: Hono): void {
  app.post("/construction/readiness", async (c) => {
    await syncRegisteredHabitatState();
    const body = await c.req.json<{ blueprintId: string }>();

    return Response.json({
      readiness: await inspectConstructionReadiness(body.blueprintId),
    });
  });

  app.post("/construction/jobs", async (c) => {
    await syncRegisteredHabitatState();
    const body = await c.req.json<{ blueprintId: string }>();

    return Response.json(
      {
        construction: await startConstruction(body.blueprintId),
      },
      { status: 201 },
    );
  });

  app.get("/construction/jobs", async () => {
    await syncRegisteredHabitatState();
    const jobs = listConstructionJobs().map(({ facility, job }) => ({
      facility,
      blueprintId: job.blueprintId,
      remainingTicks: job.remainingTicks,
    }));

    return Response.json({ jobs });
  });

  app.delete("/construction/jobs/:moduleId", async (c) => {
    await syncRegisteredHabitatState();
    return Response.json({
      canceled: cancelConstruction(c.req.param("moduleId")),
    });
  });

  app.post("/ticks", async (c) => {
    await syncRegisteredHabitatState();
    const body = await c.req.json<{ ticks: number }>();

    return Response.json({
      tick: await runTickSimulation(body.ticks),
    });
  });

  app.post("/battery/recharge", async (c) => {
    await syncRegisteredHabitatState();
    const body = await c.req.json<{ ticks: number }>();

    return Response.json({
      recharge: runBatteryRechargeSimulation(body.ticks),
    });
  });
}
