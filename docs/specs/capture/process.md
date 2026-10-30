---
type: feature
---
# Processing an uploaded capture reads its label photo and turns the text into matched ingredient lines

## Why

An uploaded photo is only useful once the app knows which ingredients are on
the label. Processing reads the text off the Capture's stored image (or takes
text the client already has) and turns it into an ordered list of
CaptureItems, each matched to a known Ingredient where possible, so flags and
favorites have something to show.

## Where it lives

- `apps/web/app/api/captures/[id]/process/route.ts` — HTTP endpoint, error
  mapping, and wiring the image reader into processing.
- `packages/domain/src/process.ts` — request validation, choosing pasted text
  vs. the image reader, tokenizing, normalizing, alias matching, and the
  Capture/CaptureItem writes.
- `packages/services/src/ocr.ts` — the OCR seam: Azure AI Document
  Intelligence when configured, a fixed sample label otherwise.
- `packages/services/src/storage.ts` — `downloadAttachment` reads the image.
- `packages/db/prisma/schema.prisma` — existing Capture, CaptureItem, and
  IngredientAlias persistence contract (no schema change).

## Behavior

`POST /api/captures/:id/process` processes one Capture owned by the current
user. The body is optional JSON `{ "text": string }`: label text the client
already has. When `text` is present it is used as-is and the image is not
read. When `text` is absent, the Capture's image is downloaded from blob
storage and read by OCR.

The route derives identity with `currentUserId()`, validates the body, and
looks the Capture up by `id` **and** the current user. A Capture that does not
exist or belongs to someone else returns `404`.

Only a Capture in status `uploaded` is processed. Any other status returns
`409` and changes nothing.

**Reading the image.** OCR runs synchronously inside the request, before the
Capture is changed. The OCR seam has two modes, chosen by configuration
(see [seams](../seams.md)):

- `OCR_CONNECTION_STRING` set → the image is sent to Azure AI Document
  Intelligence (`prebuilt-read`) and its text is returned.
- unset → the image is still downloaded, but a fixed sample label is returned
  instead of reading it, so local development needs no cloud account.

Line breaks in OCR text are replaced by spaces, because label text wraps
mid-ingredient. If the text contains `Ingredients:` anywhere, everything
before the first occurrence (brand, product name, claims) is dropped.

If the Capture has no image, the image cannot be downloaded, or OCR fails or
takes longer than 30 seconds, the route returns `502` and the Capture is
**unchanged** — still `uploaded`, so the client can retry or send `text`. If
OCR succeeds but the text yields no ingredients, the route returns `422` and
the Capture is likewise unchanged.

Processing then runs in two steps:

1. **Extract** — the text is saved to `Capture.raw_text` and the status moves
   `uploaded` → `extracted`.
2. **Parse** — the text is tokenized, each token is matched, and all
   CaptureItems are inserted together with the status move `extracted` →
   `parsed`, in **one transaction**. A Capture is never left with some items
   written.

If either step fails unexpectedly, the Capture is marked `failed` and the route
returns `500`. A failed Capture keeps whatever `raw_text` was saved and has no
CaptureItems.

