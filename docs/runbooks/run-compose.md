# The local or VPS Compose stack needs to start or update

**Use when:** starting the containerized app locally or deploying a tested image
on a single VPS.
**Last drilled:** local Docker with disposable volumes; live VPS and Google OAuth are not drilled.

## Before you start

- Install Docker with Compose v2 or later.
- Obtain the three existing auth credentials from the maintainer. Supply them
  through the shell or an untracked `.env`; never put them in the image or Git.
- For a VPS, have a tested GHCR commit tag, an Azure Storage connection string,
  a public HTTPS origin, and a trusted reverse proxy forwarding to loopback
  port 3000. Register `<origin>/api/auth/callback/google` with Google.
- Blast radius: startup applies pending SQL migrations to the selected Docker
  database volume. Updating production can interrupt the running app.

## Steps

1. For local use, set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`,
   then run:
   ```bash
   docker compose up --build -d --wait
   ```
   Open `http://localhost:3000`. Set `WEB_PORT` if port 3000 is already in use;
   register the matching localhost Google redirect URI for sign-in.
2. For a VPS, copy `compose.prod.yaml` and set `APP_IMAGE`, `POSTGRES_PASSWORD`,
   `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`, and
   `AZURE_STORAGE_CONNECTION_STRING`. Use a strong random hex database password
   so it is safe in the internal connection URL. Run:
   ```bash
   docker compose -f compose.prod.yaml pull
   docker compose -f compose.prod.yaml up -d --wait
   ```
   If the package is private, authenticate Docker to GHCR with read access.
   No source checkout or image build is needed on the VPS.
3. Inspect startup and migration status:
   ```bash
   docker compose ps -a
   docker compose logs migrate web
   ```
   Add `-f compose.prod.yaml` after `docker compose` for production commands.
4. Before updating the VPS, back up Postgres and confirm the new migration is
   compatible with the running app. Change `APP_IMAGE` to the new tested commit
   tag, then repeat the production pull/up commands; web and migrate use that
   same version. A completed migration is not undone by reverting the image.
5. Stop locally with `docker compose down`, or on the VPS with
   `docker compose -f compose.prod.yaml down`. These commands preserve volumes.
   **Destructive:** adding `--volumes` deletes that stack's persisted database
   and, locally, uploaded files. Do not use it for a normal restart or update.

## Verify it worked

1. Check `http://localhost:3000/api/health` locally or `<AUTH_URL>/api/health`
   on the VPS. Expect HTTP 200 and `db: "ok"`.
2. Confirm `migrate` exited with code 0 and web/db are healthy. Local Azurite
   must also be healthy.
3. Sign in with Google, upload an image, recreate the containers with down/up,
   and confirm the capture and uploaded file remain. Do not remove volumes.

## If this didn't work

1. Inspect `docker compose logs db migrate web` (and `azurite` locally). Fix a
   failed migration before trying to start web; do not edit applied SQL files.
2. For local uploads, verify Azurite is healthy. The connection uses Docker
   service names, not host loopback addresses.
3. For VPS uploads, check the Azure storage connection and network access.
   For sign-in, check the public HTTPS origin, proxy headers, and Google callback.
4. If an existing database rejects a new password, restore the configured
   password or rotate it in Postgres. Changing `.env` alone does not rotate it.

## Related

- [Deploy contract](../specs/deploy.md)
- [Environment variables](../specs/environment.md)
