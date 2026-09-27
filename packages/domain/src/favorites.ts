import { prisma } from "@project/db";
import { z } from "zod";

export const favoriteParamsSchema = z.object({ id: z.string().min(1) });

export type FavoriteView = {
  userId: string;
  captureId: string;
  capture: {
    id: string;
    source: "camera" | "extension";
    status: "uploaded" | "extracted" | "parsed" | "failed";
    blobName: string | null;
    rawText: string | null;
    createdAt: string;
    updatedAt: string;
    items: Array<{
      sortOrder: number;
      rawToken: string;
      ingredientId: string | null;
      matchStatus: "matched" | "unknown" | "ambiguous";
    }>;
  };
};

export class FavoriteError extends Error {
  status: 401 | 404 | 409;
  code: "unauthorized" | "not_found" | "conflict";

  constructor(
    status: 401 | 404 | 409,
    code: "unauthorized" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "FavoriteError";
    this.status = status;
    this.code = code;
  }
}

type FavoriteRow = {
  userId: string;
  captureId: string;
  capture: {
    id: string;
    source: "camera" | "extension";
    status: "uploaded" | "extracted" | "parsed" | "failed";
    blobName: string | null;
    rawText: string | null;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      sortOrder: number;
      rawToken: string;
      ingredientId: string | null;
      matchStatus: "matched" | "unknown" | "ambiguous";
    }>;
  };
};

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

function toFavoriteView(row: FavoriteRow): FavoriteView {
  return {
    userId: row.userId,
    captureId: row.captureId,
    capture: {
      id: row.capture.id,
      source: row.capture.source,
      status: row.capture.status,
      blobName: row.capture.blobName,
      rawText: row.capture.rawText,
      createdAt: row.capture.createdAt.toISOString(),
      updatedAt: row.capture.updatedAt.toISOString(),
      items: row.capture.items.map((item) => ({
        sortOrder: item.sortOrder,
        rawToken: item.rawToken,
        ingredientId: item.ingredientId,
        matchStatus: item.matchStatus,
      })),
    },
  };
}

async function requireUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new FavoriteError(401, "unauthorized", "User not found");
  }
}

export async function createFavorite(userId: string, captureId: string): Promise<FavoriteView> {
  await requireUser(userId);
  const capture = await prisma.capture.findUnique({
    where: { id_userId: { id: captureId, userId } },
  });
  if (!capture) {
    throw new FavoriteError(404, "not_found", "Capture not found");
  }
  try {
    const row = await prisma.favorite.create({
      data: { userId, captureId },
      include: {
        capture: { include: { items: { orderBy: { sortOrder: "asc" } } } },
      },
    });
    return toFavoriteView(row);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new FavoriteError(409, "conflict", "Favorite already exists");
    }
    throw error;
  }
}

export async function deleteFavorite(userId: string, captureId: string): Promise<void> {
  await requireUser(userId);
  try {
    await prisma.favorite.delete({
      where: { userId_captureId: { userId, captureId } },
    });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw new FavoriteError(404, "not_found", "Favorite not found");
    }
    throw error;
  }
}

export async function listFavorites(userId: string): Promise<FavoriteView[]> {
  await requireUser(userId);
  const rows = await prisma.favorite.findMany({
    where: { userId },
    include: {
      capture: { include: { items: { orderBy: { sortOrder: "asc" } } } },
    },
    orderBy: [{ capture: { createdAt: "desc" } }, { captureId: "asc" }],
  });
  return rows.map(toFavoriteView);
}
