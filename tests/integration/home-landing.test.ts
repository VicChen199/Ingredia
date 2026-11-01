import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type LandingAuthCalls = { auth: number; currentUserId: number; signOut: number };

function landingCalls(): LandingAuthCalls {
  const holder = globalThis as typeof globalThis & { __landingAuthCalls?: LandingAuthCalls };
  holder.__landingAuthCalls ??= { auth: 0, currentUserId: 0, signOut: 0 };
  return holder.__landingAuthCalls;
}

const requireFromAuth = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const nextHeaders = requireFromAuth("next/headers") as {
  headers: () => Promise<Headers>;
  cookies: () => Promise<{
    get: (name: string) => { name: string; value: string } | undefined;
    set: (name: string, value: string, options?: { maxAge?: number; expires?: Date }) => void;
    delete?: (name: string) => void;
  }>;
};
const originalHeaders = nextHeaders.headers;
const originalCookies = nextHeaders.cookies;

const headerJar = new Map<string, string>();
const cookieJar = new Map<string, string>();

function syncCookieHeader() {
  const cookie = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headerJar.set("cookie", cookie);
  else headerJar.delete("cookie");
}

function clearedCookie(value: string, options?: { maxAge?: number; expires?: Date }) {
  if (typeof options?.maxAge === "number" && options.maxAge <= 0) return true;
  if (options?.expires instanceof Date && options.expires.getTime() <= Date.now()) return true;
  return value === "";
}

nextHeaders.headers = async () => {
  syncCookieHeader();
  return new Headers(headerJar);
};
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
  set(
    name: string,
    value: string,
    options?: { maxAge?: number; expires?: Date },
  ) {
    if (typeof name === "object" && name !== null) {
      const cookie = name as { name: string; value: string; maxAge?: number; expires?: Date };
      this.set(cookie.name, cookie.value, cookie);
      return;
    }
    if (clearedCookie(value, options)) cookieJar.delete(name);
    else cookieJar.set(name, value);
    syncCookieHeader();
  },
  delete(name: string) {
    cookieJar.delete(name);
    syncCookieHeader();
  },
  toString() {
    syncCookieHeader();
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

const requireFromWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (node: unknown) => string;
};

const pagePath = fileURLToPath(new URL("../../apps/web/app/page.tsx", import.meta.url));
const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const scratch = mkdtempSync(resolve(tmpdir(), "home-landing-"));
const compiledPage = resolve(webRoot, ".home-landing-page.mjs");
const emptyShim = resolve(scratch, "empty-shim.mjs");

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;
let home: () => Promise<unknown>;

