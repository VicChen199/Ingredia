---
type: feature
---
# A matched ingredient carries its citations and its legal status per jurisdiction

## Why

A one-line blurb tells a person what an ingredient is, not why anyone says it
is safe, useful, or controversial, or whether it is allowed where they live.
Citations and per-country status let a capture detail show the source behind a
claim, and show "allowed in the US, restricted in the EU" as two facts rather
than one sentence on the profile.

## Where it lives

- `packages/db/prisma/schema.prisma` — the `Evidence` and `RegulatoryStatus`
  models and the `ClaimType` enum.
- `packages/db/prisma/migrations/0003_encyclopedia.sql` — the additive
  migration that creates them.
- `packages/domain/src/capture-read.ts` — the capture read select and view
  gain the two lists on each linked ingredient.
- `tests/integration/capture-read.test.ts` — fixture rows and assertions.
- [captures/read.md](../captures/read.md) — the read contract these fields are
  added to.

## Behavior

**Evidence** is a citation about one ingredient. An ingredient has zero or
more. Each row has:

- `ingredient_id` → Ingredient, required;
- `claim_type`: `safety` | `function` | `controversy`, required;
- `summary`: what the source says, required, non-empty;
- `source_url`: where it says it, required;
- `published_on`: the source's publication date, a calendar date, nullable
  when the source is undated.

**RegulatoryStatus** is an ingredient's status in one jurisdiction. Each row
has:

- `ingredient_id` → Ingredient, required;
- `jurisdiction`: a short uppercase code (`US`, `EU`, `CA`, …), required;
- `status_text`: the status in plain words, required, non-empty;
- `as_of_date`: the date the status was checked, a calendar date, required.

An ingredient has at most one RegulatoryStatus per jurisdiction. Legal in the
US and restricted in the EU is two rows.

Deleting an Ingredient deletes its Evidence and RegulatoryStatus rows. Deleting
an Ingredient that any CaptureItem references is still refused, so in practice
encyclopedia rows of a scanned ingredient are never removed by an ingredient
delete.

**On capture read.** Every linked `ingredient` in `GET /api/captures` and
`GET /api/captures/:id` gains two arrays next to `profile` and `flags`:

- `evidence`: `{ claimType, summary, sourceUrl, publishedOn }`, ordered by
  `publishedOn` descending with undated rows last, then by summary ascending.
- `regulatoryStatuses`: `{ jurisdiction, statusText, asOfDate }`, ordered by
  `jurisdiction` ascending.

Dates are `YYYY-MM-DD` strings, not timestamps. An ingredient with no rows
returns `[]` for that array — never a guessed or default status. Unlinked
items still have `ingredient: null`. Every other field of the read response
is unchanged, and the lists are loaded in the same batched query as profile
and flags, never once per item.

Matching, processing, preferences, and favorites do not read these tables.

## Examples

| State / input | Behavior |
|---|---|
| Caller's parsed capture links wheat; wheat has a profile, one `safety` citation, and `US` and `EU` rows | Detail shows the blurb, `evidence` of length 1, and `regulatoryStatuses` `[EU, US]`. |
| Linked ingredient has no evidence or regulatory rows | `evidence: []`, `regulatoryStatuses: []`. |
| Two citations, one dated `2024-05-01`, one undated | The dated one is first. |
| Item is `unknown` | `ingredient: null`; no encyclopedia fields. |
| Second `US` row inserted for the same ingredient | Rejected by the database unique constraint. |
| Evidence row with a `claim_type` outside the enum | Rejected by the database. |
| Ingredient referenced by a CaptureItem is deleted | Refused; its evidence and regulatory rows remain. |
| Unreferenced ingredient with evidence is deleted | Its evidence and regulatory rows are deleted with it. |
| Foreign or unknown capture id | 404 `not_found`, as in [read](../captures/read.md). |

## Verify

- `pnpm exec vitest run tests/integration/capture-read.test.ts` — the
  done-when case (blurb, one citation, two jurisdictions on one ingredient),
  empty lists, ordering, date format, and the unique, enum, and delete
  constraints, against PGlite with the new migration applied.
- `pnpm test`, `pnpm typecheck`, and `pnpm build`.
- With `pnpm dev` running on a database that predates this change, confirm
  the migration applies on start and `GET /api/captures/<owned-id>` returns
  `evidence: []` and `regulatoryStatuses: []` for seeded ingredients.

## Constraints & decisions

- **Schema and read surface only.** Production rows are the Catalog track's,
  loaded by the seed, never by migration `INSERT`s
  ([development-phases](../development-phases.md)). This change adds no seed
  rows; fixture rows live in tests.
- **`claim_type` is an enum; `jurisdiction` is text.** The claim kinds are a
  closed list the UI groups by. Jurisdictions are open-ended (`…` in the
  [data model](../data-model.md)), so adding one is a catalog row, not a
  migration.
- **One row per ingredient and jurisdiction.** A status change replaces the
  row and its `as_of_date`; history of past statuses is not kept.
- **Calendar dates.** `published_on` and `as_of_date` are `DATE` columns, so
  no time zone can shift them by a day.
- **Cascade from Ingredient.** Encyclopedia rows have no meaning without
  their ingredient; the existing `Restrict` from CaptureItem already protects
  scanned ingredients.
- **Migration number `0003`.** `0002` is taken by the identity track's
  migration; both are additive and touch different tables, so either may
  merge first.
- Read shows current catalog content, like profile and flags: a citation
  added later appears on an old capture. The stored items and matches are
  unchanged.

## Out of scope

Catalog content and the seed loader (cloud-phase Catalog track); a standalone
ingredient page or endpoint; editing rows through the app; status history;
favorites responses, which do not join ingredients
([favorites](../captures/favorites.md)); and any UI.
