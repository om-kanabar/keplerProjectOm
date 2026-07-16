import { StrictMode, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { normalizeStatusSnapshot, pickOperatingLine, type DashboardMode, type RegularModeSnapshot, type ModuleSummary, type ResourceSummary } from "./dashboard-model";
import { previewSnapshot } from "./preview";
import "./dashboard.css";

declare global { interface Window { habitatAuthSkipPreview?: boolean; } }

const modes: Array<{ id: DashboardMode; label: string; detail: string }> = [
  { id: "regular", label: "Regular", detail: "Habitat operations" },
  { id: "display", label: "Display", detail: "Ambient habitat status" },
];
const subsystems = ["Overview", "Modules", "Blueprints", "Resources", "Inventory", "Construction", "Alerts", "Forecast", "Humans", "EVA", "Catalogs", "World", "Server", "Settings"];
type Subsystem = typeof subsystems[number];
type Blueprint = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  buildTicks?: number;
  repeatable?: boolean;
  capabilities?: string[];
  requiredFacility?: string | Record<string, unknown>;
  runtimeAttributes?: Record<string, unknown>;
} & Record<string, unknown>;
type CatalogResource = {
  id?: string;
  resourceId: string;
  displayName?: string;
  name?: string;
  status?: string;
  rarity?: string;
  amount?: number;
} & Record<string, unknown>;
type InventoryItem = { resourceId: string; amount: number };
type InventoryPayload = InventoryItem[] | Record<string, number> | null | undefined;

async function loadBlueprintDetails(blueprintId: string): Promise<Blueprint> {
  const response = await request<{ blueprint: Blueprint }>(`/catalog/blueprints/${blueprintId}`);
  return response.blueprint;
}

async function loadCatalogResources(): Promise<CatalogResource[]> {
  const response = await request<{ resources: CatalogResource[] }>("/resources");
  return response.resources;
}

