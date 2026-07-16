import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeStatusSnapshot, pickOperatingLine, type DashboardMode, type RegularModeSnapshot, type ModuleSummary, type ResourceSummary } from "./dashboard-model";
import { previewSnapshot } from "./preview";
import "./dashboard.css";

declare global { interface Window { habitatAuthSkipPreview?: boolean; } }

const modes: Array<{ id: DashboardMode; label: string; detail: string }> = [
  { id: "regular", label: "Regular", detail: "Habitat operations" },
  { id: "display", label: "Display", detail: "Coming later" },
  { id: "info", label: "Info", detail: "Coming later" },
];
const subsystems = ["Overview", "Modules", "Blueprints", "Resources", "Inventory", "Construction", "Alerts", "Forecast", "Humans", "Scan"];
type Subsystem = typeof subsystems[number];
type Blueprint = { blueprintId: string; displayName: string; description?: string; buildTicks?: number };
type InventoryItem = { resourceId: string; amount: number };

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" } });
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
  const [snapshot, setSnapshot] = useState<RegularModeSnapshot | null>(previewMode ? normalizeStatusSnapshot(previewSnapshot) : null);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [activeMode, setActiveMode] = useState<DashboardMode>("regular");
  const [activeSubsystem, setActiveSubsystem] = useState<Subsystem>("Overview");
  const [blueprints, setBlueprints] = useState<Blueprint[] | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const unregisterDialog = useRef<HTMLDialogElement>(null);

  const refresh = async () => {
    setLoading(true); setError(null);
    try { setSnapshot(previewMode ? normalizeStatusSnapshot(previewSnapshot) : await loadSnapshot()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Habitat."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!previewMode) void refresh(); }, [previewMode]);
  useEffect(() => {
    if (activeSubsystem === "Blueprints" && !blueprints) void request<{ blueprints: Blueprint[] }>("/catalog/blueprints").then((result) => setBlueprints(result.blueprints)).catch(() => setBlueprints([]));
    if (activeSubsystem === "Inventory" && !inventory) void request<{ inventory: InventoryItem[] }>("/inventory").then((result) => setInventory(result.inventory)).catch(() => setInventory([]));
  }, [activeSubsystem, blueprints, inventory]);

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

  if (loading && !snapshot) return <main className="habitat-dashboard state-page"><div className="empty-state"><p className="dashboard-label">Habitat</p><h2>Reading habitat state <LoadingDots /></h2></div></main>;
  if (error && !snapshot) return <main className="habitat-dashboard state-page"><div className="error-state"><p className="dashboard-label">Connection error</p><h2>Habitat is not reachable.</h2><p>{error}</p><button className="button button-primary" onClick={() => void refresh()}>Retry</button></div></main>;
  if (!snapshot?.registration) return <RegistrationState name={name} message={message} setName={setName} register={() => void register()} />;

  return <main className="habitat-dashboard console-layout">
    <aside className="console-sidebar" aria-label="Habitat modes">
      <div className="sidebar-identity"><span className="sidebar-mark" aria-hidden="true" /><span>{snapshot.registration.displayName}</span></div>
      <div className="mode-slider" role="group" aria-label="Habitat display mode"><span className="mode-slider-label">Mode</span><div className="mode-slider-track">{modes.map((mode) => <button key={mode.id} className={`mode-slider-option ${mode.id === activeMode ? "is-active" : ""}`} type="button" aria-pressed={mode.id === activeMode} onClick={() => setActiveMode(mode.id)}><span>{mode.label}</span><small>{mode.detail}</small></button>)}</div></div>
      <nav className="subsystem-nav" aria-label="Habitat subsystems"><span className="mode-slider-label">Systems</span>{subsystems.map((item) => <button key={item} className={`subsystem-link ${item === activeSubsystem ? "is-active" : ""}`} type="button" aria-current={item === activeSubsystem ? "page" : undefined} onClick={() => setActiveSubsystem(item)}>{item}</button>)}</nav>
      <div className="sidebar-footer"><span className={`connection-dot ${snapshot.connection}`} aria-hidden="true" /> <span>{snapshot.connection === "connected" ? snapshot.registration.status ?? "connected" : "disconnected"}</span></div>
    </aside>
    <section className="console-content"><header className="console-header"><div><p className="dashboard-label">{snapshot.registration.displayName} / habitat</p><h1 id="dashboard-title">{modes.find((mode) => mode.id === activeMode)?.label}</h1></div><div className="dashboard-actions"><button className="button" disabled={loading} onClick={() => void refresh()}>Refresh</button><button className="button" onClick={() => void logout()}>Log out</button><button className="button button-danger" onClick={() => unregisterDialog.current?.showModal()}>Unregister</button></div></header>
      <section id={`${activeMode}-panel`} role="tabpanel" aria-label={`${activeMode} mode`} className="console-panel">{activeMode !== "regular" ? <ModePlaceholder mode={activeMode} /> : activeSubsystem === "Overview" ? <RegularModeOverview snapshot={snapshot} /> : <SubsystemView name={activeSubsystem} snapshot={snapshot} blueprints={blueprints} inventory={inventory} />}</section>
      {message && <p className="dashboard-feedback success" role="status">{message}</p>}
    </section>
    <dialog className="dashboard-dialog" ref={unregisterDialog}><p className="dashboard-label">Registration</p><h2>Unregister {snapshot.registration.displayName}?</h2><p>This removes the current registration through the Habitat API.</p><div className="dialog-actions"><button className="button" onClick={() => unregisterDialog.current?.close()}>Cancel</button><button className="button button-danger" onClick={() => { unregisterDialog.current?.close(); void unregister(); }}>Unregister</button></div></dialog>
  </main>;
}

function RegistrationState({ name, message, setName, register }: { name: string; message: string | null; setName: (name: string) => void; register: () => void }) { return <main className="habitat-dashboard state-page"><section className="registration-intro"><p className="dashboard-label">Habitat</p><h1 id="dashboard-title">Not registered.</h1><p>Connect this display to a Habitat to see its live state.</p></section><section className="empty-state"><h2>Choose a Habitat name.</h2><form className="registration-form" onSubmit={(event) => { event.preventDefault(); register(); }}><label htmlFor="habitat-name">Habitat name</label><input id="habitat-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Habitat name" required /><button className="button button-primary">Register</button></form>{message && <p className="dashboard-feedback" role="status">{message}</p>}</section></main>; }

function ModePlaceholder({ mode }: { mode: DashboardMode }) { const label = mode === "display" ? "Display Mode" : "Info Mode"; return <section className="mode-placeholder"><p className="dashboard-label">{label}</p><h2>This mode is connected.</h2><p>{label} is reserved for its own focused experience. Regular Mode remains the operating view for now.</p></section>; }
function SubsystemView({ name, snapshot, blueprints, inventory }: { name: Subsystem; snapshot: RegularModeSnapshot; blueprints: Blueprint[] | null; inventory: InventoryItem[] | null }) {
  if (name === "Modules") return <section className="subsystem-view"><SectionHeading id="modules-view-heading" label="Modules" detail={`${snapshot.modules.length} installed`} /><div className="module-grid">{snapshot.modules.length ? snapshot.modules.map((module) => <ModuleCard key={module.id} module={module} />) : <EmptyState text="No modules are reported by Habitat yet." />}</div></section>;
  if (name === "Alerts") return <section className="subsystem-view"><AlertSection alerts={snapshot.alerts} /></section>;
  if (name === "Resources") return <section className="subsystem-view"><SectionHeading id="resources-view-heading" label="Resources" detail="Current habitat reserves" /><div className="resource-grid">{snapshot.resources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}</div></section>;
  if (name === "Construction") return <section className="subsystem-view"><SectionHeading id="construction-view-heading" label="Construction" detail="Active work" />{snapshot.activeWork.length ? <div className="work-list">{snapshot.activeWork.map((work) => <article className="work-row" key={work.id}><div><p className="dashboard-label">{work.kind}</p><h3>{work.label}</h3><p>{work.detail}</p></div>{work.percent !== undefined && <strong>{work.percent}%</strong>}</article>)}</div> : <EmptyState text="No construction is currently active." />}</section>;
  if (name === "Forecast") return <section className="subsystem-view"><SectionHeading id="forecast-view-heading" label="Forecast" detail="Surface conditions" /><div className="mode-placeholder"><p className="dashboard-label">Next conditions</p><h2>Solar outlook: clear.</h2><p>Current irradiance supports normal power generation. Detailed hourly forecasts will appear here when the weather feed is connected.</p></div></section>;
  if (name === "Humans") return <section className="subsystem-view"><SectionHeading id="humans-view-heading" label="Humans" detail="Crew overview" /><div className="mode-placeholder"><p className="dashboard-label">Crew manifest</p><h2>Habitat crew systems ready.</h2><p>Human locations, assignments, and EVA state will appear here from the crew service.</p></div></section>;
  if (name === "Scan") return <section className="subsystem-view"><SectionHeading id="scan-view-heading" label="Scan" detail="Explorer interface" /><div className="mode-placeholder"><p className="dashboard-label">Surface scan</p><h2>Explorer scan ready.</h2><p>Deploy a human and provide sensor strength and radius to scan nearby terrain through the Habitat CLI workflow.</p></div></section>;
  if (name === "Blueprints") return <section className="subsystem-view"><SectionHeading id="blueprints-view-heading" label="Blueprints" detail={blueprints ? `${blueprints.length} available` : "Loading catalog"} />{blueprints === null ? <LoadingState label="Loading blueprint catalog" /> : <div className="blueprint-list">{blueprints.length ? blueprints.map((blueprint) => <article key={blueprint.blueprintId}><h3>{blueprint.displayName}</h3><p>{blueprint.description ?? blueprint.blueprintId}</p>{blueprint.buildTicks !== undefined && <small>{blueprint.buildTicks} build ticks</small>}</article>) : <EmptyState text="Blueprint catalog is unavailable." />}</div>}</section>;
  if (name === "Inventory") return <section className="subsystem-view"><SectionHeading id="inventory-view-heading" label="Inventory" detail={inventory ? `${inventory.length} resource types` : "Loading inventory"} />{inventory === null ? <LoadingState label="Loading inventory" /> : inventory.length ? <div className="inventory-list">{inventory.map((item) => <article className="work-row" key={item.resourceId}><h3>{item.resourceId}</h3><strong>{item.amount}</strong></article>)}</div> : <EmptyState text="Inventory is currently empty." />}</section>;
  return <section className="subsystem-view mode-placeholder"><p className="dashboard-label">{name}</p><h2>System view ready.</h2><p>This subsystem is connected to the Habitat navigation.</p></section>;
}

function RegularModeOverview({ snapshot }: { snapshot: RegularModeSnapshot }) {
  const [operatingLine] = useState(() => pickOperatingLine());
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  return <div className="regular-overview"><section className="overview-greeting" aria-labelledby="overview-heading"><p>{greeting}, inhabitants.</p><h2 id="overview-heading">{operatingLine}</h2></section><section className={`overall-status status-block ${snapshot.overall.tone}`} aria-labelledby="overall-status-heading"><div><p className="dashboard-label">Overall habitat status</p><h2 id="overall-status-heading">{snapshot.overall.label}</h2><p>{snapshot.overall.detail}</p></div><span className="status-word">{snapshot.connection}</span></section><AlertSection alerts={snapshot.alerts} /><section className="overview-section" aria-labelledby="resources-heading"><SectionHeading id="resources-heading" label="Resources" detail="Meaning before measurement" /><div className="resource-grid">{snapshot.resources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}</div></section><section className="overview-section" aria-labelledby="modules-heading"><SectionHeading id="modules-heading" label="Modules" detail={`${snapshot.modules.length} installed`} /><div className="module-grid">{snapshot.modules.length ? snapshot.modules.map((module) => <ModuleCard key={module.id} module={module} />) : <EmptyState text="No modules are reported by Habitat yet." />}</div></section>{snapshot.activeWork.length > 0 && <section className="overview-section" aria-labelledby="work-heading"><SectionHeading id="work-heading" label="Active work" detail="Current operations" /><div className="work-list">{snapshot.activeWork.map((work) => <article className="work-row" key={work.id}><div><p className="dashboard-label">{work.kind}</p><h3>{work.label}</h3><p>{work.detail}</p></div>{work.percent !== undefined && <strong>{work.percent}%</strong>}</article>)}</div></section>}<section className="overview-section" aria-labelledby="activity-heading"><SectionHeading id="activity-heading" label="Recent activity" detail="Operational history" />{snapshot.activity.length ? <div className="activity-list">{snapshot.activity.map((event) => <article className="activity-row" key={event.id}><time>{event.occurredAt}</time><div><h3>{event.label}</h3><p>{event.detail}</p></div></article>)}</div> : <EmptyState text="No recent operational events." />}</section></div>;
}

function AlertSection({ alerts }: { alerts: RegularModeSnapshot["alerts"] }) { return <section className="overview-section alerts-section" aria-labelledby="alerts-heading"><SectionHeading id="alerts-heading" label="Alerts" detail={alerts.length ? `${alerts.length} open` : "All clear"} />{alerts.length ? <div className="alert-list">{alerts.map((alert) => <article className={`alert-row ${alert.severity}`} key={alert.id}><span className="status-word">{alert.severity}</span><div><h3>{alert.title}</h3><p>{alert.detail}</p>{alert.action && <small>{alert.action}</small>}</div></article>)}</div> : <div className="no-alerts"><span aria-hidden="true">✓</span><div><h3>No alerts</h3><p>Habitat reports no conditions requiring attention.</p></div></div>}</section>; }
function ResourceCard({ resource }: { resource: ResourceSummary }) { return <article className={`resource-card ${resource.tone}`}><p className="dashboard-label">{resource.label}</p><strong>{resource.value}</strong><h3>{resource.interpretation}</h3><details><summary>Details</summary><p>{resource.detail}</p></details></article>; }
function ModuleCard({ module }: { module: ModuleSummary }) { return <article className="module-card"><div><p className="dashboard-label">{module.blueprintId}</p><h3>{module.label}</h3></div><span className={`status-chip ${module.status}`}>{module.status}</span><details><summary>Details</summary><p>{module.detail}</p></details></article>; }
function SectionHeading({ id, label, detail }: { id: string; label: string; detail: string }) { return <div className="section-heading"><h2 id={id}>{label}</h2><span className="telemetry-text">{detail}</span></div>; }
function EmptyState({ text }: { text: string }) { return <p className="dashboard-feedback">{text}</p>; }
function LoadingDots() { return <span className="dashboard-loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>; }
function LoadingState({ label }: { label: string }) { return <p className="dashboard-feedback dashboard-loading" role="status">{label} <LoadingDots /></p>; }
export function mountDashboard(element: Element) { createRoot(element).render(<StrictMode><Dashboard /></StrictMode>); }
