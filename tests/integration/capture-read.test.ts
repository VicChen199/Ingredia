import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn(async () => "user-a") }));
vi.mock("@project/auth", () => ({ currentUserId }));
vi.mock("../../packages/auth/src/index.ts", () => ({ currentUserId }));
vi.mock("../../packages/auth/src/current-user.ts", () => ({ currentUserId }));

let prisma: import("@project/db").PrismaClient;
let list: typeof import("../../apps/web/app/api/captures/route").GET;
let detail: typeof import("../../apps/web/app/api/captures/[id]/route").GET;

beforeAll(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  prisma = (await import("@project/db")).prisma;
  list = (await import("../../apps/web/app/api/captures/route")).GET;
  detail = (await import("../../apps/web/app/api/captures/[id]/route")).GET;
}, 30000);

beforeEach(async () => {
  vi.restoreAllMocks();
  currentUserId.mockReset().mockResolvedValue("user-a");
  await prisma.favorite.deleteMany();
  await prisma.captureItem.deleteMany();
  await prisma.capture.deleteMany();
  await prisma.userPreference.deleteMany();
  await prisma.ingredientFlag.deleteMany();
  await prisma.ingredientProfile.deleteMany();
  await prisma.ingredientAlias.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.preferenceFlag.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [{ id: "user-a" }, { id: "user-b" }] });
});

afterAll(async () => { await prisma?.$disconnect(); });

function readList() { return list(new Request("http://local/api/captures?userId=user-b")); }
function readDetail(id: string) {
  return detail(new Request(`http://local/api/captures/${id}?userId=user-b`), {
    params: Promise.resolve({ id }),
  });
}

async function capture(id = "cap-1", userId = "user-a") {
  return prisma.capture.create({ data: { id, userId, source: "camera", status: "parsed", rawText: "Wheat, mystery, collision" } });
}

async function enrichedFixture() {
  await capture();
  await prisma.preferenceFlag.createMany({ data: [
    { id: "flag-z", code: "zeta", label: "Zeta", categoryScope: null },
    { id: "flag-g", code: "gluten", label: "Gluten", categoryScope: "food" },
  ] });
  await prisma.ingredient.create({ data: {
    id: "wheat", slug: "wheat", displayName: "Wheat",
    profile: { create: { originSummary: "plant", manufacturerUse: "Binder", summary: "Contains gluten." } },
    flags: { create: [
      { flagId: "flag-z", productCategory: null },
      { flagId: "flag-g", productCategory: "food" },
    ] },
    evidence: { create: [
      { claimType: "function", summary: "Undated binder note.", sourceUrl: "https://example.org/binder", publishedOn: null },
      { claimType: "safety", summary: "Gluten triggers coeliac disease.", sourceUrl: "https://example.org/gluten", publishedOn: new Date("2024-05-01") },
    ] },
    regulatoryStatuses: { create: [
      { jurisdiction: "US", statusText: "Major allergen source.", asOfDate: new Date("2025-01-15") },
      { jurisdiction: "EU", statusText: "Allergen; emphasised on labels.", asOfDate: new Date("2025-02-01") },
    ] },
  } });
  await prisma.ingredient.create({ data: { id: "bare", slug: "bare", displayName: "Bare" } });
  await prisma.userPreference.createMany({ data: [
    { userId: "user-a", flagId: "flag-g" }, { userId: "user-b", flagId: "flag-z" },
  ] });
  await prisma.captureItem.createMany({ data: [
    { captureId: "cap-1", sortOrder: 3, rawToken: "Bare", ingredientId: "bare", matchStatus: "matched" },
    { captureId: "cap-1", sortOrder: 2, rawToken: "collision", matchStatus: "ambiguous" },
    { captureId: "cap-1", sortOrder: 1, rawToken: "mystery", matchStatus: "unknown" },
    { captureId: "cap-1", sortOrder: 0, rawToken: "Wheat", ingredientId: "wheat", matchStatus: "matched" },
  ] });
}

async function snapshot() {
  return {
    captures: await prisma.capture.findMany({ orderBy: { id: "asc" } }),
    items: await prisma.captureItem.findMany({ orderBy: [{ captureId: "asc" }, { sortOrder: "asc" }] }),
    preferences: await prisma.userPreference.findMany({ orderBy: [{ userId: "asc" }, { flagId: "asc" }] }),
    favorites: await prisma.favorite.findMany({ orderBy: [{ userId: "asc" }, { captureId: "asc" }] }),
  };
}

