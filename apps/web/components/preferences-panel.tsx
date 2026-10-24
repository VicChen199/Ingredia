"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PreferenceFlagItem {
  id: string;
  code: string;
  label: string;
  categoryScope: string | null;
}

interface PreferencesResponse {
  preferences: PreferenceFlagItem[];
  availableFlags?: PreferenceFlagItem[];
  error?: { code: string; message: string };
}

interface UserActionsAndPreferencesProps {
  userId: string;
}

export function UserActionsAndPreferences({ userId }: UserActionsAndPreferencesProps) {
  const panelId = "preferences-panel";
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [availableFlags, setAvailableFlags] = useState<PreferenceFlagItem[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const healthLinkRef = useRef<HTMLAnchorElement | null>(null);
  const prefsButtonRef = useRef<HTMLButtonElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const refreshEmptyButtonRef = useRef<HTMLButtonElement | null>(null);
  const checkboxRefs = useRef<Array<HTMLInputElement | null>>([]);

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as PreferencesResponse | null;
        throw new Error(body?.error?.message ?? `Failed to load preferences (${response.status})`);
      }

      const data = (await response.json()) as PreferencesResponse;
      const enabled = new Set((data.preferences ?? []).map((flag) => flag.id));
      const catalog =
        data.availableFlags && data.availableFlags.length > 0
          ? data.availableFlags
          : (data.preferences ?? []);

      setEnabledIds(enabled);
      setAvailableFlags(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load preferences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchPreferences();
    }
  }, [isOpen, fetchPreferences]);

  const toggleFlag = useCallback(
    async (flag: PreferenceFlagItem) => {
      if (pendingIds.has(flag.id)) return;

      const wasEnabled = enabledIds.has(flag.id);
      const nextEnabled = !wasEnabled;

      setToastError(null);
      setEnabledIds((prev) => {
        const next = new Set(prev);
        if (nextEnabled) {
          next.add(flag.id);
        } else {
          next.delete(flag.id);
        }
        return next;
      });
      setPendingIds((prev) => new Set(prev).add(flag.id));

      try {
        const response = await fetch(`/api/preferences/${encodeURIComponent(flag.id)}`, {
          method: nextEnabled ? "PUT" : "DELETE",
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(
            body?.error?.message ?? `Could not update "${flag.label}" (${response.status})`,
          );
        }
      } catch (err) {
        // Roll back optimistic state and surface toast
        setEnabledIds((prev) => {
          const rollback = new Set(prev);
          if (wasEnabled) {
            rollback.add(flag.id);
          } else {
            rollback.delete(flag.id);
          }
          return rollback;
        });
        setToastError(
          err instanceof Error
            ? `${err.message} — reverted "${flag.label}".`
            : `Failed to update "${flag.label}" — change reverted.`,
        );
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(flag.id);
          return next;
        });
      }
    },
    [enabledIds, pendingIds],
  );

  const focusFirstPanelControl = () => {
    if (error && retryButtonRef.current) {
      retryButtonRef.current.focus();
      return;
    }
    if (availableFlags.length === 0 && refreshEmptyButtonRef.current) {
      refreshEmptyButtonRef.current.focus();
      return;
    }
    checkboxRefs.current[0]?.focus();
  };

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (active === healthLinkRef.current) {
        prefsButtonRef.current?.focus();
      } else {
        healthLinkRef.current?.focus();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (isOpen) {
        focusFirstPanelControl();
      } else if (active === healthLinkRef.current) {
        prefsButtonRef.current?.focus();
      } else {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (active === prefsButtonRef.current) {
        healthLinkRef.current?.focus();
      } else {
        prefsButtonRef.current?.focus();
      }
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      prefsButtonRef.current?.focus();
    }
  };

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      prefsButtonRef.current?.focus();
      return;
    }

    if (availableFlags.length === 0) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        prefsButtonRef.current?.focus();
      }
      return;
    }

    const currentIndex = checkboxRefs.current.findIndex(
      (input) => input === document.activeElement,
    );

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + 1) % availableFlags.length;
      checkboxRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (currentIndex <= 0) {
        prefsButtonRef.current?.focus();
      } else {
        checkboxRefs.current[currentIndex - 1]?.focus();
      }
      return;
    }

    if (event.key === "Enter" && currentIndex >= 0) {
      event.preventDefault();
      const flag = availableFlags[currentIndex];
      if (flag) {
        void toggleFlag(flag);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-xs">
        <div className="text-sm text-neutral-600">
          Signed in as{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-900">
            {userId}
          </code>{" "}
          <span className="text-neutral-400">
            (dev identity stub — real auth arrives in Week 8)
          </span>
        </div>

        <div
          role="toolbar"
          aria-label={`Actions for ${userId}`}
          onKeyDown={handleToolbarKeyDown}
          className="flex items-center gap-2"
        >
          <a
            ref={healthLinkRef}
            href="/api/health"
            className="inline-flex items-center rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Check health &rarr;
          </a>

          <button
            ref={prefsButtonRef}
            type="button"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex items-center rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {isOpen ? "Hide preferences" : "Preferences"}
          </button>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Keyboard: use <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">Tab</kbd>{" "}
        or arrow keys (<kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">&larr;</kbd>{" "}
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">&rarr;</kbd>{" "}
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">&uarr;</kbd>{" "}
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">&darr;</kbd>) to move
        between controls,{" "}
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">Space</kbd> /{" "}
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">Enter</kbd> to
        activate, and <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1">Esc</kbd>{" "}
        to close preferences.
      </p>

      {isOpen && (
        <section
          id={panelId}
          aria-label={`Dietary and ingredient preferences for ${userId}`}
          onKeyDown={handlePanelKeyDown}
          className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                Preferences for <code className="text-sm font-mono">{userId}</code>
              </h2>
              <p className="text-sm text-neutral-600">
                Toggle ingredient flags to highlight matches when scanning labels.
              </p>
            </div>
          </div>

          {toastError && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {toastError}
            </div>
          )}

          {loading ? (
            <div aria-busy="true" aria-label="Loading preferences" className="space-y-2">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="h-12 animate-pulse rounded-md border border-neutral-200 bg-neutral-200/70"
                />
              ))}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-white p-4 space-y-3"
            >
              <p className="text-sm text-red-700">{error}</p>
              <button
                ref={retryButtonRef}
                type="button"
                onClick={() => void fetchPreferences()}
                className="inline-flex items-center rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Retry
              </button>
            </div>
          ) : availableFlags.length === 0 ? (
            <div className="rounded-md border border-neutral-200 bg-white p-4 space-y-3">
              <p className="text-sm text-neutral-600">
                No preference flags found. Seed the database with{" "}
                <code className="rounded bg-neutral-100 px-1">pnpm db:seed</code> and refresh.
              </p>
              <button
                ref={refreshEmptyButtonRef}
                type="button"
                onClick={() => void fetchPreferences()}
                className="inline-flex items-center rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Refresh flags
              </button>
            </div>
          ) : (
            <ul className="space-y-2" role="list">
              {availableFlags.map((flag, index) => {
                const checked = enabledIds.has(flag.id);
                const isPending = pendingIds.has(flag.id);
                return (
                  <li key={flag.id}>
                    <label className="flex cursor-pointer items-center justify-between rounded-md border border-neutral-200 bg-white px-4 py-3 transition hover:border-neutral-300 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-1">
                      <div className="flex items-center gap-3">
                        <input
                          ref={(el) => {
                            checkboxRefs.current[index] = el;
                          }}
                          type="checkbox"
                          checked={checked}
                          disabled={isPending}
                          onChange={() => void toggleFlag(flag)}
                          className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-600"
                        />
                        <div>
                          <span className="font-medium text-neutral-900">{flag.label}</span>
                          <span className="ml-2 text-xs text-neutral-400">({flag.code})</span>
                        </div>
                      </div>

                      {flag.categoryScope && (
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                          {flag.categoryScope}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
