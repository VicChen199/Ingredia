import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Root Vitest does not depend on @project/auth. Link the workspace package
// so this file can import it.
const authPackageLink = fileURLToPath(new URL("../../node_modules/@project/auth", import.meta.url));
if (!existsSync(authPackageLink)) {
  mkdirSync(dirname(authPackageLink), { recursive: true });
  symlinkSync(fileURLToPath(new URL("../../packages/auth", import.meta.url)), authPackageLink, "dir");
}

const requireFromAuth = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const nextHeaders = requireFromAuth("next/headers") as {
  headers: () => Promise<Headers>;
  cookies: () => Promise<{
    get: (name: string) => { name: string; value: string } | undefined;
    set: (name: string, value: string) => void;
    toString: () => string;
  }>;
};
const originalHeaders = nextHeaders.headers;
const originalCookies = nextHeaders.cookies;

const headerJar = new Map<string, string>();
const cookieJar = new Map<string, string>();

nextHeaders.headers = async () => new Headers(headerJar);
nextHeaders.cookies = async () => ({
  get(name: string) {
    const value = cookieJar.get(name);
    return value === undefined ? undefined : { name, value };
  },
  getAll() {
    return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
  },
  has(name: string) {
    return cookieJar.has(name);
  },
  set(name: string, value: string) {
    cookieJar.set(name, value);
  },
  toString() {
    return headerJar.get("cookie") ?? "";
  },
});

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "test-auth-secret";
process.env.AUTH_GOOGLE_ID = "test-google-id";
process.env.AUTH_GOOGLE_SECRET = "test-google-secret";
delete process.env.AUTH_URL;
delete process.env.NEXTAUTH_URL;
delete process.env.DEV_USER_ID;
delete process.env.ALLOW_DEV_IDENTITY;

const ISSUER = "https://accounts.google.com";
const GOOGLE_HOST = /(^|\.)google(apis)?\.com$/;

type Profile = {
  sub: string;
  name: string;
  email: string;
  picture: string;
  reject?: boolean;
};

const profiles = new Map<string, Profile>();
const issuedIdTokens = new Map<string, string>();
const tokenRequests: { url: string; body: string; authorization: string | null }[] = [];
let publicJwk: JsonWebKey;
let privateKey: CryptoKey;
let lastNonce: string | null = null;

function b64url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes).toString("base64url");
}

async function signIdToken(profile: Profile) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const payload: Record<string, unknown> = {
    iss: ISSUER,
    aud: process.env.AUTH_GOOGLE_ID,
    sub: profile.sub,
    email: profile.email,
    email_verified: true,
    name: profile.name,
    picture: profile.picture,
    iat: now,
    exp: now + 3600,
  };
  if (lastNonce) payload.nonce = lastNonce;
  const body = b64url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!GOOGLE_HOST.test(url.hostname)) return originalFetch(input, init);

  if (url.pathname.endsWith("/.well-known/openid-configuration")) {
    return jsonResponse({
      issuer: ISSUER,
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }

  if (url.pathname.includes("certs") || url.pathname.endsWith("/jwks")) {
    return jsonResponse({ keys: [publicJwk] });
  }

  const authorization = new Headers(init?.headers).get("authorization");
  const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

  if (method === "POST" || body.includes("code=")) {
    tokenRequests.push({ url: url.href, body, authorization });
    const code = new URLSearchParams(body).get("code") ?? "";
    const profile = profiles.get(code);
    if (!profile || profile.reject) return jsonResponse({ error: "invalid_grant" }, 400);
    const idToken = await signIdToken(profile);
    issuedIdTokens.set(code, idToken);
    return jsonResponse({
      access_token: `access-${profile.sub}`,
      refresh_token: `refresh-${profile.sub}`,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      session_state: `state-${profile.sub}`,
    });
  }

  const accessToken = (authorization ?? "").replace(/^Bearer /i, "");
  const profile = [...profiles.values()].find((item) => `access-${item.sub}` === accessToken);
  return jsonResponse({
    sub: profile?.sub,
    name: profile?.name,
    email: profile?.email,
    picture: profile?.picture,
  });
};

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;
let signIn: ((provider: string) => Promise<unknown>) | undefined;
let GET: ((request: Request) => Promise<Response>) | undefined;

const loginPagePath = fileURLToPath(new URL("../../apps/web/app/login/page.tsx", import.meta.url));
const compiledLoginPage = fileURLToPath(new URL("../../apps/web/.google-sign-in-page.mjs", import.meta.url));

function resetRequest() {
  headerJar.clear();
  cookieJar.clear();
  headerJar.set("host", "localhost:3000");
  headerJar.set("x-forwarded-host", "localhost:3000");
  headerJar.set("x-forwarded-proto", "http");
  headerJar.set("referer", "http://localhost:3000/login");
}

function redirectUrlOf(error: unknown) {
  const digest = (error as { digest?: string }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw error;
  return digest.split(";").slice(2, -2).join(";");
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function sessionTokens(response: Response) {
  return response.headers.getSetCookie().flatMap((line) => {
    const [pair] = line.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator === -1) return [];
    const name = pair.slice(0, separator).trim();
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    if (name !== "authjs.session-token" && name !== "__Secure-authjs.session-token") return [];
    return value ? [value] : [];
  });
}

function locationOf(response: Response) {
  const location = response.headers.get("location");
  expect(location, "redirect location").toEqual(expect.any(String));
  return new URL(location ?? "", "http://localhost:3000");
}

async function counts() {
  const [users, accounts, sessions] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.session.count(),
  ]);
  return { users, accounts, sessions };
}

