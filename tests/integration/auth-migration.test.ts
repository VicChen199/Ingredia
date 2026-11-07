import { beforeAll, describe, expect, it } from "vitest";

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const db = await import("@project/db");
  prisma = db.prisma;
}, 30000);

describe("Auth.js adapter tables", () => {
  it("enforces Account, Session, and VerificationToken constraints", async () => {
    const user = await prisma.user.create({ data: { id: "user-auth-a" } });
    const other = await prisma.user.create({ data: { id: "user-auth-b" } });
    const expires = new Date("2026-12-01T00:00:00.000Z");

    const account = await prisma.account.create({
      data: {
        id: "account-auth-a",
        userId: user.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-subject-1",
        refresh_token: "refresh-token",
        access_token: "access-token",
        expires_at: 1735689600,
        token_type: "Bearer",
        scope: "openid",
        id_token: "id-token",
        session_state: "session-state",
      },
    });

    expect(account.provider).toBe("google");
    expect(account.providerAccountId).toBe("google-subject-1");
    expect(account.refresh_token).toBe("refresh-token");
    expect(account.access_token).toBe("access-token");
    expect(account.expires_at).toBe(1735689600);
    expect(account.token_type).toBe("Bearer");
    expect(account.scope).toBe("openid");
    expect(account.id_token).toBe("id-token");
    expect(account.session_state).toBe("session-state");
    expect(account).not.toHaveProperty("password");
    expect(account).not.toHaveProperty("google_id");

    await expect(async () => {
      await prisma.account.create({
        data: {
          id: "account-auth-dup",
          userId: other.id,
          type: "oauth",
          provider: "google",
          providerAccountId: "google-subject-1",
        },
      });
    }).rejects.toThrow(/unique/i);

    const otherAccount = await prisma.account.create({
      data: {
        id: "account-auth-b",
        userId: user.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-subject-2",
      },
    });
    expect(otherAccount.providerAccountId).toBe("google-subject-2");

    const session = await prisma.session.create({
      data: {
        id: "session-auth-a",
        sessionToken: "session-token-1",
        userId: user.id,
        expires,
      },
    });
    expect(session.sessionToken).toBe("session-token-1");
    expect(session).not.toHaveProperty("password");
    expect(session).not.toHaveProperty("google_id");

    await expect(async () => {
      await prisma.session.create({
        data: {
          id: "session-auth-dup",
          sessionToken: "session-token-1",
          userId: other.id,
          expires,
        },
      });
    }).rejects.toThrow(/unique/i);

    const verification = await prisma.verificationToken.create({
      data: {
        identifier: "ada@example.com",
        token: "verify-token-1",
        expires,
      },
    });
    expect(verification.identifier).toBe("ada@example.com");
    expect(verification.token).toBe("verify-token-1");
    expect(verification).not.toHaveProperty("userId");
    expect(verification).not.toHaveProperty("password");
    expect(verification).not.toHaveProperty("google_id");

    await expect(async () => {
      await prisma.verificationToken.create({
        data: {
          identifier: "ada@example.com",
          token: "verify-token-1",
          expires,
        },
      });
    }).rejects.toThrow(/unique/i);

    await expect(async () => {
      await prisma.verificationToken.create({
        data: {
          identifier: "other@example.com",
          token: "verify-token-1",
          expires,
        },
      });
    }).rejects.toThrow(/unique/i);

    const linked = await prisma.user.findUnique({
      where: { id: user.id },
      include: { accounts: true, sessions: true },
    });
    expect(linked?.accounts).toHaveLength(2);
    expect(linked?.sessions).toHaveLength(1);

    await prisma.account.delete({ where: { id: otherAccount.id } });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.account.findUnique({ where: { id: otherAccount.id } })).toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(
      await prisma.verificationToken.findUnique({ where: { token: "verify-token-1" } }),
    ).not.toBeNull();
  });
});
