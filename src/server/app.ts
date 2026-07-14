import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerCatalogRoutes } from "./routes/catalog";
import { registerConstructionRoutes } from "./routes/construction";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerAuthRoutes } from "./routes/auth";
import { appendServerLog, listServerLogs } from "./logs";
import { registerModuleRoutes } from "./routes/modules";
import { registerRegistrationRoutes } from "./routes/registration";
import { registerScanRoutes } from "./routes/scan";
import { fetchKeplerHealth, fetchKeplerModuleCatalog, fetchKeplerSiteTypeCatalog, fetchKeplerUnlockCatalog, fetchKeplerVersion, reportHabitatUnlocks, sendHabitatHeartbeat, sendHabitatSummary } from "../kepler";

export function createApp(): Hono {
  const app = new Hono();

  const webOrigin = process.env.HABITAT_WEB_ORIGIN;
  if (webOrigin) {
    app.use("*", cors({
      origin: webOrigin,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }));
  }

  app.use("*", async (c, next) => {
    await next();

    appendServerLog({
      level: c.res.status >= 400 ? "error" : "info",
      message: `${c.req.method} ${c.req.path}`,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
    });
  });

  registerRegistrationRoutes(app);
  registerAuthRoutes(app);
  registerCatalogRoutes(app);
  registerModuleRoutes(app);
  registerInventoryRoutes(app);
  registerConstructionRoutes(app);
  registerScanRoutes(app);

  app.get("/health", async () => Response.json({ health: await fetchKeplerHealth() }));
  app.get("/version", async () => Response.json({ version: await fetchKeplerVersion() }));
  app.get("/catalog/modules", async () => Response.json({ modules: await fetchKeplerModuleCatalog() }));
  app.get("/catalog/site-types", async () => Response.json({ siteTypes: await fetchKeplerSiteTypeCatalog() }));
  app.get("/catalog/unlocks", async () => Response.json({ unlocks: await fetchKeplerUnlockCatalog() }));

  app.post("/heartbeat", async () => Response.json({ heartbeat: await sendHabitatHeartbeat() }));
  app.post("/summary", async () => Response.json({ summary: await sendHabitatSummary() }));
  app.post("/unlocks/report", async () => Response.json({ report: await reportHabitatUnlocks() }));
  app.get("/server/logs", async () => Response.json({ logs: listServerLogs() }));

  app.onError((error, c) => {
    appendServerLog({
      level: "error",
      message: error.message || "Internal server error.",
      method: c.req.method,
      path: c.req.path,
      statusCode: 400,
    });

    return Response.json(
      {
        error: {
          message: error.message || "Internal server error.",
        },
      },
      { status: 400 },
    );
  });

  return app;
}
