import { readData, writeData } from "../storage";
import { runTickSimulation } from "../tick";
import { HabitatClockState } from "../types";

export type ClockEvent = { absoluteTick: number; advancedBy: number; issuedAt: string; applied: boolean };
const DEFAULT_STATE: HabitatClockState = { mode: "manual", listening: false, connectionStatus: "disconnected", latestKeplerTick: null, latestAdvancedBy: null, lastConnectedAt: null, lastMessageAt: null, lastError: null };
let socket: WebSocket | null = null;
let authenticated = false;
let messageQueue: Promise<void> = Promise.resolve();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionGeneration = 0;
const listeners = new Set<(event: ClockEvent) => void>();

export function getClockState(): HabitatClockState { return readData().clockState ?? DEFAULT_STATE; }
function save(patch: Partial<HabitatClockState>): HabitatClockState { const next = { ...DEFAULT_STATE, ...getClockState(), ...patch }; writeData({ ...readData(), clockState: next }); return next; }
export function subscribeClockEvents(listener: (event: ClockEvent) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function setListening(enabled: boolean): HabitatClockState {
  if (!enabled) {
    connectionGeneration += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket?.close();
    socket = null;
    authenticated = false;
    return save({ mode: "manual", listening: false, connectionStatus: "disconnected", lastError: null });
  }
  if (getClockState().listening && socket) return getClockState();
  if (getClockState().listening && reconnectTimer) return getClockState();
  const state = save({ mode: "kepler", listening: true, connectionStatus: "connecting", lastError: null });
  connect();
  return state;
}
function connect(): void {
  const registration = readData().keplerRegistration;
  const state = getClockState();
  if (!state.listening || !registration?.streamUrl || !registration.apiToken) { save({ connectionStatus: "error", lastError: "Kepler stream credentials are missing from registration." }); return; }
  const generation = ++connectionGeneration;
  try {
    const nextSocket = new WebSocket(registration.streamUrl);
    socket = nextSocket;
    nextSocket.onopen = () => { if (generation !== connectionGeneration || socket !== nextSocket) return; authenticated = false; save({ connectionStatus: "connecting", lastError: null }); nextSocket.send(JSON.stringify({ type: "hello", apiToken: registration.apiToken, subscribe: (registration.stream?.subscriptions ?? []).filter((item) => item === "ticks") })); };
    nextSocket.onmessage = (message) => { if (generation !== connectionGeneration || socket !== nextSocket) return; messageQueue = messageQueue.then(() => handleMessage(String(message.data))).catch(() => undefined); };
    nextSocket.onerror = () => { if (generation === connectionGeneration && socket === nextSocket) save({ connectionStatus: "error", lastError: "Kepler WebSocket connection failed." }); };
    nextSocket.onclose = () => { if (generation !== connectionGeneration || socket !== nextSocket) return; socket = null; if (getClockState().listening) { save({ connectionStatus: "disconnected" }); reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000); } };
  } catch (error) {
    if (generation !== connectionGeneration) return;
    save({ connectionStatus: "error", lastError: error instanceof Error ? error.message : "Unable to connect to Kepler." });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (generation === connectionGeneration && getClockState().listening) connect();
    }, 1000);
  }
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
