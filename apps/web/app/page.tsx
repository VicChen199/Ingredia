// Home page. A signed-out visit links to /login. A signed-in visit keeps
// preferences and adds sign-out and unlink.
import { auth, signOut } from "@project/auth";
import { UserActionsAndPreferences } from "../components/preferences-panel";
import { UnlinkGoogleButton } from "./unlink-google-button";

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function Home() {
  const session = await auth();

  return (
    <main className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Starter Skeleton</h1>
        {session ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
                >
                  Sign out
                </button>
              </form>
              <UnlinkGoogleButton />
            </div>
            <UserActionsAndPreferences userId={session.user.id} />
          </div>
        ) : (
          <p>
            <a href="/login" className="text-blue-700 underline">
              Sign in
            </a>
          </p>
        )}
      </header>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
        <p className="text-neutral-600">
          Welcome to the starter skeleton. The database is connected and ready.
          Example branches add their own pages, API routes, and background workers here.
        </p>
      </section>
    </main>
  );
}
