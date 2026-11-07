import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A cookie-less gated document. The slice names no new screen; this path is
// any page outside the public skip list.
const gatedPage = "/history";
const gatedApi = "/api/captures";

const sessionCookies = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

const { currentUserId } = vi.hoisted(() => ({
  currentUserId: vi.fn(async () => {
    throw new Error("no session");
  }),
}));
vi.mock("@project/auth", () => ({ currentUserId }));
vi.mock("../../packages/auth/src/index.ts", () => ({ currentUserId }));
vi.mock("../../packages/auth/src/current-user.ts", () => ({ currentUserId }));

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;

const requireFromWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { unstable_doesMiddlewareMatch } = requireFromWeb("next/experimental/testing/server") as {
  unstable_doesMiddlewareMatch: (args: {
    config: { matcher?: unknown };
    url: string;
    headers?: Record<string, string>;
  }) => boolean;
};

type Gate = {
  middleware: (request: NextRequest) => Response | Promise<Response | undefined | null> | undefined | null;
  config?: { matcher?: unknown };
};

let gate: Gate;
let prisma: import("@project/db").PrismaClient;
let capturesGet: typeof import("../../apps/web/app/api/captures/route").GET;
let healthGet: typeof import("../../apps/web/app/api/health/route").GET;

function importedSpecifiers(source: string) {
  const found: string[] = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) found.push(match[1]);
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]);
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]);
  return found;
}

function forbidsPrismaOrAuth(specifier: string) {
  return (
    specifier === "@project/auth" ||
    specifier.startsWith("@project/auth/") ||
    specifier === "@project/db" ||
    specifier.startsWith("@project/db/") ||
    specifier === "prisma" ||
    specifier.startsWith("prisma/") ||
    specifier.startsWith("@prisma/")
  );
}

function continues(response: Response | undefined | null) {
  if (response == null) return true;
  return response.headers.get("x-middleware-next") === "1";
}

function locationPath(response: Response) {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const pathname = new URL(location!, "http://localhost").pathname;
  return pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

async function guard(pathname: string, cookie?: string) {
  const url = `http://localhost${pathname}`;
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const runs = unstable_doesMiddlewareMatch({ config: gate.config ?? {}, url, headers });
  if (!runs) return undefined;
  return gate.middleware(new NextRequest(url, { headers: cookie ? { cookie } : undefined }));
}

describe("guard-request invariant", () => {
  it("reads the session cookies and does not import @project/auth or Prisma", () => {
    const path = fileURLToPath(new URL("../../apps/web/middleware.ts", import.meta.url));
    expect(existsSync(path), "apps/web/middleware.ts").toBe(true);
    const source = readFileSync(path, "utf8");
    expect(source).toContain("__Secure-authjs.session-token");
    expect(source.replaceAll("__Secure-authjs.session-token", "")).toContain("authjs.session-token");
    expect(importedSpecifiers(source).filter(forbidsPrismaOrAuth)).toEqual([]);
  });
});

describe("guard-request", () => {
  beforeAll(async () => {
    try {
      gate = (await import("../../apps/web/middleware.ts")) as Gate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Missing guard-request middleware. A cookie-less gated page does not redirect 307 to /login. A cookie-less gated API does not return 401 { error: { code: "unauthorized", message: "A signed-in user is required" } }. A present or stale cookie does not reach current-user-id. ${message}`,
      );
    }
    expect(typeof gate.middleware, "middleware").toBe("function");
    prisma = (await import("@project/db")).prisma;
    capturesGet = (await import("../../apps/web/app/api/captures/route.ts")).GET;
    healthGet = (await import("../../apps/web/app/api/health/route.ts")).GET;
  }, 30000);

  beforeEach(() => {
    currentUserId.mockReset();
    currentUserId.mockRejectedValue(new Error("no session"));
  });

  it("skips public paths when the session cookie is missing", async () => {
    for (const pathname of [
      "/",
      "/login",
      "/api/health",
      "/api/auth/callback/google",
      "/api/auth/signin",
      "/_next/static/chunks/main.js",
      "/favicon.ico",
      "/logo.png",
    ]) {
      expect(continues(await guard(pathname)), pathname).toBe(true);
    }
  });

  it("leaves a cookie-less /api/health response unchanged", async () => {
    expect(continues(await guard("/api/health"))).toBe(true);
    const response = await healthGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("redirects a cookie-less gated page to /login", async () => {
    const response = await guard(gatedPage);
    expect(response?.status).toBe(307);
    expect(locationPath(response as Response)).toBe("/login");
  });

  it("returns 401 for a cookie-less gated API", async () => {
    const response = await guard(gatedApi);
    expect(response?.status).toBe(401);
    expect(await response!.json()).toEqual({
      error: { code: "unauthorized", message: "A signed-in user is required" },
    });
    expect(currentUserId).not.toHaveBeenCalled();
  });

  it("continues a present session cookie and the handler still runs current-user-id", async () => {
    await prisma.user.create({ data: { id: "user-a" } });
    currentUserId.mockResolvedValue("user-a");
    for (const name of sessionCookies) {
      currentUserId.mockClear();
      expect(continues(await guard(gatedApi, `${name}=present-token`)), name).toBe(true);
      expect(continues(await guard(gatedPage, `${name}=present-token`)), name).toBe(true);
      expect(currentUserId).not.toHaveBeenCalled();
      const response = await capturesGet(new Request("http://localhost/api/captures"));
      expect(currentUserId).toHaveBeenCalled();
      expect(response.status).toBe(200);
    }
  });

  it("lets a stale cookie reach the handler, which answers through its existing catch", async () => {
    for (const name of sessionCookies) {
      currentUserId.mockClear();
      currentUserId.mockRejectedValue(new Error("expired session"));
      expect(continues(await guard(gatedApi, `${name}=stale-token`)), name).toBe(true);
      expect(currentUserId).not.toHaveBeenCalled();
      const response = await capturesGet(new Request("http://localhost/api/captures"));
      expect(currentUserId).toHaveBeenCalled();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "unauthorized", message: "A signed-in user is required" },
      });
    }
  });
});