function resetRequest() {
  headerJar.clear();
  cookieJar.clear();
  headerJar.set("host", "localhost:3000");
  headerJar.set("x-forwarded-host", "localhost:3000");
  headerJar.set("x-forwarded-proto", "http");
  headerJar.set("referer", "http://localhost:3000/");
  syncCookieHeader();
  const calls = landingCalls();
  calls.auth = 0;
  calls.currentUserId = 0;
  calls.signOut = 0;
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

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
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

function functionSource(value: unknown) {
  if (typeof value !== "function") return "";
  return Function.prototype.toString.call(value).replace(
    /\(0\s*,\s*__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\)/g,
    "$1",
  );
}

function screenBlob(node: unknown) {
  const parts: string[] = [textOf(node)];
  try {
    parts.push(renderToStaticMarkup(node));
  } catch {
    // The element tree still carries the server render and client function source.
  }
  walk(node, (element) => {
    parts.push(functionSource(element.type));
    for (const value of Object.values(element.props ?? {})) parts.push(functionSource(value));
  });
  return parts.filter(Boolean).join("\n");
}

function loginHrefs(node: unknown) {
  const hrefs: string[] = [];
  walk(node, (element) => {
    const href = element.props?.href;
    if (typeof href === "string") hrefs.push(href);
  });
  for (const match of screenBlob(node).matchAll(/href=["']([^"']+)["']/g)) hrefs.push(match[1] ?? "");
  return hrefs;
}

function isLoginHref(href: string) {
  return href === "/login" || href.endsWith("/login");
}

function redirectPath(error: unknown) {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  const url = digest.split(";").slice(2, -2).join(";");
  return new URL(url || "/", "http://localhost:3000").pathname;
}

type Handler = (...args: unknown[]) => Promise<unknown> | unknown;

// The bundler renames the imported binding (`signOut2`) when the action shares the name.
function sourceCallsSignOut(source: string) {
  return /signOut\d*\s*\(/.test(source);
}

function sourceDeletesGoogle(source: string) {
  return /fetch\s*\(\s*["'`]\/api\/account\/google["'`][\s\S]{0,240}DELETE/.test(source);
}

function componentFn(type: unknown, seen = new Set<unknown>()): ((props: unknown) => unknown) | undefined {
  if (typeof type === "function") return type as (props: unknown) => unknown;
  if (typeof type !== "object" || type === null || seen.has(type)) return undefined;
  seen.add(type);
  const record = type as { render?: unknown; type?: unknown };
  if (typeof record.render === "function") return record.render as (props: unknown) => unknown;
  if (record.type) return componentFn(record.type, seen);
  return undefined;
}

function eventHandlers(props: Record<string, unknown> | undefined) {
  const handlers: Handler[] = [];
  for (const key of ["action", "formAction", "onClick", "onSubmit"]) {
    const value = props?.[key];
    if (typeof value === "function") handlers.push(value as Handler);
  }
  return handlers;
}

function installHookDispatcher() {
  const requireFromPage = createRequire(compiledPage);
  const react = requireFromPage("react") as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  };
  const internals = react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const state: unknown[] = [];
  let cursor = 0;
  const slot = (initial: unknown) => {
    const index = cursor++;
    if (!Object.prototype.hasOwnProperty.call(state, index)) state[index] = initial;
    return index;
  };
  const dispatcher = {
    useState(initial: unknown) {
      const index = slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [
        state[index],
        (update: unknown) => {
          state[index] = typeof update === "function" ? (update as (value: unknown) => unknown)(state[index]) : update;
        },
      ];
    },
    useReducer(reducer: (value: unknown, action: unknown) => unknown, initial: unknown, init?: (value: unknown) => unknown) {
      const index = slot(init ? init(initial) : initial);
      return [state[index], (action: unknown) => { state[index] = reducer(state[index], action); }];
    },
    useRef(initial: unknown) {
      const index = slot(undefined);
      if (state[index] === undefined) state[index] = { current: initial };
      return state[index];
    },
    useMemo(factory: () => unknown) {
      cursor += 1;
      return factory();
    },
    useCallback(callback: unknown) {
      cursor += 1;
      return callback;
    },
    useEffect() { cursor += 1; },
    useLayoutEffect() { cursor += 1; },
    useInsertionEffect() { cursor += 1; },
    useImperativeHandle() { cursor += 1; },
    useDebugValue() {},
    useDeferredValue(value: unknown) {
      cursor += 1;
      return value;
    },
    useTransition() {
      cursor += 1;
      return [false, (callback: () => unknown) => callback()];
    },
    useId() {
      cursor += 1;
      return "unlink-google";
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown, getServerSnapshot?: () => unknown) {
      cursor += 1;
      return getServerSnapshot ? getServerSnapshot() : getSnapshot();
    },
    useOptimistic(passthrough: unknown) {
      cursor += 1;
      return [passthrough, () => {}];
    },
    useActionState(action: unknown, initial: unknown) {
      cursor += 1;
      return [initial, action, false];
    },
    useFormState(action: unknown, initial: unknown) {
      cursor += 1;
      return [initial, action, false];
    },
    useContext() {
      cursor += 1;
      return undefined;
    },
    useHostTransitionStatus() {
      cursor += 1;
      return { pending: false, data: null, method: null, action: null };
    },
    useMemoCache(size: number) {
      return Array.from({ length: size }, () => null);
    },
    useCacheRefresh() {
      return () => {};
    },
    useEffectEvent(callback: unknown) {
      return callback;
    },
    use(usable: unknown) {
      return usable;
    },
  };
  internals.H = new Proxy(dispatcher, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop as keyof typeof target];
      return () => undefined;
    },
  });
  return () => {
    internals.H = previous;
  };
}

