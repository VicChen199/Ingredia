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
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside
        id="account"
        className="w-full shrink-0 border-b border-neutral-200 bg-neutral-50 md:w-1/4 md:border-b-0 md:border-r"
      >
        <div className="flex flex-col gap-7 p-5 md:sticky md:top-0 md:h-screen md:overflow-y-auto">
          <div>
            <p className="text-lg font-semibold tracking-tight text-neutral-900">Ingredia</p>
            <p className="mt-1 text-xs text-neutral-500">Workspace</p>
          </div>

          <div className="space-y-2">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Browse
            </p>
            <nav aria-label="Workspace navigation" className="space-y-1">
              <a
                href="#home"
                aria-current="page"
                className="flex items-center gap-3 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800"
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-600" />
                Home
              </a>
              <a
                href={session ? "#account-preferences" : "#account-controls"}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-neutral-400" />
                Preferences
              </a>
            </nav>
          </div>

          <section id="account-controls" aria-label="Account controls" className="space-y-3">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Account
            </p>
            {session ? (
              <div className="space-y-3">
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center rounded-md border border-neutral-300 bg-white px-3 py-2 text-left text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
                  >
                    Sign out
                  </button>
                </form>
                <UnlinkGoogleButton />
              </div>
            ) : (
              <a
                href="/login"
                className="inline-flex w-full items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Sign in
              </a>
            )}
          </section>

          {session && <UserActionsAndPreferences userId={session.user.id} />}
        </div>
      </aside>

      <main id="home" className="min-w-0 flex-1 space-y-8 p-6 md:p-10">
        <header className="space-y-3">
          <p className="text-sm font-medium text-blue-700">Home</p>
          <h1 className="text-3xl font-bold tracking-tight">Starter Skeleton</h1>
        </header>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Welcome</h2>
          <p className="mt-2 text-neutral-600">
            The database is connected and ready. Example branches add their own pages, API routes,
            and background workers here.
          </p>
        </section>
      </main>
    </div>
  );
}
