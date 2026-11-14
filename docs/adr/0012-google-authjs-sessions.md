# ADR-0012: Google Auth.js database sessions

## Status

Accepted

## Context

ADR-0003 identified the current user with a development stub: an `x-user-id` header, then `DEV_USER_ID`, then a seeded `demo-user`, with a production throw unless `ALLOW_DEV_IDENTITY` was set. That stub is gone. Sign-in is Google, locally and in production, and the session is a database row.

## Decision

`currentUserId()` reads the Auth.js database session and returns `User.id`. Google is the only provider. `session.strategy` is `database`. The adapter is `PrismaAdapter`. The client supplies no user id. This supersedes ADR-0003.

- A missing, unknown, or expired session makes `auth()` return null and `currentUserId()` throw.
- The first Google sign-in creates `User` and `Account` when that email is free. The same `(provider, providerAccountId)` returns the same user. The same email does not attach a Google account to an existing user. `allowDangerousEmailAccountLinking` stays unset.
- Unlink deletes the Google `Account` only. `User`, `Session`, captures, and favorites stay.
- There is no password column and no `google_id` on `User`. `VerificationToken` exists for the adapter schema. Google sign-in does not write it.
- The cookie gate in `apps/web/middleware.ts` checks cookie presence only. Handlers still call `currentUserId()`.

Runner-up: keep the stub for local requests and swap to Google only in production. Rejected. Two identity paths hide which user a request acts as.

## Consequences

- **Easier**: local and production use the same sign-in. A user id cannot be chosen by a request header.
- **Harder**: local sign-in needs `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET`. There is no seeded user to call the API as.
- **Accepted tradeoff**: `packages/auth` stays the Next.js session lookup. The worker still has no user context in jobs.

## See also

- [ADR-0003](0003-dev-identity-stub.md) — the stub this decision replaces.
- `docs/specs/auth.md` — the identity contract.
- `docs/specs/identity/google-authjs-sessions.md` — route traces and table fields.
