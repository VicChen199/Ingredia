import { currentUserId } from "@project/auth";
import { CaptureReadError, captureReadParamsSchema, getCapture } from "@project/domain";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch {
    return Response.json({ error: { code: "unauthorized", message: "A signed-in user is required" } }, { status: 401 });
  }
  try {
    const parsed = captureReadParamsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return Response.json({ error: { code: "validation_error", message: "Invalid capture id" } }, { status: 400 });
    }
    return Response.json(await getCapture(userId, parsed.data.id));
  } catch (error) {
    if (error instanceof CaptureReadError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
  }
}
