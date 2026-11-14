# ADR-0012: Azure AI Document Intelligence behind an OCR seam

## Status

Proposed

## Context

Capture processing needs the text on a label photo. Until now the extractor
was a stub returning a fixed sample label. Real OCR needs an engine, a way to
run it locally with no cloud account ([seams](../specs/seams.md)), and a
place in the request flow.

Options considered for the engine: Azure AI Document Intelligence, Google
Cloud Vision, and `tesseract.js` (local, no account). Options for where it
runs: synchronously in the process request, or as a worker job.

## Decision

- **Engine:** Azure AI Document Intelligence, `prebuilt-read` model, via
  `@azure-rest/ai-document-intelligence`. It is on the project's existing
  cloud, reads printed label text well, and needs no extra vendor.
- **Seam:** `packages/services/src/ocr.ts` exposes
  `readLabelText(data, contentType)`. One env var,
  `OCR_CONNECTION_STRING` (`Endpoint=https://…;Key=…`), switches it to the
  real engine. Unset, it returns a fixed sample label, so `pnpm dev` and tests
  need no account. Endpoint and key are packed into one connection string so
  the seam keeps the one-env-var-per-seam rule.
- **Placement:** synchronous inside `POST /api/captures/:id/process`, with a
  30-second budget, before the Capture's status is claimed. The route injects
  the reader into `packages/domain`, so domain does not import the SDK.

## Consequences

- **Easier**: real photos become text with no schema change; the paste path
  is untouched; swapping engines changes only `ocr.ts`.
- **Harder**: each read is a per-image cost and a secret to manage; a slow
  read holds a web request open for up to 30 seconds.
- **Accepted tradeoff**: `tesseract.js` was rejected as the local stand-in —
  its accuracy on small, curved label text would make the POC look broken,
  and a second engine doubles what must be maintained. Local development
  sees the sample label, not the photo's text. Moving OCR to the worker is
  deferred until request latency proves a problem; that would also require
  revisiting [ADR-0009](0009-domain-web-only.md).

## See also

- `docs/specs/capture/process.md` — the processing behavior this serves.
- `docs/specs/seams.md` — the seam pattern; this ADR is one instance.
- [ADR-0008](0008-azurite-seam.md) — the storage seam the image is read from.
