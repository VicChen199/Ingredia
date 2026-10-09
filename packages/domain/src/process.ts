// Capture processing: stub text extraction, tokenizing, alias matching, and
// CaptureItem writes. Behavior contract: docs/specs/capture/process.md.
import { z } from "zod";
import { CaptureStatus, prisma } from "@project/db";

export const MAX_PROCESS_TEXT_LENGTH = 10_000;

// Stands in for OCR until a provider is chosen; uses the seeded demo aliases.
export const STUB_LABEL_TEXT =
  "Ingredients: Water, Glycerin, Coconut Oil, Wheat, Parfum.";

export const processRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_PROCESS_TEXT_LENGTH).optional(),
});

export type MatchStatus = "matched" | "unknown" | "ambiguous";

export type ProcessedItem = {
  sortOrder: number;
  rawToken: string;
  ingredientId: string | null;
  matchStatus: MatchStatus;
};

export class ProcessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function extractText(text?: string): string {
  return text ?? STUB_LABEL_TEXT;
}

// Splits on commas, semicolons, and line breaks outside parentheses/brackets.
export function tokenize(text: string): string[] {
  const body = text.replace(/^\s*ingredients\s*:/i, "");
  const tokens: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "(" || char === "[") depth += 1;
    if ((char === ")" || char === "]") && depth > 0) depth -= 1;

    if (depth === 0 && (char === "," || char === ";" || char === "\n")) {
      tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  tokens.push(current);

  return tokens.map((token) => token.trim().replace(/\.$/, "").trim()).filter(Boolean);
}

// Same form as IngredientAlias.normalized: lowercase, ASCII-folded,
// punctuation removed, whitespace collapsed.
export function normalize(token: string): string {
  return token
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function matchTokens(tokens: string[]): Promise<ProcessedItem[]> {
  const normalized = tokens.map(normalize);
  const lookup = [...new Set(normalized.filter(Boolean))];

  const aliases = await prisma.ingredientAlias.findMany({
    where: { normalized: { in: lookup } },
    select: { normalized: true, ingredientId: true },
  });

  const ingredientsByAlias = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const ids = ingredientsByAlias.get(alias.normalized) ?? new Set<string>();
    ids.add(alias.ingredientId);
    ingredientsByAlias.set(alias.normalized, ids);
  }

  return tokens.map((rawToken, sortOrder) => {
    const ids = [...(ingredientsByAlias.get(normalized[sortOrder]!) ?? [])];
    if (ids.length === 1) {
      return { sortOrder, rawToken, ingredientId: ids[0]!, matchStatus: "matched" };
    }
    return {
      sortOrder,
      rawToken,
      ingredientId: null,
      matchStatus: ids.length > 1 ? "ambiguous" : "unknown",
    };
  });
}

export async function processCapture(userId: string, captureId: string, text?: string) {
  const rawText = extractText(text);
  const tokens = tokenize(rawText);
  if (tokens.length === 0) {
    throw new ProcessError("INVALID_PROCESS_REQUEST", 400, "text contains no ingredients");
  }

  const capture = await prisma.capture.findUnique({
    where: { id_userId: { id: captureId, userId } },
    select: { status: true },
  });
  if (!capture) {
    throw new ProcessError("CAPTURE_NOT_FOUND", 404, "capture not found");
  }
  if (capture.status !== CaptureStatus.uploaded) {
    throw new ProcessError("CAPTURE_NOT_PROCESSABLE", 409, "capture has already been processed");
  }

  // Conditional claim: a concurrent request that already moved the status wins.
  const claimed = await prisma.capture.updateMany({
    where: { id: captureId, userId, status: CaptureStatus.uploaded },
    data: { rawText, status: CaptureStatus.extracted },
  });
  if (claimed.count === 0) {
    throw new ProcessError("CAPTURE_NOT_PROCESSABLE", 409, "capture has already been processed");
  }

  try {
    const items = await matchTokens(tokens);
    const [, updated] = await prisma.$transaction([
      prisma.captureItem.createMany({
        data: items.map((item) => ({ captureId, ...item })),
      }),
      prisma.capture.update({
        where: { id_userId: { id: captureId, userId } },
        data: { status: CaptureStatus.parsed },
        select: { id: true, status: true },
      }),
    ]);
    return { capture: updated, items };
  } catch {
    try {
      await prisma.capture.update({
        where: { id_userId: { id: captureId, userId } },
        data: { status: CaptureStatus.failed },
      });
    } catch {
      // Preserve the original processing failure if the status update fails.
    }
    throw new ProcessError("CAPTURE_PROCESS_FAILED", 500, "the capture could not be processed");
  }
}
