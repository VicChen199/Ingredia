import { beforeAll, describe, expect, it } from "vitest";

type PrismaClient = import("@project/db").PrismaClient;
let prisma: PrismaClient;
let domain: typeof import("@project/domain");

beforeAll(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const db = await import("@project/db");
  prisma = db.prisma;
  domain = await import("@project/domain");
}, 30000);

describe("user preferences", () => {
  it("allows a user to check off set preferences (gluten and peanut) and associates them with their profile", async () => {
    const user = await prisma.user.create({
      data: { id: "user-profile-1", name: "Alice" },
    });

    const glutenFlag = await prisma.preferenceFlag.create({
      data: { id: "flag-gluten", code: "gluten", label: "Gluten", categoryScope: "food" },
    });

    const peanutFlag = await prisma.preferenceFlag.create({
      data: { id: "flag-peanut", code: "peanut", label: "Peanut", categoryScope: "food" },
    });

    // Check off gluten and peanut preferences for the user
    await domain.enableUserPreference(user.id, glutenFlag.id);
    await domain.enableUserPreference(user.id, peanutFlag.id);

    // Verify both preferences are associated with the user profile
    const userPreferences = await domain.listUserPreferences(user.id);
    expect(userPreferences).toHaveLength(2);

    const preferenceCodes = userPreferences.map((p) => p.flag.code);
    expect(preferenceCodes).toEqual(["gluten", "peanut"]);

    const preferenceLabels = userPreferences.map((p) => p.flag.label);
    expect(preferenceLabels).toEqual(["Gluten", "Peanut"]);
  });

  it("handles toggling preferences on and off for a user profile", async () => {
    const user = await prisma.user.create({
      data: { id: "user-profile-2", name: "Bob" },
    });

    const glutenFlag = await prisma.preferenceFlag.findUniqueOrThrow({
      where: { code: "gluten" },
    });
    const peanutFlag = await prisma.preferenceFlag.findUniqueOrThrow({
      where: { code: "peanut" },
    });

    // Check off both preferences
    await domain.enableUserPreference(user.id, glutenFlag.id);
    await domain.enableUserPreference(user.id, peanutFlag.id);

    let prefs = await domain.listUserPreferences(user.id);
    expect(prefs.map((p) => p.flag.code)).toEqual(["gluten", "peanut"]);

    // Uncheck peanut preference
    await domain.disableUserPreference(user.id, peanutFlag.id);
    prefs = await domain.listUserPreferences(user.id);
    expect(prefs.map((p) => p.flag.code)).toEqual(["gluten"]);

    // Uncheck gluten preference
    await domain.disableUserPreference(user.id, glutenFlag.id);
    prefs = await domain.listUserPreferences(user.id);
    expect(prefs).toEqual([]);
  });

  it("maintains preference isolation across different user profiles", async () => {
    const userA = await prisma.user.create({ data: { id: "user-profile-a", name: "Charlie" } });
    const userB = await prisma.user.create({ data: { id: "user-profile-b", name: "Dana" } });

    const glutenFlag = await prisma.preferenceFlag.findUniqueOrThrow({ where: { code: "gluten" } });
    const peanutFlag = await prisma.preferenceFlag.findUniqueOrThrow({ where: { code: "peanut" } });

    // User A checks off both gluten and peanut
    await domain.enableUserPreference(userA.id, glutenFlag.id);
    await domain.enableUserPreference(userA.id, peanutFlag.id);

    // User B checks off peanut only
    await domain.enableUserPreference(userB.id, peanutFlag.id);

    const userAPrefs = await domain.listUserPreferences(userA.id);
    const userBPrefs = await domain.listUserPreferences(userB.id);

    expect(userAPrefs.map((p) => p.flag.code)).toEqual(["gluten", "peanut"]);
    expect(userBPrefs.map((p) => p.flag.code)).toEqual(["peanut"]);
  });

  it("is idempotent when checking off an already selected preference", async () => {
    const user = await prisma.user.create({ data: { id: "user-profile-3", name: "Eve" } });
    const glutenFlag = await prisma.preferenceFlag.findUniqueOrThrow({ where: { code: "gluten" } });

    await domain.enableUserPreference(user.id, glutenFlag.id);
    await domain.enableUserPreference(user.id, glutenFlag.id);

    const prefs = await domain.listUserPreferences(user.id);
    expect(prefs).toHaveLength(1);
    expect(prefs[0].flag.code).toBe("gluten");
  });

  it("lists all available preference flags ordered by code", async () => {
    const flags = await domain.listPreferenceFlags();
    expect(flags.map((f) => f.code)).toEqual(["gluten", "peanut"]);
  });
});