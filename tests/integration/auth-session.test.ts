import { createRequire } from "node:module";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Root Vitest does not depend on @project/auth. Link the workspace package
// so this file can import it.
const authPackageLink = fileURLToPath(new URL("../../node_modules/@project/auth", import.meta.url));
if (!existsSync(authPackageLink)) {
  mkdirSync(dirname(authPackageLink), { recursive: true });
  symlinkSync(fileURLToPath(new URL("../../packages/auth", import.meta.url)), authPackageLink, "dir");
}

// Auth.js reads authjs.session-token from the request cookie header.
const headerJar = new Map<string, string>();

const requireFromAuth = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const nextHeaders = requireFromAuth("next/headers") as {
  headers: () => Promise<Headers>;
  cookies: () => Promise<{
    get: (name: string) => { name: string; value: string } | undefined;
    toString: () => string;
  }>;
};
const originalHeaders = nextHeaders.headers;
const originalCookies = nextHeaders.cookies;

function cookieEntries() {
  const cookieHeader = headerJar.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      const name = separator === -1 ? part : part.slice(0, separator);
      const value = separator === -1 ? "" : part.slice(separator + 1);
      return { name, value };
    });
}

nextHeaders.headers = async () => new Headers(headerJar);
nextHeaders.cookies = async () => {
  const entries = cookieEntries();
  return {
    get(name: string) {
      return entries.find((entry) => entry.name === name);
    },
    getAll() {
      return entries;
    },
    has(name: string) {
      return entries.some((entry) => entry.name === name);
    },
    toString() {
      return headerJar.get("cookie") ?? "";
    },
  };
};

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "test-auth-secret";
delete process.env.AUTH_URL;
delete process.env.DEV_USER_ID;
delete process.env.ALLOW_DEV_IDENTITY;

type SessionResult = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
} | null;

let auth: () => Promise<SessionResult>;
let currentUserId: () => Promise<string>;

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;

function resetRequest() {
  headerJar.clear();
  headerJar.set("host", "localhost:3000");
  headerJar.set("x-forwarded-host", "localhost:3000");
  headerJar.set("x-forwarded-proto", "http");
}

function setSessionCookie(token?: string) {
  if (token === undefined) headerJar.delete("cookie");
  else headerJar.set("cookie", `authjs.session-token=${token}`);
}

beforeAll(async () => {
  const authModule = (await import("@project/auth")) as {
    auth?: () => Promise<SessionResult>;
    currentUserId: () => Promise<string>;
  };
  auth = authModule.auth as () => Promise<SessionResult>;
  currentUserId = authModule.currentUserId;
  const db = await import("@project/db");
  prisma = db.prisma;
}, 30000);

beforeEach(() => {
  resetRequest();
  delete process.env.DEV_USER_ID;
  delete process.env.ALLOW_DEV_IDENTITY;
});

afterAll(() => {
  nextHeaders.headers = originalHeaders;
  nextHeaders.cookies = originalCookies;
});

describe("read-session", () => {
  it("returns the user on an unexpired authjs.session-token cookie", async () => {
    const user = await prisma.user.create({
      data: {
        id: "user-read-session",
        name: "Ada Lovelace",
        email: "ada-read-session@example.com",
        image: "https://example.com/ada.png",
      },
    });
    await prisma.session.create({
      data: {
        id: "session-read-valid",
        sessionToken: "session-token-valid",
        userId: user.id,
        expires: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    setSessionCookie("session-token-valid");
    headerJar.set("x-user-id", "header-user");
    process.env.DEV_USER_ID = "env-user";
    process.env.ALLOW_DEV_IDENTITY = "1";

    const session = await auth();

    expect(session).toMatchObject({
      user: {
        id: user.id,
        name: "Ada Lovelace",
        email: "ada-read-session@example.com",
        image: "https://example.com/ada.png",
      },
    });
    expect(await currentUserId()).toBe(user.id);
  });

  it("returns null and does not throw when the session cookie is missing", async () => {
    await expect(auth()).resolves.toBeNull();
  });

  it("returns null and does not throw when the session token matches no Session", async () => {
    setSessionCookie("session-token-unknown");
    await expect(auth()).resolves.toBeNull();
  });

  it("returns null and does not throw when the session is expired", async () => {
    const user = await prisma.user.create({
      data: {
        id: "user-read-expired",
        name: "Grace Hopper",
        email: "grace-read-expired@example.com",
        image: "https://example.com/grace.png",
      },
    });
    await prisma.session.create({
      data: {
        id: "session-read-expired",
        sessionToken: "session-token-expired",
        userId: user.id,
        expires: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    setSessionCookie("session-token-expired");

    await expect(auth()).resolves.toBeNull();
  });
});

describe("current-user-id", () => {
  it("throws when the session cookie is missing", async () => {
    await expect(currentUserId()).rejects.toThrow();
  });

  it("throws when the session token matches no Session", async () => {
    setSessionCookie("session-token-missing");
    await expect(currentUserId()).rejects.toThrow();
  });

  it("throws when the session is expired", async () => {
    const user = await prisma.user.create({
      data: {
        id: "user-current-expired",
        name: "Expired User",
        email: "expired-current-user@example.com",
        image: null,
      },
    });
    await prisma.session.create({
      data: {
        id: "session-current-expired",
        sessionToken: "session-token-current-expired",
        userId: user.id,
        expires: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    setSessionCookie("session-token-current-expired");

    await expect(currentUserId()).rejects.toThrow();
  });

  it("throws instead of using x-user-id, DEV_USER_ID, or demo-user", async () => {
    headerJar.set("x-user-id", "header-user");
    process.env.DEV_USER_ID = "env-user";
    process.env.ALLOW_DEV_IDENTITY = "1";

    await expect(currentUserId()).rejects.toThrow();
    await expect(auth()).resolves.toBeNull();
  });
});

describe("auth handlers route", () => {
  it("re-exports handlers from the Auth.js route module", async () => {
    const routeUrl = new URL("../../apps/web/app/api/auth/[...nextauth]/route.ts", import.meta.url);
    const route = (await import(routeUrl.href)) as { handlers?: unknown };
    expect(route.handlers).toBeDefined();
  });
});
