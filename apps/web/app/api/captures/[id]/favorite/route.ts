import { currentUserId } from "@project/auth";
import {
  FavoriteError,
  createFavorite,
  deleteFavorite,
  favoriteParamsSchema,
} from "@project/domain";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown): Response {
  if (error instanceof FavoriteError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const userId = await currentUserId();
    const { id } = favoriteParamsSchema.parse(await context.params);
    const favorite = await createFavorite(userId, id);
    return Response.json(favorite, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const userId = await currentUserId();
    const { id } = favoriteParamsSchema.parse(await context.params);
    await deleteFavorite(userId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
