import { Hono } from "hono";
import { listModules } from "../../modules";
import { createRegistration, deleteRegistration, getRegistration, syncRegisteredHabitatState } from "../services/registration-service";

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
      modules: listModules(),
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
