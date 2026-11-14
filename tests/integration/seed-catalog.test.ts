import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const requireFromDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { PGlite } = requireFromDb("@electric-sql/pglite") as {
  new (dataDir: string): {
    query: <T extends Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>;
    close: () => Promise<void>;
  };
};

const tsxCli = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

let dataDir: string;

async function queryCatalog(dir: string) {
  const db = new PGlite(dir);
  try {
    const users = await db.query<{ id: string }>(`SELECT id FROM "User" WHERE id = 'demo-user'`);
    const flags = await db.query<{ code: string }>(`SELECT code FROM "PreferenceFlag" ORDER BY code`);
    const ingredients = await db.query<{ slug: string }>(`SELECT slug FROM "Ingredient" ORDER BY slug`);
    const profiles = await db.query<{ ingredient_id: string }>(
      `SELECT ingredient_id FROM "IngredientProfile"`,
    );
    const aliases = await db.query<{ normalized: string }>(
      `SELECT normalized FROM "IngredientAlias" ORDER BY normalized`,
    );
    return { users: users.rows, flags: flags.rows, ingredients: ingredients.rows, profiles: profiles.rows, aliases: aliases.rows };
  } finally {
    await db.close();
  }
}

afterAll(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("seed", () => {
  it("deletes the demo-user upsert only and keeps catalog rows", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "seed-catalog-"));
    const env = { ...process.env, PGLITE_DATA_DIR: dataDir };
    delete env.DATABASE_URL;

    await execFileAsync(process.execPath, [tsxCli, "apps/migrate/src/seed.ts"], {
      cwd: repoRoot,
      env,
    });

    const catalog = await queryCatalog(dataDir);

    expect(catalog.flags.map((row) => row.code)).toEqual([
      "comedogenic",
      "fragrance_allergen",
      "gluten",
    ]);
    expect(catalog.ingredients.map((row) => row.slug)).toEqual([
      "coconut-oil",
      "fragrance",
      "wheat",
    ]);
    expect(catalog.profiles).toHaveLength(3);
    expect(catalog.aliases.map((row) => row.normalized)).toEqual([
      "coconut oil",
      "cocos nucifera oil",
      "fragrance",
      "parfum",
      "triticum aestivum",
      "wheat",
    ]);
    expect(catalog.users, "seed deletes the demo-user upsert only").toEqual([]);
  }, 30000);
});
