import { currentUserId } from "@project/auth";
import { CaptureReadError, listCaptures } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch {
    return Response.json({ error: { code: "unauthorized", message: "A signed-in user is required" } }, { status: 401 });
  }
  try {
    return Response.json(await listCaptures(userId));
  } catch (error) {
    if (error instanceof CaptureReadError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
  }
}
