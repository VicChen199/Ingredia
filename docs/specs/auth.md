---
type: infrastructure
---
# Identity — the auth subsystem

Who the current user is. Every server entry learns it from the Auth.js database session.

## Purpose

The Google session is the only identity. `currentUserId()` reads that session and returns `User.id`. The client supplies no user id. `x-user-id` and `ALLOW_DEV_IDENTITY` are gone. Local development and production sign in the same way.

## Where it lives

- `packages/auth` — Auth.js config, `auth()`, `signIn`, `signOut`, `currentUserId()`, and `unlinkGoogleAccount()`.
- `apps/web/app/api/auth/[...nextauth]/route.ts` — Auth.js HTTP handlers.
- `apps/web/app/login/page.tsx` — Google sign-in.
- `apps/web/app/api/account/google/route.ts` — unlink.
- `apps/web/middleware.ts` — cookie presence gate. A cookie is presence, not proof. Handlers still call `currentUserId()`.

## The contract

- Auth.js database sessions. Google is the only provider. `session.strategy` is `database`. The adapter is `PrismaAdapter`. The session callback copies `User.id` onto the session.
- `auth()` returns `{ user: { id, name, email, image } }` or null. A missing, unknown, or expired session returns null.
- `currentUserId()` calls `auth()` and returns `session.user.id`. A missing session throws.
- `signOut()` deletes the `Session` row for this cookie, clears the cookie, and redirects to `/`. `User`, `Account`, captures, and favorites stay.
- Public routes are `/`, `/login`, `/api/health`, and `/api/auth/*`. Any other page without a session cookie redirects to `/login`. Any other API call without a session cookie returns `401` `{ error: { code: "unauthorized", message: "A signed-in user is required" } }`.
- `allowDangerousEmailAccountLinking` stays unset. The same email never attaches a Google account to an existing user.

## First sign-in

Google sends the browser to `GET /api/auth/callback/google`. Auth.js exchanges the code and looks up `Account` by `provider = "google"` and `providerAccountId`.

When that pair exists, the session belongs to its `User`. When it does not, and no `User` already has this email, Auth.js inserts `User` (`name`, `email`, `image` from the profile) and `Account` (`type` `oauth`, `provider` `google`, `providerAccountId`, plus the adapter token fields), then inserts `Session` and sets the session cookie. When the email already belongs to a `User` and this Google pair has no `Account`, Auth.js writes nothing.

Success redirects to `/login`. That page sees the session and redirects to `/`. Failure redirects to `/login?error=...`, writes no rows, sets no cookie, and `/login` shows `Sign-in failed`. Two Google accounts with different emails become two users. The same pair always returns the same user.

## Unlink

`DELETE /api/account/google` sends no body. The handler calls `currentUserId()`, then `unlinkGoogleAccount(userId)`, which runs `account.deleteMany({ where: { userId, provider: "google" } })`. The delete leaves `User`, `Session`, `Capture`, and `Favorite` in place.

- `204` with an empty body when a row was deleted.
- `404` `{ error: { code: "not_found", message: "Google account not linked" } }` when none.
- `401` `{ error: { code: "unauthorized", message: "A signed-in user is required" } }` when `currentUserId()` throws.

The path sits outside `/api/auth`, so the cookie gate applies. `204` and `404` stay on signed-in `/`. `204` shows Google unlinked. `404` shows the not-linked message. The session still loads this user.

A later sign-in with the same Google account does not find this user. The pair is gone, email does not merge, and the old email remains on this `User`, so the callback writes nothing and `/login` shows `Sign-in failed`.

## Home

Signed-out `/` runs `auth()` and shows a link to `/login`. It does not call `currentUserId()`. Signed-in `/` shows the preferences panel, Sign out, and Unlink Google.

## Verify

- Two-account localhost drill: sign in with two Google accounts. Each account sees only its own captures and favorites.
- Unlink drill: on signed-in `/`, choose Unlink Google. The page stays signed in and shows Google unlinked. The `User`, the `Session`, captures, and favorites remain. Sign out, then sign in again with that Google account. `/login` shows `Sign-in failed`.
- Cookie-less:

  ```bash
  curl -i http://localhost:3000/api/captures
  curl -i http://localhost:3000/api/health
  ```

  `/api/captures` returns 401. `/api/health` returns 200.

## Key ADRs

- [ADR-0012](../adr/0012-google-authjs-sessions.md) — Google Auth.js database sessions. Supersedes [ADR-0003](../adr/0003-dev-identity-stub.md).
