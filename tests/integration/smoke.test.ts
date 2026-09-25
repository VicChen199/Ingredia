import { describe, it, expect, beforeAll } from "vitest";

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const db = await import("@project/db");
  prisma = db.prisma;
}, 30000);

describe("prisma client (PGlite door)", () => {
  it("connects to an in-memory PGlite instance", async () => {
    const result = await prisma.$queryRaw<[{ "?column?": number }]>`SELECT 1`;
    expect(result[0]["?column?"]).toBe(1);
  });

  it("rejects a favorite of another user's capture", async () => {
    const owner = await prisma.user.create({ data: { id: "user-a" } });
    const other = await prisma.user.create({ data: { id: "user-b" } });
    const capture = await prisma.capture.create({
      data: { id: "cap-a", userId: owner.id, source: "camera", status: "uploaded" },
    });

    await expect(
      prisma.favorite.create({ data: { userId: other.id, captureId: capture.id } }),
    ).rejects.toThrow();
  });

  it("restricts deleting an ingredient a capture item still references", async () => {
    const user = await prisma.user.create({ data: { id: "user-c" } });
    const ingredient = await prisma.ingredient.create({
      data: { id: "ing-water", slug: "water", displayName: "Water" },
    });
    await prisma.capture.create({
      data: {
        id: "cap-c",
        userId: user.id,
        source: "camera",
        status: "parsed",
        items: {
          create: {
            sortOrder: 0,
            rawToken: "water",
            ingredientId: ingredient.id,
            matchStatus: "matched",
          },
        },
      },
    });

    await expect(prisma.ingredient.delete({ where: { id: ingredient.id } })).rejects.toThrow();
  });
});
