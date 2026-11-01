# Feature: google-authjs-sessions

Source contract: `docs/specs/identity/google-authjs-sessions.md`

Architecture patched: no

## Slice: migration
status: done
goal: Add the Auth.js adapter tables. `User` gains `accounts` and `sessions` only.
owns: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0002_auth.sql`
routes: []
acceptance: `Account`, `Session`, and `VerificationToken` match the data model. `Account.userId` and `Session.userId` reference `User` with `onDelete: Cascade`. `Account` is unique on `(provider, providerAccountId)`. `Session.sessionToken` is unique. `VerificationToken` is unique on `(identifier, token)` and has no user foreign key. CamelCase fields use `@map` to snake columns. Token fields keep snake_case Prisma names (`refresh_token`, `access_token`, `expires_at`, `token_type`, `scope`, `id_token`, `session_state`). No `password`. No `google_id`. `0001_init.sql` stays as it is.
done_when: `0002_auth.sql` applies after `0001_init.sql`. A second `Account` with the same `(provider, providerAccountId)` fails the unique constraint. A different `providerAccountId` is allowed. `pnpm test` still passes.
tables: Account, Session, VerificationToken
migration: `packages/db/prisma/migrations/0002_auth.sql` adds `Account`, `Session`, and `VerificationToken`. `User` relations only.
existing_tests: `tests/integration/capture.test.ts`, `tests/integration/capture-read.test.ts`, `tests/integration/process.test.ts`, `tests/integration/favorites.test.ts`, `tests/integration/preferences.test.ts`, `tests/integration/smoke.test.ts`

## Slice: read-session
status: done
goal: `read-session` and `current-user-id`, with the Auth.js module mounted at `/api/auth/[...nextauth]`.
owns: `packages/auth`, `apps/web/app/api/auth/[...nextauth]/route.ts`, `.env.example`
routes: read-session, current-user-id
acceptance: `auth()` returns `{ user: { id, name, email, image } }` or null. A missing, unknown, or expired session returns null and does not throw. `currentUserId()` returns `session.user.id` after the session callback copies `User.id` onto the session, and throws when the session is missing, unknown, or expired. `x-user-id`, `DEV_USER_ID`, and `ALLOW_DEV_IDENTITY` are gone. `session.strategy` is `database`. The adapter is `PrismaAdapter` on the client from `@project/db`. `apps/web/app/api/auth/[...nextauth]/route.ts` re-exports `handlers`. `AUTH_SECRET` signs `authjs.session-token` and `__Secure-authjs.session-token`. Localhost does not require `AUTH_URL`. New dependencies, both on `@project/auth`: `next-auth` 5 and `@auth/prisma-adapter`. Add `@prisma/client` 6.19.3 on that package only if pnpm's peer check requires it. `.env.example` names `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET` only, and drops the `DEV_USER_ID` line. Do not edit `.env`. This slice does not add the Google provider, `/login`, middleware, sign-out, unlink, or the landing controls. `/` still calls `currentUserId()` until the landing slice.
done_when: A `Session` row and its cookie make `auth()` and `currentUserId()` return that `User.id`. No session makes `auth()` null and `currentUserId()` throw. The header and `DEV_USER_ID` do not choose the user. `pnpm test`, `pnpm typecheck`, and `pnpm build` pass without a Google round-trip.
tables: Session, User
migration: none
existing_tests: `tests/integration/capture.test.ts`, `tests/integration/capture-read.test.ts`, `tests/integration/process.test.ts`, `tests/integration/favorites.test.ts`, `tests/integration/preferences.test.ts`, `tests/integration/smoke.test.ts`

## Slice: google-sign-in
status: done
goal: `start-google-sign-in` and `complete-google-sign-in` on `/login`.
owns: `packages/auth`, `apps/web/app/login/page.tsx`
routes: start-google-sign-in, complete-google-sign-in
acceptance: One provider, Google, with `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Scopes stay `openid`, `email`, and `profile`. `allowDangerousEmailAccountLinking` stays unset. `pages.signIn` and `pages.error` are both `/login`. The button calls `signIn("google")` with no second argument and writes no `User`, `Account`, or `Session`. `GET /api/auth/callback/google?code&state` exchanges the code, then finds `Account` by `provider = "google"` and `providerAccountId`. A new pair with a free email inserts `User` (`name`, `email`, `image`) and `Account` (`type` `oauth`, `provider` `google`, `providerAccountId`, plus the adapter token fields), then inserts `Session` and sets the cookie. The same pair loads that user. An email that already belongs to a `User`, with no `Account` for this pair, writes nothing. Success is `302` to `/login`. Failure is `302` to `/login?error=...` with no rows and no cookie. `/login` with a session redirects to `/`. A rejected start or callback shows `Sign-in failed` and the button remains. Two Google accounts with different emails are two users.
done_when: Those outcomes hold in `pnpm test` without a live Google round-trip. The two-account browser check stays manual after `pnpm dev`.
tables: Account, User, Session
migration: none
existing_tests: `tests/integration/capture.test.ts`, `tests/integration/capture-read.test.ts`, `tests/integration/process.test.ts`, `tests/integration/favorites.test.ts`, `tests/integration/preferences.test.ts`, `tests/integration/smoke.test.ts`

