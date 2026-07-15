import { Hono } from "hono"; import { acknowledgeAlert, listAlerts } from "../../alerts";
export function registerAlertRoutes(app: Hono): void { app.get("/alerts", () => Response.json({ alerts: listAlerts() })); app.post("/alerts/:alertId/acknowledge", (c) => Response.json({ alert: acknowledgeAlert(c.req.param("alertId")) })); }