async function startGoogleSignIn() {
  resetRequest();
  tokenRequests.length = 0;
  expect(signIn, 'signIn("google")').toEqual(expect.any(Function));
  try {
    await signIn!("google");
  } catch (error) {
    const url = new URL(redirectUrlOf(error));
    lastNonce = url.searchParams.get("nonce");
    return url;
  }
  throw new Error('signIn("google") did not redirect');
}

async function callback(code: string, state: string) {
  expect(GET, "GET /api/auth/callback/google").toEqual(expect.any(Function));
  return GET!(
    new Request(
      `http://localhost:3000/api/auth/callback/google?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie: cookieHeader(),
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        },
      },
    ),
  );
}

async function finishGoogleSignIn(code: string, profile: Profile) {
  profiles.set(code, profile);
  const authorization = await startGoogleSignIn();
  const state = authorization.searchParams.get("state") ?? "state";
  const response = await callback(code, state);
  return { authorization, response };
}

function loadEsbuild() {
  const pnpmDir = fileURLToPath(new URL("../../node_modules/.pnpm", import.meta.url));
  const entry = readdirSync(pnpmDir).find((name) => name.startsWith("esbuild@"));
  if (!entry) throw new Error("esbuild is not available");
  const requireEsbuild = createRequire(resolve(pnpmDir, entry, "node_modules/esbuild/package.json"));
  return requireEsbuild("esbuild") as {
    build: (options: Record<string, unknown>) => Promise<unknown>;
  };
}

async function loadLoginPage() {
  expect(existsSync(loginPagePath), "/login is not implemented").toBe(true);
  const emptyShim = fileURLToPath(new URL("../../apps/web/.empty-shim.mjs", import.meta.url));
  writeFileSync(emptyShim, "export {};\n");
  const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
  await loadEsbuild().build({
    entryPoints: [loginPagePath],
    outfile: compiledLoginPage,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    absWorkingDir: webRoot,
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "login-page-externals",
        setup(build: {
          onResolve: (
            options: { filter: RegExp },
            callback: (args: { path: string }) => { path: string; external?: boolean } | undefined,
          ) => void;
        }) {
          build.onResolve({ filter: /^(react|react-dom|next|@project\/)/ }, (args) => ({
            path: args.path,
            external: true,
          }));
          build.onResolve({ filter: /^(server-only|client-only)$/ }, () => ({ path: emptyShim }));
          build.onResolve({ filter: /^@\// }, (args) => ({
            path: resolve(webRoot, args.path.slice(2)),
          }));
        },
      },
    ],
  });
  const imported = (await import(`${compiledLoginPage}?ts=${Date.now()}`)) as {
    default: (props: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<unknown>;
  };
  return imported.default;
}

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function walk(node: unknown, visit: (node: { type?: unknown; props?: Record<string, unknown> }) => void) {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node === "object" && node !== null && "props" in node) {
    const element = node as { type?: unknown; props?: Record<string, unknown> };
    visit(element);
    for (const value of Object.values(element.props ?? {})) walk(value, visit);
  }
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = keyPair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  publicJwk.kid = "test-key";
  delete publicJwk.key_ops;

  const db = await import("@project/db");
  prisma = db.prisma;
  const auth = (await import("@project/auth")) as {
    signIn?: (provider: string) => Promise<unknown>;
    handlers?: { GET?: (request: Request) => Promise<Response> };
  };
  signIn = auth.signIn;
  const route = (await import("../../apps/web/app/api/auth/[...nextauth]/route.ts")) as {
    GET?: (request: Request) => Promise<Response>;
  };
  GET = route.GET;
}, 30000);

beforeEach(async () => {
  resetRequest();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(() => {
  nextHeaders.headers = originalHeaders;
  nextHeaders.cookies = originalCookies;
  globalThis.fetch = originalFetch;
  rmSync(compiledLoginPage, { force: true });
  rmSync(fileURLToPath(new URL("../../apps/web/.empty-shim.mjs", import.meta.url)), { force: true });
});

describe("google sign-in invariant", () => {
  it("does not link a Google account when the email already belongs to a User", async () => {
    const existing = await prisma.user.create({
      data: { name: "Existing Person", email: "taken@example.com", image: null },
    });
    const { response } = await finishGoogleSignIn("code-taken", {
      sub: "google-taken",
      name: "Taken Google",
      email: "taken@example.com",
      picture: "https://example.com/taken.png",
    });

    expect(response.status).toBe(302);
    const location = locationOf(response);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toEqual(expect.any(String));
    expect(sessionTokens(response)).toEqual([]);
    expect(await prisma.user.findUnique({ where: { id: existing.id } })).toEqual(existing);
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);

    const other = await prisma.user.create({ data: { id: "user-email-other" } });
    await expect(
      prisma.user.create({ data: { id: "user-email-dup", email: "taken@example.com" } }),
    ).rejects.toThrow(/unique/i);
    await prisma.account.create({
      data: {
        userId: existing.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-unique-pair",
      },
    });
    await expect(
      prisma.account.create({
        data: {
          userId: other.id,
          type: "oauth",
          provider: "google",
          providerAccountId: "google-unique-pair",
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});

describe("complete-google-sign-in", () => {
  it("GET /api/auth/callback/google?code&state creates the user or reports failure", async () => {
    const started = await startGoogleSignIn();
    expect(started.hostname).toBe("accounts.google.com");
    expect(started.searchParams.get("client_id")).toBe("test-google-id");
    expect(started.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(await counts()).toEqual({ users: 0, accounts: 0, sessions: 0 });

    profiles.set("code-rejected", {
      sub: "google-rejected",
      name: "Rejected",
      email: "rejected@example.com",
      picture: "https://example.com/rejected.png",
      reject: true,
    });
    const rejected = await callback("code-rejected", started.searchParams.get("state") ?? "state");
    expect(rejected.status).toBe(302);
    const rejectedLocation = locationOf(rejected);
    expect(rejectedLocation.pathname).toBe("/login");
    expect(rejectedLocation.searchParams.get("error")).toEqual(expect.any(String));
    expect(sessionTokens(rejected)).toEqual([]);
    expect(await counts()).toEqual({ users: 0, accounts: 0, sessions: 0 });

    const ada = {
      sub: "google-ada",
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://example.com/ada.png",
    };
    const created = await finishGoogleSignIn("code-ada", ada);
    expect(created.authorization.hostname).toBe("accounts.google.com");
    expect(created.response.status).toBe(302);
    const createdLocation = locationOf(created.response);
    expect(createdLocation.pathname).toBe("/login");
    expect(createdLocation.searchParams.has("error")).toBe(false);

    const exchange = tokenRequests.find((request) => request.body.includes("code=code-ada"));
    expect(exchange?.url).toContain("googleapis.com");
    expect(exchange?.body).toContain("code=code-ada");
    expect(Buffer.from((exchange?.authorization ?? "").replace(/^Basic\s+/i, ""), "base64").toString()).toBe(
      "test-google-id:test-google-secret",
    );

    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: "https://example.com/ada.png",
    });
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: "google-ada" } },
    });
    const now = Math.floor(Date.now() / 1000);
    expect(account).toMatchObject({
      userId: user?.id,
      type: "oauth",
      provider: "google",
      providerAccountId: "google-ada",
      refresh_token: "refresh-google-ada",
      access_token: "access-google-ada",
      token_type: "bearer",
      scope: "openid email profile",
      id_token: issuedIdTokens.get("code-ada"),
      session_state: "state-google-ada",
    });
    expect(account?.expires_at).toBeGreaterThanOrEqual(now + 3600 - 120);
    expect(account?.expires_at).toBeLessThanOrEqual(now + 3600 + 120);

    const [sessionCookie] = sessionTokens(created.response);
    expect(sessionCookie).toEqual(expect.any(String));
    const session = await prisma.session.findUnique({ where: { sessionToken: sessionCookie } });
    expect(session?.userId).toBe(user?.id);

    const again = await finishGoogleSignIn("code-ada-again", ada);
    expect(again.response.status).toBe(302);
    expect(locationOf(again.response).pathname).toBe("/login");
    expect(await prisma.user.count({ where: { email: "ada@example.com" } })).toBe(1);
    expect(
      await prisma.account.count({ where: { provider: "google", providerAccountId: "google-ada" } }),
    ).toBe(1);
    const againCookie = sessionTokens(again.response)[0];
    const againSession = await prisma.session.findUnique({ where: { sessionToken: againCookie } });
    expect(againSession?.userId).toBe(user?.id);

    await finishGoogleSignIn("code-grace", {
      sub: "google-grace",
      name: "Grace Hopper",
      email: "grace@example.com",
      picture: "https://example.com/grace.png",
    });
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.account.count({ where: { provider: "google" } })).toBe(2);
  });
});

describe("/login", () => {
  it("shows Sign in with Google, shows Sign-in failed, and redirects a session to /", async () => {
    const page = await loadLoginPage();
    const user = await prisma.user.create({
      data: { name: "Signed In", email: "signed-in@example.com" },
    });
    await prisma.session.create({
      data: {
        sessionToken: "login-session",
        userId: user.id,
        expires: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    headerJar.set("cookie", "authjs.session-token=login-session");

    let redirected = "";
    try {
      await page({ searchParams: Promise.resolve({}) });
    } catch (error) {
      redirected = redirectUrlOf(error);
    }
    const home = new URL(redirected || "http://localhost:3000/stay", "http://localhost:3000");
    expect(home.pathname).toBe("/");

    headerJar.delete("cookie");
    const signingIn = await page({ searchParams: Promise.resolve({}) });
    const failed = await page({ searchParams: Promise.resolve({ error: "OAuthAccountNotLinked" }) });
    for (const screen of [signingIn, failed]) {
      const buttons: { type?: unknown; props?: Record<string, unknown> }[] = [];
      const actions: string[] = [];
      walk(screen, (element) => {
        if (element.type === "button") buttons.push(element);
        for (const value of Object.values(element.props ?? {})) {
          if (typeof value === "function") actions.push(Function.prototype.toString.call(value));
        }
      });
      expect(buttons.some((button) => textOf(button).includes("Sign in with Google"))).toBe(true);
      // The runner rewrites an imported call to (0,__vite_ssr_import_N__.signIn)(...) before toString.
      const calls = actions.map((source) =>
        source.replace(/\(0\s*,\s*__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\)/g, "$1"),
      );
      expect(calls.some((source) => /signIn\(\s*["']google["']\s*\)/.test(source))).toBe(true);
      expect(calls.some((source) => /signIn\(\s*["']google["']\s*,/.test(source))).toBe(false);
    }
    expect(textOf(failed)).toContain("Sign-in failed");
  });
});
