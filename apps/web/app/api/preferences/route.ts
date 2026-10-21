import { currentUserId } from "@project/auth";
import {
  listUserPreferences,
} from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  const preferences = await listUserPreferences(userId);

  return Response.json({
    preferences: preferences.map(({ flag }) => flag),
  });
}