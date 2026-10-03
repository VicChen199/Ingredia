import { prisma } from "@project/db";
import { z } from "zod";

export const captureReadParamsSchema = z.object({ id: z.string().min(1) });

export class CaptureReadError extends Error {
  constructor(
    readonly status: 401 | 404,
    readonly code: "unauthorized" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "CaptureReadError";
  }
}

// Select only the fields in the public contract. Nested relations are batched
// by Prisma, rather than queried once per item.
const captureReadSelect = {
  id: true,
  source: true,
  status: true,
  blobName: true,
  rawText: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { sortOrder: "asc" },
    select: {
      sortOrder: true,
      rawToken: true,
      ingredientId: true,
      matchStatus: true,
      ingredient: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          profile: {
            select: { originSummary: true, manufacturerUse: true, summary: true },
          },
          flags: {
            orderBy: { flag: { code: "asc" } },
            select: {
              productCategory: true,
              flag: {
                select: { id: true, code: true, label: true, categoryScope: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

async function findCaptureRows(userId: string) {
  return prisma.capture.findMany({
    where: { userId },
    select: captureReadSelect,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

type CaptureReadRow = Awaited<ReturnType<typeof findCaptureRows>>[number];

function toCaptureView(row: CaptureReadRow, enabledFlags: Set<string>) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map(({ ingredient, ...item }) => ({
      ...item,
      ingredient: ingredient === null ? null : {
        ...ingredient,
        flags: ingredient.flags.map(({ flag, productCategory }) => ({
          ...flag,
          productCategory,
          enabledByUser: enabledFlags.has(flag.id),
        })),
      },
    })),
  };
}

export type CaptureView = ReturnType<typeof toCaptureView>;

async function requireUser(userId: string): Promise<void> {
  if (!userId || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    throw new CaptureReadError(401, "unauthorized", "A signed-in user is required");
  }
}

async function getEnabledFlags(userId: string): Promise<Set<string>> {
  const preferences = await prisma.userPreference.findMany({
    where: { userId },
    select: { flagId: true },
  });
  return new Set(preferences.map(({ flagId }) => flagId));
}

export async function listCaptures(userId: string): Promise<CaptureView[]> {
  await requireUser(userId);
  const [rows, enabledFlags] = await Promise.all([
    findCaptureRows(userId), getEnabledFlags(userId),
  ]);
  return rows.map((row) => toCaptureView(row, enabledFlags));
}

export async function getCapture(userId: string, id: string): Promise<CaptureView> {
  await requireUser(userId);
  const row = await prisma.capture.findUnique({
    where: { id_userId: { id, userId } },
    select: captureReadSelect,
  });
  if (!row) throw new CaptureReadError(404, "not_found", "Capture not found");
  return toCaptureView(row, await getEnabledFlags(userId));
}
