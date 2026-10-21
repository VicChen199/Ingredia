import { prisma } from "@project/db";
import { z } from "zod";

// Web-only domain logic: input validation schemas and database queries.
export { CaptureReadError, captureReadParamsSchema, getCapture, listCaptures } from "./capture-read";
export type { CaptureView } from "./capture-read";
export {
  createCapture,
  getUserById,
  updateCapture,
} from "./capture";
export {
  FavoriteError,
  createFavorite,
  deleteFavorite,
  favoriteParamsSchema,
  listFavorites,
} from "./favorites";
export type { FavoriteView } from "./favorites";
export {
  MAX_PROCESS_TEXT_LENGTH,
  ProcessError,
  STUB_LABEL_TEXT,
  normalize,
  processCapture,
  processRequestSchema,
  tokenize,
  type MatchStatus,
  type ProcessedItem,
} from "./process";

export const preferenceFlagParamsSchema = z.object({
  flagId: z.string().min(1),
});

export class PreferenceNotFoundError extends Error {
  constructor() {
    super("Preference flag not found");
    this.name = "PreferenceNotFoundError";
  }
}

export async function listUserPreferences(userId: string) {
  return prisma.userPreference.findMany({
    where: { userId },
    include: { flag: true },
    orderBy: { flag: { code: "asc" } },
  });
}

export async function enableUserPreference(userId: string, flagId: string) {
  const flag = await prisma.preferenceFlag.findUnique({ where: { id: flagId } });
  if (!flag) throw new PreferenceNotFoundError();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new PreferenceNotFoundError();

  return prisma.userPreference.upsert({
    where: { userId_flagId: { userId, flagId } },
    create: { userId, flagId },
    update: {},
    include: { flag: true },
  });
}

export async function disableUserPreference(userId: string, flagId: string) {
  const flag = await prisma.preferenceFlag.findUnique({ where: { id: flagId } });
  if (!flag) throw new PreferenceNotFoundError();

  await prisma.userPreference.deleteMany({ where: { userId, flagId } });
}
