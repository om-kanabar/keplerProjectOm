import { Hono } from "hono"; import { listHumans, moveHuman } from "../../humans";
export function registerHumanRoutes(app: Hono): void { app.get("/humans", () => Response.json({ humans: listHumans() })); app.post("/humans/:humanId/move", async (c) => { const body = await c.req.json<{ moduleId: string }>(); return Response.json({ human: moveHuman(c.req.param("humanId"), body.moduleId) }); }); }
