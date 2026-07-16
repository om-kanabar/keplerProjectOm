import { Hono } from "hono";
import { getClockState, setListening, subscribeClockEvents } from "../kepler-stream";

export function registerClockRoutes(app: Hono): void {
  app.get("/clock/status", () => Response.json({ clock: getClockState() }));
  app.post("/clock/listen", async (c) => { const body = await c.req.json<{ enabled?: boolean }>(); return Response.json({ clock: setListening(body.enabled === true) }); });
  app.get("/clock/events", (c) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) { const unsubscribe = subscribeClockEvents((event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))); c.req.raw.signal.addEventListener("abort", () => { unsubscribe(); controller.close(); }, { once: true }); } });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  });
}
