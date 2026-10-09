import { currentUserId } from "@project/auth";
import { CaptureSource, CaptureStatus } from "@project/db";
import { createCapture, getUserById, updateCapture } from "@project/domain";
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from "@project/services";

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch {
    return errorResponse("UNAUTHENTICATED", "a signed-in user is required", 401);
  }

  let user: { id: string } | null;
  try {
    user = await getUserById(userId);
  } catch {
    return errorResponse("DATABASE_UNAVAILABLE", "the database is unavailable", 503);
  }

  if (!user) {
    return errorResponse("UNAUTHENTICATED", "a signed-in user is required", 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("INVALID_CAPTURE_UPLOAD", "request must be multipart form data", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("INVALID_CAPTURE_UPLOAD", "file is required", 400);
  }

  if (!file.type.startsWith("image/") || file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return errorResponse("INVALID_CAPTURE_UPLOAD", "file must be a non-empty image no larger than 5 MB", 400);
  }

  const sourceValue = formData.get("source");
  if (
    sourceValue !== null &&
    (typeof sourceValue !== "string" ||
      (sourceValue !== CaptureSource.camera && sourceValue !== CaptureSource.extension))
  ) {
    return errorResponse("INVALID_CAPTURE_UPLOAD", "source must be camera or extension", 400);
  }

  const source =
    sourceValue === CaptureSource.extension ? CaptureSource.extension : CaptureSource.camera;

  let capture: { id: string };
  try {
    capture = await createCapture(user.id, source);
  } catch {
    return errorResponse("CAPTURE_CREATE_FAILED", "the capture could not be created", 500);
  }

  try {
    const blobName = await uploadAttachment(
      capture.id,
      file.name,
      file.type,
      await file.arrayBuffer(),
    );
    const updatedCapture = await updateCapture(
      capture.id,
      user.id,
      blobName,
      CaptureStatus.uploaded,
    );
    return Response.json({ capture: updatedCapture }, { status: 201 });
  } catch {
    try {
      await updateCapture(capture.id, user.id, null, CaptureStatus.failed);
    } catch {
      // Preserve the original upload failure response if the status update fails.
    }
    return errorResponse("CAPTURE_UPLOAD_FAILED", "the capture upload failed", 503);
  }
}
