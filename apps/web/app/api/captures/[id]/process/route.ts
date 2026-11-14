import { currentUserId } from "@project/auth";
import { ProcessError, processCapture, processRequestSchema, type ImageTextReader } from "@project/domain";
import { downloadAttachment, readLabelText } from "@project/services";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const readImageText: ImageTextReader = async (blobName) => {
  const image = await downloadAttachment(blobName);
  if (!image) throw new Error(`blob not found: ${blobName}`);
  return readLabelText(image.data, image.contentType);
};

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch {
    return errorResponse("UNAUTHENTICATED", "a signed-in user is required", 401);
  }

  const { id } = await context.params;

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("INVALID_PROCESS_REQUEST", "body must be JSON", 400);
    }
  }

  const parsed = processRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_PROCESS_REQUEST",
      "text must be a non-empty string of at most 10,000 characters",
      400,
    );
  }

  try {
    const result = await processCapture(userId, id, parsed.data.text, readImageText);
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ProcessError) {
      return errorResponse(error.code, error.message, error.status);
    }
    return errorResponse("CAPTURE_PROCESS_FAILED", "the capture could not be processed", 500);
  }
}
