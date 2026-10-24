// Boilerplate home page. Shows the current dev user and a link to the health
// check endpoint. Example branches replace this with their own app-specific UI.
import { currentUserId } from "@project/auth";
import { UserActionsAndPreferences } from "../components/preferences-panel";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await currentUserId();

  return (
    <main className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Starter Skeleton</h1>
        <UserActionsAndPreferences userId={userId} />
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