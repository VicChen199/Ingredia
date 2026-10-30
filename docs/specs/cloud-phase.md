---
type: feature
---
# Cloud phase — build and add-ons

How to build the cloud phase in [development-phases.md](./development-phases.md), and the add-on features that sit on top of decisions already made.

Add-ons extend the camera loop. They do not replace Auth.js, Azure, Prisma, or the encyclopedia tables.

## Decisions kept

| Decision | Where it lives |
|---|---|
| Postgres + Prisma, one schema, additive migrations | [ADR-0004](../adr/0004-prisma-orm.md) |
| `currentUserId()`; the dev stub throws in production | [ADR-0003](../adr/0003-dev-identity-stub.md), [auth.md](./auth.md) |
| Auth.js database sessions. Google is `provider = "google"`. `Account` is unique on `(provider, providerAccountId)`. No `password`. No `google_id` on `User`. Unlink deletes `Account` only. | [development-phases.md](./development-phases.md), [data-model.md](./data-model.md) |
| Azure Postgres and Azure Blob. The row stores `blob_name`, never a URL. Local bytes stay on Azurite. | [deploy.md](./deploy.md), [storage.md](./storage.md), [ADR-0006](../adr/0006-blob-storage.md), [ADR-0008](../adr/0008-azurite-seam.md) |
| `Evidence` and `RegulatoryStatus`. The profile stays the short blurb. US vs EU is two regulatory rows. | [data-model.md](./data-model.md) |
| Encyclopedia `INSERT`s stay out of migrations. | [development-phases.md](./development-phases.md) |
| Matching is `IngredientAlias.normalized` plus `pg_trgm`. Aliases are unique per ingredient. | [data-model.md](./data-model.md) |
| Favorite points at a Capture. No Product, listing, or visit tables in cloud. | [development-phases.md](./development-phases.md) |
| Domain queries stay in `packages/domain`, imported by the web app. | [ADR-0009](../adr/0009-domain-web-only.md) |

[auth.md](./auth.md) still says GitHub. That is the template leftover. The identity track updates it to Google. The provider is not an open choice.

## Four tracks

Four engineers build the kept cloud phase at the same time. Each track has its own files.

| Track | Owns | Does not edit | Adds |
|---|---|---|---|
| Identity | `packages/auth`, `/login`, `/api/auth/*`, `docs/specs/auth.md` | Capture matching, catalog files, deploy workflows | Auth.js `Account`, `Session`, `VerificationToken` |
| Hosting | Deploy workflow, host secrets, `DATABASE_URL`, `AZURE_STORAGE_CONNECTION_STRING` | `schema.prisma`, domain packages, catalog files | Azure Postgres, Azure Blob, Container Apps |
| Encyclopedia schema | `Evidence`, `RegulatoryStatus`, those fields on capture read | Auth, catalog content files, deploy workflows | The cloud tables in the data model |
| Catalog | `apps/migrate/src/catalog/`, loaded from `apps/migrate/src/seed.ts` | `schema.prisma`, `packages/auth`, deploy workflows | Rows for the tables that already exist, then evidence and regulatory rows |

Identity and Encyclopedia schema are the only tracks that edit `schema.prisma`. Each ships its own migration folder and only its own models. Neither edits the other’s migration.

The dev stub throws in production, so a public URL waits until Identity has merged. Hosting can prove `migrate deploy`, `/api/health`, and a blob round-trip on current main before that. Catalog can load ingredients, aliases, profiles, and flags today. Evidence and regulatory rows load once Encyclopedia schema has merged.

### Identity

**Goal.** The session is the only identity. Google creates or links a `User`.

Callers keep `const userId = await currentUserId()`. Tests that mock `@project/auth` keep mocking that function. Public routes are the landing page, `/login`, `/api/health`, and `/api/auth/*`. Other API calls without a session return 401. Pages redirect to `/login`. The `x-user-id` header and `ALLOW_DEV_IDENTITY` leave the codebase, including dev.

**Done when.** On localhost, two Google accounts each see only their own captures and favorites. Unlinking Google leaves the user and their captures.

### Hosting

**Goal.** The same camera app survives a restart on Azure. This track applies [deploy.md](./deploy.md) and [seams.md](./seams.md). It does not add product behavior.

Image build in CI, a new Container Apps revision at 0% traffic, smoke `GET /api/health` with `db: "ok"`, then promote. Secrets live on the host. `.env.example` lists every variable. Google redirect URIs for the live origin are recorded here and used by Identity’s client config.

**Done when.** A revision runs `prisma migrate deploy`, an upload round-trips to Azure Blob, a restart leaves the Capture row, and health fails closed when the database is down.

### Encyclopedia schema

**Goal.** Citations and jurisdiction have the tables the data model already names. `IngredientProfile` stays the blurb.

