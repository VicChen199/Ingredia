---
type: infrastructure
---
# Environment

## Purpose

`.env` is local and gitignored. `.env.example` is the shape of that file: names and comments, no secret values. `pnpm dev` starts local Postgres and Azurite with no env file. Copy `.env.example` to `.env` when a knob below is needed.

## Shape

Commented lines in `.env.example` are optional. Uncomment a line only to set that knob. Do not commit `.env`.

Google sign-in and the session cookie use three names:

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_SECRET`

The maintainer of this repository already has the current values for those three. Ask them. Do not invent values, and do not paste the values into docs, issues, or chat.

Other knobs, all optional for local dev:

- `PGLITE_DATA_DIR` — tests only. `memory://` runs Postgres in-process.
- `DATABASE_URL` — unset uses `postgresql://postgres:postgres@127.0.0.1:5433/postgres`. Set it to point the same code at another Postgres.
- `PG_POOL_MAX` — pool size. Shared class servers keep this at 1.
- `AZURE_STORAGE_CONNECTION_STRING` — unset uses Azurite. Set it to use a real Azure storage account.
- `LOG_LEVEL` — `debug`, `info`, `warn`, or `error`.

## Verify

`.env` is listed in `.gitignore`. `.env.example` names `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET` and contains no secret values.

## Key ADRs

- [ADR-0008](../adr/0008-azurite-seam.md) — Azurite when the storage connection string is unset.
- [ADR-0005](../adr/0005-pglite-tests.md) — PGlite when tests set `PGLITE_DATA_DIR`.