async function callComponent(fn: (props: unknown) => unknown, props: unknown) {
  const restore = installHookDispatcher();
  try {
    const rendered = fn(props ?? {});
    if (rendered && typeof (rendered as { then?: unknown }).then === "function") {
      return await (rendered as Promise<unknown>);
    }
    return rendered;
  } finally {
    restore();
  }
}

function findSignOut(node: unknown) {
  let found: (() => Promise<unknown> | unknown) | undefined;
  walk(node, (element) => {
    if (!textOf(element).includes("Sign out")) return;
    for (const key of ["action", "formAction", "onClick"]) {
      const value = element.props?.[key];
      if (typeof value === "function" && sourceCallsSignOut(functionSource(value))) {
        found = value as () => Promise<unknown>;
      }
    }
  });
  return found;
}

async function findUnlink(node: unknown) {
  const found: Handler[] = [];
  const seen = new Set<unknown>();
  const components: Array<{ fn: (props: unknown) => unknown; props: unknown }> = [];
  walk(node, (element) => {
    for (const handler of eventHandlers(element.props)) {
      if (sourceDeletesGoogle(functionSource(handler))) found.push(handler);
    }
    const fn = componentFn(element.type);
    if (!fn || seen.has(fn)) return;
    const source = functionSource(fn);
    if (!sourceDeletesGoogle(source) || !source.includes("Unlink Google")) return;
    seen.add(fn);
    components.push({ fn, props: element.props });
  });

  const ranked: Array<{ len: number; handler: Handler; deletes: boolean }> = [];
  for (const component of components) {
    const rendered = await callComponent(component.fn, component.props);
    walk(rendered, (element) => {
      const text = textOf(element);
      for (const handler of eventHandlers(element.props)) {
        const deletes = sourceDeletesGoogle(functionSource(handler));
        if (deletes || text.includes("Unlink Google")) {
          ranked.push({ len: text.length, handler, deletes });
        }
      }
    });
  }
  ranked.sort((a, b) => Number(b.deletes) - Number(a.deletes) || a.len - b.len);
  for (const item of ranked) {
    if (!found.includes(item.handler)) found.push(item.handler);
  }
  return found;
}

async function renderHome() {
  const calls = landingCalls();
  calls.auth = 0;
  calls.currentUserId = 0;
  calls.signOut = 0;
  try {
    return { node: await home(), thrown: undefined as unknown };
  } catch (thrown) {
    return { node: undefined as unknown, thrown };
  }
}