- `Evidence`: `ingredient_id`, `summary`, `source_url`, `published_on`, `claim_type` (`safety` | `function` | `controversy`).
- `RegulatoryStatus`: `ingredient_id`, `jurisdiction` (`US` | `EU` | `CA` | …), `status_text`, `as_of_date`.

Capture read grows additive fields for those rows. Matching and favorites stay as they are. A few fixture rows live in tests. Production rows belong to Catalog. Ingredient delete still restricts when any `CaptureItem` references it.

**Done when.** One ingredient on a capture detail shows the blurb, one citation, and two jurisdiction rows.

### Catalog

**Goal.** A real label matches. This is the production risk, not the VM.

Catalog files under `apps/migrate/src/catalog/` are loaded with re-runnable upserts. The stub `User` block in `apps/migrate/src/seed.ts` stays until Identity replaces sign-in. The demo gluten / fragrance / comedogenic rows may move into the catalog files.

**Done when.** Seeding loads the catalog. A real label, not the sample text in the process stub, matches multiple lines and a preference flag fires. Seeded ingredients have a real blurb, at least one evidence row, and separate US and EU rows where both apply.

**Done when, all four.** Sign in with Google, upload a label, data survives restart on Azure, user A cannot see user B, and ingredient pages are more than the demo seed.

## Add-on features

These are new behavior on the system above. The base tables, auth product, and host stay. A choice inside an add-on is accepted by updating that add-on’s spec (`capture/process.md` or the catalog notes in this file). It does not need a new auth or hosting vendor.

### Read the label

**Attaches to.** The extract step in `POST /api/captures/:id/process`. Today the route does not read the blob. Optional JSON `{ "text" }` is the label. With no text, the extractor returns a fixed sample. Status still walks `uploaded → extracted → parsed` in the web request. [capture/process.md](./capture/process.md).

**Keeps.** The paste path. The status machine. `blob_name` as the image identity. No new tables.

Cloud can ship while this add-on is still the stub. Matching and favorites already work from pasted text.

**Choice: how the first real read runs.**

| Option | What it adds | Cost |
|---|---|---|
| A. Leave the stub | Nothing. The stored photo is unused until someone pastes text. | “Upload a label” does not yet mean “read a label.” |
| B. One server function. Recommended. | `extractText(bytes, contentType) → string` inside the existing extract step. Pasted `text` still wins when the client sends it. The blob is read only when `text` is absent. | A large photo can time out the request. The engine is a secret and a per-image cost. |
| C. A worker job | Upload or process enqueues a job. The worker writes `raw_text`. | The worker cannot import `packages/domain` ([ADR-0009](../adr/0009-domain-web-only.md)) unless that ADR is superseded. More machinery before we know the request is too slow. |

**Engine, only if B.** One of Google Cloud Vision or Azure Document Intelligence, behind `extractText`, so the route does not name the vendor. Pick when the add-on is built. Swapping the engine later does not change Capture.

On-device OCR is a later client that sends `text`. The server path stays the paste path. It is not a second extractor to build in this add-on.

**Recommendation.** Ship cloud on A. Add B when a photo has to become text. Do not start with C.

### Fill the encyclopedia

**Attaches to.** The ingredient, alias, profile, flag, `Evidence`, and `RegulatoryStatus` tables. The field lists stay as in [data-model.md](./data-model.md).

**Keeps.** Seed or a content pipeline, not migration `INSERT`s. A missing citation or jurisdiction is an empty list, not a guessed status. Capture still freezes the match the user saw; this add-on does not look an ingredient up from a third party at request time.

**Choice: where a row is written.**

| Option | What it adds | Cost |
|---|---|---|
| A. Git-reviewed catalog files. Recommended. | `apps/migrate/src/catalog/` plus the seed loader. A pull request is the review. | Coverage grows only as fast as reviews. |
| B. A spreadsheet or CSV import into those same files | A checked-in converter that emits the catalog files. People edit a sheet; git still holds the result. | Two formats to keep aligned. |
| C. An admin UI | Signed-in editors write rows in the app. | A new role, audit, and a privacy story [auth.md](./auth.md) already postponed. Out of cloud. |

**Sources.** Public INCI or regulatory lists may be imported into option A where the license allows redistribution. The import copies rows into our tables. The running app does not call that source.

**Coverage.** “Not a toy” means a normal shampoo or packaged-food label matches most lines, on the order of a few hundred common names, not a full dictionary. Unknown tokens stay `unknown`. The exact list is chosen in the catalog pull requests.

A row needs a display name, at least one alias, and a profile blurb before it is seeded. Evidence and jurisdiction rows are added when we are willing to show them.

**Recommendation.** A. Use B only as a generator that commits catalog files. Do not build C in this phase.
