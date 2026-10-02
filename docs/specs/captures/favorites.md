---
type: feature
---
# A user favorites their own capture

## Why
A person keeps a capture they want to come back to. Favoriting pins that capture. Unfavoriting removes the pin. The capture and its lines stay.

## Where it lives
- `packages/domain/src/favorites.ts` — Zod params, `FavoriteView`, and the queries. Web-only, per [ADR-0009](../../adr/0009-domain-web-only.md).
- `POST /api/captures/:id/favorite` and `DELETE /api/captures/:id/favorite` — `apps/web/app/api/captures/[id]/favorite/route.ts`
- `GET /api/favorites` — `apps/web/app/api/favorites/route.ts`

`:id` is `Capture.id`. Favorite has no id column.

## Behavior
Identity comes from `currentUserId()` ([ADR-0003](../../adr/0003-dev-identity-stub.md)). The client sends no body and no user id. The server sets `Favorite.userId` from that identity and `Favorite.captureId` from `:id`.

Every query is scoped by that user id. A missing `User` row is 401 `{ error: { code: "unauthorized", message: "User not found" } }`.

`POST /api/captures/:id/favorite` returns 201 and one `FavoriteView` when the capture belongs to the caller. Capture status is not checked. Zero `CaptureItem` rows is valid and returns `items: []`. A capture owned by someone else and a capture that does not exist both return 404 `{ error: { code: "not_found", message: "Capture not found" } }` before any insert. A second favorite for the same pair returns 409 `{ error: { code: "conflict", message: "Favorite already exists" } }`. At most one row exists per `(userId, captureId)`.

`DELETE /api/captures/:id/favorite` returns 204 and an empty body. It deletes that user's Favorite row only. Capture, CaptureItem, and blob bytes stay. A missing favorite, a missing capture, and another user's favorite all return 404 `{ error: { code: "not_found", message: "Favorite not found" } }`. The handler does not look up the capture.

`GET /api/favorites` returns 200 and `FavoriteView[]` for the caller, ordered by `Capture.createdAt` descending, then `captureId` ascending. Each object includes that capture's items ordered by `sortOrder` ascending. An empty list is `[]`. The list does not join Ingredient, IngredientFlag, UserPreference, or PreferenceFlag.

`FavoriteView` is:

```json
{
  "userId": "string",
  "captureId": "string",
  "capture": {
    "id": "string",
    "source": "camera | extension",
    "status": "uploaded | extracted | parsed | failed",
    "blobName": "string | null",
    "rawText": "string | null",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "items": [
      {
        "sortOrder": 0,
        "rawToken": "string",
        "ingredientId": "string | null",
        "matchStatus": "matched | unknown | ambiguous"
      }
    ]
  }
}
```

This slice never returns 403. Any error that is not a `FavoriteError`, including a `:id` that fails `favoriteParamsSchema`, is 500 `{ error: { code: "internal", message: "Internal error" } }`. The client never receives a stack, a raw error message, or a Prisma object on that branch.

There is no cached page. These handlers do not call `revalidatePath`.

## Examples

| State / input | Behavior |
|---|---|
| Caller owns capture `cap-1` (`uploaded`, no items). `POST /api/captures/cap-1/favorite`. | 201. One Favorite row. `userId` is the caller, `captureId` is `cap-1`, `capture.items` is `[]`. |
| That pair is already favorited. `POST` again. | 409 `conflict`. Still one Favorite row. |
| Capture `cap-b` belongs to someone else, or the id does not exist. `POST`. | 404 `not_found`, message `Capture not found`. Status is never 403. No Favorite row is written. |
| `currentUserId()` names a user row that does not exist. `POST`. | 401 `unauthorized`. |
| Capture has items at `sortOrder` 1 (`rawToken` `s`) and 0 (`rawToken` `0`). `POST`. | 201. `items` is ordered 0 then 1. |
| Caller has a favorite. `DELETE /api/captures/:id/favorite`. | 204, empty body. Favorite row is gone. Capture and CaptureItems remain. |
| `DELETE` again, or `DELETE` of another user's capture id. | 404 `not_found`, message `Favorite not found`. The other user's rows stay. |
| Caller has two favorites; someone else has one. `GET /api/favorites`. | 200, length 2, only the caller's capture ids, `Capture.createdAt` descending. Each object includes its items. No ingredient or flag fields. |

## Verify
- `pnpm test:integration` — `tests/integration/favorites.test.ts` exercises the cases above on in-memory PGlite.
- `pnpm --filter @project/domain typecheck`
- `pnpm --filter @project/web typecheck`

No curl drill: these routes are confirmed by calling the handlers in the integration suite. A favorites page does not exist yet.

## Constraints & decisions
- A Favorite row is only `(userId, captureId)`. It points at a Capture that same user owns. The schema enforces that with `Capture @@unique([id, userId])` and the Favorite relation on `[captureId, userId]`. See [data-model.md](../data-model.md).
- Create and delete do not insert, update, or delete Capture, CaptureItem, or blob bytes. Unfavorite deletes the Favorite row only.
- The ownership read on create happens before insert, so a foreign capture and a missing capture share one 404 body. Delete does not look up the capture, so every miss shares `Favorite not found` and does not reveal whether the capture exists.
- Duplicate create is 409 because the primary key rejects the second row (`P2002`). The list orders by when the capture was created. Favorite has no timestamp of its own.
- Validation and queries live in `packages/domain`. Routes derive identity, validate `:id`, call the domain, and map errors ([web.md](../web.md), [ADR-0009](../../adr/0009-domain-web-only.md)).
- A schema failure on `:id` is 500 `internal` on this slice. The handlers map `FavoriteError` and send every other throw to that body.

## Out of scope
- Creating or reading captures. Those routes do not exist yet.
- A favorites page. The POC journey in [development-phases.md](../development-phases.md) still expects `Favorite → Capture → CaptureItem` on a page; this spec is the API only.
- OCR, alias matching, and preference flags. Those are later POC steps in [development-phases.md](../development-phases.md).
- Extension save that materializes a Capture before inserting Favorite. That is stretch behavior in [data-model.md](../data-model.md).