async function loadInventoryItems(): Promise<InventoryItem[]> {
  const response = await request<{ inventory: InventoryPayload }>("/inventory");
  const raw = response.inventory;
  const items = Array.isArray(raw)
    ? raw.map((item) => ({ resourceId: String(item.resourceId ?? ""), amount: Number(item.amount) }))
    : Object.entries(raw ?? {}).map(([resourceId, amount]) => ({ resourceId, amount: Number(amount) }));
  return items.filter((item) => item.resourceId && Number.isFinite(item.amount) && item.amount > 0);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (HTTP ${response.status}).`);
  return body as T;
}

async function loadSnapshot(): Promise<RegularModeSnapshot> {
  const status = await request<Record<string, unknown>>("/status");
  const [alerts, construction] = await Promise.allSettled([
    request<{ alerts: unknown[] }>("/alerts"),
    request<{ jobs: unknown[] }>("/construction/jobs"),
  ]);
  return normalizeStatusSnapshot({
    ...status,
    alerts: alerts.status === "fulfilled" ? alerts.value.alerts : [],
    alertsError: alerts.status === "rejected",
    construction: construction.status === "fulfilled" ? { jobs: construction.value.jobs } : null,
    constructionError: construction.status === "rejected",
  });
}

function Dashboard() {
  const previewMode = window.habitatAuthSkipPreview === true;
  const showDev = new URLSearchParams(window.location.search).has("dev");
  const [snapshot, setSnapshot] = useState<RegularModeSnapshot | null>(previewMode ? normalizeStatusSnapshot(previewSnapshot) : null);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [activeMode, setActiveMode] = useState<DashboardMode>("regular");
  const [activeSubsystem, setActiveSubsystem] = useState<Subsystem>("Overview");
  const [blueprints, setBlueprints] = useState<Blueprint[] | null>(previewMode ? previewBlueprints : null);
  const [catalogResources, setCatalogResources] = useState<CatalogResource[] | null>(previewMode ? previewCatalogResources : null);
  const [inventory, setInventory] = useState<InventoryItem[] | null>(previewMode ? previewInventory : null);
  const unregisterDialog = useRef<HTMLDialogElement>(null);
  const displayHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayChromeVisible, setDisplayChromeVisible] = useState(true);

  const refresh = async () => {
    setLoading(true); setError(null);
    try { setSnapshot(previewMode ? normalizeStatusSnapshot(previewSnapshot) : await loadSnapshot()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Habitat."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!previewMode) void refresh(); }, [previewMode]);
  useEffect(() => {
    if (activeMode !== "display" || previewMode) return;
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [activeMode, previewMode]);
  useEffect(() => {
    if (activeMode !== "display") { setDisplayChromeVisible(true); return; }
    const showChrome = () => {
      setDisplayChromeVisible(true);
      if (displayHideTimer.current) clearTimeout(displayHideTimer.current);
      displayHideTimer.current = setTimeout(() => setDisplayChromeVisible(false), 3_000);
    };
    window.addEventListener("pointermove", showChrome);
    window.addEventListener("keydown", showChrome);
    showChrome();
    return () => { window.removeEventListener("pointermove", showChrome); window.removeEventListener("keydown", showChrome); if (displayHideTimer.current) clearTimeout(displayHideTimer.current); };
  }, [activeMode]);
  useEffect(() => {
    if (previewMode) return;
    if (activeSubsystem === "Blueprints" && !blueprints) void request<{ blueprints: Blueprint[] }>("/catalog/blueprints").then((result) => setBlueprints(result.blueprints)).catch(() => setBlueprints([]));
    if (activeSubsystem === "Resources" && !catalogResources) void loadCatalogResources().then((resources) => setCatalogResources(resources)).catch(() => setCatalogResources([]));
    if (activeSubsystem === "Inventory" && !inventory) void loadInventoryItems().then((items) => setInventory(items)).catch(() => setInventory([]));
  }, [activeSubsystem, blueprints, catalogResources, inventory, previewMode]);
  useEffect(() => { if (activeSubsystem === "Server" && !showDev) setActiveSubsystem("Overview"); }, [activeSubsystem, showDev]);

  const register = async () => {
    if (!name.trim()) return;
    try { await fetch("/registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name.trim() }) }); await refresh(); setMessage("Habitat registered."); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Registration failed."); }
  };
  const unregister = async () => {
    try { await fetch("/registration", { method: "DELETE" }); setSnapshot(null); setMessage("Habitat unregistered."); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Unregister failed."); }
  };
  const logout = async () => {
    if (previewMode) { setMessage("Preview mode has no session to close."); return; }
    try { await fetch("/auth/web/session", { method: "DELETE", credentials: "same-origin" }); window.location.reload(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Logout failed."); }
  };
  const changeModuleStatus = async (moduleId: string, status: "online" | "offline" | "active") => {
    try { await request(`/modules/${encodeURIComponent(moduleId)}/status`, { method: "POST", body: JSON.stringify({ status }) } as RequestInit); await refresh(); setMessage(`Module set to ${status}.`); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Module status update failed."); }
  };

  if (loading && !snapshot) return <main className="habitat-dashboard state-page"><div className="empty-state"><p className="dashboard-label">Habitat</p><h2>Reading habitat state <LoadingDots /></h2></div></main>;
  if (error && !snapshot) return <main className="habitat-dashboard state-page"><div className="error-state"><p className="dashboard-label">Connection error</p><h2>Habitat is not reachable.</h2><p>{error}</p><button className="button button-primary" onClick={() => void refresh()}>Retry</button></div></main>;
  if (!snapshot?.registration) return <RegistrationState name={name} message={message} setName={setName} register={() => void register()} />;

  return <main className={`habitat-dashboard console-layout ${activeMode === "display" ? "display-mode" : ""} ${displayChromeVisible ? "display-chrome-visible" : "display-chrome-hidden"}`}>
    <aside className="console-sidebar" aria-label="Habitat modes">
      <div className="sidebar-identity"><span className="sidebar-mark" aria-hidden="true" /><span>{snapshot.registration.displayName}</span></div>
      <div className="mode-slider" role="group" aria-label="Habitat display mode"><span className="mode-slider-label">Mode</span><div className="mode-slider-track">{modes.map((mode) => <button key={mode.id} className={`mode-slider-option ${mode.id === activeMode ? "is-active" : ""}`} type="button" aria-pressed={mode.id === activeMode} onClick={() => setActiveMode(mode.id)}><span>{mode.label}</span><small>{mode.detail}</small></button>)}</div></div>
      <nav className="subsystem-nav" aria-label="Habitat subsystems"><span className="mode-slider-label">Systems</span>{subsystems.filter((item) => item !== "Server" || showDev).map((item) => <button key={item} className={`subsystem-link ${item === activeSubsystem ? "is-active" : ""}`} type="button" aria-current={item === activeSubsystem ? "page" : undefined} onClick={() => setActiveSubsystem(item)}>{item}</button>)}</nav>
      <div className="sidebar-footer"><span className={`connection-dot ${snapshot.connection}`} aria-hidden="true" /> <span>{snapshot.connection === "connected" ? snapshot.registration.status ?? "connected" : "disconnected"}</span></div>
    </aside>
    <section className="console-content"><header className="console-header"><div><p className="dashboard-label">{snapshot.registration.displayName} / habitat</p><h1 id="dashboard-title">{modes.find((mode) => mode.id === activeMode)?.label}</h1></div><div className="dashboard-actions"><button className="button" disabled={loading} onClick={() => void refresh()}>Refresh</button><button className="button" onClick={() => void logout()}>Log out</button><button className="button button-danger" onClick={() => unregisterDialog.current?.showModal()}>Unregister</button></div></header>
      <section id={`${activeMode}-panel`} role="tabpanel" aria-label={`${activeMode} mode`} className="console-panel">{activeMode === "display" ? <DisplayModeView snapshot={snapshot} onExit={() => setActiveMode("regular")} error={error} /> : activeSubsystem === "Overview" ? <RegularModeOverview snapshot={snapshot} onStatusChange={changeModuleStatus} /> : <SubsystemView name={activeSubsystem} snapshot={snapshot} blueprints={blueprints} catalogResources={catalogResources} inventory={inventory} onStatusChange={changeModuleStatus} />}</section>
      {message && <p className="dashboard-feedback success" role="status">{message}</p>}
      <EVAKeyboardControls />
      <EVAScanColorizer />
    </section>
    <dialog className="dashboard-dialog" ref={unregisterDialog}><p className="dashboard-label">Registration</p><h2>Unregister {snapshot.registration.displayName}?</h2><p>This removes the current registration through the Habitat API.</p><div className="dialog-actions"><button className="button" onClick={() => unregisterDialog.current?.close()}>Cancel</button><button className="button button-danger" onClick={() => { unregisterDialog.current?.close(); void unregister(); }}>Unregister</button></div></dialog>
  </main>;
}

function RegistrationState({ name, message, setName, register }: { name: string; message: string | null; setName: (name: string) => void; register: () => void }) { return <main className="habitat-dashboard state-page"><section className="registration-intro"><p className="dashboard-label">Habitat</p><h1 id="dashboard-title">Not registered.</h1><p>Connect this display to a Habitat to see its live state.</p></section><section className="empty-state"><h2>Choose a Habitat name.</h2><form className="registration-form" onSubmit={(event) => { event.preventDefault(); register(); }}><label htmlFor="habitat-name">Habitat name</label><input id="habitat-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Habitat name" required /><button className="button button-primary">Register</button></form>{message && <p className="dashboard-feedback" role="status">{message}</p>}</section></main>; }

function EVAKeyboardControls() { useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { const map = document.querySelector<HTMLElement>(".eva-map"); if (!map || (event.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))) return; const key = event.key.toLowerCase(); if (!["w", "a", "s", "d"].includes(key)) return; const current = map.querySelector<HTMLElement>(".eva-tile.is-current"); if (!current) return; const match = current.getAttribute("aria-label")?.match(/(-?\d+),\s*(-?\d+)/); if (!match) return; const x = Number(match[1]) + (key === "d" ? 1 : key === "a" ? -1 : 0); const y = Number(match[2]) + (key === "s" ? 1 : key === "w" ? -1 : 0); const target = Array.from(map.querySelectorAll<HTMLElement>(".eva-tile")).find((tile) => tile.getAttribute("aria-label") === `Move to ${x}, ${y}` && !tile.hasAttribute("disabled")); if (target) { event.preventDefault(); target.click(); target.focus(); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []); return null; }
function DisplayModeView({ snapshot, onExit, error }: { snapshot: RegularModeSnapshot; onExit: () => void; error: string | null }) {
  const [operatingLine] = useState(() => pickOperatingLine());
  const byId = (id: string) => snapshot.resources.find((resource) => resource.id === id);
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date());
  const exit = (event: KeyboardEvent<HTMLSpanElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onExit(); } };
  return <section className="display-mode-view" aria-label="Ambient habitat display"><span className="display-mode-exit" role="button" tabIndex={0} aria-label="Exit display mode" title="Exit display mode" onClick={onExit} onKeyDown={exit}>←</span><div className="display-mode-topline"><span>{snapshot.registration?.displayName ?? "Habitat"}</span><time>{clock}</time></div><div className="display-mode-hero"><p className="dashboard-label">{snapshot.connection === "connected" ? "Habitat status" : "Connection degraded"}</p><h2 className={`display-status-line ${snapshot.overall.tone}`}>{snapshot.overall.label}</h2><p>{operatingLine}</p></div><div className="display-mode-metrics"><DisplayMetric label="Power" value={byId("power")?.value ?? "Unavailable"} detail={byId("power")?.interpretation ?? "Awaiting telemetry"} /><DisplayMetric label="Battery" value={byId("battery")?.value ?? "Unavailable"} detail={byId("battery")?.interpretation ?? "Awaiting telemetry"} /><DisplayMetric label="Solar" value={byId("solar")?.value ?? "Unavailable"} detail={byId("solar")?.interpretation ?? "Awaiting telemetry"} /><DisplayMetric label="Reserve" value={byId("reserve")?.value ?? "Unavailable"} detail={byId("reserve")?.interpretation ?? "Awaiting telemetry"} /></div><div className="display-mode-lower"><div><p className="dashboard-label">Active work</p><strong>{snapshot.activeWork.length ? snapshot.activeWork[0].label : "No active construction"}</strong><p>{snapshot.activeWork.length ? snapshot.activeWork[0].detail : "Habitat operations are waiting."}</p></div><div><p className="dashboard-label">Alerts</p><strong>{snapshot.alerts.length ? `${snapshot.alerts.length} open` : "All clear"}</strong><p>{snapshot.alerts.length ? "Review the Alerts system when convenient." : "No conditions require attention."}</p></div></div>{error && <p className="display-mode-error" role="status">Live refresh unavailable · showing last known state</p>}</section>;
}
function DisplayMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="display-mode-metric"><p className="dashboard-label">{label}</p><strong>{value}</strong><span>{detail}</span></article>; }
function SubsystemView({ name, snapshot, blueprints, catalogResources, inventory, onStatusChange }: { name: Subsystem; snapshot: RegularModeSnapshot; blueprints: Blueprint[] | null; catalogResources: CatalogResource[] | null; inventory: InventoryItem[] | null; onStatusChange: (moduleId: string, status: "online" | "offline" | "active") => void }) {
  if (name === "Modules") return <section className="subsystem-view"><SectionHeading id="modules-view-heading" label="Modules" detail={`${snapshot.modules.length} installed`} /><div className="module-grid">{snapshot.modules.length ? snapshot.modules.map((module) => <ModuleCard key={module.id} module={module} onStatusChange={onStatusChange} />) : <EmptyState text="No modules are reported by Habitat yet." />}</div></section>;
  if (name === "Alerts") return <AlertsView alerts={snapshot.alerts} />;
  if (name === "Resources") return <section className="subsystem-view"><SectionHeading id="resources-view-heading" label="Resources" detail={catalogResources ? `${catalogResources.length} resource types` : "Loading catalog"} />{catalogResources === null ? <LoadingState label="Loading resources" /> : catalogResources.length ? <div className="table-frame"><table className="dashboard-table"><thead><tr><th>Name</th><th>Resource ID</th><th>Status</th><th>Amount</th></tr></thead><tbody>{catalogResources.map((resource) => <tr key={resource.resourceId}><td>{resource.displayName ?? resource.name ?? resource.resourceId}</td><td>{resource.resourceId}</td><td>{resource.status ?? resource.rarity ?? "unknown"}</td><td>{resource.amount ?? 0}</td></tr>)}</tbody></table></div> : <EmptyState text="No resources found." />}</section>;
  if (name === "Construction") return <section className="subsystem-view"><SectionHeading id="construction-view-heading" label="Construction" detail="Active work" />{snapshot.activeWork.length ? <div className="work-list">{snapshot.activeWork.map((work) => <article className="work-row" key={work.id}><div><p className="dashboard-label">{work.kind}</p><h3>{work.label}</h3><p>{work.detail}</p></div>{work.percent !== undefined && <strong>{work.percent}%</strong>}<button className="button button-danger" type="button" onClick={() => { if (window.confirm("Cancel this construction job?")) void request(`/construction/jobs/${encodeURIComponent(work.id)}`, { method: "DELETE" }); }}>Cancel</button></article>)}</div> : <EmptyState text="No construction is currently active." />}</section>;
  if (name === "Forecast") return <section className="subsystem-view"><SectionHeading id="forecast-view-heading" label="Forecast" detail="Surface conditions" /><div className="mode-placeholder"><p className="dashboard-label">Next conditions</p><h2>Solar outlook: clear.</h2><p>Current irradiance supports normal power generation. Detailed hourly forecasts will appear here when the weather feed is connected.</p></div></section>;
  if (name === "Humans") return <HumansViewBetter snapshot={snapshot} />;
  if (name === "EVA") return <EVAView />;
  if (name === "Catalogs") return <CatalogsView />;
  if (name === "World") return <WorldView />;
  if (name === "Server") return <ServerView />;
  if (name === "Settings") return <SettingsView onUnregister={() => document.querySelector<HTMLDialogElement>(".dashboard-dialog")?.showModal()} />;
  if (name === "Blueprints") return <BlueprintsView blueprints={blueprints} />;
  if (name === "Inventory") return <section className="subsystem-view"><SectionHeading id="inventory-view-heading" label="Inventory" detail={inventory ? `${inventory.length} resource types` : "Loading inventory"} />{inventory === null ? <LoadingState label="Loading inventory" /> : inventory.length ? <div className="table-frame"><table className="dashboard-table"><thead><tr><th>Resource</th><th>Amount</th></tr></thead><tbody>{inventory.map((item) => <tr key={item.resourceId}><td>{item.resourceId}</td><td>{item.amount}</td></tr>)}</tbody></table></div> : <EmptyState text="No inventory found." />}</section>;
  return <section className="subsystem-view mode-placeholder"><p className="dashboard-label">{name}</p><h2>System view ready.</h2><p>This subsystem is connected to the Habitat navigation.</p></section>;
}

function ActionForm({ label, path, fields, onDone, onResult }: { label: string; path: string; fields: Array<{ name: string; label: string; type?: string; defaultValue?: string }>; onDone?: (message: string) => void; onResult?: (result: unknown) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setState("Working"); try { const response = await request(path, { method: "POST", body: JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value]))) }); setResult(response); onResult?.(response); const message = `${label} complete.`; setState(message); onDone?.(message); } catch (caught) { setState(caught instanceof Error ? caught.message : `${label} failed.`); } };
  return <form className="command-form" onSubmit={(event) => void submit(event)}><p className="dashboard-label">{label}</p>{fields.map((field) => <label key={field.name}>{field.label}<input required name={field.name} type={field.type ?? "text"} defaultValue={field.defaultValue} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} /></label>)}<button className="button button-primary" type="submit">Run</button>{state && <p className="dashboard-feedback" role="status">{state}{state === "Working" && <> <LoadingDots /></>}</p>}{result && (label.toLowerCase().includes("scan") ? <ScanResult result={result} /> : label.toLowerCase().includes("collect") ? <CollectResult result={result} /> : <pre className="scan-result">{JSON.stringify(result, null, 2)}</pre>)}</form>;
}

function scanDisplayValue(value: unknown): string { if (value === undefined || value === null || value === "") return "—"; if (typeof value === "object") { const record = value as Record<string, unknown>; return String(record.resourceType ?? record.resourceId ?? record.resource ?? record.candidate ?? record.probabilityPct ?? JSON.stringify(value)); } return String(value); }
function scanResourceName(tile: any): string { const value = scanDisplayValue(tile?.topCandidate?.resourceType ?? tile?.topCandidate?.resource ?? tile?.topCandidate); return /^\d+(\.\d+)?$/.test(value) || value === "—" ? "none" : value; }
function scanResourceColor(resource: string): string { const palette: Record<string, string> = { "basalt-composite": "#8f9aa3", "conductive-ore": "#58b6c8", ferrite: "#c87955", "ice-regolith": "#8fc7df", "rare-catalyst": "#c28be8", "silicate-glass": "#8be0bf", "volatile-compounds": "#e5ba6d", none: "#27303a" }; return palette[resource] ?? "#d1bd8e"; }
function ScanResult({ result }: { result: any }) { const scan = result?.scan ?? result ?? {}; const tiles = Array.isArray(scan.tiles) ? scan.tiles : []; useEffect(() => { window.dispatchEvent(new CustomEvent("habitat:scan", { detail: scan })); }, [scan]); const resources = tiles.map((tile: any) => scanResourceName(tile)).filter((value) => value !== "none"); const scanQuantity = scan.quantityKg ?? scan.quantity ?? scan.amountKg; const range = scan.range ?? (scan.rangeMinKg !== undefined && scan.rangeMaxKg !== undefined ? `${scan.rangeMinKg}–${scan.rangeMaxKg} kg` : null); return <div className="scan-result-cards"><p className="dashboard-label">Scan mapped</p><p>{tiles.length ? `${tiles.length} ${tiles.length === 1 ? "tile" : "tiles"} colored on the EVA map.` : "No tiles were returned by the scan."}</p>{(scanQuantity !== undefined || range) && <p>Habitat resource amount: <b>{scanQuantity !== undefined ? `${scanQuantity} kg` : range}</b>{scan.exact === false ? " estimated" : ""}</p>}{resources.length > 0 && <p>Leading readings: <b>{Array.from(new Set(resources)).slice(0, 3).join(", ")}</b></p>}{tiles.length > 0 && <div className="scan-tile-list">{tiles.map((tile: any) => { const resource = scanResourceName(tile); const raw = tile.topCandidate?.probabilityPct ?? tile.topCandidate?.probability ?? tile.probabilityPct ?? tile.confidence; const confidence = Number(raw); const quantity = tile.quantityKg ?? tile.estimatedAmountKg ?? tile.quantity ?? tile.amountKg; return <article className="scan-tile-card" key={`${tile.x}:${tile.y}`}><div><strong>Tile ({tile.x}, {tile.y})</strong><span>{tile.terrain ?? "Unknown terrain"}</span></div><div><b>{resource === "none" ? "No resource detected" : resource}</b><span>{Number.isFinite(confidence) ? `${confidence.toFixed(1)}% confidence` : "Confidence unavailable"}</span></div>{quantity !== undefined && <span>Estimated amount: {quantity} kg</span>}</article>; })}</div>}</div>; }
function EVAScanColorizer() { useEffect(() => { const paint = (event: Event) => { const scan = (event as CustomEvent).detail ?? {}; const tiles = Array.isArray(scan.tiles) ? scan.tiles : []; const map = document.querySelector(".eva-map"); if (!map) return; map.querySelectorAll<HTMLElement>(".eva-tile.is-scanned").forEach((button) => { button.classList.remove("is-scanned"); button.style.removeProperty("background-color"); button.removeAttribute("data-resource"); button.removeAttribute("data-amount"); button.title = ""; }); tiles.forEach((tile: any) => { const button = Array.from(map.querySelectorAll<HTMLElement>(".eva-tile")).find((candidate) => candidate.getAttribute("aria-label") === `Move to ${tile.x}, ${tile.y}`); if (!button) return; const raw = tile.topCandidate?.probabilityPct ?? tile.topCandidate?.probability ?? tile.probabilityPct ?? tile.confidence ?? 0; const confidence = Math.max(0, Math.min(100, Number(raw) || 0)); const resource = scanResourceName(tile); const amount = tile.quantityKg ?? tile.estimatedAmountKg ?? tile.quantity ?? tile.amountKg; button.classList.add("is-scanned"); button.style.setProperty("--scan-confidence", `${confidence / 100}`); button.style.backgroundColor = scanResourceColor(resource); button.dataset.resource = resource; button.dataset.amount = amount === undefined ? "amount unavailable" : `${amount} kg`; button.title = `${resource === "none" ? "No resource detected" : resource} · ${button.dataset.amount} · ${confidence.toFixed(0)}% confidence`; }); }; window.addEventListener("habitat:scan", paint); return () => window.removeEventListener("habitat:scan", paint); }, []); return null; }
function CollectResult({ result }: { result: any }) { const collection = result?.collection ?? result ?? {}; const eva = result?.eva ?? {}; const carried = Object.values(eva.carried ?? {}).reduce((sum: number, value: any) => sum + Number(value), 0); return <div className="collect-result-card"><p className="dashboard-label">Collection complete</p><strong>{scanDisplayValue(collection.resourceType ?? collection.resourceId ?? "Resource")}</strong><p>{scanDisplayValue(collection.collectedKg ?? collection.quantityKg ?? 0)} kg collected at ({scanDisplayValue(collection.x ?? eva.x)}, {scanDisplayValue(collection.y ?? eva.y)}).</p><p>Remaining at tile: {scanDisplayValue(collection.remainingKg ?? collection.remainingKgAtTile ?? "—")} kg</p>{eva.capacityKg !== undefined && <p>EVA capacity: {carried} / {scanDisplayValue(eva.capacityKg)} kg</p>}</div>; }

function HumansViewBetter({ snapshot }: { snapshot: RegularModeSnapshot }) { const [humans, setHumans] = useState<any[] | null>(null); const [modules, setModules] = useState<any[]>(snapshot.modules); useEffect(() => { void Promise.all([request<{ humans: any[] }>("/humans"), request<{ modules: any[] }>("/modules")]).then(([crew, moduleResult]) => { setHumans(crew.humans); setModules(moduleResult.modules); }).catch(() => setHumans([])); }, []); return <section className="subsystem-view"><SectionHeading id="humans-view-heading" label="Humans" detail="Crew overview" />{humans === null ? <LoadingState label="Loading crew" /> : humans.length ? <div className="human-cards">{humans.map((human) => <HumanMoveCard key={human.id} human={human} modules={modules} />)}</div> : <EmptyState text="No humans found." />}</section>; }
function HumanMoveCard({ human, modules }: { human: any; modules: any[] }) { const [moduleId, setModuleId] = useState(human.locationModuleId ?? human.moduleId ?? ""); const [state, setState] = useState<string | null>(null); const currentModule = modules.find((module) => module.id === (human.locationModuleId ?? human.moduleId)); const attrs = currentModule?.runtimeAttributes ?? {}; const location = currentModule ? `${currentModule.displayName ?? currentModule.blueprintId ?? currentModule.id}${attrs.x !== undefined && attrs.y !== undefined ? ` · (${attrs.x}, ${attrs.y})` : currentModule.x !== undefined && currentModule.y !== undefined ? ` · (${currentModule.x}, ${currentModule.y})` : ""}` : human.locationModuleId || human.moduleId ? "Location module unavailable" : "Unassigned"; const move = async () => { setState("Moving"); try { await request(`/humans/${encodeURIComponent(human.id)}/move`, { method: "POST", body: JSON.stringify({ moduleId }) }); setState(`Moved to ${moduleId}.`); } catch (caught) { setState(caught instanceof Error ? caught.message : "Unable to move human."); } }; return <article className="human-card"><div className="human-card-identity"><span className="human-avatar" aria-hidden="true">{String(human.displayName ?? human.name ?? human.id).slice(0, 1).toUpperCase()}</span><div><h3>{human.displayName ?? human.name ?? human.id}</h3><p className="human-location">{location}</p></div></div><label>Move to<select value={moduleId} onChange={(event) => setModuleId(event.target.value)}><option value="">Choose a module</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.displayName ?? module.blueprintId ?? module.id}</option>)}</select></label><button className="button button-primary" type="button" disabled={!moduleId || state === "Moving"} onClick={() => void move()}>{state === "Moving" ? <>Moving <LoadingDots /></> : "Move human"}</button>{state && state !== "Moving" && <p className={`dashboard-feedback ${state.startsWith("Unable") ? "error" : "success"}`} role="status">{state}</p>}</article>; }
function AlertsView({ alerts }: { alerts: RegularModeSnapshot["alerts"] }) { return <section className="subsystem-view"><AlertSection alerts={alerts} /><div className="command-grid">{alerts.map((alert) => <button className="button" type="button" key={alert.id} onClick={() => void request(`/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: "POST" })}>Acknowledge {alert.title}</button>)}</div></section>; }

