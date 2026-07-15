# Crew, Exploration, Collection, and Alerts Design

## Scope

Add locally owned Habitat crew, EVA, resource-return, and alert behavior. The
CLI and browser-facing clients continue to call the local Hono API; only that
API calls Kepler for shared-world scan and collection operations.

## State and ownership

The existing SQLite `habitat_state` record remains the single local state
store. `HabitatData` will gain validated fields for:

- persisted humans from Kepler registration (`id`, `displayName`,
  `locationModuleId`);
- exploration state (deployed human ID or null, coordinates, carried resources,
  and a fixed kilogram capacity);
- persisted alert records and the registered alert contract.

Kepler remains authoritative for sector boundaries, world resource identity,
and remaining tile quantities. Local state determines human occupancy, EVA
eligibility, location, and capacity before it calls Kepler.

## Registration and crew

Registration will parse `starterHumans` and `contracts.alerts` from the live
payload and atomically persist them with the six starter modules. Any invalid
payload or persistence failure leaves the prior local registration state
unchanged. Re-registration does not invent or duplicate humans.

`humans.ts` owns list and move operations. A human can move to an existing
module only when the module has unused `runtimeAttributes.crewCapacity`.
Deleting any occupied module is rejected.

## EVA and collection

`eva.ts` owns deployment, cardinal one-tile movement within Kepler's current
sector, scan position access, collection, and docking. Deployment requires a
human in the starter module with `basic-suitport` capability and begins at
`(0, 0)`. At most one explorer is active. Invalid moves and collection failures
do not modify local state.

The scan endpoint accepts only strength and radius and reads its origin from
the saved deployed explorer. Collection validates a positive whole-number
quantity and remaining carrying capacity locally, calls Kepler's authenticated
`POST /world/collect`, and adds the returned material locally only on success.

Docking is valid only at `(0, 0)` and uses one SQLite transaction to transfer
carried material to inventory, restore the explorer to the suitport, clear EVA
state, and resolve the deployment condition.

## Alerts

`alerts.ts` owns contract-backed alert persistence and lifecycle. It creates or
refreshes a single unresolved alert per condition, updating occurrence count
and last-observed time. Alerts cover active deployment, full carrying capacity,
and Kepler collection failures after local validation. They support open,
acknowledged, and resolved states, and may optionally reference a human or
module.

## API, CLI, and tests

Canonical local Hono endpoints are `/humans`, `/eva`, `/collect`, and
`/alerts`; there are no duplicate `/api` aliases. The typed API client and
Commander wiring add the required `human`, `eva`, `collect`, and `alert`
commands, with readable text plus stable `--json` results.

Focused tests cover registration rollback and hydration, crew capacity and
module deletion, EVA movement and scan origin, collection and docking
atomicity, and alert deduplication/lifecycle.