beforeAll(async () => {
  writeFileSync(emptyShim, "export {};\n");
  const authStub = [
    'import * as real from "@project/auth-real";',
    "const calls = (globalThis.__landingAuthCalls ??= { auth: 0, currentUserId: 0, signOut: 0 });",
    "export async function auth(...args) {",
    "  calls.auth += 1;",
    "  return real.auth(...args);",
    "}",
    "export async function currentUserId(...args) {",
    "  calls.currentUserId += 1;",
    "  return real.currentUserId(...args);",
    "}",
    "export async function signOut(...args) {",
    "  calls.signOut += 1;",
    '  if (typeof real.signOut !== "function") throw new Error("signOut() is not exported");',
    "  return real.signOut(...args);",
    "}",
    "export const signIn = real.signIn;",
    "export const handlers = real.handlers;",
    "",
  ].join("\n");

  await loadEsbuild().build({
    entryPoints: [pagePath],
    outfile: compiledPage,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    absWorkingDir: webRoot,
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "home-landing",
        setup(build: {
          onResolve: (
            options: { filter: RegExp },
            callback: (args: { path: string }) => { path: string; external?: boolean; namespace?: string } | undefined,
          ) => void;
          onLoad: (
            options: { filter: RegExp; namespace?: string },
            callback: () => { contents: string; loader: string },
          ) => void;
        }) {
          build.onResolve({ filter: /^@project\/auth$/ }, () => ({
            path: "landing-auth",
            namespace: "landing-auth",
          }));
          build.onResolve({ filter: /^@project\/auth-real$/ }, () => ({
            path: "@project/auth",
            external: true,
          }));
          build.onResolve({ filter: /^(react|react-dom|next|@project\/)/ }, (args) => ({
            path: args.path,
            external: true,
          }));
          build.onResolve({ filter: /^(server-only|client-only)$/ }, () => ({ path: emptyShim }));
          build.onResolve({ filter: /^@\// }, (args) => ({
            path: resolve(webRoot, args.path.slice(2)),
          }));
          build.onLoad({ filter: /.*/, namespace: "landing-auth" }, () => ({
            contents: authStub,
            loader: "js",
          }));
        },
      },
    ],
  });

  const imported = (await import(`${compiledPage}?ts=${Date.now()}`)) as {
    default: () => Promise<unknown>;
  };
  home = imported.default;
  prisma = (await import("@project/db")).prisma;
}, 30000);

beforeEach(async () => {
  resetRequest();
  await prisma.user.deleteMany();
});

