import { CaptureSource, CaptureStatus, prisma } from "@project/db";

export async function getUserById(userId: string): Promise<{ id: string } | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
}

export async function createCapture(
  userId: string,
  source: CaptureSource,
) {
  return prisma.capture.create({
    data: {
      userId,
      source,
      status: CaptureStatus.uploaded,
    },
    select: {
      id: true,
      source: true,
      status: true,
    },
  });
}

export async function updateCapture(
  captureId: string,
  userId: string,
  blobName: string | null,
  status: CaptureStatus,
) {
  return prisma.capture.update({
    where: { id_userId: { id: captureId, userId } },
    data: { blobName, status },
    select: {
      id: true,
      source: true,
      status: true,
    },
  });
}
