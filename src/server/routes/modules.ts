import { Hono } from "hono";
import { deleteModule, getModule, listModules, setModuleStatus, updateModule } from "../../modules";
import { syncRegisteredHabitatState } from "../services/registration-service";

export function registerModuleRoutes(app: Hono): void {
  app.get("/modules", async () => {
    await syncRegisteredHabitatState();
    return Response.json({
      modules: listModules(),
    });
  });

  app.get("/modules/:moduleId", async (c) => {
    await syncRegisteredHabitatState();
    return Response.json({
      module: getModule(c.req.param("moduleId")),
    });
  });

  app.patch("/modules/:moduleId", async (c) => {
    await syncRegisteredHabitatState();
    return Response.json({
      module: updateModule(c.req.param("moduleId"), await c.req.json()),
    });
  });

  app.post("/modules/:moduleId/status", async (c) => {
    await syncRegisteredHabitatState();
    const body = await c.req.json<{ status: string }>();
    return Response.json({
      module: setModuleStatus(c.req.param("moduleId"), body.status),
    });
  });

  app.delete("/modules/:moduleId", async (c) => {
    await syncRegisteredHabitatState();
    return Response.json({
      module: deleteModule(c.req.param("moduleId")),
    });
  });
}
