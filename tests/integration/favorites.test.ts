import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUserId } = vi.hoisted(() => ({
  currentUserId: vi.fn(async () => "user-a"),
}));

vi.mock("@project/auth", () => ({
  currentUserId,
}));
// The route resolves @project/auth to these files. Mocking the package name
// alone leaves that resolution on the real module, which calls next/headers.
vi.mock("../../packages/auth/src/index.ts", () => ({
  currentUserId,
}));
vi.mock("../../packages/auth/src/current-user.ts", () => ({
  currentUserId,
}));

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;

type FavoriteHandlers = typeof import("../../apps/web/app/api/captures/[id]/favorite/route");
let POST: FavoriteHandlers["POST"];
let DELETE: FavoriteHandlers["DELETE"];
let GET: typeof import("../../apps/web/app/api/favorites/route").GET;

beforeAll(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const db = await import("@project/db");
  prisma = db.prisma;
  const favoriteRoute = await import("../../apps/web/app/api/captures/[id]/favorite/route");
  POST = favoriteRoute.POST;
  DELETE = favoriteRoute.DELETE;
  const listRoute = await import("../../apps/web/app/api/favorites/route");
  GET = listRoute.GET;
}, 30000);

beforeEach(async () => {
  currentUserId.mockReset();
  currentUserId.mockResolvedValue("user-a");
  await prisma.favorite.deleteMany();
  await prisma.captureItem.deleteMany();
  await prisma.capture.deleteMany();
  await prisma.user.deleteMany();
});

