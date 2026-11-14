---
type: feature
---
# A user lists and inspects their own captures

## Why
A person revisits scanned labels, reads plain-language ingredient profiles, and sees which ingredient flags match their current preferences.

## Where it lives
- `packages/domain/src/capture-read.ts`: validation, queries, response types, and errors.
- `GET /api/captures` and `GET /api/captures/:id`: Next.js route handlers.
- `tests/integration/capture-read.test.ts`: handler integration tests using PGlite.

## Behavior
Identity comes from `currentUserId()`. No client-supplied user id is used. Both endpoints verify the user exists and scope capture queries by the derived user id.

The list returns 200 and `CaptureView[]`, ordered by createdAt descending then id ascending; an empty list is `[]`. Detail returns 200 and one `CaptureView`. All capture statuses are readable. Items are ordered by sortOrder ascending. Reads never change database rows or process labels.

`CaptureView` contains id, source, status, nullable blobName and rawText, ISO createdAt and updatedAt, and items. Each item contains sortOrder, rawToken, nullable ingredientId, matchStatus, and nullable ingredient. A linked ingredient contains id, slug, displayName, nullable profile, and flags. Profile contains originSummary, manufacturerUse, and summary. Flags contain id, code, label, nullable categoryScope and productCategory, and enabledByUser, ordered by code. All flags are returned; enabledByUser reflects current UserPreference rows, not a category-applicability judgment. Unknown and ambiguous items retain their raw tokens with ingredient null when unlinked. Missing profiles remain null and missing items or flags are empty arrays.

Missing/empty identity or a missing User row returns 401 `unauthorized` / `A signed-in user is required`. Detail ids use a shared nonempty-string Zod schema, without requiring CUID format. Invalid ids return 400 `validation_error` / `Invalid capture id`. Foreign and unknown captures return identical 404 `not_found` / `Capture not found`. Unexpected errors return 500 `internal` / `Internal error`. All errors use `{ error: { code, message } }`; no raw errors reach clients.

Queries load ingredient relations in batches and read enabled preferences once per successful request, never once per item. Handlers are dynamic; no cached page needs revalidation.

## Examples
| State / input | Behavior |
|---|---|
| Caller has no captures | GET list returns 200 and `[]`. |
| Caller owns an uploaded capture without items | Detail returns metadata and `items: []`. |
| Caller owns a parsed item linked to wheat and has enabled gluten | Ingredient flags include gluten with enabledByUser true and category metadata. |
| Caller disables gluten | A subsequent read returns that flag with enabledByUser false; the stored capture is unchanged. |
| Capture belongs to someone else or does not exist | Identical 404 response. |
| Empty detail id | 400 validation_error. |

Example detail (the list contains objects of the same shape):
```json
{
  "id": "cap-1", "source": "camera", "status": "parsed",
  "blobName": null, "rawText": "Wheat",
  "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
  "items": [{
    "sortOrder": 0, "rawToken": "Wheat", "ingredientId": "ing-wheat", "matchStatus": "matched",
    "ingredient": {
      "id": "ing-wheat", "slug": "wheat", "displayName": "Wheat",
      "profile": { "originSummary": "plant", "manufacturerUse": "Binder", "summary": "Contains gluten." },
      "flags": [{ "id": "flag-gluten", "code": "gluten", "label": "Gluten", "categoryScope": "food", "productCategory": "food", "enabledByUser": true }]
    }
  }]
}
```

## Verify
- `pnpm exec vitest run tests/integration/capture-read.test.ts`: ownership, ordering, enrichment, preferences, errors, and read-only behavior.
- `pnpm test`, `pnpm test:integration`, `pnpm typecheck`, and `pnpm build`. The existing upload integration test requires Azurite.
- With local dev and seeded data running, request `/api/captures` and `/api/captures/<owned-id>`; verify 200, and request an unknown id to verify 404. No Azure account is needed.

## Constraints & decisions
- Use the existing schema and the Google session ([auth](../auth.md)); validation and queries live in domain per [web](../web.md).
- Captures have no product category, so scope metadata is exposed without inferring whether flags apply to this product.
- Ingredient profiles and preference annotations reflect current catalog/preferences; the stored item tokens and matches are unchanged.
- Return full results on both endpoints without pagination for the local POC. Never return user records, blob URLs, aliases, or raw Prisma objects.

## Out of scope
UI, pagination/filtering, image download, OCR, matching, uploads, preference mutation, and favorite mutation. Existing [favorites](favorites.md) responses are unchanged; upload remains at the singular `/api/capture`.
