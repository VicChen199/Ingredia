# @project/web — the Next.js app

The user-facing web application. A Next.js server-rendered React app.

Signed-out `/` links to `/login`. Signed-in `/` shows the preferences panel, Sign out, and Unlink Google, plus the starter welcome paragraph. Identity is the Google Auth.js session in [`docs/specs/auth.md`](../../docs/specs/auth.md).

## Public surface

A session cookie is not required for `/`, `/login`, `/api/health`, or `/api/auth/*`. Every other page without that cookie redirects to `/login`. Every other API without that cookie returns 401. A cookie is not proof: handlers still call `currentUserId()`.

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Signed-out sign-in link, or signed-in preferences, Sign out, and Unlink Google |
| `/login` | GET | Sign in with Google. Redirects to `/` when a session exists |
| `/api/health` | GET | Health check — is the process alive? Can it reach the DB? |
| `/api/auth/*` | GET, POST | Auth.js handlers, including the Google callback |
| `/api/account/google` | DELETE | Unlink the signed-in user's Google account |
| `/api/capture` | POST | Store a label image and a Capture row |
| `/api/captures` | GET | List the signed-in user's captures |
| `/api/captures/:id` | GET | One capture the signed-in user owns |
| `/api/captures/:id/process` | POST | Turn label text into matched ingredient lines |
| `/api/captures/:id/favorite` | POST, DELETE | Favorite or unfavorite a capture the same user owns |
| `/api/favorites` | GET | The signed-in user's favorites |
| `/api/preferences` | GET | The signed-in user's flags and the flag catalog |
| `/api/preferences/:flagId` | PUT, DELETE | Enable or disable a known flag |

## Dependencies

- `@project/db` — the Prisma client and generated types
- `@project/services` — queue, storage, and notify adapters
- `@project/domain` — Zod schemas and database queries
- `@project/auth` — `currentUserId()` reads the Google session
- `@project/log` — pino logger

## Consumers

Users with a browser. No other app or package imports from `@project/web`.

## Local dev

```bash
pnpm dev:web     # starts the Next.js dev server
```

The dev server expects a Postgres server and Azurite running alongside it.
Start everything together with `pnpm dev` from the repo root. The dev server
uses Turbopack (`--turbopack`). Google sign-in needs the names in
[`docs/specs/environment.md`](../../docs/specs/environment.md).

## When it changes

- A new route goes in `app/api/`.
- A new Client Component goes in `components/`.
- Routes are Server Components. Forms and interactivity are Client Components.