function postFavorite(id: string) {
  return POST(new Request(`http://local/api/captures/${id}/favorite`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

function deleteFavorite(id: string) {
  return DELETE(new Request(`http://local/api/captures/${id}/favorite`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

async function insertUser(id: string) {
  await prisma.user.create({ data: { id } });
}

describe("favorites", () => {
  it("creates a favorite for the caller's uploaded capture with no items", async () => {
    await insertUser("user-a");
    await prisma.capture.create({
      data: { id: "cap-1", userId: "user-a", source: "camera", status: "uploaded" },
    });

    const res = await postFavorite("cap-1");

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.captureId).toBe("cap-1");
    expect(body.userId).toBe("user-a");
    expect(body.capture.items).toEqual([]);
    expect(await prisma.favorite.count()).toBe(1);
  });

  it("rejects a second favorite for the same pair", async () => {
    await insertUser("user-a");
    await prisma.capture.create({
      data: { id: "cap-1", userId: "user-a", source: "camera", status: "uploaded" },
    });

    const first = await postFavorite("cap-1");
    expect(first.status).toBe(201);
    const second = await postFavorite("cap-1");

    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("conflict");
    expect(await prisma.favorite.count()).toBe(1);
  });

  it("returns 404 when the capture belongs to someone else", async () => {
    await insertUser("user-a");
    await insertUser("user-b");
    await prisma.capture.create({
      data: { id: "cap-b", userId: "user-b", source: "camera", status: "uploaded" },
    });

    const res = await postFavorite("cap-b");

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Capture not found");
    expect(await prisma.favorite.count()).toBe(0);
  });

  it("returns 404 for an unknown capture id", async () => {
    await insertUser("user-a");

    const res = await postFavorite("missing");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Capture not found");
  });

  it("returns 401 when the current user row does not exist", async () => {
    currentUserId.mockResolvedValueOnce("user-missing");

    const res = await postFavorite("cap-1");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns capture items ordered by sortOrder ascending", async () => {
    await insertUser("user-a");
    await prisma.capture.create({
      data: {
        id: "cap-1",
        userId: "user-a",
        source: "camera",
        status: "parsed",
        items: {
          create: [
            { sortOrder: 1, rawToken: "s", matchStatus: "unknown" },
            { sortOrder: 0, rawToken: "0", matchStatus: "unknown" },
          ],
        },
      },
    });

    const res = await postFavorite("cap-1");

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.capture.items).toEqual([
      { sortOrder: 0, rawToken: "0", ingredientId: null, matchStatus: "unknown" },
      { sortOrder: 1, rawToken: "s", ingredientId: null, matchStatus: "unknown" },
    ]);
  });

  it("deletes the favorite and leaves the capture and items", async () => {
    await insertUser("user-a");
    await prisma.capture.create({
      data: {
        id: "cap-1",
        userId: "user-a",
        source: "camera",
        status: "parsed",
        items: {
          create: [
            { sortOrder: 1, rawToken: "s", matchStatus: "unknown" },
            { sortOrder: 0, rawToken: "0", matchStatus: "unknown" },
          ],
        },
      },
    });
    await prisma.favorite.create({ data: { userId: "user-a", captureId: "cap-1" } });

    const res = await deleteFavorite("cap-1");

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await prisma.favorite.count()).toBe(0);
    const capture = await prisma.capture.findUnique({
      where: { id: "cap-1" },
      include: { items: true },
    });
    expect(capture).not.toBeNull();
    expect(capture?.items).toHaveLength(2);
  });

  it("returns 404 when deleting a favorite that is already gone", async () => {
    await insertUser("user-a");
    await prisma.capture.create({
      data: { id: "cap-1", userId: "user-a", source: "camera", status: "uploaded" },
    });
    await prisma.favorite.create({ data: { userId: "user-a", captureId: "cap-1" } });
    const first = await deleteFavorite("cap-1");
    expect(first.status).toBe(204);

    const res = await deleteFavorite("cap-1");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Favorite not found");
  });

  it("returns 404 when deleting another user's favorite and leaves their rows", async () => {
    await insertUser("user-a");
    await insertUser("user-b");
    await prisma.capture.create({
      data: {
        id: "cap-b",
        userId: "user-b",
        source: "camera",
        status: "uploaded",
        items: {
          create: [{ sortOrder: 0, rawToken: "water", matchStatus: "unknown" }],
        },
      },
    });
    await prisma.favorite.create({ data: { userId: "user-b", captureId: "cap-b" } });

    const res = await deleteFavorite("cap-b");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Favorite not found");
    expect(await prisma.capture.count()).toBe(1);
    expect(await prisma.captureItem.count()).toBe(1);
    expect(await prisma.favorite.count()).toBe(1);
    const favorite = await prisma.favorite.findUnique({
      where: { userId_captureId: { userId: "user-b", captureId: "cap-b" } },
    });
    expect(favorite).not.toBeNull();
  });

  it("lists only the caller's favorites ordered by capture createdAt descending", async () => {
    await insertUser("user-a");
    await insertUser("user-b");
    await prisma.capture.create({
      data: {
        id: "cap-new",
        userId: "user-a",
        source: "camera",
        status: "uploaded",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        items: {
          create: [{ sortOrder: 0, rawToken: "new", matchStatus: "matched" }],
        },
      },
    });
    await prisma.capture.create({
      data: {
        id: "cap-b",
        userId: "user-b",
        source: "camera",
        status: "uploaded",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        items: {
          create: [{ sortOrder: 0, rawToken: "other", matchStatus: "unknown" }],
        },
      },
    });
    await prisma.capture.create({
      data: {
        id: "cap-old",
        userId: "user-a",
        source: "camera",
        status: "parsed",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        items: {
          create: [{ sortOrder: 0, rawToken: "old", matchStatus: "ambiguous" }],
        },
      },
    });
    await prisma.favorite.createMany({
      data: [
        { userId: "user-a", captureId: "cap-new" },
        { userId: "user-b", captureId: "cap-b" },
        { userId: "user-a", captureId: "cap-old" },
      ],
    });

    const res = await GET(new Request("http://local/api/favorites"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((row: { captureId: string }) => row.captureId)).toEqual(["cap-new", "cap-old"]);
    expect(body.every((row: { userId: string }) => row.userId === "user-a")).toBe(true);
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["capture", "captureId", "userId"]);
      expect(Object.keys(row.capture).sort()).toEqual([
        "blobName",
        "createdAt",
        "id",
        "items",
        "rawText",
        "source",
        "status",
        "updatedAt",
      ]);
      expect(row.capture.items.length).toBeGreaterThan(0);
      for (const item of row.capture.items) {
        expect(Object.keys(item).sort()).toEqual([
          "ingredientId",
          "matchStatus",
          "rawToken",
          "sortOrder",
        ]);
      }
    }
    expect(body[0].capture.items).toEqual([
      { sortOrder: 0, rawToken: "new", ingredientId: null, matchStatus: "matched" },
    ]);
    expect(body[1].capture.items).toEqual([
      { sortOrder: 0, rawToken: "old", ingredientId: null, matchStatus: "ambiguous" },
    ]);
  });
});
