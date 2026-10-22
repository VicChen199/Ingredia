import { currentUserId } from "@project/auth";
import {
  listPreferenceFlags,
  listUserPreferences,
} from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  const [preferences, availableFlags] = await Promise.all([
    listUserPreferences(userId),
    listPreferenceFlags(),
  ]);

  return Response.json({
    preferences: preferences.map(({ flag }) => flag),
    availableFlags,
  });
}