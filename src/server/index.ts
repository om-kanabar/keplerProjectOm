import { createApp } from "./app";
import { appendServerLog } from "./logs";
import { stopClock, setListening, getClockState } from "./kepler-stream";

function readHost(): string {
  return process.env.HABITAT_API_HOST ?? "0.0.0.0";
}

function readPort(): number {
  const value = Number(process.env.HABITAT_API_PORT ?? "8787");

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("HABITAT_API_PORT must be a positive integer.");
  }

  return value;
}

const host = readHost();
const port = readPort();
const api = createApp();
if (getClockState().listening) setListening(true);
process.once("SIGINT", stopClock);
process.once("SIGTERM", stopClock);

const staticFiles: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/scripts.js": "scripts.js",
  "/loading.js": "loading.js",
  "/app.js": "app.js",
};

async function fetchRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const fileName = staticFiles[pathname];

  if (request.method === "GET" && pathname.startsWith("/dashboard/")) {
    const relativePath = pathname.slice("/dashboard/".length);
    if (!relativePath.includes("..")) {
      const file = (Bun as unknown as {
        file(path: string): { exists(): Promise<boolean> } & BodyInit;
      }).file(`dashboard/${relativePath}`);
      if (await file.exists()) {
        return new Response(file, { headers: { "Cache-Control": "no-store" } });
      }
    }
  }

  if (request.method === "GET" && fileName) {
    const file = (Bun as unknown as {
      file(path: string): { exists(): Promise<boolean> } & BodyInit;
    }).file(fileName);
    if (await file.exists()) {
      return new Response(file);
    }
  }

  return api.fetch(request);
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch: fetchRequest,
});

appendServerLog({
  level: "info",
  message: `Habitat API listening on http://${server.hostname}:${server.port}`,
});
