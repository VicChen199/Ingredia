import { auth } from "./auth";

export async function currentUserId(): Promise<string> {
  const session = await auth();
  if (!session) {
    throw new Error("A signed-in user is required");
  }
  return session.user.id;
}