function EVAView() { const [eva, setEva] = useState<any>(null); const [humans, setHumans] = useState<any[]>([]); const [selectedHuman, setSelectedHuman] = useState(""); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const load = async () => { const result = await request<{ eva: any }>("/eva"); setEva(result.eva); }; useEffect(() => { void Promise.all([request<{ eva: any }>("/eva"), request<{ humans: any[] }>("/humans")]).then(([e, h]) => { setEva(e.eva); setHumans(h.humans); setSelectedHuman(h.humans[0]?.id ?? ""); }).catch(() => setEva({ error: "Unable to load EVA state." })); }, []); const act = async (path: string, body: Record<string, unknown> = {}) => { setBusy(true); setMessage(null); try { await request(path, { method: "POST", body: JSON.stringify(body) }); await load(); setMessage("EVA state updated."); } catch (caught) { setMessage(caught instanceof Error ? caught.message : "EVA action failed."); } finally { setBusy(false); } }; const deployed = Boolean(eva?.humanId); const move = (x: number, y: number) => { if (!deployed || busy) return; void act("/eva/move", { x, y }); }; return <section className="subsystem-view"><SectionHeading id="eva-view-heading" label="EVA" detail="Guided explorer controls" />{eva ? <><div className="eva-guide"><p className="dashboard-label">{deployed ? "Step 2 · Explore" : "Step 1 · Suit up"}</p><h2>{eva.error ?? (deployed ? `Explorer at (${eva.x}, ${eva.y})` : "Choose a crew member to deploy")}</h2><p>{deployed ? "Use the map to move one tile at a time. Scan from your current position, collect what you find, then return to the origin to dock." : "Choose a crew member, confirm they are at the suitport, then deploy them. This restores the EVA suit's battery and oxygen only."}</p></div>{deployed && <div className="eva-status-strip"><span>Battery <strong>{eva.battery}/{eva.batteryCapacity}</strong></span><span>Oxygen <strong>{eva.oxygen}/{eva.oxygenCapacity}</strong></span><span>Carried <strong>{Object.values(eva.carried ?? {}).reduce((sum: number, value: any) => sum + Number(value), 0)}/{eva.capacityKg} kg</strong></span></div>}<div className="eva-layout"><div className="eva-map" aria-label="50 by 50 EVA movement map">{Array.from({ length: 2500 }, (_, index) => { const x = (index % 50) - 25, y = Math.floor(index / 50) - 25, current = x === Number(eva.x) && y === Number(eva.y), origin = x === 0 && y === 0; return <button key={`${x}:${y}`} className={`eva-tile ${current ? "is-current" : ""} ${origin ? "is-origin" : ""}`} type="button" disabled={!deployed || Math.abs(x - Number(eva.x)) + Math.abs(y - Number(eva.y)) !== 1 || busy} onClick={() => move(x, y)} aria-label={`Move to ${x}, ${y}`}>{current ? "●" : origin ? "＋" : ""}</button>; })}</div><div className="eva-actions">{!deployed ? <><label className="eva-select-label">Crew member<select value={selectedHuman} onChange={(event) => setSelectedHuman(event.target.value)}><option value="">Choose a human</option>{humans.map((human) => <option key={human.id} value={human.id}>{human.displayName ?? human.id}</option>)}</select></label><p className="dashboard-feedback">The selected human must be inside the active suitport.</p><button className="button button-primary" type="button" disabled={!selectedHuman || busy} onClick={() => void act("/eva/deploy", { humanId: selectedHuman })}>Deploy selected human</button></> : <><ActionForm label="Scan this tile" path="/scan" fields={[{ name: "sensorStrength", label: "Sensor strength", type: "number", defaultValue: "60" }, { name: "radiusTiles", label: "Scan radius", type: "number", defaultValue: "0" }]} /><ActionForm label="Collect resource" path="/collect" fields={[{ name: "quantityKg", label: "Quantity (kg)", type: "number" }]} /><button className="button button-primary" type="button" disabled={busy || eva.x !== 0 || eva.y !== 0} onClick={() => void act("/eva/dock")}>Return and dock</button></>}</div></div>{busy && <p className="dashboard-feedback dashboard-loading">Updating EVA <LoadingDots /></p>}{message && <p className="dashboard-feedback" role="status">{message}</p>}</> : <LoadingState label="Loading EVA state" />}</section>; }
function CatalogsView() { const [catalog, setCatalog] = useState<any>(null); useEffect(() => { void Promise.all([request<any>("/catalog/modules"), request<any>("/catalog/resources"), request<any>("/catalog/site-types"), request<any>("/catalog/unlocks")]).then(([modules, resources, siteTypes, unlocks]) => setCatalog({ modules: modules.modules, resources: resources.resources, siteTypes: siteTypes.siteTypes, unlocks: unlocks.unlocks })).catch(() => setCatalog({ error: "Unable to load catalogs." })); }, []); return <section className="subsystem-view"><SectionHeading id="catalogs-view-heading" label="Catalogs" detail="Kepler-owned reference data" />{catalog ? catalog.error ? <p className="dashboard-feedback error">{catalog.error}</p> : <div className="table-frame"><table className="dashboard-table"><thead><tr><th>Catalog</th><th>Entries</th></tr></thead><tbody>{Object.entries(catalog).map(([key, value]) => <tr key={key}><td>{key}</td><td>{Array.isArray(value) ? value.length : 0}</td></tr>)}</tbody></table></div> : <LoadingState label="Loading catalogs" />}</section>; }
function WorldView() { const [data, setData] = useState<any>(null); useEffect(() => { void request<any>("/solar/irradiance").then(setData).catch((caught) => setData({ error: caught instanceof Error ? caught.message : "Unable to load world state." })); }, []); return <section className="subsystem-view"><SectionHeading id="world-view-heading" label="World" detail="Kepler environment" />{data ? data.error ? <p className="dashboard-feedback error">{data.error}</p> : <div className="mode-placeholder"><p className="dashboard-label">Solar irradiance</p><h2>{JSON.stringify(data.solarIrradiance ?? data)}</h2></div> : <LoadingState label="Loading world state" />}</section>; }
function ServerView() { const [logs, setLogs] = useState<any[] | null>(null); useEffect(() => { void request<{ logs: any[] }>("/server/logs").then((result) => setLogs(result.logs)).catch(() => setLogs([])); }, []); return <section className="subsystem-view"><SectionHeading id="server-view-heading" label="Server" detail="Local Habitat API" />{logs === null ? <LoadingState label="Loading server logs" /> : logs.length ? <div className="table-frame"><table className="dashboard-table"><thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead><tbody>{logs.map((log, index) => <tr key={index}><td>{formatLocalTime(log.createdAt ?? log.timestamp ?? "")}</td><td>{log.level}</td><td>{log.message}</td></tr>)}</tbody></table></div> : <EmptyState text="No server logs found." />}</section>; }
function SettingsView({ onUnregister }: { onUnregister: () => void }) { const [url, setUrl] = useState(""); const [message, setMessage] = useState<string | null>(null); return <section className="subsystem-view"><SectionHeading id="settings-view-heading" label="Settings" detail="Habitat connection" /><form className="command-form" onSubmit={(event) => { event.preventDefault(); setMessage("Connection settings are managed by the local Habitat server."); }}><label>Habitat API base URL<input value={url} onChange={(event) => setUrl(event.target.value.trimStart())} placeholder="http://127.0.0.1:8787" /></label><button className="button button-primary" type="submit">Save connection</button>{message && <p className="dashboard-feedback success">{message}</p>}</form><button className="button button-danger" type="button" onClick={onUnregister}>Unregister habitat</button></section>; }