afterAll(() => {
  nextHeaders.headers = originalHeaders;
  nextHeaders.cookies = originalCookies;
  rmSync(compiledPage, { force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe("signed-out /", () => {
  it("runs read-session, shows a link to /login, and does not call currentUserId()", async () => {
    const screen = await renderHome();

    expect(landingCalls().currentUserId, "signed-out / does not call currentUserId()").toBe(0);
    expect(landingCalls().auth, "signed-out / runs read-session").toBeGreaterThan(0);
    expect(screen.thrown, "signed-out / shows the landing").toBeUndefined();
    expect(loginHrefs(screen.node).some(isLoginHref), "signed-out / shows a link to /login").toBe(true);
  });
});

describe("signed-in /", () => {
  async function signIn(userId: string, token: string) {
    await prisma.user.create({
      data: { id: userId, name: "Ada Lovelace", email: `${userId}@example.com` },
    });
    await prisma.session.create({
      data: {
        sessionToken: token,
        userId,
        expires: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    cookieJar.set("authjs.session-token", token);
    syncCookieHeader();
  }

  it("shows the preferences panel, Sign out, Unlink Google, Google unlinked, and the not-linked message", async () => {
    await signIn("home-signed-in", "home-signed-in-token");
    const screen = await renderHome();
    expect(screen.thrown, "signed-in / renders").toBeUndefined();

    const blob = screenBlob(screen.node);
    const missing = [
      ["preferences panel", "Preferences"],
      ["Sign out", "Sign out"],
      ["Unlink Google", "Unlink Google"],
      ["Google unlinked", "Google unlinked"],
      ["not-linked message", "Google account not linked"],
    ]
      .filter(([, text]) => !blob.includes(text))
      .map(([label]) => label);

    expect(missing, "signed-in /").toEqual([]);
    expect(landingCalls().auth, "signed-in / runs read-session").toBeGreaterThan(0);
  });

  it("Sign out calls signOut(), deletes this Session, clears the cookie, leaves User, Account, captures, and favorites, and redirects to /", async () => {
    const userId = "home-sign-out";
    const token = "home-sign-out-token";
    const otherToken = "home-sign-out-other";
    await signIn(userId, token);
    await prisma.session.create({
      data: {
        sessionToken: otherToken,
        userId,
        expires: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    await prisma.account.create({
      data: {
        userId,
        type: "oauth",
        provider: "google",
        providerAccountId: "google-sign-out",
      },
    });
    await prisma.capture.create({
      data: { id: "capture-sign-out", userId, source: "camera", status: "uploaded" },
    });
    await prisma.favorite.create({
      data: { userId, captureId: "capture-sign-out" },
    });

    const screen = await renderHome();
    expect(screen.thrown, "signed-in / renders Sign out").toBeUndefined();
    const signOut = findSignOut(screen.node);
    expect(signOut, "Sign out button on signed-in / calls signOut()").toEqual(expect.any(Function));

    let redirect: string | null = null;
    try {
      await signOut!();
    } catch (error) {
      redirect = redirectPath(error);
      if (!redirect) throw error;
    }

    expect(landingCalls().signOut, "Sign out calls signOut()").toBeGreaterThan(0);
    expect(redirect, "sign-out redirects to /").toBe("/");
    expect(await prisma.session.findUnique({ where: { sessionToken: token } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { sessionToken: otherToken } })).not.toBeNull();
    expect(cookieJar.get("authjs.session-token") ?? "").toBe("");
    expect(cookieJar.get("__Secure-authjs.session-token") ?? "").toBe("");
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await prisma.account.count({ where: { userId, provider: "google" } })).toBe(1);
    expect(await prisma.capture.findUnique({ where: { id: "capture-sign-out" } })).not.toBeNull();
    expect(
      await prisma.favorite.findUnique({
        where: { userId_captureId: { userId, captureId: "capture-sign-out" } },
      }),
    ).not.toBeNull();

    const signedOut = await renderHome();
    expect(signedOut.thrown, "signed-out landing after sign-out").toBeUndefined();
    expect(loginHrefs(signedOut.node).some(isLoginHref), "read-session null shows the signed-out landing").toBe(
      true,
    );
    expect(landingCalls().currentUserId, "signed-out landing does not call currentUserId()").toBe(0);

    const again = await renderHome();
    expect(again.thrown, "a second visit is the same signed-out page").toBeUndefined();
    expect(loginHrefs(again.node).some(isLoginHref)).toBe(true);
  });

  it("Unlink Google sends DELETE /api/account/google with no body, and 204 and 404 stay on signed-in /", async () => {
    const userId = "home-unlink";
    const token = "home-unlink-token";
    await signIn(userId, token);
    const screen = await renderHome();
    expect(screen.thrown, "signed-in / renders Unlink Google").toBeUndefined();
    const blob = screenBlob(screen.node);
    expect(blob.includes("Unlink Google"), "signed-in / shows Unlink Google").toBe(true);
    const handlers = await findUnlink(screen.node);
    expect(handlers, "Unlink Google calls DELETE /api/account/google").not.toEqual([]);

    const originalFetch = globalThis.fetch;
    const seen: { method: string; body: string | null }[] = [];
    const responses = [
      new Response(null, { status: 204 }),
      new Response(
        JSON.stringify({ error: { code: "not_found", message: "Google account not linked" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    ];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (typeof input === "object" && input !== null && "method" in input ? input.method : "GET")
      ).toUpperCase();
      if (new URL(url, "http://localhost:3000").pathname === "/api/account/google") {
        const body = init?.body == null ? null : String(init.body);
        seen.push({ method, body });
        return responses.shift() ?? new Response(null, { status: 204 });
      }
      return originalFetch(input, init);
    };

    try {
      for (const status of [204, 404]) {
        seen.length = 0;
        let redirect: string | null = null;
        try {
          await handlers[0]!();
        } catch (error) {
          redirect = redirectPath(error);
          if (!redirect) throw error;
        }
        expect(seen, `${status} DELETE /api/account/google with no body`).toEqual([
          { method: "DELETE", body: null },
        ]);
        expect(redirect === null || redirect === "/", `${status} stays on /`).toBe(true);
        expect(await prisma.session.findUnique({ where: { sessionToken: token } })).not.toBeNull();
        expect(cookieJar.get("authjs.session-token")).toBe(token);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    const stillSignedIn = await renderHome();
    expect(stillSignedIn.thrown, "204 and 404 stay on signed-in /").toBeUndefined();
    expect(screenBlob(stillSignedIn.node).includes("Preferences"), "204 and 404 stay on signed-in /").toBe(
      true,
    );
  });
});
