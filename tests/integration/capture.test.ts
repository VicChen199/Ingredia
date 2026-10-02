import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const requireFromServices = createRequire(
  new URL("../../packages/services/package.json", import.meta.url),
);
const { BlobServiceClient } = requireFromServices("@azure/storage-blob");

const TEST_USER_ID = "capture-upload-user";
const IMAGE_BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;

vi.mock("../../packages/auth/src/index", () => ({
  currentUserId: async () => TEST_USER_ID,
}));

const [{ POST }, db] = await Promise.all([
  import("../../apps/web/app/api/capture/route"),
  import("@project/db"),
]);

const storageConnectionString =
  process.env.AZURE_STORAGE_CONNECTION_STRING ?? "UseDevelopmentStorage=true";
let blobName: string | null = null;

describe("POST /api/capture", () => {
  beforeAll(async () => {
    await db.prisma.user.create({ data: { id: TEST_USER_ID } });
  });

  afterAll(async () => {
    if (blobName) {
      const service = BlobServiceClient.fromConnectionString(storageConnectionString);
      await service
        .getContainerClient("attachments")
        .getBlockBlobClient(blobName)
        .deleteIfExists();
    }

    await db.prisma.user.delete({ where: { id: TEST_USER_ID } });
    await db.prisma.$disconnect();
  });

  it("creates a Capture and stores the uploaded image in Azurite", async () => {
    const form = new FormData();
    form.set("file", new File([IMAGE_BYTES], "label.png", { type: "image/png" }));
    form.set("source", "camera");

    const response = await POST(
      new Request("http://localhost/api/capture", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      capture: { id: string; source: string; status: string };
    };

    expect(body.capture.source).toBe("camera");
    expect(body.capture.status).toBe("uploaded");

    const capture = await db.prisma.capture.findUnique({
      where: { id: body.capture.id },
    });

    expect(capture).not.toBeNull();
    expect(capture?.userId).toBe(TEST_USER_ID);
    expect(capture?.source).toBe("camera");
    expect(capture?.status).toBe("uploaded");
    expect(capture?.blobName).toBe(`${body.capture.id}/label.png`);
    blobName = capture?.blobName ?? null;

    const service = BlobServiceClient.fromConnectionString(storageConnectionString);
    const blob = service
      .getContainerClient("attachments")
      .getBlockBlobClient(capture!.blobName!);
    const properties = await blob.getProperties();
    const downloaded = await blob.downloadToBuffer();

    expect(properties.contentType).toBe("image/png");
    expect(downloaded).toEqual(Buffer.from(IMAGE_BYTES));
  });
});