describe("capture reads", () => {
  it("returns an empty list for a user without captures", async () => {
    const response = await readList();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("lists only owned captures in deterministic order and includes every status", async () => {
    await prisma.capture.createMany({ data: [
      { id: "older", userId: "user-a", source: "camera", status: "uploaded", createdAt: new Date("2026-01-01") },
      { id: "b", userId: "user-a", source: "camera", status: "failed", createdAt: new Date("2026-01-02") },
      { id: "a", userId: "user-a", source: "extension", status: "extracted", createdAt: new Date("2026-01-02") },
      { id: "parsed", userId: "user-a", source: "camera", status: "parsed", createdAt: new Date("2026-01-01") },
      { id: "foreign", userId: "user-b", source: "camera", status: "parsed", createdAt: new Date("2026-01-03") },
    ] });
    const response = await readList();
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows.map((row: { id: string }) => row.id)).toEqual(["a", "b", "older", "parsed"]);
    expect(rows[0]).toMatchObject({ source: "extension", status: "extracted", blobName: null, rawText: null, items: [] });
  });

  it("returns the same enriched view in list and detail, preserving unmatched items", async () => {
    await enrichedFixture();
    const response = await readDetail("cap-1");
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view).toEqual({
      id: "cap-1", source: "camera", status: "parsed", blobName: null,
      rawText: "Wheat, mystery, collision", createdAt: expect.any(String), updatedAt: expect.any(String),
      items: [
        { sortOrder: 0, rawToken: "Wheat", ingredientId: "wheat", matchStatus: "matched", ingredient: {
          id: "wheat", slug: "wheat", displayName: "Wheat",
          profile: { originSummary: "plant", manufacturerUse: "Binder", summary: "Contains gluten." },
          flags: [
            { id: "flag-g", code: "gluten", label: "Gluten", categoryScope: "food", productCategory: "food", enabledByUser: true },
            { id: "flag-z", code: "zeta", label: "Zeta", categoryScope: null, productCategory: null, enabledByUser: false },
          ],
          evidence: [
            { claimType: "safety", summary: "Gluten triggers coeliac disease.", sourceUrl: "https://example.org/gluten", publishedOn: "2024-05-01" },
            { claimType: "function", summary: "Undated binder note.", sourceUrl: "https://example.org/binder", publishedOn: null },
          ],
          regulatoryStatuses: [
            { jurisdiction: "EU", statusText: "Allergen; emphasised on labels.", asOfDate: "2025-02-01" },
            { jurisdiction: "US", statusText: "Major allergen source.", asOfDate: "2025-01-15" },
          ],
        } },
        { sortOrder: 1, rawToken: "mystery", ingredientId: null, matchStatus: "unknown", ingredient: null },
        { sortOrder: 2, rawToken: "collision", ingredientId: null, matchStatus: "ambiguous", ingredient: null },
        { sortOrder: 3, rawToken: "Bare", ingredientId: "bare", matchStatus: "matched", ingredient: {
          id: "bare", slug: "bare", displayName: "Bare", profile: null, flags: [],
          evidence: [], regulatoryStatuses: [],
        } },
      ],
    });
    expect(view.createdAt).toBe(new Date(view.createdAt).toISOString());
    expect(view.updatedAt).toBe(new Date(view.updatedAt).toISOString());
    expect(await (await readList()).json()).toEqual([view]);
  });

  it("returns empty items and stored blob metadata for an uploaded capture", async () => {
    await prisma.capture.create({ data: { id: "upload", userId: "user-a", source: "camera", status: "uploaded", blobName: "upload/label.png" } });
    const response = await readDetail("upload");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "upload", status: "uploaded", blobName: "upload/label.png", rawText: null, items: [] });
  });

  it("returns identical 404 bodies for foreign and nonexistent captures", async () => {
    await capture("foreign", "user-b");
    for (const id of ["foreign", "missing"]) {
      const response = await readDetail(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: "Capture not found" } });
    }
  });

  it.each(["throws", "empty", "missing"])("returns 401 on both endpoints when identity is %s", async (mode) => {
    if (mode === "throws") currentUserId.mockRejectedValue(new Error("private identity failure"));
    else currentUserId.mockResolvedValue(mode === "empty" ? "" : "missing-user");
    for (const response of [await readList(), await readDetail("cap-1")]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "A signed-in user is required" } });
    }
  });

  it("returns 400 for an invalid detail id", async () => {
    const response = await readDetail("");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "validation_error", message: "Invalid capture id" } });
  });

  it("reads preferences once per request and reflects changes without changing captures", async () => {
    await enrichedFixture();
    await prisma.favorite.create({ data: { userId: "user-a", captureId: "cap-1" } });
    const before = await snapshot();
    const preferenceRead = vi.spyOn(prisma.userPreference, "findMany");
    await readList();
    expect(preferenceRead).toHaveBeenCalledTimes(1);
    await readDetail("cap-1");
    expect(preferenceRead).toHaveBeenCalledTimes(2);
    expect(await snapshot()).toEqual(before);
    await prisma.userPreference.delete({ where: { userId_flagId: { userId: "user-a", flagId: "flag-g" } } });
    const afterPreferenceChange = await snapshot();
    const view = await (await readDetail("cap-1")).json();
    expect(view.items[0].ingredient.flags[0].enabledByUser).toBe(false);
    expect(await snapshot()).toEqual(afterPreferenceChange);
    expect(afterPreferenceChange.captures).toEqual(before.captures);
    expect(afterPreferenceChange.items).toEqual(before.items);
  });

  it("orders evidence newest first, undated last, ties by summary", async () => {
    await enrichedFixture();
    await prisma.evidence.createMany({ data: [
      { ingredientId: "wheat", claimType: "controversy", summary: "A later note.", sourceUrl: "https://example.org/a", publishedOn: new Date("2024-05-01") },
      { ingredientId: "wheat", claimType: "safety", summary: "Newest study.", sourceUrl: "https://example.org/b", publishedOn: new Date("2025-03-09") },
    ] });
    const view = await (await readDetail("cap-1")).json();
    expect(view.items[0].ingredient.evidence.map((row: { summary: string }) => row.summary)).toEqual([
      "Newest study.", "A later note.", "Gluten triggers coeliac disease.", "Undated binder note.",
    ]);
  });

  it("enforces the encyclopedia constraints in the database", async () => {
    await enrichedFixture();
    const status = { ingredientId: "wheat", statusText: "Allowed.", asOfDate: new Date("2025-01-15") };
    await expect(prisma.regulatoryStatus.create({ data: { ...status, jurisdiction: "US" } })).rejects.toThrow();
    await expect(prisma.regulatoryStatus.create({ data: { ...status, jurisdiction: "us" } })).rejects.toThrow();
    await expect(prisma.regulatoryStatus.create({ data: { ...status, jurisdiction: "CA", statusText: "  " } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "Evidence" (id, ingredient_id, claim_type, summary, source_url) VALUES ('e', 'wheat', 'marketing', 'x', 'https://example.org')`,
    )).rejects.toThrow();
    await expect(prisma.evidence.create({ data: {
      ingredientId: "wheat", claimType: "safety", summary: "", sourceUrl: "https://example.org",
    } })).rejects.toThrow();
    await prisma.regulatoryStatus.create({ data: { ...status, jurisdiction: "CA" } });
    expect(await prisma.regulatoryStatus.count({ where: { ingredientId: "wheat" } })).toBe(3);
  });

  it("keeps encyclopedia rows of a scanned ingredient and cascades them from an unscanned one", async () => {
    await enrichedFixture();
    await prisma.evidence.create({ data: { ingredientId: "bare", claimType: "function", summary: "Filler.", sourceUrl: "https://example.org/bare" } });
    await prisma.regulatoryStatus.create({ data: { ingredientId: "bare", jurisdiction: "US", statusText: "Allowed.", asOfDate: new Date("2025-01-15") } });
    await expect(prisma.ingredient.delete({ where: { id: "wheat" } })).rejects.toThrow();
    expect(await prisma.evidence.count({ where: { ingredientId: "wheat" } })).toBe(2);
    expect(await prisma.regulatoryStatus.count({ where: { ingredientId: "wheat" } })).toBe(2);
    await prisma.captureItem.delete({ where: { captureId_sortOrder: { captureId: "cap-1", sortOrder: 3 } } });
    await prisma.ingredient.delete({ where: { id: "bare" } });
    expect(await prisma.evidence.count({ where: { ingredientId: "bare" } })).toBe(0);
    expect(await prisma.regulatoryStatus.count({ where: { ingredientId: "bare" } })).toBe(0);
  });

  it("sanitizes unexpected database failures on both endpoints", async () => {
    vi.spyOn(prisma.user, "findUnique").mockRejectedValue(new Error("secret database credentials"));
    for (const response of [await readList(), await readDetail("cap-1")]) {
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "internal", message: "Internal error" } });
    }
  });
});
