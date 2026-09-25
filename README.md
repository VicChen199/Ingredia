# Ingredia

Ingredia translates confusing chemical nomenclature, fine print, and marketing spin into plain language. From grocery shelves to online checkouts, it breaks down formulations across food, skincare, cosmetics, and household products so you can see what you are buying.

Most ingredient lists are written for chemists and regulators. Scientific names, nested ingredients, and front-of-package claims make it hard to check allergens, dietary preferences, or safety while shopping.

**Live:** not deployed yet

## What it does

The product, as features land. Each line links its spec once that spec exists under `docs/specs/`.

- **Label scanner.** A photo of a bottle, wrapper, or tube is parsed into plain-English names (Tocopherol → Vitamin E) with badges for allergens, irritants, pore-clogging agents, and dietary flags.
- **Ingredient encyclopedia.** Fuzzy and synonym search across common names, formulations, and IUPAC names, plus origin, why it is used, regulatory status, and evidence-based context.
- **Browser extension.** Ingredient tables on major retailers are detected and annotated in place, with context that changes by category (comedogenic ingredients on beauty sites, additives on grocery sites).

### How it works

1. **Capture or browse.** Snap a label in store, or open a product page with the extension.
2. **Translate.** Ingredia parses the text against a centralized ingredient knowledge base.
3. **Decide.** Read the plain-language summary, check flags against your preferences, and buy with that in view.

### Who it's for

- **Allergy and sensitivity.** Hidden fragrance allergens, gluten derivatives, sulfates.
- **Sourcing claims.** Vegan, cruelty-free, and sustainability claims you can check.
- **Everyday shopping.** A read of the label without a separate search in the aisle.

## Run it locally

No Docker, no cloud account — everything runs from npm.

```bash
pnpm install
pnpm prisma:generate     # typed DB client
pnpm dev                 # web + worker + your own Postgres + Azurite
pnpm db:seed             # demo data (with dev running)
```

Check it worked: `http://localhost:3000/api/health` → `{"status":"ok","db":"ok"}`.
All commands: see `package.json` scripts, or [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
pre-push set (`pnpm test && pnpm typecheck && pnpm build`).

## How it's built

The web app is the UI and API. The worker polls a queue and processes jobs. Postgres holds application data; local Azurite stands in for blob and queue storage until an env var points the same code at Azure. Every cloud dependency is a seam: local stand-in by default, real Azure when configured. See [`docs/specs/seams.md`](docs/specs/seams.md).

The deeper story lives in the docs, organized by the question you're asking —
decisions in [`docs/adr/`](docs/adr/), behavior in [`docs/specs/`](docs/specs/),
history in [`docs/postmortems/`](docs/postmortems/), procedures in
[`docs/runbooks/`](docs/runbooks/). Start at [`docs/README.md`](docs/README.md).

```
apps/                           # deployable processes
├── web/                        #   Next.js app (the UI)
├── worker/                     #   background worker
├── db-server/                  #   dev-only Postgres host
└── migrate/                    #   migration CLI + seed script

packages/                       # shared libraries
├── db/                         #   Prisma schema + client + apply-migrations
├── services/                   #   Azure adapters (queue, storage, notify)
├── domain/                     #   Zod schemas + queries (web-only)
├── log/                        #   pino logger
└── auth/                       #   dev identity stub
```

Apps are deployable. Packages are shared — no app imports from another app.
Every package has a README explaining its role.

## Team

- Names and GitHub handles go here.

## Contributing

Workflow, ground rules, and the documentation system: [`CONTRIBUTING.md`](CONTRIBUTING.md).
Agent conventions (any harness): [`AGENTS.md`](AGENTS.md).

---

<sub>Built on the CTP C12 full-stack starter — Next.js · Prisma · Postgres · Azure.</sub>
