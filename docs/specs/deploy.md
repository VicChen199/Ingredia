---
type: infrastructure
---
# Deploy — merges to main ship themselves

Shipping is a merge, not a ritual performed by someone who remembers the steps.

## Purpose

Check the application in CI and publish one versioned web image separately.
Production migrations and rollout are separate from image publishing.

## Behavior

- `.github/workflows/ci.yml` installs dependencies, generates Prisma, checks
  types, runs tests, and builds the app on pull requests and pushes to main.
  It does not build Docker images, start Compose stacks, or run shell-script
  tests. Contributors do not need Docker for normal development.
- `.github/workflows/deploy.yml` builds the web app's production image and
  pushes to GHCR on pushes to main or manual dispatch. It runs independently
  of CI; publishing does not wait for CI or depend on its result. Pull requests
  only run CI and never publish images or run production migrations.
- The publishing workflow builds the triggering commit and publishes
  `ghcr.io/<lowercase-owner>/<lowercase-repo>/web:<commit-sha>` with
  `GITHUB_TOKEN`, using Buildx and GitHub Actions build caching.
- Publishing runs serially with `cancel-in-progress: false`.
- Azure login, migration-job checks, production migrations, Azure variables,
  and the OIDC permission remain commented out. Publishing requires no Azure
  account, credentials, or resources. The migration script remains available
  for the later deployment work.
- The web container starts the server without applying migrations.
- Secrets are supplied at runtime; `.env.example` documents every variable.
  Container health checks point at `/api/health`.
- `PG_POOL_MAX=1` against the shared class Postgres — connection etiquette.

## Image contract

- `apps/web/Dockerfile` uses the repository root as its build context and
  shares `node:24-bookworm-slim` plus OpenSSL between build and runtime stages.
- The build stage uses the pnpm version pinned by `package.json`, fetches
  dependencies from the lockfile before copying source, installs with
  `--frozen-lockfile --offline`, generates Prisma, and builds `apps/web`.
- The runtime copies the build workspace to the same `/app` path, including
  the generated Prisma client, migration runner, SQL migrations, and dependencies.
  It runs as `node`, serves on `0.0.0.0:3000`, disables Next telemetry, and
  starts Next directly from `/app/apps/web`.
- `.dockerignore` excludes local dependencies, build output, generated Prisma
  files, Git metadata, local database and storage state, and environment files.
- Compose build definitions reference this same Dockerfile with root context.

## Compose on one machine

- `compose.yaml` is the complete local stack: web, Postgres, Azurite, and a
  one-shot migration service. `docker compose up --build -d --wait` builds
  the web/migration image and starts it without Azure resources.
- `compose.prod.yaml` is a separate, complete VPS configuration with web,
  Postgres, and migrations. It pulls the required `APP_IMAGE` commit tag for
  both app processes and uses real Azure storage. Neither file uses profiles,
  includes, anchors, or an override file.
- Migrations wait for Postgres health; web waits for successful migration
  completion, and locally for Azurite health. A failed migration prevents a
  new web container from starting. Starting or restarting web alone does not
  apply migrations.
- Both files keep Postgres private to the Docker network and use a named
  database volume. Local Azurite also uses a named volume. `down` preserves
  these volumes; `down --volumes` removes their data.
- Local Postgres credentials and the public Azurite emulator key are local
  defaults only. Production requires the image, database password, auth
  credentials, HTTPS origin, and storage connection string. See
  [Environment](environment.md).
- Web binds to loopback port 3000 by default. A VPS reverse proxy supplies
  public HTTPS and forwards the original host/protocol. Proxy provisioning,
  automated server updates, worker/OCR services, and managed database setup
  are separate work. No worker is needed for the current capture API flow.
- Operations follow [run-compose](../runbooks/run-compose.md). VPS updates
  are manual and can interrupt service; Compose does not provide a blue/green
  rollout or automatic application rollback.

## Boundaries

The GitHub pipeline ends after testing and publishing the image. It does not
connect to a server or run production migrations. Starting production Compose
on a VPS runs migrations and starts web on that machine. Automated rollout,
traffic switching, and Azure Container Apps deployment remain deferred.
Google sign-in and the storage and worker behavior keep their own contracts.

## Error states

| Failure | What happens |
|---|---|
| web cannot reach its database | health returns 503 and Compose reports it unhealthy |
| application checks fail | CI fails; the independent publishing workflow is unaffected |
| image build or publish fails | publishing workflow fails; production database and web app are unchanged |
| Compose migration fails | new web container is blocked; database changes are not automatically reverted |
| production Compose variables are missing | configuration fails before starting services |

## Constraints & decisions

- GHCR, not ACR — free for public repos.
- Package visibility is configured separately in GitHub; publishing does not
  automatically make the image public or configure a deployment host.
- Migrations are append-only and expand-only during release: old code must
  continue working against the new schema if rollout fails or is deferred.
- The runtime retains the full build workspace to keep the web server and
  migration runner in one image; dependency pruning is outside this contract.
- The image uses pnpm without hardcoding the workspace package scope. No new
  application dependencies are required.
- CI and publishing are independent workflows; merge protection is configured
  separately in GitHub.
- The deferred Azure migration-job procedure is recorded in
  [provision-migration-job](../runbooks/provision-migration-job.md).
- Postgres uses a pinned major version; a major upgrade requires a separate
  data migration. Container restarts and named volumes do not replace backups.

## Verify

- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- Confirm CI has only the application checks job, with no Docker build,
  Compose startup, shell-script tests, or call to the publishing workflow.
- Confirm publishing has push-to-main and manual triggers, uses the root-context
  Dockerfile, and tags GHCR images with the triggering commit SHA. Azure steps
  remain commented out and no Azure variables are required for publishing.
- Drill local or VPS container startup, migrations, storage, and persistence
  manually using [run-compose](../runbooks/run-compose.md).

## Key ADRs

- [ADR-0004](../adr/0004-prisma-orm.md) — Prisma and the database boundary.
