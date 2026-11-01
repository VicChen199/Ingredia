import { auth, signIn } from "@project/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function signInWithGoogle() {
  "use server";
  await signIn("google");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  const params = await searchParams;
  const error = params.error;
  const failed =
    (typeof error === "string" && error.length > 0) ||
    (Array.isArray(error) && error.length > 0);

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {failed ? <p>Sign-in failed</p> : null}
      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
