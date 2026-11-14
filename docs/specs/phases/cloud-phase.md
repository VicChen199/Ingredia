---
type: feature
---
# Cloud phase — build and add-ons

How to build the cloud phase in [development-phases.md](./development-phases.md), and the add-on features that sit on top of decisions already made.

Add-ons extend the camera loop. They do not replace Auth.js, Azure, Prisma, or the encyclopedia tables.

## Decisions kept

| Decision | Where it lives |
|---|---|
| Postgres + Prisma, one schema, additive migrations | [ADR-0004](../../adr/0004-prisma-orm.md) |
| `currentUserId()` reads the Google Auth.js database session | [auth.md](../auth.md), [ADR-0012](../../adr/0012-google-authjs-sessions.md) |
| Auth.js database sessions. Google is `provider = "google"`. `Account` is unique on `(provider, providerAccountId)`. No `password`. No `google_id` on `User`. Unlink deletes `Account` only. Implemented. | [auth.md](../auth.md), [data-model.md](./data-model.md) |
| Future. Azure Postgres and Azure Blob. The row stores `blob_name`, never a URL. Local bytes stay on Azurite until then. | [deploy.md](../deploy.md), [storage.md](../storage.md), [ADR-0006](../../adr/0006-blob-storage.md), [ADR-0008](../../adr/0008-azurite-seam.md) |
| Future. `Evidence` and `RegulatoryStatus`. The profile stays the short blurb. US vs EU is two regulatory rows. | [data-model.md](./data-model.md) |
| Encyclopedia `INSERT`s stay out of migrations. | [development-phases.md](./development-phases.md) |
| Matching is `IngredientAlias.normalized` plus `pg_trgm`. Aliases are unique per ingredient. | [data-model.md](./data-model.md) |
| Favorite points at a Capture. No Product, listing, or visit tables in cloud. | [development-phases.md](./development-phases.md) |
| Domain queries stay in `packages/domain`, imported by the web app. | [ADR-0009](../../adr/0009-domain-web-only.md) |

Google is the provider. That choice is closed.

## Four tracks

Identity is implemented. Hosting, encyclopedia schema, and catalog depth are future.

| Track | Status | Owns | Does not edit | Adds |
|---|---|---|---|---|
| Identity | Implemented | `packages/auth`, `/login`, `/api/auth/*`, `docs/specs/auth.md` | Capture matching, catalog files, deploy workflows | Auth.js `Account`, `Session`, `VerificationToken` |
| Hosting | Future | Deploy workflow, host secrets, `DATABASE_URL`, `AZURE_STORAGE_CONNECTION_STRING` | `schema.prisma`, domain packages, catalog files | Azure Postgres, Azure Blob, Container Apps |
| Encyclopedia schema | Future | `Evidence`, `RegulatoryStatus`, those fields on capture read | Auth, catalog content files, deploy workflows | The cloud tables in the data model |
| Catalog | Future | `apps/migrate/src/catalog/`, loaded from `apps/migrate/src/seed.ts` | `schema.prisma`, `packages/auth`, deploy workflows | Rows for the tables that already exist, then evidence and regulatory rows |

`Account`, `Session`, and `VerificationToken` are already in `0002_auth.sql`. Encyclopedia schema is the remaining track that edits `schema.prisma`. It ships its own migration and only its own models. Hosting can prove `migrate deploy`, `/api/health`, and a blob round-trip without new product tables. The seed already loads the demo ingredients, aliases, profiles, and flags. Evidence and regulatory rows load once encyclopedia schema exists.

### Identity

**Implemented.** The session is the only identity. The contract is [auth.md](../auth.md).

Callers keep `const userId = await currentUserId()`. Tests that mock `@project/auth` keep mocking that function. Public routes are `/`, `/login`, `/api/health`, and `/api/auth/*`. Other API calls without a session cookie return 401. Other pages without a session cookie redirect to `/login`. `x-user-id`, `DEV_USER_ID`, and `ALLOW_DEV_IDENTITY` are gone.

Google sign-in creates or loads a `User`. Unlink deletes the Google `Account` and leaves the user, the session, and their captures. The verify drills are in [auth.md](../auth.md).

### Hosting

