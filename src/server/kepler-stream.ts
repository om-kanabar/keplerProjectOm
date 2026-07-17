import { readData, writeData } from "../storage";
import { runTickSimulation } from "../tick";
import { HabitatClockState } from "../types";

export type ClockEvent = { absoluteTick: number; advancedBy: number; issuedAt: string; applied: boolean };
const DEFAULT_STATE: HabitatClockState = { mode: "manual", listening: false, connectionStatus: "disconnected", latestKeplerTick: null, latestAdvancedBy: null, lastConnectedAt: null, lastMessageAt: null, lastError: null };
let socket: WebSocket | null = null;
let authenticated = false;
let messageQueue: Promise<void> = Promise.resolve();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(event: ClockEvent) => void>();

export function getClockState(): HabitatClockState { return readData().clockState ?? DEFAULT_STATE; }
function save(patch: Partial<HabitatClockState>): HabitatClockState { const next = { ...DEFAULT_STATE, ...getClockState(), ...patch }; writeData({ ...readData(), clockState: next }); return next; }
export function subscribeClockEvents(listener: (event: ClockEvent) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function setListening(enabled: boolean): HabitatClockState {
  if (!enabled) { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; socket?.close(); socket = null; return save({ mode: "manual", listening: false, connectionStatus: "disconnected", lastError: null }); }
  const state = save({ mode: "kepler", listening: true, connectionStatus: "connecting", lastError: null });
  connect();
  return state;
}
function connect(): void {
  const registration = readData().keplerRegistration;
  const state = getClockState();
  if (!state.listening || !registration?.streamUrl || !registration.apiToken) { save({ connectionStatus: "error", lastError: "Kepler stream credentials are missing from registration." }); return; }
  try {
    socket = new WebSocket(registration.streamUrl);
    socket.onopen = () => { authenticated = false; save({ connectionStatus: "connecting", lastError: null }); socket?.send(JSON.stringify({ type: "hello", apiToken: registration.apiToken, subscribe: (registration.stream?.subscriptions ?? []).filter((item) => item === "ticks") })); };
    socket.onmessage = (message) => { messageQueue = messageQueue.then(() => handleMessage(String(message.data))).catch(() => undefined); };
    socket.onerror = () => save({ connectionStatus: "error", lastError: "Kepler WebSocket connection failed." });
    socket.onclose = () => { socket = null; if (getClockState().listening) { save({ connectionStatus: "disconnected" }); reconnectTimer = setTimeout(connect, 1000); } };
  } catch (error) { save({ connectionStatus: "error", lastError: error instanceof Error ? error.message : "Unable to connect to Kepler." }); reconnectTimer = setTimeout(connect, 1000); }
}
async function handleMessage(raw: string): Promise<void> {
  let value: unknown; try { value = JSON.parse(raw); } catch { return; }
  if (!value || typeof value !== "object") return;
  const notice = value as Record<string, unknown>;
  if (notice.type === "hello_ack") {
    const registration = readData().keplerRegistration;
    const subscribed = Array.isArray(notice.subscribe) ? notice.subscribe : Array.isArray(notice.subscriptions) ? notice.subscriptions : [];
    const requestedTicks = (registration?.stream?.subscriptions ?? []).includes("ticks");
    if (notice.habitatId !== registration?.habitatId || notice.ok !== true || (requestedTicks && !subscribed.includes("ticks"))) {
      authenticated = false;
      save({ connectionStatus: "error", lastError: "Kepler rejected the Habitat stream hello." });
      socket?.close();
      return;
    }
    authenticated = true;
    save({ connectionStatus: "connected", lastConnectedAt: new Date().toISOString(), lastError: null });
    return;
  }
  if (notice.type !== "planet_tick" || !authenticated || !getClockState().listening) return;
  const tick = notice.tick; const advancedBy = notice.advancedBy;
  if (typeof tick !== "number" || !Number.isInteger(tick) || typeof advancedBy !== "number" || !Number.isInteger(advancedBy) || advancedBy <= 0) return;
  const previous = getClockState().latestKeplerTick;
  if (previous !== null && tick <= previous) return;
  const result = await runTickSimulation(advancedBy);
  save({ latestKeplerTick: tick, latestAdvancedBy: advancedBy, lastMessageAt: new Date().toISOString() });
  const event = { absoluteTick: tick, advancedBy, issuedAt: typeof notice.issuedAt === "string" ? notice.issuedAt : new Date().toISOString(), applied: result.completedTicks === advancedBy };
  for (const listener of listeners) listener(event);
}
export function stopClock(): void { setListening(false); }
