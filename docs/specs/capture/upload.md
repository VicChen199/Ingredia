---
type: feature
---
# Capture image upload

## Why

The camera and extension clients need one server endpoint that stores an image
in blob storage and records the owned Capture that refers to it.

## Where it lives

- `apps/web/app/api/capture/route.ts` — HTTP endpoint and error mapping.
- `packages/domain/src/capture.ts` — source/image validation and Capture queries.
- `packages/services/src/storage.ts` — Azure Blob Storage/Azurite adapter.
- `packages/db/prisma/schema.prisma` — existing Capture persistence contract.

## Behavior

`POST /api/capture` accepts `multipart/form-data` with a required `file` image
and an optional `source` field. The source defaults to `camera` and may be
`extension`.

The route derives identity with `currentUserId()`, verifies the user exists,
validates the image, creates the Capture, uploads it to the `attachments`
container, and updates the Capture with the returned blob name. The client
never supplies `userId`.

The route currently checks that the file is an image, is non-empty, and is no
larger than 5 MB. Further image-content checks may be added later.

The blob key is `<captureId>/<sanitized-filename>`. The database stores the blob
key, never a blob URL. A successful response is `201` with:

```json
{
  "capture": {
    "id": "…",
    "source": "camera",
    "status": "uploaded"
  }
}
```

## Examples

| State / input | Behavior |
|---|---|
| Valid image with no source | Creates a camera Capture and returns `201`. |
| Valid image with `source=extension` | Creates an extension-provenance Capture and returns `201`. |
| Missing file, invalid source, non-image, empty file, or file over 5 MB | Returns `400` with the standard error shape. |
| Auth identity is missing or does not resolve to a User row | Returns `401`. |
| Azurite/Azure Blob is unavailable | Returns `503` with `STORAGE_UNAVAILABLE`. |
| Capture creation succeeds but storage fails | Marks the Capture `failed` and returns `503`. |
| Database update fails after blob upload | Returns `500`; the existing storage contract permits an orphaned blob. |

## Verify

- `pnpm typecheck`
- `pnpm build`
- Start `pnpm dev`, then upload an image with:

  ```bash
  curl -X POST http://localhost:3000/api/capture \
    -F "file=@label.png" \
    -F "source=camera"
  ```

- Confirm the response is `201`, the Capture has the current user's ID, and the
  blob exists in Azurite under the returned capture ID prefix.

## Constraints & decisions

- The endpoint uses the existing dev identity stub and does not add Auth.js.
- `extension` is accepted only as Capture provenance. Extension visits,
  listings, product data, and extension workflows remain out of scope.
- Blob storage and Postgres are separate systems; their writes are not one
  distributed transaction. See [ADR-0006](../../adr/0006-blob-storage.md).
- Local storage defaults to Azurite and production uses the same adapter with
  `AZURE_STORAGE_CONNECTION_STRING`. See [storage](../storage.md).

## Out of scope

OCR, CaptureItem creation, ingredient matching, favorites, thumbnails, and
download endpoints are separate behavior and are not performed by this upload.
