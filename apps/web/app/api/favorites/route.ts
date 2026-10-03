import { currentUserId } from "@project/auth";
import { FavoriteError, listFavorites } from "@project/domain";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown): Response {
  if (error instanceof FavoriteError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
}

export async function GET(_request: Request): Promise<Response> {
  try {
    const userId = await currentUserId();
    const favorites = await listFavorites(userId);
    return Response.json(favorites);
  } catch (error) {
    return errorResponse(error);
  }
}