**Tokenizing.** Text up to and including the first `Ingredients:` label is
dropped. The text is split on commas, semicolons, and line breaks that are not
inside parentheses, so `Fragrance (Parfum, Limonene)` stays one token. Tokens
are trimmed, a trailing period is dropped, and empty tokens are discarded.
`raw_token` keeps the token's original spelling; `sort_order` is its 0-based
position.

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
| Own `uploaded` Capture, no body, OCR configured | Image is read by Document Intelligence; `200`, status `parsed`, items from the label. |
| Own `uploaded` Capture, no body, OCR not configured | Image is downloaded; sample label text is used; `200`, status `parsed`. |
| Own `uploaded` Capture, `text: "Water, Wheat, Parfum"` | Image is not read. Three items in order: `unknown`, `matched` (wheat), `matched` (fragrance). |
| OCR text `"Acme Shampoo\nIngredients: Water, Sodium Laureth\nSulfate."` | Two items: `Water`, `Sodium Laureth Sulfate`. |
| `text: "Ingredients: Coconut Oil; Crème."` | Two items: `Coconut Oil` → `matched`; `Crème` normalizes to `creme` → `unknown`. |
| `text: "Fragrance (Parfum, Limonene)"` | One item; normalizes to `fragrance parfum limonene` → `unknown`. |
| Token whose normalized form is an alias of two ingredients | `ambiguous`, `ingredient_id` null. |
| `text` is not a string, is blank, tokenizes to nothing, or exceeds 10,000 characters | `400` `INVALID_PROCESS_REQUEST`; Capture unchanged. |
| No `text`; Capture has no image, blob is missing, or OCR errors/times out | `502` `TEXT_EXTRACTION_FAILED`; Capture still `uploaded`. |
| No `text`; OCR returns blank text or text that tokenizes to nothing | `422` `NO_INGREDIENTS_FOUND`; Capture still `uploaded`. |
| Capture already `parsed`, `extracted`, or `failed` | `409` `CAPTURE_NOT_PROCESSABLE`; Capture unchanged; image not read. |
| Capture id unknown or owned by another user | `404` `CAPTURE_NOT_FOUND`; image not read. |
| Auth identity is missing | `401` `UNAUTHENTICATED`. |
| Database fails while writing items | Status `failed`, no CaptureItems, `500` `CAPTURE_PROCESS_FAILED`. |

## Verify

- `pnpm test` — `tests/integration/process.test.ts` covers the happy path with
  pasted text and with the image reader, ambiguous and unknown matches, the
  OCR text cleanup, 400, 404 (foreign), 409, 422, and 502 with the Capture
  left `uploaded`. `packages/services` unit tests cover the OCR seam's mode
  selection and connection-string parsing.
- `pnpm typecheck` and `pnpm build`.
- With `pnpm dev` running and the database seeded, upload a label photo with
  `POST /api/capture`, then:

  ```bash
  curl -X POST http://localhost:3000/api/captures/<captureId>/process
  ```

  Without `OCR_CONNECTION_STRING`, confirm `200` and items from the sample
  label. With it set to a real Document Intelligence resource, confirm the
  items match the photo. Stop Azurite and process a fresh Capture: confirm
  `502` and that the Capture is still `uploaded`.

## Constraints & decisions

- **One OCR engine behind one seam.** Azure AI Document Intelligence in
  production, a fixed sample locally, switched by one env var. The route and
  domain never name the vendor. See
  [ADR-0012](../../adr/0012-ocr-seam.md).
- **Pasted text wins.** When `text` is sent, OCR never runs. This keeps a path
  that works when OCR is weak, and lets a future on-device OCR client send
  text without a second server extractor.
- **OCR failure does not consume the Capture.** Extraction happens before the
  status claim, so a `502` or `422` leaves the Capture `uploaded` for a retry.
  Only failures after text is saved mark it `failed`.
- **Processing runs once.** Only `uploaded` captures are processed, so a
  Capture is an immutable snapshot (see [data model](../data-model.md)).
  Re-processing a `failed` Capture is not supported yet.
- **Synchronous.** OCR runs in the request with a 30-second budget, not on the
  worker queue; the worker cannot import `packages/domain`
  ([ADR-0009](../../adr/0009-domain-web-only.md)).
- **Exact matching only.** Typo tolerance with `pg_trgm` is a later change;
  OCR misreads therefore show as `unknown`.
- The 10,000-character limit applies to pasted `text`; OCR text is bounded by
  the 5 MB image limit of [upload](upload.md).

## Out of scope

Choosing the ingredient list's end on a label (text after the list may become
`unknown` items); image preprocessing (rotation, cropping); on-device OCR;
fuzzy or typo-tolerant matching; resolving `ambiguous` items; overlaying
preference flags on items; listing or reading CaptureItems; re-processing; a
web page for upload and processing; and the upload itself
([upload](upload.md)).
