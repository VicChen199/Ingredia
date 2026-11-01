---
type: feature
---
# Processing an uploaded capture turns its label text into matched ingredient lines

## Why

An uploaded photo is only useful once the app knows which ingredients are on
the label. Processing turns a Capture's text into an ordered list of
CaptureItems, each matched to a known Ingredient where possible, so flags and
favorites have something to show.

## Where it lives

- `apps/web/app/api/captures/[id]/process/route.ts` — HTTP endpoint and error
  mapping.
- `packages/domain/src/process.ts` — request validation, the text-extraction
  stub, tokenizing, normalizing, alias matching, and the Capture/CaptureItem
  writes.
- `packages/db/prisma/schema.prisma` — existing Capture, CaptureItem, and
  IngredientAlias persistence contract (no schema change).

## Behavior

`POST /api/captures/:id/process` processes one Capture owned by the current
user. The body is optional JSON `{ "text": string }`: the label text to use
instead of OCR. Without `text`, the stub extractor returns a fixed sample
label. No real OCR runs and the blob is not read.

The route derives identity with `currentUserId()`, validates the body, and
looks the Capture up by `id` **and** the current user. A Capture that does not
exist or belongs to someone else returns `404`.

Only a Capture in status `uploaded` is processed. Any other status returns
`409` and changes nothing.

Processing runs in two steps:

1. **Extract** — the text is saved to `Capture.raw_text` and the status moves
   `uploaded` → `extracted`.
2. **Parse** — the text is tokenized, each token is matched, and all
   CaptureItems are inserted together with the status move `extracted` →
   `parsed`, in **one transaction**. A Capture is never left with some items
   written.

If either step fails unexpectedly, the Capture is marked `failed` and the route
returns `500`. A failed Capture keeps whatever `raw_text` was saved and has no
CaptureItems.

**Tokenizing.** A leading `Ingredients:` label is dropped. The text is split on
commas, semicolons, and line breaks that are not inside parentheses, so
`Fragrance (Parfum, Limonene)` stays one token. Tokens are trimmed, a trailing
period is dropped, and empty tokens are discarded. `raw_token` keeps the
token's original spelling; `sort_order` is its 0-based position.

**Normalizing.** A token is lowercased, ASCII-folded (accents removed),
punctuation is removed, and runs of whitespace collapse to one space — the same
form stored in `IngredientAlias.normalized`.

**Matching.** The normalized token is compared exactly against
`IngredientAlias.normalized`, counting distinct ingredients:

- exactly one ingredient → `matched`, `ingredient_id` set;
- two or more ingredients → `ambiguous`, `ingredient_id` null;
- none → `unknown`, `ingredient_id` null.

Matching uses one alias query for the whole capture, not one per token.

A successful response is `200` with:

```json
{
  "capture": { "id": "…", "status": "parsed" },
  "items": [
    { "sortOrder": 0, "rawToken": "Water", "ingredientId": null, "matchStatus": "unknown" },
    { "sortOrder": 1, "rawToken": "Parfum", "ingredientId": "ing-fragrance", "matchStatus": "matched" }
  ]
}
```

## Examples

| State / input | Behavior |
|---|---|
| Own `uploaded` Capture, no body | Stub text is used; returns `200`, status `parsed`, items created. |
| Own `uploaded` Capture, `text: "Water, Wheat, Parfum"` | Three items in order: `unknown`, `matched` (wheat), `matched` (fragrance). |
| `text: "Ingredients: Coconut Oil; Crème."` | Two items: `Coconut Oil` → `matched`; `Crème` normalizes to `creme` → `unknown`. |
| `text: "Fragrance (Parfum, Limonene)"` | One item; normalizes to `fragrance parfum limonene` → `unknown`. |
| Token whose normalized form is an alias of two ingredients | `ambiguous`, `ingredient_id` null. |
| `text` is not a string, is blank, tokenizes to nothing, or exceeds 10,000 characters | `400` `INVALID_PROCESS_REQUEST`; Capture unchanged. |
| Capture already `parsed`, `extracted`, or `failed` | `409` `CAPTURE_NOT_PROCESSABLE`; Capture unchanged. |
| Capture id unknown or owned by another user | `404` `CAPTURE_NOT_FOUND`. |
| Auth identity is missing | `401` `UNAUTHENTICATED`. |
| Database fails while writing items | Status `failed`, no CaptureItems, `500` `CAPTURE_PROCESS_FAILED`. |

## Verify

- `pnpm test` — `tests/integration/process.test.ts` covers the happy path,
  ambiguous and unknown matches, 400, 404 (foreign), and 409.
- `pnpm typecheck` and `pnpm build`.
- With `pnpm dev` running and the database seeded, upload an image with
  `POST /api/capture`, then:

  ```bash
  curl -X POST http://localhost:3000/api/captures/<captureId>/process \
    -H "Content-Type: application/json" \
    -d '{"text":"Water, Wheat, Parfum"}'
  ```

  Confirm `200`, status `parsed`, and three CaptureItems for that Capture.

## Constraints & decisions

- **OCR is a stub.** Text comes from the request or a fixed sample, so the
  parse-and-match loop works end to end before an OCR provider is chosen.
  Swapping in real OCR changes only the extractor.
- **Processing runs once.** Only `uploaded` captures are processed, so a
  Capture is an immutable snapshot (see [data model](../phases/data-model.md)).
  Re-processing a `failed` Capture is not supported yet.
- **Exact matching only.** Typo tolerance with `pg_trgm` is a later change.
- **Synchronous.** Processing runs in the request, not on the worker queue;
  a stub and a short label do not need a background job.
- The text limit of 10,000 characters bounds the work a single request can
  trigger.

## Out of scope

Real OCR and reading the blob image; fuzzy or typo-tolerant matching;
resolving `ambiguous` items; overlaying preference flags on items; listing or
reading CaptureItems; re-processing; and the upload itself
([upload](upload.md)).
