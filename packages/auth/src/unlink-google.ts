// Deletes Google Account rows for one user.
// Reports whether a row was deleted. User, Session, Capture, and Favorite stay.

import { prisma } from "@project/db";

export async function unlinkGoogleAccount(userId: string): Promise<boolean> {
  const result = await prisma.account.deleteMany({
    where: { userId, provider: "google" },
  });
  return result.count > 0;
}