**Future.** The same camera app survives a restart on Azure. This track applies [deploy.md](../deploy.md) and [seams.md](../seams.md). It does not add product behavior.

Image build in CI, a new Container Apps revision at 0% traffic, smoke `GET /api/health` with `db: "ok"`, then promote. Secrets live on the host. `.env.example` lists every variable. Google redirect URIs for the live origin are recorded here and used by Identity’s client config.

**Done when.** A revision runs `prisma migrate deploy`, an upload round-trips to Azure Blob, a restart leaves the Capture row, and health fails closed when the database is down.

### Encyclopedia schema

**Future.** Citations and jurisdiction have the tables the data model already names. `IngredientProfile` stays the blurb. Those tables are not in the current schema.

- `Evidence`: `ingredient_id`, `summary`, `source_url`, `published_on`, `claim_type` (`safety` | `function` | `controversy`).
- `RegulatoryStatus`: `ingredient_id`, `jurisdiction` (`US` | `EU` | `CA` | …), `status_text`, `as_of_date`.

Capture read grows additive fields for those rows. Matching and favorites stay as they are. A few fixture rows live in tests. Production rows belong to Catalog. Ingredient delete still restricts when any `CaptureItem` references it.

**Done when.** One ingredient on a capture detail shows the blurb, one citation, and two jurisdiction rows.

### Catalog

**Future.** A real label matches. This is the production risk, not the VM.

Catalog files under `apps/migrate/src/catalog/` do not exist yet. When this track is built, the seed loads them with re-runnable upserts. The seed creates no user. The demo gluten, fragrance, and comedogenic rows stay in `apps/migrate/src/seed.ts` until they move into those catalog files.

**Done when.** Seeding loads the catalog. A real label, not the sample text in the process stub, matches multiple lines and a preference flag fires. Seeded ingredients have a real blurb, at least one evidence row, and separate US and EU rows where both apply.

**Done when, the three future tracks.** An upload survives restart on Azure, user A cannot see user B (already true for the session), and ingredient pages are more than the demo seed. Sign in with Google is already done.

## Add-on features

**Future.** These are not implemented. They are new behavior on the system above. The base tables and the auth product stay. A choice inside an add-on is accepted by updating that add-on’s spec (`capture/process.md` or the catalog notes in this file). It does not need a new auth or hosting vendor.

### Read the label

**Attaches to.** The extract step in `POST /api/captures/:id/process`. Today the route does not read the blob. Optional JSON `{ "text" }` is the label. With no text, the extractor returns a fixed sample. Status still walks `uploaded → extracted → parsed` in the web request. [capture/process.md](../capture/process.md).

**Keeps.** The paste path. The status machine. `blob_name` as the image identity. No new tables.

Cloud can ship while this add-on is still the stub. Matching and favorites already work from pasted text.

**Choice: how the first real read runs.**

| Option | What it adds | Cost |
|---|---|---|
| A. Leave the stub | Nothing. The stored photo is unused until someone pastes text. | “Upload a label” does not yet mean “read a label.” |
| B. One server function. Recommended. | `extractText(bytes, contentType) → string` inside the existing extract step. Pasted `text` still wins when the client sends it. The blob is read only when `text` is absent. | A large photo can time out the request. The engine is a secret and a per-image cost. |
| C. A worker job | Upload or process enqueues a job. The worker writes `raw_text`. | The worker cannot import `packages/domain` ([ADR-0009](../../adr/0009-domain-web-only.md)) unless that ADR is superseded. More machinery before we know the request is too slow. |

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
| C. An admin UI | Signed-in editors write rows in the app. | A new role, audit, and a privacy story [auth.md](../auth.md) already postponed. Out of cloud. |

**Sources.** Public INCI or regulatory lists may be imported into option A where the license allows redistribution. The import copies rows into our tables. The running app does not call that source.

**Coverage.** “Not a toy” means a normal shampoo or packaged-food label matches most lines, on the order of a few hundred common names, not a full dictionary. Unknown tokens stay `unknown`. The exact list is chosen in the catalog pull requests.

A row needs a display name, at least one alias, and a profile blurb before it is seeded. Evidence and jurisdiction rows are added when we are willing to show them.

**Recommendation.** A. Use B only as a generator that commits catalog files. Do not build C in this phase.
