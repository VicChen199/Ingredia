// Seed script: stub user plus a demo catalog for gluten, fragrance, and comedogenic.
// Safe to re-run. Run via: pnpm db:seed

import { prisma } from "@project/db";

const flags = [
  { id: "flag-gluten", code: "gluten", label: "Gluten", categoryScope: "food" },
  {
    id: "flag-fragrance",
    code: "fragrance_allergen",
    label: "Fragrance allergen",
    categoryScope: "beauty",
  },
  {
    id: "flag-comedogenic",
    code: "comedogenic",
    label: "Comedogenic",
    categoryScope: "beauty",
  },
] as const;

const ingredients = [
  {
    id: "ing-wheat",
    slug: "wheat",
    displayName: "Wheat",
    flagId: "flag-gluten",
    productCategory: "food",
    profile: {
      originSummary: "plant" as const,
      manufacturerUse: "Flour and binder",
      summary: "A grain that contains gluten proteins.",
    },
    aliases: [
      { name: "Wheat", nameType: "common" as const, normalized: "wheat" },
      { name: "Triticum aestivum", nameType: "inci" as const, normalized: "triticum aestivum" },
    ],
  },
  {
    id: "ing-fragrance",
    slug: "fragrance",
    displayName: "Fragrance",
    flagId: "flag-fragrance",
    productCategory: "beauty",
    profile: {
      originSummary: "mixed" as const,
      manufacturerUse: "Scent",
      summary: "An umbrella term for scent ingredients that can be allergens.",
    },
    aliases: [
      { name: "Fragrance", nameType: "common" as const, normalized: "fragrance" },
      { name: "Parfum", nameType: "inci" as const, normalized: "parfum" },
    ],
  },
  {
    id: "ing-coconut-oil",
    slug: "coconut-oil",
    displayName: "Coconut oil",
    flagId: "flag-comedogenic",
    productCategory: "beauty",
    profile: {
      originSummary: "plant" as const,
      manufacturerUse: "Emollient",
      summary: "A plant oil that can clog pores in leave-on skin products.",
    },
    aliases: [
      { name: "Coconut oil", nameType: "common" as const, normalized: "coconut oil" },
      { name: "Cocos nucifera oil", nameType: "inci" as const, normalized: "cocos nucifera oil" },
    ],
  },
];

async function main() {
  await prisma.user.upsert({
    where: { id: "demo-user" },
    update: {},
    create: { id: "demo-user", name: "Demo", email: "demo@localhost" },
  });

  for (const flag of flags) {
    await prisma.preferenceFlag.upsert({
      where: { id: flag.id },
      update: { code: flag.code, label: flag.label, categoryScope: flag.categoryScope },
      create: flag,
    });
  }

  for (const ingredient of ingredients) {
    await prisma.ingredient.upsert({
      where: { id: ingredient.id },
      update: { slug: ingredient.slug, displayName: ingredient.displayName },
      create: {
        id: ingredient.id,
        slug: ingredient.slug,
        displayName: ingredient.displayName,
      },
    });

    await prisma.ingredientProfile.upsert({
      where: { ingredientId: ingredient.id },
      update: ingredient.profile,
      create: { ingredientId: ingredient.id, ...ingredient.profile },
    });

    await prisma.ingredientFlag.upsert({
      where: {
        ingredientId_flagId: { ingredientId: ingredient.id, flagId: ingredient.flagId },
      },
      update: { productCategory: ingredient.productCategory },
      create: {
        ingredientId: ingredient.id,
        flagId: ingredient.flagId,
        productCategory: ingredient.productCategory,
      },
    });

    for (const alias of ingredient.aliases) {
      await prisma.ingredientAlias.upsert({
        where: {
          ingredientId_normalized_nameType: {
            ingredientId: ingredient.id,
            normalized: alias.normalized,
            nameType: alias.nameType,
          },
        },
        update: { name: alias.name },
        create: { ingredientId: ingredient.id, ...alias },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
