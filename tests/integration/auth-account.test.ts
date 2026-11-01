import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "unlink-account-user";

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "test-auth-secret";
process.env.AUTH_GOOGLE_ID = "test-google-id";
process.env.AUTH_GOOGLE_SECRET = "test-google-secret";
delete process.env.AUTH_URL;
delete process.env.NEXTAUTH_URL;
delete process.env.DEV_USER_ID;
delete process.env.ALLOW_DEV_IDENTITY;

vi.mock("../../packages/auth/src/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/auth/src/index")>();
  return {
    ...actual,
    currentUserId: async () => TEST_USER_ID,
  };
});

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;

const routePath = fileURLToPath(
  new URL("../../apps/web/app/api/account/google/route.ts", import.meta.url),
);

beforeAll(async () => {
  prisma = (await import("@project/db")).prisma;
}, 30000);

beforeEach(async () => {
  await prisma.user.deleteMany();
});

async function ownRows(userId: string, providerAccountId: string | null) {
  await prisma.user.create({
    data: { id: userId, name: userId, email: `${userId}@example.com` },
  });
  await prisma.capture.create({
    data: { id: `capture-${userId}`, userId, source: "camera", status: "uploaded" },
  });
  await prisma.favorite.create({
    data: { userId, captureId: `capture-${userId}` },
  });
  await prisma.session.create({
    data: {
      sessionToken: `session-${userId}`,
      userId,
      expires: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  if (providerAccountId) {
    await prisma.account.create({
      data: {
        userId,
        type: "oauth",
        provider: "google",
        providerAccountId,
      },
    });
  }
  await prisma.account.create({
    data: {
      userId,
      type: "oauth",
      provider: "other",
      providerAccountId: `other-${userId}`,
    },
  });
}

async function expectKept(userId: string) {
  expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
  expect(await prisma.capture.findUnique({ where: { id: `capture-${userId}` } })).not.toBeNull();
  expect(
    await prisma.favorite.findUnique({
      where: { userId_captureId: { userId, captureId: `capture-${userId}` } },
    }),
  ).not.toBeNull();
  expect(await prisma.session.findUnique({ where: { sessionToken: `session-${userId}` } })).not.toBeNull();
  expect(await prisma.account.count({ where: { userId, provider: "other" } })).toBe(1);
}

describe("Account (provider, providerAccountId)", () => {
  it("rejects a duplicate pair and keeps a different providerAccountId as a different user", async () => {
    const ada = await prisma.user.create({
      data: { id: "account-user-ada", email: "ada-account@example.com" },
    });
    const grace = await prisma.user.create({
      data: { id: "account-user-grace", email: "grace-account@example.com" },
    });

    const adaAccount = await prisma.account.create({
      data: {
        userId: ada.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-ada",
      },
    });
    const graceAccount = await prisma.account.create({
      data: {
        userId: grace.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-grace",
      },
    });

    expect(adaAccount.userId).toBe(ada.id);
    expect(graceAccount.userId).toBe(grace.id);
    expect(adaAccount.userId).not.toBe(graceAccount.userId);
    expect(adaAccount.providerAccountId).not.toBe(graceAccount.providerAccountId);

    await expect(
      prisma.account.create({
        data: {
          userId: grace.id,
          type: "oauth",
          provider: "google",
          providerAccountId: "google-ada",
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});

describe("unlinkGoogleAccount", () => {
  it("deletes the Google account and leaves User, Capture, Favorite, and Session", async () => {
    const auth = await vi.importActual<typeof import("../../packages/auth/src/index")>(
      "../../packages/auth/src/index",
    );
    const unlinkGoogleAccount = (
      auth as { unlinkGoogleAccount?: (userId: string) => Promise<unknown> }
    ).unlinkGoogleAccount;
    expect(unlinkGoogleAccount, "unlinkGoogleAccount(userId)").toEqual(expect.any(Function));

    await ownRows(TEST_USER_ID, "google-unlink");
    const otherId = "unlink-other-user";
    await ownRows(otherId, "google-other");

    await unlinkGoogleAccount!(TEST_USER_ID);

    expect(await prisma.account.count({ where: { userId: TEST_USER_ID, provider: "google" } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: otherId, provider: "google" } })).toBe(1);
    await expectKept(TEST_USER_ID);
    await expectKept(otherId);
  });
});

describe("DELETE /api/account/google", () => {
  async function loadDelete() {
    expect(existsSync(routePath), "DELETE /api/account/google").toBe(true);
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("currentUserId(");
    expect(source).toContain("unlinkGoogleAccount(");
    const route = (await import("../../apps/web/app/api/account/google/route.ts")) as {
      DELETE?: (request: Request) => Promise<Response>;
    };
    expect(route.DELETE, "DELETE /api/account/google").toEqual(expect.any(Function));
    return route.DELETE!;
  }

  function request() {
    return new Request("http://localhost/api/account/google", { method: "DELETE" });
  }

  it("returns 204 empty when a Google account row was deleted", async () => {
    const DELETE = await loadDelete();
    await ownRows(TEST_USER_ID, "google-route");
    const otherId = "route-other-user";
    await ownRows(otherId, "google-route-other");

    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await prisma.account.count({ where: { userId: TEST_USER_ID, provider: "google" } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: otherId, provider: "google" } })).toBe(1);
    await expectKept(TEST_USER_ID);
    await expectKept(otherId);
  });

  it("returns 404 when no Google account is linked", async () => {
    const DELETE = await loadDelete();
    await ownRows(TEST_USER_ID, null);

    const response = await DELETE(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Google account not linked" },
    });
    expect(await prisma.account.count({ where: { userId: TEST_USER_ID, provider: "google" } })).toBe(0);
    await expectKept(TEST_USER_ID);
  });
});