## Slice: guard-request
status: done
goal: `guard-request` checks the session cookie and does not open Postgres.
owns: `apps/web/middleware.ts`
routes: guard-request
acceptance: The middleware reads `authjs.session-token` or `__Secure-authjs.session-token`. It does not import `@project/auth` or Prisma. It skips `/`, `/login`, `/api/health`, `/api/auth/*`, `/_next`, static files, and favicon. A missing cookie on any other page redirects `307` to `/login`. A missing cookie on any other API returns `401` `{ error: { code: "unauthorized", message: "A signed-in user is required" } }`. A present cookie continues. The Node handler still runs `current-user-id`. A stale cookie still reaches that handler.
done_when: A cookie-less `/api/health` is unchanged. A cookie-less gated API returns that 401. A cookie-less gated page redirects to `/login`. A present cookie continues.
tables: none
migration: none
existing_tests: `tests/integration/capture.test.ts`, `tests/integration/capture-read.test.ts`, `tests/integration/process.test.ts`, `tests/integration/favorites.test.ts`, `tests/integration/preferences.test.ts`, `tests/integration/smoke.test.ts`

## Slice: sign-out-and-unlink
status: done
goal: `sign-out`, `unlink-google`, the landing states, and removal of the `demo-user` seed.
owns: `apps/web/app/page.tsx`, `apps/web/app/unlink-google-button.tsx`, `apps/web/app/api/account/google/route.ts`, `packages/auth`, `apps/migrate/src/seed.ts`, `tests/integration/auth-account.test.ts`, `docs/specs/auth.md`, `docs/specs/phases/cloud-phase.md`, `docs/specs/seams.md`, `packages/auth/README.md`, `docs/specs/README.md`, `docs/specs/monorepo.md`, `docs/README.md`, `README.md`, `apps/web/README.md`, `docs/specs/web.md`, `docs/specs/capture/upload.md`, `docs/specs/capture/read.md`
routes: sign-out, unlink-google
acceptance: Signed-out `/` runs `read-session`, shows a link to `/login`, and does not call `currentUserId()`. Signed-in `/` shows the existing preferences panel, Sign out, and Unlink Google. Sign out calls `signOut()`, deletes this `Session`, clears the cookie, leaves `User`, `Account`, captures, and favorites, and redirects to `/`. Unlink is `DELETE /api/account/google` with no body. It calls `currentUserId()`, then `unlinkGoogleAccount(userId)`, which runs `account.deleteMany({ where: { userId, provider: "google" } })` and does not touch `User`, `Session`, `Capture`, or `Favorite`. `204` empty when a row was deleted. `404` `{ error: { code: "not_found", message: "Google account not linked" } }` when none. `401` `{ error: { code: "unauthorized", message: "A signed-in user is required" } }` when `currentUserId()` throws. `204` and `404` stay on signed-in `/`. `204` shows Google unlinked. `404` shows the not-linked message. The seed deletes the `demo-user` upsert only. Catalog rows stay. `tests/integration/auth-account.test.ts` mocks `currentUserId` the same way as the capture tests. It shows unlink leaving `User`, `Capture`, and `Favorite`, the unique `(provider, providerAccountId)` failure, and a different `providerAccountId` as a different user. Rewrite `docs/specs/auth.md`. In `docs/specs/phases/cloud-phase.md`, remove only the sentence that `auth.md` still says GitHub. Update the other owned docs so identity is the Google session. Do not edit `docs/adr/0003-dev-identity-stub.md`, `docs/specs/phases/development-phases.md`, `docs/specs/phases/data-model.md`, or `docs/specs/capture/favorites.md`. Do not change capture, favorite, preference, or health handlers.
done_when: The landing, sign-out, and unlink outcomes above hold. Existing tests still mock `@project/auth`. `pnpm test`, `pnpm typecheck`, and `pnpm build` pass without a Google round-trip.
tables: Session, Account, User
migration: none
existing_tests: `tests/integration/capture.test.ts`, `tests/integration/capture-read.test.ts`, `tests/integration/process.test.ts`, `tests/integration/favorites.test.ts`, `tests/integration/preferences.test.ts`, `tests/integration/smoke.test.ts`
