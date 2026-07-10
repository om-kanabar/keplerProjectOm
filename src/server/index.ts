import { createApp } from "./app";
import { appendServerLog } from "./logs";

function readHost(): string {
  return process.env.HABITAT_API_HOST ?? "127.0.0.1";
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

const server = Bun.serve({
  hostname: host,
  port,
  fetch: createApp().fetch,
});

appendServerLog({
  level: "info",
  message: `Habitat API listening on http://${server.hostname}:${server.port}`,
});

console.log(`Habitat API listening on http://${server.hostname}:${server.port}`);
