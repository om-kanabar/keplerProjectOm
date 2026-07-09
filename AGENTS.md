# AGENTS.md

Use this file as the quick guide for working in `/Users/Om/labs/keplerProject`.

This repo is a Bun + TypeScript CLI called `habitat`. Its job is to register a local habitat with the Kepler server, cache registration data, and let users inspect and manage local modules. The main entrypoint is [src/index.ts](/Users/Om/labs/keplerProject/src/index.ts).

## Read First

- [src/index.ts](/Users/Om/labs/keplerProject/src/index.ts): CLI surface and `--json` behavior
- [src/kepler.ts](/Users/Om/labs/keplerProject/src/kepler.ts): server requests and auth env vars
- [src/storage.ts](/Users/Om/labs/keplerProject/src/storage.ts): local persistence
- [src/types.ts](/Users/Om/labs/keplerProject/src/types.ts): schema source of truth
- [tests/habitat-kepler.test.ts](/Users/Om/labs/keplerProject/tests/habitat-kepler.test.ts): registration flow examples

## Rules

- Keep `--json` stable. It is the machine-readable API for other tools.
- Prefer updating typed code paths over manually editing JSON data files.
- Preserve compatibility with both `.habitat-data.json` and `habitat-modules.json`.
- If you change persisted fields, update types, storage parsing, and tests together.

## Local Data

- Main state file: [/.habitat-data.json](/Users/Om/labs/keplerProject/.habitat-data.json)
- Module mirror: [/habitat-modules.json](/Users/Om/labs/keplerProject/habitat-modules.json)

The top-level local shape is `HabitatData`, containing optional `keplerRegistration` and `modules`. The exact schema lives in [src/types.ts](/Users/Om/labs/keplerProject/src/types.ts).

## API And Schema Docs

Use the server docs for the full contract instead of duplicating them here:

- [Kepler docs](https://planet.turingguild.com/docs)

When docs and local code disagree, prefer the checked-in code for this repo unless the user asks for habitat construction status migration.