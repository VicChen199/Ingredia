"use client";

// Unlink Google control on the signed-in home page.
// DELETE /api/account/google, then show the result without leaving the page.

import { useState } from "react";

export function UnlinkGoogleButton() {
  const [message, setMessage] = useState<string | null>(null);

  async function unlink() {
    const response = await fetch("/api/account/google", { method: "DELETE" });
    if (response.status === 204) {
      setMessage("Google unlinked");
      return;
    }
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(body?.error?.message ?? "Google account not linked");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void unlink()}
        className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
      >
        Unlink Google
      </button>
      {message ? (
        <p role="status" className="text-sm text-neutral-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
