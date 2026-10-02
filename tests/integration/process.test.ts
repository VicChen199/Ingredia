import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const OWNER_ID = "process-owner";
const OTHER_USER_ID = "process-other";
let signedInUserId: string | null = OWNER_ID;

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;

vi.mock("../../packages/auth/src/index", () => ({
  currentUserId: async () => {
    if (!signedInUserId) throw new Error("no identity");
    return signedInUserId;
  },
}));

const [{ POST }, db, domain] = await Promise.all([
  import("../../apps/web/app/api/captures/[id]/process/route"),
  import("@project/db"),
  import("@project/domain"),
]);

type ProcessBody = {
  capture: { id: string; status: string };
  items: { sortOrder: number; rawToken: string; ingredientId: string | null; matchStatus: string }[];
};

async function createCapture(userId = OWNER_ID, status = db.CaptureStatus.uploaded) {
  const capture = await db.prisma.capture.create({
    data: { userId, source: db.CaptureSource.camera, status },
  });
  return capture.id;
}

function processRequest(captureId: string, body?: unknown) {
  return POST(
    new Request(`http://localhost/api/captures/${captureId}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: captureId }) },
  );
}

describe("POST /api/captures/:id/process", () => {
  beforeAll(async () => {
    await db.prisma.user.createMany({ data: [{ id: OWNER_ID }, { id: OTHER_USER_ID }] });
    await db.prisma.ingredient.createMany({
      data: [
        { id: "ing-wheat", slug: "wheat", displayName: "Wheat" },
        { id: "ing-fragrance", slug: "fragrance", displayName: "Fragrance" },
        { id: "ing-coconut-oil", slug: "coconut-oil", displayName: "Coconut oil" },
        { id: "ing-mint-a", slug: "mint-a", displayName: "Mint A" },
        { id: "ing-mint-b", slug: "mint-b", displayName: "Mint B" },
      ],
    });
    await db.prisma.ingredientAlias.createMany({
      data: [
        { ingredientId: "ing-wheat", name: "Wheat", nameType: "common", normalized: "wheat" },
        { ingredientId: "ing-fragrance", name: "Parfum", nameType: "inci", normalized: "parfum" },
        { ingredientId: "ing-coconut-oil", name: "Coconut oil", nameType: "common", normalized: "coconut oil" },
        { ingredientId: "ing-mint-a", name: "Mint", nameType: "common", normalized: "mint" },
        { ingredientId: "ing-mint-b", name: "Mint", nameType: "common", normalized: "mint" },
      ],
    });
  });

  afterAll(async () => {
    await db.prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_USER_ID] } } });
    await db.prisma.$disconnect();
  });

  it("parses text into ordered, matched CaptureItems and marks the capture parsed", async () => {
    const captureId = await createCapture();

    const response = await processRequest(captureId, { text: "Water, Wheat, Parfum" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as ProcessBody;
    expect(body.capture).toEqual({ id: captureId, status: "parsed" });
    expect(body.items.map((item) => [item.rawToken, item.matchStatus, item.ingredientId])).toEqual([
      ["Water", "unknown", null],
      ["Wheat", "matched", "ing-wheat"],
      ["Parfum", "matched", "ing-fragrance"],
    ]);

    const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
    expect(capture?.status).toBe("parsed");
    expect(capture?.rawText).toBe("Water, Wheat, Parfum");
    const items = await db.prisma.captureItem.findMany({
      where: { captureId },
      orderBy: { sortOrder: "asc" },
    });
    expect(items.map((item) => [item.sortOrder, item.rawToken, item.matchStatus])).toEqual([
      [0, "Water", "unknown"],
      [1, "Wheat", "matched"],
      [2, "Parfum", "matched"],
    ]);
  });

  it("uses the stub label text when no body is sent", async () => {
    const captureId = await createCapture();

    const response = await processRequest(captureId);

    expect(response.status).toBe(200);
    const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
    expect(capture?.rawText).toBe(domain.STUB_LABEL_TEXT);
    expect(await db.prisma.captureItem.count({ where: { captureId } })).toBeGreaterThan(0);
  });

  it("normalizes case, accents, and the Ingredients: label before matching", async () => {
    const captureId = await createCapture();

    const response = await processRequest(captureId, { text: "Ingredients: COCONUT OIL; Crème." });

    const body = (await response.json()) as ProcessBody;
    expect(body.items.map((item) => [item.rawToken, item.matchStatus])).toEqual([
      ["COCONUT OIL", "matched"],
      ["Crème", "unknown"],
    ]);
  });

  it("marks a token shared by two ingredients as ambiguous with no ingredient", async () => {
    const captureId = await createCapture();

    const response = await processRequest(captureId, { text: "Mint" });

    const body = (await response.json()) as ProcessBody;
    expect(body.items).toEqual([
      { sortOrder: 0, rawToken: "Mint", ingredientId: null, matchStatus: "ambiguous" },
    ]);
  });

  it("keeps commas inside parentheses in one token", async () => {
    const captureId = await createCapture();

    const response = await processRequest(captureId, { text: "Fragrance (Parfum, Limonene), Wheat" });

    const body = (await response.json()) as ProcessBody;
    expect(body.items.map((item) => item.rawToken)).toEqual(["Fragrance (Parfum, Limonene)", "Wheat"]);
  });

  it.each([
    ["a non-string text", { text: 42 }],
    ["blank text", { text: "   " }],
    ["text with no ingredients", { text: ", ; ." }],
    ["text over 10,000 characters", { text: "a".repeat(10_001) }],
  ])("rejects %s with 400 and leaves the capture unchanged", async (_label, body) => {
    const captureId = await createCapture();

    const response = await processRequest(captureId, body);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_PROCESS_REQUEST",
    );
    const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
    expect(capture?.status).toBe("uploaded");
    expect(capture?.rawText).toBeNull();
  });

  it.each([db.CaptureStatus.parsed, db.CaptureStatus.extracted, db.CaptureStatus.failed])(
    "returns 409 for a %s capture and changes nothing",
    async (status) => {
      const captureId = await createCapture(OWNER_ID, status);

      const response = await processRequest(captureId, { text: "Wheat" });

      expect(response.status).toBe(409);
      const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
      expect(capture?.status).toBe(status);
      expect(await db.prisma.captureItem.count({ where: { captureId } })).toBe(0);
    },
  );

  it("returns 404 for another user's capture without touching it", async () => {
    const captureId = await createCapture(OTHER_USER_ID);

    const response = await processRequest(captureId, { text: "Wheat" });

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "CAPTURE_NOT_FOUND",
    );
    const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
    expect(capture?.status).toBe("uploaded");
  });

  it("returns 404 for an unknown capture id", async () => {
    const response = await processRequest("does-not-exist", { text: "Wheat" });

    expect(response.status).toBe(404);
  });

  it("returns 401 when there is no identity", async () => {
    const captureId = await createCapture();
    signedInUserId = null;
    try {
      const response = await processRequest(captureId, { text: "Wheat" });
      expect(response.status).toBe(401);
    } finally {
      signedInUserId = OWNER_ID;
    }
  });

  it("marks the capture failed with no items when the item write fails", async () => {
    const captureId = await createCapture();
    const transaction = vi
      .spyOn(db.prisma, "$transaction")
      .mockRejectedValueOnce(new Error("database went away"));

    try {
      const response = await processRequest(captureId, { text: "Wheat, Parfum" });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("CAPTURE_PROCESS_FAILED");
      expect(body.error.message).not.toContain("database went away");
    } finally {
      transaction.mockRestore();
    }

    const capture = await db.prisma.capture.findUnique({ where: { id: captureId } });
    expect(capture?.status).toBe("failed");
    expect(await db.prisma.captureItem.count({ where: { captureId } })).toBe(0);
  });
});
