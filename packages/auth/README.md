# @project/auth — identity / auth

Who the current user is. Auth.js database sessions with Google, shared by the
web app. `currentUserId()` is the session lookup.

## Public API

All exports come from `src/index.ts`:

| Export | What it does |
|---|---|
| `auth()` | Reads the database session. Returns `{ user: { id, name, email, image } }` or null. |
| `currentUserId()` | Calls `auth()` and returns `session.user.id`. Throws when the session is missing, unknown, or expired. |
| `signIn` | Starts Google sign-in. |
| `signOut` | Deletes this `Session`, clears the cookie, and redirects. |
| `unlinkGoogleAccount(userId)` | Deletes `Account` rows for that user where `provider` is `"google"`, and reports whether a row was deleted. |
| `handlers` | Auth.js `GET` and `POST` handlers for `/api/auth/*`. |

## Dependencies

- `next-auth` and `@auth/prisma-adapter` — database sessions and the Google provider
- `@project/db` — the Prisma client the adapter and unlink use
- `next` — server entry for the Auth.js route handlers

## Consumers

- `apps/web` — via `@project/auth`

## Session lookup

```ts
currentUserId()
  1. auth() reads the session cookie and the Session row
  2. the session callback has copied User.id onto that session
  3. return session.user.id
```

A missing session throws `A signed-in user is required`. The same Google
session is the identity locally and in production.
