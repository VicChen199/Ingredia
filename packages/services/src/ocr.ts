// The OCR adapter. Reads label text from an image with Azure AI Document
// Intelligence, or returns a fixed sample label when OCR_CONNECTION_STRING is
// unset. Contract: docs/specs/capture/process.md, ADR-0012.
import createClient, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
} from "@azure-rest/ai-document-intelligence";
import { log } from "@project/log";

export const OCR_TIMEOUT_MS = 30_000;

// Returned when no OCR engine is configured; uses the seeded demo aliases.
export const SAMPLE_LABEL_TEXT =
  "Ingredients: Water, Glycerin, Coconut Oil, Wheat, Parfum.";

// Parses `Endpoint=https://…;Key=…` (keys case-insensitive).
export function parseOcrConnectionString(value: string): { endpoint: string; key: string } {
  const parts = new Map<string, string>();
  for (const pair of value.split(";")) {
    const index = pair.indexOf("=");
    if (index > 0) parts.set(pair.slice(0, index).trim().toLowerCase(), pair.slice(index + 1).trim());
  }
  const endpoint = parts.get("endpoint");
  const key = parts.get("key");
  if (!endpoint || !key) {
    throw new Error("OCR_CONNECTION_STRING must contain Endpoint= and Key=");
  }
  return { endpoint, key };
}

export async function readLabelText(data: Uint8Array, contentType: string): Promise<string> {
  const connectionString = process.env.OCR_CONNECTION_STRING?.trim();
  if (!connectionString) return SAMPLE_LABEL_TEXT;

  const { endpoint, key } = parseOcrConnectionString(connectionString);
  const client = createClient(endpoint, { key });
  const abortSignal = AbortSignal.timeout(OCR_TIMEOUT_MS);

  const initial = await client
    .path("/documentModels/{modelId}:analyze", "prebuilt-read")
    .post({ contentType: "application/octet-stream", body: data, abortSignal });
  if (isUnexpected(initial)) {
    throw new Error(`document intelligence rejected the image: ${initial.body.error.message}`);
  }

  const result = await getLongRunningPoller(client, initial).pollUntilDone({ abortSignal });
  if (isUnexpected(result)) {
    throw new Error(`document intelligence failed: ${result.body.error.message}`);
  }

  // The poller's success body is untyped; it is the analyze operation.
  const text = (result.body as AnalyzeOperationOutput).analyzeResult?.content ?? "";
  log.info({ contentType, bytes: data.byteLength, chars: text.length }, "ocr read label");
  return text;
}
