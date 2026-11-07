// DELETE /api/account/google. Unlinks the signed-in user's Google account.
// 204 when a row was deleted, 404 when none, 401 when currentUserId() throws.

import { currentUserId, unlinkGoogleAccount } from "@project/auth";

export const dynamic = "force-dynamic";

export async function DELETE(): Promise<Response> {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch {
    return Response.json(
      { error: { code: "unauthorized", message: "A signed-in user is required" } },
      { status: 401 },
    );
  }

  const deleted = await unlinkGoogleAccount(userId);
  if (!deleted) {
    return Response.json(
      { error: { code: "not_found", message: "Google account not linked" } },
      { status: 404 },
    );
  }

  return new Response(null, { status: 204 });
}