function BlueprintsView({ blueprints }: { blueprints: Blueprint[] | null }) {
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [selectedBlueprintError, setSelectedBlueprintError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const previewMode = window.habitatAuthSkipPreview === true;
  const selectBlueprint = async (blueprint: Blueprint) => {
    setSelectedBlueprintId(blueprint.blueprintId);
    setSelectedBlueprintError(null);
    setMessage(null);
    setLoadingDetails(true);

    if (previewMode) {
      setSelectedBlueprint(blueprint);
      setLoadingDetails(false);
      return;
    }

    try {
      setSelectedBlueprint(await loadBlueprintDetails(blueprint.blueprintId));
    } catch (caught) {
      setSelectedBlueprint(null);
      setSelectedBlueprintError(caught instanceof Error ? caught.message : "Unable to load blueprint details.");
    } finally {
      setLoadingDetails(false);
    }
  };
  const build = async () => {
    if (!selectedBlueprintId || !selectedBlueprint) return;
    if (previewMode) { setMessage("Preview mode cannot start construction."); return; }
    setBuilding(true); setMessage(null);
    try {
      const readiness = await request<{ readiness?: { ready?: boolean; reason?: string } }>("/construction/readiness", { method: "POST", body: JSON.stringify({ blueprintId: selectedBlueprintId }) });
      if (readiness.readiness?.ready === false) { setMessage(readiness.readiness.reason ?? "This blueprint is not ready to build."); return; }
      await request("/construction/jobs", { method: "POST", body: JSON.stringify({ blueprintId: selectedBlueprintId }) });
      setMessage(`${selectedBlueprint.displayName} construction started.`);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Unable to start construction. Check habitat readiness and resources."); }
    finally { setBuilding(false); }
  };
  return <section className="subsystem-view"><SectionHeading id="blueprints-view-heading" label="Blueprints" detail={blueprints ? `${blueprints.length} available` : "Loading catalog"} />{blueprints === null ? <LoadingState label="Loading blueprint catalog" /> : <div className="blueprint-shell"><div className="blueprint-list-pane"><div className="blueprint-list">{blueprints.length ? blueprints.map((blueprint) => <article className={selectedBlueprintId === blueprint.blueprintId ? "is-selected" : undefined} key={blueprint.blueprintId}><div className="blueprint-row"><div><h3>{blueprint.displayName}</h3><p>{blueprint.description ?? blueprint.blueprintId}</p></div><button className="button" type="button" onClick={() => void selectBlueprint(blueprint)}>{selectedBlueprintId === blueprint.blueprintId ? "Viewing" : "View details"}</button></div>{blueprint.buildTicks !== undefined && <small>{blueprint.buildTicks} build ticks</small>}</article>) : <EmptyState text="Blueprint catalog is unavailable." />}</div></div>{selectedBlueprintId && <div className="blueprint-overlay" role="dialog" aria-modal="true" aria-labelledby="blueprint-overlay-heading"><div className="blueprint-overlay-panel">{loadingDetails && !selectedBlueprint ? <LoadingState label="Loading blueprint details" /> : selectedBlueprint ? <><div className="blueprint-overlay-head"><button className="button blueprint-overlay-back" type="button" onClick={() => { setSelectedBlueprintId(null); setSelectedBlueprint(null); setSelectedBlueprintError(null); setMessage(null); }}>Back</button><div><p className="dashboard-label">Blueprint details</p><h3 id="blueprint-overlay-heading">{selectedBlueprint.displayName}</h3></div></div><p>{selectedBlueprint.description ?? "No description supplied."}</p><dl className="blueprint-fields"><div><dt>ID</dt><dd>{formatBlueprintValue(selectedBlueprint.id)}</dd></div><div><dt>Blueprint ID</dt><dd>{selectedBlueprint.blueprintId}</dd></div><div><dt>Status</dt><dd>{formatBlueprintValue(selectedBlueprint.status)}</dd></div><div><dt>Required Facility</dt><dd>{formatBlueprintRequiredFacility(selectedBlueprint)}</dd></div><div><dt>Output</dt><dd>{formatBlueprintOutput(selectedBlueprint)}</dd></div><div><dt>Build Ticks</dt><dd>{formatBlueprintValue(selectedBlueprint.buildTicks)}</dd></div><div><dt>Repeatable</dt><dd>{selectedBlueprint.repeatable ? "yes" : "no"}</dd></div>{selectedBlueprint.capabilities && <div><dt>Capabilities</dt><dd>{selectedBlueprint.capabilities.length ? selectedBlueprint.capabilities.join(", ") : "(none)"}</dd></div>}</dl><h4>Resources required</h4>{selectedBlueprint.inputs && Object.keys(selectedBlueprint.inputs).length ? <table className="dashboard-table"><thead><tr><th>Resource</th><th>Amount</th></tr></thead><tbody>{Object.entries(selectedBlueprint.inputs).map(([resource, amount]) => <tr key={resource}><td>{resource}</td><td>{formatBlueprintValue(amount)}</td></tr>)}</tbody></table> : <p className="dashboard-feedback">Resource requirements were not supplied by the catalog.</p>}{selectedBlueprint.runtimeAttributes && Object.keys(selectedBlueprint.runtimeAttributes).length > 0 && <><h4>Runtime attributes</h4><pre className="blueprint-runtime">{JSON.stringify(selectedBlueprint.runtimeAttributes, null, 2)}</pre></>}<button className="button button-primary" type="button" disabled={building || loadingDetails} onClick={() => void build()}>{building ? <>Checking readiness <LoadingDots /></> : "Build"}</button></> : <p className="dashboard-feedback error">{selectedBlueprintError ?? "Loading blueprint details..."}</p>}{message && <p className="dashboard-feedback" role="status">{message}</p>}</div></div>}</div>}</section>;
}

function RegularModeOverview({ snapshot, onStatusChange }: { snapshot: RegularModeSnapshot; onStatusChange: (moduleId: string, status: "online" | "offline" | "active") => void }) {
  const [operatingLine] = useState(() => pickOperatingLine());
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  return <div className="regular-overview"><section className="overview-greeting" aria-labelledby="overview-heading"><p>{greeting}, inhabitants.</p><h2 id="overview-heading">{operatingLine}</h2></section><section className={`overall-status status-block ${snapshot.overall.tone}`} aria-labelledby="overall-status-heading"><div><p className="dashboard-label">Overall habitat status</p><h2 id="overall-status-heading">{snapshot.overall.label}</h2><p>{snapshot.overall.detail}</p></div><span className="status-word">{snapshot.connection}</span></section><AlertSection alerts={snapshot.alerts} /><section className="overview-section" aria-labelledby="resources-heading"><SectionHeading id="resources-heading" label="Resources" detail="Meaning before measurement" /><div className="resource-grid">{snapshot.resources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}</div></section><section className="overview-section" aria-labelledby="modules-heading"><SectionHeading id="modules-heading" label="Modules" detail={`${snapshot.modules.length} installed`} /><div className="module-grid">{snapshot.modules.length ? snapshot.modules.map((module) => <ModuleCard key={module.id} module={module} onStatusChange={onStatusChange} />) : <EmptyState text="No modules are reported by Habitat yet." />}</div></section>{snapshot.activeWork.length > 0 && <section className="overview-section" aria-labelledby="work-heading"><SectionHeading id="work-heading" label="Active work" detail="Current operations" /><div className="work-list">{snapshot.activeWork.map((work) => <article className="work-row" key={work.id}><div><p className="dashboard-label">{work.kind}</p><h3>{work.label}</h3><p>{work.detail}</p></div>{work.percent !== undefined && <strong>{work.percent}%</strong>}</article>)}</div></section>}<section className="overview-section" aria-labelledby="activity-heading"><SectionHeading id="activity-heading" label="Recent activity" detail="Operational history" />{snapshot.activity.length ? <div className="activity-list">{snapshot.activity.map((event) => <article className="activity-row" key={event.id}><time>{formatLocalTime(event.occurredAt)}</time><div><h3>{event.label}</h3><p>{event.detail}</p></div></article>)}</div> : <EmptyState text="No recent operational events." />}</section></div>;
}

function AlertSection({ alerts }: { alerts: RegularModeSnapshot["alerts"] }) { return <section className="overview-section alerts-section" aria-labelledby="alerts-heading"><SectionHeading id="alerts-heading" label="Alerts" detail={alerts.length ? `${alerts.length} open` : "All clear"} />{alerts.length ? <div className="alert-list">{alerts.map((alert) => <article className={`alert-row ${alert.severity}`} key={alert.id}><span className="status-word">{alert.severity}</span><div><h3>{alert.title}</h3><p>{alert.detail}</p>{alert.action && <small>{alert.action}</small>}</div></article>)}</div> : <div className="no-alerts"><span aria-hidden="true">✓</span><div><h3>No alerts</h3><p>Habitat reports no conditions requiring attention.</p></div></div>}</section>; }
function ResourceCard({ resource }: { resource: ResourceSummary }) { return <article className={`resource-card ${resource.tone}`}><p className="dashboard-label">{resource.label}</p><strong>{resource.value}</strong><h3>{resource.interpretation}</h3><details><summary>Details</summary><p>{resource.detail}</p></details></article>; }
function ModuleCard({ module, onStatusChange }: { module: ModuleSummary; onStatusChange?: (moduleId: string, status: "online" | "offline" | "active") => void }) {
  const controllable = onStatusChange && ["online", "offline", "active"].includes(module.status);
  const [status, setStatus] = useState<"online" | "offline" | "active">(module.status === "active" ? "active" : module.status === "offline" ? "offline" : "online");

  useEffect(() => {
    if (module.status === "active" || module.status === "offline" || module.status === "online") {
      setStatus(module.status);
    }
  }, [module.status]);

  return <article className="module-card"><div><p className="dashboard-label">{module.blueprintId}</p><h3>{module.label}</h3></div>{controllable ? <select className={`status-chip module-status-select ${status}`} aria-label={`Change ${module.label} status`} value={status} onChange={(event) => { const nextStatus = event.target.value as "online" | "offline" | "active"; setStatus(nextStatus); void onStatusChange?.(module.id, nextStatus); }}><option value="online">online</option><option value="offline">offline</option><option value="active">active</option></select> : <span className={`status-chip ${module.status}`}>{module.status}</span>}<details><summary>Details</summary><p>{module.detail}{module.status === "damaged" && " Status is read-only until repaired."}</p></details></article>;
}
function SectionHeading({ id, label, detail }: { id: string; label: string; detail: string }) { return <div className="section-heading"><h2 id={id}>{label}</h2><span className="telemetry-text">{detail}</span></div>; }
function EmptyState({ text }: { text: string }) { return <p className="dashboard-feedback">{text}</p>; }
function LoadingDots() { return <span className="dashboard-loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>; }
function LoadingState({ label }: { label: string }) { return <p className="dashboard-feedback dashboard-loading" role="status">{label} <LoadingDots /></p>; }
function formatBlueprintValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(none)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function formatBlueprintOutput(blueprint: Blueprint): string {
  if (!blueprint.output || typeof blueprint.output !== "object") return "(none)";
  const output = blueprint.output as Record<string, unknown>;
  const moduleType = typeof output.moduleType === "string" ? output.moduleType : undefined;
  const itemType = typeof output.itemType === "string" ? output.itemType : undefined;
  const quantity = typeof output.quantity === "number" && output.quantity > 1 ? ` x${output.quantity}` : "";
  if (moduleType) return `module: ${moduleType}${quantity}`;
  if (itemType) return `${itemType}${quantity}`;
  return "(none)";
}
function formatBlueprintRequiredFacility(blueprint: Blueprint): string {
  const requiredFacility = blueprint.requiredFacility;
  if (typeof requiredFacility === "string" && requiredFacility.length > 0) return requiredFacility;
  if (!requiredFacility || typeof requiredFacility !== "object" || Array.isArray(requiredFacility)) return "(none)";
  const record = requiredFacility as Record<string, unknown>;
  const candidates = [record.moduleType, record.blueprintId, record.facilityType, record.id];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0) ?? "(none)";
}
function formatLocalTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date); }
export function mountDashboard(element: Element) { createRoot(element).render(<StrictMode><Dashboard /></StrictMode>); }

const previewCatalogResources: CatalogResource[] = [
  { resourceId: "ferrite", displayName: "Ferrite", status: "common", amount: 0 },
  { resourceId: "water", displayName: "Water", status: "operational", amount: 0 },
  { resourceId: "oxygen", displayName: "Oxygen", status: "operational", amount: 0 },
];
const previewInventory: InventoryItem[] = [];
const previewBlueprints: Blueprint[] = [
  { blueprintId: "small-solar-array", displayName: "Small Solar Array", description: "Compact surface power generation.", buildTicks: 900, inputs: { steel: 12, silicon: 8 } },
  { blueprintId: "life-support", displayName: "Life Support", description: "Closed-loop habitat support.", buildTicks: 1800, inputs: { steel: 24, electronics: 6 } },
];
