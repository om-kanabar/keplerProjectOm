# Habitat web command surface design

## Goal

Expose the user-facing `habitat --help` command surface in the web dashboard while excluding auth commands, developer tick controls, and `resource add`. The web UI should preserve the existing fullscreen dashboard and overview personality behavior.

## Navigation and views

The existing sidebar becomes a grouped command navigator. Groups are Overview, Modules, Blueprints, Construction, Resources & inventory, Crew, EVA & scanning, Alerts, Catalogs, and Server & settings. Each group maps to a full-width view and uses the local Habitat API rather than invoking a shell command from the browser.

Read-only commands render responsive tables or compact cards. Detail views use the existing fullscreen overlay pattern with a back button, including blueprint and module details.

## Actions

Supported mutations are module status/update/delete/battery recharge, construction cancel, blueprint build, inventory add, human move, EVA deploy/move/dock, collection, alert acknowledge, connect, and unregister. `resource add` is intentionally omitted. Delete, cancel, and unregister require an explicit confirmation step. Damaged modules remain visible but status controls cannot enable them.

## Data and error handling

Views load through typed request helpers and show the existing loading dots while pending. Errors remain in the current view with a retry action. Mutations refresh the affected data after success and show a concise inline result. Server endpoints should delegate to the same domain logic as CLI commands so behavior stays consistent.

## Verification

Add focused tests covering navigation, endpoint wiring, loading/error states, mutation controls, confirmation gates, and the excluded commands. Run the dashboard build and the focused dashboard/API test suite before completion.
