# Habitat Brand Rename Design

## Goal

Replace the website and example-facing **Cupola** branding with **Habitat**, and publish the site at `habitat.omkanabar.com`.

## Scope

- Update all visible dashboard branding, accessibility labels, browser title, loading copy, and default dashboard copy to say Habitat.
- Rename the dashboard startup function so the implementation does not retain stale Cupola terminology.
- Update CLI registration examples from `Cupola` to `Habitat`.
- Change the repository `CNAME` from `cupola.omkanabar.com` to `habitat.omkanabar.com`.

## Explicit Non-Goals

- Do not rename the GitHub repository or npm package.
- Do not change the `habitat` CLI command.
- Do not migrate or overwrite saved registration display names; an existing habitat called Cupola is user data.
- Do not change server routes, SQLite schema, or the Kepler API contract.

## Behavior and Validation

The static dashboard must show Habitat everywhere it previously showed Cupola. The CLI's human-facing help must use Habitat in its registration examples. `CNAME` must contain only `habitat.omkanabar.com`; the corresponding DNS record must be configured by the deployment owner. Existing CLI and server behavior must remain unchanged.

## Testing

- Add a focused static-content test that rejects remaining live Cupola branding in the dashboard, script, CLI source, and CNAME.
- Run the focused test, then the TypeScript check and existing Bun test suite.

