import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "test-auth-secret";

vi.mock("../../packages/auth/src/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/auth/src/index")>();
  return {
    ...actual,
    currentUserId: async () => {
      throw new Error("no session");
    },
  };
});

describe("DELETE /api/account/google unauthorized", () => {
  it("returns 401 when currentUserId() throws", async () => {
    const routePath = fileURLToPath(
      new URL("../../apps/web/app/api/account/google/route.ts", import.meta.url),
    );
    expect(existsSync(routePath), "DELETE /api/account/google").toBe(true);

    const route = (await import("../../apps/web/app/api/account/google/route.ts")) as {
      DELETE?: (request: Request) => Promise<Response>;
    };
    expect(route.DELETE, "DELETE /api/account/google").toEqual(expect.any(Function));

    const response = await route.DELETE!(
      new Request("http://localhost/api/account/google", { method: "DELETE" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "A signed-in user is required" },
    });
  });
});
